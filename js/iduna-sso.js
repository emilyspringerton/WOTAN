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
  return idunaLoginBase() + params.toString();
}

// ---- Which IDUNA: a local one first, the cloud one when no local one answers --------------------------------------------
// Founder, 2026-11-17: "we need a local iduna to test against it needs to work so that it checks to see if there is a
// local iduna and connects to that and if not it attempts to use cloud iduna". PARENA decides: /js/iduna-discover.js is
// generated from PARENA stdlib/iduna/discover.prn + discover_web.prn (the same rules native tools run as C). It probes
// this site's own origin, then the local IDUNA (only from a localhost or file:// page, or when a developer opts in), then
// the cloud IDUNA, one /health each with a short timeout. This half only keeps the choice for the browser session
// (sessionStorage can throw), reads the overrides, and applies WOTAN's two production rules below.
//   idunaReady()          Promise of the choice {source, base, loginUrl, verified, error, checks}
//   idunaApi(path, init)  fetch() on the chosen IDUNA (base '' = this page's own origin)
//   idunaChoiceNow()      the choice if known yet, else null
// Config: window.IDUNA_CONFIG = {localUrl, cloudUrl, localFirst, timeoutMs, ttlMs}, and a developer's per-browser overrides
// in localStorage: iduna_local_url, iduna_cloud_url, iduna_local_first ("1" probes the local IDUNA from any page, "0"
// never), iduna_probe_timeout_ms. Unset: the module's defaults, http://localhost:8080 and https://iam.okemily.com.
const IDUNA_CHOICE_KEY = 'wotan_iduna_choice';
const IDUNA_DISCOVER_URL = (function () {
  try { return new URL('iduna-discover.js', document.currentScript.src).href; } catch (e) { return '/js/iduna-discover.js'; }
})();
let idunaChoicePromise = null;
let idunaModule = null;
let idunaChoice = (function () {
  try { const s = sessionStorage.getItem(IDUNA_CHOICE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
})();

function idunaOnOkemily() { return /(^|\.)okemily\.com$/.test(location.hostname); }

function idunaConfig() {
  const c = (window.IDUNA_CONFIG && typeof window.IDUNA_CONFIG === 'object') ? window.IDUNA_CONFIG : {};
  const ttl = Number(c.ttlMs || 0);
  return {
    localUrl: idunaStorageGet('iduna_local_url') || c.localUrl || '',
    cloudUrl: idunaStorageGet('iduna_cloud_url') || c.cloudUrl || '',
    localFirst: idunaStorageGet('iduna_local_first') || (c.localFirst === undefined ? '' : String(c.localFirst)),
    timeoutMs: Number(idunaStorageGet('iduna_probe_timeout_ms') || c.timeoutMs || 0),
    ttlMs: ttl > 0 ? ttl : undefined
  };
}

function idunaChoiceNow() { return idunaChoice; }

function idunaReady(fresh) {
  if (idunaChoicePromise && !fresh) return idunaChoicePromise;
  const cfg = idunaConfig();
  cfg.cached = fresh ? null : idunaChoice;
  cfg.fresh = !!fresh;
  idunaChoicePromise = import(IDUNA_DISCOVER_URL)
    .then(function (m) { idunaModule = m; return m.idunaDiscover(cfg); })
    .catch(function (e) {
      // the module itself did not load: keep the pre-discovery behaviour (this page's own /api/) and say why
      return { source: 'same-origin', base: '', loginUrl: location.origin + '/api/v1/auth/sso/login?', verified: false,
               error: 'IDUNA discovery did not load (' + e + ').', checks: [], at: Date.now(), key: '' };
    })
    .then(function (c) {
      idunaChoice = c;
      try { sessionStorage.setItem(IDUNA_CHOICE_KEY, JSON.stringify(c)); } catch (e) { /* blocked: probe once per page */ }
      if (!c.verified && c.error) { try { console.warn('IDUNA: ' + c.error); } catch (e) { /* no console */ } }
      try { window.dispatchEvent(new CustomEvent('iduna:ready', { detail: c })); } catch (e) { /* old browser */ }
      return c;
    });
  return idunaChoicePromise;
}

// Forget the choice (a call to it failed), so the next idunaReady() probes again.
function idunaForgetChoice() {
  idunaChoicePromise = null;
  idunaChoice = null;
  try { sessionStorage.removeItem(IDUNA_CHOICE_KEY); } catch (e) { /* ignore */ }
  try { if (idunaModule) idunaModule.idunaForget(); } catch (e) { /* ignore */ }
}

// WOTAN production rule 1, API calls: when nothing answered, okemily.com keeps its own /api/ (nginx sends it to the cloud
// IDUNA), exactly as before discovery existed, so the cloud's CORS settings never matter there.
function idunaApiBase(c) {
  if (!c) return '';
  if (!c.verified && idunaOnOkemily()) return '';
  return c.base || '';
}

function idunaApi(path, init) {
  return idunaReady().then(function (c) {
    return fetch(idunaApiBase(c) + path, init).catch(function (e) { idunaForgetChoice(); throw e; });
  });
}

// WOTAN production rule 2, "Sign in": a local IDUNA's own login page; otherwise on okemily.com the hosted login at
// iam.okemily.com (Google's redirect URIs are registered there, and it remembers the browser); elsewhere the chosen
// IDUNA's login page. Before the choice is known: the same rule with this page's own origin, as before.
function idunaLoginBase() {
  const c = idunaChoice;
  if (c && c.source === 'local' && c.verified) return c.loginUrl;
  if (idunaOnOkemily()) return (idunaConfig().cloudUrl || 'https://iam.okemily.com').replace(/\/+$/, '') + '/?';
  if (c && c.loginUrl) return c.loginUrl;
  return location.origin + '/api/v1/auth/sso/login?';
}

// A "Sign in" link written before the choice was known still points at the old login base: re-point it when clicked,
// keeping its own query (redirect_uri and any extra parameters).
document.addEventListener('click', function (e) {
  const a = e.target && e.target.closest ? e.target.closest('a[data-signin]') : null;
  if (!a || !idunaChoice) return;
  const q = a.href.indexOf('?');
  if (q > 0) a.href = idunaLoginBase() + a.href.slice(q + 1);
}, true);

idunaReady();

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
