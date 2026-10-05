#!/usr/bin/env python
"""
elo_match.py — play Chess-For-Xiaomi-Band against Stockfish at a chosen strength
and report the score, which converts directly into an Elo difference.

Desktop-only calibration tool. Not part of the RPK.

Usage:
    python tools/elo_match.py --sf /tmp/sf/stockfish/stockfish-....exe \
        --level master --movetime 0.3 --games 10 --skill 0

Both engines get the SAME fixed time per move (--movetime), so the result is a
like-for-like strength comparison rather than a speed race.

Stockfish strength is selected with either:
    --elo N     (UCI_LimitStrength + UCI_Elo; Stockfish's minimum is 1320)
    --skill N   (Skill Level 0..20; use this below 1320)
"""

import argparse
import math
import sys
import time

import chess
import chess.engine
import chess.pgn

BRIDGE = "tools/uci_bridge.js"
NODE = "C:/Users/HP/.workbuddy-ai/binaries/node/versions/22.22.2-3/node.exe"


def elo_diff(score):
    """Convert a match score (0..1) into an Elo difference."""
    if score <= 0.0:
        return -800.0
    if score >= 1.0:
        return 800.0
    return -400.0 * math.log10(1.0 / score - 1.0)


def play_one(our_engine, sf_engine, our_white, movetime, max_plies, opening=None, sf_nodes=0):
    board = chess.Board()
    if opening:
        for uci in opening.split():
            board.push_uci(uci)

    our_limit = chess.engine.Limit(time=movetime)  # -> `go movetime <ms>`
    # Stockfish may be limited by nodes instead of time, so the two sides do not
    # necessarily share a limit object.
    sf_limit = chess.engine.Limit(nodes=sf_nodes) if sf_nodes else our_limit
    moves_san = []
    while not board.is_game_over(claim_draw=True) and board.ply() < max_plies:
        ours = (board.turn == chess.WHITE) == our_white
        engine = our_engine if ours else sf_engine
        limit = our_limit if ours else sf_limit
        try:
            result = engine.play(board, limit)
        except Exception as exc:
            # Name the side that failed: "some engine timed out" is useless when
            # two engines are in the loop and only one of them is ours.
            side = "OURS" if ours else "STOCKFISH"
            return "0-1" if board.turn == chess.WHITE else "1-0", moves_san, \
                "%s failed at ply %d: %s" % (side, board.ply(), type(exc).__name__), board
        if result.move is None:
            break
        moves_san.append(board.san(result.move))
        board.push(result.move)

    if board.is_game_over(claim_draw=True):
        outcome = board.outcome(claim_draw=True)
        if outcome.winner is None:
            return "1/2-1/2", moves_san, outcome.termination.name, board
        return ("1-0" if outcome.winner == chess.WHITE else "0-1"), moves_san, \
            outcome.termination.name, board

    # Hit the ply cap: call it a draw. Long shuffles in dead-drawn endgames are
    # not evidence of strength in either direction.
    return "1/2-1/2", moves_san, "adjudicated (ply cap)", board


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sf", required=True, help="path to the Stockfish binary")
    ap.add_argument("--level", default="master", choices=["easy", "normal", "hard", "master"])
    ap.add_argument("--movetime", type=float, default=0.3, help="seconds per move, both sides")
    ap.add_argument("--games", type=int, default=10)
    ap.add_argument("--elo", type=int, default=0, help="Stockfish UCI_Elo (>=1320)")
    ap.add_argument("--skill", type=int, default=-1, help="Stockfish Skill Level 0..20")
    ap.add_argument("--nodes", type=int, default=0,
                    help="limit Stockfish by NODES instead of strength. A node-limited "
                         "Stockfish is a *principled* weak opponent (full evaluation, "
                         "shallow search), which is a far better stand-in for a human of "
                         "similar strength than UCI_LimitStrength, whose low settings "
                         "play like a drunk Stockfish rather than a weak human.")
    ap.add_argument("--max-plies", type=int, default=200)
    ap.add_argument("--openings", default="", help="file with one UCI opening line per line")
    ap.add_argument("--debug", action="store_true", help="log the full UCI exchange")
    ap.add_argument("--pgn", default="", help="write the games to this PGN file for review")
    args = ap.parse_args()

    if args.debug:
        import logging
        logging.basicConfig(level=logging.DEBUG, stream=sys.stdout, format="%(message)s")

    openings = [""]
    if args.openings:
        with open(args.openings) as fh:
            openings = [ln.strip() for ln in fh if ln.strip()]
        openings = [ln for ln in openings if ln]

    sf_opts = {"Threads": 1, "Hash": 16}
    if args.elo:
        sf_opts["UCI_LimitStrength"] = True
        sf_opts["UCI_Elo"] = args.elo
    if args.skill >= 0:
        sf_opts["Skill Level"] = args.skill

    label = ("UCI_Elo=%d" % args.elo) if args.elo else ("Skill=%d" % args.skill)
    if args.nodes:
        label = "nodes=%d" % args.nodes

    our = chess.engine.SimpleEngine.popen_uci([NODE, BRIDGE])
    sf = chess.engine.SimpleEngine.popen_uci(args.sf)
    try:
        our.configure({"Level": args.level, "Movetime": int(args.movetime * 1000)})
        sf.configure(sf_opts)

        print("=== %s vs Stockfish %s | %s | %.0fms/move | %d games ===" % (
            args.level, label, "threads=1", args.movetime * 1000, args.games))
        sys.stdout.flush()

        wins = losses = draws = 0
        t0 = time.time()
        pgn_games = []
        for g in range(args.games):
            our_white = (g % 2 == 0)
            opening = openings[g % len(openings)] if len(openings) > 1 else ""
            res, sans, why, final_board = play_one(our, sf, our_white, args.movetime,
                                                   args.max_plies, opening, sf_nodes=args.nodes)
            if args.pgn:
                game = chess.pgn.Game()
                game.headers["Event"] = "elo_match"
                game.headers["White"] = "our" if our_white else label
                game.headers["Black"] = label if our_white else "our"
                game.headers["Result"] = res
                game.headers["Termination"] = why
                node = game
                # The game did not start from the initial position, so the
                # opening moves have to be replayed into the PGN as well.
                board_replay = chess.Board()
                for uci in (opening.split() if opening else []):
                    mv = board_replay.parse_uci(uci)
                    node = node.add_variation(mv)
                    board_replay.push(mv)
                for san in sans:
                    mv = board_replay.parse_san(san)
                    node = node.add_variation(mv)
                    board_replay.push(mv)
                pgn_games.append(game)
            if res == "1/2-1/2":
                draws += 1
                mark = "="
            elif (res == "1-0") == our_white:
                wins += 1
                mark = "+"
            else:
                losses += 1
                mark = "-"
            print("  game %2d  %s  our=%s  %-22s %3d plies  %s" % (
                g + 1, mark, "white" if our_white else "black", res, len(sans), why))
            sys.stdout.flush()

        total = wins + losses + draws
        score = (wins + 0.5 * draws) / total if total else 0.0
        diff = elo_diff(score)
        print("---")
        print("  our engine: %dW %dL %dD   score %.3f" % (wins, losses, draws, score))
        print("  Elo difference vs %s: %+.0f" % (label, diff))
        print("  (positive = our engine is stronger; +/- 1 game ~ %.0f Elo at this sample size)"
              % (400.0 / max(1, total)))
        print("  elapsed %.0fs" % (time.time() - t0))

        if args.pgn and pgn_games:
            with open(args.pgn, "w") as fh:
                for game in pgn_games:
                    print(game, file=fh)
                    print(file=fh)
            print("  PGN written to %s" % args.pgn)
    finally:
        # Always reap both engines: an orphaned child keeps the inherited stdout
        # pipe open, which makes any `| tail` in the calling shell hang forever.
        for eng in (our, sf):
            try:
                eng.quit()
            except Exception:
                pass


if __name__ == "__main__":
    main()
