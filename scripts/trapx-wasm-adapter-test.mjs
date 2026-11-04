// scripts/trapx-wasm-adapter-test.mjs -- the page's wasm path, driven the way the page drives it.
//
//   node scripts/trapx-wasm-adapter-test.mjs [trapx.wasm] [PARENA_DIR]
//
// PARENA's scripts/trapx_wasm_test.mjs already proves the MODULE computes the right city. This proves the
// other half: that trapx/trapx-wasm-city.js -- the adapter the page now imports -- exposes the same API and
// the same numbers as trapx/trapx-city.js, so the switch cannot quietly change what a button does.
//
// It is a browser-free test on purpose: no DOM, no canvas, no Chromium. What it cannot tell you is whether
// the page *looks* right; it can tell you that every verb, every field and every event agrees.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(process.argv[2] || path.join(here, '..', 'trapx', 'trapx.wasm'));
const parenaDir = path.resolve(process.argv[3] || path.join(here, '..', '..', 'PARENA'));

let pass = 0, fail = 0;
const eq = (got, want, m) => { if (got === want) pass++; else { fail++; console.log(`FAIL: ${m} (got ${got} want ${want})`); } };
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };

if (!fs.existsSync(wasmPath)) {
  console.log(`FAIL: no wasm at ${wasmPath}`);
  process.exit(1);
}

const W = await import(pathToFileURL(path.join(here, '..', 'trapx', 'trapx-wasm-city.js')).href);
await W.ready(fs.readFileSync(wasmPath));            // bytes in, so no fetch and no server
const J = await import(pathToFileURL(path.join(here, '..', 'trapx', 'trapx-city.js')).href);
// the portal graph is a RULE (PARENA/stdlib/trapx/trapx_rules.prn), so the test asks the rules module rather
// than hard-coding 200 <-> 201 and quietly blessing a second copy of the graph.
const R = await import(pathToFileURL(path.join(here, '..', 'trapx', 'trapx-rules.js')).href);

// the same constants, or the page's reason strings would fall through to "error N"
for (const k of ['OK', 'ERR_SCENE', 'ERR_NOT_HERE', 'ERR_FULL', 'ERR_POOR', 'ERR_NONE_HELD', 'ERR_NO_PORTAL', 'ERR_ARG', 'APARTMENT', 'SCHOOL']) {
  eq(W[k], J[k], `constant ${k}`);
}
eq(JSON.stringify(W.EV), JSON.stringify(J.EV), 'EV kinds');
eq(JSON.stringify(W.EV_NAMES), JSON.stringify(J.EV_NAMES), 'EV_NAMES');

// a script that uses every verb the page's buttons use, plus ticks and a portal
const script = [
  ['tick', 0], ['claim'], ['tick', 1], ['claim'], ['claim'],
  ['k9', 2], ['contest'], ['kill', 3],
  ['portal'], ['claim'], ['tick', 0], ['kill', 1],
  ['portal'], ['tick', 1], ['k9', 0], ['contest'],
];
const wc = W.initCity(W.APARTMENT);
const jc = J.initCity(J.APARTMENT);
const fields = ['scene', 'alertness', 'trust', 'heat', 'enforcement', 'fos_total', 'fos_held', 'attention', 'integrity', 'pressure', 'k9', 'kills', 'clean_receipts', 'dirty_receipts', 'rogue'];

for (const [i, [op, arg]] of script.entries()) {
  let w, j;
  if (op === 'tick') { w = W.tick(wc, arg); j = J.tick(jc, arg); }
  else if (op === 'claim') { w = W.claim(wc, wc.scene); j = J.claim(jc, jc.scene); }
  else if (op === 'contest') { w = W.contest(wc, wc.scene); j = J.contest(jc, jc.scene); }
  else if (op === 'k9') { w = W.deployK9(wc, wc.scene, arg); j = J.deployK9(jc, jc.scene, arg); }
  else if (op === 'kill') { w = W.publicKill(wc, wc.scene, arg); j = J.publicKill(jc, jc.scene, arg); }
  else if (op === 'portal') { w = W.portal(wc, R.trapxPortalTarget(wc.scene)); j = J.portal(jc, R.trapxPortalTarget(jc.scene)); }
  eq(w, j, `step ${i} (${op}) return code`);

  eq(wc.scene, jc.scene, `step ${i} (${op}) scene`);
  eq(wc.tick, jc.tick, `step ${i} (${op}) tick`);
  eq(wc.flow, jc.flow, `step ${i} (${op}) flow`);
  eq(wc.receipts, jc.receipts, `step ${i} (${op}) receipts`);
  eq(wc.ledger, jc.ledger % 1000000007, `step ${i} (${op}) ledger`);
  for (const scene of [200, 201]) {
    const wd = W.district(wc, scene), jd = J.district(jc, scene);
    for (const f of fields) eq(wd[f], jd[f], `step ${i} (${op}) ${scene} ${f}`);
  }
  const we = wc.events, je = jc.events;
  eq(we.length, je.length, `step ${i} (${op}) event count`);
  for (let k = 0; k < Math.min(we.length, 12); k++) {
    eq(we[k].kind, je[k].kind, `step ${i} (${op}) event ${k} kind`);
    eq(we[k].tick, je[k].tick, `step ${i} (${op}) event ${k} tick`);
  }
  eq(JSON.stringify(wc.mods.map((m) => [m.name, m.mask, m.priority, m.enabled])),
     JSON.stringify(jc.mods.map((m) => [m.name, m.mask, m.priority, m.enabled])),
     `step ${i} (${op}) mods`);
}

// the page reads d.alertness etc. as LIVE values: a getter frozen at construction would break every readout
const live = W.initCity(W.APARTMENT);
const before = W.here(live).alertness;
W.tick(live, 0);
ok(W.here(live).alertness > before, 'district getters read live state, not a snapshot');

// and the fallback path still exists and is what loads when the wasm is missing
ok(fs.existsSync(path.join(here, '..', 'trapx', 'trapx-city.js')), 'the JS city is still present as the fallback');
ok(fs.existsSync(path.join(here, '..', 'trapx', 'trapx-engine.js')), 'the chooser module is present');

if (fail > 0) {
  console.log(`trapx-wasm-adapter-test: ${fail} of ${pass + fail} FAILED`);
  process.exit(1);
}
console.log(`trapx-wasm-adapter-test OK (${pass} checks, ${script.length} scripted page commands)`);
