using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

// Dev probe: capture every active capture endpoint for a few seconds and report
// peak/RMS per device. Used to identify which device carries the real microphone.
internal static class ProbeCaptures
{
    public static int Run(string[] args)
    {
        // --probe-captures <seconds> [result.json]
        if (args.Length < 2) return Usage();
        double seconds;
        if (!double.TryParse(args[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out seconds)) return Usage();
        if (seconds < 1 || seconds > 30) seconds = 4;
        string resultJson = args.Length > 2 ? args[2] : null;

        var rows = new List<string>();
        uint seq = 0;
        using (var en = new MMDeviceEnumerator())
        {
            foreach (var dev in en.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
            {
                seq++;
                WasapiCapture cap = null;
                try
                {
                    cap = new WasapiCapture(dev);
                    var buf = new BufferedWaveProvider(cap.WaveFormat) { BufferDuration = TimeSpan.FromSeconds(2), DiscardOnBufferOverflow = true };
                    long bytes = 0;
                    cap.DataAvailable += delegate (object s, WaveInEventArgs e) { if (e.BytesRecorded > 0) { buf.AddSamples(e.Buffer, 0, e.BytesRecorded); bytes += e.BytesRecorded; } };
                    cap.StartRecording();
                    Thread.Sleep((int)(seconds * 1000));
                    try { cap.StopRecording(); } catch { }
                    var sp = CaptureTest.Normalize(buf);
                    var arr = new float[48000 * 2];
                    double peak = 0, sum = 0; long frames = 0;
                    long wantFrames = (long)(48000 * seconds);
                    while (frames < wantFrames)
                    {
                        int wantSamples = (int)Math.Min(arr.Length, (wantFrames - frames) * 2);
                        int n = sp.Read(arr, 0, wantSamples);
                        if (n <= 0) break;
                        for (int i = 0; i < n; i++) { double v = arr[i]; if (Math.Abs(v) > peak) peak = Math.Abs(v); sum += v * v; }
                        frames += n / 2;
                    }
                    double rms = frames > 0 ? Math.Sqrt(sum / (frames * 2)) : 0;
                    rows.Add("{\"id\":\"" + CaptureTest.J(dev.ID) + "\",\"name\":\"" + CaptureTest.J(dev.FriendlyName) + "\",\"bytes\":" + bytes + ",\"frames\":" + frames + ",\"peak\":" + CaptureTest.F(peak) + ",\"rms\":" + CaptureTest.F(rms) + "}");
                }
                catch (Exception ex)
                {
                    rows.Add("{\"id\":\"" + CaptureTest.J(dev.ID) + "\",\"name\":\"" + CaptureTest.J(dev.FriendlyName) + "\",\"error\":\"" + CaptureTest.J(ex.Message) + "\"}");
                }
                finally
                {
                    try { if (cap != null) cap.Dispose(); } catch { }
                    try { dev.Dispose(); } catch { }
                }
            }
        }
        var json = "{\"ok\":true,\"seconds\":" + CaptureTest.F(seconds) + ",\"devices\":[" + string.Join(",", rows.ToArray()) + "]}";
        if (!string.IsNullOrEmpty(resultJson)) CaptureTest.WriteText(resultJson, json);
        Console.WriteLine(json);
        return 0;
    }

    private static int Usage()
    {
        Console.Error.WriteLine("  --probe-captures <seconds> [result.json]");
        return 2;
    }
}
