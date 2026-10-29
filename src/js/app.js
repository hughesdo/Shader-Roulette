// ============================================================ app
const $ = (s) => document.querySelector(s);
const fmt = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
const even = (x) => Math.max(2, Math.round(x / 2) * 2);
const RES = {
  '1280x720': [1280, 720], '1920x1080': [1920, 1080], '2560x1440': [2560, 1440], '3840x2160': [3840, 2160],
  '1080x1920': [1080, 1920], '1080x1080': [1080, 1080], '1080x1350': [1080, 1350],
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('roulette.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('roulette.' + k, JSON.stringify(v)); } catch (e) {} },
};
const KIND_LABEL = { intro: 'Intro', verse: 'Verse', build: 'Build', drop: 'Drop', peak: 'Peak', break: 'Break', outro: 'Outro' };
const LENS_LABEL = { 1: 'mirror', 2: 'four-way mirror', 3: 'kaleidoscope', 4: 'mirrored tiles', 5: 'polar tunnel', 6: 'bulge', 7: 'drift', 8: 'mosaic', 9: 'mirror', 10: 'ripple' };
const BLEND_LABEL = ['screen', 'difference', 'shadow fill', 'split', 'portal', 'lighten', 'overlay'];

// SuperTool effects, curated from a headless test that laid each one over a library shader:
//  scenes: ignore the frame underneath entirely, so they join the shader pool instead
//  skip:   replace or white out the picture rather than treat it
//  strong: heavy looks, drawn less often and mixed in at most ~65%
//  quiet:  beat-gated ones that barely show unless the track really hits
const ST_EFFECT_SCENES = new Set(['st-echappatoire', 'st-echappatoire-with-heart', 'st-ray-balls-5']);
const ST_EFFECT_SKIP = new Set(['st-rays', 'st-electric-dream', 'st-pulsing-waves', 'st-vibe-drummer', 'st-anastasia', 'st-edge-detection-dfdx-dfdy',
  'st-edge-glow', 'st-edge-neon', 'st-ray-balls', 'st-ray-balls-2', 'st-ray-balls-3', 'st-ray-balls-4']);
const ST_EFFECT_STRONG = new Set(['st-after-effects-tiktok-edit', 'st-tiktok-edit', 'st-color-cycle-2', 'st-plasma-overlay', 'st-spiral-pattern',
  'st-raymarch-3d', 'st-raymarch-3d-1', 'st-wave-interference', 'st-mosaic', 'st-dancing-cube-field-visualiser', 'st-crt-tv', 'st-trippy',
  'st-everyday-skeletons', 'st-hexagon-grid', 'st-twist-cube', 'st-matrix-rain', 'st-video-filters', 'st-bit-blurry-effect-2',
  'st-bit-blurry-effect-3', 'st-pixelate', 'st-candy-flipping', 'st-webby', 'st-twist']);
const ST_EFFECT_QUIET = new Set(['st-starfield-overlay', 'st-particle-burst', 'st-beat-flash', 'st-datamosh', 'st-surf-3', 'st-directional-blur']);

const S = {
  lib: new ShaderLibrary(), comp: null, A: null, mtex: null, plan: null, name: '',
  scenes: [], trans: [], effects: [], mine: [], stScenes: [],
  cfg: Object.assign({ style: '', pace: 0.5, remix: 0.55, hits: 0.85, duets: true, libTransitions: true, effects: true, credits: false, seed: '' }, store.get('cfg', {})),
  out: Object.assign({ res: '1920x1080', fps: 30, mbps: 16, preview: 0.5 }, store.get('out', {})),
  libUrl: store.get('libUrl', ''),
  recent: store.get('recent', {}), lastStyle: store.get('lastStyle', ''), probes: store.get('probes', {}),
  blacklist: new Set(), seedNow: 0, recentForSeed: null, rollId: 0,
  dirty: true, exporting: false, recording: false, cancel: false, adapt: 1, lastFrameAt: 0, ftAvg: 16,
  lastBlob: null, lastExt: 'mp4', canRender: typeof VideoEncoder !== 'undefined',
  thumbs: new Map(),
};
const player = new Player();
const dlCap = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

function status(msg, kind) { const el = $('#status'); el.textContent = msg || ''; el.dataset.kind = kind || ''; }
function busy(msg, p) {
  $('#busy').textContent = msg || '';
  $('#busyBar').hidden = p == null;
  if (p != null) $('#busyBar i').style.setProperty('--p', Math.round(p * 100) + '%');
}
const outSize = () => RES[S.out.res] || RES['1920x1080'];
const randomSeed = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return (a[0] % 2176782335) + 1; };

