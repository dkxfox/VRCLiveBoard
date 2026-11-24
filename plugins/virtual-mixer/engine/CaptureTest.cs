using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

// S2a live capture smoke: record system loopback + microphone, mix through
// the Ducker, write a WAV for inspection. No speaker/output device is opened.
internal static class CaptureTest
{
    private const int Rate = 48000;
    private const int Channels = 2;

    public static int Run(string[] args)
    {
        // --capture-test <out.wav> <seconds> [renderId] [micId] [result.json]
        if (args.Length < 3) return Usage();
        string outWav = args[1];
        double seconds;
        if (!double.TryParse(args[2], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out seconds)) return Usage();
        if (seconds < 0.5 || seconds > 30) seconds = 2;
        string renderId = args.Length > 3 ? args[3] : "";
        string micId = args.Length > 4 ? args[4] : "";
        string resultJson = args.Length > 5 ? args[5] : null;

        MMDevice render = null, mic = null;
        WasapiLoopbackCapture loop = null;
        WasapiCapture micCap = null;
        try
        {
            using (var en = new MMDeviceEnumerator())
            {
                render = FindDevice(en, DataFlow.Render, renderId);
                mic = FindDevice(en, DataFlow.Capture, micId);
                if (render == null) throw new Exception("NO_RENDER_DEVICE");
                if (mic == null) throw new Exception("NO_MIC_DEVICE");

                loop = new WasapiLoopbackCapture(render);
                micCap = new WasapiCapture(mic);
                var sysBuf = new BufferedWaveProvider(loop.WaveFormat) { BufferDuration = TimeSpan.FromSeconds(2), DiscardOnBufferOverflow = true };
                var micBuf = new BufferedWaveProvider(micCap.WaveFormat) { BufferDuration = TimeSpan.FromSeconds(2), DiscardOnBufferOverflow = true };
                long sysBytes = 0, micBytes = 0;
                loop.DataAvailable += delegate (object s, WaveInEventArgs e) { if (e.BytesRecorded > 0) { sysBuf.AddSamples(e.Buffer, 0, e.BytesRecorded); sysBytes += e.BytesRecorded; } };
                micCap.DataAvailable += delegate (object s, WaveInEventArgs e) { if (e.BytesRecorded > 0) { micBuf.AddSamples(e.Buffer, 0, e.BytesRecorded); micBytes += e.BytesRecorded; } };

                var sys = Normalize(sysBuf);
                var micSp = Normalize(micBuf);
                loop.StartRecording();
                micCap.StartRecording();
                Thread.Sleep(250); // let the capture callbacks fill a little

                var duck = new Ducker(Rate);
                var wavFmt = WaveFormat.CreateIeeeFloatWaveFormat(Rate, Channels);
                long frames = 0;
                double duckMin = 1.0, duckMax = 0.0;
                double mixedPeak = 0.0;
                using (var writer = new WaveFileWriter(outWav, wavFmt))
                {
                    var sysBufF = new float[Rate * Channels / 100]; // 10ms
                    var micBufF = new float[Rate * Channels / 100];
                    var outBuf = new float[sysBufF.Length];
                    var sw = Stopwatch.StartNew();
                    while (sw.Elapsed.TotalSeconds < seconds)
                    {
                        ReadSome(sys, sysBufF, sysBufF.Length);
                        ReadSome(micSp, micBufF, micBufF.Length);
                        int framesThis = sysBufF.Length / Channels;
                        for (int i = 0; i < framesThis; i++)
                        {
                            float l = sysBufF[i * Channels];
                            float r = sysBufF[i * Channels + 1];
                            float music = (l + r) * 0.5f;
                            float micL = micBufF[i * Channels];
                            float micR = micBufF[i * Channels + 1];
                            float micMono = (micL + micR) * 0.5f;
                            float gain;
                            float ducked = duck.Process(music, micMono, out gain);
                            float mixed = ducked + micMono * 0.9f;
                            if (Math.Abs(mixed) > mixedPeak) mixedPeak = Math.Abs(mixed);
                            if (gain < duckMin) duckMin = gain;
                            if (gain > duckMax) duckMax = gain;
                            outBuf[i * Channels] = mixed;
                            outBuf[i * Channels + 1] = mixed;
                        }
                        writer.WriteSamples(outBuf, 0, outBuf.Length);
                        frames += framesThis;
                        Thread.Sleep(10);
                    }
                }
                try { loop.StopRecording(); } catch { }
                try { micCap.StopRecording(); } catch { }

                var json = "{\"ok\":true,\"mode\":\"capture-test\",\"seconds\":" + F(seconds) + ",\"renderDevice\":\"" + J(render.FriendlyName) + "\",\"micDevice\":\"" + J(mic.FriendlyName) +
                    "\",\"sampleRate\":" + Rate + ",\"channels\":" + Channels + ",\"frames\":" + frames + ",\"sysBytes\":" + sysBytes + ",\"micBytes\":" + micBytes +
                    ",\"duckMinGain\":" + F(duckMin) + ",\"duckMaxGain\":" + F(duckMax) + ",\"mixedPeak\":" + F(mixedPeak) + ",\"output\":\"" + J(outWav) + "\"}";
                if (!string.IsNullOrEmpty(resultJson)) WriteText(resultJson, json);
                Console.WriteLine(json);
                return frames > 0 && sysBytes > 0 ? 0 : 3;
            }
        }
        finally
        {
            try { if (loop != null) loop.Dispose(); } catch { }
            try { if (micCap != null) micCap.Dispose(); } catch { }
            try { if (render != null) render.Dispose(); } catch { }
            try { if (mic != null) mic.Dispose(); } catch { }
        }
    }

    private static int Usage()
    {
        Console.Error.WriteLine("  --capture-test <out.wav> <seconds> [renderId] [micId] [result.json]");
        return 2;
    }

    internal static MMDevice FindDevice(MMDeviceEnumerator en, DataFlow flow, string idOrName)
    {
        MMDevice fallback = null;
        try { fallback = en.GetDefaultAudioEndpoint(flow, Role.Console); } catch { }
        if (string.IsNullOrEmpty(idOrName)) return fallback;
        foreach (var d in en.EnumerateAudioEndPoints(flow, DeviceState.Active))
        {
            if (d.ID == idOrName || d.FriendlyName == idOrName) return d;
        }
        return fallback;
    }

    internal static ISampleProvider Normalize(BufferedWaveProvider buffer)
    {
        ISampleProvider sp = buffer.ToSampleProvider();
        if (sp.WaveFormat.SampleRate != Rate) sp = new WdlResamplingSampleProvider(sp, Rate);
        if (sp.WaveFormat.Channels == 1) sp = new MonoToStereoSampleProvider(sp);
        return sp;
    }

    internal static void ReadSome(ISampleProvider sp, float[] buf, int count)
    {
        int got = 0;
        while (got < count)
        {
            int n = sp.Read(buf, got, count - got);
            if (n <= 0) break;
            got += n;
        }
        for (int i = got; i < count; i++) buf[i] = 0f;
    }

    internal static void WriteText(string path, string text)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.WriteAllText(path, text, new UTF8Encoding(false));
    }

    internal static string J(string s)
    {
        if (s == null) return "";
        var sb = new StringBuilder();
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default: if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4")); else sb.Append(c); break;
            }
        }
        return sb.ToString();
    }

    internal static string F(double v) { return v.ToString("0.######", System.Globalization.CultureInfo.InvariantCulture); }
}
