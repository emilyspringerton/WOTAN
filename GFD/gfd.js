// WOTAN /GFD/ -- browser client for the GoblinFoxDragon MUD.
//
// The terminal itself (UTF-8/ANSI parser, scrollback, selection, history, key -> byte mapping and
// the software renderer) is PARENA, compiled to wasm: PARENA/stdlib/gfd/term.prn -> term.wasm.
// This file is only the host glue the wasm cannot do: the WebSocket, the IDUNA sign-in state, DOM
// events, canvas blitting, the clipboard, and the accessibility transcript.
//
// Wire protocol (GoblinFoxDragon/apps2/mud/ws_listener.go): the first client frame is
// {"token":"<IDUNA SSO JWT>"}; after that every frame is a chunk of the MUD's raw byte stream in
// each direction, exactly what telnet/SSH carry. The server echoes typed input (like an SSH PTY),
// so the client never echoes locally. Close code 4401 means the token was refused.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('term'), stage = $('stage'), veil = $('veil'), veilCard = $('veil-card');
  var input = $('gfd-input'), pill = $('gfd-pill'), pillText = $('gfd-pill-text'), srLog = $('gfd-sr');
  var ctx = canvas.getContext('2d', { alpha: false });
  var COLS = 100, ROWS = 34, FBW = 800, FBH = 544;

  var KEY = { ENTER: 1114113, BACKSPACE: 1114114, UP: 1114115, DOWN: 1114116, PGUP: 1114117, PGDN: 1114118, TAB: 1114119, ESC: 1114120 };

  var x = null;               // wasm exports
  var ws = null;
  var wsLive = false;         // received data on this socket
  var openedAt = 0;
  var intentionalClose = false;
  var retry = 0, retryTimer = 0;
  var focused = false, blinkPhase = 1;
  var zoomLevels = ['fit', 1, 2, 3], zoomIdx = 0;
  var off = document.createElement('canvas'); off.width = FBW; off.height = FBH;
  var offCtx = off.getContext('2d', { alpha: false });
  var decoder = new TextDecoder('utf-8');
  var encoder = new TextEncoder();

  // ---- small UI helpers --------------------------------------------------------------------
  function setState(state, text) { pill.setAttribute('data-state', state); pillText.textContent = text; }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'text') n.textContent = attrs[k]; else if (attrs[k] !== null && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]); }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  // Overlay card. acts: [{label, primary, onclick}] and optional extra DOM nodes.
  function showVeil(title, body, acts, extra) {
    veilCard.textContent = '';
    veilCard.appendChild(el('h2', { text: title }));
    if (body) veilCard.appendChild(el('p', { text: body }));
    if (extra) veilCard.appendChild(extra);
    if (acts && acts.length) {
      var row = el('div', { 'class': 'acts' });
      acts.forEach(function (a) {
        var b = el('button', { type: 'button', 'class': 'gfd-btn' + (a.primary ? ' primary' : ''), text: a.label });
        b.addEventListener('click', a.onclick);
        row.appendChild(b);
      });
      veilCard.appendChild(row);
    }
    veil.hidden = false;
    var first = veilCard.querySelector('button, a');
    if (first) first.focus({ preventScroll: true });
  }
  function hideVeil() { veil.hidden = true; }

  // Plain-text sign-in anchor (WOTAN rule: only the nav renders a sign-in *button*).
  function signInLink(text) {
    var a = el('a', { href: (window.WotanNav && WotanNav.signInURL) ? WotanNav.signInURL() : 'https://iam.okemily.com/', 'data-signin': '', text: text });
    a.style.cssText = 'font-size:1.05rem;font-weight:600';
    return a;
  }

  function session() { try { return typeof getIdunaSession === 'function' ? getIdunaSession() : null; } catch (e) { return null; } }

  // ---- sizing / painting ------------------------------------------------------------------
  function loadZoom() { try { var v = localStorage.getItem('gfd_zoom'); var i = zoomLevels.indexOf(v === 'fit' ? 'fit' : parseInt(v, 10)); if (i >= 0) zoomIdx = i; } catch (e) { /* storage blocked */ } }
  function saveZoom() { try { localStorage.setItem('gfd_zoom', String(zoomLevels[zoomIdx])); } catch (e) { /* ignore */ } }

  function fit() {
    var dpr = window.devicePixelRatio || 1;
    var full = stage.classList.contains('full');
    var availW = full ? window.innerWidth : stage.parentElement.clientWidth;
    var availH = full ? window.innerHeight : Infinity;
    var z = zoomLevels[zoomIdx], cssW;
    // Fit mode also respects the window height (leave room for nav + toolbar) so the whole terminal
    // is visible without page scrolling; very short windows keep a usable minimum.
    var byHeight = full ? availH * FBW / FBH : Math.max(480, (window.innerHeight - 210) * FBW / FBH);
    if (z === 'fit' || full) cssW = Math.min(availW, byHeight, 1800);
    else cssW = Math.min(FBW * z, availW);
    cssW = Math.max(200, Math.floor(cssW));
    var s = Math.max(1, Math.ceil(cssW * dpr / FBW));
    var integerFit = (z !== 'fit' && !full && cssW === FBW * z);
    if (integerFit) s = Math.max(1, Math.round(z * dpr));
    canvas.width = FBW * s; canvas.height = FBH * s;
    canvas.style.width = cssW + 'px'; canvas.style.height = Math.round(cssW * FBH / FBW) + 'px';
    ctx.imageSmoothingEnabled = !integerFit;
    canvas.style.imageRendering = integerFit ? 'pixelated' : 'auto';
    paint();
  }

  var havePixels = false;
  function paint() {
    if (!x || !havePixels) return;
    var img = new ImageData(new Uint8ClampedArray(x.memory.buffer, x.term_fb_addr(), FBW * FBH * 4), FBW, FBH);
    offCtx.putImageData(img, 0, 0);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  function frame() {
    if (x && !document.hidden && x.term_render() === 1) { havePixels = true; paint(); }
    requestAnimationFrame(frame);
  }

  // ---- bytes between wasm and socket -------------------------------------------------------
  var srPending = '';
  function feedServer(buf) {
    var bytes = new Uint8Array(buf), inAddr = x.term_in_addr(), CH = 65536;
    for (var o = 0; o < bytes.length; o += CH) {
      var n = Math.min(CH, bytes.length - o);
      new Uint8Array(x.memory.buffer, inAddr, n).set(bytes.subarray(o, o + n));
      x.term_feed(n);
    }
    srPending += decoder.decode(bytes, { stream: true });
  }

  // Strip control sequences and mirror to the aria-live transcript (batched, last ~40 lines kept).
  var ANSI_RE = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[()][A-Za-z0-9]/g;
  setInterval(function () {
    if (!srPending) return;
    var t = srPending.replace(ANSI_RE, '').replace(/\r/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
    srPending = '';
    if (!t.trim()) return;
    srLog.appendChild(document.createTextNode(t));
    while (srLog.childNodes.length > 40) srLog.removeChild(srLog.firstChild);
  }, 400);

  function sendOut(n) {
    if (n <= 0) return;
    if (!ws || ws.readyState !== 1) { flash('Not connected'); return; }
    ws.send(new Uint8Array(x.memory.buffer, x.term_out_addr(), n).slice());
  }
  function key(code, mods) { return x.term_key(code, mods || 0); }
  function keyAndSend(code, mods) { sendOut(key(code, mods)); }

  // Several keys in one frame (paste, quick commands): copy OUT after each call, send once.
  function sendKeys(codes, mods) {
    var chunks = [], total = 0;
    codes.forEach(function (c) {
      var n = key(c, mods || 0);
      if (n > 0) { var b = new Uint8Array(x.memory.buffer, x.term_out_addr(), n).slice(); chunks.push(b); total += n; }
    });
    if (!total) return;
    if (!ws || ws.readyState !== 1) { flash('Not connected'); return; }
    var all = new Uint8Array(total), p = 0;
    chunks.forEach(function (c) { all.set(c, p); p += c.length; });
    ws.send(all);
  }

  var flashTimer = 0;
  function flash(msg) {
    var prev = pillText.textContent, prevState = pill.getAttribute('data-state');
    pillText.textContent = msg; clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { pillText.textContent = prev; pill.setAttribute('data-state', prevState); }, 1400);
  }

  // ---- connection --------------------------------------------------------------------------
  function wsURL() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/GFD/ws'; }

  function connect() {
    clearTimeout(retryTimer);
    var s = session();
    if (!s) {
      setState('down', 'Signed out');
      showVeil('Sign in to play', 'GoblinFoxDragon uses your IDUNA account. There is no separate password.', null, signInLink('Sign in with IDUNA'));
      return;
    }
    hideVeil();
    setState('wait', retry ? 'Reconnecting' : 'Connecting');
    intentionalClose = false; wsLive = false;
    var sock;
    try { sock = new WebSocket(wsURL()); } catch (e) { scheduleRetry(); return; }
    sock.binaryType = 'arraybuffer';
    ws = sock;
    sock.onopen = function () {
      openedAt = Date.now();
      sock.send(JSON.stringify({ token: s.token }));
    };
    sock.onmessage = function (ev) {
      if (!(ev.data instanceof ArrayBuffer)) return;
      if (!wsLive) { wsLive = true; retry = 0; setState('live', 'Connected' + (s.displayName ? ' as ' + s.displayName : '')); hideVeil(); input.focus({ preventScroll: true }); }
      feedServer(ev.data);
    };
    sock.onclose = function (ev) {
      if (ws !== sock) return;
      wsLive = false;
      if (intentionalClose) return;
      if (ev.code === 4401) {
        setState('down', 'Sign-in needed');
        showVeil('Your IDUNA session expired', 'Sign in again to keep playing. Your character is exactly where you left it.', null, signInLink('Sign in with IDUNA'));
        return;
      }
      var wasStable = openedAt && (Date.now() - openedAt > 5000);
      var clean = ev.code === 1000;
      if (clean) {
        setState('down', 'Disconnected');
        showVeil('Connection closed', 'The server ended the session (idle for too long, or a refused login). Reconnect to jump back in.', [{ label: 'Reconnect', primary: true, onclick: function () { retry = 0; connect(); } }]);
      } else if (wasStable || retry < 4) {
        scheduleRetry();
      } else {
        setState('down', 'Offline');
        showVeil('Cannot reach the game', 'Check your connection. The server may also be restarting.', [{ label: 'Try again', primary: true, onclick: function () { retry = 0; connect(); } }]);
      }
    };
    sock.onerror = function () { /* onclose follows and carries the code */ };
  }

  function scheduleRetry() {
    retry++;
    var secs = Math.min(15, 1 << Math.min(retry, 4));
    var left = secs;
    setState('wait', 'Reconnecting in ' + left + 's');
    (function tick() {
      if (left <= 0) { connect(); return; }
      setState('wait', 'Reconnecting in ' + left + 's');
      left--; retryTimer = setTimeout(tick, 1000);
    })();
  }

  // ---- keyboard ----------------------------------------------------------------------------
  function hasSel() { return x.term_has_sel() === 1; }

  function copySelection() {
    var n = x.term_copy();
    if (!n) { flash('Nothing selected'); return false; }
    var text = decoder.decode(new Uint8Array(x.memory.buffer, x.term_copy_addr(), n).slice());
    var done = function () { flash('Copied ' + text.length + ' chars'); x.term_mouse(4, 0, 0); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
    else { legacyCopy(text); done(); }
    return true;
  }
  function legacyCopy(text) {
    var t = el('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) { /* nothing more to try */ }
    document.body.removeChild(t); input.focus({ preventScroll: true });
  }

  function pasteText(text) {
    text = text.replace(/\r\n?/g, '\n');
    var lines = text.split('\n');
    if (lines.length > 1 && !window.confirm('Paste ' + lines.length + ' lines? Each line runs as a separate command.')) return;
    if (text.length > 2000 && !window.confirm('Paste ' + text.length + ' characters?')) return;
    var codes = [];
    lines.forEach(function (ln, i) {
      Array.from(ln).forEach(function (ch) { var cp = ch.codePointAt(0); if (cp >= 32) codes.push(cp); });
      if (i < lines.length - 1) codes.push(KEY.ENTER);
    });
    sendKeys(codes);
  }

  input.addEventListener('keydown', function (e) {
    if (e.isComposing || e.key === 'Process' || e.keyCode === 229) return;
    var ctrl = e.ctrlKey, meta = e.metaKey;
    if ((ctrl || meta) && (e.key === 'c' || e.key === 'C')) {
      if (hasSel() || (e.shiftKey && ctrl)) { e.preventDefault(); copySelection(); return; }
      if (ctrl) { e.preventDefault(); keyAndSend(99, 1); return; }   // no selection: real ^C
      return;
    }
    if ((ctrl || meta) && (e.key === 'v' || e.key === 'V')) return; // let the paste event fire
    if (ctrl || meta) return;                                         // leave browser shortcuts alone
    var code = null;
    switch (e.key) {
      case 'Enter': code = KEY.ENTER; break;
      case 'Backspace': code = KEY.BACKSPACE; break;
      case 'ArrowUp': code = KEY.UP; break;
      case 'ArrowDown': code = KEY.DOWN; break;
      case 'PageUp': code = KEY.PGUP; break;
      case 'PageDown': code = KEY.PGDN; break;
      case 'Escape': if (stage.classList.contains('full') && !document.fullscreenElement) setFull(false); code = KEY.ESC; break;
      case 'Tab': return;                                             // keep Tab for page navigation
      default:
        if (e.key && Array.from(e.key).length === 1) code = e.key.codePointAt(0);
    }
    if (code === null) return;
    e.preventDefault();
    keyAndSend(code, 0);
  });

  // Soft keyboards (Android reports key "Unidentified") and IME: handle through input events.
  input.addEventListener('beforeinput', function (e) {
    if (e.isComposing) return;
    if (e.inputType === 'insertText' && e.data) { e.preventDefault(); sendKeys(Array.from(e.data).map(function (c) { return c.codePointAt(0); })); }
    else if (e.inputType === 'deleteContentBackward') { e.preventDefault(); keyAndSend(KEY.BACKSPACE, 0); }
    else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') { e.preventDefault(); keyAndSend(KEY.ENTER, 0); }
    else if (e.inputType === 'insertFromPaste') { e.preventDefault(); }
  });
  input.addEventListener('compositionend', function (e) {
    if (e.data) sendKeys(Array.from(e.data).map(function (c) { return c.codePointAt(0); }));
    input.value = '';
  });
  input.addEventListener('paste', function (e) {
    e.preventDefault();
    var t = (e.clipboardData || window.clipboardData).getData('text');
    if (t) pasteText(t);
  });
  input.addEventListener('focus', function () { focused = true; blinkPhase = 1; x && x.term_set_cursor(1); });
  input.addEventListener('blur', function () { focused = false; x && x.term_set_cursor(0); });
  setInterval(function () { if (x && focused) { blinkPhase ^= 1; x.term_set_cursor(blinkPhase); } }, 530);

  // ---- mouse / touch -----------------------------------------------------------------------
  function cell(e) {
    var r = canvas.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / r.width * COLS), Math.floor((e.clientY - r.top) / r.height * ROWS)];
  }
  var dragging = false, touchY = null, touchAcc = 0;
  // The canvas is focusable (tab-reachable) but real input lives in the hidden textarea. Without
  // these two lines a click focused the canvas AFTER pointerdown had focused the textarea, so
  // keystrokes went nowhere (found by the headless-browser test).
  canvas.addEventListener('mousedown', function (e) { e.preventDefault(); input.focus({ preventScroll: true }); });
  canvas.addEventListener('focus', function () { input.focus({ preventScroll: true }); });
  canvas.addEventListener('pointerdown', function (e) {
    input.focus({ preventScroll: true });
    if (e.pointerType === 'touch') { touchY = e.clientY; touchAcc = 0; return; }
    if (e.button !== 0) return;
    var c = cell(e); dragging = true; canvas.setPointerCapture(e.pointerId); x.term_mouse(0, c[0], c[1]);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') {
      if (touchY === null) return;
      touchAcc += (e.clientY - touchY) / (canvas.getBoundingClientRect().height / ROWS); touchY = e.clientY;
      var rows = Math.trunc(touchAcc); if (rows) { touchAcc -= rows; x.term_scroll(rows); }
      return;
    }
    if (!dragging) return; var c = cell(e); x.term_mouse(1, c[0], c[1]);
  });
  function endPointer(e) {
    if (e.pointerType === 'touch') { touchY = null; return; }
    if (!dragging) return; dragging = false; var c = cell(e); x.term_mouse(2, c[0], c[1]);
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('dblclick', function (e) { var c = cell(e); x.term_mouse(3, c[0], c[1]); });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rows = Math.max(1, Math.round(Math.abs(e.deltaY) / (e.deltaMode === 0 ? 40 : 1)));
    x.term_scroll(e.deltaY < 0 ? rows * 2 : -rows * 2);
  }, { passive: false });
  stage.addEventListener('click', function (e) { if (e.target === stage) input.focus({ preventScroll: true }); });

  // ---- toolbar -----------------------------------------------------------------------------
  $('b-copy').addEventListener('click', function () { copySelection(); input.focus({ preventScroll: true }); });
  $('b-paste').addEventListener('click', function () {
    input.focus({ preventScroll: true });
    if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(function (t) { if (t) pasteText(t); }, function () { flash('Press Ctrl+V to paste'); });
    else flash('Press Ctrl+V to paste');
  });
  $('b-smaller').addEventListener('click', function () { zoomIdx = Math.max(0, zoomIdx - 1); saveZoom(); fit(); flash(zoomLabel()); });
  $('b-bigger').addEventListener('click', function () { zoomIdx = Math.min(zoomLevels.length - 1, zoomIdx + 1); saveZoom(); fit(); flash(zoomLabel()); });
  function zoomLabel() { return zoomLevels[zoomIdx] === 'fit' ? 'Fit to width' : zoomLevels[zoomIdx] + 'x'; }

  function setFull(on) {
    stage.classList.toggle('full', on);
    $('b-full').textContent = on ? 'Exit fullscreen' : 'Fullscreen';
    if (on && stage.requestFullscreen) stage.requestFullscreen().catch(function () { /* CSS fullscreen still applies */ });
    if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
    setTimeout(fit, 60);
  }
  $('b-full').addEventListener('click', function () { setFull(!stage.classList.contains('full')); input.focus({ preventScroll: true }); });
  $('b-exit').addEventListener('click', function () { setFull(false); input.focus({ preventScroll: true }); });
  document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && stage.classList.contains('full')) { stage.classList.remove('full'); $('b-full').textContent = 'Fullscreen'; fit(); } });

  document.getElementById('quick').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-cmd]') : null;
    if (!b) return;
    var cmd = b.getAttribute('data-cmd');
    // ESC first clears anything half-typed (the server deletes it), so the command runs clean.
    sendKeys([KEY.ESC].concat(Array.from(cmd).map(function (c) { return c.codePointAt(0); }), [KEY.ENTER]));
    input.focus({ preventScroll: true });
  });

  window.addEventListener('resize', fit);
  window.addEventListener('storage', function (e) { if (e.key === 'wotan_iduna_token' && !ws) connect(); });

  // ---- boot --------------------------------------------------------------------------------
  function boot() {
    loadZoom();
    setState('wait', 'Loading terminal');
    var url = '/GFD/term.wasm';
    var load = (WebAssembly.instantiateStreaming
      ? WebAssembly.instantiateStreaming(fetch(url), {}).catch(function () { return fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return WebAssembly.instantiate(b, {}); }); })
      : fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return WebAssembly.instantiate(b, {}); }));
    load.then(function (res) {
      x = res.instance.exports;
      x.term_init();
      fit();
      requestAnimationFrame(frame);
      connect();
    }).catch(function (err) {
      setState('down', 'Terminal failed to load');
      showVeil('Could not load the terminal', 'Your browser could not start the WebAssembly module (' + (err && err.message ? err.message : err) + '). Try a current Chrome, Firefox, Safari or Edge.', [{ label: 'Reload', primary: true, onclick: function () { location.reload(); } }]);
    });
  }
  // wotan-nav.js has already consumed any #sso_token fragment by the time this runs.
  boot();
})();
