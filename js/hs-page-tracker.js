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
    var age = st.updated_at ? Math.max(0, Math.round((Date.now() - Date.parse(st.updated_at)) / 1000)) : null;
    var ageTxt = age === null ? '' : ' \u00b7 PC last sent ' + (age < 90 ? age + 's' : Math.round(age / 60) + 'm') + ' ago';
    if (!st.connected) status.textContent = 'Waiting for your PC.';
    else if (st.in_game) status.textContent = 'In game · turn ' + st.turn;
    else if (st.deck) status.textContent = 'Connected · queued deck ready';
    else status.textContent = 'Connected';
    $('deck-name').textContent = st.deck ? st.deck.name + (st.deck.class ? ' · ' + st.deck.class : '') : '—';
    $('left-n').textContent = String(st.left_total || 0);
    $('deck-size').textContent = String(st.deck ? st.deck.size : 30);
    $('note').textContent = st.note || '';
    var wl = $('warn');
    while (wl.firstChild) wl.removeChild(wl.firstChild);
    (st.warnings || []).forEach(function (w) { wl.appendChild(el('li', '', w)); });
    wl.hidden = !(st.warnings && st.warnings.length);
    var sy = $('synced');
    if (st.library_deck_id) {
      while (sy.firstChild) sy.removeChild(sy.firstChild);
      sy.appendChild(document.createTextNode('Last game saved to your library: '));
      var a = el('a', '', 'open deck'); a.href = '/hearthstone/deck.html?id=' + encodeURIComponent(st.library_deck_id);
      sy.appendChild(a); sy.hidden = false;
    }
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
      $('status').textContent = 'Reconnecting… (showing the last data received)';
    }
  }
  function start() { if (!timer) { poll(); timer = setInterval(poll, 1500); } }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else if (HS.hasSession()) start(); });

  function showSignIn() {
    $('connect').hidden = true; $('live').hidden = true; $('signin').hidden = false;
    try { $('signin-link').href = typeof buildSsoURL === 'function' ? buildSsoURL() : 'https://iam.okemily.com/'; } catch (e) { /* keep # */ }
  }

  // The uplink signs in with IAM itself (loopback OAuth, same pattern as the EDGE.GAME client), so the
  // command carries no secret and is the same for everyone.
  function showCommand() {
    var base = location.origin;
    $('cmd').value = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-RestMethod \'' +
      base + '/api/v1/hs/live/uplink.ps1\'))) -Base \'' + base + '\'"';
    $('icmd').value = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-RestMethod \'' +
      base + '/api/v1/hs/live/install.ps1\'))) -Base \'' + base + '\'"';
  }

  async function loadPrefs() {
    var box = $('autopub');
    try {
      var s = await HS.get('/settings');
      box.checked = !!s.auto_publish;
      $('prefs').hidden = false;
      box.addEventListener('change', async function () {
        var want = box.checked;
        try { var r = await HS.put('/settings', { auto_publish: want }); box.checked = !!r.auto_publish; }
        catch (e) { box.checked = !want; }
      });
    } catch (e) { /* settings are optional; the tracker works without them */ }
  }

  document.addEventListener('DOMContentLoaded', function () {
    showCommand();
    [['copy', 'cmd', 'copied'], ['icopy', 'icmd', 'icopied']].forEach(function (ids) {
      $(ids[0]).addEventListener('click', function () {
        var t = $(ids[1]); t.select();
        try { document.execCommand('copy'); $(ids[2]).textContent = 'Copied.'; } catch (e) { $(ids[2]).textContent = 'Press Ctrl+C.'; }
      });
    });
    if (!HS.hasSession()) { showSignIn(); return; }
    $('connect').hidden = false;
    loadPrefs();
    start();
  });
})();
