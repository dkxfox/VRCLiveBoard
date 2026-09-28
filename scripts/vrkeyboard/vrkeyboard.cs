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
    static bool PointerValid = false;
    static float PointerPx = 0, PointerPy = 0;
    static DateTime LastClickAt = DateTime.Now;
    static int AutoHideSec = 0;    // 默认**不**自动收起(45 秒那次把用户的面板收没了); 需要时 --auto-hide N
    static float CurMeters = 1.35f, CurDist = 1.3f, CurDrop = 0.28f;   // 多久没点就把键盘收起来(免得游戏一直收不到输入)
    static int HoverLogged = 0;
    static float MinX = float.MaxValue, MaxX = float.MinValue, MinY = float.MaxValue, MaxY = float.MinValue;
    static int MoveSeen = 0;
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
            // 靶点: SteamVR 只给仪表盘画光标, 世界里的覆盖层没有 -> 自己画一个(含坐标环)
            // 护栏: 靶点坐标必须是有限值且在画面附近 —— 否则 GDI+ 会 OverflowException 直接把程序崩掉(实测踩过)
            bool cursorOk = PointerValid && Shown &&
                !float.IsNaN(PointerPx) && !float.IsNaN(PointerPy) &&
                !float.IsInfinity(PointerPx) && !float.IsInfinity(PointerPy) &&
                PointerPx > -64f && PointerPx < W + 64f && PointerPy > -64f && PointerPy < H + 64f;
            if (cursorOk)
            {
                using (SolidBrush b = new SolidBrush(Color.FromArgb(220, 255, 214, 92)))
                    g.FillEllipse(b, PointerPx - 9f, PointerPy - 9f, 18f, 18f);
                using (Pen p = new Pen(Color.FromArgb(230, 255, 255, 255), 2f))
                    g.DrawEllipse(p, PointerPx - 16f, PointerPy - 16f, 32f, 32f);
            }
            using (Font f = new Font("Microsoft YaHei UI", 18f))
            using (SolidBrush b = new SolidBrush(Color.FromArgb(255, 150, 200, 160)))
                g.DrawString(Status + "   [指针 " + HoverX.ToString("0.###") + "," + HoverY.ToString("0.###") + (HoverKey == null ? "" : (" -> " + HoverKey.Label)) + "]", f, b, 20f, H - 44f);
        }
        return bmp;
    }

    // 命中测试: 先判断拿到的是 UV(0~1) 还是像素, 再翻 Y(GL 空间原点在左下角)
    static void ToUv(float ax, float ay, out float u, out float v)
    {
        if (Math.Abs(ax) <= 1.5f && Math.Abs(ay) <= 1.5f) { u = ax; v = ay; }
        else { u = ax / W; v = ay / H; }
    }

    static Key Hit(float ax, float ay)
    {
        float u, v;
        ToUv(ax, ay, out u, out v);
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
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int PollRawFn(IntPtr self, ulong handle, IntPtr pEvent, uint size);
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
    static int RunOverlay(string url, string dll, float meters, float dist, float height, bool followHead, int diagSeconds, bool showAtStart, int ctlPort, int autoHideSec)
    {
        Log("=== vrkeyboard 启动 === 参数: url=" + url + " meters=" + meters + " dist=" + dist + " height=" + height + " 模式=" + (followHead ? "跟随头显" : "固定在身前") + (diagSeconds > 0 ? (" 诊断 " + diagSeconds + "s") : ""));
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
            Log("[信息] SetOverlayMouseScale(" + W + "x" + H + " -> 按官方注释: 鼠标尺度是 UI 像素尺寸) -> " + Vt<SetOverlayMouseScaleFn>(ov, 52)(ov, handle, W, H));
            HmdMatrix34_t m = new HmdMatrix34_t();
            m.m0 = 1f; m.m5 = 1f; m.m10 = 1f;
            if (!followHead)
            {
                m.m3 = 0f; m.m7 = height; m.m11 = -dist;
                Log("[信息] 绝对位置(站立空间) 前方 " + dist + "m, 高 " + height + "m -> " + Vt<SetOverlayTransformAbsoluteFn>(ov, 33)(ov, handle, UniverseStanding, ref m));
            }
            else
            {
                m.m3 = 0f; m.m7 = -0.22f; m.m11 = -Math.Max(0.4f, dist);
                Log("[信息] 跟随头显(会把射线一直压在面板上, 只在排障时用): 眼前 " + Math.Max(0.4f, dist) + "m -> " + Vt<SetOverlayTransformHeadFn>(ov, 35)(ov, handle, HmdDeviceIndex, ref m));
            }
            ShowOverlayFn show = Vt<ShowOverlayFn>(ov, 43);
            HideOverlayFn hide = Vt<HideOverlayFn>(ov, 44);
            FlagRef = Vt<SetOverlayFlagFn>(ov, 11);
            ShowRef = show; HideRef = hide; OvRef = ov; HandleRef = handle;
            if (showAtStart) { DoShow(); }
            else { DoHide(); Log("[信息] 默认**隐藏**(避免一直吸着控制器激光让游戏收不到输入); 用 --toggle / 控制口 或 --show-at-start 显示"); }
            if (ctlPort > 0) StartControl(ctlPort);
            EnsureSystem();
            // action 系统的 aim 姿态**对覆盖层应用不可用**(实测 UpdateActionState -> 8 = NoActiveActionSet: 覆盖层没有输入焦点),
            // 所以这里不再尝试; 射线方向改用"校准过的 grip 朝向"或"目光指针"(见 DEV-NOTES 271)。
            // 若将来改成有输入焦点的形态, 把下面这行恢复即可。
            // InitActions();
            LoadCalib();                         // 一次性校准的偏移(没有就用原始握把朝向)
            SetPanelFromMatrix(CurPanelMatrix());
            // 先把事件字段原样打几条出来(排障: 鼠标事件的坐标/按钮到底在哪个偏移)
            SetOverlayRawFn setRaw = Vt<SetOverlayRawFn>(ov, 62);
            SetOverlayFromFileFn setFile = Vt<SetOverlayFromFileFn>(ov, 63);
            IsOverlayVisibleFn isVisible = Vt<IsOverlayVisibleFn>(ov, 45);
            PollNextOverlayEventFn poll = Vt<PollNextOverlayEventFn>(ov, 48);
            PollRawFn pollRaw = Vt<PollRawFn>(ov, 48);
            IntPtr evBuf = Marshal.AllocHGlobal(96);
            byte[] evBytes = new byte[96];
            int dumped = 0;
            int frame = 0, rawErr = 0, evCount = 0, clickCount = 0;
            bool dirty = true;
            DateTime lastRender = DateTime.MinValue;
            DateTime lastBeat = DateTime.Now;
            DateTime start = DateTime.Now;
            while (true)
            {
                // 节流: 之前是"只要 dirty 就重绘并推纹理", 指针每帧微动 -> 每秒上百次推送 -> 画面闪。
                // 现在最多 ~15fps, 且只在真的需要时推。(2026-09-29 用户报"键盘在闪", 日志里帧数 22977/20 分钟)
                if (dirty && (DateTime.Now - lastRender).TotalMilliseconds >= 66)
                {
                    lastRender = DateTime.Now;
                    // 关键: 每帧的 Bitmap 必须释放 —— 之前泄漏了(每帧 1024x640x4 ≈ 2.6MB),
                    // 表现为"按得越多越不跟手", 并最终引发 GDI+ 报错与画面闪烁。
                    using (Bitmap bmp = Render())
                    {
                    int re = PushRaw(ov, handle, bmp, setRaw);
                    rawErr = re;
                    if (re != 0)
                    {
                        string f = TempPng(frame % 2);
                        int fe = -1;
                        try { bmp.Save(f, ImageFormat.Png); fe = setFile(ov, handle, f); }
                        catch (Exception ex) { if (frame < 5) Log("[警告] 保存 PNG 失败(跳过这一帧): " + ex.Message); }
                        if (frame < 3) Log("[信息] SetOverlayRaw -> " + re + " (失败), 改用 PNG 文件 -> " + fe + " : " + f);
                    }
                    frame++;
                    dirty = false;
                    }
                }
                // 每帧: 枚举手柄 -> 读姿态与扳机 -> 交给指针状态机(自算射线/近距戳键)
                if (ActionsTick(url)) { /* action 输入已接管(用的是真 aim 姿态) */ }
                else if (SysRef != IntPtr.Zero)
                {
                    try
                    {
                        EnumerateControllers();
                        if (ControllerIdx.Length > 0 && GetPoseRef != null)
                        {
                            uint mx = 0;
                            foreach (uint ci in ControllerIdx) if (ci > mx) mx = ci;
                            uint devMax = Math.Max(mx, 1u);
                            Pose_t[] ps = new Pose_t[devMax + 1];
                            GetPoseRef(SysRef, UniverseStanding, 0f, ps, devMax + 1);
                            bool anyTrig = false;
                            for (int k = 0; k < ControllerIdx.Length; k++)
                            {
                                StepHand(ControllerRole[k], ControllerIdx[k], ps, url);
                                if (TrigPrevHand[ControllerRole[k]]) anyTrig = true;
                            }
                            // 目光指针(兜底, 零猜测): 头显的 -Z 就是它的正前方 —— 看着哪个键扣扳机就能打字。
                            // 手柄的 -Z 是"握把朝向"(实测朝上偏 ~40 度), 真正的 aim 姿态要走 action 输入系统, 那是下一步的事。
                            GazeStep(ps, anyTrig, url);
                            if (dirtyGlobal) { dirty = true; dirtyGlobal = false; }
                        }
                    }
                    catch (Exception ex) { if (MoveLogged < 3) Log("[输入] 读手柄出错: " + ex.Message); }
                }
                VREvent_t ev = new VREvent_t();
                if (poll(ov, handle, ref ev, 64u) != 0)
                {
                    evCount++;
                    if (dumped < 6 && ev.eventType != 300)
                    {
                        int rp = pollRaw(ov, handle, evBuf, 96u);
                        if (rp != 0)
                        {
                            Marshal.Copy(evBuf, evBytes, 0, 96);
                            StringBuilder sbd = new StringBuilder();
                            for (int off = 8; off <= 40; off += 4)
                                sbd.Append("[" + off + "]=" + BitConverter.ToSingle(evBytes, off).ToString("0.####") + " ");
                            Log("[原始] type=" + BitConverter.ToInt32(evBytes, 0) + " " + sbd.ToString());
                        }
                    }
                    if (dumped < 6)
                    {
                        dumped++;
                        Log("[事件样本] type=" + ev.eventType + " device=" + ev.trackedDeviceIndex + " x=" + ev.mouseX + " y=" + ev.mouseY + " button=" + ev.mouseButton);
                    }
                    EvCount2 = evCount;
                    if (ev.eventType == EvMouseMove)
                    {
                        Key hk = Hit(ev.mouseX, ev.mouseY);
                        MoveSeen++; if (ev.mouseX < MinX) MinX = ev.mouseX; if (ev.mouseX > MaxX) MaxX = ev.mouseX; if (ev.mouseY < MinY) MinY = ev.mouseY; if (ev.mouseY > MaxY) MaxY = ev.mouseY;
                        if (MoveLogged < 8)
                        {
                            MoveLogged++;
                            Log("[移动样本] 原始=(" + ev.mouseX.ToString("0.####") + "," + ev.mouseY.ToString("0.####") + ") -> " + (hk == null ? "面板外" : hk.Label));
                        }
                        // 系统鼠标事件的坐标恒为 (0,0)(实测两万多个事件), 已废弃: 只留样本日志, 不再让它动指针状态
                        // (以前它每帧把 HoverKey 清成 null, 把自算射线/目光指针的悬停全冲掉了)
                        if (MoveLogged < 8 && hk != null) Log("[系统鼠标] 竟然有可用坐标: " + hk.Label);
                        HoverX = ev.mouseX; HoverY = ev.mouseY;
                        { float pu, pv; ToUv(ev.mouseX, ev.mouseY, out pu, out pv); PointerPx = pu * W; PointerPy = (1f - pv) * H; PointerValid = true; }
                    }
                    else if (ev.eventType == EvMouseDown || ev.eventType == EvMouseUp)
                    {
                        // 系统鼠标事件**坐标恒为 (0,0)**(实测), 但**按键本身是可靠的** ——
                        // 所以位置用我们自算射线得到的 HoverKey, 按键用这个事件当扳机。
                        // (legacy GetControllerState 对没有输入焦点的覆盖层应用返回不了状态, 见 DEV-NOTES 271/278)
                        bool down = (ev.eventType == EvMouseDown);
                        Log("[扳机] " + (down ? "按下" : "松开") + " button=" + ev.mouseButton + " 悬停键=" + (HoverKey == null ? "(无)" : HoverKey.Label));
                        // 手柄射线常常打不中(握把朝向 vs 瞄准方向), 但**目光是可靠的**:
                        // 所以按键时若自家悬停为空, 就回落到"你正在看的键"; 顺便用这次意图自校准那只手。
                        Key pressKey = HoverKey;
                        int pressRole = 0;
                        for (int ci = 0; ci < ControllerIdx.Length; ci++) if (ControllerIdx[ci] == ev.trackedDeviceIndex) pressRole = ControllerRole[ci];
                        if (pressKey == null) pressKey = GazeHoverKey;
                        if (down && pressKey != null && pressRole != 0 && GazeHoverKey != null && LastHoverOrigin != null)
                        {
                            // 自校准: 把这只手的朝向, 旋到"它应该指向的那个键的中心"
                            float ku = (GazeHoverKey.Rect.X + GazeHoverKey.Rect.Width / 2f) / W;
                            float kv = 1f - ((GazeHoverKey.Rect.Y + GazeHoverKey.Rect.Height / 2f) / H);
                            float[] tgt = KeyCenterWorld(ku, kv);
                            float[] dir = Normalize(new float[] { tgt[0] - LastHoverOrigin[0], tgt[1] - LastHoverOrigin[1], tgt[2] - LastHoverOrigin[2] });
                            float[] gripDir = Normalize(new float[] { -LastHandMatrix[pressRole].m2, -LastHandMatrix[pressRole].m6, -LastHandMatrix[pressRole].m10 });
                            float ang = AngleBetween(gripDir, dir);
                            if (ang < 30f && CalibrateHandDir(pressRole, gripDir, dir)) Log("[自校准] 手=" + (pressRole == RoleLeft ? "左" : "右") + " 用这次按键修正了 " + ang.ToString("0.0") + " 度(按的是「" + GazeHoverKey.Label + "」)");
                        }
                        if (down && ev.mouseButton == MouseLeft && pressKey != null)
                        {
                            clickCount++; LastClickAt = DateTime.Now;
                            if (PointerPy < 100f && LastHoverOrigin != null)
                            {
                                // 顶部抓取条: 拿起键盘(记下手柄与面板的相对位置, 之后跟手)
                                Grabbing = true;
                                GrabOffset = new float[] { PanelPos[0] - LastHoverOrigin[0], PanelPos[1] - LastHoverOrigin[1], PanelPos[2] - LastHoverOrigin[2] };
                                Log("[抓取] 拿起键盘(顶部条)");
                            }
                            else { PressKey(pressKey, url); }
                            dirty = true;
                        }
                        else if (!down && Grabbing)
                        {
                            Grabbing = false;
                            Log("[抓取] 松手, 钉在当前位置");
                        }
                    }
                }
                else Thread.Sleep(15);
                if ((DateTime.Now - lastBeat).TotalSeconds >= 5)
                {
                    lastBeat = DateTime.Now;
                    Log("[指针范围] n=" + MoveSeen + " x=[" + (MoveSeen > 0 ? MinX.ToString("0.##") : "-") + "," + (MoveSeen > 0 ? MaxX.ToString("0.##") : "-") + "] y=[" + (MoveSeen > 0 ? MinY.ToString("0.##") : "-") + "," + (MoveSeen > 0 ? MaxY.ToString("0.##") : "-") + "]");
                    Log("[心跳] 帧=" + frame + " 可见=" + isVisible(ov, handle) + " 原始推送返回=" + rawErr + " 事件=" + evCount + " 点击=" + clickCount + " 输入行='" + Line + "'");
                }
                if (Shown && AutoHideSec > 0 && (DateTime.Now - LastClickAt).TotalSeconds >= AutoHideSec)
                {
                    Log("[控制] 超过 " + AutoHideSec + " 秒没有点击, 自动收起键盘(把输入还给游戏)");
                    DoHide();
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
        PlaceInFrontOfHead(CurMeters, CurDist, CurDrop);   // 每次都按"你此刻的朝向"摆一次(召唤语义)
        if (FlagRef != null) FlagRef(OvRef, HandleRef, (int)FlagInteractive, true);
        if (ShowRef != null) ShowRef(OvRef, HandleRef);
        Shown = true;
        LastClickAt = DateTime.Now;
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
                        else if (path == "/calibrate") { DoCalibrate(); body = "{\"ok\":true,\"note\":\"calibrating\"}"; }
                        else body = "{\"ok\":true,\"shown\":" + (Shown ? "true" : "false") + ",\"events\":" + EvCount2 + ",\"clicks\":" + ClickCount2 + ",\"input\":\"" + JsonEscape(Line) + "\"}";
                        byte[] buf = Encoding.UTF8.GetBytes(body);
                        ctx.Response.ContentType = "application/json";
                        ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");   // 控制台页面(:19190)要能直接调本机控制口(:19192)
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


    // ---------- 显示位置: 按头显当前姿态把面板放到眼前(参考 UEVR / Desktop+ 的做法: 读 HMD 姿态 -> 绝对变换) ----------
    // 为什么要这样: 固定写"站立空间正前方"依赖 play area 朝向(用户可能背对着它); 而"跟随头显"又会让射线永远压在面板上,
    // 游戏就收不到输入。正确做法是**召唤时按当前朝向摆一次**, 之后固定在原地 —— 看开就把输入还给游戏。
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void GetPoseFn(IntPtr self, int origin, float predictedSeconds, [Out] Pose_t[] poses, uint count);

    // TrackedDevicePose_t 真实大小 = 80 字节(48 矩阵 + 12 线速度 + 12 角速度 + 4 跟踪结果 + 1 有效 + 1 连接 + 2 对齐)
    // 之前写成 96 -> 数组里第 2 个元素起全部错位(表现为"手柄位置在天上/地板外"), 这是本轮的根因。
    [StructLayout(LayoutKind.Explicit, Size = 80)]
    struct Pose_t { [FieldOffset(0)] public HmdMatrix34_t m; }

    static void PlaceInFrontOfHead(float meters, float dist, float drop)
    {
        try
        {
            if (OvRef == IntPtr.Zero || HandleRef == 0) return;
            string[] sysVersions = new string[] { "IVRSystem_026", "IVRSystem_025", "IVRSystem_024", "IVRSystem_023" };
            IntPtr sys = IntPtr.Zero; string usedSys = null;
            foreach (string v in sysVersions)
            {
                int se = 0;
                IntPtr cand = VR_GetGenericInterface(v, ref se);
                if (cand != IntPtr.Zero && se == 0) { sys = cand; usedSys = v; break; }
            }
            if (sys == IntPtr.Zero) { Log("[放置] 拿不到 IVRSystem 接口, 保持原位置"); return; }
            GetPoseFn getPose = Vt<GetPoseFn>(sys, 12);   // IVRSystem::GetDeviceToAbsoluteTrackingPose
            Pose_t[] poses = new Pose_t[1];
            getPose(sys, UniverseStanding, 0f, poses, 1u);
            HmdMatrix34_t h = poses[0].m;
            float hx = h.m3, hy = h.m7, hz = h.m11;                     // 头显位置(第 4 列)
            float fx = -h.m2, fy = -h.m6, fz = -h.m10;                  // 朝向 = -第三列
            float len = (float)Math.Sqrt(fx * fx + fy * fy + fz * fz);
            if (len > 0.001f) { fx /= len; fy /= len; fz /= len; }
            if (float.IsNaN(hx) || float.IsNaN(fx) || len <= 0.001f) { Log("[放置] 头显姿态不可用(值异常), 保持原位置"); return; }
            HmdMatrix34_t p = new HmdMatrix34_t();
            p.m0 = h.m0; p.m1 = h.m1; p.m2 = h.m2;                       // 用头显的旋转(面板正面朝你)
            p.m4 = h.m4; p.m5 = h.m5; p.m6 = h.m6;
            p.m8 = h.m8; p.m9 = h.m9; p.m10 = h.m10;
            p.m3 = hx + fx * dist;
            p.m7 = hy + fy * dist - drop;
            p.m11 = hz + fz * dist;
            int e = Vt<SetOverlayTransformAbsoluteFn>(OvRef, 33)(OvRef, HandleRef, UniverseStanding, ref p);
            Log("[放置] " + usedSys + " 头显=(" + hx.ToString("0.00") + "," + hy.ToString("0.00") + "," + hz.ToString("0.00") + ") 朝向=(" + fx.ToString("0.00") + "," + fy.ToString("0.00") + "," + fz.ToString("0.00") + ") -> 面板=(" + p.m3.ToString("0.00") + "," + p.m7.ToString("0.00") + "," + p.m11.ToString("0.00") + ") 距离=" + dist + "m 下移=" + drop + "m 结果=" + e);
            Vt<SetOverlayWidthInMetersFn>(OvRef, 22)(OvRef, HandleRef, meters);
            SetPanelFromMatrix(p);
        }
        catch (Exception ex) { Log("[放置] 异常: " + ex.Message); }
    }


    // ================= 切片 2: 自算射线 + 抓取/放置(参考 wlx-overlay-s: 自己算 ray、边沿检测、松开回原目标) =================
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate uint GetRoleIndexFn(IntPtr self, int role);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate bool GetControllerStateFn(IntPtr self, uint index, ref VRControllerState_t state, uint size);

    // legacy 控制器状态: unPacketNum(4) + pad(4) + ulButtonPressed(8) + ulButtonTouched(8) + rAxis[5](40) = 64
    [StructLayout(LayoutKind.Explicit, Size = 64)]
    struct VRControllerState_t
    {
        [FieldOffset(0)] public uint unPacketNum;
        [FieldOffset(8)] public ulong ulButtonPressed;
        [FieldOffset(16)] public ulong ulButtonTouched;
        [FieldOffset(24)] public float axis0x;   // rAxis[0].x = 扳机模拟量
    }

    const int RoleLeft = 1, RoleRight = 2;
    const ulong TriggerMask = 1UL << 33;          // k_EButton_SteamVR_Trigger == k_EButton_Axis1 == 33
    const float TitleBarV = 100f / 640f;          // 顶部 100px 是"抓取条"(按住这里拖动键盘)

    static IntPtr SysRef = IntPtr.Zero;
    static string SysVer = null;
    static GetPoseFn GetPoseRef = null;
    static GetControllerStateFn GetStateRef = null;
    static GetRoleIndexFn RoleIndexRef = null;

    // 面板几何(我们自己维护: 位置 + 三个基向量), 由 SetPanelFromMatrix 更新
    static float[] PanelPos = new float[] { 0, 1.3f, -1.4f };
    static float[] PanelRight = new float[] { 1, 0, 0 };
    static float[] PanelUp = new float[] { 0, 1, 0 };
    static float[] PanelNormal = new float[] { 0, 0, 1 };   // 局部 +Z: 朝用户那一面

    static bool EnsureSystem()
    {
        if (SysRef != IntPtr.Zero) return true;
        string[] vers = new string[] { "IVRSystem_026", "IVRSystem_025", "IVRSystem_024", "IVRSystem_023" };
        foreach (string v in vers)
        {
            int err = 0;
            IntPtr cand = VR_GetGenericInterface(v, ref err);
            if (cand != IntPtr.Zero && err == 0)
            {
                SysRef = cand; SysVer = v;
                GetPoseRef = Vt<GetPoseFn>(cand, 12);              // GetDeviceToAbsoluteTrackingPose
                RoleIndexRef = Vt<GetRoleIndexFn>(cand, 18);        // GetTrackedDeviceIndexForControllerRole
                GetStateRef = Vt<GetControllerStateFn>(cand, 37);   // GetControllerState
                IsConnectedRef = Vt<IsConnectedFn>(cand, 21);        // IsTrackedDeviceConnected
                GetClassRef = Vt<GetClassFn>(cand, 20);              // GetTrackedDeviceClass
                GetRoleRef = Vt<GetRoleFn>(cand, 19);                // GetControllerRoleForTrackedDeviceIndex
                Log("[输入] 拿到 " + v + ": 姿态/手柄角色/扳机 三个入口就绪");
                return true;
            }
        }
        Log("[输入] 拿不到 IVRSystem 接口(手柄输入不可用, 面板只显示不响应)");
        return false;
    }

    static void SetPanelFromMatrix(HmdMatrix34_t m)
    {
        PanelPos = new float[] { m.m3, m.m7, m.m11 };
        PanelRight = new float[] { m.m0, m.m4, m.m8 };
        PanelUp = new float[] { m.m1, m.m5, m.m9 };
        PanelNormal = new float[] { m.m2, m.m6, m.m10 };
    }

    // 射线与面板平面求交 -> 面板 UV(0~1, 原点左下, 与覆盖层一致)
    static bool RayToUv(float[] o, float[] d, out float u, out float v)
    {
        u = 0; v = 0;
        float den = d[0] * PanelNormal[0] + d[1] * PanelNormal[1] + d[2] * PanelNormal[2];
        if (Math.Abs(den) < 1e-6f) return false;
        float dx = PanelPos[0] - o[0], dy = PanelPos[1] - o[1], dz = PanelPos[2] - o[2];
        float t = (dx * PanelNormal[0] + dy * PanelNormal[1] + dz * PanelNormal[2]) / den;
        if (t <= 0.02f) return false;                                  // 在身后 / 太近不算
        float hx = o[0] + d[0] * t - PanelPos[0];
        float hy = o[1] + d[1] * t - PanelPos[1];
        float hz = o[2] + d[2] * t - PanelPos[2];
        float lx = hx * PanelRight[0] + hy * PanelRight[1] + hz * PanelRight[2];
        float ly = hx * PanelUp[0] + hy * PanelUp[1] + hz * PanelUp[2];
        float halfW = CurMeters * 0.5f;
        float halfH = CurMeters * ((float)H / (float)W) * 0.5f;
        u = 0.5f + lx / (2f * halfW);
        v = 0.5f + ly / (2f * halfH);
        return true;
    }

    static bool InPanelBox(float u, float v) { return u >= 0f && u <= 1f && v >= 0f && v <= 1f; }

    // ---- 指针状态机: 边沿检测 + 抓取/放置 + 只在打中面板时接管输入 ----
    static bool TrigPrev = false;
    static bool Grabbing = false;
    static float[] GrabOffset = new float[] { 0, 0, 0 };
    static int GrabHandRole = 0;
    static int InteractionOn = 0;     // 交互开关被打开的次数(用于断言"平时不抢输入")

    static float[] LastHoverOrigin = null;   // 最近一次悬停在面板上时, 手柄所在位置(抓取时算相对位置用)
    static Key GazeHoverKey = null;          // 目光(头显指向)当前落在哪个键 —— 可靠, 用作"用户想要哪个键"的基准
    static float[] LastGazeOrigin = null;
    static bool InteractiveNow = false;   // 只在**状态变化**时切交互开关(每帧来回切会让画面闪)
    static void SetInteractive(bool on)
    {
        if (FlagRef == null) return;
        if (on == InteractiveNow) return;
        FlagRef(OvRef, HandleRef, (int)FlagInteractive, on);
        InteractiveNow = on;
        if (on) InteractionOn++;
    }

    // 每帧调用: 给定一只手(fw = 朝向)与扳机状态, 决定 hover / 打字 / 抓取
    static void PointerStep(int role, float[] origin, float[] dir, bool trigger, string url)
    {
        float u, v;
        bool hitPanel = RayToUv(origin, dir, out u, out v) && InPanelBox(u, v);
        if (!hitPanel && NearToUv(origin, out u, out v) && InPanelBox(u, v)) hitPanel = true;

        // 不抢输入: 只在"打中面板"时才让系统激光鼠标接管那一发扳机; 指开立刻还回去
        if (hitPanel && !InteractionEnabed) { SetInteractive(true); InteractionEnabed = true; }
        else if (!hitPanel && InteractionEnabed && !Grabbing) { SetInteractive(false); InteractionEnabed = false; }

        if (hitPanel)
        {
            Key hk = Hit(u, v);
            PointerPx = u * W; PointerPy = (1f - v) * H; PointerValid = true;
            if (hk != HoverKey) { HoverKey = hk; dirtyGlobal = true; }
        }
        else if (!Grabbing)
        {
            PointerValid = false;
            if (HoverKey != null) { HoverKey = null; dirtyGlobal = true; }
        }

        bool rising = trigger && !TrigPrev;
        bool falling = !trigger && TrigPrev;

        if (rising)
        {
            if (hitPanel && v >= (1f - TitleBarV))            // 顶部抓取条 -> 拿起键盘
            {
                Grabbing = true; GrabHandRole = role;
                GrabOffset = new float[] { PanelPos[0] - origin[0], PanelPos[1] - origin[1], PanelPos[2] - origin[2] };
                Log("[抓取] 拿起键盘(手=" + (role == RoleLeft ? "左" : "右") + ")");
            }
            else if (hitPanel)
            {
                Key k = Hit(u, v);
                if (k != null) { LastClickAt = DateTime.Now; ClicksDone++; PressKey(k, url); dirtyGlobal = true; Log("[输入] 按下 -> " + k.Label); }
            }
        }
        else if (falling && Grabbing && role == GrabHandRole)
        {
            Grabbing = false;
            Log("[抓取] 松手, 钉在当前位置");
        }

        if (Grabbing && role == GrabHandRole)
        {
            HmdMatrix34_t m = CurPanelMatrix();
            m.m3 = origin[0] + GrabOffset[0];
            m.m7 = origin[1] + GrabOffset[1];
            m.m11 = origin[2] + GrabOffset[2];
            Vt<SetOverlayTransformAbsoluteFn>(OvRef, 33)(OvRef, HandleRef, UniverseStanding, ref m);
            SetPanelFromMatrix(m);
        }
        TrigPrev = trigger;
    }

    static bool InteractionEnabed = false;
    static bool dirtyGlobal = false;
    static int ClicksDone = 0;

    // 当前面板矩阵(位置 + 旋转), 抓取时只改位置
    static HmdMatrix34_t CurPanelMatrix()
    {
        HmdMatrix34_t m = new HmdMatrix34_t();
        m.m0 = PanelRight[0]; m.m4 = PanelRight[1]; m.m8 = PanelRight[2];
        m.m1 = PanelUp[0]; m.m5 = PanelUp[1]; m.m9 = PanelUp[2];
        m.m2 = PanelNormal[0]; m.m6 = PanelNormal[1]; m.m10 = PanelNormal[2];
        m.m3 = PanelPos[0]; m.m7 = PanelPos[1]; m.m11 = PanelPos[2];
        return m;
    }


    // ---- 每帧: 从 IVRSystem 读两只手的姿态与扳机, 交给指针状态机 ----
    static bool[] TrigPrevHand = new bool[3];

    static void RayFromUv(float u, float v, float dist, out float[] o, out float[] d)
    {
        float halfW = CurMeters * 0.5f;
        float halfH = CurMeters * ((float)H / (float)W) * 0.5f;
        float lx = (u - 0.5f) * 2f * halfW;
        float ly = (v - 0.5f) * 2f * halfH;
        o = new float[] {
            PanelPos[0] + PanelRight[0]*lx + PanelUp[0]*ly + PanelNormal[0]*dist,
            PanelPos[1] + PanelRight[1]*lx + PanelUp[1]*ly + PanelNormal[1]*dist,
            PanelPos[2] + PanelRight[2]*lx + PanelUp[2]*ly + PanelNormal[2]*dist };
        d = new float[] { -PanelNormal[0], -PanelNormal[1], -PanelNormal[2] };
    }

    static void StepHand(int role, uint idx, Pose_t[] ps, string url)
    {
        if (idx == 0 || idx >= (uint)ps.Length) return;
        HmdMatrix34_t m = ps[idx].m;
        float[] o = new float[] { m.m3, m.m7, m.m11 };
        float dx = -m.m2, dy = -m.m6, dz = -m.m10;
        float len = (float)Math.Sqrt(dx * dx + dy * dy + dz * dz);
        if (len <= 0.001f || float.IsNaN(len) || float.IsNaN(o[0]))
        {
            if (Grabbing && role == GrabHandRole) { Grabbing = false; Log("[抓取] 手柄姿态失效 -> 原地钉住"); }
            return;
        }
        float[] d = new float[] { dx / len, dy / len, dz / len };
        LastHandMatrix[role] = m;
        if (PendingCalib > 0) { PendingCalib--; CalibrateHand(role, o, d); }
        d = ApplyCalib(role, d);                       // 用校准过的朝向当瞄准方向(没校准过就是原样)
        VRControllerState_t st = new VRControllerState_t();
        bool ok = GetStateRef != null && GetStateRef(SysRef, idx, ref st, 64u);
        bool trig = ok && (((st.ulButtonPressed & TriggerMask) != 0) || st.axis0x > 0.5f);
        LogGeometry(role, o, d);
        bool prev = TrigPrevHand[role];
        bool rising = trig && !prev;
        bool falling = !trig && prev;
        TrigPrevHand[role] = trig;
        PointerStepEdge(role, o, d, rising, falling, url);
    }

    // 把 PointerStep 拆成"边沿版", 便于 --sim 直接驱动(不需要 VR)
    static void PointerStepEdge(int role, float[] origin, float[] dir, bool rising, bool falling, string url)
    {
        float u, v;
        bool hitPanel = RayToUv(origin, dir, out u, out v) && InPanelBox(u, v);
        if (hitPanel && !InteractionEnabed) { SetInteractive(true); InteractionEnabed = true; }
        else if (!hitPanel && InteractionEnabed && !Grabbing) { SetInteractive(false); InteractionEnabed = false; }
        if (hitPanel)
        {
            Key hk = Hit(u, v);
            PointerPx = u * W; PointerPy = (1f - v) * H; PointerValid = true;
            if (hk != HoverKey) { HoverKey = hk; dirtyGlobal = true; }
        }
        else if (!Grabbing)
        {
            PointerValid = false;
            if (HoverKey != null) { HoverKey = null; dirtyGlobal = true; }
        }
        if (rising)
        {
            if (hitPanel && v >= (1f - TitleBarV))
            {
                Grabbing = true; GrabHandRole = role;
                GrabOffset = new float[] { PanelPos[0] - origin[0], PanelPos[1] - origin[1], PanelPos[2] - origin[2] };
                Log("[抓取] 拿起键盘(手=" + (role == RoleLeft ? "左" : "右") + ")");
            }
            else if (hitPanel)
            {
                Key k = Hit(u, v);
                if (k != null) { LastClickAt = DateTime.Now; ClicksDone++; PressKey(k, url); dirtyGlobal = true; Log("[输入] 按下 -> " + k.Label); }
            }
        }
        else if (falling && Grabbing && role == GrabHandRole) { Grabbing = false; Log("[抓取] 松手, 钉在当前位置"); }
        if (Grabbing && role == GrabHandRole)
        {
            HmdMatrix34_t pm = CurPanelMatrix();
            pm.m3 = origin[0] + GrabOffset[0];
            pm.m7 = origin[1] + GrabOffset[1];
            pm.m11 = origin[2] + GrabOffset[2];
            if (OvRef != IntPtr.Zero && HandleRef != 0) Vt<SetOverlayTransformAbsoluteFn>(OvRef, 33)(OvRef, HandleRef, UniverseStanding, ref pm);   // sim 模式没有真覆盖层, 只更新几何
            SetPanelFromMatrix(pm);
        }
    }

    // ================= 一次性校准: 把"握把朝向"旋到真正的瞄准方向 =================
    // 背景: 覆盖层拿不到 action 的 aim 姿态(NoActiveActionSet, 见 DEV-NOTES 271), legacy 只有 grip 姿态,
    // 而实测 grip 的 -Z 比瞄准方向**偏上约 26 度** -> 用一次"看着键盘中心扣扳机/点校准"把偏移量算出来记住。
    static float[][] CalibRot = new float[3][];
    static string CalibFile = null;

    static string CalibPath()
    {
        if (CalibFile != null) return CalibFile;
        try
        {
            DirectoryInfo d = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            for (int i = 0; i < 6 && d != null; i++)
            {
                if (File.Exists(Path.Combine(d.FullName, "config.default.json"))) { CalibFile = Path.Combine(d.FullName, "logs", "vrkeyboard-calib.json"); break; }
                d = d.Parent;
            }
        }
        catch (Exception) { }
        if (CalibFile == null) CalibFile = Path.Combine(Path.GetTempPath(), "vrkeyboard-calib.json");
        return CalibFile;
    }

    static void LoadCalib()
    {
        try
        {
            if (!File.Exists(CalibPath())) { Log("[校准] 还没有校准记录(射线用原始握把朝向, 会偏上)"); return; }
            string s = File.ReadAllText(CalibPath());
            foreach (char hand in new char[] { 'L', 'R' })
            {
                int i = s.IndexOf("\"" + hand + "\":[");
                if (i < 0) continue;
                i = s.IndexOf('[', i) + 1;
                int j = s.IndexOf(']', i);
                string[] parts = s.Substring(i, j - i).Split(',');
                if (parts.Length < 9) continue;
                float[] m = new float[9];
                for (int k = 0; k < 9; k++) m[k] = float.Parse(parts[k], System.Globalization.CultureInfo.InvariantCulture);
                CalibRot[hand == 'L' ? RoleLeft : RoleRight] = m;
            }
            Log("[校准] 已加载: 左=" + (CalibRot[RoleLeft] != null ? "有" : "无") + " 右=" + (CalibRot[RoleRight] != null ? "有" : "无"));
        }
        catch (Exception ex) { Log("[校准] 读取失败(忽略): " + ex.Message); }
    }

    static void SaveCalib()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(CalibPath()));
            string s = "{";
            for (int r = 0; r < 3; r++)
            {
                if (CalibRot[r] == null) continue;
                if (s.Length > 1) s += ",";
                s += "\"" + (r == RoleLeft ? "L" : "R") + "\":[";
                for (int k = 0; k < 9; k++) s += (k > 0 ? "," : "") + CalibRot[r][k].ToString("0.000000", System.Globalization.CultureInfo.InvariantCulture);
                s += "]";
            }
            s += "}";
            File.WriteAllText(CalibPath(), s);
            Log("[校准] 已保存: " + s);
        }
        catch (Exception ex) { Log("[校准] 保存失败: " + ex.Message); }
    }

    // 把手柄朝向旋到"手柄 -> 面板中心"方向(轴角法), 记成 3x3 旋转矩阵
    static bool CalibrateHand(int role, float[] handPos, float[] handDir)
    {
        float[] t = new float[] { PanelPos[0] - handPos[0], PanelPos[1] - handPos[1], PanelPos[2] - handPos[2] };
        float tl = (float)Math.Sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]);
        if (tl < 0.05f) { Log("[校准] 手离面板太近, 跳过"); return false; }
        t[0] /= tl; t[1] /= tl; t[2] /= tl;
        float dot = handDir[0] * t[0] + handDir[1] * t[1] + handDir[2] * t[2];
        if (dot > 0.9999f) { CalibRot[role] = new float[] { 1, 0, 0, 0, 1, 0, 0, 0, 1 }; SaveCalib(); Log("[校准] 本来就对准, 记为单位旋转"); return true; }
        float[] ax = new float[] { handDir[1] * t[2] - handDir[2] * t[1], handDir[2] * t[0] - handDir[0] * t[2], handDir[0] * t[1] - handDir[1] * t[0] };
        float al = (float)Math.Sqrt(ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2]);
        if (al < 1e-6f) { Log("[校准] 方向正好相反, 轴角法不适用(跳过)"); return false; }
        ax[0] /= al; ax[1] /= al; ax[2] /= al;
        float ang = (float)Math.Acos(Math.Max(-1f, Math.Min(1f, dot)));
        float c = (float)Math.Cos(ang), s = (float)Math.Sin(ang), tt = 1f - c;
        float x = ax[0], y = ax[1], z = ax[2];
        CalibRot[role] = new float[] {
            tt*x*x + c,    tt*x*y - s*z,  tt*x*z + s*y,
            tt*x*y + s*z,  tt*y*y + c,    tt*y*z - s*x,
            tt*x*z - s*y,  tt*y*z + s*x,  tt*z*z + c };
        Log("[校准] 手=" + (role == RoleLeft ? "左" : "右") + " 夹角=" + (ang * 180.0 / Math.PI).ToString("0.0") + " 度");
        SaveCalib();
        return true;
    }

    static float[] ApplyCalib(int role, float[] d)
    {
        float[] m = (role >= 0 && role < 3) ? CalibRot[role] : null;
        if (m == null) return d;
        return new float[] {
            m[0]*d[0] + m[1]*d[1] + m[2]*d[2],
            m[3]*d[0] + m[4]*d[1] + m[5]*d[2],
            m[6]*d[0] + m[7]*d[1] + m[8]*d[2] };
    }

    // 校准期间: 每个手柄都用当前姿态算一次(由控制口 /calibrate 触发)
    static int PendingCalib = 0;
    static void DoCalibrate()
    {
        PendingCalib = 2;   // 接下来两帧里, 每只出现的手柄都算一次
        Log("[校准] 收到校准请求: 请让手保持指向键盘中心");
    }
    // ---- 自校准用的小工具 ----
    static HmdMatrix34_t[] LastHandMatrix = new HmdMatrix34_t[3];

    static float[] Normalize(float[] v)
    {
        float l = (float)Math.Sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        if (l < 1e-6f) return new float[] { 0, 0, -1 };
        return new float[] { v[0] / l, v[1] / l, v[2] / l };
    }

    static float AngleBetween(float[] a, float[] b)
    {
        float d = Math.Max(-1f, Math.Min(1f, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
        return (float)(Math.Acos(d) * 180.0 / Math.PI);
    }

    // 键中心的 UV -> 面板世界坐标
    static float[] KeyCenterWorld(float u, float v)
    {
        float halfW = CurMeters * 0.5f;
        float halfH = CurMeters * ((float)H / (float)W) * 0.5f;
        float lx = (u - 0.5f) * 2f * halfW, ly = (v - 0.5f) * 2f * halfH;
        return new float[] {
            PanelPos[0] + PanelRight[0] * lx + PanelUp[0] * ly,
            PanelPos[1] + PanelRight[1] * lx + PanelUp[1] * ly,
            PanelPos[2] + PanelRight[2] * lx + PanelUp[2] * ly };
    }

    // 与 CalibrateHand 同一套轴角法, 但直接给"从哪个方向"到"哪个方向"
    static bool CalibrateHandDir(int role, float[] from, float[] to)
    {
        float dot = Math.Max(-1f, Math.Min(1f, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
        if (dot > 0.99999f) return false;
        float[] ax = new float[] { from[1] * to[2] - from[2] * to[1], from[2] * to[0] - from[0] * to[2], from[0] * to[1] - from[1] * to[0] };
        float al = (float)Math.Sqrt(ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2]);
        if (al < 1e-6f) return false;
        ax[0] /= al; ax[1] /= al; ax[2] /= al;
        float ang = (float)Math.Acos(dot);
        float c = (float)Math.Cos(ang), s = (float)Math.Sin(ang), tt = 1f - c;
        float x = ax[0], y = ax[1], z = ax[2];
        CalibRot[role] = new float[] {
            tt*x*x + c,    tt*x*y - s*z,  tt*x*z + s*y,
            tt*x*y + s*z,  tt*y*y + c,    tt*y*z - s*x,
            tt*x*z - s*y,  tt*y*z + s*x,  tt*z*z + c };
        SaveCalib();
        return true;
    }

    // ---- --sim: 不需要 VR 的断言(给门禁/自检用) ----
    static int SimTest()
    {
        int fail = 0;
        int pass = 0;
        BuildLayout();
        HmdMatrix34_t m = new HmdMatrix34_t();
        m.m0 = 1f; m.m5 = 1f; m.m10 = 1f; m.m3 = 0f; m.m7 = 1.3f; m.m11 = -1.4f;
        SetPanelFromMatrix(m);
        CurMeters = 1.35f;
        DryRun = true;
        OvRef = IntPtr.Zero; HandleRef = 0; FlagRef = null;   // sim 里没有真覆盖层

        // 1) 射线对准每个键的中心 -> 必须命中它自己
        int miss = 0;
        foreach (Key k in Keys)
        {
            float u = (k.Rect.X + k.Rect.Width / 2f) / W;
            float v = 1f - ((k.Rect.Y + k.Rect.Height / 2f) / H);
            float[] o, d;
            RayFromUv(u, v, 1.2f, out o, out d);
            float hu, hv;
            if (!RayToUv(o, d, out hu, out hv)) { miss++; continue; }
            Key hk = Hit(hu, hv);
            if (hk == null || hk.Value != k.Value) miss++;
        }
        if (miss == 0) { pass++; Log("  PASS 射线命中: " + Keys.Count + " 个键的中心都能被射线命中"); }
        else { fail++; Log("  FAIL 射线命中: " + miss + " 个键没命中"); }

        // 2) 边沿检测: 按住不放只出一次字
        Line = "";
        float[] o2, d2; RayFromUv(0.1f, 0.7f, 1.2f, out o2, out d2);
        Key kk = null; float hx, hy;
        if (RayToUv(o2, d2, out hx, out hy)) kk = Hit(hx, hy);
        if (kk != null)
        {
            Line = "";
            PointerStepEdge(RoleRight, o2, d2, true, false, "x");    // 按下
            string after1 = Line;
            PointerStepEdge(RoleRight, o2, d2, false, false, "x");   // 持续按住
            if (after1.Length == 1 && Line == after1) { pass++; Log("  PASS 边沿检测: 按住不放只输入 1 个字符('" + Line + "')"); }
            else { fail++; Log("  FAIL 边沿检测: after1='" + after1 + "' now='" + Line + "'"); }
        }
        else { fail++; Log("  FAIL 边沿检测: 找不到可点的键"); }

        // 3) 抓取: 顶部条按下 -> 移动 -> 面板跟着走; 松手 -> 再移动面板不动
        float[] o3, d3; RayFromUv(0.5f, 1f - TitleBarV * 0.5f, 1.2f, out o3, out d3);   // 对准顶部抓取条
        float[] before = new float[] { PanelPos[0], PanelPos[1], PanelPos[2] };
        PointerStepEdge(RoleRight, o3, d3, true, false, "x");
        if (!Grabbing) { fail++; Log("  FAIL 抓取: 顶部条按下没有进入抓取态"); }
        else
        {
            float[] moved = new float[] { o3[0] + 0.3f, o3[1] + 0.1f, o3[2] };
            PointerStepEdge(RoleRight, moved, d3, false, false, "x");
            float dx = PanelPos[0] - (before[0] + 0.3f);
            if (Math.Abs(dx) < 0.001f) { pass++; Log("  PASS 抓取: 面板跟着手移动(Δx=0.30)"); }
            else { fail++; Log("  FAIL 抓取: 面板没跟上(Δx=" + dx.ToString("0.###") + ")"); }
            PointerStepEdge(RoleRight, moved, d3, false, true, "x");    // 松手
            float[] anchored = new float[] { PanelPos[0], PanelPos[1], PanelPos[2] };
            float[] moved2 = new float[] { moved[0] + 0.5f, moved[1], moved[2] };
            PointerStepEdge(RoleRight, moved2, d3, false, false, "x");
            if (Math.Abs(PanelPos[0] - anchored[0]) < 0.001f) { pass++; Log("  PASS 放置: 松手后位置固定(再移动手柄面板不动)"); }
            else { fail++; Log("  FAIL 放置: 松手后还在动"); }
        }

        // 4) 指开面板 -> 不开交互(不抢游戏输入)
        InteractionEnabed = false;
        float[] o4 = new float[] { 5f, 5f, 5f }, d4 = new float[] { 0, 1, 0 };
        PointerStepEdge(RoleRight, o4, d4, true, false, "x");
        if (!InteractionEnabed) { pass++; Log("  PASS 不抢输入: 射线不在面板上时不打开交互"); }
        else { fail++; Log("  FAIL 不抢输入: 射线不在面板上却打开了交互"); }

        // 6) 校准: 造一个"偏上 26 度"的手柄朝向 -> 校准后射线必须能打中面板中心
        {
            float[] handPos = new float[] { 0f, 1.3f, 0.4f };                       // 面板前 1.8m 处
            float calAng = 26f * (float)Math.PI / 180f;
            float[] handDir = new float[] { 0f, (float)Math.Sin(calAng), -(float)Math.Cos(calAng) };   // 偏上 26 度
            float u2, v2;
            bool hitBefore = RayToUv(handPos, handDir, out u2, out v2);
            CalibRot[RoleRight] = null;
            CalibrateHand(RoleRight, handPos, handDir);
            float[] fixedDir = ApplyCalib(RoleRight, handDir);
            bool hitAfter = RayToUv(handPos, fixedDir, out u2, out v2);
            Key hk2 = hitAfter ? Hit(u2, v2) : null;
            if (hitBefore && !hitAfter) { pass++; Log("  PASS 校准: 偏 26 度时打不中 -> 校准后命中(" + (hk2 == null ? "面板内" : hk2.Label) + ")"); }
            else if (hitBefore && hitAfter) { pass++; Log("  PASS 校准: 校准后命中(" + (hk2 == null ? "面板内" : hk2.Label) + ")"); }
            else { fail++; Log("  FAIL 校准: before=" + hitBefore + " after=" + hitAfter); }
            CalibRot[RoleRight] = null;
        }
        Log("[模拟自检] 通过 " + pass + " 项, 失败 " + fail + " 项");
        return fail == 0 ? 0 : 1;
    }


    // ---- 近距离戳键(不依赖瞄准方向): 手柄贴近面板时, 用它落在面板上的点当指针 ----
    static bool NearToUv(float[] p, out float u, out float v)
    {
        u = 0; v = 0;
        float dx = p[0] - PanelPos[0], dy = p[1] - PanelPos[1], dz = p[2] - PanelPos[2];
        float along = dx * PanelNormal[0] + dy * PanelNormal[1] + dz * PanelNormal[2];
        if (Math.Abs(along) > 0.08f) return false;
        float lx = dx * PanelRight[0] + dy * PanelRight[1] + dz * PanelRight[2];
        float ly = dx * PanelUp[0] + dy * PanelUp[1] + dz * PanelUp[2];
        float halfW = CurMeters * 0.5f;
        float halfH = CurMeters * ((float)H / (float)W) * 0.5f;
        u = 0.5f + lx / (2f * halfW);
        v = 0.5f + ly / (2f * halfH);
        return true;
    }

    // 几何取证: 每 2 秒记一次(手/方向/面板/射线偏差), 用来定位瞄准问题
    static DateTime LastGeomLog = DateTime.Now;
    static void LogGeometry(int role, float[] o, float[] d)
    {
        if ((DateTime.Now - LastGeomLog).TotalSeconds < 2) return;
        LastGeomLog = DateTime.Now;
        float den = d[0] * PanelNormal[0] + d[1] * PanelNormal[1] + d[2] * PanelNormal[2];
        string info = "den=" + den.ToString("0.###");
        if (Math.Abs(den) > 1e-6f)
        {
            float dx = PanelPos[0] - o[0], dy = PanelPos[1] - o[1], dz = PanelPos[2] - o[2];
            float t = (dx * PanelNormal[0] + dy * PanelNormal[1] + dz * PanelNormal[2]) / den;
            if (t > 0)
            {
                float hx = o[0] + d[0] * t - PanelPos[0], hy = o[1] + d[1] * t - PanelPos[1], hz = o[2] + d[2] * t - PanelPos[2];
                float lx = hx * PanelRight[0] + hy * PanelRight[1] + hz * PanelRight[2];
                float ly = hx * PanelUp[0] + hy * PanelUp[1] + hz * PanelUp[2];
                info = info + " t=" + t.ToString("0.##") + " 命中偏移=(" + lx.ToString("0.###") + "," + ly.ToString("0.###") + ")";
            }
            else info = info + " 交点在身后";
        }
        Log("[几何] " + (role == RoleLeft ? "左" : "右") + " 手=(" + o[0].ToString("0.##") + "," + o[1].ToString("0.##") + "," + o[2].ToString("0.##") + ") 方向=(" + d[0].ToString("0.##") + "," + d[1].ToString("0.##") + "," + d[2].ToString("0.##") + ") 面板=(" + PanelPos[0].ToString("0.##") + "," + PanelPos[1].ToString("0.##") + "," + PanelPos[2].ToString("0.##") + ") " + info);
    }

// ---- 手柄枚举: 实测 GetTrackedDeviceIndexForControllerRole 返回 0, 改为遍历设备类(TrackedDeviceClass_Controller = 2) ----
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate bool IsConnectedFn(IntPtr self, uint index);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int GetClassFn(IntPtr self, uint index);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int GetRoleFn(IntPtr self, uint index);

    static IsConnectedFn IsConnectedRef = null;
    static GetClassFn GetClassRef = null;
    static GetRoleFn GetRoleRef = null;
    static uint[] ControllerIdx = new uint[0];
    static int[] ControllerRole = new int[0];
    static DateTime LastEnumLog = DateTime.MinValue;

    static void EnumerateControllers()
    {
        if (SysRef == IntPtr.Zero || IsConnectedRef == null) return;
        List<uint> idx = new List<uint>();
        List<int> role = new List<int>();
        for (uint i = 1; i <= 63; i++)
        {
            if (!IsConnectedRef(SysRef, i)) continue;
            if (GetClassRef(SysRef, i) != 2) continue;                 // 2 = Controller
            int r = GetRoleRef != null ? GetRoleRef(SysRef, i) : 0;    // 1=左 2=右
            idx.Add(i); role.Add(r);
        }
        if (idx.Count >= 1 && role[0] != 1 && role[0] != 2) role[0] = RoleRight;   // 角色缺失时兜底
        if (idx.Count >= 2 && role[1] != 1 && role[1] != 2) role[1] = RoleLeft;
        ControllerIdx = idx.ToArray();
        ControllerRole = role.ToArray();
        if ((DateTime.Now - LastEnumLog).TotalSeconds > 60)
        {
            LastEnumLog = DateTime.Now;
            string s = "";
            for (int k = 0; k < idx.Count; k++) s += (k > 0 ? ", " : "") + "#" + idx[k] + "(角色" + role[k] + ")";
            Log("[输入] 检测到控制器 " + idx.Count + " 个" + (idx.Count > 0 ? (": " + s) : "(没有手柄?)"));
        }
    }

// 目光指针: role 0 表示"用头显看", 位置/方向取 pose[0](头显的 -Z 就是正前方)
    static bool GazeTrigPrev = false;

    static void GazeStep(Pose_t[] ps, bool trigger, string url)
    {
        if (ps == null || ps.Length < 1) return;
        HmdMatrix34_t h = ps[0].m;
        float[] o = new float[] { h.m3, h.m7, h.m11 };
        float dx = -h.m2, dy = -h.m6, dz = -h.m10;
        float len = (float)Math.Sqrt(dx * dx + dy * dy + dz * dz);
        if (len <= 0.001f || float.IsNaN(o[0])) return;
        float[] d = new float[] { dx / len, dy / len, dz / len };
        // 目光的悬停键单独记下来(自校准与"看着键扣扳机"都靠它)
        float gu, gv;
        if (RayToUv(o, d, out gu, out gv) && InPanelBox(gu, gv)) { GazeHoverKey = Hit(gu, gv); LastGazeOrigin = o; }
        else GazeHoverKey = null;
        bool rising = trigger && !GazeTrigPrev;
        bool falling = !trigger && GazeTrigPrev;
        GazeTrigPrev = trigger;
        PointerStepEdge(0, o, d, rising, falling, url);
    }

// ================= action 输入系统: 拿真正的 **aim 姿态**(就是 SteamVR 激光指的那条线) =================
    // 为什么必须走 action: legacy 的 GetDeviceToAbsoluteTrackingPose 给的是 **grip(握把)姿态**,
    // 与瞄准方向差 ~26 度(实测), 所以射线系统性偏上。aim 姿态只有 action 系统给。
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetManifestFn(IntPtr self, string path);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int GetHandleFn(IntPtr self, string path, ref ulong handle);
    // 注意: 官方签名是 UpdateActionState( VRActiveActionSet_t *pSets, uint32_t unSizeOfVRSelectedActionSet_t, uint32_t unSetCount )
    // —— **三个**参数, 中间那个是结构体字节数。少写一个参数会让 action 永远起不来(表现为 GetPose 返回 3=InvalidHandle)。
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int UpdateActionsFn(IntPtr self, [In] ActiveActionSet_t[] sets, uint sizeOfSet, uint count);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int GetDigitalFn(IntPtr self, ulong handle, ref InputDigitalActionData_t data, uint size, ulong restrict);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int GetPoseActionFn(IntPtr self, ulong handle, int origin, ref InputPoseActionData_t data, uint size, ulong restrict);

    [StructLayout(LayoutKind.Sequential)]
    struct ActiveActionSet_t { public ulong actionSet; public ulong restrictToDevice; }

    // InputPoseActionData_t: bActive(1)+pad(7)+activeOrigin(8)+TrackedDevicePose_t(80) = 96, 矩阵在偏移 16
    [StructLayout(LayoutKind.Explicit, Size = 96)]
    struct InputPoseActionData_t { [FieldOffset(0)] public byte bActive; [FieldOffset(8)] public ulong activeOrigin; [FieldOffset(16)] public HmdMatrix34_t pose; }

    // InputDigitalActionData_t: bActive(1)+pad(7)+activeOrigin(8)+bState(1)+bChanged(1)+pad(2)+fUpdateTime(4) = 24
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct InputDigitalActionData_t { [FieldOffset(0)] public byte bActive; [FieldOffset(8)] public ulong activeOrigin; [FieldOffset(16)] public byte bState; [FieldOffset(17)] public byte bChanged; [FieldOffset(20)] public float fUpdateTime; }

    static IntPtr InputRef = IntPtr.Zero;
    static ulong SetMain = 0, ActPoseL = 0, ActPoseR = 0, ActTrigL = 0, ActTrigR = 0;
    static UpdateActionsFn UpdateActionsRef = null;
    static GetPoseActionFn GetPoseActionRef = null;
    static GetDigitalFn GetDigitalRef = null;
    static bool ActionsReady = false;
    static bool AimActive = false;
    static bool[] AimTrigPrev = new bool[3];
    static DateTime LastAimLog = DateTime.MinValue;

    static bool InitActions()
    {
        try
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory;
            string manifest = Path.Combine(dir, "actions.json");
            if (!File.Exists(manifest))
            {
                Log("[aim] 找不到 " + manifest + " -> 退回 grip 姿态(射线会偏)");
                return false;
            }
            int err = 0;
            InputRef = VR_GetGenericInterface("IVRInput_011", ref err);
            if (InputRef == IntPtr.Zero || err != 0)
            {
                for (int v = 10; v >= 1 && InputRef == IntPtr.Zero; v--)
                {
                    err = 0;
                    InputRef = VR_GetGenericInterface("IVRInput_0" + v.ToString("00"), ref err);
                    if (err != 0) InputRef = IntPtr.Zero;
                }
            }
            if (InputRef == IntPtr.Zero) { Log("[aim] 拿不到 IVRInput 接口 -> 退回 grip 姿态"); return false; }
            SetManifestFn setManifest = Vt<SetManifestFn>(InputRef, 0);
            GetHandleFn getHandle = Vt<GetHandleFn>(InputRef, 2);
            UpdateActionsRef = Vt<UpdateActionsFn>(InputRef, 4);
            GetDigitalRef = Vt<GetDigitalFn>(InputRef, 5);
            GetPoseActionRef = Vt<GetPoseActionFn>(InputRef, 8);
            int e1 = setManifest(InputRef, manifest);
            Log("[aim] SetActionManifestPath -> " + e1 + " (" + manifest + ")");
            GetHandleFn setHandle = Vt<GetHandleFn>(InputRef, 1);
            int e2 = setHandle(InputRef, "/actions/main", ref SetMain);
            int e3 = getHandle(InputRef, "/actions/main/in/pose_left", ref ActPoseL);
            int e4 = getHandle(InputRef, "/actions/main/in/pose_right", ref ActPoseR);
            int e5 = getHandle(InputRef, "/actions/main/in/trigger_left", ref ActTrigL);
            int e6 = getHandle(InputRef, "/actions/main/in/trigger_right", ref ActTrigR);
            Log("[aim] 句柄: set=" + e2 + "(" + SetMain + ") 左aim=" + e3 + "(" + ActPoseL + ") 右aim=" + e4 + "(" + ActPoseR + ") 左扳机=" + e5 + " 右扳机=" + e6);
            ActionsReady = (e2 == 0 && e3 == 0 && e4 == 0 && e5 == 0 && e6 == 0 && SetMain != 0);
            Log(ActionsReady ? "[aim] action 输入就绪(用真正的 aim 姿态)" : "[aim] 有句柄没拿到 -> 退回 grip 姿态");
            return ActionsReady;
        }
        catch (Exception ex) { Log("[aim] 初始化异常: " + ex.Message + " -> 退回 grip 姿态"); return false; }
    }

    // 每帧: 更新 action 状态, 取左右 aim 姿态与扳机 -> 交给同一个指针状态机
    static bool ActionsTick(string url)
    {
        if (!ActionsReady || UpdateActionsRef == null || GetPoseActionRef == null) return false;
        try
        {
            ActiveActionSet_t[] sets = new ActiveActionSet_t[1];
            sets[0].actionSet = SetMain; sets[0].restrictToDevice = 0;
            int ue = UpdateActionsRef(InputRef, sets, 16u, 1u);   // 16 = sizeof(VRActiveActionSet_t)
            if (ue != 0 && (DateTime.Now - LastAimLog).TotalSeconds > 5) Log("[aim] UpdateActionState -> " + ue + " (非 0 = action 没激活)");
            bool handled = false;
            for (int k = 0; k < 2; k++)
            {
                int role = (k == 0) ? RoleLeft : RoleRight;
                ulong poseH = (k == 0) ? ActPoseL : ActPoseR;
                ulong trigH = (k == 0) ? ActTrigL : ActTrigR;
                InputPoseActionData_t pd = new InputPoseActionData_t();
                int pe = GetPoseActionRef(InputRef, poseH, UniverseStanding, ref pd, 96u, 0ul);
                InputDigitalActionData_t td = new InputDigitalActionData_t();
                int te = GetDigitalRef != null ? GetDigitalRef(InputRef, trigH, ref td, 24u, 0ul) : 1;
                if ((DateTime.Now - LastAimLog).TotalSeconds > 5)
                {
                    LastAimLog = DateTime.Now;
                    Log("[aim] " + (k == 0 ? "左" : "右") + " poseErr=" + pe + " active=" + pd.bActive + " trigErr=" + te + " trigActive=" + td.bActive + " trig=" + td.bState);
                }
                if (pe != 0 || pd.bActive == 0) continue;
                handled = true;
                AimActive = true;
                float[] o = new float[] { pd.pose.m3, pd.pose.m7, pd.pose.m11 };
                float dx = -pd.pose.m2, dy = -pd.pose.m6, dz = -pd.pose.m10;   // aim 姿态的 -Z 就是指向
                float len = (float)Math.Sqrt(dx * dx + dy * dy + dz * dz);
                if (len <= 0.001f || float.IsNaN(o[0])) continue;
                float[] d = new float[] { dx / len, dy / len, dz / len };
                bool trig = (td.bActive != 0) && (td.bState != 0);
                bool prev = AimTrigPrev[role];
                bool rising = trig && !prev;
                bool falling = !trig && prev;
                AimTrigPrev[role] = trig;
                PointerStepEdge(role, o, d, rising, falling, url);
            }
            return handled;
        }
        catch (Exception ex) { if (MoveLogged < 3) Log("[aim] 每帧更新异常: " + ex.Message); return false; }
    }

    static int Main(string[] args)








    {
        Console.OutputEncoding = Encoding.UTF8;
        // 双击 exe(无参数)应当**启动覆盖层** —— 之前默认是 --selftest, 用户双击后它自检完就退出,
        // 看起来就是"手动启动失败"(2026-09-29 实际踩到)。自检请显式用 --selftest / --sim。
        string mode = args.Length > 0 ? args[0] : "--run";
        string url = "http://127.0.0.1:19190/v1/chatbox";
        string dll = null, outPng = null;
        float meters = 1.35f, dist = 1.6f, height = 1.35f;
        bool followHead = false;
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
            else if (args[i] == "--follow") followHead = true;
            else if (args[i] == "--auto-hide" && i + 1 < args.Length) AutoHideSec = int.Parse(args[++i]);
            else if (args[i] == "--show-at-start") showAtStart = true;
            else if (args[i] == "--no-ctl") ctl = 0;
            else if (args[i] == "--ctl" && i + 1 < args.Length) ctl = int.Parse(args[++i]);
            else if (args[i] == "--seconds" && i + 1 < args.Length) diag = int.Parse(args[++i]);
        }
        BuildLayout();
        CurMeters = meters; CurDist = dist; CurDrop = 0.28f;
        if (mode == "--selftest") return SelfTest();
        if (mode == "--sim") return SimTest();
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
        if (mode == "--calibrate") return CtlClient("http://127.0.0.1:" + ctl + "/calibrate");
        if (mode == "--run") return RunOverlay(url, dll, meters, dist, height, followHead, 0, showAtStart, ctl, AutoHideSec);
        if (mode == "--diag") return RunOverlay(url, dll, meters, dist, height, followHead, diag > 0 ? diag : 15, true, 0, AutoHideSec);
        Log("用法: vrkeyboard.exe --selftest | --render [--out x.png] | --run [--fixed] [--url ...] | --diag [--seconds N]");
        return 1;
    }
}
