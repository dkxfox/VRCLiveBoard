# 发布前审计(流程 3 的一键入口): 全部门禁 + 安全扫描 + 包审计 + 授权链沙箱 + 校验和清单
# 产出: dist\公开版\SHA256SUMS-v<版本>.txt 与 审计报告-AUDIT-<时间>.txt
# 用法: powershell -File scripts\checks\release-audit.ps1 [-SkipSmoke] [-NoSelftest]
param(
  [switch]$SkipSmoke,
  [switch]$NoSelftest
)
$proj = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $proj
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$ver = (Get-Content (Join-Path $proj 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$report = Join-Path $proj ('审计报告-AUDIT-' + $stamp + '.txt')
$log = [System.Collections.ArrayList]@()
function Log($line) { [void]$log.Add($line); Write-Output $line }
$exit = 0

Log ('==== VRCLiveBoard v' + $ver + ' 发布前审计 ' + $stamp + ' ====')
Log ''

function RunStep($name, $block) {
  Log ('---- 步骤: ' + $name + ' ----')
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = & $block 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  Log $out.Trim()
  Log ('步骤结果 ' + $name + ': ' + $(if ($code -eq 0) { 'PASS' } else { 'FAIL' }))
  if ($code -ne 0) { $script:exit = 1 }
  Log ''
}

# 0a. 打包脚本自身健康(2026-09-11 审计 H1): make-dist 是"什么能出厂"的唯一执行者 —— 它一旦丢 BOM 或解析失败,
#     中文排除项(秘密开发*/旧版控制台/测试素材)会静默失效, 而脚本仍会打印 integrity OK。
RunStep '0a. 打包脚本自身检查(BOM + PS5.1 解析)' { node scripts\checks\pack-script-check.js }

# 0. 检查器自测(审计之前先审审计器)
if (-not $NoSelftest) {
  RunStep '0. 门禁有效性自测(红队夹具)' { powershell -NoProfile -ExecutionPolicy Bypass -File scripts\checks\gate-selftest.ps1 }
} else { Log '[skipped] 0. 门禁自测(-NoSelftest)'; Log '' }

# 1. 机密扫描(工作区 + git 历史)
RunStep '1. 机密扫描(工作区 + git 历史)' { node scripts\checks\secret-scan.js }

# 2. 攻击面基线
RunStep '2. 攻击面基线比对' { node scripts\checks\surface-scan.js }

# 3. 授权体系状态(仅开发者机; 非开发者机自动跳过; 只输出投影信息, 不打印口令)
RunStep '3. 授权体系状态(登记表/锚点/盐/mini-template)' { node scripts\checks\auth-state-check.js }

# 4. 依赖与产物完整性 + npm audit
RunStep '4. 依赖审计(npm audit + 产物哈希)' { node scripts\checks\dep-audit.js }

# 5. 常规门禁
RunStep '5. 常规门禁(语法/编码/版本/i18n/HTML/插件/配置)' { powershell -NoProfile -ExecutionPolicy Bypass -File scripts\checks\run-gates.ps1 -AllowDirty }

# 6. 隔离冒烟
if (-not $SkipSmoke) {
  RunStep '6. 隔离冒烟(端口 19260)' { powershell -NoProfile -ExecutionPolicy Bypass -File scripts\checks\smoke.ps1 -Port 19260 }
} else { Log '[skipped] 6. 冒烟(-SkipSmoke)'; Log '' }

# 7. 发布包审计 + SHA256 清单
RunStep '7. 发布包审计 + SHA256 清单' {
  $pub = Join-Path $proj 'dist\公开版'
  $zips = @(Get-ChildItem $pub -Filter ('*v' + $ver + '.zip') | ForEach-Object { $_.FullName })
  if ($zips.Count -eq 0) { Log 'FAIL dist\公开版 没有当前版本号的 zip(先跑 make-dist)'; $script:exit = 1; return }
  # 新鲜度(M-20260911-37): 包比源码旧 = 有人改完代码没重新打包 —— 以前审计发现不了这类漂移, 报告还会被 exit 跳过
  $srcDirs = @((Join-Path $proj 'src'), (Join-Path $proj 'electron'), (Join-Path $proj 'plugins'))
  $newest = Get-ChildItem $srcDirs -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\(node_modules|vendor|dist)\\' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $zipTime = (Get-Item $zips[0]).LastWriteTime
  if ($newest -and $newest.LastWriteTime -gt $zipTime) { Log ('FAIL 包比源码旧: ' + (Split-Path $newest.FullName -Leaf) + ' (' + $newest.LastWriteTime + ') 晚于 zip (' + $zipTime + ') -> 先重新跑 make-dist'); $script:exit = 1; return }
  node scripts\checks\pack-audit.js $zips
  # 包与提交绑定(M-20260911-39): BUILD-INFO.commit 必须等于 HEAD, 否则说明包是从旧代码打的
  $head = ''
  try { $head = (git rev-parse HEAD).Trim() } catch {}
  $biZip = $zips | Select-Object -First 1
  $biTxt = ''
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [System.IO.Compression.ZipFile]::OpenRead($biZip)
    try {
      $entry = $z.GetEntry('BUILD-INFO.json')
      if ($entry) { $sr = New-Object System.IO.StreamReader($entry.Open()); $biTxt = $sr.ReadToEnd(); $sr.Dispose() }
    } finally { $z.Dispose() }
  } catch { Log ('WARN 读取 BUILD-INFO 失败: ' + $_.Exception.Message) }
  if (-not $biTxt) { Log 'WARN 包内没有 BUILD-INFO.json(旧包或未用新版 make-dist 构建)' }
  else {
    $bi = $biTxt | ConvertFrom-Json
    if ($head -and $bi.commit -and ($bi.commit -ne $head)) { Log ('FAIL 包内 BUILD-INFO.commit(' + $bi.commit.Substring(0,7) + ') 与当前 HEAD(' + $head.Substring(0,7) + ') 不一致 -> 用当前代码重新打包'); $script:exit = 1 }
    else { Log ('包与提交绑定: commit ' + ([string]$bi.commit).Substring(0,7) + ' 与 HEAD 一致') }
  }
  # 插件更新包也要过一遍禁入名单/机密/文件名编码(M-20260911-39)
  $plugDir = Join-Path $proj 'dist\插件更新包'
  $plugZips = @(Get-ChildItem $plugDir -Filter '*.zip' -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  if ($plugZips.Count) { node scripts\checks\pack-audit.js --plugin-pack @plugZips; if ($LASTEXITCODE -ne 0) { Log 'FAIL 插件更新包审计未通过'; $script:exit = 1 } else { Log ('插件更新包审计通过(' + $plugZips.Count + ' 个)') } }
  else { Log 'WARN 没有找到插件更新包(dist\插件更新包\*.zip)' }
  $sums = Join-Path $pub ('SHA256SUMS-v' + $ver + '.txt')
  Get-FileHash $zips -Algorithm SHA256 | ForEach-Object { '{0}  {1}' -f $_.Hash.ToLower(), (Split-Path $_.Path -Leaf) } | Set-Content -Path $sums -Encoding ascii
  Log ('已生成校验和清单: ' + $sums)
}

# 8. git 同步
RunStep '8. git 同步状态' { node scripts\checks\git-sync-check.js }

Log '==================== 审计结论 ===================='
Log $(if ($exit -eq 0) { 'AUDIT PASS —— 可以发布' } else { 'AUDIT FAIL —— 修复所有 FAIL 后重跑' })
Log '=================================================='
[System.IO.File]::WriteAllText($report, ($log -join [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($true)))
Log ('报告已写入: ' + $report)
exit $exit
