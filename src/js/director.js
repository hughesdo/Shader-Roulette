// ============================================================ the director
// Reads the song (analysis.js), picks a style, cuts the song into sections and shots, casts shaders
// from the library, and decides every transition, lens, duet and hit. A fresh random seed on every
// roll, plus a memory of what recent rolls used, means the same song never gets the same video twice.

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const pickR = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
function shuffleR(rnd, arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function wpick(rnd, obj) {
  const ks = Object.keys(obj).filter(k => obj[k] > 0);
  let tot = 0; for (const k of ks) tot += obj[k];
  let r = rnd() * tot;
  for (const k of ks) { r -= obj[k]; if (r <= 0) return k; }
  return ks[ks.length - 1];
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth01 = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const seedCode = (n) => (n >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
const codeSeed = (s) => (parseInt(String(s).trim(), 36) >>> 0) || 1;

// ------------------------------------------------------------ styles
// bars: shot length in bars for low / mid / high energy. feel: how transitions are weighted.
// cutP: chance a shot change inside a section is a plain cut. remix: how much this style plays
// with lenses, grades and duets (scaled by the Remix slider). uniq: share of shots that get a new shader.
const STYLES = {
  pulse: {
    name: 'Pulse', blurb: 'Cuts on the bar, hits on the kick, stutters into every drop.',
    bars: { low: [4, 8], mid: [2, 4], high: [1, 2] }, cutP: 0.45, transBeats: 0.7, stutter: 0.75,
    feel: { hard: 3, punch: 3, musical: 2, smooth: 1 }, fx: 0.85, remix: 1.0, duet: 0.12, motif: 0.6, uniq: 0.7,
    lenses: { 7: 3, 6: 2, 3: 1, 10: 1, 1: 1, 8: 1 }, time: { clock: 3, flow: 3, reverse: 0.4, stepped: 0.4 },
    blends: [0, 2, 4, 5], effects: 1.0, effectTags: ['beat', 'flash', 'shake', 'rgb', 'chromatic', 'zoom', 'pulse', 'bass'],
  },
  drift: {
    name: 'Drift', blurb: 'Long takes, slow dissolves, time that speeds up when the song does.',
    bars: { low: [8, 16], mid: [8, 12], high: [4, 8] }, cutP: 0.05, transBeats: 2.5, stutter: 0,
    feel: { smooth: 5, musical: 1.5, punch: 0.5, hard: 0.1 }, fx: 0.3, remix: 0.7, duet: 0.25, motif: 0.35, uniq: 0.95,
    lenses: { 7: 4, 6: 1, 3: 1, 10: 1 }, time: { clock: 2, flow: 4, reverse: 0.6 },
    blends: [0, 2, 5, 6], effects: 0.6, effectTags: ['trails', 'glow', 'bloom', 'light', 'rays', 'dream', 'blur', 'warp', 'liquid'],
  },
  story: {
    name: 'Story', blurb: 'One world per section. Choruses come home to the same shader.',
    bars: { low: [8, 16], mid: [8, 16], high: [4, 8] }, perSection: true, cutP: 0.2, transBeats: 1.5, stutter: 0.4,
    feel: { smooth: 2, punch: 2, musical: 2, hard: 1 }, fx: 0.6, remix: 0.6, duet: 0.08, motif: 0.85, uniq: 0.85,
    lenses: { 7: 3, 3: 1, 6: 1, 1: 1 }, time: { clock: 3, flow: 3, reverse: 0.3 },
    blends: [0, 2, 4], effects: 0.8, effectTags: [],
  },
  chaos: {
    name: 'Chaos', blurb: 'Fast cuts, double exposures, glitches and lenses everywhere.',
    bars: { low: [2, 4], mid: [1, 2], high: [0.5, 1] }, cutP: 0.4, transBeats: 0.6, stutter: 1,
    feel: { hard: 3, punch: 2.5, musical: 2, smooth: 0.7 }, fx: 1, remix: 1.5, duet: 0.4, motif: 0.25, uniq: 0.6,
    lenses: { 3: 2, 2: 2, 4: 2, 5: 2, 8: 2, 6: 1, 10: 1, 1: 1, 9: 1, 7: 1 }, time: { clock: 2, flow: 2, reverse: 1, stepped: 1.2 },
    blends: [0, 1, 2, 3, 4, 5, 6], effects: 1.7, effectTags: ['glitch', 'datamosh', 'rgb', 'strobe', 'vhs', 'pixel', 'mosaic', 'invert', 'tiktok'],
  },
  cinema: {
    name: 'Cinema', blurb: 'Widescreen bars, film grades, long takes, big moments at the changes.',
    bars: { low: [8, 16], mid: [4, 8], high: [2, 4] }, cutP: 0.3, transBeats: 1.5, stutter: 0.2, letterbox: true,
    feel: { smooth: 3, punch: 1.5, musical: 1, hard: 0.5 }, fx: 0.45, remix: 0.8, duet: 0.06, motif: 0.6, uniq: 0.85,
    lenses: { 7: 5, 6: 1 }, time: { clock: 4, flow: 2 }, film: true,
    blends: [0, 2], effects: 0.55, effectTags: ['vhs', 'crt', 'film', 'grain', 'light', 'rays', 'bloom', 'vignette', 'tv', 'scan'],
  },
  mirror: {
    name: 'Mirror World', blurb: 'Kaleidoscopes and symmetry, folding every shader into a mandala.',
    bars: { low: [4, 8], mid: [4, 8], high: [2, 4] }, cutP: 0.25, transBeats: 1.5, stutter: 0.3, mirror: true,
    feel: { smooth: 2.5, musical: 2, punch: 1.5, hard: 1 }, fx: 0.55, remix: 1.6, duet: 0.15, motif: 0.5, uniq: 0.8,
    lenses: { 3: 5, 2: 3, 1: 2, 9: 2, 4: 2, 5: 1 }, time: { clock: 3, flow: 3, reverse: 0.5 },
    blends: [0, 4, 5], effects: 0.8, effectTags: ['kaleid', 'mirror', 'symmetr', 'hex', 'spiral', 'twist', 'vortex'],
  },
};
const STYLE_KEYS = Object.keys(STYLES);

function songCharacter(A) {
  const D = Math.max(1, A.duration);
  const hits = (A.onsets.kick.length + A.onsets.snare.length) / D;
  let m = 0, v = 0;
  for (let i = 0; i < A.n; i += 10) m += A.level[i];
  m /= Math.ceil(A.n / 10);
  for (let i = 0; i < A.n; i += 10) v += (A.level[i] - m) ** 2;
  v = Math.sqrt(v / Math.ceil(A.n / 10));
  return { hits, dyn: v, bpm: A.bpm, sections: A.sections.length };
}

function chooseStyle(A, rnd, avoid) {
  const c = songCharacter(A);
  const fast = clamp01((c.bpm - 95) / 45), busy = clamp01(c.hits / 4), dyn = clamp01(c.dyn / 0.25);
  const w = {
    pulse: 1 + 2 * fast + 1.5 * busy,
    drift: 1 + 2 * (1 - fast) + 1.5 * (1 - busy),
    story: 1 + 1.5 * clamp01(c.sections / 6) + dyn,
    chaos: 0.6 + 1.5 * fast * busy,
    cinema: 1 + dyn + (1 - busy),
    mirror: 1.2,
  };
  if (avoid && w[avoid]) w[avoid] *= 0.15;   // last roll's style is unlikely to come straight back
  return wpick(rnd, w);
}

// ------------------------------------------------------------ the beat grid
function makeGrid(A) {
  const D = A.duration;
  let beats = A.beats.filter(t => t >= 0 && t < D);
  if (beats.length < 4) { beats = []; for (let t = 0; t < D; t += 0.5) beats.push(t); }
  const P = (beats[beats.length - 1] - beats[0]) / Math.max(1, beats.length - 1) || 0.5;
  // extend back to 0 and forward past the end so every beat index has a time
  while (beats[0] > P * 0.6) beats.unshift(beats[0] - P);
  if (beats[0] > 0) beats[0] = 0;
  const at = (i) => i <= 0 ? 0 : i < beats.length ? beats[i] : Math.min(D, beats[beats.length - 1] + (i - beats.length + 1) * P);
  const near = (t) => {
    let lo = 0, hi = beats.length - 1;
    if (t >= beats[hi]) return hi + Math.round((t - beats[hi]) / P);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; }
    return (t - beats[lo] < beats[hi] - t) ? lo : hi;
  };
  // phase of the downbeat inside the (possibly extended) beat list
  let phase = 0;
  if (A.downbeats.length) phase = ((near(A.downbeats[0]) % 4) + 4) % 4;
  const last = near(D);
  return { beats, P, at, near, phase, last };
}

function meanOver(arr, fps, t0, t1) {
  const i0 = Math.max(0, Math.floor(t0 * fps)), i1 = Math.min(arr.length, Math.max(i0 + 1, Math.floor(t1 * fps)));
  let s = 0; for (let i = i0; i < i1; i++) s += arr[i];
  return s / Math.max(1, i1 - i0);
}
const energyOver = (A, t0, t1) => 0.7 * meanOver(A.level, A.fps, t0, t1) + 0.3 * meanOver(A.bands.bass, A.fps, t0, t1);

// ------------------------------------------------------------ sections
function buildSections(A, G) {
  const D = A.duration;
  let cuts = A.sections.map(s => s.t).filter(t => t > 3 && t < D - 3);
  if (!cuts.length && D > 45) for (let b = G.phase + 64; G.at(b) < D - 12; b += 64) cuts.push(G.at(b));
  const bounds = [0, ...cuts, D];
  let secs = [];
  for (let i = 0; i < bounds.length - 1; i++) secs.push({ start: bounds[i], end: bounds[i + 1] });
  // fold sections shorter than ~4 bars into their neighbour
  const minLen = Math.max(5, G.P * 14);
  for (let i = secs.length - 1; i > 0; i--) if (secs[i].end - secs[i].start < minLen || secs[i - 1].end - secs[i - 1].start < minLen) {
    if (secs.length <= 1) break;
    secs[i - 1].end = secs[i].end; secs.splice(i, 1);
  }
  for (const s of secs) {
    s.b0 = G.near(s.start); s.b1 = G.near(s.end);
    if (s === secs[0]) s.b0 = 0;
    s.e = energyOver(A, s.start, s.end);
    // a rough timbre fingerprint for "is this the chorus again?"
    const f = [];
    for (let g = 0; g < 16; g++) {
      let v = 0, n = 0;
      for (let i = Math.floor(s.start * A.fps); i < Math.min(A.n, Math.floor(s.end * A.fps)); i += 4) { for (let q = 0; q < 4; q++) v += A.spec[i * 64 + g * 4 + q]; n += 4; }
      f.push(v / Math.max(1, n));
    }
    for (const k of ['bass', 'lowmid', 'mid', 'high', 'treble']) f.push(meanOver(A.bands[k], A.fps, s.start, s.end));
    s.f = f;
  }
  // rank energies, label kinds
  const es = secs.map(s => s.e).slice().sort((a, b) => a - b);
  for (const s of secs) s.er = secs.length > 1 ? es.indexOf(s.e) / (secs.length - 1) : 0.6;
  secs.forEach((s, i) => {
    const prev = secs[i - 1], next = secs[i + 1];
    const jump = prev ? s.er - prev.er : 0;
    if (i === 0 && s.er < 0.5 && secs.length > 2) s.kind = 'intro';
    else if (i === secs.length - 1 && s.er < 0.5 && secs.length > 2) s.kind = 'outro';
    else if (prev && jump >= 0.3 && s.er >= 0.6) s.kind = 'drop';
    else if (prev && jump <= -0.3) s.kind = 'break';
    else if (s.er >= 0.67) s.kind = 'peak';
    else if (next && next.er - s.er >= 0.3) s.kind = 'build';
    else s.kind = 'verse';
  });
  // similarity labels (z-scored fingerprints, cosine)
  const dims = secs[0] ? secs[0].f.length : 0;
  if (secs.length >= 3) {
    for (let d = 0; d < dims; d++) {
      let m = 0, v = 0; for (const s of secs) m += s.f[d]; m /= secs.length;
      for (const s of secs) v += (s.f[d] - m) ** 2; v = Math.sqrt(v / secs.length) || 1;
      for (const s of secs) s.f[d] = (s.f[d] - m) / v;
    }
  }
  const cos = (a, b) => { let x = 0, na = 0, nb = 0; for (let d = 0; d < dims; d++) { x += a[d] * b[d]; na += a[d] * a[d]; nb += b[d] * b[d]; } return x / (Math.sqrt(na * nb) || 1); };
  const reps = [];
  for (const s of secs) {
    let best = -1, bi = -1;
    reps.forEach((r, k) => { const c = cos(s.f, r.f); if (c > best) { best = c; bi = k; } });
    if (bi >= 0 && best > 0.82 && secs.length >= 3) s.label = bi;
    else { s.label = reps.length; reps.push(s); }
  }
  return secs;
}

// ------------------------------------------------------------ shots
const LEN_SET = [0.5, 1, 2, 3, 4, 6, 8, 12, 16];
function shotBars(style, er, pace, rnd) {
  const band = er < 0.36 ? 'low' : er < 0.67 ? 'mid' : 'high';
  const [lo, hi] = style.bars[band];
  const k = Math.pow(2, (0.5 - pace) * 2.2);                // pace 0 = twice as long, 1 = half
  const want = lerp(lo, hi, rnd()) * k;
  let best = LEN_SET[0];
  for (const L of LEN_SET) if (Math.abs(Math.log(L / want)) < Math.abs(Math.log(best / want))) best = L;
  return best;
}

function buildShots(A, G, secs, style, cfg, rnd, remixK) {
  const shots = [];
  secs.forEach((s, si) => {
    let b = s.b0;
    const end = s.b1;
    // Story: a section is one shot up to 8 bars, otherwise two or more even halves
    const per = style.perSection;
    const parts = per ? Math.max(1, Math.round((end - b) / 32)) : 0;
    let first = true;
    while (b < end) {
      let Lb = per ? Math.max(4, Math.round((s.b1 - s.b0) / parts / 4) * 4) : Math.max(2, Math.round(shotBars(style, s.er, cfg.pace, rnd) * 4));
      let nb = b + Lb;
      if (nb > end - 2) nb = end;                             // don't leave a sliver at the end of a section
      const st = G.at(b), en = si === secs.length - 1 && nb >= end ? A.duration : G.at(nb);
      if (en - st > 0.25) shots.push({ start: st, end: en, b0: b, b1: nb, sec: si, first });
      else if (shots.length) { shots[shots.length - 1].end = en; shots[shots.length - 1].b1 = nb; }
      first = false;
      b = nb;
    }
  });
  if (shots.length) { shots[0].start = 0; shots[shots.length - 1].end = A.duration; }
  // stutters: chop the last bar before a lift into beat-long flickers
  let gid = 0;
  for (let i = shots.length - 2; i >= 0; i--) {
    const s = shots[i], n = shots[i + 1];
    if (n.sec === s.sec) continue;
    const lift = secs[n.sec].er - secs[s.sec].er;
    if (lift < 0.15 && secs[n.sec].kind !== 'drop') continue;
    if (s.b1 - s.b0 < 8 || rnd() > style.stutter * Math.min(1.5, remixK + 0.3)) continue;
    const step = (style === STYLES.chaos && G.P > 0.5) ? 0.5 : 1;
    const parts = [];
    for (let k = s.b1 - 4; k < s.b1 - 1e-6; k += step) parts.push(k);
    const tailStart = G.at(s.b1 - 4);
    if (tailStart - s.start < 1) continue;
    const subs = parts.map((k, j) => ({ start: G.at(k), end: j === parts.length - 1 ? s.end : G.at(k + step), b0: k, b1: k + step, sec: s.sec, stutter: gid, sj: j }));
    s.end = tailStart; s.b1 = s.b1 - 4;
    shots.splice(i + 1, 0, ...subs);
    gid++;
  }
  shots.forEach((s, i) => { s.i = i; s.e = energyOver(A, s.start, s.end); });
  const normal = shots.filter(s => s.stutter == null);
  const es = normal.map(s => s.e).sort((a, b) => a - b);
  for (const s of shots) {
    const r = es.length > 1 ? es.findIndex(v => v >= s.e) / (es.length - 1) : 0.5;
    s.er = 0.55 * r + 0.45 * secs[s.sec].er;
  }
  return shots;
}

// ------------------------------------------------------------ casting
// Weighted draw without replacement. Stars matter, recently used shaders are pushed to the back.
function chooseCast(pool, K, rnd, recent, pinned) {
  const cand = pool.filter(e => !pinned.includes(e.id));
  const w = new Map(cand.map(e => {
    const stars = Math.max(1, e.stars || 3);
    const rec = recent ? (recent[e.id] || 0) : 0;
    const pr = e.probe || e.known;                            // dim, still shaders get cast less often
    const lively = pr ? Math.max(0.3, Math.min(1.2, 0.3 + pr.I * 1.4)) : 1;
    return [e.id, Math.pow(stars, 1.2) / (1 + 2.5 * rec) * lively * (0.6 + rnd() * 0.8)];
  }));
  const out = pool.filter(e => pinned.includes(e.id));
  while (out.length < K && cand.length) {
    let tot = 0; for (const e of cand) tot += w.get(e.id);
    let r = rnd() * tot, k = 0;
    for (; k < cand.length - 1; k++) { r -= w.get(cand[k].id); if (r <= 0) break; }
    out.push(cand.splice(k, 1)[0]);
  }
  return out;
}

// How many different shaders this song gets, before we know which ones.
function castSize(shots, secs, style, poolSize, D) {
  const n = shots.filter(s => s.stutter == null).length;
  const labels = new Set(secs.map(s => s.label)).size;
  let K = Math.round(n * style.uniq);
  if (style.perSection) K = Math.max(labels + 2, Math.round(n * 0.7));
  K = Math.max(K, Math.min(n, Math.round(D / 14)));          // at least one new shader every ~14 s
  return Math.max(Math.min(3, poolSize), Math.min(poolSize, 48, K));
}

// ------------------------------------------------------------ assignment
function hueDist(a, b) { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); }

function assignScenes(shots, secs, cast, style, rnd) {
  // intensity rank among the cast, from the probes (brightness, motion, colour)
  const ids = cast.map(e => e.id);
  const P = Object.fromEntries(cast.map(e => [e.id, e.probe || { I: 0.5, H: rnd(), Y: 0.4 }]));
  const sortedI = ids.map(id => P[id].I).sort((a, b) => a - b);
  const rank = Object.fromEntries(ids.map(id => [id, ids.length > 1 ? sortedI.indexOf(P[id].I) / (ids.length - 1) : 0.5]));
  const usage = Object.fromEntries(ids.map(id => [id, 0]));
  const motif = {};
  const hist = [];
  for (const s of shots) {
    if (s.stutter != null) continue;
    const prev = hist[hist.length - 1];
    const lab = secs[s.sec].label;
    let choice = null;
    const kind = secs[s.sec].kind;
    const motifP = (kind === 'peak' || kind === 'drop') ? style.motif : kind === 'outro' ? style.motif * 0.7 : kind === 'verse' ? style.motif * 0.35 : 0;
    if (s.first && motif[lab] && motif[lab] !== prev && rnd() < motifP) choice = motif[lab];
    if (!choice) {
      let best = -1e9;
      for (const id of ids) {
        if (id === prev && ids.length > 1) continue;
        let v = -Math.abs(s.er - rank[id]) * 1.3;
        if (prev) v += hueDist(P[prev].H, P[id].H) * 0.7;
        v -= usage[id] * 0.9;
        if (hist.slice(-3).includes(id)) v -= 1.2;
        v += rnd() * 0.8;
        if (v > best) { best = v; choice = id; }
      }
    }
    if (s.first && motif[lab] == null && kind !== 'break') motif[lab] = choice;
    s.scene = choice; usage[choice]++; hist.push(choice);
  }
  // stutters flicker between the shot they came from and the one they lead into
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (s.stutter == null) continue;
    let k = i; while (k > 0 && shots[k].stutter != null) k--;
    let j = i; while (j < shots.length - 1 && shots[j].stutter != null) j++;
    const cur = shots[k].scene, nxt = shots[j].stutter == null ? shots[j].scene : pickR(rnd, ids.filter(x => x !== cur));
    const nParts = shots.filter(x => x.stutter === s.stutter).length;
    s.scene = ((nParts - 1 - s.sj) % 2 === 1) ? nxt : cur;   // the last flicker is always the old shot
    if (s.scene == null) s.scene = cur || ids[0];
  }
  return { rank, usage };
}

