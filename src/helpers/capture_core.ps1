# VRCLiveBoard screenshot core (2026-09-11, extracted from screen_capture.ps1)
# Two entry points share this file:
#   screen_capture.ps1 - one-shot CLI (unchanged params / unchanged stdout protocol)
#   capture_host.ps1   - resident helper: one JSON command per stdin line, one result line back
# stdout protocol (single line): OK | NO-WINDOW | NO-REGION | CAPTURE-FAIL: <reason>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
# The Add-Type/Roslyn compile is the bulk of the cold start, so it must happen once per process.
# Adding the same type twice throws, so probe first (the resident host dot-sources this only once).
if (-not ('VLB.CapWin32' -as [type])) {
  $sig = @"
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string name);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
"@
  [void](Add-Type -MemberDefinition $sig -Name CapWin32 -Namespace VLB -PassThru)
}
$script:CapWin32 = 'VLB.CapWin32' -as [type]

function New-Bmp([int]$bw, [int]$bh) { return New-Object System.Drawing.Bitmap $bw, $bh }

function Crop-Center($bmp, [double]$cfw, [double]$cfh) {
  $cw = $bmp.Width; $ch = $bmp.Height
  if ($cfw -gt 0 -and $cfw -lt 1) { $cw = [int][math]::Round($bmp.Width * $cfw) }
  if ($cfh -gt 0 -and $cfh -lt 1) { $ch = [int][math]::Round($bmp.Height * $cfh) }
  if ($cw -eq $bmp.Width -and $ch -eq $bmp.Height) { return $bmp }
  $cx = [int](($bmp.Width - $cw) / 2); $cy = [int](($bmp.Height - $ch) / 2)
  $rect = New-Object System.Drawing.Rectangle $cx, $cy, $cw, $ch
  $crop = $bmp.Clone($rect, $bmp.PixelFormat)
  $bmp.Dispose()
  return $crop
}

function Copy-Screen([int]$sx, [int]$sy, [int]$sw, [int]$sh) {
  $bmp = New-Bmp $sw $sh
  # try/finally (M-20260911-38): the resident host lives for the whole session, so a GDI+ failure must not leak handles
  try {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen($sx, $sy, 0, 0, (New-Object System.Drawing.Size $sw, $sh)) } finally { $g.Dispose() }
  } catch { $bmp.Dispose(); throw }
  return $bmp
}

function Resize-Bmp($bmp, [int]$nw, [int]$nh) {
  $big = New-Bmp $nw $nh
  try {
    $g = [System.Drawing.Graphics]::FromImage($big)
    try {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.DrawImage($bmp, 0, 0, $nw, $nh)
    } finally { $g.Dispose() }
  } catch { $big.Dispose(); throw }
  $bmp.Dispose()
  return $big
}

