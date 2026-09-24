# WOTAN

`wotan.okemily.com` — the online social tournament site for EINHORN_INDUSTRIAL, and (2026-09-24) the real front door:
`index.html` no longer defers to `OKEMILY/tournaments.html`, it's the other way around now (that page keeps its own
distinct live content — REDGARDEN leaderboard, hero stats, GFD Battlegrounds demo, mailing list — and links forward to
here). Plain static HTML/CSS/JS, no build step. See `CLAUDE.md` for status and related docs.

**Look**: BRAWLPIT "neon brutalist" art direction (2026-09-24) — near-black violet background,
violet primary accent, a gold secondary accent, one shared stylesheet (`css/wotan-theme.css`)
across every page. Dark-only by design.

## What is live

- **`/decks.html` — DEADWEIGHT Draft Decks** (open to everyone, no account): every deck drafted in DEADWEIGHT's draft
  queue with its win/loss/draw record, filterable (players / bots, min games, player name, "only decks with this
  card"), sortable (sample-size-adjusted "Best", raw win rate, most games, newest), each deck's cards as chips with a
  **big card tooltip on hover** (tap on phones; keyboard focus works too) and an expandable full-deck card grid; a
  **Cards** tab with every card's record across all decks. Deep links: `/decks.html#deck-451`, filters live in the URL.
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