// ------------------------------------------------------------ looks, duets, time
const LENS_PARAMS = {
  1: () => [0, 0, 0, 0], 2: () => [0, 0, 0, 0], 9: () => [0, 0, 0, 0],
  3: (r) => [pickR(r, [4, 5, 6, 8, 10, 12]), (r() < 0.5 ? -1 : 1) * lerp(0.04, 0.2, r()), 0, 0],
  4: (r) => [pickR(r, [2, 2, 3]), 0, 0, 0],
  5: (r) => [pickR(r, [1, 2, 3]), lerp(0.04, 0.18, r()) * (r() < 0.3 ? -1 : 1), 0, 0],
  6: (r) => [lerp(0.15, 0.45, r()), 0, 0, 0],
  7: (r) => [lerp(0.04, 0.22, r()), (r() < 0.5 ? -1 : 1) * lerp(0.015, 0.07, r()), 0, 0],
  8: (r) => [lerp(36, 90, r()), 0, 0, 0],
  10: (r) => [lerp(16, 40, r()), 0, 0, 0],
};
const FILM_TINTS = [[1.0, 0.78, 0.55], [0.55, 0.85, 1.0], [0.95, 0.6, 0.85], [0.7, 1.0, 0.8], [1.0, 0.9, 0.7]];

function makeLook(s, style, remixK, rnd) {
  const look = { lens: 0, lensP: [0, 0, 0, 0], grade: [0, 1, 1, 1], tint: [0, 0, 0, 0], poster: 0 };
  if (remixK <= 0) return look;
  const lensP = (style.mirror ? 0.75 : 0.32) * Math.min(1.2, remixK);
  if (rnd() < lensP) {
    look.lens = +wpick(rnd, style.lenses);
    look.lensP = LENS_PARAMS[look.lens] ? LENS_PARAMS[look.lens](rnd) : [0, 0, 0, 0];
  }
  if (rnd() < 0.28 * remixK) look.grade[0] = (rnd() - 0.5) * (style === STYLES.chaos ? 1 : 0.5);
  if (rnd() < 0.3 * remixK) look.grade[1] = lerp(0.65, 1.45, rnd());
  if (rnd() < 0.25 * remixK) look.grade[2] = lerp(0.95, 1.25, rnd());
  if (style.film) { look.grade[1] *= 0.85; look.grade[2] = Math.max(look.grade[2], 1.08); if (rnd() < 0.45 * remixK) look.tint = [...pickR(rnd, FILM_TINTS), lerp(0.25, 0.55, rnd())]; }
  else if (rnd() < 0.07 * remixK) look.tint = [0.5 + 0.5 * rnd(), 0.5 + 0.5 * rnd(), 0.5 + 0.5 * rnd(), lerp(0.4, 0.8, rnd())];
  if (style === STYLES.chaos && rnd() < 0.08 * remixK) look.poster = pickR(rnd, [4, 5, 6]);
  return look;
}

