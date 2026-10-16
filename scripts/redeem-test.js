#!/usr/bin/env node
// Plain-node test for js/redeem-api.js (the Redeem a Code page and account overview's one client for the redeem
// API). No browser, no network: pure helpers, then the request wiring against a fake fetch. The real page in a real
// browser against a real IDUNA is scripts/redeem-browser-test.mjs.
//   node scripts/redeem-test.js
'use strict';
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

// Everything below runs against a fresh module so the fake fetch / session globals are the ones it sees.
function load() {
  delete require.cache[require.resolve(path.join(ROOT, 'js/redeem-api.js'))];
  return require(path.join(ROOT, 'js/redeem-api.js'));
}
const API = load();

// ---- code entry ----
(async () => {
  await t('formatCodeInput: groups five by five, upper-cases, strips everything else', () => {
    const f = API.formatCodeInput;
    assert.strictEqual(f('abcde12345fghjk67890lmnpqrstu'), 'ABCDE-12345-FGHJK-67890-LMNPQ'); // capped at 25
    assert.strictEqual(f('  abcde-12345 fghjk–67890\nlmnpq '), 'ABCDE-12345-FGHJK-67890-LMNPQ'); // spaces, dashes, en dash, newline
    assert.strictEqual(f(''), '');
    assert.strictEqual(f(null), '');
    assert.strictEqual(f(undefined), '');
    assert.strictEqual(f('!!!'), '');
  });
  await t('formatCodeInput: a dash only appears once a character follows it (Backspace never fights the format)', () => {
    const f = API.formatCodeInput;
    assert.strictEqual(f('abcde'), 'ABCDE');
    assert.strictEqual(f('ABCDE-'), 'ABCDE');
    assert.strictEqual(f('abcdef'), 'ABCDE-F');
    assert.strictEqual(f(f('abcdef').slice(0, -1)), 'ABCDE'); // backspace over the 6th char leaves no dangling dash
  });
  await t('formatCodeInput: idempotent', () => {
    ['', 'a', 'abcde', 'abcdef', 'abcde12345fghjk67890lmnpq', 'x y-z'].forEach((s) => {
      const once = API.formatCodeInput(s);
      assert.strictEqual(API.formatCodeInput(once), once, s);
    });
  });
  await t('isCodeShape: exactly the server regex (5x5 upper-case letters/digits, dashes)', () => {
    assert.ok(API.isCodeShape('ABCDE-12345-FGHJK-67890-LMNPQ'));
    assert.ok(!API.isCodeShape('ABCDE-12345-FGHJK-67890-LMNP'));
    assert.ok(!API.isCodeShape('abcde-12345-fghjk-67890-lmnpq')); // callers format first
    assert.ok(!API.isCodeShape('ABCDE12345FGHJK67890LMNPQ'));
    assert.ok(!API.isCodeShape(''));
    assert.ok(!API.isCodeShape(null));
  });
  await t('a pasted code of any common shape ends up submittable', () => {
    const real = 'ABCDE-12345-FGHJK-67890-LMNPQ';
    [real, real.toLowerCase(), real.replace(/-/g, ''), ' ' + real + '\n', real.replace(/-/g, ' '), real.replace(/-/g, '–')].forEach((s) => {
      const f = API.formatCodeInput(s);
      assert.strictEqual(f, real, JSON.stringify(s));
      assert.ok(API.isCodeShape(f));
    });
  });
  await t('extractCode: lifts a dashed code out of pasted prose, and only a whole one', () => {
    const x = API.extractCode;
    assert.strictEqual(x('Your code: abcde-12345-fghjk-67890-lmnpq \u2014 enjoy!'), 'ABCDE-12345-FGHJK-67890-LMNPQ');
    assert.strictEqual(x('ABCDE-12345-FGHJK-67890-LMNPQ'), 'ABCDE-12345-FGHJK-67890-LMNPQ');
    assert.strictEqual(x('line one\n  ABCDE-12345-FGHJK-67890-LMNPQ\nline three'), 'ABCDE-12345-FGHJK-67890-LMNPQ');
    assert.strictEqual(x('xABCDE-12345-FGHJK-67890-LMNPQ'), '', 'no boundary before it');
    assert.strictEqual(x('ABCDE-12345-FGHJK-67890-LMNPQx'), '', 'no boundary after it');
    assert.strictEqual(x('ABCDE12345FGHJK67890LMNPQ'), '', 'dashless pastes go through formatCodeInput instead');
    assert.strictEqual(x('ABCDE-12345-FGHJK-67890'), '');
    assert.strictEqual(x(''), ''); assert.strictEqual(x(null), '');
  });
  await t('caretAfter: the caret stays after the Nth letter when dashes appear around it', () => {
    assert.strictEqual(API.caretAfter('ABCDE-F', 0), 0);
    assert.strictEqual(API.caretAfter('ABCDE-F', 5), 5);
    assert.strictEqual(API.caretAfter('ABCDE-F', 6), 7); // past the dash that was just inserted
    assert.strictEqual(API.caretAfter('ABCDE-FGHJK-LMNPQ', 11), 13); // just after the L
    assert.strictEqual(API.caretAfter('ABCDE-FGHJK-LMNPQ', 15), 17); // the very end
    assert.strictEqual(API.caretAfter('ABCDE', 99), 5);
  });

  // ---- what it did ----
  await t('describe: a founder code on a fresh account says Founder unlocked and the jump to 9,999', () => {
    const d = API.describe({ ok: true, game: 'deadweight', game_name: 'DEADWEIGHT', code: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE',
      tickets_granted: 0, founder: true, was_founder: false, tier: '', tickets_before: 25, tickets: 9999, display_name: 'Gary' });
    assert.strictEqual(d.kind, 'founder');
    assert.strictEqual(d.title, 'DEADWEIGHT Founder unlocked');
    assert.ok(d.lines.some((l) => /Founder status is now on your account/.test(l)), d.lines.join('|'));
    assert.ok(d.lines.some((l) => l === 'Draft tickets: 25 → 9,999, effectively unlimited.'), d.lines.join('|'));
    assert.deepStrictEqual(d.tiles, [{ value: '9,999', label: 'Draft tickets' }, { value: 'Founder', label: 'Status' }]);
    assert.strictEqual(d.appliedTo, 'Applied to Gary in DEADWEIGHT.');
    assert.deepStrictEqual(d.play, { href: '/DEADWEIGHT/', label: 'Play DEADWEIGHT' });
    assert.strictEqual(d.code, 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE');
  });
  await t('describe: founder code that also carried tickets mentions them', () => {
    const d = API.describe({ game: 'deadweight', game_name: 'DEADWEIGHT', tickets_granted: 10, founder: true, was_founder: false, tickets_before: 1, tickets: 9999 });
    assert.strictEqual(d.kind, 'founder');
    assert.ok(d.lines.some((l) => /also carried 10 tickets/.test(l)), d.lines.join('|'));
  });
  await t('describe: a second founder code says it changed nothing (and does not shout Founder unlocked)', () => {
    const d = API.describe({ game: 'deadweight', game_name: 'DEADWEIGHT', tickets_granted: 0, founder: true, was_founder: true, tickets_before: 9999, tickets: 9999, display_name: 'Gary' });
    assert.strictEqual(d.kind, 'nothing');
    assert.strictEqual(d.title, 'Nothing new this time');
    assert.ok(/already a DEADWEIGHT Founder/.test(d.lines[0]) && /used up/.test(d.lines[0]), d.lines[0]);
    assert.ok(!/unlocked/i.test(d.title + d.lines.join(' ')));
  });
  await t('describe: a ticket pack states the before and after balance', () => {
    const d = API.describe({ game: 'deadweight', game_name: 'DEADWEIGHT', tickets_granted: 10, founder: false, was_founder: false, tickets_before: 25, tickets: 35 });
    assert.strictEqual(d.kind, 'tickets');
    assert.strictEqual(d.title, '+10 DEADWEIGHT tickets');
    assert.deepStrictEqual(d.lines, ['Draft tickets: 25 → 35 (+10).']);
    assert.deepStrictEqual(d.tiles, [{ value: '35', label: 'Draft tickets' }]);
    assert.strictEqual(API.describe({ game: 'deadweight', game_name: 'DEADWEIGHT', tickets_granted: 1, tickets_before: 0, tickets: 1 }).title, '+1 DEADWEIGHT ticket');
  });
  await t('describe: a tier-only code, and a code that changed nothing at all', () => {
    const tier = API.describe({ game: 'deadweight', game_name: 'DEADWEIGHT', tier: 'tier_premium', tickets_before: 5, tickets: 5 });
    assert.strictEqual(tier.kind, 'tier');
    assert.ok(tier.lines.includes('Account tier: tier_premium.'));
    const none = API.describe({ game: 'deadweight', game_name: 'DEADWEIGHT', tickets_before: 5, tickets: 5 });
    assert.strictEqual(none.kind, 'nothing');
    assert.ok(/did not change anything/.test(none.lines[0]));
  });
  await t('describe: a game with no page on this site gets no Play button; unknown shapes never throw', () => {
    assert.strictEqual(API.describe({ game: 'big_o', game_name: 'BIG_O', founder: true, tickets: 9999 }).play, null);
    assert.doesNotThrow(() => API.describe(null));
    assert.doesNotThrow(() => API.describe({}));
  });
  await t('summarize: one line per history row', () => {
    assert.strictEqual(API.summarize({ founder: true, tickets: 0 }), 'Founder status');
    assert.strictEqual(API.summarize({ founder: false, tickets: 10 }), '+10 tickets');
    assert.strictEqual(API.summarize({ founder: true, tickets: 1 }), 'Founder status and +1 ticket');
    assert.strictEqual(API.summarize({ tier: 'tier_premium' }), 'account tier tier_premium');
    assert.strictEqual(API.summarize({}), 'Code redeemed');
  });

  // ---- failure words ----
  await t('friendlyError: a stable code wins; otherwise status; otherwise the server sentence', () => {
    const f = API.friendlyError;
    assert.strictEqual(f({ status: 400, code: 'code_unavailable' }), API.messages.code_unavailable);
    assert.ok(/not valid, or it has already been used/.test(f({ status: 400, code: 'code_unavailable' })));
    assert.ok(/five groups of five/.test(f({ status: 400, code: 'invalid_code_format' })));
    assert.ok(/expired/.test(f({ status: 401, hadToken: true })));
    assert.strictEqual(f({ status: 401, hadToken: false }), 'Sign in to redeem a code.');
    assert.ok(/Too many attempts/.test(f({ status: 429 })));
    assert.ok(/Could not reach the server/.test(f({ status: 0, code: 'network' })));
    assert.ok(/not switched on here yet/.test(f({ status: 404 })));
    assert.strictEqual(f({ status: 403, code: 'other_game', message: 'This account already belongs to a different game, so a DEADWEIGHT code cannot be applied to it.' }),
      'This account already belongs to a different game, so a DEADWEIGHT code cannot be applied to it.');
    assert.ok(/Something went wrong \(500\)/.test(f({ status: 500 })));
    assert.doesNotThrow(() => f(null));
  });

  // ---- request wiring ----
  function fakeFetch(handler) {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      const r = await handler(url, opts);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
    };
    return calls;
  }
  await t('redeem: POSTs {code} to /api/v1/redeem with the shared session token and returns the answer', async () => {
    globalThis.getIdunaSession = () => ({ token: 'tok-123', playerID: 'p1' });
    const answer = { ok: true, game: 'deadweight', founder: true, tickets: 9999 };
    const calls = fakeFetch(() => ({ status: 200, body: answer }));
    const api = load();
    const got = await api.redeem('ABCDE-12345-FGHJK-67890-LMNPQ');
    assert.deepStrictEqual(got, answer);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, '/api/v1/redeem');
    assert.strictEqual(calls[0].opts.method, 'POST');
    assert.strictEqual(calls[0].opts.headers['Authorization'], 'Bearer tok-123');
    assert.strictEqual(calls[0].opts.headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { code: 'ABCDE-12345-FGHJK-67890-LMNPQ' });
  });
  await t('redeem: a refusal rejects with status, machine code and the server sentence', async () => {
    globalThis.getIdunaSession = () => ({ token: 'tok-123', playerID: 'p1' });
    fakeFetch(() => ({ status: 400, body: { error: 'That code is not valid, or it has already been used.', code: 'code_unavailable' } }));
    const api = load();
    await assert.rejects(() => api.redeem('ABCDE-12345-FGHJK-67890-LMNPQ'), (e) => {
      assert.strictEqual(e.status, 400); assert.strictEqual(e.code, 'code_unavailable');
      assert.strictEqual(e.hadToken, true);
      assert.strictEqual(api.friendlyError(e), api.messages.code_unavailable);
      return true;
    });
  });
  await t('redeem: a dead network rejects as status 0 / network, and a 401 remembers whether a token was sent', async () => {
    globalThis.getIdunaSession = () => ({ token: 'tok-123', playerID: 'p1' });
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    let api = load();
    await assert.rejects(() => api.redeem('X'), (e) => e.status === 0 && e.code === 'network');
    fakeFetch(() => ({ status: 401, body: { error: 'invalid token' } }));
    api = load();
    await assert.rejects(() => api.redeem('X'), (e) => e.status === 401 && e.hadToken === true && /expired/.test(api.friendlyError(e)));
    globalThis.getIdunaSession = () => null;
    api = load();
    assert.strictEqual(api.hasSession(), false);
    await assert.rejects(() => api.redeem('X'), (e) => e.status === 401 && e.hadToken === false && api.friendlyError(e) === 'Sign in to redeem a code.');
  });
  await t('entitlements: GETs /api/v1/me/entitlements and always answers with arrays', async () => {
    globalThis.getIdunaSession = () => ({ token: 'tok-123', playerID: 'p1' });
    let calls = fakeFetch(() => ({ status: 200, body: { player_id: 'p1', games: [{ game: 'deadweight', founder: true, tickets: 9999 }], redemptions: [{ code: 'A' }] } }));
    let api = load();
    let e = await api.entitlements();
    assert.strictEqual(calls[0].url, '/api/v1/me/entitlements');
    assert.strictEqual(calls[0].opts.method, 'GET');
    assert.strictEqual(e.games.length, 1); assert.strictEqual(e.redemptions.length, 1);
    fakeFetch(() => ({ status: 200, body: { player_id: 'p1', games: null, redemptions: null } }));
    api = load();
    e = await api.entitlements();
    assert.deepStrictEqual(e, { games: [], redemptions: [] });
  });

  // ---- static wiring ----
  const fs = require('fs');
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  await t('wiring: the redeem API paths live in js/redeem-api.js only', () => {
    ['js/redeem-widget.js', 'js/redeem-page.js', 'js/account-overview.js'].forEach((f) => {
      assert.ok(!/\/api\/v1\//.test(read(f)), f + ' must not hard-code API paths');
    });
  });
  await t('wiring: nav menu has Redeem a code, the acct skin has the two tabs, pages load the scripts in order', () => {
    const nav = read('js/wotan-nav.js');
    assert.ok(nav.includes("href: '/redeem/', text: 'Redeem a code'"));
    assert.ok(/acct: \[\s*\['account', 'Account', '\/account\/'\],\s*\['redeem', 'Redeem a code', '\/redeem\/'\]/.test(nav));
    const page = read('redeem/index.html');
    const order = ['/js/iduna-sso.js', '/js/wotan-nav.js', '/js/redeem-api.js', '/js/redeem-widget.js', '/js/redeem-page.js'].map((s) => page.indexOf(s));
    assert.ok(order.every((i) => i > 0) && order.every((v, i) => i === 0 || v > order[i - 1]), 'script order: ' + order);
    assert.ok(page.includes('data-skin="acct"') && page.includes('data-section="redeem"'));
    const acct = read('account/index.html');
    assert.ok(acct.includes('data-skin="acct"') && acct.includes('wotan-redeem.css'));
    ['redeem-api.js', 'redeem-widget.js', 'account-overview.js'].forEach((f) => assert.ok(acct.indexOf(f) > 0 && acct.indexOf(f) < acct.indexOf('identity-page-account.js'), f));
    assert.ok(!/<button[^>]*>\s*Sign in/i.test(page + acct), 'WOTAN rule: pages never render their own Sign in buttons');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
