using System;

// Lightweight microphone noise gate used by the main live mixer.
// It is an envelope-following expander, not a spectral denoiser: low CPU and
// effective for fans/hiss between phrases.
internal sealed class NoiseGate
{
    private readonly double attackCoef, releaseCoef;
    private readonly double threshold;
    private readonly double minGain;
    private double env = 0.0;
    private double gain = 1.0;

    public NoiseGate(int rate, double thresholdDb, double rangeDb, double attackMs, double releaseMs)
    {
        threshold = Math.Pow(10.0, thresholdDb / 20.0);
        minGain = Math.Pow(10.0, -Math.Abs(rangeDb) / 20.0);
        attackCoef = 1.0 - Math.Exp(-1.0 / Math.Max(1.0, rate * attackMs / 1000.0));
        releaseCoef = 1.0 - Math.Exp(-1.0 / Math.Max(1.0, rate * releaseMs / 1000.0));
    }

    public float Process(float input)
    {
        double a = Math.Abs(input);
        if (a > env) env += (a - env) * 0.35; // fast peak follow
        else env += (a - env) * 0.002;         // slower decay
        double target = env >= threshold ? 1.0 : minGain;
        double coef = target > gain ? attackCoef : releaseCoef;
        gain += (target - gain) * coef;
        return (float)(input * gain);
    }
}
