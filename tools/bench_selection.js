#!/usr/bin/env node
/**
 * bench_selection.js — how long does "tap a piece" actually take?
 *
 * Loads game.ux in the same vm harness the verifiers use, plays into a
 * realistic middlegame, then times the tap -> legal-move-hints path. Run it
 * before and after a change to see the real difference:
 *
 *     node tools/bench_selection.js
 *
 * Two numbers are reported for a tap, because they are what the user feels:
 *   - "box"  : time until the selection box can paint (tapSquare returns)
 *   - "+hints": time until the blue destination dots are ready
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DEV = process.argv[2] || 'xiaomi-band-9';

/* ---- load the shared engine --------------------------------------- */
function loadEngine() {
  const src = fs.readFileSync(path.join(ROOT, 'src/common/js/ai.js'), 'utf8');
  const body = src
    .replace(/^export default ai;\s*$/m, '')
    .replace(/^export \{[\s\S]*?\};\s*$/m, '');
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.createContext(sandbox);
  vm.runInContext(body + '\nmodule.exports = { ai, LEVELS, LEVEL_ORDER, AiPlayer, Position, hasLegalMove, typeOf, VALUE };', sandbox);
  return sandbox.module.exports;
}

function makeComponent(def) {
  const priv = {};
  Object.assign(priv, def.private || {});
  Object.assign(priv, def.data || {});
  const comp = {};
  const proto = {};
  for (const k in def) {
    if (k === 'private' || k === 'data') continue;
    if (k === 'computed') {
      for (const c in def.computed) {
        Object.defineProperty(proto, c, { get: def.computed[c].bind(comp), enumerable: true });
      }
    } else if (typeof def[k] === 'function') {
      proto[k] = def[k];
    } else {
      priv[k] = def[k];
    }
  }
  Object.setPrototypeOf(comp, proto);
  Object.assign(comp, priv);
  comp.setData = function (o) { Object.assign(comp, o); };
  return comp;
}

