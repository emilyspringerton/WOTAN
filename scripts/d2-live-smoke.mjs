// Plays one short real session against production (or any WOTAN origin): a guest account, the D2 gateway, the live dw2_server and a live
// bot, a packed ship, READY, the fight with every round break answered on the line, the result and the recording. No browser.
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
const ident = await next(0xA1);
ok(ident[1] === 1, 'the gateway says who you are (a guest)');
await next(0x81);
ok(true, 'the match server welcomed the player');
send(3); // QUEUE
const mf = await next(0x83, 60000);
const opp = new TextDecoder().decode(mf.slice(10, 26)).replace(/\0.*$/, '');
ok(mf[26] === 1, `paired with a bot at once (${opp})`);
// the starter ship: three generator -> wire -> railgun lines and bulwarks
const ship = [[0,0,0,0],[1,0,1,0],[3,0,2,0],[0,1,0,0],[1,1,1,0],[3,1,2,0],[0,2,0,0],[1,2,1,0],[3,2,2,0],[4,4,0,0],[4,4,1,0],[4,4,2,0],[4,4,3,0],[4,4,4,0],[4,4,5,0],[4,5,0,0]];
for (const p of ship) send(4, ...p);
for (let i = 0; i < ship.length; i++) { const a = await next(0x84, 10000); if (a[0] !== 0x84) throw new Error('placement refused'); }
ok(true, `the server accepted all ${ship.length} placements`);
send(6); // READY
const cs = await next(0x88, 60000);
ok(cs[2] === 100 || cs[2] <= 100, `combat started (your armor ${cs[3] | cs[4] << 8}, theirs ${cs[5] | cs[6] << 8})`);
let end = null, breaks = 0, perfect = 0, good = 0;
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
  const me = inbox.findIndex((f) => f[0] === 0x8A);
  if (me >= 0) end = inbox.splice(me, 1)[0];
  await sleep(10);
}
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
