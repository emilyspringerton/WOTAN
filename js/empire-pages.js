// EMPIRE tab pages (/empire/*.html). One script, page chosen by <body data-page>.
// Data comes from IDUNA's public EMPIRE reads (same-origin via /api/) and one file the build generates from the real module:
//   GET /api/v1/games/empire/leaderboard?limit=    the generic game ladder (the AIs are players with kind "bot")
//   GET /api/v1/empire/bots | live | cards | matches | matches/{id} | players/{id} | status
//   /data/empire-cards.json                          cards, factions and the AIs: numbers from empire.wasm's own exports (scripts/empire-cards.mjs)
// House rule (same as the Hearthstone, Redgarden and D2 sections): user text only ever goes through textContent.
// This file is display only. The game itself -- its rules, the AIs, the screens -- is empire.wasm, compiled from PARENA.
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
  function empty(title, text) { return h('div', { 'class': 'em-empty' }, h('b', { text: title }), h('p', { text: text, 'class': 'em-note' })); }
  function errBox(msg) { return h('div', { 'class': 'em-empty' }, h('b', { text: 'Could not load' }), h('p', { 'class': 'em-note', text: msg })); }
  function table(cols, rows) {
    var thead = h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { 'class': c.n ? 'n' : '', text: c.t }); })));
    return h('table', { 'class': 'em-table' }, thead, h('tbody', null, rows));
  }
  function secs(n) { n = Math.max(0, n | 0); var m = Math.floor(n / 60), s = n % 60; return m + ':' + (s < 10 ? '0' : '') + s; }

  var FACTION = ['Syndicate', 'Goetia', 'Archive'];
  var REASON = ['', 'a king fell', 'more towers at time', 'first tower in overtime', 'more tower health', 'level on towers', 'resigned'];
  var meta = null;
  async function loadMeta() {
    if (!meta) meta = await getJSON('/data/empire-cards.json');
    return meta;
  }
  function card(id) { return meta && meta.cards[id] ? meta.cards[id] : { id: id, short: '?', name: '?', mythic: false }; }

  // ---- the little marks (display only: the emblems the wasm draws on its cards, as SVG) ----
  var NS = 'http://www.w3.org/2000/svg';
  function sv(tag, a) { var n = document.createElementNS(NS, tag); Object.keys(a || {}).forEach(function (k) { n.setAttribute(k, a[k]); }); return n; }
  function emblem(id) {
    var s = sv('svg', { viewBox: '-12 -12 24 24', 'aria-hidden': 'true' });
    var st = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    function add(tag, a) { var o = Object.assign({}, st, a); s.appendChild(sv(tag, o)); }
    function dot(cx, cy, r) { s.appendChild(sv('circle', { cx: cx, cy: cy, r: r, fill: 'currentColor' })); }
    switch (id) {
      case 0: add('rect', { x: -9, y: -5, width: 8, height: 10 }); add('rect', { x: 1, y: -5, width: 8, height: 10 }); break;
      case 1: add('circle', { cx: 0, cy: 0, r: 9 }); add('path', { d: 'M-5 5 L5 -5' }); break;
      case 2: dot(-4, 0, 4); dot(4, 0, 4); break;
      case 3: add('circle', { cx: 0, cy: 0, r: 9 }); dot(0, 0, 3); break;
      case 4: dot(0, -5, 2); dot(-5, 5, 2); dot(5, 5, 2); break;
      case 5: add('circle', { cx: 0, cy: 0, r: 9 }); add('path', { d: 'M0 -5 V5 M-5 0 H5' }); break;
      case 6: add('path', { d: 'M0 -9 L9 0 L0 9 L-9 0 Z' }); break;
      case 7: add('path', { d: 'M0 -9 L9 5 H-9 Z' }); dot(0, 1, 1.5); break;
      case 8: add('circle', { cx: -4, cy: 0, r: 5 }); add('circle', { cx: 4, cy: 0, r: 5 }); break;
      case 9: add('circle', { cx: 0, cy: 0, r: 9 }); add('circle', { cx: 0, cy: 0, r: 4.5 }); break;
      case 10: add('path', { d: 'M-9 6 V-5 L-4.5 0 L0 -9 L4.5 0 L9 -5 V6 Z' }); break;
      case 11: add('path', { d: 'M0 -9 L9 9 H-9 Z' }); break;
      case 12: add('path', { d: 'M-9 -5 H9 M-9 0 H9 M-9 5 H9' }); break;
      case 13: add('path', { d: 'M-9 -5 L0 0 L-9 5 M0 -5 L9 0 L0 5' }); break;
      case 14: add('path', { d: 'M-9 9 V-9 L0 0 L9 -9 V9' }); break;
      case 15: add('path', { d: 'M0 9 V0 M0 0 L-9 -9 M0 0 L9 -9' }); break;
      default: dot(0, 0, 4);
    }
    return s;
  }
  function mark(id) {
    var c = card(id);
    var n = h('span', { 'class': 'em-mark' + (c.mythic ? ' myth' : ''), title: c.short + (c.mythic ? ' (mythic)' : ''), style: 'color:' + (c.mythic ? '#d6b062' : '#e2e4ec') });
    n.appendChild(emblem(id));
    return n;
  }
  function deckRow(deck) { return h('span', { 'class': 'em-deckrow' }, (deck || []).map(mark)); }
  function crowns(n) { return h('span', { 'class': 'em-crowns', title: n + ' of 3', 'aria-label': n + ' of 3 crowns' }, [0, 1, 2].map(function (i) { return h('i', { 'class': i < n ? 'on' : '' }); })); }
  function facTag(f) { return h('span', { 'class': 'em-fac f' + f, text: FACTION[f] || '' }); }

  function who(p) {
    return [h('a', { href: '/empire/u.html?id=' + encodeURIComponent(p.player_id), text: p.display_name || p.name || 'Player' }),
      (p.kind === 'bot' || p.bot > 0) ? h('span', { 'class': 'em-tag bot', text: 'AI' }) : null];
  }
  function whoSeat(s) { return who({ player_id: s.player_id, name: s.name, bot: s.bot, kind: s.kind }); }

  // ---- ladder ----
  async function pageBoard() {
    var list = $('board'), kind = 'all', all = [];
    function draw() {
      var rows = all.filter(function (p) { return kind === 'all' || p.kind === kind; }).map(function (p, i) {
        var m = p.matches || 0, wr = m ? p.wins / m : 0;
        return h('tr', null,
          h('td', { 'class': 'em-rank', text: String(i + 1) }),
          h('td', null, who(p)),
          h('td', { 'class': 'n', text: String(Math.round(p.rating)) }),
          h('td', { 'class': 'n em-win', text: String(p.wins) }),
          h('td', { 'class': 'n em-loss', text: String(p.losses) }),
          h('td', { 'class': 'n', text: String(m) }),
          h('td', { 'class': 'n', text: m ? pct(wr) : '–' }));
      });
      clear(list);
      if (!rows.length) { list.appendChild(empty('Nobody here yet', 'Play a match and your name lands on the ladder.')); return; }
      list.appendChild(table([{ t: '#' }, { t: 'Player' }, { t: 'Rating', n: 1 }, { t: 'W', n: 1 }, { t: 'L', n: 1 }, { t: 'Played', n: 1 }, { t: 'Win rate', n: 1 }], rows));
    }
    document.querySelectorAll('.em-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        kind = b.getAttribute('data-kind');
        document.querySelectorAll('.em-chip').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        draw();
      });
    });
    try {
      all = (await getJSON('/api/v1/games/empire/leaderboard?limit=100')).filter(function (p) { return p.matches > 0; });
      $('s-players').textContent = String(all.length);
      // every match is counted once for each side
      $('s-matches').textContent = String(Math.round(all.reduce(function (a, p) { return a + p.matches; }, 0) / 2));
      draw();
    } catch (e) { clear(list).appendChild(errBox(e.message)); }
    liveStrip($('live-strip'));
  }

  // ---- live matches ----
  async function liveList() {
    var d = await getJSON('/api/v1/empire/live');
    return d.live || [];
  }
  function liveRow(m) {
    var name = function (i) { return m.names[i] || '?'; };
    return h('div', { 'class': 'em-liverow' },
      h('span', { 'class': 'grow' }, h('span', { 'class': 'em-dot' }),
        h('b', { text: name(0) }), ' ', facTag(m.factions[0]), '  against  ', h('b', { text: name(1) }), ' ', facTag(m.factions[1])),
      h('span', { 'class': 'em-note', text: (m.mode === 'league' ? 'AI league' : 'ranked') + ' · ' + secs(m.tick / 20) }),
      m.watchers ? h('span', { 'class': 'em-note', text: m.watchers + ' watching' }) : null,
      h('a', { 'class': 'em-btn', href: '/empire/watch.html?live=' + m.id, text: 'Watch' }));
  }
  async function liveStrip(box) {
    if (!box) return;
    try {
      var live = await liveList();
      clear(box);
      if (live.length) box.appendChild(h('div', { 'class': 'em-live' }, live.slice(0, 3).map(liveRow)));
    } catch (e) { /* the strip is a bonus */ }
  }
  async function pageLive() {
    var box = $('live');
    async function tick() {
      try {
        var live = await liveList();
        clear(box);
        if (!live.length) box.appendChild(empty('Quiet just now', 'The AIs sit down to a league match every fifteen minutes or so, and any ranked match in progress shows up here. Check back in a moment.'));
        else box.appendChild(h('div', { 'class': 'em-live' }, live.map(liveRow)));
      } catch (e) { clear(box).appendChild(errBox(e.message)); }
    }
    tick();
    setInterval(tick, 5000);
  }

  // ---- the AIs ----
  async function pageAIs() {
    var box = $('ais');
    try {
      await loadMeta();
      var d = await getJSON('/api/v1/empire/bots');
      var byN = {}; (d.bots || []).forEach(function (b) { byN[b.n] = b; });
      clear(box);
      var grid = h('div', { 'class': 'em-grid3' });
      meta.bots.forEach(function (b) {
        var s = byN[b.n] || {}, m = s.matches || 0;
        grid.appendChild(h('article', { 'class': 'em-tile' },
          h('h3', null, h('span', { text: b.name }), h('span', { 'class': 'em-tag bot', text: 'AI' })),
          h('p', { 'class': 'sub' }, facTag(b.faction), '  ·  ', FACTION[b.faction] ? meta.factions[b.faction].blurb : ''),
          h('p', { text: b.blurb }),
          h('div', null, deckRow(b.deck)),
          h('dl', { 'class': 'em-kv' },
            h('dt', { text: 'Rating' }), h('dd', { text: String(Math.round(s.rating || 1500)) }),
            h('dt', { text: 'Record' }), h('dd', { text: m ? (s.wins + ' – ' + s.losses + (s.draws ? ' – ' + s.draws : '')) : 'no matches yet' }),
            h('dt', { text: 'Win rate' }), h('dd', { text: m ? pct(s.wins / m) : '–' })),
          s.player_id ? h('a', { 'class': 'em-link', href: '/empire/u.html?id=' + encodeURIComponent(s.player_id), text: 'Their matches and cards' }) : null));
      });
      box.appendChild(grid);
    } catch (e) { clear(box).appendChild(errBox(e.message)); }
  }

  // ---- cards ----
  function cardLine(c) {
    var parts = [];
    if (c.spell) parts.push('spell, radius ' + (c.aoe / meta.geometry.tile).toFixed(1) + ' tiles');
    else {
      parts.push((c.count > 1 ? c.count + ' bodies, ' : '') + c.hp + ' health');
      if (c.dmg) parts.push(c.dmg + ' a blow every ' + (c.period / meta.geometry.tps).toFixed(1) + ' s' + (c.range > 400 ? ', ranged' : ''));
    }
    return parts.join(' · ');
  }
  async function pageCards() {
    var box = $('cards'), sort = 'cost';
    try {
      await loadMeta();
      var d = await getJSON('/api/v1/empire/cards');
      var st = d.cards || [];
      $('s-cm').textContent = String(d.matches || 0);
      function draw() {
        var ids = meta.cards.map(function (c) { return c.id; });
        ids.sort(function (a, b) {
          if (sort === 'win') return (st[b].win_rate || 0) - (st[a].win_rate || 0) || a - b;
          if (sort === 'played') return (st[b].plays || 0) - (st[a].plays || 0) || a - b;
          return card(a).cost - card(b).cost || a - b;
        });
        clear(box);
        var grid = h('div', { 'class': 'em-grid3' });
        ids.forEach(function (id) {
          var c = card(id), s = st[id] || {}, g = s.games || 0;
          grid.appendChild(h('article', { 'class': 'em-tile' + (c.mythic ? ' myth' : '') },
            h('h3', null, mark(id), h('span', { text: c.short })),
            h('p', { 'class': 'sub', text: c.name + ' — ' + c.hero }),
            h('p', { text: c.desc }),
            h('dl', { 'class': 'em-kv' },
              h('dt', { text: 'Cost' }), h('dd', { text: c.cost + ' elixir' + (c.mythic ? ' · mythic' : ' · mundane') }),
              h('dt', { text: 'On the board' }), h('dd', { text: cardLine(c) }),
              h('dt', { text: 'In decks' }), h('dd', { text: String(g) + (g ? ' matches' : '') }),
              h('dt', { text: 'Win rate' }), h('dd', { text: g ? pct(s.win_rate) : '–' }),
              h('dt', { text: 'Cast' }), h('dd', { text: g ? (s.plays / g).toFixed(1) + ' a match' : '–' })),
            h('div', { 'class': 'em-bar gold', title: 'win rate' }, h('i', { style: 'width:' + (g ? Math.round(s.win_rate * 100) : 0) + '%' }))));
        });
        box.appendChild(grid);
      }
      document.querySelectorAll('.em-chip').forEach(function (b) {
        b.addEventListener('click', function () {
          sort = b.getAttribute('data-sort');
          document.querySelectorAll('.em-chip').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
          draw();
        });
      });
      draw();
    } catch (e) { clear(box).appendChild(errBox(e.message)); }
  }

  // ---- matches ----
  function ratingDelta(s) {
    var d = Math.round(s.rating_after - s.rating_before);
    return h('span', { 'class': 'em-delta ' + (d >= 0 ? 'up' : 'down'), text: (d >= 0 ? '+' : '') + d });
  }
  function matchRows(list, me) {
    return (list || []).map(function (m) {
      var seat = me && m.seats[1].player_id === me ? 1 : 0;
      var res = m.winner === 2 ? ['DRAW', 'draw'] : (m.winner === seat ? ['WIN', 'win'] : ['LOSS', 'loss']);
      var a = m.seats[0], b = m.seats[1];
      return h('tr', null,
        h('td', null, me ? h('span', { 'class': 'em-pill ' + res[1], text: res[0] }) : h('span', { 'class': 'em-tag', text: m.mode === 'league' ? 'league' : 'ranked' })),
        h('td', null, h('span', { 'class': 'em-vs' }, whoSeat(a), h('span', { 'class': 'em-note', text: 'against' }), whoSeat(b))),
        h('td', { 'class': 'n' }, crowns(a.crowns), ' ', h('span', { 'class': 'em-note', text: ' ' }), crowns(b.crowns)),
        h('td', { 'class': 'n em-kd', text: secs(m.ticks / 20) }),
        h('td', { 'class': 'n em-note', text: REASON[m.reason] || '' }),
        h('td', { 'class': 'n' }, me ? ratingDelta(m.seats[seat]) : null),
        h('td', { 'class': 'n em-note', text: ago(m.played_at) }),
        h('td', { 'class': 'n' }, h('a', { 'class': 'em-link', href: '/empire/m.html?id=' + m.id, text: 'Open' }), '  ',
          h('a', { 'class': 'em-link', href: '/empire/watch.html?replay=' + m.id, text: 'Replay' })));
    });
  }
  function matchTable(list, me) {
    return table([{ t: me ? 'Result' : 'Kind' }, { t: 'Match' }, { t: 'Towers', n: 1 }, { t: 'Time', n: 1 }, { t: 'Ended', n: 1 }, { t: me ? 'Rating' : '', n: 1 }, { t: '', n: 1 }, { t: '', n: 1 }], matchRows(list, me));
  }
  async function pageMatches() {
    var box = $('matches'), mode = '';
    async function load() {
      try {
        var d = await getJSON('/api/v1/empire/matches?limit=60' + (mode ? '&mode=' + mode : ''));
        var list = d.matches || [];
        clear(box);
        if (!list.length) { box.appendChild(empty('No matches yet', 'Press play on the Play page, or wait for the AIs to sit down to a league match.')); return; }
        box.appendChild(matchTable(list, null));
        $('s-shown').textContent = String(list.length);
        $('s-human').textContent = String(list.filter(function (m) { return m.seats[0].kind === 'human' || m.seats[1].kind === 'human'; }).length);
      } catch (e) { clear(box).appendChild(errBox(e.message)); }
    }
    document.querySelectorAll('.em-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        mode = b.getAttribute('data-mode');
        document.querySelectorAll('.em-chip').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        load();
      });
    });
    load();
  }

  // ---- one match ----
  var STAT_ROWS = [['plays', 'cards played'], ['mythic', 'mythic casts'], ['spells', 'spells'], ['deployed', 'troops put down'], ['lost', 'troops lost'], ['kills', 'troops felled'],
    ['damage', 'damage dealt'], ['tower_damage', 'tower damage'], ['healed', 'health mended'], ['elixir_spent', 'elixir spent'], ['elixir_pumped', 'elixir collected'],
    ['lowest_standing', 'lowest standing'], ['cancelled_ticks', 'seconds cancelled']];
  async function pageMatch() {
    var id = new URLSearchParams(location.search).get('id') || '', body = $('match');
    if (!id) { clear(body).appendChild(empty('Which match?', 'Open one from the Matches page.')); return; }
    try {
      await loadMeta();
      var m = await getJSON('/api/v1/empire/matches/' + encodeURIComponent(id));
      var a = m.seats[0], b = m.seats[1];
      document.title = a.name + ' against ' + b.name + ' — WOTAN EMPIRE';
      clear($('m-title')).appendChild(document.createTextNode(a.name + ' against ' + b.name));
      $('m-sub').textContent = (m.mode === 'league' ? 'AI league' : 'Ranked') + ' · ' + secs(m.ticks / 20) + ' · ' + (m.winner === 2 ? 'a draw' : (m.seats[m.winner].name + ' won')) +
        ' (' + (REASON[m.reason] || '') + ') · ' + ago(m.played_at);
      clear(body);
      var s0 = m.stats ? m.stats[0] : {}, s1 = m.stats ? m.stats[1] : {};
      var rows = [h('div', { 'class': 'em-statrow' }, h('span', null, crowns(a.crowns)), h('span', { text: 'crowns' }), h('span', null, crowns(b.crowns))),
        h('div', { 'class': 'em-statrow' }, h('span', { text: String(a.tower_hp) }), h('span', { text: 'tower health left' }), h('span', { text: String(b.tower_hp) })),
        h('div', { 'class': 'em-statrow' }, h('span', { text: String(a.towers) }), h('span', { text: 'towers standing' }), h('span', { text: String(b.towers) }))];
      STAT_ROWS.forEach(function (r) {
        var x = s0[r[0]], y = s1[r[0]];
        if (r[0] === 'cancelled_ticks') { x = Math.round((x || 0) / 20); y = Math.round((y || 0) / 20); }
        rows.push(h('div', { 'class': 'em-statrow' }, h('span', { text: String(x === undefined ? '–' : x) }), h('span', { text: r[1] }), h('span', { text: String(y === undefined ? '–' : y) })));
      });
      rows.push(h('div', { 'class': 'em-statrow' }, h('span', { text: String(Math.round((s0.elixir_wasted_milli || 0) / 1000)) }), h('span', { text: 'elixir left unused' }), h('span', { text: String(Math.round((s1.elixir_wasted_milli || 0) / 1000)) })));
      function side(s, i) {
        return h('section', { 'class': 'em-panel' }, h('h2', { 'class': 'em-h2' }, whoSeat(s)),
          h('p', { 'class': 'em-note', style: 'margin:0 0 .6rem' }, facTag(s.faction), '  ·  rating ', String(Math.round(s.rating_before)), ' → ', String(Math.round(s.rating_after)), '  ', m.counted ? ratingDelta(s) : null),
          h('div', null, deckRow(s.deck)),
          h('table', { 'class': 'em-table', style: 'margin-top:.7rem' }, h('tbody', null, s.deck.map(function (cid) {
            var c = card(cid);
            return h('tr', null, h('td', null, mark(cid), ' ', c.short), h('td', { 'class': 'n', text: ((m.plays && m.plays[i]) ? (m.plays[i][cid] || 0) : 0) + ' cast' }));
          }))));
      }
      body.appendChild(h('div', { 'class': 'em-two' }, side(a, 0), side(b, 1)));
      body.appendChild(h('section', { 'class': 'em-panel', style: 'margin-top:1.1rem' }, h('h2', { 'class': 'em-h2', text: 'What the board counted' }), h('div', null, rows)));
      body.appendChild(h('div', { 'class': 'em-actions' },
        h('a', { 'class': 'em-btn', href: '/empire/watch.html?replay=' + m.id, text: 'Watch the replay' }),
        h('a', { 'class': 'em-btn ghost', href: '/empire/matches.html', text: 'All matches' })));
    } catch (e) { clear(body).appendChild(e.status === 404 ? empty('No such match', 'It may have been removed.') : errBox(e.message)); }
  }

  // ---- profile ----
  async function pageProfile() {
    var id = new URLSearchParams(location.search).get('id') || '';
    var body = $('profile');
    if (!id) {
      var s = null; try { s = typeof getIdunaSession === 'function' ? getIdunaSession() : null; } catch (e) { s = null; }
      if (s && s.playerID) { location.replace('/empire/u.html?id=' + encodeURIComponent(s.playerID)); return; }
      clear(body).appendChild(empty('Which player?', 'Open a profile from the ladder, or sign in to see your own.'));
      return;
    }
    try {
      await loadMeta();
      var d = await getJSON('/api/v1/empire/players/' + encodeURIComponent(id));
      var p = d.player, m = p.matches || 0;
      document.title = (p.display_name || 'Player') + ' — WOTAN EMPIRE';
      clear($('p-name')).appendChild(document.createTextNode(p.display_name || 'Player'));
      if (p.kind === 'bot') $('p-name').appendChild(h('span', { 'class': 'em-tag bot', text: 'AI' }));
      $('p-r').textContent = m ? String(Math.round(p.rating)) : '–';
      $('p-rank').textContent = d.rank ? '#' + d.rank : '–';
      $('p-w').textContent = String(p.wins); $('p-l').textContent = String(p.losses);
      $('p-wr').textContent = m ? pct(p.wins / m) : '–';
      $('p-streak').textContent = d.streak ? (d.streak > 0 ? d.streak + ' won' : (-d.streak) + ' lost') : '–';
      clear(body);
      if (d.last_deck && d.last_deck.length) {
        body.appendChild(h('section', { 'class': 'em-panel', style: 'margin-bottom:1.1rem' }, h('h2', { 'class': 'em-h2', text: 'The eight they last played' }),
          h('div', null, deckRow(d.last_deck)), '  ', facTag(d.last_faction)));
      }
      var cs = (d.cards || []).filter(function (c) { return c.games > 0; }).sort(function (a, b) { return b.plays - a.plays; });
      if (cs.length) {
        body.appendChild(h('section', { 'class': 'em-panel', style: 'margin-bottom:1.1rem' }, h('h2', { 'class': 'em-h2', text: 'Their cards' }),
          table([{ t: 'Card' }, { t: 'Matches', n: 1 }, { t: 'Cast', n: 1 }, { t: 'Win rate', n: 1 }], cs.map(function (c) {
            return h('tr', null, h('td', null, mark(c.card), ' ', card(c.card).short), h('td', { 'class': 'n', text: String(c.games) }), h('td', { 'class': 'n', text: String(c.plays) }),
              h('td', { 'class': 'n', text: pct(c.win_rate) }));
          }))));
      }
      if (d.recent && d.recent.length) {
        body.appendChild(h('section', { 'class': 'em-panel' }, h('h2', { 'class': 'em-h2', text: 'Recent matches' }), matchTable(d.recent, id),
          d.resigned ? h('p', { 'class': 'em-note', style: 'margin:.8rem 0 0', text: 'Matches an opponent resigned: ' + d.resigned + '.' }) : null));
      } else {
        body.appendChild(h('section', { 'class': 'em-panel' }, h('p', { 'class': 'em-note', text: 'No matches yet.' })));
      }
    } catch (e) {
      clear(body).appendChild(e.status === 404 ? empty('No EMPIRE record', 'This player has not finished an EMPIRE match yet.') : errBox(e.message));
    }
  }

  var page = document.body.getAttribute('data-page');
  if (page === 'board') pageBoard();
  else if (page === 'ais') pageAIs();
  else if (page === 'cards') pageCards();
  else if (page === 'live') pageLive();
  else if (page === 'matches') pageMatches();
  else if (page === 'match') pageMatch();
  else if (page === 'profile') pageProfile();
})();
