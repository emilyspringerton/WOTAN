// Real-browser test of the DEADWEIGHT Draft Decks page (/decks.html) -- against a REAL IDUNA.
//   NODE_PATH=<dir with node_modules/playwright> PLAYWRIGHT_BROWSERS_PATH=... [IDUNA_BIN=...] [DECKS_REAL_LOG=<copy of decks.ndjson>] \
//     node scripts/decks-browser-test.mjs [outdir]
// What runs: the real IDUNA binary (IDUNA_BIN, or built from the sibling ../IDUNA checkout) pointed at a deck log this test
// writes (a deterministic synthetic one: ~900 bot decks and a few player decks with results), this repo served statically with
// /api/ proxied to IDUNA as the Gateway does, and headless Chromium driving the page like a visitor. Nothing on the IDUNA side
// is stubbed, so it exercises the real background ingest (log -> SQLite) and the real list / card-stats routes.
//
// Why it exists: the tracker was broken in production because IDUNA read the whole (882 MiB) log into memory on the first
// request and was OOM-killed. This test checks the page works, and that serving it does not grow IDUNA's memory with the log.
// DECKS_REAL_LOG runs the same page against a copy of the production log (1.2M decks) and prints how IDUNA coped.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startIduna, serveWotan } from './lib/real-iduna.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = process.argv[2] || path.join(root, '..', 'decks-shots');
fs.mkdirSync(outdir, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- a deterministic deck log ----------
function rng(seed) { let s = seed >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wotan-decks-'));
let logPath = path.join(work, 'decks.ndjson');
const real = process.env.DECKS_REAL_LOG;
const N_BOT = 900, N_HUMAN = 6;
const GOOD_CARD = 7;       // a deck running this card wins more often, so the Cards tab has a real signal to show
let expectDecks = 0;
if (real) {
  logPath = real;
} else {
  const r = rng(42);
  const lines = [];
  const bots = ['bot-wall-d', 'bot-ripper-d', 'bot-mirror-d'], humans = ['Alice', 'Bob', 'Runner-Y4DZ'];
  let match = 1;
  const total = N_BOT + N_HUMAN;
  for (let id = 1; id <= total; id++) {
    const human = id > N_BOT;
    const player = human ? humans[id % humans.length] : bots[id % bots.length];
    // 10 singles + 5 pairs + 1 triple = 23 cards, 16 distinct, from the 105-card catalog
    const pool = Array.from({ length: 105 }, (_, i) => i).sort(() => r() - 0.5).slice(0, 16);
    if (id % 3 === 0 && !pool.includes(GOOD_CARD)) pool[0] = GOOD_CARD;
    const cards = [...pool.slice(0, 10), ...pool.slice(10, 15).flatMap((c) => [c, c]), ...Array(3).fill(pool[15])];
    lines.push(JSON.stringify({ event: 'draft', deck_id: id, t: 1790000000 + id * 60, player, kind: human ? 0 : 1, cards, names: cards.map((c) => 'Card ' + c) }));
    const games = 1 + Math.floor(-Math.log(1 - r()) * (human ? 8 : 3));
    const pWin = cards.includes(GOOD_CARD) ? 0.7 : 0.42;
    for (let g = 0; g < games; g++) {
      const x = r();
      lines.push(JSON.stringify({ event: 'match', deck_id: id, match_id: match++, player, kind: human ? 0 : 1, result: x < pWin ? 'win' : x < pWin + 0.05 ? 'draw' : 'loss', rounds: 5 }));
    }
  }
  fs.writeFileSync(logPath, lines.join('\n') + '\n');
  expectDecks = total;
}
const dbPath = path.join(work, 'deckstats.db');
const iduna = await startIduna({ DEADWEIGHT_DECK_LOG: logPath, DEADWEIGHT_DECKSTATS_DB: dbPath, DEADWEIGHT_MATCH_LOG: path.join(work, 'matches.ndjson') });
const wotan = await serveWotan(iduna.port);
const api = async (p) => { const r = await fetch(iduna.base + '/api/v1/games/deadweight' + p); return { status: r.status, body: await r.json().catch(() => null) }; };
const vmHWM = () => { try { return Math.round(+fs.readFileSync(`/proc/${iduna.pid}/status`, 'utf8').match(/VmHWM:\s+(\d+)/)[1] / 1024); } catch (e) { return -1; } };

// the background loop reads the log shortly after IDUNA starts; wait for it like a visitor who arrived a moment later would
const t0 = Date.now();
let sum = null;
for (;;) {
  const r = await api('/decks?limit=1&min_games=0');
  if (r.status === 200 && r.body.summary && r.body.summary.decks > 0 && !r.body.summary.warming && r.body.summary.indexed_bytes === r.body.summary.log_bytes) { sum = r.body.summary; break; }
  if (Date.now() - t0 > (real ? 600000 : 30000)) { console.log('FAIL: the tracker never finished reading the log: ' + JSON.stringify(r.body && r.body.summary)); process.exit(1); }
  await sleep(500);
}
console.log(`indexed ${sum.decks} decks / ${sum.matches} matches in ${((Date.now() - t0) / 1000).toFixed(1)} s; IDUNA peak RSS ${vmHWM()} MiB`);
if (!real) ok(sum.decks === expectDecks, `the tracker read every deck in the log (${sum.decks} of ${expectDecks})`);
ok(sum.human_decks > 0 && sum.bot_decks > 0, `it tells player decks (${sum.human_decks}) from bot decks (${sum.bot_decks})`);

const browser = await chromium.launch();
const errors = [];
async function newPage(name, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route('**/fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('**/fonts.gstatic.com/**', (r) => r.abort());
  await ctx.route('**/iam.okemily.com/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g|ERR_FAILED|iam\.okemily/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  return page;
}
const decksShown = (p) => p.locator('article.deck').count();
async function waitDecks(p, pred, ms = 8000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await pred()) return true; await sleep(100); }
  return false;
}
const statValue = async (p, label) => {
  const tiles = await p.locator('#stats .stat').evaluateAll((els) => els.map((e) => ({ n: e.querySelector('b').textContent, l: e.querySelector('span').textContent })));
  const t = tiles.find((x) => x.l === label);
  return t ? Number(t.n.replace(/[^0-9]/g, '')) : null;
};

// ---------- the default view ----------
const page = await newPage('desktop');
await page.goto(`${wotan.base}/decks.html`);
await page.waitForSelector('article.deck', { timeout: 15000 });
ok((await page.title()).includes('Draft Decks'), 'the page loads');
ok(await statValue(page, 'Decks drafted') === sum.decks, `the totals strip shows ${sum.decks.toLocaleString()} decks drafted`);
ok(await statValue(page, 'Player decks') === sum.human_decks && await statValue(page, 'Bot decks') === sum.bot_decks, 'player and bot deck totals match the API');
const def = await api('/decks?sort=score&min_games=5&limit=40&offset=0');
ok(await decksShown(page) === Math.min(40, def.body.total), `the default view (best, 5+ games) lists ${Math.min(40, def.body.total)} decks`);
const firstId = await page.locator('article.deck').first().getAttribute('id');
ok(firstId === 'deck-' + def.body.decks[0].deck_id, `the best deck by adjusted win rate (#${def.body.decks[0].deck_id}) is on top`);
const chips = await page.locator('article.deck').first().locator('.strip .chip').count();
ok(chips >= 10 && chips <= 16, `a deck shows its cards as chips (${chips} distinct)`);
await page.screenshot({ path: path.join(outdir, 'decks-desktop.png'), fullPage: false });

// the "Show more" button pages through the rest
if (def.body.total > 40) {
  const label = await page.locator('#more').textContent();
  ok(label.includes(`${def.body.total - 40} left`), `"Show more" counts what is left (${label.trim()})`);
  await page.locator('#more').click();
  ok(await waitDecks(page, async () => (await decksShown(page)) === Math.min(80, def.body.total)), 'Show more loads the next page');
}

// ---------- filters ----------
await page.locator('#f-who button[data-v="human"]').click();
const humanApi = await api('/decks?sort=score&min_games=5&kind=human&limit=40');
ok(await waitDecks(page, async () => (await decksShown(page)) === humanApi.body.decks.length), `"Players" lists only player decks (${humanApi.body.decks.length})`);
const badges = await page.locator('article.deck .badge').allTextContents();
ok(badges.length > 0 && badges.every((b) => b.trim() === 'Player'), 'every deck is badged Player');
await page.locator('#f-who button[data-v=""]').click();

await page.locator('#f-min').selectOption('10');
const ten = await api('/decks?sort=score&min_games=10&limit=40');
ok(await waitDecks(page, async () => (await decksShown(page)) === Math.min(40, ten.body.total)), `"Min games 10+" narrows to ${ten.body.total} decks`);
await page.locator('#f-min').selectOption('5');

await page.locator('#f-sort').selectOption('recent');
const recent = await api('/decks?sort=recent&min_games=5&limit=40');
ok(await waitDecks(page, async () => (await page.locator('article.deck').first().getAttribute('id')) === 'deck-' + recent.body.decks[0].deck_id), 'Newest puts the most recent deck first');
await page.locator('#f-sort').selectOption('score');

if (!real) {
  await page.locator('#f-min').selectOption('1');
  await page.locator('#f-q').fill('ali');
  const ali = await api('/decks?sort=score&min_games=1&player=ali&limit=40');
  ok(await waitDecks(page, async () => (await decksShown(page)) === Math.min(40, ali.body.total)) && ali.body.total > 0, `the name box finds Alice's decks (${ali.body.total})`);
  const whos = await page.locator('article.deck .who').allTextContents();
  ok(whos.length > 0 && whos.every((w) => w.startsWith('Alice')), 'every result is one of Alice\'s');
  await page.locator('#f-q').fill('');
  await page.locator('#f-min').selectOption('5');
  await waitDecks(page, async () => (await decksShown(page)) > 1);
}

// ---------- the Cards tab ----------
await page.locator('#tab-cards').click();
await page.waitForSelector('#ctable tbody tr');
const rows = await page.locator('#ctable tbody tr').count();
ok(rows === 105, `the Cards tab lists the whole 105-card catalog (${rows})`);
const stats = await api('/card-stats');
const gs = stats.body.cards.find((c) => c.card === GOOD_CARD);
const rowText = await page.locator('#ctable tbody tr', { has: page.locator(`button[data-filter-card="${GOOD_CARD}"]`) }).innerText();
ok(gs && rowText.includes(String(gs.games)), `card ${GOOD_CARD}'s row shows its ${gs && gs.games} games`);
if (!real) ok(gs.win_rate > 0.55, `the better card has the better win rate (${(gs.win_rate * 100).toFixed(1)}%)`);
await page.screenshot({ path: path.join(outdir, 'cards-desktop.png') });

await page.locator(`button[data-filter-card="${GOOD_CARD}"]`).click();
await page.waitForSelector('#clearcard');
const only = await api(`/decks?sort=score&min_games=5&card=${GOOD_CARD}&limit=40`);
ok(await waitDecks(page, async () => (await decksShown(page)) === Math.min(40, only.body.total)), `"show decks" filters to decks running that card (${only.body.total})`);
const all = await page.locator('article.deck').evaluateAll((els, c) => els.every((e) => e.querySelector(`.strip .chip[data-card="${c}"]`)), GOOD_CARD);
ok(all, 'every deck shown runs the card');
ok(await page.locator('#f-min').inputValue() === '5', 'the card filter keeps the 5+ games minimum (1+ over a million decks is noise)');
await page.locator('#clearcard').click();

// ---------- when the tracker says no ----------
await page.route('**/api/v1/games/deadweight/decks?*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'busy -- try again in a moment' }) }));
await page.locator('#f-sort').selectOption('games');
ok(await waitDecks(page, async () => /busy -- try again/.test(await page.locator('#decks').innerText())), 'a refused request shows the server\'s own sentence, not just "503"');
await page.unroute('**/api/v1/games/deadweight/decks?*');

// ---------- while it is still reading a big history ----------
await page.route('**/api/v1/games/deadweight/decks?*', async (route) => {
  const r = await route.fetch();
  const j = await r.json();
  j.summary.warming = true; j.summary.indexed_bytes = 250; j.summary.log_bytes = 1000;
  await route.fulfill({ response: r, json: j });
});
await page.locator('#f-sort').selectOption('score');
ok(await waitDecks(page, async () => (await page.locator('#stats .stat.warm').count()) === 1), 'while the history is still being read the totals say how far it got');
ok((await page.locator('#stats .stat.warm b').textContent()) === '25%', 'it shows the percentage read (25%)');
await page.unroute('**/api/v1/games/deadweight/decks?*');

// ---------- a phone ----------
const phone = await newPage('phone', { width: 390, height: 844 });
await phone.goto(`${wotan.base}/decks.html`);
await phone.waitForSelector('article.deck', { timeout: 15000 });
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(overflow <= 1, `no sideways scroll on a phone (${overflow}px)`);
await phone.screenshot({ path: path.join(outdir, 'decks-phone.png') });

// ---------- the server survived ----------
const health = await fetch(iduna.base + '/health');
ok(health.ok, 'IDUNA is still up after all of that');
const peak = vmHWM();
console.log(`IDUNA peak RSS ${peak} MiB while serving ${sum.decks.toLocaleString()} decks from a ${(fs.statSync(logPath).size / 1048576).toFixed(0)} MiB log`);
ok(peak < 0 || peak < 350, `IDUNA's memory does not grow with the log (peak ${peak} MiB)`);
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));

await browser.close();
wotan.stop();
iduna.stop();
console.log(`\n${pass} passed, ${fail} failed; screenshots in ${outdir}`);
process.exit(fail ? 1 : 0);
