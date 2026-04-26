use serde_json::Value;
use std::{
  io::{ErrorKind, Write},
  path::{Path, PathBuf},
  process::{Command, Stdio},
};

fn project_root() -> Result<PathBuf, String> {
  Path::new(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .and_then(Path::parent)
    .map(Path::to_path_buf)
    .ok_or_else(|| "无法定位项目根目录".to_string())
}

fn parse_bridge_output(output: std::process::Output, command_name: &str) -> Result<Value, String> {
  let stdout = String::from_utf8(output.stdout)
    .map_err(|err| format!("{command_name} 输出不是有效 UTF-8: {err}"))?;
  if stdout.trim().is_empty() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    return Err(format!("{command_name} 没有返回数据: {stderr}"));
  }

  serde_json::from_str::<Value>(&stdout)
    .map_err(|err| format!("{command_name} 返回了无效 JSON: {err}\n{stdout}"))
}

fn run_bridge_once(
  executable: &str,
  extra_args: &[&str],
  request_json: &str,
  root: &Path,
) -> Result<Value, String> {
  let mut child = Command::new(executable)
    .args(extra_args)
    .arg("-m")
    .arg("elisa_calculator.bridge")
    .current_dir(root)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|err| match err.kind() {
      ErrorKind::NotFound => format!("{executable} 未找到"),
      _ => format!("无法启动 {executable}: {err}"),
    })?;

  if let Some(stdin) = child.stdin.as_mut() {
    stdin
      .write_all(request_json.as_bytes())
      .map_err(|err| format!("写入 Python 请求失败: {err}"))?;
  }

  let output = child
    .wait_with_output()
    .map_err(|err| format!("等待 Python 桥接层返回失败: {err}"))?;

  parse_bridge_output(output, executable)
}

fn run_python_bridge(request: Value) -> Result<Value, String> {
  let request_json =
    serde_json::to_string(&request).map_err(|err| format!("序列化请求失败: {err}"))?;
  let root = project_root()?;
  let mut errors = Vec::new();

  for (executable, args) in [("python", Vec::<&str>::new()), ("py", vec!["-3"])] {
    match run_bridge_once(executable, &args, &request_json, &root) {
      Ok(value) => return Ok(value),
      Err(err) => errors.push(err),
    }
  }

  Err(format!("无法调用 Python 桥接层: {}", errors.join(" | ")))
}

#[tauri::command]
async fn run_bridge(request: Value) -> Result<Value, String> {
  tauri::async_runtime::spawn_blocking(move || run_python_bridge(request))
    .await
    .map_err(|err| err.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![run_bridge])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
