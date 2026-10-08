#!/usr/bin/env node
/*
 * verify_mate_rules.js — regression guard for check / checkmate / stalemate.
 *
 * WHY THIS EXISTS
 * ---------------
 * The page used to carry
 *
 *     isInCheckBoard(board,color){const king=color+'K',sq=board.indexOf(king);...}
 *
 * but the board stores pieces as 'wK' / 'bK' while move() passed this.turn,
 * which is 'white' / 'black'.  So the lookup asked for 'whiteK', indexOf()
 * returned -1, and the function was hard-wired to false.
 *
 * Consequence: isCheckmate() could never be true, isStalemate() collapsed to
 * "no legal moves" and EVERY checkmate was displayed as a draw by stalemate.
 * The in-game "check" banner was dead for the same reason.
 *
 * The fix normalises the colour first.  This script replays real positions —
 * including a full Scholar's Mate played through the actual move() — and
 * asserts the resulting resultTitle, so the two call conventions ('white' and
 * 'w') can never silently diverge again.
 *
 * Run:  node tools/verify_mate_rules.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  (' + extra + ')' : '')); }
}

/* Pull the page object out of a .ux file and hand it to node. */
function loadPage(device) {
  const f = path.join(ROOT, 'devices', device, 'source', 'chinese', 'src', 'pages', 'game', 'game.ux');
  const src = fs.readFileSync(f, 'utf8');
  const m = src.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no <script> block in ' + f);
  let body = m[1].replace(/^import .*$/gm, '');
  body = body.replace('export default', 'module.exports =');
  const sandbox = { module: { exports: {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(body, sandbox);
  return sandbox.module.exports;
}

/* A detached component: real chess methods, stubbed UI/timer/i18n. */
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

  // UI / storage / clock / i18n stubs — the rules engine must not need them.
  comp.$t = (k) => '<' + k + '>';
  ['tickClock', 'stopClock', 'startClock', 'updateSquares', 'maybeAiMove',
   'saveActiveGame', 'saveSettings', 'clearActiveGame', 'buildSquares',
   'closeMenu', 'loadSettings', 'clearActiveGame'].forEach((k) => { comp[k] = () => {}; });
  comp.formatClock = (s) => String(s);
  comp.encodeBoard = (b) => b.map((p) => p || '-').join(',');

  comp.incrementSeconds = 0;
  comp.unlimited = true;
  comp.whiteSeconds = 0;
  comp.blackSeconds = 0;
  comp.resultVisible = false;
  comp.gameOver = false;
  comp.history = [];
  comp.lastMove = [];
  comp.legalCache = {};
  comp.halfmoveClock = 0;
  comp.positionCounts = {};
  comp.castling = { wK: false, wQ: false, bK: false, bQ: false };
  comp.turn = 'white';
  comp.board = new Array(64).fill(null);
  return comp;
}

function place(comp, map) {
  comp.board = new Array(64).fill(null);
  for (const k in map) comp.board[+k] = map[k];
  comp.legalCache = {};
  comp.lastMove = [];
  comp.halfmoveClock = 0;
  comp.positionCounts = {};
  comp.positionCounts[comp.positionKey(comp.board, comp.turn)] = 1;
  comp.resultVisible = false;
  comp.gameOver = false;
}

/* Square index -> algebraic, for readable failures. */
const N = (i) => 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8));

