#G4 隔离冒烟: 把当前工作树(或一个 zip)复制到临时目录, 用测试端口真实启动并打端点
# 纪律: 永远不碰用户实例 19190; 用 config.default.json 而非用户 config.json; 跑完清端口清临时目录
# 用法:
#   powershell -File scripts\checks\smoke.ps1                      # 测当前工作树, 端口 19250
#   powershell -File scripts\checks\smoke.ps1 -Zip dist\...zip -Port 19260
#   powershell -File scripts\checks\smoke.ps1 -Assert 'updateBtn|/|id="updateBtn"'
#   断言第 4 段可选=期望 HTTP 状态码(默认要求 2xx): '文件读拦截|/api/special/video?file=config.json|ok.:false|403'
#   M-09(2026-09-02): 响应体按 UTF-8 解码(中文断言可用); 经 run-gates/feature-accept 转发时断言数组用 [char]31 拼成一个参数, 本脚本自动拆分
param(
  [string]$Zip = '',
  [int]$Port = 19250,
  [string[]]$Assert = @(),
  [switch]$KeepTemp,
  [switch]$Flow
)
$ErrorActionPreference = 'Stop'
$Assert = @($Assert | ForEach-Object { $_ -split ([string][char]31) } | Where-Object { $_ })
$proj = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if ($Port -eq 19190) { Write-Output '[FATAL] 19190 是用户实例端口, 禁止用于测试'; exit 2 }
$tmp = Join-Path $env:TEMP ('vrcb-smoke-' + $Port)
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

if ($Zip) {
  if (-not [System.IO.Path]::IsPathRooted($Zip)) { $Zip = Join-Path $proj $Zip }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($Zip, $tmp)
  Write-Output ('[smoke] 来源 = zip ' + (Split-Path $Zip -Leaf))
} else {
  $excl = @('node_modules','dist','logs','.git','.electron-cache','.pydist','.ocr-langs','.ocr-cache') | ForEach-Object { Join-Path $proj $_ }
  robocopy $proj $tmp /E /NFL /NDL /NJH /NJS /XD $excl /XF 'config.json' | Out-Null
  Copy-Item (Join-Path $proj 'config.default.json') (Join-Path $tmp 'config.json') -Force
  Write-Output '[smoke] 来源 = 当前工作树(config.default.json 作配置)'
}
if (-not (Test-Path (Join-Path $tmp 'node_modules'))) {
  robocopy (Join-Path $proj 'node_modules') (Join-Path $tmp 'node_modules') /E /NFL /NDL /NJH /NJS /MT:16 | Out-Null
}

$cfgPath = Join-Path $tmp 'config.json'
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$cfg.web.port = $Port
$cfg.web.openBrowser = $false
[System.IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 24), (New-Object System.Text.UTF8Encoding($false)))
$env:VRCB_USER_DATA = Join-Path $tmp '.userdata'
# 无人值守: 涉及"打开文件夹"的接口只回路径不弹窗(否则每次跑冒烟都会在用户桌面弹出资源管理器)
$env:VRCB_NO_SHELL = '1'

