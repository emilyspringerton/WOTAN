// /clubs/w.html?s=slug -- members workspace: roster wall, strategy feed (post/comment/pin), scrim and
// win-rate matrix + contributor board (reads /clubs/{id}/analytics/*, empty state when those 404).
(function () {
  'use strict';
  var h = UI.h, P = ClubPerms;
  var root = UI.$('root');
  var slug = (UI.params().get('s') || '').trim().toLowerCase();
  var g, myHandle = '', panelEl, tabs = {};

  function enc(x) { return encodeURIComponent(x); }
  function base() { return '/' + enc(g.id); }

  async function init() {
    g = await CUI.memberGate(root, slug, init);
    if (!g) return;
    if (!P.has(g.perms, 'club.view')) { UI.clear(root); root.setAttribute('aria-busy', 'false'); root.appendChild(CUI.notFound()); return; }
    var club = g.club;
    if (!club) { try { club = await CLUB.get('/by-slug/' + enc(slug)); } catch (e) { club = null; } }
    club = club || g.summary || {};
    try { var who = await HS.who(); myHandle = (who.me && who.me.handle) || ''; } catch (e) { myHandle = ''; }

    document.title = (club.name || slug) + ' workspace — WOTAN Clubs';
    UI.clear(root); root.setAttribute('aria-busy', 'false');
    CUI.setBrand(root, club.brand);
    root.appendChild(h('header', { 'class': 'club-head' },
      h('div', { 'class': 'badges' }, CUI.tierBadge(CUI.tierOf(club)), CUI.roleBadge(g.role), h('span', { 'class': 'hs-badge plain', text: 'Members only' })),
      h('h1', { 'class': 'hs-h1', text: club.name || slug }),
      h('p', { 'class': 'hs-meta', text: 'Workspace. Nothing on this page is visible to non-members.' })));
    root.appendChild(CUI.subnav(slug, 'w', g.perms));

    var names = [['roster', 'Roster'], ['feed', 'Strategy feed'], ['scrims', 'Scrims & win rates']];
    var bar = h('div', { 'class': 'hs-tabs', role: 'tablist', 'aria-label': 'Workspace' });
    names.forEach(function (n) {
      var t = h('button', { 'class': 'hs-tab', role: 'tab', id: 'tab-' + n[0], 'aria-selected': 'false', 'aria-controls': 'wspanel', text: n[1], type: 'button', on: { click: function () { select(n[0]); } } });
      tabs[n[0]] = t; bar.appendChild(t);
    });
    panelEl = h('div', { id: 'wspanel', role: 'tabpanel' });
    root.appendChild(bar); root.appendChild(panelEl);
    var want = (location.hash || '').replace('#', '');
    select(tabs[want] ? want : 'roster');
  }

  function select(name) {
    Object.keys(tabs).forEach(function (k) { tabs[k].setAttribute('aria-selected', String(k === name)); });
    panelEl.setAttribute('aria-labelledby', 'tab-' + name);
    try { history.replaceState(null, '', location.pathname + location.search + '#' + name); } catch (e) { /* ignore */ }
    UI.clear(panelEl);
    if (name === 'roster') rosterTab(panelEl);
    else if (name === 'feed') feedTab(panelEl);
    else scrimTab(panelEl);
  }

  // ---- roster wall ----
  async function rosterTab(box) {
    if (!P.has(g.perms, 'club.roster.view')) { box.appendChild(UI.emptyState('Roster hidden', 'Your role cannot see the internal roster.')); return; }
    UI.skeleton(box, 3, 'row');
    try {
      var items = CLUB.items(await CLUB.get(base() + '/members'));
      UI.clear(box);
      items.sort(function (a, b) {
        var d = (P.RANK[CUI.roleOfMember(b)] || 0) - (P.RANK[CUI.roleOfMember(a)] || 0);
        return d || String(CUI.handleOf(a)).localeCompare(String(CUI.handleOf(b)));
      });
      if (!items.length) { box.appendChild(UI.emptyState('No members', 'This should not happen: a club always has a manager.')); return; }
      box.appendChild(h('p', { 'class': 'hs-meta', text: items.length + (items.length === 1 ? ' member' : ' members') + '. Ranks without a “verified” mark are self-declared.' }));
      box.appendChild(h('div', { 'class': 'club-roster wall' }, items.map(function (m) {
        return CUI.memberRow(m, m.joined_at ? h('span', { 'class': 'hs-meta', text: 'Joined ' + UI.ago(m.joined_at) }) : null);
      })));
    } catch (e) { UI.clear(box); box.appendChild(UI.errorState(e.message, function () { UI.clear(box); rosterTab(box); })); }
  }

  // ---- strategy feed ----
  var FEED_PAGE = 20;
  async function feedTab(box) {
    if (!P.has(g.perms, 'club.feed.read')) { box.appendChild(UI.emptyState('Feed hidden', 'Your role cannot read the strategy feed.')); return; }
    var listEl = h('div', { 'class': 'hs-list' });
    var moreWrap = h('div', { 'class': 'hs-more', hidden: true });
    var moreBtn = h('button', { type: 'button', 'class': 'hs-btn', text: 'Show older posts' });
    moreWrap.appendChild(moreBtn);
    if (P.has(g.perms, 'club.feed.post')) box.appendChild(composer(listEl));
    box.appendChild(listEl); box.appendChild(moreWrap);
    var offset = 0, total = 0;
    async function load() {
      try {
        var res = await CLUB.get(base() + '/feed', { limit: FEED_PAGE, offset: offset });
        var items = CLUB.items(res);
        total = (res && res.total) || 0;
        items.forEach(function (p) { listEl.appendChild(postNode(p)); });
        offset += items.length;
        if (!listEl.children.length) listEl.appendChild(UI.emptyState('Nothing posted yet', 'Share a matchup note, a list tweak, or a scrim result.'));
        moreWrap.hidden = !(offset < total && items.length);
      } catch (e) { listEl.appendChild(UI.errorState(e.message, function () { UI.clear(listEl); load(); })); }
      moreBtn.disabled = false;
    }
    moreBtn.addEventListener('click', function () { moreBtn.disabled = true; load(); });
    load();
  }

  function composer(listEl) {
    var ta = h('textarea', { 'class': 'hs-textarea', maxlength: '2000', rows: '3', placeholder: 'Post to the club (members only)', 'aria-label': 'New post' });
    var count = h('span', { 'class': 'hs-count', text: '0 / 2000' });
    var err = h('p', { 'class': 'hs-msg err', role: 'alert', hidden: true });
    var btn = h('button', { type: 'submit', 'class': 'hs-btn solid sm', text: 'Post' });
    ta.addEventListener('input', function () { count.textContent = ta.value.length + ' / 2000'; });
    var form = h('form', { 'class': 'hs-composer' }, ta, h('div', { 'class': 'hs-composer-foot' }, count, btn), err);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var body = ta.value.trim();
      if (!body) return;
      UI.withBusy(btn, async function () {
        err.hidden = true;
        try {
          var post = await CLUB.post(base() + '/feed', { body: body });
          var empty = listEl.querySelector('.hs-empty'); if (empty) empty.remove();
          listEl.insertBefore(postNode(post && post.id ? post : { id: post && post.id, body: body, handle: myHandle, created_at: new Date().toISOString() }), listEl.firstChild);
          ta.value = ''; count.textContent = '0 / 2000';
        } catch (e) { err.textContent = CUI.errMessage(e); err.hidden = false; }
      });
    });
    return form;
  }

  function postNode(p) {
    var pid = p.id;
    var author = CUI.handleOf(p);
    var canMod = P.has(g.perms, 'club.feed.moderate');
    var mine = p.mine === true || p.is_mine === true || (myHandle && author && author.toLowerCase() === myHandle.toLowerCase());
    var pinned = !!p.pinned;
    var el = h('article', { 'class': 'hs-post' });
    var pinMark = h('span', { 'class': 'club-pin', text: 'Pinned', hidden: !pinned });
    var cWrap = null, cCount = typeof p.comments === 'number' ? p.comments : (typeof p.comment_count === 'number' ? p.comment_count : 0);
    var cBtn = h('button', { type: 'button', 'class': 'hs-btn sm ghost', text: commentLabel(cCount), 'aria-expanded': 'false' });
    function commentLabel(n) { return n ? n + (n === 1 ? ' comment' : ' comments') : 'Comment'; }
    el.appendChild(h('div', { 'class': 'hs-post-head' }, CUI.nameLink(p, author), h('span', { 'class': 'hs-meta', text: UI.ago(p.created_at) }), pinMark));
    el.appendChild(h('div', { 'class': 'hs-post-body', text: p.body || '' }));
    if (p.pinned_deck_id) el.appendChild(h('p', { 'class': 'hs-meta' }, 'Pinned deck: ', h('a', { href: UI.deckURL(p.pinned_deck_id), text: 'open deck' })));
    var actions = h('div', { 'class': 'hs-post-actions' }, cBtn);
    if (pid !== undefined && pid !== null) {
      if (canMod) {
        var pinBtn = h('button', { type: 'button', 'class': 'hs-btn sm ghost', text: pinned ? 'Unpin' : 'Pin' });
        pinBtn.addEventListener('click', function () {
          UI.withBusy(pinBtn, async function () {
            try { await CLUB.put(base() + '/feed/' + enc(pid) + '/pin', { pinned: !pinned }); pinned = !pinned; pinBtn.textContent = pinned ? 'Unpin' : 'Pin'; pinMark.hidden = !pinned; }
            catch (e) { UI.toast(CUI.errMessage(e), 'err'); }
          });
        });
        actions.appendChild(pinBtn);
      }
      if (canMod || mine) {
        actions.appendChild(h('button', { type: 'button', 'class': 'hs-link-btn', text: 'Delete', on: { click: function () {
          if (!window.confirm('Delete this post?')) return;
          CLUB.del(base() + '/feed/' + enc(pid)).then(function () { el.remove(); }, function (e) { UI.toast(CUI.errMessage(e), 'err'); });
        } } }));
      }
    }
    el.appendChild(actions);
    cBtn.addEventListener('click', function () {
      if (cWrap) { cWrap.hidden = !cWrap.hidden; cBtn.setAttribute('aria-expanded', String(!cWrap.hidden)); return; }
      cWrap = h('div', { 'class': 'hs-thread' });
      el.appendChild(cWrap);
      cBtn.setAttribute('aria-expanded', 'true');
      loadComments(cWrap, pid, function (n) { cCount = n; cBtn.textContent = commentLabel(n); });
    });
    return el;
  }

  async function loadComments(wrap, pid, onCount) {
    if (pid === undefined || pid === null) return;
    var listEl = h('div', { 'class': 'hs-list' });
    wrap.appendChild(listEl);
    try {
      var items = CLUB.items(await CLUB.get(base() + '/feed/' + enc(pid) + '/comments'));
      items.forEach(function (c) { listEl.appendChild(commentNode(c)); });
      onCount(items.length);
    } catch (e) { listEl.appendChild(h('p', { 'class': 'hs-msg err', text: CUI.errMessage(e) })); }
    if (!P.has(g.perms, 'club.feed.post')) return;
    var ta = h('textarea', { 'class': 'hs-textarea', maxlength: '1000', rows: '2', 'aria-label': 'Write a comment', style: { 'min-height': '3.5rem' } });
    var btn = h('button', { type: 'submit', 'class': 'hs-btn sm solid', text: 'Reply' });
    var err = h('p', { 'class': 'hs-msg err', role: 'alert', hidden: true });
    var form = h('form', { 'class': 'hs-composer' }, ta, h('div', { 'class': 'hs-composer-foot' }, h('span'), btn), err);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var body = ta.value.trim();
      if (!body) return;
      UI.withBusy(btn, async function () {
        err.hidden = true;
        try {
          var c = await CLUB.post(base() + '/feed/' + enc(pid) + '/comments', { body: body });
          listEl.appendChild(commentNode(c && c.body ? c : { body: body, handle: myHandle, created_at: new Date().toISOString() }));
          ta.value = '';
          onCount(listEl.children.length);
        } catch (e) { err.textContent = CUI.errMessage(e); err.hidden = false; }
      });
    });
    wrap.appendChild(form);
  }
  function commentNode(c) {
    var a = CUI.handleOf(c);
    return h('div', { 'class': 'hs-comment' },
      h('div', { 'class': 'hs-comment-head' }, CUI.nameLink(c, a), h('span', { 'class': 'hs-meta', text: UI.ago(c.created_at) })),
      h('div', { 'class': 'hs-comment-body', text: c.body || '' }));
  }

  // ---- scrims: matchup matrix + contributor board ----
  var windowSel = 'week';
  async function scrimTab(box) {
    if (!P.has(g.perms, 'club.analytics.view')) { box.appendChild(UI.emptyState('Analytics hidden', 'Your role cannot see club analytics.')); return; }
    var sel = h('select', { 'class': 'hs-select', id: 'win', 'aria-label': 'Time window' },
      [['week', 'Last 7 days'], ['month', 'Last 30 days'], ['all', 'All time']].map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === windowSel }); }));
    var matrixBox = h('section', { 'class': 'hs-panel' });
    var boardBox = h('section', { 'class': 'hs-panel' });
    sel.addEventListener('change', function () { windowSel = sel.value; fill(); });
    box.appendChild(h('div', { 'class': 'hs-filters' }, h('label', { 'class': 'hs-field', style: { margin: '0' } }, h('span', { 'class': 'hs-label', text: 'Window' }), sel)));
    box.appendChild(matrixBox); box.appendChild(boardBox);
    function fill() { drawMatrix(matrixBox); drawBoard(boardBox); }
    fill();
  }

  function unavailable(box, what) {
    UI.clear(box);
    box.appendChild(h('h2', { 'class': 'hs-h3', text: what }));
    box.appendChild(UI.emptyState('Not available yet', 'This server has not switched on club analytics. Match data you route to this club will show up here once it does.'));
  }

  async function drawMatrix(box) {
    UI.clear(box);
    box.appendChild(h('h2', { 'class': 'hs-h3', text: 'Win-rate matrix' }));
    box.appendChild(h('p', { 'class': 'hs-meta', text: 'Your club’s own games vs. the archetypes you faced. Always members only. Cells under the minimum sample are dimmed.' }));
    try {
      var res = await CLUB.get(base() + '/analytics/matchups', { window: windowSel });
      var m = CUI.matchupMatrix(res);
      if (m.empty) { box.appendChild(UI.emptyState('No games yet', 'Set your tracker sync target to this club and play. Games appear here automatically.')); return; }
      var thead = h('tr', null, h('th', { text: '' }), m.cols.map(function (c) { return h('th', { scope: 'col', text: c }); }));
      var body = m.rows.map(function (r) {
        return h('tr', null, h('th', { scope: 'row', 'class': 'rowh', text: r }), m.cols.map(function (c) {
          var x = m.get(r, c);
          if (!x || !x.games) return h('td', { 'class': 'nil', text: '–' });
          var pct = x.wr === null ? null : Math.round(x.wr * 100);
          var band = pct === null ? 'even' : (pct >= 55 ? 'good' : (pct < 45 ? 'bad' : 'even'));
          return h('td', { 'class': band + (x.games < m.min ? ' dim' : ''), title: x.games < m.min ? 'Only ' + x.games + ' games (minimum sample ' + m.min + ')' : x.games + ' games' },
            pct === null ? '?' : pct + '%', h('small', { text: x.games + (x.games === 1 ? ' game' : ' games') }));
        }));
      });
      box.appendChild(h('div', { 'class': 'club-scroll' }, h('table', { 'class': 'club-matrix' }, h('thead', null, thead), h('tbody', null, body))));
    } catch (e) {
      if (e.status === 404 || e.status === 501) unavailable(box, 'Win-rate matrix');
      else box.appendChild(UI.errorState(CUI.errMessage(e), function () { drawMatrix(box); }));
    }
  }

  async function drawBoard(box) {
    UI.clear(box);
    box.appendChild(h('h2', { 'class': 'hs-h3', text: 'Contributor board' }));
    try {
      var items = CLUB.items(await CLUB.get(base() + '/analytics/contributors', { window: windowSel }));
      if (!items.length) { box.appendChild(UI.emptyState('No contributions yet', 'Members who route match data to this club will be ranked here.')); return; }
      box.appendChild(h('div', { 'class': 'club-board' }, items.map(function (c) {
        var a = CUI.handleOf(c);
        var wins = c.wins, games = c.games;
        var tail = [];
        if (typeof wins === 'number' && typeof games === 'number') tail.push(wins + ' wins / ' + games + ' games');
        else if (typeof wins === 'number') tail.push(wins + ' wins');
        else if (typeof games === 'number') tail.push(games + ' games');
        return h('div', null, CUI.nameLink(c, a), h('span', { 'class': 'hs-meta', text: tail.join(' ') }));
      })));
    } catch (e) {
      if (e.status === 404 || e.status === 501) unavailable(box, 'Contributor board');
      else box.appendChild(UI.errorState(CUI.errMessage(e), function () { drawBoard(box); }));
    }
  }

  init();
})();
