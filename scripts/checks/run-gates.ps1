# 门禁总入口: 一条命令跑完该跑的闸, 末尾打印汇总表
# 纪律: 只有这张汇总表可以贴进 DEV-NOTES 当证据; 不许用自然语言代替
# 用法:
#   powershell -File scripts\checks\run-gates.ps1                      # 按 git 改动自动判定
#   powershell -File scripts\checks\run-gates.ps1 -Smoke               # 加隔离冒烟
#   powershell -File scripts\checks\run-gates.ps1 -Smoke -Assert 'x|/|regex'
#   powershell -File scripts\checks\run-gates.ps1 -Pack dist\公开版\xxx.zip
param(
  [string]$Changed = '',
  [switch]$Smoke,
  [int]$Port = 19250,
  [string[]]$Assert = @(),
  [string]$Pack = '',
  [switch]$AllowDirty
)
$proj = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $proj
$results = @()
function Gate($id, $name, $block) {
  Write-Output ''
  Write-Output ('===== ' + $id + ' ' + $name + ' =====')
  $code = 0
  try { & $block; $code = $LASTEXITCODE; if ($null -eq $code) { $code = 0 } }
  catch { Write-Output ('  FAIL 异常: ' + $_.Exception.Message); $code = 1 }
  $script:results += [pscustomobject]@{ Gate = $id; Name = $name; Result = $(if ($code -eq 0) { 'PASS' } else { 'FAIL' }) }
}

# 收集改动文件
if ($Changed) { $files = $Changed -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } }
else {
  $files = @()
  $files += (git diff --name-only HEAD 2>$null)
  $files += (git ls-files --others --exclude-standard 2>$null)
  $files = $files | Where-Object { $_ }
}
Write-Output ('[run-gates] 改动文件 ' + $files.Count + ' 个' + $(if ($files.Count) { ': ' + (($files | Select-Object -First 8) -join ', ') } else { '(工作区干净)' }))

Gate 'G1' '语法解析(改动文件)' {
  $bad = 0
  foreach ($f in $files) {
    if (-not (Test-Path $f)) { continue }
    $ext = [System.IO.Path]::GetExtension($f).ToLower()
    if ($ext -eq '.js' -or $ext -eq '.cjs' -or $ext -eq '.mjs') {
      node --check $f 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { Write-Output ('  FAIL node --check ' + $f); $bad++ } else { Write-Output ('  OK   ' + $f) }
    } elseif ($ext -eq '.ps1') {
      $err = $null
      $null = [System.Management.Automation.PSParser]::Tokenize((Get-Content $f -Raw), [ref]$err)
      if ($err.Count) { Write-Output ('  FAIL PS 解析 ' + $f + ': ' + $err[0].Message); $bad++ } else { Write-Output ('  OK   ' + $f) }
    } elseif ($ext -eq '.json') {
      try { $null = Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json; Write-Output ('  OK   ' + $f) }
      catch { Write-Output ('  FAIL JSON ' + $f + ': ' + $_.Exception.Message); $bad++ }
    }
  }
  if ($bad -eq 0) { Write-Output '  PASS' }
  cmd /c exit $bad
}
Gate 'G2'    '编码规范'        { node scripts\checks\encoding-lint.js }
Gate 'GVER'  '版本一致性'      { node scripts\checks\version-sync.js }
Gate 'GI18N' '三语键对齐'      { node scripts\checks\i18n-check.js }
Gate 'GHTML' '控制台页面'      { node scripts\checks\html-inline-check.js }
if ($Smoke) {
  Gate 'G4' ('隔离冒烟 :' + $Port) {
    if ($Assert.Count) { powershell -NoProfile -ExecutionPolicy Bypass -File scripts\checks\smoke.ps1 -Port $Port -Assert $Assert }
    else { powershell -NoProfile -ExecutionPolicy Bypass -File scripts\checks\smoke.ps1 -Port $Port }
  }
}
if ($Pack) { Gate 'GPACK' '发布包审计' { node scripts\checks\pack-audit.js $Pack } }
Gate 'GSYNC' 'git 同步状态' {
  if ($AllowDirty) { node scripts\checks\git-sync-check.js --allow-dirty } else { node scripts\checks\git-sync-check.js }
}

Write-Output ''
Write-Output '==================== GATES SUMMARY ===================='
foreach ($r in $results) { Write-Output ('  ' + $r.Result.PadRight(5) + $r.Gate.PadRight(7) + $r.Name) }
$failed = @($results | Where-Object { $_.Result -eq 'FAIL' }).Count
Write-Output ('  ---- ' + ($results.Count - $failed) + ' PASS / ' + $failed + ' FAIL ----')
Write-Output '======================================================='
if ($failed) { exit 1 } else { exit 0 }
