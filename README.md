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
- **`/profile.html` — public DEADWEIGHT player profiles** (no login): look up any player by
  Player ID, see rating/W-L-D/matches/friend count.
- **`/friends.html` — DEADWEIGHT friends & duels** (S536/S537, 2026-09-24): log in with a
  DEADWEIGHT account (email/password, set via the client's own "link email" flow — a guest-only
  account can't sign in here) to send/accept/decline friend requests, list friends, remove a
  friend, and challenge a friend to a friendly-challenge duel. This is a **separate credential
  system from the Hat Store's IDUNA login** — DEADWEIGHT accounts and IDUNA platform accounts are
  different identities (`IDUNA/internal/http/handlers/game_online.go`'s per-game `players` table
  vs. IDUNA's own `users` table). Honest limit: no player-search-by-name yet, so adding a friend
  means sharing your Player ID directly; turning an accepted duel into a live match instance is
  real, named, deferred work (see `EMILY/BACKLOG.md` SECTION 537) — an accepted duel today just
  means "it's on," not an automatic match launch.
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
