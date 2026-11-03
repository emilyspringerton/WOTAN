#!/usr/bin/env node
// scripts/shankpit-net-test.js -- the internet-of-SHANKPIT shim, tested against the REAL daemon and the
// REAL snapshot the game's own test writes.
//
//   SHANKPIT_NETD      path to shankpit_netd        (default ../SHANKPIT/bin/shankpit_netd)
//   DW_SNAPSHOT        the snapshot to serve        (default ../SHANKPIT/var/deadweight/net.json)
//   PORT               daemon port                  (default 8799)
//
// What it proves, in order: the daemon serves the file the game wrote; the ETag/304 path works; CORS
// and OPTIONS work for a dev origin; a bad route names itself; a write method is refused with Allow;
// and js/shankpit-net.js turns that exact JSON into the page's model with consistent, non-invented
// numbers. Rebuild the snapshot with `make test-deadweight` in ../SHANKPIT, then run this.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const NET = require('../js/shankpit-net.js');

const ROOT = path.resolve(__dirname, '..');
const NETD = process.env.SHANKPIT_NETD || path.resolve(ROOT, '../SHANKPIT/bin/shankpit_netd');
const SNAPSHOT = process.env.DW_SNAPSHOT || path.resolve(ROOT, '../SHANKPIT/var/deadweight/net.json');
const PORT = Number(process.env.PORT || 8799);

let failures = 0, checks = 0;
function ok(cond, what) { checks++; if (!cond) { failures++; console.log('FAIL ' + what); } }
function eq(actual, expected, what) {
  checks++;
  if (actual !== expected) { failures++; console.log('FAIL ' + what + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')'); }
}

