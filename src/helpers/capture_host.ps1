# VRCLiveBoard resident screenshot host (2026-09-11)
# Started once by src/capturehost.js instead of paying a PowerShell cold start (~0.5s) per capture.
# Protocol: first line "READY"; then one JSON command per stdin line -> one result line
#   OK | NO-WINDOW | NO-REGION | CAPTURE-FAIL: <reason>
# Command fields are the screen_capture.ps1 params: mode, x, y, w, h, out, title, fw, fh, scale,
#   maxdim, foreground, restoreAfter. Closing stdin (or the line "quit") exits.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'capture_core.ps1')
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
# Read stdin as UTF-8 explicitly: [Console]::In would decode it with the OEM codepage, so any
# non-ASCII window title would arrive as mojibake and FindWindowW could never match it.
# (Verified 2026-09-11 with a Chinese window title: broken before, 1128x608 capture after.)
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding($false)))
# Results go straight to stdout: PowerShell pipeline buffering would stall the caller.
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = $stdin.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq '') { continue }
  if ($line -eq 'quit') { break }
  $res = 'CAPTURE-FAIL: bad command'
  try {
    $opt = $line | ConvertFrom-Json
    # Keep the last non-empty string the core returned: a stray pipeline value must not desync the protocol.
    foreach ($o in @(Invoke-Capture $opt)) { if ($o -is [string] -and $o.Length -gt 0) { $res = $o } }
  } catch {
    $res = 'CAPTURE-FAIL: ' + $_.Exception.Message
  }
  [Console]::Out.WriteLine($res)
  [Console]::Out.Flush()
}