for (const d of DEVICES) {
  const def = loadPage(d);
  console.log('== ' + d + ' ==');

  /* ---- 1. the colour argument must work in BOTH conventions ---------- */
  {
    const c = makeComponent(def);
    c.turn = 'black';
    place(c, { 4: 'bK', 12: 'wR', 63: 'wK', 0: 'bR', 7: 'bR' }); // Re7 checks Ke8
    ok(d + ': isInCheckBoard accepts "black"', c.isInCheckBoard(c.board, 'black') === true);
    ok(d + ': isInCheckBoard accepts "b"', c.isInCheckBoard(c.board, 'b') === true);
    ok(d + ': isInCheckBoard("white") is not a false positive',
      c.isInCheckBoard(c.board, 'white') === true, 'bR h8 hits wK h1 in this setup');
  }
  {
    const c = makeComponent(def);
    place(c, { 4: 'bK', 60: 'wK' }); // nobody attacked
    ok(d + ': quiet position reports no check (both conventions)',
      c.isInCheckBoard(c.board, 'white') === false && c.isInCheckBoard(c.board, 'black') === false);
  }

  /* ---- 2. stalemate must still be detected --------------------------- */
  {
    const c = makeComponent(def);
    c.turn = 'black';
    place(c, { 0: 'bK', 10: 'wQ', 63: 'wK' }); // Ka8, Qc7, Kh1
    ok(d + ': stalemate not a check', c.isInCheckBoard(c.board, 'black') === false);
    ok(d + ': stalemate has no legal move', c.hasLegalMove('black') === false);
    ok(d + ': isStalemate true', c.isStalemate('black') === true);
    ok(d + ': isCheckmate false for stalemate', c.isCheckmate('black') === false);
  }
  {
    const c = makeComponent(def);
    c.turn = 'white';
    place(c, { 56: 'wK', 50: 'bQ', 7: 'bK' }); // Kh1, Qg2, Kh8
    ok(d + ': white stalemate detected', c.isStalemate('white') === true && c.isCheckmate('white') === false);
  }

  /* ---- 3. real mates must be detected -------------------------------- */
  {
    const c = makeComponent(def);
    c.turn = 'black';
    place(c, { 0: 'bK', 9: 'wQ', 18: 'wK' }); // Ka8, Qb7, Kc7
    ok(d + ': back-rank-adjacent mate is a mate', c.isCheckmate('black') === true);
    ok(d + ': that mate is not a stalemate', c.isStalemate('black') === false);
  }
  {
    const c = makeComponent(def);
    c.turn = 'black';
    place(c, { 7: 'bK', 0: 'wR', 63: 'wK', 14: 'bP', 15: 'bP' }); // Kh8, Ra8, Kh1, Pg7 Ph7
    ok(d + ': back-rank mate is a mate', c.isCheckmate('black') === true);
  }
  {
    const c = makeComponent(def);
    c.turn = 'black';
    place(c, { 7: 'bK', 0: 'wR', 8: 'wR', 63: 'wK' }); // ladder mate
    ok(d + ': two-rook ladder mate is a mate', c.isCheckmate('black') === true);
  }

  /* ---- 4. quiet position is neither ---------------------------------- */
  {
    const c = makeComponent(def);
    c.turn = 'black';
    place(c, { 4: 'bK', 7: 'bR', 63: 'wK', 59: 'wQ' });
    ok(d + ': normal position is neither mate nor stalemate',
      c.isCheckmate('black') === false && c.isStalemate('black') === false && c.hasLegalMove('black') === true);
  }

  /* ---- 5. full game: Scholar's Mate through the real move() ---------- */
  {
    const c = makeComponent(def);
    c.incrementSeconds = 0;
    c.unlimited = true;
    c.turn = 'white';
    const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    c.board = new Array(64).fill(null);
    for (let i = 0; i < 8; i++) {
      c.board[i] = 'b' + back[i];
      c.board[8 + i] = 'bP';
      c.board[48 + i] = 'wP';
      c.board[56 + i] = 'w' + back[i];
    }
    c.castling = { wK: true, wQ: true, bK: true, bQ: true };
    c.positionCounts = {};
    c.positionCounts[c.positionKey(c.board, c.turn)] = 1;

    const script = [
      [52, 36, '1. e4'], [12, 28, '1... e5'],
      [61, 34, '2. Bc4'], [1, 18, '2... Nc6'],
      [59, 31, '3. Qh5'], [6, 21, '3... Nf6'],
      [31, 13, '4. Qxf7#'],
    ];
    for (const [f, t, label] of script) {
      c.move(f, t);
      if (label === '4. Qxf7#') {
        ok(d + ': Scholar\'s Mate sets resultVisible', c.resultVisible === true);
        ok(d + ': Scholar\'s Mate shows a WON-BY-MATE result, not a draw',
          /mateWins/.test(String(c.resultTitle)),
          'resultTitle=' + c.resultTitle + ' (move ' + N(f) + '->' + N(t) + ')');
        ok(d + ': Scholar\'s Mate does not say stalemate',
          !/stalemateDraw|stalemate/.test(String(c.resultTitle)),
          'resultTitle=' + c.resultTitle);
      }
    }
  }

  /* ---- 6. a mere check (not mate) must raise the check banner --------- */
  {
    const c = makeComponent(def);
    c.turn = 'white';
    place(c, {
      60: 'wK', 59: 'wQ', 56: 'wR',
      4: 'bK', 12: 'bP', 13: 'bP', 14: 'bP', 15: 'bP', 7: 'bR',
      48: 'wP', 49: 'wP', 50: 'wP', 51: 'wP',
    });
    // Qd1-h5? no. Use Rd1-d8+ style: rook to the 8th rank gives check on Ke8.
    c.board[56] = null;
    c.board[59] = 'wR';           // Rd1 -> d1 is 59? d1 index = 59
    c.turn = 'white';
    c.move(59, 3);                // Rd1-d8+  (d8 = index 3)
    ok(d + ': plain check raises the check banner',
      /checkPass/.test(String(c.hintText)),
      'hintText=' + c.hintText);
    ok(d + ': plain check is not reported as mate',
      c.isCheckmate('black') === false);
  }
}

console.log('\n' + (fail === 0 ? 'MATE RULES OK' : 'FAILED: ' + fail) + '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
