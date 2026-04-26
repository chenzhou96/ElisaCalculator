$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$bridgeEntry = Join-Path $PSScriptRoot 'bridge_entry.py'
$outDir = Join-Path $projectRoot 'src-tauri\resources\bridge'
$buildDir = Join-Path $projectRoot 'src-tauri\target\pyinstaller'
$requirementsFile = Join-Path $projectRoot '..\requirements-build.txt'

# Use the clean elisacalculator conda env if not overridden
if ($env:BRIDGE_PYTHON_HOME) {
  $pythonHome = $env:BRIDGE_PYTHON_HOME
} else {
  $pythonHome = 'D:\Program\anaconda3\envs\elisacalculator'
}
$pythonExe = Join-Path $pythonHome 'python.exe'

if (!(Test-Path $pythonExe)) {
  throw "Python not found at $pythonExe. Set BRIDGE_PYTHON_HOME env var to your conda env path."
}

if (!(Test-Path $bridgeEntry)) {
  throw "Bridge entry not found: $bridgeEntry"
}

Write-Host "Using Python: $pythonExe"

New-Item -ItemType Directory -Path $outDir -Force | Out-Null
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

if (!(Test-Path $requirementsFile)) {
  throw "Missing requirements file: $requirementsFile"
}

Write-Host "Syncing bridge build dependencies from: $requirementsFile"
& $pythonExe -m pip install -r $requirementsFile

$bridgeExe = Join-Path $outDir 'elisa_bridge.exe'
if (Test-Path $bridgeExe) {
  Remove-Item $bridgeExe -Force
}

& $pythonExe -m PyInstaller `
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
  --exclude-module tkinter `
  --exclude-module _tkinter `
  --exclude-module pyperclip `
  --exclude-module IPython `
  --exclude-module jupyter `
  --exclude-module notebook `
  --exclude-module PyQt5 `
  --exclude-module PyQt6 `
  --exclude-module PySide2 `
  --exclude-module PySide6 `
  --exclude-module wx `
  --exclude-module sphinx `
  --exclude-module bokeh `
  --exclude-module plotly `
  --exclude-module altair `
  --exclude-module sklearn `
  --exclude-module skimage `
  --exclude-module xarray `
  --exclude-module dask `
  --exclude-module sqlalchemy `
  --exclude-module numba `
  --exclude-module h5py `
  --exclude-module tables `
  --exclude-module openpyxl `
  --exclude-module lxml `
  --exclude-module rich `
  --exclude-module click `
  $bridgeEntry

if (!(Test-Path $bridgeExe)) {
  throw "Build failed. Missing $bridgeExe"
}

$sizeMb = [math]::Round((Get-Item $bridgeExe).Length / 1MB, 1)
Write-Host "Bridge executable ready: $bridgeExe ($sizeMb MB)"
