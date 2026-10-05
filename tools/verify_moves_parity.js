#!/usr/bin/env node
/**
 * verify_moves_parity.js — prove the optimised move generator is EQUIVALENT to
 * the original one.
 *
 * getMoves() was rewritten to (a) cache per position instead of by a
 * `board.join(',')` string and (b) test legality with make/unmake on one
 * scratch copy of the board instead of copying the board per pseudo-move.
 *
 * That second part touches castling, en passant and promotion, so "the games
 * still look legal" is not enough — a missing move would never show up that
 * way. This compares the new generator against the ORIGINAL algorithm, which
 * is still present in the page as applyBoardMove() + isInCheckBoard():
 *
 *     reference(i) = pseudoMoves(i) filtered by applyBoardMove + isInCheckBoard
 *
 * Both are evaluated on the same positions, reached by playing random legal
 * games, and the move SETS must match exactly for all 64 squares.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const D = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  (' + extra + ')' : '')); }
};

function loadEngine() {
  const src = fs.readFileSync(path.join(ROOT, 'src/common/js/ai.js'), 'utf8');
  const body = src.replace(/^export default ai;\s*$/m, '').replace(/^export \{[\s\S]*?\};\s*$/m, '');
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.createContext(sandbox);
  vm.runInContext(body + '\nmodule.exports = { ai };', sandbox);
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
    if (k === 'computed') for (const c in def.computed) Object.defineProperty(proto, c, { get: def.computed[c].bind(comp), enumerable: true });
    else if (typeof def[k] === 'function') proto[k] = def[k];
    else priv[k] = def[k];
  }
  Object.setPrototypeOf(comp, proto);
  Object.assign(comp, priv);
  comp.setData = function (o) { Object.assign(comp, o); };
  return comp;
}

function loadPage(device) {
  const f = path.join(ROOT, 'devices', device, 'source', 'chinese', 'src', 'pages', 'game', 'game.ux');
  const src = fs.readFileSync(f, 'utf8');
  let body = src.match(/<script>([\s\S]*)<\/script>/)[1];
  const timers = [];
  const sandbox = {
    storage: { _s: {}, get(o) { const v = this._s[o.key]; (o.success || o.fail)(v === undefined ? { data: undefined } : { data: v }); }, set(o) { this._s[o.key] = o.value; } },
    router: { back() {}, push() {} },
    configuration: { getLocale: () => ({ language: 'zh', countryOrRegion: 'CN' }) },
    ai: loadEngine().ai,
    console,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    Date, Math, JSON, Object, Array, String, Number, parseInt, isNaN, Boolean
  };
  body = body.replace(/^\s*import .*?;\s*$/gm, '').replace(/export default/, 'var __def =');
  vm.createContext(sandbox);
  vm.runInContext(body + '\n__page = __def;', sandbox);
  sandbox.__page.$t = (k) => k;
  const comp = makeComponent(sandbox.__page);
  comp.__drain = () => { let g = 0; while (timers.length && g++ < 400) timers.shift()(); };
  return comp;
}

/* Deterministic PRNG so a failure is reproducible. */
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/* The ORIGINAL legality algorithm, using helpers that are still in the page. */
function referenceMoves(comp, i) {
  const p = comp.board[i];
  if (!p) return [];
  const pseudo = comp.getPseudoMoves(i, comp.board, true);
  const out = [];
  for (let n = 0; n < pseudo.length; n++) {
    const b = comp.applyBoardMove(comp.board, i, pseudo[n]);
    if (!comp.isInCheckBoard(b, p[0])) out.push(pseudo[n]);
  }
  return out.sort((a, b) => a - b);
}
const sorted = (a) => a.slice().sort((x, y) => x - y);

/* Compare every square of the current position. */
function comparePosition(comp, tag, notes) {
  comp.legalCache = {};                       // force a fresh computation
  let mismatch = 0, firstBad = '';
  for (let i = 0; i < 64; i++) {
    const got = sorted(comp.getMoves(i));
    const want = referenceMoves(comp, i);
    if (got.join(',') !== want.join(',')) {
      mismatch++;
      if (!firstBad) firstBad = 'sq' + i + ' got[' + got + '] want[' + want + ']';
    }
  }
  if (mismatch) notes.push(tag + ': ' + mismatch + ' square(s) differ — ' + firstBad);
  return mismatch === 0;
}

console.log('== move-generator parity (optimised vs original algorithm) ==');

