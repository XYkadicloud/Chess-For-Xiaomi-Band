/*
 * ai.js — built-in chess engine for Chess for Xiaomi Vela Bands
 *
 * Design constraints (Xiaomi Band 9 / 9 Pro / 10 are resource limited):
 *   - No external assets, no network, no worker threads, no WebAssembly.
 *   - The runtime is an embedded JS interpreter (JerryScript / QuickJS Lite),
 *     not V8. It has no JIT-tier worth relying on and a very small heap, so the
 *     engine is written to avoid allocation inside the search:
 *       * the board is mirrored into a flat Int8Array of piece codes,
 *       * moves are packed into plain integers held in one preallocated buffer,
 *       * the transposition table is open-addressed typed arrays rather than a
 *         Map of objects.
 *   - Allocation-free hot paths are worth more here than they are on a desktop:
 *     every object created inside negamax is a future GC pause on a 64 MHz
 *     class core, and GC is what makes a watch UI stutter.
 *
 * Public board encoding (unchanged, this is what the host page uses):
 *   'wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP', null for empty
 *   board[0] = a8, board[56] = a1, board[60] = e1.
 *
 * Internal board encoding:
 *   sq[i] = 0 empty, +1..+6 for White P,N,B,R,Q,K, -1..-6 for Black.
 *
 * Move packing (one int):
 *   bits  0-5   from
 *   bits  6-11  to
 *   bits 12-14  promotion piece type (0 = none)
 *   bits 15-16  castle (1 = 'K', 2 = 'Q')
 *   bits 17-20  captured piece type (0 = none)
 *   bit  21     en-passant capture
 */

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

const WHITE = 'w';
const BLACK = 'b';

const EMPTY = 0;
const PAWN = 1;
const KNIGHT = 2;
const BISHOP = 3;
const ROOK = 4;
const QUEEN = 5;
const KING = 6;

/* Piece values in centipawns. */
const VALUE = [0, 100, 320, 330, 500, 900, 20000];

const MATE = 30000;
const INF = 1000000;

/* Search limits. MAX_PLY bounds extensions so a perpetual-check line can never
 * walk off the end of the per-ply buffers. */
const MAX_PLY = 64;
const MAX_MOVES = 160;
const MOVE_BUF = MAX_PLY * MAX_MOVES;
/* Deeper than the search can ever go (MAX_PLY plus quiescence), with room to
 * spare for hosts that make a long chain of moves without unmaking. */
const UNDO_BUF = 256;

/* ------------------------------------------------------------------ *
 * Piece-square tables (White's point of view, index 0 = a8)
 * ------------------------------------------------------------------ */

const PST_PAWN = [
  0, 0, 0, 0, 0, 0, 0, 0,
  60, 60, 60, 60, 60, 60, 60, 60,
  12, 18, 22, 30, 30, 22, 18, 12,
  6, 9, 14, 24, 24, 14, 9, 6,
  2, 4, 8, 18, 18, 8, 4, 2,
  2, -2, 0, 4, 4, 0, -2, 2,
  2, 4, 4, -10, -10, 4, 4, 2,
  0, 0, 0, 0, 0, 0, 0, 0
];

const PST_KNIGHT = [
  -50, -35, -25, -25, -25, -25, -35, -50,
  -35, -18, 0, 4, 4, 0, -18, -35,
  -25, 4, 12, 18, 18, 12, 4, -25,
  -25, 2, 18, 24, 24, 18, 2, -25,
  -25, 2, 18, 24, 24, 18, 2, -25,
  -25, 4, 12, 18, 18, 12, 4, -25,
  -35, -18, 0, 4, 4, 0, -18, -35,
  -50, -30, -25, -25, -25, -25, -30, -50
];

const PST_BISHOP = [
  -18, -10, -10, -10, -10, -10, -10, -18,
  -10, 4, 0, 0, 0, 0, 4, -10,
  -10, 8, 10, 10, 10, 10, 8, -10,
  -10, 0, 12, 14, 14, 12, 0, -10,
  -10, 6, 6, 14, 14, 6, 6, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 2, 0, 0, 0, 0, 2, -10,
  -18, -10, -14, -10, -10, -14, -10, -18
];

const PST_ROOK = [
  0, 0, 0, 2, 2, 0, 0, 0,
  6, 10, 10, 10, 10, 10, 10, 6,
  -4, 0, 0, 0, 0, 0, 0, -4,
  -4, 0, 0, 0, 0, 0, 0, -4,
  -4, 0, 0, 0, 0, 0, 0, -4,
  -4, 0, 0, 0, 0, 0, 0, -4,
  -4, 0, 0, 0, 0, 0, 0, -4,
  0, 0, 2, 6, 6, 2, 0, 0
];

const PST_QUEEN = [
  -18, -10, -10, -2, -2, -10, -10, -18,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 4, 4, 4, 4, 0, -10,
  -2, 0, 4, 4, 4, 4, 0, -2,
  0, 0, 4, 4, 4, 4, 0, -2,
  -10, 4, 4, 4, 4, 4, 0, -10,
  -10, 0, 4, 0, 0, 0, 0, -10,
  -18, -10, -10, -2, -2, -10, -10, -18
];

const PST_KING_MID = [
  -60, -70, -70, -80, -80, -70, -70, -60,
  -60, -70, -70, -80, -80, -70, -70, -60,
  -60, -70, -70, -80, -80, -70, -70, -60,
  -60, -70, -70, -80, -80, -70, -70, -60,
  -40, -50, -50, -60, -60, -50, -50, -40,
  -20, -30, -30, -40, -40, -30, -30, -20,
  20, 20, -10, -20, -20, -10, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20
];

const PST_KING_END = [
  -50, -30, -20, -20, -20, -20, -30, -50,
  -30, -10, 0, 0, 0, 0, -10, -30,
  -20, 0, 20, 25, 25, 20, 0, -20,
  -20, 0, 25, 35, 35, 25, 0, -20,
  -20, 0, 25, 35, 35, 25, 0, -20,
  -20, 0, 20, 25, 25, 20, 0, -20,
  -30, -10, 0, 0, 0, 0, -10, -30,
  -50, -40, -30, -20, -20, -30, -40, -50
];

const PST = [null, PST_PAWN, PST_KNIGHT, PST_BISHOP, PST_ROOK, PST_QUEEN, PST_KING_MID];

/* Mirrored square index, so Black can reuse the White tables. */
const MIRROR = new Int8Array(64);
for (let i = 0; i < 64; i++) MIRROR[i] = (7 - (i >> 3)) * 8 + (i & 7);

/* Popcount for the 8-bit pawn rank masks used by the pawn-structure terms. */
const POPC = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let n = 0;
  for (let b = i; b; b >>= 1) n += b & 1;
  POPC[i] = n;
}

/* Passed-pawn bonus by how far the pawn has advanced (0 = on its start rank). */
const PASSED_BONUS = [0, 8, 14, 24, 42, 70, 120];

/* ------------------------------------------------------------------ *
 * Precomputed geometry
 *
 * Every square gets its knight/king target list and its eight ray lists up
 * front. That turns the inner loops of move generation and attack detection
 * into "walk a flat array", with no rank/file bounds arithmetic at all — the
 * single largest constant-factor win in the file.
 * ------------------------------------------------------------------ */

const KNIGHT_MOVES = new Array(64);
const KING_MOVES = new Array(64);
const RAY_O = new Array(64);   /* rank/file rays, checked for rook + queen */
const RAY_D = new Array(64);   /* diagonal rays, checked for bishop + queen */
const PAWN_ATTACKERS = [new Array(64), new Array(64)]; /* squares a pawn of
                                  colour X would have to stand on to hit sq */

const ORTH_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const KNIGHT_DELTAS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

(function buildGeometry() {
  for (let sq = 0; sq < 64; sq++) {
    const r = sq >> 3;
    const c = sq & 7;

    const kn = [];
    for (let i = 0; i < 8; i++) {
      const rr = r + KNIGHT_DELTAS[i][0];
      const cc = c + KNIGHT_DELTAS[i][1];
      if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) kn.push(rr * 8 + cc);
    }
    KNIGHT_MOVES[sq] = kn;

    const kg = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) kg.push(rr * 8 + cc);
      }
    }
    KING_MOVES[sq] = kg;

    const ortho = [];
    for (let d = 0; d < 4; d++) {
      const line = [];
      let rr = r + ORTH_DIRS[d][0];
      let cc = c + ORTH_DIRS[d][1];
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        line.push(rr * 8 + cc);
        rr += ORTH_DIRS[d][0];
        cc += ORTH_DIRS[d][1];
      }
      ortho.push(line);
    }
    RAY_O[sq] = ortho;

    const diag = [];
    for (let d = 0; d < 4; d++) {
      const line = [];
      let rr = r + DIAG_DIRS[d][0];
      let cc = c + DIAG_DIRS[d][1];
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        line.push(rr * 8 + cc);
        rr += DIAG_DIRS[d][0];
        cc += DIAG_DIRS[d][1];
      }
      diag.push(line);
    }
    RAY_D[sq] = diag;

    /* A White pawn captures "upward", so it stands one row *below* the target. */
    const wFrom = [];
    const bFrom = [];
    for (let dc = -1; dc <= 1; dc += 2) {
      const cc = c + dc;
      if (cc < 0 || cc > 7) continue;
      if (r + 1 < 8) wFrom.push((r + 1) * 8 + cc);
      if (r - 1 >= 0) bFrom.push((r - 1) * 8 + cc);
    }
    PAWN_ATTACKERS[0][sq] = wFrom;   /* White pawn that attacks sq */
    PAWN_ATTACKERS[1][sq] = bFrom;   /* Black pawn that attacks sq */
  }
})();

/* ------------------------------------------------------------------ *
 * Difficulty presets
 *
 *   depth     maximum iterative-deepening depth in plies
 *   timeMs    soft wall-clock budget; iterative deepening stops early
 *   blunder   chance of playing a lesser root move (lower levels only)
 *   ttBits    log2 of transposition-table slots
 * ------------------------------------------------------------------ */
