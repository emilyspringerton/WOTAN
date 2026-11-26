# The WOTAN game box — play.okemily.com

One Vultr VM for the game servers, their bot pools and (later) the bot models (founder 2026-11-26: "a slightly beefier
box ... all of the game servers and match making and ai models for multiplayer ... shankpit-460 first ... then GFD").

**Live since 2026-11-26:** `ord`, `vhp-4c-8gb-amd` ($48/month, 4 vCPU / 8 GB), instance
`bf519d2f-8a03-43a9-ae7f-1bd7ce34225d`, reserved IPv4 **144.202.54.81** (`4503e8d5-c911-41fc-978a-d7ccb0868f06`, kept if the
instance is rebuilt). `play.okemily.com` is **DNS only** (grey cloud): game traffic is UDP and Cloudflare's proxy carries
only HTTP. Firewall (ufw): 22/tcp, 6969/udp (shankpit-460), 2323/tcp + 2222/tcp + 6970/udp (GFD), 8443/tcp from 64.177.15.59 only.

Web matchmaking does **not** run here: the browser games (shankpit-460, Bedrock Racers, ...) match on IDUNA
(`/api/v1/shankpit460/play`) through wotan.okemily.com's `/api/` proxy. This box is for native servers.

## What runs

| Unit | What | Port |
|---|---|---|
| `shankpit460-server` | shankpit-460 C server (`apps/server/src/main.c`, static build), server-authoritative FFA | 6969/udp |
| `shankpit460-bots` | 9 `emily-bot` fill players (`apps2/emily-bot`), so a human lands in a 10-player match | — |
| `gfd-mud` | GoblinFoxDragon MUD (`apps2/mud`): telnet, ssh, the browser WebSocket, world-events API | 2323/tcp, 2222/tcp public; 8480, 7171 local |
| `gfd-server-go` | GoblinFoxDragon world backend (`apps2/server-go`) | 6970/udp public; 7070, 7071 local |
| `redgarden-stable-mm` + `-bots` | REDGARDEN stable 10v10 matchmaker + 19-bot pool (GFD Battlegrounds, WOTAN web) | 8778/udp, games 8300-8319/udp |
| `redgarden-rnd-mm` + `-bots` | REDGARDEN R&D 10v10 matchmaker + 19-bot pool (WOTAN web, native `--queue`) | 7778/udp, games 7300-7319/udp |
| `redgarden-rnd-players-mm` | REDGARDEN 1v1, humans only | 7779/udp, games 7600-7609/udp |
| `redgarden-rnd-3v3-mm` + `-bots` | REDGARDEN 3v3 + 5-bot pool (not used by the web gateway: the arena splits teams at slot 10) | 7780/udp, games 7400-7409/udp |
| nginx | `nginx/games-ws.conf`: TLS door for browser game sockets, `/GFD/ws` -> 127.0.0.1:8480 | 8443/tcp, **WOTAN box only** |

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

## GFD

Browser path: `wss://wotan.okemily.com/GFD/ws` -> Cloudflare -> WOTAN nginx -> `https://play.okemily.com:8443` (Cloudflare
Origin CA cert, `~/secrets/games-origin/`, verified by WOTAN against Cloudflare's origin ECC root) -> MUD :8480. WOTAN
sends `X-Forwarded-For: $http_cf_connecting_ip`, this nginx appends WOTAN's address and the MUD runs `-web-trust-xff`,
so its per-IP session caps see the player. The MUD validates IDUNA tokens against `iam.okemily.com`'s JWKS and calls
IDUNA as agent `DRAGONSNSHIT-MUD` (`/etc/games/gfd.env`; copy at `~/secrets/gfd-mud-agent.env`, rotated from the Back
Office as HOUSE). Native: `telnet play.okemily.com 2323` (guest) and `ssh -p 2222 play.okemily.com`.

```bash
cd GoblinFoxDragon
GOWORK=off CGO_ENABLED=0 go build -o bin/mud ./apps2/mud && GOWORK=off CGO_ENABLED=0 go build -o bin/server-go ./apps2/server-go
scp bin/mud bin/server-go root@play.okemily.com:/srv/games/gfd/bin/
tar cz data ops/genesis | ssh root@play.okemily.com 'tar xz -C /srv/games/gfd'
ssh root@play.okemily.com 'systemctl restart gfd-server-go gfd-mud'
```

State is `/srv/games/gfd/var` (mud-chars.json, mud-player-ids.json, the ssh host key); characters themselves live in
IDUNA. Verified 2026-11-26 (GoblinFoxDragon 5dcfe7d): a real IDUNA token through wotan.okemily.com reaches the name-claim
prompt; the agent's character lookup answers (404 = no character yet, not 401/403); telnet banner and ssh host key
answer on play.okemily.com; 8443 is unreachable from outside. A smoke identity `gfd-smoke-20261126@example.com` exists on
IDUNA (credentials `~/secrets/gfd-smoke-identity.json`); no character was claimed for it.

## REDGARDEN

Same layout as the old `EMILY/gitops/specs/redgarden-{stable,rnd}.pod` (same ports and args), built static from the
REDGARDEN repo (the matchmaker, arena server and arena bot lines of `scripts/build.sh` plus `-static`). One working
directory per pool (`/srv/games/redgarden/{stable,rnd,rnd3v3}`, each with `build -> ../bin` and `scripts/run_bot_pool.sh`)
so pools with the same bot indices don't share log files. The matchmaker spawns `red_garden_arena_server` per match;
match logs land in `<dir>/var/matches/`. `REDGARDEN_TICKET_SECRET` (`/etc/games/redgarden.env`, copy
`~/secrets/redgarden-ticket-secret`) is shared with IDUNA, which also has
`REDGARDEN_POOLS=rnd-10v10|10v10|rnd.rg.okemily.com:7778|20;stable-10v10|10v10|rg.okemily.com:8778|20` for its web gateway.
DNS `rg`, `rnd.rg`, `gfd.rg`, `shankpit.rg` and `*.rg` now point here, DNS only (old records in `~/secrets/rg-dns-rollback.json`).

```bash
cd REDGARDEN   # the three server binaries, static
gcc -std=c99 -D_DEFAULT_SOURCE -O2 -Wall -Wextra -Ipackages -static ...   # copy the matchmaker / arena_server / arena_bot lines of scripts/build.sh
scp build/red_garden_{matchmaker,arena_server,arena_bot} root@play.okemily.com:/srv/games/redgarden/bin/
ssh root@play.okemily.com 'systemctl restart redgarden-stable-mm redgarden-stable-bots redgarden-rnd-mm redgarden-rnd-bots redgarden-rnd-players-mm redgarden-rnd-3v3-mm redgarden-rnd-3v3-bots'
```

Verified 2026-11-26 (REDGARDEN 1f2f02c): a REDGARDEN guest through `wss://wotan.okemily.com/api/v1/redgarden/play`
was seated in a 20-player 10v10 with the 19 bots and got snapshots at ~20 Hz; two arena bots from the ops box played a
whole 1v1 on `144.202.54.81:7779` and requeued; all pools refill (19/20, 19/20, 5/6). GFD's `battlegrounds` command
now names this box (`REDGARDEN_MATCHMAKER_HOST=144.202.54.81` in `/etc/games/gfd.env`).

**Native clients take an IP, not a name:** `apps/arena` and `apps/arena_bot` use `inet_addr`, so `--queue
rnd.rg.okemily.com` (what CI's PLAY.bat says) never resolves. Use `RedGarden.exe --queue 144.202.54.81 --account`
(`--matchmaker-port 8778` for stable). `--account` gets a real ticket from IDUNA; the CI PLAY.bat instead self-mints with
a test secret that this box does not accept (a public secret would let anyone pose as any player).

## Not done

- **Native clients can't play yet.** Released clients aim at `okemily.com:6969` (now behind Cloudflare) and sign their
  own ticket with the secret shipped in `PLAY.bat`, which would publish the new secret. Needs a client build that
  defaults to `play.okemily.com` and fetches a ticket from IDUNA (`POST /api/v1/shankpit/ticket`) instead.
- Match results: the server reports to IDUNA as an M2M agent (`IDUNA_BASE_URL` / `IDUNA_AGENT_NAME` / `_SECRET`); no
  agent yet, so results are not recorded.
- GFD: not played through in a real browser yet; the public ssh is on 2222, not 22 (22 is the box's admin ssh).
- DEADWEIGHT, D2, REDGARDEN and the bot models: next, one at a time.
- WOTAN's origin also answers when reached by IP (not only via Cloudflare), so a direct client could forge CF-Connecting-IP; locking 443 to Cloudflare's ranges would close that.
- No backups: GFD's `var/` is now state worth keeping.
