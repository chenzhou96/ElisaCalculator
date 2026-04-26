use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use std::{
  env,
  ffi::OsString,
  io::{ErrorKind, Read, Write},
  path::{Path, PathBuf},
  process::{Command, Stdio},
};

fn project_root() -> Result<PathBuf, String> {
  if let Ok(value) = env::var("ELISA_PROJECT_ROOT") {
    let candidate = PathBuf::from(value);
    if candidate.join("elisa_calculator").exists() {
      return Ok(candidate);
    }
  }

  if let Ok(exe_path) = env::current_exe() {
    if let Some(exe_dir) = exe_path.parent() {
      let candidates = [
        exe_dir.to_path_buf(),
        exe_dir.join("resources"),
        exe_dir.join("../Resources"),
      ];

      for candidate in candidates {
        if candidate.join("elisa_calculator").exists() {
          return Ok(candidate);
        }
      }
    }
  }

  Path::new(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .and_then(Path::parent)
    .map(Path::to_path_buf)
    .ok_or_else(|| "无法定位项目根目录".to_string())
}

fn parse_bridge_output(output: std::process::Output, command_name: &str) -> Result<Value, String> {
  let stdout = String::from_utf8(output.stdout)
    .map_err(|err| format!("{command_name} 输出不是有效 UTF-8: {err}"))?;
  log::info!("[Rust bridge] stdout 长度: {} bytes", stdout.len());
  if stdout.trim().is_empty() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    log::error!("[Rust bridge] {} 没有返回数据: {}", command_name, stderr);
    return Err(format!("{command_name} 没有返回数据: {stderr}"));
  }

  serde_json::from_str::<Value>(&stdout)
    .map_err(|err| {
      log::error!("[Rust bridge] JSON 解析失败: {}\nstdout 前 500 字符: {}", err, &stdout[..stdout.len().min(500)]);
      format!("{command_name} 返回了无效 JSON: {err}\n{stdout}")
    })
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
    .env("PYTHONIOENCODING", "utf-8")
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

fn unique_paths(items: Vec<PathBuf>) -> Vec<PathBuf> {
  let mut seen = std::collections::HashSet::<OsString>::new();
  let mut result = Vec::new();
  for path in items {
    let key = path.as_os_str().to_os_string();
    if seen.insert(key) {
      result.push(path);
    }
  }
  result
}

fn bundled_bridge_candidates(root: &Path) -> Vec<PathBuf> {
  let exe_name = if cfg!(windows) {
    "elisa_bridge.exe"
  } else {
    "elisa_bridge"
  };

  let mut candidates = vec![
    root.join("bridge").join(exe_name),
    root.join(exe_name),
  ];

  if let Ok(exe_path) = env::current_exe() {
    if let Some(exe_dir) = exe_path.parent() {
      candidates.push(exe_dir.join("resources").join("bridge").join(exe_name));
      candidates.push(exe_dir.join("resources").join(exe_name));
      candidates.push(exe_dir.join("../Resources").join("bridge").join(exe_name));
      candidates.push(exe_dir.join("../Resources").join(exe_name));
      candidates.push(exe_dir.join("bridge").join(exe_name));
      candidates.push(exe_dir.join(exe_name));
    }
  }

  unique_paths(candidates)
}

fn run_bridge_executable(executable: &Path, request_json: &str, root: &Path) -> Result<Value, String> {
  let mut child = Command::new(executable)
    .current_dir(root)
    .env("PYTHONIOENCODING", "utf-8")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|err| format!("无法启动内置桥接可执行文件 {}: {}", executable.display(), err))?;

  if let Some(stdin) = child.stdin.as_mut() {
    stdin
      .write_all(request_json.as_bytes())
      .map_err(|err| format!("写入内置桥接请求失败: {err}"))?;
  }

  let output = child
    .wait_with_output()
    .map_err(|err| format!("等待内置桥接返回失败: {err}"))?;

  parse_bridge_output(output, &format!("内置桥接 {}", executable.display()))
}

fn run_python_bridge(request: Value) -> Result<Value, String> {
  let request_json =
    serde_json::to_string(&request).map_err(|err| format!("序列化请求失败: {err}"))?;
  let root = project_root()?;
  log::info!("[Rust bridge] project_root: {:?}", root);
  log::info!("[Rust bridge] request_json 长度: {} bytes", request_json.len());
  let mut errors = Vec::new();

  let try_system_python = |errors: &mut Vec<String>| -> Option<Value> {
    for (executable, args) in [("python", Vec::<&str>::new()), ("py", vec!["-3"])] {
      match run_bridge_once(executable, &args, &request_json, &root) {
        Ok(value) => {
          log::info!("[Rust bridge] {} 成功返回", executable);
          return Some(value);
        },
        Err(err) => {
          log::warn!("[Rust bridge] {} 失败: {}", executable, err);
          errors.push(err);
        },
      }
    }
    None
  };

  let try_bundled_bridge = |errors: &mut Vec<String>| -> Option<Value> {
    for bridge_exe in bundled_bridge_candidates(&root) {
      if !bridge_exe.exists() {
        continue;
      }
      match run_bridge_executable(&bridge_exe, &request_json, &root) {
        Ok(value) => {
          log::info!("[Rust bridge] 内置桥接成功: {}", bridge_exe.display());
          return Some(value);
        },
        Err(err) => {
          log::warn!("[Rust bridge] 内置桥接失败: {}", err);
          errors.push(err);
        },
      }
    }
    None
  };

  if cfg!(debug_assertions) {
    if let Some(value) = try_system_python(&mut errors) {
      return Ok(value);
    }
    if let Some(value) = try_bundled_bridge(&mut errors) {
      return Ok(value);
    }
  } else {
    if let Some(value) = try_bundled_bridge(&mut errors) {
      return Ok(value);
    }
    if let Some(value) = try_system_python(&mut errors) {
      return Ok(value);
    }
  }

  Err(format!("无法调用 Python 桥接层: {}", errors.join(" | ")))
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
  let mut file = std::fs::File::open(&path)
    .map_err(|err| format!("无法打开文件 {path}: {err}"))?;
  let mut buf = Vec::new();
  file.read_to_end(&mut buf)
    .map_err(|err| format!("读取文件失败 {path}: {err}"))?;
  let mime = mime_guess::from_path(&path)
    .first_or_octet_stream();
  Ok(format!(
    "data:{mime};base64,{}",
    STANDARD.encode(&buf)
  ))
}

#[tauri::command]
async fn run_bridge(request: Value) -> Result<Value, String> {
  log::info!("[Rust bridge] 收到前端请求: command={}", request.get("command").and_then(|c| c.as_str()).unwrap_or("?"));
  let result = tauri::async_runtime::spawn_blocking(move || run_python_bridge(request))
    .await
    .map_err(|err| err.to_string())?;
  match &result {
    Ok(value) => log::info!("[Rust bridge] 返回前端: ok={}", value.get("ok").and_then(|o| o.as_bool()).unwrap_or(false)),
    Err(e) => log::error!("[Rust bridge] 返回前端错误: {}", e),
  }
  result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![run_bridge, read_file_base64])
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
