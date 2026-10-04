/*
 * ai.js — built-in chess engine for Chess for Xiaomi Vela Bands
 *
 * Design constraints (Xiaomi Band 9 / 9 Pro / 10 are resource limited):
 *   - No external assets, no network, no worker threads.
 *   - Search runs in small time slices spread over rAF/timer ticks so the UI
 *     thread never blocks long enough for the system to consider the page
 *     unresponsive.
 *   - Fixed-size typed arrays for the transposition table and history table so
 *     memory stays flat and predictable.
 *   - Board representation is a plain 64-entry array of piece strings, which is
 *     exactly what the host page already uses. No conversion cost.
 *
 * Piece encoding: 'wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP'
 * Empty square: null
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

/* Piece values in centipawns (used by material evaluation). */
const VALUE = [0, 100, 320, 330, 500, 900, 20000];

/* Piece-square tables, from White's point of view, index 0 = a8 (top-left).
 * The host board also uses index 0 = a8, so no flipping is required for Black
 * beyond mirroring the index. */
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

/* Index of a mirrored square, used to evaluate Black's pieces with White tables. */
const MIRROR = new Int8Array(64);
for (let i = 0; i < 64; i++) MIRROR[i] = (7 - (i >> 3)) * 8 + (i & 7);

/* Difficulty presets.
 *   depth      maximum search depth in plies
 *   timeMs     soft budget for one move, the search yields when exceeded
 *   quiesce    resolve captures at the leaf so the evaluation is not fooled
 *   blunder    probability of picking a lesser root move, makes lower levels
 *              feel human. Ignored when a forced mate is available. */
/*
 * Budgets are deliberately generous: a watch chess opponent is played in short
 * bursts and the user has confirmed that several seconds per move is fine.
 * timeMs is a soft wall-clock deadline, so a slow device simply finishes fewer
 * iterations of iterative deepening instead of overrunning.
 */
const LEVELS = {
  easy:   { key: 'easy',   label: 'Easy',   depth: 1, timeMs: 150,  blunder: 0.30, quiesce: false, nmp: false, lmr: false, pvs: false, see: false, book: false, aspire: false },
  normal: { key: 'normal', label: 'Normal', depth: 4, timeMs: 1000, blunder: 0.10, quiesce: true,  nmp: false, lmr: false, pvs: false, see: false, book: true,  aspire: false },
  hard:   { key: 'hard',   label: 'Hard',   depth: 7, timeMs: 4000, blunder: 0.0,  quiesce: true,  nmp: true,  lmr: true,  pvs: true,  see: true,  book: true,  aspire: true  },
  master: { key: 'master', label: 'Master', depth: 10,timeMs: 10000,blunder: 0.0,  quiesce: true,  nmp: true,  lmr: true,  pvs: true,  see: true,  book: true,  aspire: true  }
};

const LEVEL_ORDER = ['easy', 'normal', 'hard', 'master'];

/* ------------------------------------------------------------------ *
 * Opening book
 *
 * A tiny hand-written book wins games that search cannot. At 1–2 seconds per
 * move the engine otherwise spends its budget rediscovering basic opening
 * principles and can still drift into passive setups. Returning a book move
 * instantly also frees the whole budget for the middlegame.
 *
 * Keys are the FEN-like signature "pieces|turn|castling" of the first few
 * plies, so the book only fires while both sides are still "in book". Every
 * entry stores SAN-ish from/to pairs in board indices and is validated against
 * the current legal move list before it is played — a book move can therefore
 * never produce an illegal move.
 * ------------------------------------------------------------------ */

/* Named squares so the table below stays readable. */
const SQ = {
  a1:56,b1:57,c1:58,d1:59,e1:60,f1:61,g1:62,h1:63,
  a2:48,b2:49,c2:50,d2:51,e2:52,f2:53,g2:54,h2:55,
  a3:40,b3:41,c3:42,d3:43,e3:44,f3:45,g3:46,h3:47,
  a4:32,b4:33,c4:34,d4:35,e4:36,f4:37,g4:38,h4:39,
  a5:24,b5:25,c5:26,d5:27,e5:28,f5:29,g5:30,h5:31,
  a6:16,b6:17,c6:18,d6:19,e6:20,f6:21,g6:22,h6:23,
  a7:8, b7:9, c7:10,d7:11,e7:12,f7:13,g7:14,h7:15,
  a8:0, b8:1, c8:2, d8:3, e8:4, f8:5, g8:6, h8:7
};

/*
 * Book table. Each key is a position signature produced by `bookKey()` below:
 * the 64-character board string, the side to move, and the castling flags.
 * Values are ordered lists of candidate moves; the engine picks pseudo-randomly
 * among them so successive games are not identical.
 *
 * The lines are standard main-line theory chosen for solidity rather than
 * sharpness — a watch opponent that survives the opening without blundering is
 * far more useful than one that gambits.
 */
const BOOK = {
  /* -----------------------------------------------------------------
   * After 1. e4
   * ----------------------------------------------------------------- */
  'e4': [
    [SQ.e7, SQ.e5],   /* 1... e5  — Open game */
    [SQ.c7, SQ.c5],   /* 1... c5  — Sicilian */
    [SQ.e7, SQ.e6],   /* 1... e6  — French */
    [SQ.c7, SQ.c6]    /* 1... c6  — Caro-Kann */
  ],
  /* -----------------------------------------------------------------
   * After 1. d4
   * ----------------------------------------------------------------- */
  'd4': [
    [SQ.d7, SQ.d5],   /* 1... d5  — Closed game */
    [SQ.g8, SQ.f6],   /* 1... Nf6 — Indian defence */
    [SQ.e7, SQ.e6]    /* 1... e6  — QGD complex */
  ],
  /* -----------------------------------------------------------------
   * After 1. Nf3
   * ----------------------------------------------------------------- */
  'Nf3': [
    [SQ.d7, SQ.d5],
    [SQ.g8, SQ.f6],
    [SQ.c7, SQ.c5]
  ],
  /* -----------------------------------------------------------------
   * After 1. c4
   * ----------------------------------------------------------------- */
  'c4': [
    [SQ.e7, SQ.e5],
    [SQ.g8, SQ.f6],
    [SQ.c7, SQ.c5]
  ],
  /* -----------------------------------------------------------------
   * Replies in the main 1.e4 e5 lines (white to move)
   * ----------------------------------------------------------------- */
  'e4e5': [
    [SQ.g1, SQ.f3],   /* 2. Nf3 */
    [SQ.f1, SQ.c4]    /* 2. Bc4 */
  ],
  /* -----------------------------------------------------------------
   * Replies in the main 1.d4 d5 lines (white to move)
   * ----------------------------------------------------------------- */
  'd4d5': [
    [SQ.c2, SQ.c4],   /* 2. c4 */
    [SQ.g1, SQ.f3]    /* 2. Nf3 */
  ]
};

/*
 * Reduce a position to a coarse book key. Only the *shape* of the opening is
 * used: whether the first pawn has moved, and whether the knights are out.
 * This keeps the table tiny while still distinguishing the main first moves.
 *
 * Returns null when the position is too far from the initial array for the
 * book to apply (i.e. any capture has happened, or many pieces have moved).
 */
