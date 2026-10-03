//! Durable analysis history lives in app data, never in the disposable plot/export cache.
//! Each history item is an immutable, atomically published full JSON snapshot. There is
//! no separately updated index that can lose synchronization with snapshot files.
use serde::Serialize;
use serde_json::Value;
use std::{
  fs::{self, File, OpenOptions},
  io::{Read, Write},
  path::{Path, PathBuf},
  sync::{atomic::{AtomicU64, Ordering}, Mutex},
  time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_RECORD_BYTES: u64 = 64 * 1024 * 1024;
const MAX_HISTORY_ITEMS: usize = 4096;
static HISTORY_LOCK: Mutex<()> = Mutex::new(());
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
  id: String,
  saved_at: String,
  label: String,
  input_view: String,
  workflow: String,
  has_result: bool,
  group_count: usize,
  reference_group: Option<String>,
  reference_value: f64,
  #[serde(skip_serializing_if = "Option::is_none")]
  error: Option<String>,
}

fn id_path(root: &Path, id: &str) -> Result<PathBuf, String> {
  if id.is_empty() || id.len() > 96 || !id.as_bytes()[0].is_ascii_alphanumeric()
    || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
    return Err("历史记录标识无效".into());
  }
  Ok(root.join("snapshots").join(format!("{id}.json")))
}
fn validate(text: &str) -> Result<Value, String> {
  if text.len() as u64 > MAX_RECORD_BYTES {return Err("分析记录超过 64 MiB 限制".into());}
  let record: Value = serde_json::from_str(text).map_err(|e| format!("分析记录 JSON 无效: {e}"))?;
  let schema = record.get("schema").and_then(Value::as_str);
  if !matches!(schema, Some("elisa-analysis/1") | Some("elisa-analysis/2")) {
    return Err("分析记录版本不兼容".into());
  }
  if record.pointer("/inputs/rawText").and_then(Value::as_str).is_none() {
    return Err("分析记录缺少原始输入".into());
  }
  if schema == Some("elisa-analysis/2") && record.get("saved_at").and_then(Value::as_str).is_none() {
    return Err("完整分析记录缺少保存时间".into());
  }
  Ok(record)
}
fn read_bounded(path: &Path) -> Result<String, String> {
  let meta = fs::symlink_metadata(path).map_err(|e| format!("无法读取历史记录: {e}"))?;
  if !meta.is_file() || meta.file_type().is_symlink() {return Err("历史记录不是常规文件".into());}
  if meta.len() > MAX_RECORD_BYTES {return Err("分析记录超过 64 MiB 限制".into());}
  let mut bytes = Vec::new();
  File::open(path).map_err(|e| e.to_string())?.take(MAX_RECORD_BYTES + 1)
    .read_to_end(&mut bytes).map_err(|e| format!("历史记录读取失败: {e}"))?;
  if bytes.len() as u64 > MAX_RECORD_BYTES {return Err("分析记录超过 64 MiB 限制".into());}
  String::from_utf8(bytes).map_err(|e| format!("历史记录不是 UTF-8: {e}"))
}
fn ensure_directory(path: &Path) -> Result<(), String> {
  if !path.exists() {
    if let Some(parent) = path.parent() {if !parent.exists() {ensure_directory(parent)?;}}
    match fs::create_dir(path) {
      Ok(()) => {},
      Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {},
      Err(error) => return Err(format!("无法建立应用历史目录: {error}")),
    }
  }
  let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
  if !meta.is_dir() || meta.file_type().is_symlink() {return Err("应用历史目录无效或是符号链接".into());}
  // Persist each new ancestor entry too, including the first application launch.
  sync_directory(path)?;
  if let Some(parent) = path.parent() {sync_directory(parent)?;}
  Ok(())
}
#[cfg(not(windows))]
fn sync_directory(path: &Path) -> Result<(), String> {
  File::open(path).and_then(|file| file.sync_all())
    .map_err(|e| format!("历史目录持久化失败: {e}"))
}
#[cfg(windows)]
fn sync_directory(_path: &Path) -> Result<(), String> {
  // Windows publication uses MOVEFILE_WRITE_THROUGH after the file was synced.
  Ok(())
}
#[cfg(not(windows))]
fn publish(temp: &Path, destination: &Path, replace: bool) -> Result<(), String> {
  if replace {
    fs::rename(temp, destination).map_err(|e| format!("原子更新上次会话失败: {e}"))?;
  } else {
    // link() is atomic and refuses an existing destination, unlike rename().
    fs::hard_link(temp, destination).map_err(|e| format!("原子保存历史记录失败: {e}"))?;
    fs::remove_file(temp).map_err(|e| format!("清理历史临时文件失败: {e}"))?;
  }
  sync_directory(destination.parent().ok_or("历史文件缺少父目录")?)
}
#[cfg(windows)]
fn publish(temp: &Path, destination: &Path, replace: bool) -> Result<(), String> {
  use std::os::windows::ffi::OsStrExt;
  #[link(name = "Kernel32")]
  extern "system" {fn MoveFileExW(existing: *const u16, destination: *const u16, flags: u32) -> i32;}
  let old: Vec<u16> = temp.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
  let new: Vec<u16> = destination.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
  let flags = 0x8 | if replace {0x1} else {0}; // WRITE_THROUGH, optionally REPLACE_EXISTING.
  if unsafe {MoveFileExW(old.as_ptr(), new.as_ptr(), flags)} == 0 {
    return Err(format!("原子保存历史记录失败: {}", std::io::Error::last_os_error()));
  }
  Ok(())
}
fn atomic_write(path: &Path, text: &str, replace: bool) -> Result<(), String> {
  atomic_write_with_publish(path, text, replace, publish)
}
fn atomic_write_with_publish<P>(path: &Path, text: &str, replace: bool, publish: P) -> Result<(), String>
where P: FnOnce(&Path, &Path, bool) -> Result<(), String> {
  let parent = path.parent().ok_or("历史文件缺少父目录")?;
  ensure_directory(parent)?;
  let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
  let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
  let temp = parent.join(format!(".pending-{}-{nonce}-{counter}", std::process::id()));
  let result = (|| {
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temp)
      .map_err(|e| format!("创建历史临时文件失败: {e}"))?;
    file.write_all(text.as_bytes()).map_err(|e| format!("写入历史记录失败: {e}"))?;
    file.sync_all().map_err(|e| format!("历史记录持久化失败: {e}"))?;
    drop(file);
    publish(&temp, path, replace)
  })();
  if temp.exists() {let _ = fs::remove_file(&temp);}
  result
}
fn check_directory(path: &Path) -> Result<(), String> {
  let meta = fs::symlink_metadata(path).map_err(|e| format!("历史目录无效: {e}"))?;
  if !meta.is_dir() || meta.file_type().is_symlink() {return Err("应用历史目录无效或是符号链接".into());}
  Ok(())
}
fn list_paths(root: &Path) -> Result<Vec<(String, PathBuf)>, String> {
  let directory = root.join("snapshots");
  if !root.exists() {return Ok(Vec::new());}
  check_directory(root)?;
  if !directory.exists() {return Ok(Vec::new());}
  check_directory(&directory)?;
  let mut items = Vec::new();
  for item in fs::read_dir(directory).map_err(|e| format!("历史目录读取失败: {e}"))? {
    let path = item.map_err(|e| e.to_string())?.path();
    if path.extension().and_then(|s| s.to_str()) != Some("json") {continue;}
    if let Some(id) = path.file_stem().and_then(|s| s.to_str()) {
      if id_path(root, id).is_ok() {items.push((id.to_string(), path));}
    }
    if items.len() > MAX_HISTORY_ITEMS {return Err("历史记录超过 4096 项，请先备份并整理应用数据目录".into());}
  }
  Ok(items)
}
fn entry(id: String, record: &Value) -> HistoryEntry {
  let input = &record["inputs"];
  let options = &input["options"];
  let has_result = record["schema"] == "elisa-analysis/2" && record["result"].is_object();
  HistoryEntry {
    id, saved_at: record["saved_at"].as_str().unwrap_or("").to_string(),
    label: input["source"].as_str().unwrap_or("分析记录").to_string(),
    input_view: input["inputView"].as_str().unwrap_or("table").to_string(),
    workflow: options["workflow"].as_str().unwrap_or("comparative").to_string(),
    has_result, group_count: if has_result {record.pointer("/result/report/summary_rows").and_then(Value::as_array).map_or(0, Vec::len)} else {0},
    reference_group: options["reference_group"].as_str().map(str::to_string),
    reference_value: options["reference_assigned_value"].as_f64().unwrap_or(1.0), error: None,
  }
}

