# WOTAN PHASE 2 — CLUBS (TEAMS) — NORTHSTAR (2026-10-12)

Founder real-time, 2026-10-12: ingest the Clubs/Teams spec (a multi-turn design chat) into a Phase 2
document for WOTAN — **clubs (teams), granular controls, the full admin interfaces and the full granular
IDUNA permission model**; the rest of the platform functionality is already laid out. Ingest first, plan,
then execute with a few parallel agents. Routed via `emily observe` (session `sess-20261009-1745-ee80b668`).

Phase 1 of WOTAN is everything already live: IDUNA SSO, DEADWEIGHT decks/matches/friends, SHANKPIT and
REDGARDEN boards, hat store, and the Hearthstone decks + socials + live tracker
(`HEARTHSTONE_NORTHSTAR.md`). Phase 2 adds the **group layer** on top of it: a player can belong to clubs,
clubs have roles, privacy tiers, a members-only workspace, a public roster "flex" page, and routed
telemetry from the tracker uplink.

---

## 0. Source reconciliation (what the chat said vs. what this doc decides)

The source chat evolved over several turns and contradicts itself in places. This doc is the single
reconciled version; where it deviates from the chat the reason is named.

| # | Chat said | Decision here | Why |
|---|---|---|---|
| R1 | Visibility is **Public vs Stealth** (turn 1), later **Secret / Private / Social** + `is_exclusive` (turn 3) | **Use the 3-tier model + exclusive flag.** Stealth ≡ Secret; Public splits into Private (roster flex only) and Social (roster + shared decks) | Turn 3 explicitly supersedes turn 1 and is a strict superset |
| R2 | "Spy assumption: never limit one club per account" **and** `is_exclusive` = "1-club lock" | **Multi-club is the default; exclusivity is an opt-in per club** (§3.4). Both are true: nothing is hard-coded to 1, but a club may *choose* to lock its members | Reconciles the two without special-casing accounts |
| R3 | Club role + `club_id` live in the **JWT** and IDUNA returns 403 | **JWT carries only coarse platform permissions; the compound `permission + club_id` is evaluated server-side from membership rows** on every request. A short-lived **club-context JWT** can be minted for external verifiers (§4.3) | A person can be Manager of club A and Player of club B at once; a flat `permissions` array cannot express that, and a baked-in role goes stale the instant someone is demoted/kicked. DB-checked is instantly revocable |
| R4 | "Official Blizzard Legend Rank" shown beside every gamertag, "verified" | **Rank is modelled with a `verified` flag; v0 ships self-declared + BattleTag-ownership-verified, rank-verified is a named later phase** (§8) | Checked directly: there is **no legend-rank data source anywhere** in the tracker/IDUNA today (`hstracker`, `hs_live`, `hs_games` carry BattleTags and results, not rank). Claiming "verified" without a source would be fabricated |
| R5 | Private tier: win rates "100% hidden"; ego section: "Most wins this week" on public clubs | **Internal matchup matrix is always members-only. A contributor leaderboard ("most wins this week") is public only for Social clubs, only if the manager enables it, and only for members who opted in to public visibility** | Resolves the Private-vs-ego contradiction with explicit, auditable switches |
| R6 | "IDUNA returns 403 for another team's analytics" | **403 for non-members of Private/Social clubs; 404 for Secret clubs** (no existence leak) | A 403 on a Secret club would confirm it exists, defeating "404 if an outsider guesses the URL" |
| R7 | Invite URL `://okemily.com<token>` (garbled) | `https://wotan.okemily.com/clubs/join.html#<token>` — token in the **URL fragment**, redeemed via POST | Fragment never reaches server logs, proxies or Referer headers |
| R8 | "Claimed Decks" = off-meta decks a player "invented" | **Claim = first publisher of that canonical deckstring** (earliest `hs_decks.created_at`); not proof of invention | Only provable thing in the data; honest label in the UI |
| R9 | PowerShell client "downloads the preference flag" and uploads to target repo | **The client never names a club.** Server resolves the target from the stored sync preference and **re-verifies membership at ingest time** (§6) | A client that names `club_id` is a cross-tenant injection vector |

