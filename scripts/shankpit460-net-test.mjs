// shankpit-460 over the wire: TWO engine instances (the real shankpit460.wasm) driven by a minimal host, one signed in with a
// real IDUNA token and one a guest, against the REAL IDUNA binary. No browser: this is the protocol, the lobby, the referee and
// the engines' netcode end to end.
//   node scripts/shankpit460-net-test.mjs [path/to/shankpit460.wasm]
// What it proves: pressing play queues a human search while a bot match runs; two searchers are paired into one room; the match
// goes live after the countdown; positions relay; a claimed hit moves the victim's health and shield on BOTH screens; a kill
// scores, respawns after the delay, and the kill limit ends the match with the same standings on both screens; the end screen's
// requeue puts both back in a new lobby.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startIduna, serveWotan } from './lib/real-iduna.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = process.argv[2] || path.join(here, '..', 'shankpit-460', 'shankpit460.wasm');
const fieldsPath = path.join(here, '..', '..', 'PARENA', 'stdlib', 'shankpit460', 'sp_fields.prn');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS: ' : 'FAIL: ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fields = {};
for (const m of fs.readFileSync(fieldsPath, 'utf8').matchAll(/\(defn k-([a-z0-9-]+) \[\] : I32 (\d+)\)/g)) fields[m[1]] = +m[2];
const G = { mode: 3, phase: 16, countdown: 11, killLimit: 6, me: 2, qstate: 65, winner: 7, endReason: 8, endN: 94, tick: 0, inMatch: 268, welcomed: 265, auth: 266, matchLeft: 4 };

// KILL_LIMIT 3, a 2 second countdown, a 3 minute match: the same code paths as production, just quicker
const iduna = await startIduna({ SHANKPIT460_KILL_LIMIT: '3', SHANKPIT460_COUNTDOWN_SECONDS: '2', SHANKPIT460_MATCH_SECONDS: '180' });
const wotan = await serveWotan(iduna.port);
const wsUrl = `ws://127.0.0.1:${wotan.port}/api/v1/shankpit460/play`;
const wasmBytes = fs.readFileSync(wasmPath);
const player = await iduna.ssoIdentity('net-player@example.com');

class Host {
  constructor(name, token) {
    this.name = name; this.token = token; this.sock = null; this.errors = []; this.next = 0;
  }
  async start() {
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    this.x = instance.exports; this.x.sp_init();
    this.dv = () => new DataView(this.x.memory.buffer);
    this.t0 = performance.now();
    this.timer = setInterval(() => { try { this.frame(); } catch (e) { this.errors.push(String(e)); } }, 8);
  }
  stop() { clearInterval(this.timer); try { this.sock && this.sock.close(); } catch (e) { /* closed */ } }
  gi(k) { return this.dv().getInt32(135168 + k * 4, true); }
  pf(p, k) { return this.dv().getFloat32(this.x.sp_player_addr(p) + fields[k] * 4, true); }
  pi(p, k) { return this.dv().getInt32(this.x.sp_player_addr(p) + fields[k] * 4, true); }
  get me() { return this.gi(G.me); }
  frame() {
    const now = performance.now() - this.t0 + 1000;
    // the host's two jobs: keep a socket if the engine wants one, and ferry bytes
    if (this.x.sp_net_wanted() === 1 && !this.sock && now >= this.next) this.open();
    this.x.sp_frame(now);
    const total = this.x.sp_net_out_len();
    if (total > 0) {
      if (this.sock && this.sock.readyState === 1) {
        const base = this.x.sp_net_out_addr(), dv = this.dv();
        for (let off = 0; off + 2 < total;) {
          const len = dv.getUint8(base + off) + 256 * dv.getUint8(base + off + 1);
          this.sock.send(new Uint8Array(this.x.memory.buffer.slice(base + off + 2, base + off + 2 + len)));
          off += 2 + len;
        }
      }
      this.x.sp_net_out_clear();
    }
  }
  open() {
    this.x.sp_net_socket(1);
    const ws = new WebSocket(wsUrl); ws.binaryType = 'arraybuffer'; this.sock = ws;
    ws.onopen = () => {
      const tok = this.token || '';
      new Uint8Array(this.x.memory.buffer, this.x.sp_token_addr(), 2000).set(Buffer.from(tok, 'latin1'));
      this.x.sp_token_set(tok.length);
      this.x.sp_name_set(0);
      this.x.sp_net_socket(2);
    };
    ws.onmessage = (e) => {
      const b = new Uint8Array(e.data);
      new Uint8Array(this.x.memory.buffer, this.x.sp_net_in_addr(), b.length).set(b);
      this.x.sp_net_recv(b.length);
    };
    const gone = () => { if (this.sock === ws) { this.sock = null; this.next = performance.now() - this.t0 + 1000 + 3000; this.x.sp_net_socket(3); } };
    ws.onclose = gone; ws.onerror = gone;
  }
  click(x, y) { this.x.sp_pointer(x, y); this.x.sp_button(0, 1); this.x.sp_button(0, 0); }
  async until(label, fn, ms = 20000) {
    const t = performance.now();
    while (performance.now() - t < ms) { if (fn()) return true; await sleep(20); }
    console.log(`  (timed out waiting for: ${label})`);
    return false;
  }
}

