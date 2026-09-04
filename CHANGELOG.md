# Changelog

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