---

## 1. Domain vocabulary

- **Club (Team)** — a group entity: competitive lineup, practice group, or community faction. Identified by
  an immutable `id` (UUID) and a unique, case-insensitive `slug` (3–30, `[a-z0-9-]`).
- **Member** — an IDUNA identity (JWT `sub`) with a **role** in a club. One IDUNA account may hold
  memberships in many clubs. Requires a Hearthstone **handle** (existing `hs_profiles`) to join — handles
  are the public name everywhere.
- **Roles**: `manager` (admin) › `coach` › `player`. The club **owner** is a manager flagged on the club
  row (`owner_sub`); ownership is what makes delete/transfer unambiguous.
- **Privacy tier**: `secret` (1) · `private` (2) · `social` (3).
- **Exclusive**: boolean; locks members to this one club (§3.4).
- **Workspace** — the members-only internal dashboard (roster wall, strategy feed, scrim aggregator).
- **Sync target** — per-user routing preference for tracker telemetry: `personal` | `club:<id>` | `none`.

---

## 2. Role hierarchy & granular permission matrix

### 2.1 Club-scoped permission nodes (the full granular set)

Dotted, hierarchical, evaluated as `(actor, node, club_id)`. Nodes are the unit of both enforcement and
UI affordance; roles are only named bundles of them.

| Node | Meaning | player | coach | manager |
|---|---|:-:|:-:|:-:|
| `club.view` | see the workspace shell | ✓ | ✓ | ✓ |
| `club.roster.view` | internal roster wall | ✓ | ✓ | ✓ |
| `club.feed.read` | read strategy feed | ✓ | ✓ | ✓ |
| `club.feed.post` | post / comment | ✓ | ✓ | ✓ |
| `club.feed.moderate` | delete others' posts, pin | | ✓ | ✓ |
| `club.decks.read` | internal shared deck profiles | ✓ | ✓ | ✓ |
| `club.decks.feature` | pick decks for the public page | | ✓ | ✓ |
| `club.analytics.view` | matchup matrix / contributor stats | ✓ | ✓ | ✓ |
| `club.telemetry.contribute` | route own match data here | ✓ | ✓ | ✓ |
| `club.members.invite` | create/revoke invite links (role ≤ player) | | ✓ | ✓ |
| `club.members.invite.elevated` | invites that grant coach/manager | | | ✓ |
| `club.members.requests` | decide join requests | | ✓ | ✓ |
| `club.members.remove.player` | remove a Player | | ✓ | ✓ |
| `club.members.remove.coach` | remove a Coach | | | ✓ |
| `club.members.remove.manager` | remove another Manager | | | ✓ (not owner) |
| `club.members.promote` | Player→Coach, Coach→Manager | | | ✓ |
| `club.members.demote` | lower anyone below Owner | | | ✓ |
| `club.settings.edit` | name, tagline, branding, description | | | ✓ |
| `club.visibility.set` | privacy tier, exclusive, join policy | | | ✓ |
| `club.audit.view` | club audit log | | | ✓ |
| `club.owner.transfer` | hand ownership to another manager | owner only |
| `club.delete` | delete the club | owner only |

Self-service actions that need no node: **leave club** (except the last manager/owner — must transfer
first), and **edit own roster presentation** (`public_visible`, `show_badge`, §5.3).

### 2.2 Hierarchy invariants (enforced in one function, unit-tested as a table)

1. An actor may only remove/demote a target whose rank is **strictly lower**, except Managers, who may
   act on other Managers (but never the Owner).
