// /hearthstone/tracker.html -- live cards-left tracker. Private: every request carries the viewer's own
// IDUNA token and the server keys the session on its subject, so this page can only ever show your game.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var timer = null, lastOk = 0;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text; // textContent only: card names are never HTML
    return n;
  }

  function paintList(ul, cards, dim) {
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    (cards || []).forEach(function (c) {
      var li = el('li', 'trk-row' + (dim ? ' dim' : ''));
      li.appendChild(el('span', 'trk-cost', String(c.cost)));
      li.appendChild(el('span', 'trk-name', c.name));
      li.appendChild(el('span', 'trk-count', c.count > 1 ? '×' + c.count : ''));
      ul.appendChild(li);
    });
    if (!cards || !cards.length) ul.appendChild(el('li', 'hs-meta', 'None yet.'));
  }

  function paint(st) {
    $('live').hidden = false;
    var dot = $('dot'), status = $('status');
    dot.className = 'trk-dot' + (st.in_game ? ' game' : (st.connected ? ' on' : ''));
    if (!st.connected) status.textContent = 'Waiting for your PC.';
    else if (st.in_game) status.textContent = 'In game · turn ' + st.turn;
    else if (st.deck) status.textContent = 'Connected · queued deck ready';
    else status.textContent = 'Connected';
    $('deck-name').textContent = st.deck ? st.deck.name + (st.deck.class ? ' · ' + st.deck.class : '') : '—';
    $('left-n').textContent = String(st.left_total || 0);
    $('deck-size').textContent = String(st.deck ? st.deck.size : 30);
    $('note').textContent = st.note || '';
    paintList($('left'), st.left, false);
    paintList($('drawn'), st.drawn, true);
    $('drawn-n').textContent = st.drawn_total ? '(' + st.drawn_total + ')' : '';
    paintList($('opp'), st.opponent && st.opponent.cards, false);
    $('opp-name').textContent = st.opponent && st.opponent.name ? '· ' + st.opponent.name : '';
  }

  async function poll() {
    try {
      var st = await HS.get('/live/state');
      lastOk = Date.now();
      paint(st);
    } catch (e) {
      if (e.status === 401) { stop(); showSignIn(); return; }
      $('status').textContent = 'Reconnecting…';
    }
  }
  function start() { if (!timer) { poll(); timer = setInterval(poll, 1500); } }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else if (HS.hasSession()) start(); });

  function showSignIn() {
    $('connect').hidden = true; $('live').hidden = true; $('signin').hidden = false;
    try { $('signin-link').href = typeof buildSsoURL === 'function' ? buildSsoURL() : 'https://iam.okemily.com/'; } catch (e) { /* keep # */ }
  }

  async function mint() {
    var err = $('connect-err'); err.hidden = true;
    try {
      var r = await HS.post('/live/token', {});
      var base = location.origin;
      var cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-RestMethod \'' +
        base + '/api/v1/hs/live/uplink.ps1\'))) -Token \'' + r.token + '\' -Base \'' + base + '\'"';
      $('cmd').value = cmd; $('cmd-wrap').hidden = false;
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('mint').addEventListener('click', mint);
    $('copy').addEventListener('click', function () {
      var t = $('cmd'); t.select();
      try { document.execCommand('copy'); $('copied').textContent = 'Copied.'; } catch (e) { $('copied').textContent = 'Press Ctrl+C.'; }
    });
    if (!HS.hasSession()) { showSignIn(); return; }
    $('connect').hidden = false;
    start();
  });
})();