// ------------------------------------------------------------ library + pools
function libraryCandidates() {
  const q = new URLSearchParams(location.search).get('lib');
  const sameOrigin = location.protocol.startsWith('http') ? new URL('library', location.href).href : null;
  return [q, S.libUrl, sameOrigin, LIB_DEFAULT].filter((v, i, a) => v && a.indexOf(v) === i);
}
async function openLibrary() {
  const el = $('#libline');
  el.dataset.kind = ''; el.textContent = 'Opening the shader library…';
  const bi = builtinEntries();
  try {
    await S.lib.open(libraryCandidates());
  } catch (e) {
    S.lib.entries = [];
    el.dataset.kind = 'error';
    el.textContent = 'Couldn’t reach the shader library, so only the built-in shader is available. Check the address in Settings.';
  }
  const ok = (e) => !(e.needs || []).some(n => ['keyboard', 'video', 'webcam'].includes(n));
  S.scenes = S.lib.entries.filter(e => (e.kind || 'standalone') === 'standalone' && ok(e)).concat(bi.scenes, S.stScenes || [], S.mine);
  // Luma needs a greyscale map the library doesn't ship, so it leaves specks; leave it out.
  S.trans = S.lib.entries.filter(e => e.kind === 'transition' && e.id !== 'luma').concat(bi.trans);
  if (S.lib.entries.length) {
    const host = S.lib.root.replace(/^https?:\/\//, '').replace(/\/library$/, '');
    el.textContent = `${S.scenes.length} shaders, ${S.trans.length} transitions and ${S.effects.length} effects, from ${host}`;
  }
}
const scenePool = () => S.scenes.filter(e => !S.blacklist.has(e.id));
const entryById = (id) => S.scenes.find(e => e.id === id) || S.trans.find(e => e.id === id) || S.effects.find(e => e.id === id);

async function loadEffects() {
  if (typeof ST_EFFECTS_GZ === 'undefined' || typeof DecompressionStream === 'undefined') return [];
  try {
    const bin = Uint8Array.from(atob(ST_EFFECTS_GZ), c => c.charCodeAt(0));
    const txt = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const pack = JSON.parse(txt);
    const mk = (e, kind) => ({
      id: e.id, name: e.name, user: 'SuperTool', kind, tags: e.tags || [], source: 'supertool', stars: 3, audio: e.audio, needs: [],
      w: ST_EFFECT_STRONG.has(e.id) ? 0.6 : ST_EFFECT_QUIET.has(e.id) ? 0.35 : 1, maxAmt: ST_EFFECT_STRONG.has(e.id) ? 0.65 : 1,
      doc: { schema: 'shaderlib/1', dialect: 'supertool', kind, params: e.params || {}, info: { id: e.id, name: e.name },
        renderpass: [{ type: 'image', name: 'Image', code: e.code, inputs: [{ channel: 0, type: 'frame', sampler: { filter: 'linear', wrap: 'clamp', vflip: false } }] }] },
    });
    S.stScenes = pack.effects.filter(e => ST_EFFECT_SCENES.has(e.id)).map(e => mk(e, 'standalone'));
    return pack.effects.filter(e => !ST_EFFECT_SKIP.has(e.id) && !ST_EFFECT_SCENES.has(e.id)).map(e => mk(e, 'effect'));
  } catch (e) { console.warn('[effects]', e); return []; }
}

// Compile a list of entries, a few at a time, reporting progress.
async function compileMany(list, onProgress) {
  let done = 0;
  const queue = list.slice();
  const worker = async () => {
    while (queue.length) {
      const e = queue.shift();
      try { await S.comp.load(e, S.lib); } catch (err) { console.warn('[compile]', e.name || e.id, err.log || err.message); }
      done++; onProgress && onProgress(done, list.length, e);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker));
}

// A still for shaders that don't come with one (the built-in and your own).
function thumbFor(e) {
  if (!e) return '';
  const u = S.lib.thumbUrl(e);
  if (u) return u;
  if (S.thumbs.has(e.id)) return S.thumbs.get(e.id);
  const inst = S.comp.insts.get(e.id);
  if (!inst) return '';
  const gl = S.comp.gl, w = 160, h = 90;
  const out = S.comp.target('thumb', w, h);
  S.comp.rt.reset(inst); inst.owner = 'thumb';
  for (let f = 0; f < (inst.hasBuffers ? 10 : 1); f++) { S.comp.rt.uploadAudio(MusicTexture.synthetic(0.8, 14 + f / 30)); S.comp.rt.render(inst, out, { time: 14 + f / 30, dt: 1 / 30, date: [2026, 9, 22, 0], sampleRate: 44100, extra: {} }); }
  inst.owner = null;
  const px = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const img = c.getContext('2d').createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  c.getContext('2d').putImageData(img, 0, 0);
  const url = c.toDataURL('image/jpeg', 0.8);
  S.thumbs.set(e.id, url);
  return url;
}

// ------------------------------------------------------------ song
async function loadSong(file) {
  if (!file || S.exporting || S.recording) return;
  player.stop(); updateTransport();
  setControls(false);
  $('#drop').hidden = false; $('#bigPlay').hidden = true; sizeStage();
  try {
    busy(`Reading “${file.name}”`, 0.02);
    const ab = await file.arrayBuffer();
    const ctx = player.ensure();
    const buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
    busy('Listening for the beat, the drops and the quiet parts', 0.05);
    const A = await analyzeAudio(buf, p => busy('Listening for the beat, the drops and the quiet parts', 0.05 + p * 0.35));
    player.setBuffer(buf);
    S.A = A; S.mtex = new MusicTexture(buf); S.comp.sampleRate = buf.sampleRate;
    S.name = file.name.replace(/\.[^.]+$/, '');
    S.recentForSeed = null;
    updateEstimate();
    await roll(true);
  } catch (e) {
    console.error(e);
    busy('');
    status('That file couldn’t be read as audio. MP3, WAV, M4A, AAC, OGG, FLAC and Opus all work.', 'error');
    if (S.plan) { setControls(true); $('#drop').hidden = true; }
  }
}

// ------------------------------------------------------------ roll a cut
async function roll(newSeed) {
  if (!S.A) return;
  const my = ++S.rollId;
  const wasPlaying = player.playing;
  player.pause(); updateTransport();
  setControls(false);
  const locked = String(S.cfg.seed || '').trim();
  let seed;
  if (locked) seed = codeSeed(locked);
  else if (newSeed || !S.seedNow) { seed = randomSeed(); S.recentForSeed = Object.assign({}, S.recent); }
  else seed = S.seedNow;
  S.seedNow = seed;
  const recent = locked ? null : S.recentForSeed;
  const cfg = Object.assign({}, S.cfg, { seed });
  const pool = scenePool();
  if (!pool.length) { busy(''); status('There are no shaders to work with. Check the library address in Settings.', 'error'); return; }
  for (const e of pool) if (!e.probe && S.probes[e.id]) e.known = S.probes[e.id];   // brightness from earlier sessions
  const St = planStructure(S.A, cfg, { poolSize: pool.length, lastStyle: locked ? '' : S.lastStyle, effectPool: S.effects });
  const styleName = STYLES[St.styleKey].name;
  const showBusy = !S.plan || $('#drop').hidden === false;
  const say = (msg, p) => { if (showBusy) busy(msg, p); else status(msg); };

  // cast: draw a few spares, compile, probe, drop anything broken or black, top up if short
  const pinned = S.mine.map(e => e.id);
  let cand = chooseCast(pool, Math.min(pool.length, St.K + Math.ceil(St.K * 0.25) + 2), St.rnd, recent, pinned);
  const good = [];
  for (let round = 0; round < 4 && cand.length; round++) {
    await compileMany(cand, (d, n, e) => say(`${styleName}. Compiling ${e.name}`, 0.4 + 0.5 * Math.min(1, (good.length + d) / Math.max(1, St.K + 2))));
    if (my !== S.rollId) return;
    for (const e of cand) {
      if (!S.comp.insts.has(e.id)) { S.blacklist.add(e.id); continue; }
      if (!e.probe) { e.probe = S.comp.probe(e.id); if (e.probe) { S.probes[e.id] = { I: +e.probe.I.toFixed(3), Y: +e.probe.Y.toFixed(3) }; store.set('probes', S.probes); } }
      if (!e.probe || e.probe.black) { S.blacklist.add(e.id); S.comp.unload(e.id); continue; }
      good.push(e);
    }
    if (good.length >= St.K) break;
    const have = new Set(good.map(e => e.id).concat(cand.map(e => e.id)));
    cand = chooseCast(pool.filter(e => !have.has(e.id) && !S.blacklist.has(e.id)), St.K - good.length + 1, St.rnd, recent, []);
  }
  const cast = good.filter(e => pinned.includes(e.id)).concat(good.filter(e => !pinned.includes(e.id))).slice(0, Math.max(St.K, pinned.length));
  if (!cast.length) { busy(''); status('None of the shaders compiled on this GPU. Details are in the browser console.', 'error'); return; }

  const plan = planFinish(S.A, St, cast, S.trans, cfg);
  const trList = [...new Set(plan.trans.filter(t => t.id).map(t => t.id))].map(entryById).filter(Boolean);
  const fxList = plan.effects.ids.map(entryById).filter(Boolean);
  say(`${styleName}. Preparing ${trList.length} transitions${fxList.length ? ` and ${fxList.length} effects` : ''}`, 0.93);
  await compileMany(trList.concat(fxList));
  if (my !== S.rollId) return;
  for (const tr of plan.trans) if (tr.id && !S.comp.insts.has(tr.id)) { tr.cut = true; tr.id = null; tr.plainCut = true; }
  plan.effects.windows = plan.effects.windows.filter(w => S.comp.insts.has(w.id));

  S.plan = plan;
  if (!locked && newSeed) {
    // memory: what this roll used gets pushed to the back of the queue for the next few rolls
    for (const k in S.recent) { S.recent[k] *= 0.55; if (S.recent[k] < 0.05) delete S.recent[k]; }
    for (const id of plan.used) S.recent[id] = (S.recent[id] || 0) + 1;
    store.set('recent', S.recent);
    S.lastStyle = plan.styleKey; store.set('lastStyle', S.lastStyle);
  }
  // keep GPU memory in check across many rolls
  if (S.comp.insts.size > 80) {
    const keep = new Set([...plan.used, ...trList.map(e => e.id), ...fxList.map(e => e.id)]);
    for (const id of [...S.comp.insts.keys()]) if (!keep.has(id)) S.comp.unload(id);
  }
  for (const inst of S.comp.insts.values()) inst.owner = null;
  busy('');
  renderCut(true);
  setControls(true);
  $('#drop').hidden = true; sizeStage();
  status('');
  S.dirty = true;
  if (newSeed || wasPlaying) {
    // A suspended AudioContext (song dropped rather than picked) can't start without a click,
    // and resume() would wait forever, so show the big play button instead of awaiting it.
    if (player.ctx && player.ctx.state === 'running') { try { await player.play(newSeed ? 0 : player.offset); } catch (e) {} }
    if (!player.playing) { if (newSeed) player.offset = 0; $('#bigPlay').hidden = false; }
  }
  updateTransport();
}

// ------------------------------------------------------------ the strip, the cast
function sceneName(id) { const e = entryById(id); return e ? e.name : id; }
function renderCut(animate) {
  const P = S.plan, D = S.A.duration;
  const st = P.style;
  $('#cutName').textContent = `${st.name}, roll ${P.code}`;
  const nT = P.trans.filter(t => t.id).length, nS = P.shots.length;
  $('#cutBlurb').textContent = `${st.blurb} ${nS} shots, ${P.used.length} shaders, ${nT} transitions, ${S.A.bpm.toFixed(0)} BPM.`;
  const tiles = $('#tiles');
  tiles.replaceChildren();
  P.shots.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'tile' + (s.partner ? ' duet' : '') + (s.stutter != null ? ' stutter' : '');
    d.style.left = (s.start / D * 100) + '%';
    d.style.width = Math.max(0.15, (s.end - s.start) / D * 100) + '%';
    d.style.setProperty('--i', String(i));
    const url = thumbFor(entryById(s.scene));
    if (url) d.style.backgroundImage = `url("${url}")`;
    const bits = [sceneName(s.scene)];
    if (s.partner) bits.push(`blended with ${sceneName(s.partner.scene)} (${BLEND_LABEL[s.partner.blend]})`);
    if (s.look.lens) bits.push(`through a ${LENS_LABEL[s.look.lens]}`);
    if (s.time.mode === 'reverse') bits.push('running backwards');
    if (s.time.mode === 'flow') bits.push('speeds up with the music');
    if (s.time.mode === 'stepped') bits.push('stop-motion');
    d.title = `${fmt(s.start)} to ${fmt(s.end)}: ${bits.join(', ')}`;
    const tr = i > 0 ? P.trans[i - 1] : null;
    if (tr && !tr.stutter) {
      const m = document.createElement('i');
      m.className = 'tr' + (tr.id ? '' : ' hard');
      m.title = tr.id ? `${sceneName(tr.id)} transition` : tr.impact ? 'Drop: hard cut with a hit' : 'Cut';
      d.appendChild(m);
    }
    tiles.appendChild(d);
  });
  if (animate) { tiles.classList.remove('rolling'); void tiles.offsetWidth; tiles.classList.add('rolling'); }
  const secs = $('#secs'); secs.replaceChildren();
  for (const s of P.secs) {
    const d = document.createElement('div');
    d.className = 'sec';
    d.style.left = (s.start / D * 100) + '%';
    d.style.width = `calc(${(s.end - s.start) / D * 100}% - 2px)`;
    d.style.background = `var(--k-${s.kind})`;
    if ((s.end - s.start) / D > 0.05) d.textContent = KIND_LABEL[s.kind];
    d.title = `${KIND_LABEL[s.kind]}, ${fmt(s.start)} to ${fmt(s.end)}`;
    secs.appendChild(d);
  }
  const effs = $('#effs'); effs.replaceChildren();
  for (const w of P.effects.windows) {
    const d = document.createElement('div');
    d.className = 'eff';
    d.style.left = (w.t / D * 100) + '%'; d.style.width = (w.dur / D * 100) + '%';
    d.title = `${sceneName(w.id)} (SuperTool effect)`;
    effs.appendChild(d);
  }
  $('#stripEmpty').hidden = true; $('#playhead').hidden = false;
  // cast
  const cast = $('#cast'); cast.replaceChildren();
  for (const id of P.used) {
    const e = entryById(id); if (!e) continue;
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.id = id;
    const th = document.createElement('div'); th.className = 'th';
    const url = thumbFor(e); if (url) th.style.backgroundImage = `url("${url}")`;
    const txt = document.createElement('div');
    const n = document.createElement('b'); n.textContent = e.name;
    const u = document.createElement('span'); u.textContent = e.user || '';
    txt.append(n, u); b.append(th, txt);
    b.title = `Jump to ${e.name}`;
    b.addEventListener('click', () => { const s = P.shots.find(x => x.scene === id || (x.partner && x.partner.scene === id)); if (s) seek(s.start + 0.01); });
    cast.appendChild(b);
  }
  $('#castTitle').textContent = `The cast: ${P.used.length} shaders`;
  $('#copyCredits').disabled = false;
}

