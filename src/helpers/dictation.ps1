<#
  语音听写助手(切片 2, 2026-09-28): 常驻进程, 用 Windows 自带的离线语音识别(System.Speech / SAPI)做"说话->文字"。
  为什么用 SAPI 而不是 WinRT SpeechRecognizer: PS 5.1 里 WinRT 的 Constraints 集合是裸 __ComObject,
  既没有 Add 也没有 Append(实测), 加不了听写约束; 而 SAPI 的 LoadGrammar(DictationGrammar) 一步到位,
  本机也确认装好了离线中文识别器(Microsoft Speech Recognizer 8.0 zh-CN)。
  为什么常驻: PowerShell + 识别引擎冷启动要 1~3 秒, 而按一次握拳就要开始听 —— 每次重启太慢;
              常驻后每次只需要 Start/Stop 识别(约 100~300ms)。
  为什么不一直听: 只有收到 listen 命令才开麦克风, stop 立刻关 —— 不做"一直热着"的窃听器。
  与 Node 的接口(刻意做成"文件命令 + 标准输出 JSON 行", 避开 stdin 异步的坑):
    · 命令文件(默认 <程序目录>\logs\dictation.cmd): listen / stop / quit
    · 输出(每行一个 JSON): {"type":"status","state":"ready|listening|idle|error","error":"..."}
                            {"type":"text","text":"最终识别","final":true}
                            {"type":"text","text":"临时识别","final":false}
#>
param(
  [string]$CommandFile = '',
  [string]$Culture = ''
)
$ErrorActionPreference = 'Continue'
function Emit($obj) {
  # 关键(2026-09-28 实测踩坑): 中文必须自己按 UTF-8 写**字节** —— PowerShell 5.1 的 [Console]::Out 用的是
  # 控制台代码页(简中系统上是 GBK/936), 而 Node 按 UTF-8 读, 结果识别出来的中文全变成 � 乱码
  # (用户报的"字库错了"就是这个)。写原始字节可以彻底绕开代码页。
  try {
    $json = ($obj | ConvertTo-Json -Compress)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json + "`n")
    $stdout = [Console]::OpenStandardOutput()
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
  } catch { }
}

try { Add-Type -AssemblyName System.Speech } catch {
  Emit @{ type = 'status'; state = 'error'; error = '加载 System.Speech 失败: ' + $_.Exception.Message }; exit 1
}

# 挑识别器: 指定语言 > 当前系统语言 > 已装的第一个
try {
  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if (-not $installed -or $installed.Count -eq 0) { Emit @{ type = 'status'; state = 'error'; error = '系统没有安装任何离线语音识别器(设置 → 时间和语言 → 语音)' }; exit 1 }
  $info = $null
  if ($Culture) { $info = $installed | Where-Object { $_.Culture.Name -eq $Culture } | Select-Object -First 1 }
  if (-not $info) { $info = $installed | Where-Object { $_.Culture.Name -eq [System.Globalization.CultureInfo]::CurrentCulture.Name } | Select-Object -First 1 }
  if (-not $info) { $info = $installed | Select-Object -First 1 }
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine $info.Culture
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.SetInputToDefaultAudioDevice()
} catch {
  Emit @{ type = 'status'; state = 'error'; error = '识别引擎初始化失败: ' + $_.Exception.Message }; exit 1
}

# 事件回调在别的 runspace 里跑, 直接写 stdout 拿不到 —— 用同步队列转交给主循环
$queue = [System.Collections.Queue]::Synchronized((New-Object System.Collections.Queue))
$null = Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -Action {
  try {
    $r = $Event.SourceEventArgs.Result
    if ($r -and $r.Text) { $Event.MessageData.Enqueue(@{ type = 'text'; text = $r.Text; final = $true; confidence = [math]::Round($r.Confidence, 3) }) }
  } catch { }
} -MessageData $queue
$null = Register-ObjectEvent -InputObject $engine -EventName SpeechHypothesized -Action {
  try {
    $r = $Event.SourceEventArgs.Result
    if ($r -and $r.Text) { $Event.MessageData.Enqueue(@{ type = 'text'; text = $r.Text; final = $false }) }
  } catch { }
} -MessageData $queue
$null = Register-ObjectEvent -InputObject $engine -EventName RecognizeCompleted -Action {
  try { $Event.MessageData.Enqueue(@{ type = 'status'; state = 'idle' }) } catch { }
} -MessageData $queue

Emit @{ type = 'status'; state = 'ready'; recognizer = $info.Name; culture = $info.Culture.Name; commandFile = $CommandFile }

$lastCmd = ''
while ($true) {
  if ($CommandFile -and (Test-Path $CommandFile)) {
    try {
      $cmd = (Get-Content $CommandFile -Raw -ErrorAction SilentlyContinue)
      if ($cmd) { $cmd = $cmd.Trim() }
      if ($cmd -and $cmd -ne $lastCmd) {
        $lastCmd = $cmd
        if ($cmd -eq 'quit') { Emit @{ type = 'status'; state = 'bye' }; break }
        elseif ($cmd -eq 'selftest') { Emit @{ type = 'text'; text = '你好，这是一次听写自检'; final = $true }; Emit @{ type = 'text'; text = '繁体字也测一下: 測試'; final = $true } }
        elseif ($cmd -eq 'listen') {
          try { $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple); Emit @{ type = 'status'; state = 'listening' } }
          catch { Emit @{ type = 'status'; state = 'error'; error = '开始识别失败: ' + $_.Exception.Message } }
        } elseif ($cmd -eq 'stop') {
          try { $engine.RecognizeAsyncStop(); Emit @{ type = 'status'; state = 'stopping' } }
          catch { Emit @{ type = 'status'; state = 'error'; error = '停止识别失败: ' + $_.Exception.Message } }
        }
      }
    } catch { }
  }
  while ($queue.Count -gt 0) { $item = $queue.Dequeue(); if ($item) { Emit $item } }
  Start-Sleep -Milliseconds 80
}
try { $engine.Dispose() } catch { }