pub fn save_snapshot(root: &Path, id: &str, text: &str) -> Result<(), String> {
  let _guard = HISTORY_LOCK.lock().map_err(|_| "历史存储锁不可用")?;
  validate(text)?;
  let destination = id_path(root, id)?;
  ensure_directory(root)?;
  if destination.exists() {
    if read_bounded(&destination)? == text {return Ok(());}
    return Err("历史记录标识已存在，不能覆盖另一份分析".into());
  }
  if list_paths(root)?.len() >= MAX_HISTORY_ITEMS {return Err("历史记录已达 4096 项上限，请先备份并整理".into());}
  atomic_write(&destination, text, false)
}
pub fn read_snapshot(root: &Path, id: &str) -> Result<String, String> {
  let _guard = HISTORY_LOCK.lock().map_err(|_| "历史存储锁不可用")?;
  let path = id_path(root, id)?;
  check_directory(root)?;
  check_directory(&root.join("snapshots"))?;
  let text = read_bounded(&path)?;
  validate(&text)?;
  Ok(text)
}
pub fn list_snapshots(root: &Path) -> Result<Vec<HistoryEntry>, String> {
  let _guard = HISTORY_LOCK.lock().map_err(|_| "历史存储锁不可用")?;
  let mut entries = Vec::new();
  for (id, path) in list_paths(root)? {
    let parsed = read_bounded(&path).and_then(|text| validate(&text));
    entries.push(match parsed {
      Ok(record) => entry(id, &record),
      Err(error) => HistoryEntry {id, saved_at: String::new(), label: "损坏的历史记录".into(), input_view: "plate".into(), workflow: "comparative".into(), has_result: false, group_count: 0, reference_group: None, reference_value: 1.0, error: Some(error)},
    });
  }
  entries.sort_by(|a, b| b.saved_at.cmp(&a.saved_at).then_with(|| b.id.cmp(&a.id)));
  Ok(entries)
}
pub fn save_session(root: &Path, text: &str) -> Result<(), String> {
  let _guard = HISTORY_LOCK.lock().map_err(|_| "历史存储锁不可用")?;
  validate(text)?;
  ensure_directory(root)?;
  atomic_write(&root.join("last-session.json"), text, true)
}
pub fn read_session(root: &Path) -> Result<Option<String>, String> {
  let _guard = HISTORY_LOCK.lock().map_err(|_| "历史存储锁不可用")?;
  if !root.exists() {return Ok(None);}
  check_directory(root)?;
  let path = root.join("last-session.json");
  match fs::symlink_metadata(&path) {
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(error) => return Err(format!("无法读取上次会话: {error}")),
    Ok(_) => {},
  }
  let text = read_bounded(&path)?;
  validate(&text)?;
  Ok(Some(text))
}

