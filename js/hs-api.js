// Tiny fetch wrapper for IDUNA's /api/v1/hs/* (same-origin via WOTAN's nginx /api/ proxy).
// JSON in/out, Bearer token from the shared IDUNA session when present, throws Error with the
// server's {error} message. A 401 throws an Error with .status === 401 and a plain "sign in" message;
// it never clears the stored session (the topbar widget owns that).
(function () {
  'use strict';
  var BASE = '/api/v1/hs';

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

  async function req(method, path, body, params) {
    var headers = { 'Accept': 'application/json' };
    var t = token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    var opts = { method: method, headers: headers };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    var res;
    try {
      res = await fetch(BASE + path + qs(params), opts);
    } catch (e) {
      var ne = new Error('Could not reach the server. Check your connection and try again.');
      ne.status = 0;
      throw ne;
    }
    var data = null;
    var text = '';
    try { text = await res.text(); } catch (e) { text = ''; }
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if (!res.ok) {
      var msg = data && data.error ? String(data.error)
        : res.status === 401 ? 'Sign in to do that.'
        : res.status === 404 ? 'Not found.'
        : res.status === 429 ? 'Slow down a little, then try again.'
        : 'Something went wrong (' + res.status + ').';
      if (res.status === 401 && !(data && data.error)) msg = token() ? 'Your session has expired. Sign in again.' : 'Sign in to do that.';
      var err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  var _meFallback = null;
  window.HS = {
    req: req,
    qs: qs,
    get: function (path, params) { return req('GET', path, undefined, params); },
    post: function (path, body) { return req('POST', path, body === undefined ? {} : body); },
    put: function (path, body) { return req('PUT', path, body === undefined ? {} : body); },
    patch: function (path, body) { return req('PATCH', path, body); },
    del: function (path) { return req('DELETE', path); },

    // Is there a stored IDUNA session (token present)? Cheap, synchronous.
    hasSession: function () { return !!token(); },

    // Resolves { signedIn, me } -- me is the /hs/me profile ({handle|null, bio, ...}) or null.
    // Shares the topbar's cached request when WotanNav is present.
    who: async function () {
      if (!token()) return { signedIn: false, me: null };
      var me = null;
      try {
        if (window.WotanNav) me = await window.WotanNav.getMe();
        else { if (!_meFallback) _meFallback = req('GET', '/me').catch(function () { return null; }); me = await _meFallback; }
      } catch (e) { me = null; }
      if (me && me.__unauth) return { signedIn: false, me: null };
      return { signedIn: true, me: me };
    }
  };
})();
