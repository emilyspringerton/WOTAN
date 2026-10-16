#!/usr/bin/env bash
# build-shankpit460.sh -- rebuild shankpit-460/shankpit460.wasm and shankpit-460/sp-host.js from PARENA source
# (stdlib/shankpit460/*.prn in the sibling PARENA checkout, or $PARENA_DIR). Both files are committed, the same
# convention as BRAWLPIT/brawlpit.wasm and GFD/term.wasm: the deploy image is built from git-tracked files only, so a
# change to the .prn files is not live until this is run and the two outputs are committed.
#
#   shankpit460.wasm   the whole game: simulation, bots, 3D software renderer, menus, the matchmaking protocol client.
#                      No allocator, no imports.
#   sp-host.js         the page's host code. PARENA -> TypeScript -> JS; there is no hand-written JS in shankpit-460/.
#
# Needs node and the LLVM toolchain at ~/.local/opt/llvm-toolchain (see PARENA/scripts/build_shankpit460_wasm.sh).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
PARENA="${PARENA_DIR:-$SRC/../PARENA}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
"$PARENA/scripts/build_shankpit460_web.sh" "$W"
cp "$W/shankpit460.wasm" "$W/sp-host.js" "$SRC/shankpit-460/"
echo "updated $SRC/shankpit-460/shankpit460.wasm and sp-host.js"
