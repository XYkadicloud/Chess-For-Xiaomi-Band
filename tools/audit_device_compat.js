const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const pages = fs.readdirSync(path.join(src, 'pages')).filter(n => fs.existsSync(path.join(src, 'pages', n, n + '.ux')));
const errors = [], warnings = [];
function file(p) { return fs.readFileSync(path.join(src, p), 'utf8'); }
function script(text) { const m = text.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i); return m ? m[1] : ''; }
for (const page of pages) {
  const rel = `pages/${page}/${page}.ux`, text = file(rel), js = script(text);
  if (!text.match(/<template>[\s\S]*<\/template>/i)) errors.push(`${rel}: missing template`);
  if (!js) errors.push(`${rel}: missing script`);
  try { new Function(js.replace(/^\s*import[^\n]*\n/gm, '').replace(/export\s+default\s*\{/, 'return {')); }
  catch (e) { errors.push(`${rel}: script syntax: ${e.message}`); }
  if (js.includes('data:') && js.includes('protected:')) errors.push(`${rel}: data + protected VM conflict`);
  const events = [...text.matchAll(/@(click|touchstart|touchmove|touchend|swipe)="([^"]+)"/g)].map(m => m[2]);
  for (const expr of events) {
    const name = expr.split(/[ (]/)[0];
    if (!new RegExp(`\\b${name}\\s*\\(`).test(js)) warnings.push(`${rel}: event handler not found: ${name}`);
  }
}
const manifest = JSON.parse(file('manifest.json'));
const declared = new Set((manifest.features || []).map(x => x.name));
const imports = new Set();
for (const page of pages) for (const m of script(file(`pages/${page}/${page}.ux`)).matchAll(/import\s+\w+\s+from\s+['"](@system\.[^'"]+)['"]/g)) imports.add(m[1]);
for (const m of script(file('app.ux')).matchAll(/import\s+\w+\s+from\s+['"](@system\.[^'"]+)['"]/g)) imports.add(m[1]);
for (const mod of imports) if (!declared.has(mod.replace('@system.', 'system.'))) warnings.push(`manifest missing feature for ${mod}`);
const game = file('pages/game/game.ux');
const gameJs = script(game);
const gameTemplateEvents = (game.match(/@(click|touchstart|touchmove|touchend|swipe)=/g) || []).length;
if (gameTemplateEvents > 20) warnings.push(`game has ${gameTemplateEvents} template event bindings`);
if ((game.match(/<div[^>]*for="\{\{squares\}\}"/g) || []).length) warnings.push('game renders 64 square nodes dynamically');
if ((gameJs.match(/JSON\.parse\(JSON\.stringify/g) || []).length) warnings.push('game contains deep-copy JSON operations');
if ((gameJs.match(/storage\.(get|set|delete)/g) || []).length > 0) warnings.push(`game retains ${gameJs.match(/storage\.(get|set|delete)/g).length} storage calls outside startup`);
if (gameJs.includes('global.runGC')) warnings.push('game depends on nonstandard global.runGC guard');
console.log(JSON.stringify({pages, imports:[...imports], declared:[...declared], errors, warnings}, null, 2));
if (errors.length) process.exitCode = 1;
