// trapx/trapx-engine.js -- pick the city: trapx.wasm if it loads, trapx-city.js if it does not.
//
// The page imports this instead of either implementation, so the verb buttons, the readouts and the feed are
// written once. Reasons the wasm can lose: an old cached page, a browser without WebAssembly streaming, a
// proxy that mangles application/wasm, or the module simply not having been deployed yet. None of those
// should leave a visitor with a dead control panel, so the JS city -- which the page shipped before -- stays
// as the fallback rather than being deleted.
//
// `source` is exported for the footer/test to report which engine a session actually ran.

let impl;
export let source;

try {
  const wasmCity = await import('./trapx-wasm-city.js');
  await wasmCity.ready();               // fetches trapx.wasm next to this file
  impl = wasmCity;
  source = 'wasm';
} catch (err) {
  console.warn('trapx: the wasm city did not load, falling back to trapx-city.js —', err && err.message ? err.message : err);
  impl = await import('./trapx-city.js');
  source = 'js';
}

export default impl;
