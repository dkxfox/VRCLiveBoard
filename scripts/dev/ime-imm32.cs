// IMM32 候选词探针(F-20260929-02 路线 2 的决定性验证)
// 背景: UIA 能看见候选窗(类名 SoPY_Comp), 但读不到里面的候选词(自绘, 没有子控件)。
// 正确做法是 IMM32 的 GCS_CANDIDATELIST —— 但它必须由**持有 IME 上下文的那个线程**调用,
//   也就是"正在被输入的那个窗口所在的进程"。所以这个探针自己开一个窗口, 让用户在里面打字。
// 用法: 运行 -> 在窗口的输入框里打拼音 -> 下方会实时列出输入法给出的候选词与当前选中项。
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

    TextBox box;
    TextBox outBox;
    Timer timer;
    string last = "";

    public ImeImm32Probe()
    {
        Text = "输入法候选词探针 —— 请在下面的框里打拼音(如 nihao)";
        Width = 720; Height = 420;
        box = new TextBox(); box.Multiline = true; box.Height = 120; box.Dock = DockStyle.Top; box.Font = new System.Drawing.Font("Microsoft YaHei UI", 14f);
        outBox = new TextBox(); outBox.Multiline = true; outBox.ScrollBars = ScrollBars.Vertical; outBox.Dock = DockStyle.Fill; outBox.ReadOnly = true;
        outBox.Font = new System.Drawing.Font("Consolas", 10f);
        Controls.Add(outBox); Controls.Add(box);
        timer = new Timer(); timer.Interval = 150; timer.Tick += delegate { Poll(); }; timer.Start();
    }

    static string Str(IntPtr himc, int kind)
    {
        int n = ImmGetCompositionString(himc, kind, null, 0);
        if (n <= 0) return "";
        var buf = new byte[n];
        ImmGetCompositionString(himc, kind, buf, n);
        return Encoding.Unicode.GetString(buf);
    }

    void Poll()
    {
        try
        {
            IntPtr himc = ImmGetContext(box.Handle);
            if (himc == IntPtr.Zero) { Show("(拿不到 IME 上下文)"); return; }
            try
            {
                string comp = Str(himc, GCS_COMPSTR);
                string result = Str(himc, GCS_RESULTSTR);
                var sb = new StringBuilder();
                sb.AppendLine("组字串(拼音): " + (comp.Length > 0 ? comp : "(空)"));
                int need = ImmGetCompositionString(himc, GCS_CANDIDATELIST, null, 0);
                if (need > 0)
                {
                    var buf = new byte[need];
                    ImmGetCompositionString(himc, GCS_CANDIDATELIST, buf, need);
                    // CANDIDATELIST: dwSize, dwStyle, dwCount, dwSelection, dwPageStart, dwPageSize, dwOffset[dwCount]
                    int count = BitConverter.ToInt32(buf, 8);
                    int sel = BitConverter.ToInt32(buf, 12);
                    int pageStart = BitConverter.ToInt32(buf, 16);
                    int pageSize = BitConverter.ToInt32(buf, 20);
                    sb.AppendLine("候选数: " + count + "   当前选中: " + sel + "   本页: [" + pageStart + ", +" + pageSize + ")");
                    for (int i = 0; i < count && i < 40; i++)
                    {
                        int off = BitConverter.ToInt32(buf, 24 + i * 4);
                        if (off < 0 || off >= buf.Length) continue;
                        int end = off;
                        while (end + 1 < buf.Length && !(buf[end] == 0 && buf[end + 1] == 0)) end += 2;
                        string s = Encoding.Unicode.GetString(buf, off, end - off);
                        sb.AppendLine((i == sel ? "  > " : "    ") + (i + 1) + ". " + s);
                    }
                }
                else sb.AppendLine("候选列表: (IME 没给 GCS_CANDIDATELIST —— 可能是 TSF-only 输入法)");
                if (result.Length > 0) sb.AppendLine("== 上一次上屏: " + result);
                Show(sb.ToString());
            }
            finally { ImmReleaseContext(box.Handle, himc); }
        }
        catch (Exception ex) { Show("异常: " + ex.Message); }
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
        Console.WriteLine("[IMM32 探针] 已启动: 请在弹出窗口的输入框里打拼音, 候选词会打印在这里。");
        Application.Run(new ImeImm32Probe());
    }
}