const LEVELS = {
  easy:   { key: 'easy',   label: 'Easy',   depth: 1,  timeMs: 150,   blunder: 0.30, quiesce: false, nmp: false, lmr: false, pvs: false, see: false, book: false, aspire: false, futility: false, razor: false, contempt: 0,   ttBits: 12 },
  normal: { key: 'normal', label: 'Normal', depth: 5,  timeMs: 1000,  blunder: 0.10, quiesce: true,  nmp: false, lmr: true,  pvs: true,  see: true,  book: true,  aspire: false, futility: true,  razor: false, contempt: 0,   ttBits: 13 },
  hard:   { key: 'hard',   label: 'Hard',   depth: 8,  timeMs: 4000,  blunder: 0.0,  quiesce: true,  nmp: true,  lmr: true,  pvs: true,  see: true,  book: true,  aspire: true,  futility: true,  razor: true,  contempt: 120, ttBits: 14 },
  master: { key: 'master', label: 'Master', depth: 12, timeMs: 10000, blunder: 0.0,  quiesce: true,  nmp: true,  lmr: true,  pvs: true,  see: true,  book: true,  aspire: true,  futility: true,  razor: true,  contempt: 120, ttBits: 15 }
};

const LEVEL_ORDER = ['easy', 'normal', 'hard', 'master'];

/* ------------------------------------------------------------------ *
 * Opening book
 *
 * Lines are ordinary main-line theory written in UCI. They are replayed from
 * the start position once at module load and every position along the way is
 * hashed, so the lookup at runtime is an exact Zobrist match instead of the
 * fragile "which pawn left its home rank" heuristic this used to rely on.
 * An exact match means the book can hold real theory and still never fire on
 * a position it was not written for.
 *
 * Where several lines share a prefix the position collects several candidate
 * replies, and the engine picks among them at random so games differ.
 *
 * Repertoire is chosen for solidity rather than sharpness: on a watch, an
 * opponent that reaches a playable middlegame beats one that gambits and then
 * has to calculate its way out of trouble.
 * ------------------------------------------------------------------ */

const BOOK_LINES = [
  /* ---- White 1.e4 ---- */
  'e2e4 e7e5 g1f3 b8c6 f1b5',                 /* Ruy Lopez */
  'e2e4 e7e5 g1f3 b8c6 f1c4',                 /* Italian */
  'e2e4 e7e5 g1f3 g8f6',                      /* Petroff */
  'e2e4 e7e5 f1c4 g8f6 d2d3',                 /* Bishop's opening */
  'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4',       /* Sicilian, Open */
  'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4',       /* Sicilian, Open */
  'e2e4 c7c5 b1c3 b8c6 g2g3',                 /* Sicilian, closed */
  'e2e4 e7e6 d2d4 d7d5 b1c3',                 /* French */
  'e2e4 c7c6 d2d4 d7d5 b1c3',                 /* Caro-Kann */
  'e2e4 d7d5 e4d5',                           /* Scandinavian */
  'e2e4 g8f6 e4e5',                           /* Alekhine */
  'e2e4 d7d6 d2d4 g8f6 b1c3',                 /* Pirc */
  /* ---- White 1.d4 ---- */
  'd2d4 d7d5 c2c4',                           /* Queen's Gambit */
  'd2d4 d7d5 g1f3 g8f6 c2c4',                 /* QGD */
  'd2d4 g8f6 c2c4 e7e6 g1f3',                 /* Indian / QID */
  'd2d4 g8f6 c2c4 e7e6 b1c3 f8b4',            /* Nimzo-Indian */
  'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7',            /* King's Indian */
  'd2d4 e7e6 c2c4',                           /* QGD */
  'd2d4 f7f5 g1f3',                           /* Dutch */
  'd2d4 g8f6 g1f3',                           /* quiet Indian */
  /* ---- White 1.Nf3 and 1.c4 ---- */
  'g1f3 d7d5 d2d4',
  'g1f3 g8f6 c2c4',
  'g1f3 g8f6 d2d4',
  'c2c4 e7e5 b1c3',
  'c2c4 g8f6 b1c3',
  'c2c4 c7c5 g1f3',
  'c2c4 e7e6 g1f3',
  /* ---- Black: answers to the common first moves ---- */
  'e2e4 e7e5',
  'e2e4 c7c5',
  'e2e4 e7e6',
  'e2e4 c7c6',
  'd2d4 d7d5',
  'd2d4 g8f6',
  'd2d4 e7e6',
  'c2c4 e7e5',
  'c2c4 g8f6',
  'c2c4 c7c5',
  'g1f3 d7d5',
  'g1f3 g8f6',
  'b1c3 e7e5',
  'b1c3 d7d5',
  /* ---- Black: second moves in the main lines ---- */
  'e2e4 e7e5 g1f3 b8c6',
  'e2e4 e7e5 g1f3 g8f6',
  'e2e4 c7c5 g1f3 d7d6',
  'e2e4 c7c5 g1f3 b8c6',
  'd2d4 d7d5 c2c4 e7e6',
  'd2d4 d7d5 c2c4 c7c6',
  'd2d4 g8f6 c2c4 e7e6',
  'e2e4 e7e6 d2d4 d7d5',
  'e2e4 c7c6 d2d4 d7d5',
  'c2c4 e7e5 b1c3 g8f6',
  'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6',            /* morphy defence */
  'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6'
];

/* ------------------------------------------------------------------ *
 * Zobrist hashing
 * ------------------------------------------------------------------ */

let _zSeed = 0x243F6A88 >>> 0;
function zrnd() {
  _zSeed ^= (_zSeed << 13); _zSeed >>>= 0;
  _zSeed ^= (_zSeed >>> 17);
  _zSeed ^= (_zSeed << 5);  _zSeed >>>= 0;
  return _zSeed >>> 0;
}

/* ZOB[code + 6][square]; code is -6..+6. */
const ZOB = new Array(13);
for (let ci = 0; ci < 13; ci++) {
  const row = new Int32Array(64);
  for (let s = 0; s < 64; s++) row[s] = zrnd() | 0;
  ZOB[ci] = row;
}
const ZOB_CASTLE = [zrnd() | 0, zrnd() | 0, zrnd() | 0, zrnd() | 0];
/* ZOB_CASTLE_XOR[b] is the XOR of every castling bit set in the 4-bit mask b,
 * so make/unmake can fix the key with two XORs instead of four tests. */
const ZOB_CASTLE_XOR = new Int32Array(16);
for (let b = 0; b < 16; b++) {
  let h = 0;
  if (b & 1) h ^= ZOB_CASTLE[0];
  if (b & 2) h ^= ZOB_CASTLE[1];
  if (b & 4) h ^= ZOB_CASTLE[2];
  if (b & 8) h ^= ZOB_CASTLE[3];
  ZOB_CASTLE_XOR[b] = h | 0;
}
const ZOB_EP = new Int32Array(65); /* index epSquare + 1, so -1 maps to 0 */
for (let i = 0; i < 65; i++) ZOB_EP[i] = zrnd() | 0;
const ZOB_BLACK = zrnd() | 0;

const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

/* ------------------------------------------------------------------ *
 * Piece-code helpers
 * ------------------------------------------------------------------ */

/* typeOf() keeps its historical signature: it takes the host's piece *string*. */
function typeOf(p) {
  if (!p) return EMPTY;
  switch (p.charCodeAt(1)) {
    case 80: return PAWN;
    case 78: return KNIGHT;
    case 66: return BISHOP;
    case 82: return ROOK;
    case 81: return QUEEN;
    case 75: return KING;
    default: return EMPTY;
  }
}

function colorOf(p) {
  return p ? p.charCodeAt(0) : 0; /* 119 = 'w', 98 = 'b' */
}

/* Internal: piece type from a signed code. */
function typeOfCode(c) { return c < 0 ? -c : c; }

const STR_CODE = {};
const CODE_STR = new Array(13);
(function buildCodeMaps() {
  const names = ['P', 'N', 'B', 'R', 'Q', 'K'];
  for (let t = 1; t <= 6; t++) {
    const w = 'w' + names[t - 1];
    const b = 'b' + names[t - 1];
    STR_CODE[w] = t;
    STR_CODE[b] = -t;
    CODE_STR[6 + t] = w;
    CODE_STR[6 - t] = b;
  }
  CODE_STR[6] = null;
})();

function promoChar(t) {
  switch (t) {
    case QUEEN: return 'Q';
    case ROOK: return 'R';
    case BISHOP: return 'B';
    case KNIGHT: return 'N';
    default: return 'Q';
  }
}

/* ------------------------------------------------------------------ *
 * Move packing
 * ------------------------------------------------------------------ */

function pack(from, to, promo, castle, cap, ep) {
  return from | (to << 6) | (promo << 12) | (castle << 15) | (cap << 17) | (ep << 21);
}
function mvFrom(m) { return m & 63; }
function mvTo(m) { return (m >> 6) & 63; }
function mvPromo(m) { return (m >> 12) & 7; }
function mvCastle(m) { return (m >> 15) & 3; }
function mvCap(m) { return (m >> 17) & 15; }
function mvEpFlag(m) { return (m >> 21) & 1; }

/* Accept the host's plain object form as well as a packed int, because
 * Position.make() is part of the public surface. */
function packObject(o) {
  const from = o.from;
  const to = o.to;
  const promo = o.promo || 0;
  const castle = o.castle === 'K' ? 1 : (o.castle === 'Q' ? 2 : 0);
  const ep = (o.ep === undefined || o.ep === null || o.ep < 0) ? 0 : 1;
  return pack(from, to, promo, castle, ep ? PAWN : 0, ep);
}

/* Back to the host's object form. */
function unpack(m) {
  const from = mvFrom(m);
  const to = mvTo(m);
  const promo = mvPromo(m);
  const castle = mvCastle(m);
  const epFlag = mvEpFlag(m);
  return {
    from: from,
    to: to,
    promo: promo,
    ep: epFlag ? (to < from ? to + 8 : to - 8) : -1,
    castle: castle === 1 ? 'K' : (castle === 2 ? 'Q' : 0)
  };
}

/* ------------------------------------------------------------------ *
 * Position
 * ------------------------------------------------------------------ */

function Position() {
  this.board = new Array(64);       /* public: host piece strings */
  this.sq = new Int8Array(64);      /* internal: signed piece codes */
  this.turn = BLACK;                /* 'w' | 'b' */
  this.wtm = false;                 /* side-to-move as a boolean, mirrors turn */
  this.castling = { wK: true, wQ: true, bK: true, bQ: true };
  this.cb = 15;                     /* 1=wK 2=wQ 4=bK 8=bQ */
  this.ep = -1;
  this.halfmove = 0;
  this.key = 0;
  this.kingSq = new Int8Array(2);   /* 0 = White king, 1 = Black king */
  this.sp = 0;
  this.uMove = new Int32Array(UNDO_BUF);
  this.uCap = new Int32Array(UNDO_BUF);
  this.uCastle = new Int32Array(UNDO_BUF);
  this.uEp = new Int32Array(UNDO_BUF);
  this.uHalf = new Int32Array(UNDO_BUF);
  this.uKey = new Int32Array(UNDO_BUF);
  this.uKing = new Int32Array(UNDO_BUF);
}

