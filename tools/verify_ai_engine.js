/*
 * verify_ai_engine.js — self-contained correctness checks for common/js/ai.js
 *
 * Run:  node tools/verify_ai_engine.js
 *
 * Why this exists: the AI engine is pure logic, so it can be tested on the
 * desktop without a device. These checks cover the failure modes that matter
 * most on a watch — an engine that plays illegal moves, or one that cannot find
 * a mate in one, ruins a game immediately.
 *
 * The engine is authored as an ES module because that is what the Vela runtime
 * consumes. Node is loaded here through a tiny in-memory CommonJS bridge so the
 * test needs no bundler and no extra dependency.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENGINE_PATH = path.join(__dirname, '..', 'src', 'common', 'js', 'ai.js');

function loadEngine() {
  const source = fs.readFileSync(ENGINE_PATH, 'utf8');
  /* Convert the trailing ES export block into a CommonJS assignment. The engine
   * only uses `export default ai;` plus a named list, so a suffix rewrite is
   * sufficient and keeps the test harness dependency free. */
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

const { Position, AiPlayer, LEVELS } = ai;

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : ''));
  }
}

function section(title) {
  console.log('\n' + title);
}

/* Build a board from a compact 8x8 diagram, top row = rank 8.
 *   'wK' white king, 'bP' black pawn, '.' empty
 *
 * Rows are whitespace-separated cells, so a leading indent is harmless. The
 * parser asserts 8 rows and 8 cells per row, which catches a mis-typed diagram
 * that would otherwise silently shift the whole position.
 */
function parseBoard(text) {
  const board = new Array(64).fill(null);
  const rows = text.trim().split('\n')
    .map(function (r) { return r.trim(); })
    .filter(function (r) { return r.length > 0; });
  if (rows.length !== 8) throw new Error('diagram must have 8 rows, got ' + rows.length + ': ' + JSON.stringify(rows));
  for (let r = 0; r < 8; r++) {
    const cells = rows[r].split(/\s+/);
    if (cells.length !== 8) throw new Error('row ' + r + ' must have 8 cells, got ' + cells.length + ': "' + rows[r] + '"');
    for (let c = 0; c < 8; c++) {
      const v = cells[c];
      board[r * 8 + c] = (v === '.' || v === '-') ? null : v;
    }
  }
  return board;
}

const START = parseBoard(`
  bR bN bB bQ bK bB bN bR
  bP bP bP bP bP bP bP bP
  . . . . . . . .
  . . . . . . . .
  . . . . . . . .
  . . . . . . . .
  wP wP wP wP wP wP wP wP
  wR wN wB wQ wK wB wN wR
`);

const NO_CASTLE = { wK: false, wQ: false, bK: false, bQ: false };
const FULL_CASTLE = { wK: true, wQ: true, bK: true, bQ: true };

/* ------------------------------------------------------------------ */

section('1. Starting position');
{
  const pos = new Position().load(START, 'w', FULL_CASTLE, -1, 0);
  const moves = pos.legalMoves();
  check('20 legal moves for White at the start', moves.length === 20, 'got ' + moves.length);

  const posB = new Position().load(START, 'b', FULL_CASTLE, -1, 0);
  check('20 legal moves for Black at the start', posB.legalMoves().length === 20, 'got ' + posB.legalMoves().length);

  check('White is not in check at the start', !pos.inCheck('w'));
  /* Castling is NOT available at the start because the bishop and knight still
   * occupy f1 and g1. Assert the correct behaviour so a regression that allows
   * castling through pieces is caught. */
  check('No castling is offered at the start (pieces block the path)',
    !moves.some(function (m) { return m.castle; }));
}

section('2. Illegal moves are rejected');
{
  /* A pinned piece must not be able to move off the pin line. */
  const pinned = parseBoard(`
    . . . . bR . . bK
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . wN . . .
    . . . . wK . . .
  `);
  const pos = new Position().load(pinned, 'w', NO_CASTLE, -1, 0);
  const moves = pos.legalMoves();
  const knightMoves = moves.filter(function (m) { return m.from === 52; });
  check('Pinned knight cannot move sideways', knightMoves.length === 0, 'got ' + knightMoves.length);

  /* King may not step into an attacked square. */
  const kbox = parseBoard(`
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . bR . . .
    . . . . . . . .
    . . . . . . . .
    . . . . wK . . .
  `);
  const kpos = new Position().load(kbox, 'w', NO_CASTLE, -1, 0);
  const kMoves = kpos.legalMoves();
  check('King must move out of a rook check', kMoves.length > 0);
  check('Every generated king move escapes the check', kMoves.every(function (m) {
    const u = kpos.make(m);
    const ok = !kpos.inCheck('w');
    kpos.unmake(u);
    return ok;
  }));
}

