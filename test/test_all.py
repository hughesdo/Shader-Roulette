import asyncio, json, base64
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
JS_COMPILE = r"""async () => {
  const S = window.__roulette, C = S.comp;
  const all = S.scenes.concat(S.trans);
  const t0 = performance.now();
  await compileMany(all);
  const failed = all.filter(e => !C.insts.has(e.id)).map(e => [e.id, (C.failed.get(e.id) || '').slice(0, 300)]);
  const probes = [];
  for (const e of S.scenes) if (C.insts.has(e.id)) { const p = C.probe(e.id); probes.push([e.id, +p.Y.toFixed(3), +p.M.toFixed(3), +p.I.toFixed(2), p.black]); }
  return { n: all.length, ms: performance.now() - t0, failed, probes, glErr: C.gl.getError() };
}"""
JS_TRANS = r"""async () => {
  const S = window.__roulette, C = S.comp, gl = C.gl, rt = C.rt, w = 224, h = 126;
  const A = C.insts.get('N3tSzH') || C.insts.get(S.scenes[0].id), B = C.insts.get('moltenheart') || C.insts.get(S.scenes[1].id);
  const ta = C.target('ta', w, h), tb = C.target('tb', w, h), out = C.target('to', w, h);
  rt.uploadAudio(MusicTexture.synthetic(0.8, 2));
  rt.reset(A); rt.render(A, ta, { time: 20, dt: 1/30, date: [2026,9,22,0], sampleRate: 44100, extra: {} });
  rt.reset(B); rt.render(B, tb, { time: 9, dt: 1/30, date: [2026,9,22,0], sampleRate: 44100, extra: {} });
  const res = [];
  for (const e of S.trans) {
    const ti = C.insts.get(e.id); if (!ti) continue;
    const row = [];
    for (const p of [0.02, 0.35, 0.65, 0.98]) {
      rt.render(ti, out, { from: ta, to: tb, progress: p, time: 1, dt: 1/30, extra: { uBass: 0.6, uKick: 0.5, uSeed: 0.42, uDir: [0.7, 0.7] } });
      const px = new Uint8Array(w*h*4); gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      let bin=''; for (let i=0;i<px.length;i+=8192) bin += String.fromCharCode.apply(null, px.subarray(i, i+8192)); row.push(btoa(bin));
    }
    res.push({ id: e.id, rows: row });
  }
  return { w, h, res };
}"""
JS_ROLLS = r"""async () => {
  const S = window.__roulette; const out = [];
  const styles = ['', '', '', 'pulse', 'drift', 'story', 'chaos', 'cinema', 'mirror', '', '', ''];
  for (const st of styles) {
    S.cfg.style = st;
    const t0 = performance.now();
    await roll(true);
    player.pause();
    const P = S.plan;
    let glErr = 0;
    for (const t of [3, 20, 35, 47, 61, 79]) { renderAt(t, 320, 180, 1/30, 30, 1); glErr = glErr || S.comp.gl.getError(); }
    out.push({ want: st || 'auto', style: P.styleKey, code: P.code, ms: Math.round(performance.now() - t0), shots: P.shots.length, shaders: P.used.length,
      trans: P.trans.filter(t => t.id).length, cuts: P.trans.filter(t => !t.id).length, effects: P.effects.windows.length, duets: P.shots.filter(s => s.partner).length,
      lenses: P.shots.filter(s => s.look.lens).length, glErr, firstFour: P.used.slice(0, 4) });
  }
  S.cfg.style = '';
  return out;
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EXE, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1360, 'height': 1400})
        logs = []
        pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error',) else None)
        await pg.add_init_script("localStorage.setItem('roulette.out', JSON.stringify({res:'1280x720', fps:30, mbps:8, preview:0.25}));")
        await pg.goto('http://localhost:8765/')
        await pg.wait_for_function("window.__roulette && document.querySelector('#libline').textContent.includes('shaders')", timeout=60000)
        r = await pg.evaluate(JS_COMPILE)
        print('compiled', r['n'], f"in {r['ms']/1000:.1f}s", 'glErr', r['glErr'])
        print('FAILED:', json.dumps(r['failed'], indent=1))
        print('dim/black probes:', [x for x in r['probes'] if x[1] < 0.05])
        t = await pg.evaluate(JS_TRANS)
        w, h = t['w'], t['h']
        sheet = Image.new('RGB', (4 * w, len(t['res']) * h))
        for i, tr in enumerate(t['res']):
            for j, px in enumerate(tr['rows']):
                im = Image.frombytes('RGBA', (w, h), base64.b64decode(px)).transpose(Image.FLIP_TOP_BOTTOM).convert('RGB')
                if j == 0: ImageDraw.Draw(im).text((3, 3), tr['id'], fill=(255, 255, 0))
                sheet.paste(im, (j * w, i * h))
        for k in range(0, sheet.size[1], 15 * h):
            sheet.crop((0, k, 4 * w, min(sheet.size[1], k + 15 * h))).save(f'out/trans-{k // (15 * h)}.jpg', quality=80)
        print('transition sheets written', len(t['res']))
        await pg.set_input_files('#songFile', 'song.wav')
        await pg.wait_for_function("window.__roulette && window.__roulette.plan && document.querySelector('#drop').hidden", timeout=600000, polling=1000)
        rolls = await pg.evaluate(JS_ROLLS)
        for x in rolls: print(json.dumps(x))
        await pg.screenshot(path='out/03-after-rolls.png', timeout=240000, full_page=True)
        print('\n'.join(logs[:40]))
        await b.close()
asyncio.run(main())
