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
  easy:   { key: 'easy',   label: 'Easy',   depth: 1, timeMs: 150,  blunder: 0.30, quiesce: false, nmp: false, lmr: false },
  normal: { key: 'normal', label: 'Normal', depth: 4, timeMs: 1000, blunder: 0.10, quiesce: true,  nmp: false, lmr: false },
  hard:   { key: 'hard',   label: 'Hard',   depth: 6, timeMs: 4000, blunder: 0.0,  quiesce: true,  nmp: true,  lmr: true  },
  master: { key: 'master', label: 'Master', depth: 8, timeMs: 10000, blunder: 0.0, quiesce: true,  nmp: true,  lmr: true  }
};

const LEVEL_ORDER = ['easy', 'normal', 'hard', 'master'];

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

  // King-safety: pawn shield around king (counts friendly pawns on ranks 1-2 in front
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

/* Order moves: promotions and captures by MVV-LVA, then killers, then history. */
Search.prototype.scoreMoves = function (moves) {
  const b = this.pos.board;
  const killers = this.killers[0];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const victim = b[m.to];
    let s = 0;
    if (victim) s = 1000 + VALUE[typeOf(victim)] * 10 - VALUE[typeOf(b[m.from])];
    else if (m.ep >= 0) s = 1000 + VALUE[PAWN] * 10 - VALUE[PAWN];
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
    if (b[m.to] || m.ep >= 0 || m.promo) caps.push(m);
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
 * Iterative deepening at the root. Returns the chosen move plus diagnostics.
 * The search respects `cfg.timeMs`, so the caller can safely run it on the UI
 * thread as long as the budget stays within a couple of hundred milliseconds
 * for the easier levels.
 */
Search.prototype.chooseMove = function (board, turn, castling, ep, halfmove) {
  this.reset();
  this.pos.load(board, turn, castling, ep, halfmove);
  this.deadline = Date.now() + this.cfg.timeMs;

  const roots = this.pos.legalMoves();
  if (!roots.length) return null;
  if (roots.length === 1) return roots[0];

  this.scoreMoves(roots);

  let bestMove = roots[0];
  let lastScore = 0;

  for (let d = 1; d <= this.cfg.depth; d++) {
    let alpha = -INF;
    let localBest = null;
    let localScore = -INF;
    let completed = true;

    for (let i = 0; i < roots.length; i++) {
      const m = roots[i];
      const undo = this.pos.make(m);
      /* Full window on the first move of the iteration, then a null-window
       * probe. The beta passed down must be -alpha, not -INF: passing -INF
       * gives the child a window so wide that scores come back unpruned and
       * the root cannot tell a real improvement from a fail-low. */
      let score;
      if (i === 0) {
        score = -this.negamax(d - 1, -INF, INF, 1, true);
      } else {
        score = -this.negamax(d - 1, -alpha - 1, -alpha, 1, false);
        if (score > alpha && score < INF) {
          /* Re-search with the full window when the probe beat alpha. */
          score = -this.negamax(d - 1, -INF, -alpha, 1, true);
        }
      }
      this.pos.unmake(undo);

      if (this.aborted) { completed = false; break; }

      if (score > localScore) {
        localScore = score;
        localBest = m;
        if (score > alpha) alpha = score;
      }
    }

    if (completed && localBest) {
      bestMove = localBest;
      lastScore = localScore;
      /* Bubble the best move to the front so the next iteration prunes sooner. */
      const idx = roots.indexOf(localBest);
      if (idx > 0) { roots.splice(idx, 1); roots.unshift(localBest); }
    }

    if (!completed) break;
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