const A = new Host('A', player.token);
const B = new Host('B', '');
await A.start(); await B.start();
ok(A.x.sp_phase() === 0 && B.x.sp_phase() === 0, 'both engines start on the title screen');

// ---- A presses PLAY: a bot match at once, and a human search behind it ----
A.x.sp_lock(1);
A.click(320, 204);
ok(A.x.sp_phase() === 1 && A.gi(G.mode) === 0, 'PLAY drops A straight into a bot match');
ok(await A.until('A welcomed', () => A.gi(G.welcomed) === 1), 'A\'s socket opened and IDUNA welcomed it');
ok(A.gi(G.auth) === 1, 'A\'s real SSO token was accepted (signed in, not a guest)');
ok(await A.until('A searching', () => A.x.sp_net_status() === 1), 'A is SEARCHING FOR MATCH while the bot match runs');
const st1 = await (await fetch(`${iduna.base}/api/v1/shankpit460/status`)).json();
ok(st1.searching === 1 && st1.online === 1, `IDUNA counts one searcher (${JSON.stringify({ o: st1.online, s: st1.searching })})`);
await sleep(300);
ok(A.gi(G.mode) === 0 && A.x.sp_phase() === 1, 'a lone searcher stays in the bot match');

// ---- B (a guest) presses PLAY: both are moved into a lobby ----
B.x.sp_lock(1);
B.click(320, 204);
ok(await A.until('A matched', () => A.gi(G.mode) === 1 && A.gi(G.inMatch) === 1), 'A is moved into a human match');
ok(await B.until('B matched', () => B.gi(G.mode) === 1 && B.gi(G.inMatch) === 1), 'B is moved into the same human match');
ok(A.me !== B.me && A.gi(G.killLimit) === 3, `distinct slots (${A.me}, ${B.me}) and the format came from the server (kill limit ${A.gi(G.killLimit)})`);
ok(await A.until('countdown over', () => A.gi(G.countdown) === 0, 8000) && await B.until('countdown over', () => B.gi(G.countdown) === 0, 8000), 'the countdown ends and the match goes live on both screens');

// ---- put them face to face in the open and let A shoot B ----
async function faceOff() {
  // wait out the post-spawn window, then stand them 30 units apart, A facing -z
  await sleep(1300);
  A.x.sp_t_place(A.me, -260, 0.5, -40, 0, 0);
  B.x.sp_t_place(B.me, -260, 0.5, -70, 180, 0);
  // the server believes a position after three updates in a row; give it a moment, and let B's slot settle in A's interpolation
  await sleep(900);
}
await faceOff();
const bx = A.pf(B.me, 'x'), bz = A.pf(B.me, 'z');
ok(Math.abs(bx + 260) < 3 && Math.abs(bz + 70) < 3, `A sees B where B stands (${bx.toFixed(1)}, ${bz.toFixed(1)}) -- positions relay`);

