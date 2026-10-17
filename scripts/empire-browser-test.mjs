// Real-browser test of EMPIRE web: Chromium against a REAL IDUNA (the referee: the game's own wasm stepped with wazero, the matchmaker, the AIs, the recorder)
// on a throwaway database, and this repo served statically with /api/ (WebSocket included) proxied to IDUNA, as the Gateway does in production. Nothing is stubbed.
//
//   NODE_PATH=<dir with node_modules/playwright> PLAYWRIGHT_BROWSERS_PATH=... [IDUNA_BIN=...] node scripts/empire-browser-test.mjs [outdir]
//
// Drives the real page like a player: the title screen (the eight AIs listed with their ratings), the deck builder (the chosen deck survives a reload), offline
// practice, then PLAY as a guest: an IDUNA guest account is made and remembered, an AI sits down, the player puts cards on the table, the match is played to its
// end by the referee and every turn is applied by the browser's own copy of the game; the match is then on the ladder, the Matches tab, the profile and the
// card statistics, and its replay played back through the same wasm reaches the same ending. A watcher with no account sees a live AI-league match. Then a
// signed-in IDUNA player resigns. Screenshots go to outdir so the look can be checked by eye.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startIduna, serveWotan } from './lib/real-iduna.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = process.argv[2] || path.join(root, '..', 'empire-shots');
fs.mkdirSync(outdir, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const iduna = await startIduna({ EMPIRE_TICK_MS: '8', EMPIRE_LEAGUE_MINUTES: '30', EMPIRE_LEAGUE_FIRST_SECONDS: '4' });
const wotan = await serveWotan(iduna.port);
const sso = await iduna.ssoIdentity('empire-browser@example.com');
const api = async (p) => (await fetch(iduna.base + p)).json();
process.on('exit', () => { try { iduna.stop(); } catch (e) { /* gone */ } });

const browser = await chromium.launch();
const errors = [];
async function newPage(name, { session, url = '/empire/play.html', canvas = true } = {}) {
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
  await page.goto(`${wotan.base}${url}`);
  if (canvas) {
    await page.waitForSelector('#em-canvas:not([hidden])', { timeout: 15000 });
    const got = page.getByText('Got it');
    if (await got.count()) { await got.first().click(); await sleep(300); }
  }
  return { page, ctx };
}
const g = (p, k) => p.evaluate((k) => window.__em.em_g(k), k);
const ex = (p, f, ...a) => p.evaluate(([f, a]) => window.__em[f](...a), [f, a]);
async function waitG(p, k, pred, ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (pred(await g(p, k))) return true; await sleep(30); }
  return false;
}
const G = { screen: 0, mode: 30, seat: 33, haveResult: 60, resWinner: 61, recGot: 64, recCounted: 65, recRating: 66, resId: 69, deck: 70, faction: 71, version: 27, nameLen: 7, ident: 13, sel: 40, bots: 99 };
async function fb(p, x, y, button = 'left') {
  const box = await p.locator('#em-canvas').boundingBox();
  await p.mouse.click(box.x + (x / 960) * box.width, box.y + (y / 540) * box.height, { button });
  await sleep(90);
}
async function shot(p, name) { await p.screenshot({ path: path.join(outdir, name + '.png') }); }
const canvasShot = async (p, name) => (await p.locator('#em-canvas').screenshot({ path: path.join(outdir, name + '.png') }));

// ---------------------------------------------------------------------------------------------------------------------------------------------------
console.log('== the page, the title screen, the AIs');
const a = await newPage('guest');
ok(await a.page.locator('#em-pill').textContent() !== '', 'the page loaded the wasm and shows a status');
ok(await a.page.evaluate(() => typeof window.__em.em_frame === 'function'), 'the wasm is exposed as __em');
const stat = await a.page.locator('#em-stat').textContent();
ok(/empire\.wasm .* 0 imports .* 4 MB fixed memory, no allocator/.test(stat), 'the page says it is wasm with 0 imports and no allocator: ' + stat.slice(0, 90));
ok(await ex(a.page, 'em_screen') === 0, 'the game starts on the title screen');
// the wasm learns who is playing: a guest account is made and remembered
await waitG(a.page, G.nameLen, (v) => v > 0, 15000);
ok(await g(a.page, G.nameLen) > 0, 'a guest account name reached the wasm');
const guest = await a.page.evaluate(() => JSON.parse(localStorage.getItem('em_guest') || 'null'));
ok(guest && guest.player_id && guest.guest_secret, 'the guest account is remembered in this browser');
await sleep(400);
ok(await g(a.page, G.version) === 1, 'the page and the referee agree on the sim version');
const bots0 = await api('/api/v1/empire/bots');
ok(bots0.bots.length === 8 && bots0.bots[0].name === 'Marrow' && bots0.bots[0].deck.length === 8, 'IDUNA lists the eight AIs with their decks');
await canvasShot(a.page, '01-title');

