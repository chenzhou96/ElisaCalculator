param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$ReportDirectory
)
$ErrorActionPreference = 'Stop'
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$ReportDirectory = [IO.Path]::GetFullPath($ReportDirectory)
New-Item -ItemType Directory -Path $ReportDirectory -Force | Out-Null
$root = Join-Path ([IO.Path]::GetTempPath()) ("ELISA $([char]0x7528)$([char]0x6237) " + [guid]::NewGuid().ToString('N').Substring(0,8))
$installDir = Join-Path $root 'Installed App'
$unrelatedDir = Join-Path $root ("Outside $([char]0x6D4B)$([char]0x8BD5)")
$utf8 = [Text.UTF8Encoding]::new($false)
New-Item -ItemType Directory -Path $root, $unrelatedDir -Force | Out-Null

# NSIS requires the unquoted /D= argument last, including when the path has spaces.
$install = Start-Process -FilePath $Installer -ArgumentList "/S /D=$installDir" -PassThru
if (!$install.WaitForExit(300000)) { $install.Kill(); throw 'NSIS exceeded five minutes.' }
if ($install.ExitCode -ne 0) { throw "NSIS exit code: $($install.ExitCode)" }
$appExe = Join-Path $installDir 'app.exe'
$bridgeRoot = Join-Path $installDir 'resources\bridge'
$sourceRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'src-tauri\resources\bridge'
foreach ($file in @($appExe, (Join-Path $bridgeRoot 'elisa_bridge.exe'),
                   (Join-Path $bridgeRoot '_internal\python312.dll'),
                   (Join-Path $bridgeRoot '_internal\msvcp140.dll'))) {
  if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing installed file: $file" }
}
$bridgeFiles = @(Get-ChildItem -LiteralPath $sourceRoot -File -Recurse)
foreach ($file in $bridgeFiles) {
  $relative = $file.FullName.Substring($sourceRoot.Length + 1)
  $installedFile = Join-Path $bridgeRoot $relative
  if (!(Test-Path -LiteralPath $installedFile -PathType Leaf)) { throw "Missing installed payload file: $relative" }
  if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $installedFile).Hash) {
    throw "Installer changed the bridge payload: $relative"
  }
}

function Invoke-InstalledBridge($Name, $Payload) {
  $request = Join-Path $unrelatedDir "$Name input.json"
  $response = Join-Path $unrelatedDir "$Name output.json"
  [IO.File]::WriteAllText($request, ($Payload | ConvertTo-Json -Compress -Depth 8), $utf8)
  $processArgs = "--bridge-smoke `"$request`" `"$response`""
  $process = Start-Process -FilePath $appExe -ArgumentList $processArgs -WorkingDirectory $unrelatedDir -PassThru
  if (!$process.WaitForExit(180000)) { $process.Kill(); throw "Installed $Name timed out." }
  if (!(Test-Path -LiteralPath $response -PathType Leaf)) { throw "Installed $Name returned no response (exit $($process.ExitCode))." }
  $reply = Get-Content -Raw -Encoding utf8 -LiteralPath $response | ConvertFrom-Json
  if ($process.ExitCode -ne 0 -or !$reply.ok) { throw "Installed $Name failed (exit $($process.ExitCode)): $($reply.error)" }
  return $reply
}