function makeTime(s, style, G, rnd) {
  const mode = s.stutter != null ? 'clock' : wpick(rnd, style.time);
  const fast = 0.75 + 0.6 * s.er;
  return {
    mode,
    off: lerp(3, 55, rnd()),
    rate: mode === 'flow' ? lerp(0.8, 1.3, rnd()) : mode === 'reverse' ? lerp(0.6, 1.0, rnd()) : lerp(0.75, 1.2, rnd()) * fast,
    step: G.P / 2,
  };
}

function shotTime(A, s, t) {
  const tm = s.time, dt = t - s.start;
  switch (tm.mode) {
    case 'flow': return tm.off + (flowAt(A, t) - flowAt(A, s.start)) * tm.rate;
    case 'reverse': return tm.off + 30 - dt * tm.rate;
    case 'stepped': return tm.off + Math.floor(dt / tm.step) * tm.step * tm.rate;
    default: return tm.off + dt * tm.rate;
  }
}
function flowAt(A, t) {
  const x = Math.max(0, Math.min(A.n - 1, t * A.fps)), i = Math.floor(x), j = Math.min(A.n - 1, i + 1);
  return A.flow[i] + (A.flow[j] - A.flow[i]) * (x - i);
}

// ------------------------------------------------------------ transitions
function transitionPool(entries, cfg) {
  return entries.filter(e => e.kind === 'transition' && (e.source === 'builtin' || cfg.libTransitions)).map(e => {
    const feel = e.feel || LIB_TRANSITION_FEEL[e.id] || 'smooth';
    const beats = e.beats || (feel === 'smooth' ? [1, 4] : [0.5, 2]);
    return { id: e.id, feel, beats, lib: e.source !== 'builtin' };
  });
}