Position.prototype.load = function (board, turn, castling, ep, halfmove) {
  const s = this.sq;
  for (let i = 0; i < 64; i++) {
    const p = board[i] || null;
    this.board[i] = p;
    s[i] = p ? (STR_CODE[p] || 0) : 0;
  }
  this.turn = turn;
  this.wtm = turn === 'w';
  this.cb = castling
    ? ((castling.wK ? 1 : 0) | (castling.wQ ? 2 : 0) | (castling.bK ? 4 : 0) | (castling.bQ ? 8 : 0))
    : 0;
  this.castling = { wK: !!(this.cb & 1), wQ: !!(this.cb & 2), bK: !!(this.cb & 4), bQ: !!(this.cb & 8) };
  this.ep = (ep === undefined || ep === null) ? -1 : ep;
  this.halfmove = halfmove || 0;
  this.sp = 0;
  this.kingSq[0] = this.findKing(KING);
  this.kingSq[1] = this.findKing(-KING);
  this.key = this.computeKey();
  return this;
};

Position.prototype.findKing = function (code) {
  const s = this.sq;
  for (let i = 0; i < 64; i++) if (s[i] === code) return i;
  return -1;
};

Position.prototype.clone = function () {
  const p = new Position();
  return p.load(this.board, this.turn, this.castling, this.ep, this.halfmove);
};

/* Full-scan hash. Used once per Position.load() and by the test harness to
 * cross-check the incremental key maintained by make/unmake. */
Position.prototype.computeKey = function () {
  let h = 0;
  const s = this.sq;
  for (let i = 0; i < 64; i++) {
    const p = s[i];
    if (p) h ^= ZOB[p + 6][i];
  }
  h ^= ZOB_CASTLE_XOR[this.cb];
  h ^= ZOB_EP[this.ep + 1];
  if (!this.wtm) h ^= ZOB_BLACK;
  return h | 0;
};

Position.prototype.kingSquare = function (color) {
  return this.kingSq[color === 'w' ? 0 : 1];
};

/* True when `sq` is attacked by side `byWhite`. */
Position.prototype.isAttacked = function (sq, byWhite) {
  const s = this.sq;

  /* Pawns. */
  const pa = PAWN_ATTACKERS[byWhite ? 0 : 1][sq];
  const pawnCode = byWhite ? PAWN : -PAWN;
  for (let i = 0; i < pa.length; i++) if (s[pa[i]] === pawnCode) return true;

  /* Knights. */
  const kn = KNIGHT_MOVES[sq];
  const knightCode = byWhite ? KNIGHT : -KNIGHT;
  for (let i = 0; i < kn.length; i++) if (s[kn[i]] === knightCode) return true;

  /* King. */
  const kg = KING_MOVES[sq];
  const kingCode = byWhite ? KING : -KING;
  for (let i = 0; i < kg.length; i++) if (s[kg[i]] === kingCode) return true;

  /* Bishops / queens on the diagonals, then rooks / queens on the lines. */
  const rd = RAY_D[sq];
  for (let d = 0; d < 4; d++) {
    const line = rd[d];
    for (let i = 0; i < line.length; i++) {
      const t = s[line[i]];
      if (!t) continue;
      if ((t > 0) === byWhite) {
        const a = t < 0 ? -t : t;
        if (a === BISHOP || a === QUEEN) return true;
      }
      break;
    }
  }
  const ro = RAY_O[sq];
  for (let d = 0; d < 4; d++) {
    const line = ro[d];
    for (let i = 0; i < line.length; i++) {
      const t = s[line[i]];
      if (!t) continue;
      if ((t > 0) === byWhite) {
        const a = t < 0 ? -t : t;
        if (a === ROOK || a === QUEEN) return true;
      }
      break;
    }
  }
  return false;
};

/* Historical string form of attacked(), kept so external callers still work. */
Position.prototype.attacked = function (sq, by) {
  return this.isAttacked(sq, by === 'w');
};

Position.prototype.inCheck = function (color) {
  const sq = this.kingSq[color === 'w' ? 0 : 1];
  if (sq < 0) return false;
  return this.isAttacked(sq, color !== 'w');
};

/* Non-pawn, non-king material for one side. Used to gate null-move pruning
 * (unsafe in pawn endgames) and to scale the middlegame-only terms. */
Position.prototype.nonPawnMaterial = function (white) {
  const s = this.sq;
  let total = 0;
  for (let i = 0; i < 64; i++) {
    const p = s[i];
    if (!p) continue;
    if ((p > 0) !== white) continue;
    const t = p < 0 ? -p : p;
    if (t === PAWN || t === KING) continue;
    total += VALUE[t];
  }
  return total;
};

/* ------------------------------------------------------------------ *
 * make / unmake
 *
 * The undo record is a stack slot rather than an object, so a search that
 * touches millions of nodes allocates nothing at all.
 * ------------------------------------------------------------------ */

Position.prototype.make = function (move) {
  let m = move;
  if (typeof m !== 'number') m = packObject(m);

  const s = this.sq;
  const b = this.board;
  const from = mvFrom(m);
  const to = mvTo(m);
  const promo = mvPromo(m);
  const castle = mvCastle(m);
  const epFlag = mvEpFlag(m);

  /* Self-heal the captured-piece field: callers that hand-build a move object
   * do not know it. */
  if (!mvCap(m) && !epFlag && !castle) {
    const t = s[to];
    if (t) m |= (t < 0 ? -t : t) << 17;
  }
  const cap = mvCap(m);

  const sp = this.sp;
  this.uMove[sp] = m;
  this.uCastle[sp] = this.cb;
  this.uEp[sp] = this.ep;
  this.uHalf[sp] = this.halfmove;
  /* King squares are packed as (w+1) * 65 + (b+1) so that -1 survives. */
  this.uKey[sp] = this.key;
  this.uKing[sp] = (this.kingSq[0] + 1) * 65 + (this.kingSq[1] + 1);

  const moving = s[from];
  const wtm = this.wtm;
  const t = moving < 0 ? -moving : moving;
  /* The captured pawn of an en-passant capture is not on `to`; every other
   * capture sits on `to` and is simply overwritten below. */
  const capSq = epFlag ? (to < from ? to + 8 : to - 8) : to;

  let key = this.key;
  key ^= ZOB[moving + 6][from];
  if (cap) {
    const capCode = wtm ? -cap : cap;
    key ^= ZOB[capCode + 6][capSq];
    this.uCap[sp] = capCode;
  } else {
    this.uCap[sp] = 0;
  }

  /* Move the piece. */
  const placed = promo ? (wtm ? promo : -promo) : moving;
  s[from] = 0;
  s[to] = placed;
  b[from] = null;
  b[to] = CODE_STR[placed + 6];
  key ^= ZOB[placed + 6][to];

  if (epFlag) {
    s[capSq] = 0;
    b[capSq] = null;
  }

  if (t === KING) this.kingSq[wtm ? 0 : 1] = to;

  if (castle) {
    let rookFrom, rookTo;
    if (castle === 1) { rookFrom = wtm ? 63 : 7; rookTo = wtm ? 61 : 5; }
    else { rookFrom = wtm ? 56 : 0; rookTo = wtm ? 59 : 3; }
    const rook = s[rookFrom];
    s[rookTo] = rook;
    s[rookFrom] = 0;
    b[rookTo] = CODE_STR[rook + 6];
    b[rookFrom] = null;
    key ^= ZOB[rook + 6][rookFrom];
    key ^= ZOB[rook + 6][rookTo];
  }

  /* Castling rights. */
  let cb = this.cb;
  if (from === 60 || to === 60) cb &= ~3;
  if (from === 63 || to === 63) cb &= ~1;
  if (from === 56 || to === 56) cb &= ~2;
  if (from === 4 || to === 4) cb &= ~12;
  if (from === 7 || to === 7) cb &= ~4;
  if (from === 0 || to === 0) cb &= ~8;
  if (cb !== this.cb) {
    key ^= ZOB_CASTLE_XOR[this.cb] ^ ZOB_CASTLE_XOR[cb];
    this.cb = cb;
    this.castling.wK = (cb & 1) !== 0;
    this.castling.wQ = (cb & 2) !== 0;
    this.castling.bK = (cb & 4) !== 0;
    this.castling.bQ = (cb & 8) !== 0;
  }

  /* En-passant target, only after a double pawn push. */
  const oldEp = this.ep;
  if (t === PAWN && (to - from === 16 || from - to === 16)) {
    this.ep = wtm ? to + 8 : to - 8;
  } else {
    this.ep = -1;
  }
  if (oldEp !== this.ep) key ^= ZOB_EP[oldEp + 1] ^ ZOB_EP[this.ep + 1];

  this.halfmove = (t === PAWN || cap) ? 0 : this.halfmove + 1;
  this.wtm = !wtm;
  this.turn = wtm ? 'b' : 'w';
  key ^= ZOB_BLACK;
  this.key = key | 0;

  this.sp = sp + 1;
  return sp;
};

Position.prototype.unmake = function (undo) {
  const sp = undo;
  const m = this.uMove[sp];
  const s = this.sq;
  const b = this.board;

  const from = mvFrom(m);
  const to = mvTo(m);
  const promo = mvPromo(m);
  const castle = mvCastle(m);
  const capCode = this.uCap[sp];

  /* The side that just moved is the one to move again after the flip. */
  const movedIsWhite = !this.wtm;

  if (castle) {
    let rookFrom, rookTo;
    if (castle === 1) { rookFrom = movedIsWhite ? 63 : 7; rookTo = movedIsWhite ? 61 : 5; }
    else { rookFrom = movedIsWhite ? 56 : 0; rookTo = movedIsWhite ? 59 : 3; }
    s[rookFrom] = s[rookTo];
    s[rookTo] = 0;
    b[rookFrom] = CODE_STR[s[rookFrom] + 6];
    b[rookTo] = null;
  }

  const restored = promo ? (movedIsWhite ? PAWN : -PAWN) : s[to];
  s[to] = 0;
  s[from] = restored;
  b[to] = null;
  b[from] = CODE_STR[restored + 6];

  if (capCode) {
    const capSq = mvEpFlag(m) ? (to < from ? to + 8 : to - 8) : to;
    s[capSq] = capCode;
    b[capSq] = CODE_STR[capCode + 6];
  }

  const kingPair = this.uKing[sp];
  this.kingSq[0] = ((kingPair / 65) | 0) - 1;
  this.kingSq[1] = (kingPair % 65) - 1;

  const cb = this.uCastle[sp];
  if (cb !== this.cb) {
    this.cb = cb;
    this.castling.wK = (cb & 1) !== 0;
    this.castling.wQ = (cb & 2) !== 0;
    this.castling.bK = (cb & 4) !== 0;
    this.castling.bQ = (cb & 8) !== 0;
  }
  this.ep = this.uEp[sp];
  this.halfmove = this.uHalf[sp];
  this.key = this.uKey[sp];
  this.wtm = !this.wtm;
  this.turn = this.wtm ? 'w' : 'b';
  this.sp = sp;
};

