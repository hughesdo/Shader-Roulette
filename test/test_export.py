import asyncio, base64, json, time
from playwright.async_api import async_playwright
EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EXE, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1360, 'height': 1000})
        logs = []
        pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        await pg.add_init_script("localStorage.setItem('roulette.out', JSON.stringify({res:'1280x720', fps:24, mbps:4, preview:0.25})); localStorage.setItem('roulette.cfg', JSON.stringify({style:'chaos', credits:true, remix:1, hits:1}));")
        await pg.goto('http://localhost:8765/')
        await pg.wait_for_function("window.__roulette && document.querySelector('#libline').textContent.includes('shaders')", timeout=60000)
        await pg.set_input_files('#songFile', 'short.wav')
        await pg.wait_for_function("window.__roulette && window.__roulette.plan && document.querySelector('#drop').hidden", timeout=600000, polling=1000)
        # small output for the test
        await pg.evaluate("() => { player.pause(); RES['320x180'] = [320, 180]; window.__roulette.out.res = '320x180'; }")
        t0 = time.time()
        await pg.evaluate("exportFramePerfect()")
        await pg.wait_for_function("window.__roulette.lastBlob && !window.__roulette.exporting", timeout=900000, polling=2000)
        print('export took', round(time.time() - t0, 1), 's')
        info = await pg.evaluate("() => ({ info: document.querySelector('#saveInfo').textContent, chips: [...document.querySelectorAll('#saveChips .pill')].map(x => x.textContent), status: document.querySelector('#status').textContent })")
        print(info)
        b64 = await pg.evaluate("""async () => { const b = new Uint8Array(await window.__roulette.lastBlob.arrayBuffer()); let s=''; for (let i=0;i<b.length;i+=8192) s += String.fromCharCode.apply(null, b.subarray(i,i+8192)); return btoa(s); }""")
        open('out/export.mp4', 'wb').write(base64.b64decode(b64))
        print('\n'.join(l for l in logs if 'error' in l.lower() or 'PAGEERROR' in l)[:2000])
        await b.close()
asyncio.run(main())
