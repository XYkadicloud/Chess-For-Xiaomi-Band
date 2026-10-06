#!/usr/bin/env node
/*
 * _probe_control.js — sanity control for the eval-quality metric.
 *
 * Before trusting "our r = 0.47", check what a trivially simple evaluation
 * scores on the same fixture with the same reference. If material-only scores
 * the same, the metric is measuring the reference's noise, not our evaluation.
 *
 * Also reports a "quiet only" subset: positions where Stockfish's shallow score
 * agrees with its own deep score. On those the shallow score is a trustworthy
 * oracle; on the rest it is not, and including them measures tactics instead.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ENGINE = path.resolve(__dirname, '..', 'src', 'common', 'js', 'ai.js');
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
  return { board, turn: parts[1] === 'w' ? 'w' : 'b', castling: cb };
}

const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

function materialOnly(st) {
  let s = 0;
  for (const p of st.board) {
    if (!p) continue;
    const v = VAL[p[1]];
    s += p[0] === 'w' ? v : -v;
  }
  return (st.turn === 'w' ? 1 : -1) * s;
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
function mae(a, b) { return a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length; }

const sfPath = process.argv[2];
const ALL = fs.readFileSync(process.argv[3] || path.resolve(__dirname, '_fixtures', 'eval_sample.fen'),
  'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && l[0] !== '#');
/* Deep reference scores are expensive; take every Nth position. */
const STRIDE = parseInt(process.argv[4], 10) || 4;
const fens = ALL.filter((_, i) => i % STRIDE === 0);

function sfBatch(depth) {
  const script = fens.map(f => 'position fen ' + f + '\ngo depth ' + depth).join('\n') + '\nquit\n';
  const res = spawnSync(sfPath, [], { input: script, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = [];
  let last = null;
  for (const line of res.stdout.split(/\r?\n/)) {
    const m = line.match(/^info .*\bscore (cp|mate) (-?\d+)/);
    if (m) { last = m[1] === 'mate' ? (parseInt(m[2], 10) > 0 ? 10000 : -10000) : parseInt(m[2], 10); continue; }
    if (line.startsWith('bestmove')) { out.push(last); last = null; }
  }
  return out;
}

const d2 = sfBatch(2);
const d4 = sfBatch(4);
const d10 = sfBatch(10);
const d16 = sfBatch(12);

const ours = [], mat = [], quietOurs = [], quietMat = [], quietSf = [];
let nq = 0;
for (let i = 0; i < fens.length; i++) {
  const st = parseFen(fens[i]);
  const pos = new ai.Position().load(st.board, st.turn, st.castling, -1, 0);
  const o = ai.evaluatePos(pos);
  const m = materialOnly(st);
  ours.push(o); mat.push(m);
  if (Math.abs(d2[i] - d10[i]) <= 50) {
    nq++;
    quietOurs.push(o); quietMat.push(m); quietSf.push(d2[i]);
  }
}

console.log('positions ' + fens.length + '   quiet ' + nq);
console.log();
console.log('--- how trustworthy is each Stockfish depth as an oracle? ---');
console.log('r(sf d2, sf d12)   ' + pearson(d2, d16).toFixed(3));
console.log('r(sf d4, sf d12)   ' + pearson(d4, d16).toFixed(3));
console.log('r(sf d10, sf d12)  ' + pearson(d10, d16).toFixed(3));
console.log();
console.log('--- static evals vs each oracle ---');
for (const [name, ref] of [['d2', d2], ['d4', d4], ['d10', d10], ['d16', d16]]) {
  console.log('oracle sf ' + name.padEnd(4) +
    '  material r ' + pearson(mat, ref).toFixed(3) + ' MAE ' + mae(mat, ref).toFixed(0) +
    '   |   ours r ' + pearson(ours, ref).toFixed(3) + ' MAE ' + mae(ours, ref).toFixed(0));
}
console.log();
console.log('--- reference: Stockfish depth 2, quiet positions only ---');
console.log('material only   r ' + pearson(quietMat, quietSf).toFixed(3) + '   MAE ' + mae(quietMat, quietSf).toFixed(0));
console.log('our full eval   r ' + pearson(quietOurs, quietSf).toFixed(3) + '   MAE ' + mae(quietOurs, quietSf).toFixed(0));
