#!/usr/bin/env node
// Plain-node test for the identity-federation front end (IDENTITY_NORTHSTAR.md chunk ID-B). No browser, no network.
//   node scripts/identity-affordance-test.js
// Part 1: pure helpers in js/identity-api.js (one-liners, display name, rank wording, grace, link URLs, error codes).
// Part 2: the REAL account page / gate / club badge code inside a tiny DOM + fetch stub, asserting what renders and
//         which API calls are made. The backend is a stub written to the contract; nothing here proves the real
//         IDUNA endpoints behave this way.
// Part 3: static structure checks (script wiring, nav entry, HRIP uplink patch if the sibling repo is present).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const API = require(path.join(ROOT, 'js/identity-api.js'));

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

// ===== Part 1: pure helpers =====
const pure = [];
pure.push(['oneLiners: inline carries the key, save-once does not, both point at this origin', () => {
  const c = API.oneLiners('https://wotan.okemily.com/', 'wt_abc123');
  assert.ok(c.inline.includes("-Key 'wt_abc123'") && c.inline.includes('-SaveKey'));
  assert.ok(!c.saveOnce.includes('wt_abc123') && !c.saveOnce.includes('-Key') && c.saveOnce.includes('-SaveKey'));
  [c.inline, c.saveOnce].forEach((s) => {
    assert.ok(s.includes("'https://wotan.okemily.com/api/v1/hs/live/uplink.ps1'"), s);
    assert.ok(s.includes("-Base 'https://wotan.okemily.com'"), s);
    assert.ok(s.startsWith('powershell -NoProfile'));
  });
}]);
pure.push(['oneLiners: a single quote in a key cannot break out of the quoted argument', () => {
  const c = API.oneLiners('https://x.test', "a'b");
  assert.ok(c.inline.includes("-Key 'a''b'"), c.inline);
}]);
pure.push(['displayName: Twitch only when opted in; BattleTag never surfaces', () => {
  const on = API.displayName({ handle: 'bolt', twitch_login: 'BoltTV', show_twitch_name: true, battletag: 'Bolt#1234' });
  assert.deepStrictEqual([on.text, on.twitch, on.handle], ['BoltTV', true, 'bolt']);
  const off = API.displayName({ handle: 'bolt', twitch_login: 'BoltTV', show_twitch_name: false, battletag: 'Bolt#1234' });
  assert.deepStrictEqual([off.text, off.twitch], ['@bolt', false]);
  assert.ok(!JSON.stringify(off).includes('Bolt#1234'));
  assert.strictEqual(API.displayName({ handle: 'x', twitch_login: 'T' }).twitch, false, 'absent opt-in means off');
}]);
pure.push(['rankLabel: leaderboard-matched wording, never "verified"', () => {
  assert.strictEqual(API.rankLabel(true), 'Leaderboard-matched');
  assert.strictEqual(API.rankLabel(false), 'unverified');
}]);
pure.push(['graceActive: future only', () => {
  const now = Date.parse('2026-10-12T00:00:00Z');
  assert.strictEqual(API.graceActive('2026-11-11T00:00:00Z', now), true);
  assert.strictEqual(API.graceActive('2026-10-01T00:00:00Z', now), false);
  assert.strictEqual(API.graceActive('', now), false);
  assert.strictEqual(API.graceActive('garbage', now), false);
}]);
pure.push(['readLinkReturn: query and fragment, linked and error', () => {
  assert.deepStrictEqual(API.readLinkReturn('?linked=battlenet', ''), { linked: 'battlenet', error: '' });
  assert.deepStrictEqual(API.readLinkReturn('', '#link_error=identity_taken'), { linked: '', error: 'identity_taken' });
  assert.deepStrictEqual(API.readLinkReturn('', ''), { linked: '', error: '' });
}]);
pure.push(['normIdentities: tolerant of missing fields; battlenet_linked falls back to the rows', () => {
  const n = API._normIdentities({ identities: [{ id: 3, provider: 'battlenet', display: 'A#1' }] });
  assert.strictEqual(n.battlenetLinked, true);
  assert.deepStrictEqual(n.prefs, { show_twitch_name: false, show_battletag: false });
  assert.strictEqual(API._normIdentities({}).identities.length, 0);
  assert.strictEqual(API._normIdentities({ identities: [], battlenet_linked: false, grace_until: '2026-11-01T00:00:00Z' }).graceUntil, '2026-11-01T00:00:00Z');
}]);
pure.push(['friendly: every contract error code has plain-language text', () => {
  ['identity_taken', 'provider_not_configured', 'battlenet_required'].forEach((c) => assert.ok(API.friendly(c) && !/_/.test(API.friendly(c)), c));
}]);

