# WOTAN — wotan.okemily.com

## What this is

The real, dedicated codebase for WOTAN, EINHORN_INDUSTRIAL's esports/stats hub — split out of
`OKEMILY/tournaments.html` (a single static page inside the OKEMILY marketing site) into its own
repo/subdomain now that real feature work is scoped against it (kanban `WOTAN-999`/`WOTAN-998`/
`WOTAN-996`, see `BRAWLPIT/docs/WOTAN_HAT_STORE_NORTHSTAR.md`) and it needs its own DNS
(`WOTAN-DNS-001`, real Cloudflare key at `EMILY/var/cloudflare.md`).

**Upstream repo pre-created by the founder 2026-09-03, empty** — this scaffold is the first real
commit. Matches the same "new repo, real minimal first commit, not a live founder ask" pattern as
`LO`/`SPIDERBEETLE`/`EMILY_FOR_BUSINESS` (see `/home/fatbaby/CLAUDE.md`'s own repo table).

**Live** at wotan.okemily.com (DNS, nginx, cert and `~/wotan-deploy.sh` all exist since 2026-09-04).

## Stack

Plain static HTML/CSS, no build step — deliberately matching `OKEMILY`'s own convention (fast,
near-zero footprint, trivially administrable by Claude Code: edit → commit → deploy). The real
hat-store/pixel-editor feature work scoped in `BRAWLPIT/docs/WOTAN_HAT_STORE_NORTHSTAR.md` will
need a real backend eventually (Phase 2 of that doc) — deferred, not decided yet.

## Design system

`css/wotan-theme.css` (2026-09-24) is the one shared stylesheet for all 5 pages — BRAWLPIT
"neon brutalist" art direction: near-black violet background, violet primary accent, a gold
"IDUNA undertone" secondary accent, plus cyan/orange/red/blue/green utility colors, all as CSS
custom properties. Shared topbar/nav, cards, buttons, badges, and form inputs live here; each
page keeps only its own page-specific overrides in a local `<style>` block. Dark-only, no
light-mode variant — deliberate, not an oversight. New pages should link this stylesheet and the
shared topbar markup rather than re-declaring `:root`/base styles. `button`/`.secondary`/`.gold`
rules also match a `.button` class, so a plain `<a>` can be styled like a button (2026-09-24,
added for store.html's "Sign in with IDUNA" link).

**IDUNA front page = the WOTAN style guide (2026-10-16, founder real-time: "look at the front page as the WOTAN style guide").**
`css/wotan-iduna.css` distils IDUNA's own front page (`IDUNA/index.html` + `styles.css`): cream paper, thin gold-edged
panels, Cormorant Garamond display over Spectral body, wide-tracked uppercase labels, restrained gold. New and reworked
pages use its `.i-*` components (hero, panel, button, scoreboard stat tiles, cards, badges, toast) with `body.iduna`
instead of inventing a palette; `store.html` and `GFD/` are the first two. The older dark `wotan-theme.css` pages
(friends, matches, ...) are unchanged and migrate opportunistically.

## Auth — IDUNA as SSO (standing, 2026-09-24; live end to end since 2026-09-25)

No page on this site renders its own email/password form. Every page links to IDUNA's own hosted
login page (`https://iam.okemily.com/?redirect_uri=<this page's URL>`, real cross-domain redirect
— see `IDUNA/internal/http/handlers/sso_login.go`), which hands a JWT back via a URL fragment on
return (`#sso_token=...&player_id=...`). `iam.okemily.com` is live (DNS via Terraform + nginx +
cert, `IDUNA/ops/nginx/iam-okemily.conf`) — a real nginx double-query-string bug that corrupted
the redirect was found and fixed live (dropped `$is_args$args` from the rewrite, `IDUNA` `3781d3c`).

Two real consumer patterns exist, not one:
- **`store.html`** uses the SSO token directly — WOTAN hats are IDUNA-native (GFD character +
  Flow balance), so the generic SSO JWT is already the right shape.
- **`friends.html`** (2026-09-25) needs a second step: DEADWEIGHT friends/duels are keyed to a
  *game-scoped* player token (`player_id`/`game`/`permissions` claims, minted by
  `internal/http/handlers/game_online.go`'s `playerToken`), which the generic SSO JWT is NOT
  shaped for (no `player_id`/`game`/`permissions` claims) — it fails `draftPlayerClaims` outright
  even though it's authenticating the exact same underlying `players` row. `friends.html` reads
  the SSO fragment same as store.html, then exchanges it via a new endpoint,
  `POST /api/v1/games/deadweight/sso-exchange` (bearer = the generic SSO token) → a real
  DEADWEIGHT `playerToken`, which it stores as `wotan_dw_token` exactly like the old inline form
  used to. No new player is ever minted by this exchange — an IDUNA identity with no DEADWEIGHT
  account linked (`players` row with `game='deadweight'`) gets a real 404, matching the page's own
  existing "guest accounts alone can't sign in here, link one from inside the DEADWEIGHT client
  first" framing. See `IDUNA/internal/http/handlers/game_online.go`'s `ssoExchange` for the real
  rationale and `game_online_test.go`'s `TestSSOExchange_*` for the live-proven round trip
  (register → guest-upgrade → generic SSO login → exchange → real `friendsList` call succeeds).

Any new page on this site that needs an IDUNA login should follow store.html's pattern (link out
with `redirect_uri`, read the returned fragment) if the target API already accepts a generic IDUNA
JWT, or friends.html's pattern (SSO login, then exchange for a game-scoped token) if it's a
game-scoped endpoint like DEADWEIGHT's — never add another inline credential form.

**A third real consumer (2026-09-28)**: `DEADWEIGHT/` (the actual game client, not a stats page)
follows friends.html's exact exchange pattern too, but as its own TS module (`web/src/sso.ts` in
the source repo, `DEADWEIGHT/dist/sso.js` here) rather than sharing this site's plain-`<script>`
`js/iduna-sso.js` — that file is DEADWEIGHT's own repo's build output, kept behaviorally identical
on purpose, not a fork of this one to maintain separately by accident. If `js/iduna-sso.js`'s
storage-key shape or fragment format ever changes, `DEADWEIGHT/docs/NATIVE_WASM_CLIENT_NORTHSTAR.md`
needs the same update made in its own `sso.ts`.

