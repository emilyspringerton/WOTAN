# WOTAN — wotan.okemily.com (planned)

## What this is

The real, dedicated codebase for WOTAN, EINHORN_INDUSTRIAL's esports/stats hub — split out of
`OKEMILY/tournaments.html` (a single static page inside the OKEMILY marketing site) into its own
repo/subdomain now that real feature work is scoped against it (kanban `WOTAN-999`/`WOTAN-998`/
`WOTAN-996`, see `BRAWLPIT/docs/WOTAN_HAT_STORE_NORTHSTAR.md`) and it needs its own DNS
(`WOTAN-DNS-001`, real Cloudflare key at `EMILY/var/cloudflare.md`).

**Upstream repo pre-created by the founder 2026-09-03, empty** — this scaffold is the first real
commit. Matches the same "new repo, real minimal first commit, not a live founder ask" pattern as
`LO`/`SPIDERBEETLE`/`EMILY_FOR_BUSINESS` (see `/home/fatbaby/CLAUDE.md`'s own repo table).

**Not yet live.** No DNS record exists yet (`WOTAN-DNS-001` is a separate, open priority-queue
card), no server block, no deploy script. This repo currently holds a real placeholder page only.

## Stack

Plain static HTML/CSS, no build step — deliberately matching `OKEMILY`'s own convention (fast,
near-zero footprint, trivially administrable by Claude Code: edit → commit → deploy). The real
hat-store/pixel-editor feature work scoped in `BRAWLPIT/docs/WOTAN_HAT_STORE_NORTHSTAR.md` will
need a real backend eventually (Phase 2 of that doc) — deferred, not decided yet.

## Real, current status

- `index.html` — real placeholder landing page (esports hub branding, "coming soon" framing),
  matching `OKEMILY/hats.html`'s own honest-placeholder precedent (every purchase/feature control
  visibly disabled, not faked as live).
- No deploy pipeline yet — needs `WOTAN-DNS-001`'s own Cloudflare subdomain + a real nginx server
  block (matching `OKEMILY/ops/nginx-okemily.conf`'s own pattern) before this can go live.

## Related

- `BRAWLPIT/docs/WOTAN_HAT_STORE_NORTHSTAR.md` — the real, scoped hat-store feature plan.
- `OKEMILY/tournaments.html` — the original single-page version this repo is splitting WOTAN out
  of; not deleted, stays as the live page until this repo actually replaces it.
- `EMILY/var/cloudflare.md` — real Cloudflare API token for the subdomain work (`WOTAN-DNS-001`).
