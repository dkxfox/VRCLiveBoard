# 输入法候选窗探针(F-20260929-02 路线 2 可行性验证) —— 用 UI Automation 看候选窗里有什么
# 为什么用 PowerShell 而不是 C#: csc 解析不了 GAC 里的 UIAutomationClient(CS0006), 而 PowerShell 能直接 Add-Type。
# 用法: powershell -File scripts\dev\ime-probe.ps1 [-Seconds 60]
param([int]$Seconds = 60, [int]$DelayMs = 300, [switch]$All)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$TS_Children = [System.Windows.Automation.TreeScope]::Children
$TS_Desc = [System.Windows.Automation.TreeScope]::Descendants
$anyCond = [System.Windows.Automation.Condition]::TrueCondition
Write-Host "[探针] 观察 $Seconds 秒, 每 $DelayMs ms 一次 —— 请现在切到任意输入框打拼音(例如 nihao)"
$seen = New-Object 'System.Collections.Generic.HashSet[string]'
$last = ''
$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
  $sb = New-Object Text.StringBuilder
  try {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    foreach ($w in $root.FindAll($TS_Children, $anyCond)) {
      $cls = ''; $nm = ''; $pid2 = 0
      try { $cls = $w.Current.ClassName } catch {}
      try { $nm = $w.Current.Name } catch {}
      try { $pid2 = $w.Current.ProcessId } catch {}
      $pname = ''
      try { $pname = (Get-Process -Id $pid2 -ErrorAction Stop).ProcessName } catch {}
      $hit = ($cls -match 'IME|Candidate|TextInput|InputApp') -or ($pname -match 'TextInputHost|Sogou|QQPinyin|ChsIME|ctfmon')
      if (-not $hit -and -not $All) { continue }
      $sig = "$cls|$pname|$nm|$pid2"
      if (-not $seen.Add($sig)) { continue }   # 只报新窗口
      Write-Host ("[新窗口] " + $cls + " | " + $pname + " (pid " + $pid2 + ") | " + $nm)
      [void]$sb.AppendLine("窗口: $cls | pid=$pid2($pname) | $nm")
      $n = 0
      foreach ($k in $w.FindAll($TS_Desc, $anyCond)) {
        $kn = ''
        try { $kn = $k.Current.Name } catch {}
        if (-not $kn) { continue }
        if ($kn.Length -gt 24) { continue }
        if ($kn -notmatch '[\u4e00-\u9fff\u3040-\u30ff]') { continue }
        $kc = ''; try { $kc = $k.Current.ControlType.ProgrammaticName } catch {}
        [void]$sb.AppendLine("    候选?: $kc | $kn")
        if (++$n -ge 30) { break }
      }
      if ($n -eq 0) { [void]$sb.AppendLine('    (没有中文文本节点)') }
    }
  } catch { [void]$sb.AppendLine('异常: ' + $_.Exception.Message) }
  $now = $sb.ToString()
  if ($now -ne $last -and $now.Trim().Length -gt 0) { Write-Host ('---- ' + (Get-Date -Format HH:mm:ss) + ' ----'); Write-Host $now; $last = $now }
  Start-Sleep -Milliseconds $DelayMs
}
Write-Host '[探针] 结束'