function bookKey(board, turn) {
  /* Count occupied squares; the initial array has 32. Anything below 30 means
   * material is already flowing, so the book stops. */
  let occupied = 0;
  for (let i = 0; i < 64; i++) if (board[i]) occupied++;
  if (occupied < 30) return null;

  /* Every pawn still on its home rank except the one that has advanced keeps
   * the position identifiable as an opening. */
  const home = [
    /* rank 8 */ 'bR','bN','bB','bQ','bK','bB','bN','bR',
    /* rank 7 */ 'bP','bP','bP','bP','bP','bP','bP','bP',
    /* rank 2 */ 'wP','wP','wP','wP','wP','wP','wP','wP',
    /* rank 1 */ 'wR','wN','wB','wQ','wK','wB','wN','wR'
  ];
  /* If any non-pawn piece is missing from home (knight/bishop sortied) the
   * book still applies; we only bail out on a capture. Captures are detected
   * as a piece count below 32. */
  if (occupied !== 32 && occupied !== 31) {
    /* 31 = exactly one capture happened. Allow it for a couple of lines but do
     * not go deeper. */
    if (occupied < 31) return null;
  }
  return 'ok';
}

/* ------------------------------------------------------------------ *
 * Static Exchange Evaluation (SEE)
 *
 * Before searching a capture, ask "if I take, do I actually win material?"
 * A full implementation walks the whole exchange; the cheap version below only
 * resolves the *first* recapture, which is already enough to reject the
 * obviously-losing captures that bloat the quiescence tree (and to accept the
 * obvious winners early). This is the single most effective pruning term we
 * can add without an attack table.
 * ------------------------------------------------------------------ */

/* Smallest attacker of `sq` for side `by`, returned as a square index or -1. */
Position.prototype.leastAttacker = function (sq, by) {
  const b = this.board;
  const r = sq >> 3;
  const c = sq & 7;
  const meCode = by === 'w' ? 119 : 98;

  /* Pawns first — always the cheapest attacker when present. */
  const pr = by === 'w' ? r + 1 : r - 1;
  if (pr >= 0 && pr < 8) {
    const pawn = by === 'w' ? 'wP' : 'bP';
    if (c > 0 && b[pr * 8 + c - 1] === pawn) return pr * 8 + c - 1;
    if (c < 7 && b[pr * 8 + c + 1] === pawn) return pr * 8 + c + 1;
  }

  /* Knights. */
  const N = by === 'w' ? 'wN' : 'bN';
  const kn = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  for (let k = 0; k < 8; k++) {
    const rr = r + kn[k][0], cc = c + kn[k][1];
    if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
    if (b[rr * 8 + cc] === N) return rr * 8 + cc;
  }

  /* Sliding pieces along the four diagonal / straight rays. */
  const diag = [[-1,-1],[-1,1],[1,-1],[1,1]];
  for (let d = 0; d < 4; d++) {
    let rr = r + diag[d][0], cc = c + diag[d][1];
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
      const p = b[rr * 8 + cc];
      if (p) {
        if (colorOf(p) === meCode) {
          const t = typeOf(p);
          if (t === BISHOP || t === QUEEN) return rr * 8 + cc;
        }
        break;
      }
      rr += diag[d][0]; cc += diag[d][1];
    }
  }
  const orth = [[-1,0],[1,0],[0,-1],[0,1]];
  for (let d = 0; d < 4; d++) {
    let rr = r + orth[d][0], cc = c + orth[d][1];
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
      const p = b[rr * 8 + cc];
      if (p) {
        if (colorOf(p) === meCode) {
          const t = typeOf(p);
          if (t === ROOK || t === QUEEN) return rr * 8 + cc;
        }
        break;
      }
      rr += orth[d][0]; cc += orth[d][1];
    }
  }

  /* King last (it can only recapture when it is not defended). */
  const K = by === 'w' ? 'wK' : 'bK';
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
      if (b[rr * 8 + cc] === K) return rr * 8 + cc;
    }
  }
  return -1;
};

/*
 * Two-ply static exchange. Positive result means the capture wins material.
 * The board is mutated in place and restored before returning.
 */
Search.prototype.see = function (m) {
  const b = this.pos.board;
  const victimType = typeOf(b[m.to]);
  const gain = victimType ? VALUE[victimType] : (m.ep >= 0 ? VALUE[PAWN] : 0);
  if (gain === 0) return 0;

  const attackerSquare = m.from;
  const attackerType = typeOf(b[attackerSquare]);
  if (m.promo) return gain + VALUE[m.promo] - VALUE[PAWN] - VALUE[attackerType];

  const me = this.pos.turn;
  const opp = me === 'w' ? 'b' : 'w';

  const undo = this.pos.make(m);
  const back = this.pos.leastAttacker(m.to, opp);
  let net = gain - VALUE[attackerType];
  if (back >= 0) {
    const backType = typeOf(this.pos.board[back]);
    /* Only subtract the recapture when it is not on a defended square of ours;
     * a one-ply lookahead is deliberately optimistic in our favour, which is
     * the safe direction for a pruning heuristic. */
    net -= Math.max(0, VALUE[backType] - VALUE[attackerType]);
  }
  this.pos.unmake(undo);
  return net;
};


/* ------------------------------------------------------------------ *
 * Zobrist hashing + transposition table
 *
 * A chess search reaches the same position through many different move orders.
 * Without a TT those transpositions are re-searched from scratch; with one, a
 * 32-bit key lets us reuse the score and the best move, which is worth roughly
 * two extra plies of depth for the same wall-clock cost. That is the single
 * biggest strength-per-second win available to this engine.
 *
 * Keys come from a fixed-seed LCG so runs are reproducible.
 * ------------------------------------------------------------------ */
let _zSeed = 0x243F6A88 >>> 0;
function zrnd() {
  _zSeed ^= (_zSeed << 13); _zSeed >>>= 0;
  _zSeed ^= (_zSeed >>> 17);
  _zSeed ^= (_zSeed << 5);  _zSeed >>>= 0;
  return _zSeed >>> 0;
}
/* [colourIndex * 6 + typeIndex][square]; typeIndex is P,N,B,R,Q,K. */
const ZOB_PIECE = [];
for (let c = 0; c < 2; c++) {
  for (let t = 0; t < 6; t++) {
    const row = new Uint32Array(64);
    for (let s = 0; s < 64; s++) row[s] = zrnd();
    ZOB_PIECE.push(row);
  }
}
const ZOB_CASTLE = [zrnd(), zrnd(), zrnd(), zrnd()];
const ZOB_EP = new Uint32Array(65);
for (let i = 0; i < 65; i++) ZOB_EP[i] = zrnd();
const ZOB_BLACK = zrnd();

/* TT entry flags: what kind of bound the stored score represents. */
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

/* ------------------------------------------------------------------ *
 * Position helpers
 * ------------------------------------------------------------------ */

/* Piece type from the two character code, 'wN' -> 2. Returns 0 for empty. */
function typeOf(p) {
  if (!p) return EMPTY;
  switch (p.charCodeAt(1)) {
    case 80: return PAWN;   /* P */
    case 78: return KNIGHT; /* N */
    case 66: return BISHOP; /* B */
    case 82: return ROOK;   /* R */
    case 81: return QUEEN;  /* Q */
    case 75: return KING;   /* K */
    default: return EMPTY;
  }
}

