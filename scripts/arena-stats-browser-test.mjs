// Real-browser test of the arena stats pages (Ladder, Matches, player) for shankpit-460 and Bedrock Racers: Chromium against the
// REAL IDUNA binary, this repo served statically with /api/ proxied to it as the Gateway does in production. The results are written
// straight into IDUNA's own database in the shape its recorders write (handlers/shankpit460_stats.go, bedrockracers_play.go), so
// what is tested is IDUNA's real read routes and these pages; the recording itself is tested in IDUNA and, end to end with two real
// engines, by scripts/shankpit460-net-test.mjs.
//
//   NODE_PATH=<dir with node_modules/playwright> [IDUNA_BIN=...] node scripts/arena-stats-browser-test.mjs [outdir]
//
// Checks every page at a desktop and a phone width: the rows and the numbers, guest / left / bot tags, the leaders, the empty and
// unknown-player states, no horizontal scroll, no console errors. Screenshots go to outdir.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startIduna, serveWotan } from './lib/real-iduna.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = process.argv[2] || path.join(root, '..', 'arena-stats-shots');
fs.mkdirSync(outdir, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };

const iduna = await startIduna();
const wotan = await serveWotan(iduna.port);

// ---- results, as IDUNA's recorders store them ----
const seed = String.raw`
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1], timeout=10)
c = db.cursor()
def player(pid, name, game):
    c.execute("INSERT INTO players (player_id, display_name, provider, provider_sub, game) VALUES (?,?,?,?,?)", (pid, name, 'iduna_sso', 'sub-' + pid, game))
def stats(pid, game, rating, w, l, d, m):
    c.execute("INSERT INTO game_player_stats (player_id, game, rating, wins, losses, draws, matches) VALUES (?,?,?,?,?,?,?)", (pid, game, rating, w, l, d, m))
for pid, name in (('sp-ash', 'Ash'), ('sp-birch', 'Birch'), ('sp-cedar', 'Cedar')):
    player(pid, name, 'shankpit460')
stats('sp-ash', 'shankpit460', 1531.0, 1, 0, 1, 2)
stats('sp-birch', 'shankpit460', 1485.7, 0, 1, 1, 2)
stats('sp-cedar', 'shankpit460', 1473.3, 0, 1, 0, 1)
def line(slot, pid, name, kind, k, d, place, result, before=0, after=0, left=False, left_ms=0):
    l = dict(slot=slot, name=name, kind=kind, kills=k, deaths=d, place=place, result=result)
    if pid: l['player_id'] = pid
    if left: l['left'], l['left_after_ms'] = True, left_ms
    if before: l['rating_before'], l['rating_after'] = before, after
    return l
r1 = [line(0, 'sp-ash', 'Ash', 'human', 16, 4, 1, 'win', 1500, 1516),
      line(1, '', 'Guest 0042', 'guest', 9, 10, 2, 'loss'),
      line(2, 'sp-birch', 'Birch', 'human', 5, 12, 3, 'loss', 1500, 1494.7),
      line(3, 'sp-cedar', 'Cedar', 'human', 1, 3, 4, 'left', 1500, 1473.3, True, 70000)]
c.execute("""INSERT INTO shankpit460_matches (match_uid, room_id, reason, kill_limit, live_ms, players, signed_in, winner_name, winner_id, top_kills, counted, roster, played_at)
             VALUES ('u1', 1, 1, 16, 183000, 4, 3, 'Ash', 'sp-ash', 16, 1, ?, datetime('now', '-2 hours'))""", (json.dumps(r1),))
m1 = c.lastrowid
for pid, slot, place, res, k, d, b, a in (('sp-ash', 0, 1, 'win', 16, 4, 1500, 1516), ('sp-birch', 2, 3, 'loss', 5, 12, 1500, 1494.7), ('sp-cedar', 3, 4, 'left', 1, 3, 1500, 1473.3)):
    c.execute("INSERT INTO shankpit460_player_matches (match_id, player_id, slot, place, players, result, kills, deaths, rating_before, rating_after, counted, played_at) VALUES (?,?,?,?,4,?,?,?,?,?,1, datetime('now', '-2 hours'))",
              (m1, pid, slot, place, res, k, d, b, a))
r2 = [line(0, 'sp-ash', 'Ash', 'human', 0, 0, 1, 'draw', 1516, 1531), line(1, 'sp-birch', 'Birch', 'human', 0, 0, 1, 'draw', 1494.7, 1485.7)]
c.execute("""INSERT INTO shankpit460_matches (match_uid, room_id, reason, kill_limit, live_ms, players, signed_in, winner_name, winner_id, top_kills, counted, roster)
             VALUES ('u2', 2, 2, 16, 360000, 2, 2, '', '', 0, 1, ?)""", (json.dumps(r2),))
m2 = c.lastrowid
for pid, slot, b, a in (('sp-ash', 0, 1516, 1531), ('sp-birch', 1, 1494.7, 1485.7)):
    c.execute("INSERT INTO shankpit460_player_matches (match_id, player_id, slot, place, players, result, kills, deaths, rating_before, rating_after, counted) VALUES (?,?,?,1,2,'draw',0,0,?,?,1)",
              (m2, pid, slot, b, a))

# Bedrock Racers: four teams of three, two people (Amber slot 0, Teal slot 3), bots in the other ten seats
for pid, name in (('br-dune', 'Dune'), ('br-ember', 'Ember')):
    player(pid, name, 'bedrockracers')
stats('br-ember', 'bedrockracers', 1521.3, 1, 0, 0, 1)
stats('br-dune', 'bedrockracers', 1478.7, 0, 1, 0, 1)
cars = []
for slot in range(12):
    team = slot // 3
    car = dict(slot=slot, team=team, name='Bot %d' % slot, kind='bot', goals=0, assists=0, own_goals=0, steals=0, catches=0, throws=0, passes=0, fires=0, touches=0, top_speed=0, air_used=0)
    if slot == 0: car.update(player_id='br-dune', name='Dune', kind='human', goals=2, assists=1, steals=3, result='loss', rating_before=1500, rating_after=1478.7)
    if slot == 3: car.update(player_id='br-ember', name='Ember', kind='human', goals=4, assists=2, steals=1, result='win', rating_before=1500, rating_after=1521.3)
    cars.append(car)
c.execute("""INSERT INTO bedrockracers_matches (mode, seed, sim_version, level, humans, winner, reason, ticks, overtime, score0, score1, score2, score3, counted, desyncs, roster)
             VALUES ('lobby', 7, 1, 2, 2, 1, 1, 15000, 0, 3, 5, 2, 1, 1, 0, ?)""", (json.dumps(cars),))
bm = c.lastrowid
for pid, slot, team, res, g, a, st, b, af in (('br-dune', 0, 0, 'loss', 2, 1, 3, 1500, 1478.7), ('br-ember', 3, 1, 'win', 4, 2, 1, 1500, 1521.3)):
    c.execute("""INSERT INTO bedrockracers_player_matches (match_id, player_id, slot, team, result, goals, assists, steals, humans, rating_before, rating_after, counted)
                 VALUES (?,?,?,?,?,?,?,?,2,?,?,1)""", (bm, pid, slot, team, res, g, a, st, b, af))
db.commit()
print('seeded')
`;
execFileSync('python3', ['-c', seed, iduna.dbPath], { stdio: 'inherit' });

