#!/usr/bin/env node
/* Throwaway probe: correlation under the two possible sign conventions. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

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
  if (parts[3] && parts[3] !== '-') {
    ep = (7 - (parseInt(parts[3][1], 10) - 1)) * 8 + (parts[3].charCodeAt(0) - 97);
  }
  return { board, turn: parts[1] === 'w' ? 'w' : 'b', castling: cb, ep };
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
const DEPTH = parseInt(process.argv[3], 10) || 2;
const FEN_FILE = process.argv[4] || path.resolve(__dirname, '_fixtures', 'eval_sample.fen');

const fens = fs.readFileSync(FEN_FILE, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && l[0] !== '#');
const script = fens.map(f => 'position fen ' + f + '\ngo depth ' + DEPTH).join('\n') + '\nquit\n';
const res = spawnSync(sfPath, [], { input: script, encoding: 'utf8', maxBuffer: 1 << 28 });
const sf = [];
let last = null;
for (const line of res.stdout.split(/\r?\n/)) {
  const m = line.match(/^info .*\bscore (cp|mate) (-?\d+)/);
  if (m) { last = m[1] === 'mate' ? (parseInt(m[2], 10) > 0 ? 10000 : -10000) : parseInt(m[2], 10); continue; }
  if (line.startsWith('bestmove')) { sf.push(last); last = null; }
}

const asIs = [], flipped = [];
for (let i = 0; i < fens.length; i++) {
  const st = parseFen(fens[i]);
  const pos = new ai.Position().load(st.board, st.turn, st.castling, st.ep, 0);
  const raw = ai.evaluatePos(pos);            /* side-to-move POV */
  asIs.push(raw);                              /* == what SF reports */
  flipped.push(raw * (st.turn === 'w' ? 1 : -1)); /* what the checker computed */
}

function mae(a, b) { return a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length; }
function bias(a, b) { return a.reduce((s, v, i) => s + (v - b[i]), 0) / a.length; }

console.log('positions ' + fens.length + '   sf depth ' + DEPTH);
console.log('convention "as-is"  (stm POV)   r=' + pearson(asIs, sf).toFixed(3) +
  '  MAE=' + mae(asIs, sf).toFixed(0) + '  bias=' + bias(asIs, sf).toFixed(0));
console.log('convention "flipped"(white POV) r=' + pearson(flipped, sf).toFixed(3) +
  '  MAE=' + mae(flipped, sf).toFixed(0) + '  bias=' + bias(flipped, sf).toFixed(0));

/* White-to-move subset only — where both conventions agree. */
const aw = [], fw = [], sw = [];
for (let i = 0; i < fens.length; i++) {
  if (parseFen(fens[i]).turn !== 'w') continue;
  aw.push(asIs[i]); fw.push(flipped[i]); sw.push(sf[i]);
}
console.log('white-to-move only (' + aw.length + '): as-is r=' + pearson(aw, sw).toFixed(3) +
  '   flipped r=' + pearson(fw, sw).toFixed(3));
