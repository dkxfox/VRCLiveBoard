// 输入法候选窗探针(F-20260929-02 路线 2 可行性验证)
// 做一件事: 用 UI Automation 看"现在屏幕上有没有输入法候选窗, 里面有哪些候选词"。
// 为什么要它: OVR 的"选择窗口"只能点一个窗口, 而候选窗是独立顶层窗口 -> 点不着;
//   如果 UIA 能稳定读到候选文本, 我们就可以在自己界面里画一份, 再由数字键回送完成选词。
// 用法: ime-probe.exe [观察秒数=60] [轮询毫秒=300]
// 输出: 每轮打印 顶层窗口(UIA 视角) + 候选相关节点的文本; 只在内容变化时打印, 免得刷屏。
using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Windows.Automation;

class ImeProbe
{
    static string Safe(Func<string> f) { try { return f() ?? ""; } catch (Exception) { return ""; } }

    static string NodeLine(AutomationElement e)
    {
        string cls = Safe(delegate { return e.Current.ClassName; });
        string name = Safe(delegate { return e.Current.Name; });
        int pid = 0; try { pid = e.Current.ProcessId; } catch (Exception) { }
        string ctl = Safe(delegate { return e.Current.ControlType.ProgrammaticName; });
        return ctl.Replace("ControlType.", "") + " | " + cls + " | pid=" + pid + " | " + name;
    }

    // 判断"这个字符串像不像候选词": 含中文/日文, 或者本身就是拼音串
    static bool LooksLikeCandidate(string s)
    {
        if (string.IsNullOrEmpty(s)) return false;
        if (s.Length > 24) return false;
        foreach (char c in s) { if (c >= 0x4E00 && c <= 0x9FFF) return true; if (c >= 0x3040 && c <= 0x30FF) return true; }
        return false;
    }

    static int Main(string[] args)
    {
        int seconds = args.Length > 0 ? int.Parse(args[0]) : 60;
        int delay = args.Length > 1 ? int.Parse(args[1]) : 300;
        Console.WriteLine("[探针] 观察 " + seconds + " 秒, 每 " + delay + "ms 一次。请现在切到任意输入框打拼音(如 nihao)。");
        var last = "";
        var deadline = DateTime.Now.AddSeconds(seconds);
        while (DateTime.Now < deadline)
        {
            var sb = new StringBuilder();
            try
            {
                AutomationElement root = AutomationElement.RootElement;
                AutomationElementCollection wins = root.FindAll(TreeScope.Children, Condition.TrueCondition);
                foreach (AutomationElement w in wins)
                {
                    string wname = Safe(delegate { return w.Current.Name; });
                    string wcls = Safe(delegate { return w.Current.ClassName; });
                    int wpid = 0; try { wpid = w.Current.ProcessId; } catch (Exception) { }
                    bool interesting = wcls.IndexOf("IME", StringComparison.OrdinalIgnoreCase) >= 0
                        || wcls.IndexOf("Candidate", StringComparison.OrdinalIgnoreCase) >= 0
                        || wcls.IndexOf("TextInput", StringComparison.OrdinalIgnoreCase) >= 0
                        || wname.IndexOf("候选", StringComparison.Ordinal) >= 0
                        || wname.IndexOf("拼音", StringComparison.Ordinal) >= 0;
                    string pname = "";
                    try { pname = System.Diagnostics.Process.GetProcessById(wpid).ProcessName; } catch (Exception) { }
                    if (pname.IndexOf("TextInputHost", StringComparison.OrdinalIgnoreCase) >= 0
                        || pname.IndexOf("Sogou", StringComparison.OrdinalIgnoreCase) >= 0
                        || pname.IndexOf("QQPinyin", StringComparison.OrdinalIgnoreCase) >= 0
                        || pname.IndexOf("ChsIME", StringComparison.OrdinalIgnoreCase) >= 0) interesting = true;
                    if (!interesting) continue;
                    sb.AppendLine("窗口: " + wcls + " | pid=" + wpid + "(" + pname + ") | " + wname);
                    AutomationElementCollection kids = w.FindAll(TreeScope.Descendants, Condition.TrueCondition);
                    int shown = 0;
                    foreach (AutomationElement k in kids)
                    {
                        string nm = Safe(delegate { return k.Current.Name; });
                        if (!LooksLikeCandidate(nm)) continue;
                        sb.AppendLine("    候选?: " + NodeLine(k));
                        if (++shown >= 30) break;
                    }
                    if (shown == 0) sb.AppendLine("    (没有中文文本节点)");
                }
            }
            catch (Exception ex) { sb.AppendLine("异常: " + ex.Message); }
            string now = sb.ToString();
            if (now != last && now.Trim().Length > 0) { Console.WriteLine("---- " + DateTime.Now.ToString("HH:mm:ss") + " ----"); Console.Write(now); last = now; }
            Thread.Sleep(delay);
        }
        Console.WriteLine("[探针] 结束。");
        return 0;
    }
}
