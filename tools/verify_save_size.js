#!/usr/bin/env node
/**
 * verify_save_size.js — the autosaved game must not grow quadratically.
 *
 * saveActiveGame() JSON.stringify's the whole move history and writes it to
 * storage; it runs on every onHide() and every time the menu is opened. Every
 * history entry used to embed its own copy of `positionCounts`, which itself
 * grows by a key per move — so the blob was O(N^2):
 *
 *     ply 20 -> 47 KB     ply 60 -> 328 KB     ply 119 -> 1.19 MB
 *
 * A blob that size means a long stringify + flash write on the band (the
 * freeze) and a huge JSON.parse on resume (the "restart").
 *
 * This asserts the size stays bounded, and that the undo bookkeeping which
 * replaced the per-entry snapshot is exactly equivalent.
 *
 *     node tools/verify_save_size.js
 *     CHESS_GAME_UX=<file> node tools/verify_save_size.js   # compare a version
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const D = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const PLIES = 140;
const MAX_BYTES = 90000;          // generous: the fixed build lands near 35 KB

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};

function loadPage(device) {
  const f = process.env.CHESS_GAME_UX
    || path.join(ROOT, 'devices', device, 'source', 'chinese', 'src', 'pages', 'game', 'game.ux');
  const src = fs.readFileSync(f, 'utf8');
  let body = src.match(/<script>([\s\S]*)<\/script>/)[1];
  const timers = [];
  const sandbox = {
    storage: { _s: {}, get(o) { const v = this._s[o.key]; (o.success || o.fail)(v === undefined ? { data: undefined } : { data: v }); }, set(o) { this._s[o.key] = o.value; } },
    router: { back() {}, push() {} },
    configuration: { getLocale: () => ({ language: 'zh', countryOrRegion: 'CN' }) },
    ai: { setLevel() {}, compute() { return null; }, isReady() { return true; }, label() { return ''; } },
    console,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Date, Math, JSON, Object, Array, String, Number, parseInt, isNaN, Boolean
  };
  body = body.replace(/^\s*import .*?;\s*$/gm, '').replace(/export default/, 'var __def =');
  vm.createContext(sandbox);
  vm.runInContext(body + '\n__page = __def;', sandbox);
  sandbox.__page.$t = (k) => k;

  const def = sandbox.__page, priv = {}, comp = {}, proto = {};
  Object.assign(priv, def.private || {});
  Object.assign(priv, def.data || {});
  for (const k in def) {
    if (k === 'private' || k === 'data') continue;
    if (k === 'computed') for (const c in def.computed) Object.defineProperty(proto, c, { get: def.computed[c].bind(comp), enumerable: true });
    else if (typeof def[k] === 'function') proto[k] = def[k];
    else priv[k] = def[k];
  }
  Object.setPrototypeOf(comp, proto);
  Object.assign(comp, priv);
  comp.__drain = () => { let g = 0; while (timers.length && g++ < 400) timers.shift()(); };
  return comp;
}

/* Exactly what saveActiveGame() serialises. */
function saveBlob(comp) {
  return JSON.stringify({
    board: comp.board, history: comp.history, turn: comp.turn, lastMove: comp.lastMove,
    castling: comp.castling, unlimited: comp.unlimited, whiteSeconds: comp.whiteSeconds,
    blackSeconds: comp.blackSeconds, initialMinutes: comp.initialMinutes,
    incrementSeconds: comp.incrementSeconds, squareSize: comp.squareSize,
    boardLeft: comp.boardLeft, boardTop: comp.boardTop, halfmoveClock: comp.halfmoveClock,
    positionCounts: comp.positionCounts, showHints: comp.showHints,
    autoCenter: comp.autoCenter, confirmBeforeResign: comp.confirmBeforeResign,
    gameOver: false, aiEnabled: comp.aiEnabled, aiLevel: comp.aiLevel, aiColor: comp.aiColor
  });
}
const canon = (o) => JSON.stringify(Object.keys(o).sort().map((k) => k + '=' + o[k]));

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const anyMove = (comp) => {
  const c = [];
  for (let i = 0; i < 64; i++) {
    const p = comp.board[i];
    if (p && p[0] === comp.turn[0]) for (const to of comp.getMoves(i)) c.push([i, to]);
  }
  return c.length ? c[Math.floor(rnd() * c.length)] : null;
};

console.log('== saved-game size (autosave runs on every onHide + menu open) ==');

for (const d of D) {
  const comp = loadPage(d);
  comp.aiEnabled = false;
  comp.newPosition();

  const sizes = {};
  let plies = 0;
  for (let ply = 0; ply < PLIES; ply++) {
    if (ply % 20 === 0) sizes[ply] = saveBlob(comp).length;
    const mv = anyMove(comp);
    if (!mv) break;
    comp.move(mv[0], mv[1]);
    comp.__drain();
    plies++;
    if (comp.resultVisible || comp.gameOver) break;
  }
  sizes[plies] = saveBlob(comp).length;
  const at = (n) => sizes[n] || sizes[Math.max(...Object.keys(sizes).map(Number).filter((k) => k <= n))];
  console.log('  ' + d + ': ' + plies + ' plies — ' +
    Object.keys(sizes).sort((a, b) => a - b).map((k) => k + ':' + (sizes[k] / 1024).toFixed(0) + 'K').join('  '));

  const finalSize = saveBlob(comp).length;
  ok(d + ': saved game stays under ' + (MAX_BYTES / 1024) + ' KB', finalSize < MAX_BYTES,
    (finalSize / 1024).toFixed(0) + ' KB at ' + plies + ' plies');

  /* Quadratic growth shows up as the size roughly quadrupling when the ply
   * count doubles. Anything close to linear is fine. */
  const a = at(60), b = at(120);
  if (a && b && plies >= 120) {
    ok(d + ': growth is not quadratic', b / a < 3,
      '60 plies ' + (a / 1024).toFixed(0) + 'K -> 120 plies ' + (b / 1024).toFixed(0) + 'K (ratio ' + (b / a).toFixed(2) + ')');
  }

  /* Undo bookkeeping: making K moves then undoing them all must leave the
   * repetition map exactly as it started. */
  const comp2 = loadPage(d);
  comp2.aiEnabled = false;
  comp2.newPosition();
  const before = canon(comp2.positionCounts);
  const played = [];
  for (let k = 0; k < 12; k++) {
    const mv = anyMove(comp2);
    if (!mv) break;
    played.push(mv);
    comp2.move(mv[0], mv[1]);
    comp2.__drain();
  }
  for (let k = 0; k < played.length; k++) comp2.undoMoveBase();
  ok(d + ': undo restores the repetition map exactly',
    canon(comp2.positionCounts) === before,
    'after ' + played.length + ' moves + undos: ' + canon(comp2.positionCounts) + ' vs ' + before);
  ok(d + ': undo restores the board', comp2.board.filter(Boolean).length === 32);
}

console.log('\n' + (fail === 0 ? 'SAVE-SIZE OK' : 'FAILED: ' + fail) + '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
