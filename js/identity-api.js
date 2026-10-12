// WOTAN identity federation client (IDENTITY_NORTHSTAR.md section 4/8). EVERY identity / upload-key API call
// and every backend path for this feature lives in THIS file, so adjusting the contract is a one-file change.
//
//   GET    /api/v1/hs/me/identities             -> {identities:[{id,provider,display,verified,linked_at,last_login_at,status}],
//                                                   prefs:{show_twitch_name,show_battletag}, can_unlink:{<id>:bool},
//                                                   battlenet_linked:bool, grace_until?:string}
//   PUT    /api/v1/hs/me/identities/prefs        {show_twitch_name?, show_battletag?}
//   DELETE /api/v1/hs/me/identities/{id}
//   GET    /api/v1/hs/me/upload-keys             -> items [{id,key_prefix,label,created_at,last_used_at,revoked_at,uploads_ok,rejected_tag_mismatch}]
//   POST   /api/v1/hs/me/upload-keys {label?}    -> {key,prefix,id}   (key is shown ONCE)
//   DELETE /api/v1/hs/me/upload-keys/{id}
//   Link starts are FULL-PAGE NAVIGATIONS (cannot carry an Authorization header):
//     /api/v1/auth/sso/battlenet/start?mode=link&redirect_uri=<this page>
//     /api/v1/hs/me/identities/twitch/start
//   Errors: {error:"identity_taken"|"provider_not_configured"|"battlenet_required"|...}
//
// Pure helpers (oneLiners, displayName, rankLabel, graceActive, readLinkReturn, friendly) are DOM-free so
// scripts/identity-affordance-test.js can require() this file under plain node.
(function (root) {
  'use strict';

  var ME = '/api/v1/hs/me';
  var CONFIG = {
    // The browser cannot attach a Bearer header to a navigation, so the link-start URLs carry the session token
    // in this query parameter. ASSUMPTION about the backend (flagged in the build report): the start handlers
    // read it, bind OAuth `state` to that session's player_id, and never log it. Change here if it differs.
    linkTokenParam: 'access_token',
    battlenetStart: '/api/v1/auth/sso/battlenet/start',
    twitchStart: ME + '/identities/twitch/start'
  };

  var MESSAGES = {
    identity_taken: 'That account is already linked to a different WOTAN account. If it is yours, contact an operator to have the accounts merged.',
    provider_not_configured: 'That sign-in provider is not enabled on this server yet.',
    battlenet_required: 'Link a Battle.net account first. Competitive features need a verified in-game identity.',
    last_login_door: 'That is your last way to sign in, so it cannot be removed.',
    has_active_keys: 'Revoke your upload keys first, then unlink this Battle.net account.',
    not_found: 'That item no longer exists. Reload and try again.',
    rate_limited: 'Slow down a little, then try again.'
  };
  var PROVIDER_LABEL = { battlenet: 'Battle.net', google: 'Google', twitch: 'Twitch', iduna_local: 'Email and password' };

  function friendly(code, fallback) {
    if (code && MESSAGES[code]) return MESSAGES[code];
    return fallback || 'Something went wrong. Try again.';
  }

  // ---- low-level request ----
  function token() {
    try { var s = typeof root.getIdunaSession === 'function' ? root.getIdunaSession() : null; return s ? s.token : ''; }
    catch (e) { return ''; }
  }
  async function request(method, path, body) {
    var headers = { 'Accept': 'application/json' };
    var t = token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    var opts = { method: method, headers: headers, cache: 'no-store' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    var res;
    try { res = await root.fetch(path, opts); }
    catch (e) { var ne = new Error('Could not reach the server. Check your connection and try again.'); ne.status = 0; ne.code = 'network'; throw ne; }
    var text = '', data = null;
    try { text = await res.text(); } catch (e) { text = ''; }
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if (!res.ok) {
      // The contract puts a machine code in `error` ("identity_taken"); some handlers put prose there. Treat a
      // snake_case token as the code and otherwise keep the server text.
      var raw = data && data.error !== undefined && data.error !== null ? String(data.error) : '';
      var code = data && data.code ? String(data.code) : (/^[a-z][a-z0-9_]*$/.test(raw) ? raw : '');
      var fb = res.status === 401 ? (t ? 'Your session has expired. Sign in again.' : 'Sign in to do that.')
        : res.status === 403 ? 'You do not have permission to do that.'
        : res.status === 404 ? 'Not found.'
        : res.status === 409 ? 'That conflicts with the current state. Reload and try again.'
        : res.status === 429 ? 'Slow down a little, then try again.'
        : 'Something went wrong (' + res.status + ').';
      var err = new Error(code ? friendly(code, raw || fb) : (raw || fb));
      err.status = res.status; err.code = code; err.data = data;
      throw err;
    }
    return data;
  }

  // ---- normalisation (tolerant: optional fields may be absent) ----
  function bool(v) { return v === true || v === 1 || v === '1'; }
  function normIdentities(res) {
    res = res || {};
    var list = Array.isArray(res.identities) ? res.identities : [];
    var items = list.filter(function (x) { return x && x.id !== undefined; }).map(function (x) {
      return {
        id: x.id, provider: String(x.provider || ''), display: x.display || '', verified: bool(x.verified),
        linked_at: x.linked_at || '', last_login_at: x.last_login_at || '', status: x.status || 'active'
      };
    });
    var p = res.prefs || {};
    var cu = res.can_unlink && typeof res.can_unlink === 'object' ? res.can_unlink : {};
    var bn = res.battlenet_linked !== undefined ? bool(res.battlenet_linked)
      : items.some(function (i) { return i.provider === 'battlenet' && i.status === 'active'; });
    return {
      identities: items,
      prefs: { show_twitch_name: bool(p.show_twitch_name), show_battletag: bool(p.show_battletag) },
      canUnlink: cu,
      battlenetLinked: bn,
      graceUntil: res.grace_until ? String(res.grace_until) : ''
    };
  }
  function normKeys(res) {
    var arr = Array.isArray(res) ? res : (res && Array.isArray(res.items) ? res.items : (res && Array.isArray(res.keys) ? res.keys : []));
    return arr.filter(function (k) { return k && k.id !== undefined; }).map(function (k) {
      return {
        id: k.id, key_prefix: k.key_prefix || k.prefix || '', label: k.label || '', created_at: k.created_at || '',
        last_used_at: k.last_used_at || '', revoked_at: k.revoked_at || '',
        uploads_ok: Number(k.uploads_ok) || 0, rejected_tag_mismatch: Number(k.rejected_tag_mismatch) || 0
      };
    });
  }

  // ---- pure helpers ----
  // True when grace_until parses and is still in the future (`now` injectable for tests).
  function graceActive(until, now) {
    if (!until) return false;
    var t = Date.parse(until);
    return !isNaN(t) && t > (now === undefined ? Date.now() : now);
  }

  // Display-name resolution (IDENTITY_NORTHSTAR I9/IQ-4). Twitch name only when the user opted in; the
  // BattleTag is never produced here. Accepts the tolerant field shapes the clubs/profile endpoints may use.
  function displayName(x) {
    x = x || {};
    var handle = x.handle || x.author_handle || (x.user && x.user.handle) || '';
    var tw = x.twitch_login || x.twitch_name || (x.twitch && (x.twitch.login || x.twitch.name)) || '';
    var opt = x.show_twitch_name !== undefined ? bool(x.show_twitch_name)
      : (x.twitch && x.twitch.show !== undefined ? bool(x.twitch.show) : false);
    if (tw && opt) return { text: String(tw), twitch: true, handle: handle };
    return { text: handle ? '@' + handle : '', twitch: false, handle: handle };
  }
  // Rank-badge wording: a leaderboard row matched to a linked BattleTag name is "Leaderboard-matched", never
  // "verified" (I3: it is a name match, not a cryptographic proof).
  function rankLabel(verified) { return verified ? 'Leaderboard-matched' : 'unverified'; }

  // Install commands, built client-side from the one-time key (installer URL = this origin).
  //  inline: key on the command line (lands in shell history / AV logs) -- convenient.
  //  saveOnce: no key on the command line; the script prompts with a hidden input and stores the key
  //            DPAPI-encrypted under %APPDATA%\WOTAN. The key is pasted at the prompt instead.
  function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
  function oneLiners(base, key) {
    base = String(base || '').replace(/\/+$/, '');
    var head = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-RestMethod ' + psQuote(base + '/api/v1/hs/live/uplink.ps1') + '))) -Base ' + psQuote(base);
    return {
      inline: head + (key ? ' -Key ' + psQuote(key) : ' -Key \'<your key>\'') + ' -SaveKey"',
      saveOnce: head + ' -SaveKey"'
    };
  }

  // What the backend may redirect back with after a link attempt: ?linked=battlenet or ?link_error=identity_taken
  // (also accepted: ?error=, and the same keys in a #fragment). Returns {linked, error} (strings, maybe '').
  function readLinkReturn(search, hash) {
    var out = { linked: '', error: '' };
    [search, hash].forEach(function (s) {
      if (!s) return;
      var p = new URLSearchParams(String(s).replace(/^[?#]/, ''));
      out.linked = out.linked || p.get('linked') || '';
      out.error = out.error || p.get('link_error') || p.get('error') || '';
    });
    return out;
  }

  function sameOriginReturn(loc) {
    loc = loc || root.location || {};
    return String(loc.origin || '') + String(loc.pathname || '/') + String(loc.search || '');
  }
  // Full-page navigation target for starting a link flow. returnTo defaults to the current page.
  function linkURL(provider, returnTo) {
    var ret = returnTo || sameOriginReturn();
    var u = provider === 'twitch' ? CONFIG.twitchStart : CONFIG.battlenetStart;
    var p = new URLSearchParams();
    if (provider !== 'twitch') p.set('mode', 'link');
    p.set('redirect_uri', ret);
    var t = token();
    if (t) p.set(CONFIG.linkTokenParam, t);
    return u + '?' + p.toString();
  }
  function beginLink(provider, returnTo) { root.location.assign(linkURL(provider, returnTo)); }

  // ---- API ----
  var cache = null;
  var IDAPI = {
    CONFIG: CONFIG,
    PROVIDER_LABEL: PROVIDER_LABEL,
    friendly: friendly,
    hasSession: function () { return !!token(); },

    identities: async function () { cache = null; return normIdentities(await request('GET', ME + '/identities')); },
    // Cached snapshot for gates (one request per page load); status(true) forces a refetch.
    status: function (force) {
      if (!token()) return Promise.resolve({ signedIn: false, battlenetLinked: false, graceUntil: '', graceActive: false, unknown: false });
      if (!cache || force) {
        cache = request('GET', ME + '/identities').then(function (r) {
          var n = normIdentities(r);
          return { signedIn: true, battlenetLinked: n.battlenetLinked, graceUntil: n.graceUntil, graceActive: graceActive(n.graceUntil), unknown: false };
        }, function (e) {
          // Backend not reachable / not deployed: do not lock people out client-side; the server still enforces.
          return { signedIn: true, battlenetLinked: false, graceUntil: '', graceActive: false, unknown: true, error: e };
        });
      }
      return cache;
    },
    setPrefs: function (prefs) { cache = null; return request('PUT', ME + '/identities/prefs', prefs); },
    unlink: function (id) { cache = null; return request('DELETE', ME + '/identities/' + encodeURIComponent(id)); },

    uploadKeys: async function () { return normKeys(await request('GET', ME + '/upload-keys')); },
    createUploadKey: async function (label) {
      var r = await request('POST', ME + '/upload-keys', label ? { label: label } : {});
      return { key: r && r.key ? String(r.key) : '', prefix: (r && (r.prefix || r.key_prefix)) || '', id: r && r.id };
    },
    revokeUploadKey: function (id) { return request('DELETE', ME + '/upload-keys/' + encodeURIComponent(id)); },

    linkURL: linkURL,
    beginLink: beginLink,

    graceActive: graceActive,
    displayName: displayName,
    rankLabel: rankLabel,
    oneLiners: oneLiners,
    readLinkReturn: readLinkReturn,
    _normIdentities: normIdentities,
    _normKeys: normKeys
  };

  root.IDAPI = IDAPI;
  if (typeof module !== 'undefined' && module.exports) module.exports = IDAPI;
})(typeof window !== 'undefined' ? window : globalThis);
