'use strict';
// 显示/隐藏本进程树的控制台窗口(命令行黑窗)。
// 实测踩过的三个坑(2026-09-11):
//   ① GetConsoleWindow 在 **kernel32.dll**(不是 user32) —— 写错 DLL 抛 EntryPointNotFoundException,
//      而旧代码用空回调吞掉了它: 这个开关"从来没生效过"。
//   ② 子进程必须**共享**父控制台: windowsHide:true 会给子进程 CREATE_NO_WINDOW, 句柄不是父窗口。
//   ③ 父进程本来就没有控制台时(桌面版/管道环境), 子进程会**新建**一个自己的控制台 —— 对它 ShowWindow
//      毫无意义却会返回成功。所以必须校验"这个控制台里有没有父进程", 不能假装成功。
const { execFile } = require('child_process');

// 桌面版(嵌入 Electron)没有独立的命令行窗口, 这个开关在那里没有意义
function supported() { return process.env.VRCB_EMBEDDED !== '1'; }

function setConsoleVisible(visible) {
  return new Promise(function (resolve) {
    if (!supported()) return resolve({ ok: true, skipped: true, note: '桌面版没有独立命令行窗口, 该开关不适用' });
    const n = visible ? 5 : 0; // SW_SHOW / SW_HIDE
    const sig = '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();' +
      '[DllImport("kernel32.dll")] public static extern uint GetConsoleProcessList(uint[] list, uint count);' +
      '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);';
    const ps = '$sig=' + "'" + sig + "'" +
      ';$t=Add-Type -MemberDefinition $sig -Name CW -Namespace VLB -PassThru;' +
      '$h=$t::GetConsoleWindow();' +
      'if($h -eq [IntPtr]::Zero){ Write-Output "NO-CONSOLE"; exit 3 }' +
      '$buf=New-Object uint32[] 64; $n=$t::GetConsoleProcessList($buf,64);' +
      'if($n -le 1 -or ($buf[0..([int]$n-1)] -notcontains [uint32]' + String(process.pid) + ')){ Write-Output "NOT-SHARED"; exit 4 }' +
      '[void]$t::ShowWindow($h,' + n + '); Write-Output "OK"';
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: false, timeout: 8000 }, function (err, stdout) {
      const out = String(stdout || '').trim();
      if (out.indexOf('NOT-SHARED') >= 0) return resolve({ ok: false, error: '该开关只在命令行窗口(启动.bat)里运行时有效' });
      if (out.indexOf('NO-CONSOLE') >= 0) return resolve({ ok: false, error: '当前没有可操作的控制台窗口' });
      if (err) return resolve({ ok: false, error: '控制台窗口操作失败: ' + String(err.message || '').slice(0, 120) });
      if (out.indexOf('OK') < 0) return resolve({ ok: false, error: '控制台窗口操作未返回预期结果' });
      resolve({ ok: true });
    });
  });
}
module.exports = { setConsoleVisible: setConsoleVisible, supported: supported };
