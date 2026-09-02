# VRCLiveBoard packaging script (ASCII only - PS5.1 GBK parsing safety)
# Outputs: dist\VRCLiveBoard-Desktop-SelfContained-vX.zip (no Node/npm needed)
#          dist\VRCLiveBoard-Lite-RequiresNode-vX.zip (first run auto-installs deps)
param([switch]$SkipLight)
$ErrorActionPreference = 'Stop'
$p = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $p
$pkg = Get-Content 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$ver = $pkg.version
$dist = Join-Path $p 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
# 成品分两个区(中文名用码点构造, 保持本脚本 ASCII 安全): 公开版 / 开发者申请版
$pubDir = Join-Path $dist (-join @([char]0x516C,[char]0x5F00,[char]0x7248))
$appDir = Join-Path $dist (-join @([char]0x5F00,[char]0x53D1,[char]0x8005,[char]0x7533,[char]0x8BF7,[char]0x7248))
New-Item -ItemType Directory -Force -Path $pubDir | Out-Null
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
$appNote = (-join @([char]0x7533,[char]0x8BF7,[char]0x8BF4,[char]0x660E)) + '.txt'
Copy-Item (Join-Path $p 'scripts\dev-apply-note.txt') (Join-Path $appDir $appNote) -Force
Get-ChildItem $dist -Filter 'VRCLiveBoard-*.zip' -File | Remove-Item -Force
# exclude dirs whose names match test/OCR material (Unicode-safe: via variables, not literals)
$userDirs = @(Get-ChildItem $p -Directory | Where-Object { $_.Name -match '测试|OCR|截图' } | ForEach-Object { $_.Name })
$exclDirs = @('node_modules','logs','.electron-cache','.ocr-cache','.ocr-langs','.pydist') + $userDirs
# 只排除项目顶层的 dist(用绝对路径),避免误伤插件自带的 vendor\dist 等嵌套同名目录
# scripts\checks 是开发期门禁工具, 不随分发包出厂(仓库里保留)
$exclAbs = @($dist, (Join-Path $p 'dev-dongle'), (Join-Path $p 'scripts\checks')) + $exclDirs

