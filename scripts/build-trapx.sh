#!/usr/bin/env bash
# build-trapx.sh -- rebuild trapx/trapx-rules.js (and the committed .ts it is stripped from) out of PARENA.
#
# The rules are parENA's, not this page's: WOTAN/trapx/trapx-rules.js is
#   PARENA/stdlib/trapx/trapx_rules.prn -> TypeScript (parena's TS target) -> JavaScript (Node's own type stripper)
# exactly like shankpit-460's sp-host.js. SHANKPIT's C host links the SAME .prn emitted to C, and both sides assert
# PARENA/stdlib/trapx/trapx_parity.txt.
#
# Usage: scripts/build-trapx.sh   (needs a sibling ../PARENA checkout, or PARENA_DIR)
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
PARENA="${PARENA_DIR:-$SRC/../PARENA}"

if [ -x "$PARENA/.parena-bootstrap" ]; then
    PARENA_BIN="$PARENA/.parena-bootstrap"
elif [ -x "$PARENA/parena" ]; then
    PARENA_BIN="$PARENA/parena"
else
    echo "build-trapx: no parena binary at $PARENA (build it with: cd ../PARENA && make .parena-bootstrap)" >&2
    exit 1
fi

mkdir -p "$SRC/trapx"
"$PARENA_BIN" build "$PARENA/stdlib/trapx/trapx_rules.prn" -o "$SRC/trapx/trapx-rules.ts"
node "$PARENA/scripts/ts_strip.mjs" "$SRC/trapx/trapx-rules.ts" "$SRC/trapx/trapx-rules.js"
echo "updated trapx/trapx-rules.ts and trapx/trapx-rules.js"
