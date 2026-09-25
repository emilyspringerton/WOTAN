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
- `store.html` — real, code-complete WOTAN_HAT_STORE_NORTHSTAR.md Phase 2 store page (2026-09-04):
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
- Deploy: `~/wotan-deploy.sh` rsyncs this repo to `/var/www/wotan` (no build step).

## Related

- `NORTHSTAR.md` — this repo's own S547 match stats+replay build (why DEADWEIGHT, architecture,
  verification, deferred work).
- `BRAWLPIT/docs/WOTAN_HAT_STORE_NORTHSTAR.md` — the real, scoped hat-store feature plan.
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
