# WOTAN

Esports/stats hub for EINHORN_INDUSTRIAL (`wotan.okemily.com`), being split out of `OKEMILY/tournaments.html` into its
own repo/subdomain. Plain static HTML/CSS/JS, no build step. See `CLAUDE.md` for status and related docs.

## What is live

- **`/decks.html` — DEADWEIGHT Draft Decks** (open to everyone, no account): every deck drafted in DEADWEIGHT's draft
  queue with its win/loss/draw record, filterable (players / bots, min games, player name, "only decks with this
  card"), sortable (sample-size-adjusted "Best", raw win rate, most games, newest), each deck's cards as chips with a
  **big card tooltip on hover** (tap on phones; keyboard focus works too) and an expandable full-deck card grid; a
  **Cards** tab with every card's record across all decks. Deep links: `/decks.html#deck-451`, filters live in the URL.
- `/store.html` — the BRAWLPIT hat store (IDUNA login).
- `/` — landing page.

## How the deck browser gets its data

- `GET /api/v1/games/deadweight/decks`, `/decks/{id}`, `/card-stats` — public, read-only, rate-limited endpoints in IDUNA
  (`internal/deckstats`, `internal/http/handlers/deck_stats.go`) that tail `dw_server`'s `decks.ndjson`
  (`DEADWEIGHT_DECK_LOG`, default `/home/fatbaby/DEADWEIGHT/var/matches/decks.ndjson`). The nginx `/api/` proxy
  (`ops/nginx-wotan.conf`) forwards them, so the page is same-origin.
- `data/cards.json` — the 105-card catalog (kind, keyword, cost, power, text) for the tooltips, **generated** from DEADWEIGHT's rules and card text:
  `cd DEADWEIGHT && scripts/export_cards.sh` (re-run after any card change).

Decks drafted before the 2026-09-19 Offense/Operations/Defense retheme were archived server-side (`decks.pre-retheme.ndjson`) and are not shown.

## Deploy

`~/wotan-deploy.sh` (rsync to `/var/www/wotan`). Accounts (tournaments, deck tools) are planned; the header's "Sign in"
button is deliberately disabled until they exist.