function planTransitions(A, G, shots, secs, style, trPool, rnd, remixK) {
  const trans = [];
  const recentT = [];
  const byFeel = {};
  for (const t of trPool) (byFeel[t.feel] = byFeel[t.feel] || []).push(t);
  const choose = (feelW) => {
    const w = {}; for (const k in feelW) if (byFeel[k] && byFeel[k].length) w[k] = feelW[k];
    if (!Object.keys(w).length) return null;
    const feel = wpick(rnd, w);
    let cands = byFeel[feel].filter(t => !recentT.includes(t.id));
    if (!cands.length) cands = byFeel[feel];
    // library transitions get a little extra weight: they're the hand-made ones
    const t = cands.length > 1 && rnd() < 0.55 && cands.some(c => c.lib) ? pickR(rnd, cands.filter(c => c.lib)) : pickR(rnd, cands);
    recentT.push(t.id); if (recentT.length > 5) recentT.shift();
    return t;
  };
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
  let lastT1 = 0;
  for (let i = 0; i < shots.length - 1; i++) {
    const a = shots[i], b = shots[i + 1], c = b.start;
    const secChange = a.sec !== b.sec;
    const kind = secs[b.sec].kind;
    const ev = { t: c, from: i, to: i + 1, cut: true, id: null, secChange, kind: secChange ? kind : null };
    if (a.stutter != null || b.stutter != null) { ev.stutter = true; trans.push(ev); continue; }
    let tr = null, beats = 0, align = 0.5;
    if (secChange && kind === 'drop') {
      ev.impact = true;                                         // hard cut on the downbeat, hits handled in fx
    } else if (secChange && (kind === 'break' || kind === 'outro')) {
      tr = choose({ smooth: 4, musical: 1 }); beats = tr ? lerp(tr.beats[0], tr.beats[1], 0.5 + 0.5 * rnd()) * 1.3 : 0; align = 0.25;
    } else if (secChange) {
      tr = choose(Object.assign({}, style.feel, { punch: (style.feel.punch || 1) * 1.6, musical: (style.feel.musical || 1) * 1.4 }));
      beats = tr ? lerp(tr.beats[0], tr.beats[1], rnd()) : 0;
    } else if (rnd() >= style.cutP) {
      tr = choose(style.feel);
      beats = tr ? lerp(tr.beats[0], tr.beats[1], rnd()) * style.transBeats : 0;
    } else {
      ev.plainCut = true;
    }
    if (tr) {
      let dur = Math.max(0.12, beats * G.P);
      dur = Math.min(dur, 0.45 * (a.end - a.start) / Math.max(0.01, align * 2), 0.9 * (b.end - b.start) / Math.max(0.01, (1 - align) * 2), 6);
      let t0 = c - dur * align, t1 = c + dur * (1 - align);
      if (t0 < lastT1 + 0.02) { t0 = lastT1 + 0.02; }
      if (t1 - t0 > 0.1) {
        Object.assign(ev, { cut: false, id: tr.id, feel: tr.feel, t0, t1, seed: rnd(), dir: pickR(rnd, dirs) });
        lastT1 = t1;
      } else ev.plainCut = true;
    }
    trans.push(ev);
  }
  return trans;
}