for (const d of D) {
  const comp = loadPage(d);
  const notes = [];
  let plies = 0, bad = 0;
  let sawCastle = false, sawEp = false, sawPromo = false;

  comp.aiEnabled = false;
  comp.showHints = true;

  for (let game = 0; game < 6 && notes.length < 3; game++) {
    comp.newPosition();
    for (let ply = 0; ply < 90; ply++) {
      if (!comparePosition(comp, d + ' game' + game + ' ply' + ply, notes)) bad++;

      /* pick a random legal move from the side to move */
      const cands = [];
      for (let i = 0; i < 64; i++) {
        const p = comp.board[i];
        if (p && p[0] === comp.turn[0]) {
          for (const to of comp.getMoves(i)) cands.push([i, to, p]);
        }
      }
      if (!cands.length) break;
      const [from, to, piece] = cands[Math.floor(rnd() * cands.length)];
      if (piece[1] === 'K' && Math.abs(to - from) === 2) sawCastle = true;
      if (piece[1] === 'P' && Math.abs(to - from) === 7 && !comp.board[to]) sawEp = true;
      if (piece[1] === 'P' && (to < 8 || to > 55)) sawPromo = true;
      comp.move(from, to);
      comp.__drain();
      plies++;
      if (comp.resultVisible || comp.gameOver) break;
    }
  }

  console.log('  ' + d + ': ' + plies + ' plies compared, ' +
    'castling=' + sawCastle + ' enPassant=' + sawEp + ' promotion=' + sawPromo);
  for (const n of notes.slice(0, 3)) console.log('        ' + n);
  ok(d + ': optimised generator matches the original', bad === 0, bad + ' position(s) differed');

  /* Random play rarely reaches en passant (and sometimes never castles), so
   * the special rules are pinned down explicitly. Square numbers are
   * row*8+col with row 0 = rank 8: 0=a8, 4=e8, 27=d5, 28=e5, 56=a1, 60=e1,
   * 62=g1, 63=h1. `expect` must be offered, `absent` must NOT be. */
  const setup = (pieces, turn, castling, lastMove) => {
    const b = new Array(64).fill(null);
    for (const k of Object.keys(pieces)) b[Number(k)] = pieces[k];
    comp.board = b; comp.turn = turn; comp.lastMove = lastMove || [];
    comp.castling = Object.assign({ wK: false, wQ: false, bK: false, bQ: false }, castling || {});
    comp.history = []; comp.selected = -1; comp.legalMoves = []; comp.legalCache = {};
    comp.gameOver = false; comp.resultVisible = false;
  };
  const SPECIAL = [
    // black just played d7-d5; the white e5 pawn may capture en passant to d6(19)
    ['en passant capture', { 60: 'wK', 4: 'bK', 28: 'wP', 27: 'bP' }, 'white', {}, [11, 27], 28, [19, 20], []],
    // same, but a black rook on e8 pins the pawn: capturing e.p. would expose
    // the king, so only the e6 push (20) is legal
    ['en passant illegal (pinned pawn)', { 60: 'wK', 0: 'bK', 4: 'bR', 28: 'wP', 27: 'bP' }, 'white', {}, [11, 27], 28, [20], [19]],
    ['castling both sides', { 60: 'wK', 4: 'bK', 56: 'wR', 63: 'wR' }, 'white', { wK: true, wQ: true }, [], 60, [58, 62], []],
    // a black rook on f8 attacks f1, so the king may not pass through it:
    // O-O-O (58) stays legal, O-O (62) must not be offered
    ['castling blocked by attacked square', { 60: 'wK', 4: 'bK', 56: 'wR', 63: 'wR', 5: 'bR' }, 'white', { wK: true, wQ: true }, [], 60, [58], [62]],
    ['promotion', { 60: 'wK', 4: 'bK', 8: 'wP' }, 'white', {}, [], 8, [0], []],
    // black rook on e2 checks; the king may take it (52) or step aside, but
    // d2 (51) is on the rook's rank and must stay illegal
    ['king in check', { 60: 'wK', 4: 'bK', 52: 'bR' }, 'white', {}, [], 60, [52, 59, 61], [51]],
  ];
  for (const [name, pieces, turn, castling, lastMove, probe, expect, absent] of SPECIAL) {
    setup(pieces, turn, castling, lastMove);
    ok(d + ': ' + name + ' — generator matches the original',
      comparePosition(comp, d + ' ' + name, notes));
    const got = comp.getMoves(probe);
    ok(d + ': ' + name + ' — expected moves offered',
      expect.every((e) => got.indexOf(e) >= 0),
      'probe sq' + probe + ' got[' + got + '] want[' + expect + ']');
    ok(d + ': ' + name + ' — illegal moves excluded',
      absent.every((e) => got.indexOf(e) < 0),
      'probe sq' + probe + ' got[' + got + '] must not contain[' + absent + ']');
  }
}

console.log('\n' + (fail === 0 ? 'MOVE PARITY OK' : 'FAILED: ' + fail) + '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
