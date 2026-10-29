import asyncio, os
from playwright.async_api import async_playwright
EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EXE, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(accept_downloads=True, viewport={'width': 1360, 'height': 1000})
        pg = await ctx.new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("localStorage.setItem('roulette.out', JSON.stringify({res:'1280x720', fps:24, mbps:2, preview:0.25}));")
        await pg.goto('http://localhost:8765/')
        await pg.wait_for_function("document.querySelector('#libline').textContent.includes('shaders')", timeout=60000)
        print('native picker present:', await pg.evaluate("typeof window.showSaveFilePicker"))
        await pg.set_input_files('#songFile', 'short.wav')
        await pg.wait_for_function("window.__roulette && window.__roulette.plan && document.querySelector('#drop').hidden", timeout=600000, polling=1000)
        await pg.evaluate("() => { player.pause(); RES['256x144'] = [256, 144]; window.__roulette.out.res = '256x144'; }")
        await pg.click('#renderBtn')
        await pg.wait_for_function("window.__roulette.lastBlob && !window.__roulette.exporting", timeout=900000, polling=2000)
        print('after render status:', await pg.text_content('#status'), '| save row hidden:', await pg.get_attribute('#saveRow', 'hidden'))
        # path 1: Save As dialog (stubbed: headless can't show native dialogs)
        await pg.evaluate("""() => { window.__written = 0; window.showSaveFilePicker = async (o) => { window.__suggested = o.suggestedName;
            return { name: o.suggestedName, createWritable: async () => ({ write: async (b) => { window.__written = b.size; }, close: async () => {} }) }; }; }""")
        await pg.click('#saveBtn')
        await pg.wait_for_timeout(500)
        print('picker path:', await pg.evaluate("[window.__suggested, window.__written, window.__roulette.lastBlob.size]"), '|', await pg.text_content('#status'))
        # path 1b: user cancels the dialog
        await pg.evaluate("() => { window.showSaveFilePicker = async () => { throw new DOMException('cancelled', 'AbortError'); }; }")
        await pg.click('#saveBtn'); await pg.wait_for_timeout(300)
        print('cancel path:', await pg.text_content('#status'))
        # path 2: no picker (Firefox, Safari): plain download
        await pg.evaluate("() => { delete window.showSaveFilePicker; window.showSaveFilePicker = undefined; }")
        async with pg.expect_download(timeout=30000) as dl:
            await pg.click('#saveBtn')
        d = await dl.value
        path = 'out/' + d.suggested_filename
        await d.save_as(path)
        print('download path:', d.suggested_filename, os.path.getsize(path), 'bytes |', await pg.text_content('#status'))
        print('errors:', errs)
        await b.close()
asyncio.run(main())
