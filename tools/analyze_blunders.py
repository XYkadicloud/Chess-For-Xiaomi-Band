#!/usr/bin/env python
"""
analyze_blunders.py — find out HOW an engine loses, not just that it loses.

Takes a PGN produced by tools/elo_match.py --pgn, re-evaluates every position with
full-strength Stockfish, and reports the centipawn cost of each of OUR moves.

The score alone ("we score 0.31") tells you nothing actionable. "We drop a pawn on
move 13 in 4 out of 8 games, always by pushing a wing pawn while the queen is on the
loose" tells you exactly what to fix.

Usage:
    python tools/analyze_blunders.py --pgn games.pgn --sf <stockfish> \
        [--depth 12] [--top 12] [--threshold 100]
"""

import argparse
import collections

import chess
import chess.engine
import chess.pgn

MATE_CP = 10000


def score_cp(engine, board, depth):
    """Score in centipawns from the side-to-move's point of view."""
    info = engine.analyse(board, chess.engine.Limit(depth=depth))
    score = info["score"].pov(board.turn)
    if score.is_mate():
        m = score.mate()
        return MATE_CP - abs(m) * 10 if m > 0 else -(MATE_CP - abs(m) * 10)
    return score.score()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pgn", required=True)
    ap.add_argument("--sf", required=True)
    ap.add_argument("--depth", type=int, default=12)
    ap.add_argument("--top", type=int, default=12)
    ap.add_argument("--threshold", type=int, default=80,
                    help="only report moves losing at least this many centipawns")
    args = ap.parse_args()

    sf = chess.engine.SimpleEngine.popen_uci(args.sf)
    sf.configure({"Threads": 1, "Hash": 64})

    blunders = []
    per_game = []
    try:
        with open(args.pgn) as fh:
            while True:
                game = chess.pgn.read_game(fh)
                if game is None:
                    break
                our_white = game.headers.get("White") == "our"
                board = game.board()
                losses = []
                ply = 0
                for move in game.mainline_moves():
                    ours = (board.turn == chess.WHITE) == our_white
                    if ours:
                        before = score_cp(sf, board, args.depth)
                        best = sf.analyse(board, chess.engine.Limit(depth=args.depth))["pv"][0]
                        board.push(move)
                        after = -score_cp(sf, board, args.depth)
                        loss = before - after
                        if loss >= args.threshold:
                            losses.append((loss, ply, move, best, before, after))
                            blunders.append((loss, ply, move, best, before, after, board.copy()))
                    else:
                        board.push(move)
                    ply += 1
                per_game.append((game.headers.get("Result"), losses))
    finally:
        sf.quit()

    print("=== moves of ours losing >= %d cp (SF depth %d) ===" % (args.threshold, args.depth))
    for i, (result, losses) in enumerate(per_game):
        total = sum(l[0] for l in losses)
        print("game %d  result %-8s  %2d bad moves  %5d cp total" % (i + 1, result, len(losses), total))
    print()
    blunders.sort(key=lambda b: -b[0])
    print("worst %d:" % args.top)
    for loss, ply, move, best, before, after, board_after in blunders[:args.top]:
        print("  -%4dcp  move %-3d  played %-7s  best %-7s  (%+d -> %+d)"
              % (loss, ply // 2 + 1, move.uci(), best.uci(), before, after))

    if blunders:
        print()
        print("all of our moves in the %d worst games, by phase:" % len(per_game))
        phase = collections.Counter()
        for loss, ply, move, best, before, after, _ in blunders:
            phase["opening (ply<20)" if ply < 20 else
                  ("middlegame (20-60)" if ply < 60 else "endgame (60+)")] += 1
        for k, v in phase.most_common():
            print("   %-22s %d" % (k, v))


if __name__ == "__main__":
    main()
