using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

// VRCLiveBoard virtual mixer engine (S1 skeleton)
// Modes:
//   --version
//   --list-devices <out.json>
//   --selftest <out.wav> [result.json]
// No live capture/output yet; S2 adds channel capture and ducking.
internal static class Program
{
    private const string EngineVersion = "0.3.0";
    private const int SampleRate = 48000;
    private const int Channels = 2;

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 0) { Usage(); return 2; }
            if (args[0] == "--version")
            {
                Console.WriteLine("{\"ok\":true,\"engine\":\"VirtualMixerEngine\",\"version\":\"" + EngineVersion + "\",\"naudio\":\"1.10.0\"}");
                return 0;
            }
            if (args[0] == "--list-devices" && args.Length >= 2) return ListDevices(args[1]);
            if (args[0] == "--selftest" && args.Length >= 2) return SelfTest(args[1], args.Length >= 3 ? args[2] : null);
            if (args[0] == "--duck-selftest" && args.Length >= 2) return DuckSelfTest(args[1], args.Length >= 3 ? args[2] : null);
            if (args[0] == "--capture-test") return CaptureTest.Run(args);
            Usage();
            return 2;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("ERROR: " + ex.Message);
            return 1;
        }
    }

    private static void Usage()
    {
        Console.Error.WriteLine("VirtualMixerEngine " + EngineVersion);
        Console.Error.WriteLine("  --version");
        Console.Error.WriteLine("  --list-devices <out.json>");
        Console.Error.WriteLine("  --selftest <out.wav> [result.json]");
        Console.Error.WriteLine("  --duck-selftest <out.wav> [result.json]");
        Console.Error.WriteLine("  --capture-test <out.wav> <seconds> [renderId] [micId] [result.json]");
    }

    private static int ListDevices(string outPath)
    {
        var sb = new StringBuilder();
        sb.Append("{\"ok\":true,\"render\":[");
        var first = true;
        using (var en = new MMDeviceEnumerator())
        {
            string defaultRender = null;
            string defaultCapture = null;
            try { defaultRender = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Console).ID; } catch { }
            try { defaultCapture = en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Console).ID; } catch { }
            foreach (var d in en.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"id\":\"").Append(J(d.ID)).Append("\",\"name\":\"").Append(J(d.FriendlyName)).Append("\",\"default\":").Append(d.ID == defaultRender ? "true" : "false").Append('}');
            }
            sb.Append("],\"capture\":[");
            first = true;
            foreach (var d in en.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"id\":\"").Append(J(d.ID)).Append("\",\"name\":\"").Append(J(d.FriendlyName)).Append("\",\"default\":").Append(d.ID == defaultCapture ? "true" : "false").Append('}');
            }
        }
        sb.Append("]}");
        WriteText(outPath, sb.ToString());
        Console.WriteLine("{\"ok\":true,\"output\":\"" + J(outPath) + "\"}");
        return 0;
    }

    private static int SelfTest(string outWav, string resultJson)
    {
        var temp = Path.Combine(Path.GetTempPath(), "vrcb-mixer-selftest-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        var aPath = Path.Combine(temp, "tone-a.wav");
        var bPath = Path.Combine(temp, "tone-b.wav");
        try
        {
            GenerateTone(aPath, 440.0, 0.25, 2.0);
            GenerateTone(bPath, 660.0, 0.15, 2.0);
            using (var a = new AudioFileReader(aPath))
            using (var b = new AudioFileReader(bPath))
            {
                var mix = new MixingSampleProvider(new ISampleProvider[] { new GainSampleProvider(a, 0.8f), new GainSampleProvider(b, 0.8f) });
                WaveFileWriter.CreateWaveFile16(outWav, mix);
            }
            double peak, rms; long frames;
            ReadStats(outWav, out peak, out rms, out frames);
            var json = "{\"ok\":true,\"engine\":\"VirtualMixerEngine\",\"version\":\"" + EngineVersion + "\",\"sampleRate\":" + SampleRate + ",\"channels\":" + Channels +
                ",\"frames\":" + frames + ",\"durationMs\":" + (int)(frames * 1000L / SampleRate) +
                ",\"peak\":" + F(peak) + ",\"rms\":" + F(rms) + ",\"output\":\"" + J(outWav) + "\"}";
            if (!string.IsNullOrEmpty(resultJson)) WriteText(resultJson, json);
            Console.WriteLine(json);
            return 0;
        }
        finally
        {
            try { Directory.Delete(temp, true); } catch { }
        }
    }

    private static void GenerateTone(string path, double frequency, double gain, double seconds)
    {
        var format = WaveFormat.CreateIeeeFloatWaveFormat(SampleRate, Channels);
        using (var writer = new WaveFileWriter(path, format))
        {
            long total = (long)(SampleRate * seconds);
            var buffer = new float[SampleRate * Channels];
            long done = 0;
            while (done < total)
            {
                int frames = (int)Math.Min(buffer.Length / Channels, total - done);
                for (int i = 0; i < frames; i++)
                {
                    double t = (done + i) / (double)SampleRate;
                    float s = (float)(Math.Sin(2.0 * Math.PI * frequency * t) * gain);
                    buffer[i * Channels] = s;
                    buffer[i * Channels + 1] = s;
                }
                writer.WriteSamples(buffer, 0, frames * Channels);
                done += frames;
            }
        }
    }


    private static int DuckSelfTest(string outWav, string resultJson)
    {
        const int seconds = 3;
        var d = new Ducker(SampleRate);
        int frames = SampleRate * seconds;
        var left = new double[frames];
        var right = new double[frames];
        var buffer = new float[SampleRate * Channels];
        double musicAmp = 0.20;
        double micAmp = 0.15;
        using (var writer = new WaveFileWriter(outWav, WaveFormat.CreateIeeeFloatWaveFormat(SampleRate, Channels)))
        {
            int at = 0;
            for (int i = 0; i < frames; i++)
            {
                double t = i / (double)SampleRate;
                bool speech = (t >= 0.3 && t < 1.0) || (t >= 1.4 && t < 2.2);
                double music = Math.Sin(2.0 * Math.PI * 440.0 * t) * musicAmp;
                double mic = speech ? Math.Sin(2.0 * Math.PI * 180.0 * t) * micAmp : 0.0;
                float applied;
                double ducked = d.Process((float)music, (float)mic, out applied);
                left[i] = ducked;
                right[i] = mic;
                buffer[at++] = (float)ducked;
                buffer[at++] = (float)mic;
                if (at == buffer.Length) { writer.WriteSamples(buffer, 0, at); at = 0; }
            }
            if (at > 0) writer.WriteSamples(buffer, 0, at);
        }
        double quiet = 0, loud = 0;
        int qn = 0, ln = 0;
        for (int i = 0; i < frames; i++)
        {
            double t = i / (double)SampleRate;
            if ((t >= 0.05 && t < 0.2) || (t >= 2.5 && t < 2.9)) { quiet += left[i] * left[i]; qn++; }
            if ((t >= 0.6 && t < 0.9) || (t >= 1.7 && t < 2.0)) { loud += left[i] * left[i]; ln++; }
        }
        double q = qn > 0 ? Math.Sqrt(quiet / qn) : 0;
        double l = ln > 0 ? Math.Sqrt(loud / ln) : 0;
        double att = (q > 0 && l > 0) ? 20.0 * Math.Log10(q / l) : 0;
        var json = "{\"ok\":true,\"engine\":\"VirtualMixerEngine\",\"version\":\"" + EngineVersion + "\",\"sampleRate\":" + SampleRate +
            ",\"channels\":" + Channels + ",\"frames\":" + frames + ",\"durationMs\":" + (frames * 1000L / SampleRate) +
            ",\"quietMusicRms\":" + F(q) + ",\"speechMusicRms\":" + F(l) + ",\"attenuationDb\":" + F(att) + ",\"output\":\"" + J(outWav) + "\"}";
        if (!string.IsNullOrEmpty(resultJson)) WriteText(resultJson, json);
        Console.WriteLine(json);
        return att >= 6.0 ? 0 : 3;
    }

    private static void ReadStats(string path, out double peak, out double rms, out long frames)
    {
        peak = 0; rms = 0; frames = 0;
        double sum = 0;
        using (var reader = new AudioFileReader(path))
        {
            var buf = new float[SampleRate * Channels];
            int n;
            while ((n = reader.Read(buf, 0, buf.Length)) > 0)
            {
                for (int i = 0; i < n; i++)
                {
                    double v = buf[i];
                    if (Math.Abs(v) > peak) peak = Math.Abs(v);
                    sum += v * v;
                }
                frames += n / Channels;
            }
        }
        if (frames > 0) rms = Math.Sqrt(sum / (frames * Channels));
    }

    private static void WriteText(string path, string text)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.WriteAllText(path, text, new UTF8Encoding(false));
    }

    private static string J(string s)
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

    private static string F(double v) { return v.ToString("0.######", CultureInfo.InvariantCulture); }
}

internal sealed class GainSampleProvider : ISampleProvider
{
    private readonly ISampleProvider source;
    private readonly float gain;
    public GainSampleProvider(ISampleProvider source, float gain) { this.source = source; this.gain = gain; }
    public WaveFormat WaveFormat { get { return source.WaveFormat; } }
    public int Read(float[] buffer, int offset, int count)
    {
        int n = source.Read(buffer, offset, count);
        for (int i = 0; i < n; i++) buffer[offset + i] *= gain;
        return n;
    }
}