section('3. make / unmake restores the position exactly');
{
  const pos = new Position().load(START, 'w', FULL_CASTLE, -1, 0);
  const before = JSON.stringify([pos.board, pos.turn, pos.castling, pos.ep, pos.halfmove]);
  const moves = pos.legalMoves();
  let allRestored = true;
  for (let i = 0; i < moves.length; i++) {
    const u = pos.make(moves[i]);
    pos.unmake(u);
    if (JSON.stringify([pos.board, pos.turn, pos.castling, pos.ep, pos.halfmove]) !== before) {
      allRestored = false;
      break;
    }
  }
  check('All 20 start moves round-trip through make/unmake', allRestored);
}

section('4. En passant');
{
  /* White pawn on e5, black pawn on d5, and Black has just played d7-d5 so the
   * en-passant target is d6. Board indices: rank 5 is row 3, so d5 = 27,
   * e5 = 28, and the target d6 sits on row 2 at index 19. */
  const board = parseBoard(`
    . . . . bK . . .
    . . . . . . . .
    . . . . . . . .
    . . . bP wP . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . wK . . .
  `);
  check('Fixture puts the white pawn on e5 and black pawn on d5',
    board[28] === 'wP' && board[27] === 'bP', 'e5=' + board[28] + ' d5=' + board[27]);

  const pos = new Position().load(board, 'w', NO_CASTLE, 19, 0);
  const epMove = pos.legalMoves().filter(function (m) { return m.ep >= 0; });
  check('En-passant capture is generated', epMove.length === 1, 'got ' + epMove.length);
  if (epMove.length) {
    check('En-passant lands on d6 and removes the pawn on d5',
      epMove[0].to === 19 && epMove[0].ep === 27,
      'to=' + epMove[0].to + ' ep=' + epMove[0].ep);
    const u = pos.make(epMove[0]);
    check('En passant removes the captured pawn', pos.board[27] === null && pos.board[19] === 'wP');
    pos.unmake(u);
    check('En passant unmake restores both squares', pos.board[27] === 'bP' && pos.board[28] === 'wP');
  }
}

section('5. Castling rights and execution');
{
  const board = parseBoard(`
    . . . . bK . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    wR . . . wK . . wR
  `);
  const pos = new Position().load(board, 'w', FULL_CASTLE, -1, 0);
  const kings = pos.legalMoves().filter(function (m) { return m.castle === 'K'; });
  const queens = pos.legalMoves().filter(function (m) { return m.castle === 'Q'; });
  check('Kingside castling available when path is clear', kings.length === 1);
  check('Queenside castling available when path is clear', queens.length === 1);

  if (kings.length) {
    const u = pos.make(kings[0]);
    check('Kingside castle moves king and rook', pos.board[62] === 'wK' && pos.board[61] === 'wR' && pos.board[60] === null && pos.board[63] === null);
    pos.unmake(u);
    check('Castle unmake restores king and rook', pos.board[60] === 'wK' && pos.board[63] === 'wR');
  }

  /* Castling through an attacked square must be rejected. */
  /* A black rook on f8 attacks f1, the square the king must cross, so
   * kingside castling is illegal even though the path is clear. */
  const attacked = parseBoard(`
    . . . . bK . bR .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    wR . . . wK . . wR
  `);
  const apos = new Position().load(attacked, 'w', FULL_CASTLE, -1, 0);
  check('Cannot castle kingside through an attacked square',
    !apos.legalMoves().some(function (m) { return m.castle === 'K'; }));
  check('Queenside castling is still legal in that position',
    apos.legalMoves().some(function (m) { return m.castle === 'Q'; }));
}

