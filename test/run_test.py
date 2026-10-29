import asyncio, json, sys, base64, time
from playwright.async_api import async_playwright
EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/'
OUT = 'out'
import os; os.makedirs(OUT, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EXE, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1360, 'height': 980})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.add_init_script("""localStorage.setItem('roulette.out', JSON.stringify({res:'1280x720', fps:30, mbps:8, preview:0.25}));""")
        t0 = time.time()
        await pg.goto(URL)
        await pg.wait_for_function("document.querySelector('#libline').textContent.includes('shaders') || document.querySelector('#libline').dataset.kind==='error'", timeout=60000)
        print('library:', await pg.text_content('#libline'), f'{time.time()-t0:.1f}s')
        await pg.screenshot(path=f'{OUT}/01-empty.png')
        await pg.set_input_files('#songFile', 'song.wav')
        try:
            await pg.wait_for_function("window.__roulette && window.__roulette.plan && document.querySelector('#drop').hidden", timeout=900000, polling=1000)
        except Exception as e:
            print('TIMEOUT waiting for plan', await pg.text_content('#busy'))
        print('rolled in', f'{time.time()-t0:.1f}s')
        info = await pg.evaluate("""() => { const S = window.__roulette; const P = S.plan; player.pause();
          return { style: P.styleKey, code: P.code, bpm: S.A.bpm, dur: S.A.duration, secs: P.secs.map(s => [s.kind, +s.start.toFixed(1), +s.end.toFixed(1), s.label]),
            shots: P.shots.length, used: P.used, trans: P.trans.map(t => t.id || (t.impact ? 'IMPACT' : t.stutter ? 'stutter' : 'cut')),
            effects: P.effects.windows.map(w => [w.id, +w.t.toFixed(1), +w.dur.toFixed(1)]), duets: P.shots.filter(s => s.partner).length,
            lenses: P.shots.map(s => s.look.lens).filter(x => x), times: P.shots.map(s => s.time.mode),
            failed: [...S.comp.failed.entries()].map(([k, v]) => [k, v.slice(0, 300)]), black: [...S.blacklist],
            probes: S.scenes.filter(e => e.probe).map(e => [e.id, +e.probe.Y.toFixed(3), +e.probe.M.toFixed(3), +e.probe.I.toFixed(2)]) }; }""")
        print(json.dumps(info, indent=1))
        await pg.screenshot(path=f'{OUT}/02-rolled.png', timeout=240000)
        # frames across the song
        times = [1, 8, 16, 26, 31, 33, 40, 45, 50, 57, 61, 66, 72, 80]
        for t in times:
            url = await pg.evaluate(f"""() => {{ const S = window.__roulette; renderAt({t}, 640, 360, 1/30, 30, 1); return S.comp.canvas.toDataURL('image/jpeg', 0.85); }}""")
            open(f'{OUT}/frame-{t:03d}.jpg', 'wb').write(base64.b64decode(url.split(',')[1]))
        errs = [l for l in logs if 'error' in l.lower() or 'warn' in l.lower()]
        print('\n'.join(errs[:60]))
        print('log lines', len(logs))
        await b.close()
asyncio.run(main())
