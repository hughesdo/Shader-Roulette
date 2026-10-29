// ============================================================ compositor
// One frame = up to four shader renders (outgoing shot, its duet partner, incoming shot, its partner),
// each through a look pass, then duet blends, the transition, an optional SuperTool effect, and the
// fx pass (hits, echo, freeze, credit). Everything is offscreen until the final blit to the canvas.

const SYS_DOC = (id, code) => ({ schema: 'shaderlib/1', dialect: 'glsl-full', kind: 'pass', params: {}, info: { id, name: id }, renderpass: [{ type: 'image', name: 'Image', code, inputs: [] }] });

class Compositor {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('This browser has no WebGL2. Try a current Chrome, Edge, Firefox or Safari.');
    this.gl = gl; this.canvas = canvas;
    this.rt = new ShaderRuntime(gl);
    this.insts = new Map();          // entry id -> compiled instance
    this.failed = new Map();         // entry id -> error text
    this.sys = {};
    this.T = {};                     // named render targets
    this.size = [0, 0];
    this.fxFlip = 0;
    this.overlay = { canvas: document.createElement('canvas'), tex: null, key: '' };
    this.sampleRate = 44100;
    this.entries = new Map();
  }

  async init() {
    const defs = { look: LOOK_SRC, duet: DUET_SRC, fx: FX_SRC, blit: BLIT_SRC };
    for (const [k, code] of Object.entries(defs)) {
      this.sys[k] = await this.rt.compile({ entry: { id: 'sys-' + k, name: k }, doc: SYS_DOC('sys-' + k, '#version 300 es\n' + code), baseUrl: '' });
    }
    const gl = this.gl;
    this.overlay.tex = this.rt.tex2D(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, gl.CLAMP_TO_EDGE, new Uint8Array(4));
  }

  // ---------------------------------------------------------- shaders
  async load(entry, lib) {
    if (this.insts.has(entry.id)) return this.insts.get(entry.id);
    if (this.failed.has(entry.id)) throw new Error(this.failed.get(entry.id));
    try {
      const rs = await lib.get(entry);
      const inst = await this.rt.compile(rs);
      inst.hasBuffers = inst.passes.some(p => p.pass.type === 'buffer');
      this.insts.set(entry.id, inst);
      this.entries.set(entry.id, entry);
      return inst;
    } catch (e) {
      this.failed.set(entry.id, (e && (e.log || e.message)) || String(e));
      throw e;
    }
  }
  unload(id) { const i = this.insts.get(id); if (i) { this.rt.destroy(i); this.insts.delete(id); } }

  // ---------------------------------------------------------- targets
  target(name, w, h) {
    let t = this.T[name];
    if (t && t.w === w && t.h === h) return t;
    if (t) this.rt.freeTarget(t);
    t = this.T[name] = this.rt.target(w, h, false);
    return t;
  }

  // ---------------------------------------------------------- one shader into one target
  scene(key, id, time, dt, out) {
    const inst = this.insts.get(id);
    const gl = this.gl;
    if (!inst) { gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const st = { time, dt, date: [2026, 9, 22, 43200 + time], sampleRate: this.sampleRate, progress: 0, extra: {} };
    if (inst.owner !== key) {
      this.rt.reset(inst); inst.owner = key;
      if (inst.hasBuffers) for (let k = 8; k > 0; k--) { st.time = time - k / 60; st.dt = 1 / 60; this.rt.render(inst, out, st); }
      st.time = time; st.dt = dt;
    }
    this.rt.render(inst, out, st);
  }

  looks(look) {
    return !look || (look.lens === 0 && look.grade[0] === 0 && look.grade[1] === 1 && look.grade[2] === 1 && look.grade[3] === 1 && look.tint[3] === 0 && !look.poster);
  }

  // A shot (plus its duet partner) all the way to one texture.
  layer(L, slot, t, dt, W, H, sw, sh, au) {
    const raw = this.target('raw' + slot, sw, sh);
    this.scene(L.key, L.scene, L.time, dt, raw);
    let out = raw;
    if (!this.looks(L.look) || sw !== W || sh !== H) {
      out = this.target('look' + slot, W, H);
      const lk = L.look || { lens: 0, lensP: [0, 0, 0, 0], grade: [0, 1, 1, 1], tint: [0, 0, 0, 0], poster: 0 };
      this.rt.render(this.sys.look, out, { from: raw, time: t, dt, extra: {
        uT: t, uLens: lk.lens, uLensP: lk.lensP, uGrade: lk.grade, uTint: lk.tint, uPoster: lk.poster, uBass: au.bass, uKick: au.kick,
      } });
    }
    if (L.partner) {
      const praw = this.target('raw' + (slot + 1), sw, sh);
      this.scene(L.partner.key, L.partner.scene, L.partner.time, dt, praw);
      const d = this.target('duet' + slot, W, H);
      this.rt.render(this.sys.duet, d, { from: out, to: praw, time: t, dt, extra: {
        uT: t, uBlend: L.partner.blend, uAmt: L.partner.amt, uBass: au.bass, uKick: au.kick, uSeed: 0.37 + slot,
      } });
      out = d;
    }
    return out;
  }

  // ---------------------------------------------------------- credit overlay
  setOverlay(text, W, H) {
    const key = `${text}|${W}x${H}`;
    if (key === this.overlay.key) return;
    this.overlay.key = key;
    const c = this.overlay.canvas;
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    if (text) {
      const s = Math.min(W, H) / 1080;
      const pad = Math.round(54 * s), fs = Math.round(30 * s), fs2 = Math.round(20 * s);
      const [name, who] = text.split('\n');
      g.textBaseline = 'alphabetic';
      g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 14 * s;
      g.fillStyle = 'rgba(255,255,255,.96)';
      g.font = `600 ${fs}px "Bricolage Grotesque", "Segoe UI", system-ui, sans-serif`;
      g.fillText(name, pad, H - pad - fs2 * 1.5);
      g.font = `500 ${fs2}px "Bricolage Grotesque", system-ui, sans-serif`;
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.fillText(who, pad, H - pad);
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.fillRect(pad, H - pad - fs2 * 1.5 - fs * 1.25, Math.round(36 * s), Math.max(2, Math.round(3 * s)));
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.overlay.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
  }

  // ---------------------------------------------------------- the frame
  // F: directFrame() output. music: 1024 bytes (FFT + wave) for this instant.
  frame(F, music, W, H, opts) {
    const gl = this.gl;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const k = opts.sceneScale || 1;
    const sw = Math.max(2, Math.round(W * k)), sh = Math.max(2, Math.round(H * k));
    this.rt.uploadAudio(music);
    const au = F.au, t = F.t, dt = opts.dt || 1 / 60;

    let a = this.layer(F.a, 0, t, dt, W, H, sw, sh, au);
    let comp = a;
    if (F.b) {
      const b = this.layer(F.b, 2, t, dt, W, H, sw, sh, au);
      const tr = F.trans && this.insts.get(F.trans.id);
      if (tr) {
        comp = this.target('trans', W, H);
        this.rt.render(tr, comp, { from: a, to: b, progress: F.trans.progress, time: t, dt, extra: {
          uBass: au.bass, uKick: au.kick, uSeed: F.trans.seed, uDir: F.trans.dir,
        } });
      } else comp = F.trans && F.trans.progress >= 0.5 ? b : a;
    }
    // SuperTool effect over the composite
    let eff = null, effAmt = 0;
    if (F.fx.effect && F.fx.effect.amt > 0.001) {
      const ei = this.insts.get(F.fx.effect.id);
      if (ei) {
        eff = this.target('eff', W, H);
        if (ei.owner !== 'fx') { this.rt.reset(ei); ei.owner = 'fx'; }
        this.rt.render(ei, eff, { from: comp, time: t, dt, date: [2026, 9, 22, 43200 + t], sampleRate: this.sampleRate, progress: 0, extra: {} });
        effAmt = F.fx.effect.amt;
      }
    }
    // credit
    let ovAmt = 0;
    if (F.fx.overlay && opts.creditText) { this.setOverlay(opts.creditText(F.fx.overlay.id), W, H); ovAmt = F.fx.overlay.alpha; }
    // fx pass, ping-pong so the next frame can echo / freeze this one
    const prev = this.target('fx' + this.fxFlip, W, H);
    this.fxFlip ^= 1;
    const cur = this.target('fx' + this.fxFlip, W, H);
    const fx = F.fx;
    this.rt.render(this.sys.fx, cur, { from: comp, time: t, dt, tex: { uPrev: prev.tex, uOverlay: this.overlay.tex, uEff: eff ? eff.tex : null }, extra: {
      uT: t, uZoom: fx.zoom, uRGB: fx.rgb, uEcho: fx.echo, uHold: fx.hold, uInvert: fx.invert, uShake: fx.shake, uScan: fx.scan,
      uFade: opts.fade == null ? 1 : opts.fade, uOverlayAmt: ovAmt, uBars: fx.bars, uGrain: opts.grain ?? 0.02, uVignette: opts.vignette ?? 0.35,
      uFlash: fx.flash, uShock: fx.shock, uEffAmt: effAmt,
    } });
    // to the canvas
    this.rt.render(this.sys.blit, { fbo: null, w: W, h: H }, { from: cur, time: t, dt, extra: {} });
    return cur;
  }

  // ---------------------------------------------------------- probe
  // Renders a shader tiny with loud fake music and measures brightness, colour and motion.
  probe(id) {
    const inst = this.insts.get(id);
    if (!inst) return null;
    const gl = this.gl, w = 96, h = 54;
    const out = this.target('probe', w, h);
    const px = new Uint8Array(w * h * 4), px2 = new Uint8Array(w * h * 4);
    this.rt.reset(inst); inst.owner = 'probe';
    const T0 = 12.0;
    const n = inst.hasBuffers ? 12 : 1;
    const st = (tt) => ({ time: tt, dt: 1 / 30, date: [2026, 9, 22, tt], sampleRate: this.sampleRate, progress: 0, extra: {} });
    for (let f = 0; f < n; f++) { this.rt.uploadAudio(MusicTexture.synthetic(0.85, T0 + f / 30)); this.rt.render(inst, out, st(T0 + f / 30)); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let f = 0; f < 4; f++) { const tt = T0 + n / 30 + 0.12 * (f + 1); this.rt.uploadAudio(MusicTexture.synthetic(0.6 + 0.3 * (f & 1), tt)); this.rt.render(inst, out, st(tt)); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    inst.owner = null;
    let Y = 0, S = 0, M = 0, hx = 0, hy = 0;
    const N = w * h;
    for (let i = 0; i < N; i++) {
      const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx - mn;
      Y += 0.299 * r + 0.587 * g + 0.114 * b; S += s;
      if (s > 0.05) {
        let hh;
        if (mx === r) hh = ((g - b) / s + 6) % 6; else if (mx === g) hh = (b - r) / s + 2; else hh = (r - g) / s + 4;
        const ang = hh / 6 * 2 * Math.PI; hx += Math.cos(ang) * s; hy += Math.sin(ang) * s;
      }
      M += (Math.abs(px[i * 4] - px2[i * 4]) + Math.abs(px[i * 4 + 1] - px2[i * 4 + 1]) + Math.abs(px[i * 4 + 2] - px2[i * 4 + 2])) / 765;
    }
    Y /= N; S /= N; M /= N;
    const H = ((Math.atan2(hy, hx) / (2 * Math.PI)) + 1) % 1;
    const I = 0.45 * Math.min(1, M * 5) + 0.35 * Math.min(1, Y * 1.7) + 0.2 * Math.min(1, S * 2);
    return { Y, S, M, H, I, black: Y < 0.012 && M < 0.002 };
  }
}
