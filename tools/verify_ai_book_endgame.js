/*
 * verify_ai_book_endgame.js — checks the opening book and the built-in endgame
 * prediction in common/js/ai.js.
 *
 * Run:  node tools/verify_ai_book_endgame.js
 *
 * Two things are easy to get wrong here and both are silent on a device:
 *   - a book that fires on the wrong position (the old implementation guessed
 *     from "which pawn left its home rank", so any position with one pawn
 *     missing looked like an opening);
 *   - an endgame term that is present but never actually converts, e.g. a mate
 *     drive that pushes the king around for 50 moves without mating.
 * So the book is checked by move set per position, and the endgames are checked
 * by actually playing them out to mate.
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
  if (!/module\.exports\s*=\s*ai;/.test(converted)) throw new Error('no export block');
  const sandbox = { module: { exports: {} }, console: console, Math: Math, Date: Date, JSON: JSON, Array: Array, Object: Object, Int8Array: Int8Array, Int32Array: Int32Array, parseInt: parseInt, isNaN: isNaN, Infinity: Infinity };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(converted, sandbox, { filename: ENGINE_PATH });
  return sandbox.module.exports;
}

const ai = loadEngine();
const { Position, LEVELS } = ai;

/* Keep the endgame play-outs quick: the point is whether the technique
 * converts, not how long it takes. */
LEVELS.hard.timeMs = 250;
LEVELS.normal.timeMs = 250;

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

