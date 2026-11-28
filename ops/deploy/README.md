# Auto-deploy for the Vultr services

Push to a repo's main branch -> GitHub Actions builds -> the result is streamed over SSH to the box -> a **receiver**
installs it, health-checks it, and **rolls back** if the check fails (the run goes red). No GCP, no registry login on the boxes.

Every key is a **forced command** (`restrict,command="..."` in root's `authorized_keys`): it can only run its own receiver,
and the receiver only accepts that service's files. GFD has the same pattern with its own receiver
(`GoblinFoxDragon/ops/deploy/`).

| Service (repo) | Box | Receiver | What ships | Health check |
|---|---|---|---|---|
| IDUNA (IDUNA) | IDUNA box 137.220.58.252 | `iduna-receive.sh` | an image tag (release.yml pushed `ghcr.io/emilyspringerton/iduna:<sha>`); compose repointed | container healthcheck, 120 s |
| okemily.com (OKEMILY) | IDUNA box | `static-receive.sh okemily` | site tarball -> `/srv/iduna/var/www` (overlay; IDUNA's generated blog/tyler/prompt-o-verse kept) | `:8090/` answers 200 |
| wotan.okemily.com (WOTAN) | WOTAN box 64.177.15.59 | `static-receive.sh wotan` | site tarball + fresh DEADWEIGHT web build -> `/var/www/wotan` | nginx answers 200 |
| SHANKPIT | game box play.okemily.com | `game-receive.sh shankpit` | `bin/shank_server`, `bin/emily-bot` | 3 units active, no self-restarts, ~30 s |
| shankpit-460 | game box | `game-receive.sh shankpit460` | `bin/shank_server`, `bin/emily-bot`, `maps/v0_shankpit.map` | 2 units |
| REDGARDEN | game box | `game-receive.sh redgarden` | matchmaker, arena server, arena bot (static) | 7 units |
| D2 (DEADWEIGHT_2) | game box | `game-receive.sh d2` | `bin/dw2_server`, `bin/dw2_bot` | 2 units |
| GoblinFoxDragon | game box | `gfd-receive` (its own repo) | mud, server-go, data | telnet/web/worldapi ports |

Game receivers only accept the files listed for that game (ELF magic checked on binaries), never touch `var/`, and keep the
previous release in `.prev/`. The receivers live in `/usr/local/sbin/emily-*-receive` on the boxes. **CI does not update
them**: after you change a receiver here, run `setup.sh <service>` (or `scp` it) again.

## Status

2026-11-28: all of the above are wired (receivers installed, per-service key authorized, `DEPLOY_SSH_KEY` secret set on each
repo) and each service's workflow was run from a push.

## Setup / rotate a key / rebuild a box

```bash
ROOT_KEY=~/path/to/root_ed25519 GH_TOKEN=<token that can write repo secrets> ./setup.sh          # all services
./setup.sh d2 okemily                                                                           # some
```

It installs the receiver, makes a fresh ed25519 key, replaces that service's line in `authorized_keys`, stores the private key
as the repo secret `DEPLOY_SSH_KEY` and shreds the local copy. Safe to re-run (that is how you rotate).

The workflows pin each box's SSH host key. If a box is rebuilt, update the key in the workflow or set the repo variable
`DEPLOY_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <host>`), then re-run `setup.sh`.

## Manual rollback

Games: `ssh root@play.okemily.com 'cd /srv/games/<game> && cp -a .prev/bin/. bin/ && systemctl restart <units>'`.
IDUNA: `ssh root@137.220.58.252 'cp /opt/iduna/compose.yml.prev /opt/iduna/compose.yml && cd /opt/iduna && docker compose up -d iduna'`.
Static: the previous tree is `/var/www/.prev-wotan/tree` (WOTAN box) or `/srv/iduna/var/.prev-okemily/` (IDUNA box).
