import asyncio, json, base64, io
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
JS = r"""async (ids) => {
  const S = window.__roulette, C = S.comp, gl = C.gl, rt = C.rt; const w = 256, h = 144;
  const base = S.scenes.find(e => e.id === 'N3tSzH') || S.scenes[0];
  await C.load(base, S.lib);
  const inA = C.target('tA', w, h), out = C.target('tO', w, h);
  const inst = C.insts.get(base.id); rt.reset(inst);
  rt.uploadAudio(MusicTexture.synthetic(0.8, 3)); rt.render(inst, inA, { time: 20, dt: 1/30, date: [2026,9,22,0], sampleRate: 44100, extra: {} });
  const read = (t) => { const px = new Uint8Array(w*h*4); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return Array.from(px); };
  const outs = [{ id: 'input', px: read(inA) }];
  for (const id of ids) {
    const e = S.effects.find(x => x.id === id); if (!e) continue;
    await C.load(e, S.lib); const ei = C.insts.get(id); rt.reset(ei);
    for (let f = 0; f < 4; f++) { rt.uploadAudio(MusicTexture.synthetic(0.55 + 0.35 * (f & 1), 6 + f/30)); rt.render(ei, out, { from: inA, time: 6 + f/30, dt: 1/30, date: [2026,9,22,0], sampleRate: 44100, progress: 0, extra: {} }); }
    outs.push({ id, px: read(out) });
  }
  return { w, h, outs };
}"""
async def main():
    r = json.load(open('out/effects.json'))
    ids = [x['id'] for x in sorted(r['res'], key=lambda x: x.get('dep', 0))]
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EXE, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page()
        await pg.goto('http://localhost:8765/')
        await pg.wait_for_function("window.__roulette && window.__roulette.effects.length > 0 && document.querySelector('#libline').textContent.includes('shaders')", timeout=60000)
        res = await pg.evaluate(JS, ids)
        await b.close()
    w, h = res['w'], res['h']
    tiles = []
    for o in res['outs']:
        im = Image.frombytes('RGBA', (w, h), bytes(o['px'])).transpose(Image.FLIP_TOP_BOTTOM).convert('RGB')
        d = ImageDraw.Draw(im); d.rectangle((0, h - 14, w, h), fill=(0, 0, 0)); d.text((3, h - 13), o['id'].replace('st-', ''), fill=(255, 255, 255))
        tiles.append(im)
    cols = 6
    for k in range(0, len(tiles), 30):
        part = tiles[k:k + 30]; rows = (len(part) + cols - 1) // cols
        sheet = Image.new('RGB', (cols * w, rows * h))
        for i, im in enumerate(part): sheet.paste(im, ((i % cols) * w, (i // cols) * h))
        sheet.save(f'out/effects-{k // 30}.jpg', quality=82)
        print('sheet', k // 30, sheet.size)
asyncio.run(main())
