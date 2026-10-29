// ============================================================ audio analysis (offline, whole track)
// Produces per-frame (100 fps) band envelopes, onset envelopes, a 64-bin log spectrum,
// beat grid (DP beat tracker), downbeats and section boundaries (self-similarity novelty).

const AN_FPS = 100;
const BAND_DEFS = [[20, 150], [150, 500], [500, 2000], [2000, 6000], [6000, 16000]];
const BAND_KEYS = ['bass', 'lowmid', 'mid', 'high', 'treble'];
const FLUX_DEFS = { kick: [35, 140], snare: [180, 4500], hat: [7000, 16000], full: [30, 16000] };

function makeFFT(n) {
  const levels = Math.round(Math.log2(n));
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let j = 0; j < levels; j++) r = (r << 1) | ((i >>> j) & 1); rev[i] = r; }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >>> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };
}

function percentile(arr, q, mask) {
  const v = [];
  for (let i = 0; i < arr.length; i++) if (!mask || mask[i]) v.push(arr[i]);
  if (!v.length) return 0;
  v.sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.floor(q * (v.length - 1))))];
}

function envFollow(src, attack, release, fps) {
  const out = new Float32Array(src.length);
  const ca = 1 - Math.exp(-1 / (attack * fps)), cr = 1 - Math.exp(-1 / (release * fps));
  let y = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    y += (x - y) * (x > y ? ca : cr);
    out[i] = y;
  }
  return out;
}

function movingAvg(src, half) {
  const n = src.length, out = new Float32Array(n);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half), b = Math.min(n, i + half + 1);
    out[i] = (pre[b] - pre[a]) / (b - a);
  }
  return out;
}

function pickOnsets(flux, fps, opt) {
  const n = flux.length;
  const avg = movingAvg(flux, Math.round(opt.win * fps));
  const floor = percentile(flux, 0.5) * 0.4 + 1e-6;
  const m = opt.local, minGap = Math.round(opt.gap * fps);
  const ev = [];
  let last = -1e9;
  for (let i = 1; i < n - 1; i++) {
    const thr = avg[i] * opt.k + floor;
    const v = flux[i];
    if (v <= thr) continue;
    let isMax = true;
    for (let j = Math.max(0, i - m); j <= Math.min(n - 1, i + m); j++) if (flux[j] > v) { isMax = false; break; }
    if (!isMax || i - last < minGap) continue;
    ev.push({ i, t: i / fps, raw: v - thr });
    last = i;
  }
  const ref = percentile(ev.map(e => e.raw), 0.9) || 1;
  for (const e of ev) e.s = Math.min(1, Math.sqrt(e.raw / ref));
  const env = new Float32Array(n);
  const decay = Math.exp(-1 / (opt.tau * fps));
  let k = 0, y = 0;
  for (let i = 0; i < n; i++) {
    y *= decay;
    while (k < ev.length && ev[k].i === i) { y = Math.max(y, ev[k].s); k++; }
    env[i] = y;
  }
  return { events: ev, env };
}

function estimateTempo(o, fps) {
  const n = o.length;
  const minLag = Math.round(fps * 60 / 210), maxLag = Math.round(fps * 60 / 55);
  const N = Math.min(n, fps * 120);            // first two minutes are plenty
  const start = Math.max(0, Math.floor((n - N) / 2));
  let best = -1, bestLag = Math.round(fps * 0.5), conf = 0;
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = start; i < start + N - lag; i++) s += o[i] * o[i + lag];
    ac[lag] = s / (N - lag);
  }
  let mean = 0; for (let lag = minLag; lag <= maxLag; lag++) mean += ac[lag]; mean /= (maxLag - minLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 * fps / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const v = ac[lag] * w;
    if (v > best) { best = v; bestLag = lag; }
  }
  // parabolic refinement
  const a = ac[bestLag - 1] || ac[bestLag], b = ac[bestLag], c = ac[bestLag + 1] || ac[bestLag];
  const den = a - 2 * b + c;
  const off = den !== 0 ? 0.5 * (a - c) / den : 0;
  conf = mean > 0 ? b / mean : 0;
  return { period: bestLag + Math.max(-0.5, Math.min(0.5, off)), conf };
}

