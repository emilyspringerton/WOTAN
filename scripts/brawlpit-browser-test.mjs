// Real-browser test of the BRAWLPIT page (headless Chromium via Playwright).
//   NODE_PATH=<dir with node_modules/playwright> PLAYWRIGHT_BROWSERS_PATH=... node scripts/brawlpit-browser-test.mjs [outdir]
//   (BRAWLPIT_BASE_URL=https://wotan.okemily.com ... runs it against the deployed site instead of a local server)
// Serves this repo's static files, opens /BRAWLPIT/, and checks that the WebAssembly game really
// boots in a browser, paints, takes keyboard and gamepad input, runs a match, and that the page's
// only JavaScript is the generated bp-host.js (plus the site-wide nav/SSO scripts).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = process.argv[2] || path.join(root, '..', 'brawlpit-shots');
fs.mkdirSync(outdir, { recursive: true });

// BRAWLPIT_BASE_URL=https://wotan.okemily.com runs the same checks against the DEPLOYED site (the IDUNA
// endpoints stay stubbed either way, so no real account or token is involved); unset, this repo is served locally.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png' };
let server = null, base;
if (process.env.BRAWLPIT_BASE_URL) {
  base = process.env.BRAWLPIT_BASE_URL.replace(/\/$/, '');
} else {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.startsWith('/api/')) { res.writeHead(404); res.end('{}'); return; }
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) errors.push('console: ' + m.text()); });
await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
await page.route('**/fonts.gstatic.com/**', (r) => r.abort());
await page.route('**/iam.okemily.com/**', (r) => r.abort());

// a signed-in player whose character has an equipped pixel hat: the IDUNA endpoints the page calls are stubbed
const hatPng = (() => {
  const w = 32, h = 32, raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + x * 4;
    const crown = y >= 8 && y < 26 && x >= 4 && x < 28 && (y > 16 || (x % 6 < 3));
    raw[o] = 255; raw[o + 1] = crown ? 215 : 0; raw[o + 2] = crown ? 0 : 255; raw[o + 3] = crown ? 255 : 0;
  }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
})();
const apiHits = [];
await page.addInitScript(() => { localStorage.setItem('wotan_iduna_token', 'tok-e2e'); localStorage.setItem('wotan_iduna_player_id', 'p-e2e'); localStorage.setItem('wotan_iduna_display_name', 'E2E'); });
await page.route('**/api/v1/**', (r) => {
  const u = new URL(r.request().url()).pathname;
  apiHits.push({ u, auth: r.request().headers()['authorization'] || '' });
  if (u.startsWith('/api/v1/characters/by-player/')) return r.fulfill({ json: { character_id: 'c-e2e' } });
  if (u === '/api/v1/characters/c-e2e/hats') return r.fulfill({ json: [{ hat_id: 'h0', name: 'Plain', equipped: false }, { hat_id: 'h1', name: 'Gold Crown', equipped: true, image_url: '/api/v1/hats/h1/image' }] });
  if (u === '/api/v1/hats/h1/image') return r.fulfill({ body: hatPng, contentType: 'image/png' });
  return r.fulfill({ status: 401, json: {} });
});

await page.goto(base + '/BRAWLPIT/', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('bp-pill')?.textContent === 'Running in WebAssembly', null, { timeout: 15000 });
ok(true, 'page booted: pill says "Running in WebAssembly"');
ok(await page.evaluate(() => !document.getElementById('bp-canvas').hidden && document.getElementById('bp-load').hidden), 'canvas visible, loading panel hidden');
const stat = await page.textContent('#bp-stat');
ok(/0 imports/.test(stat) && /no allocator/.test(stat), 'footer reports 0 imports and no allocator: ' + stat.trim());

await page.waitForFunction(() => !document.getElementById('bp-hat').hidden, null, { timeout: 8000 });
ok(await page.evaluate(() => document.getElementById('bp-hat-img').getAttribute('src').startsWith('data:image/png')), 'signed-in player: header badge shows the equipped hat (the 32x32 surface the wasm wears)');
ok(/Wearing your Hat Store hat: Gold Crown\./.test(await page.textContent('#bp-hat-msg')), 'signed-in player: the status line under the canvas names the hat being worn');
ok(apiHits.filter((h) => h.u.startsWith('/api/v1/characters/')).every((h) => h.auth === 'Bearer tok-e2e'), 'IDUNA calls carried the shared session token');

