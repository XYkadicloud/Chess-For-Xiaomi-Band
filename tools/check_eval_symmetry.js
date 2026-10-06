#!/usr/bin/env node
/*
 * check_eval_symmetry.js — does the evaluation treat both colours identically?
 *
 * Chess is symmetric under colour reversal: mirror a position vertically and
 * swap every piece's colour, and the evaluation must come back negated. If it
 * does not, the engine has a systematic preference for one side, which shows up
 * as a huge score bias and as "it plays badly as Black" in real games — and it
 * is invisible to a correlation test that pools both colours.
 *
 * Run: node tools/check_eval_symmetry.js [fenFile]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENGINE = process.env.CHESS_AI_JS
  ? path.resolve(process.env.CHESS_AI_JS)
  : path.resolve(__dirname, '..', 'src', 'common', 'js', 'ai.js');

function loadEngine() {
  const src = fs.readFileSync(ENGINE, 'utf8');
  const converted = src
    .replace(/^\s*export default ai;\s*$/m, '')
    .replace(/^\s*export \{[^}]*\};\s*$/m, 'module.exports = ai;')
    .replace(/^import .*$/gm, '');
  const ctx = {
    module: { exports: {} }, console: console, Math: Math, Date: Date, JSON: JSON,
    Array: Array, Object: Object, Int8Array: Int8Array, Int32Array: Int32Array,
    parseInt: parseInt, isNaN: isNaN, Infinity: Infinity
  };
  ctx.exports = ctx.module.exports;
  vm.createContext(ctx);
  vm.runInContext(converted, ctx, { filename: ENGINE });
  return ctx.module.exports;
}
const ai = loadEngine();

/* Mirror a board array vertically and swap colours. `board` is a flat array
 * whose index 0 is a8, so vertical mirroring is row 7-r. */
function mirrorBoard(board) {
  const out = new Array(64).fill(null);
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p) continue;
    const colour = p[0] === 'w' ? 'b' : 'w';
    const j = (7 - (i >> 3)) * 8 + (i & 7);
    out[j] = colour + p[1];
  }
  return out;
}

function parseFen(fen) {
  const parts = fen.trim().split(/\s+/);
  const board = new Array(64).fill(null);
  const ranks = parts[0].split('/');
  if (ranks.length !== 8) throw new Error('bad FEN: ' + fen);
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of ranks[r]) {
      if (/\d/.test(ch)) file += parseInt(ch, 10);
      else { board[r * 8 + file] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase(); file++; }
    }
  }
  const cb = { wK: false, wQ: false, bK: false, bQ: false };
  if (parts[2] && parts[2] !== '-') {
    cb.wK = parts[2].indexOf('K') >= 0; cb.wQ = parts[2].indexOf('Q') >= 0;
    cb.bK = parts[2].indexOf('k') >= 0; cb.bQ = parts[2].indexOf('q') >= 0;
  }
  return { board, turn: parts[1] === 'w' ? 'w' : 'b', castling: cb };
}

const FEN_FILE = process.argv[2] || path.resolve(__dirname, '_fixtures', 'eval_sample.fen');
const fens = fs.readFileSync(FEN_FILE, 'utf8').split(/\r?\n/)
  .map(l => l.trim()).filter(l => l && l[0] !== '#');

let worst = null;
let sumAbs = 0;
let n = 0;
const bad = [];
for (const fen of fens) {
  const st = parseFen(fen);
  const pos = new ai.Position().load(st.board, st.turn, st.castling, -1, 0);
  const a = ai.evaluatePos(pos);                       /* side-to-move POV */

  const mb = mirrorBoard(st.board);
  const mcb = { wK: st.castling.bK, wQ: st.castling.bQ, bK: st.castling.wK, bQ: st.castling.wQ };
  const mturn = st.turn === 'w' ? 'b' : 'w';
  const mpos = new ai.Position().load(mb, mturn, mcb, -1, 0);
  const b = ai.evaluatePos(mpos);

  /* evaluatePos is side-to-move relative, so the invariant is
   *     eval(P) == eval(mirror(P))
   * (both positions ask "how good is this for the player about to move?").
   * If evaluatePos is ever switched to a white-relative convention this test
   * must be changed to a sum, not a difference. */
  const err = a - b;
  sumAbs += Math.abs(err);
  n++;
  if (!worst || Math.abs(err) > Math.abs(worst.err)) worst = { fen, a, b, err };
  if (Math.abs(err) > 20) bad.push({ fen, a, b, err });
}

console.log('=== colour-symmetry check: eval(mirror(P)) - eval(P) must be 0 ===');
console.log('positions      ' + n);
console.log('mean |error|   ' + (sumAbs / n).toFixed(1) + ' cp');
if (worst) {
  console.log('worst          ' + worst.err + ' cp   (ours ' + worst.a +
    ', mirrored ' + worst.b + ')');
  console.log('               ' + worst.fen);
}
if (bad.length) {
  console.log();
  console.log('asymmetric positions (' + bad.length + ', |error| > 20 cp):');
  bad.sort((x, y) => Math.abs(y.err) - Math.abs(x.err)).slice(0, 8).forEach(x => {
    console.log('  err ' + (x.err >= 0 ? '+' : '') + x.err +
      '   ours ' + x.a + '  mirrored ' + x.b + '   ' + x.fen.slice(0, 46));
  });
}
process.exit(sumAbs / n > 20 ? 1 : 0);
