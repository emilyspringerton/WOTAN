// D2 tab pages (/d2/*.html). One script, page chosen by <body data-page>.
// Data comes from IDUNA's public D2 reads (same-origin via /api/):
//   GET /api/v1/games/d2/leaderboard?limit=        the generic game ladder (bots are players with kind "bot")
//   GET /api/v1/d2/players/{player_id}              rating, rank, record and recent matches
//   GET /api/v1/d2/web-matches?limit=&player_id=    matches played in the browser, with the packed ship and the round-break log
// House rule (same as the Hearthstone and Redgarden sections): user text only ever goes through textContent.
(function () {
  'use strict';

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
    function add(c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) { c.forEach(add); return; }
      n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function pct(x) { return (Math.round(x * 1000) / 10).toFixed(1) + '%'; }
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
    var res = await fetch(path, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) { var e = new Error(res.status === 404 ? 'Not found' : 'Server error (' + res.status + ')'); e.status = res.status; throw e; }
    return res.json();
  }
  function empty(title, text) { return h('div', { 'class': 'd2-empty' }, h('b', { text: title }), h('p', { text: text, 'class': 'd2-note' })); }
  function errBox(msg) { return h('div', { 'class': 'd2-empty' }, h('b', { text: 'Could not load' }), h('p', { 'class': 'd2-note', text: msg })); }
  function table(cols, rows) {
    var thead = h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { 'class': c.n ? 'n' : '', text: c.t }); })));
    return h('table', { 'class': 'd2-table' }, thead, h('tbody', null, rows));
  }
  function who(p) {
    return [h('a', { href: '/d2/u.html?id=' + encodeURIComponent(p.player_id), text: p.display_name || 'Player' }),
      p.kind === 'bot' ? h('span', { 'class': 'd2-tag bot', text: 'bot' }) : null];
  }

  // ---- ladder ----
  async function pageBoard() {
    var list = $('board'), kind = 'all', all = [];
    function draw() {
      var rows = all.filter(function (p) { return kind === 'all' || p.kind === kind; }).map(function (p, i) {
        var m = p.matches || 0, wr = m ? p.wins / m : 0;
        return h('tr', null,
          h('td', { 'class': 'd2-rank', text: String(i + 1) }),
          h('td', null, who(p)),
          h('td', { 'class': 'n', text: String(Math.round(p.rating)) }),
          h('td', { 'class': 'n d2-win', text: String(p.wins) }),
          h('td', { 'class': 'n d2-loss', text: String(p.losses) }),
          h('td', { 'class': 'n', text: String(m) }),
          h('td', { 'class': 'n', text: m ? pct(wr) : '–' }));
      });
      clear(list);
      if (!rows.length) { list.appendChild(empty('Nobody here yet', 'Play a match and your name lands on the ladder.')); return; }
      list.appendChild(table([{ t: '#' }, { t: 'Player' }, { t: 'Rating', n: 1 }, { t: 'W', n: 1 }, { t: 'L', n: 1 }, { t: 'Played', n: 1 }, { t: 'Win rate', n: 1 }], rows));
    }
    document.querySelectorAll('.d2-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        kind = b.getAttribute('data-kind');
        document.querySelectorAll('.d2-chip').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        draw();
      });
    });
    try {
      all = (await getJSON('/api/v1/games/d2/leaderboard?limit=100')).filter(function (p) { return p.matches > 0; });
      $('s-players').textContent = String(all.length);
      // every match is counted once for each side, and a bot-vs-bot match never reaches the ladder
      $('s-matches').textContent = String(Math.round(all.reduce(function (a, p) { return a + p.matches; }, 0) / 2));
      draw();
    } catch (e) { clear(list).appendChild(errBox(e.message)); }
  }

  // ---- a packed ship, drawn from the stored placements ----
  // Display only: this mirrors DEADWEIGHT_2/core/items.c (dx, dy, ports, role per cell, cost, weight) so a stored ship can be shown; the game itself never
  // reads it. Ports N 8 E 4 S 2 W 1. Roles 0 body, 1 generator, 2 wire, 3 splitter, 4 weapon, 5 plate, 7 amplifier, 8 mender, 9 aegis, 10 resistor, 11 capacitor,
  // 12 battery, 13 transistor, 14 delayer, 15 cryo-vent, 16 biomass. Row 0 is the bow.
  var ITEMS = [
    { n: 'Generator', k: 1, c: 100, w: 4, b: [[0, 0, 4, 1]] },
    { n: 'Conductor', k: 1, c: 10, w: 1, b: [[0, 0, 5, 2]] },
    { n: 'Splitter Node', k: 1, c: 25, w: 1, b: [[0, 0, 11, 3]] },
    { n: 'Railgun', k: 0, c: 240, w: 9, b: [[0, 0, 1, 4]] },
    { n: 'Bulwark Plate', k: 2, c: 55, w: 5, b: [[0, 0, 0, 5]] },
    { n: 'Titanium Beam', k: 0, c: 90, w: 8, b: [[0, 0, 0, 0], [1, 0, 0, 0], [2, 0, 0, 0], [3, 0, 0, 0]] },
    { n: 'Aether Ore', k: 2, c: 100, w: 6, b: [[0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [1, 1, 0, 0]] },
    { n: 'Pulse Laser', k: 0, c: 120, w: 3, b: [[0, 0, 1, 4]] },
    { n: 'Siege Cannon', k: 0, c: 230, w: 10, b: [[0, 0, 1, 4], [1, 0, 0, 0]] },
    { n: 'Amplifier', k: 1, c: 90, w: 2, b: [[0, 0, 5, 7]] },
    { n: 'Mender', k: 1, c: 130, w: 3, b: [[0, 0, 1, 8]] },
    { n: 'Aegis Emitter', k: 2, c: 140, w: 3, b: [[0, 0, 1, 9]] },
    { n: 'Resistor 1R', k: 1, c: 20, w: 1, b: [[0, 0, 5, 10]] },
    { n: 'Resistor 2R', k: 1, c: 20, w: 1, b: [[0, 0, 5, 10]] },
    { n: 'Resistor 4R', k: 1, c: 20, w: 1, b: [[0, 0, 5, 10]] },
    { n: 'Capacitor', k: 1, c: 70, w: 2, b: [[0, 0, 5, 11]] },
    { n: 'Battery', k: 1, c: 110, w: 4, b: [[0, 0, 5, 12]] },
    { n: 'Transistor', k: 1, c: 80, w: 1, b: [[0, 0, 13, 13]] },
    { n: 'Delayer', k: 1, c: 60, w: 1, b: [[0, 0, 5, 14]] },
    { n: 'Quantum Core', k: 1, c: 320, w: 10, b: [[0, 0, 9, 1], [1, 0, 12, 1], [0, 1, 3, 1], [1, 1, 6, 1]] },
    { n: 'Cryo-Vent', k: 2, c: 60, w: 3, b: [[0, 0, 0, 15], [1, 0, 0, 15]] },
    { n: 'Xeno-Biomass', k: 2, c: 90, w: 4, b: [[0, 0, 0, 16], [0, 1, 0, 16], [0, 2, 0, 16], [1, 2, 0, 16]] },
    { n: 'Titanium Shard', k: 0, c: 55, w: 5, b: [[0, 0, 0, 0], [1, 0, 0, 0]] },
    { n: 'Ore Chip', k: 2, c: 30, w: 2, b: [[0, 0, 0, 0]] }
  ];
  var KIND = ['#cc6058', '#d6a456', '#6094d0'];
  // a letter for each part, so a stored ship reads at a glance
  var GLYPH_ITEM = { 0: 'G', 1: '+', 2: 'Y', 3: 'R', 4: '#', 5: 'T', 6: 'o', 7: 'L', 8: 'C', 9: 'A', 10: 'M', 11: 'E', 12: 'r', 13: 'r', 14: 'r', 15: 'c', 16: 'b', 17: 't', 18: 'd',
    19: 'Q', 20: 'V', 21: 'N', 22: 't', 23: 'o' };
  function cells(it, rot, ar, ac) {
    var out = [], mnx = 99, mny = 99;
    it.b.forEach(function (c) {
      var x = c[0], y = c[1];
      for (var k = 0; k < rot; k++) { var nx = -y; y = x; x = nx; }
      out.push([x, y, c[2], c[3]]);
      if (x < mnx) mnx = x; if (y < mny) mny = y;
    });
    return out.map(function (c) {
      return { r: ar + (c[1] - mny), c: ac + (c[0] - mnx), role: c[3] };
    });
  }
  function shipGrid(loadout) {
    var grid = [], cost = 0, weight = 0;
    for (var i = 0; i < 36; i++) grid.push(null);
    (loadout || []).forEach(function (p) {
      var it = ITEMS[p.item];
      if (!it) return;
      cost += it.c; weight += it.w;
      cells(it, p.rot | 0, p.row | 0, p.col | 0).forEach(function (c) {
        if (c.r >= 0 && c.r < 6 && c.c >= 0 && c.c < 6) grid[c.r * 6 + c.c] = { kind: it.k, name: it.n, glyph: GLYPH_ITEM[p.item] || '' };
      });
    });
    var box = h('div', { 'class': 'd2-ship', role: 'img', 'aria-label': 'The ship that was packed. The top row is the bow.' }, grid.map(function (c) {
      if (!c) return h('i');
      return h('i', { title: c.name, style: 'background:' + KIND[c.kind] + 'b0;color:#14161d;font:700 .7rem/1 "Space Grotesk",system-ui;display:grid;place-items:center', text: c.glyph });
    }));
    return h('div', null, box, h('p', { 'class': 'd2-note', style: 'margin:.35rem 0 0', text: 'bow at the top · ' + cost + ' credits · ' + weight + ' t' }));
  }

  var GRADE = ['', 'miss', 'good', 'perfect'];
  var CALL = ['overcharge', 'brace', 'none'];
  function roundsList(rounds) {
    if (!rounds || !rounds.length) return h('p', { 'class': 'd2-note', text: 'The fight ended before the first round break.' });
    return h('ul', { 'class': 'd2-note', style: 'margin:0;padding-left:1.1rem' }, rounds.map(function (r) {
      return h('li', { text: 'Round ' + r.no + ': you ' + (CALL[r.your_call] || 'none') + (r.your_grade ? ' (' + GRADE[r.your_grade] + ')' : '') +
        ', they ' + (CALL[r.opp_call] || 'none') + (r.opp_grade ? ' (' + GRADE[r.opp_grade] + ')' : '') });
    }));
  }

  var RESULT = { win: ['WIN', 'win'], loss: ['LOSS', 'loss'], tie: ['DRAW', 'tie'], forfeit: ['FORFEIT', 'forfeit'] };
  function secs(n) { n = Math.max(0, n | 0); var m = Math.floor(n / 60), s = n % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function delta(m) {
    if (!m.counted) return h('span', { 'class': 'd2-note', text: 'unrated' });
    var d = Math.round(m.rating_after - m.rating_before);
    return h('span', { 'class': 'd2-delta ' + (d >= 0 ? 'up' : 'down'), text: (d >= 0 ? '+' : '') + d });
  }
  function matchRows(list, withPlayer, cols) {
    var rows = [];
    (list || []).forEach(function (m) {
      var r = RESULT[m.result] || [m.result, 'tie'];
      var open = false, more = null;
      var tr = h('tr', { 'class': 'd2-open', tabindex: '0', title: 'Show the ship and the round breaks' },
        h('td', null, h('span', { 'class': 'd2-pill ' + r[1], text: r[0] })),
        withPlayer ? h('td', null, h('a', { href: '/d2/u.html?id=' + encodeURIComponent(m.player_id), text: m.display_name || 'Player' })) : null,
        h('td', null, m.opp_name || '?', m.opp_kind === 'bot' ? h('span', { 'class': 'd2-tag bot', text: 'bot' }) : null),
        h('td', { 'class': 'n d2-kd', text: m.hull_you + ' / ' + m.hull_opp }),
        h('td', { 'class': 'n d2-kd', text: secs(m.ticks) }),
        h('td', { 'class': 'n' }, delta(m)),
        h('td', { 'class': 'n d2-note', text: ago(m.played_at) }));
      function toggle() {
        open = !open;
        if (open && !more) {
          more = h('tr', null, h('td', { colspan: String(cols) }, h('div', { 'class': 'd2-detail', style: 'display:flex;gap:1.5rem;flex-wrap:wrap;align-items:flex-start;padding:.4rem 0' },
            h('div', null, h('p', { 'class': 'd2-note', style: 'margin:0 0 .4rem', text: 'The ship' }), h('div', { 'class': 'd2-shipbox', text: 'loading…' })),
            h('div', null, h('p', { 'class': 'd2-note', style: 'margin:0 0 .4rem', text: 'Round breaks' }), h('div', { 'class': 'd2-roundsbox', text: 'loading…' })))));
          tr.parentNode.insertBefore(more, tr.nextSibling);
          getJSON('/api/v1/d2/web-matches/' + m.id).then(function (d) {
            clear(more.querySelector('.d2-shipbox')).appendChild(shipGrid(d.loadout));
            clear(more.querySelector('.d2-roundsbox')).appendChild(roundsList(d.rounds));
          }).catch(function (e) { more.querySelector('.d2-shipbox').textContent = e.message; });
        }
        if (more) more.hidden = !open;
      }
      tr.addEventListener('click', function (e) { if (e.target.tagName !== 'A') toggle(); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      rows.push(tr);
    });
    return rows;
  }
  function matchTable(list, withPlayer) {
    var cols = [{ t: 'Result' }];
    if (withPlayer) cols.push({ t: 'Player' });
    cols.push({ t: 'Against' }, { t: 'Hull', n: 1 }, { t: 'Time', n: 1 }, { t: 'Rating', n: 1 }, { t: '', n: 1 });
    return table(cols, matchRows(list, withPlayer, cols.length));
  }

  // ---- profile ----
  async function pageProfile() {
    var id = new URLSearchParams(location.search).get('id') || '';
    var body = $('profile');
    if (!id) {
      var s = null; try { s = typeof getIdunaSession === 'function' ? getIdunaSession() : null; } catch (e) { s = null; }
      if (s && s.playerID) { location.replace('/d2/u.html?id=' + encodeURIComponent(s.playerID)); return; }
      clear(body).appendChild(empty('Which player?', 'Open a profile from the ladder, or sign in to see your own.'));
      return;
    }
    try {
      var d = await getJSON('/api/v1/d2/players/' + encodeURIComponent(id));
      var p = d.player, m = p.matches || 0;
      document.title = (p.display_name || 'Player') + ' — WOTAN D2';
      clear($('p-name')).appendChild(document.createTextNode(p.display_name || 'Player'));
      if (p.kind === 'bot') $('p-name').appendChild(h('span', { 'class': 'd2-tag bot', text: 'bot' }));
      $('p-r').textContent = m ? String(Math.round(p.rating)) : '–';
      $('p-rank').textContent = d.rank ? '#' + d.rank : '–';
      $('p-w').textContent = String(p.wins); $('p-l').textContent = String(p.losses);
      $('p-wr').textContent = m ? pct(p.wins / m) : '–';
      clear(body);
      if (d.recent && d.recent.length) {
        body.appendChild(h('section', { 'class': 'd2-panel' }, h('h2', { 'class': 'd2-h2', text: 'Recent matches' }), matchTable(d.recent, false),
          d.forfeits ? h('p', { 'class': 'd2-note', style: 'margin:.8rem 0 0', text: 'Forfeits: ' + d.forfeits + ' (leaving a live match is a loss).' }) : null));
      } else {
        body.appendChild(h('section', { 'class': 'd2-panel' }, h('p', { 'class': 'd2-note', text: p.kind === 'bot' ? 'Bots play in the pool and are rated like everyone else; their per-match history is not kept.' : 'No matches played in the browser yet.' })));
      }
    } catch (e) {
      clear(body).appendChild(e.status === 404 ? empty('No D2 record', 'This player has not finished a D2 match yet.') : errBox(e.message));
    }
  }

  // ---- matches (played in the browser) ----
  async function pageMatches() {
    var box = $('matches');
    try {
      var d = await getJSON('/api/v1/d2/web-matches?limit=50');
      var list = d.matches || [];
      clear(box);
      if (!list.length) { box.appendChild(empty('No browser matches yet', 'Press play on the Play page and your first match lands here.')); return; }
      box.appendChild(matchTable(list, true));
      $('s-shown').textContent = String(list.length);
      $('s-wins').textContent = String(list.filter(function (m) { return m.result === 'win'; }).length);
    } catch (e) { clear(box).appendChild(errBox(e.message)); }
  }

  var page = document.body.getAttribute('data-page');
  if (page === 'board') pageBoard();
  else if (page === 'profile') pageProfile();
  else if (page === 'matches') pageMatches();
})();
