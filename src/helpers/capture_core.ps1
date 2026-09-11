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
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string name);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
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
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($sx, $sy, 0, 0, (New-Object System.Drawing.Size $sw, $sh))
  $g.Dispose()
  return $bmp
}

function Resize-Bmp($bmp, [int]$nw, [int]$nh) {
  $big = New-Bmp $nw $nh
  $g = [System.Drawing.Graphics]::FromImage($big)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($bmp, 0, 0, $nw, $nh)
  $g.Dispose()
  $bmp.Dispose()
  return $big
}

# Resolve a top-level window handle by title: UIA first (matches VRChat's real window), FindWindowW as fallback.
function Find-WindowByTitle([string]$want) {
  $hwnd = [IntPtr]::Zero
  if (-not $want) { return $hwnd }
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
    if ($mode -eq 'fg') {
      $hwnd = Find-WindowByTitle $title
      if ($hwnd -eq [IntPtr]::Zero) { return 'NO-WINDOW' }
      if ($script:CapWin32::IsIconic($hwnd)) { [void]$script:CapWin32::ShowWindow($hwnd, 9) }
      [void]$script:CapWin32::ShowWindow($hwnd, 5)
      [void]$script:CapWin32::SetForegroundWindow($hwnd)
      Start-Sleep -Milliseconds 300
      return 'OK'
    }
    if ($mode -eq 'window') {
      $hwnd = Find-WindowByTitle $title
      if ($hwnd -eq [IntPtr]::Zero) { return 'NO-WINDOW' }
      $r = New-Object 'VLB.CapWin32+RECT'
      if (-not $script:CapWin32::GetWindowRect($hwnd, [ref]$r)) { return 'NO-WINDOW' }
      $ww = $r.Right - $r.Left; $wh = $r.Bottom - $r.Top
      if ($ww -le 0 -or $wh -le 0) { return 'NO-WINDOW' }
      $wasMin = $script:CapWin32::IsIconic($hwnd)
      $prevFg = $script:CapWin32::GetForegroundWindow()
      if ($foreground -or $wasMin) {
        if ($wasMin) { [void]$script:CapWin32::ShowWindow($hwnd, 9) }
        [void]$script:CapWin32::ShowWindow($hwnd, 5)
        [void]$script:CapWin32::SetForegroundWindow($hwnd)
        Start-Sleep -Milliseconds 600
      }
      try {
        $bmp = New-Bmp $ww $wh
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $hdc = $g.GetHdc()
        $ok = $script:CapWin32::PrintWindow($hwnd, $hdc, 2)
        $g.ReleaseHdc($hdc)
        $g.Dispose()
        if (-not $ok) {
          $bmp.Dispose()
          $bmp = Copy-Screen $r.Left $r.Top $ww $wh
        }
      } finally {
        if ($wasMin -and $restoreAfter) { [void]$script:CapWin32::ShowWindow($hwnd, 6) }
        elseif ($foreground -and $restoreAfter -and $prevFg -ne [IntPtr]::Zero -and $prevFg -ne $hwnd) {
          [void]$script:CapWin32::SetForegroundWindow($prevFg)
        }
      }
      $bmp = Crop-Center $bmp $fw $fh
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

    if ($maxdim -gt 0) {
      $mx = [math]::Max($bmp.Width, $bmp.Height)
      if ($mx -gt $maxdim) {
        $k = $maxdim / [double]$mx
        $nw = [int][math]::Round($bmp.Width * $k); $nh = [int][math]::Round($bmp.Height * $k)
        if ($nw -lt 1) { $nw = 1 }; if ($nh -lt 1) { $nh = 1 }
        $bmp = Resize-Bmp $bmp $nw $nh
      }
    }
    elseif ($scale -ge 2) {
      $bmp = Resize-Bmp $bmp ($bmp.Width * $scale) ($bmp.Height * $scale)
    }

    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return 'OK'
  } catch {
    if ($bmp) { try { $bmp.Dispose() } catch {} }
    return ('CAPTURE-FAIL: ' + $_.Exception.Message)
  }
}
