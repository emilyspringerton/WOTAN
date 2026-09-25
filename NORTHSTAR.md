# WOTAN NORTHSTAR — Match Stats + Replay (S547, real day-0 build)

Founder real-time, 2026-09-25: "build wotan in front end day 0" → "build in wotan stats and game
replays in browser use emojis for the different items and stuff like we do for
okemily.com/live-match.html." Routed via `emily observe` (obs `2026-09-25T10-46-42Z`, Apple
#20808), curated into `EMILY/BACKLOG.md` SECTION 547. This doc records what was actually built,
why this game/data source, and what's explicitly deferred.

## What this is

`/matches.html` (live at `wotan.okemily.com/matches.html`) — WOTAN's first real match
stats+replay page: a leaderboard, a recent-matches list with filters, and a genuine
round-by-round replay viewer (step controls, an auto-play button, a full round log) for
**DEADWEIGHT**, the card-mode game (`Dark Sector: Hold Battles`'s VS0). Items (cards) render as
an emoji chosen by the card's real kind/keyword, matching the visual convention
`okemily.com/live-match.html` established (hero emoji on REDGARDEN's own live spectator page).

## Why DEADWEIGHT, and not D2 / ECOWAR / SHANKPIT / BRAWLPIT

The task named several candidates and said to check what's actually populated rather than assume.
Checked directly (`IDUNA/var/iduna.db`, live, 2026-09-25):

```
SELECT game, count(*) FROM game_matches GROUP BY game;
  deadweight | 312771
```

Every other row in `internal/games.Registry` (`d2`, `big_o`, `brawlpit`) has **zero** rows in
`game_matches` as of this build — `d2`'s own permission set exists but no server has reported a
real match result yet (D2/D4, "a real placeholder bot," is a separate, not-yet-built phase per
`EMILY/BACKLOG.md`'s own D2 rows). REDGARDEN/ECOWAR/SHANKPIT/BRAWLPIT don't use
`internal/games.Registry`'s per-match table at all — they have their own older, game-specific
leaderboard/ticket handlers (`redgarden_stats.go`, `shankpit_checkpoints.go`, etc.), a real,
separate strand of match data this build didn't try to unify (see Deferred, below).

DEADWEIGHT wins on every axis that matters for a real day-0 build: 312k+ real matches (still
growing live — `dw_server`/3 bot pairs run continuously), a **real, replayable log** already
proven by DEADWEIGHT's own `tests/replay_check.c` ("faithful, replayable record" from `(seed,
each round's two locked slots)`), and WOTAN already has a live, working precedent for reading
`dw_server`'s ndjson logs same-origin (`decks.html`, S519-S536) — this build is an extension of
an already-proven pattern, not a new one.

## Real V0 architecture

**The core decision: replay through the real engine, don't reimplement the rules.** DEADWEIGHT's
match core (`core/match.c`) is a real, nontrivial rules engine (damage triangles, ~30 effect
channels, Dark Pool substitution, etc.) — reimplementing it in JS/Go to reconstruct hull/energy
per round would be a large, drift-prone duplicate. Instead:

1. **`DEADWEIGHT/tools/replay_dump.c`** (new) — reads one raw `matches.ndjson` line on stdin,
   replays it through the actual `core/match.c`/`core/card_rules.c` (the same functions
   `dw_server` itself calls, and the same ones `tests/replay_check.c` already trusts for
   determinism), and prints a full round-by-round JSON trace: hull/energy/armor before each
   round, both hands, the exact card each seat played (declared **and** effective — e.g. a Dark
   Pool substitution shows both), damage/heal/roll/status flags, hull/energy after. Built with
   `scripts/build.sh` (new step, does not touch `dw_server`/`dw_bot`); installed to
   `~/.local/opt/deadweight/bin/dw_replay_dump` (a plain file copy — **the live `dw-server`/
   `dw-bot` systemd services were never touched or restarted** for this work, per this session's
   own standing caution around shared matchmaker processes).
   - **Verified for real, not assumed**: sampled 200 random historical matches (97% clean
     replay — the ~3% failures are pre-retheme/legacy-format lines from weeks-old card-catalog
     revisions, a known, honest gap) and the most recent 300 live matches (**300/300 clean**,
     zero mismatches) — recent matches are exactly what the UI surfaces, so this is the real,
     relevant confidence number.
2. **`IDUNA/internal/matchlog`** (new package) — tails `matches.ndjson` (dw_server's sibling log
   to `decks.ndjson`, which `internal/deckstats` already tails for `decks.html`), keeping the
   most recent 2000 matches in memory (bounded — this is a live/recent feed, not a full archive;
   `game_matches`/`game_player_stats` in SQL remain the durable aggregate record).
3. **`IDUNA/internal/http/handlers/match_replay.go`** (new) — public, rate-limited, read-only:
   - `GET /api/v1/games/deadweight/matches?limit=&offset=&player=&mode=` — recent match list
   - `GET /api/v1/games/deadweight/matches/{id}` — one match's parsed summary
   - `GET /api/v1/games/deadweight/matches/{id}/replay` — shells out to `dw_replay_dump` (5s
     timeout, fresh process per request, never touches the live match services) and forwards its
     JSON verbatim.
   Mounted in `main.go` next to `decks.html`'s own `DeckStatsHandler`, same `/api/v1/games/
   deadweight/` namespace, same public/no-auth/rate-limited shape.
4. **`/matches.html`** (new, WOTAN) — leaderboard tab (real per-player rating/W-L-D/matches from
   the **already-existing, already-public** `GET /api/v1/games/deadweight/leaderboard` —
   `game_online.go`'s `leaderboard()`, no new backend work needed there) + recent-matches tab
   (the new `/matches` list, filterable by player/mode) + a replay view, deep-linkable via
   `#replay-<id>` (same convention `decks.html#deck-451` already uses), with Prev/Next/Play/Last
   controls, a round slider, and a full round log you can also just click through directly.

## Emoji convention

Per-card emoji is assigned by the card's real `kind`+`keyword` (from `data/cards.json`, already
generated by `DEADWEIGHT/scripts/export_cards.sh` for `decks.html`) — checked directly: keyword
only ever appears on Operations cards, a clean 5-way split (Flank/Lock/Scan/Siphon/Sabotage, 7
cards each), Offense/Defense never carry one. So 7 emoji cover the whole 105-card catalog exactly,
no per-card hand-authoring needed (unlike `live-match.html`'s own hand-synced 28-entry
`HERO_EMOJI` array, which has no such clean underlying grouping to key off):

| Kind / keyword | Emoji |
|---|---|
| Offense | ⚔️ |
| Defense | 🛡️ |
| Operations · Flank | 🦅 |
| Operations · Lock | 🔒 |
| Operations · Scan | 📡 |
| Operations · Siphon | 🧲 |
| Operations · Sabotage | 💣 |

## Verification (real, not assumed)

- `go build ./...` / `go test ./...` clean across all of IDUNA, including new
  `internal/matchlog` tests (tail/incremental-line/eviction) and
  `internal/http/handlers/match_replay_test.go` (list/one/404/400, plus a real end-to-end test
  that **builds `dw_replay_dump` from the sibling DEADWEIGHT checkout and replays a real
  5-round match**, asserting a clean, complete, 5-round trace).
- `iduna.service` rebuilt and restarted (routine for this service, same precedent
  `friends.html`'s own S536 work already used) — **the DEADWEIGHT `dw-server`/`dw-bot@*`
  services were never restarted or touched**, matching this session's own standing caution
  around shared, live matchmaker processes.
- Live round-trip against the real, running API: `curl` against
  `localhost:8080/api/v1/games/deadweight/matches`, `/matches/{id}`, `/matches/{id}/replay` all
  verified against real, current match data before deploy.
- Deployed via the existing `~/wotan-deploy.sh` (plain rsync, no service restart).
- **Live-verified in a real (headless Chromium, via Playwright) browser against the deployed
  `wotan.okemily.com/matches.html`**: zero console/page errors; the recent-matches list renders
  30 real live matches; the leaderboard tab renders real ratings (including bots at 70k+ matches
  and real human players, e.g. the founder's own `emilyspringerton` row); clicking a match row
  loads and renders a real replay; the Next button steps the round counter and the hull bars
  update correctly round-to-round (verified 17/20 · 19/20 hull at round 3, consistent with the
  logged -3/-1 damage in rounds 1–3); confirmed at both desktop (1100px) and phone (390px)
  width. **Honest gap**: this sandbox's headless Chromium has no color-emoji font installed, so
  the emoji rendered as monochrome fallback glyphs in the screenshot rather than full color —
  the underlying Unicode codepoints are correct and every mainstream browser/OS ships a color
  emoji font, but true color rendering wasn't visually confirmed here (same class of caveat
  `friends.html`'s own CLAUDE.md entry already carries for its own untested-on-a-real-device gap).

## Deferred (named explicitly, not silently dropped)

- **Other games.** D2 (zero real matches yet — comes back into scope once D4's placeholder bot
  ships and reports real results), REDGARDEN/ECOWAR/SHANKPIT/BRAWLPIT (each has its own
  game-specific stats surface already; unifying them into this same match-list/replay shape is
  real, separate work, not started).
- **Richer replay controls**: no scrub-by-drag-while-playing, no keyboard shortcuts, no
  speed control on auto-play (fixed 1.4s/round), no shareable "start at round N" beyond the
  match-level `#replay-<id>` deep link.
- **Per-card visual polish**: card chips show name+emoji+cost/power, not a full "card face"
  (decks.html's own `.face` treatment) — a deliberate real-V0 cut, not an oversight.
- **Historical replay coverage**: pre-retheme / older-format `matches.ndjson` lines (~3% of a
  random historical sample) don't replay cleanly against the current rules engine — out of scope
  for a day-0 build; the recent-matches window this page actually surfaces is unaffected (300/300
  verified).
- **Phone-width table density**: the recent-matches table is readable but tight at 390px width —
  no horizontal-scroll treatment like `decks.html`'s own nav bar has. Noted, not fixed here.
- **In-memory recency window**: `matchlog.Store` keeps the most recent 2000 matches only (a few
  hours at current bot-pool throughput) — a match older than that 404s from `/matches/{id}` and
  `/replay` even though it's still in `matches.ndjson` on disk and in `game_matches` in SQL. A
  real "look up any historical match_id" path (reading directly from the SQL `game_matches` row,
  which has `seed`/`winner`/`rounds` but not the full `plays` array a replay needs) is real,
  separate future work, not started.

## Related

- `EMILY/BACKLOG.md` SECTION 547 — the founder-direction source and its curated scope.
- `DEADWEIGHT/tests/replay_check.c` — the existing precedent this build's replay-fidelity
  confidence is built on.
- `WOTAN/decks.html` / `IDUNA/internal/deckstats` — the sibling read path (`decks.ndjson`) this
  build's own `matches.ndjson` path directly mirrors.
- `IDUNA/internal/http/handlers/game_online.go`'s `leaderboard()`/`stats()` — the existing,
  already-public per-player aggregate endpoints this page's Leaderboard tab reuses as-is.
