#!/usr/bin/env bash
# build-redgarden.sh -- rebuild redgarden/redgarden.wasm and redgarden/rg-host.js from PARENA source
# (stdlib/redgarden/web/*.prn in the sibling PARENA checkout, or $PARENA_DIR). Both files are committed, the same
# convention as BRAWLPIT/brawlpit.wasm and shankpit-460/shankpit460.wasm: the deploy image is built from git-tracked
# files only, so a change to the .prn files is not live until this is run and the two outputs are committed.
#
#   redgarden.wasm   the game client: the arena protocol, the arena renderer, the draft, shop, HUD and orders.
#                    No allocator, no imports.
#   rg-host.js       the page's host code. PARENA -> TypeScript -> JS; there is no hand-written JS in redgarden/.
#
# Needs node and the LLVM toolchain at ~/.local/opt/llvm-toolchain (see PARENA/scripts/build_redgarden_wasm.sh).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
PARENA="${PARENA_DIR:-$SRC/../PARENA}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
"$PARENA/scripts/build_redgarden_web.sh" "$W"
cp "$W/redgarden.wasm" "$W/rg-host.js" "$SRC/redgarden/"
echo "updated $SRC/redgarden/redgarden.wasm and rg-host.js"