2. A Coach can never touch another Coach or any Manager (matrix rows above; also enforced by rank).
3. Nobody can grant a role higher than their own; Coaches' invites are capped at `player`.
4. **The last Manager cannot be removed, demoted or leave**; the Owner can only be changed through
   `owner.transfer` or a platform-admin action.
5. A user cannot change their own role (no self-promotion, even for Managers).
6. All mutations are idempotent-safe and run in a transaction that re-reads the actor's *current* role.

### 2.3 Platform-level permissions (IDUNA permission catalog, JWT-bearable)

Registered via migration into IDUNA's `permissions` table (same convention as
`202609050002_mailinglist_admin_permission.sql`, granted to `super_admin`):

| Permission | Who | Gates |
|---|---|---|
| `wotan.club.create` | every signed-in player (default) | `POST /api/v1/clubs`; capped per user (§7.3) |
| `wotan.clubs.admin` | platform operators, M2M agents | JSON admin API: suspend, delete, transfer, force-tier |
| `wotan.clubs.moderate` | platform moderators | read-only admin API + reports queue + takedown of posts |
| `iduna.admin` (existing) | Back Office humans | the `/admin/clubs/*` HTML console (existing cookie gate) |

The three in-club roles in the original sketch (`wotan.club.admin|coach|player`) are kept as **role names
exposed in the club-context token** (§4.3), not as global permissions — a global `wotan.club.admin` would
make someone admin of *every* club, which is exactly the cross-tenant hole the spec forbids.

---

## 3. Privacy model

### 3.1 The three tiers

| | **Secret** (1) | **Private** (2) | **Social** (3) |
|---|---|---|---|
| Directory / search | never | listed | listed |
| Public club page | **404** to non-members | roster-only landing page | full page: roster, featured decks, achievements |
| Roster visible publicly | no | yes (opted-in members) | yes (opted-in members) |
| Role badges 👑 📋 ⚔️ | members only | public | public |
| Appears on member profiles | **no** (members of the same club see it) | yes (unless member hid) | yes (unless member hid) |
| Shared decks / feed | members only | **members only** | featured decks public; feed stays members-only |
| Win rates / matchup matrix | members only | members only | members only (contributor board optional, §0-R5) |
| Join | invite only | invite only | invite or request (`join_policy`) |

### 3.2 Toggling (the "tournament reveal")

The manager "Stealth Toggle" becomes a **tier selector with memory**: switching to Secret stores
`prev_tier`; "Reveal" restores it in one click. Tier changes are audit-logged and take effect on the very
next request (no caches on club reads — `Cache-Control: no-store`, same as `hs_social.go`).

### 3.3 Page-level leak rules

- Secret clubs are excluded from: directory, search, sitemap, "mutual clubs", counts on profiles, error
  messages (no "club exists but you can't see it"), and the cross-club `hs_reports` surface.
- Invite redemption for a Secret club shows the invite holder the club name — they hold the invite.
- A Social/Private club's public view is a **projection**: the handler builds it from an allow-list of
  fields; internal fields are never selected, so a new column cannot leak by default.

### 3.4 Exclusive clubs (opt-in 1-club lock)

- `is_exclusive = true` ⇒ every member holds **no other membership** (Secret clubs count).
- Joining an exclusive club while in another club → `409 {code:"exclusive_conflict"}`; joining any club
  while in an exclusive one → same. Both messages are about the actor's own memberships only.
- Turning exclusive **on** is refused while any member also belongs to another club; the response lists
  those members (managers need that to act) — only for members of the manager's own club.
- Turning it off is always allowed. Multi-club remains the default for every other club.

---

## 4. IDUNA fine-grained security layout

### 4.1 One choke point

Every club endpoint goes through a single guard:

```
guard(r, club_ref, node) → (club, role, perms) | 401 | 403 | 404
  1. authenticate JWT (existing hs_social.go viewer())            → 401 if required & absent
  2. load club by id/slug; deleted/suspended handling
  3. load actor's membership row (club_id, sub)                    → role
  4. perms = matrix[role]; platform admin overrides audited, never silent
  5. if node ∉ perms: Secret & non-member → 404; else 403
```

