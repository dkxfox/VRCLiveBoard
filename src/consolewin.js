'use strict';
// 显示/隐藏本进程树的控制台窗口(命令行黑窗)。
// 原理: 子进程 powershell 继承同一控制台, GetConsoleWindow 拿到的是同一个窗口句柄。
const { execFile } = require('child_process');
function setConsoleVisible(visible) {
  const n = visible ? 5 : 0; // SW_SHOW / SW_HIDE
  const ps = '$sig=' + "'" + '[DllImport("user32.dll")] public static extern IntPtr GetConsoleWindow();[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);' + "'" +
    ';$t=Add-Type -MemberDefinition $sig -Name CW -Namespace VLB -PassThru;' +
    '$h=$t::GetConsoleWindow();' +
    'if($h -ne [IntPtr]::Zero){[void]$t::ShowWindow($h,' + n + ')}';
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 8000 }, function () {});
}
module.exports = { setConsoleVisible };