// the page's scripts: generated host + site-wide nav/SSO + consent; nothing hand-written for BRAWLPIT
const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.getAttribute('src') || '(inline)'));
ok(scripts.includes('bp-host.js') && !scripts.includes('brawlpit.js') && !scripts.includes('hat.js') && !scripts.includes('(inline)'),
   'BRAWLPIT page scripts: ' + scripts.join(', '));

// pixels: read the canvas back
const paint = async () => page.evaluate(() => { const c = document.getElementById('bp-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const s = new Set(); for (let i = 0; i < d.length; i += 4 * 211) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); return { w: c.width, h: c.height, colors: s.size, alpha: d[3] }; });
let p0 = await paint();
ok(p0.w === 960 && p0.h === 540 && p0.colors > 12 && p0.alpha === 255, `the wasm painted the title screen onto the canvas (${p0.colors} distinct sampled colours)`);
await page.screenshot({ path: path.join(outdir, 'page-title.png') });
await (await page.$('#bp-canvas')).screenshot({ path: path.join(outdir, 'canvas-title.png') });

const phase = () => page.evaluate(() => document.getElementById('bp-canvas') && window.__bp ? window.__bp() : -1);
const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.down(k); await page.waitForTimeout(70); await page.keyboard.up(k); await page.waitForTimeout(70); } };

await page.focus('#bp-canvas');
await press('Enter');                 // VS CPU
await page.waitForTimeout(150);
await (await page.$('#bp-canvas')).screenshot({ path: path.join(outdir, 'canvas-select.png') });
// the equipped store hat is on the fighter already: nothing was picked. Gold (255,215,0) is the stub crown's colour.
const gold = (pg) => pg.evaluate(() => { const c = document.getElementById('bp-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 215 && d[i + 2] === 0) n++; return n; });
const goldSelect = await gold(page);
ok(goldSelect > 400, `fighter select: the equipped hat is already on player 1's fighter without touching anything (${goldSelect} px of the crown's gold)`);
await press('ArrowRight', 2);                 // another fighter: the hat stays
await page.waitForTimeout(100);
await (await page.$('#bp-canvas')).screenshot({ path: path.join(outdir, 'canvas-select-hat.png') });
await press('ArrowDown');                     // store hat -> NO HAT
await page.waitForTimeout(100);
const goldBare = await gold(page);
ok(goldBare < goldSelect - 400, `down takes the hat off (${goldBare} px of gold left)`);
await (await page.$('#bp-canvas')).screenshot({ path: path.join(outdir, 'canvas-select-nohat.png') });
await press('ArrowUp');                       // and back on
await page.waitForTimeout(100);
ok(Math.abs((await gold(page)) - goldSelect) < 60, 'up puts it back on');
await press('Enter'); await press('Enter');   // lock in, stage -> fight
await page.waitForTimeout(3300);              // READY / 3 / 2 / 1 / GO
await (await page.$('#bp-canvas')).screenshot({ path: path.join(outdir, 'canvas-fight-0.png') });
const goldFight = await gold(page);
const sample = async () => (await page.evaluate(() => { const c = document.getElementById('bp-canvas'); return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data.slice(0, 4 * 960 * 540)); })).reduce((a, b, i) => (a * 31 + b + i) | 0, 7);
const h1 = await sample();
await page.keyboard.down('d'); await page.waitForTimeout(700); await page.keyboard.up('d');
await page.keyboard.down('j'); await page.waitForTimeout(120); await page.keyboard.up('j');
await page.waitForTimeout(500);
const h2 = await sample();
ok(h1 !== h2, 'the picture changes while playing (keys reach the wasm)');
await (await page.$('#bp-canvas')).screenshot({ path: path.join(outdir, 'canvas-fight-1.png') });
// pause
await press('p');
await page.waitForTimeout(200);
await (await page.$('#bp-canvas')).screenshot({ path: path.join(outdir, 'canvas-pause.png') });
await press('p');

// arrows must not scroll the page while the canvas has focus
const y0 = await page.evaluate(() => window.scrollY);
await press('ArrowDown', 3); await press(' ', 2);
ok((await page.evaluate(() => window.scrollY)) === y0, 'arrow keys and space do not scroll the page');

// click-to-focus + pointer: leave the match through the pause menu with the mouse
const box = await (await page.$('#bp-canvas')).boundingBox();
await press('Escape');
await page.waitForTimeout(200);
await page.mouse.click(box.x + box.width * (480 / 960), box.y + box.height * (355 / 540));   // QUIT TO MENU
await page.waitForTimeout(300);
await (await page.$('#bp-canvas')).screenshot({ path: path.join(outdir, 'canvas-after-quit.png') });
const p1 = await paint();
ok(p1.colors > 12, 'mouse click on a canvas menu button was handled by the wasm (back at the title)');

// fullscreen button
await page.click('#b-fullscreen').catch(() => {});

// a synthetic gamepad: Playwright cannot attach a real one, so shim the Gamepad API the page polls
await page.evaluate(() => {
  const pad = { index: 0, id: 'Test Pad', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  window.__pad = pad;
  Object.defineProperty(navigator, 'getGamepads', { value: () => [window.__pad, null, null, null], configurable: true });
  window.dispatchEvent(new Event('gamepadconnected'));
});
await page.waitForTimeout(150);
ok(/Controller connected/.test(await page.textContent('#bp-pad-status')), 'controller connect updates the page label');
// drive the title menu with the pad: d-pad down x2 then A (cursor 2 = free for all)
const padPress = async (i) => { await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: true, value: 1 }; }, i); await page.waitForTimeout(90); await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: false, value: 0 }; }, i); await page.waitForTimeout(90); };
await padPress(13); await padPress(13); await padPress(0);   // down, down, A
await page.waitForTimeout(200);
await (await page.$('#bp-canvas')).screenshot({ path: path.join(outdir, 'canvas-pad-select.png') });
await padPress(0); await padPress(0);                        // lock in, FIGHT
await page.waitForTimeout(3300);
await (await page.$('#bp-canvas')).screenshot({ path: path.join(outdir, 'canvas-ffa.png') });
const q1 = await sample();
await page.evaluate(() => { window.__pad.axes[0] = 1; window.__pad.buttons[0] = { pressed: true, value: 1 }; });
await page.waitForTimeout(600);
await page.evaluate(() => { window.__pad.axes[0] = 0; window.__pad.buttons[0] = { pressed: false, value: 0 }; });
const q2 = await sample();
ok(q1 !== q2, 'a gamepad stick + button moves a fighter in the free-for-all');

