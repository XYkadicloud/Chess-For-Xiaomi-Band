#!/usr/bin/env bash
# eval_regression.sh — the fast, repeatable check for an evaluation change.
#
# A single number ("we score 0.31 against Stockfish") is not enough to accept or
# reject a change, and a match takes 10+ minutes per revision. This runs the two
# cheap, low-variance metrics on a FIXED fixture instead:
#
#   1. r    — correlation between our static eval and Stockfish's shallow eval
#             on tools/_fixtures/eval_sample.fen. Directional, not proof.
#   2. nps  — the change must not cost measurable search speed on the band-class
#             budget. An evaluation term that adds 30% to the eval cost is a
#             losing trade on a watch even if r improves.
#
# Usage:
#   bash tools/eval_regression.sh                 # current src/common/js/ai.js
#   bash tools/eval_regression.sh path/to/cand.js # a candidate file
set -uo pipefail
cd "$(dirname "$0")/.."

NODE="C:/Users/HP/.workbuddy-ai/binaries/node/versions/22.22.2-3/node.exe"
SF="${SF:-C:\\Users\\HP\\AppData\\Local\\Temp\\sf\\stockfish\\stockfish-windows-x86-64-avx2.exe}"
FIX="tools/_fixtures/eval_sample.fen"
ENGINE="${1:-}"

if [ -n "$ENGINE" ]; then
  export CHESS_AI_JS="$ENGINE"
  echo "engine: $ENGINE"
else
  echo "engine: src/common/js/ai.js (default)"
fi

if [ ! -f "$SF" ]; then
  echo "Stockfish not found at: $SF"
  echo "set SF=/path/to/stockfish and re-run"
  exit 2
fi

echo
echo "--- static eval vs Stockfish shallow (fixed ${FIX}) ---"
for d in 1 2; do
  printf 'SF depth %s: ' "$d"
  "$NODE" tools/check_eval_quality.js "$SF" "$d" "$FIX" \
    | grep -E "correlation|mean abs error|mean bias" | tr -s ' ' | tr '\n' '|'
  echo
done

echo
echo "--- search speed (must not regress) ---"
"$NODE" tools/bench_engine.js 2>/dev/null | grep -E "^nps\["
