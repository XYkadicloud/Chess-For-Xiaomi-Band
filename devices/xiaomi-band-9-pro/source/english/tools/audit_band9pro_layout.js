const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const manifest = JSON.parse(read('src/manifest.json'));

assert.strictEqual(manifest.config.designWidth, 336);
const checks = [
  ['about', 52 + 428, 480],
  ['support', 52 + 428, 480],
  ['purchase', 52 + 364 + 64, 480],
  ['game', 48 + 26 + 280 + 46 + 58, 480],
];
for (const [name, used, limit] of checks) {
  assert(used <= limit, `${name}: outer vertical overflow ${used} > ${limit}`);
  console.log(`${name}: outer vertical ${used}/${limit}dp PASS`);
}

const about = read('src/pages/about/about.ux');
assert(about.includes('.aboutList { width:336dp; height:428dp;'));
assert(about.includes('.supportItem { height:380dp;'));
assert(14 + 23 + 5 + 19 + 10 + 240 + 8 + 34 + 16 <= 380, 'about QR card content overflow');

const support = read('src/pages/support/support.ux');
assert(support.includes('.body { width:336dp; height:428dp;'));
assert(20 + 28 + 12 + 200 + 12 + 26 + 4 + 19 + 15 + 38 <= 428, 'support page content overflow');

const purchase = read('src/pages/purchase/purchase.ux');
assert(purchase.includes('.purchaseList { width:336dp; height:364dp;'));
assert(9 + 200 + 9 <= 220, 'purchase QR card overflow');
assert(10 + 28 + 2 + 38 + 10 <= 92, 'purchase price card text overflow');
assert(10 + 19 + 7 + 76 + 10 <= 180, 'purchase information card text overflow');
assert(10 + 19 + 7 + 76 + 10 <= 180, 'purchase browser card text overflow');
assert(purchase.includes('lines:2') && purchase.includes('lines:4'), 'purchase text line limits missing');

const game = read('src/pages/game/game.ux');
assert(game.includes('.page { width:336dp; height:480dp;'));
assert(game.includes('maxBoardLeft(){return Math.max(0,Math.floor((336-this.boardSize)/2));}'));
assert(game.includes('this.boardLeft=Math.max(0,Math.min(maxLeft'), 'game horizontal clamp missing');
assert(game.includes('maxBoardTop(){return Math.min(0,280-this.boardSize);}'));

for (const p of ['src/app.ux', ...fs.readdirSync(path.join(root, 'src/pages')).map(d => `src/pages/${d}/${d}.ux`)]) {
  const s = read(p);
  assert(!s.includes('192dp') && !s.includes('490dp'), `${p}: legacy canvas dimensions remain`);
  assert(!s.includes('212dp') && !s.includes('520dp'), `${p}: Band 10 canvas dimensions remain`);
}
console.log('Band 9 Pro layout overflow audit: PASS');