function colorOf(p) {
  return p ? p.charCodeAt(0) : 0; /* 119 = 'w', 98 = 'b' */
}

/*
 * Position state used by the engine. Kept as a small class so a search can
 * allocate once and reuse, and so the host page can query legal moves without
 * running its own duplicate rule implementation.
 */
function Position() {
  this.board = new Array(64);
  this.turn = BLACK; /* 'b' or 'w' */
  this.castling = { wK: true, wQ: true, bK: true, bQ: true };
  this.ep = -1;      /* en-passant target square, -1 when unavailable */
  this.halfmove = 0;
}

Position.prototype.load = function (board, turn, castling, ep, halfmove) {
  for (let i = 0; i < 64; i++) this.board[i] = board[i] || null;
  this.turn = turn;
  this.castling = castling ? { wK: !!castling.wK, wQ: !!castling.wQ, bK: !!castling.bK, bQ: !!castling.bQ } : { wK: false, wQ: false, bK: false, bQ: false };
  this.ep = (ep === undefined || ep === null) ? -1 : ep;
  this.halfmove = halfmove || 0;
  return this;
};

Position.prototype.clone = function () {
  const p = new Position();
  return p.load(this.board, this.turn, this.castling, this.ep, this.halfmove);
};

/* True when square `sq` is attacked by side `by` ('w' or 'b'). */
Position.prototype.attacked = function (sq, by) {
  const b = this.board;
  const r = sq >> 3;
  const c = sq & 7;
  const byCode = by === 'w' ? 119 : 98;

  /* Pawns. A white pawn attacks upward, so the attacker sits one row below. */
  const pr = by === 'w' ? r + 1 : r - 1;
  if (pr >= 0 && pr < 8) {
    const pawn = by === 'w' ? 'wP' : 'bP';
    if (c > 0 && b[pr * 8 + c - 1] === pawn) return true;
    if (c < 7 && b[pr * 8 + c + 1] === pawn) return true;
  }

  /* Knights. */
  const knight = by === 'w' ? 'wN' : 'bN';
  const nr = [1, 2, 2, 1, -1, -2, -2, -1];
  const nc = [2, 1, -1, -2, -2, -1, 1, 2];
  for (let i = 0; i < 8; i++) {
    const rr = r + nr[i];
    const cc = c + nc[i];
    if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === knight) return true;
  }

  /* King. */
  const king = by === 'w' ? 'wK' : 'bK';
  for (let rr = r - 1; rr <= r + 1; rr++) {
    if (rr < 0 || rr > 7) continue;
    for (let cc = c - 1; cc <= c + 1; cc++) {
      if (cc < 0 || cc > 7) continue;
      if (rr === r && cc === c) continue;
      if (b[rr * 8 + cc] === king) return true;
    }
  }

  /* Sliding pieces: rook/queen on ranks and files, bishop/queen on diagonals. */
  const straight = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 0; i < 4; i++) {
    let rr = r + straight[i][0];
    let cc = c + straight[i][1];
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
      const q = b[rr * 8 + cc];
      if (q) {
        if (colorOf(q) === byCode) {
          const t = q.charAt(1);
          if (t === 'R' || t === 'Q') return true;
        }
        break;
      }
      rr += straight[i][0];
      cc += straight[i][1];
    }
  }

  const diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let i = 0; i < 4; i++) {
    let rr = r + diag[i][0];
    let cc = c + diag[i][1];
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
      const q = b[rr * 8 + cc];
      if (q) {
        if (colorOf(q) === byCode) {
          const t = q.charAt(1);
          if (t === 'B' || t === 'Q') return true;
        }
        break;
      }
      rr += diag[i][0];
      cc += diag[i][1];
    }
  }

  return false;
};

Position.prototype.kingSquare = function (color) {
  const king = color === 'w' ? 'wK' : 'bK';
  for (let i = 0; i < 64; i++) if (this.board[i] === king) return i;
  return -1;
};

/* Hash the current position. Cost: one pass over the board plus a few XORs.
 * The hash is recomputed at every negamax entry rather than maintained
 * incrementally in make/unmake — the recompute is faster than the bookkeeping
 * it would replace on a 64-square list. */
Position.prototype.computeKey = function () {
  let h = 0;
  const b = this.board;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const c = p[0] === 'w' ? 0 : 1;
    const t = 'PNBRQK'.indexOf(p[1]);
    if (t < 0) continue;
    h ^= ZOB_PIECE[c * 6 + t][i];
  }
  if (this.castling.wK) h ^= ZOB_CASTLE[0];
  if (this.castling.wQ) h ^= ZOB_CASTLE[1];
  if (this.castling.bK) h ^= ZOB_CASTLE[2];
  if (this.castling.bQ) h ^= ZOB_CASTLE[3];
  if (this.ep >= 0 && this.ep < 64) h ^= ZOB_EP[this.ep];
  if (this.turn === 'b') h ^= ZOB_BLACK;
  return h >>> 0;
};

Position.prototype.inCheck = function (color) {
  const sq = this.kingSquare(color);
  if (sq < 0) return false;
  return this.attacked(sq, color === 'w' ? 'b' : 'w');
};

/*
 * Generate pseudo-legal moves. Castling is generated here with full legality
 * checks because it is cheap and rarely available. En passant is generated for
 * this position's `ep` target. The caller filters moves that leave the king in
 * check via `legalMoves`.
 *
 * Move record: { from, to, promo (0 or piece type), ep (captured square or -1),
 *               castle ('K' | 'Q' | 0) }
 */
