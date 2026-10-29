// Inline the app, its vendored libraries and the SuperTool effects into one self-contained HTML file.
//   node build.mjs            -> dist/shader-roulette.html (+ index.html copy for GitHub Pages)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const root = path.dirname(new URL(import.meta.url).pathname);
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const order = ['runtime', 'builtins', 'analysis', 'audio', 'codecs', 'director', 'compositor', 'app'];
const app = order.map(n => `// ---- ${n}.js\n` + rd(`src/js/${n}.js`)).join('\n\n');
let muxer = rd('vendor/mp4-muxer.min.js');
muxer = '/*! mp4-muxer 5.2.2 | MIT License | github.com/Vanilagy/mp4-muxer */\n' + muxer.replace('if (typeof module === "object" && typeof module.exports === "object") Object.assign(module.exports, Mp4Muxer)', '');
const aac = rd('vendor/aac-wasm.js');
const fxJson = fs.readFileSync(path.join(root, 'vendor/supertool-effects.json'));
const fxB64 = zlib.gzipSync(fxJson, { level: 9 }).toString('base64');
let html = rd('src/template.html')
  .replace('/*MUXER*/', () => muxer)
  .replace('/*AACWASM*/', () => aac)
  .replace('/*EFFECTS*/', () => `/* SuperTool effects (github.com/hughesdo/SuperTool, public/shaders/effects), gzip + base64. Each file keeps its own header and credits. */\nconst ST_EFFECTS_GZ = "${fxB64}";`)
  .replace('/*APP*/', () => app);
const page = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${html.replace(/^<title>/, '<title>')}\n</html>\n`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/shader-roulette.html'), page);
fs.writeFileSync(path.join(root, 'dist/app.js'), app);   // for syntax checks
console.log('built', (page.length / 1024).toFixed(0) + ' KB', `(effects ${(fxB64.length / 1024).toFixed(0)} KB)`);
