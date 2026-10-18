// Real-browser test of D2 web: Chromium against a REAL IDUNA (the gateway), the REAL dw2_server and the REAL dw2_bot pool (built from
// github.com/emilyspringerton/DEADWEIGHT_2), and this repo served statically with /api/ (WebSocket included) proxied to IDUNA, as the
// Gateway does in production. Nothing about the game is stubbed.
//
//   NODE_PATH=<dir with node_modules/playwright> PLAYWRIGHT_BROWSERS_PATH=... \
//   D2_BIN_DIR=<dir with dw2_server, dw2_bot> [IDUNA_BIN=...] node scripts/d2-browser-test.mjs [outdir]
//
// Drives the real page like a player: title -> PLAY as a guest (an IDUNA guest account is made and remembered) -> the server pairs the
// player with a bot -> PACK (parts by key and by click, undo, the EXAMPLE ship, the wiring readout) -> READY -> the fight, answering
// every round break on the line -> the result screen -> the match is in IDUNA's database, on the ladder, on the Matches tab and on the
// player's profile. Then the same as a signed-in IDUNA player, who forfeits. Screenshots go to outdir so the look can be checked by eye.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startIduna, serveWotan } from './lib/real-iduna.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = process.argv[2] || path.join(root, '..', 'd2-shots');
const bins = process.env.D2_BIN_DIR;
if (!bins) { console.error('set D2_BIN_DIR to a directory with dw2_server and dw2_bot'); process.exit(2); }
fs.mkdirSync(outdir, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the real D2: the match server and a bot pool ----
const port = 24000 + Math.floor(Math.random() * 9000);
const children = [];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-'));
function start(bin, args) {
  const c = spawn(path.join(bins, bin), args, { cwd: work, stdio: 'ignore' });
  children.push(c); return c;
}
start('dw2_server', ['--port', String(port), '--no-auth', '--pack-ms', '40000', '--tick-ms', '150']);
await sleep(400);
start('dw2_bot', ['--port', String(port), '--count', '4']);
await sleep(1500);
const cleanup = () => { for (const c of children) { try { c.kill(); } catch (e) { /* gone */ } } };
process.on('exit', cleanup);

const iduna = await startIduna({ D2_SERVER_ADDR: `127.0.0.1:${port}` });
const wotan = await serveWotan(iduna.port);
const sso = await iduna.ssoIdentity('d2-browser@example.com');
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
  await page.goto(`${wotan.base}/d2/play.html`);
  await page.waitForSelector('#d2-canvas:not([hidden])', { timeout: 15000 });
  const got = page.getByText('Got it');
  if (await got.count()) { await got.first().click(); await sleep(300); }
  return { page, ctx };
}
const pill = (p) => p.locator('#d2-pill').textContent();
async function waitPill(p, re, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (re.test(await pill(p))) return true; await sleep(100); }
  return false;
}
const g = (p, k) => p.evaluate((k) => window.__d2.d2_g(k), k);
// a read that lets the wasm see the click first (it acts on input once per animation frame)
// a key press, then a beat: the wasm acts on input once per animation frame, so a person's key-then-click is two frames apart; so is ours
const key = async (p, k) => { await p.keyboard.press(k); await sleep(70); };
const gs = async (p, k) => { await sleep(90); return g(p, k); };
async function waitG(p, k, pred, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (pred(await g(p, k))) return true; await sleep(20); }
  return false;
}
// a click at a framebuffer coordinate (the canvas is 960x540 scaled to fit)
async function fb(p, x, y, button = 'left') {
  const box = await p.locator('#d2-canvas').boundingBox();
  await p.mouse.click(box.x + (x / 960) * box.width, box.y + (y / 540) * box.height, { button });
}
async function fbMove(p, x, y) {
  const box = await p.locator('#d2-canvas').boundingBox();
  await p.mouse.move(box.x + (x / 960) * box.width, box.y + (y / 540) * box.height);
}
const cellXY = (r, c) => [296 + c * 50 + 25, 104 + r * 50 + 25];
const BTN = { example: [49, 441], undo: [116, 441], clear: [171, 441], split: [223, 441], ready: [778, 514], forfeit: [64, 520] };
const SHOT = (n) => path.join(outdir, n + '.png');
// the globals the page's footer and this test read (stdlib/d2/web/d2_mem.prn)
const G_STAGE = 90, G_WEAPONS = 121, G_POWERED = 122, G_LOOPS = 123, G_CELLS = 126, G_COST = 154, G_WEIGHT = 155, G_STRUCT = 156, G_EVADE = 157, G_TOAST = 100;
const G_FX = 138, G_STRUCT_YOU = 400, G_STRUCT0_YOU = 402, G_EV_N = 411;
const shots = (p, kind, lane) => p.evaluate(([l, k]) => window.__d2.d2_t_shots_to_open(l, k), [lane, kind]);

