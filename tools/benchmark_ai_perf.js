/*
 * benchmark_ai_perf.js — measure AI strength on tactical puzzles and a
 * short master self-play. Run before and after engine changes; numbers must
 * improve (or at worst stay within budget on the slowest level).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENGINE = path.resolve(__dirname, '..', 'src', 'common', 'js', 'ai.js');

function loadEngine() {
  const src = fs.readFileSync(ENGINE, 'utf8');
  const converted = src
    .replace(/^\s*export default ai;\s*$/m, '')
    .replace(/^\s*export \{[^}]*\};\s*$/m, 'module.exports = ai;')
    .replace(/^import .*$/gm, '');
  if (!/module\.exports\s*=\s*ai;/.test(converted)) throw new Error('no export');
  const ctx = { module: { exports: {} }, Math, Date, setTimeout,
    Infinity, parseInt, isNaN, JSON, Array, Object, Int8Array, Int32Array };
  ctx.exports = ctx.module.exports;
  vm.createContext(ctx);
  vm.runInContext(converted, ctx, { filename: ENGINE });
  return ctx.module.exports;
}
const ai = loadEngine();

function emptyBoard() { return new Array(64).fill(null); }

function parseFen(fen) {
  const [rows, turn] = fen.split(' ');
  const board = emptyBoard();
  const ranks = rows.split('/');
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of ranks[r]) {
      if (/\d/.test(ch)) file += parseInt(ch, 10);
      else {
        const sq = r * 8 + file;
        board[sq] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
        file++;
      }
    }
  }
  return { board, turn: turn === 'w' ? 'w' : 'b' };
}

function sq(idx) {
  // board layout: board[0] = a8 (rank 8), board[56] = a1 (rank 1).
  return String.fromCharCode(97 + idx % 8) + (8 - Math.floor(idx / 8));
}
function bestUci(best) {
  if (Array.isArray(best)) return best;
  return null;
}

const PUZZLES = [
  // mate-in-1: back-rank laddermate (Rxh8#)
  { name: 'mate-in-1 back rank',   fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',  best: ['a1a8'] },
  // free-queen: Nf3xg5 picks up the queen (UCI f3g5)
  { name: 'free-queen Nf3xg5',     fen: 'r1b1k2r/pppp1ppp/2n2n2/2b1p1q1/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 1', best: ['f3g5'] },
  // legal opening — many correct first moves are fine
  { name: 'opening legal',         fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', best: ['e2e4','d2d4','b1c3','g1f3'] },
  // KQ vs K, must not stalemate
  { name: 'KQ vs K must win',      fen: '8/8/8/4k3/8/8/4K3/4Q3 w - - 0 1', best: null },
];

console.log('=== AI perf benchmark ===');
console.log('--- single-position puzzles ---');
for (const lvl of ['hard', 'master']) {
  ai.setLevel(lvl);
  console.log(' [' + lvl + ']');
  for (const p of PUZZLES) {
    const st = parseFen(p.fen);
    const t0 = Date.now();
    const m = ai.compute(st.board, st.turn, { wK: true, wQ: true, bK: true, bQ: true }, -1, 0);
    const dur = Date.now() - t0;
    const uci = m ? sq(m.from) + sq(m.to) : '(none)';
    const ok = !p.best || !m ? '   ' : (p.best.includes(uci) ? '✓  ' : '×  ');
    console.log('  ' + ok + p.name.padEnd(28) + ' -> ' + uci + '   ' + dur + 'ms   nodes=' + (m ? m.points : '?'));
  }
}

function selfPlay(level, plies) {
  ai.setLevel(level);
  let st = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  let { board } = st;
  let turn = st.turn;
  let castle = { wK: true, wQ: true, bK: true, bQ: true };
  let ep = -1, hm = 0;
  let totalMs = 0, nodes = 0, n = 0;
  for (let i = 0; i < plies; i++) {
    const m = ai.compute(board, turn, castle, ep, hm);
    if (!m) break;
    totalMs += m.ms; nodes += (m.points || 0); n++;
    const movedPiece = board[m.from];
    const captured = board[m.to];
    board[m.to] = movedPiece; board[m.from] = null;
    hm = (movedPiece[1] === 'P' || captured) ? 0 : hm + 1;
    if (movedPiece[1] === 'K') { castle[turn + 'K'] = false; castle[turn + 'Q'] = false; }
    ep = (movedPiece[1] === 'P' && Math.abs(m.to - m.from) === 16) ? (m.to + m.from) / 2 : -1;
    turn = turn === 'w' ? 'b' : 'w';
  }
  return { totalMs, nodes, n };
}

console.log('\n--- self-play (40 plies, hard / master) ---');
for (const lvl of ['hard', 'master']) {
  const r = selfPlay(lvl, 40);
  console.log('  ' + lvl.padEnd(8) + ' ' + r.n + ' plies, ' + r.totalMs + 'ms total, ' +
              (r.totalMs / Math.max(1, r.n)).toFixed(0) + 'ms/ply, ' + r.nodes + ' nodes');
}