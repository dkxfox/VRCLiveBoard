using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

// S2b live output test: capture system + mic, mix through Ducker, and render
// to a selected WASAPI device. Use a virtual cable (or a silent endpoint) for
// testing; never select the same physical output as both capture and render.
internal static class OutputTest
{
    private const int Rate = 48000;
    private const int Channels = 2;

    public static int Run(string[] args)
    {
        // --output-test <seconds> [renderId] [micId] [result.json]
        if (args.Length < 2) return Usage();
        double seconds;
        if (!double.TryParse(args[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out seconds)) return Usage();
        if (seconds < 0.5 || seconds > 3600) seconds = 2;
        string renderId = args.Length > 2 ? args[2] : "";
        string micId = args.Length > 3 ? args[3] : "";
        string resultJson = args.Length > 4 ? args[4] : null;

        MMDevice render = null, mic = null;
        WasapiLoopbackCapture loop = null;
        WasapiCapture micCap = null;
        WasapiOut output = null;
        try
        {
            using (var en = new MMDeviceEnumerator())
            {
                render = CaptureTest.FindDevice(en, DataFlow.Render, renderId);
                mic = CaptureTest.FindDevice(en, DataFlow.Capture, micId);
                if (render == null) throw new Exception("NO_RENDER_DEVICE");
                if (mic == null) throw new Exception("NO_MIC_DEVICE");

                loop = new WasapiLoopbackCapture(render);
                micCap = new WasapiCapture(mic);
                var sysBuf = new BufferedWaveProvider(loop.WaveFormat) { BufferDuration = TimeSpan.FromSeconds(2), DiscardOnBufferOverflow = true };
                var micBuf = new BufferedWaveProvider(micCap.WaveFormat) { BufferDuration = TimeSpan.FromSeconds(2), DiscardOnBufferOverflow = true };
                long sysBytes = 0, micBytes = 0;
                loop.DataAvailable += delegate (object s, WaveInEventArgs e) { if (e.BytesRecorded > 0) { sysBuf.AddSamples(e.Buffer, 0, e.BytesRecorded); sysBytes += e.BytesRecorded; } };
                micCap.DataAvailable += delegate (object s, WaveInEventArgs e) { if (e.BytesRecorded > 0) { micBuf.AddSamples(e.Buffer, 0, e.BytesRecorded); micBytes += e.BytesRecorded; } };

                var sys = CaptureTest.Normalize(sysBuf);
                var micSp = CaptureTest.Normalize(micBuf);
                loop.StartRecording();
                micCap.StartRecording();
                Thread.Sleep(250);

                var outFmt = WaveFormat.CreateIeeeFloatWaveFormat(Rate, Channels);
                var outBuf = new BufferedWaveProvider(outFmt) { BufferDuration = TimeSpan.FromMilliseconds(500), DiscardOnBufferOverflow = true };
                output = new WasapiOut(render, AudioClientShareMode.Shared, false, 50);
                output.Init(outBuf);
                output.Play();

                var duck = new Ducker(Rate);
                long frames = 0;
                double duckMin = 1.0, duckMax = 0.0, mixedPeak = 0.0;
                var sysF = new float[Rate * Channels / 100];
                var micF = new float[Rate * Channels / 100];
                var outF = new float[sysF.Length];
                var outBytes = new byte[sysF.Length * sizeof(float)];
                var sw = Stopwatch.StartNew();
                while (sw.Elapsed.TotalSeconds < seconds)
                {
                    CaptureTest.ReadSome(sys, sysF, sysF.Length);
                    CaptureTest.ReadSome(micSp, micF, micF.Length);
                    int nf = sysF.Length / Channels;
                    for (int i = 0; i < nf; i++)
                    {
                        float l = sysF[i * Channels];
                        float r = sysF[i * Channels + 1];
                        float music = (l + r) * 0.5f;
                        float micMono = (micF[i * Channels] + micF[i * Channels + 1]) * 0.5f;
                        float gain;
                        float ducked = duck.Process(music, micMono, out gain);
                        float mixed = ducked + micMono * 0.9f;
                        if (Math.Abs(mixed) > mixedPeak) mixedPeak = Math.Abs(mixed);
                        if (gain < duckMin) duckMin = gain;
                        if (gain > duckMax) duckMax = gain;
                        outF[i * Channels] = mixed;
                        outF[i * Channels + 1] = mixed;
                    }
                    Buffer.BlockCopy(outF, 0, outBytes, 0, outBytes.Length);
                    outBuf.AddSamples(outBytes, 0, outBytes.Length);
                    frames += nf;
                    Thread.Sleep(10);
                }
                output.Stop();
                try { loop.StopRecording(); } catch { }
                try { micCap.StopRecording(); } catch { }
                var json = "{\"ok\":true,\"mode\":\"output-test\",\"seconds\":" + CaptureTest.F(seconds) + ",\"renderDevice\":\"" + CaptureTest.J(render.FriendlyName) + "\",\"micDevice\":\"" + CaptureTest.J(mic.FriendlyName) +
                    "\",\"sampleRate\":" + Rate + ",\"channels\":" + Channels + ",\"frames\":" + frames + ",\"sysBytes\":" + sysBytes + ",\"micBytes\":" + micBytes +
                    ",\"duckMinGain\":" + CaptureTest.F(duckMin) + ",\"duckMaxGain\":" + CaptureTest.F(duckMax) + ",\"mixedPeak\":" + CaptureTest.F(mixedPeak) + "}";
                if (!string.IsNullOrEmpty(resultJson)) CaptureTest.WriteText(resultJson, json);
                Console.WriteLine(json);
                return frames > 0 ? 0 : 3;
            }
        }
        finally
        {
            try { if (output != null) output.Dispose(); } catch { }
            try { if (loop != null) loop.Dispose(); } catch { }
            try { if (micCap != null) micCap.Dispose(); } catch { }
            try { if (render != null) render.Dispose(); } catch { }
            try { if (mic != null) mic.Dispose(); } catch { }
        }
    }

    private static int Usage()
    {
        Console.Error.WriteLine("  --output-test <seconds> [renderId] [micId] [result.json]");
        return 2;
    }
}