console.log('== the deck builder and its memory');
const deck0 = await g(a.page, G.deck);
await fb(a.page, 160, 311);                    // deck and faction
ok(await ex(a.page, 'em_screen') === 1, 'the deck screen opened');
await fb(a.page, 870, 440);                    // clear
await fb(a.page, 50 + 0 * 158, 100); await fb(a.page, 50 + 1 * 158, 100); await fb(a.page, 50 + 2 * 158, 100); await fb(a.page, 50 + 3 * 158, 100);       // cards 0..3
await fb(a.page, 50, 200); await fb(a.page, 208, 200); await fb(a.page, 366, 200); await fb(a.page, 524, 200);                                           // cards 4..7
await fb(a.page, 800, 215 + 74);               // faction: Goetia
await canvasShot(a.page, '02-deck');
await fb(a.page, 800, 485);                    // keep this deck
ok(await ex(a.page, 'em_screen') === 0, 'keeping a full deck returns to the title');
const deck1 = await g(a.page, G.deck);
ok(deck1 === 0x76543210 && await g(a.page, G.faction) === 1, 'the deck is cards 0-7 under the Goetia: ' + deck1.toString(16));
await sleep(300);
const saved = await a.page.evaluate(() => JSON.parse(localStorage.getItem('empire_deck') || 'null'));
ok(saved && saved.d === 0x76543210 && saved.f === 1, 'the page saved it (localStorage)');
await a.page.reload();
await a.page.waitForSelector('#em-canvas:not([hidden])');
await sleep(500);
ok(await g(a.page, G.deck) === 0x76543210 && await g(a.page, G.faction) === 1, 'the deck was restored after a reload');
// back to the starter deck for the real match
await fb(a.page, 160, 311); await fb(a.page, 740, 440); await fb(a.page, 800, 215); await fb(a.page, 800, 485);   // starter, Syndicate, keep
ok(await g(a.page, G.deck) === deck0 && await g(a.page, G.faction) === 0, 'the starter button restores the starter deck');

console.log('== practice (offline)');
await fb(a.page, 160, 273);
ok(await ex(a.page, 'em_screen') === 3 && await g(a.page, G.mode) === 1, 'practice opened a local match');
await sleep(2500);
await a.page.keyboard.press('1'); await sleep(90);
ok(await g(a.page, G.sel) === 0, 'key 1 picked the first card');
await fb(a.page, 470, 400);                    // on my half
await sleep(300);
ok(await ex(a.page, 'em_stat', 0, 2) === 1, 'a card was played in practice (cards played = 1)');
await canvasShot(a.page, '03-practice');
await fb(a.page, 800, 495); await fb(a.page, 800, 495);   // leave (two clicks: it asks)
ok(await ex(a.page, 'em_screen') === 0, 'leaving practice returns to the title');

