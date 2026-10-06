#!/usr/bin/env node
/* Throwaway probe: is evaluatePos() side-to-move relative or white relative?
 * And which convention does check_eval_quality.js actually compare? */
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

function sfScore(sfPath, fen, depth) {
  const res = spawnSync(sfPath, [], {
    input: 'position fen ' + fen + '\ngo depth ' + depth + '\nquit\n',
    encoding: 'utf8'
  });
  let last = null;
  for (const line of res.stdout.split(/\r?\n/)) {
    const m = line.match(/^info .*\bscore (cp|mate) (-?\d+)/);
    if (m) last = m[1] === 'mate' ? (parseInt(m[2], 10) > 0 ? 10000 : -10000) : parseInt(m[2], 10);
  }
  return last;
}

const CASES = [
  'r2q1rk1/pp2ppbp/2n2np1/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2Q1RK1 b - - 0 9',
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1',
  '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1',
  '8/8/8/4k3/8/8/4K3/4Q3 b - - 0 1',
  '1r4k1/5pp1/7p/8/8/6P1/5P1P/1R4K1 b - - 0 30'
];
const SF = process.argv[2];

for (const fen of CASES) {
  const st = parseFen(fen);
  const pos = new ai.Position().load(st.board, st.turn, st.castling, st.ep, 0);
  const raw = ai.evaluatePos(pos);
  const whitePov = st.turn === 'w' ? raw : -raw;
  const stmPov = raw;
  const sf = SF ? sfScore(SF, fen, 2) : null;
  console.log('fen       ' + fen);
  console.log('  turn=' + st.turn + '  pos.wtm=' + pos.wtm +
    '  raw=' + raw + '  whitePov=' + whitePov + '  stmPov=' + stmPov +
    '  sf(stm)=' + sf);
}
