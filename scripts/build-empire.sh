#!/usr/bin/env bash
# build-empire.sh -- rebuild empire/empire.wasm, empire/empire-host.js and data/empire-cards.json from PARENA source (stdlib/empire/web/*.prn in the
# sibling PARENA checkout, or $PARENA_DIR). All three are committed, the same convention as d2/d2.wasm and the other games: the deploy image is built from
# git-tracked files only, so a change to the .prn files is not live until this is run and the outputs are committed.
#
#   empire.wasm        the game: rules, AIs, protocol, screens. No allocator, no imports. IDUNA embeds the very same file (scripts/sync-empire-wasm.sh there).
#   empire-host.js     the page's host code. PARENA -> TypeScript -> JS; there is no hand-written JS in empire/ that runs the game.
#   empire-cards.json  the cards, factions and AIs the stats pages describe, read from empire.wasm's own exports so they cannot drift.
#
# Needs node and the LLVM toolchain at ~/.local/opt/llvm-toolchain (see PARENA/scripts/build_empire_wasm.sh).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
PARENA="${PARENA_DIR:-$SRC/../PARENA}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
"$PARENA/scripts/build_empire_web.sh" "$W"
cp "$W/empire.wasm" "$W/empire-host.js" "$SRC/empire/"
node "$SRC/scripts/empire-cards.mjs" "$SRC/empire/empire.wasm" "$PARENA/stdlib/empire/web" "$SRC/data/empire-cards.json"
echo "updated $SRC/empire/empire.wasm, empire-host.js and data/empire-cards.json"
echo "IDUNA's referee must run the same wasm: IDUNA/scripts/sync-empire-wasm.sh (sim version $(node -e "console.log(JSON.parse(require('fs').readFileSync('$SRC/data/empire-cards.json')).version)"))"