function creditsText() {
  const P = S.plan;
  const lines = [`Visuals cut by Shader Roulette from the Shader-Selector library (@OneHung).`, '', 'Shaders:'];
  for (const id of P.used) {
    const e = entryById(id); if (!e) continue;
    lines.push(`- ${e.name} by ${e.user || 'unknown'}${e.url ? ' ' + e.url : ''}`);
  }
  const libT = [...new Set(P.trans.filter(t => t.id && entryById(t.id) && entryById(t.id).source !== 'builtin').map(t => entryById(t.id)))];
  if (libT.length) lines.push('', 'Transitions (gl-transitions, MIT): ' + libT.map(e => `${e.name} by ${e.user}`).join(', '));
  if (P.effects.ids.length) lines.push('', 'Effects from SuperTool: ' + P.effects.ids.map(sceneName).join(', '));
  return lines.join('\n');
}

// ------------------------------------------------------------ rendering
function creditText(id) { const e = entryById(id); return e ? `${e.name}\n${e.user || ''}` : ''; }
function renderAt(t, W, H, dt, fps, fade) {
  const F = directFrame(S.A, S.plan, t, { fxAmount: S.cfg.hits, aspect: W / H, credits: S.cfg.credits });
  const music = S.mtex.at(t, fps);
  S.comp.frame(F, music, W, H, { dt, fade, creditText });
  return F;
}

