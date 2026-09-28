// VR 覆盖层键盘(F-20260925-02 P1, 2026-09-29) —— 独立原生工具, 不进主体包。
// 为什么是独立工具: 主体是 Node/Electron, 拿不到 OpenVR 原生能力(见功能卡 D1 决策树)。
// 技术选型: C# + Windows 自带 csc.exe(与 scripts/launcher 同一套, 零工具链) + P/Invoke openvr_api.dll(SteamVR 自带)。
// 显示: GDI+ 离屏位图 -> **BGRA 原始缓冲**(SetOverlayRaw, 主路径) / PNG 文件(SetOverlayFromFile, 兜底)。
// 交互: 覆盖层鼠标事件(射线 + 扳机); 事件坐标是 GL 空间(左下角原点), 命中前要翻 Y。
// 输出: 文本直接 POST 给主程序既有的 /v1/chatbox。
// 日志: 每一步都写 <工程根>\\logs\\vrkeyboard.log(排障用; 没有日志就等于瞎猜)。
//
// 用法:
//   vrkeyboard.exe --selftest                 无 VR 自检(渲染 + 命中 + 打字 + 发送路径)
//   vrkeyboard.exe --render [--out x.png]     只渲染一张面板图
//   vrkeyboard.exe --run [--fixed]            真跑覆盖层(默认贴在头显前方, 跟着你看)
//   vrkeyboard.exe --diag                     起覆盖层并只报诊断 15 秒(排障用)
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class VRKeyboard
{
    const int W = 1024, H = 640;
    const int EvMouseMove = 300, EvMouseDown = 301, EvMouseUp = 302;
    const int AppTypeOverlay = 2;
    const uint FlagInteractive = 1u << 16;
    const int UniverseStanding = 1;
    const int InputMethodMouse = 1;
    const uint MouseLeft = 1;
    const uint HmdDeviceIndex = 0;   // OpenVR: 0 号设备是头显

    static readonly string OverlayKey = "vrcliveboard.keyboard";
    static readonly string OverlayName = "VRCLiveBoard 键盘";
    static string LogPath = null;
    static readonly object LogLock = new object();

    static void Log(string msg)
    {
        string line = DateTime.Now.ToString("HH:mm:ss.fff") + "  " + msg;
        Console.WriteLine(line);
        try
        {
            if (LogPath == null) LogPath = ResolveLogPath();
            lock (LogLock) File.AppendAllText(LogPath, line + Environment.NewLine, Encoding.UTF8);
        }
        catch (Exception) { }
    }

    static string ResolveLogPath()
    {
        try
        {
            DirectoryInfo d = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            for (int i = 0; i < 6 && d != null; i++)
            {
                if (File.Exists(Path.Combine(d.FullName, "config.default.json")) || File.Exists(Path.Combine(d.FullName, "src", "main.js")))
                {
                    string dir = Path.Combine(d.FullName, "logs");
                    Directory.CreateDirectory(dir);
                    return Path.Combine(dir, "vrkeyboard.log");
                }
                d = d.Parent;
            }
        }
        catch (Exception) { }
        return Path.Combine(Path.GetTempPath(), "vrkeyboard.log");
    }

    // ---------- 布局 ----------
    class Key
    {
        public string Label;
        public string Value;
        public RectangleF Rect;
        public bool Special;
    }

    static List<Key> Keys = new List<Key>();
    static string Line = "";
    static string Status = "点字母打字, 回车发送";
    static string LastSent = null;
    static bool DryRun = false;
    static bool Shown = false;            // 是否已显示(默认隐藏: 显示即可交互会一直吸着控制器激光, 游戏就收不到输入)
    static int CtlPort = 19192;
    static int ClickCount2 = 0;
    static int EvCount2 = 0;
    static bool DumpedEvents = false;
    static Key HoverKey = null;
    static float HoverX = 0, HoverY = 0;
    static int MoveLogged = 0;
    static int HoverLogged = 0;
    static IntPtr OvRef = IntPtr.Zero;
    static ulong HandleRef = 0;
    static ShowOverlayFn ShowRef = null;
    static HideOverlayFn HideRef = null;
    static SetOverlayFlagFn FlagRef = null;

    static void BuildLayout()
    {
        Keys.Clear();
        string[] rows = new string[] { "qwertyuiop", "asdfghjkl", "zxcvbnm" };
        float gap = 10f, keyH = 92f, top = 150f;
        for (int r = 0; r < rows.Length; r++)
        {
            string row = rows[r];
            float keyW = 88f;
            float totalW = row.Length * keyW + (row.Length - 1) * gap;
            float x = (W - totalW) / 2f;
            float y = top + r * (keyH + gap);
            for (int i = 0; i < row.Length; i++)
            {
                Key k = new Key();
                k.Label = row[i].ToString().ToUpper();
                k.Value = row[i].ToString();
                k.Rect = new RectangleF(x, y, keyW, keyH);
                Keys.Add(k);
                x += keyW + gap;
            }
        }
        float by = top + 3 * (keyH + gap);
        float bw = 200f, bx = 18f;
        string[] bottom = new string[] { "空格|space", "退格|back", "清空|clear", "发送|enter" };
        for (int i = 0; i < bottom.Length; i++)
        {
            string[] parts = bottom[i].Split('|');
            Key k = new Key();
            k.Label = parts[0];
            k.Value = parts[1];
            k.Special = true;
            k.Rect = new RectangleF(bx, by, bw, keyH);
            Keys.Add(k);
            bx += bw + gap;
        }
    }

    // ---------- 渲染 ----------
    static Bitmap Render()
    {
        Bitmap bmp = new Bitmap(W, H, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            using (SolidBrush b = new SolidBrush(Color.FromArgb(255, 26, 30, 42)))
                g.FillRectangle(b, new Rectangle(0, 0, W, H));
            using (Font f = new Font("Microsoft YaHei UI", 30f, FontStyle.Bold))
            using (SolidBrush b = new SolidBrush(Color.FromArgb(255, 235, 238, 245)))
                g.DrawString("VRCLiveBoard 键盘", f, b, 20f, 28f);
            RectangleF lineRect = new RectangleF(18f, 78f, W - 36f, 52f);
            using (SolidBrush b = new SolidBrush(Color.FromArgb(255, 12, 14, 20)))
                g.FillRectangle(b, lineRect);
            using (Pen p = new Pen(Color.FromArgb(255, 70, 120, 220), 2f))
                g.DrawRectangle(p, lineRect.X, lineRect.Y, lineRect.Width, lineRect.Height);
            using (Font f = new Font("Microsoft YaHei UI", 24f))
            using (SolidBrush b = new SolidBrush(Color.FromArgb(255, 240, 244, 252)))
                g.DrawString(Line.Length == 0 ? "(点字母开始打字)" : Line, f, b, lineRect.X + 12f, lineRect.Y + 8f);
            foreach (Key k in Keys)
            {
                bool hovered = (HoverKey != null && HoverKey.Value == k.Value);
                using (SolidBrush b = new SolidBrush(hovered ? Color.FromArgb(255, 96, 132, 200) : (k.Special ? Color.FromArgb(255, 44, 58, 88) : Color.FromArgb(255, 38, 44, 60))))
                    g.FillRectangle(b, k.Rect);
                using (Pen p = new Pen(Color.FromArgb(255, 92, 104, 132), 2f))
                    g.DrawRectangle(p, k.Rect.X, k.Rect.Y, k.Rect.Width, k.Rect.Height);
                using (Font f = new Font("Microsoft YaHei UI", k.Special ? 20f : 30f, FontStyle.Bold))
                using (SolidBrush b = new SolidBrush(Color.FromArgb(255, 232, 236, 246)))
                {
                    SizeF sz = g.MeasureString(k.Label, f);
                    g.DrawString(k.Label, f, b, k.Rect.X + (k.Rect.Width - sz.Width) / 2f, k.Rect.Y + (k.Rect.Height - sz.Height) / 2f);
                }
            }
            using (Font f = new Font("Microsoft YaHei UI", 18f))
            using (SolidBrush b = new SolidBrush(Color.FromArgb(255, 150, 200, 160)))
                g.DrawString(Status + "   [指针 " + HoverX.ToString("0.###") + "," + HoverY.ToString("0.###") + (HoverKey == null ? "" : (" -> " + HoverKey.Label)) + "]", f, b, 20f, H - 44f);
        }
        return bmp;
    }

    // 命中测试: 先判断拿到的是 UV(0~1) 还是像素, 再翻 Y(GL 空间原点在左下角)
    static Key Hit(float ax, float ay)
    {
        float u, v;
        if (Math.Abs(ax) <= 1.5f && Math.Abs(ay) <= 1.5f) { u = ax; v = ay; }
        else { u = ax / W; v = ay / H; }
        float px = u * W;
        float py = (1f - v) * H;
        if (px < 0 || py < 0 || px > W || py > H) return null;
        foreach (Key k in Keys)
            if (px >= k.Rect.X && px <= k.Rect.Right && py >= k.Rect.Y && py <= k.Rect.Bottom) return k;
        return null;
    }
    static void PressKey(Key k, string url)
    {
        if (k == null) return;
        if (!k.Special)
        {
            if (Line.Length < 140) Line += k.Value;
            Status = "输入中: " + Line.Length + " 字";
            return;
        }
        if (k.Value == "space") { if (Line.Length < 140) Line += " "; }
        else if (k.Value == "back") { if (Line.Length > 0) Line = Line.Substring(0, Line.Length - 1); }
        else if (k.Value == "clear") { Line = ""; Status = "已清空"; }
        else if (k.Value == "enter")
        {
            string text = Line.Trim();
            if (text.Length == 0) { Status = "还没打字"; return; }
            bool ok = SendChatbox(text, url);
            if (ok) { Status = "已发送: " + text; Line = ""; }
            else Status = "发送失败(主程序没在跑?)";
        }
    }

    static bool SendChatbox(string text, string url)
    {
        LastSent = text;
        if (DryRun) return true;
        try
        {
            byte[] body = Encoding.UTF8.GetBytes("{\"text\":\"" + JsonEscape(text) + "\",\"priority\":80}");
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "POST";
            req.ContentType = "application/json";
            req.ContentLength = body.Length;
            req.Timeout = 3000;
            using (Stream s = req.GetRequestStream()) s.Write(body, 0, body.Length);
            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                return (int)resp.StatusCode >= 200 && (int)resp.StatusCode < 300;
        }
        catch (Exception e) { Log("[发送] 失败: " + e.Message); return false; }
    }

    static string JsonEscape(string s)
    {
        StringBuilder sb = new StringBuilder();
        foreach (char c in s)
        {
            if (c == '"') sb.Append("\\\"");
            else if (c == '\\') sb.Append("\\\\");
            else if (c == '\n') sb.Append("\\n");
            else if (c == '\r') sb.Append("\\r");
            else if (c == '\t') sb.Append("\\t");
            else if (c < 32) sb.Append(" ");
            else sb.Append(c);
        }
        return sb.ToString();
    }

    // ---------- OpenVR ----------
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)] static extern IntPtr VR_InitInternal(ref int peError, int eApplicationType);
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)] static extern void VR_ShutdownInternal();
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)] static extern bool VR_IsRuntimeInstalled();
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)] static extern bool VR_IsHmdPresent();
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)] static extern IntPtr VR_GetStringForHmdError(int eError);
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)] static extern IntPtr VR_GetGenericInterface(string pchInterfaceVersion, ref int peError);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetDllDirectory(string lpPathName);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int CreateOverlayFn(IntPtr self, string key, string name, out ulong handle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int DestroyOverlayFn(IntPtr self, ulong handle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetOverlayFlagFn(IntPtr self, ulong handle, int flag, bool enabled);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetOverlayWidthInMetersFn(IntPtr self, ulong handle, float meters);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetOverlayTransformAbsoluteFn(IntPtr self, ulong handle, int origin, ref HmdMatrix34_t m);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetOverlayTransformHeadFn(IntPtr self, ulong handle, uint device, ref HmdMatrix34_t m);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int ShowOverlayFn(IntPtr self, ulong handle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int HideOverlayFn(IntPtr self, ulong handle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int IsOverlayVisibleFn(IntPtr self, ulong handle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int PollNextOverlayEventFn(IntPtr self, ulong handle, ref VREvent_t ev, uint size);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetOverlayInputMethodFn(IntPtr self, ulong handle, int method);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetOverlayMouseScaleFn(IntPtr self, ulong handle, float x, float y);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetOverlayFromFileFn(IntPtr self, ulong handle, string path);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetOverlayRawFn(IntPtr self, ulong handle, IntPtr buffer, uint width, uint height, uint depth);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetOverlayAlphaFn(IntPtr self, ulong handle, float alpha);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetOverlaySortOrderFn(IntPtr self, ulong handle, uint order);

    [StructLayout(LayoutKind.Sequential)]
    struct HmdMatrix34_t { public float m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11; }

    [StructLayout(LayoutKind.Explicit, Size = 64)]
    struct VREvent_t
    {
        [FieldOffset(0)] public int eventType;
        [FieldOffset(4)] public uint trackedDeviceIndex;
        [FieldOffset(8)] public float eventAgeSeconds;
        [FieldOffset(16)] public float mouseX;
        [FieldOffset(20)] public float mouseY;
        [FieldOffset(24)] public uint mouseButton;
    }

    static T Vt<T>(IntPtr obj, int index)
    {
        IntPtr vtable = Marshal.ReadIntPtr(obj);
        IntPtr fn = Marshal.ReadIntPtr(vtable, index * IntPtr.Size);
        return (T)(object)Marshal.GetDelegateForFunctionPointer(fn, typeof(T));
    }

    static string FindOpenVr(string explicitPath)
    {
        if (explicitPath != null && File.Exists(explicitPath)) return explicitPath;
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string tail = Path.Combine("steamapps", "common", "SteamVR", "bin", "win64", "openvr_api.dll");
        string[] cands = new string[] {
            Path.Combine(pf86, "Steam", tail), Path.Combine(pf, "Steam", tail),
            "D:" + Path.DirectorySeparatorChar + "Steam" + Path.DirectorySeparatorChar + tail,
            "D:" + Path.DirectorySeparatorChar + "SteamLibrary" + Path.DirectorySeparatorChar + tail,
            "E:" + Path.DirectorySeparatorChar + "SteamLibrary" + Path.DirectorySeparatorChar + tail
        };
        foreach (string c in cands) if (File.Exists(c)) return c;
        return null;
    }

    static string TempPng(int n) { return Path.Combine(Path.GetTempPath(), "vrcb-vrkeyboard-" + n + ".png"); }

    // 把 Bitmap 的 BGRA 像素直接推给覆盖层(比走 PNG 文件更少环节)
    static int PushRaw(IntPtr ov, ulong handle, Bitmap bmp, SetOverlayRawFn fn)
    {
        BitmapData bd = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try { return fn(ov, handle, bd.Scan0, (uint)bmp.Width, (uint)bmp.Height, 4u); }
        finally { bmp.UnlockBits(bd); }
    }

    // ---------- 自检(不需要 VR) ----------
    static int SelfTest()
    {
        int fail = 0;
        BuildLayout();
        Log("[自检] 键位 " + Keys.Count + " 个");
        if (Keys.Count != 30) { Log("  FAIL 键位数应为 30, 实得 " + Keys.Count); fail++; }
        Bitmap bmp = Render();
        string png = TempPng(9);
        bmp.Save(png, ImageFormat.Png);
        FileInfo fi = new FileInfo(png);
        Log("[自检] 渲染 PNG " + png + " (" + (fi.Length / 1024) + "KB)");
        if (fi.Length < 5000) { Log("  FAIL 渲染结果太小, 可能是空图"); fail++; }
        int miss = 0;
        foreach (Key k in Keys)
        {
            float u = (k.Rect.X + k.Rect.Width / 2f) / W;
            float v = 1f - ((k.Rect.Y + k.Rect.Height / 2f) / H);
            Key hit = Hit(u, v);
            if (hit == null || hit.Value != k.Value) miss++;
        }
        if (miss == 0) Log("  PASS 命中测试: 全部 " + Keys.Count + " 个键的中心都能命中自己");
        else { Log("  FAIL 命中测试: " + miss + " 个键没命中自己"); fail++; }
        DryRun = true;
        Line = "";
        foreach (char c in "nihao") foreach (Key k in Keys) if (k.Value == c.ToString()) { PressKey(k, "x"); break; }
        if (Line == "nihao") Log("  PASS 打字: -> '" + Line + "'");
        else { Log("  FAIL 打字: 实得 '" + Line + "'"); fail++; }
        foreach (Key k in Keys) if (k.Value == "back") { PressKey(k, "x"); break; }
        if (Line == "niha") Log("  PASS 退格: -> '" + Line + "'");
        else { Log("  FAIL 退格: 实得 '" + Line + "'"); fail++; }
        foreach (Key k in Keys) if (k.Value == "enter") { PressKey(k, "x"); break; }
        if (LastSent == "niha" && Line == "") Log("  PASS 发送路径: 收到 '" + LastSent + "' 且输入行已清空");
        else { Log("  FAIL 发送路径: LastSent='" + LastSent + "'"); fail++; }
        LastSent = null;
        foreach (Key k in Keys) if (k.Value == "enter") { PressKey(k, "x"); break; }
        if (LastSent == null) Log("  PASS 空输入不发送");
        else { Log("  FAIL 空输入竟然发送了"); fail++; }
        Log(fail == 0 ? "[自检] 全部通过" : ("[自检] " + fail + " 项失败"));
        return fail == 0 ? 0 : 1;
    }

    // ---------- 真跑 ----------
    static int RunOverlay(string url, string dll, float meters, float dist, float height, bool fixedPos, int diagSeconds, bool showAtStart, int ctlPort)
    {
        Log("=== vrkeyboard 启动 === 参数: url=" + url + " meters=" + meters + " dist=" + dist + " height=" + height + " 模式=" + (fixedPos ? "绝对位置(固定)" : "跟随头显") + (diagSeconds > 0 ? (" 诊断 " + diagSeconds + "s") : ""));
        Log("日志文件: " + (LogPath != null ? LogPath : ResolveLogPath()));
        string dllPath = FindOpenVr(dll);
        if (dllPath == null)
        {
            Log("[错误] 找不到 openvr_api.dll —— 装 SteamVR 后它一般在 SteamVR 安装目录的 bin/win64 下; 也可以用 --dll 指定");
            Console.Error.WriteLine("[错误] 找不到 openvr_api.dll");
            return 2;
        }
        Log("[信息] openvr_api.dll = " + dllPath);
        SetDllDirectory(Path.GetDirectoryName(dllPath));
        // 等待 SteamVR / 头显就绪(启动顺序不该由用户来记)
        int waited = 0;
        while (waited < 90000)
        {
            if (VR_IsRuntimeInstalled()) { if (VR_IsHmdPresent()) break; }
            if (waited % 10000 == 0) Log("[等待] SteamVR 运行时/HMD 尚未就绪(" + (waited / 1000) + "s)… 请确认 SteamVR 已经在运行");
            Thread.Sleep(1000); waited += 1000;
        }
        if (!VR_IsRuntimeInstalled()) { Log("[错误] 等了 " + (waited / 1000) + "s 仍找不到 SteamVR 运行时(SteamVR 没装?)"); return 2; }
        if (!VR_IsHmdPresent()) { Log("[错误] 等了 " + (waited / 1000) + "s 仍检测不到头显 —— 先把 SteamVR 跑起来(头显要显示画面)再启动本工具"); return 2; }
        Log("[信息] SteamVR 就绪(等待 " + (waited / 1000) + "s)");
        ulong handle = 0;
        IntPtr ov = IntPtr.Zero;
        try
        {
        int err = 0;
        Log("[步骤] VR_InitInternal(AppType=Overlay)…");
        IntPtr ctx = VR_InitInternal(ref err, AppTypeOverlay);
        if (err != 0 || ctx == IntPtr.Zero)
        {
            Log("[错误] VR_Init 失败(" + err + "): " + Marshal.PtrToStringAnsi(VR_GetStringForHmdError(err)));
            return 2;
        }
        Log("[信息] VR_Init OK");
        Log("[步骤] 取 IVROverlay 接口指针…");
        // 注意: openvr_api.dll **不导出** VROverlay() —— 那只是官方头文件里的 inline 辅助函数,
        // 它内部就是调 VR_GetGenericInterface("IVROverlay_0xx")。所以这里直接按版本号取。
        string usedVer = null;
        string[] versions = new string[] { "IVROverlay_028", "IVROverlay_027", "IVROverlay_026" };
        foreach (string ver in versions)
        {
            int ge = 0;
            IntPtr cand = VR_GetGenericInterface(ver, ref ge);
            Log("[步骤] VR_GetGenericInterface(" + ver + ") = 0x" + cand.ToInt64().ToString("X") + " err=" + ge);
            if (cand != IntPtr.Zero && ge == 0) { ov = cand; usedVer = ver; break; }
        }
        if (ov != IntPtr.Zero) Log("[信息] 接口版本 " + usedVer + "(vtable 下标按官方 master 头文件=028 排的, 版本不符就可能调错函数)");
        else Log("[警告] 只接受 028(其它版本的 vtable 布局不同, 用错下标会调错函数)");
                if (ov == IntPtr.Zero) { Log("[错误] 拿不到 IVROverlay 接口指针(SteamVR 运行时没就绪?) —— 到此为止"); VR_ShutdownInternal(); return 2; }
        CreateOverlayFn create = Vt<CreateOverlayFn>(ov, 1);
        Log("[步骤] 调用 CreateOverlay(" + OverlayKey + ")…");
        int e = create(ov, OverlayKey, OverlayName, out handle);
        Log("[信息] CreateOverlay -> " + e + (e == 0 ? "" : " (非 0 即失败)") + ", handle=" + handle);
        if (e != 0) { VR_ShutdownInternal(); return 2; }
        {
            Log("[信息] SetOverlayFlag(可交互) -> " + Vt<SetOverlayFlagFn>(ov, 11)(ov, handle, (int)FlagInteractive, true));
            Log("[信息] SetOverlayAlpha -> " + Vt<SetOverlayAlphaFn>(ov, 16)(ov, handle, 1f));
            Log("[信息] SetOverlaySortOrder -> " + Vt<SetOverlaySortOrderFn>(ov, 20)(ov, handle, 1u));
            Log("[信息] SetOverlayWidthInMeters(" + meters + ") -> " + Vt<SetOverlayWidthInMetersFn>(ov, 22)(ov, handle, meters));
            Log("[信息] SetOverlayInputMethod(Mouse) -> " + Vt<SetOverlayInputMethodFn>(ov, 50)(ov, handle, InputMethodMouse));
            Log("[信息] SetOverlayMouseScale(1,1 -> 事件坐标用 UV) -> " + Vt<SetOverlayMouseScaleFn>(ov, 52)(ov, handle, 1f, 1f));
            HmdMatrix34_t m = new HmdMatrix34_t();
            m.m0 = 1f; m.m5 = 1f; m.m10 = 1f;
            if (fixedPos)
            {
                m.m3 = 0f; m.m7 = height; m.m11 = -dist;
                Log("[信息] 绝对位置(站立空间) 前方 " + dist + "m, 高 " + height + "m -> " + Vt<SetOverlayTransformAbsoluteFn>(ov, 33)(ov, handle, UniverseStanding, ref m));
            }
            else
            {
                m.m3 = 0f; m.m7 = -0.22f; m.m11 = -Math.Max(0.4f, dist);
                Log("[信息] 跟随头显: 眼前 " + Math.Max(0.4f, dist) + "m / 下方 0.22m -> " + Vt<SetOverlayTransformHeadFn>(ov, 35)(ov, handle, HmdDeviceIndex, ref m));
            }
            ShowOverlayFn show = Vt<ShowOverlayFn>(ov, 43);
            HideOverlayFn hide = Vt<HideOverlayFn>(ov, 44);
            FlagRef = Vt<SetOverlayFlagFn>(ov, 11);
            ShowRef = show; HideRef = hide; OvRef = ov; HandleRef = handle;
            if (showAtStart) { DoShow(); }
            else { DoHide(); Log("[信息] 默认**隐藏**(避免一直吸着控制器激光让游戏收不到输入); 用 --toggle / 控制口 或 --show-at-start 显示"); }
            if (ctlPort > 0) StartControl(ctlPort);
            // 先把事件字段原样打几条出来(排障: 鼠标事件的坐标/按钮到底在哪个偏移)
            SetOverlayRawFn setRaw = Vt<SetOverlayRawFn>(ov, 62);
            SetOverlayFromFileFn setFile = Vt<SetOverlayFromFileFn>(ov, 63);
            IsOverlayVisibleFn isVisible = Vt<IsOverlayVisibleFn>(ov, 45);
            PollNextOverlayEventFn poll = Vt<PollNextOverlayEventFn>(ov, 48);
            int dumped = 0;
            int frame = 0, rawErr = 0, evCount = 0, clickCount = 0;
            bool dirty = true;
            DateTime lastBeat = DateTime.Now;
            DateTime start = DateTime.Now;
            while (true)
            {
                if (dirty)
                {
                    Bitmap bmp = Render();
                    int re = PushRaw(ov, handle, bmp, setRaw);
                    rawErr = re;
                    if (re != 0)
                    {
                        string f = TempPng(frame % 2);
                        bmp.Save(f, ImageFormat.Png);
                        int fe = setFile(ov, handle, f);
                        if (frame < 3) Log("[信息] SetOverlayRaw -> " + re + " (失败), 改用 PNG 文件 -> " + fe + " : " + f);
                    }
                    frame++;
                    dirty = false;
                }
                VREvent_t ev = new VREvent_t();
                if (poll(ov, handle, ref ev, 64u) != 0)
                {
                    evCount++;
                    if (dumped < 6)
                    {
                        dumped++;
                        Log("[事件样本] type=" + ev.eventType + " device=" + ev.trackedDeviceIndex + " x=" + ev.mouseX + " y=" + ev.mouseY + " button=" + ev.mouseButton);
                    }
                    EvCount2 = evCount;
                    if (ev.eventType == EvMouseMove)
                    {
                        Key hk = Hit(ev.mouseX, ev.mouseY);
                        if (MoveLogged < 8)
                        {
                            MoveLogged++;
                            Log("[移动样本] 原始=(" + ev.mouseX.ToString("0.####") + "," + ev.mouseY.ToString("0.####") + ") -> " + (hk == null ? "面板外" : hk.Label));
                        }
                        if (hk != HoverKey) { HoverKey = hk; dirty = true; HoverLogged++; if (HoverLogged <= 25) Log("[悬停] -> " + (hk == null ? "面板外" : hk.Label) + "  原始=(" + ev.mouseX.ToString("0.####") + "," + ev.mouseY.ToString("0.####") + ")"); }
                        HoverX = ev.mouseX; HoverY = ev.mouseY;
                    }
                    else if (ev.eventType == EvMouseDown || ev.eventType == EvMouseUp)
                    {
                        Key k = Hit(ev.mouseX, ev.mouseY);
                        Log("[输入] " + (ev.eventType == EvMouseDown ? "按下" : "松开") + " 原始=(" + ev.mouseX.ToString("0.####") + "," + ev.mouseY.ToString("0.####") + ") button=" + ev.mouseButton + " -> " + (k == null ? "没命中任何键" : k.Label));
                        if (ev.eventType == EvMouseDown && k != null) { clickCount++; PressKey(k, url); dirty = true; }
                    }
                }
                else Thread.Sleep(15);
                if ((DateTime.Now - lastBeat).TotalSeconds >= 5)
                {
                    lastBeat = DateTime.Now;
                    Log("[心跳] 帧=" + frame + " 可见=" + isVisible(ov, handle) + " 原始推送返回=" + rawErr + " 事件=" + evCount + " 点击=" + clickCount + " 输入行='" + Line + "'");
                }
                if (diagSeconds > 0 && (DateTime.Now - start).TotalSeconds >= diagSeconds)
                {
                    Log("[诊断] 时间到, 退出(帧=" + frame + " 事件=" + evCount + " 可见=" + isVisible(ov, handle) + ")");
                    break;
                }
            }
        }
        // (旧 catch 已合并到下面那个带堆栈的)
        }
        catch (Exception ex)
        {
            Log("[异常] " + ex.GetType().FullName + " :: " + ex.Message);
            Log("[异常] 堆栈: " + (ex.StackTrace == null ? "(无)" : ex.StackTrace.Replace(Environment.NewLine, " | ")));
            try { VR_ShutdownInternal(); } catch (Exception) { }
            Log("=== 异常退出 ===");
            return 3;
        }
        finally
        {
            try { if (handle != 0) Vt<DestroyOverlayFn>(ov, 3)(ov, handle); } catch (Exception) { }
            try { VR_ShutdownInternal(); } catch (Exception) { }
            Log("=== 已退出 ===");
        }
        return 0;
    }


    // ---------- 控制口 + 显示/隐藏(默认隐藏: 显示即可交互会一直吸着控制器激光 -> 游戏收不到输入 = 用户遇到的 AFK) ----------
    static void DoShow()
    {
        if (OvRef == IntPtr.Zero || HandleRef == 0) return;
        if (FlagRef != null) FlagRef(OvRef, HandleRef, (int)FlagInteractive, true);
        if (ShowRef != null) ShowRef(OvRef, HandleRef);
        Shown = true;
        Status = "键盘已显示: 点字母, 回车发送";
        Log("[控制] 显示键盘(已开可交互)");
    }

    static void DoHide()
    {
        if (OvRef == IntPtr.Zero || HandleRef == 0) return;
        if (FlagRef != null) FlagRef(OvRef, HandleRef, (int)FlagInteractive, false);
        if (HideRef != null) HideRef(OvRef, HandleRef);
        Shown = false;
        Status = "键盘已隐藏";
        Log("[控制] 隐藏键盘(已关可交互, 控制器交还游戏)");
    }

    static void StartControl(int port)
    {
        try
        {
            System.Net.HttpListener l = new System.Net.HttpListener();
            l.Prefixes.Add("http://127.0.0.1:" + port + "/");
            l.Start();
            Thread th = new Thread(delegate()
            {
                while (true)
                {
                    try
                    {
                        System.Net.HttpListenerContext ctx = l.GetContext();
                        string path = ctx.Request.Url.AbsolutePath.ToLower();
                        string body;
                        if (path == "/show") { DoShow(); body = "{\"ok\":true,\"shown\":true}"; }
                        else if (path == "/hide") { DoHide(); body = "{\"ok\":true,\"shown\":false}"; }
                        else if (path == "/toggle") { if (Shown) DoHide(); else DoShow(); body = "{\"ok\":true,\"shown\":" + (Shown ? "true" : "false") + "}"; }
                        else body = "{\"ok\":true,\"shown\":" + (Shown ? "true" : "false") + ",\"events\":" + EvCount2 + ",\"clicks\":" + ClickCount2 + ",\"input\":\"" + JsonEscape(Line) + "\"}";
                        byte[] buf = Encoding.UTF8.GetBytes(body);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.OutputStream.Write(buf, 0, buf.Length);
                        ctx.Response.Close();
                    }
                    catch (Exception) { break; }
                }
            });
            th.IsBackground = true;
            th.Start();
            Log("[控制] 已监听 http://127.0.0.1:" + port + "/ (show / hide / toggle / state)");
        }
        catch (Exception e) { Log("[控制] 监听失败(端口被占?): " + e.Message); }
    }

    static int CtlClient(string url)
    {
        try
        {
            using (WebClient wc = new WebClient())
            {
                wc.Encoding = Encoding.UTF8;
                Console.WriteLine(wc.DownloadString(url));
                return 0;
            }
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("控制调用失败: " + e.Message + " (键盘程序在跑吗? 端口对不对?)");
            return 2;
        }
    }

    static int Main(string[] args)

    {
        Console.OutputEncoding = Encoding.UTF8;
        string mode = args.Length > 0 ? args[0] : "--selftest";
        string url = "http://127.0.0.1:19190/v1/chatbox";
        string dll = null, outPng = null;
        float meters = 1.35f, dist = 1.6f, height = 1.35f;
        bool fixedPos = false;
        bool showAtStart = false;
        int ctl = 19192;
        int diag = 0;
        for (int i = 1; i < args.Length; i++)
        {
            if (args[i] == "--url" && i + 1 < args.Length) url = args[++i];
            else if (args[i] == "--dll" && i + 1 < args.Length) dll = args[++i];
            else if (args[i] == "--out" && i + 1 < args.Length) outPng = args[++i];
            else if (args[i] == "--meters" && i + 1 < args.Length) meters = float.Parse(args[++i]);
            else if (args[i] == "--dist" && i + 1 < args.Length) dist = float.Parse(args[++i]);
            else if (args[i] == "--height" && i + 1 < args.Length) height = float.Parse(args[++i]);
            else if (args[i] == "--fixed") fixedPos = true;
            else if (args[i] == "--show-at-start") showAtStart = true;
            else if (args[i] == "--no-ctl") ctl = 0;
            else if (args[i] == "--ctl" && i + 1 < args.Length) ctl = int.Parse(args[++i]);
            else if (args[i] == "--seconds" && i + 1 < args.Length) diag = int.Parse(args[++i]);
        }
        BuildLayout();
        if (mode == "--selftest") return SelfTest();
        if (mode == "--render")
        {
            Bitmap b = Render();
            string p = outPng != null ? outPng : Path.Combine(Directory.GetCurrentDirectory(), "vrkeyboard-preview.png");
            b.Save(p, ImageFormat.Png);
            Log("已渲染: " + p);
            return 0;
        }
        if (mode == "--show") return CtlClient("http://127.0.0.1:" + ctl + "/show");
        if (mode == "--hide") return CtlClient("http://127.0.0.1:" + ctl + "/hide");
        if (mode == "--toggle") return CtlClient("http://127.0.0.1:" + ctl + "/toggle");
        if (mode == "--state") return CtlClient("http://127.0.0.1:" + ctl + "/state");
        if (mode == "--run") return RunOverlay(url, dll, meters, dist, height, fixedPos, 0, showAtStart, ctl);
        if (mode == "--diag") return RunOverlay(url, dll, meters, dist, height, fixedPos, diag > 0 ? diag : 15, true, 0);
        Log("用法: vrkeyboard.exe --selftest | --render [--out x.png] | --run [--fixed] [--url ...] | --diag [--seconds N]");
        return 1;
    }
}