#[cfg(test)]
mod tests {
  use super::*;
  fn root() -> PathBuf {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    std::env::temp_dir().join(format!("elisa-history-test-{}-{nonce}-{}", std::process::id(), TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)))
  }
  fn snapshot(label: &str) -> String {serde_json::json!({"schema":"elisa-analysis/2","saved_at":"2026-10-03T00:00:00.000Z","inputs":{"rawText":label,"source":label,"inputView":"plate","options":{"reference_assigned_value":10}},"result":null}).to_string()}
  #[test]
  fn restart_roundtrip_and_immutable_history() {
    let directory = root(); let text = snapshot("raw unrounded 0.12345678912345678");
    save_snapshot(&directory, "analysis-first", &text).unwrap();
    save_snapshot(&directory, "analysis-first", &text).unwrap(); // Idempotent retry.
    assert_eq!(read_snapshot(&directory, "analysis-first").unwrap(), text);
    assert!(save_snapshot(&directory, "analysis-first", &snapshot("different")).is_err());
    assert_eq!(list_snapshots(&directory).unwrap().len(), 1);
    save_session(&directory, &text).unwrap();
    save_session(&directory, &snapshot("new session")).unwrap();
    assert_eq!(read_session(&directory).unwrap(), Some(snapshot("new session")));
    fs::remove_dir_all(directory).unwrap();
  }
  #[test]
  fn failed_session_write_keeps_prior_and_retry_works() {
    let directory = root(); let old = snapshot("old");
    save_session(&directory, &old).unwrap();
    assert!(save_session(&directory, "not JSON").is_err());
    assert_eq!(read_session(&directory).unwrap(), Some(old));
    save_session(&directory, &snapshot("retry")).unwrap();
    fs::remove_dir_all(directory).unwrap();
  }
  #[test]
  fn interrupted_publication_keeps_old_session_and_removes_temporary_file() {
    let directory = root(); let old = snapshot("old durable session");
    save_session(&directory, &old).unwrap();
    let result = atomic_write_with_publish(&directory.join("last-session.json"), &snapshot("must not publish"), true,
      |_temp, _destination, _replace| Err("simulated publication failure".into()));
    assert!(result.is_err());
    assert_eq!(read_session(&directory).unwrap(), Some(old));
    assert!(fs::read_dir(&directory).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().starts_with(".pending-")));
    save_session(&directory, &snapshot("retry")).unwrap();
    assert_eq!(read_session(&directory).unwrap(), Some(snapshot("retry")));
    fs::remove_dir_all(directory).unwrap();
  }
  #[test]
  fn hostile_ids_and_damaged_records_are_visible() {
    let directory = root();
    for id in ["../outside", "", "a/b", "a\\b", ".hidden", "a.json", "中文"] {assert!(save_snapshot(&directory, id, &snapshot("safe")).is_err());}
    save_snapshot(&directory, "valid", &snapshot("safe")).unwrap();
    fs::write(directory.join("snapshots/damaged.json"), "not JSON").unwrap();
    fs::write(directory.join("snapshots/.pending-ignored"), "partial write").unwrap();
    let entries = list_snapshots(&directory).unwrap();
    assert_eq!(entries.len(), 2); assert!(entries.iter().any(|entry| entry.error.is_some()));
    assert!(read_snapshot(&directory, "damaged").is_err());
    fs::write(directory.join("last-session.json"), "damaged").unwrap();
    assert!(read_session(&directory).is_err());
    fs::remove_dir_all(directory).unwrap();
  }
  #[test]
  fn concurrent_writers_leave_complete_snapshots() {
    let directory = root();
    let workers: Vec<_> = (0..12).map(|index| {
      let root = directory.clone();
      std::thread::spawn(move || save_snapshot(&root, &format!("analysis-{index}"), &snapshot(&format!("run {index}"))).unwrap())
    }).collect();
    for worker in workers {worker.join().unwrap();}
    assert_eq!(list_snapshots(&directory).unwrap().len(), 12);
    for index in 0..12 {assert_eq!(read_snapshot(&directory, &format!("analysis-{index}")).unwrap(), snapshot(&format!("run {index}")));}
    fs::remove_dir_all(directory).unwrap();
  }
  #[cfg(unix)]
  #[test]
  fn symlinked_history_directory_cannot_escape_application_data() {
    let directory = root(); let outside = root();
    fs::create_dir_all(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, &directory).unwrap();
    assert!(save_session(&directory, &snapshot("private")).is_err());
    assert!(save_snapshot(&directory, "valid", &snapshot("private")).is_err());
    assert!(list_snapshots(&directory).is_err());
    assert!(read_session(&directory).is_err());
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    fs::remove_file(directory).unwrap(); fs::remove_dir_all(outside).unwrap();
  }
  #[test]
  fn storage_failure_is_an_error_not_a_cache_fallback() {
    let directory = root(); fs::write(&directory, "blocking file").unwrap();
    assert!(save_session(&directory, &snapshot("never persisted")).is_err());
    fs::remove_file(&directory).unwrap();
    save_session(&directory, &snapshot("retry")).unwrap();
    assert!(read_session(&directory).unwrap().is_some());
    fs::remove_dir_all(directory).unwrap();
  }
}
