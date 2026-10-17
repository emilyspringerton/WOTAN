// A short REAL session against a deployed Red Garden gateway, speaking the browser protocol (no browser):
//   node scripts/redgarden-live-smoke.mjs [https://wotan.okemily.com]
// Makes a guest account (one row in the target's IDUNA), queues for a 10v10, drafts a hero, goes live, walks, and leaves (an
// "abandoned" row, which never touches win/loss). Proves the deployed chain end to end: gateway -> ticket -> live matchmaker ->
// arena server -> snapshots. It occupies one live arena (and the bots in it) for about half a minute.
const base = process.argv[2] || 'https://wotan.okemily.com';
const wsUrl = base.replace(/^http/, 'ws') + '/api/v1/redgarden/play';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const st = await (await fetch(base + '/api/v1/redgarden/status')).json();
ok(st.configured === true, 'the gateway is configured (REDGARDEN_TICKET_SECRET is set): ' + JSON.stringify(st).slice(0, 160));
if (!st.configured) process.exit(1);
const reg = await fetch(base + '/api/v1/games/redgarden/guest-register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'RG Smoke' }) });
ok(reg.ok, 'a guest account can be made (' + reg.status + ')');
const guest = await reg.json();

const ws = new WebSocket(wsUrl); ws.binaryType = 'arraybuffer';
const frames = [];
ws.onmessage = (e) => frames.push(new Uint8Array(e.data));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket failed')); });
const tok = Buffer.from(guest.token, 'latin1');
const hello = Buffer.concat([Buffer.from([1, 1, tok.length & 255, tok.length >> 8]), tok]);
ws.send(hello);
const of = (k) => frames.filter((f) => f[0] === k);
async function until(what, cond, ms = 40000) { const t = Date.now(); while (Date.now() - t < ms) { if (cond()) return true; await sleep(100); } console.log('  (timed out waiting for ' + what + ')'); return false; }
ok(await until('welcome', () => of(0x81).length === 1, 8000), 'HELLO is accepted: the gateway resolves the guest token');
if (of(0x81)[0]) { const w = of(0x81)[0]; const nl = w[3]; ok(w[2] === 1 && Buffer.from(w.slice(4, 4 + nl)).toString() === 'RG Smoke', 'WELCOME names the player'); }
ws.send(Buffer.from([2, 1])); // QUEUE 10v10
ok(await until('match', () => of(0x83).length === 1, 120000), 'the live matchmaker seats the player in a 10v10 (STATUS: ' + of(0x82).map((s) => s[1]).join(',') + ')');
const m = of(0x83)[0] || [];
ok(m[2] === 20, 'lobby of 20 (the player plus the 19-bot pool): slot ' + m[1] + ', team ' + m[3]);
const snap = () => { const s = of(0x84); return s.length ? s[s.length - 1] : null; };
const phase = () => { const s = snap(); return s ? s[1 + 2] : -1; };
ok(await until('draft', () => phase() === 1, 30000), 'the arena opens its draft');
ws.send(Buffer.from([0x10, 9]));
ok(await until('live', () => phase() === 2, 40000), 'picking a hero starts the match');
const hero = (s, slot) => { const base = 1 + 1244 + 4 + Math.floor(slot / 14) * 1460 - Math.floor(slot / 14) * 4 + (slot % 14) * 104; return base; };
const heroAt = (slot) => { const s = snap(); const off = 1 + 1244 + Math.floor(slot / 14) * 1460 + 4 + (slot % 14) * 104; const dv = new DataView(s.buffer, s.byteOffset); return { x: dv.getFloat32(off, true), z: dv.getFloat32(off + 4, true), id: s[off + 13], hp: dv.getUint16(off + 8, true) }; };
await sleep(1500);
const me = heroAt(m[1]);
ok(me.id === 9 && me.hp > 0, 'the snapshot shows the picked hero alive (hero ' + me.id + ', hp ' + me.hp + ')');
const mv = Buffer.alloc(9); mv[0] = 0x11; mv.writeFloatLE(0, 1); mv.writeFloatLE(0, 5);
ws.send(mv);
const d0 = Math.hypot(me.x, me.z);
ok(await until('walk', () => { const h = heroAt(m[1]); return Math.hypot(h.x, h.z) < d0 - 4; }, 25000), 'a move order walks the hero toward the middle on the real arena');
ws.send(Buffer.from([3])); // LEAVE
await sleep(800);
ws.close();
const mm = await (await fetch(base + '/api/v1/redgarden/status')).json();
console.log(`\n${pass} passed, ${fail} failed (guest ${guest.player_id}; status after: ${JSON.stringify(mm.pools)})`);
process.exit(fail ? 1 : 0);
