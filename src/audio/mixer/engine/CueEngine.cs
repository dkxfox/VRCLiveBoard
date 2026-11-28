using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

// Cue playback: start several files on the same 48 kHz output clock.
// --cue <output> <leadMs> <status.json> <file1> <gainDb1> [file2] [gainDb2] ...
// --cue-selftest <out.wav> <result.json> <file1> [file2] ...
internal static class CueEngine
{
    private const int Rate = 48000;
    private const int Channels = 2;

    private sealed class Track
    {
        public string Path;
        public ISampleProvider Provider;
        public double Gain = 1.0;
        public bool Done;
        public long DurationMs;
    }

    private sealed class CueState
    {
        private readonly object gate = new object();
        private long frames;
        private double level;
        private bool running = true;
        public long StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        public long DurationMs;
        public string Files;
        public void Update(long f, double p) { lock (gate) { frames = f; if (p > level) level = p; } }
        public void Stop() { lock (gate) { running = false; } }
        public void Write(string path)
        {
            if (string.IsNullOrEmpty(path)) return;
            long f; bool r; double lv;
            lock (gate) { f = frames; r = running; lv = level; level = 0; }
            double progress = DurationMs > 0 ? Math.Min(1.0, (f * 1000.0 / Rate) / DurationMs) : 0;
            try { CaptureTest.WriteText(path, "{\"ok\":true,\"running\":" + (r ? "true" : "false") + ",\"startedAt\":" + StartedAt + ",\"durationMs\":" + DurationMs + ",\"frames\":" + f + ",\"progress\":" + CaptureTest.F(progress) + ",\"level\":" + CaptureTest.F(lv) + ",\"files\":\"" + CaptureTest.J(Files) + "\"}"); } catch { }
        }
    }

    private sealed class DuckOptions
    {
        public bool Enabled;
        public string MicDevice = "";
        public double DepthDb = -15;
        public double ThresholdDb = -35;
        public double AttackMs = 45;
        public double ReleaseMs = 600;
        public double HoldMs = 650;
        public double LookaheadMs = 8;
        public double HpfHz = 120;
    }

