// ============================================================ export codecs
// Goal: every frame-perfect render is an MP4 that X (and everything else) takes as is:
// H.264 video plus AAC-LC audio at 44.1 or 48 kHz, mono or stereo, moov atom up front.

// Chrome's Windows AAC encoder only accepts 96, 128, 160 or 192 kbps and rejects anything else,
// so stay on that list. X recommends at least 128 kbps.
function audioBitrate(ch) { return ch === 1 ? 128000 : 192000; }

// H.264 level limits: [level_idc, max frame size in macroblocks, max macroblocks per second, High-profile max kbps]
const AVC_LEVELS = [
  [0x1f, 3600, 108000, 17500],     // 3.1
  [0x20, 5120, 216000, 25000],     // 3.2
  [0x28, 8192, 245760, 25000],     // 4.0
  [0x29, 8192, 245760, 62500],     // 4.1
  [0x2a, 8704, 522240, 62500],     // 4.2
  [0x32, 22080, 589824, 168750],   // 5.0
  [0x33, 36864, 983040, 300000],   // 5.1
  [0x34, 36864, 2073600, 300000],  // 5.2
];
// Lowest level that legally covers the size, frame rate and bitrate, then the ones above it.
// (1080p60 needs 4.2; tagging it 4.0 is out of spec and some encoders refuse it.)
function avcLevelsFor(w, h, fps, bitrate) {
  const fs = Math.ceil(w / 16) * Math.ceil(h / 16), mbps = fs * fps, kbps = bitrate / 1000;
  let i = AVC_LEVELS.findIndex(([, maxFs, maxMbps, maxKbps]) => fs <= maxFs && mbps <= maxMbps && kbps <= maxKbps);
  if (i < 0) i = AVC_LEVELS.length - 1;
  return AVC_LEVELS.slice(i).map(l => l[0].toString(16).padStart(2, '0'));
}

async function pickVideoEncoder(w, h, fps, bitrate) {
  if (typeof VideoEncoder === 'undefined' || typeof Mp4Muxer === 'undefined') return null;
  const levels = avcLevelsFor(w, h, fps, bitrate).slice(0, 3);
  for (const profile of ['6400', '4d00', '4200']) {          // High, Main, Baseline
    for (const lv of levels) {
      const cfg = { codec: `avc1.${profile}${lv}`, width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } };
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return { cfg, muxCodec: 'avc', label: 'H.264' }; } catch (e) {}
    }
  }
  for (const codec of ['vp09.00.40.08', 'vp09.00.10.08']) {  // last resort: plays in VLC and browsers, not on X
    const cfg = { codec, width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality' };
    try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return { cfg, muxCodec: 'vp9', label: 'VP9' }; } catch (e) {}
  }
  return null;
}

// ------------------------------------------------------------ audio
// The decoded song runs at the sound card's rate (often 96 or 192 kHz on audio interfaces) and can
// have more than two channels. AAC encoders only take 44.1 or 48 kHz and X rejects 5.1, so normalize.
async function resample(buf, sr, ch) {
  const oc = new OfflineAudioContext(ch, Math.ceil(buf.duration * sr), sr);
  const s = oc.createBufferSource(); s.buffer = buf; s.connect(oc.destination); s.start();
  return await oc.startRendering();
}
async function exportAudioBuffer(buf) {
  const sr = (buf.sampleRate === 44100 || buf.sampleRate === 48000) ? buf.sampleRate : 48000;
  const ch = Math.min(2, buf.numberOfChannels);
  return (sr === buf.sampleRate && ch === buf.numberOfChannels) ? buf : await resample(buf, sr, ch);
}

async function nativeAudioConfig(codec, sr, ch) {
  if (typeof AudioEncoder === 'undefined') return null;
  const cfg = { codec, sampleRate: sr, numberOfChannels: ch, bitrate: audioBitrate(ch) };
  try { const r = await AudioEncoder.isConfigSupported(cfg); return r.supported ? cfg : null; } catch (e) { return null; }
}