$savedEnvironment = @{}
foreach ($name in @('PATH', 'PYTHONHOME', 'PYTHONPATH', 'ELISA_PROJECT_ROOT', 'LOCALAPPDATA', 'MPLCONFIGDIR')) {
  $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$app = $null
try {
  $env:PATH = Join-Path $env:SystemRoot 'System32'
  $env:PYTHONHOME = Join-Path $root 'absent python home'
  $env:PYTHONPATH = Join-Path $root 'absent python path'
  $env:ELISA_PROJECT_ROOT = Join-Path $root 'absent source checkout'
  $env:LOCALAPPDATA = Join-Path $root 'Local App Data'
  $env:MPLCONFIGDIR = Join-Path $root 'plot cache'
  New-Item -ItemType Directory -Path $env:LOCALAPPDATA, $env:MPLCONFIGDIR -Force | Out-Null
  if (Get-Command python, py -CommandType Application -ErrorAction SilentlyContinue) {
    throw 'Python or its launcher is still on PATH.'
  }

  # A synthetic two-group dataset with exact shared A/D and known log EC50 values.
  $groupA = "Group $([char]0x7532)"
  $groupB = "Group $([char]0x4E59)"
  $invariant = [cultureinfo]::InvariantCulture
  $lines = @("logX,$groupA,$groupB")
  foreach ($i in -5..5) {
    [double]$x = $i / 2.0
    $y1 = 0.06 + 1.18 / (1 + [Math]::Pow(10, 1.3 * ($x - (-0.45))))
    $y2 = 0.06 + 1.18 / (1 + [Math]::Pow(10, 0.85 * ($x - 0.37)))
    $lines += ([string]::Format($invariant, '{0:R},{1:R},{2:R}', $x, $y1, $y2))
  }
  $raw = $lines -join "`n"
  $parsed = Invoke-InstalledBridge 'parse' @{
    command = 'parse'; raw_text = $raw; source_label = "ELISA $([char]0x67D3)$([char]0x8272)"
  }
  if ($parsed.row_count -ne 11 -or $parsed.column_count -ne 3 -or !$parsed.preview_text.Contains($groupA)) {
    throw 'Installed parse did not preserve 11 rows and Unicode column labels.'
  }
  $fitted = Invoke-InstalledBridge 'fit' @{
    command = 'run'; raw_text = $raw; x_col_name = 'logX'; y_cols_names = @($groupA, $groupB);
    source_label = "ELISA $([char]0x67D3)$([char]0x8272)"; save_outputs = $true
  }
  $rows = @($fitted.report.summary_rows)
  if (!$fitted.report.fit_success -or $rows.Count -ne 2) { throw 'Expected a successful two-group global fit.' }
  $expected = [ordered]@{}
  $expected[$groupA] = -0.45
  $expected[$groupB] = 0.37
  foreach ($label in $expected.Keys) {
    $row = @($rows | Where-Object { $_.Group -eq $label })
    if ($row.Count -ne 1 -or $row[0].Status -ne 'Success' -or $null -eq $row[0].EC50 -or
        [Math]::Abs([double]$row[0].EC50 - $expected[$label]) -gt 0.001) {
      throw "Installed 4PL did not recover log EC50 for $label."
    }
  }
  $exports = @($fitted.saved_files)
  if ($fitted.export_error -or $exports.Count -lt 3 -or !($exports | Where-Object { $_ -like '*.csv' }) -or
      !($exports | Where-Object { $_ -like '*.png' })) { throw 'Expected CSV and PNG exports.' }
  foreach ($file in $exports) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -eq 0) {
      throw "Missing/empty exported file: $file"
    }
  }

  # Separate native window check; above already exercises the release Rust resolver and pipe protocol.
  $app = Start-Process -FilePath $appExe -WorkingDirectory $unrelatedDir -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    Start-Sleep -Milliseconds 250
    $app.Refresh()
    if ($app.HasExited) { throw "Native app exited before opening a window: $($app.ExitCode)" }
  } while ($app.MainWindowHandle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)
  if ($app.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Native app did not create a window.' }
  Start-Sleep -Seconds 5
  $app.Refresh()
  if ($app.HasExited -or !$app.Responding -or $app.MainWindowTitle -ne 'ELISA Calculator') {
    throw 'Native window did not stay responsive with expected title.'
  }
  $os = Get-CimInstance Win32_OperatingSystem
  $report = [ordered]@{
    installer_sha256 = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant()
    install_directory = $installDir; unrelated_working_directory = $unrelatedDir
    installation_ok = $true; frozen_payload_hash_match = $true; payload_file_count = $bridgeFiles.Count
    python_unavailable_on_path = $true; poisoned_python_environment = $true
    installed_rust_bridge_parse_fit_export = $true; measured_log_ec50 = @($rows | ForEach-Object { $_.EC50 })
    export_count = $exports.Count; native_window_responsive = $true
    os_caption = $os.Caption; os_version = $os.Version; os_build = $os.BuildNumber
  }
  $json = $report | ConvertTo-Json -Depth 10
  [IO.File]::WriteAllText((Join-Path $ReportDirectory 'windows-installer-smoke.json'), $json, $utf8)
  Write-Output $json
} finally {
  if ($app -and !$app.HasExited) {
    if ($app.CloseMainWindow()) { [void]$app.WaitForExit(5000) }
    if (!$app.HasExited) { $app.Kill(); [void]$app.WaitForExit(5000) }
  }
  foreach ($name in $savedEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
  }
}