function trackBeats(o, fps, period) {
  const n = o.length, P = period, tight = 100;
  const score = new Float32Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(2 * P), hi = Math.max(1, Math.round(P / 2));
  for (let i = 0; i < n; i++) {
    let best = -Infinity, bi = -1;
    for (let j = Math.max(0, i - lo); j <= i - hi; j++) {
      const r = Math.log((i - j) / P);
      const v = score[j] - tight * r * r;
      if (v > best) { best = v; bi = j; }
    }
    if (bi >= 0 && best > 0) { score[i] = o[i] + best; back[i] = bi; } else score[i] = o[i];
  }
  let end = n - 1, bs = -Infinity;
  for (let i = Math.max(0, n - Math.round(P)); i < n; i++) if (score[i] > bs) { bs = score[i]; end = i; }
  const beats = [];
  for (let i = end; i >= 0; i = back[i]) { beats.push(i); if (back[i] < 0) break; }
  beats.reverse();
  // extend grid back to the start of the track if the DP stopped early
  const b0 = beats.length ? beats[0] : 0;
  const pre = [];
  for (let t = b0 - P; t >= 0; t -= P) pre.unshift(Math.round(t));
  return pre.concat(beats);
}

function findSections(A, beats, downIdxPhase) {
  const nb = beats.length - 1;
  if (nb < 24) return [];
  const F = [];
  const dims = 16 + 1 + 5;
  for (let k = 0; k < nb; k++) {
    const a = beats[k], b = Math.max(a + 1, beats[k + 1]);
    const f = new Float32Array(dims);
    for (let i = a; i < b; i++) {
      for (let g = 0; g < 16; g++) {
        let s = 0; for (let q = 0; q < 4; q++) s += A.spec[i * 64 + g * 4 + q];
        f[g] += s / 4;
      }
      f[16] += A.level[i];
      for (let q = 0; q < 5; q++) f[17 + q] += A.bands[BAND_KEYS[q]][i];
    }
    for (let d = 0; d < dims; d++) f[d] /= (b - a);
    F.push(f);
  }
  // z-score
  for (let d = 0; d < dims; d++) {
    let m = 0, s = 0;
    for (const f of F) m += f[d]; m /= nb;
    for (const f of F) s += (f[d] - m) ** 2; s = Math.sqrt(s / nb) || 1;
    for (const f of F) f[d] = (f[d] - m) / s;
  }
  const norms = F.map(f => Math.sqrt(f.reduce((x, y) => x + y * y, 0)) || 1);
  const S = (i, j) => {
    if (i < 0 || j < 0 || i >= nb || j >= nb) return 0;
    let s = 0; const a = F[i], b = F[j];
    for (let d = 0; d < dims; d++) s += a[d] * b[d];
    return s / (norms[i] * norms[j]);
  };
  const L = Math.max(4, Math.min(16, Math.floor(nb / 6)));
  const g = []; for (let i = -L; i < L; i++) g.push(Math.exp(-0.5 * ((i + 0.5) / (L * 0.5)) ** 2));
  const nov = new Float32Array(nb);
  for (let k = 0; k < nb; k++) {
    let s = 0;
    for (let i = -L; i < L; i++) for (let j = -L; j < L; j++) {
      const sg = ((i < 0) === (j < 0)) ? 1 : -1;
      s += sg * g[i + L] * g[j + L] * S(k + i, k + j);
    }
    nov[k] = Math.max(0, s);
  }
  // energy-change novelty
  const lv = F.map(f => f[16]);
  const en = new Float32Array(nb);
  for (let k = 0; k < nb; k++) {
    let a = 0, b = 0, ca = 0, cb = 0;
    for (let i = Math.max(0, k - 8); i < k; i++) { a += lv[i]; ca++; }
    for (let i = k; i < Math.min(nb, k + 8); i++) { b += lv[i]; cb++; }
    en[k] = ca && cb ? Math.abs(b / cb - a / ca) : 0;
  }
  const nmax = Math.max(...nov) || 1, emax = Math.max(...en) || 1;
  const comb = new Float32Array(nb);
  for (let k = 0; k < nb; k++) comb[k] = nov[k] / nmax + 0.6 * en[k] / emax;
  let mean = 0; for (const v of comb) mean += v; mean /= nb;
  let sd = 0; for (const v of comb) sd += (v - mean) ** 2; sd = Math.sqrt(sd / nb);
  const out = [];
  for (let k = 8; k < nb - 8; k++) {
    const v = comb[k];
    if (v < mean + 0.35 * sd) continue;
    let isMax = true;
    for (let j = k - 8; j <= k + 8; j++) if (comb[j] > v) { isMax = false; break; }
    if (!isMax) continue;
    // snap to nearest downbeat
    let kk = k, bestd = 9;
    for (let j = k - 2; j <= k + 2; j++) if (j >= 0 && ((j - downIdxPhase) % 4 + 4) % 4 === 0 && Math.abs(j - k) < bestd) { bestd = Math.abs(j - k); kk = j; }
    out.push({ beat: kk, t: beats[kk] / AN_FPS, strength: Math.min(1, (v - mean) / (2.5 * sd + 1e-6)) });
  }
  return out;
}

