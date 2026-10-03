param(
  [string]$BridgeExe,
  [switch]$SkipBuild,
  [switch]$IsolatePython,
  [string]$ReportPath,
  [ValidateRange(10, 600)][int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (!$BridgeExe) { $BridgeExe = Join-Path $projectRoot 'src-tauri\resources\bridge\elisa_bridge.exe' }
if (!$SkipBuild) {
  & (Join-Path $PSScriptRoot 'build-bridge-exe.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Bridge build failed.' }
}
if (!(Test-Path -LiteralPath $BridgeExe -PathType Leaf)) { throw "Bridge executable not found: $BridgeExe" }
$BridgeExe = (Resolve-Path -LiteralPath $BridgeExe).Path

# Write raw UTF-8 JSON directly, independent of PowerShell's console/code-page settings.
# Read both redirected streams concurrently so PNG/base64 previews cannot deadlock.
function Invoke-FrozenBridge($Request, [string]$Arguments = '') {
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $BridgeExe
  $start.Arguments = $Arguments
  $start.WorkingDirectory = Split-Path -Parent $BridgeExe
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $start.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $start
  try {
    if (!$process.Start()) { throw 'Frozen bridge process did not start.' }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes(($Request | ConvertTo-Json -Depth 30 -Compress))
    $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $process.StandardInput.BaseStream.Close()
    if (!$process.WaitForExit($TimeoutSeconds * 1000)) {
      $process.Kill()
      throw "Frozen bridge exceeded $TimeoutSeconds seconds."
    }
    $output = $stdout.GetAwaiter().GetResult()
    $errors = $stderr.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw "Frozen bridge exited $($process.ExitCode): $errors" }
    if ([string]::IsNullOrWhiteSpace($output)) { throw "Frozen bridge returned no JSON: $errors" }
    return ($output | ConvertFrom-Json)
  } finally { $process.Dispose() }
}

function Assert-Near($Value, [double]$Expected, [string]$Label) {
  if ($null -eq $Value -or [double]::IsNaN([double]$Value) -or [double]::IsInfinity([double]$Value) -or
      [math]::Abs([double]$Value - $Expected) -gt 0.00001) {
    throw "$Label did not match known truth $Expected (actual: $Value)."
  }
}

$savedEnvironment = @{}
foreach ($name in @('PATH', 'PYTHONHOME', 'PYTHONPATH', 'PYTHONUTF8', 'PYTHONIOENCODING', 'ELISA_PROJECT_ROOT')) {
  $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  $env:PYTHONUTF8 = '1'
  $env:PYTHONIOENCODING = 'utf-8'
  if ($IsolatePython) {
    # Process-local only; don't uninstall Python or change the machine's settings.
    $env:PATH = Join-Path $env:SystemRoot 'System32'
    Remove-Item Env:PYTHONHOME, Env:PYTHONPATH, Env:ELISA_PROJECT_ROOT -ErrorAction SilentlyContinue
    if (Get-Command python, py -CommandType Application -ErrorAction SilentlyContinue) {
      throw 'Python isolation failed: python/py is still available on PATH.'
    }
  }
  $buildInfo = Invoke-FrozenBridge @{} '--build-info'
  if (!$buildInfo.frozen -or $buildInfo.architecture_bits -ne 64 -or $buildInfo.python -notlike '3.12.*') {
    throw 'Bridge runtime is not frozen x64 CPython 3.12.'
  }
  foreach ($package in @{ numpy = '2.3.5'; pandas = '2.2.3'; scipy = '1.17.0'; matplotlib = '3.10.8' }.GetEnumerator()) {
    if ($buildInfo.($package.Key) -ne $package.Value) { throw "Unexpected frozen $($package.Key) version." }
  }
  $unicodeLabel = 'smoke-' + [char]0x6D4B + [char]0x8BD5
  $parse = Invoke-FrozenBridge @{
    command = 'parse'; raw_text = "x,$unicodeLabel`n1,2`n2,3`n3,4"
  }
  if (!$parse.ok -or $parse.row_count -ne 3 -or $parse.columns[1] -ne $unicodeLabel) {
    throw 'Frozen parse/UTF-8 smoke test failed.'
  }

  # Independent analytic truth: y = 0.1 + 2/(1+c^1.8); EC50 = 1 ng/mL.
  $culture = [Globalization.CultureInfo]::InvariantCulture
  $rows = @('concentration,standard')
  for ($i = 0; $i -le 12; $i++) {
    $c = [math]::Pow(10, -1 + $i / 6.0)
    $od = 0.1 + 2 / (1 + [math]::Pow($c, 1.8))
    $rows += $c.ToString('G17', $culture) + ',' + $od.ToString('G17', $culture)
  }
  $request = @{
    command = 'run'; raw_text = $rows -join "`n"; save_outputs = $true
    source_label = $unicodeLabel
    analysis_options = @{
      workflow = 'standard_curve'; input_mode = 'raw_concentration'
      standard_group = 'standard'; concentration_unit = 'ng/mL'
      unknown_samples = @(@{
        sample_id = $unicodeLabel; od = 0.1 + 2 / (1 + [math]::Pow(1.3, 1.8)); dilution_factor = 7
      })
    }
  }
  $run = Invoke-FrozenBridge $request
  if (!$run.ok -or !$run.report.fit_success) { throw "Frozen SciPy fit failed: $($run.error)" }
  $summaryRows = @($run.report.summary_rows | Where-Object { $_.Status -eq 'Success' })
  if ($summaryRows.Count -ne 1) { throw 'Frozen fit did not return exactly one successful standard.' }
  Assert-Near $summaryRows[0].EC50 1 'EC50'
  $unknown = @($run.report.unknown_results)
  if ($unknown.Count -ne 1 -or $unknown[0].Status -ne 'Success' -or $unknown[0].Sample -ne $unicodeLabel) {
    throw 'Frozen unknown quantitation/UTF-8 smoke test failed.'
  }
  Assert-Near $unknown[0].Concentration 1.3 'Unknown concentration'
  Assert-Near $unknown[0].Corrected_concentration 9.1 'Dilution-corrected concentration'
  if (@($run.previews).Count -lt 2 -or @($run.preview_warnings).Count -gt 0) {
    throw 'Frozen Matplotlib preview smoke test failed.'
  }
  foreach ($preview in $run.previews) {
    if (!$preview.data_url.StartsWith('data:image/png;base64,')) { throw 'Preview is not a PNG data URL.' }
    $png = [Convert]::FromBase64String($preview.data_url.Substring(22))
    if ($png.Length -lt 8 -or [BitConverter]::ToString($png[0..7]) -ne '89-50-4E-47-0D-0A-1A-0A') {
      throw 'Preview does not contain valid PNG bytes.'
    }
  }
  if ($run.export_error -or @($run.export_warnings).Count -gt 0) {
    throw "Frozen export failed: $($run.export_error); $($run.export_warnings -join '; ')"
  }
  $savedFiles = @($run.saved_files)
  foreach ($path in $savedFiles) {
    if (!(Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -eq 0) {
      throw "Export file is missing or empty: $path"
    }
  }
  foreach ($required in @('EC50_Summary.csv', 'Unknown_Samples.csv', 'Input_Audit.csv', 'Analysis_Record.json')) {
    if (!($savedFiles | Where-Object { (Split-Path -Leaf $_) -eq $required })) { throw "Missing export: $required" }
  }
  if (@($savedFiles | Where-Object { [IO.Path]::GetExtension($_) -eq '.png' }).Count -lt 2) {
    throw 'Frozen export did not write both PNG plots.'
  }
  $recordPath = $savedFiles | Where-Object { (Split-Path -Leaf $_) -eq 'Analysis_Record.json' } | Select-Object -First 1
  $record = Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($record.record_schema -ne 'elisa-report-v2' -or $record.report.metadata.raw_input -ne $request.raw_text) {
    throw 'Frozen audit export is incomplete.'
  }
  $invalid = Invoke-FrozenBridge @{ command = 'unsupported-smoke-command' }
  if ($invalid.ok -or !$invalid.error) { throw 'Frozen bridge did not reject an unsupported command.' }
  $summary = [ordered]@{
    bridge_path = $BridgeExe; bridge_sha256 = (Get-FileHash -LiteralPath $BridgeExe -Algorithm SHA256).Hash.ToLowerInvariant()
    engine_build_info = $buildInfo
    python_unavailable_on_path = [bool]$IsolatePython; parse_utf8_ok = $true; fit_ok = $true
    ec50 = [double]$summaryRows[0].EC50; concentration = [double]$unknown[0].Concentration
    corrected_concentration = [double]$unknown[0].Corrected_concentration
    previews = @($run.previews).Count; exports = $savedFiles.Count; audit_ok = $true; invalid_command_rejected = $true
  }
  $json = $summary | ConvertTo-Json -Depth 10
  if ($ReportPath) {
    New-Item -ItemType Directory -Path (Split-Path -Parent ([IO.Path]::GetFullPath($ReportPath))) -Force | Out-Null
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($ReportPath), $json, (New-Object System.Text.UTF8Encoding($false)))
  }
  Write-Output $json
} finally {
  foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
