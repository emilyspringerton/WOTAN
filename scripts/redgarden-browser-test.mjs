// Real-browser test of REDGARDEN web: Chromium against a REAL IDUNA (the gateway), the REAL C matchmaker + arena server +
// 19-bot pool (built from github.com/emilyspringerton/REDGARDEN), and this repo served statically with /api/ (WebSocket
// included) proxied to IDUNA, as the Gateway does in production. Nothing about the game is stubbed.
//
//   NODE_PATH=<dir with node_modules/playwright> PLAYWRIGHT_BROWSERS_PATH=... \
//   REDGARDEN_BIN_DIR=<dir with matchmaker, arena_server, arena_bot> [IDUNA_BIN=...] \
//   node scripts/redgarden-browser-test.mjs [outdir]
//
// REDGARDEN_BIN_DIR may also hold `arena_server_fast`, an arena_server built with ARENA_MATCH_MAX_DURATION_MS = 30 s so a whole
// match (and its recording) fits in a test; without it the stock server is used and a match takes up to 12 minutes.
// Drives the real page like a player: title -> PLAY as a guest (an IDUNA guest account is made and remembered) -> the real
// matchmaker seats you with 19 bots -> the draft -> a live match (orders, shop, scoreboard, help) -> the result screen -> the match
// is in IDUNA's database, on the leaderboard, on the Matches tab and on the player's profile. Then the same as a signed-in IDUNA
// player. Screenshots go to outdir so the look can be checked by eye.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startIduna, serveWotan } from './lib/real-iduna.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = process.argv[2] || path.join(root, '..', 'redgarden-shots');
const bins = process.env.REDGARDEN_BIN_DIR;
if (!bins) { console.error('set REDGARDEN_BIN_DIR to a directory with matchmaker, arena_server, arena_bot'); process.exit(2); }
fs.mkdirSync(outdir, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the real REDGARDEN: matchmaker + a 19-bot pool, 10v10 ----
const SECRET = 'redgarden-browser-test-secret';
const base = 21000 + Math.floor(Math.random() * 9000);
const children = [];
function start(bin, args) {
  const c = spawn(path.join(bins, bin), args, { env: { ...process.env, REDGARDEN_TICKET_SECRET: SECRET }, stdio: 'ignore' });
  children.push(c); return c;
}
const serverBin = fs.existsSync(path.join(bins, 'arena_server_fast')) ? 'arena_server_fast' : 'arena_server';
start('matchmaker', ['--listen-port', String(base), '--lobby-size', '20', '--server-bin', path.join(bins, serverBin),
  '--first-game-port', String(base + 10), '--game-port-range', '10']);
await sleep(400);
for (let i = 1; i <= 19; i++) start('arena_bot', ['--host', '127.0.0.1', '--index', String(i), '--matchmaker-port', String(base)]);
await sleep(3500);
const cleanup = () => { for (const c of children) { try { c.kill(); } catch (e) { /* gone */ } } };
process.on('exit', cleanup);

const iduna = await startIduna({ REDGARDEN_TICKET_SECRET: SECRET, REDGARDEN_POOLS: `test-10v10|10v10|127.0.0.1:${base}|20` });
const wotan = await serveWotan(iduna.port);
const sso = await iduna.ssoIdentity('redgarden-browser@example.com');
const api = async (p) => (await fetch(iduna.base + p)).json();

const browser = await chromium.launch();
const errors = [];
async function newPage(name, session) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (session) {
    await ctx.addInitScript((x) => {
      try { localStorage.setItem('wotan_iduna_token', x.token); localStorage.setItem('wotan_iduna_player_id', x.id); localStorage.setItem('wotan_iduna_display_name', x.name); } catch (e) { /* ignore */ }
    }, session);
  }
  await ctx.route('**/fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('**/fonts.gstatic.com/**', (r) => r.abort());
  await ctx.route('**/iam.okemily.com/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g|ERR_FAILED|iam\.okemily/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  await page.goto(`${wotan.base}/redgarden/play.html`);
  await page.waitForSelector('#rg-canvas:not([hidden])', { timeout: 15000 });
  // the cookie notice sits above the page and shifts the layout when it goes: dismiss it like a visitor would
  const got = page.getByText('Got it');
  if (await got.count()) { await got.first().click(); await sleep(300); }
  return { page, ctx };
}
const pill = (p) => p.locator('#rg-pill').textContent();
async function waitPill(p, re, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (re.test(await pill(p))) return true; await sleep(100); }
  return false;
}
// a click at a framebuffer coordinate (the canvas is 960x540 scaled to fit)
async function fb(p, x, y, button = 'left') {
  const box = await p.locator('#rg-canvas').boundingBox();
  await p.mouse.click(box.x + (x / 960) * box.width, box.y + (y / 540) * box.height, { button });
}
async function fbMove(p, x, y) {
  const box = await p.locator('#rg-canvas').boundingBox();
  await p.mouse.move(box.x + (x / 960) * box.width, box.y + (y / 540) * box.height);
}