function request(pathname, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForHealth(deadline) {
  for (;;) {
    try { const r = await request('/api/v1/shankpit-net/health'); if (r.status === 200) return r; } catch (e) { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('shankpit_netd did not answer /health in 5s');
    await new Promise((r) => setTimeout(r, 100));
  }
}

(async () => {
  if (!fs.existsSync(NETD)) {
    console.log('FAIL missing daemon: ' + NETD + '\n     build it with `make netd` in ../SHANKPIT');
    process.exit(1);
  }
  if (!fs.existsSync(SNAPSHOT)) {
    console.log('FAIL missing snapshot: ' + SNAPSHOT + '\n     write it with `make test-deadweight` in ../SHANKPIT');
    process.exit(1);
  }

  const child = spawn(NETD, ['--snapshot', SNAPSHOT, '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let daemonOut = '';
  child.stdout.on('data', (d) => { daemonOut += d; });
  child.stderr.on('data', (d) => { daemonOut += d; });

  try {
    await waitForHealth(Date.now() + 5000);

    // ---- the file really is served, and it is the game's own snapshot ----
    const snap = await request('/api/v1/shankpit-net/deadweight');
    eq(snap.status, 200, 'snapshot 200');
    ok(/application\/json/.test(snap.headers['content-type'] || ''), 'snapshot content-type is JSON');
    eq(snap.headers['access-control-allow-origin'], '*', 'snapshot CORS');
    ok(!!snap.headers.etag, 'snapshot has an ETag');
    const onDisk = fs.readFileSync(SNAPSHOT, 'utf8');
    eq(snap.body, onDisk, 'the daemon serves the file on disk byte for byte');

    // ---- 304 on a matching If-None-Match, 200 on a stale one ----
    const cached = await request('/api/v1/shankpit-net/deadweight', { headers: { 'If-None-Match': snap.headers.etag } });
    eq(cached.status, 304, 'matching ETag -> 304');
    eq(cached.body, '', '304 has no body');
    const stale = await request('/api/v1/shankpit-net/deadweight', { headers: { 'If-None-Match': '"nope"' } });
    eq(stale.status, 200, 'a stale ETag -> 200');

    // ---- HEAD carries the headers and no body ----
    const head = await request('/api/v1/shankpit-net/deadweight', { method: 'HEAD' });
    eq(head.status, 200, 'HEAD 200');
    eq(head.body, '', 'HEAD has no body');
    ok(Number(head.headers['content-length']) > 0, 'HEAD reports the length it would send');

    // ---- OPTIONS for a dev origin, and a write method refused with Allow ----
    const opts = await request('/api/v1/shankpit-net/deadweight', { method: 'OPTIONS' });
    eq(opts.status, 204, 'OPTIONS -> 204');
    eq(opts.headers['access-control-allow-methods'], 'GET, HEAD, OPTIONS', 'OPTIONS advertises the methods');
    const post = await request('/api/v1/shankpit-net/deadweight', { method: 'POST' });
    eq(post.status, 405, 'POST -> 405');
    eq(post.headers.allow, 'GET, HEAD, OPTIONS', '405 carries Allow');

    // ---- an honest 404 that names the path ----
    const miss = await request('/api/v1/shankpit-net/nope');
    eq(miss.status, 404, 'unknown route -> 404');
    const missJson = JSON.parse(miss.body);
    eq(missJson.path, '/api/v1/shankpit-net/nope', 'the 404 names the path it did not find');
    ok(Array.isArray(missJson.routes) && missJson.routes.length === 2, 'the 404 lists the real routes');

    // ---- health ----
    const health = JSON.parse((await request('/api/v1/shankpit-net/health')).body);
    eq(health.ok, true, 'health ok');
    eq(health.snapshot_bytes, onDisk.length, 'health reports the real snapshot size');
    ok(health.snapshot_age_ms >= 0, 'health reports a real age');

    // ---- the module turns that JSON into the page's model, with no invented numbers ----
    const raw = JSON.parse(snap.body);
    const model = NET.describe(raw, Number(raw.generated_ms) + 1200);
    eq(model.schema, 2, 'model schema');
    ok(model.records.length >= 1, 'the model has the citizen the game created');
    const citizen = model.records.filter((r) => !r.player)[0];
    ok(!!citizen, 'a citizen record survives the round trip');
    eq(citizen.name, 'a"b\\c', 'the escaped name decodes to what the game put in it');
    eq(citizen.path, 'CRAFT', 'the citizen knows its path');
    eq(citizen.deck.length, 16, 'a deck is sixteen cards');
    eq(citizen.mix.total, 16, 'the deck mix counts sixteen cards');
    eq(citizen.games >= 1, true, 'the match the game played is on the record');
    ok(citizen.winratePermille >= 0 && citizen.winratePermille <= 1000, 'the win rate is a real permille');
    // schema 2: the number a leaderboard climbs, straight off the ladder (dw_rating.c <- rating.prn)
    ok(citizen.rating >= 100, 'the record carries the ladder rating');
    eq(citizen.unknownRating, false, 'a rated record is not flagged unknown');
    // and the page's order is the ladder's order, not the JSON's arrival order
    for (let i = 1; i < model.records.length; i++) {
      ok(model.records[i - 1].rating >= model.records[i].rating, 'records are ordered by rating');
    }
    // the JSON on disk really carries it -- the model is not inventing a number
    ok(/"rating":\d+/.test(snap.body), 'the snapshot itself carries a rating field');

    eq(model.population.citizens, 1, 'population citizens');
    eq(model.population.players, 1, 'population players');
    ok(model.recent.length >= 1, 'the ticker has the finished match');
    eq(model.recent[0].pid0, 4, 'the ticker keeps the challenge order (seat 0)');
    eq(model.recent[0].pid1, 0, 'the ticker keeps the challenge order (seat 1)');
    // hand-derived: the match finished at ms=2500, `now` is generated_ms+1200 = 5200, so 2700 ms
    eq(model.recent[0].ago, '3s ago', 'the ticker reports the real age of the match');
    ok(/beat|drew/.test(NET.resultLine(model.recent[0], model.nameFor)), 'a result line reads as a sentence');
    ok(/a"b\\c/.test(NET.resultLine(model.recent[0], model.nameFor)), 'the result line uses the citizen name');

    // the meta's own share is derived from the tally, never restated
    eq(model.meta.kinds.length, 3, 'three kinds');
    const kindSum = model.meta.kinds.reduce((a, b) => a + b, 0);
    if (model.meta.plays > 0) {
      const share = Math.floor((Math.max.apply(null, model.meta.kinds) * 1000) / model.meta.plays);
      eq(model.meta.sharePermille, share, 'the share is the tallied kind over the tallied plays');
    }
    eq(model.totals.matches, Math.round(model.totals.games / 2), 'matches is games over two');

    // ---- the page and the nav are wired to this module and this route ----
    const page = fs.readFileSync(path.join(ROOT, 'shankpit-citizens.html'), 'utf8');
    ok(page.includes('/js/shankpit-net.js'), 'the page loads the module');
    ok(page.includes('data-skin="dw"') && page.includes('data-section="citizens"'), 'the page mounts the nav as Citizens');
    ok(page.includes('/api/v1/shankpit/leaderboard'), 'the page also reads IDUNA\'s real SHANKPIT leaderboard');
    const nav = fs.readFileSync(path.join(ROOT, 'js/wotan-nav.js'), 'utf8');
    ok(nav.includes("'/shankpit-citizens.html'"), 'the nav has a Citizens tab');

    // ---- formatting is deterministic, which is what makes it testable ----
    eq(NET.pct(666), '66.6%', 'pct 666');
    eq(NET.pct(500), '50%', 'pct 500');
    eq(NET.pct(1000), '100%', 'pct 1000');
    eq(NET.nameOf({ pid: 9, name: '' }), 'citizen 9', 'an unnamed citizen falls back to its pid');
    eq(NET.nameOf({ pid: 0, player: 1, name: '' }), 'player 0', 'an unnamed player falls back to its pid');
    eq(NET.timeAgo(1000, 61000), '1m ago', 'timeAgo minutes');
    eq(NET.timeAgo(2500, 3300), 'just now', 'timeAgo under two seconds');
    eq(NET.kindName(1), 'OPERATIONS', 'kind name');
    eq(NET.deckMix([0, 0, 3, 6, 9]).operations, 1, 'deck mix counts an Operations id');
  } catch (e) {
    failures++;
    checks++;
    console.log('FAIL ' + e.message);
    if (daemonOut) console.log('     daemon said: ' + daemonOut.trim());
  } finally {
    child.kill();
  }

  if (failures) { console.log('shankpit-net: ' + failures + ' of ' + checks + ' FAILED'); process.exit(1); }
  console.log('shankpit-net: ALL PASS (' + checks + ' checks)');
})();
