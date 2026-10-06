#!/usr/bin/env bash
# eval_quick.sh — fast iteration loop for an evaluation change (no search bench).
#
# Usage: bash tools/eval_quick.sh [candidate.js]
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

for d in 1 2 3; do
  "$NODE" tools/check_eval_quality.js "$SF" "$d" "$FIX" \
    | grep -E "^positions|^correlation|^mean abs|^mean bias|to move" \
    | sed "s/^/d$d  /"
done
"$NODE" tools/check_eval_symmetry.js "$FIX" | grep -E "mean \|error\|"
