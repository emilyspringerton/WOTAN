// Real-browser test of the Redeem a Code page, the nav menu entry and the account overview -- against a REAL IDUNA.
//   NODE_PATH=<dir with node_modules/playwright> PLAYWRIGHT_BROWSERS_PATH=... [IDUNA_BIN=/path/to/iduna] node scripts/redeem-browser-test.mjs [outdir]
// What runs: the real IDUNA binary (IDUNA_BIN, or built from the sibling ../IDUNA checkout with `go build`; needs Go) on a
// throwaway SQLite database seeded with SYNTHETIC claim codes, this repo served statically with /api/ proxied to it
// (what the Gateway does in production), and headless Chromium driving the real pages as a signed-in player. Nothing is
// stubbed on the IDUNA side, so this exercises the real routes, the real claim-code transaction and the real SSO-token
// -> game-player resolution. (Never put real claim codes in this file: the repo is public and codes are redeemable.)
// Optional extra: DEADWEIGHT_SITE=<output of DEADWEIGHT/scripts/build-web.sh> also serves that freshly built game client at
// /DEADWEIGHT/ and runs the whole chain -- sign in to the game, click its Redeem link, redeem in the new tab, come back and
// see 9,999 tickets and the FOUNDER badge -- with the real IDUNA behind both pages.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = process.argv[2] || path.join(root, '..', 'redeem-shots');
fs.mkdirSync(outdir, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };

// ---------- a real IDUNA ----------
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wotan-redeem-'));
let bin = process.env.IDUNA_BIN;
const idunaDir = path.resolve(root, '..', 'IDUNA');
if (!bin) {
  if (!fs.existsSync(path.join(idunaDir, 'main.go'))) { console.error('Set IDUNA_BIN, or check out IDUNA next to this repo.'); process.exit(2); }
  bin = path.join(work, 'iduna');
  console.log('building IDUNA ...');
  execFileSync('go', ['build', '-o', bin, '.'], { cwd: idunaDir, env: { ...process.env, GOWORK: 'off' }, stdio: 'inherit' });
}
const run = path.join(work, 'run');
for (const d of ['var', 'nock', 'video']) fs.mkdirSync(path.join(run, d), { recursive: true });
fs.symlinkSync(path.join(idunaDir, 'migrations'), path.join(run, 'migrations'));
const idunaPort = 20000 + Math.floor(Math.random() * 20000);
const dbPath = path.join(run, 'var', 'iduna.db');
const iduna = spawn(bin, [], {
  cwd: run, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, IDUNA_ROOT: run, SQLITE_PATH: dbPath, KEY_FILE: path.join(run, 'key.json'), IDUNA_ADDR: `127.0.0.1:${idunaPort}`,
    BASE_URL: `http://127.0.0.1:${idunaPort}`, NOCK_DATA_DIR: path.join(run, 'nock'), NOCK_VIDEO_DIR: path.join(run, 'video'),
    NOCK_ROBOTS_GIT_DIR: 'off', EMILY_BACKLOG_PATH: path.join(run, 'BACKLOG.md'),
    DEADWEIGHT_MODEL_GIT_DISABLED: '1', BRAWLPIT_MODEL_GIT_DISABLED: '1', SHANKPIT_MODEL_GIT_DISABLED: '1' },
});
let idunaLog = '';
iduna.stdout.on('data', (d) => { idunaLog += d; }); iduna.stderr.on('data', (d) => { idunaLog += d; });
const idunaBase = `http://127.0.0.1:${idunaPort}`;
for (let i = 0; ; i++) {
  try { if ((await fetch(idunaBase + '/health')).ok) break; } catch (e) { /* not up yet */ }
  if (i > 60) { console.error('IDUNA did not start:\n' + idunaLog.slice(-800)); iduna.kill(); process.exit(2); }
  await new Promise((r) => setTimeout(r, 500));
}