// ---- other visitors: each in its own browser context (own localStorage) ----------------------------------------------
async function openPersona({ session, routes }) {
  const pg = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) errors.push('console: ' + m.text()); });
  await pg.route('**/fonts.googleapis.com/**', (r) => r.abort());
  await pg.route('**/fonts.gstatic.com/**', (r) => r.abort());
  await pg.route('**/iam.okemily.com/**', (r) => r.abort());
  if (session) await pg.addInitScript(() => { localStorage.setItem('wotan_iduna_token', 'tok-p'); localStorage.setItem('wotan_iduna_player_id', 'p-p'); localStorage.setItem('wotan_iduna_display_name', 'P'); });
  await pg.route('**/api/v1/**', (r) => { const u = new URL(r.request().url()).pathname; const f = routes[u]; return f ? r.fulfill(f) : r.fulfill({ status: 404, json: {} }); });
  await pg.goto(base + '/BRAWLPIT/', { waitUntil: 'load' });
  await pg.waitForFunction(() => document.getElementById('bp-pill')?.textContent === 'Running in WebAssembly', null, { timeout: 15000 });
  return pg;
}
const msgOf = (pg) => pg.evaluate(() => document.getElementById('bp-hat-msg').textContent);
const tapKey = async (pg, k) => { await pg.keyboard.down(k); await pg.waitForTimeout(70); await pg.keyboard.up(k); await pg.waitForTimeout(90); };   // the game polls key state each frame: hold across one
const toFight = async (pg) => { await tapKey(pg, 'Enter'); await tapKey(pg, 'Enter'); await pg.waitForTimeout(3300); };                          // lock in the fighter, then the stage, then READY / 3 / 2 / 1 / GO

