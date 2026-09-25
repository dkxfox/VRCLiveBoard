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

# 2026-09-25: 断言用 **base64** 传给 smoke.ps1 —— 直接拼在命令行上时, 双引号会被解析层吃掉
# (现象: 卡片里写 "id":"xxx" 的正则永远 FAIL, 去掉引号立刻 PASS。见 ISSUES M-20260925-07)
$joined = $asserts -join [string][char]31
$b64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($joined))
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'smoke.ps1') -Port $Port -AssertB64 $b64
exit $LASTEXITCODE