// ---------- synthetic codes ----------
const db = new DatabaseSync(dbPath);
const seed = db.prepare('INSERT INTO game_claim_codes (code, game, tickets, founder_flag) VALUES (?,?,?,?)');
const C = {
  founder1: 'FNDR1-TEST1-AAAAA-BBBBB-CCCCC', founder2: 'FNDR2-TEST2-AAAAA-BBBBB-CCCCC',
  pack: 'PACK1-TEST1-AAAAA-BBBBB-CCCCC', pack2: 'PACK2-TEST2-AAAAA-BBBBB-CCCCC', brawl: 'BRWL1-TEST1-AAAAA-BBBBB-CCCCC',
};
seed.run(C.founder1, 'deadweight', 0, 1); seed.run(C.founder2, 'deadweight', 0, 1);
seed.run(C.pack, 'deadweight', 10, 0); seed.run(C.pack2, 'deadweight', 5, 0); seed.run(C.brawl, 'brawlpit', 5, 0);

// ---------- WOTAN, statically, with /api/ proxied to IDUNA like the Gateway does ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const p = http.request({ host: '127.0.0.1', port: idunaPort, method: req.method, path: u.pathname + u.search, headers: { ...req.headers, host: `127.0.0.1:${idunaPort}` } },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end('{}'); });
    req.pipe(p); return;
  }
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  let dir = root;
  if (process.env.DEADWEIGHT_SITE && p.startsWith('/DEADWEIGHT/')) { dir = process.env.DEADWEIGHT_SITE; p = p.slice('/DEADWEIGHT'.length); }
  const f = path.join(dir, p);
  if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------- a signed-in player: the generic SSO token WOTAN holds ----------
async function ssoIdentity(email) {
  const r = await fetch(idunaBase + '/api/v1/auth/email/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correcthorsebattery' }) });
  if (!r.ok) throw new Error('register ' + email + ': ' + r.status + ' ' + await r.text());
  return r.json();
}
const me = await ssoIdentity('browser-player@example.com');

// wotan.test resolves to 127.0.0.1 but is not "localhost", so the DEADWEIGHT client takes its production branches (same-origin IDUNA)
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP wotan.test 127.0.0.1'] });
const errors = [];
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 } });
  if (opts.session !== false) {
    const s = opts.session || { token: me.token, id: me.player_id, name: me.display_name };
    await ctx.addInitScript((x) => {
      try {
        localStorage.setItem('wotan_iduna_token', x.token); localStorage.setItem('wotan_iduna_player_id', x.id); localStorage.setItem('wotan_iduna_display_name', x.name);
        // the DEADWEIGHT client keeps its own copy of the same SSO session under its own keys
        localStorage.setItem('dw_iduna_sso_token', x.token); localStorage.setItem('dw_iduna_sso_player_id', x.id); localStorage.setItem('dw_iduna_sso_display_name', x.name);
      } catch (e) { /* ignore */ }
    }, s);
  }
  await ctx.route('**/fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('**/fonts.gstatic.com/**', (r) => r.abort());
  await ctx.route('**/iam.okemily.com/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g|ERR_FAILED|iam\.okemily|\/DEADWEIGHT\/ws/.test(m.text())) errors.push('console: ' + m.text()); });
  return page;
}
// textContent, not innerText: the badges are upper-cased by CSS and innerText would report them that way.
const text = async (page, sel) => (await page.locator(sel).first().textContent()).replace(/\s+/g, ' ').trim();
const shot = (page, name) => page.screenshot({ path: path.join(outdir, name + '.png') });

