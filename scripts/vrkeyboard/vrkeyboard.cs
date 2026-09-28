// VR 覆盖层键盘(F-20260925-02 P1, 2026-09-29) —— 独立原生工具, 不进主体包。
// 为什么是独立工具: 主体是 Node/Electron, 拿不到 OpenVR 原生能力(见功能卡 D1 决策树)。
// 技术选型: C# + Windows 自带 csc.exe(与 scripts/launcher 同一套, 零工具链) + P/Invoke openvr_api.dll(SteamVR 自带)。
// 显示: GDI+ 离屏位图 -> PNG 文件 -> SetOverlayFromFile(不用 D3D, P1 阶段够用)。
// 交互: 覆盖层鼠标事件(射线指到面板 + 扣扳机), 事件坐标是 GL 空间(左下角 0,0), 要翻 Y。
// 输出: 文本直接 POST 给主程序既有的 /v1/chatbox(不另造链路)。
//
// 用法:
//   vrkeyboard.exe --selftest                 无 VR, 自检(渲染 + 命中 + 打字 + 发送路径)
//   vrkeyboard.exe --render out.png           只渲染一张面板图
//   vrkeyboard.exe --run [--url http://...]   真跑覆盖层(需要 SteamVR 在运行)
//   vrkeyboard.exe --dll <path>               指定 openvr_api.dll
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

    static readonly string OverlayKey = "vrcliveboard.keyboard";
    static readonly string OverlayName = "VRCLiveBoard 键盘";

    // ---------- 布局 ----------
    class Key
    {
        public string Label;
        public string Value;      // 单字符键就是字符; 特殊键是动作名
        public RectangleF Rect;
        public bool Special;
    }

    static List<Key> Keys = new List<Key>();
    static string Line = "";
    static string Status = "点字母打字, 回车发送";
    static string LastSent = null;
    static bool DryRun = false;

    static void BuildLayout()
    {
        Keys.Clear();
        string[] rows = new string[] { "qwertyuiop", "asdfghjkl", "zxcvbnm" };
        float pad = 18f, gap = 10f;
        float keyH = 92f, top = 150f;
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
        // 底部功能键
        float by = top + 3 * (keyH + gap);
        float bw = 200f;
        float bx = pad;
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
            g.Clear(Color.FromArgb(255, 18, 20, 28));
            using (SolidBrush b = new SolidBrush(Color.FromArgb(255, 26, 30, 42)))
                g.FillRectangle(b, new Rectangle(0, 0, W, H));
            // 标题
            using (Font f = new Font("Microsoft YaHei UI", 30f, FontStyle.Bold))
            using (SolidBrush b = new SolidBrush(Color.FromArgb(255, 235, 238, 245)))
                g.DrawString("VRCLiveBoard 键盘", f, b, pad2(), 28f);
            // 输入行
            RectangleF lineRect = new RectangleF(18f, 78f, W - 36f, 52f);
            using (SolidBrush b = new SolidBrush(Color.FromArgb(255, 12, 14, 20)))
                g.FillRectangle(b, lineRect);
            using (Pen p = new Pen(Color.FromArgb(255, 70, 120, 220), 2f))
                g.DrawRectangle(p, lineRect.X, lineRect.Y, lineRect.Width, lineRect.Height);
            using (Font f = new Font("Microsoft YaHei UI", 24f))
            using (SolidBrush b = new SolidBrush(Color.FromArgb(255, 240, 244, 252)))
                g.DrawString(Line.Length == 0 ? "(点字母开始打字)" : Line, f, b, lineRect.X + 12f, lineRect.Y + 8f);
            // 键
            foreach (Key k in Keys)
            {
                using (SolidBrush b = new SolidBrush(k.Special ? Color.FromArgb(255, 44, 58, 88) : Color.FromArgb(255, 38, 44, 60)))
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
            // 状态行
            using (Font f = new Font("Microsoft YaHei UI", 18f))
            using (SolidBrush b = new SolidBrush(Color.FromArgb(255, 150, 200, 160)))
                g.DrawString(Status, f, b, pad2(), H - 44f);
        }
        return bmp;
    }

    static float pad2() { return 20f; }

    // ---------- 命中(UV -> 像素; 覆盖层 UV 原点在左下角, 要翻 Y) ----------
    static Key Hit(float u, float v)
    {
        float px = u * W;
        float py = (1f - v) * H;
        foreach (Key k in Keys)
        {
            if (px >= k.Rect.X && px <= k.Rect.Right && py >= k.Rect.Y && py <= k.Rect.Bottom) return k;
        }
        return null;
    }

    // ---------- 输入处理 ----------
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
            else { Status = "发送失败(主程序没在跑?)"; }
        }
    }

    // ---------- 发送: 走主程序既有的 /v1/chatbox ----------
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
            {
                return (int)resp.StatusCode >= 200 && (int)resp.StatusCode < 300;
            }
        }
        catch (Exception) { return false; }
    }

    static string JsonEscape(string s)
    {
        StringBuilder sb = new StringBuilder();
        foreach (char c in s)
        {
            if (c == '"' ) sb.Append("\\\"");
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
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr VR_InitInternal(ref int peError, int eApplicationType);
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern void VR_ShutdownInternal();
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern bool VR_IsRuntimeInstalled();
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern bool VR_IsHmdPresent();
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr VR_GetStringForHmdError(int eError);
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr VROverlay();

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int CreateOverlayFn(IntPtr self, string key, string name, out ulong handle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int DestroyOverlayFn(IntPtr self, ulong handle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int SetOverlayFlagFn(IntPtr self, ulong handle, int flag, bool enabled);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int SetOverlayWidthInMetersFn(IntPtr self, ulong handle, float meters);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int SetOverlayTransformAbsoluteFn(IntPtr self, ulong handle, int origin, ref HmdMatrix34_t m);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int ShowOverlayFn(IntPtr self, ulong handle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int HideOverlayFn(IntPtr self, ulong handle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int PollNextOverlayEventFn(IntPtr self, ulong handle, ref VREvent_t ev, uint size);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int SetOverlayInputMethodFn(IntPtr self, ulong handle, int method);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int SetOverlayMouseScaleFn(IntPtr self, ulong handle, float x, float y);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int SetOverlayFromFileFn(IntPtr self, ulong handle, string path);

    [StructLayout(LayoutKind.Sequential)]
    struct HmdMatrix34_t
    {
        public float m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11;
    }

    // VREvent_t = 64 字节(eventType/trackedDeviceIndex/eventAgeSeconds 之后是 48 字节的 union, 鼠标字段在 union 起点)
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
        string[] cands = new string[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam\\steamapps\\common\\SteamVR\\bin\\win64\\openvr_api.dll"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Steam\\steamapps\\common\\SteamVR\\bin\\win64\\openvr_api.dll"),
            "D:\\Steam\\steamapps\\common\\SteamVR\\bin\\win64\\openvr_api.dll",
            "D:\\SteamLibrary\\steamapps\\common\\SteamVR\\bin\\win64\\openvr_api.dll",
            "E:\\SteamLibrary\\steamapps\\common\\SteamVR\\bin\\win64\\openvr_api.dll"
        };
        foreach (string c in cands) if (File.Exists(c)) return c;
        return null;
    }

    static string TempPng(int n)
    {
        return Path.Combine(Path.GetTempPath(), "vrcb-vrkeyboard-" + n + ".png");
    }

    // ---------- 自检(不需要 VR) ----------
    static int SelfTest()
    {
        int fail = 0;
        BuildLayout();
        Console.WriteLine("[自检] 键位 " + Keys.Count + " 个");
        if (Keys.Count != 30) { Console.WriteLine("  FAIL 键位数应为 30(zxcvbnm 那行是 7 个)"); fail++; }
        Bitmap bmp = Render();
        string png = TempPng(9);
        bmp.Save(png, ImageFormat.Png);
        FileInfo fi = new FileInfo(png);
        Console.WriteLine("[自检] 渲染 PNG " + png + " (" + (fi.Length / 1024) + "KB)");
        if (fi.Length < 5000) { Console.WriteLine("  FAIL 渲染结果太小, 可能是空图"); fail++; }
        // 命中测试: 每个键的中心都必须命中它自己
        int miss = 0;
        foreach (Key k in Keys)
        {
            float u = (k.Rect.X + k.Rect.Width / 2f) / W;
            float v = 1f - ((k.Rect.Y + k.Rect.Height / 2f) / H);
            Key hit = Hit(u, v);
            if (hit == null || hit.Value != k.Value) miss++;
        }
        if (miss == 0) Console.WriteLine("  PASS 命中测试: 全部 " + Keys.Count + " 个键的中心都能命中自己");
        else { Console.WriteLine("  FAIL 命中测试: " + miss + " 个键的中心没命中自己"); fail++; }
        // 打字 -> 发送路径
        DryRun = true;
        Line = "";
        string typed = "nihao";
        foreach (char c in typed)
        {
            foreach (Key k in Keys) if (k.Value == c.ToString()) { PressKey(k, "http://127.0.0.1:1/v1/chatbox"); break; }
        }
        if (Line == typed) Console.WriteLine("  PASS 打字: " + typed + " -> 输入行 '" + Line + "'");
        else { Console.WriteLine("  FAIL 打字: 期望 '" + typed + "' 实得 '" + Line + "'"); fail++; }
        foreach (Key k in Keys) if (k.Value == "back") { PressKey(k, "x"); break; }
        if (Line == "niha") Console.WriteLine("  PASS 退格: -> '" + Line + "'");
        else { Console.WriteLine("  FAIL 退格: 期望 'niha' 实得 '" + Line + "'"); fail++; }
        foreach (Key k in Keys) if (k.Value == "enter") { PressKey(k, "http://127.0.0.1:1/v1/chatbox"); break; }
        if (LastSent == "niha" && Line == "") Console.WriteLine("  PASS 发送路径: 收到 '" + LastSent + "' 且输入行已清空");
        else { Console.WriteLine("  FAIL 发送路径: LastSent='" + LastSent + "' Line='" + Line + "'"); fail++; }
        // 空输入不该发
        LastSent = null;
        foreach (Key k in Keys) if (k.Value == "enter") { PressKey(k, "x"); break; }
        if (LastSent == null) Console.WriteLine("  PASS 空输入不发送");
        else { Console.WriteLine("  FAIL 空输入竟然发送了"); fail++; }
        Console.WriteLine(fail == 0 ? "[自检] 全部通过" : ("[自检] " + fail + " 项失败"));
        return fail == 0 ? 0 : 1;
    }

    // ---------- 真跑覆盖层 ----------
    static int RunOverlay(string url, string dll, float meters, float dist, float height)
    {
        string dllPath = FindOpenVr(dll);
                Console.WriteLine("[错误] 找不到 openvr_api.dll(装 SteamVR 后一般在 SteamVR 安装目录的 bin/win64 下)");
        Console.WriteLine("[信息] openvr_api.dll = " + dllPath);
        SetDllDirectory(Path.GetDirectoryName(dllPath));
        if (!VR_IsRuntimeInstalled()) { Console.WriteLine("[错误] SteamVR 运行时没装/没找到"); return 2; }
        if (!VR_IsHmdPresent()) { Console.WriteLine("[错误] 没检测到头显 —— 先把 SteamVR 跑起来再试"); return 2; }
        int err = 0;
        IntPtr ctx = VR_InitInternal(ref err, AppTypeOverlay);
        if (err != 0 || ctx == IntPtr.Zero)
        {
            string msg = Marshal.PtrToStringAnsi(VR_GetStringForHmdError(err));
            Console.WriteLine("[错误] VR_Init 失败(" + err + "): " + msg);
            return 2;
        }
        ulong handle = 0;
        try
        {
            IntPtr ov = VROverlay();
            CreateOverlayFn create = Vt<CreateOverlayFn>(ov, 1);
            int e = create(ov, OverlayKey, OverlayName, out handle);
            if (e != 0) { Console.WriteLine("[错误] CreateOverlay 失败: " + e); return 2; }
            Vt<SetOverlayFlagFn>(ov, 11)(ov, handle, (int)FlagInteractive, true);   // 让可见的覆盖层也能收射线输入
            Vt<SetOverlayWidthInMetersFn>(ov, 22)(ov, handle, meters);
            Vt<SetOverlayInputMethodFn>(ov, 50)(ov, handle, InputMethodMouse);
            Vt<SetOverlayMouseScaleFn>(ov, 52)(ov, handle, W, H);
            HmdMatrix34_t m = new HmdMatrix34_t();
            m.m0 = 1f; m.m5 = 1f; m.m10 = 1f;
            m.m3 = 0f; m.m7 = height; m.m11 = -dist;
            Vt<SetOverlayTransformAbsoluteFn>(ov, 33)(ov, handle, UniverseStanding, ref m);
            ShowOverlayFn show = Vt<ShowOverlayFn>(ov, 43);
            show(ov, handle);
            PollNextOverlayEventFn poll = Vt<PollNextOverlayEventFn>(ov, 48);
            SetOverlayFromFileFn setFile = Vt<SetOverlayFromFileFn>(ov, 63);
            Console.WriteLine("[信息] 覆盖层已显示(键 " + OverlayKey + "); 射线指到面板上就能点。Ctrl+C 退出。");
            int frame = 0;
            bool dirty = true;
            Bitmap last = null;
            while (true)
            {
                if (dirty)
                {
                    last = Render();
                    string f = TempPng(frame % 2);
                    last.Save(f, ImageFormat.Png);
                    setFile(ov, handle, f);
                    frame++;
                    dirty = false;
                }
                VREvent_t ev = new VREvent_t();
                bool got = poll(ov, handle, ref ev, 64u) != 0;
                if (got)
                {
                    if (ev.eventType == EvMouseDown && ev.mouseButton == MouseLeft)
                    {
                        Key k = Hit(ev.mouseX, ev.mouseY);
                        if (k != null) { PressKey(k, url); dirty = true; }
                    }
                }
                else Thread.Sleep(15);
            }
        }
        finally
        {
            try { if (handle != 0) Vt<DestroyOverlayFn>(VROverlay(), 3)(VROverlay(), handle); } catch (Exception) { }
            VR_ShutdownInternal();
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetDllDirectory(string lpPathName);

    static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        string mode = args.Length > 0 ? args[0] : "--selftest";
        string url = "http://127.0.0.1:19190/v1/chatbox";
        string dll = null, outPng = null;
        float meters = 1.35f, dist = 1.6f, height = 1.35f;
        for (int i = 1; i < args.Length; i++)
        {
            if (args[i] == "--url" && i + 1 < args.Length) url = args[++i];
            else if (args[i] == "--dll" && i + 1 < args.Length) dll = args[++i];
            else if (args[i] == "--out" && i + 1 < args.Length) outPng = args[++i];
            else if (args[i] == "--meters" && i + 1 < args.Length) meters = float.Parse(args[++i]);
            else if (args[i] == "--dist" && i + 1 < args.Length) dist = float.Parse(args[++i]);
            else if (args[i] == "--height" && i + 1 < args.Length) height = float.Parse(args[++i]);
        }
        BuildLayout();
        if (mode == "--selftest") return SelfTest();
        if (mode == "--render")
        {
            Bitmap b = Render();
            string p = outPng != null ? outPng : Path.Combine(Directory.GetCurrentDirectory(), "vrkeyboard-preview.png");
            b.Save(p, ImageFormat.Png);
            Console.WriteLine("已渲染: " + p);
            return 0;
        }
        if (mode == "--run") return RunOverlay(url, dll, meters, dist, height);
        Console.WriteLine("用法: vrkeyboard.exe --selftest | --render [--out x.png] | --run [--url ...] [--dll ...]");
        return 1;
    }
}
