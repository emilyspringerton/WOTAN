// WOTAN /BRAWLPIT/ -- browser client scaffold. Mirrors WOTAN/GFD/gfd.js's role (host glue the
// wasm module itself can't do: canvas, DOM, input, IDUNA session) but there is no wasm module to
// talk to yet -- BRAWLPIT's core engine (core/*.c) has not been ported to PARENA. See
// BRAWLPIT/docs/BP_WASM_WOTAN_NORTHSTAR.md Phase 0/1/4 for what this stub is ahead of.
//
// What's real right now: the IDUNA-signed-in state (via the shared js/iduna-sso.js session),
// the placeholder stage, and gamepad *detection* (Phase 4) -- polling navigator.getGamepads()
// and logging connect/disconnect, so the input-mapping plumbing exists before there is an engine
// to feed it. No real gamepad was available in this sandbox to verify button-to-action mapping.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var padStatus = $('bp-pad-status');

  // ---- IDUNA session (no sign-in button of our own -- wotan-nav.js owns that) ----
  function session() {
    try { return typeof getIdunaSession === 'function' ? getIdunaSession() : null; } catch (e) { return null; }
  }

  // ---- Phase 4 scaffold: Gamepad API detection + connect/disconnect, no engine to feed yet ----
  var pads = {};
  function padLabel(gp) { return gp.id || ('Gamepad ' + gp.index); }
  function renderPadStatus() {
    if (!padStatus) return;
    var ids = Object.keys(pads);
    padStatus.textContent = ids.length
      ? ('Controller detected: ' + ids.map(function (i) { return pads[i]; }).join(', ') + ' (input mapping lands with the core engine port)')
      : '';
  }
  if (window.navigator && typeof navigator.getGamepads === 'function') {
    window.addEventListener('gamepadconnected', function (e) {
      pads[e.gamepad.index] = padLabel(e.gamepad);
      renderPadStatus();
    });
    window.addEventListener('gamepaddisconnected', function (e) {
      delete pads[e.gamepad.index];
      renderPadStatus();
    });
  }

  // Intentionally no rAF polling loop or button->action mapping yet -- there is no wasm input
  // path to feed it into (BRAWLPIT/docs/BP_WASM_WOTAN_NORTHSTAR.md Phase 0 blocks it). The
  // connect/disconnect listeners above are enough to prove gamepad detection works in-browser
  // ahead of that, without inventing a mapping for an engine that doesn't exist yet.

  session(); // touch the shared session so load order errors surface here, not silently later
})();