// ---- 1. a guest ----
const G = await newPage('guest');
{
  const { page } = G;
  ok((await pill(page)) === 'Ready', 'the wasm starts and the page says Ready');
  const stat = await page.locator('#d2-stat').textContent();
  ok(/0 imports/.test(stat) && /no allocator/.test(stat), `the module imports nothing and has no allocator (${stat.trim().slice(0, 80)}...)`);
  await sleep(1200); // the guest account is made in the background
  ok(/playing as|guest/i.test(await page.locator('#d2-who-msg').textContent()), 'a guest account is set up and named on the page');
  await page.screenshot({ path: SHOT('01-title') });
  await fb(page, 480, 340); // PLAY
  ok(await waitPill(page, /Looking for an opponent|Packing/, 20000), 'PLAY starts a search');
  ok(await waitPill(page, /Packing/, 20000), 'the match server paired the guest with a bot and the packing screen opened');
  ok((await g(page, 33)) === 1, 'the opponent is a bot (MATCH_FOUND opp_kind 1)');
  await page.screenshot({ path: SHOT('02-pack-empty') });

  // parts by key, placed by click: generator, conductor, railgun in a row
  ok((await gs(page, G_STAGE)) === 0, 'the hold starts empty');
  ok((await g(page, G_COST)) === 0 && (await g(page, G_WEIGHT)) === 0, 'and costs nothing and weighs nothing');
  await key(page, '1'); await fb(page, ...cellXY(0, 0)); await sleep(70);
  await key(page, '7'); await fb(page, ...cellXY(0, 1)); await sleep(70);
  ok((await gs(page, G_STAGE)) === 2, 'two parts placed by click');
  ok((await gs(page, G_WEAPONS)) === 0, 'no railgun yet: nothing to fire');
  await key(page, 'e'); await fb(page, ...cellXY(0, 2)); await sleep(70);
  { const n = await gs(page, G_STAGE), fed = await g(page, G_POWERED); ok(n === 3 && fed === 1, `a generator, a wire and a railgun: the railgun is fed (the readout says ${fed} of 1; ${n} parts)`); }
  ok((await g(page, G_COST)) === 100 + 10 + 240 && (await g(page, G_WEIGHT)) === 4 + 1 + 9, `the budget bars add up: ${await g(page, G_COST)} credits, ${await g(page, G_WEIGHT)} tons`);
  ok((await g(page, G_STRUCT)) === 20 + 10 + 30, `the structure is the HP of every cell (${await g(page, G_STRUCT)})`);
  // the lanes: how many shots it takes to open the railgun's lane, and an empty lane is OPEN (0)
  ok((await shots(page, 1, 2)) === 5 && (await shots(page, 2, 2)) === 1 && (await shots(page, 3, 2)) === 1, 'lane 3 holds a 30 HP railgun: 5 laser shots, 1 slug, 1 shell to open it');
  ok((await shots(page, 1, 4)) === 0, 'a lane with nothing in it is open (0 shots)');
  await fbMove(page, ...cellXY(0, 2)); await sleep(150);
  await page.screenshot({ path: SHOT('03-pack-wired') });
  // a part that does not fit is refused; undo and right click take parts off
  await key(page, '1'); await fb(page, ...cellXY(0, 0));
  ok((await gs(page, G_STAGE)) === 3, 'placing on an occupied cell does nothing');
  await key(page, 'z');
  ok((await gs(page, G_STAGE)) === 2, 'Z undoes the last part');
  await fb(page, ...cellXY(0, 1), 'right'); await sleep(50);
  ok((await gs(page, G_STAGE)) === 1, 'a right click removes the part under the pointer');
  // the budget: Bulwark Plates weigh 5 t, so 21 fit in 105 t and the 22nd is refused
  await fb(page, ...BTN.clear); await sleep(80);
  ok((await gs(page, G_STAGE)) === 0, 'CLEAR empties the hold');
  await key(page, 'u');
  let placed = 0;
  for (let c = 0; c < 6; c++) for (let r = 0; r < 6 && placed < 22; r++) { await fb(page, ...cellXY(r, c)); await sleep(35); placed++; }
  { const n = await gs(page, G_STAGE), w = await g(page, G_WEIGHT);
    ok(n === 21 && w === 105, `21 Bulwarks fill the 105 t weight budget and the 22nd is refused (${n} parts, ${w} t)`);
    ok((await g(page, G_TOAST)) === 8, 'the refusal says it is too heavy'); }
  await page.screenshot({ path: SHOT('04-pack-budget') });
  await fb(page, ...BTN.clear); await sleep(80);
  // SPLIT: a Titanium Beam becomes two Shards on exactly the cells it held; the pieces cost and weigh more
  await key(page, 'i'); await fb(page, ...cellXY(1, 1)); await sleep(80);
  ok((await gs(page, G_STAGE)) === 1 && (await g(page, G_COST)) === 90 && (await g(page, G_WEIGHT)) === 8 && (await g(page, G_CELLS)) === 4, 'a Titanium Beam: 90 credits, 8 t, four cells');
  await fbMove(page, ...cellXY(1, 2)); await sleep(120);
  await page.screenshot({ path: SHOT('05-pack-split-preview') });
  await key(page, 'c');
  ok((await gs(page, G_STAGE)) === 2 && (await g(page, G_COST)) === 110 && (await g(page, G_WEIGHT)) === 10 && (await g(page, G_CELLS)) === 4,
     `C splits it into two Shards in place: ${await g(page, G_STAGE)} parts, ${await g(page, G_COST)} credits (the tax is +20), ${await g(page, G_WEIGHT)} t, still four cells`);
  await page.screenshot({ path: SHOT('06-pack-split') });
  await key(page, 'z');
  ok((await gs(page, G_STAGE)) === 1 && (await g(page, G_COST)) === 90, 'Z undoes the split: the Beam is whole again');
  // Aether Ore into four Chips
  await key(page, 'p'); await fb(page, ...cellXY(3, 3)); await sleep(80);
  const costWithOre = await g(page, G_COST);
  await fbMove(page, ...cellXY(3, 3)); await sleep(100);
  await key(page, 'c');
  ok((await g(page, G_STAGE)) === 5 && (await g(page, G_COST)) === costWithOre + 20, `Aether Ore splits into four Chips (${await g(page, G_STAGE)} parts, ${await g(page, G_COST)} credits)`);
  // a closed loop of wire is called out: the textbook ring
  await page.evaluate(() => { const w = window.__d2; w.d2_t_clear(); [[0,0,0,0],[2,0,1,3],[2,0,2,3],[2,1,2,0],[2,1,1,1]].forEach(([i,r,c,rot]) => w.d2_t_add(i, r, c, rot)); w.d2_t_rebuild(); });
  ok((await gs(page, G_LOOPS)) === 1, 'a ring of splitters is recognised as a closed loop (the readout warns it will burn out)');
  await page.screenshot({ path: SHOT('07-pack-loop') });
  // the example ships: all of them lay down legal ships
  let allLegal = true, lastCost = 0, laserLine = null;
  for (let k = 0; k < 12; k++) {
    await fb(page, ...BTN.example); await sleep(130);
    const n = await g(page, G_STAGE), cost = await g(page, G_COST), wt = await g(page, G_WEIGHT);
    if (n === 0 || cost > 1000 || wt > 40) { allLegal = false; console.log('example', k, 'is not legal:', n, cost, wt); }
    if (k === 0) { ok(n === 4 && (await g(page, G_POWERED)) === 2 && (await g(page, G_WEAPONS)) === 2, 'EXAMPLE 1 is the hot Core: a laser and a railgun, both fed by the Core'); await page.screenshot({ path: SHOT('08-pack-core') }); }
    if (k === 2) { laserLine = { n, cost, wt, fed: await g(page, G_POWERED), guns: await g(page, G_WEAPONS) }; await fbMove(page, ...cellXY(1, 1)); await sleep(150); await page.screenshot({ path: SHOT('09-pack-laserline') }); }
    if (k === 6) { await fbMove(page, ...cellXY(3, 1)); await sleep(150); await page.screenshot({ path: SHOT('10-pack-cannons') }); }
    lastCost = cost;
  }
  ok(allLegal, 'every EXAMPLE ship is legal: inside the credit and weight budgets');
  ok(laserLine && laserLine.guns === 4 && laserLine.fed === 4 && laserLine.cost <= 1000, `the laser line has four lasers, all fed (${JSON.stringify(laserLine)})`);
  await fb(page, ...BTN.example); await sleep(120);   // back to laser line x4 (index 2) after a full cycle of 12 + this one wraps to index 0; take index 2
  await fb(page, ...BTN.example); await sleep(120); await fb(page, ...BTN.example); await sleep(120);
  ok((await g(page, G_STAGE)) === laserLine.n, 'the examples cycle round');
  const shipN = await g(page, G_STAGE), shipStruct = await g(page, G_STRUCT);
  await fb(page, ...BTN.ready);
  await sleep(300);
  await page.screenshot({ path: SHOT('11-pack-locked') });
  ok(await waitPill(page, /In a fight/, 25000), 'READY sends the ship and the fight starts when the bot is ready too');
  ok((await g(page, 40)) <= 100 && (await g(page, 41)) <= 100, 'the fight opens with both hulls');
  ok((await g(page, G_STRUCT0_YOU)) === shipStruct && (await g(page, G_STRUCT_YOU)) === shipStruct, `the fight starts with the ship's structure (${shipStruct} HP)`);
  await sleep(2600);
  await page.screenshot({ path: SHOT('12-fight') });
  ok((await g(page, G_FX)) > 0, 'shots were fired and the second\'s events became animation (the effects counter moved)');
  await fbMove(page, 358 + 38 * 1 + 19, 290 + 38 * 0 + 19); await sleep(200);
  await page.screenshot({ path: SHOT('13-fight-inspect') });

  // every round break: press OVERCHARGE / BRACE on the line
  let breaks = 0, good = 0, perfect = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 100000 && !/Match over/.test(await pill(page))) {
    if ((await g(page, 55)) === 1 && (await g(page, 61)) === 0) {
      const target = await g(page, 58), rtt = await g(page, 20), start = await g(page, 60);
      if (breaks === 0) { await sleep(400); await page.screenshot({ path: SHOT('14-round-break') }); }
      const want = Math.max(40, target - rtt);
      for (;;) { const now = await g(page, 2); if (now - start >= want - 12) break; await sleep(4); }
      await page.keyboard.press(breaks % 2 === 0 ? 'o' : 'b');
      breaks++;
      await waitG(page, 63, (v) => v > 0, 3000);
      const gr = await g(page, 65);
      if (gr >= 2) good++; if (gr === 3) perfect++;
      if (breaks === 1) { await sleep(300); await page.screenshot({ path: SHOT('15-round-result') }); }
      await sleep(300);
    }
    await sleep(25);
  }
  ok(breaks >= 1, `the fight had round breaks and each was answered (${breaks})`);
  ok(good >= Math.ceil(breaks / 2), `pressing on the line, compensated for the round trip, grades GOOD or better (${good}/${breaks} good, ${perfect} perfect)`);
  ok(await waitPill(page, /Match over/, 60000), 'the fight ends and the result screen opens');
  await sleep(1500);
  ok((await g(page, 76)) === 1 && (await g(page, 77)) === 1, 'the gateway reports the match recorded and rated');
  ok([0, 1, 2].includes(await g(page, 72)), 'the result is a win, a loss or a draw');
  await page.screenshot({ path: SHOT('16-result') });

  // the page links to the player's profile once the gateway has said who they are
  const href = await page.locator('#d2-profile').getAttribute('href');
  ok(/\/d2\/u\.html\?id=/.test(href || ''), 'the page links the player to their D2 profile');
  G.pid = (href || '').split('id=')[1];
  G.shipN = shipN;
}

