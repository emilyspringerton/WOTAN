# WOTAN Identity Federation — Phase 2b (Linked Accounts, Battle.net, Twitch, Upload Keys)

Status: **design + build plan**, 2026-10-12. Sibling of `CLUBS_NORTHSTAR.md` (Phase 2). Source: founder-pasted
Gemini design chat on account linking ("INGEST AND PLAN THE FULL INTEGRATION — it directly impacts Teams").
Everything here is IDUNA-resident; WOTAN is a static front end over IDUNA's API.

## 0. Why this directly impacts Clubs

Clubs (Phase 2) authorize by `permission + club_id` against a **player**. Telemetry routing, "verified rank"
badges, Claimed Decks ("first streamed by"), roster ego-play and the Legend-rank badge all assume the player has a
*trustworthy in-game identity*. Phase 2 shipped with a self-declared rank and an upload token that proves only
"some signed-in IDUNA account", never "this is the BattleTag in the log". This phase supplies the missing
identity layer and tightens three Phase 2 behaviors (§7).

## 1. Source reconciliation — what the chat said vs. what is true / what we decide

| # | Chat claim | Decision |
|---|---|---|
| I1 | "Log in with Blizzard shares `sub`, `battletag`, `id`." | Correct for Battle.net OIDC (`openid` scope, `https://oauth.battle.net/userinfo` → `sub`, `id`, `battletag`). **Scope = `openid` only.** The chat's `wow.profile`/`sc2.profile` scopes are unrelated games and are *not* requested. `sub` is the anchor; BattleTag is mutable display data and is refreshed on every link/login. |
| I2 | "One Battle.net ID links NA/EU/APAC smurfs; peak NA #12 / EU #45 / APAC #89." | **Partly wrong.** Hearthstone regions are regions of *one* Battle.net account (one BattleTag). True smurfs are *separate* Battle.net accounts and OAuth cannot enumerate them. So bundling = a user links **N Battle.net identities** by completing OAuth once per account (N-to-1 onto one WOTAN player). Per-region peak comes from region-scoped rank rows, not from bundling. |
| I3 | "Verified Legend checkmark… mathematically impossible to forge." | Overstated. Blizzard's OAuth token does not expose Hearthstone rank. Verification = match the public Hearthstone leaderboard entry's account name against the linked BattleTag *name part*; collisions across discriminators are possible, so the badge says **"Leaderboard-matched"**, not "cryptographically verified". Still CLUBS-08, now unblocked on a real identity (§6). |
| I4 | Google/IDUNA-email users get "social only"; Battle.net is the premium door. | Adopted. Login page: Battle.net primary, Google + IDUNA email secondary. Gate sits on **actions**, not on login (§5). |
| I5 | "Merge Google and Blizzard under one master user." | IDUNA has no master-user table today — players are `(provider, provider_sub)` rows and `hs_profiles` is keyed by the JWT `sub` (= `player_id`). Decision: keep `player_id` as the master id and add `player_identities` (§3) rather than inventing a second id. A login via *any* linked provider resolves to the same `player_id`. |
| I6 | Long-lived `wt_tok_…` embedded in a one-line `irm … \| iex; Start-WotanTracker -Token …`. | Adopted as an **upload key** with changes: random 32-byte, `wt_` prefix, **stored hashed**, shown once, scoped to `hs.live.upload` only, revocable/rotatable, per-key last-used + counters. The uplink exchanges it at init for the *existing* 12 h upload JWT so the ingest path is unchanged. A key in a command line lands in shell history and AV logs, so the dashboard also offers a "paste once, key saved to `%APPDATA%` DPAPI file" variant (§4). The chat's `irm ://okemily.com` URL is malformed; real URL comes from settings. |
| I7 | "If the BattleTag in the log doesn't match, silently drop." | Drop, but not *silently to the owner*: increment a per-key `rejected_tag_mismatch` counter surfaced in settings ("14 uploads rejected: BattleTag not linked"). Attacker sees nothing different; owner sees why their stats are missing. Match is against the **set** of the player's linked BattleTags (smurfs). |
| I8 | Twitch scopes `user:read:email`, `channel:read:stream_key`. | **Rejected.** Never request the stream key. Identity only: `user:read:email` is also unnecessary (no email use). Live-check uses Helix `streams` with an **app access token** (no user scope). Chat-bot `!deck` is a *separate, later, opt-in* `chat:read chat:edit` scope grant. |
| I9 | Twitch name displayed instead of BattleTag; link BattleTag↔Twitch. | Adopted. Display name resolution: `twitch_login` if linked **and** user opted "show Twitch name", else WOTAN handle. BattleTag is never shown publicly unless the user opts in (privacy: Phase 2 R-series). |
| I10 | "First Streamed By" awarded if Twitch says the user is live when the deck is first uploaded. | Adopted as **Claimed Decks v2**: `claimed_by` already = first publisher (Phase 2 R7); add `first_streamed_live=1` flag set at ingest when Twitch `streams` says live (cached 60 s). Flag is cosmetic only, never affects authz. |
| I11 | Gate downloading the tracker and creating a Club behind Battle.net link. | Adopted (§5), with grandfathering and an explicit escape hatch for operators. |