// ===== DOM stub (same shape as clubs-affordance-test.js) =====
class Node_ {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.parentNode = null; this.listeners = {}; this._text = ''; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.checked = false; this.dataset = {};
    this.style = { setProperty: () => {} }; this.classList = { add: (c) => { this.className = (this.className + ' ' + c).trim(); }, contains: (c) => this.className.split(/\s+/).includes(c) }; }
  get firstChild() { return this.children[0] || null; }
  get nodeType() { return 1; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'hidden') this.hidden = true; if (k === 'disabled') this.disabled = true; if (k === 'value') this.value = String(v); if (k === 'checked') this.checked = true; if (k === 'class') this.className = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  querySelector() { return null; }
  focus() {} select() {}
}
class Text_ { constructor(s) { this.nodeType = 3; this._s = String(s); this.parentNode = null; } get textContent() { return this._s; } }
function walk(n, fn) { if (!n || n.nodeType === 3) return; fn(n); n.children.forEach((c) => walk(c, fn)); }
function findAll(n, pred) { const out = []; walk(n, (x) => { if (pred(x)) out.push(x); }); return out; }
const hasClass = (n, c) => n.className.split(/\s+/).includes(c);
const byText = (root, tag, re) => findAll(root, (n) => n.tagName === tag && re.test(n.textContent));
const click = (n) => Promise.all((n.listeners.click || []).map((f) => f({ preventDefault() {} })));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mkFixture(over) {
  return Object.assign({
    identities: [
      { id: 1, provider: 'battlenet', display: 'Main#1111', verified: true, linked_at: '2026-10-01T00:00:00Z', last_login_at: '2026-10-11T00:00:00Z', status: 'active' },
      { id: 2, provider: 'battlenet', display: 'Smurf#2222', verified: true, linked_at: '2026-10-02T00:00:00Z', last_login_at: '', status: 'active' },
      { id: 3, provider: 'google', display: 'me@example.com', verified: true, linked_at: '2026-09-01T00:00:00Z', last_login_at: '', status: 'active' }
    ],
    prefs: { show_twitch_name: false, show_battletag: false },
    can_unlink: { 1: true, 2: true, 3: false },
    battlenet_linked: true,
    keys: [
      { id: 10, key_prefix: 'wt_ab12cd', label: 'Gaming PC', created_at: '2026-10-05T00:00:00Z', last_used_at: '2026-10-11T00:00:00Z', revoked_at: null, uploads_ok: 42, rejected_tag_mismatch: 3 },
      { id: 11, key_prefix: 'wt_zz99yy', label: 'Old', created_at: '2026-09-05T00:00:00Z', last_used_at: '', revoked_at: '2026-09-20T00:00:00Z', uploads_ok: 1, rejected_tag_mismatch: 0 }
    ]
  }, over || {});
}