// ---- what IDUNA now holds ----
{
  const ladder = await api('/api/v1/games/d2/leaderboard?limit=50');
  const me = ladder.find((p) => p.player_id === G.pid);
  ok(me && me.matches === 1 && me.kind === 'human' && Math.abs(me.rating - 1500) > 1, `the guest is on the ladder with one rated match (rating ${me && me.rating})`);
  ok(ladder.some((p) => p.kind === 'bot' && p.matches === 1), 'the bot that played is on the ladder as a bot');
  const feed = await api('/api/v1/d2/web-matches?player_id=' + G.pid);
  const m = feed.matches[0];
  ok(feed.matches.length === 1 && m.opp_kind === 'bot' && m.counted, 'the match is in the web-match feed against a bot, counted');
  const full = await api('/api/v1/d2/web-matches/' + m.id);
  ok(full.loadout.length === G.shipN && full.rounds.length >= 1 && full.rounds.every((r) => r.target_ms >= 300), `the stored match has the packed ship (${full.loadout.length} of ${G.shipN} parts) and ${full.rounds.length} round breaks`);
  const prof = await api('/api/v1/d2/players/' + G.pid);
  ok(prof.rank >= 1 && prof.player.matches === 1 && prof.recent.length === 1, 'the profile endpoint has the rank, the record and the match');
  const st = await api('/api/v1/d2/status');
  ok(st.configured === true, 'the gateway reports itself configured');
}