No handler reads `club_id` from a body or query for authorization — only from the guard-validated path
parameter. Every workspace query is `WHERE club_id = ?` with that value; a repository-level helper makes
the unscoped query un-writable (`store.ForClub(guard)`).

### 4.2 Cross-tenant isolation tests (non-negotiable)

For each internal endpoint, tests assert: member-of-A requesting club B → 403/404; coach-of-A acting as
coach on B → 403; tampered `club_id` in body ignored; removed member's still-valid JWT loses access on
the next request (the stale-token case R3 exists to solve).

### 4.3 Club-context token (for external verifiers)

`POST /api/v1/clubs/{id}/token` (members only) → ES256 JWT, `aud: "wotan-club"`, TTL 15 min, claims
`sub`, `club_id`, `club_role`, `permissions: ["club.manage.players", …]` (the effective node list for that
role). Signed with IDUNA's existing keys and published via the existing JWKS, so other services
(EDGE.GAME, future club-scoped apps) can verify offline. WOTAN's own API **does not trust this token for
authorization** — it re-reads membership — so revocation is immediate.

### 4.4 Audit

`club_audit_log` (append-only; no update/delete API): `id, club_id, actor_sub, action, target_sub, meta_json,
at`. Every mutation in §2 plus tier/exclusive changes, invite create/redeem/revoke, ownership transfer and
every **platform-admin** action (which also requires a free-text `reason`). Mirrored to IDUNA's unified
event log as `iduna:wotan.club.*` (same `EventLog` plumbing `game_online.go` uses).

---

## 5. Data model — `IDUNA/migrations/truestore/202610120001_wotan_clubs.sql`

```
clubs(id TEXT PK, slug TEXT UNIQUE COLLATE NOCASE, name, tagline, description,
      privacy_tier INT DEFAULT 1, prev_tier INT, is_exclusive INT DEFAULT 0,
      join_policy TEXT DEFAULT 'invite',          -- invite | request   (request: social only)
      show_contributors INT DEFAULT 0,            -- §0-R5
      owner_sub TEXT, brand_json TEXT,            -- {accent, banner_text}; no image uploads in v0
      suspended INT DEFAULT 0, suspended_reason, deleted INT DEFAULT 0, created_at, updated_at)
club_memberships(club_id, sub, role CHECK IN('player','coach','manager'),
      public_visible INT DEFAULT 1, show_badge INT DEFAULT 1,
      joined_at, invited_by, PRIMARY KEY(club_id, sub))
club_invites(id PK, club_id, token_hash TEXT UNIQUE,   -- sha256 only; plaintext shown once
      role, created_by, bound_sub, expires_at, used_by, used_at, revoked_at, created_at)
club_join_requests(id PK, club_id, sub, message, status, decided_by, created_at, decided_at,
      UNIQUE(club_id, sub, status) WHERE status='pending')
club_posts(id PK, club_id, author_sub, body, pinned, pinned_deck_id, deleted, created_at)
club_post_comments(id PK, post_id, club_id, author_sub, body, deleted, created_at)
club_featured_decks(club_id, deck_id, featured_by, created_at, PRIMARY KEY(club_id, deck_id))
club_audit_log(id PK, club_id, actor_sub, action, target_sub, meta_json, platform_admin INT, at)

hs_sync_targets(sub PK, kind CHECK IN('personal','club','none'), club_id, updated_at)
hs_player_rank(sub PK, battletag, battletag_verified INT, region, legend_rank INT,
      rank_verified INT, source TEXT, updated_at)
ALTER TABLE hs_games ADD COLUMN club_id TEXT NOT NULL DEFAULT '';
ALTER TABLE hs_games ADD COLUMN visibility TEXT NOT NULL DEFAULT 'personal'; -- personal|club|private
INDEXES: club_memberships(sub), hs_games(club_id, id DESC), club_audit_log(club_id, id DESC),
         club_invites(club_id), club_posts(club_id, id DESC)
```

