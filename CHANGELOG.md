# Changelog

## 2026-09-25 (2)
- fix(auth): **SSO session is now sticky across pages** (founder real-time: "the SSO should be
  sticky when i click around it forgets im logged in"). New shared `js/iduna-sso.js`
  (`getIdunaSession`/`setIdunaSession`/`clearIdunaSession`/`buildSsoURL`/`handleIdunaSsoReturn`),
  loaded by both `store.html` and `friends.html`. Before this, each page kept its own separate
  localStorage key and only ever recognized a session right after an SSO redirect landed on THAT
  page -- navigating from one page to the other looked like being logged out. Both pages'
  `handleSsoReturn()` now check a fresh SSO return first, then fall back to the shared session from
  an earlier page visit; `friends.html` silently re-exchanges the shared session for a fresh
  DEADWEIGHT token on every load rather than trusting a possibly-stale cached one. `logout()` on
  either page now clears the shared session too, so logging out is sticky in the same way.
- Related IDUNA-side fix (see `IDUNA` `5f7c9f9`/`bd3d7cc`): a generically-registered identity (no
  game scope) used to dead-end -- "no account for that game" on friends.html, "email already
  taken" on the DEADWEIGHT client's own claim-account flow, with no way out. `sso-exchange` and
  game-scoped `email-login` now claim an unscoped identity for the first game that legitimately
  uses it.

## 2026-09-25
- feat(auth): **friends.html no longer collects a password of its own** (founder real-time: "make
  it work for Friends and Duels", the direct follow-up to 2026-09-24's store.html SSO cutover).
  Removed the inline email/password form; a "Sign in with IDUNA" link now sends the browser to
  IDUNA's own SSO page, same as store.html. Genuinely different underneath, though: DEADWEIGHT
  friends/duels are keyed to a game-scoped player token (`player_id`/`game`/`permissions` claims),
  which the generic SSO JWT isn't shaped for -- so `handleSsoReturn()` now exchanges the SSO token
  for a real DEADWEIGHT token via a new IDUNA endpoint, `POST /api/v1/games/deadweight/
  sso-exchange` (see `IDUNA` `50655f5`), before storing it exactly like the old inline form did. An
  IDUNA identity with no DEADWEIGHT account linked gets a real, honest error message pointing at
  the DEADWEIGHT client's own "link email" flow, not a silent new registration. See `WOTAN/
  CLAUDE.md`'s "Auth -- IDUNA as SSO" section for the full rationale. Node-syntax-checked; the
  backend round trip is proven end to end by IDUNA's own `TestSSOExchange_*` tests; the actual
  browser click-through was not screenshotted (no headless Chrome in this sandbox).

## 2026-09-24 (5)
- feat(auth): **store.html no longer collects a password of its own** (founder real-time:
  "instead of putting your password into page on wotan iduna needs to become the SSO"). Removed
  the inline email/password/confirm-password form and its eye-toggle show/hide buttons entirely;
  the "Sign in with IDUNA" link now sends the browser to IDUNA's own dedicated SSO login page
  (`https://iam.okemily.com/?redirect_uri=<this page's own URL>`, see `IDUNA/internal/http/
  handlers/sso_login.go`) -- a real cross-domain redirect, not a same-origin trick. On return,
  IDUNA hands the JWT back via a URL fragment (`#sso_token=...&player_id=...&display_name=...`),
  which `handleSsoReturn()` reads, stores in `localStorage` exactly like the old inline form did,
  and scrubs from the URL (`history.replaceState`) so a refresh/share never carries the token.
  The `?signup=1` deep link from GFD's own login screen (Ctrl+Alt+S) still works, now forwarded
  as a query param onto the SSO page so it can default to register mode instead of focusing a
  local field. Added a shared `.button` class to `css/wotan-theme.css` (mirrors the existing
  `button`/`button.secondary`/`.gold` rules onto `<a>` elements) so a link can be styled like a
  button -- reusable by any future page, not store.html-specific.
  **Depends on `iduna.service` actually carrying the new SSO route and, ideally,
  `iam.okemily.com`'s DNS/cert existing (`IDUNA/ops/nginx/iam-okemily.conf` +
  `sudo-queue/91-iam-okemily-sso-domain.sh`, neither live yet) -- this commit is held un-deployed
  (not yet rsynced via `~/wotan-deploy.sh`) until then, since deploying it first would break the
  live hat-store login for real users.** `friends.html`'s own login form is untouched -- it
  authenticates DEADWEIGHT accounts, a genuinely separate credential system from IDUNA platform
  accounts (see this file's own 2026-09-24 entries for S536/S537), out of scope for this change.

## 2026-09-24 (4)
- feat(design): **full visual redesign — BRAWLPIT "neon brutalist" art direction** (founder
  real-time: "improve the design of the WOTAN platform use the brawlpit aesthetic the neon
  brutalist look but make it clean and readable and friendly the shankpit menu color pallette" /
  "attaching an example of a shankpit style art direction with IDUNA undertones use this as
  inspo"). New shared theme (`css/wotan-theme.css`), applied to all 5 live pages
  (`index.html`, `decks.html`, `store.html`, `profile.html`, `friends.html`) in place of each
  page's own copy-pasted `:root`/base `<style>` block. Palette: near-black violet background
  (`--bg: #0b0518`), violet primary accent (`--violet`/`--violet-bright`), a gold "IDUNA
  undertone" secondary accent (`--gold`/`--gold-bright`) used for the active-nav pill and
  highlight numbers, cyan/orange/red/blue/green utility colors -- `decks.html`'s existing
  Offense/Operations/Defense card-type coloring rides the same CSS variables unchanged (its JS
  only ever referenced those variables/classes by name, never a hardcoded hex, so the recolor
  was a pure CSS-layer change). Shared component styles: topbar/nav with `aria-current="page"`
  active-state styling, cards, buttons (primary/secondary/danger/gold), badges, form inputs,
  Space Grotesk display font. Deliberately no light-mode variant -- a neon-brutalist identity
  doesn't have one; this repo is dark-only now, a deliberate call, not an oversight. One real
  bug found and fixed during the centralization: `store.html`'s JS emits a bare
  `class="badge"` (no `.pending`/`.accepted`/`.declined` modifier) for "Owned"/"Equipped"
  states, which the new shared `.badge` base (unstyled without a modifier, by design) would
  have rendered colorless -- added a page-local override. Verified with real headless
  (Playwright/Chromium) screenshots of all 5 pages served locally, checked for readability,
  contrast, and no leftover unstyled elements before shipping -- not just "the CSS parses."

## 2026-09-24 (3)
- chore(verify): diagnosed and cleared a stalled background run of the Duel Phase 3c e2e harness
  (`duel_wotan_phase3c_e2e.sh`/`.js`, scratch, not committed) and re-ran it fresh against the
  currently-deployed `friends.html` (MD5-confirmed identical to `/var/www/wotan/friends.html`).
  Root cause: the harness hardcoded its Chrome remote-debugging port (`19223`) with no timeout on
  any CDP round-trip -- if a prior run's Chrome process wasn't fully reaped before a rerun, the
  new instance either fails to bind that port or the script ends up talking to a stale/half-dead
  one, and an unanswered CDP message then hangs forever with no self-recovery (this is what
  happened to task `bcud2ohkw` earlier the same day: killed by exact PID after confirming via
  `/proc/*/cmdline` it was scratch, not a live service). Checked directly before doing anything
  else: no process was actually still running or bound to that port at the time of this pass --
  the earlier stall had already been cleared. Randomized the port in the scratch harness so a
  future rerun can't collide with a leftover instance the same way. Fresh run: real headless
  Chrome loaded the real `friends.html`, logged in, rendered the accepted duel's `match_token` +
  Copy token button, and a real (CDP-synthesized, trusted) click resolved
  `navigator.clipboard.writeText()` -- button showed "Copied!", screenshotted. No app code
  changed; this reconfirms Duel Phase 3c (`61bfbce`, Apple #20690, `EMILY/BACKLOG.md` SECTION 537)
  is genuinely shipped and working against what's live today, not just what was true when it was
  first verified. (sess-20260923-1030-4a526255)

## 2026-09-24 (2)
- ops+feat: **WOTAN is now the real front door** (S540, founder real-time: "finish shipping the
  new WOTAN stuff / wotan.okemily.com should be the front door to the online social tournament
  site"). Closed the one real gap left after S537/S536: `iduna.service` was still running a build
  from before the friends/duels/profiles routes (`70b6b06`, `2716c8e`) landed, so every one of
  `friends.html`'s calls would have 404'd against the real deployed API despite passing every
  fixture-based test. Rebuilt IDUNA from current `main` (`go test ./...` clean across all 30+
  packages), restarted `iduna.service` (health check passed, no downtime beyond the restart
  itself), and re-deployed this repo's own `friends.html`/`profile.html` (previously committed
  but never actually rsynced to `/var/www/wotan` -- deploy is a separate manual step from
  `git push` here, and it had been missed). **Live-verified end to end against the real production
  stack, not a fixture**: registered two real throwaway DEADWEIGHT accounts through
  `wotan.okemily.com`'s own `/api/` proxy, upgraded both to email/password, logged in, sent and
  accepted a real friend request, challenged and accepted a real duel, and confirmed a real,
  correctly-shaped `match_token` came back -- the exact same call chain `friends.html` makes
  itself, just driven by curl instead of a browser. `GET .../players/{id}/profile` also confirmed
  live (friend_count reflected the new friendship).
  `index.html` rewritten: dropped the "Under construction" badge and the "old page is still at
  okemily.com/tournaments.html until this page fully replaces it" framing (had the direction of
  the pointer backwards) -- now `Live`, leads with Player Profiles/Friends & Duels, and points
  outward to `okemily.com/tournaments.html` only for the content that's genuinely still only
  there (REDGARDEN leaderboard, hero stats, GFD Battlegrounds demo). `OKEMILY/tournaments.html`
  got a matching banner pointing back here (see that repo's own CHANGELOG). `README.md` updated
  per SAGA README Reality. (sess-20260923-1030-4a526255)

## 2026-09-24
- feat: Duel Phase 3c -- `friends.html` surfaces the live match_token on an accepted duel (S537
  Duel Phase 2, Phase 3, WOTAN half). WOTAN has no game client of its own to queue a match into --
  the native SDL2 (Phase 3a, DEADWEIGHT `9afdda5`) and browser (Phase 3b, DEADWEIGHT `e16dbfa`)
  clients already read this same token straight from IDUNA and show their own Play button, so
  `friends.html`'s `loadDuels()` renders the raw token in a monospace box with a **Copy token**
  button (`navigator.clipboard.writeText`) for the one real audience WOTAN can serve directly:
  `dw_client --match-token TOK`, a real, live CLI flag as of Phase 2. Live-verified with a real
  headless Chrome (Chrome DevTools Protocol) loading the actual, unmodified `friends.html` against
  a fake same-origin IDUNA seeded with an accepted duel + token, confirming the token box and
  button render with the exact expected value, and that a real (CDP-synthesized, trusted-click)
  click resolves `writeText()` successfully (button shows "Copied!"). No app code needed a CORS
  workaround for this test -- served same-origin, matching production's real nginx `/api/` proxy.
  Closes SECTION 537's Duel Phase 2, Phase 3 entirely (3a/3b/3c all shipped). (sess-20260923-1030-4a526255)
- feat: DEADWEIGHT friends & duels (`friends.html`) and public player profiles (`profile.html`) -- founder real-time: "add iduna online accounts / add social features / profiles / friends / friendly challenges (duels) / for DEADWEIGHT / WOTAN". New IDUNA routes under `/api/v1/games/deadweight/...` (friend-requests, friends, duels, players/{id}/profile -- IDUNA commit 70b6b06). `friends.html` logs in with a DEADWEIGHT account (separate credential system from `store.html`'s IDUNA login) to manage requests/friends/duels; `profile.html` is a public, no-login profile lookup. Verified: `node --check` on both pages' scripts, headless-Chrome screenshots of both pages (and the updated `index.html` nav), and a manual field-by-field contract check against `game_social.go`'s real JSON output. Not yet live-tested end to end through the real deployed API -- the IDUNA build carrying these routes is committed/pushed but not yet deployed to `iduna.service` (same real, named gap as the BIG_O IDUNA app work, 2026-09-23). `index.html`/`README.md` updated per SAGA README Reality. (sess-20260923-1030-4a526255)

## 2026-09-19
- deploy: retheme colours/keywords live, season note (pre-retheme decks archived) (sess-20260918-1725-497f394f)
- feat(decks): Offense/Operations/Defense colours, keyword column/filter/legend, cards.json v2 (105 cards); not deployed until the server ships the retheme (sess-20260918-1725-497f394f)

- feat: DEADWEIGHT Draft Decks browser (decks.html) -- drafted decks + win rates, filters/sorts, big card tooltip on hover, per-card records tab; data/cards.json generated from DEADWEIGHT; README/CLAUDE status corrected (site is live) (sess-20260918-1725-497f394f)


## 2026-09-04 (4)

- feat(store): `?signup=1` (from GFD's own new `Ctrl+Alt+S` sign-up shortcut, `GFD-UA-001`)
  focuses the email field and hints toward the register button on load.

## 2026-09-04 (3)

- feat(store): `WOTAN-997` -- `store.html`'s register form now has a real "Confirm Password"
  field, validated (`password !== confirm` → real error, no request sent) only on the register
  path, never enforced on login (a returning login only ever needs the one real password on
  file). Both the password and confirm-password fields get their own independent show/hide
  ("eye") toggle button, flipping `type="password"`/`type="text"` per field. JS syntax-checked;
  no live browser test (no headless-browser harness in this repo, same real limitation IDUXN-003
  already named for a different repo's own page JS).

## 2026-09-04 (2)

- ops: **WOTAN-DNS-001 fully live.** `sudo-queue/48-setup-wotan-nginx-and-dir.sh` ran (nginx site
  + Let's Encrypt cert + initial deploy) but the site came up as a real, live 403 Forbidden:
  `wotan-deploy.sh`'s `rsync -a` faithfully mirrors the SOURCE repo's own file permissions into
  `/var/www/wotan`, and this repo's own checkout was `770`/`660` (no "other" access) instead of
  `OKEMILY`'s own `775`/`674` world-readable convention — so nginx's `www-data` worker genuinely
  couldn't read anything it just deployed. Real, root-cause fix, no sudo needed (this repo is
  `fatbaby`-owned): `chmod 775` the repo root + subdirectories, `664` the files, matching
  `OKEMILY`'s own precedent exactly, then re-ran `wotan-deploy.sh`. Live-verified:
  `https://wotan.okemily.com/` and `/store.html` both real `200`s over real HTTPS with the
  correct HTTP→HTTPS redirect (`--hsts`/`--redirect` from certbot), and `store.html`'s own
  `/api/` proxy confirmed reaching the real live IDUNA (`/api/v1/hats` → real 401, `/api/v1/auth/
  email/login` → real "invalid email or password" for a bogus login, not a proxy/connection
  error). WOTAN's own `store.html` (Phase 2, shipped 2026-09-04) is now genuinely reachable from
  the outside for the first time.

## 2026-09-04

- feat: `store.html` — the real WOTAN_HAT_STORE_NORTHSTAR.md Phase 2 store page (kanban
  `WTHS-0000`). Plain client-side HTML/JS (no framework, matching this repo's own established
  stack), real IDUNA email/password login (`POST /api/v1/auth/email/login` or `/register`, JWT
  kept in localStorage), resolves the logged-in player's own GFD character
  (`GET /api/v1/characters/by-player/:id`), lists the real hat catalog (`GET /api/v1/hats`) and
  the character's own owned hats, buys (`POST .../hats/buy`) and equips
  (`PATCH .../hats/equip`) against IDUNA's real Phase 1 endpoints. All calls go through this
  repo's own same-origin `/api/` nginx proxy (new block added to `ops/nginx-wotan.conf`,
  matching `OKEMILY/ops/nginx-okemily.conf`'s own pattern) — no CORS or cross-origin bearer-token
  handling needed. Linked from `index.html`. JS syntax-checked (`node --check` on the extracted
  script); no live/browser verification possible yet since this subdomain isn't deployed
  (`WOTAN-DNS-001` still blocked on an operator running the queued sudo script).
- Real, found-live security fix in IDUNA while building this page: `handleBuyHat`/
  `handleEquipHat` had no ownership check at all — see `IDUNA/CHANGELOG.md`'s own 2026-09-04 (2)
  entry. Fixed before this page could ever reach those endpoints with a real player JWT.

## 2026-09-03

- feat: initial scaffold. Real placeholder `index.html` (matches `OKEMILY/tournaments.html`'s own
  design system — same `:root` palette), `CLAUDE.md`, `README.md`. Kanban `WOTAN-REPO-001`
  ("GITHUB REPO CREATED") — founder pre-created this repo empty; this is the first real commit.
  Not deployed yet — needs `WOTAN-DNS-001` (Cloudflare subdomain) + a real nginx server block
  first.
