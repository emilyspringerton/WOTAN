#!/usr/bin/env bash
# iduna-receive -- the IDUNA box's half of IDUNA auto-deploy.
#
# Installed as /usr/local/sbin/emily-iduna-receive and bound to the CI key as a forced command:
#   restrict,command="/usr/local/sbin/emily-iduna-receive" ssh-ed25519 AAAA... iduna-ci-deploy
# CI builds and pushes ghcr.io/emilyspringerton/iduna:<sha> (IDUNA's release.yml), then runs `ssh root@box <sha>`.
# The client's command (SSH_ORIGINAL_COMMAND) is the tag and nothing else: it must be 7-40 hex characters.
#
# Steps: pull the image, point the iduna service in /opt/iduna/compose.yml at it (only that one `image:` line),
# `docker compose up -d iduna`, wait for the container healthcheck (+ /health on :8080), and on failure put the
# previous tag back and bring it up again. State (/srv/iduna/var) is never touched; sc-tunnel/web/logsync are not recreated.
set -euo pipefail

COMPOSE="${IDUNA_COMPOSE:-/opt/iduna/compose.yml}"
REPO="ghcr.io/emilyspringerton/iduna"
DOCKER="${DOCKER:-docker}"
WAIT="${IDUNA_WAIT:-120}"

log() { printf '[iduna-receive] %s\n' "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

tag="${SSH_ORIGINAL_COMMAND:-}"
[[ "$tag" =~ ^[0-9a-f]{7,40}$ ]] || die "expected a 7-40 hex character image tag, got '${tag:0:40}'"

exec 9>"${IDUNA_LOCK:-/run/lock/iduna-deploy.lock}"
flock -w 600 9 || die "another IDUNA deploy holds the lock"

[ "$(grep -c "^    image: $REPO:[0-9a-f]*$" "$COMPOSE")" = 1 ] || die "$COMPOSE does not have exactly one '$REPO:<tag>' image line"
prev="$(sed -n "s|^    image: $REPO:\([0-9a-f]*\)$|\1|p" "$COMPOSE")"
log "target $tag (live: $prev)"

"$DOCKER" pull -q "$REPO:$tag" >/dev/null || die "cannot pull $REPO:$tag (is the image built and public?)"

setrev() { sed -i "s|^    image: $REPO:[0-9a-f]*$|    image: $REPO:$1|" "$COMPOSE"; }
up()     { "$DOCKER" compose -f "$COMPOSE" up -d iduna; }
healthy() {
  local i s
  for i in $(seq 1 "$WAIT"); do
    s="$("$DOCKER" inspect -f '{{.State.Health.Status}}' iduna-iduna-1 2>/dev/null || echo none)"
    [ "$s" = healthy ] && return 0
    sleep 1
  done
  return 1
}

if [ "$tag" = "$prev" ]; then log "already running $tag; recreating nothing, checking health"; healthy && { log "healthy"; exit 0; } || die "running but unhealthy"; fi

cp -a "$COMPOSE" "$COMPOSE.prev"
setrev "$tag"
up
if healthy; then
  log "deployed $tag: iduna-iduna-1 healthy"
  exit 0
fi

log "health check FAILED for $tag; rolling back to $prev" >&2
"$DOCKER" logs --tail 30 iduna-iduna-1 >&2 || true
setrev "$prev"
up
if healthy; then log "rolled back to $prev" >&2; else log "ROLLBACK ALSO UNHEALTHY -- needs a human" >&2; fi
exit 1
