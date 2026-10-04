/*
 * bench_engine.js — fast engine probe: nodes/second plus a tactical test set.
 *
 * Run:  node tools/bench_engine.js [npsSeconds]
 *
 * benchmark_ai_perf.js is the full suite but takes minutes; this one answers
 * "is the engine faster and stronger than it was an hour ago" in seconds, so it
 * is the thing to run while tuning.
 */

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
  const ctx = { module: { exports: {} }, Math: Math, Date: Date, JSON: JSON, Array: Array, Object: Object, Int8Array: Int8Array, Int32Array: Int32Array, parseInt: parseInt, isNaN: isNaN, Infinity: Infinity };
  ctx.exports = ctx.module.exports;
  vm.createContext(ctx);
  vm.runInContext(converted, ctx, { filename: ENGINE });
  return ctx.module.exports;
}

const ai = loadEngine();

function parseFen(fen) {
  const parts = fen.split(' ');
  const board = new Array(64).fill(null);
  const ranks = parts[0].split('/');
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of ranks[r]) {
      if (/\d/.test(ch)) file += parseInt(ch, 10);
      else { board[r * 8 + file] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase(); file++; }
    }
  }
  let cb = { wK: false, wQ: false, bK: false, bQ: false };
  if (parts[2] && parts[2] !== '-') {
    cb.wK = parts[2].indexOf('K') >= 0; cb.wQ = parts[2].indexOf('Q') >= 0;
    cb.bK = parts[2].indexOf('k') >= 0; cb.bQ = parts[2].indexOf('q') >= 0;
  }
  let ep = -1;
  if (parts[3] && parts[3] !== '-') {
    const f = parts[3].charCodeAt(0) - 97;
    const r = parseInt(parts[3][1], 10) - 1;
    ep = (7 - r) * 8 + f;
  }
  return { board, turn: parts[1] === 'w' ? 'w' : 'b', castling: cb, ep, halfmove: 0 };
}

function sqName(i) { return String.fromCharCode(97 + (i % 8)) + (8 - Math.floor(i / 8)); }

/* A compact tactical set. `best` lists UCI moves that count as solved. */
const TACTICS = [
  ['mate-in-1 back rank',    '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',              ['a1a8']],
  ['mate-in-1 smothered',    '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',                 ['g5f7']],
  ['mate-in-1 Qg7#',         '7k/5K1k/6Q1/8/8/8/8/8 w - - 0 1',                   null],
  ['free queen Nxg5',        'r1b1k2r/pppp1ppp/2n2n2/2b1p1q1/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 1', ['f3g5']],
  ['win a rook (fork)',      'r1bqkbnr/ppp2ppp/2n5/3pp3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', ['f3f7']],
  ['must not lose queen',    'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 0 1', null],
  ['KQ vs K, drive to edge', '8/8/8/4k3/8/8/4K3/4Q3 w - - 0 1',                   null]
];

console.log('=== engine probe ===');

/* --- nodes per second: search a fixed middlegame for a fixed wall time --- */
const NPS_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

for (const level of ['hard', 'master']) {
  ai.setLevel(level);
  const st = parseFen(NPS_FEN);
  let nodes = 0;
  let moves = 0;
  const t0 = Date.now();
  const budget = 4000;
  while (Date.now() - t0 < budget) {
    const mv = ai.compute(st.board, st.turn, st.castling, st.ep, st.halfmove);
    if (!mv) break;
    nodes += mv.points;
    moves++;
  }
  const dt = Date.now() - t0;
  console.log('nps[' + level + ']  ' + Math.round(nodes / (dt / 1000)) +
    ' nodes/s   (' + moves + ' moves in ' + dt + 'ms, avg depth ' + (moves ? Math.round(nodes / moves) : 0) + ' nodes/move)');
}

/* --- tactical accuracy --- */
for (const level of ['normal', 'hard', 'master']) {
  ai.setLevel(level);
  let solved = 0;
  let total = 0;
  const lines = [];
  for (const [name, fen, best] of TACTICS) {
    const st = parseFen(fen);
    const t0 = Date.now();
    const mv = ai.compute(st.board, st.turn, st.castling, st.ep, st.halfmove);
    const dt = Date.now() - t0;
    const uci = mv ? sqName(mv.from) + sqName(mv.to) : '(none)';
    if (best) {
      total++;
      const ok = mv && best.indexOf(uci) >= 0;
      if (ok) solved++;
      lines.push('   ' + (ok ? 'OK ' : 'MISS') + '  ' + name.padEnd(24) + uci + '  ' + dt + 'ms');
    } else {
      lines.push('   --   ' + name.padEnd(24) + uci + '  ' + dt + 'ms');
    }
  }
  console.log('[' + level + '] tactics ' + solved + '/' + total);
  for (const l of lines) console.log(l);
}
