#!/usr/bin/env bash
# build-brawlpit.sh -- rebuild BRAWLPIT/brawlpit.wasm and BRAWLPIT/bp-host.js from PARENA source
# (stdlib/brawlpit/*.prn in the sibling PARENA checkout, or $PARENA_DIR). Both files are committed,
# the same convention as GFD/term.wasm: the deploy image is built from git-tracked files only, so a
# change to the .prn files is not live until this is run and the two outputs are committed.
#
#   brawlpit.wasm   the whole game: simulation, bots, menus, software renderer. No allocator, no imports.
#   bp-host.js      the page's host code. PARENA -> TypeScript -> JS; there is no hand-written JS in BRAWLPIT/.
#
# Needs node and the LLVM toolchain at ~/.local/opt/llvm-toolchain (see PARENA/scripts/build_brawlpit_wasm.sh).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
PARENA="${PARENA_DIR:-$SRC/../PARENA}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
"$PARENA/scripts/build_brawlpit_web.sh" "$W"
cp "$W/brawlpit.wasm" "$W/bp-host.js" "$SRC/BRAWLPIT/"
echo "updated $SRC/BRAWLPIT/brawlpit.wasm and bp-host.js"