console.log('== a ranked match against an AI, as a guest');
await fb(a.page, 700, 78 + 48 * 1 + 22);       // the second AI on the title screen: Quill
ok([2, 3].includes(await ex(a.page, 'em_screen')), 'asking for an AI opens the searching screen (or seats at once)');
ok(await waitG(a.page, G.screen, (v) => v === 3, 15000), 'the referee seated an AI and the match began');
ok(await g(a.page, G.mode) === 2, 'it is an online match');
const seat = await g(a.page, G.seat);
const oppName = await a.page.evaluate(() => { const m = window.__em.memory.buffer; const b = new Uint8Array(m, 157760, 16); let s = ''; for (const c of b) { if (!c) break; s += String.fromCharCode(c); } return s; });
ok(oppName === 'Quill', 'the opponent is Quill: ' + oppName);
await waitG(a.page, 0, () => true);
await sleep(3500);                              // the countdown
const hash = async (p) => p.evaluate(() => window.__em.em_sim_hash());
ok(await ex(a.page, 'em_tick') > 20, 'turns are arriving and being applied: tick ' + await ex(a.page, 'em_tick'));
// a watcher with no account joins this very match while it is live
const liveNow = await (async () => { for (let i = 0; i < 20; i++) { const l = (await api('/api/v1/empire/live')).live.filter((x) => x.mode === 'ranked'); if (l.length) return l[0]; await sleep(150); } return null; })();
ok(liveNow && liveNow.names.includes('Quill'), 'the live list shows the match with Quill in it');
let watcher = null;
if (liveNow) watcher = await newPage('watcher', { url: '/empire/watch.html?live=' + liveNow.id });
// put cards on the table: the hand cycles, so pick a slot, click my half (my seat is always the bottom of the screen); until it ends or forty tries
let played = 0;
for (let i = 0; i < 40 && await g(a.page, G.screen) === 3; i++) {
  const k = String(1 + (i % 4));
  await a.page.keyboard.press(k); await sleep(70);
  await fb(a.page, 400 + ((i * 53) % 150), 380 + ((i * 17) % 100));
  await sleep(400);
  played = Math.max(played, await ex(a.page, 'em_stat', seat, 2));
  if (i === 6) await canvasShot(a.page, '04-battle');
}
ok(played >= 3, 'the player put cards on the table and the referee accepted them (' + played + ')');
if (watcher) {
  ok(await waitG(watcher.page, G.screen, (v) => v === 3 || v === 4, 8000) && [4].includes(await g(watcher.page, G.mode)), 'the watcher (no account) is looking at the live match');
  ok(await g(watcher.page, 13) === 0, 'and never signed in');
  ok(await ex(watcher.page, 'em_tick') > 0, 'its turns arrived (tick ' + await ex(watcher.page, 'em_tick') + ')');
  ok(await g(watcher.page, 50) === 0, 'the watcher\'s board matched the referee\'s hashes too');
  await canvasShot(watcher.page, '07-watching');
  await watcher.ctx.close();
}
// the client's board agrees with the referee's: it is sent a hash every two seconds and a mismatch would have asked for a snapshot
ok(await g(a.page, 50) === 0, 'no desync was reported (the browser\'s board matched the referee\'s hash)');
// the match runs to its end (an AI against a player who plays a few cards) unless the player leaves
if (await g(a.page, G.screen) === 3) { await fb(a.page, 800, 495); await fb(a.page, 800, 495); }
ok(await waitG(a.page, G.screen, (v) => v === 4 || v === 0, 40000), 'the match ended');
ok(await ex(a.page, 'em_over') === 1 || await g(a.page, G.screen) === 0, 'the board says it is over');
ok(await waitG(a.page, G.recGot, (v) => v === 1, 10000), 'the referee reported the match recorded');
await sleep(400);
await canvasShot(a.page, '05-result');
ok(await g(a.page, G.recCounted) === 1 && (await g(a.page, G.recRating)) > 0, 'it counted toward the ladder, rating ' + await g(a.page, G.recRating));
const matchId = await g(a.page, G.resId);
ok(matchId > 0, 'the record has an id: ' + matchId);

console.log('== what IDUNA recorded');
const m1 = await api('/api/v1/empire/matches/' + matchId);
ok(m1.seats[0].player_id === guest.player_id || m1.seats[1].player_id === guest.player_id, 'the match is recorded against the guest account');
ok(m1.reason >= 1 && m1.reason <= 6 && m1.counted, 'recorded with a reason (' + m1.reason + ') and counted');
const meSeat = m1.seats[0].player_id === guest.player_id ? 0 : 1;
ok(m1.seats[1 - meSeat].bot === 2 && m1.seats[1 - meSeat].kind === 'bot', 'the opponent is recorded as AI number 2');
ok(m1.stats && m1.stats[meSeat].plays >= 2, 'the board\'s own counters were recorded (plays ' + (m1.stats && m1.stats[meSeat].plays) + ')');
const lb = await api('/api/v1/games/empire/leaderboard?limit=50');
const me = lb.find((p) => p.player_id === guest.player_id);
ok(me && me.matches === 1 && me.wins + me.losses === 1, 'the guest is on the ladder with the result');
const quill = lb.find((p) => p.display_name === 'Quill');
ok(quill && quill.kind === 'bot' && quill.matches >= 1, 'Quill is on the ladder as an AI');
const prof = await api('/api/v1/empire/players/' + guest.player_id);
ok(prof.player.matches === 1 && prof.recent.length === 1 && prof.cards.some((c) => c.games > 0), 'the guest\'s profile has the match and their cards');
const cards = await api('/api/v1/empire/cards');
ok(cards.matches === 1 && cards.cards.filter((c) => c.games > 0).length >= 6, 'card statistics counted the cards in play');
const rb = await fetch(iduna.base + '/api/v1/empire/replays/' + matchId);
const replay = Buffer.from(await rb.arrayBuffer());
ok(rb.ok && replay.length >= 56 && replay.readUInt32LE(0) === (await g(a.page, 115) >>> 0 || replay.readUInt32LE(0)), 'the replay file is served (' + replay.length + ' bytes)');

