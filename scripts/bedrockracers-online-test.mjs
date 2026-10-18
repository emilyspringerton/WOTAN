// Real-browser test of Bedrock Racers ONLINE: two Chromium pages against a REAL IDUNA (the lockstep room, the wazero referee, the recorder) on a throwaway
// database, this repo served statically with /api/ (WebSocket included) proxied to IDUNA as the Gateway does in production. Nothing is stubbed.
//   NODE_PATH=<dir with node_modules/playwright> PLAYWRIGHT_BROWSERS_PATH=... [IDUNA_BIN=...] node scripts/bedrockracers-online-test.mjs
// Two guests press Enter (PLAY); the server seats them in one room, both browsers play the TICK stream, and the server's hash checks (every 250
// ticks) would end either one with ERROR 6 if their copies drifted. One then leaves; the other plays on; the match is on the stats API.
import { createRequire } from 'node:module';
import { startIduna, serveWotan } from './lib/real-iduna.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const iduna = await startIduna({ BEDROCKRACERS_LOBBY_SECONDS: '2' });
const wotan = await serveWotan(iduna.port);
process.on('exit', () => { try { iduna.stop(); } catch (e) { /* gone */ } });
const api = async (p) => (await fetch(iduna.base + p)).json();

const browser = await chromium.launch();
const errors = [];
async function newPlayer(name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  await ctx.addInitScript(() => {   // keep a handle on the wasm exports so the test can read the engine's own state
    const inst = WebAssembly.instantiate;
    WebAssembly.instantiate = async function (...a) { const r = await inst.apply(this, a); window.__br = (r.instance || r).exports; return r; };
  });
  await ctx.route('**/fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('**/fonts.gstatic.com/**', (r) => r.abort());
  await ctx.route('**/iam.okemily.com/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g|ERR_FAILED|iam\.okemily/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  await page.goto(`${wotan.base}/bedrockracers/`);
  await page.waitForSelector('#br-canvas:not([hidden])', { timeout: 15000 });
  return { page, ctx };
}
const x = (p, f) => p.evaluate((f) => window.__br[f](), f);
async function waitFor(p, f, pred, ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (pred(await x(p, f))) return true; await sleep(100); }
  return false;
}

const A = await newPlayer('A'), B = await newPlayer('B');
await sleep(1500);   // identity: each page makes its guest account
await A.page.locator('#br-canvas').focus(); await A.page.keyboard.press('Enter');
await B.page.locator('#br-canvas').focus(); await B.page.keyboard.press('Enter');
ok(await waitFor(A.page, 'br_net_welcomed', (v) => v === 1), 'A is welcomed by the gateway (as a guest, with its own token)');
ok(await waitFor(B.page, 'br_net_welcomed', (v) => v === 1), 'B is welcomed too');
ok(await waitFor(A.page, 'br_net_status', (v) => v === 3, 30000), 'A is in a live online match (qstate 3)');
ok(await waitFor(B.page, 'br_net_status', (v) => v === 3, 30000), 'B is in the same live match');
const st = await api('/api/v1/bedrockracers/status');
ok(st.online >= 2 && st.playing >= 2, `the status API sees two people playing (${JSON.stringify(st)})`);

await sleep(12000);   // > 700 ticks: the server's hash checks pass only if both copies agree with its referee
ok((await x(A.page, 'br_net_err')) === 0 && (await x(B.page, 'br_net_err')) === 0, 'twelve seconds on, neither copy was ended for drifting (net-err 0 on both)');
ok((await x(A.page, 'br_status')) === 5 && (await x(B.page, 'br_status')) === 5, 'both are still in the online match (status 5)');
ok((await A.page.locator('#br-pill').textContent()) === 'Online match', 'the pill says Online match');

await B.page.close();   // B drops: its car becomes a bot at an exact tick for A
await sleep(3000);
ok((await x(A.page, 'br_status')) === 5 && (await x(A.page, 'br_net_err')) === 0, 'A plays on after B leaves (B became a bot)');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

console.log(`${pass} passed, ${fail} failed`);
await browser.close(); iduna.stop(); wotan.server?.close?.();
process.exit(fail ? 1 : 0);