/* Null move for Null-Move Pruning: swap sides without touching the board. */
Position.prototype.makeNull = function () {
  const ep = this.ep;
  this.key = (this.key ^ ZOB_BLACK ^ ZOB_EP[ep + 1] ^ ZOB_EP[0]) | 0;
  this.wtm = !this.wtm;
  this.turn = this.wtm ? 'w' : 'b';
  this.ep = -1;
  return ep;
};
Position.prototype.unmakeNull = function (ep) {
  this.wtm = !this.wtm;
  this.turn = this.wtm ? 'w' : 'b';
  this.ep = ep;
  this.key = (this.key ^ ZOB_BLACK ^ ZOB_EP[0] ^ ZOB_EP[ep + 1]) | 0;
};

/* ------------------------------------------------------------------ *
 * Opening book construction
 *
 * Replays every line above and records, for each position, the move that the
 * line plays next. Runs once, lazily, because Position has to exist first.
 * ------------------------------------------------------------------ */

let BOOK = null;

function uciToMove(u) {
  const f1 = u.charCodeAt(0) - 97;
  const r1 = parseInt(u.charAt(1), 10) - 1;
  const f2 = u.charCodeAt(2) - 97;
  const r2 = parseInt(u.charAt(3), 10) - 1;
  const from = (7 - r1) * 8 + f1;
  const to = (7 - r2) * 8 + f2;
  let promo = 0;
  if (u.length > 4) {
    const p = u.charAt(4);
    if (p === 'q') promo = QUEEN;
    else if (p === 'r') promo = ROOK;
    else if (p === 'b') promo = BISHOP;
    else if (p === 'n') promo = KNIGHT;
  }
  return pack(from, to, promo, 0, 0, 0);
}

/* Built rather than typed out: a hand-written 64-entry literal is exactly the
 * kind of thing that ends up one row short, and a book built from a wrong
 * board is silently empty. */
function startLayout() {
  const b = new Array(64).fill(null);
  const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (let f = 0; f < 8; f++) {
    b[f] = 'b' + back[f];
    b[8 + f] = 'bP';
    b[48 + f] = 'wP';
    b[56 + f] = 'w' + back[f];
  }
  return b;
}

function buildBook() {
  /* Built into a local table and published only once it is complete: a throw
   * halfway through would otherwise leave a half-filled book behind, and a
   * half-filled book fails by simply not firing — the hardest kind of bug to
   * notice on a watch. */
  const table = {};
  const start = startLayout();
  const full = { wK: true, wQ: true, bK: true, bQ: true };
  const p = new Position();

  for (let li = 0; li < BOOK_LINES.length; li++) {
    const parts = BOOK_LINES[li].split(' ');
    p.load(start, 'w', full, -1, 0);
    for (let i = 0; i < parts.length; i++) {
      const reply = uciToMove(parts[i]);
      /* Every line move must be made by the side that is actually to move, or
       * the line is mistyped (or the start layout is wrong). Fail loudly. */
      const from = reply & 63;
      const piece = p.sq[from];
      if (piece === 0 || (piece > 0) !== p.wtm) {
        throw new Error('ai.js: opening book line ' + li + ' is illegal at ply ' + i +
          ' ("' + BOOK_LINES[li] + '")');
      }
      const key = p.key;
      let list = table[key];
      if (!list) { list = []; table[key] = list; }
      let dup = false;
      for (let j = 0; j < list.length; j++) if (list[j] === reply) { dup = true; break; }
      if (!dup) list.push(reply);
      p.make(reply);
    }
  }
  let entries = 0;
  for (const k in table) if (table[k]) entries++;
  if (!entries) throw new Error('ai.js: opening book built empty');
  BOOK = table;
  return BOOK;
}

/* ------------------------------------------------------------------ *
 * Static evaluation
 *
 * One pass over the board gathers material, piece-square terms and the pawn
 * rank masks; everything else is derived from those masks, so the whole
 * function is O(64) with no allocation.
 * ------------------------------------------------------------------ */

/* Module-level scratch: evaluate() is never reentrant. */
const EV_WF = new Int32Array(8);
const EV_BF = new Int32Array(8);
const EV_PAWNS = new Int32Array(32);
const EV_ROOKS = new Int32Array(32);
/* Rooks and queens, in board order. Square | 64 marks White. */
const EV_HEAVY = new Int32Array(20);
let EV_HEAVY_N = 0;

/* Non-pawn material at the start of the game; the taper is relative to it. */
const PHASE_MAX = 6400;

function evaluatePos(pos) {
  const s = pos.sq;
  const wf = EV_WF;
  const bf = EV_BF;
  let score = 0;
  let npm = 0;
  let bishopsW = 0;
  let bishopsB = 0;
  let pawnCount = 0;
  let rookCount = 0;
  let pawnsW = 0;
  let pawnsB = 0;
  let minorsW = 0;
  let minorsB = 0;
  let queensW = 0;
  let queensB = 0;
  let rooksW = 0;
  let rooksB = 0;

  for (let f = 0; f < 8; f++) { wf[f] = 0; bf[f] = 0; }
  EV_HEAVY_N = 0;

  for (let i = 0; i < 64; i++) {
    const p = s[i];
    if (!p) continue;
    const t = p < 0 ? -p : p;
    if (t === KING) continue;
    const white = p > 0;

    if (t === PAWN) {
      const f = i & 7;
      if (white) { wf[f] |= (1 << (i >> 3)); pawnsW++; }
      else { bf[f] |= (1 << (i >> 3)); pawnsB++; }
      if (pawnCount < 32) EV_PAWNS[pawnCount++] = i | (white ? 64 : 0);
    } else {
      npm += VALUE[t];
      if (t === BISHOP) { if (white) bishopsW++; else bishopsB++; }
      if (white) { if (t === KNIGHT || t === BISHOP) minorsW++; else if (t === QUEEN) queensW++; else if (t === ROOK) rooksW++; }
      else { if (t === KNIGHT || t === BISHOP) minorsB++; else if (t === QUEEN) queensB++; else if (t === ROOK) rooksB++; }
      if (t === ROOK && rookCount < 32) EV_ROOKS[rookCount++] = i | (white ? 64 : 0);
      if ((t === ROOK || t === QUEEN) && EV_HEAVY_N < 20) EV_HEAVY[EV_HEAVY_N++] = i | (white ? 64 : 0);
    }

    const v = VALUE[t] + PST[t][white ? i : MIRROR[i]];
    score += white ? v : -v;
  }

  /* ---------------- Built-in endgame prediction ---------------- *
   * A handful of endings have a known outcome that a watch-sized search will
   * not discover inside its budget. Rather than search them, score them
   * directly: this is the difference between an engine that corners a bare
   * king and one that shuffles until the 50-move rule rescues the defender. */

  /* Nobody can mate: no pawns, no rooks or queens, at most one minor each.
   * Call it a draw and stop evaluating, so the engine plays for something
   * else instead of chasing a win that does not exist. */
  if (!pawnsW && !pawnsB && !rooksW && !rooksB && !queensW && !queensB &&
      minorsW <= 1 && minorsB <= 1) {
    return 0;
  }

  const wK0 = pos.kingSq[0];
  const bK0 = pos.kingSq[1];

  /* Queen or rook against a bare king: shrink the defender's box and walk our
   * own king in. This is the standard mating technique, encoded. */
  if (wK0 >= 0 && bK0 >= 0) {
    if (!pawnsB && !minorsB && !rooksB && !queensB && (queensW > 0 || rooksW > 0)) {
      score += mateDrive(wK0, bK0, heavySquare(true));
    }
    if (!pawnsW && !minorsW && !rooksW && !queensW && (queensB > 0 || rooksB > 0)) {
      score -= mateDrive(bK0, wK0, heavySquare(false));
    }
  }

  /* KP vs K: the rule of the square. If the defending king cannot reach the
   * promotion square in time, the pawn is winning on its own. */
  if (wK0 >= 0 && bK0 >= 0) {
    if (pawnsW === 1 && !pawnsB && !minorsW && !minorsB && !rooksW && !rooksB &&
        !queensW && !queensB) {
      if (unstoppablePasser(EV_PAWNS[0] & 63, bK0, !pos.wtm, true)) score += 250;
    }
    if (pawnsB === 1 && !pawnsW && !minorsW && !minorsB && !rooksW && !rooksB &&
        !queensW && !queensB) {
      if (unstoppablePasser(EV_PAWNS[0] & 63, wK0, pos.wtm, false)) score -= 250;
    }
  }

  /* Taper: 0 = pure middlegame, 256 = pure endgame. */
  let eg = PHASE_MAX - npm;
  if (eg < 0) eg = 0;
  if (eg > PHASE_MAX) eg = PHASE_MAX;
  eg = ((eg << 8) / PHASE_MAX) | 0;
  const mg = 256 - eg;

  /* King placement, tapered between the two tables. */
  const wK = pos.kingSq[0];
  const bK = pos.kingSq[1];
  if (wK >= 0) {
    const mid = PST_KING_MID[wK];
    const end = PST_KING_END[wK];
    score += mid + (((end - mid) * eg) >> 8);
  }
  if (bK >= 0) {
    const m2 = MIRROR[bK];
    const mid = PST_KING_MID[m2];
    const end = PST_KING_END[m2];
    score -= mid + (((end - mid) * eg) >> 8);
  }

  /* Rook activity: open and half-open files, plus the seventh rank. */
  for (let i = 0; i < rookCount; i++) {
    const e = EV_ROOKS[i];
    const idx = e & 63;
    const white = (e & 64) !== 0;
    const f = idx & 7;
    const r = idx >> 3;
    const wPawn = wf[f] !== 0;
    const bPawn = bf[f] !== 0;
    if (white) {
      if (!wPawn && bPawn) score += 30;
      else if (!wPawn) score += 20;
      if (r === 1) score += 22;
    } else {
      if (!bPawn && wPawn) score -= 30;
      else if (!bPawn) score -= 20;
      if (r === 6) score -= 22;
    }
  }

  /* Pawn structure. */
  for (let f = 0; f < 8; f++) {
    const wc = POPC[wf[f] & 255];
    const bc = POPC[bf[f] & 255];
    if (wc > 1) score -= 16 * (wc - 1);
    if (bc > 1) score += 16 * (bc - 1);
    const wl = f > 0 ? wf[f - 1] : 0;
    const wr = f < 7 ? wf[f + 1] : 0;
    const bl = f > 0 ? bf[f - 1] : 0;
    const br = f < 7 ? bf[f + 1] : 0;
    if (wc && !(wl | wr)) score -= 14 * wc;
    if (bc && !(bl | br)) score += 14 * bc;
  }

  /* Passed pawns. A pawn is passed when no enemy pawn stands on its own or an
   * adjacent file *ahead* of it. The rank masks make that a pair of ANDs. */
  for (let i = 0; i < pawnCount; i++) {
    const e = EV_PAWNS[i];
    const white = (e & 64) !== 0;
    const idx = e & 63;
    const f = idx & 7;
    const r = idx >> 3;
    let blocked;
    let advance;
    if (white) {
      const ahead = (1 << r) - 1;                     /* rows 0..r-1 */
      const enemy = bf[f] | (f > 0 ? bf[f - 1] : 0) | (f < 7 ? bf[f + 1] : 0);
      blocked = enemy & ahead;
      advance = 6 - r;
    } else {
      const ahead = ~((1 << (r + 1)) - 1) & 255;      /* rows r+1..7 */
      const enemy = wf[f] | (f > 0 ? wf[f - 1] : 0) | (f < 7 ? wf[f + 1] : 0);
      blocked = enemy & ahead;
      advance = r - 1;
    }
    if (blocked || advance < 0) continue;
    if (advance > 6) advance = 6;
    const bonus = PASSED_BONUS[advance];
    score += white ? bonus : -bonus;
  }

  /* King safety: pawn shield plus a penalty for an enemy pawn breathing on the
   * king. Middlegame only — with nothing left to attack with, a "safe" king is
   * meaningless and this term only gets in the way. */
  if (npm >= 1200 && wK >= 0 && bK >= 0) {
    score += kingShield(s, wK, true, mg);
    score -= kingShield(s, bK, false, mg);
  }

  /* Endgame king tropism: the side that is materially ahead wants the kings
   * close together, which is what actually converts K+P endings. */
  if (eg > 128 && wK >= 0 && bK >= 0) {
    const d = Math.abs((wK >> 3) - (bK >> 3)) + Math.abs((wK & 7) - (bK & 7));
    const closeness = 14 - d;
    if (score > 100) score += closeness * 4;
    else if (score < -100) score -= closeness * 4;
  }

  if (bishopsW >= 2) score += 30;
  if (bishopsB >= 2) score -= 30;

  /* Tempo. */
  score += pos.wtm ? 8 : -8;

  return pos.wtm ? score : -score;
}

