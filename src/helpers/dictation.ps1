<#
  语音听写助手(切片 2, 2026-09-28): 常驻进程, 用 Windows 自带的离线识别(System.Speech / SAPI)做"说话->文字"。
  为什么用 SAPI 而不是 WinRT SpeechRecognizer: PS 5.1 里 WinRT 的 Constraints 集合是裸 __ComObject,
  既没有 Add 也没有 Append(实测), 加不了听写约束; SAPI 的 LoadGrammar(DictationGrammar) 一步到位。
  为什么常驻: PowerShell + 识别引擎冷启动 1~3 秒, 而按一次握拳就要开始听 —— 每次重启太慢。
  为什么不一直听: 只有收到 listen 才开麦克风, stop 立刻关 —— 不做"一直热着"的窃听器。

  命令通道(2026-09-28 修): **追加式命令日志 + 已处理行数**。
    · 旧实现让 Node 反复写同一个文件、助手按"内容变化"执行 —— 单槽通道会**丢命令**
      (握拳/松开/再握拳 挤在一次 80ms 轮询里时, 中间的 stop 会被后一个 listen 盖掉,
       表现就是"只能识别第一句话")。
    · 现在 Node 只往后**追加**一行, 助手记住已处理到第几行, 每次把新增的行**全部**执行。
  与 Node 的输出接口(每行一个 JSON, **UTF-8 字节**直写标准输出):
    status: ready / listening / stopping / idle / bye / error
    text:   { type:'text', text:'...', final:true|false }
#>
param(
  [string]$CommandFile = '',
  [string]$Culture = ''
)
$ErrorActionPreference = 'Continue'

function Emit($obj) {
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

try {
  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if (-not $installed -or $installed.Count -eq 0) { Emit @{ type = 'status'; state = 'error'; error = '系统没有安装任何离线语音识别器(设置 -> 时间和语言 -> 语音)' }; exit 1 }
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

$seen = 0
while ($true) {
  if ($CommandFile -and (Test-Path $CommandFile)) {
    try {
      $lines = @(Get-Content $CommandFile -ErrorAction SilentlyContinue)
      if ($lines.Count -gt $seen) {
        for ($i = $seen; $i -lt $lines.Count; $i++) {
          $cmd = ''
          if ($lines[$i]) { $cmd = ([string]$lines[$i]).Trim() }
          if (-not $cmd) { continue }
          if ($cmd -eq 'quit') { Emit @{ type = 'status'; state = 'bye'; cmd = 'quit' }; try { $engine.Dispose() } catch { }; exit 0 }
          elseif ($cmd -eq 'selftest') { Emit @{ type = 'text'; text = '你好，这是一次听写自检'; final = $true } }
          elseif ($cmd -eq 'listen') {
            try { $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple); Emit @{ type = 'status'; state = 'listening'; cmd = 'listen' } }
            catch { Emit @{ type = 'status'; state = 'error'; error = '开始识别失败: ' + $_.Exception.Message; cmd = 'listen' } }
          } elseif ($cmd -eq 'stop') {
            try { $engine.RecognizeAsyncStop(); Emit @{ type = 'status'; state = 'stopping'; cmd = 'stop' } }
            catch { Emit @{ type = 'status'; state = 'error'; error = '停止识别失败: ' + $_.Exception.Message; cmd = 'stop' } }
          }
        }
        $seen = $lines.Count
      }
    } catch { }
  }
  while ($queue.Count -gt 0) { $item = $queue.Dequeue(); if ($item) { Emit $item } }
  Start-Sleep -Milliseconds 80
}