// ------------------------------------------------------------ fx events
function planFx(A, G, shots, secs, trans, style, rnd, remixK, cfg) {
  const fx = [];
  const K = style.fx * Math.min(1.4, 0.4 + remixK);
  const nearTrans = (t) => trans.some(tr => !tr.cut && t > tr.t0 - 0.1 && t < tr.t1 + 0.1);
  const last = {};
  const can = (type, t, gap) => !(last[type] != null && t - last[type] < gap);
  const add = (e) => { fx.push(e); last[e.type] = e.t; };
  const secAt = (t) => { let k = 0; for (let i = 0; i < secs.length; i++) if (secs[i].start <= t) k = i; return secs[k]; };
  const hue = () => { const h = rnd(); return [0.5 + 0.5 * Math.cos(6.283 * h), 0.5 + 0.5 * Math.cos(6.283 * (h + 0.33)), 0.5 + 0.5 * Math.cos(6.283 * (h + 0.67))]; };

  for (const tr of trans) {
    if (tr.impact) {
      add({ type: 'flash', t: tr.t, dur: G.P * 1.2, amp: 0.9, col: [1, 1, 1] });
      add({ type: 'shock', t: tr.t, dur: G.P * 2, amp: 1, x: 0.5 + (rnd() - 0.5) * 0.3, y: 0.5 + (rnd() - 0.5) * 0.2 });
      add({ type: 'zoom', t: tr.t, dur: G.P * 1.5, amp: 1.4 });
      add({ type: 'rgb', t: tr.t, dur: G.P, amp: 1 });
      // riser into the drop: the last bar pushes in and brightens
      add({ type: 'riser', t: Math.max(0, tr.t - G.P * 4), dur: G.P * 4, amp: 0.8 + 0.4 * rnd() });
    } else if (tr.stutter) {
      add({ type: 'flash', t: tr.t, dur: G.P * 0.5, amp: 0.35, col: hue() });
    } else if (tr.plainCut && rnd() < 0.5 * K) {
      add({ type: pickR(rnd, ['zoom', 'flash', 'rgb']), t: tr.t, dur: G.P * 0.6, amp: 0.6, col: [1, 1, 1] });
    }
  }
  for (const o of A.onsets.snare) {
    const s = secAt(o.t);
    if (o.s < 0.55 || s.er < 0.4 || nearTrans(o.t) || rnd() > K * 0.3) continue;
    const type = wpick(rnd, { flash: 2, rgb: 2, shake: 1.2, hold: style === STYLES.chaos || style === STYLES.pulse ? 1 : 0.2, invert: style === STYLES.chaos ? 0.6 : 0.05 });
    const gap = { flash: 2, rgb: 2, shake: 3, hold: 6, invert: 12 }[type] * G.P;
    if (!can(type, o.t, gap)) continue;
    add({ type, t: o.t, dur: { flash: 0.5, rgb: 0.6, shake: 0.7, hold: 0.25, invert: 0.25 }[type] * G.P, amp: 0.5 + 0.5 * o.s, col: rnd() < 0.6 ? [1, 1, 1] : hue() });
  }
  for (const o of A.onsets.kick) {
    const s = secAt(o.t);
    if (o.s < 0.75 || s.er < 0.55 || nearTrans(o.t) || rnd() > K * 0.12 || !can('shock', o.t, G.P * 8)) continue;
    add({ type: 'shock', t: o.t, dur: G.P * 1.5, amp: 0.6, x: 0.5, y: 0.5 });
  }
  for (const s of secs) {
    if (s.kind === 'break' && rnd() < 0.6 * K + 0.2) add({ type: 'echo', t: s.start, dur: s.end - s.start, amp: lerp(0.55, 0.85, rnd()) });
    if (style === STYLES.chaos && s.kind === 'peak' && rnd() < 0.5) add({ type: 'scan', t: s.start, dur: s.end - s.start, amp: 0.6 });
  }
  fx.sort((a, b) => a.t - b.t);
  return fx;
}

