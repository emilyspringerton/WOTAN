// REDGARDEN tab pages (/redgarden/*.html). One script, page chosen by <body data-page>.
// Data comes from IDUNA's public REDGARDEN reads (same-origin via nginx /api/):
//   GET /api/v1/redgarden/leaderboard?limit=&q=   GET /api/v1/redgarden/hero-leaderboard
//   GET /api/v1/redgarden/players/{player_id}
// House rule (same as the Hearthstone section): user text only ever goes through textContent.
(function () {
  'use strict';
  var API = '/api/v1/redgarden';
  var heroNames = {};

  function h(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k === 'style') n.style.cssText = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function pct(x) { return (Math.round(x * 1000) / 10).toFixed(1) + '%'; }
  function hero(id) { return heroNames[String(id)] || ('Hero #' + id); }
  function ago(iso) {
    var t = new Date(String(iso).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z')).getTime();
    if (isNaN(t)) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  async function getJSON(path) {
    var res = await fetch(API + path, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) { var e = new Error(res.status === 404 ? 'Not found' : 'Server error (' + res.status + ')'); e.status = res.status; throw e; }
    return res.json();
  }
  function empty(title, text) { return h('div', { 'class': 'rg-empty' }, h('b', { text: title }), h('p', { text: text, 'class': 'rg-note' })); }
  function errBox(msg) { return h('div', { 'class': 'rg-empty' }, h('b', { text: 'Could not load' }), h('p', { 'class': 'rg-note', text: msg })); }

  function table(cols, rows) {
    var thead = h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { 'class': c.n ? 'n' : '', text: c.t }); })));
    return h('table', { 'class': 'rg-table' }, thead, h('tbody', null, rows));
  }
  function wrBar(wr) { return h('div', { 'class': 'rg-bar', title: pct(wr) }, h('i', { style: 'width:' + Math.round(wr * 100) + '%' })); }

  // ---- leaderboard ----
  async function pageBoard() {
    var list = $('board'), q = $('q'), req = 0;
    async function load() {
      var my = ++req;
      clear(list).appendChild(h('p', { 'class': 'rg-note', text: 'Loading…' }));
      try {
        var d = await getJSON('/leaderboard?limit=100' + (q.value.trim() ? '&q=' + encodeURIComponent(q.value.trim()) : ''));
        if (my !== req) return;
        var rows = (d.leaderboard || []).map(function (p, i) {
          var m = p.matches_played || 0, wr = m ? p.wins / m : 0;
          return h('tr', null,
            h('td', { 'class': 'rg-rank', text: String(i + 1) }),
            h('td', null, h('a', { href: '/redgarden/u.html?id=' + encodeURIComponent(p.player_id), text: p.display_name || 'Player' })),
            h('td', { 'class': 'n rg-win', text: String(p.wins) }),
            h('td', { 'class': 'n rg-loss', text: String(p.losses) }),
            h('td', { 'class': 'n', text: String(m) }),
            h('td', { 'class': 'n', text: pct(wr) }),
            h('td', null, wrBar(wr)));
        });
        clear(list);
        if (!rows.length) { list.appendChild(empty(q.value.trim() ? 'No one by that name' : 'No matches reported yet', q.value.trim() ? 'Check the spelling.' : 'Play a match and your name lands here.')); return; }
        list.appendChild(table([{ t: '#' }, { t: 'Player' }, { t: 'W', n: 1 }, { t: 'L', n: 1 }, { t: 'Played', n: 1 }, { t: 'Win rate', n: 1 }, { t: '' }], rows));
        var tot = d.leaderboard.reduce(function (a, p) { return a + (p.matches_played || 0); }, 0);
        $('s-players').textContent = String(d.leaderboard.length);
        $('s-matches').textContent = String(Math.round(tot / 2) || tot); // each match is reported once per player
      } catch (e) { if (my === req) clear(list).appendChild(errBox(e.message)); }
    }
    var t; q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(load, 300); });
    load();
  }

  // ---- heroes ----
  async function pageHeroes() {
    var box = $('heroes');
    try {
      var d = await getJSON('/hero-leaderboard?min-games=1');
      var arr = d.heroes || d.leaderboard || d.hero_leaderboard || [];
      var rows = arr.map(function (r, i) {
        var m = r.matches_played != null ? r.matches_played : (r.wins + r.losses);
        var wr = r.win_rate != null ? r.win_rate : (m ? r.wins / m : 0);
        return h('tr', null,
          h('td', { 'class': 'rg-rank', text: String(i + 1) }),
          h('td', { text: hero(r.hero_id), style: 'font-weight:600' }),
          h('td', { 'class': 'n rg-win', text: String(r.wins) }),
          h('td', { 'class': 'n rg-loss', text: String(r.losses) }),
          h('td', { 'class': 'n', text: String(m) }),
          h('td', { 'class': 'n', text: pct(wr) }),
          h('td', null, wrBar(wr)));
      });
      clear(box);
      if (!rows.length) { box.appendChild(empty('No hero data yet', 'Hero win rates appear once matches are reported.')); return; }
      box.appendChild(table([{ t: '#' }, { t: 'Hero' }, { t: 'W', n: 1 }, { t: 'L', n: 1 }, { t: 'Played', n: 1 }, { t: 'Win rate', n: 1 }, { t: '' }], rows));
    } catch (e) { clear(box).appendChild(errBox(e.message)); }
  }

  // ---- profile ----
  async function pageProfile() {
    var id = new URLSearchParams(location.search).get('id') || '';
    var body = $('profile');
    if (!id) {
      var s = null; try { s = typeof getIdunaSession === 'function' ? getIdunaSession() : null; } catch (e) { s = null; }
      if (s && s.playerID) { location.replace('/redgarden/u.html?id=' + encodeURIComponent(s.playerID)); return; }
      clear(body).appendChild(empty('Which player?', 'Open a profile from the leaderboard, or sign in to see your own.'));
      return;
    }
    try {
      var p = await getJSON('/players/' + encodeURIComponent(id));
      document.title = (p.display_name || 'Player') + ' — WOTAN Redgarden';
      $('p-name').textContent = p.display_name || 'Player';
      $('p-w').textContent = String(p.wins); $('p-l').textContent = String(p.losses);
      $('p-m').textContent = String(p.matches); $('p-wr').textContent = pct(p.win_rate || 0);
      clear(body);
      var hs = (p.heroes || []).map(function (r) {
        var wr = r.matches ? r.wins / r.matches : 0;
        return h('tr', null,
          h('td', { text: hero(r.hero_id), style: 'font-weight:600' }),
          h('td', { 'class': 'n rg-win', text: String(r.wins) }),
          h('td', { 'class': 'n rg-loss', text: String(r.losses) }),
          h('td', { 'class': 'n', text: pct(wr) }),
          h('td', null, wrBar(wr)));
      });
      var rc = (p.recent || []).map(function (r) {
        return h('tr', null,
          h('td', null, h('span', { 'class': 'rg-pill ' + (r.result === 'win' ? 'win' : 'loss'), text: r.result === 'win' ? 'WIN' : 'LOSS' })),
          h('td', { text: r.hero_id >= 0 ? hero(r.hero_id) : '—' }),
          h('td', { 'class': 'n rg-note', text: ago(r.played_at) }));
      });
      body.appendChild(h('div', { 'class': 'rg-grid two' },
        h('section', { 'class': 'rg-panel' }, h('h2', { 'class': 'rg-h2', text: 'Heroes played' }),
          hs.length ? table([{ t: 'Hero' }, { t: 'W', n: 1 }, { t: 'L', n: 1 }, { t: 'Win rate', n: 1 }, { t: '' }], hs)
                    : h('p', { 'class': 'rg-note', text: 'Hero breakdown fills in from the next match onward.' })),
        h('section', { 'class': 'rg-panel' }, h('h2', { 'class': 'rg-h2', text: 'Recent matches' }),
          rc.length ? table([{ t: 'Result' }, { t: 'Hero' }, { t: '', n: 1 }], rc)
                    : h('p', { 'class': 'rg-note', text: 'No per-match history yet.' }))));
    } catch (e) {
      clear(body).appendChild(e.status === 404
        ? empty('No REDGARDEN record', 'This player has not finished a REDGARDEN match yet.')
        : errBox(e.message));
    }
  }

  async function init() {
    try {
      var r = await fetch('/data/redgarden-heroes.json');
      if (r.ok) heroNames = (await r.json()).heroes || {};
    } catch (e) { /* names fall back to "Hero #n" */ }
    var page = document.body.getAttribute('data-page');
    if (page === 'board') pageBoard();
    else if (page === 'heroes') pageHeroes();
    else if (page === 'profile') pageProfile();
  }
  init();
})();