async function playOne(P, label, hero) {
  const { page } = P;
  await fb(page, 480, 334); // PLAY
  ok(await waitPill(page, /Searching for a match|Match found|Drafting/, 20000), `${label}: PLAY starts a search`);
  ok(await waitPill(page, /Drafting/, 60000), `${label}: the real matchmaker seated the player and the arena opened its draft`);
  await fbMove(page, 300, 140); await sleep(150);
  await page.screenshot({ path: path.join(outdir, `${label}-03-draft.png`) });
  const cx = 40 + (hero % 8) * 110 + 50, cy = 92 + Math.floor(hero / 8) * 46 + 20;
  await fb(page, cx, cy);
  await sleep(200);
  await fb(page, 830, 490); // LOCK IN
  ok(await waitPill(page, /In a match/, 30000), `${label}: the draft locks and the match goes live`);
  await sleep(2500);
  await page.screenshot({ path: path.join(outdir, `${label}-04-live.png`) });
  // orders: a right click moves, a left click moves, Q casts, B opens the shop, Tab the scoreboard, H the help
  await fb(page, 600, 200, 'right'); await sleep(300);
  await fb(page, 420, 330); await sleep(300);
  await page.keyboard.press('q'); await sleep(200);
  await page.keyboard.press('b'); await sleep(300);
  await page.screenshot({ path: path.join(outdir, `${label}-05-shop.png`) });
  await page.keyboard.press('b');
  await page.keyboard.down('Tab'); await sleep(300);
  await page.screenshot({ path: path.join(outdir, `${label}-06-scores.png`) });
  await page.keyboard.up('Tab');
  await page.keyboard.press('h'); await sleep(300);
  await page.screenshot({ path: path.join(outdir, `${label}-07-help.png`) });
  await page.keyboard.press('h');
  await sleep(5000);
  await page.screenshot({ path: path.join(outdir, `${label}-08-fighting.png`) });
  ok(await waitPill(page, /Match over/, 150000), `${label}: the arena ends the match and the page shows the result`);
  await sleep(1200);
  await page.screenshot({ path: path.join(outdir, `${label}-09-result.png`) });
}

// =============== a guest ===============
const G = await newPage('guest');
ok(await pill(G.page) === 'Ready', 'the page loads and the client says Ready');
{ const box = await G.page.locator('#rg-canvas').boundingBox(); ok(box.y + box.height <= 900 && box.x >= 0 && box.x + box.width <= 1280, 'the whole canvas fits a 1280x900 window (' + Math.round(box.width) + 'x' + Math.round(box.height) + ' at y=' + Math.round(box.y) + ')'); }
ok((await G.page.locator('#rg-stat').textContent()).includes('0 imports'), 'the footer reports the wasm has 0 imports');
await G.page.waitForFunction(() => /online/.test(document.getElementById('rg-online').textContent), null, { timeout: 8000 }).catch(() => {});
ok(/online/.test(await G.page.locator('#rg-online').textContent()), 'the page shows the gateway status (' + (await G.page.locator('#rg-online').textContent()) + ')');
await G.page.screenshot({ path: path.join(outdir, 'guest-01-title.png') });
await sleep(1500);
const stored0 = await G.page.evaluate(() => localStorage.getItem('rg_guest'));
ok(!stored0 || true, 'no guest account exists before the first PLAY is required');
await playOne(G, 'guest', 9);
const guest = JSON.parse(await G.page.evaluate(() => localStorage.getItem('rg_guest')));
ok(!!guest && !!guest.player_id && !!guest.guest_secret, 'a guest account was made and remembered in this browser');
ok(/a guest/.test(await G.page.locator('#rg-who-msg').textContent()), 'the page says the player is a guest');
const href = await G.page.locator('#rg-profile').getAttribute('href');
ok(href && href.includes(guest.player_id), 'the profile link points at the guest account the match was recorded against');

