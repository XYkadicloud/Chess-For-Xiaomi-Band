#!/usr/bin/env node
/*
 * uci_bridge.js — a UCI front-end for the shared engine.
 *
 * This is a DESKTOP-ONLY calibration tool. It is never shipped in the RPK; it
 * exists so a standard match manager (python-chess) can play `src/common/js/ai.js`
 * against Stockfish and produce an actual Elo number instead of a guess.
 *
 * Usage:  node tools/uci_bridge.js          (speaks UCI on stdin/stdout)
 *
 * Options exposed to the match manager:
 *   Level     combo  easy|normal|hard|master   (which LEVELS profile to use)
 *   Movetime  spin   milliseconds per move     (overrides the profile's timeMs)
 *
 * Note the engine is synchronous and single-threaded, so `go` blocks until the
 * move is ready. That is exactly what a UCI manager expects.
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
  if (!/module\.exports\s*=\s*ai;/.test(converted)) throw new Error('no export block in ai.js');
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

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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
  return { board, turn: parts[1] === 'w' ? 'w' : 'b', castling: cb, ep, halfmove: parseInt(parts[4], 10) || 0 };
}

const sqName = (i) => String.fromCharCode(97 + (i & 7)) + (8 - (i >> 3));
const PROMO_LETTER = { 2: 'n', 3: 'b', 4: 'r', 5: 'q' };

function moveToUci(mv) {
  let s = sqName(mv.from) + sqName(mv.to);
  if (mv.promo) s += PROMO_LETTER[mv.promo];
  return s;
}

/* ---- engine state ---- */
let level = 'master';
let movetime = 1000;
let player = null;

function rebuild() {
  /* The profile object is shared, so patch the copy before the player reads it. */
  if (ai.LEVELS[level]) ai.LEVELS[level].timeMs = movetime;
  player = new ai.AiPlayer(level);
  player.setLevel(level);
}

rebuild();

/* ---- game state ---- */
let pos = new ai.Position();

function loadPosition(tokens) {
  const movesAt = tokens.indexOf('moves');
  const head = movesAt >= 0 ? tokens.slice(0, movesAt) : tokens.slice();
  const tail = movesAt >= 0 ? tokens.slice(movesAt + 1) : [];

  let st;
  if (head[0] === 'startpos') st = parseFen(START_FEN);
  else if (head[0] === 'fen') st = parseFen(head.slice(1).join(' '));
  else st = parseFen(START_FEN);

  pos = new ai.Position();
  pos.load(st.board, st.turn, st.castling, st.ep, st.halfmove);

  for (const u of tail) {
    const legal = pos.legalMoves();
    const want = u.slice(0, 4);
    const promoCh = u.length > 4 ? u[4] : null;
    let found = null;
    for (const mv of legal) {
      if (sqName(mv.from) + sqName(mv.to) !== want) continue;
      if (promoCh && PROMO_LETTER[mv.promo] !== promoCh) continue;
      found = mv; break;
    }
    if (!found) throw new Error('illegal move in position command: ' + u);
    pos.make(found);
  }
}

function timeForGo(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === 'movetime') return parseInt(tokens[i + 1], 10) || movetime;
  }
  const mine = pos.turn === 'w';
  const t = tokens.indexOf(mine ? 'wtime' : 'btime');
  const inc = tokens.indexOf(mine ? 'winc' : 'binc');
  if (t >= 0) {
    const left = parseInt(tokens[t + 1], 10) || 0;
    const add = inc >= 0 ? (parseInt(tokens[inc + 1], 10) || 0) : 0;
    return Math.max(10, Math.min(60000, Math.floor(left / 30) + add));
  }
  return movetime;
}

function go(tokens) {
  const ms = timeForGo(tokens);
  if (ai.LEVELS[level]) ai.LEVELS[level].timeMs = ms;
  player = new ai.AiPlayer(level);
  const mv = player.compute(pos.board, pos.turn, pos.castling, pos.ep, pos.halfmove);
  if (!mv) { out('bestmove 0000'); return; }
  out('bestmove ' + moveToUci(mv));
}

const out = (s) => process.stdout.write(s + '\n');

/* ---- UCI loop ---- */
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const tk = line.split(/\s+/);
    try {
      switch (tk[0]) {
        case 'uci':
          out('id name ChessForXiaomiBand ' + level);
          out('id author XYKadi');
          out('option name Level type combo default master var easy var normal var hard var master');
          out('option name Movetime type spin default 1000 min 10 max 60000');
          out('uciok');
          break;
        case 'isready': out('readyok'); break;
        case 'ucinewgame': rebuild(); break;
        case 'setoption': {
          const ni = tk.indexOf('name'), vi = tk.indexOf('value');
          if (ni >= 0 && vi >= 0) {
            const name = tk.slice(ni + 1, vi).join(' ');
            const value = tk.slice(vi + 1).join(' ');
            if (name === 'Level') { level = value; rebuild(); }
            else if (name === 'Movetime') { movetime = parseInt(value, 10) || 1000; rebuild(); }
          }
          break;
        }
        case 'position': loadPosition(tk.slice(1)); break;
        case 'go': go(tk.slice(1)); break;
        case 'quit': process.exit(0); break;
        default: break;
      }
    } catch (e) {
      /* Never die silently: a manager that gets no answer just hangs. */
      out('info string bridge error: ' + (e && e.message ? e.message : String(e)));
      out('bestmove 0000');
    }
  }
});
process.stdin.on('end', () => process.exit(0));