// ------------------------------------------------------------ SuperTool effects
// Post-process looks from SuperTool, laid over a whole shot or a whole big section.
function planEffects(A, G, shots, secs, style, remixK, rnd, pool) {
  if (!pool.length || remixK <= 0.02) return { windows: [], ids: [] };
  const p = Math.min(0.65, 0.22 * remixK * (style.effects || 1));
  const tags = style.effectTags || [];
  const w = {};
  for (const e of pool) {
    const hit = tags.length && e.tags.some(tg => tags.some(k => tg.toLowerCase().includes(k) || e.name.toLowerCase().includes(k)));
    w[e.id] = (e.w || 1) * (hit ? 3 : 1) * (0.5 + rnd());
  }
  const want = Math.max(1, Math.min(8, Math.round(shots.length * p * 0.5)));
  const pickList = [];
  const W = Object.assign({}, w);
  while (pickList.length < want && Object.keys(W).length) { const id = wpick(rnd, W); pickList.push(id); delete W[id]; }
  const windows = [];
  const covered = new Set();
  const cap = (id) => { const e = pool.find(x => x.id === id); return e && e.maxAmt ? e.maxAmt : 1; };
  secs.forEach((sc, si) => {
    if (!['peak', 'drop', 'break'].includes(sc.kind) || rnd() > p * 0.6) return;
    const id = pickR(rnd, pickList);
    windows.push({ id, t: sc.start, end: sc.end, amt: lerp(0.5, 0.95, rnd()) * cap(id) });
    covered.add(si);
  });
  for (const s of shots) {
    if (covered.has(s.sec) || s.stutter != null || s.end - s.start < 1.5 || rnd() > p) continue;
    const id = pickR(rnd, pickList);
    windows.push({ id, t: s.start, end: s.end, amt: lerp(0.55, 1, rnd()) * cap(id) });
  }
  windows.sort((a, b) => a.t - b.t);
  for (let i = 1; i < windows.length; i++) if (windows[i].t < windows[i - 1].end) windows[i].t = windows[i - 1].end;
  for (const wd of windows) { wd.dur = wd.end - wd.t; wd.fade = Math.min(G.P, wd.dur * 0.2); }
  const used = [...new Set(windows.filter(x => x.dur > 0.2).map(x => x.id))];
  return { windows: windows.filter(x => x.dur > 0.2), ids: used };
}

