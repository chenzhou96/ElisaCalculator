// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  #[cfg(all(windows, not(debug_assertions)))]
  {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_some_and(|arg| arg == "--bridge-smoke") {
      let [_, _, input, output] = args.as_slice() else {
        std::process::exit(64);
      };
      let output = std::path::Path::new(output);
      if let Err(error) = app_lib::run_bridge_smoke(std::path::Path::new(input), output) {
        // A Windows-subsystem executable has no console in an ordinary launch.
        let _ = std::fs::write(output, serde_json::json!({"ok": false, "error": error}).to_string());
        std::process::exit(1);
      }
      return;
    }
  }
  app_lib::run();
}
