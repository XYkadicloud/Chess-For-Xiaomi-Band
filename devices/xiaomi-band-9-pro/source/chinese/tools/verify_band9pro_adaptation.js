const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const pages = [
  'index/index.ux', 'setup/setup.ux', 'game/game.ux', 'settings/settings.ux',
  'about/about.ux', 'support/support.ux', 'purchase/purchase.ux'
];
const read = (p) => fs.readFileSync(path.join(src, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

assert.strictEqual(manifest.config.designWidth, 336, 'designWidth must be 336 for Band 9 Pro');
assert.deepStrictEqual(manifest.deviceTypeList, ['watch'], 'Vela wearable device type must remain watch');
assert.strictEqual(manifest.package, 'com.xykadi.chess');
assert(manifest.router.pages['pages/purchase'], 'purchase route must be registered');
assert.strictEqual(manifest.router.entry, 'pages/index');

for (const page of pages) {
  const source = read(`pages/${page}`);
  assert(source.includes('width:336dp'), `${page}: missing 336dp canvas width`);
  assert(source.includes('height:480dp'), `${page}: missing 480dp canvas height`);
  assert(!source.includes('192dp') && !source.includes('490dp'), `${page}: legacy Band 9 canvas remains`);
  const script = source.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i);
  assert(script, `${page}: missing script`);
  const executable = script[1].replace(/^\s*import[^\n]*\n/gm, '').replace(/export\s+default\s*\{/, 'return {');
  new Function(executable);
}

const game = read('pages/game/game.ux');
assert(game.includes('336-this.boardSize'), 'game horizontal boundary must use 336dp');
assert(game.includes('Math.floor((336-this.boardSize)/2)'), 'wide-screen board centering is missing');
assert(game.includes('pageX') && game.includes('pageY'), 'game touch coordinates are missing');
assert(game.includes('this.board.length!==64'), 'game board integrity guard is missing');

const index = read('pages/index/index.ux');
assert(index.includes('Xiaomi Band 9 Pro'), 'home device label must identify Band 9 Pro');
const about = read('pages/about/about.ux');
assert(about.includes('Xiaomi Band 9 Pro Vela'), 'about page device description must identify Band 9 Pro');

for (const asset of ['common/icon.png', 'common/avatar.jpg', 'common/aifadian_qr.jpg']) {
  assert(fs.statSync(path.join(src, asset)).size > 0, `${asset}: missing or empty`);
}
for (const piece of ['bK','bQ','bR','bB','bN','bP','wK','wQ','wR','wB','wN','wP']) {
  assert(fs.statSync(path.join(src, `common/pieces/${piece}.png`)).size > 0, `${piece}.png missing`);
}

console.log('Band 9 Pro adaptation static checks: PASS');
console.log('Canvas: 336×480dp; deviceTypeList: watch; routes: ' + Object.keys(manifest.router.pages).length);
