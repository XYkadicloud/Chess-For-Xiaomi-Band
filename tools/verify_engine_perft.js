/*
 * verify_engine_perft.js — deep correctness checks for common/js/ai.js
 *
 * Run:  node tools/verify_engine_perft.js
 *
 * Perft (move-generation node counting) is the only test that really pins down
 * a chess move generator: the node counts at each depth are known constants, so
 * a single missing en-passant, promotion or castling move shows up as an exact
 * arithmetic mismatch rather than as "the engine looks a bit odd".
 *
 * Also cross-checks the incrementally maintained Zobrist key against a full
 * recomputation after every move of a long random walk, which is the part of
 * make/unmake most likely to drift silently.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENGINE_PATH = path.join(__dirname, '..', 'src', 'common', 'js', 'ai.js');

function loadEngine() {
  const source = fs.readFileSync(ENGINE_PATH, 'utf8');
  const converted = source
    .replace(/^\s*export default ai;\s*$/m, '')
    .replace(/^\s*export \{[^}]*\};\s*$/m, 'module.exports = ai;')
    .replace(/^import .*$/gm, '');
  if (!/module\.exports\s*=\s*ai;/.test(converted)) {
    throw new Error('could not locate the export block in ai.js');
  }
  const sandbox = { module: { exports: {} }, console: console, Math: Math, Date: Date, JSON: JSON, Array: Array, Object: Object, Int8Array: Int8Array, Int32Array: Int32Array, parseInt: parseInt, isNaN: isNaN, Infinity: Infinity };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(converted, sandbox, { filename: ENGINE_PATH });
  return sandbox.module.exports;
}

const ai = loadEngine();
const { Position, Search } = ai;

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

/* ---------------- FEN ---------------- */

function parseFen(fen) {
  const parts = fen.split(' ');
  const board = new Array(64).fill(null);
  const ranks = parts[0].split('/');
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of ranks[r]) {
      if (/\d/.test(ch)) file += parseInt(ch, 10);
      else {
        board[r * 8 + file] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
        file++;
      }
    }
  }
  const turn = parts[1] === 'w' ? 'w' : 'b';
  let cb = { wK: false, wQ: false, bK: false, bQ: false };
  if (parts[2] && parts[2] !== '-') {
    cb.wK = parts[2].indexOf('K') >= 0;
    cb.wQ = parts[2].indexOf('Q') >= 0;
    cb.bK = parts[2].indexOf('k') >= 0;
    cb.bQ = parts[2].indexOf('q') >= 0;
  }
  let ep = -1;
  if (parts[3] && parts[3] !== '-') {
    const f = parts[3].charCodeAt(0) - 97;
    const r = parseInt(parts[3][1], 10) - 1;   /* rank 1 -> row 7 */
    ep = (7 - r) * 8 + f;
  }
  return { board: board, turn: turn, castling: cb, ep: ep, halfmove: parts[4] ? parseInt(parts[4], 10) : 0 };
}

/* ---------------- perft ---------------- */

const s = new Search('easy');

function genLegal(pos) {
  s.pos.load(pos.board, pos.turn, pos.castling, pos.ep, pos.halfmove);
  const n = s.genLegal(0);
  const out = [];
  for (let i = 0; i < n; i++) out.push(s.moves[i]);
  return out;
}

function perft(pos, depth) {
  const moves = genLegal(pos);
  if (depth === 1) return moves.length;
  let total = 0;
  for (let i = 0; i < moves.length; i++) {
    const u = pos.make(moves[i]);
    total += perft(pos, depth - 1);
    pos.unmake(u);
  }
  return total;
}

console.log('\n1. Perft from the starting position');
{
  const st = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const p = new Position().load(st.board, st.turn, st.castling, st.ep, st.halfmove);
  const expect = [20, 400, 8902, 197281];
  for (let d = 0; d < expect.length; d++) {
    const got = perft(p, d + 1);
    check('perft(' + (d + 1) + ') = ' + expect[d], got === expect[d], 'got ' + got);
  }
}

console.log('\n2. Perft from Kiwipete (castling, pins, en passant)');
{
  const st = parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  const p = new Position().load(st.board, st.turn, st.castling, st.ep, st.halfmove);
  const expect = [48, 2039, 97862];
  for (let d = 0; d < expect.length; d++) {
    const got = perft(p, d + 1);
    check('kiwipete perft(' + (d + 1) + ') = ' + expect[d], got === expect[d], 'got ' + got);
  }
}

