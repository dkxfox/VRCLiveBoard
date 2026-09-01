param([string]$mode = 'window', [int]$x = 0, [int]$y = 0, [int]$w = 0, [int]$h = 0, [string]$out = '', [string]$title = '', [double]$fw = 0, [double]$fh = 0, [int]$scale = 2, [int]$maxdim = 0, [switch]$foreground, [switch]$restoreAfter)
# VRCLiveBoard screenshot helper
# modes:
#   window - capture the target window's OWN content via PrintWindow (works when covered/minimized); title via UIA or FindWindow
#   region - CopyFromScreen x/y/w/h (screen region chosen visually in the console)
#   screen - full primary monitor
# output is upscaled 2x by default (OCR); use -scale 1 -maxdim N for a downscaled preview
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
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
$t = (Add-Type -MemberDefinition $sig -Name CapWin32 -Namespace VLB -PassThru) | Where-Object { $_.FullName -eq 'VLB.CapWin32' } | Select-Object -First 1

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

$bmp = $null
try {
  if ($mode -eq 'fg') {
    $hwnd = [IntPtr]::Zero
    if ($title) {
      try {
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $title)
        $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
        if ($win) { $hwnd = [IntPtr]$win.Current.NativeWindowHandle }
      } catch {}
      if ($hwnd -eq [IntPtr]::Zero) { $hwnd = $t::FindWindowW($null, $title) }
    }
    if ($hwnd -eq [IntPtr]::Zero) { Write-Output 'NO-WINDOW'; exit 0 }
    if ($t::IsIconic($hwnd)) { [void]$t::ShowWindow($hwnd, 9) }
    [void]$t::ShowWindow($hwnd, 5)
    [void]$t::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 300
    Write-Output 'OK'
    exit 0
  }
  if ($mode -eq 'window') {
    $hwnd = [IntPtr]::Zero
    if ($title) {
      try {
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $title)
        $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
        if ($win) { $hwnd = [IntPtr]$win.Current.NativeWindowHandle }
      } catch {}
      if ($hwnd -eq [IntPtr]::Zero) { $hwnd = $t::FindWindowW($null, $title) }
    }
    if ($hwnd -eq [IntPtr]::Zero) { Write-Output 'NO-WINDOW'; exit 0 }
    $r = New-Object 'VLB.CapWin32+RECT'
    if (-not $t::GetWindowRect($hwnd, [ref]$r)) { Write-Output 'NO-WINDOW'; exit 0 }
    $ww = $r.Right - $r.Left; $wh = $r.Bottom - $r.Top
    if ($ww -le 0 -or $wh -le 0) { Write-Output 'NO-WINDOW'; exit 0 }
    $wasMin = $t::IsIconic($hwnd)
    $prevFg = $t::GetForegroundWindow()
    if ($foreground -or $wasMin) {
      if ($wasMin) { [void]$t::ShowWindow($hwnd, 9) }
      [void]$t::ShowWindow($hwnd, 5)
      [void]$t::SetForegroundWindow($hwnd)
      Start-Sleep -Milliseconds 600
    }
    try {
      $bmp = New-Bmp $ww $wh
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $hdc = $g.GetHdc()
      $ok = $t::PrintWindow($hwnd, $hdc, 2)
      $g.ReleaseHdc($hdc)
      $g.Dispose()
      if (-not $ok) {
        $bmp.Dispose()
        $bmp = Copy-Screen $r.Left $r.Top $ww $wh
      }
    } finally {
      if ($wasMin -and $restoreAfter) { [void]$t::ShowWindow($hwnd, 6) }
      elseif ($foreground -and $restoreAfter -and $prevFg -ne [IntPtr]::Zero -and $prevFg -ne $hwnd) {
        [void]$t::SetForegroundWindow($prevFg)
      }
    }
    $bmp = Crop-Center $bmp $fw $fh
  }
  elseif ($mode -eq 'region') {
    if ($w -le 0 -or $h -le 0) { Write-Output 'NO-REGION'; exit 0 }
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
  Write-Output 'OK'
} catch {
  Write-Output ('CAPTURE-FAIL: ' + $_.Exception.Message)
  if ($bmp) { try { $bmp.Dispose() } catch {} }
}
