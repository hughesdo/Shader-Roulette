// ============================================================ playback, export
class Player {
  constructor() { this.ctx = null; this.buffer = null; this.src = null; this.playing = false; this.offset = 0; this.startAt = 0; this.onEnded = null; this.recDest = null; }
  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }
  get duration() { return this.buffer ? this.buffer.duration : 0; }
  setBuffer(b) { this.stop(); this.buffer = b; this.offset = 0; }
  async play(from) {
    if (!this.buffer) return;
    const ctx = this.ensure();
    if (ctx.state !== 'running') await ctx.resume();
    this._kill();
    const t0 = Math.max(0, Math.min(this.duration - 0.01, from ?? this.offset));
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    src.onended = () => { if (this.src === src) { this.playing = false; this.offset = this.duration; this.src = null; this.onEnded && this.onEnded(); } };
    src.start(ctx.currentTime + 0.02, t0);
    this.startAt = ctx.currentTime + 0.02 - t0;
    this.src = src; this.playing = true;
  }
  _kill() { if (this.src) { const s = this.src; this.src = null; try { s.onended = null; s.stop(); } catch (e) {} } }
  pause() { if (!this.playing) return; this.offset = this.time(); this._kill(); this.playing = false; }
  stop() { this._kill(); this.playing = false; this.offset = 0; }
  seek(t) { t = Math.max(0, Math.min(this.duration, t)); if (this.playing) this.play(t); else this.offset = t; }
  // audible time; when recording use graph time so picture and captured audio line up
  time(graphTime) {
    if (!this.playing || !this.ctx) return this.offset;
    let ct = this.ctx.currentTime;
    if (!graphTime && this.ctx.getOutputTimestamp) {
      const ts = this.ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) ct = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
    return Math.max(0, Math.min(this.duration, ct - this.startAt));
  }
  recordStream() {
    const ctx = this.ensure();
    if (!this.recDest) { this.recDest = ctx.createMediaStreamDestination(); this.gain.connect(this.recDest); }
    return this.recDest.stream;
  }
}

// Real-time recording: MP4 with H.264 + AAC where the browser can, otherwise WebM (which X won't take).
function pickRecorderMime() {
  const c = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d0028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of c) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
  return null;
}
// What a recorder MIME type means for posting.
function describeRecorderMime(mime) {
  const mp4 = /^video\/mp4/.test(mime);
  const video = /avc1/.test(mime) ? 'H.264' : /vp9/.test(mime) ? 'VP9' : /vp8/.test(mime) ? 'VP8' : null;
  const audio = /mp4a/.test(mime) ? 'AAC' : /opus/.test(mime) ? 'Opus' : null;
  return { container: mp4 ? 'mp4' : 'webm', video, audio, unknown: !video || !audio };
}

// ============================================================ Shadertoy music texture, computed offline
// Rebuilds what an AnalyserNode (fftSize 1024, smoothing 0.8, -100..-30 dB) would show at any time t,
// straight from the decoded song. Preview and frame-perfect render read the same bytes, so a shader
// reacts identically in both, at any frame rate.
class MusicTexture {
  constructor(buffer) {
    const len = buffer.length, ch = buffer.numberOfChannels;
    this.sr = buffer.sampleRate;
    this.mono = new Float32Array(len);
    for (let c = 0; c < ch; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < len; i++) this.mono[i] += d[i] / ch; }
    this.N = 1024;
    this.fft = makeFFT(this.N);
    this.re = new Float64Array(this.N); this.im = new Float64Array(this.N);
    this.win = new Float32Array(this.N);
    const a0 = 0.42, a1 = 0.5, a2 = 0.08;                // Blackman, as the Web Audio spec uses
    for (let i = 0; i < this.N; i++) this.win[i] = a0 - a1 * Math.cos(2 * Math.PI * i / this.N) + a2 * Math.cos(4 * Math.PI * i / this.N);
    this.smooth = new Float32Array(512);
    this.bytes = new Uint8Array(1024);
    this.lastT = -1;
  }
  // Silence (for probes and before a song is loaded) or a synthetic "busy music" spectrum.
  static synthetic(level, t) {
    const b = new Uint8Array(1024);
    for (let k = 0; k < 512; k++) {
      const f = k / 512;
      const v = level * (0.95 - 0.75 * Math.pow(f, 0.5)) * (0.75 + 0.25 * Math.sin(t * 7 + k * 0.21));
      b[k] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    for (let k = 0; k < 512; k++) b[512 + k] = Math.round(128 + 100 * level * Math.sin(k * 0.09 + t * 30) * Math.sin(k * 0.013));
    return b;
  }
  at(t, fps) {
    const N = this.N, mono = this.mono, re = this.re, im = this.im;
    const end = Math.round(t * this.sr), start = end - N;
    for (let i = 0; i < N; i++) {
      const s = start + i;
      re[i] = (s >= 0 && s < mono.length ? mono[s] : 0) * this.win[i];
      im[i] = 0;
    }
    this.fft(re, im);
    const tau = Math.pow(0.8, 60 / Math.max(1, fps || 60));
    const reset = this.lastT < 0 || t < this.lastT - 1e-4 || t - this.lastT > 0.25;
    this.lastT = t;
    const B = this.bytes;
    for (let k = 0; k < 512; k++) {
      const m = Math.hypot(re[k], im[k]) / N;
      const v = reset ? m : tau * this.smooth[k] + (1 - tau) * m;
      this.smooth[k] = v;
      const db = 20 * Math.log10(v + 1e-12);
      B[k] = Math.max(0, Math.min(255, Math.round((db + 100) / 70 * 255)));
    }
    for (let i = 0; i < 512; i++) {
      const s = end - 512 + i;
      const x = s >= 0 && s < mono.length ? mono[s] : 0;
      B[512 + i] = Math.max(0, Math.min(255, Math.round(128 + 128 * x)));
    }
    return B;
  }
}
