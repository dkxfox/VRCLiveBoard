using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using NAudio.CoreAudioApi;
using NAudio.Wave;

// Persistent live mixer for the plugin. Reads a flat JSON config written by
// index.js and runs until the plugin kills the process.
// --run <config.json>
internal static class LiveEngine
{
    private const int Rate = 48000;
    private const int Channels = 2;

    public static int Run(string[] args)
    {
        if (args.Length < 2) { return Usage(); }
        string configPath = args[1];
        string json;
        try { json = File.ReadAllText(configPath, Encoding.UTF8); }
        catch (Exception e) { Console.Error.WriteLine("CONFIG_READ_FAILED: " + e.Message); return 2; }

        string outputId = S(json, "output");
        string captureId = S(json, "capture");
        string micId = S(json, "mic");
        string customId = S(json, "custom");
        string statusPath = S(json, "status");
        double micGainDb = N(json, "micGainDb", 4.0);
        double musicGain = N(json, "musicGain", 0.72);
        double systemGain = N(json, "systemGain", 1.0);
        bool duckEnabled = B(json, "duckEnabled", true);
        double depthDb = N(json, "duckDepthDb", -15.0);
        double thresholdDb = N(json, "duckThresholdDb", -35.0);
        double attackMs = N(json, "duckAttackMs", 45.0);
        double releaseMs = N(json, "duckReleaseMs", 600.0);
        double holdMs = N(json, "duckHoldMs", 650.0);
        double lookaheadMs = N(json, "duckLookaheadMs", 8.0);
        double hpfHz = N(json, "sidechainHpfHz", 120.0);

        MMDevice outputDev = null, captureDev = null, mic = null, customDev = null;
        WasapiLoopbackCapture loop = null;
        WasapiCapture micCap = null, customCap = null;
        WasapiOut output = null;
        Timer statusTimer = null;
        StatusBox statusBox = new StatusBox();
        try
        {
            using (var en = new MMDeviceEnumerator())
            {
                outputDev = FindConfigured(en, DataFlow.Render, outputId, "output");
                bool useSystem = captureId != "__none__";
                if (useSystem) captureDev = FindConfigured(en, DataFlow.Render, captureId, "capture");
                mic = FindConfigured(en, DataFlow.Capture, micId, "mic");
                customDev = string.IsNullOrEmpty(customId) ? null : FindConfigured(en, DataFlow.Capture, customId, "custom");
                if (outputDev == null) throw new Exception("NO_OUTPUT_DEVICE");
                if (useSystem && captureDev == null) throw new Exception("NO_CAPTURE_DEVICE");
                if (mic == null) throw new Exception("NO_MIC_DEVICE");

                BufferedWaveProvider sysBuf = null;
                if (useSystem) { loop = new WasapiLoopbackCapture(captureDev); sysBuf = new BufferedWaveProvider(loop.WaveFormat) { BufferDuration = TimeSpan.FromMilliseconds(500), DiscardOnBufferOverflow = true, ReadFully = false }; }
                micCap = new WasapiCapture(mic);
                var micBuf = new BufferedWaveProvider(micCap.WaveFormat) { BufferDuration = TimeSpan.FromMilliseconds(500), DiscardOnBufferOverflow = true, ReadFully = false };
                long sysBytes = 0, micBytes = 0, customBytes = 0;
                if (loop != null) loop.DataAvailable += delegate (object s, WaveInEventArgs e) { if (e.BytesRecorded > 0) { sysBuf.AddSamples(e.Buffer, 0, e.BytesRecorded); sysBytes += e.BytesRecorded; } };
                micCap.DataAvailable += delegate (object s, WaveInEventArgs e) { if (e.BytesRecorded > 0) { micBuf.AddSamples(e.Buffer, 0, e.BytesRecorded); micBytes += e.BytesRecorded; } };

                BufferedWaveProvider customBuf = null;
                if (customDev != null)
                {
                    customCap = new WasapiCapture(customDev);
                    customBuf = new BufferedWaveProvider(customCap.WaveFormat) { BufferDuration = TimeSpan.FromMilliseconds(500), DiscardOnBufferOverflow = true, ReadFully = false };
                    customCap.DataAvailable += delegate (object s, WaveInEventArgs e) { if (e.BytesRecorded > 0) { customBuf.AddSamples(e.Buffer, 0, e.BytesRecorded); customBytes += e.BytesRecorded; } };
                }

                var sys = sysBuf == null ? null : CaptureTest.Normalize(sysBuf);
                var micSp = CaptureTest.Normalize(micBuf);
                var customSp = customBuf == null ? null : CaptureTest.Normalize(customBuf);
                if (loop != null) loop.StartRecording();
                micCap.StartRecording();
                if (customCap != null) customCap.StartRecording();
                Thread.Sleep(250);
                try { if (sysBuf != null) sysBuf.ClearBuffer(); micBuf.ClearBuffer(); if (customBuf != null) customBuf.ClearBuffer(); } catch { }

                var outFmt = WaveFormat.CreateIeeeFloatWaveFormat(Rate, Channels);
                var outBuf = new BufferedWaveProvider(outFmt) { BufferDuration = TimeSpan.FromMilliseconds(500), DiscardOnBufferOverflow = true };
                output = new WasapiOut(outputDev, AudioClientShareMode.Shared, false, 50);
                output.Init(outBuf);
                output.Play();

                var duck = new Ducker(Rate);
                duck.ThresholdDb = thresholdDb;
                duck.DepthDb = depthDb;
                duck.AttackMs = attackMs;
                duck.ReleaseMs = releaseMs;
                duck.HoldMs = holdMs;
                duck.LookaheadMs = lookaheadMs;
                duck.SidechainHpfHz = hpfHz;
                double micGain = Math.Pow(10.0, micGainDb / 20.0);
                long frames = 0;
                float lastGain = 1f;
                double sysPeak = 0, micPeak = 0, customPeak = 0, masterPeak = 0;
                var sysF = new float[Rate * Channels / 100];
                var micF = new float[Rate * Channels / 100];
                var customF = new float[Rate * Channels / 100];
                var outF = new float[sysF.Length];
                var outBytes = new byte[sysF.Length * sizeof(float)];
                var sw = Stopwatch.StartNew();
                if (!string.IsNullOrEmpty(statusPath))
                {
                    CaptureTest.WriteText(statusPath, "{\"ok\":true,\"running\":true,\"frames\":0,\"duckGain\":1,\"levels\":{\"system\":0,\"mic\":0,\"custom\":0,\"master\":0}}");
                    statusTimer = new Timer(delegate { statusBox.Write(statusPath); }, null, 500, 500);
                }
                try { Thread.CurrentThread.Priority = ThreadPriority.AboveNormal; } catch { }
                var loopClock = Stopwatch.StartNew();
                long nextLoopMs = 0;
                while (true)
                {
                    if (sys != null) CaptureTest.ReadSome(sys, sysF, sysF.Length); else Array.Clear(sysF, 0, sysF.Length);
                    CaptureTest.ReadSome(micSp, micF, micF.Length);
                    if (customSp != null) CaptureTest.ReadSome(customSp, customF, customF.Length);
                    int nf = sysF.Length / Channels;
                    for (int i = 0; i < nf; i++)
                    {
                        float l = sysF[i * Channels];
                        float r = sysF[i * Channels + 1];
                        float sysMono = (l + r) * 0.5f * (float)systemGain;
                        float customMono = customSp == null ? 0f : (customF[i * Channels] + customF[i * Channels + 1]) * 0.5f * (float)musicGain;
                        float music = sysMono + customMono;
                        float micMono = (micF[i * Channels] + micF[i * Channels + 1]) * 0.5f;
                        if (Math.Abs(sysMono) > sysPeak) sysPeak = Math.Abs(sysMono);
                        if (Math.Abs(customMono) > customPeak) customPeak = Math.Abs(customMono);
                        if (Math.Abs(micMono) > micPeak) micPeak = Math.Abs(micMono);
                        float gain = 1f;
                        float ducked = music;
                        if (duckEnabled) ducked = duck.Process(music, micMono, out gain);
                        lastGain = gain;
                        float mixed = ducked + micMono * (float)micGain;
                        if (mixed > 1f) mixed = 1f;
                        else if (mixed < -1f) mixed = -1f;
                        if (Math.Abs(mixed) > masterPeak) masterPeak = Math.Abs(mixed);
                        outF[i * Channels] = mixed;
                        outF[i * Channels + 1] = mixed;
                    }
                    Buffer.BlockCopy(outF, 0, outBytes, 0, outBytes.Length);
                    outBuf.AddSamples(outBytes, 0, outBytes.Length);
                    frames += nf;
                    statusBox.Update(frames, lastGain, sysPeak, micPeak, customPeak, masterPeak);
                    nextLoopMs += 10;
                    int waitMs = (int)(nextLoopMs - loopClock.ElapsedMilliseconds);
                    if (waitMs > 0) Thread.Sleep(waitMs);
                }
            }
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("LIVE_ENGINE_ERROR: " + e.Message);
            if (!string.IsNullOrEmpty(statusPath)) CaptureTest.WriteText(statusPath, "{\"ok\":false,\"running\":false,\"error\":\"" + CaptureTest.J(e.Message) + "\"}");
            return 3;
        }
        finally
        {
            try { if (statusTimer != null) statusTimer.Dispose(); } catch { }
            try { if (output != null) output.Dispose(); } catch { }
            try { if (loop != null) loop.Dispose(); } catch { }
            try { if (micCap != null) micCap.Dispose(); } catch { }
            try { if (customCap != null) customCap.Dispose(); } catch { }
            try { if (outputDev != null) outputDev.Dispose(); } catch { }
            try { if (captureDev != null) captureDev.Dispose(); } catch { }
            try { if (mic != null) mic.Dispose(); } catch { }
            try { if (customDev != null) customDev.Dispose(); } catch { }
        }
    }