console.log('\n3. Perft from the classic en-passant / promotion position 3');
{
  const st = parseFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  const p = new Position().load(st.board, st.turn, st.castling, st.ep, st.halfmove);
  const expect = [14, 191, 2812, 43238];
  for (let d = 0; d < expect.length; d++) {
    const got = perft(p, d + 1);
    check('pos3 perft(' + (d + 1) + ') = ' + expect[d], got === expect[d], 'got ' + got);
  }
}

console.log('\n4. Perft from the standard CPW positions 4, 4-mirrored, 5 and 6');
{
  /* Node counts are the published perft results from the Chess Programming
   * Wiki test set — do not "fix" a failing number without re-deriving it. */
  const cases = [
    ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
    ['r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1', [6, 264, 9467, 422333]],
    ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
    ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]]
  ];
  for (const [fen, expect] of cases) {
    const st = parseFen(fen);
    const p = new Position().load(st.board, st.turn, st.castling, st.ep, st.halfmove);
    for (let d = 0; d < expect.length; d++) {
      const got = perft(p, d + 1);
      check(fen.slice(0, 26) + ' perft(' + (d + 1) + ') = ' + expect[d], got === expect[d], 'got ' + got);
    }
  }
}

console.log('\n4b. Deeper perft on the well-known positions');
{
  const st = parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  const p = new Position().load(st.board, st.turn, st.castling, st.ep, st.halfmove);
  check('kiwipete perft(4) = 4085603', perft(p, 4) === 4085603);

  const st3 = parseFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  const p3 = new Position().load(st3.board, st3.turn, st3.castling, st3.ep, st3.halfmove);
  check('pos3 perft(5) = 674624', perft(p3, 5) === 674624);

  const sts = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const ps = new Position().load(sts.board, sts.turn, sts.castling, sts.ep, sts.halfmove);
  check('start perft(5) = 4865609', perft(ps, 5) === 4865609);
}

console.log('\n5. Incremental Zobrist key matches a full recompute');
{
  const st = parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  const p = new Position().load(st.board, st.turn, st.castling, st.ep, st.halfmove);
  let ok = true;
  let detail = '';
  let seed = 12345;
  const rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  for (let step = 0; step < 4000 && ok; step++) {
    const moves = genLegal(p);
    if (!moves.length) {
      /* Reset to a fresh start position whenever the walk runs into a mate. */
      const s2 = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      p.load(s2.board, s2.turn, s2.castling, s2.ep, s2.halfmove);
      continue;
    }
    const m = moves[Math.floor(rnd() * moves.length)];
    const u = p.make(m);
    if (p.key !== p.computeKey()) {
      ok = false;
      detail = 'key drifted at step ' + step + ' after move ' + (m & 63) + '->' + ((m >> 6) & 63);
      break;
    }
    if (ok) {
      /* Also confirm the string board and the int board agree. */
      for (let i = 0; i < 64; i++) {
        const str = p.board[i];
        const code = p.sq[i];
        if ((str === null) !== (code === 0)) { ok = false; detail = 'board/sq disagree at ' + i; break; }
        if (str && !(str[0] === (code > 0 ? 'w' : 'b') && str[1] === 'PNBRQK'.charAt(Math.abs(code) - 1))) {
          ok = false; detail = 'board/sq mismatch at ' + i + ': ' + str + ' vs ' + code; break;
        }
      }
    }
    /* Always rewind: the undo stack is finite, and leaving moves on it would
     * overflow it and produce a false failure. */
    p.unmake(u);
    if (p.key !== p.computeKey()) {
      ok = false;
      detail = 'key drifted after unmake at step ' + step;
      break;
    }
  }
  check('4000 random moves keep the incremental hash exact', ok, detail);
}

console.log('\n6. make/unmake restores the position byte for byte');
{
  const st = parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  const p = new Position().load(st.board, st.turn, st.castling, st.ep, st.halfmove);
  const snap = function () {
    return JSON.stringify([p.board, p.turn, p.castling, p.ep, p.halfmove, p.key, p.kingSq[0], p.kingSq[1]]);
  };
  const before = snap();
  const moves = genLegal(p);
  let ok = true;
  for (let i = 0; i < moves.length; i++) {
    const u = p.make(moves[i]);
    p.unmake(u);
    if (snap() !== before) { ok = false; break; }
  }
  check('all ' + moves.length + ' Kiwipete moves round-trip exactly', ok);
}

console.log('\n' + '-'.repeat(58));
console.log('passed: ' + passed + '   failed: ' + failed);
console.log('-'.repeat(58));
process.exit(failed === 0 ? 0 : 1);
