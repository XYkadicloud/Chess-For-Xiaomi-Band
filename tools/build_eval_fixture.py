#!/usr/bin/env python3
"""build_eval_fixture.py — build a balanced FEN sample for eval-quality checks.

The first fixture was built by walking every 2nd ply of a few games, which made
every single position white-to-move.  A sample that only ever sees one side to
move cannot detect a sign error, cannot detect a term that only matters for the
defender, and inflates/deflates the bias depending on who happened to be better
in those games.

This plays varied openings with Stockfish on both sides (node limited, so the
games actually leave the book and contain real mistakes), then samples every
position with the side to move preserved.  Both colours appear, the opening /
middlegame / endgame phases all appear, and lopsided positions are capped so a
handful of forced mates do not dominate the mean absolute error.

Usage:
  python tools/build_eval_fixture.py --sf <path> --out tools/_fixtures/eval_sample.fen
"""

import argparse
import os
import random
import sys

import chess
import chess.engine

OPENINGS = [
    [],                                                     # start position
    ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"],
    ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4"],
    ["e2e4", "e7e6", "d2d4", "d7d5"],
    ["e2e4", "c7c6", "d2d4", "d7d5"],
    ["d2d4", "d7d5", "c2c4", "e7e6"],
    ["d2d4", "g8f6", "c2c4", "g7g6"],
    ["d2d4", "d7d5", "c2c4", "c7c6"],
    ["g1f3", "g8f6", "c2c4", "e7e6"],
    ["g1f3", "d7d5", "d2d4", "g8f6"],
    ["c2c4", "e7e5", "b1c3", "g8f6"],
    ["e2e4", "e7e5", "f1c4", "g8f6"],
    ["e2e4", "d7d5", "e4d5", "d8d5"],
    ["d2d4", "f7f5", "g2g3", "g8f6"],
    ["e2e4", "g8f6", "e4e5", "f6d5"],
    ["d2d4", "d7d5", "b1c3", "g8f6"],
    ["e2e4", "e7e5", "g1f3", "g8f6"],
    ["d2d4", "e7e6", "c2c4", "f7f5"],
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sf", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--games", type=int, default=18)
    ap.add_argument("--nodes", type=int, default=8000)
    ap.add_argument("--max-plies", type=int, default=90)
    ap.add_argument("--every", type=int, default=2)
    ap.add_argument("--cap", type=int, default=1500,
                    help="drop positions whose |eval| exceeds this (forced wins)")
    ap.add_argument("--seed", type=int, default=20261005)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    engine = chess.engine.SimpleEngine.popen_uci(args.sf)
    limit = chess.engine.Limit(nodes=args.nodes)

    positions = []
    try:
        for g in range(args.games):
            opening = OPENINGS[g % len(OPENINGS)]
            board = chess.Board()
            ok = True
            for uci in opening:
                mv = chess.Move.from_uci(uci)
                if mv not in board.legal_moves:
                    ok = False
                    break
                board.push(mv)
            if not ok:
                continue

            # A little per-game randomness so 18 games are not 18 copies.
            if opening:
                for _ in range(rng.randint(0, 2)):
                    legal = list(board.legal_moves)
                    if not legal:
                        break
                    board.push(rng.choice(legal))

            for ply in range(args.max_plies):
                if board.is_game_over(claim_draw=False):
                    break
                info = engine.analyse(board, limit)
                score = info["score"].pov(chess.WHITE)
                cp = score.score()
                if cp is None:                       # mate
                    cp = 10000 if (score.mate() or 0) > 0 else -10000
                if abs(cp) <= args.cap and ply % args.every == 0:
                    positions.append(board.fen())
                legal = list(board.legal_moves)
                if not legal:
                    break
                res = engine.play(board, limit)
                board.push(res.move)

            if (g + 1) % 6 == 0:
                print("  played %d/%d games, %d positions"
                      % (g + 1, args.games, len(positions)), file=sys.stderr)
    finally:
        engine.quit()

    # Deduplicate while keeping order, then report the phase/colour mix.
    seen = set()
    uniq = []
    for f in positions:
        key = f.split(" ")[0]
        if key in seen:
            continue
        seen.add(key)
        uniq.append(f)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(uniq) + "\n")

    w = sum(1 for f in uniq if f.split(" ")[1] == "w")
    print("wrote %d positions to %s   (white to move %d, black to move %d)"
          % (len(uniq), args.out, w, len(uniq) - w))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
