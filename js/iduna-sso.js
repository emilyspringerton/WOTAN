// Shared IDUNA SSO session across every WOTAN page (2026-09-25, founder real-time: "the SSO
// should be sticky when i click around it forgets im logged in"). Before this, store.html and
// friends.html each kept their own separate, page-local notion of "am I signed in" --
// store.html stored the raw generic SSO token under wotan_token, friends.html only ever checked
// its own exchanged DEADWEIGHT token (wotan_dw_token) and had no idea a generic IDUNA session
// existed unless the SSO redirect fragment had JUST landed on THIS specific page. Since all
// WOTAN pages share one origin, localStorage IS already shared browser-side -- the bug was that
// nothing ever looked at a key another page had written. This file is the one shared source of
// truth for "is this browser signed into IDUNA" -- every page should include it and check
// getIdunaSession() on load, not just its own derived/game-scoped token.

const IDUNA_TOKEN_KEY = 'wotan_iduna_token';
const IDUNA_PLAYER_ID_KEY = 'wotan_iduna_player_id';
const IDUNA_DISPLAY_NAME_KEY = 'wotan_iduna_display_name';

function idunaStorageGet(key) {
  try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
}
function idunaStorageSet(key, val) {
  try { if (val) localStorage.setItem(key, val); else localStorage.removeItem(key); } catch (e) { /* private browsing / storage disabled */ }
}

// The shared, sticky session -- null if nothing is stored (or storage is unavailable).
function getIdunaSession() {
  const token = idunaStorageGet(IDUNA_TOKEN_KEY);
  const playerID = idunaStorageGet(IDUNA_PLAYER_ID_KEY);
  if (!token || !playerID) return null;
  return { token: token, playerID: playerID, displayName: idunaStorageGet(IDUNA_DISPLAY_NAME_KEY) };
}

function setIdunaSession(token, playerID, displayName) {
  idunaStorageSet(IDUNA_TOKEN_KEY, token);
  idunaStorageSet(IDUNA_PLAYER_ID_KEY, playerID);
  idunaStorageSet(IDUNA_DISPLAY_NAME_KEY, displayName || '');
}

// Clears the shared session -- logging out on ANY page logs the whole site out, matching the
// same "sticky" expectation as staying logged in does.
function clearIdunaSession() {
  idunaStorageSet(IDUNA_TOKEN_KEY, '');
  idunaStorageSet(IDUNA_PLAYER_ID_KEY, '');
  idunaStorageSet(IDUNA_DISPLAY_NAME_KEY, '');
}

// Builds the "Sign in with IDUNA" link's href, redirecting back to THIS page's own URL with any
// existing hash/query stripped so the return trip doesn't chain. extraParams (e.g. {signup: '1'})
// are forwarded onto the SSO page as-is.
function buildSsoURL(extraParams) {
  const redirect = location.origin + location.pathname;
  const params = new URLSearchParams({ redirect_uri: redirect });
  if (extraParams) { for (const k in extraParams) params.set(k, extraParams[k]); }
  return 'https://iam.okemily.com/?' + params.toString();
}

// Reads the token IDUNA's SSO page hands back via URL fragment
// (#sso_token=...&player_id=...&display_name=...), stores it in the SHARED session, and scrubs
// the fragment so a refresh/share doesn't carry the token in the URL. Returns the session object
// if a fragment was present, null otherwise -- callers should fall back to getIdunaSession() when
// this returns null, since a shared session from an earlier page visit may still be live (that
// fallback is the actual "sticky" fix -- this function alone only covers the redirect-back leg).
function handleIdunaSsoReturn() {
  const frag = new URLSearchParams(location.hash.slice(1));
  const token = frag.get('sso_token');
  const playerID = frag.get('player_id');
  if (!token || !playerID) return null;
  const displayName = frag.get('display_name') || '';
  setIdunaSession(token, playerID, displayName);
  history.replaceState(null, '', location.pathname + location.search);
  return { token: token, playerID: playerID, displayName: displayName };
}
