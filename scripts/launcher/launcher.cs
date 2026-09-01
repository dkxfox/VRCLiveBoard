// VRCLiveBoard 桌面版启动器(代号 星光)v1.3.0
// 用系统默认方式打开与本程序同目录的「启动桌面版.bat」(按本程序自身所在目录解析, 不受当前工作目录影响)。
// 编译: 同目录 build.bat(使用 Windows 自带 .NET Framework csc, 无需安装任何工具)。
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

[assembly: AssemblyTitle("VRCLiveBoard 启动器")]
[assembly: AssemblyProduct("VRCLiveBoard")]
[assembly: AssemblyCompany("DKXfox")]
[assembly: AssemblyDescription("VRCLiveBoard 桌面版启动器(代号 星光)")]
[assembly: AssemblyVersion("1.3.0.0")]
[assembly: AssemblyFileVersion("1.3.0.0")]

class Program
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    [STAThread]
    static int Main()
    {
        try
        {
            string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string bat = Path.Combine(dir, "启动桌面版.bat");
            if (!File.Exists(bat))
            {
                MessageBoxW(IntPtr.Zero,
                    "没找到同目录下的「启动桌面版.bat」。\r\n请把本程序放到 VRCLiveBoard 根目录(与 启动桌面版.bat 在一起)后运行。",
                    "VRCLiveBoard 启动器", 0x10);
                return 1;
            }
            Process.Start(new ProcessStartInfo(bat) { UseShellExecute = true, WorkingDirectory = dir });
            return 0;
        }
        catch (Exception e)
        {
            try { MessageBoxW(IntPtr.Zero, "启动失败: " + e.Message, "VRCLiveBoard 启动器", 0x10); } catch { }
            return 1;
        }
    }
}
