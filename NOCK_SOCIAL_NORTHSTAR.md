# WOTAN — SOCIAL NOCK TOOLS — NORTHSTAR (2026-10-15)

Founder real-time, 2026-10-15: *"we need to make the nock tools social; vs0 is port the nock tools into
WOTAN as a multi tenant; users can use the nock texture editor (it has layers) to edit and upload
sprays; sprays need to go into a gallery; affordances for my sprays vs all sprays"* → *"northstar it
first; users will be able to edit levels etc."*

**One sentence:** NOCK stops being an admin-only back-office console and becomes a set of
**player-owned creation tools** on WOTAN — VS0 is the layered texture editor producing **sprays** in a
public/private **gallery** with **My sprays / All sprays**; levels (and later other NOCK assets) follow
the same ownership/visibility/moderation contract.

---

## 0. What exists today (checked in the code, not assumed)

| Fact | Where | Consequence |
|---|---|---|
| The layered editor is a **server-side** engine: `Project`/`Layer` flat files on disk, composited by **ImageMagick** (`internal/nock/imagemagick.go`), keyed by **project name** in one directory | `IDUNA/internal/nock/project.go`, `service.go` | One global namespace, no owner concept, shells out to a native binary |
| Layer model: image/gradient/**procedural (PARENA source)** layers; opacity, visible, x/y/scale/rotation, move (z-order), mask, hue/sat/brightness, sharpen; canvas resize; flatten-export | `service.go` | The *model* ports cleanly; the *engine* should not |
| Whole NOCK console (projects, textures, sprays, levels…) is behind `iduna.admin` + cookie auth | `IDUNA/main.go` (`/admin/nock/...`) | Zero player-facing surface today |
| Sprays: `shankpit_sprays`, one **global** `is_default` row, **globally unique name**, admin-created via "Export to Spray" | `migrations/truestore/202609140005_shankpit_sprays.sql`, `spray_store.go` | This is the *official registry* the native SHANKPIT client trusts. It must stay curated — user content must not land in it directly |
| Public read-only spray routes already exist (list/default/image) | `shankpit_sprays.go` (`ShankpitSpraysPublicHandler`) | Native-client fetch path is proven; reuse the pattern for gallery images |
| Textures: `nock_textures`, globally unique name, no owner | `202609120001_nock_textures.sql` | Same multi-tenancy gap |
| Levels: `shankpit_levels` etc., admin-edited in a React/Three.js editor (`ShankpitLevelEditor.tsx`) | `internal/shankpit/level_store.go` | Heavy editor, bigger abuse surface — deliberately **not** VS0 (§7) |
| WOTAN is plain static HTML/JS, **no build step**; its backend is IDUNA; auth is the IDUNA SSO bearer token (`js/iduna-sso.js`, `club-api.js` pattern) | `WOTAN/CLAUDE.md` | The editor must be buildable without a bundler; the API lives in IDUNA |

---

## 1. Decisions (and why)

| # | Decision | Why / what was rejected |
|---|---|---|
| D1 | **The VS0 editor is a new client-side canvas editor in WOTAN (vanilla JS), porting NOCK's layer *model* — not its ImageMagick engine.** The server never composites. | Rejected: exposing the existing engine multi-tenant. It shells out to a native binary on untrusted image uploads, has **procedural layers that execute user-supplied PARENA source** (code execution as a feature), a Vertex "generate" path that spends real money per call, and a flat by-name directory with no owner. Making that safe is a bigger job than a canvas editor, and the canvas editor needs no per-tenant server state at all. |
| D2 | **User sprays live in a new table (`wotan_sprays`), not in `shankpit_sprays`.** An admin can **promote** a gallery spray into the official registry (copies the row). | Keeps the native client's trusted, curated default intact (`is_default` is global by design) and gives a clean moderation boundary: gallery = user content, registry = vetted. |
| D3 | **Ownership = IDUNA JWT `sub`** (same identity the clubs/store use). Name uniqueness is **per owner**, not global. | Matches WOTAN's existing SSO pattern; avoids the global-name collision that makes today's tables unusable multi-tenant. |
| D4 | **Visibility per asset: `private` / `public`** (default `private`; "Publish to gallery" is an explicit act). | "My sprays vs all sprays" needs a private-by-default draft shelf; nothing a user makes should be public by accident. |
| D5 | **Procedural (PARENA) layers, AI "generate", and server-side ImageMagick are explicitly out of VS0 for players.** They stay admin-only in the back-office console. | See D1. Procedural layers become a *later, sandboxed* feature, not a VS0 freebie. |
| D6 | **Server re-encodes every upload.** Decode PNG → verify dimensions → re-encode; reject anything else. Caps: dimensions (≤ 512×512 for sprays), bytes, per-user quota, rate limit. | Never store or serve raw user bytes; kills polyglot/metadata/oversize abuse in one step. Go's `image/png` is enough — no new native dependency. |
| D7 | **Moderation is a VS0 requirement, not a later nice-to-have.** Public user-uploaded images ⇒ report button, admin hide/remove, takedown that also un-publishes from any registry copy. | A public gallery of arbitrary images without a takedown path is a liability from day one. |

---

## 2. Generic shape (so levels slot in later)

Every player-creatable NOCK asset kind follows one contract; only the payload and validator differ.

```
owner_sub     TEXT      -- IDUNA JWT sub; ownership & authz
kind          (implicit per table: spray | texture | level …)
name          per-owner unique
visibility    private | public
status        ok | hidden (moderation)  + reported_count
payload       BLOB/JSON  (validated + re-encoded server-side per kind)
source_json   optional editable project state (layers / level doc), size-capped, for re-editing
created_at / updated_at / published_at
```

API shape per kind, under `/api/v1/wotan/<kind>/`:
`GET ?scope=mine|all&sort=new|…&cursor=` · `POST` (create) · `GET {id}` · `GET {id}/image` ·
`PATCH {id}` (rename / visibility) · `DELETE {id}` · `POST {id}/report` ·
admin: `POST {id}/hide`, `POST {id}/promote` (→ official registry).

`scope=mine` requires auth and returns private + public of the caller; `scope=all` returns only
`public` + `status=ok`, auth optional (public gallery is viewable signed-out; creating needs sign-in).

---

## 3. VS0 — layered spray editor + gallery

### 3.1 Editor (`WOTAN/sprays/editor.html`, `js/nock-*.js`)
- Layers ported from NOCK's `Layer`: image layer (user upload / paste), **solid + gradient** layers,
  opacity, visible, x/y/scale/rotation, z-order, **mask**, brightness/saturation/hue. Canvas size picker
  (square presets ≤ 512). Composited in a `<canvas>`; **flatten → PNG** is what's uploaded.
- Save: **flattened PNG** (the spray) + **`source_json`** (layer stack, each layer's pixels as PNG data,
  size-capped) so a spray can be reopened and edited — this is what makes it an editor, not an uploader.
- Undo/redo (client only). Local autosave to `localStorage` (try/catch — may be unavailable).
- Shared `css/wotan-theme.css`, shared topbar + `wotan-nav.js`; SSO via `iduna-sso.js`.

### 3.2 Gallery (`WOTAN/sprays/index.html`)
- Tabs/affordance: **My sprays** (mine: private + public, with visibility toggle, edit, delete) vs
  **All sprays** (public, newest first, owner handle, spray preview, "Open in editor as copy").
- Spray tile → detail (large preview, owner, created date, **Report**).
- "Publish" / "Unpublish" on own sprays. Signed-out viewers see All sprays read-only with a sign-in nudge.
- "Clone to my sprays" copies a public spray's `source_json` into the caller's private shelf
  (independent row — same "no shared master" convention as `nock_textures`).

### 3.3 Backend (IDUNA)
- Migration: `wotan_sprays` (+ `wotan_spray_reports`). Store `internal/wotan/spray_store.go` mirroring
  `SprayStore`'s shape with owner/visibility/status. Handler `wotan_sprays.go`, JWT-gated writes,
  public image route. Tests: ownership isolation (user A cannot read/modify B's private/any row),
  visibility filtering, re-encode rejects non-PNG/oversize/decompression-bomb dims, quota, report→hide.
- Admin: "Sprays gallery" list in the back office with hide/unhide/promote.

### 3.4 Definition of Done (VS0)
1. Two real IDUNA accounts: A builds a 3-layer spray, saves private, sees it only under *My sprays*;
   B cannot fetch it by id (404, not 403).
2. A publishes → appears for B (and signed-out) under *All sprays*; B can clone it; A's original unchanged.
3. Re-opening A's saved spray restores the exact layer stack.
4. Non-PNG / oversize / over-quota uploads are rejected with clear errors (tested).
5. B reports A's spray; admin hides it; it disappears from All sprays and its image URL 404s.
6. Admin promotes a gallery spray into `shankpit_sprays` (official registry) without touching `is_default`.
7. `go test ./...` green; WOTAN pages verified in a real browser (screenshot), not just fetched.

---

## 4. Auth & identity
- Writes need the SSO bearer; owner = `sub`; display name = the player's existing WOTAN handle/profile.
- **Open:** may DEADWEIGHT/SHANKPIT *guest* accounts (name-only, no email) publish publicly? Recommendation:
  guests may create **private** sprays only; publishing requires a linked (Google/IDUNA-local) account —
  the cheapest spam brake we already have.

## 5. Native game integration (after VS0, not in it)
- Gallery sprays are *not* automatically usable in-game. Path: player picks **equipped spray** (server-side
  per-player setting) → native client fetches `/api/v1/wotan/sprays/{id}/image`. Until then the only
  in-game sprays are the curated official registry (unchanged). Moderation must exist before this lands.

## 6. Phases

| Phase | Scope | Notes |
|---|---|---|
| **VS0** | Layered spray editor + gallery + mine/all + report/hide/promote (above) | the ask |
| VS1 | **Textures**: personal texture library (per-owner names), clone, same gallery contract; reuses editor | `nock_textures` becomes owner-scoped via a new `wotan_textures`, not an alter |
| VS2 | **Equipped spray** in SHANKPIT (+ official-registry promote UX) | needs moderation proven first |
| VS3 | **Levels**: port level editor to player-owned `wotan_levels` (§7) | the founder's "edit levels etc." |
| VS4 | Social layer: likes, follows, comments, "remix" lineage, featured shelf, club galleries | rides existing clubs model |
| Later | Sandboxed procedural layers (PARENA) for players | needs a real execution sandbox first |

## 7. Levels (forward design — not built in VS0)
- Same contract (§2): `wotan_levels` with `owner_sub`, visibility, status, `payload` = level JSON.
- **Validator is the real work**: server-side bounds/limits on walls/objects/spawners, spawn reachability,
  no scripted-door code from players (door scripts are PARENA — admin-only until sandboxed), materials
  whitelist. A user level is *data*, never code.
- Editor: the current Three.js React editor is large (`ShankpitLevelEditor.tsx`); WOTAN has no build
  step. Options to decide at VS3: (a) ship that editor as a built, self-contained bundle served from
  WOTAN, multi-tenant-ised against `wotan_levels`; (b) rewrite smaller. Decide with the VS1 learnings.
- Hosting user levels on live servers (load, griefing) is a separate gate: private test play first.

## 8. Risks / honest unknowns
- **Content abuse** (the main risk): public image uploads. Mitigations are D6/D7 + guest restriction; no
  automated image classification is planned — human report/hide only, flagged as a known limit.
- **Editor scope creep**: "photoshop with layers" is bottomless. VS0 is the field-for-field subset of
  NOCK's existing layer model; anything beyond (brushes, text, blend modes) is VS1+.
- **Storage**: BLOBs in SQLite (existing convention). 512² PNG ≈ tens of KB; per-user quota keeps it
  bounded; revisit object storage only if the gallery outgrows SQLite.
- **No existing player-facing NOCK API to reuse**: the admin handlers aren't safely reusable
  as-is; new handlers, shared validators only.

## 9. Not doing (yet)
Server-side compositing for players · player PARENA/procedural layers · AI generation · selling sprays
(price/Flow model — already deferred in the spray migration) · automatic image moderation · in-game use
of gallery sprays · level editing.