// Bundled FFmpeg AAC-LC encoder (vendor/aac-wasm.js), loaded only when the browser has no AAC
// encoder of its own: Chrome on Linux, Firefox, some Windows N editions.
let aacWasm = null;
function loadAacWasm() {
  if (typeof createAacWasmModule !== 'function' || typeof WebAssembly !== 'object') return Promise.resolve(null);
  if (!aacWasm) {
    aacWasm = createAacWasmModule({}).then((m) => {
      const fn = (name, ret, args) => m.cwrap(name, ret, args);
      const W = {
        m,
        init: fn('init_encoder', 'number', ['number', 'number', 'number']),
        frameSize: fn('get_encoder_frame_size', 'number', ['number']),
        asc: fn('get_encoder_extradata', 'number', ['number']),
        ascSize: fn('get_encoder_extradata_size', 'number', ['number']),
        inputPtr: fn('get_encode_input_ptr', 'number', ['number', 'number']),
        send: fn('send_frame', 'number', ['number', 'number']),
        receive: fn('receive_packet', 'number', ['number']),
        data: fn('get_encoded_data', 'number', ['number']),
        flush: fn('flush_encoder_start', null, ['number']),
        close: fn('close_encoder', null, ['number']),
      };
      const t = W.init(2, 48000, 192000);                    // make sure it really runs here
      if (!t) throw new Error('AAC encoder failed its self-test');
      W.close(t);
      return W;
    }).catch((e) => { console.warn('Built-in AAC encoder unavailable:', e); return null; });
  }
  return aacWasm;
}

// Which AAC encoder this browser will use: 'native', 'wasm', or null (then Opus, or nothing).
async function pickAudioPath(sr, ch) {
  const aac = await nativeAudioConfig('mp4a.40.2', sr, ch);
  if (aac) return { kind: 'native', mux: 'aac', cfg: aac };
  if (await loadAacWasm()) return { kind: 'wasm', mux: 'aac' };
  const opus = await nativeAudioConfig('opus', sr, ch);
  if (opus) return { kind: 'native', mux: 'opus', cfg: opus };
  return null;
}

const yieldToUI = () => new Promise(r => setTimeout(r, 0));
const cancelError = () => { const e = new Error('cancelled'); e.cancelled = true; return e; };

// Both encoders return the same thing: [{ d: Uint8Array, t: µs, dur: µs, meta }] for addAudioChunkRaw.
async function encodeAudioNative(buf, cfg, onProgress, isCancelled) {
  const out = []; let err = null;
  const frameUs = cfg.codec === 'opus' ? 20000 : Math.round(1024e6 / cfg.sampleRate);
  const ae = new AudioEncoder({
    output: (c, meta) => {
      const d = new Uint8Array(c.byteLength); c.copyTo(d);
      out.push({ d, t: Math.max(0, c.timestamp), dur: c.duration || frameUs, meta: meta && meta.decoderConfig ? meta : undefined });
    },
    error: (e) => { err = e; },
  });
  ae.configure(cfg);
  const CH = buf.numberOfChannels, SR = buf.sampleRate, N = 4096;
  const chans = []; for (let c = 0; c < CH; c++) chans.push(buf.getChannelData(c));
  for (let i = 0, k = 0; i < buf.length && !err; i += N, k++) {
    if (isCancelled()) { try { ae.close(); } catch (e) {} throw cancelError(); }
    const n = Math.min(N, buf.length - i);
    const data = new Float32Array(n * CH);
    for (let c = 0; c < CH; c++) data.set(chans[c].subarray(i, i + n), c * n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: CH, timestamp: Math.round(i / SR * 1e6), data });
    ae.encode(ad); ad.close();
    if (ae.encodeQueueSize > 32 || k % 64 === 0) { onProgress(i / buf.length); await yieldToUI(); }
  }
  if (!err) await ae.flush();
  try { ae.close(); } catch (e) {}
  if (err) throw err;
  if (!out.length) throw new Error('the audio encoder returned nothing');
  return out;
}