async function analyzeAudio(buffer, onProgress) {
  const sr = buffer.sampleRate, N = 2048, fps = AN_FPS, hop = sr / fps;
  const len = buffer.length, nF = Math.floor(len / hop) + 1;
  const mono = new Float32Array(len);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i] / buffer.numberOfChannels;
  }
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const half = N / 2, binHz = sr / N, scale = N / 4;
  const rng = ([lo, hi]) => [Math.max(1, Math.floor(lo / binHz)), Math.min(half, Math.ceil(hi / binHz))];
  const bandR = BAND_DEFS.map(rng);
  const fluxR = Object.fromEntries(Object.entries(FLUX_DEFS).map(([k, v]) => [k, rng(v)]));
  const specEdges = [];
  for (let j = 0; j <= 64; j++) specEdges.push(30 * Math.pow(16000 / 30, j / 64) / binHz);

  const bandDB = BAND_KEYS.map(() => new Float32Array(nF));
  const levelDB = new Float32Array(nF);
  const flux = Object.fromEntries(Object.keys(FLUX_DEFS).map(k => [k, new Float32Array(nF)]));
  const specDB = new Float32Array(nF * 64);
  const fft = makeFFT(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const mag = [new Float32Array(half + 1), new Float32Array(half + 1)];
  let prevLm = new Float32Array(half + 1), curLm = new Float32Array(half + 1);

  const fill = (frame, dst) => {
    const st = Math.round(frame * hop - N / 2);
    let rms = 0;
    for (let i = 0; i < N; i++) {
      const s = st + i;
      const v = (s >= 0 && s < len) ? mono[s] : 0;
      rms += v * v;
      dst[i] = v * win[i];
    }
    return Math.sqrt(rms / N);
  };
  const tmpB = new Float64Array(N);
  const process = (f, m, rms) => {
    levelDB[f] = 20 * Math.log10(rms + 1e-6);
    for (let b = 0; b < 5; b++) {
      const [a, z] = bandR[b]; let e = 0;
      for (let k = a; k <= z; k++) e += m[k] * m[k];
      bandDB[b][f] = 10 * Math.log10(e / (scale * scale) + 1e-10);
    }
    for (let k = 0; k <= half; k++) curLm[k] = Math.log1p(100 * m[k] / scale);
    for (const key in fluxR) {
      const [a, z] = fluxR[key]; let s = 0;
      for (let k = a; k <= z; k++) { const d = curLm[k] - prevLm[k]; if (d > 0) s += d; }
      flux[key][f] = s / (z - a + 1);
    }
    for (let j = 0; j < 64; j++) {
      const lo = specEdges[j], hi = specEdges[j + 1];
      let v = 0;
      if (hi - lo < 1) {
        const x = (lo + hi) / 2, k0 = Math.floor(x), fr = x - k0;
        v = m[k0] * (1 - fr) + m[Math.min(half, k0 + 1)] * fr;
      } else {
        for (let k = Math.floor(lo); k <= Math.min(half, Math.ceil(hi)); k++) v = Math.max(v, m[k]);
      }
      specDB[f * 64 + j] = 20 * Math.log10(v / scale + 1e-6);
    }
    const t = prevLm; prevLm = curLm; curLm = t;
  };

  for (let f = 0; f < nF; f += 2) {
    const r1 = fill(f, re);
    const has2 = f + 1 < nF;
    const r2 = has2 ? fill(f + 1, tmpB) : 0;
    for (let i = 0; i < N; i++) im[i] = has2 ? tmpB[i] : 0;
    fft(re, im);
    for (let k = 0; k <= half; k++) {
      const nk = (N - k) % N;
      const ar = (re[k] + re[nk]) / 2, ai = (im[k] - im[nk]) / 2;
      const br = (im[k] + im[nk]) / 2, bi = -(re[k] - re[nk]) / 2;
      mag[0][k] = Math.hypot(ar, ai);
      mag[1][k] = Math.hypot(br, bi);
    }
    process(f, mag[0], r1);
    if (has2) process(f + 1, mag[1], r2);
    if ((f & 511) === 0) { onProgress && onProgress(0.85 * f / nF); await new Promise(r => setTimeout(r, 0)); }
  }

  // --- normalise per song
  const lvMax = percentile(levelDB, 0.95);
  const active = new Uint8Array(nF);
  for (let i = 0; i < nF; i++) active[i] = levelDB[i] > lvMax - 45 ? 1 : 0;
  const norm = (src, pl, ph, gamma) => {
    const lo = percentile(src, pl, active), hi = percentile(src, ph, active);
    const out = new Float32Array(src.length);
    const d = Math.max(1e-3, hi - lo);
    for (let i = 0; i < src.length; i++) out[i] = Math.pow(Math.min(1, Math.max(0, (src[i] - lo) / d)), gamma);
    return out;
  };
  const bands = {};
  BAND_KEYS.forEach((k, b) => { bands[k] = envFollow(norm(bandDB[b], 0.1, 0.985, 1.4), 0.025, 0.22, fps); });
  const level = envFollow(norm(levelDB, 0.1, 0.985, 1.2), 0.03, 0.3, fps);
  onProgress && onProgress(0.88);

  // spectrum to bytes with per-bin release
  const sLo = percentile(specDB.filter((_, i) => i % 7 === 0), 0.35), sHi = percentile(specDB.filter((_, i) => i % 7 === 0), 0.997);
  const spec = new Uint8Array(nF * 64);
  const rel = Math.exp(-1 / (0.12 * fps));
  const hold = new Float32Array(64);
  for (let f = 0; f < nF; f++) for (let j = 0; j < 64; j++) {
    const v = Math.min(1, Math.max(0, (specDB[f * 64 + j] - sLo) / (sHi - sLo)));
    hold[j] = Math.max(v, hold[j] * rel);
    spec[f * 64 + j] = Math.round(hold[j] * 255);
  }
  const specF = new Float32Array(nF * 64);
  for (let i = 0; i < spec.length; i++) specF[i] = spec[i] / 255;

  // onsets
  const kick = pickOnsets(flux.kick, fps, { win: 0.5, k: 1.45, local: 6, gap: 0.11, tau: 0.16 });
  const snare = pickOnsets(flux.snare, fps, { win: 0.5, k: 1.4, local: 5, gap: 0.1, tau: 0.13 });
  const hat = pickOnsets(flux.hat, fps, { win: 0.4, k: 1.35, local: 3, gap: 0.05, tau: 0.07 });
  onProgress && onProgress(0.92);

  // beats
  const fm = movingAvg(flux.full, Math.round(0.6 * fps));
  const o = new Float32Array(nF);
  let sd = 0;
  for (let i = 0; i < nF; i++) { o[i] = Math.max(0, flux.full[i] - fm[i]); sd += o[i] * o[i]; }
  sd = Math.sqrt(sd / nF) || 1;
  for (let i = 0; i < nF; i++) o[i] /= sd;
  const tempo = estimateTempo(o, fps);
  let beats = trackBeats(o, fps, tempo.period);
  if (beats.length < 4) { beats = []; for (let t = 0; t < nF; t += fps * 0.5) beats.push(Math.round(t)); }
  // downbeat phase: where kicks + bass land
  let phase = 0, bestP = -1;
  for (let ph = 0; ph < 4; ph++) {
    let s = 0;
    for (let k = ph; k < beats.length; k += 4) { const i = beats[k]; s += kick.env[i] + 0.5 * bands.bass[i] + 0.3 * o[Math.min(nF - 1, i)]; }
    if (s > bestP) { bestP = s; phase = ph; }
  }
  onProgress && onProgress(0.95);

  const A = {
    fps, n: nF, duration: len / sr, sampleRate: sr,
    bands, level, spec: specF, specBytes: spec,
    kick: kick.env, snare: snare.env, hat: hat.env,
    onsets: { kick: kick.events, snare: snare.events, hat: hat.events },
    beats: beats.map(i => i / fps), downPhase: phase,
    bpm: 60 * fps / tempo.period, tempoConf: tempo.conf,
  };
  A.downbeats = A.beats.filter((_, k) => ((k - phase) % 4 + 4) % 4 === 0);
  A.sections = findSections(A, beats, phase);
  // energy-integrated time
  const flow = new Float32Array(nF);
  let acc = 0;
  for (let i = 0; i < nF; i++) { acc += (0.35 + 0.9 * level[i] + 0.4 * bands.bass[i]) / fps; flow[i] = acc; }
  A.flow = flow;
  onProgress && onProgress(1);
  return A;
}

// sample analysis at time t (seconds)
function sampleAnalysis(A, t) {
  const x = Math.min(A.n - 1, Math.max(0, t * A.fps));
  const i = Math.floor(x), j = Math.min(A.n - 1, i + 1), f = x - i;
  const L = arr => arr[i] + (arr[j] - arr[i]) * f;
  // beat + bar phase
  const ph = (arr) => {
    if (!arr.length) return 0;
    let lo = 0, hi = arr.length - 1;
    if (t < arr[0]) return 0;
    if (t >= arr[hi]) return 0;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= t) lo = m; else hi = m; }
    return (t - arr[lo]) / Math.max(1e-3, arr[hi] - arr[lo]);
  };
  return {
    bass: L(A.bands.bass), lowmid: L(A.bands.lowmid), mid: L(A.bands.mid), high: L(A.bands.high), treble: L(A.bands.treble),
    level: L(A.level), kick: L(A.kick), snare: L(A.snare), hat: L(A.hat), flow: L(A.flow),
    beat: ph(A.beats), bar: ph(A.downbeats), frame: Math.round(x),
  };
}