const browser = await chromium.launch();
const errors = [];
async function open(width, url, name) {
  const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: 1 });
  // the Google Fonts requests are aborted on purpose (no network here); everything else must load
  // (the unknown-player page asks for a player that does not exist: its 404 is the point)
  page.on('console', (m) => {
    if (m.type() !== 'error' || /fonts\.(googleapis|gstatic)/.test((m.location() || {}).url || '')) return;
    if (/id=nobody/.test(url) && /404/.test(m.text())) return;
    errors.push(url + ': ' + m.text());
  });
  page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push(url + ': failed ' + r.url()); });
  page.on('pageerror', (e) => errors.push(url + ': ' + e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(wotan.base + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outdir, name + (width < 600 ? '-phone' : '') + '.png'), fullPage: true });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 1, `${url} at ${width}px: no horizontal scroll (${over}px over)`);
  return page;
}
const texts = (page, sel) => page.$$eval(sel, (ns) => ns.map((n) => n.textContent.trim()));

for (const width of [1280, 390]) {
  // ---- shankpit-460 ----
  let p = await open(width, '/shankpit-460/ladder.html', 'sp-ladder');
  let names = await texts(p, '#board tbody td.who');
  ok(names.join(',') === 'Ash,Birch,Cedar', `sp ladder order by rating (${names})`);
  ok((await p.textContent('#s-players')) === '3' && (await p.textContent('#s-top')) === '1531', 'sp hero tiles: 3 ranked, top rating 1531');
  ok((await texts(p, '#board tbody tr:first-child td'))[3] === '1–0–1', 'sp ladder W-L-D for Ash is 1-0-1');
  const kills = await texts(p, '#leaders .as-leader:first-child li');
  ok(kills[0] && kills[0].startsWith('Ash') && kills[0].endsWith('16'), `sp kill leaders start with Ash on 16 (${kills[0]})`);
  ok(/Nobody yet/.test(await p.textContent('#leaders .as-leader:last-child')), 'sp K/D needs five matches: nobody yet');
  const tabs = await texts(p, '#wotan-nav .wn-tabs a');
  ok(tabs.includes('Ladder') && tabs.includes('Matches') && tabs.includes('Play'), `the sp nav has Play, Ladder and Matches tabs (${tabs})`);
  await p.close();

  p = await open(width, '/shankpit-460/matches.html', 'sp-matches');
  const titles = await texts(p, '.as-match-head b');
  ok(titles.join('|') === 'A draw|Ash wins', `sp matches newest first (${titles.join(' | ')})`);
  const second = await p.$$('.as-match');
  const roster = await second[1].$$eval('tbody tr', (rs) => rs.map((r) => r.textContent));
  ok(roster.length === 4 && /Guest 0042guest/.test(roster[1]) && /Left/.test(roster[3]), 'the scoreboard shows the guest and the leaver, tagged');
  const deltas = roster.map((r) => (r.match(/[+−±]\d+/) || ['–'])[0]);
  ok(deltas.join(' ') === '+16 – −5 −27', `rating changes: +16 Ash, none for the guest, −5 Birch, −27 Cedar (${deltas.join(' ')})`);
  await p.close();

  p = await open(width, '/shankpit-460/matches.html?player_id=sp-cedar', 'sp-matches-cedar');
  ok((await p.$$('.as-match')).length === 1 && /One player/.test(await p.textContent('#m-scope')), 'a player\'s own matches, with a way back to everyone\'s');
  await p.close();

  p = await open(width, '/shankpit-460/u.html?id=sp-ash', 'sp-player');
  ok((await p.textContent('#p-name')) === 'Ash' && /Ash/.test(await p.title()), 'sp player page names Ash');
  const tiles = await texts(p, '.as-tiles .i-stat');
  ok(tiles.some((t) => t === '1531Rating') && tiles.some((t) => t === '#1Rank') && tiles.some((t) => t === '16Kills'), `sp player tiles (${tiles.join(' / ')})`);
  ok((await p.$$('.as-section tbody tr')).length === 2, 'two recent matches');
  await p.close();

  p = await open(width, '/shankpit-460/u.html?id=nobody', 'sp-player-unknown');
  ok(/No such player/.test(await p.textContent('#player')), 'an unknown player says so');
  await p.close();

  // ---- Bedrock Racers ----
  p = await open(width, '/bedrockracers/ladder.html', 'br-ladder');
  names = await texts(p, '#board tbody td.who');
  ok(names.join(',') === 'Ember,Dune', `br ladder order (${names})`);
  const goals = await texts(p, '#leaders .as-leader:first-child li');
  ok(goals[0] && goals[0].startsWith('Ember') && goals[0].endsWith('4'), `br goal leaders start with Ember on 4 (${goals[0]})`);
  await p.close();

  p = await open(width, '/bedrockracers/matches.html', 'br-matches');
  ok((await texts(p, '.as-match-head b'))[0] === 'Teal wins', 'br match title names the winning team');
  ok((await texts(p, '.as-teams .as-team')).join(',') === 'Amber3,Teal5,Violet2,Coral1', 'the four scores');
  ok((await p.$$('.as-match tbody tr')).length === 2, 'the list shows the two people');
  await p.click('.as-more');
  await p.waitForFunction(() => document.querySelectorAll('.as-match tbody tr').length === 12, null, { timeout: 5000 }).catch(() => {});
  const all = await p.$$eval('.as-match tbody tr', (rs) => rs.map((r) => r.textContent));
  ok(all.length === 12 && all.filter((t) => /bot/.test(t)).length === 10, `every car, bots tagged (${all.length} rows)`);
  await p.screenshot({ path: path.join(outdir, 'br-matches-all' + (width < 600 ? '-phone' : '') + '.png'), fullPage: true });
  await p.close();

  p = await open(width, '/bedrockracers/u.html?id=br-ember', 'br-player');
  ok((await p.textContent('#p-name')) === 'Ember', 'br player page');
  const bt = await texts(p, '.as-tiles .i-stat');
  ok(bt.includes('4Goals') && bt.includes('#1Rank'), `br player tiles (${bt.join(' / ')})`);
  ok((await p.$$('.as-section tbody tr')).length === 1, 'one recent match');
  await p.close();
}

ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
wotan.stop(); iduna.stop();
console.log(`\n${pass} passed, ${fail} failed (screenshots in ${outdir})`);
process.exit(fail ? 1 : 0);
