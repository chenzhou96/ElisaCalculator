param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$ReportDirectory,
  [string]$InstallDirectory = (Join-Path ([IO.Path]::GetTempPath()) ('ELISA smoke ' + [char]0x7528 + [char]0x6237)),
  [ValidateRange(10, 180)][int]$LaunchTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$ReportDirectory = [IO.Path]::GetFullPath($ReportDirectory)
New-Item -ItemType Directory -Path $ReportDirectory -Force | Out-Null
if (Test-Path -LiteralPath $InstallDirectory) { throw "Use a fresh smoke-test destination: $InstallDirectory" }

# NSIS requires /D= to be the final argument and it must not be quoted, even with spaces.
$install = Start-Process -FilePath $Installer -ArgumentList "/S /D=$InstallDirectory" -PassThru
if (!$install.WaitForExit(300000)) { $install.Kill(); throw 'NSIS installer exceeded five minutes.' }
if ($install.ExitCode -ne 0) { throw "NSIS installer exited with code $($install.ExitCode)." }
$appExe = Join-Path $InstallDirectory 'app.exe'
$bridgeExe = Join-Path $InstallDirectory 'resources\bridge\elisa_bridge.exe'
foreach ($file in @($appExe, $bridgeExe)) {
  if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Installed resource is missing: $file" }
}
$buildBridge = Join-Path (Split-Path -Parent $PSScriptRoot) 'src-tauri\resources\bridge\elisa_bridge.exe'
if ((Get-FileHash -LiteralPath $buildBridge).Hash -ne (Get-FileHash -LiteralPath $bridgeExe).Hash) {
  throw 'Installed bridge differs from the bridge used to build this installer.'
}

& (Join-Path $PSScriptRoot 'bridge-health-check.ps1') -SkipBuild -IsolatePython -BridgeExe $bridgeExe `
  -ReportPath (Join-Path $ReportDirectory 'installed-bridge-health.json')

$savedEnvironment = @{}
foreach ($name in @('PATH', 'PYTHONHOME', 'PYTHONPATH', 'ELISA_PROJECT_ROOT')) {
  $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$app = $null
$nativeSnapshots = [Collections.Generic.List[object]]::new()
$nativeDiagnosticsPath = Join-Path $ReportDirectory 'native-launch-diagnostics.json'
$nativeStdoutPath = Join-Path $ReportDirectory 'native-app-stdout.log'
$nativeStderrPath = Join-Path $ReportDirectory 'native-app-stderr.log'
function Save-NativeLaunchSnapshot {
  param([Diagnostics.Process]$Process, [string]$Stage)
  $snapshot = [ordered]@{
    stage = $Stage; recorded_at_utc = [DateTime]::UtcNow.ToString('o'); process_id = $Process.Id
    has_exited = $null; exit_code = $null; responding = $null
    main_window_handle = $null; main_window_title = $null; read_error = $null
  }
  try {
    $Process.Refresh()
    $snapshot.has_exited = $Process.HasExited
    if ($snapshot.has_exited) {
      $snapshot.exit_code = $Process.ExitCode
    } else {
      # Read each value once and retain it before any assertion or cleanup can change the process.
      $snapshot.main_window_handle = $Process.MainWindowHandle.ToInt64()
      $snapshot.main_window_title = $Process.MainWindowTitle
      $snapshot.responding = $Process.Responding
    }
  } catch {
    $snapshot.read_error = $_.Exception.Message
  }
  $result = [pscustomobject]$snapshot
  $nativeSnapshots.Add($result)
  $diagnostics = [ordered]@{
    stdout_log = $nativeStdoutPath; stderr_log = $nativeStderrPath
    snapshots = @($nativeSnapshots.ToArray())
  } | ConvertTo-Json -Depth 10
  [IO.File]::WriteAllText($nativeDiagnosticsPath, $diagnostics, (New-Object System.Text.UTF8Encoding($false)))
  return $result
}
try {
  $env:PATH = Join-Path $env:SystemRoot 'System32'
  Remove-Item Env:PYTHONHOME, Env:PYTHONPATH, Env:ELISA_PROJECT_ROOT -ErrorAction SilentlyContinue
  if (Get-Command python, py -CommandType Application -ErrorAction SilentlyContinue) {
    throw 'Native launch isolation failed: python/py is still available on PATH.'
  }
  # Launch the installed app from an unrelated directory, never from the source tree.
  $app = Start-Process -FilePath $appExe -WorkingDirectory $InstallDirectory -PassThru `
    -RedirectStandardOutput $nativeStdoutPath -RedirectStandardError $nativeStderrPath
  $deadline = [DateTime]::UtcNow.AddSeconds($LaunchTimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 250
    $app.Refresh()
    if ($app.HasExited) {
      $nativeState = Save-NativeLaunchSnapshot -Process $app -Stage 'exited-before-window'
      throw "Native app exited before creating a window: $($nativeState | ConvertTo-Json -Compress)"
    }
  } while ($app.MainWindowHandle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)
  $stabilityDeadline = [DateTime]::UtcNow.AddSeconds(5)
  $nativeState = Save-NativeLaunchSnapshot -Process $app -Stage 'window-discovery'
  if ($nativeState.has_exited -ne $false -or !$nativeState.main_window_handle) {
    throw "Native app did not create a top-level window: $($nativeState | ConvertTo-Json -Compress)"
  }
  # Diagnostic reads must not add another grace period to the original five-second check.
  $remainingMilliseconds = ($stabilityDeadline - [DateTime]::UtcNow).TotalMilliseconds
  if ($remainingMilliseconds -gt 0) { Start-Sleep -Milliseconds ([int][Math]::Ceiling($remainingMilliseconds)) }
  $nativeState = Save-NativeLaunchSnapshot -Process $app -Stage 'after-five-seconds'
  if ($nativeState.has_exited -ne $false -or $nativeState.responding -ne $true -or $nativeState.main_window_title -ne 'ELISA Calculator') {
    throw "Installed native window did not remain responsive with the expected title: $($nativeState | ConvertTo-Json -Compress)"
  }
  $os = Get-CimInstance Win32_OperatingSystem
  $report = [ordered]@{
    installer_sha256 = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant()
    installed_app_sha256 = (Get-FileHash -LiteralPath $appExe -Algorithm SHA256).Hash.ToLowerInvariant()
    install_directory = $InstallDirectory; installation_ok = $true
    python_unavailable_on_path = $true; native_window_created = $true; native_window_responsive = $true
    native_window_title = $nativeState.main_window_title
    native_launch_diagnostics = $nativeDiagnosticsPath
    os_caption = $os.Caption; os_version = $os.Version; os_build = $os.BuildNumber
    coverage = 'Installer resource/engine check and native-window launch smoke; interactive native UI and persistence require separate validation.'
  }
  $json = $report | ConvertTo-Json -Depth 10
  [IO.File]::WriteAllText((Join-Path $ReportDirectory 'windows-installer-smoke.json'), $json,
    (New-Object System.Text.UTF8Encoding($false)))
  Write-Output $json
} finally {
  if ($app -and !$app.HasExited) {
    if ($app.CloseMainWindow()) { [void]$app.WaitForExit(5000) }
    if (!$app.HasExited) { $app.Kill(); [void]$app.WaitForExit(5000) }
  }
  foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