Honest gap: **Power.log contains the BattleTag only for the local player in logged games where `PlayerName=` is
populated** (the existing parser already reads `PlayerName=` from `DebugPrintGame`). Practice/AI games may carry
a generic name; those are accepted as `unverified_tag` and routed `private` only (§4.3).

## 2. Provider model

| Provider | Purpose | Login door? | Link door? | Unique key |
|---|---|---|---|---|
| `battlenet` | Competitive identity, upload-key issuance, rank match | yes (primary) | yes (multiple) | `sub` |
| `google` | Accessibility / social | yes (exists) | yes | `sub` (verified email only) |
| `iduna_local` | Email/password | yes (exists) | n/a | player row |
| `twitch` | Streamer layer: display name, live flag, later chat bot | **no** (settings only, per chat) | yes (one per player) | Twitch `sub`/user id |

Rules (non-negotiable):
- **Link only from an authenticated session**; OAuth `state` is bound to that session's `player_id` + a nonce
  (CSRF/account-link-hijack defence). Never auto-link by email or by BattleTag string.
- A `(provider, provider_sub)` pair links to **at most one** player. Attempting to link one already owned by
  another player returns `identity_taken` with a *non-leaking* message; merging two existing players is an
  explicit, re-authenticated, **operator-assisted** action in v1 (§8), not self-serve.
- Unlinking: `battlenet` identity cannot be removed if it is the player's last **login** door *and* they have
  active upload keys (revoked first). Last login door of any kind can never be removed.
- First-ever login via Battle.net creates a new player: `provider='battlenet'`, display name from BattleTag name
  part, no email.

## 3. Data model (`IDUNA/migrations/truestore/202610130001_wotan_identity.sql`)

```
player_identities(
  id PK, player_id, provider,            -- battlenet|google|twitch
  provider_sub UNIQUE with provider,
  display TEXT,                          -- battletag / twitch login / google email (never public by default)
  extra_json TEXT,                       -- region hints, twitch broadcaster_type, ...
  verified INT, linked_at, last_login_at, last_refreshed_at,
  status TEXT DEFAULT 'active'           -- active|revoked
)
hs_upload_keys(
  id PK, player_id, key_prefix TEXT,     -- first 8 chars for UI ("wt_ab12cd")
  key_hash TEXT UNIQUE,                  -- sha256(key)
  label, created_at, last_used_at, revoked_at,
  uploads_ok INT, rejected_tag_mismatch INT
)
hs_player_prefs(player_id PK, show_twitch_name INT, show_battletag INT, ...)   -- extends/reuses hs_settings if it already fits
hs_games.battletag_id INT NULL           -- player_identities.id the game was attributed to
hs_games.first_streamed_live INT DEFAULT 0
```

Migration is additive. Backfill: every existing `players(provider in google|iduna_local)` row gets a
`player_identities` row so login resolution is uniform. Only SQLite is exercised in tests; the MySQL path is
written to the same dialect rules as `202610120001` (open item CLUBS-07).

## 4. Flows

### 4.1 Login / link (Battle.net)
`GET /api/v1/auth/sso/battlenet/start?redirect_uri=…[&mode=link]` → state cookie → Blizzard authorize
(`https://oauth.battle.net/authorize`, `scope=openid`, region `us` default; EU/KR/TW selectable, same
account). `…/callback`: exchange code, call `userinfo`, then
- **login mode**: identity exists → mint the normal IDUNA player JWT for its `player_id`; absent → create player + identity.
- **link mode**: state's `player_id` must equal the session; identity absent → attach; owned by self → refresh
  battletag; owned by other → `identity_taken`.
Disabled (404 `provider_not_configured`) unless `BNET_CLIENT_ID/BNET_CLIENT_SECRET` are set — registering the
Battle.net application is a **human-only step** (develop.battle.net), same class as the Google redirect-URI note.

### 4.2 Twitch link
`GET /api/v1/hs/me/identities/twitch/start` → Twitch authorize with **no scopes** (identity via `openid`
claims only) → callback attaches `twitch` identity. Nothing else; chat bot is out of scope here.

### 4.3 Upload key + uplink
1. Settings → "Tracker" → requires ≥1 active `battlenet` identity (§5) → `POST /api/v1/hs/me/upload-keys` →
   `{key, prefix}` returned **once**.