function parseFen(fen) {
  const parts = fen.split(' ');
  const board = new Array(64).fill(null);
  const ranks = parts[0].split('/');
  /* A FEN with the wrong number of ranks used to parse "successfully" while
   * silently dropping the extra row, which produced a position with no pieces
   * where the fixture intended a rook. Fail instead. */
  if (ranks.length !== 8) throw new Error('FEN must have 8 ranks, got ' + ranks.length + ': ' + fen);
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
function uci(m) { return sqName(m.from) + sqName(m.to); }

/* Play one engine move on `pos` and return it. */
function engineMove(pos, level) {
  ai.setLevel(level);
  const mv = ai.compute(pos.board, pos.turn, pos.castling, pos.ep, pos.halfmove);
  /* compute() swallows engine exceptions so the game page stays alive; a test
   * must not. Without this an engine crash looks exactly like "no book move". */
  if (ai.lastError()) throw ai.lastError();
  if (!mv) return null;
  const legal = pos.legalMoves().filter(function (m) {
    return m.from === mv.from && m.to === mv.to && (m.promo || 0) === (mv.promo || 0);
  });
  if (!legal.length) return null;
  pos.make(legal[0]);
  return mv;
}

/* ---------------- 1. opening book ---------------- */

console.log('\n1. Opening book replies');
{
  /* From the start position the repertoire must offer only real first moves. */
  const first = [];
  for (let i = 0; i < 40; i++) {
    const st = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const pos = new Position().load(st.board, st.turn, st.castling, st.ep, 0);
    const mv = engineMove(pos, 'normal');
    if (mv) first.push(uci(mv));
  }
  const uniqFirst = first.filter(function (v, i) { return first.indexOf(v) === i; });
  const allowedFirst = ['e2e4', 'd2d4', 'c2c4', 'g1f3', 'b1c3'];
  check('every book first move is real theory',
    uniqFirst.every(function (m) { return allowedFirst.indexOf(m) >= 0; }),
    'got ' + uniqFirst.join(','));
  check('the book varies its first move', uniqFirst.length >= 2, 'got ' + uniqFirst.join(','));

  /* Black's answers to each of White's first moves. */
  const answers = {
    e2e4: ['e7e5', 'c7c5', 'e7e6', 'c7c6', 'd7d5', 'g8f6', 'd7d6'],
    d2d4: ['d7d5', 'g8f6', 'e7e6', 'f7f5'],
    c2c4: ['e7e5', 'g8f6', 'c7c5', 'e7e6'],
    g1f3: ['d7d5', 'g8f6'],
    b1c3: ['e7e5', 'd7d5']
  };
  for (const w of allowedFirst) {
    const seen = {};
    for (let i = 0; i < 40; i++) {
      const st = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      const pos = new Position().load(st.board, st.turn, st.castling, st.ep, 0);
      const legalW = pos.legalMoves().filter(function (m) { return uci(m) === w; });
      pos.make(legalW[0]);
      const mv = engineMove(pos, 'normal');
      if (mv) seen[uci(mv)] = true;
    }
    const keys = Object.keys(seen);
    const ok = keys.length > 0 && keys.every(function (m) { return answers[w].indexOf(m) >= 0; });
    check('black answers ' + w + ' with a book move',
      ok, 'got ' + (keys.join(',') || '(none)'));
  }
}

console.log('\n2. Book follows main-line theory several plies deep');
{
  /* 1.e4 e5 2.Nf3 Nc6 3.Bb5 -> the book continues with ...a6 (Morphy). */
  const st = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const pos = new Position().load(st.board, st.turn, st.castling, st.ep, 0);
  const play = function (u) {
    const legal = pos.legalMoves().filter(function (m) { return uci(m) === u; });
    if (!legal.length) throw new Error('fixture move ' + u + ' is not legal');
    pos.make(legal[0]);
  };
  play('e2e4'); play('e7e5'); play('g1f3'); play('b8c6'); play('f1b5');
  const mv = engineMove(pos, 'normal');
  check('after 1.e4 e5 2.Nf3 Nc6 3.Bb5 the book plays ...a6',
    mv && uci(mv) === 'a7a6', mv ? uci(mv) : '(none)');

  /* Same position reached by a different move order is still recognised,
   * because the lookup is on the position, not on the move sequence. */
  const st2 = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const p2 = new Position().load(st2.board, st2.turn, st2.castling, st2.ep, 0);
  const play2 = function (u) {
    const legal = p2.legalMoves().filter(function (m) { return uci(m) === u; });
    p2.make(legal[0]);
  };
  /* 1.Nf3 Nc6 2.e4 e5 3.Bb5 reaches the same Ruy position. */
  play2('g1f3'); play2('b8c6'); play2('e2e4'); play2('e7e5'); play2('f1b5');
  const mv2 = engineMove(p2, 'normal');
  check('the same position reached by transposition is still in book',
    mv2 && uci(mv2) === 'a7a6', mv2 ? uci(mv2) : '(none)');
}

console.log('\n3. The book does not fire outside its lines');
{
  /* 1.e4 d5 2.exd5 is a capture, so no line covers it. The engine must still
   * produce a legal move, and must not claim a book reply. */
  const st = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const pos = new Position().load(st.board, st.turn, st.castling, st.ep, 0);
  const play = function (u) {
    const legal = pos.legalMoves().filter(function (m) { return uci(m) === u; });
    pos.make(legal[0]);
  };
  play('e2e4'); play('d7d5'); play('e4d5');
  const before = pos.board.join('|');
  ai.setLevel('normal');
  const mv = ai.compute(pos.board, pos.turn, pos.castling, pos.ep, pos.halfmove);
  check('a position outside the book still gets a legal move', !!mv, 'got null');
  if (mv) {
    const legal = pos.legalMoves().some(function (m) {
      return m.from === mv.from && m.to === mv.to && (m.promo || 0) === (mv.promo || 0);
    });
    check('that move is legal', legal, uci(mv));
    check('searching did not mutate the caller board', pos.board.join('|') === before);
  }
}

console.log('\n4. Insufficient material is scored as a draw');
{
  const cases = [
    ['bare kings', '8/8/8/4k3/8/8/4K3/8 w - - 0 1'],
    ['K+N vs K', '8/8/8/4k3/8/8/4K3/5N2 w - - 0 1'],
    ['K+B vs K', '8/8/8/4k3/8/8/4K3/5B2 w - - 0 1'],
    ['K+N vs K+N', '8/8/8/3nk3/8/8/4K3/5N2 w - - 0 1']
  ];
  for (const [name, fen] of cases) {
    const st = parseFen(fen);
    const score = ai.evaluate(st.board, st.turn, st.castling, st.ep, 0);
    check(name + ' evaluates as a draw', score === 0, 'got ' + score);
  }
  /* Sanity: K+B vs K+N is not a forced draw in the same trivial sense but it
   * also has no pawns and one minor each, so it is scored 0 as well — assert
   * only that a materially decided position is NOT flattened. */
  const stq = parseFen('8/8/8/4k3/8/8/4K3/4Q3 w - - 0 1');
  const sq2 = ai.evaluate(stq.board, stq.turn, stq.castling, stq.ep, 0);
  check('K+Q vs K is not flattened to a draw', Math.abs(sq2) > 7, 'got ' + sq2);
}

console.log('\n5. KP vs K: rule of the square');
{
  /* White pawn a5, kings far away: the pawn runs and nothing can stop it. */
  const win = parseFen('8/8/8/P7/8/8/8/K6k w - - 0 1');
  const s1 = ai.evaluate(win.board, win.turn, win.castling, win.ep, 0);
  /* White pawn a5 but the black king sits right in front of it on a7. */
  const stop = parseFen('k7/8/8/P7/8/8/8/K7 w - - 0 1');
  const s2 = ai.evaluate(stop.board, stop.turn, stop.castling, stop.ep, 0);
  check('an unopposed outside passer is scored as winning', s1 > 2, 'got ' + s1);
  check('the same pawn with the king in front is not', s2 < 2, 'got ' + s2);
}

console.log('\n6. Mate drive actually converts: K+Q vs K');
{
  const st = parseFen('8/8/8/4k3/8/8/4K3/4Q3 w - - 0 1');
  const pos = new Position().load(st.board, st.turn, st.castling, st.ep, 0);
  let plies = 0;
  let mate = false;
  for (; plies < 120; plies++) {
    const legal = pos.legalMoves();
    if (!legal.length) { mate = pos.inCheck(pos.turn); break; }
    if (!engineMove(pos, 'hard')) break;
  }
  check('K+Q vs K is mated within 60 moves', mate, 'gave up after ' + plies + ' plies');
}

console.log('\n7. Mate drive actually converts: K+R vs K');
{
  const st = parseFen('8/8/8/4k3/8/8/4K3/4R3 w - - 0 1');
  const pos = new Position().load(st.board, st.turn, st.castling, st.ep, 0);
  let plies = 0;
  let mate = false;
  for (; plies < 160; plies++) {
    const legal = pos.legalMoves();
    if (!legal.length) { mate = pos.inCheck(pos.turn); break; }
    if (!engineMove(pos, 'hard')) break;
  }
  check('K+R vs K is mated within 80 moves', mate, 'gave up after ' + plies + ' plies');
}

console.log('\n8. The mating side never stalemates a bare king');
{
  /* A common way to lose a won endgame: the "drive" term pushes the defender
   * into a corner with no legal move. Search should see stalemate = 0. */
  const starts = [
    '8/8/8/4k3/8/8/4K3/4Q3 w - - 0 1',
    '8/8/4k3/8/8/8/4K3/6Q1 w - - 0 1',
    'k7/8/8/8/8/8/4K3/6Q1 w - - 0 1'
  ];
  let stalemates = 0;
  for (const fen of starts) {
    const st = parseFen(fen);
    const pos = new Position().load(st.board, st.turn, st.castling, st.ep, 0);
    for (let i = 0; i < 80; i++) {
      const legal = pos.legalMoves();
      if (!legal.length) {
        if (!pos.inCheck(pos.turn)) stalemates++;
        break;
      }
      if (!engineMove(pos, 'hard')) break;
    }
  }
  check('no stalemate from three won K+Q positions', stalemates === 0, stalemates + ' stalemate(s)');
}

console.log('\n' + '-'.repeat(58));
console.log('passed: ' + passed + '   failed: ' + failed);
console.log('-'.repeat(58));
process.exit(failed === 0 ? 0 : 1);