**Shared, sticky session (2026-09-25)**: `js/iduna-sso.js` is the one shared module both pages
load (`<script src="/js/iduna-sso.js">`) — `getIdunaSession()`/`setIdunaSession()`/
`clearIdunaSession()`/`buildSsoURL()`/`handleIdunaSsoReturn()`. Before this, store.html and
friends.html each kept their own separate, page-local "am I signed in" state and only ever
checked it right after an SSO redirect landed on THAT specific page — navigating to the other page
looked like being logged out even though the same origin's localStorage already had a valid
session sitting in a different key. Every page's own `handleSsoReturn()` now checks a fresh SSO
return FIRST, then falls back to the shared session from an earlier page visit, so signing in once
stays signed in across the whole site. A new page should read `getIdunaSession()` on load in
addition to (not instead of) handling its own fresh SSO return.

**Unscoped identities are claimed on first use (2026-09-25)**: a player who registers generically
(no game param — e.g. store.html/friends.html's own SSO register) used to dead-end everywhere
per-game — friends.html said "no account for that game," and the DEADWEIGHT client's own
claim-account flow said "email already taken" (true: that email already belonged to the unscoped
row, with no way to ever use it for a game). IDUNA's `sso-exchange` and game-scoped `email-login`
now both claim a never-scoped identity for the first game that legitimately authenticates against
it — see `IDUNA/internal/http/handlers/game_online.go`'s `claimGamePlayer`. An identity already
scoped to a DIFFERENT game still gets a real, distinct refusal, not silently reassigned.

## Real, current status

- `redgarden/` -- **Red Garden, playable at `/redgarden/play.html`** (2026-10-17, founder real-time: "publish redgarden web ... FULL WOTAN MATCH AND PLAYER TRACKING ... guest play ... iduna sso ... existing bot match infrastructure and bot pool ... PARENA WASM, PARENA TSX ... make it nice, very demure"). `play.html` + `redgarden.wasm` + `rg-host.js` (the old native-client how-to is a `<details>` on the page), `matches.html` (new Matches tab), `css/wotan-rg.css`, nav skin `rg` (tabs Leaderboard | Heroes | Matches | Play | GFD). **A client of the real game, not a port**: the arena server (C, authoritative) and its persistent 19-bot pool run in the cluster; `PARENA/stdlib/redgarden/web/rg_*.prn` is the wasm client (reads the arena's snapshots out of wasm memory, draws the 10v10 top-down, runs the draft / shop / HUD / orders; **no malloc, zero imports, fixed 8 MB**) and `rg_host.prn` the host (PARENA -> TypeScript -> JS: instantiate, blit, input, identity, the WebSocket) -- **no hand-written JS**. IDUNA's gateway (`/api/v1/redgarden/play`, `internal/redgardenplay`) queues the player with the live matchmaker, mints the connect ticket, relays validated orders + 20 Hz snapshots, and **records the match from the arena's own snapshots** (`redgarden_web_matches` + `player_game_stats` / `redgarden_player_matches` / `redgarden_hero_stats`, which the leaderboard / profile / hero pages already read); public `/api/v1/redgarden/status` and `/web-matches`. **Identity:** a signed-in visitor plays as their IDUNA identity (SSO JWT -> `ssoGamePlayer`); everyone else is a **guest**: the first PLAY makes a real REDGARDEN guest account (`guest-register`, IDUNA names it) kept in `localStorage` (`rg_guest`) and resumed with `guest-login`. **Rebuild** with `scripts/build-redgarden.sh` and commit both outputs. **Tests:** `scripts/redgarden-browser-test.mjs` (real Chromium + real IDUNA + the real C matchmaker / arena / 19 bots, guest and SSO, 32 checks; `REDGARDEN_BIN_DIR`, optionally with an `arena_server_fast` built with a 30 s match so a whole match fits) and, in IDUNA, `TestAgainstTheRealArena`. **Deploy order:** IDUNA first (the gateway; needs `REDGARDEN_TICKET_SECRET` in `iduna-env` = the arena's, from the `redgarden-env` secret), then WOTAN. **Found while building it:** the arena splits teams at slot 10 whatever the lobby size, so the live 3v3 queue (`:7780`) puts all six players on one team -- only the 10v10 pools are used; the prod arena pods have no IDUNA agent credentials so they report nothing themselves (the gateway records instead); focusing the canvas scrolls the page (`focus({preventScroll:true})`) and a scroll between pointer-down and -up turned clicks into misses. **Not verified:** Firefox, Safari, phones (no on-screen shop/scoreboard buttons), anyone *listening* (no audio), two humans in one match at once.

- `d2/` -- **D2 (DEADWEIGHT_2, "Hold Battles"), playable at `/d2/play.html`** (2026-10-17, founder real-time: "now DEADWEIGHT_2 same affordances WOTAN ESPORTS WASM TS PARENA"). `play.html` is the game: `d2.wasm` is the whole client (PARENA `stdlib/d2/web/d2_*.prn`, no imports, no allocator, fixed 8 MB) and `d2-host.js` is the page host (PARENA -> TypeScript -> JS: it instantiates the wasm, blits the framebuffer, forwards input, does identity -- a remembered guest account made through `/api/v1/games/d2/guest-register`, or the WOTAN SSO session -- and owns the WebSocket to IDUNA's `/api/v1/d2/play`). It is a **client of the real `dw2_server` and `dw2_bot` pool** (the match is not simulated here); it packs the ship locally (the ship rules are a port of D2's `core/`, checked against the C core tick by tick by `PARENA/scripts/d2_rules_parity.sh`), sends it on READY, plays the 30-tick fight and the round-break timing duel (the line is placed for the measured round trip), and the gateway records the match against the account. `index.html` is the **Ladder** (the generic `/api/v1/games/d2/leaderboard`, bots included and tagged), `matches.html` the **Matches** tab (`/api/v1/d2/web-matches`: click a row for the packed ship and the round breaks), `u.html` a player's **profile** (`/api/v1/d2/players/{id}`). `js/d2-pages.js` (hand-written, textContent only, like `rg-pages.js`) drives the three stats pages; `css/wotan-d2.css` is the (quietest) skin; `wotan-nav.js` has a `d2` skin. Rebuild with `scripts/build-d2.sh` (commit `d2/d2.wasm` + `d2/d2-host.js`; the image is built from tracked files). Test: `scripts/d2-browser-test.mjs` (Chromium against a real IDUNA, the real dw2_server and bots: guest and SSO play through to the result, forfeit, the ladder, matches and profile pages; needs `D2_BIN_DIR`, built from the DEADWEIGHT_2 repo). Not verified: Firefox, Safari, phones, audio (none).
- `shankpit-460/` -- **shankpit-460, playable, with human matchmaking** (2026-10-16, founder real-time: "ADD SHANKPIT 460 as a first class citizen to WOTAN, full esports treatment, full IDUNA and WOTAN integration ... queue them into a bot match and say SEARCHING FOR MATCH; if there is at least 1 other human in matchmaking put them in a ffa lobby; human matches are first to 16 or they end at 6 minutes; an end screen with the score and a requeue button; make it nice, very thoughtful, very demure; THE GAME IS PORTED TO WASM AND TYPESCRIPT VIA PARENA, SAME THING WE JUST DID FOR BRAWLPIT WEB"; "shankpit-460 just like that is the brand name keep it like that"). `index.html` + `shankpit460.wasm` + `sp-host.js`, `css/wotan-sp.css`, nav skin `sp`. **The game is the wasm**: `PARENA/stdlib/shankpit460/sp_*.prn` (physics + weapons ported from shankpit-460's C engine, parity-tested against the real `physics.h`: 40 scenarios, worst diff 5e-7; a perspective-correct z-buffered software rasteriser into a 640x360 framebuffer; bots from scratch; HUD / title / end-with-requeue; the matchmaking wire protocol), built by `PARENA/scripts/build_shankpit460_web.sh`; **no malloc, zero imports, fixed 8 MB**. **No hand-written JS** (`sp-host.js` is `sp_host.prn` -> TypeScript -> JS: instantiate, blit, input + pointer lock + gamepad, the WebSocket, WebAudio, labels). **Flow:** PLAY = a bot match at once + SEARCHING FOR MATCH; another human searching => both into an FFA lobby on IDUNA (`GET /api/v1/shankpit460/play`, a WebSocket on the Gateway's existing `/api/` route to `iduna`, whose backend timeout is already 3600 s; first to 16 or 6 minutes) -> standings + REQUEUE. A signed-in player's HELLO token resolves to their shankpit460 game-player row (`ssoGamePlayer`); no token is a guest. Public counts at `/api/v1/shankpit460/status` (shown under the page title). **Rebuild** with `scripts/build-shankpit460.sh` (sibling `PARENA`, node, LLVM toolchain) and commit both outputs. Tests: `scripts/shankpit460-net-test.mjs` (two real wasm engines + the real IDUNA binary: pairing, relay, a claimed hit, a kill, respawn, the kill limit, the end screen, requeue) and `scripts/shankpit460-browser-test.mjs` (real Chromium, 19 checks, screenshots); both start IDUNA through `scripts/lib/real-iduna.mjs` (`IDUNA_BIN` or built from `../IDUNA`; `SHANKPIT460_KILL_LIMIT` / `_MATCH_SECONDS` / `_COUNTDOWN_SECONDS` shorten matches). Deploy order: IDUNA first (it serves the WebSocket), then WOTAN. **Not verified:** Firefox, Safari, phones (no touch controls), a physical gamepad, anyone *listening* to the sound; a live match with three or more humans. **Stats and the bot league are the second pass** (founder: "we want stats on that but ... a secondary pass where we set up the bot league") -- nothing is persisted yet.

- `BRAWLPIT/` -- **BRAWLPIT, playable** (2026-10-16, founder real-time: "get brawlpit web shipped; PARENA powered; no malloc; wasmdaddy" / "make sure its actually wasm not faked with a bunch of garbage js; whatever we do need to use js for use parena into TS"). `index.html` + `brawlpit.wasm` + `bp-host.js` + `sprites.png`. **The game is the wasm**: `PARENA/stdlib/brawlpit/bp_*.prn` (physics + sim ported line for line from `BRAWLPIT/packages/common/physics.h` + `local_game.h` on PARENA's new F32 wasm backend, CPU fighters, menus, a software renderer into a 960x540 framebuffer) compiled by `PARENA/scripts/build_brawlpit_wasm.sh`; **no malloc** -- fixed-address memory, zero imports, 8 MB that cannot grow, and the build fails on an allocator symbol / undefined symbol / `memory.grow`. Physics parity with the C engine is bit-exact (`PARENA/tests/brawlpit_parity_test.mjs`: 74 scripted scenarios, 174,600 ticks). **There is no hand-written JS here**: `bp-host.js` is `PARENA/stdlib/brawlpit/bp_host.prn` compiled to TypeScript by PARENA's `emit_ts` and type-stripped; it only instantiates the wasm, blits the framebuffer (an `ImageData` view onto wasm memory), forwards keyboard / pointer / Gamepad API state, and turns the equipped hat (a PNG, or a curated hat's glyph) and the portrait atlas into pixels in wasm memory. Same affordances as `GFD/`: IDUNA SSO via the shared session, `wotan-nav.js` `bp` skin + top `GAMES` entry, equipped-hat badge in the header **and the hat worn in matches** (on by default as soon as it loads -- a pixel hat from its PNG, a curated hat by decoding IDUNA's HTML-entity `image_asset` such as `&#127914;` and drawing the glyph fitted onto the head; up/down on fighter select only swaps it for no hat / a colour hat; a status line under the canvas reports signed out / nothing equipped / expired sign-in / missing image; closes `WOTAN_HAT_STORE_NORTHSTAR.md` Phase 3). Modes: vs CPU (levels CLASSIC/EASY/NORMAL/HARD), local 2P, free-for-all, practice. **Rebuild** with `scripts/build-brawlpit.sh` (needs the sibling `PARENA` checkout, node, the LLVM toolchain at `~/.local/opt/llvm-toolchain`) and `python3 scripts/build-brawlpit-sprites.py`; commit the outputs (the deploy image is git-tracked files only). Tests: `make test-brawlpit` in PARENA (emitters, parity, engine, host-under-DOM-stub) and `scripts/brawlpit-browser-test.mjs` here (real headless Chromium, 13 checks incl. a stubbed signed-in hat flow, keyboard, pointer, a Gamepad API shim). **Not verified:** Firefox, Safari, a phone (no touch controls), a physical controller; no audio; no online play.

- `GFD/` -- **GoblinFoxDragon web client** (2026-10-16, founder real-time): `index.html` + `gfd.js` + `term.wasm`. The terminal is PARENA (`PARENA/stdlib/gfd/term.prn`, built by `PARENA/scripts/build_gfd_term_wasm.sh`, committed here as `GFD/term.wasm`; rebuild it when `term.prn` changes -- `PARENA/tests/gfd_term_test.mjs` tests the artifact). Talks to the MUD over `wss://wotan.okemily.com/GFD/ws` (Gateway route to `gfd-core:8480`, `EMILY/gitops/render.sh`); first frame is `{"token":<IDUNA SSO JWT>}`, close code 4401 = token refused. Uses the shared `js/iduna-sso.js` session, no sign-in button of its own. Character creation is the MUD's own name-claim flow (same code as SSH); the character is owned by the IDUNA account's `player_id`, which is what `store.html` looks up. One character per account for now (multibox licensing will raise it; no character select yet). Nav: `data-skin="gfd"` (`css/wotan-gfd.css`). Verified in headless Chromium against the real MUD; **not yet verified on a real phone keyboard or Safari**. Known limit: the terminal is a fixed 100x34 grid, so on a phone it is small (zoom/fullscreen help; reflow is future work).

- `clubs/` — **Clubs (teams), Phase 2** (2026-10-12, see `CLUBS_NORTHSTAR.md`): directory, tier-shaped public page,
  members workspace, manager console, invite join flow, settings/sync target. Backend is IDUNA
  `internal/http/handlers/clubs*.go` + `internal/clubs` (authz) + Back Office `/admin/clubs`; authorization is
  `permission + club_id` evaluated server-side from membership rows, not from the JWT. Rank is self-declared
  (always "unverified"). Built and handler-tested, **not yet deployed or browser-verified** (see the doc's §12).

- `redeem/` + the account overview -- **Redeem a code** (2026-10-16, founder real-time: "we need an affordance under the user profile for redeem a code ... enable founder mode in DEADWEIGHT web ... make it nice when a code is redeemed it should say what it did", after Battle.net's Redeem a Code page / account overview / account menu). `/redeem/` (IDUNA style guide: `body.iduna`, `css/wotan-redeem.css`), a **Redeem a code** entry in the `wotan-nav.js` account menu (every skin), and an overview at the top of `/account/` (compact Redeem card, Games, Recent redemptions; mounted by `identity-page-account.js` via `js/account-overview.js`, optional so it can never block the identity sections). New nav skin `acct` (tabs Account | Redeem a code) used by both pages. **All redeem API paths and every word of the answer live in `js/redeem-api.js`** (pure, node-testable: code formatting, `describe()` = "what it did", `friendlyError()`); `js/redeem-widget.js` is the shared form + answer panel (own `rd-*` classes, so it sits on both `body.iduna` and `body.hs`). Backend: IDUNA `POST /api/v1/redeem` and `GET /api/v1/me/entitlements` (`account_redeem.go`), which find the code's game and spend it on the player the SSO identity plays that game as (the `sso-exchange` rule), through the same transaction as the native client's own redeem. Founder code = permanent Founder + Draft tickets lifted to 9,999. The DEADWEIGHT web client links here (new tab) and shows the FOUNDER badge. Rules learned the hard way: **no `maxlength` on the code box** (browsers truncate a PASTE to it before any handler runs -- the native client's S520 bug again), and a menu link colour must be pinned with `#wotan-nav .wn-menu a` (a `body.hs a` rule painted menu entries indigo on dark purple). **Never put real claim codes in a test or a doc** (public repos; codes are redeemable). Tests: `node scripts/redeem-test.js` (21) and `scripts/redeem-browser-test.mjs` (real Chromium + the REAL IDUNA binary, synthetic codes; `DEADWEIGHT_SITE=<build-web.sh output>` adds the whole sign-in -> link -> redeem -> back-to-9999 chain). **Not verified:** Firefox, Safari, a real phone, a screen reader.

- `account/` — **Identity federation, Phase 2b front end (chunk ID-B, 2026-10-12, see `IDENTITY_NORTHSTAR.md`)**: linked accounts
  (Battle.net xN / Google / Twitch), privacy toggles, tracker upload keys, and the "Competitive Verification Required" gate
  (`js/identity-gate.js`, reused by tracker.html's install-command copy and the club-create flow). **All identity/upload-key API
  paths live in `js/identity-api.js` only** (also display-name and rank-wording helpers: Twitch name only on opt-in,
  "Leaderboard-matched" not "verified"). Account-menu entry is in `wotan-nav.js`; no page renders its own Sign-in button.
  Backend is IDUNA chunk ID-A (parallel, not deployed); never run in a browser; verified only by
  `scripts/identity-affordance-test.js`. Link starts pass the session as `access_token=` because navigations cannot carry a
  header (a backend assumption, see README). Uplink key exchange is a patch in `HRIP/tracker/uplink/`, not applied.

- `hearthstone/` — **Hearthstone decks + socials** (2026-10-09, see `HEARTHSTONE_NORTHSTAR.md`): IDUNA-style (cream/gold) skin
  (`css/wotan-hs.css`, `body.hs`) for `index.html` (Decks), `deck.html`, `submit.html`, `feed.html`, `players.html`, `u.html`; shared
  `js/wotan-nav.js` topbar (game switch + the ONE account widget, `data-skin="hs|dw"`) now used by every page. **Standing rule: pages never
  render their own "Sign in" buttons** — the nav is the only one; a page that needs a hint uses a plain-text `data-signin` anchor.
  Backend: IDUNA `internal/http/handlers/hs_social.go` + `internal/hsdeck` (deckstring codec). Generic IDUNA SSO JWT, store.html-style.

- `decks.html` — **DEADWEIGHT Draft Decks** (2026-09-19): the unauthenticated deck browser. Reads IDUNA's public
  `/api/v1/games/deadweight/{decks,decks/{id},card-stats}` (tails dw_server's `decks.ndjson`) and `data/cards.json`
  (generated by `DEADWEIGHT/scripts/export_cards.sh`). Hover/tap/focus any card chip for a big card tooltip. Anonymous by
  design; sign-in (tournaments etc.) is later and its header button is disabled. Verified with headless Chrome
  screenshots (desktop + phone width) against the real data; touch tap-to-pin was not exercised on a real device.

- `index.html` — landing page (esports hub branding; links Draft Decks and the store, "coming soon" framing for the rest),
  matching `OKEMILY/hats.html`'s own honest-placeholder precedent (every purchase/feature control
  visibly disabled, not faked as live). Now links to `store.html`.
- `matches.html` — **DEADWEIGHT Matches** (S547, 2026-09-25): real leaderboard + recent-matches
  list + a real round-by-round replay viewer. Reads IDUNA's public `/api/v1/games/deadweight/
  {matches,matches/{id},matches/{id}/replay}` (new — tails `dw_server`'s `matches.ndjson`, and
  `/replay` shells out to a new `dw_replay_dump` C tool that replays the match through
  DEADWEIGHT's real `core/match.c`) plus the already-existing public `leaderboard` endpoint and
  `data/cards.json`. See `NORTHSTAR.md` for the full account (why DEADWEIGHT, verification,
  deferred work). Live-verified via real headless-Chromium screenshots (desktop + phone) against
  the deployed page.
- `store.html` — (restyled 2026-10-16 on the IDUNA style guide: character plate with Flow balance + hats-owned tiles, hat cards, "need N more Flow" instead of a doomed Buy, locker with equipped state, toasts, no-character state linking to `/GFD/`) real, code-complete WOTAN_HAT_STORE_NORTHSTAR.md Phase 2 store page (2026-09-04):
  resolves the player's GFD character, real hat catalog/buy/equip against IDUNA's live Phase 1
  endpoints, all via this repo's own `/api/` nginx proxy. Login is IDUNA's own hosted SSO page
  (2026-09-24) — see "Auth — IDUNA as SSO" above and `IDUNA/internal/http/handlers/sso_login.go`
  — not an inline form on this page anymore.
- `friends.html` — real friends list/requests + duel challenges against IDUNA's live
  `game_social.go` endpoints. Login is IDUNA's own hosted SSO page too (2026-09-25), exchanged for
  a real DEADWEIGHT player token — see "Auth — IDUNA as SSO" above for why this page needs an
  extra step store.html doesn't. Not live-verified in a real browser (no headless Chrome in this
  sandbox) — Node syntax-checked, and the backend exchange endpoint is proven end to end by real
  Go tests (`IDUNA`'s `TestSSOExchange_*`), but the actual click-through hasn't been screenshotted.
- `shankpit.html` — **SHANKPIT Leaderboard** (S550, 2026-09-25, founder real-time: "add shankpit to
  WOTAN... if you have an iduna account you have a shankpit account... for now we need basic
  shankpit match tracking"). Basic kill/death/K-D/sessions leaderboard, unauthenticated, reading a
  new public `GET /api/v1/shankpit/leaderboard` (`IDUNA/internal/http/handlers/
  shankpit_leaderboard.go`) that sources directly from the existing `players` table columns
  SHANKPIT already writes to (`kills`/`deaths`/`sessions`, via `players.go`'s `handleSessionEnd`
  under the existing `shankpit.match.write` permission — SHANKPIT match tracking was already real,
  it just had no WOTAN-facing leaderboard read yet, same gap REDGARDEN's `matches.html` closed
  first). No new IDUNA account type: any `players` row already carries these columns, so "IDUNA
  account = SHANKPIT account" needed no code change, only this page. Real, named, deferred: SHANKPIT
  and BIG_O premium keys ("those will be for premium") — not part of this basic pass.
- `DEADWEIGHT/` — **the real DEADWEIGHT game client** (2026-09-28), not a stats page: a plain copy
  of `DEADWEIGHT/web/`'s built output (native wasm32 protocol codec, no Emscripten), signing in via
  the same IDUNA SSO pattern as store.html/friends.html. See `README.md`'s own entry and
  `DEADWEIGHT/docs/NATIVE_WASM_CLIENT_NORTHSTAR.md` for the full build/verification account.
  **Live**: deployed via `wotan-deploy.sh`, curl-verified 200 against the real domain. **Can't play
  a match yet** — `dw-ws-bridge.service` is installed and running for real
  (`~/sudo-queue/94-deadweight-wotan-ws-bridge.sh` was run) but `ops/nginx-wotan.conf`'s
  `/DEADWEIGHT/ws` location still 404s live: `94`'s nginx-edit anchored on "the last closing
  brace in the file," which landed the location inside certbot's own appended port-80-redirect
  server block instead of the real HTTPS one (a bare server-level `return 301` there swallows
  every request before any location inside it is reached). Fixed by
  `~/sudo-queue/95-fix-deadweight-ws-nginx-location.sh` (anchored to the known-good `/api/`
  location instead, idempotent, unit-tested against a synthetic reproduction of the bug) — still
  needs the same real sudo this sandbox doesn't have.
- Deploy: `~/wotan-deploy.sh` rsyncs this repo to `/var/www/wotan` (no build step).

## Related

- `NORTHSTAR.md` — this repo's own S547 match stats+replay build (why DEADWEIGHT, architecture,
  verification, deferred work).
- `BRAWLPIT/docs/WOTAN_HAT_STORE_NORTHSTAR.md` — the real, scoped hat-store feature plan.
- `BRAWLPIT/docs/BP_WASM_WOTAN_NORTHSTAR.md` — the BRAWLPIT-on-WOTAN wasm port plan (this pass's
  real scaffold + honest capability audit; the engine port itself is not started).
- `OKEMILY/tournaments.html` — the original single-page version this repo is splitting WOTAN out
  of; not deleted, stays as the live page until this repo actually replaces it.
- `EMILY/var/cloudflare.md` — real Cloudflare API token for the subdomain work (`WOTAN-DNS-001`).

## README Reality — SAGA reconciliation (standing instruction, monorepo-wide)

Founder real-time, 2026-09-18: if a change of yours **substantially changes the claim of this project's core README**,
then per SAGA protocols (`EMILY/docs/SAGA_SYSTEM_AUDIT_2026-07-18.md`, HQ-SPEC-DOC-102: intent ↔ claim ledger ↔ reality)
you **must update `README.md` in the same unit of work** so it reflects current reality. The README is the project's public
claim; it must not lag behind the code.

- **When it applies:** a capability is added or removed; status moves ("design only" → "working", "planned" → "shipped");
  the stack, build, run or install steps change; a claim in the README is now false or stale; or you add a **meaningful,
  genuinely interesting piece of kit** (a new tool, engine capability, protocol, pipeline, game system). For that last case
  especially: put it in the README — what it is, how to run it, and its honest status and limits.
- **When it does not:** ordinary fixes, refactors and small features that leave the README's claims true.
- **How:** re-read the README against what you just changed; fix or delete stale lines (including "not built yet" notes that
  are now built); verify any new claim by actually running it, and mark anything untested as untested; commit the README
  with (or immediately after) the change, and mention it in the CHANGELOG entry.

## Core Deps Are PARENA-First (standing, monorepo-wide)

Founder real-time, 2026-10-01: *"always implement core deps in PARENA — when core deps are missing
always implement the core deps in PARENA first."*

- **When a core dependency is missing** (a codec, a protocol client, an inference engine, a
  parser, a data structure — anything this repo's own functionality stands on), implement it in
  PARENA (`PARENA/stdlib/...`) **first**, before building the feature that needs it. Deps first,
  feature second.
- **If PARENA itself can't express the dep yet**, that gap is the real first task: fix or extend
  PARENA (compiler, emitter, or stdlib), with tests, then build the dep on top. Don't route around it.
- **Third-party tools/binaries are stopgaps, not the answer.** Shelling out to or FFI-binding an
  existing tool is allowed only to unblock a demo, and must be labeled as a stopgap in the code and
  in `EMILY/BACKLOG.md` with a PARENA replacement item. (Example: Piper via subprocess for
  MODE_TYLER TTS, 2026-10-01 — stopgap; the PARENA-native synthesis stack is the real work.)
- **Not a license to reimplement the OS.** Core deps = what the product's own behavior depends on.
  Compilers, kernels, system libraries and the like stay as-is; a repo's own CLAUDE.md may record a
  considered, specific exception (same standard as the LZ4 compression convention).