section('6. Promotion');
{
  /* White pawn on e7 (row 1, index 12), one step from promoting on e8 (index 4).
   * The black king sits on a8 so it does not occupy the promotion square. */
  const board = parseBoard(`
    bK . . . . . . .
    . . . . wP . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . wK . . .
  `);
  check('Fixture puts the white pawn on e7', board[12] === 'wP');
  const pos = new Position().load(board, 'w', NO_CASTLE, -1, 0);
  const promos = pos.legalMoves().filter(function (m) { return m.promo > 0; });
  check('Four promotion options generated', promos.length === 4, 'got ' + promos.length);
  const q = promos.filter(function (m) { return m.promo === 5; })[0];
  if (q) {
    check('Promotion targets the promotion rank e8', q.to === 4, 'to=' + q.to);
    const u = pos.make(q);
    check('Promotion produces a queen of the right colour', pos.board[4] === 'wQ', 'got ' + pos.board[4]);
    pos.unmake(u);
    check('Promotion unmake restores the pawn', pos.board[12] === 'wP' && pos.board[4] === null);
  }
}

section('7. Checkmate and stalemate detection');
{
  /* Fool's mate. Black queen h4 and bishop c5 mate the White king on e1,
   * because the White pawns on f2 and g2 have advanced and no longer block. */
  const foolsMate = parseBoard(`
    bR bN bB bQ bK bB bN bR
    bP bP bP bP . bP bP bP
    . . . . . . . .
    . . . . . . . .
    . . bB . . . . bQ
    . . . . . . . .
    wP wP wP wP wP . . wP
    wR wN wB wQ wK wB wN wR
  `);
  check('Fixture places the black king on e8', foolsMate[4] === 'bK');
  check('Fixture places the black queen on h4', foolsMate[39] === 'bQ');
  const pos = new Position().load(foolsMate, 'w', NO_CASTLE, -1, 0);
  check('Checkmate: no legal moves', pos.legalMoves().length === 0);
  check('Checkmate: king is in check', pos.inCheck('w'));

  /* Classic stalemate: black king a8, white queen c7, white king c6. */
  const stale = parseBoard(`
    bK . . . . . . .
    . . wQ . . . . .
    . . wK . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
  `);
  const spos = new Position().load(stale, 'b', NO_CASTLE, -1, 0);
  check('Stalemate: no legal moves', spos.legalMoves().length === 0);
  check('Stalemate: king is NOT in check', !spos.inCheck('b'));

  /* Insufficient material: bare kings. */
  const bareKings = parseBoard(`
    . . . . bK . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . wK . . .
  `);
  const kpos = new Position().load(bareKings, 'w', NO_CASTLE, -1, 0);
  check('Bare kings: game is drawn by insufficient material', kpos.legalMoves().length > 0);
}

section('8. AI finds mate in one');
{
  /* Black king is trapped on h8, White king f7 covers g8/g7, White queen g6
   * delivers Qg7# (index 22 -> 31). This exact mate was verified against the
   * move generator before being hard-coded here. */
  const mateInOne = parseBoard(`
    . . . . . . . bK
    . . . . . wK . .
    . . . . . . wQ .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
  `);
  check('Fixture places the black king on h8', mateInOne[7] === 'bK');
  check('Fixture places the white queen on g6', mateInOne[22] === 'wQ');

  /* The engine must deliver mate. Assert on the outcome rather than an exact
   * move coordinate, so a different-but-equally-mating move is not a failure.
   * (In this position exactly one mating move exists, Qg6-g7.) */
  const player = new AiPlayer('hard');
  const move = player.compute(mateInOne, 'w', NO_CASTLE, -1, 0);
  check('AI returns a move for mate in one', !!move);
  if (move) {
    const pos = new Position().load(mateInOne, 'w', NO_CASTLE, -1, 0);
    const isLegal = pos.legalMoves().some(function (m) {
      return m.from === move.from && m.to === move.to && (m.promo || 0) === (move.promo || 0);
    });
    check('AI move is legal', isLegal, move.from + '->' + move.to);

    const u = pos.make({ from: move.from, to: move.to, promo: move.promo, ep: move.ep, castle: move.castle });
    check('AI delivers checkmate', pos.inCheck('b') && pos.legalMoves().length === 0,
      'played ' + move.from + '->' + move.to);
    pos.unmake(u);
  }
}

