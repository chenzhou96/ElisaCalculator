$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$bridgeEntry = Join-Path $PSScriptRoot 'bridge_entry.py'
$outDir = Join-Path $projectRoot 'src-tauri\resources\bridge'
$buildDir = Join-Path $projectRoot 'src-tauri\target\pyinstaller'

if (!(Test-Path $bridgeEntry)) {
  throw "Bridge entry not found: $bridgeEntry"
}

New-Item -ItemType Directory -Path $outDir -Force | Out-Null
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

$pyinstaller = Get-Command pyinstaller -ErrorAction SilentlyContinue
if (-not $pyinstaller) {
  Write-Host 'PyInstaller not found. Installing...'
  python -m pip install pyinstaller
}

$bridgeExe = Join-Path $outDir 'elisa_bridge.exe'
if (Test-Path $bridgeExe) {
  Remove-Item $bridgeExe -Force
}

python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --name elisa_bridge `
  --paths $projectRoot `
  --distpath $outDir `
  --workpath $buildDir `
  --specpath $buildDir `
  --hidden-import elisa_calculator.bridge `
  --collect-submodules elisa_calculator `
  --hidden-import numpy `
  --hidden-import pandas `
  --hidden-import scipy `
  --hidden-import matplotlib `
  $bridgeEntry

if (!(Test-Path $bridgeExe)) {
  throw "Build failed. Missing $bridgeExe"
}

Write-Host "Bridge executable ready: $bridgeExe"
