#!/usr/bin/env node
/*
 * _probe_sanity.js — does the evaluation respond the way chess says it should?
 *
 * Correlation against Stockfish said our positional terms add nothing over raw
 * material. Before rewriting anything, check the terms on positions where the
 * correct answer is not in doubt: an open bishop must beat a blocked one, a
 * central knight must beat a rim knight, doubled pawns must be worse than
 * healthy ones. If these come out wrong, the problem is a bug, not tuning.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENGINE = process.env.CHESS_AI_JS
  ? path.resolve(process.env.CHESS_AI_JS)
  : path.resolve(__dirname, '..', 'src', 'common', 'js', 'ai.js');

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
vm.createContext(ctx);
vm.runInContext(converted, ctx, { filename: ENGINE });
const ai = ctx.module.exports;

function parseFen(fen) {
  const parts = fen.trim().split(/\s+/);
  const board = new Array(64).fill(null);
  const ranks = parts[0].split('/');
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
  let ep = -1;
  if (parts[3] && parts[3] !== '-') ep = (7 - (parseInt(parts[3][1], 10) - 1)) * 8 + (parts[3].charCodeAt(0) - 97);
  return { board, turn: parts[1] === 'w' ? 'w' : 'b', castling: cb, ep };
}

/* evaluatePos returns side-to-move POV; every case below is White to move, so
 * the number is directly White's score in centipawns. */
function ev(fen) {
  const st = parseFen(fen);
  const pos = new ai.Position().load(st.board, st.turn, st.castling, st.ep, 0);
  return ai.evaluatePos(pos);
}

const CASES = [
  ['knight rim vs centre',
    '4k3/pppppppp/8/8/8/8/PPPPPPPP/N3K3 w - - 0 1',
    '4k3/pppppppp/8/8/4N3/8/PPPPPPPP/4K3 w - - 0 1'],

  ['bishop blocked c1 vs open b2',
    '4k3/pppppppp/8/8/8/8/PPPPPPPP/2B1K3 w - - 0 1',
    '4k3/pppppppp/8/8/8/1P6/PBPPPPPP/4K3 w - - 0 1'],

  ['doubled pawns vs healthy',
    '4k3/pppppppp/8/8/8/3P4/PP1P1PPP/4K3 w - - 0 1',
    '4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1'],

  ['isolated pawn vs connected',
    '4k3/pppppppp/8/8/8/8/P1PPPPPP/4K3 w - - 0 1',
    '4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1'],

  ['passed pawn 5th vs 2nd',
    '4k3/8/8/8/8/8/P7/4K3 w - - 0 1',
    '4k3/8/8/P7/8/8/8/4K3 w - - 0 1'],

  ['rook open file vs behind own pawn',
    '4k3/pppppppp/8/8/8/8/PPPPPPPP/R3K3 w - - 0 1',
    '4k3/1ppppppp/8/8/8/8/1PPPPPPP/R3K3 w - - 0 1'],

  ['pawn on e4 vs pawn on a4',
    '4k3/pppppppp/8/8/P7/8/1PPPPPPP/4K3 w - - 0 1',
    '4k3/pppppppp/8/8/4P3/8/PPPP1PPP/4K3 w - - 0 1'],

  ['queen active vs cornered',
    '4k3/pppppppp/8/8/8/8/PPPPPPPP/3QK3 w - - 0 1',
    '4k3/pppppppp/8/8/8/8/PPPPPPPP/Q3K3 w - - 0 1']
];

console.log('engine: ' + ENGINE);
console.log();
for (const [name, a, b] of CASES) {
  const va = ev(a);
  const vb = ev(b);
  console.log(name.padEnd(34) + '  A ' + String(va).padStart(6) +
    '   B ' + String(vb).padStart(6) + '   diff ' + String(vb - va).padStart(6));
}
