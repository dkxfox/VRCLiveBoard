using System;
using System.IO;
using System.Text;
using System.Threading;
using NAudio.CoreAudioApi;
using NAudio.Wave;

// Development utility: play a known 440Hz tone to a selected render endpoint.
// Use only with a virtual cable (e.g. CABLE Input) while testing capture.
internal static class ToneTest
{
    private const int Rate = 48000;
    private const int Channels = 2;

    public static int Run(string[] args)
    {
        // --tone-test <seconds> [renderId] [result.json]
        if (args.Length < 2) return Usage();
        double seconds;
        if (!double.TryParse(args[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out seconds)) return Usage();
        if (seconds < 0.2 || seconds > 10) seconds = 1;
        string renderId = args.Length > 2 ? args[2] : "";
        string resultJson = args.Length > 3 ? args[3] : null;
        MMDevice render = null;
        WasapiOut output = null;
        try
        {
            using (var en = new MMDeviceEnumerator())
            {
                render = CaptureTest.FindDevice(en, DataFlow.Render, renderId);
                if (render == null) throw new Exception("NO_RENDER_DEVICE");
                var fmt = WaveFormat.CreateIeeeFloatWaveFormat(Rate, Channels);
                var buf = new BufferedWaveProvider(fmt) { BufferDuration = TimeSpan.FromSeconds(Math.Max(2, seconds + 1)), DiscardOnBufferOverflow = true };
                int frames = (int)(Rate * seconds);
                var samples = new float[frames * Channels];
                for (int i = 0; i < frames; i++)
                {
                    double t = i / (double)Rate;
                    float s = (float)(Math.Sin(2.0 * Math.PI * 440.0 * t) * 0.18);
                    samples[i * Channels] = s;
                    samples[i * Channels + 1] = s;
                }
                var bytes = new byte[samples.Length * sizeof(float)];
                Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
                buf.AddSamples(bytes, 0, bytes.Length);
                output = new WasapiOut(render, AudioClientShareMode.Shared, false, 50);
                output.Init(buf);
                output.Play();
                Thread.Sleep((int)(seconds * 1000));
                output.Stop();
                var json = "{\"ok\":true,\"mode\":\"tone-test\",\"renderDevice\":\"" + CaptureTest.J(render.FriendlyName) + "\",\"sampleRate\":" + Rate + ",\"channels\":" + Channels + ",\"frames\":" + frames + ",\"frequency\":440}";
                if (!string.IsNullOrEmpty(resultJson)) CaptureTest.WriteText(resultJson, json);
                Console.WriteLine(json);
                return 0;
            }
        }
        finally
        {
            try { if (output != null) output.Dispose(); } catch { }
            try { if (render != null) render.Dispose(); } catch { }
        }
    }

    private static int Usage()
    {
        Console.Error.WriteLine("  --tone-test <seconds> [renderId] [result.json]");
        return 2;
    }
}
