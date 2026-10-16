# WOTAN

**Deployed (2026-10-04): GKE.** `wotan.okemily.com` is served by a static nginx pod (`ops/docker/wotan.Dockerfile`, `scripts/build-image.sh`) behind the edge Gateway; `/api/` goes to in-cluster IDUNA and `/DEADWEIGHT/ws` to the DEADWEIGHT bridge. `ops/nginx-wotan.conf` is the retired box config.


`wotan.okemily.com` — the online social tournament site for EINHORN_INDUSTRIAL, and (2026-09-24) the real front door:
`index.html` no longer defers to `OKEMILY/tournaments.html`, it's the other way around now (that page keeps its own
distinct live content — REDGARDEN leaderboard, hero stats, GFD Battlegrounds demo, mailing list — and links forward to
here). Plain static HTML/CSS/JS, no build step. See `CLAUDE.md` for status and related docs.

**Play GoblinFoxDragon in the browser (2026-10-16):** `/GFD/` is a web terminal for the GFD MUD -- PARENA compiled to wasm for the terminal, IDUNA SSO for login, the MUD's own name-creation flow for new characters. It has its own tab in the top menu; the Hat Store links straight to it when an account has no character yet. See `CLAUDE.md`'s `GFD/` entry for architecture and honest limits.

**Look**: BRAWLPIT "neon brutalist" art direction (2026-09-24) — near-black violet background,
violet primary accent, a gold secondary accent, one shared stylesheet (`css/wotan-theme.css`)
across every page. Dark-only by design.

## Hearthstone decks (2026-10-09)

