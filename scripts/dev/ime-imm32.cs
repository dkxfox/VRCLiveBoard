// IMM32 候选词探针 v2(F-20260929-02 路线 2): 防御式解析 + 头部 hex 现场取证
// v1 的教训: 微软拼音**确实返回了候选列表**(一返回就把 v1 的解析搞崩了), 说明这条路有戏;
//   但不同输入法返回的布局/长度不同, 所以这版把所有下标都做边界检查, 并把头部原样打出来。
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

class ImeImm32Probe : Form
{
    [DllImport("imm32.dll")] static extern IntPtr ImmGetContext(IntPtr hWnd);
    [DllImport("imm32.dll")] static extern bool ImmReleaseContext(IntPtr hWnd, IntPtr hIMC);
    [DllImport("imm32.dll", CharSet = CharSet.Unicode)] static extern int ImmGetCompositionString(IntPtr hIMC, int dwIndex, byte[] lpBuf, int dwBufLen);
    const int GCS_COMPSTR = 0x0008;
    const int GCS_CANDIDATELIST = 0x0010;
    const int GCS_RESULTSTR = 0x0800;

    TextBox box, outBox;
    Timer timer;
    string last = "";

    public ImeImm32Probe()
    {
        Text = "输入法候选词探针 v2 —— 请在这里打拼音(拼音串与候选词会同时显示在下面)";
        Width = 760; Height = 460;
        box = new TextBox(); box.Multiline = true; box.Height = 110; box.Dock = DockStyle.Top;
        box.Font = new System.Drawing.Font("Microsoft YaHei UI", 14f);
        outBox = new TextBox(); outBox.Multiline = true; outBox.ScrollBars = ScrollBars.Vertical;
        outBox.Dock = DockStyle.Fill; outBox.ReadOnly = true; outBox.Font = new System.Drawing.Font("Consolas", 10f);
        Controls.Add(outBox); Controls.Add(box);
        timer = new Timer(); timer.Interval = 150; timer.Tick += delegate { Poll(); }; timer.Start();
    }

    static string Str(IntPtr himc, int kind)
    {
        try
        {
            int n = ImmGetCompositionString(himc, kind, null, 0);
            if (n <= 0) return "";
            var buf = new byte[n];
            int got = ImmGetCompositionString(himc, kind, buf, n);
            if (got <= 0) return "";
            return Encoding.Unicode.GetString(buf, 0, Math.Min(got, buf.Length));
        }
        catch (Exception) { return ""; }
    }

    void Poll()
    {
        var sb = new StringBuilder();
        try
        {
            IntPtr himc = ImmGetContext(box.Handle);
            if (himc == IntPtr.Zero) { Show("(拿不到 IME 上下文 —— 先点一下输入框)"); return; }
            try
            {
                string comp = Str(himc, GCS_COMPSTR);
                string result = Str(himc, GCS_RESULTSTR);
                sb.AppendLine("组字串: " + (comp.Length > 0 ? comp : "(空)"));
                int need = ImmGetCompositionString(himc, GCS_CANDIDATELIST, null, 0);
                if (need <= 0) { sb.AppendLine("候选列表: 长度为 0(这个输入法没给)"); }
                else
                {
                    var buf = new byte[need];
                    int got = ImmGetCompositionString(himc, GCS_CANDIDATELIST, buf, need);
                    sb.AppendLine("候选列表: 申请 " + need + " 字节, 实际返回 " + got + " 字节");
                    int count = buf.Length >= 12 ? BitConverter.ToInt32(buf, 8) : 0;
                    int sel = buf.Length >= 16 ? BitConverter.ToInt32(buf, 12) : 0;
                    int pageStart = buf.Length >= 20 ? BitConverter.ToInt32(buf, 16) : 0;
                    int pageSize = buf.Length >= 24 ? BitConverter.ToInt32(buf, 20) : 0;
                    sb.AppendLine("  count=" + count + " sel=" + sel + " pageStart=" + pageStart + " pageSize=" + pageSize);
                    var hex = new StringBuilder();
                    for (int h = 0; h < buf.Length && h < 40; h++) hex.Append(buf[h].ToString("X2")).Append(' ');
                    sb.AppendLine("  头 40 字节: " + hex);
                    int max = Math.Min(Math.Max(count, 0), 40);
                    for (int i = 0; i < max; i++)
                    {
                        int pos = 24 + i * 4;
                        if (pos + 4 > buf.Length) { sb.AppendLine("  (偏移表越界, 停止)"); break; }
                        int off = BitConverter.ToInt32(buf, pos);
                        if (off < 0 || off + 1 >= buf.Length) { sb.AppendLine("  " + (i + 1) + ". (偏移 " + off + " 越界)"); continue; }
                        int end = off;
                        while (end + 1 < buf.Length && !(buf[end] == 0 && buf[end + 1] == 0)) end += 2;
                        int len = Math.Max(0, Math.Min(end - off, buf.Length - off));
                        sb.AppendLine((i == sel ? "  > " : "    ") + (i + 1) + ". " + Encoding.Unicode.GetString(buf, off, len));
                    }
                }
                if (result.Length > 0) sb.AppendLine("上一次上屏: " + result);
            }
            finally { ImmReleaseContext(box.Handle, himc); }
        }
        catch (Exception ex) { sb.AppendLine("异常: " + ex.Message); }
        Show(sb.ToString());
    }

    void Show(string s)
    {
        if (s == last) return;
        last = s;
        outBox.Text = s;
        Console.WriteLine("---- " + DateTime.Now.ToString("HH:mm:ss") + " ----");
        Console.WriteLine(s);
    }

    [STAThread]
    static void Main()
    {
        Console.WriteLine("[IMM32 探针 v2] 已启动: 请在窗口里打拼音; 拼音串/候选词/头部 hex 都会打印到这里。");
        Application.Run(new ImeImm32Probe());
    }
}
