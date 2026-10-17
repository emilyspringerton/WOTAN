#!/usr/bin/env bash
# build-d2.sh -- rebuild d2/d2.wasm and d2/d2-host.js from PARENA source (stdlib/d2/web/*.prn in the sibling PARENA checkout, or
# $PARENA_DIR). Both files are committed, the same convention as BRAWLPIT/brawlpit.wasm, shankpit-460/shankpit460.wasm and
# redgarden/redgarden.wasm: the deploy image is built from git-tracked files only, so a change to the .prn files is not live until
# this is run and the two outputs are committed.
#
#   d2.wasm      the game client: the match server's protocol, the ship grid and its wiring, the screens. No allocator, no imports.
#   d2-host.js   the page's host code. PARENA -> TypeScript -> JS; there is no hand-written JS in d2/ that runs the game.
#
# Needs node and the LLVM toolchain at ~/.local/opt/llvm-toolchain (see PARENA/scripts/build_d2_wasm.sh).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
PARENA="${PARENA_DIR:-$SRC/../PARENA}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
"$PARENA/scripts/build_d2_web.sh" "$W"
cp "$W/d2.wasm" "$W/d2-host.js" "$SRC/d2/"
echo "updated $SRC/d2/d2.wasm and d2-host.js"