    private static MMDevice FindConfigured(MMDeviceEnumerator en, DataFlow flow, string value, string label)
    {
        if (string.IsNullOrEmpty(value)) return en.GetDefaultAudioEndpoint(flow, Role.Console);
        foreach (var d in en.EnumerateAudioEndPoints(flow, DeviceState.Active))
        {
            if (d.ID == value || d.FriendlyName == value) return d;
        }
        throw new Exception("DEVICE_NOT_FOUND: " + label + " = " + value);
    }

    private static string S(string json, string key)
    {
        var m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        return m.Success ? Regex.Unescape(m.Groups[1].Value) : "";
    }
    private static double N(string json, string key, double fallback)
    {
        var m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?)");
        double v;
        return m.Success && double.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v) ? v : fallback;
    }
    private static bool B(string json, string key, bool fallback)
    {
        var m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(true|false)");
        return m.Success ? m.Groups[1].Value == "true" : fallback;
    }

    private static int Usage()
    {
        Console.Error.WriteLine("  --run <config.json>");
        return 2;
    }
    private sealed class StatusBox
    {
        private readonly object gate = new object();
        private long frames;
        private float gain = 1f;
        private double sys, mic, custom, master;

        public void Update(long f, float g, double s, double m, double c, double outPeak)
        {
            lock (gate)
            {
                frames = f;
                gain = g;
                sys = s;
                mic = m;
                custom = c;
                master = outPeak;
            }
        }

        public void Write(string path)
        {
            long f;
            float g;
            double s, m, c, outPeak;
            lock (gate)
            {
                f = frames;
                g = gain;
                s = sys;
                m = mic;
                c = custom;
                outPeak = master;
            }
            try
            {
                CaptureTest.WriteText(path, "{\"ok\":true,\"running\":true,\"frames\":" + f + ",\"duckGain\":" + CaptureTest.F(g) + ",\"levels\":{\"system\":" + CaptureTest.F(s) + ",\"mic\":" + CaptureTest.F(m) + ",\"custom\":" + CaptureTest.F(c) + ",\"master\":" + CaptureTest.F(outPeak) + "}}");
            }
            catch { }
        }
    }

}
