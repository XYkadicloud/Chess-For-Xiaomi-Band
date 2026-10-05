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

/* A compact tactical set. `best` lists UCI moves that count as solved.
 *
 * The "scholar's mate" FEN here used to read `ppp2ppp/2n5/3pp3`, which put
 * black pawns on d5+e5 and removed the b8 knight. That is a different position
 * in which the listed answer f3f7 simply hangs the queen (Kxf7), so the engine
 * was being marked wrong for correctly declining it. This is the real
 * scholar's mate: Bc4 covers f7, so Qxf7 is checkmate. */
const TACTICS = [
  ['mate-in-1 back rank',    '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',              ['a1a8']],
  ['mate-in-1 smothered',    '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',                 ['g5f7']],
  ['mate-in-1 Qg7#',         '7k/5K2/6Q1/8/8/8/8/8 w - - 0 1',                   ['g6g7']],
  ['scholar mate Qxf7#',     'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', ['f3f7']],
  ['free queen Nxg5',        'r1b1k2r/pppp1ppp/2n2n2/2b1p1q1/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 1', ['f3g5']],
  ['must not lose queen',    'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 0 1', null],
  ['KQ vs K, drive to edge', '8/8/8/4k3/8/8/4K3/4Q3 w - - 0 1',                   null]
];

console.log('=== engine probe ===');

/* --- nodes per second ---
 *
 * Two things made the old version of this loop lie, and both are worth keeping
 * in mind before trusting any nps number out of this file:
 *
 *  1. The FEN was the Italian Game, one of the 54 book positions, so every
 *     "search" was an instant book lookup (it reported 4918 searches in 4s).
 *  2. Even out of book, looping `compute()` on the SAME position is not a
 *     benchmark: the transposition table survives between calls, so after the
 *     first real search every later one is an instant TT walk (~3ms vs 647ms).
 *
 * So: distinct positions, one cold search each, and the TT is rebuilt between
 * levels by constructing a fresh player.
 */
const NPS_FENS = [
  'r2q1rk1/pp2ppbp/2n2np1/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2Q1RK1 w - - 0 9',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'rnbq1rk1/pp2ppbp/2p2np1/3P4/2P5/2N2NP1/PP2PPBP/R1BQK2R b KQ - 0 8',
  '2rq1rk1/1p2ppbp/p1np1np1/8/2PNP3/2N1B3/PP2BPPP/2RQ1RK1 w - - 0 12',
  '8/2p2pp1/1p1k3p/p2p4/P2P3P/1PP2KP1/8/8 b - - 0 34',
  '1r4k1/5pp1/7p/8/8/6P1/5P1P/1R4K1 w - - 0 30'
];

for (const level of ['hard', 'master']) {
  let nodes = 0;
  let depthSum = 0;
  let msSum = 0;
  const t0 = Date.now();
  for (const fen of NPS_FENS) {
    /* Fresh player per position so the TT starts empty (cold search). */
    const p = new ai.AiPlayer(level);
    const st = parseFen(fen);
    const mv = p.compute(st.board, st.turn, st.castling, st.ep, st.halfmove);
    if (!mv) continue;
    nodes += mv.points;
    depthSum += mv.depth;
    msSum += mv.ms;
  }
  const dt = Date.now() - t0;
  console.log('nps[' + level + ']  ' + Math.round(nodes / (dt / 1000)) +
    ' nodes/s   (' + NPS_FENS.length + ' cold searches, ' + msSum + 'ms searching, avg depth ' +
    (depthSum / NPS_FENS.length).toFixed(1) + ', ' + Math.round(nodes / NPS_FENS.length) + ' nodes/search)');
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
