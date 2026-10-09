# WOTAN HEARTHSTONE DECKS — NORTHSTAR (scoping pass + V0 build, 2026-10-09)

Founder real-time, 2026-10-09: add a **Hearthstone deck section to WOTAN**; segment WOTAN decks into
**DEADWEIGHT** and **HEARTHSTONE**; full socials; users add decks via **deck code**; art/card data is the
*last* step (punt — card names only for now); a super-basic profile (username only, no avatar) with a
super-basic wall; make the HS section visually follow the **IDUNA style guide** so you can tell at a
glance which game you are in; multiple tabs; use a design agent; scope → kanban cards → priority → work;
and make IDUNA behave like a normal app (no repeated "Sign in with IDUNA" buttons when already signed in).
Routed via `emily observe` (Apple #22211).

## 1. Product shape

WOTAN's deck area becomes a two-game hub. A **game switch** (DEADWEIGHT | HEARTHSTONE) sits in the shared
topbar of every deck page. DEADWEIGHT keeps `decks.html` exactly as it is (neon-brutalist dark, no
breakage of existing links). HEARTHSTONE lives under `/hearthstone/` in IDUNA's classic cream/gold look
(`IDUNA/styles.css` + `sso_login.go`'s palette: `#f3ede2` / `#f8f3ea` / gold `#b89b62`, Cormorant Garamond
headlines, Inter/Spectral body). Two palettes, one shared shell: same topbar structure, same account
widget, different skin — that contrast is the "obvious which game" requirement.

### Tabs (HS section)
| Tab | Page | Auth | What |
|---|---|---|---|
| **Decks** | `/hearthstone/` | public | Browse/search/filter (class, format, sort: new / top / trending, text/card-name search), deck cards with class badge, cost-curve sparkline, likes, author |
| **Submit** | `/hearthstone/submit.html` | sign-in | Paste a deck export (the `### name / Class / Format / Year / cards / AAEC… / #` block) *or* a bare deck code; live parse preview; title + description; publish |
| **Feed** | `/hearthstone/feed.html` | public read, sign-in to post | Global wall feed + "Following" sub-tab |
| **Players** | `/hearthstone/players.html` | public | Handle search, newest / most-followed |
| *(detail)* | `/hearthstone/deck.html?id=` | public read | Full list grouped by cost, copy-code button, like, comments |
| *(profile)* | `/hearthstone/u.html?h=handle` | public read | Handle, short bio, joined date, follower/following counts, their decks tab, their wall tab |

### Social model (kept deliberately small)
- **Profile** = unique handle (3–20, `[a-z0-9_]`, case-insensitive unique) + optional ≤160-char bio. No avatar.
  Created on first HS action ("claim your handle"); keyed to the IDUNA JWT `sub`, so one IDUNA account = one HS profile.
- **Wall**: posts (≤500 chars, text only) on your own wall; others can like and comment. Wall is the public face of the profile.
- **Decks**: like (toggle), comment (≤500), delete own. Edit title/description of own deck.
- **Follow** users; Feed has a Following filter.
- **Safety floor**: per-user rate limits, length caps, HTML-escaped on render (all text stored raw, never HTML), report button
  (`hs_reports` table, reviewed in the IDUNA Back Office later), owner + admin soft-delete.

## 2. Deck code handling (the heart of it)

Hearthstone deck codes are the standard **deckstring**: base64 of a varint stream
`0x00, version(1), format(1=Wild 2=Standard 3=Classic 4=Twist), heroCount, hero dbfId…, singles[n, dbfId…], doubles[n, dbfId…], multi[n, dbfId, count]`.
Decoding needs **no card database**, so it works today:

- IDUNA decodes the code server-side (`internal/hsdeck`, pure Go, no deps) → format, hero dbfId → **class** (small static
  hero-dbfId→class map; unknown hero → class from the pasted text, else "Unknown"), card dbfIds + counts, total count.
- The pasted text block supplies **names + mana costs** (`2x (3) Menagerie Mug`). Names are display-only for now.
- **Validation**: ≤30 cards (Standard/Wild; Twist/Classic same), per-card ≤2 (≤1 allowed when rarity unknown we skip — no rarity data yet, so only a sanity ceiling of 30 and count agreement between code and text), format in known set.
  Code⇄text agreement: total card counts must match; mismatches are a hard error with a plain message.
- **Stored** (corrected during the build): `deckstring` (canonical, re-encoded from the decoded form so equivalent pastes dedupe),
  **two lists side by side** — `dbf_json` (identity, `[{dbf_id,count}]`, from the code) and `cards_json` (display,
  `[{name,cost,count}]`, from the paste). Without a card table the per-card dbfId↔name mapping is not recoverable (the code and the
  text list the same multiset in different orders), so they are never merged per card until `hs_cards` exists.
- **Dedupe**: same canonical deckstring by the same owner → 409 with a link to the existing deck.
- **Decks submitted without text** (code only) show "Card #dbfId" placeholders until the card table is backfilled; the
  `names_resolved` flag makes the UI say so honestly rather than faking names. A later backfill (`hs_cards` table, filled from
  client data the founder says they can extract — **last step, not now**) upgrades every stored deck retroactively because the
  dbfIds are already kept.

## 3. API contract (IDUNA, prefix `/api/v1/hs/`; WOTAN reaches it via its existing same-origin `/api/` proxy)

Auth = the generic IDUNA SSO JWT (same as `store.html`; no game-scoped exchange needed). "Public" = no token.

```
GET    /api/v1/hs/decks?sort=new|top|trending&class=&format=&q=&author=&limit=&offset=      public
GET    /api/v1/hs/decks/{id}                                                                public   (+ liked_by_me if token sent)
POST   /api/v1/hs/decks/parse        {"text": "<paste>"}                -> preview, nothing saved  public (rate-limited)
POST   /api/v1/hs/decks              {"title","description","text"}     -> 201 {id}                auth
PATCH  /api/v1/hs/decks/{id}         {"title","description"}                                      auth, owner
DELETE /api/v1/hs/decks/{id}                                                                      auth, owner|admin
PUT    /api/v1/hs/decks/{id}/like    DELETE same                                                  auth
GET    /api/v1/hs/decks/{id}/comments?limit=&offset=                                              public
POST   /api/v1/hs/decks/{id}/comments {"body"}                                                    auth
DELETE /api/v1/hs/comments/{id}                                                                   auth, owner|admin

GET    /api/v1/hs/me                      -> profile or {"handle":null,"sub_display":"…"}           auth
PUT    /api/v1/hs/me                      {"handle","bio"}  (handle immutable after first set; bio editable)  auth
GET    /api/v1/hs/users?q=&sort=new|followed&limit=&offset=                                       public
GET    /api/v1/hs/users/{handle}          -> profile + counts + followed_by_me                      public
GET    /api/v1/hs/users/{handle}/decks    GET …/wall                                                public
PUT    /api/v1/hs/users/{handle}/follow   DELETE same                                               auth

GET    /api/v1/hs/feed?scope=all|following&limit=&before=                                         public (following: auth)
POST   /api/v1/hs/wall                    {"body"}                                                  auth (posts to own wall)
DELETE /api/v1/hs/wall/{id}                                                                       auth, owner|admin
PUT    /api/v1/hs/wall/{id}/like          DELETE same                                               auth
GET/POST /api/v1/hs/wall/{id}/comments                                                              public / auth
POST   /api/v1/hs/reports                 {"kind":"deck|comment|post|user","id","reason"}           auth
```
All list responses: `{ "total": N, "limit": L, "offset": O, "items": [...] }`. Errors: `{ "error": "message" }` with real HTTP status.
Deck object: `{id,title,description,class,format,year,deckstring,card_count,cards,dbf_cards,names_resolved,author:{handle},likes,comments,liked_by_me,can_edit,created_at}`
— `cards` is `[{name,cost,count}]` when `names_resolved`, else `[{dbf_id,count}]` placeholders; `dbf_cards` is always the identity list.
Duplicate publish → `409 {error, deck_id}`; publishing/commenting/following without a handle → `409 {code:"handle_required"}`.
Wall comments delete via `DELETE /post-comments/{id}`, deck comments via `DELETE /comments/{id}`. Feed returns `{items, next_before}`.

## 4. Data model (`IDUNA/migrations/truestore/202610090001_hs_social.sql`)

`hs_profiles(sub PK, handle UNIQUE COLLATE NOCASE, bio, created_at)` ·
`hs_decks(id, owner_sub, title, description, class, format, year, deckstring, cards_json, card_count, names_resolved, likes, comments, deleted, created_at, updated_at, UNIQUE(owner_sub, deckstring))` ·
`hs_deck_likes(deck_id, sub, PK both)` · `hs_deck_comments(id, deck_id, sub, body, deleted, created_at)` ·
`hs_wall_posts(id, owner_sub, body, likes, comments, deleted, created_at)` · `hs_post_likes` · `hs_post_comments` ·
`hs_follows(follower_sub, followee_sub, PK both)` · `hs_reports(id, reporter_sub, kind, target_id, reason, created_at)` ·
`hs_cards(dbf_id PK, name, cost, class, rarity, card_set, text, image_url)` — created now, **empty** (the last-step art/data backfill).

## 5. "IDUNA works like a normal app" (auth UX)

Root causes found: every WOTAN page renders its own "Sign in with IDUNA" button card regardless of the shared session,
and `iam.okemily.com` always shows a blank login form even if that browser already signed in there.
Fix (two halves):
1. **One account widget** in the shared WOTAN topbar (`js/wotan-nav.js`): signed out → a single "Sign in" button; signed in →
   "@handle ▾" with Profile / Settings / Sign out. Pages stop rendering their own sign-in cards (store/friends keep only
   contextual, non-button text when signed out).
2. **IDUNA SSO page remembers**: after a successful login `iam.okemily.com` keeps its own session record; a later visit shows
   "Continue as {name}" (one click) or auto-continues when `?prompt=none`-style silent return is requested, with a "Use a
   different account" link — never a blank form for an already-signed-in browser.

## 6. Out of scope (named, not forgotten)

Card art & card database (`hs_cards` backfill — last step); deck stats/winrates (no match data source for HS — decks here are
shared lists, not played games); avatars; DMs; notifications; deck import from Blizzard URLs; deck-building UI (paste/import only);
moderation dashboard beyond the `hs_reports` table; full-text search beyond name/title/author LIKE.

## 7. Delivery plan (kanban cards, all `HS-*`)

1. **HS-01** `internal/hsdeck` deckstring codec + paste parser + tests (Go, in IDUNA)
2. **HS-02** migration + store + deck/like/comment API + tests
3. **HS-03** profile/handle/wall/follow/feed/report API + tests
4. **HS-04** register routes in `main.go` (rate limits, `RequireAuth`/optional-auth), deploy path
5. **HS-05** design pass: `css/wotan-hs.css` (IDUNA skin) + shared shell (`wotan-nav.js`, game switch) — design agent
6. **HS-06** pages: Decks browse, deck detail, Submit (with live preview) — design agent
7. **HS-07** pages: profile, wall, Feed, Players
8. **HS-08** unified auth UX: shared account widget; remove duplicate sign-in cards; IDUNA SSO "Continue as"
9. **HS-09** docs: WOTAN README/CLAUDE.md/CHANGELOG, golden-docs index, GOLDEN_DOCS resync
10. **HS-10 (later)** card data + art backfill from client extraction

## 8. Build status (2026-10-09)

Built and verified: HS-01…HS-08 (kanban #586–#593). **Verified for real**: `go test` for `internal/hsdeck` (the founder's own FilthyRat export decodes
to 30 cards, hero 893 → Warlock, bare code and full paste produce the identical canonical deckstring) and `TestHS_*` (deck lifecycle, likes,
comments, permissions, follow graph, feeds, search/LIKE-escaping, reports); then a **headless-Chromium end-to-end run of the real WOTAN pages
against the real IDUNA binary** (claim handle → paste FilthyRat → preview → publish → duplicate refusal → browse → wall post with raw HTML shown as
text → second user likes). Not verified: touch devices, the real clipboard permission path, real Google/SSO round trip on `iam.okemily.com`
(the SSO "Continue as" JS is simulated against a stub DOM in node, not a real browser), and production load.
Pre-existing, unrelated: `go test ./...` has failing `game_online` ticket tests and a failing `IDUNA Construct` CI job on `main` before this work.

Stopgap (Core-Deps-PARENA-First): `internal/hsdeck` is plain Go, not PARENA — BURROW's Go emitter is scalar-only (no loops/Vec), which a varint-stream
codec needs. Replacement item tracked in `EMILY/BACKLOG.md`.