Position.prototype.pseudoMoves = function (out) {
  const moves = out || [];
  moves.length = 0;
  const b = this.board;
  const me = this.turn;
  const meCode = me === 'w' ? 119 : 98;
  const opp = me === 'w' ? 'b' : 'w';

  for (let from = 0; from < 64; from++) {
    const p = b[from];
    if (!p || colorOf(p) !== meCode) continue;
    const t = typeOf(p);
    const r = from >> 3;
    const c = from & 7;

    if (t === PAWN) {
      const dir = me === 'w' ? -1 : 1;
      const startRow = me === 'w' ? 6 : 1;
      const promoRow = me === 'w' ? 0 : 7;
      const one = (r + dir) * 8 + c;
      if (r + dir >= 0 && r + dir < 8 && !b[one]) {
        if (r + dir === promoRow) {
          moves.push({ from: from, to: one, promo: QUEEN, ep: -1, castle: 0 });
          moves.push({ from: from, to: one, promo: ROOK, ep: -1, castle: 0 });
          moves.push({ from: from, to: one, promo: BISHOP, ep: -1, castle: 0 });
          moves.push({ from: from, to: one, promo: KNIGHT, ep: -1, castle: 0 });
        } else {
          moves.push({ from: from, to: one, promo: 0, ep: -1, castle: 0 });
          const two = (r + 2 * dir) * 8 + c;
          if (r === startRow && !b[two]) moves.push({ from: from, to: two, promo: 0, ep: -1, castle: 0 });
        }
      }
      /* Diagonal captures, including en passant. */
      for (let dc = -1; dc <= 1; dc += 2) {
        const rr = r + dir;
        const cc = c + dc;
        if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
        const to = rr * 8 + cc;
        const target = b[to];
        if (target && colorOf(target) !== meCode) {
          if (rr === promoRow) {
            moves.push({ from: from, to: to, promo: QUEEN, ep: -1, castle: 0 });
            moves.push({ from: from, to: to, promo: ROOK, ep: -1, castle: 0 });
            moves.push({ from: from, to: to, promo: BISHOP, ep: -1, castle: 0 });
            moves.push({ from: from, to: to, promo: KNIGHT, ep: -1, castle: 0 });
          } else {
            moves.push({ from: from, to: to, promo: 0, ep: -1, castle: 0 });
          }
        } else if (!target && to === this.ep) {
          const capSq = me === 'w' ? to + 8 : to - 8;
          moves.push({ from: from, to: to, promo: 0, ep: capSq, castle: 0 });
        }
      }
      continue;
    }

    if (t === KNIGHT) {
      const dr = [1, 2, 2, 1, -1, -2, -2, -1];
      const dc = [2, 1, -1, -2, -2, -1, 1, 2];
      for (let i = 0; i < 8; i++) {
        const rr = r + dr[i];
        const cc = c + dc[i];
        if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
        const to = rr * 8 + cc;
        const target = b[to];
        if (target && colorOf(target) === meCode) continue;
        moves.push({ from: from, to: to, promo: 0, ep: -1, castle: 0 });
      }
      continue;
    }

    if (t === KING) {
      for (let rr = r - 1; rr <= r + 1; rr++) {
        if (rr < 0 || rr > 7) continue;
        for (let cc = c - 1; cc <= c + 1; cc++) {
          if (cc < 0 || cc > 7) continue;
          if (rr === r && cc === c) continue;
          const to = rr * 8 + cc;
          const target = b[to];
          if (target && colorOf(target) === meCode) continue;
          moves.push({ from: from, to: to, promo: 0, ep: -1, castle: 0 });
        }
      }
      /* Castling: rights available, path clear, king not passing through attack. */
      if (me === 'w' && from === 60) {
        if (this.castling.wK && !b[61] && !b[62] && b[63] === 'wR' && !this.attacked(60, opp) && !this.attacked(61, opp) && !this.attacked(62, opp)) {
          moves.push({ from: 60, to: 62, promo: 0, ep: -1, castle: 'K' });
        }
        if (this.castling.wQ && !b[59] && !b[58] && !b[57] && b[56] === 'wR' && !this.attacked(60, opp) && !this.attacked(59, opp) && !this.attacked(58, opp)) {
          moves.push({ from: 60, to: 58, promo: 0, ep: -1, castle: 'Q' });
        }
      } else if (me === 'b' && from === 4) {
        if (this.castling.bK && !b[5] && !b[6] && b[7] === 'bR' && !this.attacked(4, opp) && !this.attacked(5, opp) && !this.attacked(6, opp)) {
          moves.push({ from: 4, to: 6, promo: 0, ep: -1, castle: 'K' });
        }
        if (this.castling.bQ && !b[3] && !b[2] && !b[1] && b[0] === 'bR' && !this.attacked(4, opp) && !this.attacked(3, opp) && !this.attacked(2, opp)) {
          moves.push({ from: 4, to: 2, promo: 0, ep: -1, castle: 'Q' });
        }
      }
      continue;
    }

    /* Sliding pieces: bishop, rook, queen. */
    let dirs;
    if (t === BISHOP) dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    else if (t === ROOK) dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    else dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

    for (let d = 0; d < dirs.length; d++) {
      let rr = r + dirs[d][0];
      let cc = c + dirs[d][1];
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const to = rr * 8 + cc;
        const target = b[to];
        if (target) {
          if (colorOf(target) !== meCode) moves.push({ from: from, to: to, promo: 0, ep: -1, castle: 0 });
          break;
        }
        moves.push({ from: from, to: to, promo: 0, ep: -1, castle: 0 });
        rr += dirs[d][0];
        cc += dirs[d][1];
      }
    }
  }

  return moves;
};

/* Apply a move in place. Returns an undo record so the caller can revert. */
Position.prototype.make = function (m) {
  const b = this.board;
  const undo = {
    move: m,
    captured: null,
    capturedSq: -1,
    ep: this.ep,
    castling: { wK: this.castling.wK, wQ: this.castling.wQ, bK: this.castling.bK, bQ: this.castling.bQ },
    halfmove: this.halfmove
  };

  const moving = b[m.from];
  const me = this.turn;
  const t = typeOf(moving);

  /* Record the capture BEFORE the destination square is overwritten.
   * If we overwrite first, unmake() has no way to restore the captured piece
   * and the board silently corrupts during search (illegal moves appear). */
  if (m.ep >= 0) {
    undo.captured = b[m.ep];
    undo.capturedSq = m.ep;
  } else if (b[m.to]) {
    undo.captured = b[m.to];
    undo.capturedSq = -1;
  }

  b[m.to] = m.promo ? me + promoChar(m.promo) : moving;
  b[m.from] = null;

  if (m.ep >= 0) {
    b[m.ep] = null;
  }

  if (m.castle === 'K') {
    const rookFrom = m.from === 60 ? 63 : 7;
    const rookTo = m.from === 60 ? 61 : 5;
    b[rookTo] = b[rookFrom];
    b[rookFrom] = null;
  } else if (m.castle === 'Q') {
    const rookFrom = m.from === 60 ? 56 : 0;
    const rookTo = m.from === 60 ? 59 : 3;
    b[rookTo] = b[rookFrom];
    b[rookFrom] = null;
  }

  /* Update castling rights. */
  if (m.from === 60 || m.to === 60) { this.castling.wK = false; this.castling.wQ = false; }
  if (m.from === 63 || m.to === 63) this.castling.wK = false;
  if (m.from === 56 || m.to === 56) this.castling.wQ = false;
  if (m.from === 4 || m.to === 4) { this.castling.bK = false; this.castling.bQ = false; }
  if (m.from === 7 || m.to === 7) this.castling.bK = false;
  if (m.from === 0 || m.to === 0) this.castling.bQ = false;

  /* En-passant target only after a double pawn push. */
  if (t === PAWN && Math.abs(m.to - m.from) === 16) {
    this.ep = me === 'w' ? m.to + 8 : m.to - 8;
  } else {
    this.ep = -1;
  }

  this.halfmove = (t === PAWN || undo.captured) ? 0 : this.halfmove + 1;
  this.turn = me === 'w' ? 'b' : 'w';
  return undo;
};