/* Weights for the mop-up term below. Tuned by playing K+R vs K out from
 * several positions, because the numbers matter more than the shape here. */
const MOPUP_EDGE = 10;
const MOPUP_KING = 4;
const MOPUP_HEAVY = 5;

/* How well the strong side is doing at cornering a bare king.
 *
 * `edge` grows as the defender is pushed to the rim and `close` as the
 * attacking king walks in — the two things a real mating net manipulates.
 *
 * `heavy` is the square of the rook or queen. Its distance term is not
 * decoration: without it the whole term depends only on the two kings, so
 * every rook move in K+R vs K evaluates identically and the engine shuffles
 * the rook between two squares forever instead of making progress. */
function mateDrive(strongK, weakK, heavy) {
  const fr = weakK >> 3;
  const fc = weakK & 7;
  const edge = (Math.abs(2 * fr - 7) + Math.abs(2 * fc - 7)) >> 1;   /* 1..7 */
  const dist = Math.abs((strongK >> 3) - fr) + Math.abs((strongK & 7) - fc);
  let v = MOPUP_EDGE * edge + MOPUP_KING * (14 - dist);
  if (heavy >= 0) {
    const rd = Math.abs((heavy >> 3) - fr) + Math.abs((heavy & 7) - fc);
    v += MOPUP_HEAVY * (14 - rd);
  }
  return v;
}

/* Square of the strong side's heaviest piece, or -1 when there is none.
 * Rooks and queens are already collected in EV_ROOKS / EV_PAWNS order, so the
 * first entry of the right colour is enough: in a mop-up there is usually one
 * such piece, and if there are two the term is only a nudge. */
function heavySquare(white) {
  const n = EV_HEAVY_N;
  for (let i = 0; i < n; i++) {
    const e = EV_HEAVY[i];
    if ((e & 64) !== 0 === white) return e & 63;
  }
  return -1;
}

/* Rule of the square: can the defending king reach the promotion square before
 * the pawn runs? `defenderToMove` gives the defender its extra tempo, and a
 * pawn still on its home rank gains a tempo from the double push. */
function unstoppablePasser(pawnSq, defenderK, defenderToMove, white) {
  const file = pawnSq & 7;
  const row = pawnSq >> 3;
  let steps = white ? row : 7 - row;
  if ((white && row === 6) || (!white && row === 1)) steps--;
  if (steps < 0) steps = 0;
  const promoRow = white ? 0 : 7;
  const dist = Math.abs((defenderK >> 3) - promoRow) + Math.abs((defenderK & 7) - file);
  return dist > steps + (defenderToMove ? 1 : 0);
}

function kingShield(s, kSq, white, mg) {
  const f = kSq & 7;
  const r = kSq >> 3;
  const dir = white ? -1 : 1;
  const ownPawn = white ? PAWN : -PAWN;
  const enemyPawn = white ? -PAWN : PAWN;
  let pen = 0;
  for (let df = -1; df <= 1; df++) {
    const ff = f + df;
    if (ff < 0 || ff > 7) continue;
    const r1 = r + dir;
    const r2 = r + 2 * dir;
    if (r1 >= 0 && r1 < 8 && s[r1 * 8 + ff] !== ownPawn) pen += 10;
    if (r2 >= 0 && r2 < 8 && s[r2 * 8 + ff] !== ownPawn) pen += 5;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr > 7) continue;
      if (s[rr * 8 + ff] === enemyPawn) pen += 8;
    }
  }
  return -((pen * mg) >> 8);
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

function Search(level) {
  this.cfg = LEVELS[level] || LEVELS.normal;
  this.pos = new Position();
  this.nodes = 0;
  this.deadline = 0;
  this.aborted = false;
  this.ttSize = 0;
  this.ttMask = 0;
  this.ttKey = null;
  this.ttMove = null;
  this.ttScore = null;
  this.ttMeta = null;
  this.history = null;
  this.killers = null;
  this.moves = null;
  this.mScore = null;
  this.pathKeys = null;
  this.alloc();
}

Search.prototype.alloc = function () {
  if (!this.moves) {
    this.moves = new Int32Array(MOVE_BUF);
    this.mScore = new Int32Array(MOVE_BUF);
    this.killers = new Int32Array(MAX_PLY * 2);
    this.pathKeys = new Int32Array(MAX_PLY + 8);
    this.history = new Int32Array(64 * 64);
  }
  const bits = this.cfg.ttBits;
  const n = 1 << bits;
  if (this.ttSize !== n || !this.ttKey) {
    this.ttSize = n;
    this.ttMask = n - 1;
    this.ttKey = new Int32Array(n);
    this.ttMove = new Int32Array(n);
    this.ttScore = new Int32Array(n);
    this.ttMeta = new Int32Array(n);
  }
};

Search.prototype.reset = function () {
  this.nodes = 0;
  this.aborted = false;
  this.alloc();
  /* Age rather than clear: the history heuristic is more useful when it
   * remembers the previous moves of the same game. */
  const h = this.history;
  for (let i = 0; i < h.length; i++) h[i] = h[i] >> 2;
  const k = this.killers;
  for (let i = 0; i < k.length; i++) k[i] = 0;
};

Search.prototype.evaluate = function () {
  return evaluatePos(this.pos);
};

/* ------------------------------------------------------------------ *
 * Static Exchange Evaluation
 *
 * Resolves the whole capture sequence on `to`, not just the first recapture.
 * Used to order captures and to drop losing captures from the quiescence tree.
 * ------------------------------------------------------------------ */

Position.prototype.leastAttacker = function (sq, white, allowKing) {
  const s = this.sq;

  const pa = PAWN_ATTACKERS[white ? 0 : 1][sq];
  const pawnCode = white ? PAWN : -PAWN;
  for (let i = 0; i < pa.length; i++) if (s[pa[i]] === pawnCode) return pa[i];

  const kn = KNIGHT_MOVES[sq];
  const knightCode = white ? KNIGHT : -KNIGHT;
  for (let i = 0; i < kn.length; i++) if (s[kn[i]] === knightCode) return kn[i];

  const rd = RAY_D[sq];
  for (let d = 0; d < 4; d++) {
    const line = rd[d];
    for (let i = 0; i < line.length; i++) {
      const t = s[line[i]];
      if (!t) continue;
      if ((t > 0) === white) {
        const a = t < 0 ? -t : t;
        if (a === BISHOP || a === QUEEN) return line[i];
      }
      break;
    }
  }
  const ro = RAY_O[sq];
  for (let d = 0; d < 4; d++) {
    const line = ro[d];
    for (let i = 0; i < line.length; i++) {
      const t = s[line[i]];
      if (!t) continue;
      if ((t > 0) === white) {
        const a = t < 0 ? -t : t;
        if (a === ROOK || a === QUEEN) return line[i];
      }
      break;
    }
  }

  if (allowKing) {
    const kg = KING_MOVES[sq];
    const kingCode = white ? KING : -KING;
    for (let i = 0; i < kg.length; i++) {
      if (s[kg[i]] === kingCode) {
        /* A king may only capture into an undefended square. */
        if (!this.isAttacked(sq, !white)) return kg[i];
        return -1;
      }
    }
  }
  return -1;
};

