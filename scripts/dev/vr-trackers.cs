// SteamVR 追踪设备探针(dev 工具): 直接问运行时"现在有哪些设备、姿势是什么、动没动"
// 用途: F-20260929-01 路线 B 排障 —— 判断"我们的姿态有没有真的进到 SteamVR"。
// 用法: vr-trackers.exe [间隔秒=2] [次数=3]
// 说明: 以 **Background** 身份连 OpenVR(不影响正在运行的游戏), 用 IVRSystem 的设备类/角色提示/序列号 + 绝对姿势。
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

class VRTrackers
{
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr VR_InitInternal(ref int peError, int eApplicationType);
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern void VR_ShutdownInternal();
    [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr VR_GetGenericInterface(string pchInterfaceVersion, ref int peError);

    [StructLayout(LayoutKind.Sequential)]
    struct HmdMatrix34_t { public float m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11; }
    [StructLayout(LayoutKind.Sequential)]
    struct HmdVector3_t { public float v0, v1, v2; }
    [StructLayout(LayoutKind.Sequential)]
    struct TrackedDevicePose_t
    {
        public HmdMatrix34_t mDeviceToAbsoluteTracking;
        public HmdVector3_t vVelocity, vAngularVelocity;
        public int eTrackingResult;
        public byte bPoseIsValid, bDeviceIsConnected;
    }

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate void GetPosesFn(IntPtr self, int eOrigin, float fPredicted, [Out] TrackedDevicePose_t[] poses, uint count);
    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate int GetClassFn(IntPtr self, uint idx);
    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate byte IsConnectedFn(IntPtr self, uint idx);
    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate int GetInt32PropFn(IntPtr self, uint idx, int prop, ref int err);
    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate uint GetStringPropFn(IntPtr self, uint idx, int prop, StringBuilder value, uint len, ref int err);

    static T Vt<T>(IntPtr obj, int index) where T : class
    {
        IntPtr vtable = Marshal.ReadIntPtr(obj);
        IntPtr fn = Marshal.ReadIntPtr(vtable, index * IntPtr.Size);
        return (T)(object)Marshal.GetDelegateForFunctionPointer(fn, typeof(T));
    }

    const int Prop_ControllerRoleHint_Int32 = 3007;
    const int Prop_SerialNumber_String = 1002;
    const int Prop_ModelNumber_String = 1001;
    const int MaxDevices = 64;

    static string RoleName(int hint)
    {
        switch (hint)
        {
            case 0: return "None";
            case 1: return "LeftHand"; case 2: return "RightHand"; case 3: return "OptOut";
            case 4: return "Treadmill"; case 5: return "Stylus";
            default: return "hint" + hint;
        }
    }

    static int Main(string[] args)
    {
        int gap = args.Length > 0 ? int.Parse(args[0]) : 2;
        int times = args.Length > 1 ? int.Parse(args[1]) : 3;
        int err = 0;
        IntPtr ctx = VR_InitInternal(ref err, 3);   // 3 = Background
        Console.WriteLine("[探针] VR_InitInternal(Background) err=" + err);
        IntPtr sys = IntPtr.Zero;
        foreach (string ver in new string[] { "IVRSystem_026", "IVRSystem_025", "IVRSystem_027" })
        {
            int ge = 0;
            sys = VR_GetGenericInterface(ver, ref ge);
            if (sys != IntPtr.Zero) { Console.WriteLine("[探针] 接口 " + ver + " 0x" + sys.ToInt64().ToString("X")); break; }
        }
        if (sys == IntPtr.Zero) { Console.WriteLine("[探针] 拿不到 IVRSystem —— SteamVR 没在跑?"); VR_ShutdownInternal(); return 2; }

        GetPosesFn getPoses = Vt<GetPosesFn>(sys, 12);
        GetClassFn getClass = Vt<GetClassFn>(sys, 20);
        IsConnectedFn isConn = Vt<IsConnectedFn>(sys, 21);
        GetInt32PropFn getInt = Vt<GetInt32PropFn>(sys, 24);
        GetStringPropFn getStr = Vt<GetStringPropFn>(sys, 28);

        TrackedDevicePose_t[][] snapshots = new TrackedDevicePose_t[times][];
        for (int t = 0; t < times; t++)
        {
            var poses = new TrackedDevicePose_t[MaxDevices];
            getPoses(sys, 1, 0f, poses, MaxDevices);   // 1 = Standing
            snapshots[t] = poses;
            Console.WriteLine("--- 第 " + (t + 1) + " 次快照 ---");
            int shown = 0;
            for (uint i = 0; i < MaxDevices; i++)
            {
                int cls = getClass(sys, i);
                if (cls <= 0) continue;
                if (isConn(sys, i) == 0) { Console.WriteLine("  [" + i + "] 类别=" + cls + " 未连接"); continue; }
                int e1 = 0, hint = getInt(sys, i, Prop_ControllerRoleHint_Int32, ref e1);
                var sb = new StringBuilder(128); int e2 = 0;
                getStr(sys, i, Prop_SerialNumber_String, sb, 128, ref e2);
                var sb2 = new StringBuilder(128); int e3 = 0;
                getStr(sys, i, Prop_ModelNumber_String, sb2, 128, ref e3);
                TrackedDevicePose_t p = poses[i];
                float x = p.mDeviceToAbsoluteTracking.m3, y = p.mDeviceToAbsoluteTracking.m7, z = p.mDeviceToAbsoluteTracking.m11;
                Console.WriteLine("  [" + i + "] 类=" + cls + " 角色=" + RoleName(hint) + " 序列号=" + sb.ToString() +
                    " 型号=" + sb2.ToString() + " 有效=" + p.bPoseIsValid +
                    " 位置=(" + x.ToString("0.000") + "," + y.ToString("0.000") + "," + z.ToString("0.000") + ")");
                shown++;
            }
            Console.WriteLine("  (在册设备 " + shown + " 个)");
            if (t < times - 1) Thread.Sleep(gap * 1000);
        }
        // 对比首尾快照, 看"动没动"
        Console.WriteLine("--- 两次快照间的位移(米) ---");
        for (uint i = 0; i < MaxDevices; i++)
        {
            int cls = getClass(sys, i);
            if (cls <= 0 || isConn(sys, i) == 0) continue;
            var a = snapshots[0][i].mDeviceToAbsoluteTracking;
            var b = snapshots[times - 1][i].mDeviceToAbsoluteTracking;
            double d = Math.Sqrt(Math.Pow(a.m3 - b.m3, 2) + Math.Pow(a.m7 - b.m7, 2) + Math.Pow(a.m11 - b.m11, 2));
            Console.WriteLine("  [" + i + "] 位移=" + d.ToString("0.0000") + " 米");
        }
        VR_ShutdownInternal();
        return 0;
    }
}