{ // signed out: no hat, an honest status line, and the same fight has none of the crown's gold -- the baseline for the signed-in fight above
  const pg = await openPersona({ session: false, routes: {} });
  await pg.waitForFunction(() => document.getElementById('bp-hat-msg').textContent.length > 0, null, { timeout: 5000 });
  ok(/not signed in/.test(await msgOf(pg)) && (await pg.evaluate(() => { const a = document.getElementById('bp-hat-link'); return !a.hidden && a.textContent === 'Sign in with IDUNA' && a.href.startsWith('https://iam.okemily.com/'); })),
     'signed out: the status line says so and offers the IDUNA sign-in');
  ok(await pg.evaluate(() => document.getElementById('bp-hat').hidden), 'signed out: the header badge stays hidden');
  await pg.focus('#bp-canvas'); await tapKey(pg, 'Enter');            // title -> fighter select (VS CPU)
  const bare = await gold(pg);
  ok(bare < 60, `signed out: nothing gold on the fighter-select screen (${bare} px)`);
  await toFight(pg);
  const goldBareFight = await gold(pg);
  ok(goldFight >= 40 && goldBareFight === 0, `in a fight the signed-in player's crown shows (${goldFight} px of gold -- the camera is zoomed out) and the signed-out one has none (${goldBareFight} px)`);
  await (await pg.$('#bp-canvas')).screenshot({ path: path.join(outdir, 'canvas-fight-signed-out.png') });
  await pg.close();
}
{ // the curated catalogue: IDUNA stores the art as an HTML-entity string ("&#9733;" stands in for the emoji here -- this machine has no emoji font)
  const pg = await openPersona({ session: true, routes: {
    '/api/v1/characters/by-player/p-p': { json: { character_id: 'c-p' } },
    '/api/v1/characters/c-p/hats': { json: [{ hat_id: 'x1', name: 'Star Cap', equipped: true, image_asset: '&#9733;' }] } } });
  await pg.waitForFunction(() => /Wearing/.test(document.getElementById('bp-hat-msg').textContent), null, { timeout: 8000 });
  ok(/Wearing your Hat Store hat: Star Cap\./.test(await msgOf(pg)), 'curated hat: worn, and the status line names it');
  // read the badge back: the data URL of the surface the wasm wears. Its ink must sit inside the 22x22 box standing on the head.
  const box = await pg.evaluate(async () => {
    const img = document.getElementById('bp-hat-img'); const im = new Image(); im.src = img.src; await im.decode();
    const c = document.createElement('canvas'); c.width = 32; c.height = 32; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, 32, 32).data; let x0 = 99, y0 = 99, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (d[(y * 32 + x) * 4 + 3] > 40) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { n, x0, y0, x1, y1 };
  });
  ok(box.n > 40, `curated hat: the entity was decoded and a glyph was really drawn (${box.n} inked pixels, not a blank surface)`);
  ok(box.x0 >= 4 && box.x1 <= 28 && box.y1 <= 31 && box.y1 >= 27 && Math.abs((box.x0 + box.x1) / 2 - 15.5) <= 2.5,
     `curated hat: the glyph is fitted to the head -- centred (x ${box.x0}..${box.x1}) and standing on row ~30 (bottom ${box.y1}), top ${box.y0}`);
  await pg.focus('#bp-canvas'); await tapKey(pg, 'Enter');            // title -> fighter select (VS CPU)
  await (await pg.$('#bp-canvas')).screenshot({ path: path.join(outdir, 'canvas-select-curated-hat.png') });
  await toFight(pg);
  await (await pg.$('#bp-canvas')).screenshot({ path: path.join(outdir, 'canvas-fight-curated-hat.png') });
  await pg.close();
}
{ // nothing equipped / expired sign-in
  const pg = await openPersona({ session: true, routes: {
    '/api/v1/characters/by-player/p-p': { json: { character_id: 'c-p' } },
    '/api/v1/characters/c-p/hats': { json: [{ hat_id: 'x1', name: 'Spare', equipped: false, image_asset: '&#9733;' }] } } });
  await pg.waitForFunction(() => /no hat equipped/.test(document.getElementById('bp-hat-msg').textContent), null, { timeout: 8000 });
  ok(await pg.evaluate(() => document.getElementById('bp-hat-link').getAttribute('href') === '/store.html' && document.getElementById('bp-hat').hidden), 'nothing equipped: the status line points at the Hat Store and no badge is shown');
  await pg.close();
  const ex = await openPersona({ session: true, routes: { '/api/v1/characters/by-player/p-p': { status: 401, json: {} } } });
  await ex.waitForFunction(() => /expired/.test(document.getElementById('bp-hat-msg').textContent), null, { timeout: 8000 });
  ok(true, 'expired sign-in (HTTP 401): the status line says so instead of silently showing no hat');
  await ex.close();
}

// sustained: 10 s of play, no errors, still animating
await page.waitForTimeout(10000);
ok(errors.length === 0, 'no page or console errors during the whole session' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
if (server) server.close();
console.log(`\n${pass} passed, ${fail} failed (screenshots in ${outdir})`);
process.exit(fail ? 1 : 0);
