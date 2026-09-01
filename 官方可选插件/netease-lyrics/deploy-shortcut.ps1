# VRCLiveBoard netease-lyrics: 在桌面创建 CDP 启动器快捷方式(需 UTF-8 BOM, PS5.1 GBK 安全)
$ErrorActionPreference = 'Stop'
$bat = Join-Path $PSScriptRoot '启动网易云-CDP.bat'
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop '网易云音乐-歌词同步.lnk'
if (-not (Test-Path -LiteralPath $bat)) { Write-Output 'BAT-MISSING'; exit 1 }
$w = New-Object -ComObject WScript.Shell
$l = $w.CreateShortcut($lnk)
$l.TargetPath = $bat
$l.WorkingDirectory = $PSScriptRoot
$l.Description = 'VRCLiveBoard 网易云歌词 CDP 启动器(精确同步)'
$l.Save()
Write-Output ('LNK-OK ' + $lnk)