function buildEnv(fx, opts) {
  opts = opts || {};
  const byId = {};
  const root = new Node_('div'); byId.root = root; root.setAttribute('aria-busy', 'true');
  ['id-grace', 'create-btn', 'create-hint'].forEach((id) => { byId[id] = new Node_('div'); });
  const doc = { createElement: (tag) => new Node_(tag), createTextNode: (s) => new Text_(s), getElementById: (id) => byId[id] || null, body: new Node_('body'), addEventListener() {} };
  const calls = [];
  async function fetchStub(url, o) {
    const m = (o && o.method) || 'GET';
    const u = String(url);
    calls.push({ m, url: u, body: o && o.body ? JSON.parse(o.body) : undefined, auth: o && o.headers && o.headers.Authorization });
    const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
    if (opts.failIdentities && u === '/api/v1/hs/me/identities') return reply(503, {});
    if (u === '/api/v1/hs/me/identities' && m === 'GET') return reply(200, { identities: fx.identities, prefs: fx.prefs, can_unlink: fx.can_unlink, battlenet_linked: fx.battlenet_linked, grace_until: fx.grace_until });
    if (u === '/api/v1/hs/me/identities/prefs' && m === 'PUT') return reply(200, {});
    if (/^\/api\/v1\/hs\/me\/identities\/\d+$/.test(u) && m === 'DELETE') return reply(200, {});
    if (u === '/api/v1/hs/me/upload-keys' && m === 'GET') return reply(200, { items: fx.keys });
    if (u === '/api/v1/hs/me/upload-keys' && m === 'POST') return opts.createError ? reply(403, { error: 'battlenet_required' }) : reply(200, { key: 'wt_SECRETKEYVALUE', prefix: 'wt_SECRET', id: 99 });
    if (/^\/api\/v1\/hs\/me\/upload-keys\/\d+$/.test(u) && m === 'DELETE') return reply(200, {});
    return reply(404, { error: 'not found' });
  }
  const nav = [];
  const ctx = {
    document: doc, fetch: fetchStub, console, URLSearchParams, setTimeout, clearTimeout, Date, JSON, Math, Object, Array, String, Number, Error, Promise, encodeURIComponent, isNaN,
    location: { search: opts.search || '', pathname: '/account/', origin: 'https://wotan.test', hash: '', assign: (u) => nav.push(u) },
    history: { replaceState() {} }, navigator: {}, sessionStorage: null, localStorage: null,
    getIdunaSession: () => (opts.signedOut ? null : { token: 'tok', playerID: 'p1', displayName: 'me' }),
    confirm: () => true
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  const files = ['js/hs-ui.js', 'js/identity-api.js', 'js/identity-gate.js'].concat(opts.page ? [opts.page] : []);
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  return { root, calls, ctx, doc, nav, byId };
}
async function settled(env) { for (let i = 0; i < 40; i++) await sleep(10); return env; }
const dialogs = (env) => findAll(env.doc.body, (n) => n.tagName === 'DIALOG');

(async function main() {
  for (const [name, fn] of pure) await t(name, fn);

  // ===== Part 2 =====
  await t('account page: identities listed; last-door unlink is disabled WITH a reason, others enabled', async () => {
    const env = await settled(buildEnv(mkFixture(), { page: 'js/identity-page-account.js' }));
    const tx = env.root.textContent;
    assert.match(tx, /Main#1111/); assert.match(tx, /Smurf#2222/); assert.match(tx, /me@example\.com/);
    const enabled = findAll(env.root, (n) => n.tagName === 'BUTTON' && n.textContent === 'Unlink' && !n.disabled);
    assert.strictEqual(enabled.length, 2, 'two unlinkable identities');
    const tips = findAll(env.root, (n) => hasClass(n, 'club-tip'));
    assert.strictEqual(tips.length, 1);
    assert.match(tips[0].attrs.title, /last way to sign in|upload keys depend/);
    assert.ok(byText(env.root, 'BUTTON', /Link another Battle\.net account/).length === 1);
    assert.ok(byText(env.root, 'BUTTON', /^Link Twitch$/).length === 1, 'twitch link offered when none linked');
    assert.ok(env.calls.every((c) => c.auth === 'Bearer tok'), 'every call carries the session token');
  });

  await t('account page: unlink issues DELETE /identities/{id}', async () => {
    const env = await settled(buildEnv(mkFixture(), { page: 'js/identity-page-account.js' }));
    const btn = findAll(env.root, (n) => n.tagName === 'BUTTON' && n.textContent === 'Unlink' && !n.disabled)[0];
    await click(btn); await sleep(30);
    assert.ok(env.calls.some((c) => c.m === 'DELETE' && c.url === '/api/v1/hs/me/identities/1'), JSON.stringify(env.calls.map((c) => c.m + ' ' + c.url)));
  });

  await t('account page: privacy toggles PUT prefs; Twitch toggle is disabled until Twitch is linked', async () => {
    const env = await settled(buildEnv(mkFixture(), { page: 'js/identity-page-account.js' }));
    const boxes = findAll(env.root, (n) => n.tagName === 'INPUT' && n.attrs.type === 'checkbox');
    assert.strictEqual(boxes.length, 2);
    assert.strictEqual(boxes[0].disabled, true, 'twitch toggle disabled without a twitch identity');
    boxes[1].checked = true; boxes[1].listeners.change.forEach((f) => f());
    await sleep(30);
    const put = env.calls.find((c) => c.m === 'PUT');
    assert.ok(put && put.url === '/api/v1/hs/me/identities/prefs' && put.body.show_battletag === true, JSON.stringify(put));
    assert.match(env.root.textContent, /Off by default/);
  });

  await t('account page: upload keys show prefix, counters, the rejected_tag_mismatch explanation, revoked keys have no Revoke', async () => {
    const env = await settled(buildEnv(mkFixture(), { page: 'js/identity-page-account.js' }));
    const tx = env.root.textContent;
    assert.match(tx, /wt_ab12cd/); assert.match(tx, /42 accepted/);
    assert.match(tx, /3 rejected: BattleTag not linked/);
    assert.match(tx, /not linked to your WOTAN account/);
    assert.strictEqual(byText(env.root, 'BUTTON', /^Revoke$/).length, 1, 'only the active key can be revoked');
    assert.match(tx, /Revoked/);
    assert.ok(!/wt_SECRET/.test(tx), 'no key material before creation');
  });

  await t('account page: create key -> one-time reveal with copy button and BOTH one-liners; revoke DELETEs', async () => {
    const env = await settled(buildEnv(mkFixture(), { page: 'js/identity-page-account.js' }));
    await click(findAll(env.root, (n) => n.attrs.id === 'create-key')[0]);
    await sleep(60);
    const post = env.calls.find((c) => c.m === 'POST');
    assert.ok(post && post.url === '/api/v1/hs/me/upload-keys');
    const reveal = findAll(env.root, (n) => hasClass(n, 'id-reveal'))[0];
    assert.ok(reveal, 'reveal block rendered');
    assert.match(reveal.textContent, /only time the key is shown/);
    assert.ok(findAll(reveal, (n) => n.tagName === 'BUTTON' && n.textContent === 'Copy').length >= 1, 'copy button');
    const areas = findAll(reveal, (n) => n.tagName === 'TEXTAREA').map((n) => n.value);
    assert.strictEqual(areas.length, 2);
    assert.ok(areas[0].includes('wt_SECRETKEYVALUE') && areas[0].includes('-SaveKey'), 'inline form');
    assert.ok(!areas[1].includes('wt_SECRETKEYVALUE') && areas[1].includes('-SaveKey'), 'save-once form has no key');
    const input = findAll(reveal, (n) => n.tagName === 'INPUT')[0];
    assert.strictEqual(input.value, 'wt_SECRETKEYVALUE');
    const rev = byText(env.root, 'BUTTON', /^Revoke$/)[0];
    await click(rev); await sleep(30);
    assert.ok(env.calls.some((c) => c.m === 'DELETE' && c.url === '/api/v1/hs/me/upload-keys/10'));
  });

  await t('account page: without a linked Battle.net the key form is replaced by a link prompt (no create button)', async () => {
    const env = await settled(buildEnv(mkFixture({ identities: [{ id: 3, provider: 'google', display: 'me@example.com', verified: true, status: 'active' }], can_unlink: { 3: false }, battlenet_linked: false, keys: [] }), { page: 'js/identity-page-account.js' }));
    assert.match(env.root.textContent, /Upload keys need a linked Battle\.net account/);
    assert.strictEqual(findAll(env.root, (n) => n.attrs.id === 'create-key').length, 0);
    assert.ok(byText(env.root, 'BUTTON', /Link a Battle\.net account/).length === 1);
  });

  await t('account page: link return messages (identity_taken is friendly, no raw code)', async () => {
    const env = await settled(buildEnv(mkFixture(), { page: 'js/identity-page-account.js', search: '?link_error=identity_taken' }));
    assert.match(env.root.textContent, /already linked to a different WOTAN account/);
    const ok = await settled(buildEnv(mkFixture(), { page: 'js/identity-page-account.js', search: '?linked=twitch' }));
    assert.match(ok.root.textContent, /Twitch account linked/);
  });

  await t('account page: backend down shows an error state, not a crash; signed out shows a plain-text sign-in hint', async () => {
    const down = await settled(buildEnv(mkFixture(), { page: 'js/identity-page-account.js', failIdentities: true }));
    assert.match(down.root.textContent, /That did not load/);
    const out = await settled(buildEnv(mkFixture(), { page: 'js/identity-page-account.js', signedOut: true }));
    assert.match(out.root.textContent, /Sign in required/);
    assert.strictEqual(findAll(out.root, (n) => n.tagName === 'BUTTON' && /sign in/i.test(n.textContent)).length, 0, 'never a Sign in button');
  });

  await t('gate: linked passes silently; unlinked shows the modal and Link routes to the Battle.net start; dismiss resolves false', async () => {
    const linked = buildEnv(mkFixture());
    assert.strictEqual(await linked.ctx.IDGate.require({ action: 'create a club' }), true);
    assert.strictEqual(dialogs(linked).length, 0);

    const env = buildEnv(mkFixture({ battlenet_linked: false, identities: [] }));
    const p = env.ctx.IDGate.require({ action: 'create a club' });
    await sleep(30);
    const dl = dialogs(env);
    assert.strictEqual(dl.length, 1);
    assert.match(dl[0].textContent, /Competitive Verification Required/);
    assert.match(dl[0].textContent, /create a club/);
    assert.strictEqual(byText(dl[0], 'BUTTON', /Continue for now/).length, 0, 'no bypass without grace');
    await click(byText(dl[0], 'BUTTON', /Link a Battle\.net account/)[0]);
    assert.strictEqual(env.nav.length, 1);
    assert.ok(env.nav[0].startsWith('/api/v1/auth/sso/battlenet/start?'), env.nav[0]);
    assert.match(env.nav[0], /mode=link/); assert.match(env.nav[0], /redirect_uri=https%3A%2F%2Fwotan\.test%2Faccount%2F/);
    await click(byText(dl[0], 'BUTTON', /Not now/)[0]);
    assert.strictEqual(await p, false);
    assert.strictEqual(dialogs(env).length, 0, 'modal removed');
  });

  await t('gate: grace window offers "Continue for now" (resolves true) and the banner names the date', async () => {
    const until = new Date(Date.now() + 20 * 86400000).toISOString();
    const env = buildEnv(mkFixture({ battlenet_linked: false, identities: [], grace_until: until }));
    const p = env.ctx.IDGate.require({ action: 'download the tracker' });
    await sleep(30);
    const dl = dialogs(env)[0];
    assert.match(dl.textContent, /keeps working until/);
    await click(byText(dl, 'BUTTON', /Continue for now/)[0]);
    assert.strictEqual(await p, true);
    const host = new Node_('div');
    assert.strictEqual(await env.ctx.IDGate.banner(host), true);
    assert.match(host.textContent, /Link Battle\.net by/);
    assert.strictEqual(host.hidden, false);
    const linkedEnv = buildEnv(mkFixture({ grace_until: until }));
    const h2 = new Node_('div');
    assert.strictEqual(await linkedEnv.ctx.IDGate.banner(h2), false, 'no banner once linked');
  });

  await t('gate: server-side battlenet_required opens the same modal; an unreachable backend never locks the UI', async () => {
    const env = buildEnv(mkFixture(), { page: 'js/identity-page-account.js', createError: true });
    const e = new Error('x'); e.code = 'battlenet_required';
    assert.strictEqual(env.ctx.IDGate.handleError(e, { action: 'create a club' }), true);
    await sleep(20);
    assert.strictEqual(dialogs(env).length, 1);
    assert.strictEqual(env.ctx.IDGate.handleError(new Error('other')), false);
    const down = buildEnv(mkFixture(), { failIdentities: true });
    assert.strictEqual(await down.ctx.IDGate.require({}), true);
    const anon = buildEnv(mkFixture(), { signedOut: true });
    assert.strictEqual(await anon.ctx.IDGate.require({}), true);
  });

  await t('club badges: Twitch name + mark when opted in, @handle otherwise; rank wording is Leaderboard-matched', async () => {
    const env = buildEnv(mkFixture());
    ['js/club-perms.js', 'js/club-api.js', 'js/club-ui.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), env.ctx, { filename: f }));
    const CUI = env.ctx.CUI;
    const a = CUI.nameLink({ handle: 'bolt', twitch_login: 'BoltTV', show_twitch_name: true });
    assert.match(a.textContent, /BoltTV/); assert.ok(findAll(a, (n) => hasClass(n, 'id-tw')).length === 1);
    assert.ok(!/@bolt/.test(a.textContent) || /BoltTV/.test(a.textContent));
    const b = CUI.nameLink({ handle: 'bolt', twitch_login: 'BoltTV', show_twitch_name: false });
    assert.match(b.textContent, /^@bolt$/);
    const r = CUI.rankBadge({ rank: { legend_rank: 9, rank_verified: true, region: 'EU' } });
    assert.match(r.textContent, /Leaderboard-matched/); assert.ok(!/\bverified\b/.test(r.textContent.replace(/unverified/g, '')));
    assert.match(CUI.rankBadge({ legend_rank: 55, rank_verified: false }).textContent, /unverified/);
  });

  // ===== Part 3: static structure =====
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  await t('wiring: account page, tracker and club index load the identity modules; nav links /account/', () => {
    const acct = read('account/index.html');
    ['identity-api.js', 'identity-gate.js', 'identity-page-account.js', 'wotan-nav.js', 'wotan-identity.css'].forEach((f) => assert.ok(acct.includes(f), 'account: ' + f));
    assert.ok(read('hearthstone/tracker.html').includes('identity-gate.js') && read('hearthstone/tracker.html').includes('identity-api.js'));
    assert.ok(read('clubs/index.html').includes('identity-gate.js'));
    assert.ok(read('js/wotan-nav.js').includes("href: '/account/'"));
    assert.ok(read('js/hs-page-tracker.js').includes("IDGate.require({ action: 'download the tracker' })"));
    assert.ok(read('js/club-page-index.js').includes("IDGate.require({ action: 'create a club' })"));
    // standing rule: pages never render their own Sign in button
    assert.ok(!/wn-signin|text: 'Sign in'/.test(read('js/identity-page-account.js')));
  });
  await t('wiring: every identity/upload-key URL lives in js/identity-api.js only', () => {
    const files = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js') && f !== 'identity-api.js');
    files.forEach((f) => {
      const s = read('js/' + f);
      assert.ok(!/\/identities|upload-keys|battlenet\/start|live\/exchange/.test(s), f + ' references an identity endpoint directly');
    });
  });
  await t('HRIP uplink patch (structure only; PowerShell is not run here)', () => {
    const p = path.join(ROOT, '..', 'HRIP', 'tracker', 'uplink', 'uplink-key.patch');
    if (!fs.existsSync(p)) { console.log('     (skipped: sibling HRIP checkout not present)'); return; }
    const added = fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n');
    ["[string]$Key = ''", '[switch]$SaveKey', '[switch]$ForgetKey', '/api/v1/hs/live/exchange', 'ConvertFrom-SecureString', 'ConvertTo-SecureString',
      'Get-UplinkToken', '$script:Token = Get-UplinkToken', '$env:APPDATA', '-AsSecureString', 'tags_linked'].forEach((s) => assert.ok(added.includes(s), 'missing ' + s));
    assert.ok(!added.includes('`'), 'a backtick would terminate the Go raw string that embeds the script');
    assert.ok(!/club/i.test(added.replace(/#.*$/gm, '')), 'uplink must never send a club id');
    const nopen = (c) => added.split(c).length - 1;
    ['{}', '()', '[]'].forEach((pr) => assert.strictEqual(nopen(pr[0]), nopen(pr[1]), 'unbalanced ' + pr));
    const removed = fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).join('\n');
    assert.ok(removed.includes('Get-IamToken') && !removed.includes('Syncing to'), 'only the token call is replaced');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