console.log('== the replay, played back through the same game');
const r = await newPage('replay', { url: '/empire/watch.html?replay=' + matchId });
ok(await waitG(r.page, G.screen, (v) => v === 3, 10000) && await g(r.page, G.mode) === 3, 'the replay opened on the battle screen');
await fb(r.page, 291, 164);                    // speed 8x
ok(await waitG(r.page, G.screen, (v) => v === 4, 60000), 'the replay ran to its end');
ok(await ex(r.page, 'em_over') === 1 && await ex(r.page, 'em_winner') === m1.winner && await ex(r.page, 'em_reason') === m1.reason, 'the replay ends the way the match did (winner ' + m1.winner + ', reason ' + m1.reason + ')');
ok(await ex(r.page, 'em_tick') === m1.ticks, 'at the same tick (' + m1.ticks + ')');
await canvasShot(r.page, '06-replay-end');
await r.ctx.close();

console.log('== the AI league plays on its own');
let lg = [];
for (let i = 0; i < 80 && !lg.length; i++) { lg = (await api('/api/v1/empire/matches?mode=league')).matches; if (!lg.length) await sleep(500); }
ok(lg.length >= 1 && lg[0].seats[0].kind === 'bot' && lg[0].seats[1].kind === 'bot' && lg[0].counted, 'an AI-against-AI league match was played and recorded without anyone');
ok((await fetch(iduna.base + '/api/v1/empire/replays/' + lg[0].id)).ok, 'and it has a replay');

console.log('== a signed-in IDUNA player, an AI of their choice, resigning');
const s = await newPage('sso', { session: { token: sso.token, id: sso.player_id || sso.user_id || '', name: 'Sunny' } });
await waitG(s.page, G.nameLen, (v) => v > 0, 15000);
ok(await g(s.page, 12) === 0, 'the wasm knows this is not a guest');
await fb(s.page, 160, 226);                    // PLAY (whoever is waiting)
ok(await waitG(s.page, G.screen, (v) => v === 3, 25000), 'the lone player was seated with an AI after the human window');
await sleep(4500);
await fb(s.page, 800, 495); await fb(s.page, 800, 495);
ok(await waitG(s.page, G.recGot, (v) => v === 1, 20000), 'the SSO player\'s match was recorded');
const lb2 = await api('/api/v1/games/empire/leaderboard?limit=50');
ok(lb2.some((p) => p.kind === 'human' && p.matches === 1 && p.player_id !== guest.player_id), 'the SSO identity is on the ladder as a person');
await s.ctx.close();

console.log('== the stats pages');
for (const [url, sel, what] of [['/empire/', '#board table tbody tr', 'ladder rows'], ['/empire/ais.html', '.em-tile', 'AI tiles'], ['/empire/cards.html', '.em-tile', 'card tiles'],
  ['/empire/live.html', '#live', 'the live page'], ['/empire/matches.html', '#matches table tbody tr', 'match rows'], ['/empire/m.html?id=' + matchId, '.em-statrow', 'match stat rows'],
  ['/empire/u.html?id=' + guest.player_id, '#profile table', 'profile tables']]) {
  const p = await newPage('page ' + url, { url, canvas: false });
  try { await p.page.waitForSelector(sel, { timeout: 8000 }); } catch (e) { /* reported below */ }
  const n = await p.page.locator(sel).count();
  ok(n > 0, `${url}: ${n} ${what}`);
  if (url === '/empire/' || url === '/empire/cards.html' || url === '/empire/ais.html') await shot(p.page, 'page-' + (url.replace(/[^a-z]/g, '') || 'index'));
  await p.ctx.close();
}
const cp = await newPage('cards', { url: '/empire/cards.html', canvas: false });
await cp.page.waitForSelector('.em-tile');
ok(await cp.page.locator('.em-tile').count() === 16, 'the cards page shows all sixteen cards');
await cp.ctx.close();

ok(errors.length === 0, 'no page errors or console errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
await browser.close();
iduna.stop(); wotan.stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
