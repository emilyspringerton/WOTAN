#!/usr/bin/env bash
# game-receive <game> -- the game box's half of auto-deploy for SHANKPIT, shankpit-460, REDGARDEN and D2.
#
# Installed as /usr/local/sbin/emily-game-receive on play.okemily.com. Each game has its own CI key, bound in root's
# authorized_keys as a forced command that names the game:
#   restrict,command="/usr/local/sbin/emily-game-receive redgarden" ssh-ed25519 AAAA... redgarden-ci-deploy
# so a key can only ever hand over the files of the one game it belongs to. Whatever command the client asks for is ignored.
# stdin: a .tgz holding exactly the files this script lists for that game (see the case below) plus REVISION.
#
# Steps: unpack to a staging dir, validate (listed paths only, regular files, ELF magic on binaries), back up the live
# files to .prev/, install each atomically (write beside, mv over), restart the game's units, health-check, and on failure
# restore .prev/, restart, exit 1. var/ and everything else under the game dir is never touched.
set -euo pipefail

game="${1:-}"
BASE="${GAMES_BASE:-/srv/games}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
SETTLE="${GAMES_SETTLE:-4}"          # seconds between health probes (tests set 0)

# Per-game profile. BIN = must be present and an ELF executable. DATA = optional plain files. UNITS = restarted in order.
case "$game" in
  shankpit)    DIR=shankpit;     BIN=(bin/shank_server bin/emily-bot);                                    DATA=(seed_zombie.json)
               UNITS=(shankpit-server shankpit-zombie shankpit-bots) ;;
  shankpit460) DIR=shankpit-460; BIN=(bin/shank_server bin/emily-bot);                                    DATA=(maps/v0_shankpit.map)
               UNITS=(shankpit460-server shankpit460-bots) ;;
  redgarden)   DIR=redgarden;    BIN=(bin/red_garden_matchmaker bin/red_garden_arena_server bin/red_garden_arena_bot); DATA=()
               UNITS=(redgarden-stable-mm redgarden-stable-bots redgarden-rnd-mm redgarden-rnd-bots redgarden-rnd-players-mm redgarden-rnd-3v3-mm redgarden-rnd-3v3-bots) ;;
  d2)          DIR=d2;           BIN=(bin/dw2_server bin/dw2_bot);                                        DATA=()
               UNITS=(d2-server d2-bots) ;;
  *) echo "[game-receive] unknown game '$game'" >&2; exit 2 ;;
esac
ROOT="$BASE/$DIR"
MAX_BYTES=$((128 * 1024 * 1024))
FILES=("${BIN[@]}" "${DATA[@]}")

log() { printf '[game-receive:%s] %s\n' "$game" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[ -d "$ROOT" ] || die "$ROOT does not exist"
exec 9>"${GAMES_LOCK:-/run/lock/game-deploy-$game.lock}"
flock -w 300 9 || die "another $game deploy holds the lock"

umask 022
stage="$(mktemp -d "$ROOT/.incoming.XXXXXX")"
trap 'rm -rf "$stage"' EXIT

# 1. Unpack. GNU tar refuses absolute and '..' member names by default; ownership comes from root, not the archive.
head -c "$MAX_BYTES" | tar -xz --no-same-owner -C "$stage" || die "bad tarball"

# 2. Validate: regular files and directories only; every file must be one of the listed paths (or REVISION).
[ -z "$(find "$stage" ! -type f ! -type d | head -1)" ] || die "tarball has links or special files"
while IFS= read -r f; do
  f="${f#./}"; [ -n "$f" ] || continue
  ok=0; for a in "${FILES[@]}" REVISION; do [ "$f" = "$a" ] && ok=1; done
  [ "$ok" = 1 ] || die "unexpected file $f for $game"
done < <(cd "$stage" && find . -type f)
for b in "${BIN[@]}"; do
  [ -f "$stage/$b" ] || die "missing $b"
  [ "$(head -c4 "$stage/$b" | od -An -tx1 | tr -d ' \n')" = "7f454c46" ] || die "$b is not an ELF binary"
done
rev="$(head -c 64 "$stage/REVISION" 2>/dev/null | tr -cd '0-9a-f')"
[ -n "$rev" ] || die "missing REVISION"
log "received $rev (live: $(cat "$ROOT/REVISION" 2>/dev/null || echo unknown))"

# 3. Back up what's live (only the listed files).
rm -rf "$ROOT/.prev" && mkdir -p "$ROOT/.prev"
for f in "${FILES[@]}" REVISION; do
  if [ -f "$ROOT/$f" ]; then mkdir -p "$ROOT/.prev/$(dirname "$f")"; cp -a "$ROOT/$f" "$ROOT/.prev/$f"; fi
done

install_one() { # install_one <srcdir> <relpath>
  local src="$1/$2" dst="$ROOT/$2" mode=0644
  for b in "${BIN[@]}"; do [ "$b" = "$2" ] && mode=0755; done
  mkdir -p "$(dirname "$dst")"
  install -m "$mode" "$src" "$(dirname "$dst")/.$(basename "$dst").new" && mv -f "$(dirname "$dst")/.$(basename "$dst").new" "$dst"
}
install_from() { # install_from <srcdir>: install every listed file present there
  local f
  for f in "${FILES[@]}" REVISION; do [ -f "$1/$f" ] && install_one "$1" "$f"; done
  return 0
}

healthy() {
  local u i
  sleep "$SETTLE"
  for i in 1 2; do
    for u in "${UNITS[@]}"; do "$SYSTEMCTL" is-active --quiet "$u" || { log "$u is not active"; return 1; }; done
    sleep "$SETTLE"; sleep "$SETTLE"   # Restart=always with RestartSec=5s: a crash-loop shows as activating or NRestarts>0
  done
  for u in "${UNITS[@]}"; do
    n="$("$SYSTEMCTL" show -p NRestarts --value "$u" 2>/dev/null || echo 0)"
    [ "${n:-0}" = "0" ] || { log "$u restarted itself ($n times)"; return 1; }
  done
}

# 4. Install and restart.
install_from "$stage"
"$SYSTEMCTL" restart "${UNITS[@]}"

if healthy; then
  log "deployed $rev: ${UNITS[*]} active"
  exit 0
fi

# 5. Roll back.
log "health check FAILED for $rev; rolling back" >&2
journalctl -u "${UNITS[0]}" -n 30 --no-pager >&2 || true
install_from "$ROOT/.prev"
"$SYSTEMCTL" restart "${UNITS[@]}"
if healthy; then log "rolled back to $(cat "$ROOT/REVISION" 2>/dev/null || echo previous)" >&2
else log "ROLLBACK ALSO UNHEALTHY -- needs a human" >&2; fi
exit 1