/* Best value `side` can win by continuing the exchange on `sq`, where the
 * piece currently standing there is worth `victim`. Returns 0 when the side
 * has no attacker, i.e. it simply stops capturing. */
Search.prototype.seeRec = function (sq, white, victim) {
  const pos = this.pos;
  const a = pos.leastAttacker(sq, white, true);
  if (a < 0) return 0;
  const s = pos.sq;
  const code = s[a];
  const saved = code;
  s[a] = 0;
  const gain = victim - this.seeRec(sq, !white, VALUE[code < 0 ? -code : code]);
  s[a] = saved;
  return gain > 0 ? gain : 0;
};

Search.prototype.see = function (m) {
  const pos = this.pos;
  const s = pos.sq;
  const from = mvFrom(m);
  const to = mvTo(m);
  const promo = mvPromo(m);
  const epFlag = mvEpFlag(m);
  const cap = mvCap(m);

  const capSq = epFlag ? (to < from ? to + 8 : to - 8) : to;
  if (!cap) return 0;

  /* Nothing defends the destination, so the capture is simply free. This is
   * the common case and it avoids the whole exchange walk. */
  if (!pos.isAttacked(to, !pos.wtm)) return VALUE[cap];

  const moverCode = s[from];
  const attVal = promo ? VALUE[promo] : VALUE[moverCode < 0 ? -moverCode : moverCode];
  const capVal = VALUE[cap] + (promo ? VALUE[promo] - VALUE[PAWN] : 0);

  /* Remove the mover from its origin so a slider behind it is discovered, and
   * remove the victim. */
  const savedFrom = s[from];
  const savedCap = s[capSq];
  s[from] = 0;
  s[capSq] = 0;
  const v = capVal - this.seeRec(to, !pos.wtm, attVal);
  s[from] = savedFrom;
  s[capSq] = savedCap;
  return v;
};

/* ------------------------------------------------------------------ *
 * Move generation
 *
 * Writes packed moves into this.moves[ply * MAX_MOVES ...] and returns the
 * count. `capsOnly` restricts to captures, promotions and en passant for the
 * quiescence search.
 * ------------------------------------------------------------------ */

Search.prototype.genMoves = function (ply, capsOnly) {
  const pos = this.pos;
  const s = pos.sq;
  const wtm = pos.wtm;
  const base = ply * MAX_MOVES;
  const buf = this.moves;
  const epSq = pos.ep;
  let n = 0;

  for (let from = 0; from < 64; from++) {
    const p = s[from];
    if (!p) continue;
    if (wtm ? p < 0 : p > 0) continue;
    const t = p < 0 ? -p : p;
    const r = from >> 3;
    const c = from & 7;

    if (t === PAWN) {
      const rr = wtm ? r - 1 : r + 1;
      const lastRow = wtm ? 0 : 7;
      if (rr >= 0 && rr < 8) {
        if (rr === lastRow) {
          /* Promotions are forcing, so the quiescence search sees them too.
           * The target must still be empty for a non-capturing push. */
          if (!s[rr * 8 + c]) {
            buf[base + n++] = pack(from, rr * 8 + c, QUEEN, 0, 0, 0);
            if (!capsOnly) {
              buf[base + n++] = pack(from, rr * 8 + c, ROOK, 0, 0, 0);
              buf[base + n++] = pack(from, rr * 8 + c, BISHOP, 0, 0, 0);
              buf[base + n++] = pack(from, rr * 8 + c, KNIGHT, 0, 0, 0);
            }
          }
        } else if (!s[rr * 8 + c] && !capsOnly) {
          buf[base + n++] = pack(from, rr * 8 + c, 0, 0, 0, 0);
          if (r === (wtm ? 6 : 1)) {
            const r2 = wtm ? r - 2 : r + 2;
            if (!s[r2 * 8 + c]) buf[base + n++] = pack(from, r2 * 8 + c, 0, 0, 0, 0);
          }
        }
        for (let k = 0; k < 2; k++) {
          const cc = c + (k ? 1 : -1);
          if (cc < 0 || cc > 7) continue;
          const to = rr * 8 + cc;
          const tp = s[to];
          if (tp) {
            if (wtm ? tp > 0 : tp < 0) continue;
            const cap = tp < 0 ? -tp : tp;
            if (rr === lastRow) {
              buf[base + n++] = pack(from, to, QUEEN, 0, cap, 0);
              if (!capsOnly) {
                buf[base + n++] = pack(from, to, ROOK, 0, cap, 0);
                buf[base + n++] = pack(from, to, BISHOP, 0, cap, 0);
                buf[base + n++] = pack(from, to, KNIGHT, 0, cap, 0);
              }
            } else {
              buf[base + n++] = pack(from, to, 0, 0, cap, 0);
            }
          } else if (to === epSq) {
            buf[base + n++] = pack(from, to, 0, 0, PAWN, 1);
          }
        }
      }
      continue;
    }

    if (t === KNIGHT || t === KING) {
      const list = t === KNIGHT ? KNIGHT_MOVES[from] : KING_MOVES[from];
      for (let i = 0; i < list.length; i++) {
        const to = list[i];
        const tp = s[to];
        if (tp && (wtm ? tp > 0 : tp < 0)) continue;
        if (capsOnly && !tp) continue;
        buf[base + n++] = pack(from, to, 0, 0, tp ? (tp < 0 ? -tp : tp) : 0, 0);
      }
      if (t === KING) {
        const cb = pos.cb;
        if (wtm && from === 60) {
          if ((cb & 1) && !s[61] && !s[62] && s[63] === ROOK &&
              !pos.isAttacked(60, false) && !pos.isAttacked(61, false) && !pos.isAttacked(62, false)) {
            buf[base + n++] = pack(60, 62, 0, 1, 0, 0);
          }
          if ((cb & 2) && !s[59] && !s[58] && !s[57] && s[56] === ROOK &&
              !pos.isAttacked(60, false) && !pos.isAttacked(59, false) && !pos.isAttacked(58, false)) {
            buf[base + n++] = pack(60, 58, 0, 2, 0, 0);
          }
        } else if (!wtm && from === 4) {
          if ((cb & 4) && !s[5] && !s[6] && s[7] === -ROOK &&
              !pos.isAttacked(4, true) && !pos.isAttacked(5, true) && !pos.isAttacked(6, true)) {
            buf[base + n++] = pack(4, 6, 0, 1, 0, 0);
          }
          if ((cb & 8) && !s[3] && !s[2] && !s[1] && s[0] === -ROOK &&
              !pos.isAttacked(4, true) && !pos.isAttacked(3, true) && !pos.isAttacked(2, true)) {
            buf[base + n++] = pack(4, 2, 0, 2, 0, 0);
          }
        }
      }
      continue;
    }

    /* Sliding pieces. */
    if (t === ROOK || t === QUEEN) {
      const rays = RAY_O[from];
      for (let d = 0; d < 4; d++) {
        const line = rays[d];
        for (let i = 0; i < line.length; i++) {
          const to = line[i];
          const tp = s[to];
          if (!tp) {
            if (!capsOnly) buf[base + n++] = pack(from, to, 0, 0, 0, 0);
            continue;
          }
          if (wtm ? tp < 0 : tp > 0) buf[base + n++] = pack(from, to, 0, 0, tp < 0 ? -tp : tp, 0);
          break;
        }
      }
    }
    if (t === BISHOP || t === QUEEN) {
      const rays = RAY_D[from];
      for (let d = 0; d < 4; d++) {
        const line = rays[d];
        for (let i = 0; i < line.length; i++) {
          const to = line[i];
          const tp = s[to];
          if (!tp) {
            if (!capsOnly) buf[base + n++] = pack(from, to, 0, 0, 0, 0);
            continue;
          }
          if (wtm ? tp < 0 : tp > 0) buf[base + n++] = pack(from, to, 0, 0, tp < 0 ? -tp : tp, 0);
          break;
        }
      }
    }
  }

  return n;
};

/* Legal move list, used by the host page and by the root search. */
Search.prototype.genLegal = function (ply) {
  const pos = this.pos;
  const base = ply * MAX_MOVES;
  const buf = this.moves;
  const n = this.genMoves(ply, false);
  const wtm = pos.wtm;
  const kIdx = wtm ? 0 : 1;
  let out = 0;
  for (let i = 0; i < n; i++) {
    const m = buf[base + i];
    const u = pos.make(m);
    if (!pos.isAttacked(pos.kingSq[kIdx], !wtm)) {
      buf[base + out++] = m;
    }
    pos.unmake(u);
  }
  return out;
};

/* ------------------------------------------------------------------ *
 * Move ordering
 * ------------------------------------------------------------------ */

Search.prototype.orderMoves = function (base, n, ttMove, ply) {
  const pos = this.pos;
  const s = pos.sq;
  const buf = this.moves;
  const sc = this.mScore;
  const hist = this.history;
  const useSee = this.cfg.see;
  const k1 = this.killers[ply * 2];
  const k2 = this.killers[ply * 2 + 1];

  for (let i = 0; i < n; i++) {
    const m = buf[base + i];
    if (m === ttMove) { sc[base + i] = 1000000000; continue; }
    const from = mvFrom(m);
    const to = mvTo(m);
    const promo = mvPromo(m);
    const castle = mvCastle(m);
    const cap = mvCap(m);
    let v;
    if (cap) {
      const attacker = s[from];
      const attVal = VALUE[attacker < 0 ? -attacker : attacker];
      v = 2000000 + VALUE[cap] * 16 - attVal;
      /* Only spend a full exchange evaluation on a capture that could
       * plausibly lose material. A pawn taking a queen is obviously fine, and
       * SEE is by far the most expensive part of ordering — profiling put it
       * at roughly a third of total search time before this gate existed. */
      if (useSee && VALUE[cap] <= attVal + 100) {
        const sv = this.see(m);
        if (sv < 0) v = -1000000 + sv;
      }
      if (promo) v += 500000 + VALUE[promo];
    } else if (promo) {
      v = 1500000 + VALUE[promo];
    } else if (castle) {
      v = 800000;
    } else if (m === k1) {
      v = 1000000;
    } else if (m === k2) {
      v = 900000;
    } else {
      v = hist[from * 64 + to];
    }
    sc[base + i] = v;
  }
};

/* Selection sort step: promote the best-scored remaining move to index i.
 * Selection rather than Array.sort because sort allocates a comparator closure
 * at every node; and because most nodes cut off after two or three moves, the
 * quadratic worst case is almost never paid. */