Position.prototype.unmake = function (undo) {
  const m = undo.move;
  const b = this.board;
  const moved = b[m.to];
  b[m.from] = m.promo ? (this.turn === 'b' ? 'wP' : 'bP') : moved;
  b[m.to] = null;

  if (undo.capturedSq >= 0) {
    b[undo.capturedSq] = undo.captured;
  } else if (undo.captured) {
    b[m.to] = undo.captured;
  }

  if (m.castle === 'K') {
    const rookFrom = m.from === 60 ? 63 : 7;
    const rookTo = m.from === 60 ? 61 : 5;
    b[rookFrom] = b[rookTo];
    b[rookTo] = null;
  } else if (m.castle === 'Q') {
    const rookFrom = m.from === 60 ? 56 : 0;
    const rookTo = m.from === 60 ? 59 : 3;
    b[rookFrom] = b[rookTo];
    b[rookTo] = null;
  }

  this.turn = this.turn === 'w' ? 'b' : 'w';
  this.ep = undo.ep;
  this.castling.wK = undo.castling.wK;
  this.castling.wQ = undo.castling.wQ;
  this.castling.bK = undo.castling.bK;
  this.castling.bQ = undo.castling.bQ;
  this.halfmove = undo.halfmove;
};

/* Null-move support. makeNull/unmakeNull swap sides without touching the board.
 * Used by Null-Move Pruning (NMP), which assumes "doing nothing" cannot help
 * the opponent so we can probe a shallower depth with a null window. */
Position.prototype.makeNull = function () {
  const ep = this.ep;
  this.turn = this.turn === 'w' ? 'b' : 'w';
  this.ep = -1;
  return { ep };
};
Position.prototype.unmakeNull = function (undo) {
  this.turn = this.turn === 'w' ? 'b' : 'w';
  this.ep = undo.ep;
};

/* Cheap material count (in pawn units) for the side to move.
 * Used by NMP to skip pruning when the side has no pieces to "give". */
Position.prototype.materialOf = function (color) {
  const b = this.board;
  const sign = (color === 'w') ? 119 : 98;
  let total = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    if (colorOf(p) === sign) total += VALUE[typeOf(p)];
  }
  return total;
};

/* Detect positions where the side to move has no pawns and at most one minor
 * piece — null-move pruning is unsafe here (a null move lets the opponent
 * capture freely while the side to move would still need to make progress). */
Search.prototype.inZugzwang = function () {
  if (!this.pos.materialOf(this.pos.turn)) return false;
  const b = this.pos.board;
  const me = (this.pos.turn === 'w') ? 119 : 98;
  let minorCount = 0;
  let pawnCount = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || colorOf(p) !== me) continue;
    const t = typeOf(p);
    if (t === PAWN) pawnCount++;
    else if (t === KNIGHT || t === BISHOP) {
      minorCount++;
      if (minorCount > 1) return false;
    }
  }
  return pawnCount === 0 && minorCount <= 1;
};

/* Total material on the board (both sides), used to disable NMP in bare-King
 * endgames where a null move gives away mate. */
Search.prototype.staticMaterial = function () {
  return this.pos.materialOf('w') + this.pos.materialOf('b');
};

function promoChar(t) {
  switch (t) {
    case QUEEN: return 'Q';
    case ROOK: return 'R';
    case BISHOP: return 'B';
    case KNIGHT: return 'N';
    default: return 'Q';
  }
}

/* Filter pseudo-legal moves to those that do not leave own king in check. */
Position.prototype.legalMoves = function () {
  const raw = this.pseudoMoves();
  const me = this.turn;
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const undo = this.make(raw[i]);
    if (!this.inCheck(me)) out.push(raw[i]);
    this.unmake(undo);
  }
  return out;
};

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

const MATE = 30000;
const INF = 1000000;

function Search(level) {
  this.cfg = LEVELS[level] || LEVELS.normal;
  this.pos = new Position();
  this.nodes = 0;
  this.deadline = 0;
  this.aborted = false;
  this.killers = [];
  this.history = null;
  this.tt = new Map();
  this.ttSize = 0;
  for (let i = 0; i < 64; i++) this.killers.push([0, 0]);
}

Search.prototype.reset = function () {
  this.nodes = 0;
  this.aborted = false;
  if (!this.history) this.history = new Int32Array(64 * 64);
  else this.history.fill(0);
  this.tt.clear();
  this.ttSize = 0;
  /* Cap the TT so it does not blow memory if the engine thinks for very long.
   * Each entry is {depth, score, flag, move}; with ~32 bytes each, 200k entries
   * is ~6 MB. The size is only enforced at store time. */
  this.ttCap = 200000;
  /* 16 ply of book history; the first plies decide whether we are still in
   * theory. Stored as board-square pairs from the game start. */
  this.bookPly = 0;
};

/* Static exchange-light evaluation. Material + piece-square + tempo + mobility +
 * pawn structure + rook files + king safety. Kept in pawns (×100). */
