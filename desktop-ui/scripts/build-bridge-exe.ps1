$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $projectRoot '..')).Path
$bridgeEntry = Join-Path $PSScriptRoot 'bridge_entry.py'
$outDir = Join-Path $projectRoot 'src-tauri\resources'
$bundleDir = Join-Path $outDir 'bridge'
$buildDir = Join-Path $projectRoot 'src-tauri\target\pyinstaller'
$distDir = Join-Path $buildDir 'dist'
$requirementsFile = Join-Path $PSScriptRoot 'requirements-windows-build.txt'

# Prefer an explicitly selected environment; otherwise resolve a real Python.
# No developer-machine drive or Conda directory is assumed.
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
$arguments = @('-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--console', '--contents-directory', '_internal',
  '--name', 'bridge', '--paths', $repoRoot,
  '--distpath', $distDir, '--workpath', $buildDir, '--specpath', $buildDir,
  '--hidden-import', 'elisa_calculator.bridge', '--collect-submodules', 'elisa_calculator',
  '--hidden-import', 'numpy', '--hidden-import', 'pandas', '--hidden-import', 'scipy',
  '--hidden-import', 'matplotlib', '--hidden-import', 'xml.parsers.expat')

foreach ($module in @('tkinter', '_tkinter', 'IPython', 'jupyter', 'notebook',
  'PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'wx', 'bokeh', 'plotly', 'altair',
  'sklearn', 'skimage', 'xarray', 'dask', 'sqlalchemy', 'numba', 'h5py', 'tables')) {
  $arguments += @('--exclude-module', $module)
}
$arguments += $bridgeEntry
& $pythonExe @arguments
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller bridge build failed.' }
$frozen = Join-Path $distDir 'bridge'
if (!(Test-Path -LiteralPath $frozen -PathType Container)) { throw 'Frozen bridge directory is missing.' }
if (Test-Path -LiteralPath $bundleDir) { Remove-Item -LiteralPath $bundleDir -Recurse -Force }
Move-Item -LiteralPath $frozen -Destination $bundleDir
# The folder name matches the install resource path, but keep the stable executable name.
$generatedExe = Join-Path $bundleDir 'bridge.exe'
$bridgeExe = Join-Path $bundleDir 'elisa_bridge.exe'
if (!(Test-Path -LiteralPath $generatedExe -PathType Leaf)) { throw "Bridge executable missing: $generatedExe" }
Move-Item -LiteralPath $generatedExe -Destination $bridgeExe
$internal = Join-Path $bundleDir '_internal'
if (!(Test-Path -LiteralPath (Join-Path $internal 'python312.dll') -PathType Leaf)) {
  throw 'Frozen application-local Python runtime is missing.'
}

# App-local Microsoft C++ libraries cover machines without the redistributable installed.
# This must be Visual Studio's official redistributable directory, not System32.
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (!(Test-Path -LiteralPath $vswhere -PathType Leaf)) { throw 'Visual Studio Installer vswhere.exe was not found.' }
$vs = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if ($LASTEXITCODE -ne 0 -or !$vs) { throw 'Visual Studio 2022 C++ Build Tools not found.' }
$redistDir = Join-Path $vs 'VC\Redist\MSVC'
$crtDir = @(Get-ChildItem -LiteralPath $redistDir -Directory |
  Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
  Sort-Object { [version]$_.Name } -Descending |
  ForEach-Object { Join-Path $_.FullName 'x64\Microsoft.VC143.CRT' } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Container } |
  Select-Object -First 1)
if (!$crtDir.Count) { throw 'Visual Studio x64 application-local runtime not found.' }
foreach ($name in @('vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll')) {
  if (!(Test-Path -LiteralPath (Join-Path $crtDir[0] $name) -PathType Leaf)) { throw "Visual C++ runtime missing: $name" }
}
# Keep CPython's collected copies where present. The rest come from the toolchain.
Get-ChildItem -LiteralPath $crtDir[0] -Filter '*.dll' -File | ForEach-Object {
  $target = Join-Path $internal $_.Name
  if (!(Test-Path -LiteralPath $target -PathType Leaf)) { Copy-Item -LiteralPath $_.FullName -Destination $target }
}
Write-Host "Bridge executable and application-local runtime ready in: $bundleDir"
