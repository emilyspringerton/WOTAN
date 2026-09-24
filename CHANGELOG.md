# Changelog

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