let lastNow = '';
function frame(now) {
  requestAnimationFrame(frame);
  if (!S.plan || S.exporting) return;
  const playing = player.playing;
  if (!playing && !S.dirty) return;
  S.dirty = false;
  const t = player.time(S.recording);
  const [w, h] = outSize();
  // adaptive preview: shrink when the GPU can't keep up, grow back when it can
  const gap = S.lastFrameAt ? now - S.lastFrameAt : 16;
  S.lastFrameAt = now;
  if (playing && !S.recording) {
    S.ftAvg = S.ftAvg * 0.9 + Math.min(100, gap) * 0.1;
    if (S.ftAvg > 26 && S.adapt > 0.35) S.adapt *= 0.97;
    else if (S.ftAvg < 18 && S.adapt < 1) S.adapt = Math.min(1, S.adapt * 1.01);
  }
  const sc = S.recording ? 1 : Math.max(0.15, S.out.preview * S.adapt);
  const F = renderAt(t, even(w * sc), even(h * sc), playing ? Math.min(0.1, gap / 1000) : 1 / 60, playing ? 1000 / Math.max(8, S.ftAvg) : 60);
  // ui
  const shot = S.plan.shots[F.shotIndex];
  const nowTxt = shot ? `${sceneName(shot.scene)}${shot.partner ? ' + ' + sceneName(shot.partner.scene) : ''}` : '';
  if (nowTxt !== lastNow) {
    lastNow = nowTxt; $('#now').textContent = nowTxt;
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', !!(shot && (c.dataset.id === shot.scene || (shot.partner && c.dataset.id === shot.partner.scene)))));
  }
  $('#clock').textContent = `${fmt(t)} / ${fmt(S.A.duration)}`;
  $('#playhead').style.left = `calc(${t / S.A.duration * 100}% - 1px)`;
}

