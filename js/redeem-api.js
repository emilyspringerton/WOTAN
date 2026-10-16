// WOTAN "Redeem a code" client. EVERY redeem-related backend path, and every word the site says about the
// answer, lives in THIS file (same house rule as identity-api.js), so the Redeem page and the account
// overview can never drift apart, and scripts/redeem-test.js can require() it under plain node.
//
//   POST /api/v1/redeem {code}    -> {ok, game, game_name, code, tickets_granted, founder, was_founder, tier,
//                                      tickets_before, tickets, player_id, display_name}
//   GET  /api/v1/me/entitlements  -> {player_id, games:[{game,name,player_id,display_name,founder,tickets,account_state}],
//                                      redemptions:[{code,game,game_name,tickets,founder,tier,redeemed_at}]}
//   Errors: {error:<prose>, code:<machine code>}      (IDUNA internal/http/handlers/account_redeem.go)
//
// The server only reports what changed; describe() below is where "what it did" becomes words.
(function (root) {
  'use strict';

  var REDEEM = '/api/v1/redeem';
  var ENTITLEMENTS = '/api/v1/me/entitlements';
  var CODE_RE = /^[A-Z0-9]{5}(-[A-Z0-9]{5}){4}$/;
  // IDUNA game_online.go founderDailyCap: the balance a Founder is lifted to. "Effectively unlimited".
  var UNLIMITED_AT = 9999;
  // Where "Play" goes after a redemption. Only games that have a page on this site.
  var PLAY = { deadweight: '/DEADWEIGHT/', brawlpit: '/BRAWLPIT/' };

  var MESSAGES = {
    invalid_code_format: 'That does not look like a code. Codes are five groups of five letters and numbers, like XXXXX-XXXXX-XXXXX-XXXXX-XXXXX.',
    code_unavailable: 'That code is not valid, or it has already been used. Check it for typos and try again.',
    agent_token: 'Sign in with your IDUNA account to redeem a code.',
    no_subject: 'Sign in with your IDUNA account to redeem a code.',
    invalid_json: 'Something went wrong sending that. Try again.',
    internal: 'Something went wrong on our side. Try again in a moment.'
  };

  // ---------- code entry ----------

  // Live formatting for the input: upper-case, only letters and digits, at most 25 of them, grouped five by
  // five with dashes. A dash appears only once a character follows it, so Backspace never fights the format.
  // Works for typing and for pasting a code with spaces, dashes or no dashes at all.
  function formatCodeInput(raw) {
    var s = String(raw === null || raw === undefined ? '' : raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 25);
    var out = [];
    for (var i = 0; i < s.length; i += 5) out.push(s.slice(i, i + 5));
    return out.join('-');
  }
  function isCodeShape(formatted) { return CODE_RE.test(String(formatted || '')); }

  // Pulls a dashed code out of pasted prose ("Your code: ABCDE-12345-... thanks!") so the words around it do not
  // end up inside the box. Needs the dashes and a boundary on both sides; anything else is left to formatCodeInput.
  var FIND_RE = /(?:^|[^A-Za-z0-9])([A-Za-z0-9]{5}(?:-[A-Za-z0-9]{5}){4})(?![A-Za-z0-9])/;
  function extractCode(text) {
    var m = FIND_RE.exec(String(text === null || text === undefined ? '' : text));
    return m ? m[1].toUpperCase() : '';
  }

  // Index in `formatted` just after its Nth letter/digit -- keeps the caret where the person was typing when
  // the input is re-formatted under them.
  function caretAfter(formatted, count) {
    if (count <= 0) return 0;
    var n = 0;
    for (var i = 0; i < formatted.length; i++) {
      if (formatted.charAt(i) !== '-') { n++; if (n === count) return i + 1; }
    }
    return formatted.length;
  }

  // ---------- words ----------

  function fmt(n) { n = Math.round(Number(n) || 0); return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function ticketWord(game) { return game === 'deadweight' ? 'Draft tickets' : 'Tickets'; }

  // The one-line description of a redeemed code in a history list ("Founder status", "+10 tickets").
  function summarize(x) {
    x = x || {};
    var parts = [];
    if (x.founder) parts.push('Founder status');
    var t = Number(x.tickets) || 0;
    if (t > 0) parts.push('+' + fmt(t) + ' ' + plural(t, 'ticket', 'tickets'));
    if (x.tier) parts.push('account tier ' + x.tier);
    return parts.length ? parts.join(' and ') : 'Code redeemed';
  }

  // "What it did", from a redeem answer. Returns
  //   {kind, title, lines[], tiles[{value,label}], appliedTo, code, play:{href,label}|null}
  // kind: 'founder' (newly unlocked), 'tickets', 'tier', or 'nothing' (the code was spent but changed nothing).
  function describe(r) {
    r = r || {};
    var game = String(r.game || '');
    var name = r.game_name || (game ? game.toUpperCase() : 'your');
    var tw = ticketWord(game);
    var before = Number(r.tickets_before) || 0;
    var after = Number(r.tickets) || 0;
    var granted = Number(r.tickets_granted) || 0;
    var newFounder = !!r.founder && !r.was_founder;
    var lines = [], tiles = [], kind, title;

    if (newFounder) {
      kind = 'founder';
      title = name + ' Founder unlocked';
      lines.push('Founder status is now on your account, for good.');
      if (after >= UNLIMITED_AT) {
        lines.push(tw + ': ' + (before > 0 && before !== after ? fmt(before) + ' → ' : '') + fmt(after) + ', effectively unlimited.');
      } else if (after !== before) {
        lines.push(tw + ': ' + fmt(before) + ' → ' + fmt(after) + '.');
      }
      if (granted > 0) lines.push('The code also carried ' + fmt(granted) + ' ' + plural(granted, 'ticket', 'tickets') + '.');
      tiles.push({ value: fmt(after), label: tw });
      tiles.push({ value: 'Founder', label: 'Status' });
    } else if (granted > 0 && !(r.founder && after === before)) {
      kind = 'tickets';
      title = '+' + fmt(granted) + ' ' + name + ' ' + plural(granted, 'ticket', 'tickets');
      lines.push(tw + ': ' + fmt(before) + ' → ' + fmt(after) + ' (+' + fmt(granted) + ').');
      tiles.push({ value: fmt(after), label: tw });
    } else if (r.tier) {
      kind = 'tier';
      title = name + ' account upgraded';
    } else {
      kind = 'nothing';
      title = 'Nothing new this time';
      if (r.was_founder && r.founder) {
        lines.push('Your account was already a ' + name + ' Founder, so this code did not add anything. It has been used up.');
        if (after > 0) tiles.push({ value: fmt(after), label: tw });
      } else {
        lines.push('This code was accepted, but it did not change anything on your account.');
      }
    }
    if (r.tier) lines.push('Account tier: ' + r.tier + '.');

    var appliedTo = r.display_name ? 'Applied to ' + r.display_name + ' in ' + name + '.' : '';
    var play = PLAY[game] ? { href: PLAY[game], label: 'Play ' + name } : null;
    return { kind: kind, title: title, lines: lines, tiles: tiles, appliedTo: appliedTo, code: r.code || '', play: play };
  }

  // Words for a failed call. err: {status, code, message} as thrown by request().
  function friendlyError(err) {
    err = err || {};
    if (err.code && MESSAGES[err.code]) return MESSAGES[err.code];
    if (err.status === 0 || err.code === 'network') return 'Could not reach the server. Check your connection and try again.';
    if (err.status === 401) return err.hadToken ? 'Your sign-in has expired. Sign in again, then redeem the code.' : 'Sign in to redeem a code.';
    if (err.status === 429) return 'Too many attempts. Wait a minute, then try again.';
    if (err.status === 404 && !err.code) return 'Redeeming codes is not switched on here yet. Try again later.';
    // other_game / wrong_game_token / no_account and anything new: the server's own sentence says it best.
    return err.message || 'Something went wrong (' + (err.status || '?') + ').';
  }

  // ---------- requests ----------

  function token() {
    try { var s = typeof root.getIdunaSession === 'function' ? root.getIdunaSession() : null; return s ? s.token : ''; }
    catch (e) { return ''; }
  }
  function hasSession() { return !!token(); }

  async function request(method, path, body) {
    var headers = { 'Accept': 'application/json' };
    var t = token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    var opts = { method: method, headers: headers, cache: 'no-store' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    var res;
    try { res = await root.fetch(path, opts); }
    catch (e) { var ne = new Error('network'); ne.status = 0; ne.code = 'network'; throw ne; }
    var text = '', data = null;
    try { text = await res.text(); } catch (e) { text = ''; }
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if (!res.ok) {
      var err = new Error(data && data.error ? String(data.error) : 'HTTP ' + res.status);
      err.status = res.status;
      err.code = data && data.code ? String(data.code) : '';
      err.hadToken = !!t;
      err.data = data;
      throw err;
    }
    return data;
  }

  var RedeemAPI = {
    formatCodeInput: formatCodeInput,
    isCodeShape: isCodeShape,
    extractCode: extractCode,
    caretAfter: caretAfter,
    describe: describe,
    summarize: summarize,
    friendlyError: friendlyError,
    messages: MESSAGES,
    fmt: fmt,
    hasSession: hasSession,
    // Spends a code. Resolves the server's answer; rejects with {status, code, message, hadToken}.
    redeem: function (code) { return request('POST', REDEEM, { code: code }); },
    // The account overview: {games, redemptions}, always arrays.
    entitlements: async function () {
      var r = (await request('GET', ENTITLEMENTS)) || {};
      return { games: Array.isArray(r.games) ? r.games : [], redemptions: Array.isArray(r.redemptions) ? r.redemptions : [] };
    },
    _request: request
  };

  root.RedeemAPI = RedeemAPI;
  if (typeof module !== 'undefined' && module.exports) module.exports = RedeemAPI;
})(typeof window !== 'undefined' ? window : globalThis);
