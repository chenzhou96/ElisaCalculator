$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $projectRoot '..')).Path
$bridgeEntry = Join-Path $PSScriptRoot 'bridge_entry.py'
$outDir = Join-Path $projectRoot 'src-tauri\resources\bridge'
$buildDir = Join-Path $projectRoot 'src-tauri\target\pyinstaller'
$requirementsFile = Join-Path $PSScriptRoot 'requirements-windows-build.txt'

# Prefer an explicitly selected environment; otherwise resolve a real Python.
# No developer-machine drive or conda directory is assumed.
if ($env:BRIDGE_PYTHON_HOME) {
  $pythonExe = Join-Path $env:BRIDGE_PYTHON_HOME 'python.exe'
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  $pythonExe = (& py -3 -c 'import sys; print(sys.executable)').Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Python launcher failed to resolve Python 3.' }
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $pythonExe = (& python -c 'import sys; print(sys.executable)').Trim()
  if ($LASTEXITCODE -ne 0) { throw 'python failed to resolve an interpreter.' }
} else {
  throw 'Python 3 not found. Install Python or set BRIDGE_PYTHON_HOME.'
}
if (!(Test-Path $pythonExe)) { throw "Python not found: $pythonExe" }
if (!(Test-Path $bridgeEntry)) { throw "Bridge entry not found: $bridgeEntry" }
if (!(Test-Path $requirementsFile)) { throw "Missing requirements: $requirementsFile" }

Write-Host "Using Python: $pythonExe"
# Avoid nested native-argument quotes so Windows PowerShell 5.1 works too.
$interpreterInfo = @(& $pythonExe -c 'import platform, struct, sys; print(sys.version_info.major, sys.version_info.minor, struct.calcsize(chr(80)) * 8, platform.machine())')
if ($LASTEXITCODE -ne 0 -or $interpreterInfo.Count -ne 1 -or $interpreterInfo[0] -notmatch '^3 12 64 (AMD64|x86_64)$') {
  throw 'Windows release bridge requires x64 CPython 3.12.'
}
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
& $pythonExe -m pip install --only-binary=:all: -r $requirementsFile
if ($LASTEXITCODE -ne 0) { throw 'Bridge dependency installation failed.' }
& $pythonExe -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Bridge dependency compatibility check failed.' }

# JSON bridge MUST retain stdin/stdout. --windowed sets these streams to None.
# Rust launches this console executable with CREATE_NO_WINDOW, avoiding flashes.
$arguments = @('-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--console',
  '--name', 'elisa_bridge', '--paths', $repoRoot,
  '--distpath', $outDir, '--workpath', $buildDir, '--specpath', $buildDir,
  '--hidden-import', 'elisa_calculator.bridge', '--collect-submodules', 'elisa_calculator',
  '--hidden-import', 'numpy', '--hidden-import', 'pandas', '--hidden-import', 'scipy',
  '--hidden-import', 'matplotlib', '--hidden-import', 'xml.parsers.expat')

# Conda may need explicit expat DLLs; regular python.org environments do not.
$pythonHome = Split-Path -Parent $pythonExe
foreach ($relative in @('DLLs\pyexpat.pyd', 'Library\bin\expat.dll', 'Library\bin\libexpat.dll')) {
  $binary = Join-Path $pythonHome $relative
  if (Test-Path $binary) { $arguments += @('--add-binary', "$binary;.") }
}
foreach ($module in @('tkinter', '_tkinter', 'IPython', 'jupyter', 'notebook',
  'PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'wx', 'bokeh', 'plotly', 'altair',
  'sklearn', 'skimage', 'xarray', 'dask', 'sqlalchemy', 'numba', 'h5py', 'tables')) {
  $arguments += @('--exclude-module', $module)
}
$arguments += $bridgeEntry
& $pythonExe @arguments
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller bridge build failed.' }
$bridgeExe = Join-Path $outDir 'elisa_bridge.exe'
if (!(Test-Path $bridgeExe)) { throw "Bridge executable missing: $bridgeExe" }
Write-Host "Bridge executable ready: $bridgeExe"
