#!/usr/bin/env node
/*
 * bench_eval.js — how expensive is the static evaluation?
 *
 * On a watch the evaluation is a large fraction of the per-node cost, so a term
 * that is "only" a few hundred extra operations per call buys real depth. A
 * search-speed benchmark is far too noisy on a shared machine to price that
 * (the same build measured 101k and 188k nodes/s on different runs), so measure
 * the evaluation itself: evaluations per second on a fixed set of positions.
 *
 * Usage:
 *   node tools/bench_eval.js [engine.js] [iterations]
 *   CHESS_AI_JS=path node tools/bench_eval.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENGINE = process.argv[2]
  ? path.resolve(process.argv[2])
  : (process.env.CHESS_AI_JS
    ? path.resolve(process.env.CHESS_AI_JS)
    : path.resolve(__dirname, '..', 'src', 'common', 'js', 'ai.js'));
const ITER = parseInt(process.argv[3], 10) || 40;

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

const fens = fs.readFileSync(path.resolve(__dirname, '_fixtures', 'eval_sample.fen'), 'utf8')
  .split(/\r?\n/).map(l => l.trim()).filter(l => l && l[0] !== '#')
  .slice(0, 200)
  .map(f => {
    const st = parseFen(f);
    return new ai.Position().load(st.board, st.turn, st.castling, st.ep, 0);
  });

/* Warm up so JIT compilation is not part of the measurement. */
for (let w = 0; w < 3; w++) for (const p of fens) ai.evaluatePos(p);

let best = Infinity;
const runs = [];
for (let r = 0; r < 5; r++) {
  const t0 = Date.now();
  for (let i = 0; i < ITER; i++) for (const p of fens) ai.evaluatePos(p);
  const ms = Date.now() - t0;
  runs.push(ms);
  if (ms < best) best = ms;
}
const total = ITER * fens.length;
runs.sort((a, b) => a - b);
console.log(path.basename(ENGINE).padEnd(12) +
  '  positions ' + fens.length + ' x ' + ITER +
  '   best ' + best + ' ms  (' + Math.round(total / best * 1000) + ' evals/s)' +
  '   median ' + runs[2] + ' ms  (' + Math.round(total / runs[2] * 1000) + ' evals/s)');
