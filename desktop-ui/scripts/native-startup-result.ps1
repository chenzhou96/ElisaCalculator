# Parse complete records only: the Ready callback can still be writing its result.
# A visible/responding window does not establish completion of native startup sizing.
function ConvertFrom-NativeStartupLog {
  param([AllowEmptyString()][string]$Text)
  $prefix = '[window startup result] '
  $lines = $Text -split "`n"
  # The final fragment is not a completed record until its newline has been captured.
  $completed = @($lines | Select-Object -SkipLast 1 | ForEach-Object { $_.TrimEnd("`r") })
  $records = @($completed | Where-Object { $_.StartsWith($prefix, [StringComparison]::Ordinal) })
  if ($records.Count -gt 1) { throw 'Native startup reported more than one Ready-time sizing result.' }
  if (!$records.Count) { return $null }
  $result = $records[0].Substring($prefix.Length) | ConvertFrom-Json -NoEnumerate -ErrorAction Stop
  if ($result -isnot [pscustomobject] -or $result.fit_ok -isnot [bool]) {
    throw 'Native startup sizing result must contain a Boolean fit_ok.'
  }
  return $result
}
