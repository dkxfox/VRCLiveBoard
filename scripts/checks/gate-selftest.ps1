# 门禁有效性自测(红队夹具): 往临时副本注入已知故障, 确认每个门禁**真的会 FAIL**
# 为什么需要它: config.json.bak 泄密的根因不是"没有扫描器", 而是"扫描器有盲区却没人发现"。
#              检查器本身必须被检查 —— 这是流程 3 的第一道工序。
# 用法: powershell -File scripts\checks\gate-selftest.ps1
$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tmp = Join-Path $env:TEMP 'vrcb-gate-selftest'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$excl = @('node_modules','dist','logs','.git','.electron-cache','.pydist','.ocr-langs','.ocr-cache') | ForEach-Object { Join-Path $proj $_ }
robocopy $proj $tmp /E /NFL /NDL /NJH /NJS /XD $excl | Out-Null
Write-Output ('[gate-selftest] 临时副本: ' + $tmp)
$CRLF = [string][char]13 + [string][char]10
$LF = [string][char]10
$results = @()
function Run-Case($name, $gate, $applyBlock, $files) {
  $backup = @{}
  foreach ($f in $files) { $p = Join-Path $tmp $f; if (Test-Path $p) { $backup[$f] = [System.IO.File]::ReadAllBytes($p) } }
  & $applyBlock
  Push-Location $tmp
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & node (Join-Path $tmp $gate) 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  Pop-Location
  foreach ($f in $files) { $p = Join-Path $tmp $f; if ($backup.ContainsKey($f)) { [System.IO.File]::WriteAllBytes($p, $backup[$f]) } elseif (Test-Path $p) { Remove-Item $p -Force -Recurse } }
  $ok = ($code -ne 0)
  $script:results += [pscustomobject]@{ Case = $name; Gate = (Split-Path $gate -Leaf); Detected = $(if ($ok) { 'YES' } else { 'NO' }) }
  Write-Output ('  ' + $(if ($ok) { 'OK   拦住了' } else { 'FAIL 没拦住!' }) + ' : ' + $name + '  (' + (Split-Path $gate -Leaf) + ' exit=' + $code + ')')
}

Run-Case '仓库里出现明文 API key' 'scripts\checks\secret-scan.js' {
  [System.IO.File]::WriteAllText((Join-Path $tmp 'leak-note.txt'), 'apiKey = sk-abcdefghijklmnopqrstuvwxyz012345')
} @('leak-note.txt')

Run-Case 'bat 混入 UTF-8 中文' 'scripts\checks\encoding-lint.js' {
  [System.IO.File]::WriteAllText((Join-Path $tmp 'scripts\tmp-selftest-utf8.bat'), 'rem 这是 UTF-8 中文' + $CRLF, (New-Object System.Text.UTF8Encoding($false)))
} @('scripts\tmp-selftest-utf8.bat')

Run-Case 'ps1 含中文却无 BOM' 'scripts\checks\encoding-lint.js' {
  [System.IO.File]::WriteAllText((Join-Path $tmp 'scripts\tmp-selftest.ps1'), '# 中文注释' + $LF + "Write-Output 'x'" + $LF, (New-Object System.Text.UTF8Encoding($false)))
} @('scripts\tmp-selftest.ps1')

Run-Case '版本号只改 package.json' 'scripts\checks\version-sync.js' {
  $p = Join-Path $tmp 'package.json'
  $j = Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json
  $j.version = '9.9.9'
  [System.IO.File]::WriteAllText($p, ($j | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding($false)))
} @('package.json')

Run-Case '英文语言包缺一个键' 'scripts\checks\i18n-check.js' {
  Add-Content -Path (Join-Path $tmp 'src\web\public\lang.js') -Value 'delete window.VRCB_LANG.en.reloadBtn;' -Encoding UTF8
} @('src\web\public\lang.js')

Run-Case '控制台内联脚本语法错误' 'scripts\checks\html-inline-check.js' {
  Add-Content -Path (Join-Path $tmp 'src\web\public\index.html') -Value '<script>function broken( {</script>' -Encoding UTF8
} @('src\web\public\index.html')

Run-Case '插件被复制出第二份源码' 'scripts\checks\plugin-check.js' {
  robocopy (Join-Path $tmp 'plugins\netease-lyrics') (Join-Path $tmp '官方可选插件\netease-lyrics') /E /NFL /NDL /NJH /NJS | Out-Null
} @('官方可选插件\netease-lyrics')

Run-Case '安全开关被改成 false' 'scripts\checks\config-contract.js' {
  $p = Join-Path $tmp 'config.default.json'
  $j = Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json
  $j.ocrtl.security.promptDefense = $false
  [System.IO.File]::WriteAllText($p, ($j | ConvertTo-Json -Depth 24), (New-Object System.Text.UTF8Encoding($false)))
} @('config.default.json')

Run-Case '出厂代码新增未知外部域名' 'scripts\checks\surface-scan.js' {
  Add-Content -Path (Join-Path $tmp 'src\main.js') -Value '// probe https://evil.example.com/collect' -Encoding UTF8
} @('src\main.js')

Write-Output ''
Write-Output '============ GATE SELF-TEST SUMMARY ============'
foreach ($r in $results) { Write-Output ('  ' + $r.Detected.PadRight(4) + ' ' + $r.Gate.PadRight(22) + $r.Case) }
$missed = @($results | Where-Object { $_.Detected -eq 'NO' }).Count
Write-Output ('  ---- ' + ($results.Count - $missed) + '/' + $results.Count + ' 个注入故障被拦住 ----')
Write-Output '==============================================='
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
if ($missed) { exit 1 } else { exit 0 }
