const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const game = read('src/pages/game/game.ux');
const index = read('src/pages/index/index.ux');
const setup = read('src/pages/setup/setup.ux');
assert(game.includes("CHESS_ACTIVE_GAME"));
assert(game.includes('saveActiveGame()'));
assert(game.includes('loadActiveGame()'));
assert(game.includes("resume: 'false'"));
assert(game.includes("this.restoring=String(this.resume)==='true'"));
assert(game.includes('this.paused=true;this.stopClock();this.saveActiveGame()'));
assert(game.includes('closeSettings(){this.settingsVisible=false;this.paused=false;this.startClock();}'));
assert(game.includes('onHide(){ if(!this.paused&&!this.gameOver&&!this.resultVisible)this.tickClock(); this.stopClock(); this.saveActiveGame(); }'));
assert(index.includes('继续对局'));
assert(index.includes("params:{resume:'true'}"));
assert(setup.includes("resume:'false'"));
assert(!setup.includes('3 分钟'));
assert(setup.includes("choose('unlimited')"));
assert(setup.includes("unlimited?'true':'false"));
assert(game.includes("unlimited: 'false'"));
assert(game.includes('this.unlimited=String(this.unlimited)===\'true\''));
assert(game.includes("this.whiteClock=this.unlimited?'∞'"));
assert(game.includes('if(this.unlimited||this.timerId'));
for (const [name, source] of [['game', game], ['index', index], ['setup', setup]]) {
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^\s*import[^\n]*\n/gm, '')
    .replace(/export\s+default\s*\{/, 'return {');
  new Function(script);
  console.log(`${name}: script syntax PASS`);
}
console.log('Pause/resume checks: PASS');
