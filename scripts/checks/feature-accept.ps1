# 功能验收: 从功能卡(docs/FEATURES/F-*.md)里抽出 ASSERT 行, 批量跑隔离冒烟
# 功能卡里的写法(每行一条):
#   - ASSERT: 名字|/api/路径|期望正则
# 用法: powershell -File scripts\checks\feature-accept.ps1 -Card docs\FEATURES\F-20260901-01-xxx.md [-Port 19260]
param(
  [Parameter(Mandatory = $true)][string]$Card,
  [int]$Port = 19260
)
$proj = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not [System.IO.Path]::IsPathRooted($Card)) { $Card = Join-Path $proj $Card }
if (-not (Test-Path $Card)) { Write-Output ('[FATAL] 功能卡不存在: ' + $Card); exit 2 }

$asserts = @()
foreach ($line in (Get-Content $Card -Encoding UTF8)) {
  if ($line -match '^\s*-\s*ASSERT\s*[::]\s*(.+)$') { $asserts += $Matches[1].Trim() }
}
Write-Output ('[feature-accept] 功能卡 ' + (Split-Path $Card -Leaf) + ' 抽出 ' + $asserts.Count + ' 条断言')
if ($asserts.Count -eq 0) { Write-Output '[FATAL] 功能卡里没有 ASSERT 行 —— 成功标准必须写成可执行断言'; exit 2 }
foreach ($a in $asserts) { Write-Output ('   ' + $a) }

powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'smoke.ps1') -Port $Port -Assert $asserts
exit $LASTEXITCODE
