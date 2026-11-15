// Ladder / Matches / player pages for the browser games IDUNA referees: shankpit-460 (/shankpit-460/) and Bedrock Racers
// (/bedrockracers/). Founder real-time, 2026-11-15: "we need esports and stats up asap". One script: the game comes from
// <body data-game="sp|br">, the page from data-page="board|matches|player". Data is IDUNA's public reads, same origin:
//   GET /api/v1/games/{shankpit460|bedrockracers}/leaderboard?limit=   the rated ladder (game_player_stats)
//   GET /api/v1/{shankpit460|bedrockracers}/matches?limit=&player_id=   recent matches with the people in them
//   GET /api/v1/{shankpit460|bedrockracers}/matches/{id}                one match (Bedrock Racers: every car, bots included)
//   GET /api/v1/{shankpit460|bedrockracers}/players/{id}                rating, rank, record, totals, recent matches
//   GET /api/v1/{shankpit460|bedrockracers}/leaders?stat=&limit=        the top of one statistic
// House rule (as d2-pages.js and rg-pages.js): user text only ever goes through textContent.
(function () {
  'use strict';

  var GAMES = {
    sp: {
      slug: 'shankpit460', base: '/shankpit-460/', name: 'shankpit-460',
      leaders: [['kills', 'Most kills', 0], ['wins', 'Most wins', 0], ['best', 'Most kills in a match', 0], ['kd', 'Best K/D (5+ matches)', 2]]
    },
    br: {
      slug: 'bedrockracers', base: '/bedrockracers/', name: 'Bedrock Racers',
      leaders: [['goals', 'Goals', 0], ['assists', 'Assists', 0], ['steals', 'Steals', 0], ['wins', 'Wins', 0]]
    }
  };
  var G = GAMES[document.body.getAttribute('data-game')];
  if (!G) return;
  var API = '/api/v1/' + G.slug;

  // Bedrock Racers' four teams, as the game names and colours them (PARENA stdlib/bedrockracers/web/br_arena.prn)
  var TEAMS = [['Amber', 'rgb(236,184,92)'], ['Teal', 'rgb(84,190,178)'], ['Violet', 'rgb(166,134,220)'], ['Coral', 'rgb(232,112,98)']];

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
  function param(k) { return new URLSearchParams(window.location.search).get(k); }
  function when(iso) {
    var t = new Date(String(iso).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z')).getTime();
    if (isNaN(t)) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function clock(seconds) {
    var s = Math.max(0, Math.round(seconds));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function pct(x) { return Math.round(x * 100) + '%'; }
  async function getJSON(path) {
    var res = await fetch(path, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      var e = new Error(res.status === 404 ? 'Not found' : 'IDUNA answered ' + res.status);
      e.status = res.status;
      throw e;
    }
    return res.json();
  }
  function skel() { return h('div', { 'class': 'as-skel', 'aria-hidden': 'true' }); }
  function empty(title, text, link) {
    return h('div', { 'class': 'as-empty' }, h('b', { text: title }), h('p', null, text,
      link ? [' ', h('a', { href: link[1], text: link[0] })] : null));
  }
  function errBox(msg) { return empty('Could not load', msg + '. Try again in a minute.'); }
  function table(cols, rows) {
    var head = h('thead', null, h('tr', null, cols.map(function (c) {
      return h('th', { 'class': [c.n ? 'n' : '', c.wide ? 'wide' : ''].join(' ').trim() || null, scope: 'col', text: c.t });
    })));
    return h('div', { 'class': 'as-scroll' }, h('table', { 'class': 'as-table' }, head, h('tbody', null, rows)));
  }
  function playerLink(id, name) {
    if (!id) return h('span', { text: name || 'Guest' });
    return h('a', { href: G.base + 'u.html?id=' + encodeURIComponent(id), text: name || 'Player' });
  }
  function resultTag(r) {
    var label = { win: 'Win', loss: 'Loss', draw: 'Draw', left: 'Left' }[r] || r || '';
    return label ? h('span', { 'class': 'as-tag ' + (r || ''), text: label }) : null;
  }
  function delta(before, after, rated) {
    if (!rated || !before) return h('span', { 'class': 'as-delta', text: '–' });
    var d = after - before, r = Math.round(d);
    var txt = (r > 0 ? '+' : (r < 0 ? '−' : '±')) + Math.abs(r);
    return h('span', { 'class': 'as-delta ' + (r > 0 ? 'up' : (r < 0 ? 'down' : '')), title: Math.round(before) + ' → ' + Math.round(after), text: txt });
  }
  function teamChip(t, score, won) {
    var tm = TEAMS[t] || ['Team ' + (t + 1), 'var(--i-line)'];
    return h('span', { 'class': 'as-team' + (won ? ' won' : '') }, h('i', { style: 'background:' + tm[1], 'aria-hidden': 'true' }), tm[0],
      score === null ? null : h('b', { text: String(score) }));
  }

  // ---- the ladder ---------------------------------------------------------------------------------------------------
  async function pageBoard() {
    var board = $('board');
    board.appendChild(skel());
    var all;
    try {
      all = (await getJSON('/api/v1/games/' + G.slug + '/leaderboard?limit=100')).filter(function (p) { return p.matches > 0; });
    } catch (e) {
      clear(board).appendChild(errBox(e.message));
      return;
    }
    $('s-players').textContent = String(all.length);
    $('s-top').textContent = all.length ? String(Math.round(all[0].rating)) : '–';
    clear(board);
    if (!all.length) {
      board.appendChild(empty('No rated matches yet', 'The ladder fills in as people with an account finish online matches.', ['Play now', G.base]));
    } else {
      var rows = all.map(function (p, i) {
        var played = p.wins + p.losses + p.draws;
        return h('tr', { 'class': i === 0 ? 'top' : null },
          h('td', { 'class': 'rank n', text: String(i + 1) }),
          h('td', { 'class': 'who' }, playerLink(p.player_id, p.display_name)),
          h('td', { 'class': 'n' }, h('span', { 'class': 'as-rating', text: String(Math.round(p.rating)) })),
          h('td', { 'class': 'n', text: p.wins + '–' + p.losses + '–' + p.draws }),
          h('td', { 'class': 'n wide', text: String(p.matches) }),
          h('td', { 'class': 'n wide', text: played ? pct(p.wins / played) : '–' }));
      });
      board.appendChild(table([{ t: '#', n: 1 }, { t: 'Player' }, { t: 'Rating', n: 1 }, { t: 'W–L–D', n: 1 },
        { t: 'Matches', n: 1, wide: 1 }, { t: 'Win rate', n: 1, wide: 1 }], rows));
    }
    var leaders = $('leaders');
    if (!leaders) return;
    G.leaders.forEach(function (s) {
      var card = h('div', { 'class': 'as-panel as-leader' }, h('h3', { text: s[1] }));
      leaders.appendChild(card);
      getJSON(API + '/leaders?stat=' + s[0] + '&limit=5').then(function (d) {
        var list = d.leaders || [];
        if (!list.length) { card.appendChild(h('p', { 'class': 'as-note', text: 'Nobody yet.' })); return; }
        card.appendChild(h('ol', null, list.map(function (x) {
          var v = s[2] ? Number(x.value).toFixed(s[2]) : String(Math.round(x.value));
          return h('li', null, h('span', null, playerLink(x.player_id, x.display_name)), h('b', { text: v }));
        })));
      }).catch(function () { card.appendChild(h('p', { 'class': 'as-note', text: 'Could not load.' })); });
    });
  }

  // ---- matches --------------------------------------------------------------------------------------------------------
  var SP_REASON = { kills: 'kill limit', time: 'time limit', abandoned: 'abandoned' };
  var BR_REASON = { 1: 'goal limit', 2: 'time', 3: 'golden goal', 4: 'closed' };

  function spRoster(m) {
    var rows = (m.roster || []).map(function (l) {
      return h('tr', { 'class': l.place === 1 && !l.left ? 'top' : null },
        h('td', { 'class': 'rank n', text: String(l.place) }),
        h('td', { 'class': 'who' }, playerLink(l.player_id, l.name), l.kind === 'guest' ? h('span', { 'class': 'as-tag', text: 'guest' }) : null),
        h('td', { 'class': 'n', text: String(l.kills) }),
        h('td', { 'class': 'n', text: String(l.deaths) }),
        h('td', null, resultTag(l.result)),
        h('td', { 'class': 'n' }, delta(l.rating_before, l.rating_after, m.counted && l.kind === 'human')));
    });
    return table([{ t: '#', n: 1 }, { t: 'Player' }, { t: 'K', n: 1 }, { t: 'D', n: 1 }, { t: 'Result' }, { t: 'Rating', n: 1 }], rows);
  }

  function brRoster(m) {
    var cars = (m.cars || []).slice().sort(function (a, b) { return a.team - b.team || a.slot - b.slot; });
    var rows = cars.map(function (c) {
      return h('tr', null,
        h('td', null, teamChip(c.team, null, m.winner === c.team)),
        h('td', { 'class': 'who' }, c.kind === 'bot' ? h('span', { text: c.name || 'Bot' }) : playerLink(c.player_id, c.name),
          c.kind === 'bot' ? h('span', { 'class': 'as-tag', text: 'bot' }) : (c.kind === 'anon' ? h('span', { 'class': 'as-tag', text: 'guest' }) : null)),
        h('td', { 'class': 'n', text: String(c.goals) }),
        h('td', { 'class': 'n', text: String(c.assists) }),
        h('td', { 'class': 'n wide', text: String(c.steals) }),
        h('td', null, c.kind === 'bot' ? null : resultTag(c.result)),
        h('td', { 'class': 'n' }, delta(c.rating_before, c.rating_after, m.counted && c.kind === 'human')));
    });
    return table([{ t: 'Team' }, { t: 'Player' }, { t: 'Goals', n: 1 }, { t: 'Assists', n: 1 }, { t: 'Steals', n: 1, wide: 1 }, { t: 'Result' },
      { t: 'Rating', n: 1 }], rows);
  }

  function matchCard(m) {
    var card = h('article', { 'class': 'as-panel as-match' });
    var title, meta;
    if (G.slug === 'shankpit460') {
      title = m.winner_name ? m.winner_name + ' wins' : (m.reason === 'time' ? 'A draw' : 'No winner');
      meta = [when(m.played_at), SP_REASON[m.reason] || m.reason, clock(m.live_ms / 1000), m.players + ' players'];
    } else {
      title = m.winner >= 0 ? (TEAMS[m.winner] || ['Team ' + (m.winner + 1)])[0] + ' wins' : 'A draw';
      meta = [when(m.played_at), BR_REASON[m.reason] || 'ended', clock(m.ticks / 62.5) + (m.overtime ? ' (overtime)' : ''),
        m.humans + (m.humans === 1 ? ' person' : ' people')];
    }
    card.appendChild(h('div', { 'class': 'as-match-head' },
      h('b', { text: title }),
      h('span', { 'class': 'as-match-meta', text: meta.filter(Boolean).join(' · ') }),
      h('span', { 'class': 'sp' }),
      m.counted ? null : h('span', { 'class': 'as-tag', title: 'Too short, or nobody with an account: no rating moved', text: 'not rated' })));
    if (G.slug === 'shankpit460') {
      card.appendChild(spRoster(m));
    } else {
      card.appendChild(h('div', { 'class': 'as-teams' }, (m.scores || []).map(function (s, t) { return teamChip(t, s, m.winner === t); })));
      var holder = h('div', null, brRoster(m));
      card.appendChild(holder);
      var more = h('button', { type: 'button', 'class': 'as-more', text: 'Show every car, bots included' });
      more.addEventListener('click', function () {
        more.disabled = true;
        getJSON(API + '/matches/' + encodeURIComponent(m.id)).then(function (full) {
          clear(holder).appendChild(brRoster(full));
          more.remove();
        }).catch(function () { more.disabled = false; more.textContent = 'Could not load: try again'; });
      });
      card.appendChild(h('div', { style: 'padding:.4rem .9rem .7rem' }, more));
    }
    return card;
  }

  async function pageMatches() {
    var list = $('matches');
    var pid = param('player_id');
    list.appendChild(skel());
    var d;
    try {
      d = await getJSON(API + '/matches?limit=50' + (pid ? '&player_id=' + encodeURIComponent(pid) : ''));
    } catch (e) {
      clear(list).appendChild(errBox(e.message));
      return;
    }
    clear(list);
    var ms = d.matches || [];
    if (pid && $('m-scope')) {
      $('m-scope').textContent = 'One player’s matches. ';
      $('m-scope').appendChild(h('a', { href: G.base + 'matches.html', text: 'Show everyone’s' }));
    }
    if (!ms.length) {
      list.appendChild(empty('No matches yet', 'Online matches show up here the moment they end.', ['Play now', G.base]));
      return;
    }
    ms.forEach(function (m) { list.appendChild(matchCard(m)); });
  }

  // ---- one player -------------------------------------------------------------------------------------------------------
  function tile(value, label) { return h('div', { 'class': 'i-stat' }, h('b', { text: String(value) }), h('span', { text: label })); }

  async function pagePlayer() {
    var id = param('id'), main = $('player');
    if (!id) {
      main.appendChild(empty('No player chosen', 'Pick someone from the ladder.', ['Open the ladder', G.base + 'ladder.html']));
      return;
    }
    main.appendChild(skel());
    var d;
    try {
      d = await getJSON(API + '/players/' + encodeURIComponent(id));
    } catch (e) {
      clear(main).appendChild(e.status === 404 ? empty('No such player', 'Nobody with that id has played ' + G.name + '.', ['Open the ladder', G.base + 'ladder.html'])
        : errBox(e.message));
      return;
    }
    clear(main);
    var p = d.player || {}, t = d.totals || {};
    $('p-name').textContent = p.display_name || 'Player';
    document.title = (p.display_name || 'Player') + ' — ' + G.name + ' — WOTAN';
    var tiles = [tile(p.matches ? Math.round(p.rating) : '–', 'Rating'), tile(d.rank ? '#' + d.rank : '–', 'Rank'),
      tile(p.wins + '–' + p.losses + '–' + p.draws, 'W–L–D')];
    if (G.slug === 'shankpit460') {
      tiles.push(tile(t.kills || 0, 'Kills'), tile(t.deaths || 0, 'Deaths'), tile(t.deaths ? (t.kills / t.deaths).toFixed(2) : (t.kills ? String(t.kills) : '–'), 'K/D'),
        tile(t.best_kills || 0, 'Kills, best match'));
    } else {
      tiles.push(tile(t.goals || 0, 'Goals'), tile(t.assists || 0, 'Assists'), tile(t.steals || 0, 'Steals'), tile(t.passes || 0, 'Passes'));
    }
    main.appendChild(h('div', { 'class': 'as-tiles' }, tiles));
    var notes = [];
    if (t.left) notes.push('Left ' + t.left + (t.left === 1 ? ' match' : ' matches') + ' before the end (each counts as a loss).');
    if (!p.matches) notes.push('No rated match yet: the rating starts at 1500.');
    if (notes.length) main.appendChild(h('p', { 'class': 'as-note', text: notes.join(' ') }));

    var recent = d.recent || [];
    var sec = h('section', { 'class': 'as-section' }, h('div', { 'class': 'as-section-head' }, h('h2', { 'class': 'as-h2', text: 'Recent matches' }),
      recent.length ? h('a', { 'class': 'i-link', href: G.base + 'matches.html?player_id=' + encodeURIComponent(id), text: 'Full scoreboards' }) : null));
    main.appendChild(sec);
    if (!recent.length) {
      sec.appendChild(h('div', { 'class': 'as-panel' }, empty('Nothing yet', 'Their online matches will show up here.')));
      return;
    }
    var rows = recent.map(function (m) {
      var detail;
      if (G.slug === 'shankpit460') {
        detail = [h('td', { 'class': 'n', text: m.place + ' of ' + m.players }), h('td', { 'class': 'n', text: m.kills + ' / ' + m.deaths })];
      } else {
        detail = [h('td', null, teamChip(m.team, (m.scores || [])[m.team], m.winner === m.team)), h('td', { 'class': 'n', text: m.goals + ' / ' + m.assists })];
      }
      return h('tr', null, h('td', { text: when(m.played_at) }), h('td', null, resultTag(m.result)), detail,
        h('td', { 'class': 'n' }, delta(m.rating_before, m.rating_after, m.counted)));
    });
    var cols = G.slug === 'shankpit460'
      ? [{ t: 'When' }, { t: 'Result' }, { t: 'Place', n: 1 }, { t: 'K / D', n: 1 }, { t: 'Rating', n: 1 }]
      : [{ t: 'When' }, { t: 'Result' }, { t: 'Team' }, { t: 'Goals / assists', n: 1 }, { t: 'Rating', n: 1 }];
    sec.appendChild(h('div', { 'class': 'as-panel' }, table(cols, rows)));
  }

  var page = document.body.getAttribute('data-page');
  if (page === 'board') pageBoard();
  else if (page === 'matches') pageMatches();
  else if (page === 'player') pagePlayer();
})();