function loadPage(device) {
  /* CHESS_GAME_UX lets you benchmark an arbitrary page file, e.g. the version
   * from git HEAD, to get a clean before/after on identical input:
   *   git show HEAD:devices/xiaomi-band-9/source/chinese/src/pages/game/game.ux > /tmp/old.ux
   *   CHESS_GAME_UX=/tmp/old.ux node tools/bench_selection.js
   */
  const f = process.env.CHESS_GAME_UX
    || path.join(ROOT, 'devices', device, 'source', 'chinese', 'src', 'pages', 'game', 'game.ux');
  const src = fs.readFileSync(f, 'utf8');
  let body = src.match(/<script>([\s\S]*)<\/script>/)[1];

  const engine = loadEngine();
  const storage = {
    _s: {},
    get(o) { const v = this._s[o.key]; (o.success || o.fail)(v === undefined ? { data: undefined } : { data: v }); },
    set(o) { this._s[o.key] = o.value; if (o.success) o.success(); }
  };
  const timers = [];
  const sandbox = {
    storage,
    router: { back() {}, push() {} },
    configuration: { getLocale: () => ({ language: 'zh', countryOrRegion: 'CN' }) },
    ai: engine.ai,
    console,
    setTimeout: (fn) => { const id = timers.length + 1; timers.push({ id, fn }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: () => 0, clearInterval: () => {},
    Date, Math, JSON, Object, Array, String, Number, parseInt, isNaN, Boolean
  };
  body = body.replace(/^\s*import .*?;\s*$/gm, '').replace(/export default/, 'var __def =');
  vm.createContext(sandbox);
  vm.runInContext(body + '\n__page = __def;', sandbox);

  sandbox.__page.$t = (k) => k;
  const comp = makeComponent(sandbox.__page);
  comp.__drain = function () { let g = 0; while (timers.length && g++ < 200) timers.shift().fn(); };
  comp.__timers = timers;

  /* Count repaints: every `this.squares = <new array>` is one pass over the
   * 64-square `for` list in the template. On the band the RENDER dominates,
   * so this matters more than any microsecond of JS — a change that halves the
   * JS but doubles the repaints is a net loss, which is exactly what happened
   * once already. */
  let sets = 0;
  let backing = comp.squares;
  Object.defineProperty(comp, 'squares', {
    configurable: true, enumerable: true,
    get() { return backing; },
    set(v) { sets++; backing = v; }
  });
  comp.__repaints = () => sets;
  comp.__resetRepaints = () => { sets = 0; };
  return comp;
}

/* ---- timing -------------------------------------------------------- */
const now = () => Number(process.hrtime.bigint()) / 1e6;

function timeIt(label, fn, n) {
  fn();                       // warm
  const t0 = now();
  for (let i = 0; i < n; i++) fn();
  const ms = (now() - t0) / n;
  console.log('  ' + label.padEnd(38) + ms.toFixed(3) + ' ms');
  return ms;
}

/* Same, but also reports how many times the square list is replaced — i.e.
 * how many full repaints of the 64-square board the tap costs. */
function timeAndCount(comp, label, fn, n) {
  fn();
  comp.__resetRepaints();
  const t0 = now();
  for (let i = 0; i < n; i++) fn();
  const ms = (now() - t0) / n;
  const per = comp.__repaints() / n;
  console.log('  ' + label.padEnd(38) + ms.toFixed(3) + ' ms   ' + per.toFixed(2) + ' repaint(s)');
  return ms;
}

/* ---- a realistic middlegame --------------------------------------- */
const OPENING = [
  [52, 36], [12, 28], [62, 45], [4, 20], [59, 31], [3, 39], [61, 34], [11, 27],
  [63, 62], [2, 3],   [56, 48], [0, 1],  [60, 59], [1, 2],  [59, 51], [2, 11],
];
function playOpening(comp) {
  for (const [from, to] of OPENING) {
    if (comp.board[from] && comp.getMoves(from).indexOf(to) >= 0) comp.move(from, to);
  }
  comp.__drain();
}
function firstPieceWithMoves(comp) {
  for (let i = 0; i < 64; i++) {
    const p = comp.board[i];
    if (p && p[0] === comp.turn[0] && comp.getMoves(i).length) return i;
  }
  return -1;
}

/* ---- run ----------------------------------------------------------- */
console.log('== selection benchmark — ' + DEV + ' ==');
const comp = loadPage(DEV);
comp.newPosition();
playOpening(comp);
comp.selected = -1; comp.legalMoves = [];
comp.autoCenter = false;

const sq = firstPieceWithMoves(comp);
if (sq < 0) { console.log('  (no piece with a legal move — aborting)'); process.exit(1); }

/* The piece with the most legal moves is the worst case for move generation
 * (a queen in the open can produce ~27 pseudo-moves, each of which is played
 * out on a copy of the board and tested for check). */
let worst = -1, worstN = 0;
for (let i = 0; i < 64; i++) {
  const p = comp.board[i];
  if (p && p[0] === comp.turn[0]) {
    const n = comp.getMoves(i).length;
    if (n > worstN) { worstN = n; worst = i; }
  }
}
console.log('  position: ' + comp.turn + ' to move, ' + comp.history.length + ' plies played');
console.log('  probing square ' + sq + ' (' + comp.board[sq] + ')');
console.log('  worst case  square ' + worst + ' (' + comp.board[worst] + ', ' + worstN + ' moves)\n');

/* Clear the move cache, so we measure the COLD path. That is the common case
 * for a tap: hasLegalMove() early-exits after the first piece that can move,
 * so the piece the user actually taps is usually not cached yet. */
const cold = () => { comp.legalCache = {}; };
const reset = () => { comp.selected = -1; comp.legalMoves = []; comp.updateSquares(); };

/* 1. What the user feels when tapping a piece. */
timeAndCount(comp, 'tapSquare() cold (select + hints)', () => { reset(); cold(); comp.tapSquare(sq); comp.__drain(); }, 3000);
timeAndCount(comp, 'tapSquare() warm (select + hints)', () => { reset(); comp.tapSquare(sq); comp.__drain(); }, 3000);
if (worst >= 0 && worst !== sq) {
  timeAndCount(comp, 'worst piece: cold (select + hints)', () => { reset(); cold(); comp.tapSquare(worst); comp.__drain(); }, 3000);
}

/* 2. Repainting the board after the selection changes. */
comp.selected = sq; comp.legalMoves = comp.getMoves(sq);
timeIt('updateSquares() after a selection', () => { comp.updateSquares(); }, 3000);

/* 3. The legality scan that runs after EVERY move. */
timeIt('isCheckmate()+isStalemate()', () => { cold(); comp.isCheckmate(comp.turn); comp.isStalemate(comp.turn); }, 3000);

/* 3b. True worst case for move generation: a lone queen in the open produces
 *     ~27 pseudo-moves, each of which used to get its own copy of the board. */
{
  const b = new Array(64).fill(null);
  b[60] = 'wK'; b[4] = 'bK'; b[27] = 'wQ';
  comp.board = b; comp.turn = 'white';
  comp.castling = { wK: false, wQ: false, bK: false, bQ: false };
  comp.lastMove = []; comp.history = []; comp.selected = -1; comp.legalMoves = [];
  console.log('\n  queen alone in the open (sq27): ' + comp.getMoves(27).length + ' legal moves');
  timeAndCount(comp, '  queen: cold (select + hints)', () => { reset(); cold(); comp.tapSquare(27); comp.__drain(); }, 3000);
  /* The pass that actually paints the 27 destination dots. */
  comp.selected = 27; comp.legalMoves = comp.getMoves(27);
  timeIt('  queen: updateSquares() w/ 27 dots', () => { comp.updateSquares(); }, 3000);
  console.log('');
}

/* 4. Whole move: legality scan + full board rebuild. */
{
  const from = firstPieceWithMoves(comp);
  const mv = comp.getMoves(from);
  if (from < 0 || !mv.length) {
    console.log('  (move() skipped: no legal move available)');
  } else {
    const to = mv[0];
    const snap = {
      board: comp.board.slice(), turn: comp.turn, history: comp.history.slice(),
      lastMove: comp.lastMove.slice(), castling: Object.assign({}, comp.castling),
      positionCounts: Object.assign({}, comp.positionCounts), resultVisible: comp.resultVisible
    };
    const ms = timeIt('move() end to end', () => {
      comp.board = snap.board.slice(); comp.turn = snap.turn;
      comp.history = snap.history.slice(); comp.lastMove = snap.lastMove.slice();
      comp.castling = Object.assign({}, snap.castling);
      comp.positionCounts = Object.assign({}, snap.positionCounts);
      comp.resultVisible = snap.resultVisible; comp.gameOver = false;
      cold();
      comp.move(from, to);
    }, 100);

    /* Sanity: if move() bailed out early the timing above is meaningless. */
    comp.board = snap.board.slice(); comp.turn = snap.turn;
    comp.history = snap.history.slice(); comp.lastMove = snap.lastMove.slice();
    comp.castling = Object.assign({}, snap.castling);
    comp.positionCounts = Object.assign({}, snap.positionCounts);
    comp.resultVisible = snap.resultVisible; comp.gameOver = false;
    comp.move(from, to);
    if (comp.board[to] !== snap.board[from] && comp.board[from] !== null) {
      console.log('      !! move() did not take effect — treat the number above as invalid');
    } else if (ms < 0.02) {
      console.log('      (unusually fast — re-run to confirm)');
    }
  }
}
console.log('');
