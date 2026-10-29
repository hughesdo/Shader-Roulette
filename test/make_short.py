# Synthetic 128 BPM test song with clear sections: intro, verse, build, drop, break, drop, outro.
import numpy as np, wave, sys
sr = 44100; bpm = 128; beat = 60 / bpm; bar = beat * 4
plan = [('intro', 2), ('build', 2), ('drop', 4)]
total = sum(b for _, b in plan) * bar
n = int(total * sr) + sr
out = np.zeros(n)
rng = np.random.default_rng(3)
def add(sig, t):
    i = int(t * sr); j = min(n, i + len(sig)); out[i:j] += sig[: j - i]
def kick(a=1.0):
    t = np.arange(int(0.35 * sr)) / sr
    f = 50 + 120 * np.exp(-t * 30)
    return a * np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-t * 7)
def snare(a=0.6):
    t = np.arange(int(0.25 * sr)) / sr
    return a * (rng.standard_normal(len(t)) * 0.7 + np.sin(2 * np.pi * 190 * t) * 0.5) * np.exp(-t * 16)
def hat(a=0.25):
    t = np.arange(int(0.06 * sr)) / sr
    x = rng.standard_normal(len(t)); x = np.diff(x, prepend=0)
    return a * x * np.exp(-t * 60)
def tone(f, d, a, kind='saw'):
    t = np.arange(int(d * sr)) / sr
    ph = (f * t) % 1
    s = (2 * ph - 1) if kind == 'saw' else np.sin(2 * np.pi * f * t)
    env = np.minimum(1, t / 0.01) * np.exp(-t * 2.5)
    return a * s * env
def pad(f, d, a):
    t = np.arange(int(d * sr)) / sr
    s = sum(np.sin(2 * np.pi * f * k * t + k) / k for k in (1, 2, 3))
    env = np.minimum(1, t / 0.6) * np.minimum(1, (d - t) / 0.6)
    return a * s * env
chords = [55, 65.4, 49, 58.3]
t0 = 0
for name, bars in plan:
    for b in range(bars):
        tb = t0 + b * bar
        root = chords[b % 4]
        if name in ('intro', 'break', 'outro'):
            add(pad(root * 4, bar, 0.12), tb)
            for k in range(8): add(hat(0.08), tb + k * beat / 2)
        if name in ('verse', 'drop', 'build'):
            for k in range(4): add(kick(1.0 if name != 'build' else 0.8), tb + k * beat)
        if name == 'verse':
            for k in (1, 3): add(snare(0.45), tb + k * beat)
            for k in range(8): add(hat(0.12), tb + k * beat / 2)
            for k in range(4): add(tone(root, beat * 0.9, 0.18, 'sine'), tb + k * beat)
        if name == 'build':
            steps = 4 * (2 ** min(3, b))
            for k in range(steps): add(snare(0.3 + 0.1 * b), tb + k * bar / steps)
            t = np.arange(int(bar * sr)) / sr
            add(rng.standard_normal(len(t)) * 0.05 * (b + t / bar) / 4, tb)
        if name == 'drop':
            for k in (1, 3): add(snare(0.7), tb + k * beat)
            for k in range(16): add(hat(0.18), tb + k * beat / 4)
            for k in range(8): add(tone(root * 2, beat * 0.45, 0.35), tb + k * beat / 2)
            for k in range(4): add(tone(root * 8 * (1.5 if k % 2 else 1), beat * 0.4, 0.12), tb + k * beat + beat / 2)
    t0 += bars * bar
out /= np.max(np.abs(out)) * 1.05
pcm = (np.stack([out, out], 1) * 32767).astype('<i2')
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'song.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
print('wrote', total, 's')
