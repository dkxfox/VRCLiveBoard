param([string]$mode = 'window', [int]$x = 0, [int]$y = 0, [int]$w = 0, [int]$h = 0, [string]$out = '', [string]$title = '', [double]$fw = 0, [double]$fh = 0, [int]$scale = 2, [int]$maxdim = 0, [switch]$foreground, [switch]$restoreAfter)
# VRCLiveBoard screenshot helper - one-shot CLI (2026-09-11: all logic moved to capture_core.ps1,
# which the resident host capture_host.ps1 shares; params and stdout protocol are unchanged)
# modes:
#   window - capture the target window's OWN content via PrintWindow (works when covered/minimized); title via UIA or FindWindow
#   region - CopyFromScreen x/y/w/h (screen region chosen visually in the console)
#   screen - full primary monitor
# output is upscaled 2x by default (OCR); use -scale 1 -maxdim N for a downscaled preview
. (Join-Path $PSScriptRoot 'capture_core.ps1')
$opt = @{
  mode = $mode; x = $x; y = $y; w = $w; h = $h; out = $out; title = $title; fw = $fw; fh = $fh
  scale = $scale; maxdim = $maxdim; foreground = [bool]$foreground; restoreAfter = [bool]$restoreAfter
}
Write-Output (Invoke-Capture $opt)
