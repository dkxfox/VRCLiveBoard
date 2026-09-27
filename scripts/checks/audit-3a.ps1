# 3A 一键入口(PROCESS-03 §0 的 3A 定期检查)
#   用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\checks\audit-3a.ps1
#   只做只读扫描(机密 / 攻击面 / 依赖与产物): 不连用户实例、不写仓库文件。
#   基线更新仍需显式 --update-baseline + 人工复核(A0), 本脚本不会替你做。
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $root
$steps = @(
  @{ id = '1'; name = '机密扫描(工作区 + git 历史)'; cmd = 'node scripts\checks\secret-scan.js' },
  @{ id = '2'; name = '攻击面基线比对';             cmd = 'node scripts\checks\surface-scan.js' },
  @{ id = '3'; name = '依赖审计 + 产物哈希';         cmd = 'node scripts\checks\dep-audit.js' }
)
Write-Output ('[3A] 仓库根: ' + $root)
$fail = 0
foreach ($s in $steps) {
  Write-Output ''
  Write-Output ('===== 3A-' + $s.id + ' ' + $s.name + ' =====')
  Invoke-Expression $s.cmd
  if ($LASTEXITCODE -ne 0) { $fail++; Write-Output ('  >> FAIL: ' + $s.name) }
}
Write-Output ''
Write-Output '==================== 3A SUMMARY ===================='
if ($fail -eq 0) { Write-Output '  3A PASS (3/3)' } else { Write-Output ('  3A FAIL (' + $fail + '/3)') }
Write-Output '=================================================='
Write-Output '提示: gate-selftest / auth-state-check(开发者机) / doc-consistency 是 3A 的扩展项, 需要时单独跑。'
Pop-Location
if ($fail -eq 0) { exit 0 } else { exit 1 }