2. One-liner is generated client-side from the key (installer URL from settings), plus a DPAPI-store variant.
3. Uplink init: `POST /api/v1/hs/live/exchange` `{key}` → `{token(12h hs-live-upload JWT), tags_linked:n}`.
4. At ingest of a completed game (existing `hs_live.go` path): parse local `PlayerName`; if it equals a linked
   BattleTag → attribute (`battletag_id`), full routing (§Clubs 6). If absent/generic → `unverified_tag`,
   force `visibility='private'`. If it is a *different* BattleTag-shaped string (`name#digits`) not linked →
   drop + `rejected_tag_mismatch++`. Rate-limited per key.
5. Revoke: `DELETE /api/v1/hs/me/upload-keys/{id}` — takes effect immediately (exchange refuses; live JWT
   remains valid ≤12 h → on revoke the session is also tombstoned in `hsSessions`).

## 5. Gates

| Action | Requires | Why |
|---|---|---|
| Browse, comment, follow, join club (invite/public), view meta | any signed-in identity | accessibility |
| Mint upload key / download tracker | ≥1 active Battle.net identity | integrity of telemetry |
| **Create** a club (`wotan.club.create`) | ≥1 active Battle.net identity (new; was "any HS handle") | clubs carry competitive claims (OQ-1 tightened) |
| Contribute club telemetry (`club.telemetry.contribute`) | membership + a game attributed to a linked tag | Phase 2 rule + identity |
| Rank badge "leaderboard-matched" | linked Battle.net + matching leaderboard row | I3 |

Grandfathering: players who already created clubs or have an upload-capable history keep working for **30 days**
(`grace_until` on the player) with a banner; after that the gate applies. Operators may grant an override
permission `wotan.identity.bypass` (platform) for tournament organizers/tests.

## 6. Rank verification (unblocks CLUBS-08)
Job (IDUNA cron, not request path): poll public Hearthstone leaderboards (per region/format) → upsert
`hs_player_rank{verified=1, source='leaderboard', region, rank, season}` for any player with a linked BattleTag
whose *name part* matches exactly one leaderboard `accountid`; ambiguous matches stay unverified and are listed
for Back Office review. Smurf bundling falls out for free: each linked tag matches independently, profile shows
best-of and per-region lines.

## 7. Phase 2 behaviors this changes
1. `wotan.club.create` implicit grant: now **also** requires a linked Battle.net identity (+ grace).
2. Club-context and upload JWT issuance unchanged in shape; `sub` stays `player_id`. `club_aud` rejection tests stay.
3. Roster ego-play: show Twitch name (opt-in) as the display handle; rank badge text "Leaderboard-matched".
4. Sync-target ingest: games with `unverified_tag` can only be `private` (cannot be force-routed to a club).
5. Contributors boards group by `player_id` (not by tag) so smurfs aggregate.

## 8. Admin surfaces
- **Settings (user)**: Linked accounts list (add Battle.net ×N, Google, Twitch; unlink with last-door guard);
  Upload keys (create/rotate/revoke, last used, accepted/rejected counts); privacy toggles (show Twitch name,
  show BattleTag).
- **Back Office `/admin/identities`** (`iduna.admin`, reason required + audit like `/admin/clubs`): search by
  player/BattleTag/Twitch; view identities & keys; force-unlink; revoke key; `identity_taken` dispute queue;
  operator-assisted **merge** (two players → one, re-pointing identities, keys, hs_profiles, memberships;
  refused if both are members of the same exclusive club until resolved).
- **IDUNA permission catalog**: `wotan.identity.link`, `wotan.identity.unlink`, `wotan.uploadkey.manage`,
  `wotan.identity.admin` (Back Office), `wotan.identity.bypass`.

## 9. Delivery plan
| Chunk | Scope | Owner |
|---|---|---|
| ID-A | Migration + identity resolution + Battle.net SSO + Twitch link + identities API + upload keys + exchange + ingest tag binding + gates + permissions + `/admin/identities` + tests | IDUNA |
| ID-B | WOTAN: login-page order (IDUNA-hosted SSO page button), Linked accounts + Upload keys in settings, tracker gate modal, uplink installer/exchange, Twitch display name & badges, affordance test | WOTAN + HRIP uplink |
| ID-C | Rank-verification job | IDUNA (follow-up, needs live leaderboard shape) |
| ID-D | Deploy + register Battle.net/Twitch apps (human), real OAuth round trip | founder/ops |

## 10. Open questions (provisional)
- **IQ-1** Grace window for existing club creators/uploaders: 30 days (provisional).
- **IQ-2** Should Twitch be allowed as a *login* door later? Provisional: no, per chat; revisit with streamer demand.
- **IQ-3** Self-serve player merge vs operator-assisted only? Provisional: operator-assisted in v1.
- **IQ-4** Show BattleTag publicly ever? Provisional: opt-in only.
- **IQ-5** Region for Battle.net OAuth endpoint: single global (`oauth.battle.net`) provisional; CN excluded.

## 11. Not verifiable here
Real Blizzard/Twitch OAuth round trips (need registered apps — human step); live leaderboard shape; Windows
uplink; MySQL. Code is tested through injectable exchange/userinfo seams exactly like `sso_google.go`.