// ------------------------------------------------------------ the whole plan
// Pass 1: structure, which tells us how many shaders to cast.
function planStructure(A, cfg, ctx) {
  const seed = cfg.seed >>> 0;
  const rnd = mulberry32(seed * 7919 + 17);
  const styleKey = cfg.style && STYLES[cfg.style] ? cfg.style : chooseStyle(A, rnd, ctx.lastStyle);
  const style = STYLES[styleKey];
  const remixK = cfg.remix * style.remix;
  const G = makeGrid(A);
  const secs = buildSections(A, G);
  const shots = buildShots(A, G, secs, style, cfg, rnd, remixK);
  const K = castSize(shots, secs, style, ctx.poolSize, A.duration);
  const effects = cfg.effects ? planEffects(A, G, shots, secs, style, remixK, rnd, ctx.effectPool || []) : { windows: [], ids: [] };
  return { seed, rnd, styleKey, style, remixK, G, secs, shots, K, effects };
}

// Pass 2: given the compiled, probed cast, finish the plan.
function planFinish(A, S, cast, entries, cfg) {
  const { rnd, style, remixK, G, secs, shots } = S;
  assignScenes(shots, secs, cast, style, rnd);
  const castIds = cast.map(e => e.id);
  const P = Object.fromEntries(cast.map(e => [e.id, e.probe || { H: 0.5 }]));
  for (const s of shots) {
    s.look = makeLook(s, style, remixK, rnd);
    s.time = makeTime(s, style, G, rnd);
    s.id = `s${s.i}`;
    if (cfg.duets && s.stutter == null && s.end - s.start > 2 && castIds.length > 2 && rnd() < style.duet * Math.min(1.3, remixK) * (0.5 + s.er)) {
      let best = null, bv = -1;
      for (const id of castIds) { if (id === s.scene) continue; const v = hueDist(P[s.scene].H, P[id].H) + rnd() * 0.4; if (v > bv) { bv = v; best = id; } }
      if (best) s.partner = { scene: best, blend: pickR(rnd, style.blends), amt: lerp(0.6, 1, rnd()), time: makeTime(s, style, G, rnd) };
    }
  }
  const trPool = transitionPool(entries, cfg);
  const trans = planTransitions(A, G, shots, secs, style, trPool, rnd, remixK);
  const fx = planFx(A, G, shots, secs, trans, style, rnd, remixK, cfg);
  // credits: first appearance of each shader
  const seen = new Set(), credits = [];
  for (const s of shots) {
    for (const id of [s.scene, s.partner && s.partner.scene]) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (s.stutter == null && s.end - s.start > 2.2) credits.push({ id, t: s.start + 0.35, dur: Math.min(3.2, s.end - s.start - 0.5) });
    }
  }
  const used = [...seen];
  return {
    seed: S.seed, code: seedCode(S.seed), styleKey: S.styleKey, style, G, secs, shots, trans, fx, credits, used,
    letterbox: !!style.letterbox, beatP: G.P, effects: S.effects,
  };
}

