#!/usr/bin/env bash
# setup.sh [service ...] -- one-time (and idempotent) wiring of auto-deploy for the Vultr services. Run from the ops box.
#
# For each service: install the receiver on its box, make a fresh ed25519 deploy key, authorize it in root's
# authorized_keys as a forced command (replacing any earlier key for the same service), store the private half as the
# repo secret DEPLOY_SSH_KEY, then shred the local copy. Needs: root ssh access to the boxes (ROOT_KEY) and a GitHub token
# that can write repo secrets (GH_TOKEN). Re-running rotates the key. GFD has its own (ops in GoblinFoxDragon/ops/deploy).
#
#   ROOT_KEY=~/secrets-unpacked/var/.ssh/id_ed25519 GH_TOKEN=$(cat ~/github) ./setup.sh            # all
#   ./setup.sh d2 okemily                                                                          # some
set -euo pipefail
cd "$(dirname "$0")"
ROOT_KEY="${ROOT_KEY:?set ROOT_KEY to the root ssh private key}"
: "${GH_TOKEN:?set GH_TOKEN}"; export GH_TOKEN
OWNER=emilyspringerton
SSH=(ssh -i "$ROOT_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
SCP=(scp -i "$ROOT_KEY" -o IdentitiesOnly=yes -o BatchMode=yes)

# service  repo  host  receiver-script  installed-name  forced-command-args
TABLE=(
  "iduna        IDUNA          137.220.58.252   iduna-receive.sh   emily-iduna-receive   "
  "okemily      OKEMILY        137.220.58.252   static-receive.sh  emily-static-receive  okemily"
  "wotan        WOTAN          64.177.15.59     static-receive.sh  emily-static-receive  wotan"
  "shankpit     SHANKPIT       play.okemily.com game-receive.sh    emily-game-receive    shankpit"
  "shankpit460  shankpit-460   play.okemily.com game-receive.sh    emily-game-receive    shankpit460"
  "redgarden    REDGARDEN      play.okemily.com game-receive.sh    emily-game-receive    redgarden"
  "d2           DEADWEIGHT_2   play.okemily.com game-receive.sh    emily-game-receive    d2"
)
want=("$@")
tmp="$(mktemp -d)"; trap 'shred -u "$tmp"/* 2>/dev/null; rm -rf "$tmp"' EXIT

for row in "${TABLE[@]}"; do
  read -r svc repo host script name args <<<"$row"
  if [ "${#want[@]}" -gt 0 ]; then case " ${want[*]} " in *" $svc "*) ;; *) continue;; esac; fi
  echo "== $svc -> $repo @ $host"
  "${SCP[@]}" -q "$script" "root@$host:/usr/local/sbin/$name"
  "${SSH[@]}" "root@$host" "chmod 755 /usr/local/sbin/$name"
  ssh-keygen -q -t ed25519 -N '' -C "$svc-ci-deploy" -f "$tmp/$svc"
  line="restrict,command=\"/usr/local/sbin/$name${args:+ $args}\" $(cat "$tmp/$svc.pub")"
  # replace any earlier key for this service, keep everything else
  "${SSH[@]}" "root@$host" "set -e; f=/root/.ssh/authorized_keys; cp -a \$f \$f.bak-\$(date +%Y%m%d); grep -v ' $svc-ci-deploy\$' \$f > \$f.new || true; printf '%s\n' '$line' >> \$f.new; chmod 600 \$f.new; mv \$f.new \$f"
  gh secret set DEPLOY_SSH_KEY -R "$OWNER/$repo" < "$tmp/$svc"
  shred -u "$tmp/$svc"
  echo "   ok: receiver installed, key authorized, DEPLOY_SSH_KEY set on $OWNER/$repo"
done
