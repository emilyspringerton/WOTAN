// trapx/trapx-city.js -- the TRAPX VS0 host for the browser: state, clock, bank, bus.
//
// The same split as SHANKPIT's C host (packages/simulation/trapx.c): every threshold, cost, level and digest is a
// call into trapx-rules.js, which is generated from PARENA/stdlib/trapx/trapx_rules.prn. What lives here is only
// what a host must hold -- the districts, the tick, the Flow bank, the receipt ledger and the mod delivery pass.
//
// It is a SEPARATE file from the page on purpose: no DOM, no window, so scripts/trapx-rules-test.mjs runs the whole
// city loop under Node and pins it to the numbers trapx_test.c asserts from the C. Two hosts, one rule set, and a
// test that notices the day they disagree.
import * as R from './trapx-rules.js';

export const APARTMENT = 200;
export const SCHOOL = 201;
export const SCENES = [APARTMENT, SCHOOL];

export const START_FLOW = 100;
export const LEDGER_MOD = 1000000007;

export const OK = 0;
export const ERR_SCENE = 1;
export const ERR_NOT_HERE = 2;
export const ERR_FULL = 3;
export const ERR_POOR = 4;
export const ERR_NONE_HELD = 5;
export const ERR_NO_PORTAL = 6;
export const ERR_ARG = 7;

export const ACTION_NONE = 0;
export const ACTION_CLAIM = 1;
export const ACTION_CONTEST = 2;
export const ACTION_DEPLOY_K9 = 3;
export const ACTION_RECEIPT = 4;

export const RECEIPT_CLAIM = 0;
export const RECEIPT_FLOW = 1;
export const RECEIPT_CONTEST = 2;
export const RECEIPT_K9 = 3;
export const RECEIPT_WITNESS = 4;

export const EV = {
  TICK: 0, CLAIM: 1, CONTEST: 2, K9: 3, ALERT: 4, ENFORCE: 5, RECEIPT: 6, KILL: 7, ROGUE: 8, PORTAL: 9, COUNT: 10,
};
export const EV_NAMES = ['tick', 'claim', 'contest', 'k9', 'alert', 'enforce', 'receipt', 'kill', 'rogue', 'portal'];
export const MOD_CAP = 8;
const EVENT_CAP = 256;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const band = (alertness) => Math.trunc(alertness / 25);

export function initCity(scene) {
  const city = {
    districts: SCENES.map((s) => ({
      scene: s,
      alertness: 0,
      trust: 0,
      heat: 0,
      enforcement: 0,
      fos_total: R.trapxSceneFos(s),
      fos_held: 0,
      attention: 0,
      integrity: 100,
      pressure: 0,
      k9: 0,
      kills: 0,
      clean_receipts: 0,
      dirty_receipts: 0,
      rogue: 0,
    })),
    scene: R.trapxSceneKnown(scene) ? scene : APARTMENT,
    tick: 0,
    flow: START_FLOW,
    receipts: 0,
    ledger: 0,
    events: [],
    seq: 0,
    mods: [],
  };
  // The three mods VS0 ships, by name -- the same three the C host registers.
  addMod(city, 'trapx.ledger', [EV.RECEIPT], 100);
  addMod(city, 'trapx.watcher', [EV.ALERT, EV.ENFORCE], 50);
  addMod(city, 'trapx.k9', [EV.K9, EV.ROGUE], 20);
  return city;
}

export function index(city, scene) {
  return city.districts.findIndex((d) => d.scene === scene);
}

export function district(city, scene) {
  const i = index(city, scene);
  return i < 0 ? null : city.districts[i];
}

export function here(city) {
  return district(city, city.scene);
}

export function enforcement(city, scene) {
  const d = district(city, scene);
  return d ? d.enforcement : 0;
}

// ---- the bus --------------------------------------------------------------------------------------
export function pushEvent(city, kind, scene, a, b) {
  if (!Number.isInteger(kind) || kind < 0 || kind >= EV.COUNT) return 0;
  city.events.unshift({ kind, tick: city.tick, scene, a, b });
  if (city.events.length > EVENT_CAP) city.events.pop();
  city.seq += 1;
  return city.seq;
}

export function addMod(city, name, kinds, priority) {
  if (!name || city.mods.length >= MOD_CAP) return -1;
  if (city.mods.some((m) => m.name === name)) return -1;
  const mask = kinds.reduce((m, k) => m | (1 << k), 0);
  city.mods.push({ name, mask, priority, enabled: 1 });
  return city.mods.length - 1;
}

export function enableMod(city, at, on) {
  if (at < 0 || at >= city.mods.length) return 0;
  city.mods[at].enabled = on ? 1 : 0;
  return 1;
}

export function modWants(city, at, kind) {
  const m = city.mods[at];
  if (!m || !m.enabled || kind < 0 || kind >= EV.COUNT) return 0;
  return (m.mask >> kind) & 1;
}

// Highest priority first, ties on registration order -- the same contract as trapx_mods_deliver.
export function deliver(city, ev) {
  const out = [];
  const used = new Set();
  while (out.length < MOD_CAP) {
    let best = -1;
    for (let i = 0; i < city.mods.length; i++) {
      if (used.has(i) || !modWants(city, i, ev.kind)) continue;
      if (best < 0 || city.mods[i].priority > city.mods[best].priority) best = i;
    }
    if (best < 0) break;
    used.add(best);
    out.push(best);
  }
  return out;
}

export function announce(city, kind, scene, a, b) {
  pushEvent(city, kind, scene, a, b);
  return deliver(city, city.events[0]);
}

