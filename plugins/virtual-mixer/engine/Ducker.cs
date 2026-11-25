using System;

// S2a core: microphone sidechain ducking for the music/system channels.
// Pure managed code; no NAudio dependency, so it can be tested offline.
internal sealed class Ducker
{
    public double ThresholdDb = -35.0;
    public double DepthDb = -15.0;
    public double AttackMs = 45.0;
    public double ReleaseMs = 600.0;
    public double HoldMs = 650.0;
    public double LookaheadMs = 8.0;
    public double SidechainHpfHz = 120.0;

    private readonly int sampleRate;
    private readonly double[] delay;
    private int delayPos;
    private double hpPrevIn, hpPrevOut;
    private double env;
    private int holdRemaining;
    private double gain = 1.0;

    public Ducker(int sampleRate)
    {
        this.sampleRate = sampleRate;
        int n = (int)Math.Round(sampleRate * LookaheadMs / 1000.0);
        if (n < 1) n = 1;
        delay = new double[n];
        delayPos = 0;
        gain = 1.0;
    }

    public double CurrentGain { get { return gain; } }

    public void Reset()
    {
        Array.Clear(delay, 0, delay.Length);
        delayPos = 0;
        hpPrevIn = hpPrevOut = 0;
        env = 0;
        holdRemaining = 0;
        gain = 1.0;
    }

    // Returns the delayed+ducked music sample. mic is the raw microphone sample.
    public float Process(float music, float mic, out float appliedGain)
    {
        double hp = ProcessHighPass(mic);
        double abs = Math.Abs(hp);
        // fast attack, slower release: envelope follower in linear amplitude
        double envCoef = abs > env ? Coef(5.0) : Coef(150.0);
        env += (abs - env) * envCoef;

        bool speaking = env > DbToLin(ThresholdDb);
        if (speaking) holdRemaining = (int)Math.Round(sampleRate * HoldMs / 1000.0);
        else if (holdRemaining > 0) holdRemaining--;

        bool shouldDuck = speaking || holdRemaining > 0;
        double target = shouldDuck ? DbToLin(DepthDb) : 1.0;
        double smooth = target < gain ? Coef(AttackMs) : Coef(ReleaseMs);
        gain += (target - gain) * smooth;

        // lookahead delay for music, so the first consonant is not exposed
        double delayed = delay[delayPos];
        delay[delayPos] = music;
        delayPos++;
        if (delayPos >= delay.Length) delayPos = 0;

        appliedGain = (float)gain;
        return (float)(delayed * gain);
    }

    private double ProcessHighPass(double x)
    {
        double rc = 1.0 / (2.0 * Math.PI * SidechainHpfHz);
        double dt = 1.0 / sampleRate;
        double alpha = rc / (rc + dt);
        double y = alpha * (hpPrevOut + x - hpPrevIn);
        hpPrevIn = x;
        hpPrevOut = y;
        return y;
    }

    private double Coef(double ms)
    {
        if (ms <= 0) return 1.0;
        return 1.0 - Math.Exp(-1.0 / (sampleRate * ms / 1000.0));
    }

    public static double DbToLin(double db) { return Math.Pow(10.0, db / 20.0); }
}
