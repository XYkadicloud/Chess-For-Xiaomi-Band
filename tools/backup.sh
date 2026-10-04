#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# backup.sh — complete, repeatable backup of this project.
#
# `git push` alone is NOT a complete backup, so this makes three layers:
#
#   1. commit + push  the tracked source of truth, off-site (GitHub)
#   2. git bundle     the ENTIRE history in one file, restorable offline
#   3. local archive  the ignored-but-critical files git never sees:
#                       sign/           signing keys — lose these and you can
#                                       never publish an update again
#                       _pieces_src/    the user's 512px piece artwork
#                       .workbuddy-ai/  assistant memory / project notes
#                       releases/       the built .rpk packages
#                       tools/_icons/   the SVG art source
#
# Usage
#   bash tools/backup.sh                  commit if needed, push, then archive
#   bash tools/backup.sh -m "message"     use an explicit commit message
#   bash tools/backup.sh --no-push        archive only, leave the remote alone
#   CHESS_BACKUP_DIR=/some/path bash tools/backup.sh
#
# Exit status: 0 = everything succeeded, 1 = something needs attention.
# A clean tree with nothing to push is still a success — the archive is
# refreshed either way.
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")/.."

KEEP="${CHESS_BACKUP_KEEP:-10}"          # how many timestamped archives to keep
MSG=""
DO_PUSH=1
while [ $# -gt 0 ]; do
  case "$1" in
    -m) MSG="${2:-}"; shift 2 ;;
    --no-push) DO_PUSH=0; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# The backup lives OUTSIDE the repo so it can never be caught by `git add -A`
# and so restoring is possible even if the working tree is destroyed.
BACKUP_DIR="${CHESS_BACKUP_DIR:-$(cd .. && pwd)/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR/git" "$BACKUP_DIR/local" || exit 1

fail=0
say() { printf '%s\n' "$*"; }
bad() { printf 'PROBLEM: %s\n' "$*" >&2; fail=1; }

say "== backup -> $BACKUP_DIR =="

# --- 0. identity -----------------------------------------------------------
# Commits need a name/email. Set a repo-local one if neither local nor global
# is present, so a fresh clone on another machine still works.
if [ -z "$(git config user.email || true)" ]; then
  git config --local user.name  "XYKadi" >/dev/null
  git config --local user.email "180416938+XYkadicloud@users.noreply.github.com" >/dev/null
  say "   set repo-local git identity (XYKadi)"
fi

# --- 1. commit -------------------------------------------------------------
# Never let a private key into the repository. They are gitignored, but this is
# cheap insurance against a future .gitignore mistake.
leak="$(git status --porcelain | grep -iE '\.(pem|key|p12|pfx)$' || true)"
if [ -n "$leak" ]; then
  bad "refusing to commit — signing material is staged:"
  printf '%s\n' "$leak" | sed 's/^/     /' >&2
else
  git add -A
  if git diff --cached --quiet; then
    say "   no source changes to commit"
  else
    n="$(git diff --cached --name-only | wc -l | tr -d ' ')"
    [ -n "$MSG" ] || MSG="backup: $n file(s) at $STAMP"
    if git commit -q -m "$MSG"; then
      say "   committed $n file(s): $MSG"
    else
      bad "git commit failed"
    fi
  fi
fi

# --- 2. push ---------------------------------------------------------------
if [ "$DO_PUSH" -eq 1 ] && [ "$fail" -eq 0 ]; then
  if git remote get-url origin >/dev/null 2>&1; then
    if git push -q 2>/tmp/chess_backup_push.err; then
      say "   pushed to origin/$(git rev-parse --abbrev-ref HEAD)"
    else
      bad "git push failed:"
      sed 's/^/     /' /tmp/chess_backup_push.err >&2
    fi
  else
    say "   no 'origin' remote — skipped push"
  fi
fi

