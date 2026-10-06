#!/usr/bin/env node
/*
 * check_eval_quality.js — is the engine's static evaluation actually any good?
 *
 * A search can only be as good as the thing it is searching with. If the static
 * eval disagrees badly with a strong engine, no amount of extra depth fixes it,
 * and the engine will keep making the same positional mistakes forever.
 *
 * This samples real positions, asks the engine for its static score and asks
 * Stockfish for a deep score, then reports the correlation and the worst
 * disagreements. Run it after ANY evaluation change.
 *
 * Run:  node tools/check_eval_quality.js <stockfish-path> [sampleSize]
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

/* CHESS_AI_JS lets the same checks run against a candidate file, which is how a
 * proposed evaluation change is compared with the current one before it is
 * accepted into src/common/js/ai.js. */
const ENGINE = process.env.CHESS_AI_JS
  ? path.resolve(process.env.CHESS_AI_JS)
  : path.resolve(__dirname, '..', 'src', 'common', 'js', 'ai.js');

function loadEngine() {
  const src = fs.readFileSync(ENGINE, 'utf8');
  const converted = src
    .replace(/^\s*export default ai;\s*$/m, '')
    .replace(/^\s*export \{[^}]*\};\s*$/m, 'module.exports = ai;')
    .replace(/^import .*$/gm, '');
  if (!/module\.exports\s*=\s*ai;/.test(converted)) throw new Error('no export block');
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

/* Positions chosen to span the range the engine actually meets: normal openings,
 * quiet middlegames, sharp middlegames, and endgames. Static eval is meaningless
 * in a position where the side to move has a big tactic available, so these are
 * deliberately quiet. */
const FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1',
  'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
  'r2q1rk1/pp2ppbp/2n2np1/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2Q1RK1 w - - 0 9',
  'r2q1rk1/pp2ppbp/2n2np1/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2Q1RK1 b - - 0 9',
  'rnbq1rk1/pp2ppbp/2p2np1/3P4/2P5/2N2NP1/PP2PPBP/R1BQK2R b KQ - 0 8',
  '2rq1rk1/1p2ppbp/p1np1np1/8/2PNP3/2N1B3/PP2BPPP/2RQ1RK1 w - - 0 12',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p2pp1/1p1k3p/p2p4/P2P3P/1PP2KP1/8/8 b - - 0 34',
  '1r4k1/5pp1/7p/8/8/6P1/5P1P/1R4K1 w - - 0 30',
  '8/8/8/4k3/8/8/4K3/4Q3 w - - 0 1',
  '8/8/8/4k3/8/8/4K3/R7 w - - 0 1',
  '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
  'r1bqkb1r/pp1n1ppp/2p1pn2/3p4/2PP4/2N1PN2/PP3PPP/R1BQKB1R w KQkq - 0 7',
  'rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq d6 0 3',
  '2kr3r/ppp2ppp/2n5/3q4/3P4/2N5/PPP2PPP/2KR3R w - - 0 12',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
  '6k1/5p1p/6p1/8/8/6P1/5P1P/6K1 w - - 0 1',
  '8/8/p7/1p6/1P6/P7/8/4K1k1 w - - 0 1',
  'r1bq1rk1/pp3ppp/2n1pn2/2bp4/8/1PN1PN2/PBPPBPPP/R2Q1RK1 w - - 0 9'
];

function parseFen(fen) {
  const parts = fen.trim().split(/\s+/);
  const board = new Array(64).fill(null);
  const ranks = parts[0].split('/');
  if (ranks.length !== 8) throw new Error('FEN must have 8 ranks: ' + fen);
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
  if (parts[3] && parts[3] !== '-') {
    ep = (7 - (parseInt(parts[3][1], 10) - 1)) * 8 + (parts[3].charCodeAt(0) - 97);
  }
  return { board, turn: parts[1] === 'w' ? 'w' : 'b', castling: cb, ep, halfmove: 0 };
}

