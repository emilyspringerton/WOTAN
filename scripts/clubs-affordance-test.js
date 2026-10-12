#!/usr/bin/env node
// Plain-node test for the Clubs admin console's permission -> affordance logic. No jsdom, no network.
//   node scripts/clubs-affordance-test.js
// Part 1: table tests of js/club-perms.js against CLUBS_NORTHSTAR.md section 2.1/2.2.
// Part 2: runs the REAL js/club-page-manage.js (plus hs-ui.js, club-api.js, club-ui.js) inside a tiny
//         DOM + fetch stub, once per role, and asserts what the rendered console actually contains.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'js/club-perms.js'));

let passed = 0, failed = 0;
function t(name, fn) {
  try { const r = fn(); if (r && typeof r.then === 'function') return r.then(() => { passed++; console.log('ok   ' + name); }, (e) => { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
  return null;
}

// ---- the permission matrix straight from section 2.1 ----
const NODES = {
  player: ['club.view', 'club.roster.view', 'club.feed.read', 'club.feed.post', 'club.decks.read', 'club.analytics.view', 'club.telemetry.contribute'],
  coach: [], manager: []
};
NODES.coach = NODES.player.concat(['club.feed.moderate', 'club.decks.feature', 'club.members.invite', 'club.members.requests', 'club.members.remove.player']);
NODES.manager = NODES.coach.concat(['club.members.invite.elevated', 'club.members.remove.coach', 'club.members.remove.manager', 'club.members.promote', 'club.members.demote',
  'club.settings.edit', 'club.visibility.set', 'club.audit.view']);
const OWNER = NODES.manager.concat(['club.owner.transfer', 'club.delete']);
const actor = (role, perms) => ({ role: role, perms: perms || NODES[role] });

// ===== Part 1 =====
t('remove: coach can remove a player', () => assert.deepStrictEqual(P.removeAffordance(actor('coach'), { role: 'player' }).enabled, true));
t('remove: coach vs coach is disabled with a reason', () => {
  const a = P.removeAffordance(actor('coach'), { role: 'coach' });
  assert.strictEqual(a.visible, true); assert.strictEqual(a.enabled, false); assert.match(a.reason, /Coaches cannot remove other Coaches/);
});
t('remove: coach vs manager is disabled with a reason', () => {
  const a = P.removeAffordance(actor('coach'), { role: 'manager' });
  assert.strictEqual(a.enabled, false); assert.match(a.reason, /Only Managers/);
});
t('remove: manager can remove coach, player, other manager', () => {
  ['player', 'coach', 'manager'].forEach((r) => assert.strictEqual(P.removeAffordance(actor('manager'), { role: r }).enabled, true, r));
});
t('remove: nobody can remove the owner', () => {
  const a = P.removeAffordance(actor('manager', OWNER), { role: 'manager', is_owner: true });
  assert.strictEqual(a.enabled, false); assert.match(a.reason, /Owner/);
});
t('remove: self is disabled and points at Leave', () => {
  const a = P.removeAffordance(actor('manager'), { role: 'manager', is_me: true });
  assert.strictEqual(a.enabled, false); assert.match(a.reason, /Leave/);
});
t('remove: a player has no remove permission at all', () => {
  assert.strictEqual(P.removeAffordance(actor('player'), { role: 'player' }).enabled, false);
});
t('role change: coach sees nothing', () => assert.strictEqual(P.roleChangeAffordance(actor('coach'), { role: 'player' }, 2).visible, false));
t('role change: manager promotes player->coach only one step', () => {
  const r = P.roleChangeAffordance(actor('manager'), { role: 'player' }, 2);
  const by = {}; r.options.forEach((o) => { by[o.role] = o; });
  assert.strictEqual(by.coach.enabled, true);
  assert.strictEqual(by.manager.enabled, false); assert.match(by.manager.reason, /one step/);
});
t('role change: demote the last manager is blocked', () => {
  const r = P.roleChangeAffordance(actor('manager'), { role: 'manager' }, 1);
  r.options.forEach((o) => assert.strictEqual(o.enabled, false, o.role));
});
t('role change: own role and owner role are not editable', () => {
  assert.strictEqual(P.roleChangeAffordance(actor('manager'), { role: 'manager', is_me: true }, 3).options.length, 0);
  assert.strictEqual(P.roleChangeAffordance(actor('manager'), { role: 'manager', is_owner: true }, 3).options.length, 0);
});
t('invite roles: coach player only, manager all three, player none', () => {
  assert.deepStrictEqual(P.inviteRoles(NODES.coach), ['player']);
  assert.deepStrictEqual(P.inviteRoles(NODES.manager), ['player', 'coach', 'manager']);
  assert.deepStrictEqual(P.inviteRoles(NODES.player), []);
});
t('panels: owner-only panels follow owner nodes, not role', () => {
  assert.strictEqual(P.panels(NODES.manager).del, false);
  assert.strictEqual(P.panels(OWNER).del, true); assert.strictEqual(P.panels(OWNER).transfer, true);
  assert.strictEqual(P.panels(NODES.coach).visibility, false); assert.strictEqual(P.panels(NODES.coach).audit, false);
});
t('stealth toggle remembers the previous tier', () => {
  assert.deepStrictEqual(P.stealthToggle(3, 0).mode, 'dark');
  const s = P.stealthToggle(1, 3);
  assert.strictEqual(s.mode, 'reveal'); assert.strictEqual(s.restoreTo, 3); assert.match(s.label, /Social/);
  assert.strictEqual(P.stealthToggle('secret', 'private').restoreTo, 2);
});
t('join policy: request only offered for Social', () => {
  assert.strictEqual(P.joinPolicyOptions(3)[1].enabled, true);
  assert.strictEqual(P.joinPolicyOptions(2)[1].enabled, false);
  assert.strictEqual(P.joinPolicyOptions(1)[1].enabled, false);
});

// ===== Part 2: the real manage page in a DOM stub =====
class Node_ {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.parentNode = null; this.listeners = {}; this._text = ''; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.checked = false; this.dataset = {};
    this.style = { setProperty: () => {} }; this.classList = { add: (c) => { this.className = (this.className + ' ' + c).trim(); }, contains: (c) => this.className.split(/\s+/).includes(c) }; }
  get firstChild() { return this.children[0] || null; }
  get nodeType() { return 1; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
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

function buildEnv(fixture, page, loc, extraIds) {
  page = page || 'js/club-page-manage.js';
  const byId = {};
  const root = new Node_('div'); byId.root = root; root.setAttribute('aria-busy', 'true');
  (extraIds || []).forEach((id) => { byId[id] = new Node_(id.indexOf('btn') >= 0 ? 'button' : (id === 'list' || id === 'more' ? 'div' : 'input')); });
  if (byId['create-dlg']) byId['create-dlg'] = new Node_('dialog');
  const doc = {
    title: '',
    createElement: (tag) => new Node_(tag),
    createTextNode: (s) => new Text_(s),
    getElementById: (id) => byId[id] || null,
    body: new Node_('body'),
    addEventListener() {}
  };
  const calls = [];
  async function fetchStub(url, opts) {
    const u = String(url).replace(/\?.*$/, '');
    const m = (opts && opts.method) || 'GET';
    calls.push(m + ' ' + url);
    const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
    if (m !== 'GET' && u !== '/api/v1/clubs/invites/peek') return reply(200, {});
    if (u === '/api/v1/clubs/me/clubs') return reply(200, { items: [{ id: 'c1', slug: 'alpha', name: 'Alpha Club', role: fixture.role }] });
    if (u === '/api/v1/clubs/by-slug/alpha') return reply(200, { id: 'c1', slug: 'alpha', name: 'Alpha Club', privacy_tier: 1, prev_tier: 3, is_exclusive: false, join_policy: 'invite', brand: { accent: '#336699' } });
    if (u === '/api/v1/clubs/c1/me') return reply(200, { role: fixture.role, perms: fixture.perms });
    if (u === '/api/v1/clubs/c1/members') return reply(200, { items: [
      { sub: 's-me', handle: 'me', role: fixture.role, is_me: true, is_owner: fixture.role === 'manager' },
      { sub: 's-m', handle: 'otherboss', role: 'manager' },
      { sub: 's-c', handle: 'othercoach', role: 'coach' },
      { sub: 's-p', handle: 'newbie', role: 'player', legend_rank: 800, rank_verified: false }] });
    if (u === '/api/v1/hs/me') return reply(200, { handle: 'me' });
    if (u === '/api/v1/clubs/by-slug/ghost') return reply(404, { error: 'not found' });
    if (u === '/api/v1/clubs/by-slug/alpha/roster') return reply(200, { items: [{ handle: 'boss', role: 'manager', legend_rank: 55, rank_verified: false }, { handle: 'bolt', role: 'player', rank: { legend_rank: 9, rank_verified: true, region: 'EU' } }] });
    if (u === '/api/v1/clubs/c1/feed') return reply(200, { total: 1, items: [{ id: 7, handle: 'bolt', body: '<img src=x onerror=alert(1)>', pinned: true, created_at: '2026-10-01T00:00:00Z' }] });
    if (u === '/api/v1/clubs/c1/analytics/matchups') return reply(404, { error: 'nope' });
    if (u === '/api/v1/clubs/invites/peek') return reply(m === 'POST' ? 200 : 404, { club: { name: 'Alpha Club', slug: 'alpha', privacy_tier: 2 }, role: 'coach' });
    if (u === '/api/v1/hs/me/sync-target') return reply(200, { kind: 'none' });
    return reply(200, { items: [] });
  }
  const ctx = {
    document: doc, fetch: fetchStub, console, URLSearchParams, setTimeout, clearTimeout,
    location: Object.assign({ search: '?s=alpha', pathname: '/clubs/manage.html', origin: 'https://wotan.test', hash: '' }, loc || {}),
    history: { replaceState() {} }, navigator: {}, sessionStorage: null, localStorage: null,
    getIdunaSession: () => ({ token: 'tok', playerID: 'p1', displayName: 'me' }),
    confirm: () => true, Date, JSON, Math, Object, Array, String, Number, Error, Promise, encodeURIComponent, isNaN
  };
  ctx.window = ctx; ctx.self = ctx;
  ctx.WotanNav = null;
  vm.createContext(ctx);
  ['js/hs-api.js', 'js/hs-ui.js', 'js/club-api.js', 'js/club-perms.js', 'js/club-ui.js', page].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return { root, calls };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function render(role, perms) {
  const env = buildEnv({ role, perms });
  for (let i = 0; i < 100; i++) { await sleep(10); if (env.root.getAttribute('aria-busy') === 'false' && (i > 8)) break; }
  await sleep(40);
  return env;
}
const panelIds = (root) => findAll(root, (n) => n.tagName === 'SECTION' && n.attrs.id).map((n) => n.attrs.id);
const tips = (root) => findAll(root, (n) => hasClass(n, 'club-tip'));
const textOf = (root) => root.textContent;

(async function main() {
  await t('manage page as Coach: roster + invites + requests + featured + audit-less; coach-vs-coach/manager disabled with reason', async () => {
    const { root } = await render('coach', NODES.coach);
    const ids = panelIds(root);
    ['roster', 'invites', 'requests', 'featured'].forEach((id) => assert.ok(ids.includes(id), 'missing panel ' + id + ' in ' + ids));
    ['visibility', 'settings', 'audit', 'transfer', 'delete'].forEach((id) => assert.ok(!ids.includes(id), 'coach must not see ' + id));
    const disabled = tips(root);
    const reasons = disabled.map((x) => x.attrs.title);
    assert.ok(reasons.some((r) => /Coaches cannot remove other Coaches/.test(r)), 'coach-vs-coach reason: ' + reasons);
    assert.ok(reasons.some((r) => /Only Managers can remove other Managers/.test(r)), 'coach-vs-manager reason: ' + reasons);
    disabled.forEach((x) => assert.ok(findAll(x, (n) => n.tagName === 'BUTTON' && n.disabled).length === 1, 'button inside tip must be disabled'));
    // the player row has an ENABLED Remove button (not wrapped in a tip)
    const enabledRemove = findAll(root, (n) => n.tagName === 'BUTTON' && n.textContent === 'Remove' && !n.disabled);
    assert.strictEqual(enabledRemove.length, 1, 'exactly one enabled Remove (the player)');
    // coach cannot change roles
    assert.strictEqual(findAll(root, (n) => n.tagName === 'SELECT' && /New role/.test(n.attrs['aria-label'] || '')).length, 0);
    // invite role select offers Player only
    const roleSel = findAll(root, (n) => n.tagName === 'SELECT' && n.attrs.id === 'inv-role')[0];
    assert.deepStrictEqual(roleSel.children.map((o) => o.attrs.value), ['player']);
  });

  await t('manage page as Manager: sees privacy, branding, audit; Reveal remembers Social; no owner-only panels', async () => {
    const { root } = await render('manager', NODES.manager);
    const ids = panelIds(root);
    ['roster', 'invites', 'requests', 'visibility', 'settings', 'featured', 'audit'].forEach((id) => assert.ok(ids.includes(id), 'missing ' + id));
    ['transfer', 'delete'].forEach((id) => assert.ok(!ids.includes(id), 'non-owner must not see ' + id));
    assert.match(textOf(root), /Reveal \(back to Social\)/);
    const roleSel = findAll(root, (n) => n.tagName === 'SELECT' && n.attrs.id === 'inv-role')[0];
    assert.deepStrictEqual(roleSel.children.map((o) => o.attrs.value), ['player', 'coach', 'manager']);
    // own row: remove disabled (use Leave), role change explains why
    assert.match(textOf(root), /You cannot change your own role/);
    // join policy: 'request' option is disabled while the club is Secret
    const jp = findAll(root, (n) => n.tagName === 'SELECT' && n.attrs.id === 'v-join')[0];
    const reqOpt = jp.children.find((o) => o.attrs.value === 'request');
    assert.ok(reqOpt.disabled, 'request option should be disabled for non-Social');
  });

  await t('manage page as Owner: transfer lists the other manager; delete needs the slug', async () => {
    const { root } = await render('manager', OWNER);
    const ids = panelIds(root);
    assert.ok(ids.includes('transfer') && ids.includes('delete'));
    const to = findAll(root, (n) => n.tagName === 'SELECT' && n.attrs.id === 't-to')[0];
    assert.ok(to, 'transfer select present');
    assert.deepStrictEqual(to.children.map((o) => o.textContent), ['@otherboss']);
    const del = findAll(root, (n) => n.tagName === 'BUTTON' && n.textContent === 'Delete this club')[0];
    assert.ok(del.disabled, 'delete disabled until slug typed');
  });

  await t('manage page as Player: dead end, no admin controls, no write calls', async () => {
    const { root, calls } = await render('player', NODES.player);
    assert.match(textOf(root), /Nothing to manage/);
    assert.strictEqual(panelIds(root).length, 0);
    assert.ok(calls.every((c) => c.startsWith('GET ')), 'only GETs: ' + calls.join(', '));
  });

  await t('public page c.html: roster shows unverified mark; unknown slug renders generic not-found', async () => {
    const env = buildEnv({ role: '', perms: [] }, 'js/club-page-c.js', { search: '?s=alpha' });
    for (let i = 0; i < 40; i++) await sleep(10);
    const tx = env.root.textContent;
    assert.match(tx, /Legend #55/); assert.match(tx, /unverified/); assert.match(tx, /Legend #9/); assert.match(tx, /verified/);
    const ghost = buildEnv({ role: '', perms: [] }, 'js/club-page-c.js', { search: '?s=ghost' });
    for (let i = 0; i < 30; i++) await sleep(10);
    assert.match(ghost.root.textContent, /Club not found/);
  });
  await t('workspace w.html: feed renders hostile text as text, analytics 404 shows graceful empty state', async () => {
    const env = buildEnv({ role: 'player', perms: NODES.player }, 'js/club-page-w.js', { search: '?s=alpha', hash: '#feed' });
    for (let i = 0; i < 50; i++) await sleep(10);
    assert.match(env.root.textContent, /<img src=x onerror=alert\(1\)>/);
    assert.strictEqual(findAll(env.root, (n) => n.tagName === 'IMG').length, 0);
    const env2 = buildEnv({ role: 'player', perms: NODES.player }, 'js/club-page-w.js', { search: '?s=alpha', hash: '#scrims' });
    for (let i = 0; i < 50; i++) await sleep(10);
    assert.match(env2.root.textContent, /Not available yet/);
  });
  await t('join.html: token is stripped from the address bar and peek is POSTed (never a query string)', async () => {
    const env = buildEnv({ role: '', perms: [] }, 'js/club-page-join.js', { search: '', pathname: '/clubs/join.html', hash: '#SECRETTOKEN' });
    for (let i = 0; i < 40; i++) await sleep(10);
    assert.ok(env.calls.some((c) => c === 'POST /api/v1/clubs/invites/peek'), env.calls.join(','));
    assert.ok(env.calls.every((c) => c.indexOf('SECRETTOKEN') < 0), 'token must not appear in any URL');
    assert.match(env.root.textContent, /Alpha Club/);
  });
  await t('settings.html + index.html render without throwing', async () => {
    const s = buildEnv({ role: 'player', perms: NODES.player }, 'js/club-page-settings.js', { search: '' });
    for (let i = 0; i < 40; i++) await sleep(10);
    assert.match(s.root.textContent, /Alpha Club/); assert.match(s.root.textContent, /unverified/);
    const ix = buildEnv({ role: '', perms: [] }, 'js/club-page-index.js', { search: '' }, ['list', 'more', 'more-btn', 'q', 'sort', 'create-btn', 'create-hint', 'create-dlg']);
    for (let i = 0; i < 20; i++) await sleep(10);
    assert.ok(ix.calls.some((c) => c.indexOf('GET /api/v1/clubs?') === 0 || c === 'GET /api/v1/clubs'), ix.calls.join(','));
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
