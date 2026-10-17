# Changelog

## 2026-10-17

- feat(redgarden): **Red Garden is playable at `/redgarden/play.html`** (founder real-time: "publish redgarden web ... it is an esport so it needs FULL WOTAN MATCH AND PLAYER TRACKING ... it should allow for guest play ... it should integrate with iduna sso ... it should use existing bot match infrastructure and bot pool ... PARENA WASM, PARENA TSX ... very demure"). The Play tab was a how-to for the native client; it is now the game (the how-to is a collapsed note under it). `redgarden/redgarden.wasm` + `redgarden/rg-host.js`, both built from `PARENA/stdlib/redgarden/web` by `scripts/build-redgarden.sh` (committed). **A client, not a port**: the match is the real arena server and its 19-bot pool, reached through IDUNA's gateway (`/api/v1/redgarden/play`); the wasm draws the arena's own snapshots and runs the draft, shop, HUD and orders. Guests get a real REDGARDEN account IDUNA makes and the browser remembers; signed-in visitors play as their IDUNA identity. Every match is recorded from the arena's snapshots: new **Matches** tab (`/redgarden/matches.html`), kills/deaths on profiles, plus the leaderboard and hero win rates WOTAN already had. `scripts/redgarden-browser-test.mjs`: real Chromium + real IDUNA + the real C matchmaker/arena/19 bots (32 checks, guest and SSO).
- fix(redgarden): the **leaderboard, heroes and profile pages were broken in production** ("Could not load ... parameter 1 is not of type 'Node'"): `h()` in `js/rg-pages.js` could not take an array of rows. It flattens arrays now.

## 2026-10-16

- feat(shankpit-460): **shankpit-460 is playable at `/shankpit-460/`** and a first-class game on WOTAN (founder real-time: "ADD SHANKPIT 460 as a first class citizen to WOTAN, full esports treatment, full IDUNA and WOTAN integration ... queue them into a bot match and say SEARCHING FOR MATCH; if there is at least 1 other human in matchmaking put them in a ffa lobby; human matches are first to 16 or they end at 6 minutes; an end screen with the score and a requeue button; make it nice, very thoughtful, very demure"). `shankpit-460/index.html` + `shankpit460.wasm` + `sp-host.js` (the game is PARENA wasm, the host JS is PARENA -> TypeScript -- no hand-written JS), `css/wotan-sp.css`, a `sp` nav skin and a GAMES-bar entry, a home-page card, `shankpit460` in the Redeem-a-code play-link maps, `scripts/build-shankpit460.sh`. Human matches go through IDUNA's new `/api/v1/shankpit460/play` WebSocket (same-origin through the Gateway's `/api/` route). The games bar was tightened so six games fit at 1280px. Tests: `scripts/shankpit460-net-test.mjs` (two real engines against the real IDUNA binary) and `scripts/shankpit460-browser-test.mjs` (real Chromium, 19 checks, screenshots). **Not verified:** Firefox, Safari, phones, a physical gamepad, listening to the sound.

