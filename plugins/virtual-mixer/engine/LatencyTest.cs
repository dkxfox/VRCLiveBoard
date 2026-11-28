using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

// Latency probe: play a known 1 kHz tone into CABLE Input and detect its
// arrival on CABLE Output. This measures engine -> CABLE output latency only;
// VRChat's own voice path is measured separately.
internal static class LatencyTest
{
    private const int Rate = 48000;
    private const int Channels = 2;

    private static MMDevice FindCable(MMDeviceEnumerator en, DataFlow flow, string label)
    {
        foreach (var d in en.EnumerateAudioEndPoints(flow, DeviceState.Active))
        {
            if (d.FriendlyName.IndexOf(label, StringComparison.OrdinalIgnoreCase) >= 0) return d;
        }
        return null;
    }

    public static int Run(string[] args)
    {
        // --latency-test [seconds] [result.json]
        double seconds = 3;
        string resultJson = null;
        if (args.Length > 1) double.TryParse(args[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out seconds);
        if (seconds < 1 || seconds > 10) seconds = 3;
        if (args.Length > 2) resultJson = args[2];

        MMDevice render = null, capture = null;
        WasapiCapture cap = null;
        WasapiOut output = null;
        try
        {
            using (var en = new MMDeviceEnumerator())
            {
                render = FindCable(en, DataFlow.Render, "CABLE Input");
                capture = FindCable(en, DataFlow.Capture, "CABLE Output");
                if (render == null) throw new Exception("NO_CABLE_INPUT");
                if (capture == null) throw new Exception("NO_CABLE_OUTPUT");

                cap = new WasapiCapture(capture, true, 5);
                var capBuf = new BufferedWaveProvider(cap.WaveFormat) { BufferDuration = TimeSpan.FromSeconds(2), DiscardOnBufferOverflow = true, ReadFully = false };
                cap.DataAvailable += delegate (object s, WaveInEventArgs e) { if (e.BytesRecorded > 0) capBuf.AddSamples(e.Buffer, 0, e.BytesRecorded); };
                cap.StartRecording();
                Thread.Sleep(200);
                var capSp = CaptureTest.Normalize(capBuf);

                var outFmt = WaveFormat.CreateIeeeFloatWaveFormat(Rate, Channels);
                var outBuf = new BufferedWaveProvider(outFmt) { BufferDuration = TimeSpan.FromSeconds(1), DiscardOnBufferOverflow = true };
                int frames = Rate; // 1 second of tone
                var samples = new float[frames * Channels];
                for (int i = 0; i < frames; i++)
                {
                    float v = (float)(Math.Sin(2.0 * Math.PI * 1000.0 * i / Rate) * 0.2);
                    samples[i * Channels] = v;
                    samples[i * Channels + 1] = v;
                }
                var bytes = new byte[samples.Length * sizeof(float)];
                Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
                outBuf.AddSamples(bytes, 0, bytes.Length);

                output = new WasapiOut(render, AudioClientShareMode.Shared, true, 5);
                output.Init(outBuf);
                try { capBuf.ClearBuffer(); } catch { }
                var sw = Stopwatch.StartNew();
                output.Play();
                bool detected = false;
                double detectedMs = 0;
                double peak = 0;
                var temp = new float[480 * Channels]; // 10ms
                while (sw.Elapsed.TotalSeconds < seconds)
                {
                    CaptureTest.ReadSome(capSp, temp, temp.Length);
                    for (int i = 0; i < temp.Length; i++)
                    {
                        double a = Math.Abs(temp[i]);
                        if (a > peak) peak = a;
                        if (a > 0.03) { detected = true; break; }
                    }
                    if (detected) { detectedMs = sw.Elapsed.TotalMilliseconds; break; }
                    Thread.Sleep(1);
                }
                output.Stop();
                try { cap.StopRecording(); } catch { }
                var json = "{\"ok\":true,\"mode\":\"latency-test\",\"sampleRate\":" + Rate + ",\"channels\":" + Channels +
                    ",\"detected\":" + (detected ? "true" : "false") + ",\"latencyMs\":" + CaptureTest.F(detectedMs) + ",\"peak\":" + CaptureTest.F(peak) +
                    ",\"output\":\"" + CaptureTest.J(render.FriendlyName) + "\",\"capture\":\"" + CaptureTest.J(capture.FriendlyName) + "\"}";
                if (!string.IsNullOrEmpty(resultJson)) CaptureTest.WriteText(resultJson, json);
                Console.WriteLine(json);
                return detected ? 0 : 3;
            }
        }
        finally
        {
            try { if (output != null) output.Dispose(); } catch { }
            try { if (cap != null) cap.Dispose(); } catch { }
            try { if (render != null) render.Dispose(); } catch { }
            try { if (capture != null) capture.Dispose(); } catch { }
        }
    }
}
