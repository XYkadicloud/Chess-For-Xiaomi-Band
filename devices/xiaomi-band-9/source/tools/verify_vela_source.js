const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const activeUx = [
  'pages/index/index.ux',
  'pages/setup/setup.ux',
  'pages/game/game.ux',
  'pages/settings/settings.ux',
  'pages/history/history.ux',
  'pages/historyDetail/historyDetail.ux'
];

function read(file) { return fs.readFileSync(path.join(src, file), 'utf8'); }
function extractScript(text, file) {
  const match = text.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i);
  assert(match, `${file}: missing script block`);
  return match[1]
    .replace(/^\s*import[^\n]*\n/gm, '')
    .replace(/export\s+default\s*\{/, 'return {');
}

const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
assert.strictEqual(manifest.package, 'com.xykadi.chess');
assert.strictEqual(manifest.versionName, '0.2.8');
assert.strictEqual(manifest.versionCode, 10);
assert.deepStrictEqual(Object.keys(manifest.router.pages).sort(), [
  'pages/game', 'pages/history', 'pages/historyDetail', 'pages/index', 'pages/settings', 'pages/setup'
]);

for (const file of activeUx) {
  const source = extractScript(read(file), file);
  new Function(source); // syntax-only validation of the extracted UX script
  assert(!(source.includes('data:') && source.includes('protected:')), `${file}: data and protected cannot coexist in Vela VM`);
}

const home = read('pages/index/index.ux');
assert.strictEqual((home.match(/>开始游戏</g) || []).length, 1, 'home must expose one 开始游戏 button');
assert.strictEqual((home.match(/新建对局/g) || []).length, 0, 'home must not expose duplicate 新建对局 button');
assert.strictEqual((home.match(/startNew/g) || []).length, 0, 'legacy startNew handler must be removed');
assert(home.includes('navigating'), 'home navigation guard is missing');

const setup = read('pages/setup/setup.ux');
assert(setup.includes('无限制时间'), 'unlimited time option is missing');
assert(setup.includes("router.push({ uri:'/pages/game'"), 'setup must navigate directly to game');
assert(setup.includes("unlimited: unlimited ? 'true' : 'false'"), 'unlimited route flag is missing');
assert((setup.match(/@touchend=/g) || []).length >= 7, 'setup must use touchend for band selection');
assert(!setup.includes("import storage from '@system.storage'"), 'setup must not load storage during selection');

const settings = read('pages/settings/settings.ux');
assert(settings.includes('confirmBeforeResign'), 'settings must use the game setting key');
assert(!settings.includes('confirmResign:true'), 'legacy mismatched setting key must be removed');

const gameSource = extractScript(read('pages/game/game.ux'), 'pages/game/game.ux');
assert(gameSource.includes('this.newPosition();'), 'game must initialize without storage callback');
assert(gameSource.includes('touchMoved'), 'game must use low-overhead touch dispatch');
const gameFactory = new Function('storage', 'router', 'brightness', gameSource);
const game = gameFactory({}, {}, {});
const state = Object.assign({}, game.private || game.data);
for (const key of Object.keys(game)) {
  if (typeof game[key] === 'function') state[key] = game[key].bind(state);
}
state.newPosition();
assert.strictEqual(state.board.length, 64);
assert.deepStrictEqual(state.getMovesFast(52), [44, 36], 'white pawn initial moves should be cached correctly');
const cached = state.getMovesFast(52);
assert.strictEqual(state.getMovesFast(52), cached, 'same position should reuse legal move cache');
state.selected = 52;
state.legalMoves = [44, 36];
state.move(52, 36);
assert.strictEqual(state.board[36], 'wP');
assert.strictEqual(state.board[52], null);
assert.strictEqual(state.turn, 'black');
assert.strictEqual(state.history.length, 1);
assert(!state.history[0].positionCounts, 'undo snapshots must not deep-copy the full repetition map');
state.stopClock();
state.unlimited = true;
state.newPosition();
assert.strictEqual(state.whiteClock, '∞');
assert.strictEqual(state.blackClock, '∞');
assert.strictEqual(state.timerId, null, 'unlimited game must not create a clock interval');

console.log('Vela source checks: PASS');
console.log(`Active UX scripts checked: ${activeUx.length}`);
console.log(`Chess state checks: board=${state.board.length}, undo=${state.history.length}, cache=reused`);