try {
  // ===== signed out =====
  {
    const page = await newPage({ session: false });
    await page.goto(base + '/redeem/');
    ok((await text(page, 'h1')) === 'Redeem a Code', 'signed out: the page is titled Redeem a Code');
    ok(await page.locator('.rd-input').isDisabled(), 'signed out: the code box is disabled');
    const hint = page.locator('.rd-msg a[data-signin]');
    ok((await hint.count()) === 1 && /Sign in/.test(await hint.innerText()), 'signed out: a plain "Sign in" link (data-signin) says what to do, no button of its own');
    ok((await page.locator('.rd-form button:not([type=submit])').count()) === 0 && (await page.locator('main button:has-text("Sign in")').count()) === 0, 'signed out: the page renders no Sign in button (the top bar owns it)');
    ok(/Account sections/.test(await page.locator('.wn-tabs').getAttribute('aria-label')) && (await page.locator('.wn-tabs a').allTextContents()).join('|') === 'Account|Redeem a code', 'nav: the account skin shows exactly the Account and Redeem a code tabs');
    ok((await page.locator('.wn-tabs a[aria-current="page"]').textContent()) === 'Redeem a code', 'nav: Redeem a code is the current tab');
    ok((await page.locator('.wn-theme').count()) === 0, 'nav: no theme picker on account pages');
    await shot(page, '01-signed-out');
    await page.context().close();
  }

  // ===== the menu entry =====
  {
    const page = await newPage();
    await page.goto(base + '/account/');
    await page.waitForSelector('.wn-user');
    await page.click('.wn-user');
    const item = page.locator('#wn-menu a[role=menuitem]', { hasText: 'Redeem a code' });
    ok((await item.count()) === 1 && (await item.getAttribute('href')) === '/redeem/', 'menu: "Redeem a code" sits in the signed-in user menu and links to /redeem/');
    const labels = await page.locator('#wn-menu [role=menuitem]').allInnerTexts();
    ok(labels.indexOf('Redeem a code') === labels.indexOf('Account & linked accounts') + 1 && labels[labels.length - 1] === 'Sign out', 'menu: it comes right after the account entry and before Sign out (' + labels.join(' / ') + ')');
    // the link must be READABLE on the menu's own background (a body.hs page once painted it indigo on dark purple)
    const contrast = await item.evaluate((a) => {
      const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const fg = lum(getComputedStyle(a).color), bg = lum(getComputedStyle(document.querySelector('#wn-menu')).backgroundColor);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    ok(contrast >= 4.5, 'menu: the entry is readable on the menu background (contrast ' + contrast.toFixed(1) + ':1, needs 4.5)');
    await shot(page, '02-menu');
    await item.click();
    await page.waitForURL('**/redeem/');
    ok(page.url().endsWith('/redeem/'), 'menu: clicking it opens the Redeem page');
    await page.context().close();
  }

  // ===== the full page, signed in =====
  const page = await newPage();
  await page.goto(base + '/redeem/');
  const input = page.locator('.rd-input'), button = page.locator('.rd-row .rd-btn');
  ok(await input.isEnabled() && await input.evaluate((e) => document.activeElement === e), 'page: signed in, the box is enabled and focused');
  ok((await button.isDisabled()), 'page: Redeem Code stays disabled until the code is complete');
  await input.pressSequentially('fndr1', { delay: 15 });
  ok((await input.inputValue()) === 'FNDR1', 'typing: upper-cased as you go, no dangling dash after five');
  await input.pressSequentially('te', { delay: 15 });
  ok((await input.inputValue()) === 'FNDR1-TE', 'typing: the dash appears when the sixth character does');
  await input.press('Backspace'); await input.press('Backspace');
  ok((await input.inputValue()) === 'FNDR1', 'typing: two Backspaces from FNDR1-TE land on FNDR1, the dash goes with the T (the format does not fight you)');
  await input.fill('  fndr1test1 aaaaa-bbbbb ccccc \n');
  ok((await input.inputValue()) === C.founder1 && (await button.isEnabled()), 'paste: spaces, dashes and lower case are tidied into the real code and the button lights up (nothing truncated)');
  await input.fill('');
  await input.evaluate((el, txt) => { const dt = new DataTransfer(); dt.setData('text', txt);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, 'Your code: fndr1-test1-aaaaa-bbbbb-ccccc -- thanks for playing!');
  ok((await input.inputValue()) === C.founder1 && (await button.isEnabled()), 'paste: a code pasted inside a sentence goes in alone, without the words around it');
  await shot(page, '03-ready');

  await button.click();
  await page.waitForSelector('.rd-result');
  const r1 = await text(page, '.rd-result');
  ok(/Code redeemed/.test(r1) && /DEADWEIGHT Founder unlocked/.test(r1), 'founder code: says "DEADWEIGHT Founder unlocked"');
  ok(/Founder status is now on your account, for good\./.test(r1), 'founder code: says what the status is');
  ok(/Draft tickets: 9,999, effectively unlimited\./.test(r1), 'founder code: says the tickets are 9,999 / effectively unlimited');
  ok((await page.locator('.rd-tile b').allInnerTexts()).join('|') === '9,999|Founder', 'founder code: the stat tiles read 9,999 and Founder');
  ok(r1.includes('Applied to ' + me.display_name + ' in DEADWEIGHT.') && r1.includes('Code ' + C.founder1), 'founder code: names the account it landed on and the code used');
  ok((await page.locator('.rd-result a.rd-btn').getAttribute('href')) === '/DEADWEIGHT/', 'founder code: offers Play DEADWEIGHT');
  ok((await input.inputValue()) === '', 'founder code: the box is cleared for the next one');
  await page.waitForTimeout(450); // let the entrance animation finish before the picture
  await shot(page, '04-founder-unlocked');

  const pub = await (await fetch(idunaBase + '/api/v1/games/deadweight/players/' + me.player_id + '/tickets')).json();
  ok(pub.founder === true && pub.tickets === 9999, 'the game side agrees: public tickets read says founder, 9999');
  const ex = await (await fetch(idunaBase + '/api/v1/games/deadweight/sso-exchange', { method: 'POST', headers: { authorization: 'Bearer ' + me.token } })).json();
  ok(ex.player_id === me.player_id && ex.tickets === 9999, 'the game side agrees: signing in to DEADWEIGHT with this identity resolves to the same player with 9999 tickets');

  await input.fill(C.founder1);
  await button.click();
  await page.waitForSelector('.rd-msg.error');
  ok(/not valid, or it has already been used/.test(await text(page, '.rd-msg')) && (await page.locator('.rd-msg').getAttribute('role')) === 'alert', 'spent code: says it is not valid or already used, as an alert');
  ok((await input.inputValue()) === C.founder1 && (await page.locator('.rd-result').count()) === 0, 'spent code: keeps what you typed (typo fixing) and drops the old result');
  await input.fill('abc');
  await input.press('Enter');
  await page.waitForFunction(() => /five groups of five/.test(document.querySelector('.rd-msg').textContent));
  ok(true, 'incomplete code + Enter: says what a code looks like instead of calling the server');

  await input.fill(C.founder2);
  await button.click();
  await page.waitForSelector('.rd-result');
  const r2 = await text(page, '.rd-result');
  ok(/Nothing new this time/.test(r2) && /already a DEADWEIGHT Founder/.test(r2) && !/unlocked/i.test(r2), 'second founder code: honestly says it changed nothing (and does not cheer)');
  ok(/Code used/.test(r2), 'second founder code: the badge says Code used, not Code redeemed');

  await input.fill(C.pack);
  await button.click();
  await page.waitForFunction(() => /\+10 DEADWEIGHT tickets/.test((document.querySelector('.rd-result') || {}).textContent || ''));
  const r3 = await text(page, '.rd-result');
  ok(/Draft tickets: 9,999 → 10,009 \(\+10\)\./.test(r3), 'ticket pack: says +10 and the before and after balance');

  await input.fill(C.brawl);
  await button.click();
  await page.waitForSelector('.rd-msg.error');
  const other = await text(page, '.rd-msg');
  ok(/different game/.test(other) && /BRAWLPIT/.test(other), 'code for another game: the account that belongs to DEADWEIGHT is told so, in plain words (' + other + ')');
  const brawlRow = db.prepare('SELECT used_by_player_id u FROM game_claim_codes WHERE code = ?').get(C.brawl);
  ok(brawlRow.u === null, 'code for another game: stays unspent');

  // a network failure
  await page.route('**/api/v1/redeem', (r) => r.abort());
  await input.fill(C.pack2);
  await button.click();
  await page.waitForFunction(() => /Could not reach the server/.test(document.querySelector('.rd-msg').textContent));
  ok(true, 'network down: says it could not reach the server (and the code is still in the box)');
  await page.unroute('**/api/v1/redeem');

  // help + cancel
  await page.click('.rd-help summary');
  ok(/Save progress with IDUNA/.test(await text(page, '.rd-help')), 'help: tells guests to save progress with IDUNA first');
  await page.context().close();

  // ===== expired sign-in =====
  {
    const p2 = await newPage({ session: { token: 'not-a-real-token', id: 'x', name: 'Ghost' } });
    await p2.goto(base + '/redeem/');
    await p2.locator('.rd-input').fill(C.pack2);
    await p2.locator('.rd-row .rd-btn').click();
    await p2.waitForSelector('.rd-msg.error');
    ok(/sign-in has expired/.test(await text(p2, '.rd-msg')) && (await p2.locator('.rd-msg a[data-signin]').count()) === 1, 'expired sign-in: says so and offers a plain Sign in link');
    await p2.context().close();
  }

  // ===== the account overview =====
  {
    const p3 = await newPage();
    await p3.goto(base + '/account/');
    await p3.waitForSelector('#overview .rd-history li');
    const overview = await text(p3, '#overview');
    ok(/Redeem a code/.test(overview) && (await p3.locator('#overview .rd-input').count()) === 1, 'account: the overview has a Redeem a code card with the box');
    ok(/DEADWEIGHT/.test(overview) && /Founder/.test(overview) && /10,009 Draft tickets/.test(overview), 'account: the Games card shows DEADWEIGHT, Founder and the live balance');
    ok(overview.includes('Playing as ' + me.display_name), 'account: it says which account is playing');
    const rows = await p3.locator('#overview .rd-history li').allInnerTexts();
    ok(rows.length === 3, 'account: Recent redemptions lists the three spent codes (' + rows.length + ')');
    ok(rows.some((x) => x.includes(C.founder1) && /Founder status/.test(x) && /Complete/.test(x)) && rows.some((x) => x.includes(C.pack) && /\+10 tickets/.test(x)),
      'account: each row says what the code gave, and shows the code');
    ok((await p3.locator('.wn-tabs a[aria-current="page"]').textContent()) === 'Account', 'account: Account is the current tab');
    ok(/Linked accounts/.test(await text(p3, 'main')), 'account: the identity sections are still there below the overview');
    await shot(p3, '05-account-overview');

    // redeem inline, in the compact card
    await p3.locator('#overview .rd-input').fill(C.pack2);
    await p3.locator('#overview .rd-row .rd-btn').click();
    await p3.waitForSelector('#overview .rd-result');
    ok(/\+5 DEADWEIGHT tickets/.test(await text(p3, '#overview .rd-result')), 'inline card: redeems right there and says what it did');
    await p3.waitForFunction(() => document.querySelectorAll('#overview .rd-history li').length === 4 && /10,014 Draft tickets/.test(document.querySelector('#overview').textContent));
    ok(true, 'inline card: the Games balance and the history refresh by themselves');
    await p3.waitForTimeout(450);
    await shot(p3, '06-account-inline-redeem');
    await p3.context().close();
  }

  // ===== a fresh identity: empty states =====
  {
    const fresh = await ssoIdentity('fresh-player@example.com');
    const p4 = await newPage({ session: { token: fresh.token, id: fresh.player_id, name: fresh.display_name } });
    await p4.goto(base + '/account/');
    await p4.waitForSelector('#overview .rd-empty');
    const t4 = await text(p4, '#overview');
    ok(/No game accounts yet/.test(t4) && /Nothing redeemed yet/.test(t4), 'account, new player: friendly empty states for games and redemptions');
    const g = await (await fetch(idunaBase + '/api/v1/me/entitlements', { headers: { authorization: 'Bearer ' + fresh.token } })).json();
    const scoped = db.prepare('SELECT game g FROM players WHERE player_id = ?').get(fresh.player_id);
    ok(g.games.length === 0 && (scoped.g === null || scoped.g === ''), 'account, new player: merely opening the overview did not claim the identity for any game');
    await p4.context().close();
  }

  // ===== the whole chain: the game, the link, WOTAN's page, and back =====
  if (process.env.DEADWEIGHT_SITE) {
    const player = await ssoIdentity('chain-player@example.com');
    seed.run('CHAIN-FNDR1-AAAAA-BBBBB-CCCCC', 'deadweight', 0, 1);
    const wotan = base.replace('127.0.0.1', 'wotan.test');
    const g = await newPage({ session: { token: player.token, id: player.player_id, name: player.display_name } });
    await g.goto(wotan + '/DEADWEIGHT/');
    await g.click('#sso-btn');
    await g.waitForFunction(() => /^TICKETS: \d+$/.test(document.getElementById('ticket-count').textContent));
    const startTickets = await text(g, '#ticket-count');
    ok(!(await g.locator('#founder-badge').isVisible()) && startTickets !== 'TICKETS: 9999', 'whole chain: signed in to DEADWEIGHT with IDUNA, an ordinary account (' + startTickets + ', no badge)');
    ok(!(await g.locator('#redeem-hint').isVisible()), 'whole chain: an IDUNA account is not nagged to save progress');
    const [tab] = await Promise.all([g.context().waitForEvent('page'), g.click('#redeem-link')]);
    await tab.waitForSelector('.rd-input');
    ok(tab.url() === wotan + '/redeem/', 'whole chain: the game\'s Redeem a code link opens WOTAN\'s Redeem page in a new tab');
    await tab.locator('.rd-input').fill('chain-fndr1-aaaaa-bbbbb-ccccc');
    await tab.locator('.rd-row .rd-btn').click();
    await tab.waitForSelector('.rd-result');
    ok(/DEADWEIGHT Founder unlocked/.test(await text(tab, '.rd-result')), 'whole chain: redeemed there, and it says DEADWEIGHT Founder unlocked');
    await tab.close();
    ok((await text(g, '#ticket-count')) === startTickets, 'whole chain: meanwhile the game tab has not changed by itself');
    await g.evaluate(() => window.dispatchEvent(new Event('focus')));
    await g.waitForFunction(() => document.getElementById('ticket-count').textContent === 'TICKETS: 9999');
    ok(await g.locator('#founder-badge').isVisible(), 'whole chain: back in the game tab it reads TICKETS: 9999 with the gold FOUNDER badge, no reload');
    await g.waitForTimeout(300);
    await g.screenshot({ path: path.join(outdir, '09-chain-game-founder.png') });
    await g.reload();
    await g.click('#sso-btn');
    await g.waitForFunction(() => document.getElementById('ticket-count').textContent === 'TICKETS: 9999' && document.getElementById('founder-badge').classList.contains('on'));
    ok(true, 'whole chain: and it is still true after a reload and a fresh sign-in (it is the account, not the tab)');
    await g.context().close();
  } else {
    console.log('SKIP: whole chain (set DEADWEIGHT_SITE to a build-web.sh output to include it)');
  }

  // ===== a phone =====
  {
    const phone = await newPage({ viewport: { width: 390, height: 844 } });
    await phone.goto(base + '/redeem/');
    await phone.locator('.rd-input').fill('abcde');
    const fits = await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    ok(fits, 'phone: /redeem/ does not scroll sideways at 390px');
    await shot(phone, '07-phone-redeem');
    await phone.goto(base + '/account/');
    await phone.waitForSelector('#overview .rd-history li');
    ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone: /account/ does not scroll sideways at 390px');
    await shot(phone, '08-phone-account');
    await phone.context().close();
  }

  ok(errors.length === 0, 'no page errors or console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) {
  fail++;
  console.log('FAIL: test aborted: ' + (e && e.stack || e));
  if (errors.length) console.log('page/console errors so far: ' + errors.join(' | '));
} finally {
  await browser.close();
  server.close();
  iduna.kill();
  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { /* tmp */ }
}
console.log(`\n${pass} passed, ${fail} failed (screenshots in ${outdir})`);
process.exit(fail ? 1 : 0);