// ---- receipts --------------------------------------------------------------------------------------
export function receipt(city, scene, kind, amount) {
  if (!R.trapxReceiptKnown(kind)) return -1;
  if (index(city, scene) < 0) return -1;
  const digest = R.trapxReceiptDigest(kind, amount, city.tick);
  city.ledger = (city.ledger + digest) % LEDGER_MOD;
  city.receipts += 1;
  const d = district(city, scene);
  if (kind === RECEIPT_K9 || kind === RECEIPT_WITNESS) d.dirty_receipts += 1;
  else d.clean_receipts += 1;
  announce(city, EV.RECEIPT, scene, kind, amount);
  return digest;
}

// ---- the tick ---------------------------------------------------------------------------------------
export function tick(city, quiet) {
  city.tick += 1;
  for (const d of city.districts) {
    const density = R.trapxSceneWatcherDensity(d.scene);
    const beforeBand = band(d.alertness);
    const beforeLevel = d.enforcement;

    d.alertness = R.trapxAlertnessStep(d.alertness, density, d.heat, quiet ? 1 : 0);
    d.heat = R.trapxHeatStep(d.heat, ACTION_NONE, d.enforcement);
    d.enforcement = R.trapxEnforcementLevel(d.alertness, d.trust, d.heat);

    if (d.fos_held > 0) {
      d.pressure = clamp(d.pressure + R.trapxPressurePerTick(d.attention, d.enforcement, d.fos_held) - 2, 0, 100);
      d.attention = R.trapxAttentionStep(d.attention, d.k9);
      d.integrity = R.trapxIntegrityDecay(d.integrity, d.attention, d.k9);
    }

    if (band(d.alertness) !== beforeBand) announce(city, EV.ALERT, d.scene, d.alertness, beforeBand * 25);
    if (d.enforcement !== beforeLevel) announce(city, EV.ENFORCE, d.scene, d.enforcement, beforeLevel);
    if (!d.rogue && d.fos_held > 0 && R.trapxRogueSwarm(d.integrity, d.attention, d.pressure)) {
      d.rogue = 1;
      announce(city, EV.ROGUE, d.scene, d.integrity, d.attention);
      receipt(city, d.scene, RECEIPT_WITNESS, 0);
    }
  }
  const i = index(city, city.scene);
  return i < 0 ? 0 : city.districts[i].enforcement;
}

// ---- the verbs --------------------------------------------------------------------------------------
export function claim(city, scene) {
  if (!R.trapxSceneKnown(scene)) return ERR_SCENE;
  if (city.scene !== scene) return ERR_NOT_HERE;
  const d = district(city, scene);
  if (!d) return ERR_SCENE;
  if (d.fos_held >= d.fos_total) return ERR_FULL;
  const cost = R.trapxClaimCost(scene, d.fos_held);
  if (city.flow < cost) return ERR_POOR;

  city.flow -= cost;
  d.fos_held += 1;
  if (d.fos_held === 1) {
    d.integrity = 100;
    d.attention = 0;
    d.pressure = 0;
  }
  announce(city, EV.CLAIM, scene, scene, cost);
  receipt(city, scene, RECEIPT_CLAIM, cost);
  return OK;
}

export function contest(city, scene) {
  if (!R.trapxSceneKnown(scene)) return ERR_SCENE;
  if (city.scene !== scene) return ERR_NOT_HERE;
  const d = district(city, scene);
  if (!d) return ERR_SCENE;
  if (d.fos_held <= 0) return ERR_NONE_HELD;

  d.pressure = clamp(d.pressure + 15, 0, 100);
  d.heat = R.trapxHeatStep(d.heat, ACTION_CONTEST, d.enforcement);
  announce(city, EV.CONTEST, scene, scene, d.pressure);
  receipt(city, scene, RECEIPT_CONTEST, 0);
  return OK;
}

export function deployK9(city, scene, units) {
  if (!R.trapxSceneKnown(scene)) return ERR_SCENE;
  if (city.scene !== scene) return ERR_NOT_HERE;
  if (!Number.isInteger(units) || units < 0 || units > 5) return ERR_ARG;
  const d = district(city, scene);
  if (!d) return ERR_SCENE;

  d.k9 = units;
  d.heat = R.trapxHeatStep(d.heat, ACTION_DEPLOY_K9, d.enforcement);
  d.attention = R.trapxAttentionStep(d.attention, units);
  announce(city, EV.K9, scene, scene, units);
  receipt(city, scene, RECEIPT_K9, R.trapxK9Worth(units));
  return OK;
}

export function publicKill(city, scene, witnesses) {
  if (!R.trapxSceneKnown(scene)) return ERR_SCENE;
  if (!Number.isInteger(witnesses) || witnesses < 0) return ERR_ARG;
  const d = district(city, scene);
  if (!d) return ERR_SCENE;

  d.heat = clamp(d.heat + R.trapxPublicKillHeat(witnesses), 0, 100);
  d.trust = clamp(d.trust + R.trapxPublicKillTrust(witnesses), -100, 100);
  d.kills += 1;
  d.enforcement = R.trapxEnforcementLevel(d.alertness, d.trust, d.heat);
  announce(city, EV.KILL, scene, witnesses, R.trapxPublicKillHeat(witnesses));
  receipt(city, scene, RECEIPT_WITNESS, witnesses);
  return OK;
}

export function portal(city, toScene) {
  if (!R.trapxSceneKnown(toScene)) return ERR_SCENE;
  if (R.trapxPortalTarget(city.scene) !== toScene) return ERR_NO_PORTAL;
  const from = city.scene;
  city.scene = toScene;
  announce(city, EV.PORTAL, toScene, from, toScene);
  return OK;
}
