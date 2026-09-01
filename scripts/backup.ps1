param([string]$outDir = '')
# VRCLiveBoard source backup (ASCII only - PS5.1 safe)
# Usage: powershell -File scripts\backup.ps1 [-outDir D:\backup]
$ErrorActionPreference = 'Stop'
$p = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $outDir) { $outDir = Join-Path $env:USERPROFILE 'Documents\VRCLiveBoard-backup' }
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$pkg = Get-Content (Join-Path $p 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$zip = Join-Path $outDir ('VRCLiveBoard-src-v' + $pkg.version + '-' + $stamp + '.zip')
# 用绝对路径排除(robocopy /XD), 避免裸名 'dist' 误杀 plugins\friend-welcome\vendor\dist
$exclAbs = @()
foreach ($n in @('node_modules','dist','logs','.electron-cache','.ocr-cache','.ocr-langs','.pydist')) { $exclAbs += (Join-Path $p $n) }
$stage = Join-Path $env:TEMP ('vrcb-backup-' + $stamp)
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
robocopy $p $stage /E /NFL /NDL /NJH /NJS /XD $exclAbs /XF config.json .ocr-tmp.png .ocr-preview.png | Out-Null
tar -a -cf $zip -C $stage .
Remove-Item $stage -Recurse -Force
Write-Output ('backup: ' + $zip)
Write-Output ('size: ' + [math]::Round((Get-Item $zip).Length / 1MB, 2) + ' MB')
