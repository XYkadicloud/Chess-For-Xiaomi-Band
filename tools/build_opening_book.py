#!/usr/bin/env python3
"""build_opening_book.py — derive the opening book from Stockfish, not from hand.

The book in `ai.js` was written by hand: 53 short lines. Two problems with that.
It only covers the first three or four moves, so any opponent deviation drops the
engine straight into its own shallow search — and on a watch that search is only
four or five plies deep, which is exactly where opening mistakes get made. And
the lines are only as good as the person who typed them.

This walks the opening tree with Stockfish and emits the paths as UCI lines in
the format `BOOK_LINES` already uses. Stockfish picks every move, so every
position in the book is a position a strong engine would be happy to be in.

Breadth is concentrated at the start (where being out of book hurts most) and
narrows with depth, which keeps the table small enough for a watch:

    ply 0..3   two replies per position
    ply 4..9   one reply per position

Run:
  python tools/build_opening_book.py --sf <stockfish> --depth 20 --out tools/_book_lines.txt
Then paste the output over BOOK_LINES in src/common/js/ai.js.
"""

import argparse
import sys

import chess
import chess.engine

# Where the tree gets a second branch, and how deep it goes at all.
WIDE_PLIES = 4
MAX_PLY = 10


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sf", required=True)
    ap.add_argument("--depth", type=int, default=20)
    ap.add_argument("--max-ply", type=int, default=MAX_PLY)
    ap.add_argument("--wide-plies", type=int, default=WIDE_PLIES)
    ap.add_argument("--cap", type=int, default=600, help="max positions to visit")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    sf = chess.engine.SimpleEngine.popen_uci(args.sf)
    sf.configure({"Threads": 1, "Hash": 128})

    # Breadth-first so the tree stays balanced and the cap cuts the deepest,
    # least valuable positions first.
    root = chess.Board()
    paths = [[]]          # list of move lists, one per node visited
    frontier = [(root, [])]
    visited = 0
    lines = []

    try:
        while frontier and visited < args.cap:
            board, path = frontier.pop(0)
            if board.ply() >= args.max_ply:
                lines.append(path)
                continue
            visited += 1
            k = 2 if board.ply() < args.wide_plies else 1
            info = sf.analyse(board, chess.engine.Limit(depth=args.depth), multipv=k)
            if isinstance(info, dict):
                info = [info]
            got = 0
            for pv in info:
                pvline = pv.get("pv") or []
                if not pvline:
                    continue
                mv = pvline[0]
                if mv not in board.legal_moves:
                    continue
                nb = board.copy()
                nb.push(mv)
                frontier.append((nb, path + [mv.uci()]))
                got += 1
            if got == 0:
                lines.append(path)
            if visited % 50 == 0:
                print("  visited %d, frontier %d, lines %d"
                      % (visited, len(frontier), len(lines)), file=sys.stderr)
    finally:
        sf.quit()

    # Any frontier left over when the cap hit is still a valid line.
    for _b, path in frontier:
        if path:
            lines.append(path)

    lines = [ln for ln in lines if ln]
    lines.sort()
    text = ",\n".join("  '" + " ".join(ln) + "'" for ln in lines)

    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text + "\n")
        print("wrote %d lines (%d positions) to %s"
              % (len(lines), visited, args.out))
    else:
        print(text)
        print("--- %d lines, %d positions ---" % (len(lines), visited), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