$pkgVer = (Get-Content (Join-Path $tmp 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$proc = Start-Process -FilePath 'node' -ArgumentList 'src/main.js' -WorkingDirectory $tmp -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 12

$script:pass = 0; $script:fail = 0
function T($name, $urlPath, $pattern, $wantStatus = 0) {
  $code = 0; $body = ''
  try {
    $resp = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $Port + $urlPath) -UseBasicParsing -TimeoutSec 12
    $code = [int]$resp.StatusCode
    if ($resp.RawContentStream) {
      try {
        $ms = New-Object System.IO.MemoryStream
        $resp.RawContentStream.CopyTo($ms)
        $body = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
        $ms.Dispose()
      } catch { $body = $resp.Content }
    } else { $body = $resp.Content }
  } catch {
    try { $code = [int]$_.Exception.Response.StatusCode.value__ } catch { $code = 0 }
    try { $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $body = $sr.ReadToEnd(); $sr.Dispose() } catch { $body = '' }
  }
  $ok = $false
  if ($wantStatus) { $ok = (($code -eq [int]$wantStatus) -and ($body -match $pattern)) }
  else { $ok = (($code -ge 200) -and ($code -lt 300) -and ($body -match $pattern)) }
  if ($ok) { Write-Output ('  PASS ' + $name); $script:pass++ }
  else { Write-Output ('  FAIL ' + $name + '  code=' + $code + ' body=' + $body.Substring(0, [Math]::Min(140, $body.Length))); $script:fail++ }
}
T 'version'        '/api/version'        ('"version"\s*:\s*"' + [regex]::Escape($pkgVer) + '"')
T 'health'         '/api/health'         '"osc"|"sources"|"uptime"'
T 'status'         '/api/status'         '"current"|"sources"'
T 'ports'          '/api/ports'          '"web"|"osc"|"vrchat"'
T 'plugins'        '/api/plugins'        'friend-welcome|scheduled-board|\[\]'
T 'console page'   '/'                   'VRCLiveBoard'
T 'lang.js'        '/lang.js'            'VRCB_LANG'
T 'devgate status' '/api/devgate/status' '"level1"'
T 'config 读取拦截' '/api/special/video?file=config.json' '"ok":false' 403
T '目录穿越拦截'    '/api/special/video?file=..%2F..%2F..%2F..%2FWindows%2Fwin.ini' '"ok":false' 403
T '小图可服务'      '/icon-256.png' 'PNG'
T '环境检测接口'    '/api/env' 'systemPython|portablePython'
foreach ($a in $Assert) {
  $parts = $a -split '\|', 4
  if ($parts.Count -ge 3) {
    $want = 0
    if ($parts.Count -eq 4) { $want = [int]$parts[3] }
    T ('[专项] ' + $parts[0]) $parts[1] $parts[2] $want
  }
  else { Write-Output ('  FAIL 断言格式错误(应为 name|urlPath|regex[|期望状态码]): ' + $a); $script:fail++ }
}
if ($Flow) {
  # 后端契约流程测试(自定义头/ POST 大 body / 事件循环阻塞): 冒烟断言机制做不到的部分
  $flowJs = Join-Path $PSScriptRoot 'backend-flow.js'
  if (Test-Path $flowJs) {
    node $flowJs --port $Port --root $tmp
    if ($LASTEXITCODE -ne 0) { $script:fail++ } else { $script:pass++ }
  } else { Write-Output '  FAIL 缺少 backend-flow.js'; $script:fail++ }
  # 截图助手契约(常驻协议 / UTF-8 往返 / 回退路径): 每次截图起一个 powershell 的冷启动太贵, 改常驻后由这条守住
  # 插件行为断言(标志位卡死/入参/动作名): 假 ctx 跑插件工厂, 静态门禁查不出这类问题
  $pbJs = Join-Path $PSScriptRoot 'plugin-behavior.js'
  if (Test-Path $pbJs) {
    node $pbJs
    if ($LASTEXITCODE -ne 0) { $script:fail++ } else { $script:pass++ }
  } else { Write-Output '  FAIL 缺少 plugin-behavior.js'; $script:fail++ }
  $capJs = Join-Path $PSScriptRoot 'capture-host.js'
  if (Test-Path $capJs) {
    node $capJs --root $tmp
    if ($LASTEXITCODE -ne 0) { $script:fail++ } else { $script:pass++ }
  } else { Write-Output '  FAIL 缺少 capture-host.js'; $script:fail++ }
}
Write-Output ('SMOKE RESULT: pass=' + $script:pass + ' fail=' + $script:fail)

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$still = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($still) { $still | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }
Start-Sleep -Seconds 1
$released = -not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
Write-Output ('port ' + $Port + ' released: ' + $released)
if (-not $KeepTemp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue; Write-Output ('temp cleaned: ' + (-not (Test-Path $tmp))) }
if ($script:fail -gt 0 -or -not $released) { exit 1 } else { exit 0 }
