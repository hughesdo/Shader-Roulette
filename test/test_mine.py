import asyncio, json
from playwright.async_api import async_playwright
EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EXE, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 1360, 'height': 1000})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("localStorage.setItem('roulette.out', JSON.stringify({res:'1280x720', fps:30, mbps:8, preview:0.25})); localStorage.setItem('roulette.cfg', JSON.stringify({style:'story'}));")
        await pg.goto('http://localhost:8765/')
        await pg.wait_for_function("document.querySelector('#libline').textContent.includes('shaders')", timeout=60000)
        await pg.set_input_files('#glslFile', 'mine.glsl')
        await pg.wait_for_timeout(1500)
        print('status:', await pg.text_content('#status'), '| mine box hidden:', await pg.get_attribute('#mineBox', 'hidden'))
        await pg.set_input_files('#songFile', 'song.wav')
        await pg.wait_for_function("window.__roulette && window.__roulette.plan && document.querySelector('#drop').hidden", timeout=600000, polling=1000)
        r = await pg.evaluate("() => { const P = window.__roulette.plan; player.pause(); return { style: P.styleKey, shots: P.shots.length, used: P.used, hasMine: P.used.some(id => id.startsWith('mine-')), secs: P.secs.map(s=>s.kind+':'+s.label), seq: P.shots.filter(s=>s.stutter==null).map(s=>s.scene.slice(0,10)) }; }")
        print(json.dumps(r, indent=0))
        print('bigPlay hidden:', await pg.get_attribute('#bigPlay', 'hidden'), '| errors:', errs)
        await b.close()
asyncio.run(main())