// ------------------------------------------------------------ transport
const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M5 3l15 9-15 9z" fill="currentColor"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24"><path d="M5 3h5v18H5zM14 3h5v18h-5z" fill="currentColor"/></svg>';
function updateTransport() {
  const b = $('#playBtn');
  b.innerHTML = player.playing ? PAUSE_SVG : PLAY_SVG;
  b.setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
  if (player.playing) $('#bigPlay').hidden = true;
}
async function togglePlay() {
  if (!S.plan || S.exporting || S.recording) return;
  if (player.playing) player.pause();
  else { if (player.offset >= player.duration - 0.05) player.offset = 0; await player.play(); }
  updateTransport(); S.dirty = true;
}
player.onEnded = () => { updateTransport(); S.dirty = true; };
function seek(t) { if (!S.A || S.exporting || S.recording) return; player.seek(t); S.dirty = true; }
function setControls(on) {
  for (const id of ['#playBtn', '#rollBtn', '#recBtn']) $(id).disabled = !on || S.exporting || S.recording;
  $('#renderBtn').disabled = !on || !S.canRender || S.exporting || S.recording;
}

// ------------------------------------------------------------ export: frame-perfect (WebCodecs), from Timewarp
async function exportFramePerfect() {
  if (!S.plan || S.exporting || S.recording) return;
  const [w, h] = outSize(), fps = S.out.fps;
  const enc = await pickVideoEncoder(w, h, fps, S.out.mbps * 1e6);
  if (!enc) { status('Render MP4 needs WebCodecs (Chrome or Edge). Use Record live here.', 'error'); return; }
  player.pause(); updateTransport();
  S.exporting = true; S.cancel = false; setExportUI(true, 'Preparing audio');
  const isCancelled = () => S.cancel;
  let fail = null, ve = null;
  try {
    const abuf = await exportAudioBuffer(player.buffer);
    let ap = await pickAudioPath(abuf.sampleRate, abuf.numberOfChannels);
    if (!ap) throw new Error('this browser can’t encode audio, so the video would be silent. Use Chrome or Edge, or Record live');
    const aProg = (p) => { $('#progBar').style.setProperty('--p', Math.round(p * 100) + '%'); $('#progText').textContent = `Encoding audio (${ap.mux === 'aac' ? 'AAC' : 'Opus'}), ${Math.round(p * 100)}%`; };
    let achunks;
    try {
      achunks = ap.kind === 'wasm' ? await encodeAacWasm(abuf, aProg, isCancelled) : await encodeAudioNative(abuf, ap.cfg, aProg, isCancelled);
    } catch (e) {
      if (e.cancelled || !(ap.kind === 'native' && ap.mux === 'aac') || !(await loadAacWasm())) throw e;
      ap = { kind: 'wasm', mux: 'aac' };
      achunks = await encodeAacWasm(abuf, aProg, isCancelled);
    }
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target, video: { codec: enc.muxCodec, width: w, height: h, frameRate: fps },
      audio: { codec: ap.mux, numberOfChannels: abuf.numberOfChannels, sampleRate: abuf.sampleRate },
      fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    });
    let ai = 0;
    const feedAudio = (untilUs) => { while (ai < achunks.length && achunks[ai].t <= untilUs) { const c = achunks[ai++]; muxer.addAudioChunkRaw(c.d, 'key', c.t, c.dur, c.meta); } };
    ve = new VideoEncoder({
      output: (c, m) => { try { muxer.addVideoChunk(c, m); feedAudio(c.timestamp + (c.duration || 0)); } catch (e) { fail = fail || e; } },
      error: (e) => { fail = fail || e; },
    });
    ve.configure(enc.cfg);
    for (const inst of S.comp.insts.values()) inst.owner = null;   // every shot starts clean, like playback from 0
    S.mtex.lastT = -1;
    const total = Math.ceil(S.A.duration * fps), t0 = performance.now();
    for (let i = 0; i < total; i++) {
      if (S.cancel || fail) break;
      const t = i / fps;
      const fade = Math.max(0, Math.min(1, (S.A.duration - t) / 0.6, t / 0.15 + 0.0001));
      renderAt(t, w, h, 1 / fps, fps, fade);
      const vf = new VideoFrame(S.comp.canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      ve.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      while (ve.encodeQueueSize > 3 && !fail) await new Promise(r => setTimeout(r, 1));
      if (i % 4 === 0) {
        const el = (performance.now() - t0) / 1000, rate = (i + 1) / fps / el, left = (total - i) / fps / Math.max(0.01, rate);
        $('#progBar').style.setProperty('--p', Math.round(i / total * 100) + '%');
        $('#progText').textContent = `Frame ${i + 1} of ${total}, ${rate.toFixed(2)}× real time, about ${fmt(left)} left`;
        await new Promise(r => setTimeout(r, 0));
      }
    }
    if (S.cancel) throw cancelError();
    await ve.flush(); ve.close(); ve = null;
    if (fail) throw fail;
    feedAudio(Infinity);
    muxer.finalize();
    S.exporting = false;
    finishExport(new Blob([target.buffer], { type: 'video/mp4' }), 'mp4', { container: 'mp4', video: enc.label, audio: ap.mux === 'aac' ? 'AAC' : 'Opus', audioKind: ap.kind });
  } catch (e) {
    if (ve) { try { ve.close(); } catch (x) {} }
    S.exporting = false; setExportUI(false);
    if (e && e.cancelled) status('Render cancelled.');
    else { status(`Render failed: ${e && e.message ? e.message : e}`, 'error'); console.error(e); }
  }
  S.dirty = true;
}

