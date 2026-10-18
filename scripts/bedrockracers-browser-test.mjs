// Real-browser test of the WOTAN /bedrockracers/ page: the whole site served statically (no IDUNA: the game is local, and the nav's
// account widget just shows signed out), driven in Chromium like a player. Screenshots go to outdir.
//   NODE_PATH=<dir with node_modules/playwright> PLAYWRIGHT_BROWSERS_PATH=... node scripts/bedrockracers-browser-test.mjs [outdir]
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = process.argv[2] || path.join(root, '..', 'bedrockracers-shots');
fs.mkdirSync(outdir, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(root, u.endsWith('/') ? u + 'index.html' : u);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route('**/fonts.googleapis.com/**', (r) => r.abort());
await ctx.route('**/fonts.gstatic.com/**', (r) => r.abort());
await ctx.route('**/iam.okemily.com/**', (r) => r.abort());
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g|ERR_FAILED|iam\.okemily/.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto(`${base}/bedrockracers/`);
await page.waitForSelector('#br-canvas:not([hidden])', { timeout: 15000 });
const pill = () => page.locator('#br-pill').textContent();
async function waitPill(text, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if ((await pill()) === text) return true; await sleep(50); } return false; }
const pixels = () => page.evaluate(() => { const c = document.getElementById('br-canvas'); return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data); });
const distinct = (a) => { const s = new Set(); for (let i = 0; i < a.length; i += 4 * 97) s.add((a[i] << 16) | (a[i + 1] << 8) | a[i + 2]); return s.size; };

ok(await waitPill('Ready', 5000), 'the page loads and the engine says Ready');
ok((await page.locator('#br-stat').textContent()).includes('0 imports'), 'the footer reports the wasm has 0 imports (' + (await page.locator('#br-stat').textContent()) + ')');
ok(/Bedrock Racers/.test(await page.locator('#wotan-nav .wn-game[aria-current="true"]').textContent()), 'the top Games bar has Bedrock Racers as the current game');
ok((await page.locator('#wotan-nav .wn-tabs a[aria-current="page"]').textContent()) === 'Play', 'the Play tab is current');
ok(await page.locator('#br-fullscreen').isEnabled(), 'the fullscreen button is enabled once the game runs');
await sleep(500);
ok(distinct(await pixels()) > 40, 'the title is a picture, not a blank');
await page.screenshot({ path: path.join(outdir, '01-page.png'), fullPage: false });
await page.keyboard.press('Enter');
ok(await waitPill('In a match'), 'Enter starts a match');
await sleep(2500);
await page.screenshot({ path: path.join(outdir, '02-match.png') });
await page.keyboard.press('Escape');
ok(await waitPill('Paused'), 'Esc pauses');
await page.keyboard.press('Escape');
ok(await waitPill('In a match'), 'Esc resumes');
const home = await ctx.newPage();
await home.goto(`${base}/`);
ok(await home.locator('a[href="/bedrockracers/"]').count() > 0, 'the home page links to /bedrockracers/');
ok(errors.length === 0, 'no page errors or console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed  (screenshots in ${outdir})`);
process.exit(fail ? 1 : 0);