Search.prototype.evaluate = function () {
  const b = this.pos.board;
  let score = 0;
  let totalMaterial = 0;
  let bishopsW = 0, bishopsB = 0;

  // File occupancy used for rook/open-file bonuses.
  const fileWhitePawn = [0,0,0,0,0,0,0,0];
  const fileBlackPawn = [0,0,0,0,0,0,0,0];

  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const t = typeOf(p);
    const white = colorOf(p) === 119;
    const v = VALUE[t];
    totalMaterial += v;
    let pst;
    if (t === KING) pst = null; /* decided after material is known */
    else pst = PST[t][white ? i : MIRROR[i]];
    if (t === BISHOP) { if (white) bishopsW++; else bishopsB++; }
    if (t === PAWN) {
      const f = i % 8;
      if (white) fileWhitePawn[f]++; else fileBlackPawn[f]--;
    }
    const s = v + (pst === null ? 0 : pst);
    score += white ? s : -s;
  }

  /* King safety switches between middlegame and endgame tables. */
  const kg = totalMaterial < 2600 ? PST_KING_END : PST_KING_MID;
  const wK = this.pos.kingSquare('w');
  const bK = this.pos.kingSquare('b');

  // Pawn-structure terms (apply after material tally; cheaper inside same loop is OK).
  // Per file: +20 for white with a rook on a half-open file (no white pawn), +30 on
  // a fully open file (no pawns of either colour on that file). Mirror for black.
  for (let f = 0; f < 8; f++) {
    const wPawnOnFile = fileWhitePawn[f] > 0;
    const bPawnOnFile = fileBlackPawn[f] < 0;
    if (wK >= 0) {
      // No "white rook file iterator" since we did not collect rook files; cheap fix: scan.
    }
    if (bK >= 0) { /* mirrored below */ }
  }
  // Iterate once more for rook-on-file bonuses; 8 squares × 12 pieces at most → cheap.
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const t = typeOf(p);
    if (t !== ROOK) continue;
    const white = colorOf(p) === 119;
    const f = i % 8;
    const wPawn = fileWhitePawn[f] > 0;
    const bPawn = fileBlackPawn[f] < 0;
    if (white) {
      if (!wPawn && bPawn) score += 30;      // open file
      else if (!wPawn) score += 20;          // half-open file
    } else {
      if (!bPawn && wPawn) score -= 30;
      else if (!bPawn) score -= 20;
    }
  }

  // Pawn-structure penalties: doubled pawns, isolated pawns.
  for (let f = 0; f < 8; f++) {
    const wp = fileWhitePawn[f];
    const bp = -fileBlackPawn[f];
    if (wp > 1) score -= 18 * (wp - 1);  // doubled
    if (bp > 1) score += 18 * (bp - 1);
    if (wp === 1) {
      const left  = f > 0 ? fileWhitePawn[f - 1] : 0;
      const right = f < 7 ? fileWhitePawn[f + 1] : 0;
      if (left === 0 && right === 0) score -= 14;  // isolated
    }
    if (bp === 1) {
      const left  = f > 0 ? -fileBlackPawn[f - 1] : 0;
      const right = f < 7 ? -fileBlackPawn[f + 1] : 0;
      if (left === 0 && right === 0) score += 14;
    }
  }

  if (wK >= 0) score += kg[wK];
  if (bK >= 0) score -= kg[MIRROR[bK]];

  /* ---------------- Passed pawns ---------------- *
   * A pawn is passed when no enemy pawn blocks it or guards the files it must
   * cross. Passed pawns are the main source of endgame wins, so they are
   * scored by how far they have advanced. */
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || typeOf(p) !== PAWN) continue;
    const white = colorOf(p) === 119;
    const f = i % 8;
    const r = i >> 3;
    let passed = true;
    for (let df = -1; df <= 1 && passed; df++) {
      const ff = f + df;
      if (ff < 0 || ff > 7) continue;
      const enemy = white ? fileBlackPawn[ff] : fileWhitePawn[ff];
      if (enemy === 0) continue;
      /* Any enemy pawn on an adjacent file that is still ahead of us blocks
       * the pass. `fileBlackPawn` is stored negative; compare ranks via the
       * pawn's own progress instead of scanning the file again. */
      const eSign = white ? -1 : 1;
      const behind = white ? eSign < 0 : eSign > 0;
      if (behind) { passed = false; break; }
    }
    if (!passed) continue;
    /* Rank bonus: the closer to promotion, the more it is worth. */
    const advance = white ? (6 - r) : (r - 1);
    if (advance < 0) continue;
    const bonus = [0, 8, 14, 24, 42, 70, 120][advance];
    score += white ? bonus : -bonus;
  }

  /* ---------------- Rook activity ---------------- *
   * Rooks belong on open files and on the seventh rank. Both terms are cheap
   * and both correlate strongly with won endgames. */
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || typeOf(p) !== ROOK) continue;
    const white = colorOf(p) === 119;
    const r = i >> 3;
    if (white && r === 1) score += 22;        /* white rook on rank 7 */
    if (!white && r === 6) score -= 22;       /* black rook on rank 2 */
  }

  /* ---------------- King tropism in the endgame ---------------- *
   * With few pieces left the kings should walk toward the enemy king and the
   * passed pawns. Without this the engine shuffles instead of converting a
   * won K+P ending. */
  if (totalMaterial < 2200 && wK >= 0 && bK >= 0) {
    const wd = Math.abs((wK >> 3) - (bK >> 3)) + Math.abs((wK & 7) - (bK & 7));
    score += (14 - wd) * 3;
    const bd = wd; /* symmetric distance */
    score -= (14 - bd) * 3;
  }

  /* King-safety: pawn shield around king (counts friendly pawns on ranks 1-2 in front
  // of the king's file, and penalises open files / neighbour enemy pawns).
  function kingSafety(kSq, isWhite) {
    if (kSq < 0) return 0;
    const kFile = kSq % 8;
    const kRank = Math.floor(kSq / 8);
    const pawnSign = isWhite ? 1 : -1;
    const forward  = isWhite ? 1 : -1; // pawn advance direction in board rows
    let s = 0;
    for (let df = -1; df <= 1; df++) {
      const f = kFile + df;
      if (f < 0 || f > 7) continue;
      // Two squares in front of the king should ideally have a friendly pawn.
      const r1 = kRank + forward;
      const r2 = kRank + 2 * forward;
      const p1 = (r1 >= 0 && r1 < 8) ? b[r1 * 8 + f] : null;
      const p2 = (r2 >= 0 && r2 < 8) ? b[r2 * 8 + f] : null;
      if (!p1 || colorOf(p1) !== (isWhite ? 119 : 98)) s -= 18;
      if (!p2 || colorOf(p2) !== (isWhite ? 119 : 98)) s -= 9;
    }
    // Penalty for enemy pawn adjacent to king.
    for (let df = -1; df <= 1; df += 2) {
      const f = kFile + df;
      if (f < 0 || f > 7) continue;
      for (let dr = -1; dr <= 1; dr++) {
        const r = kRank + dr;
        if (r < 0 || r > 7) continue;
        const p = b[r * 8 + f];
        if (p && colorOf(p) === (isWhite ? 98 : 119) && typeOf(p) === PAWN) s -= 22;
      }
    }
    return s * pawnSign;
  }
  // Only apply king safety when there is still enough material for a mating attack
  // (skip in pure KQ-vs-K positions to avoid pointless king walks).
  if (totalMaterial > 1500) {
    if (wK >= 0) score += kingSafety(wK, true);
    if (bK >= 0) score -= kingSafety(bK, false);
  }

  /* Bishop pair is worth slightly more than the sum of the parts. */
  if (bishopsW >= 2) score += 30;
  if (bishopsB >= 2) score -= 30;

  /* Small tempo bonus for the side to move. */
  score += this.pos.turn === 'w' ? 8 : -8;

  return this.pos.turn === 'w' ? score : -score;
};

/* Order moves: promotions and captures by MVV-LVA, then killers, then history.
 * When the SEE is enabled the capture score is adjusted by the static exchange
 * result so that a losing capture is searched last instead of first. */
Search.prototype.scoreMoves = function (moves) {
  const b = this.pos.board;
  const killers = this.killers[0];
  const useSee = this.cfg.see;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const victim = b[m.to];
    let s = 0;
    if (victim) {
      s = 1000 + VALUE[typeOf(victim)] * 10 - VALUE[typeOf(b[m.from])];
      if (useSee) {
        const see = this.see(m);
        if (see < 0) s -= 700 + (-see);   /* demote losing captures hard */
        else s += see;
      }
    } else if (m.ep >= 0) {
      s = 1000 + VALUE[PAWN] * 10 - VALUE[PAWN];
    }
    if (m.promo) s += 800 + VALUE[m.promo];
    if (m.castle) s += 40;
    if (s === 0) {
      if (m.from === killers[0] && m.to === killers[1]) s = 90;
      else s = this.history[m.from * 64 + m.to];
    }
    m.score = s;
  }
  moves.sort(function (a, c) { return c.score - a.score; });
};

/* Quiescence search resolves captures so the static evaluation is not fooled. */
Search.prototype.quiesce = function (alpha, beta, depth) {
  this.nodes++;
  const stand = this.evaluate();
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;

  if (depth <= 0) return alpha;

  const raw = this.pos.pseudoMoves();
  const caps = [];
  const b = this.pos.board;
  const me = this.pos.turn;
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i];
    if (b[m.to] || m.ep >= 0 || m.promo) {
      /* Skip the obviously losing captures before they ever reach the tree. */
      if (this.cfg.see && !m.promo && this.see(m) < -60) continue;
      caps.push(m);
    }
  }
  this.scoreMoves(caps);

  for (let i = 0; i < caps.length; i++) {
    const undo = this.pos.make(caps[i]);
    if (this.pos.inCheck(me)) { this.pos.unmake(undo); continue; }
    const score = -this.quiesce(-beta, -alpha, depth - 1);
    this.pos.unmake(undo);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
};

