#!/usr/bin/env bash
# apply_all.sh — deterministic pipeline that brings every device/language tree
# to the target state: text-overflow fixes + AI opponent + shared engine.
#
# ORDER MATTERS:
#   1. copy the shared engine into every tree
#   2. patch game.ux  (AI state, methods, move hook, settings rows, params)
#   3. patch setup.ux (opponent + difficulty chooser)
#   4. fix text overflow (style-only, safe on top of 2 & 3)
#
# Re-running is safe: every step is idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

NODE="C:/Users/HP/.workbuddy-ai/binaries/node/versions/22.22.2-3/node.exe"

echo "== 0. piece sprites (bitmap, SVG is not renderable on the band) =="
# Regenerate only when the source SVGs or the generator are newer than the
# installed sprites; the rasteriser needs a Python venv with svglib+Pillow.
PIECES_PY="C:/Users/HP/.workbuddy-ai/binaries/python/envs/pieces/Scripts/python.exe"
if [ -x "$PIECES_PY" ] && [ -d tools/_icons/meridian ]; then
  "$PIECES_PY" tools/build_piece_png.py | tail -1
  "$NODE" tools/install_pieces.js | tail -1
else
  echo "   (rasteriser venv or source SVGs missing - keeping installed sprites)"
fi

echo "== 1. sync shared engine =="
for d in devices/xiaomi-band-9 devices/xiaomi-band-9-pro devices/xiaomi-band-10; do
  for l in chinese english; do
    mkdir -p "$d/source/$l/src/common/js"
    cp src/common/js/ai.js "$d/source/$l/src/common/js/ai.js"
  done
done
echo "   engine copied to 6 trees"

echo "== 2. patch game.ux =="
"$NODE" tools/integrate_ai.js

echo "== 3. generate setup.ux (two-screen wizard) =="
"$NODE" tools/build_setup_page.js

echo "== 4. refresh user-facing copy =="
"$NODE" tools/update_copy_ai.js

echo "== 5. fix text overflow =="
"$NODE" tools/fix_text_overflow.js

echo "== 6. fix porting constants =="
"$NODE" tools/fix_porting.js

echo
echo "== verification =="
"$NODE" tools/verify_handlers.js
"$NODE" tools/verify_ai_engine.js | tail -3
"$NODE" tools/verify_ai_integration.js | tail -3
"$NODE" tools/verify_time_side.js | tail -1
"$NODE" tools/verify_pieces.js | tail -1
"$NODE" tools/audit_text_overflow.js | tail -1
echo "-- setup layout fit --"
"$NODE" tools/check_setup_fit.js | tail -1
"$NODE" tools/check_seg_width.js | tail -1