Search.prototype.pickMove = function (base, i, n) {
  const buf = this.moves;
  const sc = this.mScore;
  let bi = i;
  let bs = sc[base + i];
  for (let j = i + 1; j < n; j++) {
    const v = sc[base + j];
    if (v > bs) { bs = v; bi = j; }
  }
  if (bi !== i) {
    const tm = buf[base + i];
    buf[base + i] = buf[base + bi];
    buf[base + bi] = tm;
    sc[base + bi] = sc[base + i];
    sc[base + i] = bs;
  }
};

/* ------------------------------------------------------------------ *
 * Quiescence search
 * ------------------------------------------------------------------ */

Search.prototype.quiesce = function (alpha, beta, ply, qd) {
  if ((this.nodes & 255) === 0 && Date.now() > this.deadline) {
    this.aborted = true;
    return 0;
  }
  this.nodes++;

  const pos = this.pos;
  const wtm = pos.wtm;
  const kIdx = wtm ? 0 : 1;
  const inChk = pos.isAttacked(pos.kingSq[kIdx], !wtm);

  /* standPat is the score we already hold without capturing anything. Every
   * delta-pruning decision is measured against it, not against the running
   * alpha, which is the usual mistake and makes the test never fire. */
  let standPat = -INF;
  if (!inChk) {
    standPat = evaluatePos(pos);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (qd <= 0) return alpha;
  }
  if (ply >= MAX_PLY - 4) return inChk ? alpha : standPat;

  const base = ply * MAX_MOVES;
  const buf = this.moves;
  const n = this.genMoves(ply, !inChk);
  this.orderMoves(base, n, 0, ply);

  let best = inChk ? -INF : alpha;
  let legal = 0;

  for (let i = 0; i < n; i++) {
    this.pickMove(base, i, n);
    const m = buf[base + i];
    const cap = mvCap(m);
    const promo = mvPromo(m);

    if (!inChk) {
      /* Delta pruning: even if the capturing piece were then handed over for
       * free, this capture cannot reach alpha, so it is not worth a node. */
      if (!promo && standPat + VALUE[cap] + 200 < alpha) continue;
      if (this.cfg.see && !promo && cap && this.see(m) < 0) continue;
    }

    const u = pos.make(m);
    if (pos.isAttacked(pos.kingSq[kIdx], !wtm)) { pos.unmake(u); continue; }
    legal++;
    const score = -this.quiesce(-beta, -alpha, ply + 1, qd - 1);
    pos.unmake(u);

    if (this.aborted) return 0;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) return beta;
  }

  if (inChk && legal === 0) return -(MATE - ply);
  return best;
};

/* ------------------------------------------------------------------ *
 * Negamax
 * ------------------------------------------------------------------ */

/* Late-move reduction table: how many plies to shave off a quiet move that is
 * ordered late at a given depth. Deeper and later means a bigger reduction. */
const LMR = new Int32Array(32 * 32);
(function buildLmr() {
  for (let d = 0; d < 32; d++) {
    for (let i = 0; i < 32; i++) {
      let r = 0;
      if (d >= 3 && i >= 2) {
        r = 1;
        if (d >= 5 && i >= 4) r = 2;
        if (d >= 7 && i >= 8) r = 3;
      }
      LMR[d * 32 + i] = r;
    }
  }
})();

/* Repetition / 50-move scores.
 *
 * A plain 0 is correct for a dead-drawn position, but it makes the engine
 * happy to shuffle while it is winning: every repetition looks "as good as"
 * any other line once the score is clamped to 0. Contempt turns a repetition
 * into a small loss when the side to move is clearly better, which forces the
 * search to keep making progress instead of taking the draw. In a balanced or
 * worse position the contempt is not applied, so genuine perpetual checks and
 * forced draws still evaluate as 0.
 */
Search.prototype.repScore = function () {
  const c = this.cfg.contempt;
  if (!c) return 0;
  return evaluatePos(this.pos) > 150 ? -c : 0;
};

Search.prototype.negamax = function (depth, alpha, beta, ply, isPv) {
  if ((this.nodes & 255) === 0 && Date.now() > this.deadline) {
    this.aborted = true;
    return 0;
  }
  this.nodes++;

  const pos = this.pos;
  const wtm = pos.wtm;
  const kIdx = wtm ? 0 : 1;
  const key = pos.key;

  if (ply >= MAX_PLY - 2) return evaluatePos(pos);

  if (ply > 0) {
    if (pos.halfmove >= 100) return 0;
    /* Repetition along the current line is a draw. Without this the engine
     * happily walks into a repetition while sitting on a winning position. */
    for (let i = ply - 2; i >= 0; i -= 2) {
      if (this.pathKeys[i] === key) return this.repScore();
    }
    /* Mate distance pruning. */
    if (alpha < -MATE + ply) alpha = -MATE + ply;
    if (beta > MATE - ply - 1) beta = MATE - ply - 1;
    if (alpha >= beta) return alpha;
  }
  this.pathKeys[ply] = key;

  const inChk = pos.isAttacked(pos.kingSq[kIdx], !wtm);
  /* Check extension: a forcing line is worth one extra ply, otherwise mates
   * hide just past the horizon. */
  if (inChk && ply < 20) depth++;

  if (depth <= 0) {
    return this.cfg.quiesce ? this.quiesce(alpha, beta, ply, 6) : evaluatePos(pos);
  }

  /* ---------------- Transposition table probe ---------------- */
  let ttMove = 0;
  const idx = key & this.ttMask;
  const meta = this.ttMeta[idx];
  if (meta !== 0 && this.ttKey[idx] === key) {
    const stored = this.ttScore[idx];
    const d = meta & 255;
    const flag = (meta >> 8) & 3;
    if (d >= depth && ply > 0) {
      if (flag === TT_EXACT) return stored;
      if (flag === TT_LOWER && stored >= beta) return stored;
      if (flag === TT_UPPER && stored <= alpha) return stored;
    }
    ttMove = this.ttMove[idx];
  }

  const alphaOrig = alpha;
  const mateBound = Math.abs(beta) >= MATE - 200;
  let staticEval = 0;
  let haveStatic = false;

  /* ---------------- Reverse futility (static null move) ---------------- *
   * If the static score is already far above beta at a shallow depth, no quiet
   * move is going to change that. */
  if (!isPv && !inChk && !mateBound && depth <= 4) {
    staticEval = evaluatePos(pos);
    haveStatic = true;
    if (staticEval - 110 * depth >= beta) return staticEval;
  }

  /* ---------------- Razoring ---------------- *
   * At depth 1, if the static score is hopeless, drop straight to quiescence
   * instead of spending a full move loop on it. */
  if (this.cfg.razor && !isPv && !inChk && !mateBound && depth === 1) {
    if (!haveStatic) { staticEval = evaluatePos(pos); haveStatic = true; }
    if (staticEval + 300 <= alpha) {
      const q = this.quiesce(alpha, beta, ply, 6);
      return q < alpha ? q : alpha;
    }
  }

  /* ---------------- Null-move pruning ---------------- */
  if (this.cfg.nmp && !isPv && !inChk && !mateBound && depth >= 3 &&
      pos.nonPawnMaterial(wtm) > 0) {
    const r = 2 + (depth > 6 ? 1 : 0);
    const undoEp = pos.makeNull();
    const score = -this.negamax(depth - 1 - r, -beta, -beta + 1, ply + 1, false);
    pos.unmakeNull(undoEp);
    if (this.aborted) return 0;
    if (score >= beta) return beta;
  }

  const base = ply * MAX_MOVES;
  const buf = this.moves;
  const n = this.genMoves(ply, false);
  this.orderMoves(base, n, ttMove, ply);

  let best = -INF;
  let bestMove = 0;
  let legal = 0;

  for (let i = 0; i < n; i++) {
    this.pickMove(base, i, n);
    const m = buf[base + i];
    const cap = mvCap(m);
    const promo = mvPromo(m);
    const castle = mvCastle(m);
    const tactical = cap !== 0 || promo !== 0 || castle !== 0 || mvEpFlag(m) !== 0;

    /* ---------------- Futility pruning ---------------- *
     * Skip a quiet move that is too far behind alpha to matter. Never applied
     * to the first move, in check, or in a mate-scored window. */
    if (this.cfg.futility && !isPv && !inChk && !tactical && depth <= 3 &&
        legal > 0 && !mateBound) {
      if (!haveStatic) { staticEval = evaluatePos(pos); haveStatic = true; }
      if (staticEval + 140 * depth + 60 <= alpha) continue;
    }

    const u = pos.make(m);
    if (pos.isAttacked(pos.kingSq[kIdx], !wtm)) { pos.unmake(u); continue; }
    legal++;

    let d = depth - 1;
    let reduced = false;
    if (this.cfg.lmr && i >= 2 && depth >= 3 && !inChk && !tactical && legal > 1) {
      const givesCheck = pos.isAttacked(pos.kingSq[1 - kIdx], wtm);
      if (!givesCheck) {
        let r = LMR[(depth < 31 ? depth : 31) * 32 + (i < 31 ? i : 31)];
        if (!isPv && r > 0) r++;
        if (d - r < 0) r = d;
        if (r > 0) { d -= r; reduced = true; }
      }
    }

    let score;
    if (legal === 1 && isPv && !reduced) {
      score = -this.negamax(d, -beta, -alpha, ply + 1, true);
    } else {
      score = -this.negamax(d, -alpha - 1, -alpha, ply + 1, false);
      if (score > alpha && (reduced || score < beta)) {
        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, isPv);
      }
    }
    pos.unmake(u);

    if (this.aborted) return 0;

    if (score > best) { best = score; bestMove = m; }
    if (score > alpha) {
      alpha = score;
      if (alpha >= beta) {
        if (!cap) {
          const kp = ply * 2;
          if (this.killers[kp] !== m) {
            this.killers[kp + 1] = this.killers[kp];
            this.killers[kp] = m;
          }
          const hi = mvFrom(m) * 64 + mvTo(m);
          this.history[hi] += depth * depth;
          if (this.history[hi] > 600000) this.history[hi] = 600000;
        }
        break;
      }
    }
  }

  if (legal === 0) {
    return inChk ? -(MATE - ply) : 0;
  }

  /* ---------------- Transposition table store ---------------- *
   * Mate scores are ply-relative and would be reused wrongly across different
   * paths, so they are not cached. */
  if (best > -INF && best < MATE - 200 && best > -(MATE - 200)) {
    let flag = TT_EXACT;
    if (best <= alphaOrig) flag = TT_UPPER;
    else if (best >= beta) flag = TT_LOWER;
    const prev = this.ttMeta[idx];
    if (prev === 0 || (prev & 255) <= depth) {
      this.ttKey[idx] = key;
      this.ttMove[idx] = bestMove;
      this.ttScore[idx] = best;
      this.ttMeta[idx] = depth | (flag << 8);
    }
  }

  return best;
};