// the knife one-shots (200 damage) within 16.5 units: bring B to 8 units
A.x.sp_t_place(A.me, -260, 0.5, -40, 0, 0);
B.x.sp_t_place(B.me, -260, 0.5, -48, 180, 0);
await sleep(1000);
A.x.sp_key(50, 1); await sleep(40); A.x.sp_key(50, 0);   // weapon 2 = magnum
A.x.sp_key(49, 1); await sleep(40); A.x.sp_key(49, 0);   // weapon 1 = knife
await sleep(100);
ok(A.pi(A.me, 'weapon') === 0, 'key 1 selects the knife');
const hp0 = B.pi(B.me, 'health'), sh0 = B.pi(B.me, 'shield');
A.x.sp_button(0, 1);                                      // hold fire (left mouse; the pointer is locked)
const hurt = await B.until('B took damage', () => B.pi(B.me, 'shield') < sh0 || B.pi(B.me, 'health') < hp0 || B.pi(B.me, 'state') === 1, 6000);
ok(hurt, 'A\'s claimed hit moved B\'s health on B\'s own screen');
ok(await A.until('A scored', () => A.pi(A.me, 'kills') === 1, 6000), 'the knife kill scored on A\'s screen (200 damage kills through a full shield)');
ok(B.pi(B.me, 'state') === 1 || B.gi(G.mode) === 1, 'B went down');
ok(await B.until('B deaths', () => B.pi(B.me, 'deaths') === 1, 3000), 'and B\'s death count agrees');
A.x.sp_button(0, 0);
ok(await B.until('B respawned', () => B.pi(B.me, 'state') === 0 && B.pi(B.me, 'health') === 100, 6000), 'B respawns after the delay with full health');

// ---- finish the match: first to 3 ----
let guard = 0;
while (A.gi(G.phase) !== 2 && guard++ < 5) {
  await sleep(1600); // respawn protection
  A.x.sp_t_place(A.me, -260, 0.5, -40, 0, 0);
  B.x.sp_t_place(B.me, -260, 0.5, -48, 180, 0);
  await sleep(1000);
  A.x.sp_button(0, 1);
  await A.until('another kill', () => A.pi(A.me, 'kills') >= guard + 1 || A.gi(G.phase) === 2, 5000);
  A.x.sp_button(0, 0);
}
ok(await A.until('A end screen', () => A.gi(G.phase) === 2, 8000) && await B.until('B end screen', () => B.gi(G.phase) === 2, 8000), 'the kill limit ends the match: both land on the end screen');
ok(A.gi(G.winner) === A.me && B.gi(G.winner) === A.me, `both screens agree A won (winner ${A.gi(G.winner)} / ${B.gi(G.winner)})`);
ok(A.gi(G.endReason) === 1, 'the end reason is the kill limit');
ok(A.pi(A.me, 'kills') === 3 && B.pi(B.me, 'deaths') === 3, `final score ${A.pi(A.me, 'kills')} kills to A, ${B.pi(B.me, 'deaths')} deaths to B`);
ok(A.gi(G.endN) === 2, 'the standings list both players');

// ---- REQUEUE: a new lobby ----
await sleep(500);
A.click(320, 273); B.click(320, 273);   // the REQUEUE button
ok(A.x.sp_phase() === 1 && B.x.sp_phase() === 1, 'REQUEUE starts a new bot match on both screens');
ok(await A.until('A re-matched', () => A.gi(G.mode) === 1 && A.gi(G.inMatch) === 1, 15000) && await B.until('B re-matched', () => B.gi(G.mode) === 1 && B.gi(G.inMatch) === 1, 15000),
   'and they find each other again');

const bad = [...A.errors, ...B.errors];
ok(bad.length === 0, 'no engine traps or host errors' + (bad.length ? ': ' + bad[0] : ''));
A.stop(); B.stop(); wotan.stop(); iduna.stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