// ------------------------------------------------------------ export: real-time recording
async function recordRealtime() {
  if (!S.plan || S.exporting || S.recording) return;
  const mime = pickRecorderMime();
  if (!mime || !S.comp.canvas.captureStream) { status('This browser can’t record a canvas. Use Render MP4 instead.', 'error'); return; }
  const [w, h] = outSize();
  player.pause(); player.offset = 0;
  for (const inst of S.comp.insts.values()) inst.owner = null;
  renderAt(0, w, h, 1 / 60, 60, 0);
  const vs = S.comp.canvas.captureStream(S.out.fps);
  const stream = new MediaStream([...vs.getVideoTracks(), ...player.recordStream().getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: S.out.mbps * 1e6, audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  S.recording = true; S.cancel = false; setExportUI(true, 'Recording in real time');
  const done = new Promise(res => { rec.onstop = res; });
  rec.start(500);
  player.onEnded = () => { if (rec.state !== 'inactive') rec.stop(); };
  await player.play(0); updateTransport();
  const tick = setInterval(() => {
    const t = player.time(true);
    $('#progBar').style.setProperty('--p', Math.round(t / S.A.duration * 100) + '%');
    $('#progText').textContent = `Recording ${w}×${h}, ${fmt(t)} of ${fmt(S.A.duration)}. Keep this tab in front.`;
    if (S.cancel && rec.state !== 'inactive') { player.pause(); rec.stop(); }
  }, 250);
  await done;
  clearInterval(tick);
  vs.getTracks().forEach(tr => tr.stop());
  player.onEnded = () => { updateTransport(); S.dirty = true; };
  S.recording = false; updateTransport();
  if (S.cancel) { setExportUI(false); status('Recording cancelled.'); return; }
  const info = Object.assign(describeRecorderMime(mime), { realtime: true });
  finishExport(new Blob(chunks, { type: mime.split(';')[0] }), info.container, info);
}

function setExportUI(on, text) {
  $('#prog').hidden = !on;
  $('#progText').textContent = text || '';
  $('#progBar').style.setProperty('--p', '0%');
  $('#cancelBtn').hidden = !on;
  if (on) $('#saveRow').hidden = true;
  setControls(!on && !!S.plan);
  updateTransport();
}
function pills(el, list) {
  el.replaceChildren(...list.map(c => { const b = document.createElement('span'); b.className = 'pill'; b.dataset.level = c.level; b.textContent = c.text; b.title = c.tip; return b; }));
}
function finishExport(blob, ext, info) {
  setExportUI(false);
  S.lastBlob = blob; S.lastExt = ext; S.unsaved = true;
  const mb = (blob.size / 1048576).toFixed(1);
  $('#saveRow').hidden = false;
  $('#saveInfo').textContent = `${ext.toUpperCase()}${info.unknown ? '' : `, ${info.video} and ${info.audio}`}, ${mb} MB, ${S.out.res.replace('x', '×')} at ${S.out.fps} fps`;
  const v = xVerdict(info);
  pills($('#saveChips'), [v, ...xLimitChips(S.A.duration, blob.size)]);
  status(v.level === 'ok' ? 'Video ready. Click Save video to put it on your computer.' : `Video ready, but: ${v.text}. Click Save video to keep it anyway.`, v.level === 'bad' ? 'error' : '');
  $('#saveBtn').focus();
}
async function saveLast() {
  if (!S.lastBlob) return;
  const base = (S.name || 'shader-roulette').replace(/[^\w\- .]+/g, '').trim() || 'shader-roulette';
  const filename = `${base} - roulette ${S.plan ? S.plan.code : ''}.${S.lastExt}`;
  const mime = S.lastExt === 'mp4' ? 'video/mp4' : 'video/webm';
  // 1. Chrome and Edge: a real Save As dialog, so you choose the folder and see the file land.
  //    Called first, straight from the click, while the browser still counts it as your click.
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: S.lastExt.toUpperCase() + ' video', accept: { [mime]: ['.' + S.lastExt] } }] });
      status('Writing the file…');
      const w = await h.createWritable();
      await w.write(S.lastBlob);
      await w.close();
      S.unsaved = false;
      status(`Saved “${h.name}” in the folder you picked.`);
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') { status('Save cancelled. The video is still here, click Save video again when you’re ready.'); return; }
      console.warn('[save] Save As dialog unavailable, using a normal download instead', e);
    }
  }
  // 2. When this page runs inside Claude: its download capability (never wait on it for long).
  const dl = await Promise.race([dlCap, new Promise(r => setTimeout(() => r(null), 1200))]);
  if (dl) {
    try { await dl.save({ filename, data: S.lastBlob }); S.unsaved = false; status('Saved.'); return; }
    catch (e) { if (e && e.code === 'declined') { status('Save cancelled.'); return; } }
  }
  // 3. A plain browser download.
  const url = URL.createObjectURL(S.lastBlob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 120000);
  S.unsaved = false;
  status(window.self !== window.top
    ? 'If no download appeared, this page is inside a preview that blocks downloads. Download shader-roulette.html and open it straight in Chrome or Edge.'
    : `Download started: “${filename}”. Press Ctrl+J to see it in your downloads.`);
}
const fmtSize = (b) => b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`;
function updateEstimate() {
  if (!S.A) return;
  const [w, h] = outSize(), secs = S.A.duration;
  const bytes = (S.out.mbps * 1e6 + 192000) * secs / 8;
  $('#estimate').textContent = `About ${fmtSize(bytes)} for ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')} at ${w}×${h}, ${S.out.fps} fps.`;
}
let preflightSeq = 0;
async function updatePreflight() {
  const seq = ++preflightSeq;
  const [w, h] = outSize();
  const p = await probeExport(w, h, S.out.fps, S.out.mbps * 1e6);
  if (seq !== preflightSeq) return;
  let level = 'ok', text, tip;
  if (!p.video) { level = 'bad'; text = 'Render MP4 needs Chrome or Edge'; tip = 'This browser has no WebCodecs video encoder. Record live still works.'; }
  else if (!p.audio) { level = 'bad'; text = 'No audio encoder here'; tip = 'A render would come out silent. Use Chrome or Edge, or Record live.'; }
  else if (p.video !== 'H.264' || p.audio !== 'AAC') { level = 'warn'; text = `Writes ${p.video} and ${p.audio}, which X won’t take`; tip = 'Render in Chrome or Edge on Windows or Mac for H.264 with AAC.'; }
  else { text = p.audioKind === 'wasm' ? 'Writes H.264 and AAC (built-in encoder), ready for X' : 'Writes H.264 and AAC, ready for X'; tip = 'MP4 with H.264 video and AAC-LC audio, the format X recommends.'; }
  S.canRender = !!(p.video && p.audio);
  if (!S.exporting && !S.recording) $('#renderBtn').disabled = !S.canRender || !S.plan;
  const est = S.A ? xLimitChips(S.A.duration, (S.out.mbps * 1e6 + 192000) * S.A.duration / 8) : [];
  pills($('#preflight'), [{ level, text, tip }, ...est]);
}