/* ------------------------------------------------------------------ *
 * Opening book
 * ------------------------------------------------------------------ */

Search.prototype.tryBook = function (base, n) {
  if (!this.cfg.book) return 0;
  if (!BOOK) buildBook();
  const cand = BOOK[this.pos.key];
  if (!cand) return 0;

  /* The candidate came from the same position, but it is still matched against
   * the generated move list so a wrong table entry can never emit an illegal
   * move. Only from/to are compared — a book move never captures. */
  const buf = this.moves;
  const legal = [];
  for (let i = 0; i < cand.length; i++) {
    const want = cand[i];
    for (let j = 0; j < n; j++) {
      const m = buf[base + j];
      if ((m & 4095) === want) { legal.push(m); break; }
    }
  }
  if (!legal.length) return 0;
  return legal[Math.floor(Math.random() * legal.length)];
};

/* ------------------------------------------------------------------ *
 * Root search
 * ------------------------------------------------------------------ */

Search.prototype.chooseMove = function (board, turn, castling, ep, halfmove) {
  this.reset();
  const pos = this.pos;
  pos.load(board, turn, castling, ep, halfmove);
  this.deadline = Date.now() + this.cfg.timeMs;

  const base = 0;
  const n = this.genLegal(base);
  if (n === 0) return null;
  if (n === 1) return unpack(this.moves[base]);

  const bookMove = this.tryBook(base, n);
  if (bookMove) return unpack(bookMove);

  const buf = this.moves;
  /* Seed the repetition path with the root key so a two-ply shuffle that
   * returns to the start position is recognised as a draw. */
  this.pathKeys[0] = pos.key;

  let bestMove = buf[base];
  let lastScore = 0;
  let haveScore = false;
  let reachedDepth = 0;

  for (let d = 1; d <= this.cfg.depth; d++) {
    /* Aspiration window: start narrow around last iteration's score and widen
     * on failure. Only from depth 4, where the score has stabilised. */
    let alpha = -INF;
    let beta = INF;
    let window = 40;
    if (this.cfg.aspire && haveScore && d >= 4) {
      alpha = lastScore - window;
      beta = lastScore + window;
    }

    let localBest = 0;
    let localScore = -INF;
    let completed = true;

    for (let attempt = 0; attempt < 5; attempt++) {
      localBest = 0;
      localScore = -INF;
      let curAlpha = alpha;

      for (let i = 0; i < n; i++) {
        const m = buf[base + i];
        const u = pos.make(m);
        let score;
        if (i === 0 || !this.cfg.pvs) {
          score = -this.negamax(d - 1, -beta, -curAlpha, 1, true);
        } else {
          score = -this.negamax(d - 1, -curAlpha - 1, -curAlpha, 1, false);
          if (score > curAlpha && score < beta) {
            score = -this.negamax(d - 1, -beta, -curAlpha, 1, true);
          }
        }
        pos.unmake(u);

        if (this.aborted) { completed = false; break; }

        if (score > localScore) {
          localScore = score;
          localBest = m;
          if (score > curAlpha) curAlpha = score;
        }
        if (score >= beta) break;
      }

      if (!completed) break;

      if (localScore > -INF && localScore < beta) {
        /* The window held. */
        break;
      }
      /* Widen and retry. */
      if (localScore <= alpha) {
        window *= 4;
        alpha = localScore - window;
      } else {
        window *= 4;
        beta = localScore + window;
      }
      if (window > 4000) { alpha = -INF; beta = INF; }
    }

    if (!completed) break;
    reachedDepth = d;

    if (localBest) {
      bestMove = localBest;
      lastScore = localScore;
      haveScore = true;
      /* Bubble the best move to the front so the next iteration prunes sooner. */
      let at = 0;
      while (at < n && buf[base + at] !== localBest) at++;
      if (at > 0 && at < n) {
        for (let i = at; i > 0; i--) buf[base + i] = buf[base + i - 1];
        buf[base] = localBest;
      }
    }

    if (localScore > MATE - 200 || localScore < -(MATE - 200)) break;
    if (Date.now() > this.deadline) break;
  }

  this.reachedDepth = reachedDepth;

  /*
   * Deliberate imperfection for the lower levels, but never when a forced mate
   * is on the board — an "easy" opponent that misses mate in one reads as
   * broken rather than easy. The result is still one of the engine's own legal
   * root moves.
   */
  const mateOnBoard = lastScore > MATE - 200;
  if (!mateOnBoard && this.cfg.blunder > 0 && n > 1) {
    if (Math.random() < this.cfg.blunder) {
      const span = Math.min(n - 1, 3);
      const pick = 1 + Math.floor(Math.random() * span);
      if (buf[base + pick]) bestMove = buf[base + pick];
    }
  }

  return unpack(bestMove);
};

/* ------------------------------------------------------------------ *
 * Public facade used by the game page
 * ------------------------------------------------------------------ */

function AiPlayer(level) {
  this.search = new Search(level || 'normal');
  this.level = level || 'normal';
  this.busy = false;
  this._evalPos = null;
}

AiPlayer.prototype.setLevel = function (level) {
  if (!LEVELS[level]) return false;
  if (this.level === level) return true;
  this.level = level;
  this.search = new Search(level);
  return true;
};

AiPlayer.prototype.label = function () {
  return LEVELS[this.level].label;
};

AiPlayer.prototype.isReady = function () {
  return !this.busy;
};

AiPlayer.prototype.compute = function (board, turn, castling, ep, halfmove) {
  this.busy = true;
  const started = Date.now();
  let move = null;
  try {
    move = this.search.chooseMove(board, turn, castling, ep, halfmove);
    this.lastError = null;
  } catch (e) {
    /* Swallowing the error keeps the game page alive, but it also hides engine
     * bugs behind "the AI passed", so the error is kept for the tests. */
    move = null;
    this.lastError = e;
  }
  this.busy = false;
  if (!move) return null;
  return {
    from: move.from,
    to: move.to,
    promo: move.promo,
    ep: move.ep,
    castle: move.castle,
    points: this.search.nodes,
    ms: Date.now() - started,
    depth: this.search.reachedDepth || 0
  };
};

/*
 * Static evaluation of the current position from White's point of view, in
 * pawns. Used by the status bar to show who stands better.
 */
AiPlayer.prototype.evaluate = function (board, turn, castling, ep, halfmove) {
  if (!this._evalPos) this._evalPos = new Position();
  const p = this._evalPos;
  p.load(board, turn, castling, ep, halfmove);
  const cp = evaluatePos(p);
  return (turn === 'w' ? cp : -cp) / 100;
};

/* One shared Search for one-off move generation, so legalMoves() never
 * allocates a transposition table. */
let _scratch = null;
function scratch() {
  if (!_scratch) _scratch = new Search('easy');
  return _scratch;
}

/* Detect whether the given side has any legal move at all. */
function hasLegalMove(board, turn, castling, ep) {
  const s = scratch();
  s.pos.load(board, turn, castling, ep, 0);
  return s.genLegal(0) > 0;
}

/* Compatibility shim: pseudo-legal moves as host-style objects. */
Position.prototype.pseudoMoves = function (out) {
  const s = scratch();
  s.pos.load(this.board, this.turn, this.castling, this.ep, this.halfmove);
  const n = s.genMoves(0, false);
  const list = out || [];
  list.length = 0;
  for (let i = 0; i < n; i++) list.push(unpack(s.moves[i]));
  return list;
};

/* Legal moves as host-style objects. */
Position.prototype.legalMoves = function () {
  const s = scratch();
  s.pos.load(this.board, this.turn, this.castling, this.ep, this.halfmove);
  const n = s.genLegal(0);
  const out = [];
  for (let i = 0; i < n; i++) out.push(unpack(s.moves[i]));
  return out;
};

/* ------------------------------------------------------------------ *
 * Module shape
 *
 * Vela JS quick apps use ES module syntax (`import ai from '../common/js/ai.js'`),
 * so this file exports a default object plus named exports. The desktop test
 * harness loads it through a small CommonJS bridge (see tools/verify_ai_engine.js)
 * rather than a bundler, which keeps the engine runnable without a build step.
 *
 * The default export is a ready-to-use singleton: `ai.setLevel('hard')` then
 * `ai.compute(board, turn, castling, ep, halfmove)` is all a host page needs.
 * For multiple independent searches, construct `new ai.AiPlayer(level)` instead.
 * ------------------------------------------------------------------ */
const _shared = new AiPlayer('normal');

const ai = {
  LEVELS: LEVELS,
  LEVEL_ORDER: LEVEL_ORDER,
  AiPlayer: AiPlayer,
  Position: Position,
  Search: Search,
  hasLegalMove: hasLegalMove,
  typeOf: typeOf,
  colorOf: colorOf,
  VALUE: VALUE,
  evaluatePos: evaluatePos,

  /* Opening-book diagnostics, used by tools/verify_ai_book_endgame.js. */
  bookSize: function () {
    if (!BOOK) buildBook();
    let n = 0;
    for (const k in BOOK) if (BOOK[k]) n++;
    return n;
  },
  bookReplies: function (board, turn, castling, ep, halfmove) {
    if (!BOOK) buildBook();
    const p = new Position().load(board, turn, castling, ep, halfmove || 0);
    return BOOK[p.key] || null;
  },

  /* Singleton conveniences backed by _shared. */
  setLevel: function (level) { return _shared.setLevel(level); },
  isReady: function () { return _shared.isReady(); },
  label: function () { return _shared.label(); },
  /* The last exception thrown inside compute(), or null. compute() swallows
   * errors so the game page survives, which means this is the only way a test
   * can tell "no move" from "the engine crashed". */
  lastError: function () { return _shared.lastError || null; },
  compute: function (board, turn, castling, ep, halfmove) {
    return _shared.compute(board, turn, castling, ep, halfmove);
  },
  evaluate: function (board, turn, castling, ep, halfmove) {
    return _shared.evaluate(board, turn, castling, ep, halfmove);
  }
};

export default ai;
export {
  LEVELS,
  LEVEL_ORDER,
  AiPlayer,
  Position,
  Search,
  hasLegalMove,
  typeOf,
  colorOf,
  VALUE,
  evaluatePos
};
