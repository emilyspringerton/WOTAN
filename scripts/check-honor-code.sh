#!/usr/bin/env bash
# check-honor-code.sh -- fails if WOTAN's embedded copy of THE_HONOR_CODE drifts from IDUNA's.
#
# The oath page (oath.html) shows the honor code it fetches from IDUNA (GET /api/v1/honor-code) and falls back to
# the copy in js/valholl-honor-code.js when IDUNA does not answer. That copy must be IDUNA's text byte for byte:
# same text, same version, same SHA-256 (IDUNA's internal/honorcode/honorcode.go, CurrentText / CurrentVersion /
# CurrentSHA256 = sha256 of the text). Go raw strings drop '\r' and JS template literals turn CRLF into LF, so both
# sides are compared with '\r' removed.
#
#   scripts/check-honor-code.sh                      # IDUNA checked out next to WOTAN (../IDUNA), as in MONOREPO
#   IDUNA_DIR=/path/to/IDUNA scripts/check-honor-code.sh
#   IDUNA_HONORCODE_GO=/path/to/honorcode.go scripts/check-honor-code.sh
#
# Exit 0 = in sync. Exit 1 = drift (says what differs). Exit 2 = a file is missing or unreadable.
set -euo pipefail
export LC_ALL=C
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GO_FILE="${IDUNA_HONORCODE_GO:-${IDUNA_DIR:-$ROOT/../IDUNA}/internal/honorcode/honorcode.go}"
JS_FILE="$ROOT/js/valholl-honor-code.js"

[ -r "$GO_FILE" ] || { echo "check-honor-code: cannot read IDUNA's honorcode.go at $GO_FILE (set IDUNA_DIR or IDUNA_HONORCODE_GO)" >&2; exit 2; }
[ -r "$JS_FILE" ] || { echo "check-honor-code: cannot read $JS_FILE" >&2; exit 2; }

# extract FILE PREFIX: the body of the backtick literal that starts right after PREFIX at the start of a line.
extract() {
  tr -d '\r' < "$1" | awk -v pre="$2" '
    !on && index($0, pre) == 1 { on = 1; $0 = substr($0, length(pre) + 1) }
    on { i = index($0, "`"); if (i) { print substr($0, 1, i - 1); found = 1; exit } print }
    END { if (!found) exit 3 }'
}

go_text="$(extract "$GO_FILE" 'const CurrentText = `')" || { echo "check-honor-code: CurrentText not found in $GO_FILE" >&2; exit 1; }
js_text="$(extract "$JS_FILE" 'var VHL_HONOR_CODE_TEXT = `')" || { echo "check-honor-code: VHL_HONOR_CODE_TEXT not found in $JS_FILE" >&2; exit 1; }

go_ver="$(tr -d '\r' < "$GO_FILE" | sed -n 's/^const CurrentVersion = \([0-9][0-9]*\).*/\1/p' | head -n1)"
js_ver="$(tr -d '\r' < "$JS_FILE" | sed -n 's/^var VHL_HONOR_CODE_VERSION = \([0-9][0-9]*\);.*/\1/p' | head -n1)"
js_sha="$(tr -d '\r' < "$JS_FILE" | sed -n "s/^var VHL_HONOR_CODE_SHA256 = '\([0-9a-f]\{64\}\)';.*/\1/p" | head -n1)"
go_sha="$(printf '%s' "$go_text" | sha256sum | cut -d' ' -f1)"
js_text_sha="$(printf '%s' "$js_text" | sha256sum | cut -d' ' -f1)"

fail=0
[ -n "$go_ver" ] || { echo "check-honor-code: CurrentVersion not found in $GO_FILE"; fail=1; }
[ -n "$js_ver" ] || { echo "check-honor-code: VHL_HONOR_CODE_VERSION not found in $JS_FILE"; fail=1; }
[ -n "$js_sha" ] || { echo "check-honor-code: VHL_HONOR_CODE_SHA256 (64 lowercase hex) not found in $JS_FILE"; fail=1; }
# A template literal would rewrite backslashes and run \${...}; the text must hold neither.
case "$js_text" in *'\'*|*'${'*) echo "check-honor-code: the embedded text holds a backslash or \${, which a JS template literal would alter"; fail=1 ;; esac
if [ "$go_text" != "$js_text" ]; then
  echo "check-honor-code: DRIFT -- js/valholl-honor-code.js text differs from IDUNA's CurrentText:"
  diff <(printf '%s\n' "$go_text") <(printf '%s\n' "$js_text") | head -n 20 || true
  fail=1
fi
[ "$js_text_sha" = "$go_sha" ] || { echo "check-honor-code: embedded text SHA-256 $js_text_sha != IDUNA's $go_sha"; fail=1; }
[ "$js_sha" = "$go_sha" ] || { echo "check-honor-code: VHL_HONOR_CODE_SHA256 $js_sha != IDUNA's $go_sha"; fail=1; }
[ "$js_ver" = "$go_ver" ] || { echo "check-honor-code: VHL_HONOR_CODE_VERSION $js_ver != IDUNA's CurrentVersion $go_ver"; fail=1; }
[ "$fail" = 0 ] || exit 1
echo "check-honor-code: OK -- version $go_ver, sha256 $go_sha, $(printf '%s' "$go_text" | wc -c | tr -d ' ') bytes, identical to $GO_FILE"
