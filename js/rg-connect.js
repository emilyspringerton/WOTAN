// /redgarden/connect.html -- the browser half of the REDGARDEN client's IDUNA login.
//
// The native client opens this page with ?port=<loopback port>&state=<nonce>, then waits on
// http://127.0.0.1:<port>/cb. This page registers/logs in against IDUNA's generic game routes
// (/api/v1/games/redgarden/*, same shape DEADWEIGHT uses), then navigates the browser to the
// loopback callback with the result. Same pattern as the Hearthstone tracker's sign-in: the client
// never sees a password, the nonce stops other local processes from injecting an identity.
(function () {
  'use strict';
  var G = '/api/v1/games/redgarden';
  var KEY = 'rg_connect_ctx';
  var PENDING = 'rg_sso_pending'; // set before the IAM trip; wotan-nav.js consumes the #sso_token fragment first
  var $ = function (id) { return document.getElementById(id); };
  var msg = $('msg');
  var ctx = { port: 0, state: '' };
  var current = null; // {player_id, display_name, token, exp, guest_secret?, is_guest}

  function say(text, err) { msg.textContent = text || ''; msg.className = 'rg-msg' + (err ? ' err' : ''); }
  function busy(on) { Array.prototype.forEach.call(document.querySelectorAll('button, a.rg-btn'), function (b) { if (b.tagName === 'BUTTON') b.disabled = on; }); }

  function loadCtx() {
    var q = new URLSearchParams(location.search);
    var port = parseInt(q.get('port') || '', 10), state = q.get('state') || '';
    if (port && state) {
      ctx = { port: port, state: state };
      try { sessionStorage.setItem(KEY, JSON.stringify(ctx)); } catch (e) { /* ignore */ }
    } else {
      try { var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (saved && saved.port && saved.state) ctx = saved; } catch (e) { /* ignore */ }
    }
    if (!(ctx.port >= 1024 && ctx.port <= 65535) || !/^[0-9a-f]{16,64}$/.test(ctx.state)) ctx = { port: 0, state: '' };
  }

  async function post(path, body, token) {
    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var res;
    try { res = await fetch(G + path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) }); }
    catch (e) { throw new Error('Could not reach the server. Check your connection and try again.'); }
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      var m = (data && (data.error || data.message)) || ('Server error (' + res.status + ')');
      if (res.status === 429) m = 'Too many new accounts from this network today. Try again tomorrow, or sign in to an existing account.';
      var err = new Error(m); err.status = res.status; throw err;
    }
    return data;
  }

  // Hand the identity to the native client (top-level navigation to loopback: no CORS, no
  // mixed-content or private-network-access problems).
  function finish(who) {
    if (!ctx.port) {
      $('new').hidden = true; $('back').hidden = true; $('save').hidden = true;
      say('Signed in as ' + who.display_name + '. Start the REDGARDEN client from its own window to continue; this page was opened without it.');
      return;
    }
    var p = new URLSearchParams({
      state: ctx.state, player_id: who.player_id, name: who.display_name || '',
      token: who.token, exp: String(who.exp || 0)
    });
    if (who.guest_secret) p.set('secret', who.guest_secret);
    try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    say('Connected as ' + who.display_name + '. Returning to the game…');
    location.href = 'http://127.0.0.1:' + ctx.port + '/cb?' + p.toString();
  }

  function adopt(d, secret) {
    return { player_id: d.player_id, display_name: d.display_name || '', token: d.token, exp: d.expires_at,
             guest_secret: secret || d.guest_secret || '', is_guest: d.account_state !== 'base' };
  }

  $('f-new').addEventListener('submit', async function (e) {
    e.preventDefault(); busy(true); say('Creating your account…');
    try {
      var d = await post('/guest-register', { display_name: $('name').value.trim() });
      current = adopt(d, d.guest_secret);
      $('new').hidden = true; $('back').hidden = true; $('save').hidden = false;
      say('Welcome, ' + current.display_name + '.');
    } catch (err) { say(err.message, true); }
    busy(false);
  });

  $('f-save').addEventListener('submit', async function (e) {
    e.preventDefault(); if (!current) return; busy(true); say('Saving…');
    try {
      var d = await post('/guest-upgrade', { email: $('se').value.trim(), password: $('sp').value }, current.token);
      current.token = d.token || current.token; current.exp = d.expires_at || current.exp; current.is_guest = false;
      finish(current);
    } catch (err) {
      say(err.status === 409 ? 'That email already has an account. Use "Sign in" above instead, or skip.' : err.message, true);
    }
    busy(false);
  });
  $('skip').addEventListener('click', function () { if (current) finish(current); });

  $('f-login').addEventListener('submit', async function (e) {
    e.preventDefault(); busy(true); say('Signing in…');
    try {
      var d = await post('/email-login', { email: $('le').value.trim(), password: $('lp').value });
      finish(adopt(d, ''));
    } catch (err) { say(err.status === 401 ? 'Wrong email or password.' : err.message, true); }
    busy(false);
  });

  async function ssoExchange(tok) {
    busy(true); say('Signing in with IDUNA…');
    try {
      var d = await post('/sso-exchange', {}, tok);
      finish(adopt(d, ''));
    } catch (err) {
      say(err.status === 404 || err.status === 403
        ? 'This IDUNA identity has no REDGARDEN account yet (or belongs to another game). Pick a name above to create one.'
        : err.message, true);
    }
    busy(false);
  }

  loadCtx();
  $('sso').addEventListener('click', function (e) {
    e.preventDefault();
    try { sessionStorage.setItem(KEY, JSON.stringify(ctx)); sessionStorage.setItem(PENDING, '1'); } catch (err) { /* ignore */ }
    // buildSsoURL() returns to this exact page; ctx is restored from sessionStorage above.
    location.href = (typeof buildSsoURL === 'function') ? buildSsoURL() : 'https://iam.okemily.com/';
  });

  // wotan-nav.js runs first and stores the returned SSO token in the shared session, so read it from
  // there when we know we just came back from IAM.
  var returning = false;
  try { returning = sessionStorage.getItem(PENDING) === '1'; sessionStorage.removeItem(PENDING); } catch (e) { returning = false; }
  var sess = null;
  try { sess = typeof getIdunaSession === 'function' ? getIdunaSession() : null; } catch (e) { sess = null; }
  if (returning && sess && sess.token) ssoExchange(sess.token);
  else if (!ctx.port) say('Tip: this page is normally opened by the REDGARDEN client. You can still create an account here.');
})();
