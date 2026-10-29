import asyncio, json, sys
from playwright.async_api import async_playwright
EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
JS = r"""async () => {
  const S = window.__roulette, C = S.comp, gl = C.gl, rt = C.rt;
  const w = 192, h = 108;
  const silk = S.scenes.find(e => e.id === 'builtin-silk-ribbons');
  await C.load(silk, S.lib);
  const inA = C.target('tA', w, h), inB = C.target('tB', w, h), out = C.target('tO', w, h);
  const loud = MusicTexture.synthetic(0.9, 3.0);
  rt.uploadAudio(loud);
  const inst = C.insts.get(silk.id);
  rt.reset(inst); rt.render(inst, inA, { time: 7, dt: 1/30, date: [2026,9,22,0], sampleRate: 44100, extra: {} });
  rt.render(C.sys.look, inB, { from: inA, time: 0, dt: 1/30, extra: { uT: 0, uLens: 4, uLensP: [2,0,0,0], uGrade: [0.5, 1.3, 1.2, 0.45], uTint: [0,0,0,0], uPoster: 0, uBass: 0, uKick: 0 } });
  const read = (t) => { const px = new Uint8Array(w*h*4); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return px; };
  const pa = read(inA), pb = read(inB);
  const diff = (x, y) => { let s = 0; for (let i = 0; i < x.length; i += 4) s += Math.abs(x[i]-y[i]) + Math.abs(x[i+1]-y[i+1]) + Math.abs(x[i+2]-y[i+2]); return s / (x.length/4) / 765; };
  const lum = (x) => { let s = 0; for (let i = 0; i < x.length; i += 4) s += 0.299*x[i] + 0.587*x[i+1] + 0.114*x[i+2]; return s / (x.length/4) / 255; };
  const inDiff = diff(pa, pb), inY = lum(pa);
  const res = [];
  for (const e of S.effects) {
    const r = { id: e.id, name: e.name };
    try { await C.load(e, S.lib); } catch (err) { r.fail = String(err.log || err.message).slice(0, 240); res.push(r); continue; }
    const ei = C.insts.get(e.id);
    const run = (src, t) => { rt.reset(ei); for (let f = 0; f < 3; f++) { rt.uploadAudio(MusicTexture.synthetic(0.9, t + f/30)); rt.render(ei, out, { from: src, time: t + f/30, dt: 1/30, date: [2026,9,22,0], sampleRate: 44100, progress: 0, extra: {} }); } return read(out); };
    const oa = run(inA, 5), ob = run(inB, 5), oa2 = run(inA, 9.3);
    r.dep = +(diff(oa, ob) / inDiff).toFixed(3);       // ~1 = follows the frame below, ~0 = ignores it
    r.change = +diff(oa, pa).toFixed(3);               // how far it moves the picture
    r.y = +(lum(oa) / inY).toFixed(2);                 // brightness ratio
    r.anim = +diff(oa, oa2).toFixed(3);                // changes over time
    r.err = gl.getError();
    res.push(r);
  }
  return { inDiff, inY, res };
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EXE, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page()
        logs = []
        pg.on('pageerror', lambda e: logs.append(str(e)))
        await pg.goto('http://localhost:8765/')
        await pg.wait_for_function("window.__roulette && window.__roulette.effects.length > 0 && document.querySelector('#libline').textContent.includes('shaders')", timeout=60000)
        r = await pg.evaluate(JS)
        json.dump(r, open('out/effects.json', 'w'), indent=1)
        print('inDiff', r['inDiff'], 'inY', r['inY'])
        for x in sorted(r['res'], key=lambda x: x.get('dep', -1)):
            print(x['id'].ljust(40), 'FAIL ' + x['fail'][:120] if 'fail' in x else f"dep {x['dep']:<6} change {x['change']:<6} y {x['y']:<5} anim {x['anim']:<6} err {x['err']}")
        print(logs)
        await b.close()
asyncio.run(main())