Write-Output '==== 1. integrity check ===='
$problems = @()
$required = @('package.json','config.json','config.default.json','启动.bat','启动桌面版.bat','使用说明.txt','软件图标.png','官方可选插件\说明-如何装回插件.txt','src\main.js','src\composer.js','src\osc.js','src\ocrtranslate.js','src\vrcstatus.js','src\housekeeping.js','src\diagnose.js','src\autostart.js','src\helpers\smtc.py','src\helpers\screen_capture.ps1','src\web\server.js','src\web\public\index.html','src\sources\hardware.js','src\sources\media.js','src\sources\pages.js','plugins\livetranslate.js','plugins\ocrregion.js','plugins\friend-welcome\vendor\xlsx.js','plugins\friend-welcome\vendor\dist\cpexcel.js','plugins\scheduled-board\vendor\xlsx.js','plugins\scheduled-board\vendor\dist\cpexcel.js','electron\main.js','electron\app.ico','scripts\ensure-deps.js','scripts\install-electron.js','docs\DEV-NOTES.md','README.md')
foreach ($f in $required) {
  if (-not (Test-Path (Join-Path $p $f))) { $problems += ('missing: ' + $f) }
}
try { $null = Get-Content 'config.json' -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $problems += 'config.json parse failed' }
foreach ($b in @('启动.bat','启动桌面版.bat')) {
  $raw = [System.IO.File]::ReadAllText((Join-Path $p $b))
  if (-not $raw.Contains([char]13 + [char]10)) { $problems += ($b + ': not CRLF') }
  if ($raw -match '[\u4e00-\u9fff]') { $problems += ($b + ': contains CJK chars') }
}
foreach ($d in @('osc','systeminformation','tesseract.js','@tesseract.js-data\chi_sim','@tesseract.js-data\jpn','electron\dist\electron.exe')) {
  if (-not (Test-Path (Join-Path $p ('node_modules\' + $d)))) { $problems += ('missing dep: node_modules\' + $d) }
}
Write-Output '== 1b. secret scan (sk- keys) =='
$secAll = Get-ChildItem $p -Recurse -File -Include *.json,*.txt,*.js,*.md,*.log,*.ps1,*.py,*.bat,*.cfg | Where-Object { $_.FullName -notmatch 'node_modules' } | Select-String -Pattern 'sk-[a-zA-Z0-9]{16,}|SESSDATA=[0-9a-fA-F]{8}' -ErrorAction SilentlyContinue
$secFatal = $secAll | Where-Object { $_.Path -notmatch '\\config\.json$' }
if ($secFatal) { $problems += ('[SECRET] key found: ' + ($secFatal | Select-Object -First 3 | ForEach-Object { $_.Path.Replace($p + '\', '') })) }
$secCfg = $secAll | Where-Object { $_.Path -match '\\config\.json$' }
if ($secCfg) { Write-Output '[WARN] config.json 含密钥, 打包时自动清空(不会带进 zip)' }
if ($problems.Count -eq 0) { Write-Output 'integrity: ALL OK' } else { $problems | ForEach-Object { Write-Output ('[PROBLEM] ' + $_) }; exit 1 }
function Scrub-Secrets($f) {
  if (-not (Test-Path $f)) { return }
  try {
    $j = Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json
    function Recurse($o) {
      foreach ($prop in @($o.PSObject.Properties)) {
        if ($prop.Name -match 'key|token|secret|cookie|sessdata') { $prop.Value = ''; continue }
        if ($prop.Value -is [PSCustomObject]) { Recurse $prop.Value }
      }
    }
    Recurse $j
    [System.IO.File]::WriteAllText($f, ($j | ConvertTo-Json -Depth 24), (New-Object System.Text.UTF8Encoding($false)))
  } catch { Write-Output ('[WARN] config 脱敏失败: ' + $_.Exception.Message) }
}

# 内部宣传素材(汉弗莱版说明/宣传片剧本)严禁进入分发包 — 用码点构造文件名, 保持脚本 ASCII 安全
$humphrey = (-join @([char]0x7248, [char]0x672C, [char]0x8BF4, [char]0x660E)) + '-v1.1.0-' + (-join @([char]0x6C49, [char]0x5F17, [char]0x83B1)) + (-join @([char]0x7248)) + '.md'
$promoScript = (-join @([char]0x5BA3, [char]0x4F20, [char]0x7247, [char]0x5267, [char]0x672C)) + '-v1.1.0.md'
$verNote = -join @([char]0x7248, [char]0x672C, [char]0x8BF4, [char]0x660E)  # 版本说明
$secStmt = (-join @([char]0x52A0,[char]0x5BC6,[char]0x72D7,[char]0x5B89,[char]0x5168,[char]0x58F0,[char]0x660E)) + '.txt'  # 加密狗安全声明(只随授权包经 mini-template 分发, 不进公开包)
$releaseNote = (-join @([char]0x53D1,[char]0x5E03,[char]0x516C,[char]0x544A)) + '-' + (-join @([char]0x661F,[char]0x5149)) + '.txt'  # 发布公告-星光.txt(对外公告, 不进包)
$launcherExe = 'VRCLiveBoard.exe'  # 自建桌面版启动器(scripts\launcher\build.bat 编译; 是否随包分发由用户定, 目前不进包)
$dongleDoc = (-join @([char]0x52A0,[char]0x5BC6,[char]0x72D7,[char]0x5DE5,[char]0x4F5C,[char]0x539F,[char]0x7406,[char]0x8BF4,[char]0x660E)) + '.txt'  # 加密狗工作原理说明(开发者申请版内容, 不进公开包)
$contNote = (-join @([char]0x7EE7,[char]0x7EED,[char]0x5F00,[char]0x53D1,[char]0x547D,[char]0x4EE4)) + '.txt'  # 继续开发命令.txt(开发者本地便签, 不进包)
# 注意: robocopy /XF 只认文件名不认相对路径, 这里写裸文件名; '*.bak' 拦截 config.json.bak 这类含真实密钥的本地备份
$xfFiles = @('config.json', 'config.json.bak', '*.bak', '.ocr-tmp.png', '.ocr-preview.png', 'dev-unlocker.js', 'dev-unlocker.bat', 'dev-unlocker.ps1', $secStmt, $releaseNote, $launcherExe, $dongleDoc, $contNote, 'dev-apply-note.txt', $humphrey, $promoScript, ($verNote + '-v1.1.0.md'), ($verNote + '-v1.2.1.md'))  # 旧版说明仅存档不进包, 随包的是 版本说明.txt

# zip writer: .NET ZipFile writes non-ASCII entry names as UTF-8 with the EFS flag set
# (Windows tar.exe writes GBK-codepage bytes without the flag -> breaks extractors on non-CJK systems)
Add-Type -AssemblyName System.IO.Compression.FileSystem
function New-VrcbZip($srcDir, $zipPath) {
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force -ErrorAction SilentlyContinue }
  [System.IO.Compression.ZipFile]::CreateFromDirectory($srcDir, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) { & node (Join-Path $p 'scripts\fix-zip-sep.js') $zipPath } else { Write-Output '[WARN] node 不存在, 跳过 zip 分隔符规整' }
}
# 出厂前最后一道闸: 扫描 stage 目录(= 即将打进 zip 的真实内容), 命中真实密钥/私有字段即中止
function Check-Stage($dir) {
  $bad = @()
  $files = Get-ChildItem $dir -Recurse -File -Include *.json,*.bak,*.txt,*.cfg,*.ini,*.env -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'node_modules' }
  $hits = $files | Select-String -Pattern 'sk-[a-zA-Z0-9]{16,}', '"(devchain|level1Password)"\s*:', 'SESSDATA=[0-9a-fA-F]{8}' -ErrorAction SilentlyContinue
  foreach ($h in $hits) { $bad += ($h.Path.Replace($dir + '\', '') + ' line ' + $h.LineNumber) }
  foreach ($b in @(Get-ChildItem $dir -Recurse -File -Filter '*.bak' -ErrorAction SilentlyContinue)) { $bad += ('stray backup file: ' + $b.FullName.Replace($dir + '\', '')) }
  if ($bad.Count -gt 0) {
    Write-Output '[PROBLEM] stage secret scan FAILED (real key / private field about to ship):'
    $bad | Select-Object -First 12 | ForEach-Object { Write-Output ('   ' + $_) }
    exit 1
  }
  Write-Output 'stage secret scan: CLEAN'
}
# 插件单一源: plugins\ 是唯一源, 打包时在 stage 里生成 官方可选插件\ 恢复备份(用户误删可从这里拷回)
function Copy-OfficialPlugins($stageDir) {
  $optName = -join @([char]0x5B98, [char]0x65B9, [char]0x53EF, [char]0x9009, [char]0x63D2, [char]0x4EF6)  # 官方可选插件
  $optDir = Join-Path $stageDir $optName
  New-Item -ItemType Directory -Force -Path $optDir | Out-Null
  $n = 0
  foreach ($d in @(Get-ChildItem (Join-Path $p 'plugins') -Directory)) {
    robocopy $d.FullName (Join-Path $optDir $d.Name) /E /NFL /NDL /NJH /NJS | Out-Null
    $n++
  }
  Write-Output ('official plugin backups: ' + $n + ' 个 -> ' + $optName + '\')
}
function Get-ZipNames($zipPath) {
  $z = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  $names = @($z.Entries | ForEach-Object { $_.FullName })
  $z.Dispose()
  return $names
}

Write-Output '==== 2. stage self-contained (full deps) ===='
$stage = Join-Path $dist ('stage-sc-' + $ver)
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null
robocopy $p $stage /E /NFL /NDL /NJH /NJS /XD $exclAbs /XF $xfFiles | Out-Null
robocopy (Join-Path $p 'node_modules') (Join-Path $stage 'node_modules') /E /NFL /NDL /NJH /NJS | Out-Null
Copy-Item (Join-Path $p 'config.default.json') (Join-Path $stage 'config.json') -Force
Scrub-Secrets (Join-Path $stage 'config.json')
Copy-OfficialPlugins $stage
Check-Stage $stage
Write-Output '==== 3. zip self-contained (big, wait) ===='
$zipSc = Join-Path $pubDir ('VRCLiveBoard-Desktop-SelfContained-v' + $ver + '.zip')
New-VrcbZip $stage $zipSc
Write-Output ('made: ' + $zipSc + ' (' + [math]::Round((Get-Item $zipSc).Length / 1MB) + ' MB)')
$manNameSc = (-join @([char]0x4F7F,[char]0x7528,[char]0x8BF4,[char]0x660E)) + '.txt'  # 使用说明.txt
$namesSc = Get-ZipNames $zipSc
if (-not ($namesSc -contains $manNameSc)) { Write-Output '[PROBLEM] self-contained zip 中文文件名编码异常'; exit 1 }
if ($namesSc | Where-Object { $_ -like '*.bak' }) { Write-Output '[PROBLEM] self-contained zip 混入 .bak 备份文件'; exit 1 }
Write-Output 'utf8 name check: OK / no .bak: OK'

if (-not $SkipLight) {
  Write-Output '==== 4. stage lite (requires Node) ===='
  $stageL = Join-Path $dist ('stage-light-' + $ver)
  Remove-Item $stageL -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $stageL | Out-Null
  robocopy $p $stageL /E /NFL /NDL /NJH /NJS /XD $exclAbs /XF $xfFiles | Out-Null
  Copy-Item (Join-Path $p 'config.default.json') (Join-Path $stageL 'config.json') -Force
  Scrub-Secrets (Join-Path $stageL 'config.json')
  Copy-OfficialPlugins $stageL
  Check-Stage $stageL
  Write-Output '==== 5. zip lite ===='
  $zipL = Join-Path $pubDir ('VRCLiveBoard-Lite-RequiresNode-v' + $ver + '.zip')
  New-VrcbZip $stageL $zipL
  Write-Output ('made: ' + $zipL + ' (' + [math]::Round((Get-Item $zipL).Length / 1MB) + ' MB)')
  $namesL = Get-ZipNames $zipL
  $chk = $namesL | Where-Object { $_ -like '*friend-welcome*vendor*dist*cpexcel.js*' }
  if (-not $chk) { Write-Output '[PROBLEM] lite zip 缺少 vendor\dist\cpexcel.js (Excel 导入会炸)'; exit 1 }
  Write-Output 'vendor check: cpexcel.js in zip OK'
  $chkH = $namesL | Where-Object { $_ -like ('*' + $humphrey + '*') }
  if ($chkH) { Write-Output '[PROBLEM] lite zip 混入了汉弗莱版说明(内测群玩笑文件, 不得进包)'; exit 1 }
  $chkP = $namesL | Where-Object { $_ -like ('*' + $promoScript + '*') }
  if ($chkP) { Write-Output '[PROBLEM] lite zip 混入了宣传片剧本(内部素材, 不得进包)'; exit 1 }
  Write-Output 'internal-files check: excluded OK'
  $manName = (-join @([char]0x4F7F,[char]0x7528,[char]0x8BF4,[char]0x660E)) + '.txt'  # 使用说明.txt
  if (-not ($namesL -contains $manName)) { Write-Output '[PROBLEM] lite zip 中文文件名编码异常(缺 使用说明.txt)'; exit 1 }
  if ($namesL | Where-Object { $_ -like '*.bak' }) { Write-Output '[PROBLEM] lite zip 混入 .bak 备份文件'; exit 1 }
  Write-Output 'utf8 name check: OK / no .bak: OK'
}
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
if (-not $SkipLight) { Remove-Item $stageL -Recurse -Force -ErrorAction SilentlyContinue }
Write-Output '==== done ===='