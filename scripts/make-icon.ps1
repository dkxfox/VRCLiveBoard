param([string]$src = '', [string]$out = '')
# Generate a standard multi-size ICO from a PNG (entries: 16/24/32/48/64/128/256, PNG-compressed entries)
if (-not $src -or -not $out) { Write-Output 'usage: make-icon.ps1 -src <png> -out <ico>'; exit 1 }
Add-Type -AssemblyName System.Drawing
# .NET file APIs ignore PowerShell's location: resolve relative paths against the project root (parent of scripts)
$root = Split-Path $PSScriptRoot -Parent
$srcFull = $src
if (-not [System.IO.Path]::IsPathRooted($srcFull)) { $srcFull = Join-Path $root $srcFull }
$outFull = $out
if (-not [System.IO.Path]::IsPathRooted($outFull)) { $outFull = Join-Path $root $outFull }
$img = [System.Drawing.Image]::FromFile($srcFull)
if (-not $img) { Write-Output ('cannot load image: ' + $srcFull); exit 1 }
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngs = New-Object 'System.Collections.Generic.List[byte[]]'
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img, 0, 0, $s, $s)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs.Add($ms.ToArray())
  $ms.Dispose()
  $bmp.Dispose()
}
$img.Dispose()
$dirSize = 6 + 16 * $pngs.Count
$ms2 = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms2
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$pngs.Count)
$cur = $dirSize
for ($i = 0; $i -lt $pngs.Count; $i++) {
  $s = $sizes[$i]
  $wb = 0
  if ($s -lt 256) { $wb = [byte]$s }
  $bw.Write([byte]$wb)
  $bw.Write([byte]$wb)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$pngs[$i].Length)
  $bw.Write([UInt32]$cur)
  $cur += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($outFull, $ms2.ToArray())
$bw.Dispose()
$ms2.Dispose()
Write-Output ('icon written: ' + $outFull + ' entries=' + $pngs.Count + ' bytes=' + (Get-Item $outFull).Length)