# ---- window resolution (2026-09-19: VR multi-window hardening) ----------------
# Old behaviour: UIA first-match by title, else FindWindowW. Fragile once several Unity/window
# instances exist (VR: game window + desktop mirror + our own console) and it never said WHICH
# window was captured. Now we enumerate top-level windows, score them, and never consider ours.
function Get-WindowCandidates([string]$want, [bool]$allowSelf = $false) {
  $list = New-Object System.Collections.ArrayList
  $cb = [VLB.CapWin32+EnumProc]{
    param($h, $l)
    try {
      $sb = New-Object System.Text.StringBuilder 512
      [void]$script:CapWin32::GetWindowTextW($h, $sb, 512)
      $t = $sb.ToString()
      $cb2 = New-Object System.Text.StringBuilder 256
      [void]$script:CapWin32::GetClassNameW($h, $cb2, 256)
      $c = $cb2.ToString()
      if (-not $t -and -not $c) { return $true }
      $procId = [uint32]0
      [void]$script:CapWin32::GetWindowThreadProcessId($h, [ref]$procId)
      $pn = ''
      try { $pn = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
      # Never target our own processes (the console, the helper, the shell). The gate needs one
      # exception to prove the blank-capture rejection with a window it owns itself: allowSelf is
      # opt-in per command and the app never sets it.
      if ((-not $allowSelf) -and ($pn -match '^(powershell|pwsh|node|electron|VRCLiveBoard)$')) { return $true }
      $titleHit = ($want -and $t -eq $want)
      $titleLike = ($want -and $t -like ('*' + $want + '*'))
      $unity = ($c -eq 'UnityWndClass')
      $vrProc = ($pn -match 'VRChat')
      # The Unity/process heuristic is a FALLBACK for our own default target only: if the caller
      # asked for something else (another app, or a title that does not exist), never hijack it to
      # VRChat -- the gate asserts NO-WINDOW for an unknown title.
      $wantVr = ($want -match '(?i)vrchat')
      if (-not ($titleHit -or $titleLike -or ($wantVr -and $unity -and $vrProc))) { return $true }
      $r = New-Object 'VLB.CapWin32+RECT'
      if (-not $script:CapWin32::GetWindowRect($h, [ref]$r)) { return $true }
      $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
      if ($w -le 0 -or $hh -le 0) { return $true }
      $vis = $script:CapWin32::IsWindowVisible($h)
      $min = $script:CapWin32::IsIconic($h)
      $score = 0
      if ($titleHit) { $score += 2000 } elseif ($titleLike) { $score += 500 }
      if ($unity) { $score += 400 }
      if ($vrProc) { $score += 300 }
      if ($vis) { $score += 1000 }
      if (-not $min) { $score += 500 }
      $score += [int](($w * $hh) / 20000)
      [void]$list.Add([pscustomobject]@{ H = $h; Title = $t; Cls = $c; Proc = $pn; Vis = $vis; Min = $min; W = $w; Hgt = $hh; Score = $score })
    } catch {}
    return $true
  }
  [void]$script:CapWin32::EnumWindows($cb, [IntPtr]::Zero)
  return @($list | Sort-Object -Property Score -Descending)
}
# Kept (same name/signature) because the one-shot CLI and the gate rely on it -- now returns the
# best candidate instead of the first UIA match.
function Find-WindowByTitle([string]$want) {
  if (-not $want) { return [IntPtr]::Zero }
  $c = @(Get-WindowCandidates $want)
  if ($c.Count -gt 0) { return $c[0].H }
  $hwnd = [IntPtr]::Zero
  try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $want)
    $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($win) { $hwnd = [IntPtr]$win.Current.NativeWindowHandle }
  } catch {}
  if ($hwnd -eq [IntPtr]::Zero) { $hwnd = $script:CapWin32::FindWindowW($null, $want) }
  return $hwnd
}
function Describe-Window($hwnd) {
  try {
    $sb = New-Object System.Text.StringBuilder 512
    [void]$script:CapWin32::GetWindowTextW($hwnd, $sb, 512)
    $cb = New-Object System.Text.StringBuilder 256
    [void]$script:CapWin32::GetClassNameW($hwnd, $cb, 256)
    return ('"' + $sb.ToString() + '" class=' + $cb.ToString() + ' hwnd=' + $hwnd)
  } catch { return ('hwnd=' + $hwnd) }
}
# Blank-capture detection: PrintWindow returns TRUE but a fully black/empty bitmap for some GPU
# or minimized states -- the old code accepted that and OCR'd nothing. Reject near-black or
# almost-single-colour images so the caller can escalate instead of trusting garbage.
function Test-BmpUseful($bmp, [ref]$info) {
  $step = [int][math]::Max(4, [math]::Min($bmp.Width, $bmp.Height) / 40)
  $tot = 0; $dark = 0; $sum = 0.0; $colors = @{}
  for ($x = 0; $x -lt $bmp.Width; $x += $step) {
    for ($y = 0; $y -lt $bmp.Height; $y += $step) {
      $p = $bmp.GetPixel($x, $y)
      $lum = ($p.R + $p.G + $p.B) / 3.0
      $sum += $lum; $tot++
      if ($lum -lt 12) { $dark++ }
      $key = [string]::Concat([int]($p.R / 16), '_', [int]($p.G / 16), '_', [int]($p.B / 16))
      if ($colors.Count -lt 64) { $colors[$key] = 1 }
    }
  }
  $avg = 0.0; $blackPct = 0.0
  if ($tot -gt 0) { $avg = [math]::Round($sum / $tot, 1); $blackPct = [math]::Round(100.0 * $dark / $tot, 1) }
  $info.Value = ('avg=' + $avg + ' black=' + $blackPct + 'pct colors=' + $colors.Count)
  if ($tot -eq 0) { return $false }
  if ($blackPct -ge 92) { return $false }
  if ($colors.Count -le 3) { return $false }
  return $true
}
function Get-WindowPrint($hwnd, [int]$ww, [int]$wh) {
  $bmp = New-Bmp $ww $wh
  try {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    try { $ok = $script:CapWin32::PrintWindow($hwnd, $hdc, 2) } finally { $g.ReleaseHdc($hdc); $g.Dispose() }
    return [pscustomobject]@{ Ok = [bool]$ok; Bmp = $bmp }
  } catch { try { $bmp.Dispose() } catch {}; throw }
}
# Raise from a background process: plain SetForegroundWindow is refused unless we share an input
# queue with the foreground thread, so attach first, then raise z-order (HWND_TOP) and activate.
function Raise-Window($hwnd) {
  try {
    $fg = $script:CapWin32::GetForegroundWindow()
    $t1 = [uint32]0
    if ($fg -ne [IntPtr]::Zero) { [void]$script:CapWin32::GetWindowThreadProcessId($fg, [ref]$t1) }
    $t2 = $script:CapWin32::GetCurrentThreadId()
    $attached = $false
    if ($t1 -ne 0 -and $t1 -ne $t2) { $attached = $script:CapWin32::AttachThreadInput($t1, $t2, $true) }
    try {
      $flags = 0x0040 -bor 0x0001 -bor 0x0002   # SWP_SHOWWINDOW | NOSIZE | NOMOVE
      [void]$script:CapWin32::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, 0, 0, $flags)
      [void]$script:CapWin32::SetForegroundWindow($hwnd)
    } finally {
      if ($attached) { [void]$script:CapWin32::AttachThreadInput($t1, $t2, $false) }
    }
    return $true
  } catch { return $false }
}
# Diagnostics: the protocol line must stay exactly OK / NO-* / CAPTURE-FAIL, so the detail (which
# window, which strategy, was the image usable) goes to logs/capture-diag.log instead.
function Write-CapDiag([string]$line) {
  try {
    $dir = Join-Path $PSScriptRoot '..\..\logs'
    if (-not (Test-Path $dir)) { [void](New-Item -ItemType Directory -Force -Path $dir) }
    $f = Join-Path $dir 'capture-diag.log'
    [System.IO.File]::AppendAllText($f, ((Get-Date).ToString('s') + ' ' + $line + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
  } catch {}
}

# One capture. $opt carries the same fields as the old CLI params:
#   mode window|region|screen|fg, x, y, w, h, out, title, fw, fh, scale, maxdim, foreground, restoreAfter
# Returns the protocol string; never writes to the success stream (the resident host depends on that).
function Invoke-Capture($opt) {
  $mode = [string]$opt.mode
  if (-not $mode) { $mode = 'window' }
  $x = [int]$opt.x; $y = [int]$opt.y; $w = [int]$opt.w; $h = [int]$opt.h
  $out = [string]$opt.out
  $title = [string]$opt.title
  $fw = [double]$opt.fw; $fh = [double]$opt.fh
  $scale = 2
  if ($null -ne $opt.scale) { $scale = [int]$opt.scale }
  $maxdim = [int]$opt.maxdim
  $foreground = [bool]$opt.foreground
  $restoreAfter = [bool]$opt.restoreAfter

  $bmp = $null
  try {
    if ($mode -eq 'beep') {
      # Beep from the resident host too (M-20260911-38): each beep used to spawn a fresh powershell (~0.5s cold start).
      # NOTE: frequency/duration come in through the JSON command object -- an earlier revision read two undefined
      # variables here, so the host answered OK while staying silent (M-20260911-41). Fail loudly so the caller can fall back.
      try { [console]::beep([int]$opt.freq, [int]$opt.ms); return 'OK' } catch { return ('CAPTURE-FAIL: beep ' + $_.Exception.Message) }
    }
    if ($mode -eq 'probeimg') {
      # Test/diagnostic hook (2026-09-19): judge an existing PNG with the same blank-detection the
      # capture ladder uses -- lets the gate prove the detector rejects black/blank images, and lets
      # a real-world bad capture be analysed after the fact (mode=probeimg, path=<png>).
      $p = [string]$opt.path
      if (-not $p -or -not (Test-Path $p)) { return 'PROBE-FAIL: no such image' }
      $img = [System.Drawing.Image]::FromFile($p)
      try {
        $b2 = New-Object System.Drawing.Bitmap $img
        try {
          $inf2 = ''
          $u = Test-BmpUseful $b2 ([ref]$inf2)
          if ($u) { return ('USEFUL ' + $inf2) }
          return ('BLANK ' + $inf2)
        } finally { $b2.Dispose() }
      } finally { $img.Dispose() }
    }
    if ($mode -eq 'fg') {
      $cands = @(Get-WindowCandidates $title ([bool]$opt.allowSelf))
      if ($cands.Count -eq 0) { return 'NO-WINDOW' }
      $hwnd = $cands[0].H
      if ($script:CapWin32::IsIconic($hwnd)) { [void]$script:CapWin32::ShowWindow($hwnd, 9) }
      [void]$script:CapWin32::ShowWindow($hwnd, 5)
      [void](Raise-Window $hwnd)
      Start-Sleep -Milliseconds 300
      Write-CapDiag ('mode=fg picked ' + (Describe-Window $hwnd) + ' proc=' + $cands[0].Proc + ' candidates=' + $cands.Count)
      return 'OK'
    }
    if ($mode -eq 'window') {
      $cands = @(Get-WindowCandidates $title ([bool]$opt.allowSelf))
      if ($cands.Count -eq 0) { return 'NO-WINDOW' }
      $hwnd = $cands[0].H
      $r = New-Object 'VLB.CapWin32+RECT'
      if (-not $script:CapWin32::GetWindowRect($hwnd, [ref]$r)) { return 'NO-WINDOW' }
      $ww = $r.Right - $r.Left; $wh = $r.Bottom - $r.Top
      if ($ww -le 0 -or $wh -le 0) { return 'NO-WINDOW' }
      $wasMin = $script:CapWin32::IsIconic($hwnd)
      $prevFg = $script:CapWin32::GetForegroundWindow()
      $raised = $false
      $strategy = 'printwindow'
      $info = ''
      # Ladder (2026-09-19). Step 1 is the important one: PrintWindow renders the window's OWN
      # content regardless of z-order or focus, so the common case needs no window change at all.
      # (Measured on the real VRChat window: it was NOT foreground and still 0pct near-black.)
      $shot = Get-WindowPrint $hwnd $ww $wh
      $bmp = $shot.Bmp
      $use = Test-BmpUseful $bmp ([ref]$info)
      if ((-not $shot.Ok) -or (-not $use)) {
        if ((-not $foreground) -and (-not $wasMin)) {
          # Caller explicitly forbade touching the window: report honestly instead of grabbing
          # whatever happens to be on screen at those coordinates.
          try { $bmp.Dispose() } catch {}
          Write-CapDiag ('mode=window EMPTY-CAPTURE(no-touch) ' + $info + ' ' + (Describe-Window $hwnd))
          return ('EMPTY-CAPTURE: printwindow failed or blank, and raising is disabled (' + $info + ')')
        }
        Write-CapDiag ('mode=window retry reason=' + $(if ($shot.Ok) { 'blank' } else { 'printwindow-false' }) + ' ' + $info + ' ' + (Describe-Window $hwnd))
        if ($wasMin) { [void]$script:CapWin32::ShowWindow($hwnd, 9) }
        [void]$script:CapWin32::ShowWindow($hwnd, 5)
        [void](Raise-Window $hwnd)
        $raised = $true
        Start-Sleep -Milliseconds 700
        try { $bmp.Dispose() } catch {}
        $strategy = 'printwindow-raised'
        $shot = Get-WindowPrint $hwnd $ww $wh
        $bmp = $shot.Bmp
        $use = Test-BmpUseful $bmp ([ref]$info)
        if ((-not $shot.Ok) -or (-not $use)) {
          # Last resort: copy the screen area where the window is (only meaningful when the window
          # is really visible now). Verified again -- a covered window yields the wrong content.
          try { $bmp.Dispose() } catch {}
          $strategy = 'screencopy'
          $bmp = Copy-Screen $r.Left $r.Top $ww $wh
          $use = Test-BmpUseful $bmp ([ref]$info)
        }
      }
      try {
        if (-not $use) {
          Write-CapDiag ('mode=window EMPTY-CAPTURE strategy=' + $strategy + ' ' + $info + ' ' + (Describe-Window $hwnd) + ' min=' + $wasMin)
          return ('EMPTY-CAPTURE: ' + $strategy + ' ' + $info)
        }
        $bmp = Crop-Center $bmp $fw $fh
        Write-CapDiag ('mode=window OK strategy=' + $strategy + ' ' + $info + ' size=' + $ww + 'x' + $wh + ' ' + (Describe-Window $hwnd) + ' proc=' + $cands[0].Proc + ' cands=' + $cands.Count + ' min=' + $wasMin + ' raised=' + $raised)
      } finally {
        if ($wasMin -and $restoreAfter) { [void]$script:CapWin32::ShowWindow($hwnd, 6) }
        elseif ($raised -and $restoreAfter -and $prevFg -ne [IntPtr]::Zero -and $prevFg -ne $hwnd) {
          [void]$script:CapWin32::SetForegroundWindow($prevFg)
        }
      }
    }
    elseif ($mode -eq 'region') {
      if ($w -le 0 -or $h -le 0) { return 'NO-REGION' }
      $bmp = Copy-Screen $x $y $w $h
    }
    else {
      Add-Type -AssemblyName System.Windows.Forms
      $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $bmp = Copy-Screen $b.X $b.Y $b.Width $b.Height
    }

    # Cap-then-upscale (M-20260911-38): maxdim and scale used to be mutually exclusive, so bounding a 4K
    # full-screen capture meant giving up the 2x OCR upscale. Now both apply, plus a hard cap on the result.
    if ($maxdim -gt 0) {
      $mx = [math]::Max($bmp.Width, $bmp.Height)
      if ($mx -gt $maxdim) {
        $k = $maxdim / [double]$mx
        $nw = [int][math]::Round($bmp.Width * $k); $nh = [int][math]::Round($bmp.Height * $k)
        if ($nw -lt 1) { $nw = 1 }; if ($nh -lt 1) { $nh = 1 }
        $bmp = Resize-Bmp $bmp $nw $nh
      }
    }
    if ($scale -ge 2) {
      $nw = $bmp.Width * $scale; $nh = $bmp.Height * $scale
      $hardCap = 4096
      $mx2 = [math]::Max($nw, $nh)
      if ($mx2 -gt $hardCap) { $k2 = $hardCap / [double]$mx2; $nw = [int][math]::Round($nw * $k2); $nh = [int][math]::Round($nh * $k2) }
      if ($nw -ge 1 -and $nh -ge 1) { $bmp = Resize-Bmp $bmp $nw $nh }
    }

    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return 'OK'
  } catch {
    if ($bmp) { try { $bmp.Dispose() } catch {} }
    return ('CAPTURE-FAIL: ' + $_.Exception.Message)
  }
}
