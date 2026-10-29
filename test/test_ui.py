import asyncio
from playwright.async_api import async_playwright
EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EXE, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        for name, vp in [('desk', {'width': 1360, 'height': 900}), ('phone', {'width': 390, 'height': 844})]:
            pg = await b.new_page(viewport=vp)
            await pg.goto('http://localhost:8765/')
            await pg.wait_for_function("document.querySelector('#libline').textContent.includes('shaders')", timeout=60000)
            await pg.screenshot(path=f'out/ui-{name}-empty.png', full_page=True, timeout=120000)
            await pg.click('#settingsBtn'); await pg.wait_for_timeout(400)
            await pg.screenshot(path=f'out/ui-{name}-drawer.png', timeout=120000)
            await pg.close()
        await b.close()
asyncio.run(main())