// ------------------------------------------------------------ per-frame state
function shotIndexAt(plan, t) {
  const s = plan.shots;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m].start <= t) lo = m; else hi = m - 1; }
  return lo;
}
function activeTransition(plan, t) {
  const T = plan.trans;
  let lo = 0, hi = T.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; const t0 = T[m].cut ? T[m].t : T[m].t0; if (t0 <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  for (let j = Math.max(0, k - 1); j <= Math.min(T.length - 1, k + 1); j++) {
    const tr = T[j];
    if (!tr.cut && t >= tr.t0 && t <= tr.t1) return tr;
  }
  return null;
}

const envPunch = (u) => u < 0.08 ? u / 0.08 : Math.pow(Math.max(0, 1 - (u - 0.08) / 0.92), 1.6);
const envPlateau = (u) => Math.min(1, u / 0.06) * Math.min(1, (1 - u) / 0.12);

function directFrame(A, plan, t, opts) {
  const au = sampleAnalysis(A, t);
  const layer = (s) => ({
    key: s.id, scene: s.scene, time: shotTime(A, s, t), look: s.look,
    partner: s.partner ? { key: s.id + 'p', scene: s.partner.scene, time: shotTime(A, { start: s.start, time: s.partner.time }, t), blend: s.partner.blend, amt: s.partner.amt } : null,
  });
  const tr = activeTransition(plan, t);
  let a, b = null, trans = null;
  if (tr) {
    a = plan.shots[tr.from]; b = plan.shots[tr.to];
    let p = (t - tr.t0) / (tr.t1 - tr.t0);
    if (tr.feel === 'smooth') p = smooth01(p);
    trans = { id: tr.id, progress: clamp01(p), seed: tr.seed, dir: tr.dir };
  } else a = plan.shots[shotIndexAt(plan, t)];

  const style = plan.style, k = opts.fxAmount;
  const fx = { zoom: 0, rgb: 0, echo: 0, hold: 0, invert: 0, shake: 0, scan: 0, flash: [0, 0, 0, 0], shock: [0, 0.5, 0.5, 0], bars: 0, overlay: null };
  // always-on pulse: the picture leans into the kick a little
  fx.zoom += au.kick * au.kick * 0.35 * style.fx * k;
  fx.rgb += au.kick * 0.0012 * style.fx * k;
  for (const e of plan.fx) {
    if (e.t > t) break;
    if (t > e.t + e.dur) continue;
    const u = (t - e.t) / e.dur;
    switch (e.type) {
      case 'flash': { const v = e.amp * envPunch(u) * k; fx.flash = [e.col[0], e.col[1], e.col[2], Math.max(fx.flash[3], v)]; break; }
      case 'zoom': fx.zoom += e.amp * envPunch(u) * k; break;
      case 'rgb': fx.rgb += 0.012 * e.amp * envPunch(u) * k; break;
      case 'shake': fx.shake = Math.max(fx.shake, e.amp * envPunch(u) * k); break;
      case 'hold': if (k > 0.05) fx.hold = 1; break;
      case 'invert': fx.invert = Math.max(fx.invert, envPlateau(u) * Math.min(1, k)); break;
      case 'shock': fx.shock = [e.amp * (1 - u) * Math.min(1, k), e.x, e.y, u * 1.1]; break;
      case 'riser': fx.zoom += e.amp * Math.pow(u, 2.2) * 1.3 * k; fx.flash = [1, 1, 1, Math.max(fx.flash[3], Math.pow(u, 4) * 0.35 * k)]; break;
      case 'echo': fx.echo = Math.max(fx.echo, e.amp * envPlateau(u) * Math.min(1, k + 0.3)); break;
      case 'scan': fx.scan = Math.max(fx.scan, e.amp * envPlateau(u)); break;
    }
  }
  fx.effect = null;
  for (const w of plan.effects.windows) {
    if (w.t > t) break;
    if (t >= w.t + w.dur) continue;
    const env = Math.min(1, (t - w.t) / Math.max(0.01, w.fade), (w.t + w.dur - t) / Math.max(0.01, w.fade));
    fx.effect = { id: w.id, amt: w.amt * clamp01(env) * Math.min(1, opts.fxAmount + 0.25) };
  }
  if (plan.letterbox && opts.aspect > 1.2) fx.bars = Math.max(0, 0.5 - opts.aspect / 2.39 / 2);
  if (opts.credits) {
    for (const c of plan.credits) {
      if (t < c.t || t > c.t + c.dur) continue;
      const u = (t - c.t) / c.dur;
      fx.overlay = { id: c.id, alpha: Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.18) };
    }
  }
  return { t, au, a: layer(a), b: b ? layer(b) : null, trans, fx, shotIndex: b && trans.progress > 0.5 ? b.i : a.i };
}
