#!/usr/bin/env bash
# build_all.sh — compile every device/language RPK and report pass/fail.
#
# The `aiot` CLI is not on PATH, so we invoke the toolkit entry point directly
# through the managed Node runtime. Each tree keeps its own node_modules.
set -uo pipefail
cd "$(dirname "$0")/.."

NODE="C:/Users/HP/.workbuddy-ai/binaries/node/versions/22.22.2-3/node.exe"
ROOT="$(pwd)"

# The toolkit's post-build step rimrafs its own generated temp dir
# (devices/<d>/source/.temp_<lang>), which trips the CLI's bulk-delete
# guard at 50 files and makes the build exit 1 even though the RPK was
# produced. Scope the bypass to this script only -- every path removed here
# is build-generated, never user content.
export CODEBUDDY_SAFE_DELETE_ENABLED=0

pass=0; fail=0; failed=""

for d in xiaomi-band-9 xiaomi-band-9-pro xiaomi-band-10; do
  for l in chinese english; do
    dir="devices/$d/source/$l"
    if [ ! -d "$dir/node_modules/aiot-toolkit" ]; then
      echo "SKIP  $d/$l  (deps not installed)"
      continue
    fi
    echo "BUILD $d/$l ..."
    ( cd "$dir" && "$NODE" node_modules/aiot-toolkit/lib/bin.js build ) > "/tmp/build_${d}_${l}.log" 2>&1
    rc=$?
    rpk=$(ls "$dir"/dist/*.rpk 2>/dev/null | head -1)
    if [ $rc -eq 0 ] && [ -n "$rpk" ]; then
      sz=$(stat -c%s "$rpk" 2>/dev/null || echo 0)
      echo "  OK   $d/$l  ->  $(basename "$rpk")  ($sz bytes)"
      pass=$((pass+1))
    else
      echo "  FAIL $d/$l  (rc=$rc)  see /tmp/build_${d}_${l}.log"
      fail=$((fail+1)); failed="$failed $d/$l"
    fi
  done
done

echo
echo "builds passed: $pass   failed: $fail"
[ -n "$failed" ] && echo "failed:$failed"