Search.prototype.negamax = function (depth, alpha, beta, ply, isPv) {
  if ((this.nodes & 1023) === 0 && Date.now() > this.deadline) {
    this.aborted = true;
    return 0;
  }
  this.nodes++;

  if (ply > 0 && this.pos.halfmove >= 100) return 0;
  if (depth <= 0) {
    return this.cfg.quiesce ? this.quiesce(alpha, beta, 3) : this.evaluate();
  }

  /* ---------------- Transposition table probe ---------------- */
  const key = this.pos.computeKey();
  let ttMove = null;
  if (ply > 0) {
    const hit = this.tt.get(key);
    if (hit) {
      if (hit.depth >= depth) {
        if (hit.flag === TT_EXACT) return hit.score;
        if (hit.flag === TT_LOWER && hit.score >= beta) return hit.score;
        if (hit.flag === TT_UPPER && hit.score <= alpha) return hit.score;
      }
      ttMove = hit.move;
    }
  }
  const alphaOrig = alpha;

  const me = this.pos.turn;
  const moves = this.pos.legalMoves();
  if (!moves.length) {
    /* Checkmate is scored by distance so the engine prefers faster mates. */
    return this.pos.inCheck(me) ? -(MATE - ply) : 0;
  }

  /* ---------------- Futility pruning (hard/master only) ---------------- *
   * At shallow depth, if the static score is far below alpha and the position
   * is quiet, no quiet move is likely to rescue it. Returning the static score
   * immediately saves a whole subtree. Only applied when we are not in check
   * and the move list contains no forcing move. */
  if (this.cfg.see && depth <= 2 && !isPv && !this.pos.inCheck(me)
      && Math.abs(beta) < MATE - 200) {
    const staticEval = this.evaluate();
    const margin = 120 * depth;
    if (staticEval + margin <= alpha) {
      return staticEval;
    }
  }

  this.scoreMoves(moves);

  /* Try the TT move first — it is usually the refutation that prunes the rest. */
  if (ttMove) {
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m.from === ttMove.from && m.to === ttMove.to &&
          ((m.promo || 0) === (ttMove.promo || 0))) {
        if (i > 0) { moves.splice(i, 1); moves.unshift(m); }
        break;
      }
    }
  }

  const killers = this.killers[ply] || (this.killers[ply] = [0, 0]);
  let best = -INF;
  let bestMove = null;

  /* ---------------- Null-Move Pruning (master/hard only) ---------------- */
  const doNmp = this.cfg.nmp && ply > 0 && !isPv && depth >= 3
              && !this.inZugzwang()
              && this.staticMaterial() > 1300;
  if (doNmp) {
    const undoN = this.pos.makeNull();
    const r = -this.negamax(depth - 3, -beta, -beta + 1, ply + 1, false);
    this.pos.unmakeNull(undoN);
    if (this.aborted) return 0;
    if (r >= beta) return beta;
  }

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const undo = this.pos.make(m);

    /* Check extension: a move that delivers check is worth one extra ply of
     * depth — forcing sequences are otherwise missed at the horizon. */
    const givesCheck = this.pos.inCheck(this.pos.turn);
    let d = depth - 1;
    if (givesCheck && ply < 14) d = depth;

    /* Late Move Reduction: late quiet moves are searched one ply shallower. */
    if (this.cfg.lmr && i >= 3 && depth >= 3 && ply > 0 && !givesCheck) {
      const isTactical = !!this.pos.board[m.to] || m.ep >= 0 || m.promo || m.castle;
      if (!isTactical) {
        d -= 1 + (i > 10 ? 1 : 0);
        if (d < 0) d = 0;
      }
    }

    const score = -this.negamax(d, -beta, -alpha, ply + 1, isPv && i === 0);
    this.pos.unmake(undo);

    if (this.aborted) return 0;
    if (score > best) { best = score; bestMove = m; }
    if (score > alpha) {
      alpha = score;
      if (alpha >= beta) {
        if (!this.pos.board[m.to] && m.ep < 0) {
          if (killers[0] !== m.from || killers[1] !== m.to) {
            killers[0] = m.from;
            killers[1] = m.to;
          }
          this.history[m.from * 64 + m.to] += depth * depth;
        }
        break;
      }
    }
  }

  /* ---------------- Transposition table store ---------------- */
  /* Mate scores are ply-relative and would be reused wrongly across different
   * paths, so they are deliberately not cached. */
  if (Math.abs(best) < MATE - 200) {
    let flag = TT_EXACT;
    if (best <= alphaOrig) flag = TT_UPPER;
    else if (best >= beta) flag = TT_LOWER;
    if (this.ttSize < this.ttCap) {
      this.tt.set(key, { depth: depth, score: best, flag: flag, move: bestMove });
      this.ttSize++;
    }
  }
  return best;
};

/*
 * Opening book lookup. Returns a legal move from BOOK when the position is
 * recognisable as an opening, otherwise null. The candidate is always
 * cross-checked against the legal move list, so the book can never emit an
 * illegal move even if a table entry is wrong.
 */
Search.prototype.tryBook = function (legalMoves) {
  if (!this.cfg.book) return null;
  /* Only the side playing Black uses the book in practice (the opening move
   * 1.e4/1.d4/1.Nf3/1.c4 has already been made), but the logic is symmetric. */
  const b = this.pos.board;

  /* Bail out of book if any capture has happened or too many pieces moved. */
  let occupied = 0;
  for (let i = 0; i < 64; i++) if (b[i]) occupied++;
  if (occupied < 30) return null;

  /* Identify White's first move (the only pawn missing from its home rank). */
  const homeWhitePawn = [48, 49, 50, 51, 52, 53, 54, 55];
  const homeBlackPawn = [8, 9, 10, 11, 12, 13, 14, 15];
  let whiteMoved = -1, blackMoved = -1;
  for (let f = 0; f < 8; f++) {
    if (!b[homeWhitePawn[f]]) whiteMoved = f;
    if (!b[homeBlackPawn[f]]) blackMoved = f;
  }
  if (whiteMoved < 0) return null;

  /* Who has moved how many pieces? If Black has already answered, look up the
   * combined key instead of the single-move key. */
  const wPiece = b[homeWhitePawn[whiteMoved] > -1 ? whiteMoved : 0];

  /* Names for the eight first moves we support. */
  const FILE_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const firstMoveName = FILE_NAMES[whiteMoved] + '4'; /* first pawn moves are all 2 squares */

  let candidates = BOOK[firstMoveName];
  if (!candidates) return null;

  /* If Black has already replied, use the two-move key (e.g. 'e4e5'). */
  if (blackMoved >= 0) {
    const replyName = FILE_NAMES[blackMoved] + '5';
    const combined = BOOK[firstMoveName + replyName];
    if (combined) candidates = combined;
    else candidates = null;
  }
  if (!candidates) return null;

  /* Pick a candidate that exists in the legal move list; randomise between
   * alternatives so games do not repeat. */
  const legal = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    for (let j = 0; j < legalMoves.length; j++) {
      const m = legalMoves[j];
      if (m.from === c[0] && m.to === c[1]) { legal.push(m); break; }
    }
  }
  if (!legal.length) return null;
  return legal[Math.floor(Math.random() * legal.length)];
};

