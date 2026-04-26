$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$buildScript = Join-Path $PSScriptRoot 'build-bridge-exe.ps1'
$bridgeExe = Join-Path $projectRoot 'src-tauri\resources\bridge\elisa_bridge.exe'

Write-Host '=== Bridge Health Check ==='
Write-Host '[1/4] Rebuilding bridge executable...'
& powershell -ExecutionPolicy Bypass -File $buildScript

if (!(Test-Path $bridgeExe)) {
  throw "Bridge executable not found: $bridgeExe"
}

$bridgeExeItem = Get-Item $bridgeExe
$bridgeExeSizeMb = [math]::Round($bridgeExeItem.Length / 1MB, 2)
Write-Host "[2/4] Bridge executable ready: $bridgeExe ($bridgeExeSizeMb MB)"

$parseRequest = @{
  command = 'parse'
  raw_text = "x,y`n1,2`n2,3`n3,4"
}

$runRequest = @{
  command = 'run'
  raw_text = "logX,GroupA,GroupB`n-2,0.98,1.02`n-1,0.86,0.88`n0,0.55,0.60`n1,0.22,0.28`n2,0.10,0.12"
  save_outputs = $true
}

Write-Host '[3/4] Running parse smoke test...'
$parseRaw = ($parseRequest | ConvertTo-Json -Compress) | & $bridgeExe
$parseResponse = $parseRaw | ConvertFrom-Json
if (-not $parseResponse.ok) {
  throw "Parse smoke test failed: $($parseResponse.error)"
}

Write-Host '[4/4] Running run/export smoke test...'
$runRaw = ($runRequest | ConvertTo-Json -Compress) | & $bridgeExe
$runResponse = $runRaw | ConvertFrom-Json
if (-not $runResponse.ok) {
  throw "Run smoke test failed: $($runResponse.error)"
}

$outputDir = [string]($runResponse.output_dir)
if (![string]::IsNullOrWhiteSpace($outputDir) -and !(Test-Path $outputDir)) {
  throw "Run reported output_dir but directory does not exist: $outputDir"
}

$savedFiles = @($runResponse.saved_files)
if ($savedFiles.Count -lt 1) {
  throw 'Run smoke test did not produce saved files.'
}

$successRows = @($runResponse.report.summary_rows | Where-Object { $_.Status -eq 'Success' })
$ec50Preview = @($successRows | Select-Object -First 3 | ForEach-Object {
  "$($_.Group)=$([double]$_.EC50)"
}) -join '; '

Write-Host ''
Write-Host '=== Bridge Health Summary ==='
Write-Host "ExePath: $bridgeExe"
Write-Host "ExeSizeMB: $bridgeExeSizeMb"
Write-Host "ParseOk: $($parseResponse.ok)"
Write-Host "ParseRows: $($parseResponse.row_count)"
Write-Host "RunOk: $($runResponse.ok)"
Write-Host "RunStatus: $($runResponse.status_msg)"
Write-Host "SummaryGroups: $($runResponse.report.summary_rows.Count)"
Write-Host "SavedFiles: $($savedFiles.Count)"
Write-Host "OutputDir: $outputDir"
Write-Host "EC50Preview: $ec50Preview"

$summary = [ordered]@{
  exe_path = $bridgeExe
  exe_size_mb = $bridgeExeSizeMb
  parse_ok = [bool]$parseResponse.ok
  parse_rows = [int]$parseResponse.row_count
  run_ok = [bool]$runResponse.ok
  run_status = [string]$runResponse.status_msg
  summary_groups = [int]$runResponse.report.summary_rows.Count
  saved_files = [int]$savedFiles.Count
  output_dir = $outputDir
  ec50_preview = $ec50Preview
}

$summary | ConvertTo-Json -Depth 5
