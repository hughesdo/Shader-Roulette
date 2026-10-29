// ============================================================ shader runtime
// Plain-JS port of Shader-Selector's preprocess.ts + ShaderRenderer.ts, reshaped for offline,
// frame-exact rendering: every shader draws into an offscreen target at a time WE choose, so the
// same code drives the live preview and the frame-perfect MP4 render.
//
// Library format is shaderlib/1 (see Shader-Selector src/library/schema.ts). Three dialects:
//   shadertoy     mainImage() code, we inject uniforms and main()
//   glsl-full     complete program with its own #version / uniforms / out / main (OneOffRender)
//   gl-transition full program declaring sampler2D from, to; float progress; vec2 resolution

const GLSL_PRECISION = 'precision highp float; precision highp int; precision highp sampler2D; precision highp samplerCube;';
const FRAG_OUT = 'shaderlibFragColor';

function esFixups(src) {
  return src
    .replace(/^﻿/, '')
    .replace(/\btexture2D\s*\(/g, 'texture(')
    .replace(/\btextureCube\s*\(/g, 'texture(')
    .replace(/\btexture2DLod\s*\(/g, 'textureLod(')
    .replace(/^\s*#extension[^\n]*$/gm, '');
}

function prepareFull(code) {
  let src = esFixups(code);
  const legacyOut = /\bgl_FragColor\b/.test(src) && !/\bout\s+vec4\s+\w+\s*;/.test(src);
  if (legacyOut) src = src.replace(/\bgl_FragColor\b/g, FRAG_OUT);
  const lines = src.split('\n');
  const vi = lines.findIndex((l) => /^\s*#version\b/.test(l));
  if (vi >= 0) lines[vi] = '';
  const decl = legacyOut ? `out vec4 ${FRAG_OUT};\n` : '';
  return { source: `#version 300 es\n${GLSL_PRECISION}\n${decl}` + lines.join('\n'), lineOffset: legacyOut ? 3 : 2 };
}

function prepareShadertoy(code, common, inputs, isImage) {
  const samplers = [0, 1, 2, 3].map((ch) => {
    const inp = inputs.find((i) => i.channel === ch);
    return `uniform ${inp && inp.type === 'cubemap' ? 'samplerCube' : 'sampler2D'} iChannel${ch};`;
  }).join('\n');
  const header = [
    '#version 300 es', GLSL_PRECISION,
    'uniform vec3 iResolution;', 'uniform float iTime;', 'uniform float iTimeDelta;', 'uniform float iFrameRate;',
    'uniform int iFrame;', 'uniform vec4 iMouse;', 'uniform vec4 iDate;', 'uniform float iSampleRate;',
    'uniform float iChannelTime[4];', 'uniform vec3 iChannelResolution[4];',
    samplers, `out vec4 ${FRAG_OUT};`, esFixups(common || ''), '',
  ].join('\n');
  const footer = `\nvoid main() {\n  vec4 c = vec4(0.0);\n  mainImage(c, gl_FragCoord.xy);\n  ${FRAG_OUT} = ${isImage ? 'vec4(c.rgb, 1.0)' : 'c'};\n}\n`;
  return { source: header + esFixups(code) + footer, lineOffset: header.split('\n').length - 1 };
}

// SuperTool dialect (github.com/hughesdo/SuperTool, src/engine/glsl/GLSLRenderer.ts _prepareSource):
// its own preamble with iAudioFFT (row 1 = spectrum, row 0 = waveform), iProgress, v_text and audio helpers.
const ST_AUDIO_HELPERS = `
float audioFreq(float hz) { float u = clamp(hz / (iSampleRate * 0.5), 0.0, 1.0); return texture(iAudioFFT, vec2(u, 0.75)).x; }
float audioWave(float u) { return texture(iAudioFFT, vec2(clamp(u, 0.0, 1.0), 0.25)).x; }
float audioBand(float loHz, float hiHz) {
  float nyq = iSampleRate * 0.5; float lo = clamp(loHz / nyq, 0.0, 1.0); float hi = clamp(hiHz / nyq, 0.0, 1.0);
  float sum = 0.0; const int STEPS = 16;
  for (int i = 0; i < STEPS; i++) { float t = (float(i) + 0.5) / float(STEPS); sum += texture(iAudioFFT, vec2(mix(lo, hi, t), 0.75)).x; }
  return sum / float(STEPS); }
float audioRMS() { float sum = 0.0; const int STEPS = 32;
  for (int i = 0; i < STEPS; i++) { float u = (float(i) + 0.5) / float(STEPS); float v = texture(iAudioFFT, vec2(u, 0.75)).x; sum += v * v; }
  return sqrt(sum / float(STEPS)); }
float audioSmooth(float prev, float curr, float alpha) { return mix(curr, prev, alpha); }
float audioBeatEnergy() { return smoothstep(0.55, 0.85, audioBand(20.0, 200.0)); }
`;
const ST_BASE = `#version 300 es
precision highp float;
uniform vec3 iResolution; uniform float iTime; uniform float iTimeDelta; uniform int iFrame; uniform float iProgress;
uniform vec4 iMouse; uniform vec4 iDate; uniform sampler2D iAudioFFT; uniform float iSampleRate;
uniform sampler2D iChannel0; uniform sampler2D iChannel1; uniform sampler2D iChannel2; uniform sampler2D iChannel3;
`;
const ST_TAIL = `in vec2 v_text;\nout vec4 fragColor;\n${ST_AUDIO_HELPERS}`;
function stStrip(src) {
  return [
    /uniform\s+(highp\s+)?(vec[234]|float|int|sampler2D|samplerCube)\s+i(Resolution|Time|TimeDelta|Frame|Progress|Mouse|Date|Channel[0-3]|SampleRate)\s*;/g,
    /uniform\s+(highp\s+)?float\s+iAudio(Bass|Mid|High|RMS|Beat)\s*;/g,
    /uniform\s+(highp\s+)?sampler2D\s+iAudioFFT\s*;/g,
    /\bout\s+vec4\s+fragColor\s*;/g,
    /\bin\s+vec2\s+v_text\s*;/g,
  ].reduce((s, re) => s.replace(re, ''), src);
}
function prepareSuperTool(code) {
  let s = code.split('\n').filter(l => !l.trim().startsWith('#version')).join('\n');
  const pre = ST_BASE + ST_TAIL;
  const n = (x) => x.split('\n').length - 1;
  if (/void\s+mainImage\s*\(/.test(s) && !/void\s+main\s*\(/.test(s)) {
    return { source: pre + '\n' + stStrip(s) + '\nvoid main() { mainImage(fragColor, gl_FragCoord.xy); }\n', lineOffset: n(pre) + 1 };
  }
  if (/in\s+vec2\s+fragCoord\s*;/.test(s)) {
    s = s.replace(/in\s+vec2\s+fragCoord\s*;/, '').replace(/out\s+vec4\s+fragColor\s*;/, '').replace(/uniform\s+vec3\s+iResolution\s*;/, '').replace(/\bfragCoord\b/g, 'gl_FragCoord.xy');
    return { source: pre + '\n' + stStrip(s), lineOffset: n(pre) + 1 };
  }
  if (/uniform\s+(highp\s+)?vec[23]\s+iResolution/.test(s)) {
    const h = '#version 300 es\nprecision highp float;\nuniform sampler2D iChannel0; uniform sampler2D iChannel1; uniform sampler2D iChannel2; uniform sampler2D iChannel3;\nin vec2 v_text;\nout vec4 fragColor;\n';
    return { source: h + stStrip(s), lineOffset: n(h) };
  }
  return { source: pre + '\n' + stStrip(s), lineOffset: n(pre) + 1 };
}

function prepareFragment(dialect, code, opts) {
  if (dialect === 'supertool') return prepareSuperTool(code);
  return dialect === 'shadertoy' ? prepareShadertoy(code, opts.common, opts.inputs, opts.isImage) : prepareFull(code);
}

// Fullscreen triangle with no vertex buffer. v_text is there for SuperTool effects that read it.
const RT_VERTEX = `#version 300 es
out vec2 v_text;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_text = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

function remapErrors(log, off) {
  return String(log || '').replace(/(ERROR|WARNING): 0:(\d+):/g, (_m, k, n) => `${k}: line ${Math.max(1, +n - off)}:`);
}

// ------------------------------------------------------------ library
// The Shader-Selector library is a static folder: index/manifest.json, index/page-*.json,
// shaders/ab/cd/<id>/shader.json + *.glsl + thumb.webp, transitions/<name>/..., assets/...
const LIB_DEFAULT = 'https://hughesdo.github.io/Shader-Selector/library';

class ShaderLibrary {
  constructor() { this.root = ''; this.entries = []; this.docs = new Map(); }
  url(rel) { return `${this.root.replace(/\/$/, '')}/${rel}`; }
  thumbUrl(e) { return e.thumbUrl || (e.dir ? this.url(`${e.dir}/${e.thumb}`) : ''); }
  // Try each candidate root until one serves a manifest.
  async open(candidates) {
    let lastErr = null;
    for (const root of candidates.filter(Boolean)) {
      try {
        const r = await fetch(`${root.replace(/\/$/, '')}/index/manifest.json`, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const man = await r.json();
        this.root = root.replace(/\/$/, '');
        const rows = [];
        for (const p of man.pages) {
          const pr = await fetch(this.url(`index/${p}`), { cache: 'no-cache' });
          if (!pr.ok) throw new Error(`page ${p}: HTTP ${pr.status}`);
          rows.push(...(await pr.json()));
        }
        this.entries = rows.map(e => Object.assign({ source: 'library', kind: e.kind || 'standalone' }, e));
        return this.root;
      } catch (e) { lastErr = e; console.warn('[library] ' + root, e); }
    }
    throw lastErr || new Error('no library');
  }
  // Fetch shader.json and every pass's code. Local (built-in / dropped) entries carry their doc already.
  get(entry) {
    if (entry.doc) return Promise.resolve({ entry, doc: entry.doc, baseUrl: this.root });
    let p = this.docs.get(entry.id);
    if (!p) {
      p = (async () => {
        const dir = this.url(entry.dir);
        const r = await fetch(`${dir}/shader.json`);
        if (!r.ok) throw new Error(`shader.json HTTP ${r.status}`);
        const doc = await r.json();
        await Promise.all(doc.renderpass.map(async (pass) => {
          if (pass.code == null && pass.codeFile) {
            const c = await fetch(`${dir}/${pass.codeFile}`);
            if (!c.ok) throw new Error(`${pass.codeFile} HTTP ${c.status}`);
            pass.code = await c.text();
          }
        }));
        return { entry, doc, baseUrl: this.root };
      })();
      p.catch(() => this.docs.delete(entry.id));
      this.docs.set(entry.id, p);
    }
    return p;
  }
}

// ------------------------------------------------------------ runtime
class ShaderRuntime {
  constructor(gl) {
    this.gl = gl;
    this.parallel = gl.getExtension('KHR_parallel_shader_compile');
    this.floatBuffers = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.vao = gl.createVertexArray();
    // Shadertoy's music texture: 512x2, row 0 = FFT, row 1 = waveform.
    // y=0.25 reads the spectrum (Shadertoy convention), y=0.0 too (OneOffRender convention), y>=0.75 the wave.
    this.audioTex = this.tex2D(512, 2, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, gl.CLAMP_TO_EDGE);
    // SuperTool's iAudioFFT has the rows the other way round: row 0 = waveform, row 1 = spectrum.
    this.audioTexST = this.tex2D(512, 2, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, gl.CLAMP_TO_EDGE);
    this.swapBuf = new Uint8Array(1024);
    this.black2D = this.tex2D(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, gl.CLAMP_TO_EDGE);
    this.blackCube = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.blackCube);
    for (let f = 0; f < 6; f++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.assetCache = new Map();
    this.vs = null;
  }

  tex2D(w, h, ifmt, fmt, type, filter, wrap, data) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }

  // An RGBA8 render target (what every layer, transition and fx pass draws into).
  target(w, h, hdr) {
    const gl = this.gl;
    const useF = hdr && this.floatBuffers;
    const tex = this.tex2D(w, h, useF ? gl.RGBA16F : gl.RGBA8, gl.RGBA, useF ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, gl.LINEAR, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }
  freeTarget(t) { if (!t) return; this.gl.deleteTexture(t.tex); this.gl.deleteFramebuffer(t.fbo); }

  uploadAudio(bytes1024) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 2, gl.RED, gl.UNSIGNED_BYTE, bytes1024);
    this.swapBuf.set(bytes1024.subarray(512, 1024), 0);
    this.swapBuf.set(bytes1024.subarray(0, 512), 512);
    gl.bindTexture(gl.TEXTURE_2D, this.audioTexST);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 2, gl.RED, gl.UNSIGNED_BYTE, this.swapBuf);
  }

  // ---------------------------------------------------------- compile
  // Starts compiling every pass and returns a promise. Links are polled with
  // KHR_parallel_shader_compile so twenty shaders compile side by side without freezing the page.
  async compile(rs, opts = {}) {
    const gl = this.gl, doc = rs.doc;
    if (!this.vs) {
      this.vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(this.vs, RT_VERTEX); gl.compileShader(this.vs);
    }
    const common = doc.renderpass.filter(p => p.type === 'common').map(p => p.code || '').join('\n');
    const runnable = doc.renderpass.filter(p => p.type === 'image' || p.type === 'buffer');
    if (!runnable.some(p => p.type === 'image')) throw new Error('no image pass');
    const bad = runnable.flatMap(p => p.inputs || []).find(i => ['keyboard', 'video', 'webcam'].includes(i.type));
    if (bad && !opts.allowMissingInputs) throw new Error(`needs ${bad.type} input`);
    const pending = runnable.map((pass) => {
      const prep = prepareFragment(doc.dialect, pass.code || '', { common, inputs: pass.inputs || [], isImage: pass.type === 'image' });
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, prep.source); gl.compileShader(fs);
      const program = gl.createProgram();
      gl.attachShader(program, this.vs); gl.attachShader(program, fs);
      gl.linkProgram(program);
      return { pass, program, fs, lineOffset: prep.lineOffset };
    });
    if (this.parallel) {
      const ext = this.parallel;
      while (!pending.every(p => gl.getProgramParameter(p.program, ext.COMPLETION_STATUS_KHR))) {
        await new Promise(r => setTimeout(r, 12));
      }
    }
    const fails = [];
    for (const p of pending) {
      if (!gl.getProgramParameter(p.program, gl.LINK_STATUS)) {
        fails.push(`[${p.pass.name}] ${remapErrors(gl.getShaderInfoLog(p.fs) || gl.getProgramInfoLog(p.program), p.lineOffset)}`);
      }
    }
    if (fails.length) {
      pending.forEach(p => { gl.deleteProgram(p.program); gl.deleteShader(p.fs); });
      const e = new Error(`compile failed: ${rs.entry.name || rs.entry.id}`); e.log = fails.join('\n'); throw e;
    }
    pending.forEach(p => { gl.detachShader(p.program, p.fs); gl.deleteShader(p.fs); });
    const isTransition = (doc.kind || 'standalone') === 'transition';
    const inst = {
      id: rs.entry.id, entry: rs.entry, isTransition, params: doc.params || {},
      passes: pending.map(p => this.introspect(p.pass, p.program, doc, isTransition)),
      buffers: new Map(), assets: new Map(), bw: 0, bh: 0, frame: 0, owner: null,
    };
    const assetInputs = runnable.flatMap(p => p.inputs || []).filter(i => i.type === 'texture' || i.type === 'cubemap');
    await Promise.all(assetInputs.map(async (i) => {
      if (!i.ref || !i.src) return;
      try { inst.assets.set(i.ref, await this.loadAsset(i, rs.baseUrl)); }
      catch (e) { console.warn('[asset]', i.src, e); }
    }));
    return inst;
  }

  introspect(pass, program, doc, isTransition) {
    const gl = this.gl, setters = [], samplers = [];
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    const params = doc.params || {};
    let unit = 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(program, info.name);
      if (!loc) continue;
      const T = info.type;
      if (T === gl.SAMPLER_2D || T === gl.SAMPLER_CUBE) {
        const ch = /^iChannel([0-3])$/.exec(name);
        const input = (pass.inputs || []).find(inp => inp.uniform ? inp.uniform === name : ch && inp.channel === +ch[1]);
        let role = input ? 'input' : 'unbound';
        if (name === 'from') role = 'from';
        else if (name === 'to') role = 'to';
        else if (name === 'uAudio') role = 'audio';
        else if (name === 'iAudioFFT') role = 'audioST';
        else if (name === 'uPrev') role = 'prev';
        else if (name === 'uOverlay') role = 'overlay';
        else if (!input && isTransition) role = 'from';
        samplers.push({ loc, unit: unit++, isCube: T === gl.SAMPLER_CUBE, input, role, name });
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(params, name)) {
        const s = this.paramSetter(params[name], T, loc);
        if (s) { setters.push(s); continue; }
      }
      const s = this.uniformSetter(name, T, loc, info.size);
      if (s) setters.push(s);
    }
    return { pass, program, setters, samplers };
  }

  paramSetter(v, T, loc) {
    const gl = this.gl;
    const a = Array.isArray(v) ? v : [typeof v === 'boolean' ? (v ? 1 : 0) : v];
    switch (T) {
      case gl.FLOAT: return () => gl.uniform1f(loc, a[0]);
      case gl.FLOAT_VEC2: return () => gl.uniform2f(loc, a[0], a[1] ?? 0);
      case gl.FLOAT_VEC3: return () => gl.uniform3f(loc, a[0], a[1] ?? 0, a[2] ?? 0);
      case gl.FLOAT_VEC4: return () => gl.uniform4f(loc, a[0], a[1] ?? 0, a[2] ?? 0, a[3] ?? 0);
      case gl.INT: case gl.BOOL: return () => gl.uniform1i(loc, a[0] | 0);
      default: return null;
    }
  }

  uniformSetter(name, T, loc, size) {
    const gl = this.gl;
    const put = (v) => {
      if (T === gl.FLOAT) gl.uniform1f(loc, v[0]);
      else if (T === gl.FLOAT_VEC2) gl.uniform2f(loc, v[0], v[1] ?? 0);
      else if (T === gl.FLOAT_VEC3) gl.uniform3f(loc, v[0], v[1] ?? 0, v[2] ?? 1);
      else if (T === gl.FLOAT_VEC4) gl.uniform4f(loc, v[0], v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
      else if (T === gl.INT || T === gl.BOOL) gl.uniform1i(loc, v[0] | 0);
    };
    switch (name) {
      case 'iTime': case 'time': case 'iGlobalTime': return (s) => put([s.time]);
      case 'iTimeDelta': return (s) => put([s.dt]);
      case 'iFrameRate': return (s) => put([s.dt > 0 ? 1 / s.dt : 60]);
      case 'iFrame': return (s) => put([s.frame]);
      case 'iResolution': case 'resolution': case 'v2Resolution': return (s) => put([s.w, s.h, 1]);
      case 'iMouse': case 'mouse': return (s) => put(s.mouse || [0, 0, 0, 0]);
      case 'iDate': case 'date': return (s) => put(s.date);
      case 'iSampleRate': return (s) => put([s.sampleRate]);
      case 'progress': case 'iProgress': return (s) => put([s.progress || 0]);
      case 'ratio': return (s) => put([s.w / s.h]);
      case 'iChannelTime': return (s) => gl.uniform1fv(loc, new Float32Array(size).fill(s.time));
      case 'iChannelResolution': return (s) => {
        const a = new Float32Array(size * 3);
        for (let k = 0; k < size; k++) a.set([s.w, s.h, 1], k * 3);
        gl.uniform3fv(loc, a);
      };
      default:
        // Anything else is looked up in the per-draw extras (our own fx/transition uniforms).
        return (s) => { const v = s.extra && s.extra[name]; if (v !== undefined) put(Array.isArray(v) ? v : [v]); };
    }
  }

  // ---------------------------------------------------------- assets
  loadAsset(input, baseUrl) {
    const key = `${input.type}:${input.ref}:${input.sampler.filter}:${input.sampler.wrap}:${input.sampler.vflip}`;
    let p = this.assetCache.get(key);
    if (!p) {
      p = input.type === 'cubemap' ? this.loadCube(input, baseUrl) : this.loadTexture(input, baseUrl);
      p.catch(() => this.assetCache.delete(key));
      this.assetCache.set(key, p);
    }
    return p;
  }
  async bitmap(url, flip) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return createImageBitmap(await r.blob(), { imageOrientation: flip ? 'flipY' : 'from-image' });
  }
  async loadTexture(input, baseUrl) {
    const gl = this.gl;
    const bmp = await this.bitmap(`${baseUrl}/${input.src}`, input.sampler.vflip);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    bmp.close();
    const wrap = input.sampler.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (input.sampler.filter === 'mipmap') { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, input.sampler.filter === 'nearest' ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, input.sampler.filter === 'nearest' ? gl.NEAREST : gl.LINEAR);
    return tex;
  }
  async loadCube(input, baseUrl) {
    const gl = this.gl;
    const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
    const bmps = await Promise.all(faces.map(f => this.bitmap(`${baseUrl}/${input.src}/${f}.jpg`, input.sampler.vflip)));
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
    bmps.forEach((b, i) => { gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, b); b.close(); });
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  // ---------------------------------------------------------- feedback buffers
  ensureBuffers(inst, w, h) {
    if (inst.bw === w && inst.bh === h && inst.buffers.size) return;
    this.freeBuffers(inst);
    const gl = this.gl;
    for (const cp of inst.passes) {
      if (cp.pass.type !== 'buffer' || !cp.pass.id) continue;
      const a = this.target(w, h, true), b = this.target(w, h, true);
      for (const t of [a, b]) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      inst.buffers.set(cp.pass.id, { t: [a, b], read: 0 });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    inst.bw = w; inst.bh = h;
  }
  freeBuffers(inst) {
    inst.buffers.forEach(pp => pp.t.forEach(t => this.freeTarget(t)));
    inst.buffers.clear(); inst.bw = inst.bh = 0;
  }
  // A fresh showing: clean feedback, frame counter at zero.
  reset(inst) {
    const gl = this.gl;
    inst.frame = 0;
    inst.buffers.forEach(pp => pp.t.forEach(t => { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  destroy(inst) {
    inst.passes.forEach(p => this.gl.deleteProgram(p.program));
    this.freeBuffers(inst);
  }

  // ---------------------------------------------------------- draw
  // s: { time, dt, w, h, date, sampleRate, progress, from, to, prev, overlay, extra }
  render(inst, out, s) {
    const gl = this.gl;
    const w = out.w, h = out.h;
    this.ensureBuffers(inst, w, h);
    s.w = w; s.h = h; s.frame = inst.frame;
    gl.bindVertexArray(this.vao);
    for (const cp of inst.passes) {
      const pp = cp.pass.type === 'buffer' && cp.pass.id ? inst.buffers.get(cp.pass.id) : null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, pp ? pp.t[1 - pp.read].fbo : out.fbo);
      gl.viewport(0, 0, w, h);
      gl.useProgram(cp.program);
      for (const st of cp.setters) st(s);
      for (const sb of cp.samplers) {
        gl.activeTexture(gl.TEXTURE0 + sb.unit);
        gl.bindTexture(sb.isCube ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D, this.texFor(sb, inst, s));
        gl.uniform1i(sb.loc, sb.unit);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (pp) pp.read = 1 - pp.read;
    }
    // unbind everything we sampled, so a texture we just read can be a render target next pass
    for (let u = 0; u < 8; u++) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.activeTexture(gl.TEXTURE0);
    inst.frame++;
  }

  texFor(sb, inst, s) {
    const fb = sb.isCube ? this.blackCube : this.black2D;
    if (s.tex && s.tex[sb.name]) return s.tex[sb.name];        // named extras (uPrev, uOverlay, uEff)
    switch (sb.role) {
      case 'from': return (s.from && s.from.tex) || fb;
      case 'to': return (s.to && s.to.tex) || fb;
      case 'audio': return this.audioTex;
      case 'audioST': return this.audioTexST;
      case 'prev': return (s.prev && s.prev.tex) || fb;
      case 'overlay': return s.overlay || fb;
    }
    const i = sb.input;
    if (!i) return fb;
    switch (i.type) {
      case 'music': case 'mic': return sb.isCube ? fb : this.audioTex;
      case 'frame': return (s.from && s.from.tex) || fb;
      case 'buffer': { const pp = inst.buffers.get(i.ref); return pp && !sb.isCube ? pp.t[pp.read].tex : fb; }
      case 'texture': case 'cubemap': return (i.ref && inst.assets.get(i.ref)) || fb;
      default: return fb;
    }
  }
}