- feat(redeem): **Redeem a code, on WOTAN** (founder real-time: "we need an affordance under the user profile for redeem a code ... it should enable founder mode in DEADWEIGHT web ... the web client should link to the affordance for adding a code on wotan like blizzards ... make it nice when a code is redeemed it should say what it did ... the tokens are supposed to give the 9999 tickets"; the founder also shared Battle.net's account overview, redeem page and account menu as the model). Three affordances: a **Redeem a code** entry in the signed-in account menu (every page), the **`/redeem/`** page (`ENTER CODE`, one button, the answer, a help section), and an **account overview** at the top of `/account/` (compact Redeem card, **Games** with Founder status and ticket balance, **Recent redemptions**). The answer says what the code did -- "DEADWEIGHT Founder unlocked: Founder status is now on your account, for good; Draft tickets 25 -> 9,999, effectively unlimited" with stat tiles and the account it landed on, "+10 DEADWEIGHT tickets: 9,999 -> 10,009", or "Nothing new this time" for a second founder code -- and failures say why. Backend is IDUNA `POST /api/v1/redeem` + `GET /api/v1/me/entitlements` (a code finds its game and lands on the player the SSO identity plays that game as, so on the account DEADWEIGHT signs in as). New nav skin `acct`; all API paths and wording in `js/redeem-api.js`. Also fixed: menu links were indigo on the dark menu on every `body.hs` page. Real bugs the browser test caught while building it: a `maxlength` on the box truncated pasted codes carrying a space or newline (removed; a code pasted inside a sentence now goes in alone), and Enter on an incomplete code did nothing silently (now explains). Tests: `scripts/redeem-test.js` (21) and `scripts/redeem-browser-test.mjs` (59 checks, real headless Chromium against the REAL IDUNA binary on a throwaway database with synthetic codes, incl. the whole chain with the freshly built DEADWEIGHT client). Not verified: Firefox, Safari, a real phone, a screen reader.

- test(bp): `scripts/brawlpit-browser-test.mjs` can run against the deployed site (`BRAWLPIT_BASE_URL=https://wotan.okemily.com`; IDUNA stays stubbed, no real account involved). After the default-worn-hat fix deployed, all 26 checks passed against production (served `brawlpit.wasm` sha256 `6a7382f0...` == the committed build).
- fix(bp): **BRAWLPIT now puts your equipped Hat Store hat on your fighter by default** (founder real-time: "the hat stor hat thats equipped should be worn by the player in brawlpit"). It had been opt-in via up/down on the fighter-select screen. Curated store hats (whose art IDUNA stores as an HTML-entity string like `&#127914;`, not a PNG) are decoded and drawn as a glyph fitted onto the head instead of as literal text. New status line under the canvas (`#bp-hat-status`): signed out / nothing equipped / expired sign-in / missing image / "Wearing your Hat Store hat: <name>"; the header badge shows the exact 32x32 surface the game wears. `brawlpit.wasm` + `bp-host.js` rebuilt from PARENA; `scripts/brawlpit-browser-test.mjs` 13 -> 26 checks (default-worn with no key, down/up toggles it, gold crown present in a fight and absent signed-out, curated hat fitted to the head, signed-out / nothing-equipped / 401 pages).
- feat(bp): **BRAWLPIT is playable at `/BRAWLPIT/`** -- the scaffold became the real thing (founder real-time: "get brawlpit web shipped; PARENA powered; no malloc; wasmdaddy", then "make sure its actually wasm not faked with a bunch of garbage js; whatever we do need to use js for use parena into TS"). `brawlpit.wasm` is the whole game (PARENA, no malloc, zero imports, physics bit-identical to BRAWLPIT's C engine); `bp-host.js` is PARENA compiled to TypeScript and type-stripped; the hand-written `brawlpit.js` / `hat.js` scaffolds are deleted. New: `sprites.png` (the eight native portraits packed into a 4x2 atlas of 128px tiles, `scripts/build-brawlpit-sprites.py`), `scripts/build-brawlpit.sh`, `scripts/brawlpit-browser-test.mjs` (13 checks in headless Chromium: boot, paint, keyboard, mouse menus, a Gamepad API shim, a stubbed signed-in hat flow, no console errors), controls/tips panel and `css/wotan-bp.css` for the live stage. The equipped hat (and curated emoji hats) is worn in matches. Not verified: Firefox/Safari/phones/a physical gamepad; no touch controls, audio or online play.
- fix(nav): `hat-studio.html` used the Deadweight menu -- it is now the GoblinFoxDragon/Hat Store menu with "Hat Studio" current (`data-skin="gfd" data-section="studio"`); `js/wotan-nav.js` gains a Clubs tab on the Hearthstone menu and a Friends tab on the Deadweight menu, and `profile.html` highlights Friends.

- feat(bp): **`/BRAWLPIT/` scaffold -- BRAWLPIT on WOTAN** (founder real-time: "port BRAWLPIT to WASM via PARENA and put on WOTAN, ALL THE WOTAN AFFORDANCES, IDUNA SSO LOGIN, A TOP TAB ON THE TOP... ensure hats show up in BRAWLPIT WEB, CONTROLLER SUPPORT IF YOU CAN DO IT IN THE BROWSER"). Follows `/GFD/`'s exact real pattern. `index.html` + `brawlpit.js` (shared IDUNA session, honest "core engine porting to PARENA -- not playable yet" placeholder stage, Gamepad connect/disconnect detection scaffold) + `hat.js` (direct structural port of `GFD/hat.js`'s two-call equipped-hat badge -- closes `WOTAN_HAT_STORE_NORTHSTAR.md` Phase 3's own open "BRAWLPIT-side rendering" question for the 2D web case). New `bp` nav skin + `BRAWLPIT` entry in the top `GAMES` bar (`js/wotan-nav.js`) + its own section tabs; new `css/wotan-bp.css`. Full plan and honest capability audit (no wasm toolchain in this sandbox, BRAWLPIT's real `core/*.c` not yet PARENA-ported) in `BRAWLPIT/docs/BP_WASM_WOTAN_NORTHSTAR.md`. Not browser-verified (no headless Chrome in this sandbox) -- Node syntax-checked only. No wasm module, no playable match yet.

- GFD play page: the equipped hat is shown on a pixel bust in the header (`GFD/hat.js`), with a "Current Hat: <name>" tooltip. Hidden when signed out or no hat is equipped.

- feat(store): **Secondary market** section (browse/buy/cancel resale listings) and a Sell button on limited editions in the locker that opens a dialog with a live price breakdown (88% seller / 8% designer royalty / 4% burn) and the fixed-rates / 25% ceiling notice. Needs IDUNA `202610160004_hat_market.sql`. Not browser-verified.
- feat(hat-studio): optional **Quantity limit** field (blank = unlimited). Setting one makes Publish open a confirm dialog: after selling out on the WOTAN hat store the hat is secondary-market only. `store.html` shows "Limited - N of M left" and a disabled "Sold out" button; My hats shows sold/limit. Needs IDUNA `202610160003_hat_quantity_limit.sql` deployed. Not browser-verified (JS syntax-checked only).
- feat(gfd): **`/GFD/` -- the GoblinFoxDragon MUD in the browser** (founder real-time: "write a web interface at wotan.okemily.com/GFD use wasm and PARENA ... integrate with IDUNA SSO with nice affordances"). The terminal (UTF-8/ANSI parser, scrollback, selection, history, key->byte mapping, software renderer) is PARENA (`PARENA/stdlib/gfd/term.prn`) compiled to `GFD/term.wasm`; `GFD/gfd.js` is only host glue (WebSocket to `/GFD/ws`, IDUNA session, DOM events, canvas, clipboard, an aria-live transcript). Affordances: connection pill with auto-reconnect/backoff, copy/paste (multi-line paste confirms), drag/double-click selection, command history, scrollback (wheel, PgUp/PgDn, touch drag), quick-command buttons, text zoom + fullscreen with a floating exit, soft-keyboard/IME input, phone layout. Sign-in is the standing pattern: a plain `data-signin` link, no button; an expired token (close code 4401) shows a sign-in overlay and does not retry. New `gfd` nav skin (`css/wotan-gfd.css`); **GFD is a tab in the top menu's game switch** with its own Play / Hat Store / Clubs tabs. `store.html`'s "no GFD character yet" dead end now links straight to `/GFD/`. Verified in headless Chromium against the real MUD binary and a stub IDUNA (28/28, desktop + phone screenshots). Not yet verified: a real-device soft keyboard, Safari.
- feat(store): **hat store restyled on the IDUNA front page** (founder real-time: "update hat store so it more meshes with the front page of iduna ... look at the front page as the WOTAN style guide"). New `css/wotan-iduna.css` (the style guide as reusable `.i-*` components); `store.html` rebuilt on it with the same API calls plus affordances: character plate with Flow balance and hats-owned tiles, hat cards with cut-corner art wells, "Need N more Flow" instead of a failing Buy, a locker that marks the equipped hat, toasts, skeleton loading, and a no-character state that links to `/GFD/`. `/GFD/` takes the same look (gold-framed console on cream) and the `gfd` nav skin now uses the default cream/gold top bar. 37-check headless-browser run covers both pages, desktop and phone.
- feat(deadweight): rebuilt `dist/fxWasm.js` and `dist/generated/dw_fx.wasm` from DEADWEIGHT (heartbeat sound removed from the web build; audio-clock re-anchoring fix -- see `DEADWEIGHT/CHANGELOG.md`).
- feat(hat-studio): `hat-studio.html` -- layered 32x32 pixel editor (pencil, line, paint bucket,
  eraser, eyedropper, mirror, undo/redo, local projects), price guide with the 88% designer /
  12% burned breakdown, publish + "My hats" dashboard (re-price, unlist). Store shows player art,
  designer credit and the split. Exports PNG and a `.hat` file for BRAWLPIT.

## 2026-10-15
- Chrome + home redesign to match the new design reference (kanban #641): every page now gets a two-row
  topbar -- a white GAMES bar (Deadweight "Drafts · Matches · Duels", Hearthstone "Shared deck library",
  Redgarden "Knights of the Void", active one underlined gold) over a navy brand bar (WOTAN wordmark,
  section tabs, gold Sign in). Tabs trimmed to the core set (DW: Home/Play/Draft Decks/Matches/SHANKPIT;
  HS: Decks/Submit/Feed/Players/Tracker; RG: Leaderboard/Heroes/Play); Clubs stays under the account
  menu ("My clubs & sync"), Hat Store and Friends & Duels are linked from the home page. Home rebuilt as
  hero + "Open to everyone" column + "More from WOTAN" cards. Untested in a real browser (none on this
  build box) -- needs an eyeball pass; also not deployed (deploy runs from the WOTAN host). (session: unknown)

## 2026-10-12
- docs: IDENTITY_NORTHSTAR.md §13 — concrete next-steps runbook for Battle.net OAuth (register app + exact redirect URI gotcha, rank-verification job spec, open-question checklist); no code changes, IDENT-01/02 already built (sess-20261009-1745-ee80b668)
- Identity federation, front end (WOTAN Phase 2b, chunk ID-B): `/account/` page (linked Battle.net/Google/Twitch with last-door unlink guards, privacy toggles, tracker upload keys with one-time reveal, install one-liners in inline and save-once forms, accepted/rejected counters); "Competitive Verification Required" gate modal + grace banner reused by the tracker install-command copy and club creation (`js/identity-gate.js`); Twitch display name (opt-in) and "Leaderboard-matched" rank wording in club rosters/feeds; "Account & linked accounts" in the shared nav menu. All identity endpoints isolated in `js/identity-api.js`. Coded to `IDENTITY_NORTHSTAR.md` §4/§8 while IDUNA ID-A lands in parallel: verified only by `scripts/identity-affordance-test.js` (plain node stub), not in a browser and not against the real API. HRIP uplink key-exchange (`-Key`/`-SaveKey` DPAPI) delivered as `HRIP/tracker/uplink/uplink-key.patch`, not applied, PowerShell not run. README/CLAUDE.md updated.
  session: sess-20261009-1745-ee80b668

- docs(clubs): `CLUBS_NORTHSTAR.md` Phase 2 spec + §12 build status; README/CLAUDE.md status updated for the built Clubs backend (IDUNA 1dbc354, ccc14ca, db8ca8d, 9078894).

- Clubs (WOTAN Phase 2, front end, chunk P2-C): `/clubs/` directory with search/sort and create-club dialog; `c.html` public tier-shaped club page (role badges, rank with explicit "unverified" mark, featured decks, generic not-found); `w.html` members workspace (roster wall, strategy feed with post/comment/pin, win-rate matrix + contributor board with graceful empty state when analytics 404); `manage.html` admin console with every affordance computed only from `GET /clubs/{id}/me` perms[] (disabled-with-reason Remove, invite provisioning with one-time copy link, join-request queue, tier selector with Go dark/Reveal memory, exclusive conflict list, join policy, contributor toggle, role dropdowns, branding, featured-deck picker, audit log, ownership transfer, type-the-slug delete); `join.html#token` (fragment stripped on load; peek -> confirm -> join, with handle_required / exclusive_conflict / invite_expired / invite_used messages); `settings.html` (my clubs, sync target via `PUT /api/v1/hs/me/sync-target`, show-on-roster/show-badge toggles, self-declared BattleTag/region/rank). New `js/club-api.js`, `club-perms.js`, `club-ui.js`, `club-badges.js`, `club-page-*.js`, `css/wotan-clubs.css`; "Clubs" tab in the shared nav and "My clubs & sync" in the account menu; club badges on `hearthstone/u.html`. Coded to `CLUBS_NORTHSTAR.md` §7.4 with the IDUNA backend landing in parallel: verified only by `scripts/clubs-affordance-test.js` (plain node, DOM/fetch stub), not in a browser and not against the real API. README updated.
  session: sess-20261009-1745-ee80b668

## 2026-10-11

- Terms of Service (`terms.html`) and Privacy Policy (`privacy.html`): real, plain-English pages describing what WOTAN actually does today (IDUNA SSO sign-in, decks/social/leaderboards/friends-duels, the Flow-based cosmetic hat store, no real-money payments yet) -- explicitly flagged as not lawyer-reviewed, same honesty convention as `EMILY_FOR_BUSINESS/LICENSE.md`. Contact address is a placeholder (`legal@wotan.okemily.com`) pending a real inbox.
- Sitewide cookie notice + legal footer (`js/cookie-consent.js`), added to every page including `DEADWEIGHT/index.html` (which loads neither `iduna-sso.js` nor `wotan-nav.js`, so this file is fully self-contained): a dismissible top banner ("by continuing to use this site, you consent to cookies," links to Terms/Privacy, remembered via `localStorage`) plus a permanent small footer with the same two links so they stay reachable after the banner is dismissed. Inserted as the first child of `<body>` (not `position:fixed`) so it pushes the existing sticky topbar down instead of overlapping it.
- Honesty note folded into the Privacy Policy itself: WOTAN's own pages keep you signed in via browser local storage, not traditional cookies -- only IDUNA's own hosted login/admin pages set real HttpOnly session cookies. The banner still says "cookies" (the founder's own requested wording, and the common umbrella term) but the policy text is precise about which mechanism is actually in play.
  session: sess-20261009-1745-ee80b668

## 2026-10-10

- REDGARDEN is the third game tab (game switch: Deadweight | Hearthstone | Redgarden): `/redgarden/` leaderboard (search), `/redgarden/heroes.html` hero win rates, `/redgarden/u.html?id=` per-player profile (heroes played, recent matches), `/redgarden/play.html`. Own garden-green skin (`css/wotan-rg.css`); the account menu opens the REDGARDEN profile on this tab, so profiles stay separate per game. Reads IDUNA's public `/api/v1/redgarden/*`.
- `/redgarden/connect.html`: the browser half of the REDGARDEN client's IDUNA login (pick a name -> guest account, add an email to save progress, or sign in with IDUNA / email), then hands the result to the game over a loopback callback.
- Tracker page: one-time installer command that puts a "WOTAN Hearthstone Tracker" icon on the Desktop and Start menu; the icon always runs the newest uplink (the old paste-every-time command is under "Run once without installing").
- Win/loss per exact deck: a record only enters the public win rate when its player shares it (publishing shares; "Share my stats for this deck" on a private deck does it without publishing). Private pages show my record, the public rate and the projected global rate. Identical public decks are one deck named by the first publisher.
- Deck library has a "My private decks" tab (public library is public-only); publishing a deck requires a handle.
- Decks played in the tracker sync into the deck library when the game ends: private by default (publish per deck, or turn on "Publish decks instantly" on the tracker page), a changed deck is saved as a copy, and each deck shows its tracked win rate.
- Hearthstone live deck tracker page (private per player): token mint, uplink command, cards-left view (sess-20261009-1745-ee80b668)


## 2026-10-09

- Hearthstone deck section (`/hearthstone/`: Decks, Submit, Feed, Players, deck detail, profile) + shared topbar with DEADWEIGHT | HEARTHSTONE switch and one account widget (`js/wotan-nav.js`) on every page; store/friends no longer render their own Sign-in buttons. IDUNA `/api/v1/hs/*` backs it. See `HEARTHSTONE_NORTHSTAR.md`. README updated. (sess-20261008-0123-53e30776)

## 2026-10-04

- K8S-MV-03: wotan.okemily.com moved to GKE (static nginx pod; /api -> IDUNA and /DEADWEIGHT/ws -> bridge as Gateway path routes). Cert: *.okemily.com. (sess-20260923-1030-4a526255)


## 2026-09-28

- Real DEADWEIGHT game client deployed under /DEADWEIGHT/ (plain copy of DEADWEIGHT/web's built native-wasm client), linked from every page's nav. New /DEADWEIGHT/ws nginx location for the WebSocket bridge (not yet installed on the live box). See README.md. (sess-20260923-1030-4a526255)


## 2026-09-25 (3)
- Add shankpit.html: basic SHANKPIT kills/deaths/K-D/sessions leaderboard, reading new IDUNA
  endpoint GET /api/v1/shankpit/leaderboard off SHANKPIT's existing per-match write path (S550,
  founder real-time: "add shankpit to WOTAN... if you have an iduna account you have a shankpit
  account... for now we need basic shankpit match tracking")

## 2026-09-25 (2)
- Add matches.html: real DEADWEIGHT leaderboard, recent-match list, and a round-by-round replay viewer (S547) driven by new IDUNA match-log endpoints (sess-20260923-1030-4a526255)
- fix(auth): **SSO session is now sticky across pages** (founder real-time: "the SSO should be
  sticky when i click around it forgets im logged in"). New shared `js/iduna-sso.js`
  (`getIdunaSession`/`setIdunaSession`/`clearIdunaSession`/`buildSsoURL`/`handleIdunaSsoReturn`),
  loaded by both `store.html` and `friends.html`. Before this, each page kept its own separate
  localStorage key and only ever recognized a session right after an SSO redirect landed on THAT
  page -- navigating from one page to the other looked like being logged out. Both pages'
  `handleSsoReturn()` now check a fresh SSO return first, then fall back to the shared session from
  an earlier page visit; `friends.html` silently re-exchanges the shared session for a fresh
  DEADWEIGHT token on every load rather than trusting a possibly-stale cached one. `logout()` on
  either page now clears the shared session too, so logging out is sticky in the same way.
- Related IDUNA-side fix (see `IDUNA` `5f7c9f9`/`bd3d7cc`): a generically-registered identity (no
  game scope) used to dead-end -- "no account for that game" on friends.html, "email already
  taken" on the DEADWEIGHT client's own claim-account flow, with no way out. `sso-exchange` and
  game-scoped `email-login` now claim an unscoped identity for the first game that legitimately
  uses it.

## 2026-09-25
- feat(auth): **friends.html no longer collects a password of its own** (founder real-time: "make
  it work for Friends and Duels", the direct follow-up to 2026-09-24's store.html SSO cutover).
  Removed the inline email/password form; a "Sign in with IDUNA" link now sends the browser to
  IDUNA's own SSO page, same as store.html. Genuinely different underneath, though: DEADWEIGHT
  friends/duels are keyed to a game-scoped player token (`player_id`/`game`/`permissions` claims),
  which the generic SSO JWT isn't shaped for -- so `handleSsoReturn()` now exchanges the SSO token
  for a real DEADWEIGHT token via a new IDUNA endpoint, `POST /api/v1/games/deadweight/
  sso-exchange` (see `IDUNA` `50655f5`), before storing it exactly like the old inline form did. An
  IDUNA identity with no DEADWEIGHT account linked gets a real, honest error message pointing at
  the DEADWEIGHT client's own "link email" flow, not a silent new registration. See `WOTAN/
  CLAUDE.md`'s "Auth -- IDUNA as SSO" section for the full rationale. Node-syntax-checked; the
  backend round trip is proven end to end by IDUNA's own `TestSSOExchange_*` tests; the actual
  browser click-through was not screenshotted (no headless Chrome in this sandbox).

## 2026-09-24 (5)
- feat(auth): **store.html no longer collects a password of its own** (founder real-time:
  "instead of putting your password into page on wotan iduna needs to become the SSO"). Removed
  the inline email/password/confirm-password form and its eye-toggle show/hide buttons entirely;
  the "Sign in with IDUNA" link now sends the browser to IDUNA's own dedicated SSO login page
  (`https://iam.okemily.com/?redirect_uri=<this page's own URL>`, see `IDUNA/internal/http/
  handlers/sso_login.go`) -- a real cross-domain redirect, not a same-origin trick. On return,
  IDUNA hands the JWT back via a URL fragment (`#sso_token=...&player_id=...&display_name=...`),
  which `handleSsoReturn()` reads, stores in `localStorage` exactly like the old inline form did,
  and scrubs from the URL (`history.replaceState`) so a refresh/share never carries the token.
  The `?signup=1` deep link from GFD's own login screen (Ctrl+Alt+S) still works, now forwarded
  as a query param onto the SSO page so it can default to register mode instead of focusing a
  local field. Added a shared `.button` class to `css/wotan-theme.css` (mirrors the existing
  `button`/`button.secondary`/`.gold` rules onto `<a>` elements) so a link can be styled like a
  button -- reusable by any future page, not store.html-specific.
  **Depends on `iduna.service` actually carrying the new SSO route and, ideally,
  `iam.okemily.com`'s DNS/cert existing (`IDUNA/ops/nginx/iam-okemily.conf` +
  `sudo-queue/91-iam-okemily-sso-domain.sh`, neither live yet) -- this commit is held un-deployed
  (not yet rsynced via `~/wotan-deploy.sh`) until then, since deploying it first would break the
  live hat-store login for real users.** `friends.html`'s own login form is untouched -- it
  authenticates DEADWEIGHT accounts, a genuinely separate credential system from IDUNA platform
  accounts (see this file's own 2026-09-24 entries for S536/S537), out of scope for this change.

## 2026-09-24 (4)
- feat(design): **full visual redesign — BRAWLPIT "neon brutalist" art direction** (founder
  real-time: "improve the design of the WOTAN platform use the brawlpit aesthetic the neon
  brutalist look but make it clean and readable and friendly the shankpit menu color pallette" /
  "attaching an example of a shankpit style art direction with IDUNA undertones use this as
  inspo"). New shared theme (`css/wotan-theme.css`), applied to all 5 live pages
  (`index.html`, `decks.html`, `store.html`, `profile.html`, `friends.html`) in place of each
  page's own copy-pasted `:root`/base `<style>` block. Palette: near-black violet background
  (`--bg: #0b0518`), violet primary accent (`--violet`/`--violet-bright`), a gold "IDUNA
  undertone" secondary accent (`--gold`/`--gold-bright`) used for the active-nav pill and
  highlight numbers, cyan/orange/red/blue/green utility colors -- `decks.html`'s existing
  Offense/Operations/Defense card-type coloring rides the same CSS variables unchanged (its JS
  only ever referenced those variables/classes by name, never a hardcoded hex, so the recolor
  was a pure CSS-layer change). Shared component styles: topbar/nav with `aria-current="page"`
  active-state styling, cards, buttons (primary/secondary/danger/gold), badges, form inputs,
  Space Grotesk display font. Deliberately no light-mode variant -- a neon-brutalist identity
  doesn't have one; this repo is dark-only now, a deliberate call, not an oversight. One real
  bug found and fixed during the centralization: `store.html`'s JS emits a bare
  `class="badge"` (no `.pending`/`.accepted`/`.declined` modifier) for "Owned"/"Equipped"
  states, which the new shared `.badge` base (unstyled without a modifier, by design) would
  have rendered colorless -- added a page-local override. Verified with real headless
  (Playwright/Chromium) screenshots of all 5 pages served locally, checked for readability,
  contrast, and no leftover unstyled elements before shipping -- not just "the CSS parses."

## 2026-09-24 (3)
- chore(verify): diagnosed and cleared a stalled background run of the Duel Phase 3c e2e harness
  (`duel_wotan_phase3c_e2e.sh`/`.js`, scratch, not committed) and re-ran it fresh against the
  currently-deployed `friends.html` (MD5-confirmed identical to `/var/www/wotan/friends.html`).
  Root cause: the harness hardcoded its Chrome remote-debugging port (`19223`) with no timeout on
  any CDP round-trip -- if a prior run's Chrome process wasn't fully reaped before a rerun, the
  new instance either fails to bind that port or the script ends up talking to a stale/half-dead
  one, and an unanswered CDP message then hangs forever with no self-recovery (this is what
  happened to task `bcud2ohkw` earlier the same day: killed by exact PID after confirming via
  `/proc/*/cmdline` it was scratch, not a live service). Checked directly before doing anything
  else: no process was actually still running or bound to that port at the time of this pass --
  the earlier stall had already been cleared. Randomized the port in the scratch harness so a
  future rerun can't collide with a leftover instance the same way. Fresh run: real headless
  Chrome loaded the real `friends.html`, logged in, rendered the accepted duel's `match_token` +
  Copy token button, and a real (CDP-synthesized, trusted) click resolved
  `navigator.clipboard.writeText()` -- button showed "Copied!", screenshotted. No app code
  changed; this reconfirms Duel Phase 3c (`61bfbce`, Apple #20690, `EMILY/BACKLOG.md` SECTION 537)
  is genuinely shipped and working against what's live today, not just what was true when it was
  first verified. (sess-20260923-1030-4a526255)

## 2026-09-24 (2)
- ops+feat: **WOTAN is now the real front door** (S540, founder real-time: "finish shipping the
  new WOTAN stuff / wotan.okemily.com should be the front door to the online social tournament
  site"). Closed the one real gap left after S537/S536: `iduna.service` was still running a build
  from before the friends/duels/profiles routes (`70b6b06`, `2716c8e`) landed, so every one of
  `friends.html`'s calls would have 404'd against the real deployed API despite passing every
  fixture-based test. Rebuilt IDUNA from current `main` (`go test ./...` clean across all 30+
  packages), restarted `iduna.service` (health check passed, no downtime beyond the restart
  itself), and re-deployed this repo's own `friends.html`/`profile.html` (previously committed
  but never actually rsynced to `/var/www/wotan` -- deploy is a separate manual step from
  `git push` here, and it had been missed). **Live-verified end to end against the real production
  stack, not a fixture**: registered two real throwaway DEADWEIGHT accounts through
  `wotan.okemily.com`'s own `/api/` proxy, upgraded both to email/password, logged in, sent and
  accepted a real friend request, challenged and accepted a real duel, and confirmed a real,
  correctly-shaped `match_token` came back -- the exact same call chain `friends.html` makes
  itself, just driven by curl instead of a browser. `GET .../players/{id}/profile` also confirmed
  live (friend_count reflected the new friendship).
  `index.html` rewritten: dropped the "Under construction" badge and the "old page is still at
  okemily.com/tournaments.html until this page fully replaces it" framing (had the direction of
  the pointer backwards) -- now `Live`, leads with Player Profiles/Friends & Duels, and points
  outward to `okemily.com/tournaments.html` only for the content that's genuinely still only
  there (REDGARDEN leaderboard, hero stats, GFD Battlegrounds demo). `OKEMILY/tournaments.html`
  got a matching banner pointing back here (see that repo's own CHANGELOG). `README.md` updated
  per SAGA README Reality. (sess-20260923-1030-4a526255)

## 2026-09-24
- feat: Duel Phase 3c -- `friends.html` surfaces the live match_token on an accepted duel (S537
  Duel Phase 2, Phase 3, WOTAN half). WOTAN has no game client of its own to queue a match into --
  the native SDL2 (Phase 3a, DEADWEIGHT `9afdda5`) and browser (Phase 3b, DEADWEIGHT `e16dbfa`)
  clients already read this same token straight from IDUNA and show their own Play button, so
  `friends.html`'s `loadDuels()` renders the raw token in a monospace box with a **Copy token**
  button (`navigator.clipboard.writeText`) for the one real audience WOTAN can serve directly:
  `dw_client --match-token TOK`, a real, live CLI flag as of Phase 2. Live-verified with a real
  headless Chrome (Chrome DevTools Protocol) loading the actual, unmodified `friends.html` against
  a fake same-origin IDUNA seeded with an accepted duel + token, confirming the token box and
  button render with the exact expected value, and that a real (CDP-synthesized, trusted-click)
  click resolves `writeText()` successfully (button shows "Copied!"). No app code needed a CORS
  workaround for this test -- served same-origin, matching production's real nginx `/api/` proxy.
  Closes SECTION 537's Duel Phase 2, Phase 3 entirely (3a/3b/3c all shipped). (sess-20260923-1030-4a526255)
- feat: DEADWEIGHT friends & duels (`friends.html`) and public player profiles (`profile.html`) -- founder real-time: "add iduna online accounts / add social features / profiles / friends / friendly challenges (duels) / for DEADWEIGHT / WOTAN". New IDUNA routes under `/api/v1/games/deadweight/...` (friend-requests, friends, duels, players/{id}/profile -- IDUNA commit 70b6b06). `friends.html` logs in with a DEADWEIGHT account (separate credential system from `store.html`'s IDUNA login) to manage requests/friends/duels; `profile.html` is a public, no-login profile lookup. Verified: `node --check` on both pages' scripts, headless-Chrome screenshots of both pages (and the updated `index.html` nav), and a manual field-by-field contract check against `game_social.go`'s real JSON output. Not yet live-tested end to end through the real deployed API -- the IDUNA build carrying these routes is committed/pushed but not yet deployed to `iduna.service` (same real, named gap as the BIG_O IDUNA app work, 2026-09-23). `index.html`/`README.md` updated per SAGA README Reality. (sess-20260923-1030-4a526255)

## 2026-09-19
- deploy: retheme colours/keywords live, season note (pre-retheme decks archived) (sess-20260918-1725-497f394f)
- feat(decks): Offense/Operations/Defense colours, keyword column/filter/legend, cards.json v2 (105 cards); not deployed until the server ships the retheme (sess-20260918-1725-497f394f)

- feat: DEADWEIGHT Draft Decks browser (decks.html) -- drafted decks + win rates, filters/sorts, big card tooltip on hover, per-card records tab; data/cards.json generated from DEADWEIGHT; README/CLAUDE status corrected (site is live) (sess-20260918-1725-497f394f)


## 2026-09-04 (4)

- feat(store): `?signup=1` (from GFD's own new `Ctrl+Alt+S` sign-up shortcut, `GFD-UA-001`)
  focuses the email field and hints toward the register button on load.

## 2026-09-04 (3)

- feat(store): `WOTAN-997` -- `store.html`'s register form now has a real "Confirm Password"
  field, validated (`password !== confirm` → real error, no request sent) only on the register
  path, never enforced on login (a returning login only ever needs the one real password on
  file). Both the password and confirm-password fields get their own independent show/hide
  ("eye") toggle button, flipping `type="password"`/`type="text"` per field. JS syntax-checked;
  no live browser test (no headless-browser harness in this repo, same real limitation IDUXN-003
  already named for a different repo's own page JS).

## 2026-09-04 (2)

- ops: **WOTAN-DNS-001 fully live.** `sudo-queue/48-setup-wotan-nginx-and-dir.sh` ran (nginx site
  + Let's Encrypt cert + initial deploy) but the site came up as a real, live 403 Forbidden:
  `wotan-deploy.sh`'s `rsync -a` faithfully mirrors the SOURCE repo's own file permissions into
  `/var/www/wotan`, and this repo's own checkout was `770`/`660` (no "other" access) instead of
  `OKEMILY`'s own `775`/`674` world-readable convention — so nginx's `www-data` worker genuinely
  couldn't read anything it just deployed. Real, root-cause fix, no sudo needed (this repo is
  `fatbaby`-owned): `chmod 775` the repo root + subdirectories, `664` the files, matching
  `OKEMILY`'s own precedent exactly, then re-ran `wotan-deploy.sh`. Live-verified:
  `https://wotan.okemily.com/` and `/store.html` both real `200`s over real HTTPS with the
  correct HTTP→HTTPS redirect (`--hsts`/`--redirect` from certbot), and `store.html`'s own
  `/api/` proxy confirmed reaching the real live IDUNA (`/api/v1/hats` → real 401, `/api/v1/auth/
  email/login` → real "invalid email or password" for a bogus login, not a proxy/connection
  error). WOTAN's own `store.html` (Phase 2, shipped 2026-09-04) is now genuinely reachable from
  the outside for the first time.

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

## 2026-10-15
- ops(identity): Twitch OAuth credentials set in live `iduna-env`, IDUNA restarted; `/auth/sso/twitch/start` verified 302 to Twitch with empty scope and `iam.okemily.com` callback (IDENT-04 Twitch half). Full browser round trip still unverified.
- docs(identity): reconcile IDENTITY_NORTHSTAR §2 provider table and README with IQ-2 (Twitch is a login door, IDUNA 50c221d).

## 2026-10-15
- feat(themes): selectable themes Void/Ember/Terminal/Daylight via `html[data-theme]` token overrides + topbar Theme picker (localStorage `wotan_theme`); Hearthstone skin unchanged. Not browser-verified, not deployed.
- feat(hs): Hearthstone pages restyled to the new design (screenshots + WOTAN_Home mockup): `body.hs` re-tokenised to #f3f2f8/white/indigo/gold, Barlow Condensed headings, gold-grid hero band, navy stat card, hex cost gems. Not browser-verified, not deployed.
- feat(hs): deck detail navy win-rate card (win %, bar, wins/losses/tracked games) beside the title block. Not browser-verified.
