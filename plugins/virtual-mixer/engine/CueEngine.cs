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
        private bool running = true;
        public long StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        public long DurationMs;
        public string Files;
        public void Update(long f) { lock (gate) { frames = f; } }
        public void Stop() { lock (gate) { running = false; } }
        public void Write(string path)
        {
            if (string.IsNullOrEmpty(path)) return;
            long f; bool r;
            lock (gate) { f = frames; r = running; }
            double progress = DurationMs > 0 ? Math.Min(1.0, (f * 1000.0 / Rate) / DurationMs) : 0;
            try { CaptureTest.WriteText(path, "{\"ok\":true,\"running\":" + (r ? "true" : "false") + ",\"startedAt\":" + StartedAt + ",\"durationMs\":" + DurationMs + ",\"frames\":" + f + ",\"progress\":" + CaptureTest.F(progress) + ",\"files\":\"" + CaptureTest.J(Files) + "\"}"); } catch { }
        }
    }

    public static int Run(string[] args)
    {
        if (args.Length < 5) return Usage();
        string outputId = args[1];
        double leadMs;
        if (!double.TryParse(args[2], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out leadMs)) leadMs = 300;
        string statusPath = args[3];
        var tracks = LoadTracks(args, 4);
        if (tracks.Count == 0) return 2;
        if (leadMs < 0) leadMs = 0;
        if (leadMs > 5000) leadMs = 5000;
        int leadFrames = (int)Math.Round(Rate * leadMs / 1000.0);
        return Play(outputId, tracks, leadFrames, statusPath);
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
            string path = args[i];
            double gainDb;
            if (!double.TryParse(args[i + 1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out gainDb)) gainDb = 0;
            if (!File.Exists(path)) throw new Exception("FILE_NOT_FOUND: " + path);
            var reader = new AudioFileReader(path);
            ISampleProvider sp = reader;
            if (sp.WaveFormat.SampleRate != Rate) sp = new WdlResamplingSampleProvider(sp, Rate);
            if (sp.WaveFormat.Channels == 1) sp = new MonoToStereoSampleProvider(sp);
            else if (sp.WaveFormat.Channels > 2) throw new Exception("UNSUPPORTED_CHANNELS: " + path);
            list.Add(new Track { Path = path, Provider = sp, Gain = Math.Pow(10.0, gainDb / 20.0), DurationMs = (long)reader.TotalTime.TotalMilliseconds });
        }
        return list;
    }

    private static int Play(string outputId, List<Track> tracks, int leadFrames, string statusPath)
    {
        MMDevice dev = null;
        WasapiOut output = null;
        try
        {
            using (var en = new MMDeviceEnumerator())
            {
                dev = CaptureTest.FindDevice(en, DataFlow.Render, outputId);
                if (dev == null) throw new Exception("NO_OUTPUT_DEVICE");
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
                long totalMs = 0; foreach (var tr in tracks) { if (tr.DurationMs > totalMs) totalMs = tr.DurationMs; } totalMs += leadFrames * 1000L / Rate;
                var status = new CueState { DurationMs = totalMs, Files = string.Join("|", tracks.ConvertAll(t => t.Path).ToArray()) };
                Timer statusTimer = null;
                if (!string.IsNullOrEmpty(statusPath)) { status.Write(statusPath); statusTimer = new Timer(delegate { status.Write(statusPath); }, null, 200, 200); }
                var tmp = new float[Rate * Channels / 100];
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
                    for (int i = 0; i < mix.Length; i++)
                    {
                        if (mix[i] > 1f) mix[i] = 1f;
                        else if (mix[i] < -1f) mix[i] = -1f;
                    }
                    var bytes = new byte[mix.Length * sizeof(float)];
                    Buffer.BlockCopy(mix, 0, bytes, 0, bytes.Length);
                    outBuf.AddSamples(bytes, 0, bytes.Length);
                    frames += mix.Length / Channels;
                    status.Update(frames);
                    if (!any) break;
                    Thread.Sleep(10);
                }
                output.Stop();
                status.Stop();
                if (statusTimer != null) statusTimer.Dispose();
                status.Write(statusPath);
                return 0;
            }
        }
        finally
        {
            try { if (output != null) output.Dispose(); } catch { }
            try { if (dev != null) dev.Dispose(); } catch { }
        }
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