Existing `hs_games.deck_public` / `hs_stat_shares` semantics are untouched: club attribution is
**additive**, it never makes a record more public than it already was.

---

## 6. Telemetry routing (the multi-club uplink)

1. **Preference**: WOTAN settings page → "Sync match data to: [Personal wall] / [Club Alpha] / [None —
   private only]" → `PUT /api/v1/hs/me/sync-target`. Choices list only the user's own memberships.
2. **Uplink read**: the PowerShell uplink (token scope `hs.live.upload`) calls
   `GET /api/v1/hs/live/sync-target` at init and on each reconnect, and **only displays** it ("Syncing to
   Club Alpha"). It **sends no club identifier** (R9).
3. **Ingest**: when a finished game record is stored, the server reads `hs_sync_targets` and
   - `personal` → current behaviour (`visibility='personal'`, feeds shared public stats as before);
   - `club`     → re-check membership + `club.telemetry.contribute`; if valid `club_id` + `visibility='club'`;
     if the user was removed → silently fall back to `private` and flag `sync_target_invalid` in the
     uplink-visible state so the page can tell the user (never reroute to another club);
   - `none`     → `visibility='private'`: only the owner's own tracker history.
4. **Practice flag**: the spec's `IsPrivate = true` practice block maps to `visibility` ∈ {`club`,`private`};
   the original "binds the row to the active Club_ID" is exactly the `club` case.
5. **Re-attribution** (owner only): a member may move one of their own recent games between targets they
   currently qualify for; club managers may **not** pull a member's games out of their personal history.
6. **Leaving a club**: member's `club` games are retained by the club as aggregate-only rows but
   de-identified in contributor boards (shown as "former member"); a manager-initiated "purge member's
   contributions" is a platform-admin action, not a club one. (Open question OQ-3.)

---

## 7. UI & admin interfaces

### 7.1 WOTAN front end (static, `css/wotan-theme.css` + HS skin, `wotan-nav.js`, no new inline sign-in)

| Page | Audience | What |
|---|---|---|
| `/clubs/` | public | directory (Private + Social), search, sort: prestige / new / members; "Create club" |
| `/clubs/c.html?s=slug` | public (tier-shaped) | the public flex page: branding, roster with 👑📋⚔️ and rank badge, featured decks, achievements; Secret → generic "not found" |
| `/clubs/w.html?s=slug` | members | **Workspace**: roster wall · strategy feed · scrim & win-rate aggregator (§7.2A) |
| `/clubs/manage.html?s=slug` | coach/manager (affordances per role) | admin console of one club (§7.2B-C) |
| `/clubs/join.html#token` | signed-in invitee | preview → confirm; handles handle-required, exclusive conflict |
| `/clubs/settings.html` | self | my clubs, sync target selector, per-club "show on roster / show badge" |
| profile pages (`hearthstone/u.html`) | public | club badges (Private/Social only, member-hideable) |

Affordances are driven by one call, `GET /api/v1/clubs/{id}/me` → `{role, perms[]}`; the UI hides or
disables from `perms` (disabled with a reason tooltip for Coach-vs-Coach rows), the server enforces. The UI
is never the boundary.

### 7.2 In-club admin surface (the "full admin interface" for club staff)

A. **Workspace (all roles)** — Internal Roster Wall (BattleTag, rank + verified mark, role badge) · Shared
Strategy Feed (posts, deck pins, comments) · Private Scrim & Win-Rate Aggregator (matchup matrix vs. meta
archetypes from club-tagged `hs_games`, with minimum-sample dimming).

B. **Roster & invites (Coach+)** — roster actions panel (`[Remove]` greyed for Coach-vs-Coach/Manager), invite
provisioning window (role, expiry ≤ 7 d default 48 h, optional bound-handle, copy-link, single-use,
revoke), join-request queue.

C. **Manager suite** — tier selector with Reveal, exclusive toggle (with conflict list), join policy,
contributor-board toggle, role promotion/demotion dropdowns, branding, featured-deck picker, audit-log
viewer, ownership transfer, delete (type-the-slug confirm).

### 7.3 IDUNA Back Office — `/admin/clubs` (platform operators; `iduna.admin`, existing cookie auth)

| Screen | Capabilities |
|---|---|
| **Clubs index** | search/filter by tier, exclusive, suspended, size, age; Secret clubs *are* visible here (operators are the trust root) with every view audit-logged |
| **Club detail** | settings, members with per-member **effective-permission matrix**, invites (revoke), join requests, featured decks, club audit log, linked reports |
| **Actions** (each requires a `reason`, each audit-logged with `platform_admin=1`) | suspend/unsuspend (suspended club: public page 404, workspace read-only), force tier, transfer ownership, remove member, revoke all invites, delete/restore |
| **Reports queue** | extends existing `hs_reports` with `kind: club|club_post` |
| **Platform settings** | caps: clubs per user (default 5 created), members per club (default 250), invite TTL ceiling, pending invites per club; stored in a settings table with defaults in code |
| **Permission catalog view** | read-only listing of the `wotan.club*` nodes and role bundles (source of truth is code + migration; shown so operators can audit) |

Plus a machine surface for agents: bearer `wotan.clubs.admin` / `wotan.clubs.moderate` JSON under
`/api/v1/clubs/admin/*` (list, get, suspend, delete, transfer, audit).

### 7.4 API contract (prefix `/api/v1/clubs/`, same conventions as `hs_social.go`)

List responses `{total, limit, offset, items}`; errors `{error}` (+ `code` for machine cases:
`handle_required`, `exclusive_conflict`, `last_manager`, `invite_expired`, `invite_used`, `tier_forbidden`).

```
PUBLIC (token optional; viewer-shaped)
GET    /clubs?q=&sort=prestige|new|members&limit=&offset=        directory (never Secret)
GET    /clubs/by-slug/{slug}                                      tier-shaped club view
GET    /clubs/by-slug/{slug}/roster                               opted-in members + badges (+ rank)
GET    /clubs/by-slug/{slug}/decks                                Social: featured decks
GET    /users/{handle}/clubs                                      public badges / mutual-workspace clubs

AUTH
POST   /clubs                       {name,slug,tagline,privacy_tier,is_exclusive}   → 201 {id}
GET    /me/clubs                                                  my memberships (+ role, tier)
GET    /clubs/{id}/me                                             {role, perms[]}
POST   /clubs/{id}/token                                          club-context JWT (§4.3)
PATCH  /clubs/{id}                  {name?,tagline?,description?,brand?}      club.settings.edit
PUT    /clubs/{id}/visibility       {privacy_tier?,is_exclusive?,join_policy?,show_contributors?}  club.visibility.set
POST   /clubs/{id}/transfer         {to_sub}                      owner only
DELETE /clubs/{id}                                                owner only
GET    /clubs/{id}/members                                        club.roster.view
PATCH  /clubs/{id}/members/{sub}    {role}                        promote/demote
DELETE /clubs/{id}/members/{sub}                                  remove
POST   /clubs/{id}/leave
PATCH  /clubs/{id}/members/me       {public_visible?,show_badge?}
POST   /clubs/{id}/invites          {role?,ttl_hours?,bound_handle?}   → {url} (plaintext once)
GET    /clubs/{id}/invites          DELETE /clubs/{id}/invites/{iid}
GET    /clubs/invites/peek          {token} (POST)  preview
POST   /clubs/join                  {token}
POST   /clubs/by-slug/{slug}/requests  {message}   GET /clubs/{id}/requests   POST …/{rid}/decision {accept}
GET/POST /clubs/{id}/feed      DELETE /clubs/{id}/feed/{pid}   PUT …/{pid}/pin
GET/POST /clubs/{id}/feed/{pid}/comments
PUT/DELETE /clubs/{id}/featured-decks/{deck_id}
GET    /clubs/{id}/analytics/matchups?window=   GET …/analytics/contributors?window=week
GET    /clubs/{id}/audit?limit=&before=

HS NAMESPACE (additions)
GET    /hs/me/sync-target     PUT /hs/me/sync-target {kind,club_id?}
GET    /hs/live/sync-target                      (upload-token scope; read-only)
GET/PUT /hs/me/rank           {battletag?,region?,legend_rank?}  self-declared; verified flags server-set

ADMIN (bearer wotan.clubs.admin | wotan.clubs.moderate)
GET /clubs/admin/clubs  GET …/{id}  POST …/{id}/suspend|unsuspend|transfer  DELETE …/{id}  GET …/{id}/audit
```

---

## 8. Ego features & the honest gaps

**Shipped in this phase**: role badges (👑 📋 ⚔️), roster with rank + verified marks, featured "Claimed
Decks" showcase (first-publisher rule, R8), prestige score = featured decks + their likes (documented,
tunable), weekly contributor board (opt-in, §0-R5), tier "Reveal" flow for tournaments.

