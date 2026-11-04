// scripts/trapx-rules-test.mjs -- the browser half of TRAPX VS0, checked without a browser.
//
//   node scripts/trapx-rules-test.mjs            (PARENA_DIR overrides the fixture's repo)
//
// Two jobs, the same two SHANKPIT's packages/simulation/trapx_test.c does from the C:
//   1. PARITY against PARENA/stdlib/trapx/trapx_parity.txt -- the SAME 88 rows, asked of the generated JavaScript.
//   2. BEHAVIOUR of trapx/trapx-city.js, the browser host: the numbers here are hand-derived from the .prn and are
//      the same numbers the C test asserts, so the two hosts cannot drift without one of them going red.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../trapx/trapx-rules.js';
import * as C from '../trapx/trapx-city.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL: ' + msg); } };
const eq = (got, want, msg) => {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL: ${msg} (got ${got} want ${want})`); }
};
// A Bool rule is a C `int` and a TypeScript `boolean`: the fixture says 1/0, so compare in that vocabulary rather
// than weakening either target's own type.
const asInt = (v) => (v === true ? 1 : v === false ? 0 : v);

// ---- 1. parity -------------------------------------------------------------------------------------
const fixture = process.env.TRAPX_PARITY_FILE ||
  path.join(process.env.PARENA_DIR || path.join(root, '..', 'PARENA'), 'stdlib/trapx/trapx_parity.txt');
const answered = {
  0: (a) => R.trapxSceneFos(a),
  1: (a) => R.trapxSceneWatcherDensity(a),
  2: (a) => R.trapxSceneDistrict(a),
  3: (a) => R.trapxPortalTarget(a),
  4: (a) => R.trapxSceneKnown(a),
  5: (a, b, c, d) => R.trapxAlertnessStep(a, b, c, d),
  6: (a, b, c) => R.trapxTrustStep(a, b, c),
  7: (a, b, c) => R.trapxEnforcementLevel(a, b, c),
  8: (a, b) => R.trapxMediaPress(a, b),
  9: (a, b, c) => R.trapxHeatStep(a, b, c),
  10: (a, b) => R.trapxClaimCost(a, b),
  11: (a, b) => R.trapxFlowPerTick(a, b),
  12: (a, b, c) => R.trapxPressurePerTick(a, b, c),
  13: (a, b) => R.trapxAttentionStep(a, b),
  14: (a) => R.trapxK9Worth(a),
  15: (a) => R.trapxContestWindowMs(a),
  16: (a, b, c) => R.trapxIntegrityDecay(a, b, c),
  17: (a, b, c) => R.trapxRogueSwarm(a, b, c),
  18: (a, b, c) => R.trapxReceiptDigest(a, b, c),
  19: (a) => R.trapxReceiptKnown(a),
  20: (a) => R.trapxPublicKillHeat(a),
  21: (a) => R.trapxPublicKillTrust(a),
};

if (!fs.existsSync(fixture)) {
  console.log('FAIL: cannot open ' + fixture + ' (set PARENA_DIR or TRAPX_PARITY_FILE)');
  process.exit(1);
}
let rows = 0;
for (const raw of fs.readFileSync(fixture, 'utf8').split('\n')) {
  const m = raw.match(/^\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*\|\s*(-?\d+)\s*$/);
  if (!m) continue;
  const [q, a, b, c, d, want] = m.slice(1).map(Number);
  const fn = answered[q];
  if (!fn) { ok(false, 'parity row names an unknown question ' + q); continue; }
  rows++;
  eq(asInt(fn(a, b, c, d)), want, `parity row ${rows} (q=${q} ${a},${b},${c},${d})`);
}
ok(rows >= 24, 'read at least 24 parity rows, got ' + rows);

// ---- 2. behaviour: the same numbers trapx_test.c asserts ---------------------------------------------
// Jiangshi territory notices faster.
const a = C.initCity(C.APARTMENT);
const b = C.initCity(C.SCHOOL);
for (let i = 0; i < 5; i++) { C.tick(a, 0); C.tick(b, 0); }
eq(C.district(a, C.APARTMENT).alertness, 45, 'five Apartment ticks are +9 each');
eq(C.district(b, C.SCHOOL).alertness, 20, 'the custody zone is +4 a tick');
ok(C.district(a, C.APARTMENT).alertness > C.district(b, C.SCHOOL).alertness,
  'the Apartment notices faster than the School');

const q = C.initCity(C.APARTMENT);
C.tick(q, 1);
eq(C.district(q, C.APARTMENT).alertness, 3, 'a quiet tick is 3');

// claiming: cost, refusal, the bank
const c = C.initCity(C.APARTMENT);
eq(c.flow, C.START_FLOW, 'a city starts with 100 Flow');
eq(C.claim(c, C.SCHOOL), C.ERR_NOT_HERE, 'you cannot claim where you are not');
eq(C.claim(c, C.APARTMENT), C.OK, 'the first Apartment office is claimable');
eq(c.flow, 60, 'and costs 40');
eq(C.claim(c, C.APARTMENT), C.OK, 'the second is claimable');
eq(c.flow, 0, 'at 40 then 60');
eq(C.claim(c, C.APARTMENT), C.ERR_FULL, 'the third is refused: the scene holds two');

const s = C.initCity(C.SCHOOL);
eq(C.claim(s, C.SCHOOL), C.OK, 'the School office is claimable');
eq(s.flow, 10, 'at the custody premium: 90');
eq(C.claim(s, C.SCHOOL), C.ERR_FULL, 'the School holds exactly one');

const poor = C.initCity(C.APARTMENT);
poor.flow = 39;
eq(C.claim(poor, C.APARTMENT), C.ERR_POOR, '39 Flow cannot buy a 40 office');

// the portal, and one shared memory
const m = C.initCity(C.APARTMENT);
for (let i = 0; i < 3; i++) C.tick(m, 0);
eq(C.district(m, C.APARTMENT).alertness, 27, 'three ticks in the Apartment');
eq(C.portal(m, C.SCHOOL), C.OK, 'the portal to the School is open');
C.tick(m, 0);
eq(C.portal(m, C.APARTMENT), C.OK, 'and back');
eq(C.district(m, C.APARTMENT).alertness, 36, 'the Apartment kept counting while you were away');
eq(C.portal(m, C.APARTMENT), C.ERR_NO_PORTAL, 'no portal from a scene to itself');
eq(C.portal(m, 204), C.ERR_SCENE, 'and none to a district VS0 does not have');

// receipts: one feed, deterministic chain
const r1 = C.initCity(C.APARTMENT);
const r2 = C.initCity(C.APARTMENT);
C.tick(r1, 0); C.tick(r2, 0);
C.claim(r1, C.APARTMENT); C.claim(r2, C.APARTMENT);
eq(r1.receipts, 1, 'a claim writes one receipt');
C.portal(r1, C.SCHOOL); C.portal(r2, C.SCHOOL);
C.publicKill(r1, C.SCHOOL, 3); C.publicKill(r2, C.SCHOOL, 3);
eq(r1.receipts, 2, "the School's receipt lands in the same feed");
eq(r1.ledger, r2.ledger, 'the same actions chain to the same ledger');

// BIG_O's half
const k = C.initCity(C.APARTMENT);
const trust0 = C.district(k, C.APARTMENT).trust;
eq(C.publicKill(k, C.APARTMENT, 5), C.OK, 'a killing with five witnesses');
eq(C.district(k, C.APARTMENT).heat, 28, 'adds 8 + 4 a witness');
eq(C.district(k, C.APARTMENT).trust, trust0 - 34, 'and costs 4 + 6 a witness of trust');
ok(C.district(k, C.APARTMENT).enforcement >= 1, 'the city reacted before the next tick');
eq(C.publicKill(k, C.APARTMENT, -1), C.ERR_ARG, 'a negative witness count is refused');

// K9
eq(R.trapxK9Worth(0), 1000, 'the first unit is worth 1000');
eq(R.trapxK9Worth(2), 722, 'the third 722');
eq(R.trapxAttentionStep(10, 0), 6, 'with no dogs out, Attention decays by 4');
const d = C.initCity(C.APARTMENT);
C.claim(d, C.APARTMENT);
eq(C.deployK9(d, C.APARTMENT, 2), C.OK, 'two dogs on the street');
eq(C.district(d, C.APARTMENT).attention, 14, 'raise Attention by 7 a unit');
eq(C.deployK9(d, C.APARTMENT, 6), C.ERR_ARG, 'six units is out of range');

// a beaten office swarms, once
const g = C.initCity(C.APARTMENT);
C.claim(g, C.APARTMENT);
const gd = C.district(g, C.APARTMENT);
gd.integrity = 15; gd.attention = 85; gd.pressure = 70;
C.tick(g, 0);
eq(gd.rogue, 1, 'a beaten office under hard attention and pressure swarms');
eq(g.events.filter((e) => e.kind === C.EV.ROGUE).length, 1, 'and says so once');

// MODS FIRST: masks, priority, enable
const mm = C.initCity(C.APARTMENT);
eq(mm.mods.length, 3, 'VS0 ships three mods');
eq(mm.mods[0].name, 'trapx.ledger', 'the ledger mod is registered by name');
eq(C.deliver(mm, { kind: C.EV.RECEIPT }).length, 1, 'only the ledger wants a receipt');
eq(mm.mods[C.deliver(mm, { kind: C.EV.RECEIPT })[0]].name, 'trapx.ledger', 'and it is the ledger');
eq(C.deliver(mm, { kind: C.EV.ALERT }).length, 1, 'only the watcher wants an alert');
eq(C.deliver(mm, { kind: C.EV.TICK }).length, 0, 'nobody subscribed to ticks');
const extra = C.addMod(mm, 'trapx.audit', [C.EV.RECEIPT], 999);
ok(extra > 0, 'a mod can be added at runtime');
eq(C.deliver(mm, { kind: C.EV.RECEIPT })[0], extra, 'the higher priority runs first');
C.enableMod(mm, extra, 0);
eq(C.deliver(mm, { kind: C.EV.RECEIPT }).length, 1, 'a disabled mod is not delivered to');
eq(C.addMod(mm, 'trapx.audit', [], 0), -1, 'a duplicate name is refused, not overwritten');

// the bus
const ring = C.initCity(C.APARTMENT);
ring.events.length = 0;
for (let i = 0; i < 300; i++) C.pushEvent(ring, C.EV.TICK, C.APARTMENT, i, 0);
eq(ring.events.length, 256, 'the ring holds 256 and no more');
eq(ring.seq, 300, 'but the sequence keeps counting');
eq(ring.events[0].a, 299, 'newest first');
eq(C.pushEvent(ring, C.EV.COUNT, C.APARTMENT, 0, 0), 0, 'an unknown kind is refused');

if (fail > 0) {
  console.log(`trapx-rules-test: ${fail} of ${pass + fail} FAILED`);
  process.exit(1);
}
console.log(`trapx-rules-test OK (${pass} checks, ${rows} parity rows)`);
