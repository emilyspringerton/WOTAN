#!/usr/bin/env bash
# build-bedrockracers.sh -- rebuild bedrockracers/bedrockracers.wasm and bedrockracers/br-host.js from PARENA source
# (stdlib/bedrockracers/web/*.prn in the sibling PARENA checkout, or $PARENA_DIR). Both files are committed, the same
# convention as BRAWLPIT/brawlpit.wasm and shankpit-460/shankpit460.wasm: the deploy image is built from git-tracked files
# only, so a change to the .prn files is not live until this is run and the two outputs are committed.
#
#   bedrockracers.wasm   the whole game: rocket-car physics, the magnet and the Quaffle, the bots, the 3D software renderer, the
#                        menus. No allocator, no imports.
#   br-host.js           the page's host code. PARENA -> TypeScript -> JS; there is no hand-written JS in bedrockracers/.
#
# Needs node and the LLVM toolchain at ~/.local/opt/llvm-toolchain (see PARENA/scripts/build_bedrockracers_wasm.sh).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
PARENA="${PARENA_DIR:-$SRC/../PARENA}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
"$PARENA/scripts/build_bedrockracers_web.sh" "$W"
cp "$W/bedrockracers.wasm" "$W/br-host.js" "$SRC/bedrockracers/"
echo "updated $SRC/bedrockracers/bedrockracers.wasm and br-host.js"
