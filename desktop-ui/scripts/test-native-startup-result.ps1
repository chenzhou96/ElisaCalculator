$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'native-startup-result.ps1')
function Assert-Throws {
  param([scriptblock]$Action)
  $threw = $false
  try { & $Action | Out-Null } catch { $threw = $true }
  if (!$threw) { throw "Expected invalid startup evidence to be rejected: $Action" }
}
foreach ($text in @('', "[window startup] querying monitor`n", '[window startup result] {"fit_ok":true}',
    "[window startup] ready`n[window startup result] {`"fit_ok`":")) {
  if ($null -ne (ConvertFrom-NativeStartupLog -Text $text)) { throw 'Partial output cannot establish completion.' }
}
$lf = "[window startup result] {`"fit_ok`":true}`n"
$crlf = "[window startup] ready`r`n[window startup result] {`"fit_ok`":true}`r`n"
foreach ($text in @($lf, $crlf)) {
  if ((ConvertFrom-NativeStartupLog -Text $text).fit_ok -ne $true) { throw 'Complete success record was lost.' }
}
if ((ConvertFrom-NativeStartupLog -Text "[window startup result] {`"fit_ok`":false}`n").fit_ok -ne $false) {
  throw 'Failed native fitting must remain a failure.'
}
Assert-Throws { ConvertFrom-NativeStartupLog -Text ($lf + $lf) }
Assert-Throws { ConvertFrom-NativeStartupLog -Text "[window startup result] {`"fit_ok`":`"true`"}`n" }
Assert-Throws { ConvertFrom-NativeStartupLog -Text "[window startup result] {}`n" }
Assert-Throws { ConvertFrom-NativeStartupLog -Text "[window startup result] [{`"fit_ok`":true}]`n" }
Assert-Throws { ConvertFrom-NativeStartupLog -Text "[window startup result] broken`n" }
Write-Output 'Native startup log parser: partial, delayed, CRLF, failure, duplicate and malformed records passed.'