    public static int Run(string[] args)
    {
        if (args.Length < 5) return Usage();
        string outputId = args[1];
        double leadMs;
        if (!double.TryParse(args[2], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out leadMs)) leadMs = 300;
        string statusPath = args[3];
        var tracks = new List<Track>();
        var duck = new DuckOptions();
        int i = 4;
        while (i + 1 < args.Length && !args[i].StartsWith("--"))
        {
            double gainDb;
            if (!double.TryParse(args[i + 1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out gainDb)) gainDb = 0;
            tracks.Add(LoadTrack(args[i], gainDb));
            i += 2;
        }
        double cueGain = 1.0;
        string monitorId = "";
        while (i < args.Length)
        {
            if (args[i] == "--duck")
            {
                duck.Enabled = true;
                if (i + 1 < args.Length) duck.MicDevice = args[i + 1];
                if (i + 2 < args.Length) double.TryParse(args[i + 2], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out duck.DepthDb);
                if (i + 3 < args.Length) double.TryParse(args[i + 3], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out duck.ThresholdDb);
                if (i + 4 < args.Length) double.TryParse(args[i + 4], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out duck.AttackMs);
                if (i + 5 < args.Length) double.TryParse(args[i + 5], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out duck.ReleaseMs);
                if (i + 6 < args.Length) double.TryParse(args[i + 6], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out duck.HoldMs);
                if (i + 7 < args.Length) double.TryParse(args[i + 7], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out duck.LookaheadMs);
                if (i + 8 < args.Length) double.TryParse(args[i + 8], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out duck.HpfHz);
                i += 9;
            }
            else if (args[i] == "--gain" && i + 1 < args.Length)
            {
                double.TryParse(args[i + 1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out cueGain);
                i += 2;
            }
            else if (args[i] == "--monitor" && i + 1 < args.Length)
            {
                monitorId = args[i + 1];
                i += 2;
            }
            else i++;
        }
        if (cueGain < 0) cueGain = 0; if (cueGain > 2) cueGain = 2;
        if (tracks.Count == 0) return 2;
        if (leadMs < 0) leadMs = 0;
        if (leadMs > 5000) leadMs = 5000;
        int leadFrames = (int)Math.Round(Rate * leadMs / 1000.0);
        return Play(outputId, tracks, leadFrames, statusPath, duck, monitorId, cueGain);
    }

    public static int SelfTest(string[] args)
    {
        if (args.Length < 4) return Usage();
        string outWav = args[1];
        string resultJson = args[2];
        var tracks = LoadTracks(args, 3);
        if (tracks.Count == 0) return 2;
        return WriteMix(outWav, resultJson, tracks);
    }

    private static List<Track> LoadTracks(string[] args, int start)
    {
        var list = new List<Track>();
        for (int i = start; i + 1 < args.Length; i += 2)
        {
            double gainDb;
            if (!double.TryParse(args[i + 1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out gainDb)) gainDb = 0;
            list.Add(LoadTrack(args[i], gainDb));
        }
        return list;
    }

    private static Track LoadTrack(string path, double gainDb)
    {
        if (!File.Exists(path)) throw new Exception("FILE_NOT_FOUND: " + path);
        ISampleProvider sp;
        long durationMs;
        if (path.EndsWith(".flac", StringComparison.OrdinalIgnoreCase))
        {
            // Windows Media Foundation has a built-in FLAC decoder on Win10/11;
            // NAudio's managed AudioFileReader does not decode FLAC.
            var mf = new MediaFoundationReader(path);
            sp = mf.ToSampleProvider();
            durationMs = (long)mf.TotalTime.TotalMilliseconds;
        }
        else
        {
            var reader = new AudioFileReader(path);
            sp = reader;
            durationMs = (long)reader.TotalTime.TotalMilliseconds;
        }
        if (sp.WaveFormat.SampleRate != Rate) sp = new WdlResamplingSampleProvider(sp, Rate);
        if (sp.WaveFormat.Channels == 1) sp = new MonoToStereoSampleProvider(sp);
        else if (sp.WaveFormat.Channels > 2) throw new Exception("UNSUPPORTED_CHANNELS: " + path);
        return new Track { Path = path, Provider = sp, Gain = Math.Pow(10.0, gainDb / 20.0), DurationMs = durationMs };
    }

    private static int Play(string outputId, List<Track> tracks, int leadFrames, string statusPath, DuckOptions duckOpt, string monitorId, double cueGain)
    {
        MMDevice dev = null, mic = null, monDev = null;
        WasapiOut output = null, monOut = null;
        WasapiCapture micCap = null;
        try
        {
            using (var en = new MMDeviceEnumerator())
            {
                dev = CaptureTest.FindDevice(en, DataFlow.Render, outputId);
                if (dev == null) throw new Exception("NO_OUTPUT_DEVICE");
                if (!string.IsNullOrEmpty(monitorId))
                {
                    monDev = CaptureTest.FindDevice(en, DataFlow.Render, monitorId);
                    if (monDev == null) throw new Exception("NO_MONITOR_DEVICE");
                }
                BufferedWaveProvider micBuf = null;
                ISampleProvider micSp = null;
                Ducker duckL = null, duckR = null;
                if (duckOpt.Enabled)
                {
                    mic = CaptureTest.FindDevice(en, DataFlow.Capture, duckOpt.MicDevice);
                    if (mic == null) throw new Exception("NO_DUCK_MIC");
                    micCap = CreateCapture(mic);
                    micBuf = new BufferedWaveProvider(micCap.WaveFormat) { BufferDuration = TimeSpan.FromMilliseconds(500), DiscardOnBufferOverflow = true, ReadFully = false };
                    micCap.DataAvailable += delegate (object s, WaveInEventArgs e) { if (e.BytesRecorded > 0) micBuf.AddSamples(e.Buffer, 0, e.BytesRecorded); };
                    micCap.StartRecording();
                    micSp = CaptureTest.Normalize(micBuf);
                    duckL = new Ducker(Rate); duckR = new Ducker(Rate);
                    foreach (var d in new[] { duckL, duckR })
                    {
                        d.DepthDb = duckOpt.DepthDb; d.ThresholdDb = duckOpt.ThresholdDb;
                        d.AttackMs = duckOpt.AttackMs; d.ReleaseMs = duckOpt.ReleaseMs;
                        d.HoldMs = duckOpt.HoldMs; d.LookaheadMs = duckOpt.LookaheadMs; d.SidechainHpfHz = duckOpt.HpfHz;
                    }
                }
                var outFmt = WaveFormat.CreateIeeeFloatWaveFormat(Rate, Channels);
                var outBuf = new BufferedWaveProvider(outFmt) { BufferDuration = TimeSpan.FromSeconds(1), DiscardOnBufferOverflow = true };
                if (leadFrames > 0)
                {
                    var lead = new byte[leadFrames * Channels * sizeof(float)];
                    outBuf.AddSamples(lead, 0, lead.Length);
                }
                output = new WasapiOut(dev, AudioClientShareMode.Shared, true, 10);
                output.Init(outBuf);
                output.Play();
                BufferedWaveProvider monBuf = null;
                if (monDev != null)
                {
                    monBuf = new BufferedWaveProvider(outFmt) { BufferDuration = TimeSpan.FromSeconds(1), DiscardOnBufferOverflow = true };
                    if (leadFrames > 0) { var mlead = new byte[leadFrames * Channels * sizeof(float)]; monBuf.AddSamples(mlead, 0, mlead.Length); }
                    monOut = new WasapiOut(monDev, AudioClientShareMode.Shared, true, 10);
                    monOut.Init(monBuf);
                    monOut.Play();
                }
                long totalMs = 0; foreach (var tr in tracks) { if (tr.DurationMs > totalMs) totalMs = tr.DurationMs; } totalMs += leadFrames * 1000L / Rate;
                var status = new CueState { DurationMs = totalMs, Files = string.Join("|", tracks.ConvertAll(t => t.Path).ToArray()) };
                Timer statusTimer = null;
                if (!string.IsNullOrEmpty(statusPath)) { status.Write(statusPath); statusTimer = new Timer(delegate { status.Write(statusPath); }, null, 200, 200); }
                var tmp = new float[Rate * Channels / 100];
                var micF = new float[tmp.Length];
                var mix = new float[tmp.Length];
                long frames = 0;
                while (true)
                {
                    Array.Clear(mix, 0, mix.Length);
                    bool any = false;
                    foreach (var tr in tracks)
                    {
                        if (tr.Done) continue;
                        int got = ReadSome(tr.Provider, tmp, tmp.Length);
                        for (int i = 0; i < got; i++) mix[i] += (float)(tmp[i] * tr.Gain);
                        if (got < tmp.Length) tr.Done = true;
                        any = true;
                    }
                    if (micSp != null) ReadSome(micSp, micF, micF.Length);
                    double chunkPeak = 0;
                    for (int i = 0; i < mix.Length; i += 2)
                    {
                        float ml = mix[i], mr = mix[i + 1];
                        if (duckL != null)
                        {
                            float g1, g2;
                            float micMono = (micF[i] + micF[i + 1]) * 0.5f;
                            ml = duckL.Process(ml, micMono, out g1);
                            mr = duckR.Process(mr, micMono, out g2);
                        }
                        ml = (float)(ml * cueGain); mr = (float)(mr * cueGain);
                        if (Math.Abs(ml) > chunkPeak) chunkPeak = Math.Abs(ml);
                        if (Math.Abs(mr) > chunkPeak) chunkPeak = Math.Abs(mr);
                        if (ml > 1f) ml = 1f; else if (ml < -1f) ml = -1f;
                        if (mr > 1f) mr = 1f; else if (mr < -1f) mr = -1f;
                        mix[i] = ml; mix[i + 1] = mr;
                    }
                    var bytes = new byte[mix.Length * sizeof(float)];
                    Buffer.BlockCopy(mix, 0, bytes, 0, bytes.Length);
                    outBuf.AddSamples(bytes, 0, bytes.Length);
                    if (monOut != null) monBuf.AddSamples(bytes, 0, bytes.Length);
                    frames += mix.Length / Channels;
                    status.Update(frames, chunkPeak);
                    if (!any) break;
                    Thread.Sleep(10);
                }
                output.Stop();
                try { if (monOut != null) monOut.Stop(); } catch { }
                try { if (micCap != null) micCap.StopRecording(); } catch { }
                status.Stop();
                if (statusTimer != null) statusTimer.Dispose();
                status.Write(statusPath);
                return 0;
            }
        }
        finally
        {
            try { if (monOut != null) monOut.Dispose(); } catch { }
            try { if (output != null) output.Dispose(); } catch { }
            try { if (micCap != null) micCap.Dispose(); } catch { }
            try { if (mic != null) mic.Dispose(); } catch { }
            try { if (dev != null) dev.Dispose(); } catch { }
            try { if (monDev != null) monDev.Dispose(); } catch { }
        }
    }

    private static WasapiCapture CreateCapture(MMDevice dev)
    {
        try { return new WasapiCapture(dev, true, 10); }
        catch { return new WasapiCapture(dev); }
    }

    private static int WriteMix(string outWav, string resultJson, List<Track> tracks)
    {
        var fmt = WaveFormat.CreateIeeeFloatWaveFormat(Rate, Channels);
        long frames = 0;
        double peak = 0;
        using (var writer = new WaveFileWriter(outWav, fmt))
        {
            var tmp = new float[Rate * Channels / 100];
            var mix = new float[tmp.Length];
            while (true)
            {
                Array.Clear(mix, 0, mix.Length);
                bool any = false;
                foreach (var tr in tracks)
                {
                    if (tr.Done) continue;
                    int got = ReadSome(tr.Provider, tmp, tmp.Length);
                    for (int i = 0; i < got; i++) mix[i] += (float)(tmp[i] * tr.Gain);
                    if (got < tmp.Length) tr.Done = true;
                    any = true;
                }
                for (int i = 0; i < mix.Length; i++)
                {
                    if (Math.Abs(mix[i]) > peak) peak = Math.Abs(mix[i]);
                    if (mix[i] > 1f) mix[i] = 1f;
                    else if (mix[i] < -1f) mix[i] = -1f;
                }
                writer.WriteSamples(mix, 0, mix.Length);
                frames += mix.Length / Channels;
                if (!any) break;
            }
        }
        var json = "{\"ok\":true,\"mode\":\"cue-selftest\",\"sampleRate\":" + Rate + ",\"channels\":" + Channels + ",\"frames\":" + frames + ",\"durationMs\":" + (frames * 1000L / Rate) + ",\"peak\":" + CaptureTest.F(peak) + ",\"files\":\"" + CaptureTest.J(string.Join("|", tracks.ConvertAll(t => t.Path).ToArray())) + "\"}";
        if (!string.IsNullOrEmpty(resultJson)) CaptureTest.WriteText(resultJson, json);
        Console.WriteLine(json);
        return 0;
    }

    private static int ReadSome(ISampleProvider sp, float[] buf, int count)
    {
        int got = 0;
        while (got < count)
        {
            int n = sp.Read(buf, got, count - got);
            if (n <= 0) break;
            got += n;
        }
        for (int i = got; i < count; i++) buf[i] = 0f;
        return got;
    }

    private static int Usage()
    {
        Console.Error.WriteLine("  --cue <output> <leadMs> <status.json> <file1> <gainDb1> [file2] [gainDb2] ...");
        Console.Error.WriteLine("  --cue-selftest <out.wav> <result.json> <file1> [file2] ...");
        return 2;
    }
}