// ---- WOTAN's own pages ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('**/fonts.g*/**', (r) => r.abort()); await ctx.route('**/iam.okemily.com/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('wotan pageerror: ' + e.message));
  await page.goto(`${wotan.base}/d2/`);
  await page.waitForSelector('#board table tbody tr', { timeout: 10000 });
  ok((await page.locator('#board tbody tr').count()) >= 2, 'the Ladder page lists the player and the bot');
  ok((await page.locator('#board .d2-tag.bot').count()) >= 1, 'bots are marked as bots on the ladder');
  await page.screenshot({ path: SHOT('20-ladder') });
  await page.getByRole('button', { name: 'Bots' }).click();
  ok((await page.locator('#board tbody tr').count()) >= 1 && (await page.locator('#board .d2-tag.bot').count()) === (await page.locator('#board tbody tr').count()), 'the Bots filter shows only bots');
  await page.goto(`${wotan.base}/d2/matches.html`);
  await page.waitForSelector('#matches table tbody tr', { timeout: 10000 });
  ok((await page.locator('#matches tbody tr').count()) === 1, 'the Matches tab lists the match');
  await page.locator('#matches tbody tr').first().click();
  await page.waitForSelector('.d2-ship i[title]', { timeout: 5000 });
  ok((await page.locator('.d2-ship i[title]').count()) >= 10, 'opening the match draws the ship that was packed');
  await page.screenshot({ path: SHOT('21-match-open') });
  await page.goto(`${wotan.base}/d2/u.html?id=${G.pid}`);
  await page.waitForSelector('#profile table', { timeout: 10000 });
  ok(/#\d/.test(await page.locator('#p-rank').textContent()), 'the profile shows a rank');
  await page.screenshot({ path: SHOT('22-profile') });
  await ctx.close();
}

