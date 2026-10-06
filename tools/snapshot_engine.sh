#!/usr/bin/env bash
# snapshot_engine.sh — archive the current engine before it is changed again.
#
# `src/common/js/ai.js` is the single source of truth for the engine and every
# experiment edits it in place. Without a snapshot the previous revision is gone
# the moment the next one is written, which makes it impossible to re-measure a
# change or to go back to a version that played better.
#
# Every snapshot is a full copy plus a line in engine-history/MANIFEST.md with
# its md5, so any archived revision can be dropped straight back in:
#
#     cp engine-history/ai-1.2.0-shipped.js src/common/js/ai.js
#
# Usage:
#   bash tools/snapshot_engine.sh <version> <tag> [note...]
#   bash tools/snapshot_engine.sh 1.2.1 lean "reverted mobility, added bad bishop"
#
# A snapshot whose md5 already appears in the manifest is skipped, so running
# this repeatedly is harmless.
set -euo pipefail
cd "$(dirname "$0")/.."

VER="${1:?usage: snapshot_engine.sh <version> <tag> [note]}"
TAG="${2:?usage: snapshot_engine.sh <version> <tag> [note]}"
shift 2
NOTE="${*:-}"

SRC="src/common/js/ai.js"
DIR="engine-history"
OUT="$DIR/ai-$VER-$TAG.js"

mkdir -p "$DIR"
[ -f "$DIR/MANIFEST.md" ] || {
  printf '# Engine snapshots\n\n' > "$DIR/MANIFEST.md"
  printf 'Full copies of `src/common/js/ai.js` at each revision worth keeping.\n' >> "$DIR/MANIFEST.md"
  printf 'Restore any of them with `cp engine-history/<file> src/common/js/ai.js`.\n\n' >> "$DIR/MANIFEST.md"
  printf '| file | md5 | bytes | date | note |\n|---|---|---|---|---|\n' >> "$DIR/MANIFEST.md"
}

MD5=$(md5sum "$SRC" | cut -d' ' -f1)
BYTES=$(wc -c < "$SRC" | tr -d ' ')

if grep -q "$MD5" "$DIR/MANIFEST.md" 2>/dev/null; then
  echo "already archived (md5 $MD5) — nothing to do"
  exit 0
fi

cp "$SRC" "$OUT"
printf '| %s | %s | %s | %s | %s |\n' \
  "$OUT" "$MD5" "$BYTES" "$(date +%Y-%m-%d)" "$NOTE" >> "$DIR/MANIFEST.md"

echo "archived $SRC -> $OUT"
echo "  md5   $MD5"
echo "  bytes $BYTES"