**Named, not faked**:
- **Verified legend rank** has no data source today (R4). Plan: ingest Blizzard's public Hearthstone
  leaderboards per region/season, match on BattleTag (BattleTag ownership is provable: it appears as
  `my_name` in the user's own tracker uploads). Until then the UI shows rank with an "unverified" mark.
- **Card art / card DB** remains the Phase-1 "last step" (`hs_cards` backfill).
- **Team-vs-team scrims / tournaments**, club chat, DMs, image branding (needs an upload store), and
  club-level billing/premium are out of scope.

---

## 9. Delivery plan

Principles: contract-first (this doc), one parallel wave per dependency boundary, no more than four
agents total, each chunk ends with tests + commit before the next depends on it.

| Chunk | Owner | Depends | Deliverable |
|---|---|---|---|
| **P2-A** Backend core | agent A (IDUNA) | — | migration §5, `internal/clubs` (authz matrix + hierarchy invariants as a pure, table-tested package), `clubs.go` handler: clubs/members/invites/requests/feed/featured/audit/token, perm-catalog seed, route wiring in `main.go`, isolation tests |
| **P2-C** Front end | agent C (WOTAN) | contract only | all §7.1 pages + `js/club-*.js`, nav entry, join flow, settings; works against the §7.4 contract |
| **P2-B** Telemetry, rank, analytics | agent B (IDUNA) | A | sync-target endpoints, ingest routing (§6), `hs_player_rank`, matchup/contributor analytics, profile badges, uplink script display line |
| **P2-D** Back Office | agent D (IDUNA) | A | `/admin/clubs` console (§7.3), platform-settings table, JSON admin API |
| **P2-E** Integration & docs | main session | A–D | `go test ./...`, end-to-end smoke against a real IDUNA binary, README/CLAUDE.md/CHANGELOG, BACKLOG, golden-index + GOLDEN_DOCS resync, commits |

Wave 1 = A ∥ C. Wave 2 = B ∥ D (after A is committed; they touch disjoint files). E last.

### Definition of done (Phase 2)
- A user can create a club in each tier, invite two others as coach/player, and each role sees exactly the
  affordances in §2.1; every denied action is covered by a test.
- Cross-tenant tests (§4.2) pass; Secret clubs 404 for outsiders on every public route.
- A tracker game recorded while synced to club X appears in X's aggregator and nowhere public; after
  removal from X the next game does not.
- Back Office can find, suspend, reassign and delete a Secret club, each with an audit row.
- Not claimed: verified rank, real-browser touch behaviour, production load — each listed in the status
  section of this doc when the work lands.

---

## 10. Open questions (decisions I made provisionally — founder to confirm or flip)

- **OQ-1** Club creation open to every signed-in player vs. gated (invite/premium)? Provisional: open, capped at 5 clubs created per user.
- **OQ-2** Should a *Private* club allow "request to join"? Provisional: no (invite only) per §3.1.
- **OQ-3** Leaving a club: keep de-identified aggregate rows (provisional) vs. delete the member's contributions?
- **OQ-4** Should Secret clubs be allowed to be Exclusive *and* count toward another club's lock? Provisional: yes, they count.
- **OQ-5** Prestige formula — featured decks + likes is a placeholder; real weighting needs live data.

## 11. Related

`HEARTHSTONE_NORTHSTAR.md` (Phase 1 HS decks/socials) · `NORTHSTAR.md` (DEADWEIGHT match stats) ·
`IDUNA/internal/http/handlers/hs_social.go` (conventions this phase copies) · `HRIP/tracker/README.md`
(uplink) · `IDUNA/docs/iam-spec.md` (roles/permissions model).

## 12. Build status (2026-10-12)

Built, in code and committed: P2-A core (IDUNA `1dbc354`), P2-C front end (WOTAN `5c17ab1`), P2-B telemetry /
rank / analytics (IDUNA `ccc14ca`), P2-D Back Office console (IDUNA `db8ca8d`), plus a shared-middleware fix so
`aud=wotan-club` tokens are refused by `RequireAuth`/`RequireCookieAuth` (IDUNA `9078894`).

**Verified for real**: `go build`/`go vet` clean; `internal/clubs` authz table tests; 15 `TestClub*` handler
integration tests (every role, denial matrix, §4.2 cross-tenant isolation, exclusive conflicts, invite
replay/expiry, last-manager, stale membership after removal); P2-B ingest/leak/analytics/rank tests; 10
`TestAdminClubs_*` tests through the real cookie+`iduna.admin` stack; front-end `scripts/clubs-affordance-test.js`
23/23. The 9 failing `game_online` ticket tests and the `nock` door-script test fail identically on the
pre-Phase-2 commit `80fd135` (checked) -- not caused by this work.

**Not verified**: any real browser rendering (no Chromium here); the static site against the real API; the
migration on MySQL (only SQLite exercised); the PowerShell uplink changes on Windows (substring/Go tests only);
production load; the `iduna:wotan.club.*` event mirror (tests ran with `EventLog=nil`).

**Deviations from this doc's contract** (all backend-side, front end already tolerant): routes live under
`/api/v1/clubs/` including `GET /clubs/me/clubs` and `GET /clubs/users/{handle}/clubs` (`/api/v1/users/` is
taken); `PUT visibility` accepts `{reveal:true}`; invite response is `{id,url,role,expires_at,bound_handle}`;
platform admins have no implicit override on member endpoints -- only the reasoned, audited `/clubs/admin/*`
and `/admin/clubs` paths; admin reads require `?reason=`; a deleted club's slug is not reusable; featured decks
capped at 12; `wotan.club.create` is implicit for any signed-in sub with an HS handle (players get no
role-based permissions in IDUNA today -- `player_permissions` is explicit per-account grants).

**Known follow-ups**: verified legend rank (§8); Back Office cross-club reports queue index; PARENA
replacement of the plain-Go `internal/clubs` authz stopgap (labelled in code); a headless-browser pass.

## 13. Identity federation (Phase 2b)

Linked accounts (Battle.net / Google / Twitch), upload keys bound to a verified BattleTag, and the new gates on
club creation and tracker download are specified in `IDENTITY_NORTHSTAR.md`. It tightens §6 (ingest attributes
games to a linked tag; unverified-tag games are `private` only) and the implicit `wotan.club.create` grant.