// ---- 2. a signed-in IDUNA player, who forfeits ----
{
  const S = await newPage('sso', { token: sso.token, id: sso.player_id, name: sso.display_name });
  const { page } = S;
  await sleep(1200);
  ok(/Signed in as/.test(await page.locator('#d2-who-msg').textContent()), 'a signed-in visitor plays as their IDUNA identity');
  await fb(page, 480, 340);
  ok(await waitPill(page, /Packing/, 25000), 'the SSO player is paired with a bot');
  await fb(page, ...BTN.example); await sleep(100); await fb(page, ...BTN.example); await sleep(100); await fb(page, ...BTN.example); await sleep(100);
  await fb(page, ...BTN.ready);
  ok(await waitPill(page, /In a fight/, 25000), 'the SSO player reaches the fight');
  await sleep(800);
  await fb(page, ...BTN.forfeit); await sleep(200);   // FORFEIT (first click asks)
  await page.screenshot({ path: SHOT('30-forfeit-ask') });
  await fb(page, ...BTN.forfeit);                     // confirm
  ok(await waitPill(page, /Match over/, 15000), 'forfeiting ends the match');
  ok((await g(page, 72)) === 0 && (await g(page, 73)) === 2, 'a forfeit is a loss by forfeit');
  await sleep(1200);
  await page.screenshot({ path: SHOT('31-forfeit-result') });
  const href = await page.locator('#d2-profile').getAttribute('href');
  const pid = (href || '').split('id=')[1];
  const prof = await api('/api/v1/d2/players/' + pid);
  ok(prof.player.losses === 1 && prof.player.matches === 1, 'the forfeit is a loss on the SSO player\'s ladder record');
  ok(prof.recent[0] && prof.recent[0].reason === 'forfeit', 'the match is stored with reason forfeit');
  // play again from the result screen
  await fb(page, 435, 491);
  ok(await waitPill(page, /Packing/, 25000), 'PLAY AGAIN on the result screen finds another match');
  await page.screenshot({ path: SHOT('32-play-again') });
  // closing the tab mid-pack forfeits too
  await S.ctx.close();
  await sleep(1500);
  const prof2 = await api('/api/v1/d2/players/' + pid);
  ok(prof2.player.losses === 2, 'closing the tab in a match is a counted forfeit');
}

ok(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
await browser.close();
cleanup();
iduna.stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
