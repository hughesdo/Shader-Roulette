// Packs SuperTool's single-file effect shaders into vendor/supertool-effects.json.
//   node tools/pack_effects.mjs <path to SuperTool checkout>
// Skips effects that need extra textures/videos (channels) or text uniforms, and the folder-based
// multi-buffer ones. File headers (authors, sources, licences) are kept as they are.
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) { console.error('usage: node tools/pack_effects.mjs <SuperTool checkout>'); process.exit(1); }
const root = path.join(src, 'public/shaders');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'metadata.json'), 'utf8'));
const out = [], skipped = [];
for (const e of meta.effects || []) {
  const why = !e.file ? 'folder effect' : e.channels ? 'needs extra textures' :
    Object.values(e.uniforms || {}).some(u => u.type === 'text') ? 'text uniform' : null;
  if (why) { skipped.push(`${e.id} (${why})`); continue; }
  const code = fs.readFileSync(path.join(root, e.file), 'utf8');
  const params = {};
  for (const [k, u] of Object.entries(e.uniforms || {})) {
    if (u.default === undefined) continue;
    params[k] = typeof u.default === 'boolean' ? (u.default ? 1 : 0) : u.default;
  }
  out.push({ id: 'st-' + e.id, name: e.name, audio: !!e.audioReactive, tags: e.tags || [], params, code });
}
const dst = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'vendor', 'supertool-effects.json');
fs.writeFileSync(dst, JSON.stringify({ source: 'github.com/hughesdo/SuperTool public/shaders/effects', effects: out }));
console.log(`packed ${out.length} effects, skipped ${skipped.length}: ${skipped.join(', ')}`);
