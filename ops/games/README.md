# The WOTAN game box — play.okemily.com

One Vultr VM for the game servers, their bot pools and (later) the bot models (founder 2026-11-26: "a slightly beefier
box ... all of the game servers and match making and ai models for multiplayer ... shankpit-460 first ... then GFD").

**Live since 2026-11-26:** `ord`, `vhp-4c-8gb-amd` ($48/month, 4 vCPU / 8 GB), instance
`bf519d2f-8a03-43a9-ae7f-1bd7ce34225d`, reserved IPv4 **144.202.54.81** (`4503e8d5-c911-41fc-978a-d7ccb0868f06`, kept if the
instance is rebuilt). `play.okemily.com` is **DNS only** (grey cloud): game traffic is UDP and Cloudflare's proxy carries
only HTTP. Firewall (ufw): 22/tcp, 6969/udp.

Web matchmaking does **not** run here: the browser games (shankpit-460, Bedrock Racers, ...) match on IDUNA
(`/api/v1/shankpit460/play`) through wotan.okemily.com's `/api/` proxy. This box is for native servers.

## What runs

| Unit | What | Port |
|---|---|---|
| `shankpit460-server` | shankpit-460 C server (`apps/server/src/main.c`, static build), server-authoritative FFA | 6969/udp |
| `shankpit460-bots` | 9 `emily-bot` fill players (`apps2/emily-bot`), so a human lands in a 10-player match | — |

Both run as `wotan-games` under `/srv/games/<game>`, sandboxed (`ProtectSystem=strict`). Secrets live in
`/etc/games/<game>.env` (root, 600), read by systemd. `SHANKPIT_TICKET_SECRET` there must equal IDUNA's
(`/etc/iduna/iduna.env` on the IDUNA box); the copy on the ops box is `~/secrets/shankpit-ticket-secret`.

## Buy / rebuild

```bash
GAMES_SSH_KEY_IDS=<vultr key ids> ops/games/provision.sh                      # prints the live price, buys nothing
GAMES_CONFIRM_MONTHLY_USD=48 GAMES_SSH_KEY_IDS=<ids> ops/games/provision.sh  # buys, attaches the reserved IP, points DNS
```

## Deploy shankpit-460

```bash
cd shankpit-460
gcc -O2 -Wall -D_REENTRANT -Ipackages/common -Ipackages/simulation -Ipackages/render -Ipackages/audio \
    apps/server/src/main.c -o bin/shank_server -lm -static
(cd apps2/emily-bot && CGO_ENABLED=0 GOWORK=off go build -o ../../bin/emily-bot .)
scp bin/shank_server bin/emily-bot root@play.okemily.com:/srv/games/shankpit-460/bin/
scp maps/v0_shankpit.map root@play.okemily.com:/srv/games/shankpit-460/maps/
scp WOTAN/ops/games/systemd/*.service root@play.okemily.com:/etc/systemd/system/
ssh root@play.okemily.com 'systemctl daemon-reload && systemctl restart shankpit460-server shankpit460-bots'
```

Check from anywhere (one bot over the internet; PASS = welcomed, snapshots, damage both ways, respawns):

```bash
SHANKPIT_TICKET_SECRET=$(cat ~/secrets/shankpit-ticket-secret) bin/emily-bot -host play.okemily.com -bots 1 -duration 20s
```

Verified 2026-11-26: PASS from the ops box; a wrong secret is refused (never welcomed).

## Not done

- **Native clients can't play yet.** Released clients aim at `okemily.com:6969` (now behind Cloudflare) and sign their
  own ticket with the secret shipped in `PLAY.bat`, which would publish the new secret. Needs a client build that
  defaults to `play.okemily.com` and fetches a ticket from IDUNA (`POST /api/v1/shankpit/ticket`) instead.
- Match results: the server reports to IDUNA as an M2M agent (`IDUNA_BASE_URL` / `IDUNA_AGENT_NAME` / `_SECRET`); no
  agent yet, so results are not recorded.
- GFD, DEADWEIGHT, D2, REDGARDEN and the bot models: next, one at a time.
- No backups (the box holds no state yet).