# --- 3. full history as a single file --------------------------------------
# A bundle holds the WHOLE history and is ~11 MB. If HEAD has not moved since
# the last run, the existing bundle already contains exactly this history, so
# reuse it rather than piling up identical copies.
HEAD_NOW="$(git rev-parse HEAD)"
BUNDLE=""
if [ -f "$BACKUP_DIR/LATEST.txt" ]; then
  prev_rel="$(sed -n 's/^bundle:   //p' "$BACKUP_DIR/LATEST.txt" | head -1)"
  prev_sha="$(sed -n 's/^commit:   //p' "$BACKUP_DIR/LATEST.txt" | head -1)"
  if [ "$prev_sha" = "$HEAD_NOW" ] && [ -n "$prev_rel" ] && [ -f "$BACKUP_DIR/$prev_rel" ]; then
    BUNDLE="$BACKUP_DIR/$prev_rel"
    say "   history unchanged (${HEAD_NOW:0:8}) — reusing $(basename "$BUNDLE")"
  fi
fi
if [ -z "$BUNDLE" ]; then
  BUNDLE="$BACKUP_DIR/git/chess-$STAMP.bundle"
  if git bundle create "$BUNDLE" --all >/dev/null 2>&1; then
    say "   history bundle: git/$(basename "$BUNDLE")  ($(du -h "$BUNDLE" | cut -f1))"
  else
    bad "git bundle failed"
  fi
fi
BUNDLE_REL="${BUNDLE#"$BACKUP_DIR"/}"

# --- 4. the files git does not track --------------------------------------
SNAP="$BACKUP_DIR/local"
ARCHIVE="$SNAP/chess-local-$STAMP.tar.gz"
INCLUDE=()
for p in _pieces_src releases tools/_icons .workbuddy-ai; do
  [ -e "$p" ] && INCLUDE+=("$p")
done
for d in devices/*/source/*/sign; do
  [ -d "$d" ] && INCLUDE+=("$d")
done

if [ ${#INCLUDE[@]} -gt 0 ]; then
  if tar -czf "$ARCHIVE" "${INCLUDE[@]}" 2>/dev/null; then
    say "   local archive:  local/$(basename "$ARCHIVE")  ($(du -h "$ARCHIVE" | cut -f1))"
    say "                   contains: ${INCLUDE[*]}"
  else
    bad "tar failed"
  fi
else
  say "   (nothing untracked worth archiving)"
fi

# --- 5. sanitized repo config ---------------------------------------------
# .git/config holds the remote URL, which here embeds a GitHub token. Keep the
# layout for a restore, but strip every credential from the copy.
if [ -f .git/config ]; then
  sed -E 's#(https?://)[^@/]*@#\1#' .git/config > "$SNAP/git-config.sanitized-$STAMP"
  say "   repo config (credentials stripped): local/git-config.sanitized-$STAMP"
fi

# --- 6. manifest -----------------------------------------------------------
{
  echo "Chess-For-Xiaomi-Band — backup $STAMP"
  echo "commit:   $(git rev-parse HEAD)"
  echo "branch:   $(git rev-parse --abbrev-ref HEAD)"
  echo "dirty:    $(git status --porcelain | wc -l | tr -d ' ') file(s) uncommitted"
  echo "bundle:   $BUNDLE_REL"
  [ -f "$ARCHIVE" ] && echo "archive:  local/$(basename "$ARCHIVE")"
  echo
  echo "Restore the whole history offline:"
  echo "  git clone <bundle> Chess-For-Xiaomi-Band"
  echo "Restore the untracked files:"
  echo "  tar -xzf <archive> -C <repo>"
} > "$BACKUP_DIR/LATEST.txt"

# --- 7. prune (keep the newest $KEEP of each) ------------------------------
prune() {
  local dir="$1" pat="$2" n=0
  for f in $(ls -1t "$dir"/$pat 2>/dev/null | tail -n +$((KEEP + 1))); do
    rm -f "$f" && n=$((n + 1))
  done
  [ "$n" -gt 0 ] && say "   pruned $n old archive(s) from $(basename "$dir")/"
  return 0
}
prune "$BACKUP_DIR/git" '*.bundle'
prune "$SNAP" '*.tar.gz'

say ""
if [ "$fail" -eq 0 ]; then
  say "BACKUP OK — $(ls -1 "$BACKUP_DIR"/git/*.bundle 2>/dev/null | wc -l | tr -d ' ') history snapshot(s), keeping newest $KEEP"
else
  say "BACKUP INCOMPLETE — see the PROBLEM lines above"
fi
exit "$fail"
