using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

// Live output test with SEPARATE capture-render and output-render devices.
// This prevents the common feedback loop where the same CABLE Input is both
// captured and played back. Capture the physical/default render, output CABLE.
// --output-test <seconds> [captureRenderId] [micId] [customId] [outputRenderId] [result.json]
internal static class OutputTest
{
    private const int Rate = 48000;
    private const int Channels = 2;

    public static int Run(string[] args)
    {
        if (args.Length < 2) return Usage();
        double seconds;
        if (!double.TryParse(args[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out seconds)) return Usage();
        if (seconds < 0.5 || seconds > 3600) seconds = 2;
        string captureId = args.Length > 2 ? args[2] : "";
        string micId = args.Length > 3 ? args[3] : "";
        string customId = args.Length > 4 ? args[4] : "";
        string outputId = args.Length > 5 ? args[5] : "";
        string resultJson = args.Length > 6 ? args[6] : null;

        MMDevice captureRender = null, outputRender = null, mic = null, customDev = null;
        WasapiLoopbackCapture loop = null;
        WasapiCapture micCap = null, customCap = null;
        WasapiOut output = null;
        try
        {
            using (var en = new MMDeviceEnumerator())
            {
                captureRender = CaptureTest.FindDevice(en, DataFlow.Render, captureId);
                outputRender = string.IsNullOrEmpty(outputId) ? captureRender : CaptureTest.FindDevice(en, DataFlow.Render, outputId);
                mic = CaptureTest.FindDevice(en, DataFlow.Capture, micId);
                customDev = string.IsNullOrEmpty(customId) ? null : CaptureTest.FindDevice(en, DataFlow.Capture, customId);
                if (captureRender == null) throw new Exception("NO_CAPTURE_RENDER_DEVICE");
                if (outputRender == null) throw new Exception("NO_OUTPUT_RENDER_DEVICE");
                if (mic == null) throw new Exception("NO_MIC_DEVICE");

                loop = new WasapiLoopbackCapture(captureRender);
                micCap = new WasapiCapture(mic);
                var sysBuf = new BufferedWaveProvider(loop.WaveFormat) { BufferDuration = TimeSpan.FromSeconds(2), DiscardOnBufferOverflow = true };
                var micBuf = new BufferedWaveProvider(micCap.WaveFormat) { BufferDuration = TimeSpan.FromSeconds(2), DiscardOnBufferOverflow = true };
                long sysBytes = 0, micBytes = 0, customBytes = 0;
                loop.DataAvailable += delegate (object s, WaveInEventArgs e) { if (e.BytesRecorded > 0) { sysBuf.AddSamples(e.Buffer, 0, e.BytesRecorded); sysBytes += e.BytesRecorded; } };
                micCap.DataAvailable += delegate (object s, WaveInEventArgs e) { if (e.BytesRecorded > 0) { micBuf.AddSamples(e.Buffer, 0, e.BytesRecorded); micBytes += e.BytesRecorded; } };

                BufferedWaveProvider customBuf = null;
                if (customDev != null)
                {
                    customCap = new WasapiCapture(customDev);
                    customBuf = new BufferedWaveProvider(customCap.WaveFormat) { BufferDuration = TimeSpan.FromSeconds(2), DiscardOnBufferOverflow = true };
                    customCap.DataAvailable += delegate (object s, WaveInEventArgs e) { if (e.BytesRecorded > 0) { customBuf.AddSamples(e.Buffer, 0, e.BytesRecorded); customBytes += e.BytesRecorded; } };
                }

                var sys = CaptureTest.Normalize(sysBuf);
                var micSp = CaptureTest.Normalize(micBuf);
                var customSp = customBuf == null ? null : CaptureTest.Normalize(customBuf);
                loop.StartRecording();
                micCap.StartRecording();
                if (customCap != null) customCap.StartRecording();
                Thread.Sleep(250);

                var outFmt = WaveFormat.CreateIeeeFloatWaveFormat(Rate, Channels);
                var outBuf = new BufferedWaveProvider(outFmt) { BufferDuration = TimeSpan.FromMilliseconds(500), DiscardOnBufferOverflow = true };
                output = new WasapiOut(outputRender, AudioClientShareMode.Shared, false, 50);
                output.Init(outBuf);
                output.Play();

                var duck = new Ducker(Rate);
                long frames = 0;
                double duckMin = 1.0, duckMax = 0.0, mixedPeak = 0.0;
                var sysF = new float[Rate * Channels / 100];
                var micF = new float[Rate * Channels / 100];
                var customF = new float[Rate * Channels / 100];
                var outF = new float[sysF.Length];
                var outBytes = new byte[sysF.Length * sizeof(float)];
                var sw = Stopwatch.StartNew();
                while (sw.Elapsed.TotalSeconds < seconds)
                {
                    CaptureTest.ReadSome(sys, sysF, sysF.Length);
                    CaptureTest.ReadSome(micSp, micF, micF.Length);
                    if (customSp != null) CaptureTest.ReadSome(customSp, customF, customF.Length);
                    int nf = sysF.Length / Channels;
                    for (int i = 0; i < nf; i++)
                    {
                        float l = sysF[i * Channels];
                        float r = sysF[i * Channels + 1];
                        float music = (l + r) * 0.5f;
                        if (customSp != null) music += (customF[i * Channels] + customF[i * Channels + 1]) * 0.5f * 0.72f;
                        float micMono = (micF[i * Channels] + micF[i * Channels + 1]) * 0.5f;
                        float gain;
                        float ducked = duck.Process(music, micMono, out gain);
                        // Headset mic is ~12dB quieter than the tape line; give it presence.
                        float mixed = ducked + micMono * 1.585f;
                        if (Math.Abs(mixed) > mixedPeak) mixedPeak = Math.Abs(mixed);
                        if (mixed > 1f) mixed = 1f;
                        else if (mixed < -1f) mixed = -1f;
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
                try { if (customCap != null) customCap.StopRecording(); } catch { }
                var json = "{\"ok\":true,\"mode\":\"output-test\",\"seconds\":" + CaptureTest.F(seconds) + ",\"captureRender\":\"" + CaptureTest.J(captureRender.FriendlyName) + "\",\"outputRender\":\"" + CaptureTest.J(outputRender.FriendlyName) + "\",\"micDevice\":\"" + CaptureTest.J(mic.FriendlyName) + "\",\"customDevice\":\"" + CaptureTest.J(customDev == null ? "" : customDev.FriendlyName) +
                    "\",\"sampleRate\":" + Rate + ",\"channels\":" + Channels + ",\"frames\":" + frames + ",\"sysBytes\":" + sysBytes + ",\"micBytes\":" + micBytes + ",\"customBytes\":" + customBytes +
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
            try { if (customCap != null) customCap.Dispose(); } catch { }
            try { if (captureRender != null) captureRender.Dispose(); } catch { }
            try { if (outputRender != null && outputRender != captureRender) outputRender.Dispose(); } catch { }
            try { if (mic != null) mic.Dispose(); } catch { }
            try { if (customDev != null) customDev.Dispose(); } catch { }
        }
    }

    private static int Usage()
    {
        Console.Error.WriteLine("  --output-test <seconds> [captureRenderId] [micId] [customId] [outputRenderId] [result.json]");
        return 2;
    }
}
