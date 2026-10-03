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
function Read-NativeWorkAreaBounds {
  param([IntPtr]$WindowHandle)
  if (!('ElisaNativeBounds' -as [type])) {
    # GetWindowRect is DPI-virtualized. Scope the measuring thread to per-monitor awareness
    # and restore it in finally; this never changes the app, monitor scaling, or OS settings.
    # Read APIs support Windows 2000; thread DPI context/GetDpiForWindow require Windows 10 1607.
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class ElisaNativeBounds {
  [StructLayout(LayoutKind.Sequential)]
  public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  private struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)]
  private struct MonitorInfo { public uint Size; public Rect Monitor, Work; public uint Flags; }
  public sealed class Bounds {
    public bool Visible;
    public uint Dpi;
    public Rect Outer, Client, ClientScreen, WorkArea;
  }
  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")]
  private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
  [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW", ExactSpelling = true, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")]
  private static extern uint GetDpiForWindow(IntPtr window);
  public static Bounds Read(IntPtr window) {
    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE (-3) makes all queried coordinates physical.
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-3));
    if (previous == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "SetThreadDpiAwarenessContext");
    try {
      Rect outer, client;
      if (!GetWindowRect(window, out outer)) throw new Win32Exception(Marshal.GetLastWin32Error(), "GetWindowRect");
      if (!GetClientRect(window, out client)) throw new Win32Exception(Marshal.GetLastWin32Error(), "GetClientRect");
      Point origin = new Point();
      if (!ClientToScreen(window, ref origin)) throw new Win32Exception(Marshal.GetLastWin32Error(), "ClientToScreen");
      IntPtr monitor = MonitorFromWindow(window, 2); // MONITOR_DEFAULTTONEAREST
      if (monitor == IntPtr.Zero) throw new InvalidOperationException("MonitorFromWindow returned NULL");
      MonitorInfo info = new MonitorInfo();
      info.Size = (uint)Marshal.SizeOf(typeof(MonitorInfo));
      if (!GetMonitorInfo(monitor, ref info)) throw new Win32Exception(Marshal.GetLastWin32Error(), "GetMonitorInfoW");
      uint dpi = GetDpiForWindow(window);
      if (dpi == 0) throw new InvalidOperationException("GetDpiForWindow returned zero");
      return new Bounds {
        Visible = IsWindowVisible(window), Dpi = dpi, Outer = outer, Client = client, WorkArea = info.Work,
        ClientScreen = new Rect { Left = origin.X, Top = origin.Y,
          Right = origin.X + client.Right - client.Left, Bottom = origin.Y + client.Bottom - client.Top }
      };
    } finally {
      if (SetThreadDpiAwarenessContext(previous) == IntPtr.Zero)
        throw new Win32Exception(Marshal.GetLastWin32Error(), "Restore thread DPI awareness context");
    }
  }
}
'@
  }
  return [ElisaNativeBounds]::Read($WindowHandle)
}
function Convert-NativeRect {
  param($Rectangle)
  return [ordered]@{
    left = $Rectangle.Left; top = $Rectangle.Top; right = $Rectangle.Right; bottom = $Rectangle.Bottom
    width = $Rectangle.Right - $Rectangle.Left; height = $Rectangle.Bottom - $Rectangle.Top
  }
}
function Test-RectInsideWorkArea {
  param($Rectangle, $WorkArea)
  return $Rectangle.Right -gt $Rectangle.Left -and $Rectangle.Bottom -gt $Rectangle.Top `
    -and $Rectangle.Left -ge $WorkArea.Left -and $Rectangle.Top -ge $WorkArea.Top `
    -and $Rectangle.Right -le $WorkArea.Right -and $Rectangle.Bottom -le $WorkArea.Bottom
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
  $fitPrefix = '[window startup result] '
  $fitLines = @(Get-Content -LiteralPath $nativeStderrPath | Where-Object { $_.StartsWith($fitPrefix) })
  if ($fitLines.Count -ne 1) { throw 'Installed app did not report exactly one completed Ready-time native sizing result.' }
  $fitState = $fitLines[0].Substring($fitPrefix.Length) | ConvertFrom-Json
  $bounds = Read-NativeWorkAreaBounds -WindowHandle ([IntPtr]$nativeState.main_window_handle)
  $boundsReport = [ordered]@{
    coordinate_space = 'physical pixels; temporary measuring-thread DPI context restored'
    visible = $bounds.Visible; dpi = $bounds.Dpi; scale_factor = $bounds.Dpi / 96.0; fit_ok = $fitState.fit_ok
    outer = Convert-NativeRect $bounds.Outer; client = Convert-NativeRect $bounds.Client
    client_screen = Convert-NativeRect $bounds.ClientScreen; work_area = Convert-NativeRect $bounds.WorkArea
  }
  $boundsJson = $boundsReport | ConvertTo-Json -Depth 10
  $boundsPath = Join-Path $ReportDirectory 'native-window-bounds.json'
  [IO.File]::WriteAllText($boundsPath, $boundsJson, (New-Object System.Text.UTF8Encoding($false)))
  if ($fitState.fit_ok -ne $true) { throw "Native startup fit failed, even if the fallback window is responsive: $boundsJson" }
  if (!$bounds.Visible -or !(Test-RectInsideWorkArea $bounds.Outer $bounds.WorkArea) `
      -or !(Test-RectInsideWorkArea $bounds.ClientScreen $bounds.WorkArea)) {
    throw "Installed native window/client bounds overflow the monitor work area or are hidden: $boundsJson"
  }
  $os = Get-CimInstance Win32_OperatingSystem
  $report = [ordered]@{
    installer_sha256 = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant()
    installed_app_sha256 = (Get-FileHash -LiteralPath $appExe -Algorithm SHA256).Hash.ToLowerInvariant()
    install_directory = $InstallDirectory; installation_ok = $true
    python_unavailable_on_path = $true; native_window_created = $true; native_window_responsive = $true
    native_window_title = $nativeState.main_window_title
    native_launch_diagnostics = $nativeDiagnosticsPath
    native_window_bounds = $boundsPath; native_window_fits_work_area = $true
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
