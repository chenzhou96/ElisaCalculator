$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$tauriCache = Join-Path $projectRoot 'src-tauri\target\.tauri'
$nsisCache = Join-Path $tauriCache 'NSIS'
$wixCache = Join-Path $tauriCache 'WixTools314'

$localNsis = 'C:\Program Files (x86)\NSIS'
$localWix = Join-Path $projectRoot 'tools\wix314'

New-Item -ItemType Directory -Path $tauriCache -Force | Out-Null

if (Test-Path $localNsis) {
  New-Item -ItemType Directory -Path $nsisCache -Force | Out-Null
  Copy-Item -Path (Join-Path $localNsis '*') -Destination $nsisCache -Recurse -Force
  Write-Host "Prepared NSIS cache at $nsisCache"
} else {
  Write-Warning "NSIS not found at $localNsis"
}

if (Test-Path $localWix) {
  New-Item -ItemType Directory -Path $wixCache -Force | Out-Null
  Copy-Item -Path (Join-Path $localWix '*') -Destination $wixCache -Recurse -Force
  Write-Host "Prepared WiX cache at $wixCache"
} else {
  Write-Warning "WiX not found at $localWix"
}

$nsisExe = Join-Path $nsisCache 'makensis.exe'
$wixCandle = Join-Path $wixCache 'candle.exe'
$wixLight = Join-Path $wixCache 'light.exe'

if (Test-Path $nsisExe) {
  Write-Host "NSIS ready: $nsisExe"
} else {
  Write-Warning 'NSIS cache is incomplete.'
}

if ((Test-Path $wixCandle) -and (Test-Path $wixLight)) {
  Write-Host "WiX ready: $wixCandle and $wixLight"
} else {
  Write-Warning 'WiX cache is incomplete.'
}