// ------------------------------------------------------------ your own shaders
async function addMine(files) {
  for (const f of files) {
    const code = await f.text();
    const dialect = /void\s+mainImage\s*\(/.test(code) ? 'shadertoy' : /void\s+main\s*\(/.test(code) ? 'glsl-full' : null;
    if (!dialect) { status(`${f.name} has no mainImage() or main(), so it isn’t a fragment shader this page can run.`, 'error'); continue; }
    let h = 0; for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) | 0;
    const id = 'mine-' + (h >>> 0).toString(36);
    const name = f.name.replace(/\.[^.]+$/, '');
    const e = { id, name, user: 'You', kind: 'standalone', category: 'audio-reactive', stars: 5, needs: ['music'], tags: [], source: 'mine', doc: localDoc(id, name, 'You', code, dialect, 'standalone', 'audio-reactive') };
    try { await S.comp.load(e, S.lib); }
    catch (err) { status(`${name} didn’t compile: ${String(err.log || err.message).split('\n').slice(0, 2).join(' ')}`, 'error'); continue; }
    if (!S.mine.some(m => m.id === id)) S.mine.push(e);
    if (!S.scenes.some(m => m.id === id)) S.scenes.push(e);
    status(`Added ${name}. It’ll be in every roll until you remove it.`);
  }
  saveMine(); renderMine();
}
function saveMine() {
  const data = S.mine.map(e => ({ id: e.id, name: e.name, code: e.doc.renderpass[0].code, dialect: e.doc.dialect }));
  store.set('mine', JSON.stringify(data).length < 400000 ? data : []);
}
function restoreMine() {
  for (const m of store.get('mine', [])) {
    S.mine.push({ id: m.id, name: m.name, user: 'You', kind: 'standalone', category: 'audio-reactive', stars: 5, needs: ['music'], tags: [], source: 'mine', doc: localDoc(m.id, m.name, 'You', m.code, m.dialect, 'standalone', 'audio-reactive') });
  }
}
function renderMine() {
  $('#mineBox').hidden = !S.mine.length;
  $('#mineList').replaceChildren(...S.mine.map(e => {
    const t = document.createElement('span'); t.className = 'tag'; t.textContent = e.name;
    const x = document.createElement('button'); x.textContent = '×'; x.setAttribute('aria-label', `Remove ${e.name}`);
    x.addEventListener('click', () => { S.mine = S.mine.filter(m => m !== e); S.scenes = S.scenes.filter(m => m !== e); saveMine(); renderMine(); });
    t.appendChild(x); return t;
  }));
}

// ------------------------------------------------------------ settings
let replanTimer = 0;
function replanSoon() { clearTimeout(replanTimer); replanTimer = setTimeout(() => { store.set('cfg', S.cfg); if (S.A) roll(false); }, 350); }
function bindSettings() {
  const range = (id, obj, key, show) => {
    const el = $('#' + id), out = $('#' + id + 'Val');
    el.value = S[obj][key];
    const upd = () => { if (out) out.textContent = show(+el.value); };
    upd();
    el.addEventListener('input', () => { S[obj][key] = +el.value; upd(); if (obj === 'out') { store.set('out', S.out); updateEstimate(); S.dirty = true; } if (id === 'hits') { store.set('cfg', S.cfg); S.dirty = true; } });
    if (obj === 'cfg' && id !== 'hits') el.addEventListener('change', replanSoon);
    if (obj === 'out' && id === 'mbps') el.addEventListener('change', updatePreflight);
  };
  const pct = (v) => Math.round(v * 100) + '%';
  range('mbps', 'out', 'mbps', v => v + ' Mbps');
  range('preview', 'out', 'preview', pct);
  range('pace', 'cfg', 'pace', v => v < 0.3 ? 'Relaxed' : v > 0.7 ? 'Frantic' : 'Natural');
  range('remix', 'cfg', 'remix', v => v === 0 ? 'Off' : pct(v));
  range('hits', 'cfg', 'hits', v => v === 0 ? 'Off' : pct(v));
  const sel = (id, obj, key, cast) => {
    const el = $('#' + id); el.value = String(S[obj][key]);
    el.addEventListener('change', () => {
      S[obj][key] = cast ? cast(el.value) : el.value; store.set(obj, S[obj]);
      if (obj === 'cfg') replanSoon(); else { updateEstimate(); updatePreflight(); sizeStage(); S.dirty = true; }
    });
  };
  sel('res', 'out', 'res'); sel('fps', 'out', 'fps', Number); sel('style', 'cfg', 'style');
  const chk = (id, key, replan = true) => { const el = $('#' + id); el.checked = !!S.cfg[key]; el.addEventListener('change', () => { S.cfg[key] = el.checked; store.set('cfg', S.cfg); if (replan) replanSoon(); else S.dirty = true; }); };
  chk('duets', 'duets'); chk('libTrans', 'libTransitions'); chk('effects', 'effects'); chk('credits', 'credits', false);
  const seedEl = $('#seed'); seedEl.value = S.cfg.seed || '';
  seedEl.addEventListener('change', () => { S.cfg.seed = seedEl.value.trim().toUpperCase(); seedEl.value = S.cfg.seed; store.set('cfg', S.cfg); if (S.A) roll(!S.cfg.seed); });
  const lib = $('#libUrl'); lib.value = S.libUrl;
  $('#libReload').addEventListener('click', async () => { S.libUrl = lib.value.trim(); store.set('libUrl', S.libUrl); await openLibrary(); });
  const open = (on) => { $('#drawer').classList.toggle('open', on); $('#scrim').hidden = !on; $('#settingsBtn').setAttribute('aria-expanded', String(on)); if (on) $('#closeDrawer').focus(); };
  $('#settingsBtn').addEventListener('click', () => open(true));
  $('#closeDrawer').addEventListener('click', () => open(false));
  $('#scrim').addEventListener('click', () => open(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
}

function sizeStage() {
  const [w, h] = outSize();
  const wrap = $('.stage-wrap'), st = $('#stage');
  const maxW = wrap.clientWidth - 40, maxH = Math.max(240, window.innerHeight * 0.66);
  let W = maxW, H = W * h / w;
  if (H > maxH) { H = maxH; W = H * w / h; }
  if (!$('#drop').hidden && H < 360) { W = maxW; H = Math.min(380, window.innerHeight * 0.62); }   // room for the drop panel on phones
  st.style.width = Math.round(W) + 'px'; st.style.height = Math.round(H) + 'px';
  st.style.aspectRatio = 'auto';
}

// ------------------------------------------------------------ boot
async function boot() {
  sizeStage();
  window.addEventListener('resize', sizeStage);
  bindSettings();
  restoreMine(); renderMine();
  try {
    S.comp = new Compositor($('#view'));
    await S.comp.init();
  } catch (e) {
    console.error(e);
    $('#dropText').textContent = 'This browser or graphics driver can’t run WebGL2 shaders. Try a current Chrome or Edge and update your graphics driver.';
    $('#chooseBtn').disabled = true;
    return;
  }
  for (const m of S.mine) { try { await S.comp.load(m, S.lib); } catch (e) {} }
  S.effects = await loadEffects();
  await openLibrary();

  const pickSong = () => { player.ensure(); if (player.ctx.state !== 'running') player.ctx.resume().catch(() => {}); $('#songFile').click(); };
  $('#chooseBtn').addEventListener('click', pickSong);
  $('#songFile').addEventListener('change', (e) => { loadSong(e.target.files[0]); e.target.value = ''; });
  $('#glslFile').addEventListener('change', (e) => { addMine([...e.target.files]); e.target.value = ''; });
  $('#addMine').addEventListener('click', () => $('#glslFile').click());
  $('#playBtn').addEventListener('click', togglePlay);
  $('#bigPlay').addEventListener('click', togglePlay);
  $('#rollBtn').addEventListener('click', () => { if (S.cfg.seed) { S.cfg.seed = ''; $('#seed').value = ''; store.set('cfg', S.cfg); } roll(true); });
  $('#renderBtn').addEventListener('click', exportFramePerfect);
  $('#recBtn').addEventListener('click', recordRealtime);
  $('#cancelBtn').addEventListener('click', () => { S.cancel = true; });
  $('#saveBtn').addEventListener('click', saveLast);
  $('#copyCredits').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(creditsText()); status('Credits copied.'); }
    catch (e) { status('Copying was blocked by the browser. The credits are in the console.'); console.log(creditsText()); }
  });
  // drop anywhere: a song plays, .glsl files join the pool
  const drop = $('#drop');
  document.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.classList.remove('over'); });
  document.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const files = [...(e.dataTransfer.files || [])];
    const glsl = files.filter(f => /\.(glsl|frag|fs)$/i.test(f.name));
    const song = files.find(f => !glsl.includes(f));
    if (glsl.length) addMine(glsl);
    if (song) { player.ensure(); loadSong(song); }
  });
  // strip: click or drag to seek
  const strip = $('#strip');
  let dragging = false;
  const at = (e) => { const r = strip.getBoundingClientRect(); seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * S.A.duration); };
  strip.addEventListener('pointerdown', (e) => { if (!S.plan) return; dragging = true; strip.setPointerCapture(e.pointerId); at(e); });
  strip.addEventListener('pointermove', (e) => { if (dragging) at(e); });
  strip.addEventListener('pointerup', () => { dragging = false; });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, button')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight' && S.A) seek(player.time() + 5);
    else if (e.code === 'ArrowLeft' && S.A) seek(player.time() - 5);
    else if (e.key === 'r' && S.plan && !S.exporting && !S.recording) $('#rollBtn').click();
  });
  if (typeof VideoEncoder === 'undefined') $('#renderBtn').title = 'Render MP4 needs WebCodecs (Chrome or Edge). Record live works here.';
  try { await Promise.race([document.fonts.load('600 30px "Bricolage Grotesque"'), new Promise(r => setTimeout(r, 2000))]); } catch (e) {}
  requestAnimationFrame(frame);
  updatePreflight();
  // a finished render only lives in this tab until it's saved
  window.addEventListener('beforeunload', (e) => { if (S.unsaved || S.exporting) { e.preventDefault(); e.returnValue = ''; } });
  window.__roulette = S;   // handy in the console
}
boot();
