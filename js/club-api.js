// Tiny fetch wrapper for IDUNA's /api/v1/clubs/* (CLUBS_NORTHSTAR.md §7.4), same-origin via WOTAN's
// nginx /api/ proxy. Mirrors js/hs-api.js: JSON in/out, Bearer from the shared IDUNA session, throws an
// Error carrying .status, .code (machine code such as exclusive_conflict) and .data (parsed body).
// A 401 never clears the stored session -- the topbar widget owns that.
(function () {
  'use strict';
  var BASE = '/api/v1/clubs';
  var HSBASE = '/api/v1/hs';

  function token() {
    try {
      var s = typeof getIdunaSession === 'function' ? getIdunaSession() : null;
      return s ? s.token : '';
    } catch (e) { return ''; }
  }
  function qs(params) {
    if (!params) return '';
    var p = new URLSearchParams();
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v !== undefined && v !== null && v !== '') p.set(k, v);
    });
    var s = p.toString();
    return s ? '?' + s : '';
  }

  async function request(base, method, path, body, params) {
    var headers = { 'Accept': 'application/json' };
    var t = token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    var opts = { method: method, headers: headers, cache: 'no-store' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    var res;
    try {
      res = await fetch(base + path + qs(params), opts);
    } catch (e) {
      var ne = new Error('Could not reach the server. Check your connection and try again.');
      ne.status = 0;
      throw ne;
    }
    var data = null, text = '';
    try { text = await res.text(); } catch (e) { text = ''; }
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if (!res.ok) {
      var msg = data && data.error ? String(data.error)
        : res.status === 401 ? 'Sign in to do that.'
        : res.status === 403 ? 'You do not have permission to do that.'
        : res.status === 404 ? 'Not found.'
        : res.status === 409 ? 'That conflicts with the current state. Reload and try again.'
        : res.status === 429 ? 'Slow down a little, then try again.'
        : 'Something went wrong (' + res.status + ').';
      if (res.status === 401 && !(data && data.error)) msg = token() ? 'Your session has expired. Sign in again.' : 'Sign in to do that.';
      var err = new Error(msg);
      err.status = res.status;
      err.code = data && data.code ? String(data.code) : '';
      err.data = data;
      throw err;
    }
    return data;
  }

  // Lists come back as {total,limit,offset,items}; tolerate a bare array and a missing items field.
  function items(res) {
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.items)) return res.items;
    return [];
  }

  function api(base) {
    return {
      get: function (p, params) { return request(base, 'GET', p, undefined, params); },
      post: function (p, b) { return request(base, 'POST', p, b === undefined ? {} : b); },
      put: function (p, b) { return request(base, 'PUT', p, b === undefined ? {} : b); },
      patch: function (p, b) { return request(base, 'PATCH', p, b === undefined ? {} : b); },
      del: function (p) { return request(base, 'DELETE', p); }
    };
  }

  var CLUB = api(BASE);
  CLUB.hs = api(HSBASE);          // /api/v1/hs/* (sync-target, rank) -- same token, same error shape
  CLUB.items = items;
  CLUB.qs = qs;
  CLUB.hasSession = function () { return !!token(); };
  CLUB.session = function () { try { return typeof getIdunaSession === 'function' ? getIdunaSession() : null; } catch (e) { return null; } };
  window.CLUB = CLUB;
})();
