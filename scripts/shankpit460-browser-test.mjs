// Real-browser test of shankpit-460 web -- two Chromium contexts against a REAL IDUNA (the human lobby) and this repo served
// statically with /api/ (WebSocket included) proxied to it, as the Gateway does in production.
//   NODE_PATH=<dir with node_modules/playwright> PLAYWRIGHT_BROWSERS_PATH=... [IDUNA_BIN=...] node scripts/shankpit460-browser-test.mjs [outdir]
// Drives the real page like a player: title -> PLAY -> bot match with SEARCHING FOR MATCH -> a second player searches -> both are
// moved into a free-for-all -> the clock runs out (the test shortens the match) -> end screen -> REQUEUE -> a new lobby. Takes
// screenshots along the way (outdir) so the look can be checked by eye.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startIduna, serveWotan } from './lib/real-iduna.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = process.argv[2] || path.join(root, '..', 'shankpit460-shots');
fs.mkdirSync(outdir, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const iduna = await startIduna({ SHANKPIT460_COUNTDOWN_SECONDS: '3', SHANKPIT460_MATCH_SECONDS: '14' });
const wotan = await serveWotan(iduna.port);
const player = await iduna.ssoIdentity('browser-shooter@example.com');

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
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
  await page.goto(`${wotan.base}/shankpit-460/`);
  await page.waitForSelector('#sp-canvas:not([hidden])', { timeout: 15000 });
  return page;
}
const pill = (p) => p.locator('#sp-pill').textContent();
async function waitPill(p, re, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (re.test(await pill(p))) return true; await sleep(100); }
  return false;
}
// a click at a framebuffer coordinate (the canvas is 640x360 scaled to fit)
async function clickFb(p, x, y) {
  const box = await p.locator('#sp-canvas').boundingBox();
  await p.mouse.click(box.x + (x / 640) * box.width, box.y + (y / 360) * box.height);
}

const A = await newPage('A', { token: player.token, id: player.player_id, name: player.display_name });
ok(await pill(A) === 'Ready', 'the page loads and the engine says Ready');
ok((await A.locator('#sp-stat').textContent()).includes('0 imports'), 'the footer reports the wasm has 0 imports');
ok((await A.locator('#sp-who-msg').textContent()).includes('Signed in as'), 'the page greets a signed-in player by name');
await A.waitForFunction(() => /online/.test(document.getElementById('sp-online').textContent), null, { timeout: 8000 }).catch(() => {});
ok(/online/.test(await A.locator('#sp-online').textContent()), 'the page shows how many people are about (' + (await A.locator('#sp-online').textContent()) + ')');
await A.screenshot({ path: path.join(outdir, '01-title.png') });

// ---- A: PLAY ----
await clickFb(A, 320, 204);
await sleep(300);
ok(await A.evaluate(() => document.pointerLockElement === document.getElementById('sp-canvas')), 'clicking PLAY captures the pointer in the same gesture');
ok(await waitPill(A, /Searching for a match/, 8000), 'a bot match is running and the page says SEARCHING FOR A MATCH');
await sleep(2500);
await A.screenshot({ path: path.join(outdir, '02-bot-match-searching.png') });
const st = await (await fetch(`${iduna.base}/api/v1/shankpit460/status`)).json();
ok(st.searching === 1, 'IDUNA sees one human searching');

// ---- B (a guest) joins ----
const B = await newPage('B', null);
ok((await B.locator('#sp-who-msg').textContent()).includes('guest'), 'a signed-out visitor is told they are a guest');
await clickFb(B, 320, 204);
ok(await waitPill(A, /Match found|free-for-all/i, 10000), 'A is moved into a human match');
ok(await waitPill(B, /Match found|free-for-all/i, 10000), 'B is moved into the same match');
await sleep(600);
await A.screenshot({ path: path.join(outdir, '03-match-found-A.png') });
await B.screenshot({ path: path.join(outdir, '03-match-found-B.png') });
ok(await waitPill(A, /In a free-for-all/, 8000), 'the match goes live');
await sleep(1500);
await A.keyboard.down('Tab'); await sleep(300);
await A.screenshot({ path: path.join(outdir, '04-live-scoreboard-A.png') });
await A.keyboard.up('Tab');
// walk around a little: the page must keep up and nothing may throw
await A.keyboard.down('w'); await B.keyboard.down('w'); await A.keyboard.down('Space'); await sleep(900);
await A.keyboard.up('Space'); await sleep(1200); await A.keyboard.up('w'); await B.keyboard.up('w');
await A.screenshot({ path: path.join(outdir, '05-live-A.png') });
await B.screenshot({ path: path.join(outdir, '05-live-B.png') });
const live = await (await fetch(`${iduna.base}/api/v1/shankpit460/status`)).json();
ok(live.playing === 2 && live.rooms.length === 1, 'IDUNA reports a two-player room (' + JSON.stringify(live.rooms[0]) + ')');

// ---- the clock runs out ----
ok(await waitPill(A, /Match over/, 20000) && await waitPill(B, /Match over/, 20000), 'time ends the match and both pages show the end screen');
ok(await A.evaluate(() => document.pointerLockElement === null), 'the pointer is released on the end screen so the cursor is free');
await sleep(800);
await A.screenshot({ path: path.join(outdir, '06-end-A.png') });
await B.screenshot({ path: path.join(outdir, '06-end-B.png') });

// ---- REQUEUE ----
await clickFb(A, 320, 273); await clickFb(B, 320, 273);
ok(await waitPill(A, /Searching for a match|Bot match|Match found/, 6000), 'REQUEUE starts a new bot match and searches again');
ok(await waitPill(A, /Match found|free-for-all/i, 12000) && await waitPill(B, /Match found|free-for-all/i, 12000), 'and the two find each other again');
await sleep(500);
await A.screenshot({ path: path.join(outdir, '07-requeued-A.png') });

// ---- the home page and nav know about the game ----
const home = await A.context().newPage();
await home.route('**/fonts.g*/**', (r) => r.abort()); await home.route('**/iam.okemily.com/**', (r) => r.abort());
await home.goto(`${wotan.base}/`);
ok(await home.locator('a[href="/shankpit-460/"]').count() > 0, 'the WOTAN home page links to shankpit-460');
await home.waitForSelector('.wn-game');
ok(await home.locator('.wn-game', { hasText: 'shankpit-460' }).count() === 1, 'the GAMES bar lists shankpit-460');
await home.close();

ok(errors.length === 0, 'no page errors or console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); wotan.stop(); iduna.stop();
console.log(`\n${pass} passed, ${fail} failed -- screenshots in ${outdir}`);
process.exit(fail ? 1 : 0);
