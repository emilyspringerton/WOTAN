// Plays one short real session against production (or any WOTAN origin): a guest account, the D2 gateway, the live dw2_server and a live
// bot, a packed ship (ruleset 2: 1000 credits and 40 tons, an over-budget part refused), READY, the opponent's ship, the fight's EVENTS
// frames and every round break answered on the line, the result and the recording. No browser.
//   node scripts/d2-live-smoke.mjs [https://wotan.okemily.com]
// Leaves one guest account ("Runner-...") and one recorded match in production, like any player.
const origin = (process.argv[2] || 'https://wotan.okemily.com').replace(/\/$/, '');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (p, opts) => { const r = await fetch(origin + p, opts); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };

const st = await j('/api/v1/d2/status');
ok(st.configured === true, `the gateway is configured (${st.online} online, ${st.playing} playing)`);
const g = await j('/api/v1/games/d2/guest-register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
ok(g.player_id && g.token, `a guest account is made (${g.display_name})`);

const ws = new WebSocket(origin.replace(/^http/, 'ws') + '/api/v1/d2/play');
ws.binaryType = 'arraybuffer';
const inbox = [];
ws.onmessage = (e) => inbox.push(new Uint8Array(e.data));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket failed')); });
const send = (...b) => ws.send(new Uint8Array(b));
const tok = new TextEncoder().encode(g.token);
ws.send(new Uint8Array([2, tok.length & 255, tok.length >> 8, ...tok]));
async function next(type, ms = 30000) {
  const t = Date.now();
  for (;;) {
    const i = inbox.findIndex((f) => f[0] === type);
    if (i >= 0) return inbox.splice(i, 1)[0];
    if (Date.now() - t > ms) throw new Error('no frame 0x' + type.toString(16));
    const e = inbox.findIndex((f) => f[0] === 0xAF);
    if (e >= 0) throw new Error('gateway error: ' + new TextDecoder().decode(inbox[e].slice(3)));
    await sleep(20);
  }
}
async function nextOf(types, ms = 30000) {
  const t = Date.now();
  for (;;) {
    const i = inbox.findIndex((f) => types.includes(f[0]));
    if (i >= 0) return inbox.splice(i, 1)[0];
    if (Date.now() - t > ms) throw new Error('no frame of ' + types.map((x) => '0x' + x.toString(16)));
    const e = inbox.findIndex((f) => f[0] === 0xAF);
    if (e >= 0) throw new Error('gateway error: ' + new TextDecoder().decode(inbox[e].slice(3)));
    await sleep(20);
  }
}
const ident = await next(0xA1);
ok(ident[1] === 1, 'the gateway says who you are (a guest)');
await next(0x81);
ok(true, 'the match server welcomed the player');
send(3); // QUEUE
const mf = await next(0x83, 60000);
const opp = new TextDecoder().decode(mf.slice(10, 26)).replace(/\0.*$/, '');
ok(mf[26] === 1, `paired with a bot at once (${opp})`);
// a legal ship: four Pulse Lasers across the bow, a Generator behind each one pointing at it, two Bulwark plates behind those
// (990 credits, 38 tons: the same ship as the bot pool's "Laser line x4")
const ship = [[7,0,0,3],[7,0,1,3],[7,0,2,3],[7,0,3,3],[0,1,0,3],[0,1,1,3],[0,1,2,3],[0,1,3,3],[4,2,0,0],[4,2,1,0]];
const place = async (p) => { send(4, ...p); const f = await nextOf([0x84, 0x85], 10000); return f[0] === 0x84 ? 0 : f[1]; };
for (const p of ship) { if (await place(p) !== 0) throw new Error('placement refused: ' + p); }
ok(true, `the server accepted all ${ship.length} placements`);
// the budget is the server's rule, not just the page's: a Siege Cannon weighs 10 t and the ship already carries 38 of 40
ok((await place([8, 4, 4, 0])) === 3, 'a part that would take the ship over 40 tons is refused as over budget (reason 3)');
send(6); // READY
const cs = await next(0x88, 60000);
ok(cs[1] === 100 && cs[2] === 100 && (cs[3] | cs[4] << 8) === 0, `combat started: both hulls 100, no shield yet (cargo ${cs[7] | cs[8] << 8} / ${cs[9] | cs[10] << 8})`);
// the opponent's ship, right after COMBAT_START: 36 slots of (item,row,col,rot), unused ones item 255
const os = await next(0x90, 10000);
const oppParts = os[1];
ok(os.length === 146 && oppParts >= 1 && oppParts <= 36, `the opponent's ship arrives (${oppParts} parts, a ${os.length}-byte frame)`);
let end = null, breaks = 0, perfect = 0, good = 0, eventFrames = 0, fires = 0, hits = 0, lastStruct = [0, 0];
const t0 = Date.now();
while (!end && Date.now() - t0 < 120000) {
  const rb = inbox.findIndex((f) => f[0] === 0x8C);
  if (rb >= 0) {
    const f = inbox.splice(rb, 1)[0];
    const target = f[3] | f[4] << 8;
    await sleep(Math.max(40, target - 60));  // 60 ms is a guess at the round trip; GOOD is +-220 ms
    send(9, breaks % 2); breaks++;
  }
  const rr = inbox.findIndex((f) => f[0] === 0x8D);
  if (rr >= 0) { const f = inbox.splice(rr, 1)[0]; if (f[2] === 3) perfect++; if (f[2] >= 2) good++; }
  // EVENTS (0x92): after every TICK, what that second did -- tick, n, dropped, structure you/opp (u16 each), then n x (type, side, a, b, c, d, e)
  for (let ev = inbox.findIndex((f) => f[0] === 0x92); ev >= 0; ev = inbox.findIndex((f) => f[0] === 0x92)) {
    const f = inbox.splice(ev, 1)[0];
    const n = f[2];
    if (f.length !== 8 + 7 * n) throw new Error(`EVENTS frame of ${f.length} bytes for ${n} events`);
    eventFrames++; lastStruct = [f[4] | f[5] << 8, f[6] | f[7] << 8];
    for (let k = 0; k < n; k++) { const type = f[8 + 7 * k]; if (type === 1) fires++; if (type === 2) hits++; }
  }
  const me = inbox.findIndex((f) => f[0] === 0x8A);
  if (me >= 0) end = inbox.splice(me, 1)[0];
  await sleep(10);
}
ok(eventFrames >= 5 && fires >= 1, `EVENTS arrived with the ticks (${eventFrames} frames, ${fires} shots fired, ${hits} part hits; structure left ${lastStruct[0]} vs ${lastStruct[1]})`);
ok(!!end, `the match ended (${end ? ['loss', 'win', 'draw'][end[5]] : '?'}, after ${end ? end[7] : '?'} ticks, ${breaks} round breaks: ${good} good or better, ${perfect} perfect)`);
const rec = await next(0xA2, 15000);
ok(rec[1] === 1, `the match was recorded and rated (rating now ${rec[3] | rec[4] << 8}, change ${(rec[5] | rec[6] << 8) << 16 >> 16})`);
ws.close();
await sleep(300);
const prof = await j('/api/v1/d2/players/' + g.player_id);
ok(prof.player.matches === 1 && prof.recent.length === 1 && prof.rank >= 1, `the profile has the match (rank #${prof.rank})`);
const m = await j('/api/v1/d2/web-matches/' + prof.recent[0].id);
ok(m.loadout.length === ship.length && m.rounds.length === breaks, `the stored match has the ship (${m.loadout.length} parts) and ${m.rounds.length} round breaks`);
const lb = await j('/api/v1/games/d2/leaderboard?limit=100');
ok(lb.some((p) => p.player_id === g.player_id) && lb.some((p) => p.kind === 'bot' && p.display_name === opp), 'the player and the bot are on the ladder');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
