// Two REAL browsers play one short online Bedrock Racers session against a deployed WOTAN (production by default): two Chromium pages as
// guests, PLAY on both, the live IDUNA seats them in one room, ~12 s of lockstep play (the server's hash checks end either copy with ERROR 6
// if it drifts from the referee), then one leaves and the other plays on. Nothing is stubbed; use it after every deploy of either side.
//   NODE_PATH=<dir with node_modules/playwright> PLAYWRIGHT_BROWSERS_PATH=... node scripts/bedrockracers-live-smoke.mjs [https://wotan.okemily.com]
// Leaves two guest accounts and one match row in the target's IDUNA, like any two players. The room waits out the lobby timer (a few seconds
// to half a minute) before it starts.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const origin = (process.argv[2] || 'https://wotan.okemily.com').replace(/\/$/, '');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p) => (await fetch(origin + p)).json();

const st0 = await api('/api/v1/bedrockracers/status');
ok(st0.configured === true, 'the gateway is configured: ' + JSON.stringify(st0));
if (!st0.configured) process.exit(1);

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
  await page.goto(`${origin}/bedrockracers/`);
  await page.waitForSelector('#br-canvas:not([hidden])', { timeout: 20000 });
  return { page, ctx };
}
const x = (p, f) => p.evaluate((f) => window.__br[f](), f);
async function waitFor(p, f, pred, ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (pred(await x(p, f))) return true; await sleep(100); }
  return false;
}

const A = await newPlayer('A'), B = await newPlayer('B');
await sleep(2000);   // identity: each page makes its guest account
await A.page.locator('#br-canvas').focus(); await A.page.keyboard.press('Enter');
await B.page.locator('#br-canvas').focus(); await B.page.keyboard.press('Enter');
ok(await waitFor(A.page, 'br_net_welcomed', (v) => v === 1, 30000), 'A is welcomed by the gateway (a guest with its own token)');
ok(await waitFor(B.page, 'br_net_welcomed', (v) => v === 1, 30000), 'B is welcomed too');
ok(await waitFor(A.page, 'br_net_status', (v) => v === 3, 90000), 'A is in a live online match (qstate 3)');
ok(await waitFor(B.page, 'br_net_status', (v) => v === 3, 90000), 'B is in the same live match');
const st = await api('/api/v1/bedrockracers/status');
ok(st.online >= 2 && st.playing >= 2, `the status API sees both playing (${JSON.stringify(st)})`);

await sleep(12000);   // > 700 ticks: the server's hash checks pass only if both copies agree with its referee
ok((await x(A.page, 'br_net_err')) === 0 && (await x(B.page, 'br_net_err')) === 0, 'twelve seconds on, neither copy was ended for drifting (net-err 0 on both)');
ok((await x(A.page, 'br_status')) === 5 && (await x(B.page, 'br_status')) === 5, 'both are still in the online match (status 5)');
ok((await A.page.locator('#br-pill').textContent()) === 'Online match', 'the pill says Online match');

await B.page.close();   // B drops: its car becomes a bot at an exact tick for A
await sleep(3000);
ok((await x(A.page, 'br_status')) === 5 && (await x(A.page, 'br_net_err')) === 0, 'A plays on after B leaves (B became a bot)');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

await A.page.close();
await browser.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
