# Changelog

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
