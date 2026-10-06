#!/usr/bin/env python3
"""measure_acpl.py — average centipawn loss, the metric that tracks real strength.

Static-eval correlation turned out to be useless here: on a balanced fixture a
material-only evaluation scored r=0.51 and the full hand-written evaluation
scored r=0.51, i.e. every positional term in the engine was invisible to it.
What matters is not "does the eval agree with Stockfish" but "does the engine
pick good moves".

For each position:
  * Stockfish (deep) scores the position and names its best move,
  * our engine is given the same position and the same time budget the band
    would give it, and returns a move,
  * Stockfish scores the position after our move,
  * the difference is the centipawn loss for that move.

Mean loss over many positions is ACPL, the standard strength proxy. A weaker
engine loses more per move; it is stable enough that ~150 positions detect a
20 cp/move difference.

Usage:
  python tools/measure_acpl.py --fens tools/_fixtures/acpl_sample.fen \
      --sf <stockfish> --bridge tools/uci_bridge.js --movetime 400 --sf-depth 12
"""

import argparse
import json
import os
import statistics
import subprocess
import sys

import chess
import chess.engine


def load_fens(path):
    out = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#"):
                out.append(line)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fens", required=True)
    ap.add_argument("--sf", required=True)
    ap.add_argument("--bridge", required=True, help="path to uci_bridge.js")
    ap.add_argument("--engine", default=None,
                    help="alternate ai.js for the bridge to load (A/B testing)")
    ap.add_argument("--node", default="node")
    ap.add_argument("--movetime", type=float, default=400.0)
    ap.add_argument("--level", default="hard")
    ap.add_argument("--sf-depth", type=int, default=12)
    ap.add_argument("--limit", type=int, default=0, help="use only first N positions")
    ap.add_argument("--json", default=None, help="write per-move detail here")
    args = ap.parse_args()

    fens = load_fens(args.fens)
    if args.limit:
        fens = fens[: args.limit]

    sf = chess.engine.SimpleEngine.popen_uci(args.sf)
    sf.configure({"Threads": 1, "Hash": 64})

    cmd = [args.node, args.bridge]
    if args.engine:
        cmd.append(args.engine)
    ours = chess.engine.SimpleEngine.popen_uci(cmd)

    detail = []
    losses = []
    big = 0
    matches = 0
    skipped = 0
    try:
        for i, fen in enumerate(fens):
            board = chess.Board(fen)
            if board.is_game_over(claim_draw=False):
                skipped += 1
                continue

            ref = sf.analyse(board, chess.engine.Limit(depth=args.sf_depth))
            # python-chess does not always put "move" in an analyse() result;
            # the principal variation is the reliable source.
            best = ref.get("move")
            if best is None:
                pv = ref.get("pv") or []
                best = pv[0] if pv else None
            best_cp = ref["score"].pov(board.turn).score(mate_score=10000)
            if best is None or best_cp is None:
                skipped += 1
                continue

            try:
                # NOTE: in this python-chess build `Limit.time` is in SECONDS and
                # is turned into `go movetime <time*1000>`. Passing milliseconds
                # here silently asks for a budget 1000x too large, which makes
                # every measurement meaningless (and very slow).
                res = ours.play(board, chess.engine.Limit(time=args.movetime / 1000.0))
            except chess.engine.EngineError:
                skipped += 1
                continue
            mv = res.move
            if mv is None or mv not in board.legal_moves:
                skipped += 1
                continue

            if mv == best:
                loss = 0
                matches += 1
            else:
                board.push(mv)
                after = sf.analyse(board, chess.engine.Limit(depth=args.sf_depth))
                after_cp = after["score"].pov(not board.turn).score(mate_score=10000)
                board.pop()
                loss = best_cp - after_cp
                if loss < 0:
                    loss = 0

            losses.append(loss)
            if loss >= 100:
                big += 1
            detail.append({"fen": fen, "best": best.uci(), "our": mv.uci(),
                           "loss": loss, "best_cp": best_cp})

            if (i + 1) % 25 == 0:
                print("  %d/%d  mean loss so far %.1f"
                      % (i + 1, len(fens), sum(losses) / len(losses)), file=sys.stderr)
    finally:
        sf.quit()
        ours.quit()

    if not losses:
        print("no positions measured")
        return 1

    losses_sorted = sorted(losses)
    n = len(losses)
    print()
    print("=== move quality (%d positions, movetime %.0f ms, level %s) ==="
          % (n, args.movetime, args.level))
    print("mean cp loss     %.1f" % (sum(losses) / n))
    print("median cp loss   %.1f" % statistics.median(losses))
    print("90th percentile  %d" % losses_sorted[int(n * 0.90)])
    print("worst            %d" % losses_sorted[-1])
    print("moves >= 100 cp  %d  (%.1f%%)" % (big, 100.0 * big / n))
    print("matched SF best  %d  (%.1f%%)" % (matches, 100.0 * matches / n))
    if skipped:
        print("skipped          %d" % skipped)

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(detail, fh, indent=1)
        print("detail written to %s" % args.json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