/* Ask Stockfish for a deep score for every FEN in one batch. */
function stockfishScores(sfPath, fens, depth) {
  const script = fens.map((fen, i) =>
    'position fen ' + fen + '\ngo depth ' + depth).join('\n') + '\nquit\n';
  const res = spawnSync(sfPath, [], { input: script, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (res.error) throw res.error;
  const lines = res.stdout.split(/\r?\n/);
  const scores = [];
  let lastCp = null;
  let turn = 0;
  for (const line of lines) {
    const m = line.match(/^info .*\bscore (cp|mate) (-?\d+)/);
    if (m) {
      lastCp = m[1] === 'mate' ? (parseInt(m[2], 10) > 0 ? 10000 : -10000) : parseInt(m[2], 10);
      continue;
    }
    if (line.startsWith('bestmove')) {
      scores.push(lastCp);
      lastCp = null;
      turn++;
    }
  }
  return scores;
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

const sfPath = process.argv[2];
/* Compare against a SHALLOW Stockfish, not a deep one.
 *
 * A static eval is not supposed to predict the result of a 14-ply search: in
 * "4k3/8/8/8/8/8/4P3/4K3 w" our eval says "+1 pawn" and a deep search says
 * "+65 pawns, it is a forced win", and both are correct for what they are.
 * Scoring our eval against SF's deep score therefore measures the wrong thing.
 * SF at depth 2 is quasi-static, so the comparison is like-for-like. */
const DEPTH = parseInt(process.argv[3], 10) || 2;
/* Optional: a file with one FEN per line (e.g. extracted from real games) to
 * replace the built-in sample. 20 hand-picked positions is not enough to tell a
 * real regression from noise. */
const FEN_FILE = process.argv[4];
if (!sfPath) {
  console.error('usage: node tools/check_eval_quality.js <stockfish-path> [sfDepth] [fenFile]');
  process.exit(2);
}

const fens = FEN_FILE
  ? fs.readFileSync(FEN_FILE, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && l[0] !== '#')
  : FENS;

const sfScores = stockfishScores(sfPath, fens, DEPTH);
if (sfScores.length !== fens.length) {
  console.error('Stockfish returned ' + sfScores.length + ' scores for ' + fens.length + ' positions');
  process.exit(1);
}

const ours = [];
const theirs = [];
const rows = [];
for (let i = 0; i < fens.length; i++) {
  const st = parseFen(fens[i]);
  const pos = new ai.Position().load(st.board, st.turn, st.castling, st.ep, 0);
  /* evaluatePos already returns a side-to-move-relative score (it ends with
   * `return pos.wtm ? score : -score`), which is the same convention as
   * Stockfish's UCI output. Do NOT multiply by the turn sign again: with the
   * previous fixture — which happened to be 100% white-to-move — the double
   * negation cancelled and the bug stayed invisible, and on a mixed sample it
   * flips every black-to-move position and wrecks the correlation. */
  const ourCp = ai.evaluatePos(pos);
  ours.push(ourCp);
  theirs.push(sfScores[i]);
  rows.push({ fen: fens[i], turn: st.turn, our: ourCp, sf: sfScores[i], diff: ourCp - sfScores[i] });
}

const r = pearson(ours, theirs);
const mae = rows.reduce((a, x) => a + Math.abs(x.diff), 0) / rows.length;
const bias = rows.reduce((a, x) => a + x.diff, 0) / rows.length;
const meanSf = theirs.reduce((a, b) => a + Math.abs(b), 0) / theirs.length;

/* Split by side to move. A score-convention error shows up as one half being
 * excellent and the other half being anti-correlated, so print both halves
 * rather than only the pooled number. */
const wRows = rows.filter(x => x.turn === 'w');
const bRows = rows.filter(x => x.turn === 'b');
function sub(rs) {
  if (rs.length < 4) return 'n/a';
  const a = rs.map(x => x.our), b = rs.map(x => x.sf);
  const d = rs.map(x => Math.abs(x.diff));
  const spread = b.reduce((s, v) => s + Math.abs(v), 0) / rs.length;
  return 'r ' + pearson(a, b).toFixed(3) +
    '  MAE ' + (d.reduce((s, v) => s + v, 0) / rs.length).toFixed(0) + ' cp' +
    '  spread ' + spread.toFixed(0) + ' cp';
}

function pad(v, w) {
  const s = (v >= 0 ? '+' : '') + v;
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

console.log('=== static eval vs Stockfish depth ' + DEPTH + ' (centipawns, side-to-move POV) ===');
console.log('positions        ' + rows.length +
  '   (white to move ' + wRows.length + ', black to move ' + bRows.length + ')');
console.log('correlation r    ' + r.toFixed(3) + '   (a decent eval is > 0.85)');
console.log('mean abs error   ' + mae.toFixed(0) + ' cp');
console.log('mean bias        ' + (bias >= 0 ? '+' : '') + bias.toFixed(0) + ' cp');
console.log('mean |sf score|  ' + meanSf.toFixed(0) + ' cp   (how much is actually at stake)');
console.log('  white to move  ' + sub(wRows));
console.log('  black to move  ' + sub(bRows));
console.log();
console.log('worst disagreements:');
rows.slice().sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 10).forEach(x => {
  console.log('  ours ' + pad(x.our, 7) + '   sf ' + pad(x.sf, 7) +
    '   diff ' + pad(x.diff, 7) + '   ' + x.turn + '  ' + x.fen.slice(0, 44));
});