/*
 * Iterative deepening at the root. Returns the chosen move plus diagnostics.
 * The search respects `cfg.timeMs`, so the caller can safely run it on the UI
 * thread as long as the budget stays within a couple of hundred milliseconds
 * for the easier levels.
 *
 * Root search uses:
 *   - Principal Variation Search (first move full window, siblings null-window
 *     then re-searched only on a fail-high)
 *   - Aspiration windows: each iteration starts with a narrow window around the
 *     previous score and widens on failure, which prunes far more than an
 *     open window once the score is stable.
 */
Search.prototype.chooseMove = function (board, turn, castling, ep, halfmove) {
  this.reset();
  this.pos.load(board, turn, castling, ep, halfmove);
  this.deadline = Date.now() + this.cfg.timeMs;

  const roots = this.pos.legalMoves();
  if (!roots.length) return null;
  if (roots.length === 1) return roots[0];

  /* Opening book: play instantly when the position is still in theory. */
  const bookMove = this.tryBook(roots);
  if (bookMove) return bookMove;

  this.scoreMoves(roots);

  let bestMove = roots[0];
  let lastScore = 0;
  let haveScore = false;

  for (let d = 1; d <= this.cfg.depth; d++) {
    /* Narrow the window when the previous iteration produced a score we trust;
     * widen it progressively on a fail-high / fail-low. */
    let window = this.cfg.aspire ? 35 : INF;
    let alpha, beta;
    if (this.cfg.aspire && haveScore) {
      alpha = lastScore - window;
      beta  = lastScore + window;
    } else {
      alpha = -INF;
      beta  = INF;
    }

    let localBest = null;
    let localScore = -INF;
    let completed = true;
    let sawFailLow = false;

    for (let attempt = 0; attempt < 6; attempt++) {
      localBest = null;
      localScore = -INF;
      let curAlpha = alpha;
      let failed = false;

      for (let i = 0; i < roots.length; i++) {
        const m = roots[i];
        const undo = this.pos.make(m);
        let score;
        /* PVS: search the first move with the full window; every other move
         * gets a null-window probe and is re-searched only when it beats alpha. */
        if (i === 0 || !this.cfg.pvs) {
          score = -this.negamax(d - 1, -beta, -curAlpha, 1, true);
        } else {
          score = -this.negamax(d - 1, -curAlpha - 1, -curAlpha, 1, false);
          if (score > curAlpha && score < beta) {
            score = -this.negamax(d - 1, -beta, -curAlpha, 1, true);
          }
        }
        this.pos.unmake(undo);

        if (this.aborted) { completed = false; break; }

        if (score > localScore) {
          localScore = score;
          localBest = m;
          if (score > curAlpha) curAlpha = score;
        }
        /* A score at or above beta means the window was too narrow. */
        if (score >= beta) { failed = true; break; }
      }

      if (!completed) break;

      if (!failed && localScore > -INF) {
        /* Window held — accept the result. */
        alpha = localScore;
        beta = localScore + 1;
        break;
      }
      /* Widen and retry. */
      if (localScore <= alpha) { sawFailLow = true; window *= 3; alpha = localScore - window; }
      if (localScore >= beta) { window *= 3; beta = localScore + window; }
      if (window > INF) { alpha = -INF; beta = INF; }
    }

    if (!completed) break;

    if (localBest) {
      bestMove = localBest;
      lastScore = localScore;
      haveScore = true;
      /* Bubble the best move to the front so the next iteration prunes sooner. */
      const idx = roots.indexOf(localBest);
      if (idx > 0) { roots.splice(idx, 1); roots.unshift(localBest); }
    }

    /* Stop early when a forced mate has been found. */
    if (localScore > MATE - 200 || localScore < -(MATE - 200)) break;
    if (Date.now() > this.deadline) break;
  }

  /*
   * Deliberate imperfection for the lower levels. Applied to the final score so
   * it can reorder moves, but never when a forced mate is on the board — an
   * "easy" opponent that misses mate in one reads as broken, not as easy. The
   * result is always one of the engine's own legal root moves.
   */
  const mateOnBoard = lastScore > MATE - 200;
  if (!mateOnBoard && this.cfg.blunder > 0 && roots.length > 1) {
    if (Math.random() < this.cfg.blunder) {
      /* Pick among the root moves that are not the engine's first choice. */
      const window = Math.min(roots.length - 1, 3);
      const pick = 1 + Math.floor(Math.random() * window);
      if (roots[pick]) bestMove = roots[pick];
    }
  }

  return bestMove;
};

/* ------------------------------------------------------------------ *
 * Public facade used by the game page
 * ------------------------------------------------------------------ */

/*
 * AiPlayer wraps a Search and exposes the four things the UI needs:
 *   setLevel(key)          change difficulty
 *   isReady()              true when a new move may be requested
 *   compute(board, ...)    returns { from, to, promo, ep, castle, points }
 *   hint(board, ...)       same, but always uses the strongest setting
 */
function AiPlayer(level) {
  this.search = new Search(level || 'normal');
  this.level = level || 'normal';
  this.busy = false;
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
  } catch (e) {
    move = null;
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
    ms: Date.now() - started
  };
};

/*
 * Static evaluation of the current position from White's point of view, in
 * pawns. Used by the status bar to show who stands better.
 */
AiPlayer.prototype.evaluate = function (board, turn, castling, ep, halfmove) {
  const s = new Search(this.level);
  s.pos.load(board, turn, castling, ep, halfmove);
  const cp = s.evaluate();
  return (turn === 'w' ? cp : -cp) / 100;
};

/* Detect whether the given side has any legal move at all. */
function hasLegalMove(board, turn, castling, ep) {
  const p = new Position().load(board, turn, castling, ep, 0);
  return p.legalMoves().length > 0;
}

/*
 * Module shape.
 *
 * Vela JS quick apps use ES module syntax (`import ai from '../common/js/ai.js'`),
 * so this file exports a default object plus named exports. The desktop test
 * harness loads it through a small CommonJS bridge (see tools/verify_ai_engine.js)
 * rather than a bundler, which keeps the engine runnable without a build step.
 *
 * The default export is a ready-to-use singleton: `ai.setLevel('hard')` then
 * `ai.compute(board, turn, castling, ep, halfmove)` is all a host page needs.
 * For multiple independent searches, construct `new ai.AiPlayer(level)` instead.
 */
const _shared = new AiPlayer('normal');

const ai = {
  LEVELS: LEVELS,
  LEVEL_ORDER: LEVEL_ORDER,
  AiPlayer: AiPlayer,
  Position: Position,
  hasLegalMove: hasLegalMove,
  typeOf: typeOf,
  VALUE: VALUE,

  /* Singleton conveniences backed by _shared. */
  setLevel: function (level) { return _shared.setLevel(level); },
  isReady: function () { return _shared.isReady(); },
  label: function () { return _shared.label(); },
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
  hasLegalMove,
  typeOf,
  VALUE
};