**`/hearthstone/` — shared Hearthstone decks + basic socials**, a second game section next to DEADWEIGHT, in IDUNA's classic cream/gold
style (the DEADWEIGHT pages stay neon-dark, so it's obvious which game you're in; a DEADWEIGHT | HEARTHSTONE switch sits in the shared topbar).
Tabs: **Decks** (browse/search/filter by class, format, sort), **Submit** (paste a deck export or a bare deck code; live parse preview;
publish), **Feed** (global + following wall feed), **Players**; plus deck detail (copy code, mana curve, like, comments) and profile pages
(handle + short bio, wall, their decks, follow). Reading is open to everyone; posting needs an IDUNA sign-in and a one-time handle claim.
Backed by IDUNA's new `/api/v1/hs/*` (see `HEARTHSTONE_NORTHSTAR.md` for the API contract, data model and the honest scope).
**Limits:** card names come only from the pasted text — a bare code shows `Card #id` placeholders; there is no card art or card database yet
(`hs_cards` exists, empty — the founder's explicit last step). Verified with a headless-Chromium run of these pages against the real IDUNA
binary; not verified on touch devices or the production SSO round trip.

**One sign-in control**: every page now uses the shared topbar (`js/wotan-nav.js`) with a single account widget — "Sign in" when signed out,
"@handle ▾" when signed in. Pages no longer render their own Sign-in buttons, and `iam.okemily.com` offers "Continue as <name>" to a browser that
already signed in.

## What is live

- **`/decks.html` — DEADWEIGHT Draft Decks** (open to everyone, no account): every deck drafted in DEADWEIGHT's draft
  queue with its win/loss/draw record, filterable (players / bots, min games, player name, "only decks with this
  card"), sortable (sample-size-adjusted "Best", raw win rate, most games, newest), each deck's cards as chips with a
  **big card tooltip on hover** (tap on phones; keyboard focus works too) and an expandable full-deck card grid; a
  **Cards** tab with every card's record across all decks. Deep links: `/decks.html#deck-451`, filters live in the URL.
- **`/matches.html` — DEADWEIGHT Matches** (S547, 2026-09-25, open to everyone, no account): a real
  leaderboard (rating/W-L-D/matches, from IDUNA's live `game_player_stats`), a recent-matches list
  (filterable by player/mode), and a genuine round-by-round **replay viewer** — Prev/Next/Play/Last
  controls, a round slider, a full round log — that steps through every hand of a real match, cards
  shown as an emoji by kind/keyword (⚔️ Offense, 🛡️ Defense, 🦅 Lock/Scan/Siphon/Sabotage/Flank for
  Operations). This is a real engine replay, not a reconstruction guess: a new tool
  (`DEADWEIGHT/tools/replay_dump.c`) replays the match through DEADWEIGHT's actual `core/match.c`,
  verified 300/300 clean against the most recent live matches. See `NORTHSTAR.md` for the full
  account (why DEADWEIGHT over D2/other games, what's deferred).
- **`/shankpit.html` — SHANKPIT Leaderboard** (S550, 2026-09-25, open to everyone, no account):
  a basic kills/deaths/K-D/sessions leaderboard, reading a new public
  `GET /api/v1/shankpit/leaderboard` off SHANKPIT's already-existing per-match write path
  (`players.kills`/`deaths`/`sessions`, gated by `shankpit.match.write`). "If you have an IDUNA
  account you have a SHANKPIT account" — no new account type needed, only this read. SHANKPIT and
  BIG_O premium keys are named as a real future phase, not built here.
- **`/BRAWLPIT/` — BRAWLPIT, playable in the browser** (2026-10-16). The whole game -- simulation, CPU
  fighters, menus, software renderer -- is one WebAssembly module compiled from PARENA
  (`PARENA/stdlib/brawlpit/`): no malloc, no imports, and its physics is bit-identical to BRAWLPIT's C engine
  (`PARENA/tests/brawlpit_parity_*`). Keyboard or gamepad, vs CPU / local 2P / free-for-all / practice; the hat
  you equipped in the store (or drew in the Hat Studio) is on your fighter in every match by default, and a status line says
  what it found (signed out, nothing equipped, expired sign-in). The page's only JavaScript is
  `BRAWLPIT/bp-host.js`, which is *generated* from PARENA (PARENA -> TypeScript -> JS) and does nothing but
  instantiate the wasm, blit its framebuffer, forward input and decode images. `brawlpit.wasm`, `bp-host.js`
  and `sprites.png` are committed (the deploy image is built from git-tracked files): regenerate with
  `scripts/build-brawlpit.sh` (wasm + host, needs the sibling PARENA checkout, node and the LLVM toolchain) and
  `python3 scripts/build-brawlpit-sprites.py` (the portrait atlas). `scripts/brawlpit-browser-test.mjs` drives
  the real page in headless Chromium. **Honest limits:** verified in Node and headless Chromium only (not
  Firefox/Safari/phones; no touch controls); the gamepad path was exercised through a Gamepad API shim, not a
  physical controller; no audio; local play only (no online matches).
- **`/shankpit-460/` — shankpit-460, playable in the browser, with human matchmaking** (2026-10-16). SHANKPIT's competitive
  fork (the brand name is lower case and hyphenated) as a small, quick arena FFA shooter. The whole game -- the physics and weapons
  (ported from shankpit-460's C engine, checked against it tick for tick), a software 3D renderer, the bots, the HUD and
  screens, the matchmaking protocol client -- is one WebAssembly module compiled from PARENA (`PARENA/stdlib/shankpit460/`):
  no malloc, no imports. The page's only JavaScript is `shankpit-460/sp-host.js`, *generated* from PARENA like BRAWLPIT's.
  **The flow:** press PLAY and you are in a bot match straight away with SEARCHING FOR MATCH on screen; if another human is
  searching you are both moved into a free-for-all lobby (human matches are first to 16 kills or six minutes; more can join
  the countdown and a match still in its first 4:30 takes late arrivals); the match ends with the standings and a REQUEUE
  button. Human matches run through IDUNA's `/api/v1/shankpit460/play` WebSocket (a referee that owns the clock, health,
  score and respawns and checks every claimed hit); a signed-in player's name is their IDUNA game-player name, anyone else is
  a guest. Rebuild with `scripts/build-shankpit460.sh` (needs the sibling PARENA checkout, node and the LLVM toolchain) and
  commit the outputs. Tests: `scripts/shankpit460-net-test.mjs` (two real engines against the real IDUNA binary) and
  `scripts/shankpit460-browser-test.mjs` (real headless Chromium, with screenshots). **Honest limits:** Node and headless
  Chromium only (not Firefox/Safari/phones; no touch controls); the gamepad and the sound were not exercised by a person;
  the referee stops impossible hits, walls and speed hacks but not aimbots or wallhacks. **Stats and the bot league are the
  next pass** -- nothing is persisted yet.
- `/store.html` — the BRAWLPIT hat store. Login is a real redirect to IDUNA's own hosted SSO
  page (`iam.okemily.com`) — this page has no password field of its own.
- **`/profile.html` — public DEADWEIGHT player profiles** (no login): look up any player by
  Player ID, see rating/W-L-D/matches/friend count.
- **`/friends.html` — DEADWEIGHT friends & duels** (S536/S537, 2026-09-24): log in with a
  DEADWEIGHT account (email/password, set via the client's own "link email" flow — a guest-only
  account can't sign in here) to send/accept/decline friend requests, list friends, remove a
  friend, and challenge a friend to a friendly-challenge duel. This is a **separate credential
  system from the Hat Store's IDUNA login** — DEADWEIGHT accounts and IDUNA platform accounts are
  different identities (`IDUNA/internal/http/handlers/game_online.go`'s per-game `players` table
  vs. IDUNA's own `users` table). Honest limit: no player-search-by-name yet, so adding a friend
  means sharing your Player ID directly. **Duel Phase 2/3 (2026-09-24)**: an accepted duel now
  carries a live, short-lived (15-min) `match_token` that the native SDL2 and browser DEADWEIGHT
  clients read directly from IDUNA and use to queue for that specific opponent — WOTAN has no game
  client of its own to launch a match into, so it surfaces the same token as a monospace field with
  a **Copy token** button (for `dw_client --match-token`) plus a note that either real client
  already shows its own Play button for the same duel. Live-verified with a real headless Chrome
  against the real `friends.html`: the token box + Copy button render correctly for an accepted
  duel, and a real (CDP-synthesized, trusted) click resolves `navigator.clipboard.writeText()`.
  **Live-tested end to end against the real deployed API (2026-09-24)**, not just a fake fixture:
  two real throwaway DEADWEIGHT accounts registered/upgraded/logged in, a real friend request
  sent/accepted, a real duel challenged/accepted, and a real `match_token` minted — all through
  `wotan.okemily.com`'s own live `/api/` proxy to the actually-running `iduna.service` (rebuilt
  and restarted the same session to carry these routes for the first time).
- `/` — landing page, and now genuinely the front door (2026-09-24): links every live page above,
  no more "under construction" framing.
- **`/DEADWEIGHT/` — the actual DEADWEIGHT game client** (2026-09-28, founder real-time: "WASM
  version needs to work with IDUNA sso seamlessly wotan.okemily.com/DEADWEIGHT for the client"): a
  real browser client — not a stats page like the others above — built on a native
  `wasm32-unknown-unknown` protocol codec (no Emscripten) and DEADWEIGHT's own hand-written TS
  rendering/networking. Signs in via the same `iam.okemily.com` SSO redirect as `store.html`/
  `friends.html`, exchanged for a real DEADWEIGHT player token
  (`POST /api/v1/games/deadweight/sso-exchange`). A plain copy of `DEADWEIGHT/web/`'s own built
  output (`DEADWEIGHT/docs/NATIVE_WASM_CLIENT_NORTHSTAR.md` has the full build/verification
  account) — same no-build-step convention as every other page here, just a directory of files
  instead of one HTML file. Linked from every page's nav ("Play"). **Live**: deployed via
  `~/wotan-deploy.sh` and curl-verified against the real domain — `https://wotan.okemily.com/
  DEADWEIGHT/` and its JS/wasm all return 200. **Real, honest gap**: it can't play a match yet.
  DEADWEIGHT's `dw-ws-bridge.service` is installed and running for real
  (`~/sudo-queue/94-deadweight-wotan-ws-bridge.sh` was run), but `ops/nginx-wotan.conf`'s
  `/DEADWEIGHT/ws` location still 404s live — `94`'s nginx-edit script anchored the new location
  on "the last closing brace in the file," which landed it inside certbot's own appended
  port-80-redirect server block instead of the real HTTPS-serving one (that block's own bare
  `return 301` swallows every request before any location inside it is reached — diagnosed from
  behavioral evidence, not a direct read of the root-owned live file). Fix queued:
  `~/sudo-queue/95-fix-deadweight-ws-nginx-location.sh` (idempotent, anchored to the already-live
  `/api/` location instead, unit-tested against a synthetic reproduction of the exact bug) — still
  needs the same real sudo this sandbox doesn't have.

## How the deck browser gets its data

- `GET /api/v1/games/deadweight/decks`, `/decks/{id}`, `/card-stats` — public, read-only, rate-limited endpoints in IDUNA
  (`internal/deckstats`, `internal/http/handlers/deck_stats.go`) that tail `dw_server`'s `decks.ndjson`
  (`DEADWEIGHT_DECK_LOG`, default `/home/fatbaby/DEADWEIGHT/var/matches/decks.ndjson`). The nginx `/api/` proxy
  (`ops/nginx-wotan.conf`) forwards them, so the page is same-origin.
- `data/cards.json` — the 105-card catalog (kind, keyword, cost, power, text) for the tooltips, **generated** from DEADWEIGHT's rules and card text:
  `cd DEADWEIGHT && scripts/export_cards.sh` (re-run after any card change).

Decks drafted before the 2026-09-19 Offense/Operations/Defense retheme were archived server-side (`decks.pre-retheme.ndjson`) and are not shown.

## How the matches/replay page gets its data

- `GET /api/v1/games/deadweight/matches`, `/matches/{id}`, `/matches/{id}/replay` — public,
  read-only, rate-limited endpoints in IDUNA (`internal/matchlog`,
  `internal/http/handlers/match_replay.go`) that tail `dw_server`'s `matches.ndjson` (sibling log
  to `decks.ndjson` above, `DEADWEIGHT_MATCH_LOG`, default
  `/home/fatbaby/.local/var/deadweight/matches/matches.ndjson`), keeping the most recent 2000
  matches in memory. `/replay` shells out to `dw_replay_dump` (built from
  `DEADWEIGHT/tools/replay_dump.c`, installed at `~/.local/opt/deadweight/bin/dw_replay_dump`),
  which replays the match through DEADWEIGHT's real match core and returns a full round-by-round
  JSON trace. Same `/api/` proxy as the deck browser above.
- `GET /api/v1/games/deadweight/leaderboard` — already-existing, already-public per-player
  aggregate stats (`IDUNA/internal/http/handlers/game_online.go`), reused as-is for the
  Leaderboard tab.
- `data/cards.json` (same file the deck browser uses) also drives the replay viewer's per-card
  emoji (kind/keyword → emoji, see `NORTHSTAR.md`).

## Deploy

`~/wotan-deploy.sh` (rsync to `/var/www/wotan`). Accounts (tournaments, deck tools) are planned; the header's "Sign in"
button is deliberately disabled until they exist.

## Hearthstone live deck tracker (2026-10-10)
`/hearthstone/tracker.html` shows the cards left in the deck you are playing, live and **private to
your IDUNA account**. How it works: the page mints an upload-scoped token for your own identity
(`POST /api/v1/hs/live/token`, 12 h, can only POST `live/lines`) and shows a one-line PowerShell
command; the script tails your Hearthstone `Logs\Hearthstone_*\Decks.log` + `Power.log` (read-only)
and streams new lines to IDUNA, which runs the HRIP PARENA tracker over the current game and serves
the result to that same account only (`GET /api/v1/hs/live/state`). The queued deck comes from
Hearthstone's own `Decks.log` ("Finding Game With Deck" + deck code), so no setup per game.
Status: server side + page live and verified (build, privacy, counts); the PowerShell uplink has
been dry-run on a real Windows PC against the live server but not yet used for a full real game.
Deploy: pushing to `main` builds `wotan:<sha>` (`.github/workflows/deploy.yml`) and the in-cluster
gitops-autodeploy cron rolls it out through the PARENA-rendered manifests (`WOTAN_TAG`).

## Clubs (Phase 2) — built end to end, IDUNA backend + Back Office live in code (2026-10-12)
`/clubs/` is the group layer over Hearthstone: a directory with search and sort, a public tier-shaped
club page (`c.html?s=slug`: roster with role badges and an explicit "unverified" mark on self-declared
ranks, featured decks), a members workspace (`w.html`: roster wall, strategy feed with post/comment/pin,
win-rate matrix and contributor board), an admin console (`manage.html`: invites, join requests,
role changes, privacy tier with Go dark/Reveal, exclusive toggle, join policy, branding, featured decks,
audit log, ownership transfer, type-the-slug delete), invite redemption (`join.html#token`, token
stripped from the address bar on load) and `settings.html` (my clubs, tracker sync target, roster/badge
toggles, self-declared rank). Club badges also appear on `hearthstone/u.html` profiles.
- **Status, honestly**: the front end is written to the contract in `CLUBS_NORTHSTAR.md` §7.4 and the IDUNA
  backend now exists to it (`IDUNA` `1dbc354` core, `ccc14ca` telemetry/rank/analytics, `db8ca8d` Back Office
  `/admin/clubs`, `9078894` shared-auth hardening). Backend is proven by Go handler tests on SQLite, not yet
  deployed; **this static site has never been run against that API in a browser**. Deploy needs IDUNA rebuilt
  with migration `202610120001_wotan_clubs.sql`.
- **What is verified**: `node scripts/clubs-affordance-test.js` (plain node, no deps) table-tests the
  permission -> affordance rules in `js/club-perms.js` and runs the real page scripts inside a tiny DOM
  and fetch stub: per-role console contents, disabled-with-reason buttons, XSS-safe feed rendering,
  graceful analytics 404, join-token handling. It is not a browser.
- **Not verified**: real-browser rendering, layout, touch behaviour, or the live API round trip (no
  headless Chromium on the build machine). Verified legend rank has no data source yet; ranks always show as unverified.
- Files: `clubs/*.html`, `js/club-{api,perms,ui,badges}.js`, `js/club-page-*.js`, `css/wotan-clubs.css`.

## Linked accounts, upload keys, verification gate (Phase 2b, chunk ID-B, 2026-10-12) — front end only
`/account/` is the identity settings page (account menu: "Account & linked accounts"): **linked accounts**
(Battle.net, one per Battle.net account you play on; Google; Twitch; unlink with disabled-with-reason guards driven
by the server's `can_unlink`), **privacy** toggles (show Twitch name, show BattleTag; both off by default) and
**tracker upload keys** (create, one-time reveal with copy button, both install one-liners, revoke, accepted and
"rejected: BattleTag not linked" counters with the explanation). A **"Competitive Verification Required"** modal
(`js/identity-gate.js`) gates the tracker install-command copy and club creation when no Battle.net identity is linked,
with a "Continue for now" path and banner during the 30-day grace window. Club rosters show the Twitch name (with a
Twitch mark) only for players who opted in, and rank badges say "Leaderboard-matched" instead of "verified".
- **Contract**: coded to `IDENTITY_NORTHSTAR.md` §4/§8; every endpoint path lives in `js/identity-api.js` only.
- **Status, honestly**: the IDUNA backend (chunk ID-A) was being built in parallel and is **not deployed**; Battle.net
  and Twitch OAuth apps are not registered (human step, IDENT-04). Twitch is both a link door and, since IDUNA `50c221d`,
  a login door on the hosted SSO page (zero scopes; button hidden until `TWITCH_CLIENT_ID/SECRET` are set). This static front end has **never run in a
  browser or against the real API**. Verified only by `node scripts/identity-affordance-test.js` (plain node, DOM and
  fetch stub: rendering, gating, one-time reveal, API calls made, XSS-safe text, wiring) plus the unchanged clubs test.
- **Assumption the backend must meet**: link starts are full-page navigations that cannot carry an Authorization header,
  so the front end passes the session token as `access_token=` on the start URL (`IDAPI.CONFIG.linkTokenParam`), and
  expects the callback to redirect back to `redirect_uri` with `?linked=<provider>` or `?link_error=<code>`.
- **Uplink**: the PowerShell uplink is served by IDUNA (`hs_live.go`), not from this repo. The `-Key`/`-SaveKey`
  (DPAPI) key-exchange change is delivered as a patch in `HRIP/tracker/uplink/uplink-key.patch`, **not applied and not
  run** (no PowerShell here).
- Files: `account/index.html`, `js/identity-{api,gate,page-account}.js`, `css/wotan-identity.css`, `scripts/identity-affordance-test.js`.
  (2026-10-16: the page also opens with the account overview below -- `js/account-overview.js`.)

## Redeem a code, and the account overview (2026-10-16)
Founder real-time: "we need an affordance under the user profile for redeem a code ... it should enable founder mode in
DEADWEIGHT web ... make it nice when a code is redeemed it should say what it did" -- after Battle.net's Redeem a Code
page, its account overview and its account menu.
- **Where**: the signed-in account menu has **Redeem a code**; **`/redeem/`** is the page (an `ENTER CODE` box, one button,
  the answer under it, a help section); **`/account/`** now opens with an overview above the identity sections: a compact
  Redeem card, **Games** (per-game status: Founder, ticket balance, "Playing as ...", a link into the game) and **Recent
  redemptions** (date, what it gave, the code, Complete). Account pages share a small `acct` nav skin (tabs
  Account | Redeem a code; no Hearthstone tabs, no theme picker). The DEADWEIGHT web client links here too.
- **What it does**: calls IDUNA's `POST /api/v1/redeem` with your SSO session. The server works out which game the code is
  for and which player you play it as (the rule `sso-exchange` uses), so a code lands on the account DEADWEIGHT signs in as.
  A **Founder code** gives permanent Founder status and lifts Draft tickets to 9,999 (effectively unlimited); a ticket pack
  adds tickets. **It says what it did**: "DEADWEIGHT Founder unlocked -- Founder status is now on your account, for good.
  Draft tickets: 25 -> 9,999, effectively unlimited", with stat tiles and the account it was applied to; "+10 DEADWEIGHT
  tickets -- Draft tickets: 9,999 -> 10,009 (+10)"; an account that already was a Founder is told "Nothing new this time ... it
  has been used up". Failures say why: not valid or already used (those two read the same on purpose), wrong shape, the
  account belongs to another game, sign-in expired, offline.
- **Entry is forgiving**: upper-cases and groups five by five as you type (a dash only once a character follows it, so
  Backspace works), accepts a paste with spaces, dashes, no dashes, or inside a sentence, and never truncates a paste (there is
  deliberately no `maxlength`: browsers trim pasted text to it before any handler runs); Enter on an incomplete code says
  what a code looks like. Guests are told (help text, and in the game) to Save progress with IDUNA first.
- **Files**: `redeem/index.html`, `js/redeem-{api,widget,page}.js`, `js/account-overview.js`, `css/wotan-redeem.css`.
  `js/redeem-api.js` holds every API path and every word of the answer; the widget is shared by the page and the overview card.
  Also: the menu links' colour on `body.hs` pages (they were indigo on the dark menu) is fixed for every menu entry.
- **Verified**: `node scripts/redeem-test.js` (21 plain-node checks) and `scripts/redeem-browser-test.mjs`: real headless
  Chromium against the **real IDUNA binary** on a throwaway database seeded with synthetic codes -- the menu entry and its
  contrast, typing and paste, every answer, every refusal, the account overview and its empty states, a 390 px phone width,
  and (with `DEADWEIGHT_SITE` pointing at a `build-web.sh` output) the whole chain: sign in to the DEADWEIGHT client, click its
  link, redeem in the new tab, come back to 9,999 and FOUNDER, still true after a reload. Run it with
  `NODE_PATH=<dir with node_modules/playwright> PLAYWRIGHT_BROWSERS_PATH=... [IDUNA_BIN=...] [DEADWEIGHT_SITE=...] node scripts/redeem-browser-test.mjs`.
  **Not verified**: Firefox, Safari, a real phone, a screen-reader pass.
