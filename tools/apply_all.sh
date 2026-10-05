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
PYTHON="C:/Users/HP/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe"

echo "== 0. piece sprites (bitmap, SVG is not renderable on the band) =="
# Regenerate only when the source SVGs or the generator are newer than the
# installed sprites; the rasteriser needs a Python venv with svglib+Pillow.
# The active art set is lichess "cburnett" (GPLv2+); the old meridian CC0 set
# is kept in tools/_icons/meridian for reference but is NOT used. Gating on
# the meridian dir here would silently skip regeneration on a clean checkout.
PIECES_PY="C:/Users/HP/.workbuddy-ai/binaries/python/envs/pieces/Scripts/python.exe"
PIECES_SET="lichess"
if [ -x "$PIECES_PY" ] && [ -d "tools/_icons/$PIECES_SET" ]; then
  "$PIECES_PY" tools/build_piece_png.py --set "$PIECES_SET" | tail -1
  "$NODE" tools/install_pieces.js | tail -1
else
  echo "   (rasteriser venv or tools/_icons/$PIECES_SET missing - keeping installed sprites)"
fi

# Higher-fidelity cburnett set extracted from the user's pieces-assets-1.0
# zip. If the source dir exists, this overrides whatever step 0 just produced.
# CC-BY-SA-3.0 (Colin M.L. Burnett), so the manifest must keep attribution.
if [ -d "_pieces_src" ] && ls _pieces_src/*.png >/dev/null 2>&1; then
  echo "== 0b. install high-fidelity cburnett sprites from _pieces_src/ =="
  "$NODE" tools/install_pieces_from_assets.js | tail -1
fi

echo "== 0c. icon: shrink artwork to ~60% canvas so the launcher slot reads even =="
"$PYTHON" tools/fix_icon_padding.py | tail -1

echo "== 1. sync shared engine =="
# ONE tree per device now. The English build was folded into the Chinese tree
# and the language follows the DEVICE at runtime ($t() + src/i18n/*.json),
# so there is no longer a per-language copy to keep in sync.
for d in devices/xiaomi-band-9 devices/xiaomi-band-9-pro devices/xiaomi-band-10; do
  mkdir -p "$d/source/chinese/src/common/js"
  cp src/common/js/ai.js "$d/source/chinese/src/common/js/ai.js"
done
echo "   engine copied to 3 trees"

echo "== 1b. i18n strings (single source of truth: tools/build_i18n.js) =="
"$NODE" tools/build_i18n.js | tail -1

echo "== 2. patch game.ux =="
"$NODE" tools/integrate_ai.js

echo "== 3. generate setup.ux (two-screen wizard) =="
"$NODE" tools/build_setup_page.js | tail -1

echo "== 3b. (retired) new-game/end-game menu rows now in the page generator =="
# add_end_game_menu.js matched the Chinese literals 新建棋局 / 结束对局, which are
# now tr() bindings. The merged game page already renders an endGame row and
# only uses newGame from the result overlay ("再来一局"), so the patch has
# nothing left to do.
echo "   skipped (superseded by the i18n table)"

echo "== 3c. clock layout: bigger time on Band 9 / Band 10 (skip Band 9 Pro) =="
"$NODE" tools/fix_band9_band10_clock.js | tail -1

echo "== 4. (retired) user-facing copy now lives in tools/build_i18n.js =="
# update_copy_ai.js used to rewrite the About prose and drop the index subtitle.
# Both strings are now entries in the i18n table (about.aboutAppBody, etc.) and
# the subtitle is simply not part of the generator, so the old in-place patch
# has nothing left to match and must not run here.
echo "   skipped (superseded by the i18n table)"

echo "== 5. fix text overflow =="
"$NODE" tools/fix_text_overflow.js

echo "== 6. fix porting constants =="
"$NODE" tools/fix_porting.js

echo "== 7. give text nodes an explicit box (collapsed text is invisible) =="
"$NODE" tools/fix_back_text.js | tail -1

echo '== 8. merge English into the single tree (tr()/$t(), device-language aware) =='
# MUST run after every page generator/patcher above: it rewrites the pages'
# visible strings, so running it earlier would be undone.
"$NODE" tools/merge_languages.js | tail -3

echo "== 9. sync manifest features with the imports the pages actually use =="
"$NODE" tools/fix_manifest_features.js | tail -1

echo
echo "== verification =="
# Manifest first: a feature imported by a page but not declared here makes the
# toolkit fail the build outright ("missing feature: system.configuration").
"$NODE" tools/fix_manifest_features.js | tail -1
"$NODE" tools/verify_handlers.js
"$NODE" tools/verify_i18n.js | tail -1
"$NODE" tools/verify_ai_engine.js | tail -3
# Perft pins the move generator against the published node counts; the engine
# verifier only checks specific positions, so a rare castling/en-passant bug
# could pass it and still lose games on the device.
"$NODE" tools/verify_engine_perft.js | tail -3
# The book and the built-in endgame terms fail *silently* when they break (no
# book reply just looks like a normal search), so they get their own checks.
"$NODE" tools/verify_ai_book_endgame.js | tail -3
"$NODE" tools/verify_ai_integration.js | tail -3
# The page has its own legal-move generator (separate from the engine). It is
# optimised for tap latency, so pin it against the original algorithm — a
# missing move would never show up as an illegal game.
"$NODE" tools/verify_moves_parity.js | tail -3
"$NODE" tools/verify_ai_first_move.js | tail -1
"$NODE" tools/verify_time_side.js | tail -1
"$NODE" tools/verify_pieces.js | tail -1
"$NODE" tools/audit_text_overflow.js | tail -1
echo "-- setup layout fit --"
"$NODE" tools/check_setup_fit.js | tail -1
"$NODE" tools/check_seg_width.js | tail -1

# Artifact-level check: only runs once releases/*.rpk exist (i.e. after a
# release build). It inspects the COMPILED bundles, because a fix present in
# source can still be absent from the shipped package.
if ls releases/*.rpk >/dev/null 2>&1; then
  echo "-- built package contents --"
  "$NODE" tools/verify_release_rpk.js | tail -1
  "$NODE" tools/verify_pieces_in_rpk.js | tail -1
fi
