// /hearthstone/u.html?h=handle -- profile, decks tab, wall tab; with no ?h= it is the "claim your handle" page.
(function () {
  'use strict';
  var h = UI.h, PAGE = 20;
  var root = UI.$('root');
  var handle = (UI.params().get('h') || '').replace(/^@/, '');
  var HANDLE_RE = /^[a-z0-9_]{3,20}$/;

  function done() { root.setAttribute('aria-busy', 'false'); }

  async function init() {
    var who = await HS.who();
    if (handle) return showProfile(who);
    if (!who.signedIn) {
      UI.clear(root); done();
      root.appendChild(h('div', { 'class': 'hs-wrap narrow', style: { padding: '0' } },
        UI.emptyState('Pick a player', 'Open a profile from the Players tab, or from any deck or post.',
          h('div', null, h('a', { 'class': 'hs-btn', href: '/hearthstone/players.html', text: 'Browse players' }), h('div', { style: { 'margin-top': '1rem' } }, UI.signInHint('to claim your own handle'))))));
      return;
    }
    if (who.me && who.me.handle) { location.replace('/hearthstone/u.html?h=' + encodeURIComponent(who.me.handle)); return; }
    claimForm(who);
  }

  // ---- claim your handle ----
  function claimForm(who) {
    UI.clear(root); done();
    var hIn = h('input', { 'class': 'hs-input', id: 'c-handle', maxlength: '20', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'e.g. filthyrat', 'aria-describedby': 'c-handle-hint' });
    var hint = h('p', { 'class': 'hs-hint', id: 'c-handle-hint', text: '3 to 20 characters: lowercase letters, numbers and underscores. You cannot change it later.' });
    var bio = h('textarea', { 'class': 'hs-textarea', maxlength: '160', rows: '3', placeholder: 'A line about you (optional)', 'aria-label': 'Bio' });
    var bioCount = h('span', { 'class': 'hs-count', text: '0 / 160' });
    var err = h('p', { 'class': 'hs-msg err', role: 'alert', hidden: true });
    var btn = h('button', { type: 'submit', 'class': 'hs-btn solid lg', text: 'Claim handle', disabled: true });
    hIn.addEventListener('input', function () {
      var v = hIn.value.trim().toLowerCase();
      var good = HANDLE_RE.test(v);
      hint.className = 'hs-hint' + (v && !good ? ' err' : '');
      btn.disabled = !good;
    });
    bio.addEventListener('input', function () { bioCount.textContent = bio.value.length + ' / 160'; });
    var form = h('form', { 'class': 'hs-panel gold', novalidate: true },
      h('p', { 'class': 'hs-eyebrow', text: 'Welcome' }),
      h('h1', { 'class': 'hs-h1', text: 'Claim your handle' }),
      h('p', { 'class': 'hs-lede', text: 'Your handle is your name on decks, comments and your wall. There are no avatars, just a name and a short line about you.' }),
      h('div', { style: { 'margin-top': '1.4rem' } },
        h('div', { 'class': 'hs-field' }, h('label', { 'class': 'hs-label', 'for': 'c-handle', text: 'Handle' }), hIn, hint),
        h('div', { 'class': 'hs-field' }, h('span', { 'class': 'hs-label', text: 'Bio' }), bio, bioCount),
        h('div', { 'class': 'hs-actions' }, btn), err));
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      UI.withBusy(btn, async function () {
        err.hidden = true;
        var v = hIn.value.trim().toLowerCase();
        try {
          await HS.put('/me', { handle: v, bio: bio.value.trim() });
          if (window.WotanNav) await WotanNav.refreshMe();
          location.href = '/hearthstone/u.html?h=' + encodeURIComponent(v);
        } catch (e) { err.textContent = e.message; err.hidden = false; }
      });
    });
    root.appendChild(h('div', { style: { 'max-width': '560px', margin: '1rem auto 0' } }, form));
    hIn.focus();
  }

  // ---- a profile ----
  async function showProfile(who) {
    var p;
    try { p = await HS.get('/users/' + encodeURIComponent(handle)); }
    catch (e) {
      UI.clear(root); done();
      if (e.status === 404) root.appendChild(UI.emptyState('No such player', '@' + handle + ' has not claimed that handle.', h('a', { 'class': 'hs-btn', href: '/hearthstone/players.html', text: 'Browse players' })));
      else root.appendChild(UI.errorState(e.message, function () { showProfile(who); }));
      return;
    }
    document.title = '@' + p.handle + ' — WOTAN Hearthstone';
    UI.clear(root); done();
    var mine = !!(who.me && who.me.handle && who.me.handle.toLowerCase() === p.handle.toLowerCase());

    var followers = p.followers || 0;
    var folNum = h('b', { text: String(followers) });
    var folLabel = h('span', { text: followers === 1 ? 'follower' : 'followers' });
    function paintFol() { folNum.textContent = String(followers); folLabel.textContent = followers === 1 ? 'follower' : 'followers'; }

    var bioEl = h('p', { 'class': 'bio', text: p.bio || '', hidden: !p.bio });
    var actions = h('div', { 'class': 'hs-actions', style: { 'margin-top': '1rem' } });

    if (mine) {
      actions.appendChild(h('button', { type: 'button', 'class': 'hs-btn sm ghost', text: 'Edit bio', on: { click: function () { editBio(p, bioEl, actions); } } }));
    } else if (who.signedIn) {
      var fb = h('button', { type: 'button', 'class': 'hs-btn', 'aria-pressed': String(!!p.followed_by_me) });
      var followed = !!p.followed_by_me;
      var paintF = function () { fb.textContent = followed ? 'Following' : 'Follow'; fb.setAttribute('aria-pressed', String(followed)); fb.className = 'hs-btn' + (followed ? ' ghost' : ''); };
      paintF();
      fb.addEventListener('click', function () {
        UI.withBusy(fb, async function () {
          try {
            if (followed) await HS.del('/users/' + encodeURIComponent(p.handle) + '/follow'); else await HS.put('/users/' + encodeURIComponent(p.handle) + '/follow');
            followed = !followed; followers = Math.max(0, followers + (followed ? 1 : -1)); paintF(); paintFol();
          } catch (e) { UI.toast(e.message, 'err'); }
        });
      });
      actions.appendChild(fb);
    } else {
      actions.appendChild(UI.signInHint('to follow @' + p.handle));
    }

    var nums = h('div', { 'class': 'hs-profile-nums' },
      h('div', null, folNum, folLabel),
      h('div', null, h('b', { text: String(p.following || 0) }), h('span', { text: 'following' })));
    var deckCount = typeof p.decks === 'number' ? p.decks : (typeof p.deck_count === 'number' ? p.deck_count : null);
    if (deckCount !== null) nums.appendChild(h('div', null, h('b', { text: String(deckCount) }), h('span', { text: deckCount === 1 ? 'deck' : 'decks' })));

    root.appendChild(h('header', { 'class': 'hs-profile' },
      h('div', null,
        h('p', { 'class': 'hs-eyebrow', text: 'Player' + (p.created_at ? ' · joined ' + UI.monthYear(p.created_at) : '') }),
        h('h1', { 'class': 'hs-h1', text: '@' + p.handle }), bioEl, actions),
      nums));

    // tabs
    var tabDecks = h('button', { 'class': 'hs-tab', role: 'tab', id: 'tab-decks', 'aria-selected': 'true', 'aria-controls': 'tabpanel', text: 'Decks' });
    var tabWall = h('button', { 'class': 'hs-tab', role: 'tab', id: 'tab-wall', 'aria-selected': 'false', 'aria-controls': 'tabpanel', text: 'Wall' });
    var panel = h('div', { id: 'tabpanel', role: 'tabpanel', 'aria-labelledby': 'tab-decks' });
    root.appendChild(h('div', { 'class': 'hs-tabs', role: 'tablist', 'aria-label': 'Profile' }, tabDecks, tabWall));
    root.appendChild(panel);

    function select(which) {
      tabDecks.setAttribute('aria-selected', String(which === 'decks'));
      tabWall.setAttribute('aria-selected', String(which === 'wall'));
      panel.setAttribute('aria-labelledby', 'tab-' + which);
      try { history.replaceState(null, '', location.pathname + '?h=' + encodeURIComponent(p.handle) + (which === 'wall' ? '&tab=wall' : '')); } catch (e) { /* ignore */ }
      UI.clear(panel);
      if (which === 'decks') decksTab(panel, p); else wallTab(panel, p, who, mine);
    }
    tabDecks.addEventListener('click', function () { select('decks'); });
    tabWall.addEventListener('click', function () { select('wall'); });
    [tabDecks, tabWall].forEach(function (t) {
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { var o = t === tabDecks ? tabWall : tabDecks; o.focus(); o.click(); }
      });
    });
    select(UI.params().get('tab') === 'wall' ? 'wall' : 'decks');
  }

  function editBio(p, bioEl, actions) {
    var ta = h('textarea', { 'class': 'hs-textarea', maxlength: '160', rows: '3', 'aria-label': 'Bio' });
    ta.value = p.bio || '';
    var err = h('p', { 'class': 'hs-msg err', role: 'alert', hidden: true });
    var form = h('form', { style: { 'margin-top': '.8rem', 'max-width': '34rem' } }, ta,
      h('div', { 'class': 'hs-actions', style: { 'margin-top': '.5rem' } },
        h('button', { type: 'submit', 'class': 'hs-btn solid sm', text: 'Save' }),
        h('button', { type: 'button', 'class': 'hs-btn ghost sm', text: 'Cancel', on: { click: function () { form.remove(); } } })), err);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      UI.withBusy(form.querySelector('button[type=submit]'), async function () {
        try {
          await HS.put('/me', { handle: p.handle, bio: ta.value.trim() });
          p.bio = ta.value.trim(); bioEl.textContent = p.bio; bioEl.hidden = !p.bio; form.remove(); UI.toast('Bio saved.');
        } catch (e) { err.textContent = e.message; err.hidden = false; }
      });
    });
    actions.parentNode.insertBefore(form, actions.nextSibling);
    ta.focus();
  }

  // paged list helper: fetch(offset) -> {items,total}; render(item) -> node
  function paged(container, fetchPage, render, emptyMsg, moreLabel) {
    var offset = 0, listEl = h('div', null), moreWrap = h('div', { 'class': 'hs-more', hidden: true });
    var moreBtn = h('button', { type: 'button', 'class': 'hs-btn', text: moreLabel });
    moreWrap.appendChild(moreBtn);
    container.appendChild(listEl); container.appendChild(moreWrap);
    async function load(append) {
      if (!append) UI.skeleton(listEl, 2, 'row');
      try {
        var res = await fetchPage(offset);
        var items = (res && res.items) || [];
        if (!append) UI.clear(listEl);
        items.forEach(function (it) { listEl.appendChild(render(it)); });
        offset += items.length;
        if (!offset) listEl.appendChild(emptyMsg);
        moreWrap.hidden = !(res && offset < res.total && items.length);
      } catch (e) {
        if (!append) { UI.clear(listEl); listEl.appendChild(UI.errorState(e.message, function () { load(false); })); } else UI.toast(e.message, 'err');
      } finally { moreBtn.disabled = false; }
    }
    moreBtn.addEventListener('click', function () { moreBtn.disabled = true; load(true); });
    load(false);
    return listEl;
  }

  function decksTab(panel, p) {
    var grid = h('div', { 'class': 'hs-grid' });
    panel.appendChild(grid);
    paged(grid, function (off) { return HS.get('/users/' + encodeURIComponent(p.handle) + '/decks', { limit: PAGE, offset: off }); },
      UI.deckCard, (function () { var e = UI.emptyState('No decks yet', '@' + p.handle + ' has not shared a deck.'); e.style.gridColumn = '1 / -1'; return e; })(), 'Show more decks');
    // paged() appended its own list/more wrappers inside `grid`; flatten so cards sit directly in the grid
    var inner = grid.firstChild; if (inner) { inner.style.display = 'contents'; }
    var mw = grid.children[1]; if (mw) mw.style.gridColumn = '1 / -1';
  }

  function wallTab(panel, p, who, mine) {
    var listHolder = h('div', null);
    if (mine) {
      panel.appendChild(Social.composer({
        who: who, placeholder: 'Write on your wall', max: 500, label: 'Post',
        onSubmit: async function (body) {
          var post = await HS.post('/wall', { body: body });
          if (!post || !post.body) post = { id: post && post.id, body: body, created_at: new Date().toISOString(), likes: 0, comments: 0 };
          if (!post.author) post.author = { handle: p.handle };
          var empty = listHolder.querySelector('.hs-empty'); if (empty) empty.remove();
          var target = listHolder.firstChild;
          target.insertBefore(Social.postCard(post, { who: who }), target.firstChild);
          UI.toast('Posted.');
        }
      }));
    }
    panel.appendChild(listHolder);
    paged(listHolder, function (off) { return HS.get('/users/' + encodeURIComponent(p.handle) + '/wall', { limit: PAGE, offset: off }); },
      function (post) { if (!post.author) post.author = { handle: p.handle }; return Social.postCard(post, { who: who }); },
      UI.emptyState('Nothing on the wall', mine ? 'Write the first post above.' : '@' + p.handle + ' has not posted yet.'), 'Older posts');
  }

  init();
})();