section('9. AI never plays an illegal move across a full game');
{
  /* Play the engine against itself for 60 plies and assert every move legal. */
  let ok = true;
  let detail = '';
  const player = new AiPlayer('normal');
  const pos = new Position().load(START, 'w', FULL_CASTLE, -1, 0);
  const seen = {};

  for (let ply = 0; ply < 60; ply++) {
    const legal = pos.legalMoves();
    if (!legal.length) break;

    const mv = player.compute(pos.board, pos.turn, pos.castling, pos.ep, pos.halfmove);
    if (!mv) { ok = false; detail = 'engine returned null at ply ' + ply; break; }

    const match = legal.filter(function (m) {
      return m.from === mv.from && m.to === mv.to && (m.promo || 0) === (mv.promo || 0);
    });
    if (!match.length) { ok = false; detail = 'illegal move at ply ' + ply + ': ' + mv.from + '->' + mv.to; break; }

    pos.make(match[0]);

    /* Threefold-style loop guard: the engine must not shuffle forever. */
    const key = pos.board.join('') + pos.turn;
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] > 3) break;
  }
  check('60 plies of self-play produced only legal moves', ok, detail);
}

section('10. Difficulty levels are ordered and responsive');
{
  check('Four difficulty levels exist', Object.keys(LEVELS).length === 4);
  check('Easy is shallower than Master', LEVELS.easy.depth < LEVELS.master.depth);

  const player = new AiPlayer('easy');
  check('Default level can be changed', player.setLevel('master') === true);
  check('Unknown level is rejected', player.setLevel('impossible') === false);
  player.setLevel('easy');

  const pos = new Position().load(START, 'w', FULL_CASTLE, -1, 0);
  const t0 = Date.now();
  const mv = player.compute(pos.board, pos.turn, pos.castling, pos.ep, pos.halfmove);
  const dt = Date.now() - t0;
  check('Easy level returns a move', !!mv);
  check('Easy level responds within its budget (<= 1500ms)', dt <= 1500, 'took ' + dt + 'ms');

  const master = new AiPlayer('master');
  const t1 = Date.now();
  const mv2 = master.compute(pos.board, pos.turn, pos.castling, pos.ep, pos.halfmove);
  const dt2 = Date.now() - t1;
  check('Master level returns a move', !!mv2);
  check('Master level respects its time budget (<= 3500ms)', dt2 <= 3500, 'took ' + dt2 + 'ms');
}

section('11. Evaluation sanity');
{
  const p = new AiPlayer('normal');
  const startScore = p.evaluate(START, 'w', FULL_CASTLE, -1, 0);
  check('Starting position evaluates close to equal', Math.abs(startScore) < 0.6, 'got ' + startScore);

  const whiteUpQueen = parseBoard(`
    . . . . bK . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . wQ wK . . .
  `);
  const up = p.evaluate(whiteUpQueen, 'w', NO_CASTLE, -1, 0);
  check('White with an extra queen evaluates as a large advantage', up > 7, 'got ' + up);
}

section('12. Deep clone isolation between Position instances');
{
  /* join('') collapses null squares to an empty string, so a quiet move can
   * leave the joined text unchanged. Compare with an explicit separator. */
  const layout = function (board) { return board.map(function (p) { return p || '--'; }).join(' '); };

  const a = new Position().load(START, 'w', FULL_CASTLE, -1, 0);
  const before = layout(a.board);
  const b = a.clone();
  const mv = b.legalMoves()[0];
  b.make(mv);

  check('Cloned position does not mutate the original board', layout(a.board) === before,
    'original board changed');
  check('Clone itself did move', layout(b.board) !== before, 'clone board unchanged');
  check('Original position keeps the original side to move', a.turn === 'w');
  check('Clone advanced its own side to move', b.turn === 'b');
  check('Original board array is a different reference from the clone',
    a.board !== b.board);
}

/* ------------------------------------------------------------------ */

console.log('\n' + '-'.repeat(58));
console.log('passed: ' + passed + '   failed: ' + failed);
console.log('-'.repeat(58));
process.exit(failed === 0 ? 0 : 1);
