// trapx/trapx-wasm-city.js -- the city, running out of trapx.wasm instead of JavaScript.
//
// Same API as trapx-city.js (initCity / tick / claim / contest / deployK9 / publicKill / portal / here /
// district, the ERR_* codes, EV and EV_NAMES) so the page does not know which one it got. The difference is
// where the state lives: districts, Flow, the receipt ledger, the 256-event ring and the mods are words at
// fixed addresses inside a 10 KB wasm module with zero imports, built from PARENA by
// PARENA/scripts/build_trapx_wasm.sh.
//
// Nothing here decides a rule. Every number is trapx_rules.prn's, compiled into the module -- this file only
// reads words and calls the verbs, which is the same job trapx-host.js does against the JS city.
//
// It is deliberately NOT a rewrite of the page's DOM code: if this module fails to load, trapx-engine.js falls
// back to trapx-city.js and the page keeps working, which is why the fallback is a separate file.

export const APARTMENT = 200;
export const SCHOOL = 201;
export const SCENES = [APARTMENT, SCHOOL];

export const OK = 0;
export const ERR_SCENE = 1;
export const ERR_NOT_HERE = 2;
export const ERR_FULL = 3;
export const ERR_POOR = 4;
export const ERR_NONE_HELD = 5;
export const ERR_NO_PORTAL = 6;
export const ERR_ARG = 7;

// COUNT is the JS city's sentinel for "not an event" and the module enforces the same bound (kind < 10);
// carried here so an API comparison of EV is exact rather than "equal except the field nobody uses yet".
export const EV = {
  TICK: 0, CLAIM: 1, CONTEST: 2, K9: 3, ALERT: 4, ENFORCE: 5, RECEIPT: 6, KILL: 7, ROGUE: 8, PORTAL: 9, COUNT: 10,
};
export const EV_NAMES = ['tick', 'claim', 'contest', 'k9', 'alert', 'enforce', 'receipt', 'kill', 'rogue', 'portal'];

// the module's word indexes (PARENA/stdlib/trapx/web/tp_mem.prn)
const G = { tick: 0, flow: 1, scene: 2, receipts: 3, ledger: 4, seq: 5, head: 6, mods: 7 };
const D = {
  scene: 0, alertness: 1, trust: 2, heat: 3, enforcement: 4, fos_total: 5, fos_held: 6,
  attention: 7, integrity: 8, pressure: 9, k9: 10, kills: 11, clean_receipts: 12,
  dirty_receipts: 13, rogue: 14,
};
const MOD_NAME = { 1: 'trapx.ledger', 2: 'trapx.watcher', 3: 'trapx.k9' };

let W = null;
let loadedFrom = null;

// ready() takes nothing (fetch trapx.wasm beside this file), a URL, or the module's bytes -- the last form is
// what lets the Node test drive this exact code with no browser and no server.
export async function ready(src = 'trapx.wasm') {
  if (W) return true;
  const bytes = src instanceof Uint8Array || src instanceof ArrayBuffer ? src : null;
  if (bytes) {
    // The buffer form answers { module, instance }; the streaming form answers an Instance. Assuming the
    // same shape for both is how the Node test read exports off an object that has none.
    const out = await WebAssembly.instantiate(bytes, {});
    W = out.instance ? out.instance.exports : out.exports;
    loadedFrom = 'bytes';
  } else {
    const res = await fetch(src, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`trapx.wasm: HTTP ${res.status}`);
    const out = await WebAssembly.instantiateStreaming(res, {});
    W = out.instance ? out.instance.exports : out.exports;
    loadedFrom = src;
  }
  if (!W || !W.tp_init) throw new Error('trapx.wasm: module has no tp_init export');
  return true;
}

export function where() { return loadedFrom; }

class District {
  constructor(scene) { this._scene = scene; }
  get scene() { return this._scene; }
  get alertness() { return W.tp_di(this._scene, D.alertness); }
  get trust() { return W.tp_di(this._scene, D.trust); }
  get heat() { return W.tp_di(this._scene, D.heat); }
  get enforcement() { return W.tp_di(this._scene, D.enforcement); }
  get fos_total() { return W.tp_di(this._scene, D.fos_total); }
  get fos_held() { return W.tp_di(this._scene, D.fos_held); }
  get attention() { return W.tp_di(this._scene, D.attention); }
  get integrity() { return W.tp_di(this._scene, D.integrity); }
  get pressure() { return W.tp_di(this._scene, D.pressure); }
  get k9() { return W.tp_di(this._scene, D.k9); }
  get kills() { return W.tp_di(this._scene, D.kills); }
  get clean_receipts() { return W.tp_di(this._scene, D.clean_receipts); }
  get dirty_receipts() { return W.tp_di(this._scene, D.dirty_receipts); }
  get rogue() { return W.tp_di(this._scene, D.rogue); }
}

class City {
  constructor() {
    W.tp_init();
    this.status = '';   // the page's own line of prose, exactly as the JS city carried it
    this._districts = SCENES.map((s) => new District(s));
  }
  get scene() { return W.tp_g(G.scene); }
  get tick() { return W.tp_g(G.tick); }
  get flow() { return W.tp_g(G.flow); }
  get receipts() { return W.tp_g(G.receipts); }
  get ledger() { return W.tp_g(G.ledger); }
  get seq() { return W.tp_g(G.seq); }
  get mods() {
    const out = [];
    const n = W.tp_mods();
    for (let i = 0; i < n; i++) {
      out.push({
        name: MOD_NAME[W.tp_mi(i, 0)] || 'mod.' + W.tp_mi(i, 0),
        mask: W.tp_mi(i, 1),
        priority: W.tp_mi(i, 2),
        enabled: W.tp_mi(i, 3),
      });
    }
    return out;
  }
  // newest first, exactly like the JS city's array after unshift
  get events() {
    const out = [];
    const n = W.tp_ev_count();
    for (let i = 0; i < n; i++) {
      out.push({ kind: W.tp_ev(i, 0), tick: W.tp_ev(i, 1), scene: W.tp_ev(i, 2), a: W.tp_ev(i, 3), b: W.tp_ev(i, 4) });
    }
    return out;
  }
}

export function initCity(scene) {
  const city = new City();
  return city;   // the module always starts in the Apartment, same as trapx-city.js
}

export function district(city, scene) {
  return city._districts.find((d) => d.scene === scene) || null;
}
export function here(city) { return district(city, city.scene); }

export function tick(city, quiet) { return W.tp_tick(quiet ? 1 : 0); }
export function claim(city, scene) { return W.tp_claim(scene); }
export function contest(city, scene) { return W.tp_contest(scene); }
export function deployK9(city, scene, units) { return W.tp_k9(scene, units); }
export function publicKill(city, scene, witnesses) { return W.tp_kill(scene, witnesses); }
export function portal(city, toScene) { return W.tp_portal(toScene); }
export function receipt(city, scene, kind, amount) { return W.tp_receipt(scene, kind, amount); }
// Highest priority first, ties on registration order -- the same contract as the JS city's deliver().
export function deliver(city, ev) {
  const out = [];
  for (let rank = 0; rank < 8; rank++) {
    const at = W.tp_deliver(ev.kind, rank);
    if (at < 0) break;
    out.push(at);
  }
  return out;
}
export function addMod(city, name, kinds, priority) {
  const id = Object.keys(MOD_NAME).find((k) => MOD_NAME[k] === name);
  const mask = kinds.reduce((m, k) => m | (1 << k), 0);
  return W.tp_mod_add(id ? Number(id) : 99, mask, priority);
}
export function enableMod(city, at, on) { return W.tp_mod_enable(at, on ? 1 : 0); }