async function encodeAacWasm(buf, onProgress, isCancelled) {
  const W = await loadAacWasm();
  if (!W) throw new Error('the built-in AAC encoder could not start');
  const CH = buf.numberOfChannels, SR = buf.sampleRate;
  const ctx = W.init(CH, SR, audioBitrate(CH));
  if (!ctx) throw new Error('the built-in AAC encoder could not start');
  try {
    const m = W.m, N = W.frameSize(ctx);
    const ap = W.asc(ctx), description = m.HEAPU8.slice(ap, ap + W.ascSize(ctx));
    const meta = { decoderConfig: { codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: CH, description } };
    const chans = []; for (let c = 0; c < CH; c++) chans.push(buf.getChannelData(c));
    const inter = new Float32Array(N * CH), packets = [];
    const drain = () => {
      let size;
      while ((size = W.receive(ctx)) > 0) { const p = W.data(ctx); packets.push(m.HEAPU8.slice(p, p + size)); }
      if (size < 0) throw new Error(`AAC encoder error ${size}`);
    };
    for (let i = 0, k = 0; i < buf.length; i += N, k++) {
      if (isCancelled()) throw cancelError();
      const n = Math.min(N, buf.length - i);
      if (n < N) inter.fill(0);                              // pad the last frame with silence
      for (let c = 0; c < CH; c++) { const src = chans[c]; for (let j = 0; j < n; j++) inter[j * CH + c] = src[i + j]; }
      const ptr = W.inputPtr(ctx, inter.byteLength);
      if (!ptr) throw new Error('AAC encoder ran out of memory');
      new Float32Array(m.HEAPU8.buffer, ptr, inter.length).set(inter);   // re-read HEAPU8: memory can grow
      const r = W.send(ctx, BigInt(i));
      if (r < 0) throw new Error(`AAC encoder error ${r}`);
      drain();
      if (k % 256 === 0) { onProgress(i / buf.length); await yieldToUI(); }
    }
    W.flush(ctx); drain();
    // Timestamps from zero, one AAC frame apart. The first frame carries the encoder's 1024-sample
    // priming, which puts the sound about 21 ms behind the picture, same as the browsers' own encoders.
    const dur = Math.round(N * 1e6 / SR);
    return packets.map((d, k) => ({ d, t: Math.round(k * N * 1e6 / SR), dur, meta: k === 0 ? meta : undefined }));
  } finally {
    W.close(ctx);
  }
}

// ------------------------------------------------------------ what this browser will write
// Shown on the Export card before anyone sits through a render.
async function probeExport(w, h, fps, bitrate) {
  const v = await pickVideoEncoder(w, h, fps, bitrate);
  const a = await pickAudioPath(48000, 2);
  return {
    video: v ? v.label : null,
    audio: a ? (a.mux === 'aac' ? 'AAC' : 'Opus') : null,
    audioKind: a ? a.kind : null,
  };
}

// X's posting rules for a finished (or planned) file. Limits as of October 2026.
const X_FREE = { seconds: 140, bytes: 512 * 1048576 };
function xVerdict(info) {
  if (info.container !== 'mp4') return { level: 'bad', text: 'Not X-ready: WebM', tip: 'X doesn’t accept WebM files. Use Render MP4 in Chrome or Edge, or convert the file before posting.' };
  if (info.unknown) return { level: 'warn', text: 'Codecs unknown', tip: 'The browser didn’t say which codecs it used for this recording. Render MP4 is the safe choice for posting to X.' };
  if (info.video !== 'H.264') return { level: 'bad', text: `Not X-ready: ${info.video} video`, tip: 'X wants H.264 video. This browser can’t encode H.264. Render in Chrome or Edge on Windows or Mac.' };
  if (!info.audio) return { level: 'bad', text: 'No audio track', tip: 'This file has no sound.' };
  if (info.audio !== 'AAC') return { level: 'bad', text: `Not X-ready: ${info.audio} audio`, tip: 'X wants AAC audio. Render in a browser that can write AAC, or convert the audio before posting.' };
  if (info.realtime) return { level: 'warn', text: 'Render MP4 is safer for X', tip: 'Real-time recordings are saved as fragmented MP4 with a variable frame rate, and can drop frames on a busy computer. Render MP4 writes a standard file that’s the safe choice for posting.' };
  return { level: 'ok', text: 'X-ready', tip: 'MP4 with H.264 video and AAC-LC audio, the format X recommends.' };
}
function xLimitChips(seconds, bytes) {
  const chips = [];
  if (seconds > X_FREE.seconds) chips.push({ level: 'warn', text: 'Over 2:20', tip: 'Free X accounts can post videos up to 2 minutes 20 seconds. Longer needs X Premium, or trim the video before posting. Click for details.' });
  if (bytes > X_FREE.bytes) chips.push({ level: 'warn', text: 'Over 512 MB', tip: 'Free X accounts can upload files up to 512 MB. Lower the bitrate, or post from an X Premium account (up to 16 GB). Click for details.' });
  return chips;
}
