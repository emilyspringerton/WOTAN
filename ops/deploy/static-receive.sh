#!/usr/bin/env bash
# static-receive <site> -- auto-deploy for the two static sites: wotan (WOTAN box) and okemily (IDUNA box).
#
# Installed as /usr/local/sbin/emily-static-receive and bound to the site's CI key as a forced command:
#   restrict,command="/usr/local/sbin/emily-static-receive wotan" ssh-ed25519 AAAA... wotan-ci-deploy
# stdin: a .tgz of the site (index.html at the top, REVISION beside it).
#
#   wotan    /var/www/wotan: this box owns the whole directory, so the new tree replaces it (old one kept in .prev).
#   okemily  /srv/iduna/var/www: IDUNA writes generated content (blog/, tyler/, prompt-o-verse/) into this same directory,
#            so the tree is overlaid and only the files the previous release shipped (listed in .site-manifest) are
#            removed when the new release no longer has them. Generated content is never touched.
# Health: the site's own nginx answers 200 for / afterwards. If not, the previous release is restored and the run fails.
set -euo pipefail

site="${1:-}"
case "$site" in
  wotan)   ROOT="${SITE_ROOT:-/var/www/wotan}";        MODE=replace
           PROBE=(curl -fsS -o /dev/null -k -H 'Host: wotan.okemily.com' https://127.0.0.1/) ;;
  okemily) ROOT="${SITE_ROOT:-/srv/iduna/var/www}";    MODE=overlay
           PROBE=(curl -fsS -o /dev/null http://127.0.0.1:8090/) ;;
  *) echo "[static-receive] unknown site '$site'" >&2; exit 2 ;;
esac
[ -n "${SITE_PROBE:-}" ] && PROBE=($SITE_PROBE)   # tests only
MAX_BYTES=$((512 * 1024 * 1024))

log() { printf '[static-receive:%s] %s\n' "$site" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[ -d "$ROOT" ] || die "$ROOT does not exist"
PARENT="$(dirname "$ROOT")"
exec 9>"${SITE_LOCK:-/run/lock/static-deploy-$site.lock}"
flock -w 300 9 || die "another $site deploy holds the lock"
umask 022
stage="$(mktemp -d "$PARENT/.incoming-$site.XXXXXX")"
trap 'rm -rf "$stage"' EXIT

head -c "$MAX_BYTES" | tar -xz --no-same-owner -C "$stage" || die "bad tarball"
[ -z "$(find "$stage" ! -type f ! -type d | head -1)" ] || die "tarball has links or special files"
[ -f "$stage/index.html" ] || die "no index.html at the top of the tarball"
[ -z "$(find "$stage" -name '.*' -not -path "$stage" | head -1)" ] || die "tarball has dotfiles"
rev="$(head -c 64 "$stage/REVISION" 2>/dev/null | tr -cd '0-9a-f')"
[ -n "$rev" ] || die "missing REVISION"
chmod -R a+rX "$stage"
log "received $rev (live: $(cat "$ROOT/REVISION" 2>/dev/null || echo unknown))"

PREV="$PARENT/.prev-$site"
rm -rf "$PREV"; mkdir -p "$PREV"

restore() {
  if [ "$MODE" = replace ]; then
    rm -rf "$ROOT.failed"; mv "$ROOT" "$ROOT.failed"; mv "$PREV/tree" "$ROOT"; rm -rf "$ROOT.failed"
  else
    ( cd "$ROOT" && [ -f .site-manifest ] && xargs -d '\n' -r rm -f -- < .site-manifest ) || true
    tar -xf "$PREV/files.tar" -C "$ROOT"
    cp -a "$PREV/manifest" "$ROOT/.site-manifest" 2>/dev/null || rm -f "$ROOT/.site-manifest"
  fi
}

if [ "$MODE" = replace ]; then
  cp -a "$ROOT" "$PREV/tree"
  mv "$ROOT" "$ROOT.old"; mv "$stage" "$ROOT"; rm -rf "$ROOT.old"
  trap - EXIT
else
  # remember exactly what the old release owned (manifest) and keep a copy of those files for rollback
  if [ -f "$ROOT/.site-manifest" ]; then
    cp -a "$ROOT/.site-manifest" "$PREV/manifest"
    ( cd "$ROOT" && tar -cf "$PREV/files.tar" --ignore-failed-read -T .site-manifest 2>/dev/null ) || true
  else
    ( cd "$ROOT" && tar -cf "$PREV/files.tar" --exclude=./blog --exclude=./tyler --exclude=./prompt-o-verse . ) || true
  fi
  ( cd "$stage" && find . -type f | sed 's|^\./||' | sort ) > "$stage/.new-manifest"
  # drop files the old release shipped that the new one does not
  if [ -f "$PREV/manifest" ]; then
    comm -23 <(sort "$PREV/manifest") "$stage/.new-manifest" | ( cd "$ROOT" && xargs -d '\n' -r rm -f -- )
  fi
  ( cd "$stage" && tar -cf - --exclude=.new-manifest . ) | tar -xf - -C "$ROOT"
  mv "$stage/.new-manifest" "$ROOT/.site-manifest"
fi

ok=0
for i in 1 2 3 4 5; do if "${PROBE[@]}"; then ok=1; break; fi; sleep 1; done
if [ "$ok" = 1 ]; then log "deployed $rev"; exit 0; fi

log "probe FAILED for $rev; restoring the previous release" >&2
restore
"${PROBE[@]}" && log "rolled back" >&2 || log "ROLLBACK ALSO FAILING -- needs a human" >&2
exit 1