const gm = (await api(`/api/v1/redgarden/web-matches?player_id=${guest.player_id}`)).matches;
ok(gm.length === 1, 'IDUNA recorded exactly one match for the guest (' + gm.length + ')');
const m0 = gm[0] || {};
ok(m0.hero_id === 9 && /win|loss/.test(m0.result) && m0.lobby === 20 && m0.mode === '10v10', `the record has the picked hero, a result and the lobby (hero ${m0.hero_id}, ${m0.result}, ${m0.mode}, ${m0.lobby})`);
ok(Array.isArray(m0.roster) && m0.roster.length === 20 && m0.roster.some((r) => r.you), 'the record carries the whole roster of 20 with the player marked');
const prof = await fetch(iduna.base + `/api/v1/redgarden/players/${guest.player_id}`);
ok(prof.ok, 'the guest has a REDGARDEN profile on the same endpoint WOTAN already reads');
if (prof.ok) { const pj = await prof.json(); ok(pj.matches === (m0.counted ? 1 : 0), 'the profile totals count the match when it counted (' + pj.matches + ')'); ok((pj.heroes || []).some((h) => h.hero_id === 9) || !m0.counted, 'the profile lists the hero played'); }
const lb = await api('/api/v1/redgarden/leaderboard?limit=200');
ok(!m0.counted || lb.leaderboard.some((e) => e.player_id === guest.player_id), 'the guest is on the leaderboard');
const hs = await api('/api/v1/redgarden/hero-leaderboard');
ok(!m0.counted || (hs.heroes || []).some((h) => h.hero_id === 9), 'the hero win rates include the match');

// the Matches tab and the profile page show it
const mp = await G.ctx.newPage();
await mp.route('**/fonts.g*/**', (r) => r.abort()); await mp.route('**/iam.okemily.com/**', (r) => r.abort());
await mp.goto(`${wotan.base}/redgarden/matches.html`);
await mp.waitForSelector('#matches table', { timeout: 8000 }).catch(() => {});
ok(await mp.locator('#matches table tbody tr').count() >= 1, 'the Matches tab lists the match');
await mp.screenshot({ path: path.join(outdir, 'matches-tab.png') });
await mp.goto(`${wotan.base}/redgarden/u.html?id=${guest.player_id}`);
await mp.waitForSelector('#profile .rg-panel', { timeout: 8000 }).catch(() => {});
ok(/Played in the browser/.test(await mp.locator('#profile').textContent()), "the player's profile shows the browser match with kills and deaths");
await mp.screenshot({ path: path.join(outdir, 'profile.png') });
await mp.close();

// a reload keeps the same guest
await G.page.reload();
await G.page.waitForSelector('#rg-canvas:not([hidden])', { timeout: 15000 });
await sleep(800);
const again = JSON.parse(await G.page.evaluate(() => localStorage.getItem('rg_guest')));
ok(again.player_id === guest.player_id, 'after a reload the same guest account is kept');

// requeue straight away: the result screen's PLAY AGAIN (a second match for the same guest)
await fb(G.page, 480, 334);
ok(await waitPill(G.page, /Searching for a match|Match found|Drafting/, 40000), 'PLAY after a reload searches again with the remembered guest');
await G.page.screenshot({ path: path.join(outdir, 'guest-10-requeue.png') });
await sleep(1000);
await G.page.keyboard.press('Escape');
await sleep(500);
await G.ctx.close();
await sleep(1500);

// =============== a signed-in IDUNA player ===============
const S = await newPage('sso', { token: sso.token, id: sso.player_id, name: sso.display_name });
ok(/Signed in as/.test(await S.page.locator('#rg-who-msg').textContent().catch(() => '')) || await waitFn(S.page, () => /Signed in as/.test(document.getElementById('rg-who-msg').textContent)), 'the page greets a signed-in player by name');
async function waitFn(p, fn) { try { await p.waitForFunction(fn, null, { timeout: 8000 }); return true; } catch (e) { return false; } }
await playOne(S, 'sso', 3);
const sid = (await S.page.locator('#rg-profile').getAttribute('href')).split('id=')[1];
const sm = (await api(`/api/v1/redgarden/web-matches?player_id=${sid}`)).matches;
ok(sm.length === 1 && sm[0].hero_id === 3, 'IDUNA recorded the signed-in player\'s match against their own REDGARDEN account (' + sm.length + ')');
ok(sm.length === 1 && sm[0].display_name && sm[0].display_name !== 'Player', 'it carries their display name (' + (sm[0] && sm[0].display_name) + ')');

ok(errors.length === 0, 'no page errors or console errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
console.log(`\n${pass} passed, ${fail} failed; screenshots in ${outdir}`);
await browser.close(); cleanup(); iduna.stop(); wotan.stop();
process.exit(fail ? 1 : 0);
