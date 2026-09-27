const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const manifest = JSON.parse(read('src/manifest.json'));
assert.strictEqual(manifest.package, 'com.xykadi.chess');
assert.strictEqual(manifest.name, 'Chess');
assert.strictEqual(manifest.icon, '/common/icon.png');
assert.strictEqual(manifest.router.entry, 'pages/index');
assert.deepStrictEqual(Object.keys(manifest.router.pages).sort(), ['pages/about', 'pages/game', 'pages/index', 'pages/purchase', 'pages/settings', 'pages/setup', 'pages/support']);
const game = read('src/pages/game/game.ux');
const setup = read('src/pages/setup/setup.ux');
const settings = read('src/pages/settings/settings.ux');
assert(game.includes("protected: { minutes: '10', unlimited: 'false', boardSize: '30', resume: 'false' }"));
assert(!game.includes('$page'));
assert(game.includes('this.loadSettings();'));
assert(game.includes('this.initialMinutes=this.unlimited?0:(isNaN(parsed)||parsed<1?10:parsed)'));
assert(game.includes('saveSettings()'));
assert(game.includes('toggleAutoCenter(){this.autoCenter=!this.autoCenter;this.saveSettings();}'));
assert(game.includes('if(this.autoCenter)this.centerOn(i)'));
assert(setup.includes('@touchend="choose'));
assert(setup.includes("params:{minutes:minutes,unlimited:unlimited?'true':'false',boardSize:size,resume:'false'}"));
assert(settings.includes('autoCenter'));
assert(settings.includes('boardSize'));
assert(!settings.includes('Move hints'));
assert(!settings.includes('Confirm before resigning'));
assert(!settings.includes('Board animation'));
for (const [file, source] of [['game', game], ['setup', setup], ['settings', settings]]) {
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^\s*import[^\n]*\n/gm, '')
    .replace(/export\s+default\s*\{/, 'return {');
  new Function(script);
  console.log(`${file}: script syntax PASS`);
}
console.log('Vela time/center checks: PASS');
console.log(`manifest: ${manifest.name} ${manifest.package} ${manifest.versionName}`);
console.log(`icon: ${fs.statSync(path.join(root, 'src/common/icon.png')).size} bytes`);
