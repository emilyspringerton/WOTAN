// /clubs/c.html?s=slug -- the public, tier-shaped club page. Anything the API 404s renders the same
// generic not-found state (Secret clubs must not be distinguishable from nonexistent ones, §3.3).
(function () {
  'use strict';
  var h = UI.h, P = ClubPerms;
  var root = UI.$('root');
  var slug = (UI.params().get('s') || '').trim().toLowerCase();

  function done() { root.setAttribute('aria-busy', 'false'); }
  function show404() { UI.clear(root); done(); document.title = 'Club not found — WOTAN Clubs'; root.appendChild(CUI.notFound()); }

  async function init() {
    if (!CUI.SLUG_RE.test(slug)) return show404();
    var c;
    try { c = await CLUB.get('/by-slug/' + encodeURIComponent(slug)); }
    catch (e) {
      if (e.status === 404) return show404();
      UI.clear(root); done();
      root.appendChild(UI.errorState(e.message, init));
      return;
    }
    if (!c || typeof c !== 'object') return show404();
    var tier = CUI.tierOf(c);
    var role = c.viewer_role || c.my_role || (c.viewer && c.viewer.role) || '';
    role = P.roleOf(role) || await CUI.myRole(slug);

    document.title = (c.name || slug) + ' — WOTAN Clubs';
    UI.clear(root); done();
    CUI.setBrand(root, c.brand || c.brand_json);
    var brand = (c.brand && typeof c.brand === 'object') ? c.brand : {};

    var n = CUI.membersCount(c);
    var head = h('header', { 'class': 'club-head' },
      h('div', { 'class': 'badges' }, CUI.tierBadge(tier), c.is_exclusive ? h('span', { 'class': 'hs-badge plain fmt', text: 'Exclusive' }) : null, role ? CUI.roleBadge(role) : null),
      h('h1', { 'class': 'hs-h1', text: c.name || slug }),
      c.tagline ? h('p', { 'class': 'hs-lede', text: c.tagline }) : null,
      brand.banner_text ? h('p', { 'class': 'club-banner', text: String(brand.banner_text) }) : null,
      c.description ? h('p', { 'class': 'club-desc', text: c.description }) : null,
      h('div', { 'class': 'club-stats' },
        n !== null ? h('div', null, h('b', { text: String(n) }), h('span', { text: n === 1 ? 'member' : 'members' })) : null,
        typeof c.prestige === 'number' ? h('div', null, h('b', { text: String(c.prestige) }), h('span', { text: 'prestige' })) : null,
        c.created_at ? h('div', null, h('b', { text: UI.monthYear(c.created_at) }), h('span', { text: 'founded' })) : null));
    root.appendChild(head);

    // Members get the full sub-navigation (perms come from /me; failure just leaves the public page).
    var perms = null;
    if (role && c.id) {
      try { var me = await CLUB.get('/' + encodeURIComponent(c.id) + '/me'); perms = (me && me.perms) || []; } catch (e) { perms = null; }
    }
    if (perms) root.appendChild(CUI.subnav(slug, 'c', perms));
    else if (role) root.appendChild(h('div', { 'class': 'hs-actions', style: { 'margin-bottom': '1rem' } }, h('a', { 'class': 'hs-btn', href: '/clubs/w.html?s=' + encodeURIComponent(slug), text: 'Open workspace' })));

    // Join affordance: only Social clubs with join_policy=request, and only when not already a member.
    if (!role && c.join_policy === 'request') root.appendChild(joinPanel());

    var rosterHolder = h('section', { 'class': 'hs-panel' }, h('h2', { 'class': 'hs-h3', text: 'Roster' }));
    root.appendChild(rosterHolder);
    loadRoster(rosterHolder);

    if (tier === 3 || (role && tier >= 1)) {
      var decksHolder = h('section', { 'class': 'hs-panel', hidden: true });
      root.appendChild(decksHolder);
      loadDecks(decksHolder);
    }
  }

  function joinPanel() {
    var msg = h('textarea', { 'class': 'hs-textarea', maxlength: '300', rows: '3', 'aria-label': 'Message to the club managers', placeholder: 'Say hello and who you play with (optional)' });
    var out = h('p', { 'class': 'hs-msg', role: 'status' });
    var btn = h('button', { type: 'submit', 'class': 'hs-btn solid', text: 'Request to join' });
    var form = h('form', { 'class': 'hs-panel gold' },
      h('h2', { 'class': 'hs-h3', text: 'Ask to join' }),
      CLUB.hasSession() ? h('div', null, msg, h('div', { 'class': 'hs-actions', style: { 'margin-top': '.6rem' } }, btn), out)
        : UI.signInHint('to ask to join this club'));
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      UI.withBusy(btn, async function () {
        try {
          await CLUB.post('/by-slug/' + encodeURIComponent(slug) + '/requests', { message: msg.value.trim() });
          out.className = 'hs-msg ok'; out.textContent = 'Request sent. A coach or manager will decide on it.';
          btn.disabled = true;
        } catch (e) { out.className = 'hs-msg err'; out.textContent = CUI.errMessage(e); }
      });
    });
    return form;
  }

  async function loadRoster(box) {
    try {
      var items = CLUB.items(await CLUB.get('/by-slug/' + encodeURIComponent(slug) + '/roster'));
      // Display order: Manager, Coach, Player, then handle.
      items.sort(function (a, b) {
        var d = (P.RANK[CUI.roleOfMember(b)] || 0) - (P.RANK[CUI.roleOfMember(a)] || 0);
        return d || String(CUI.handleOf(a)).localeCompare(String(CUI.handleOf(b)));
      });
      if (!items.length) { box.appendChild(h('p', { 'class': 'hs-meta', text: 'No members have chosen to appear on the public roster.' })); return; }
      box.appendChild(h('div', { 'class': 'club-roster wall' }, items.map(function (m) { return CUI.memberRow(m); })));
      box.appendChild(h('p', { 'class': 'hs-note', style: { 'margin-top': '.8rem' }, text: 'Ranks are self-declared unless marked verified. Verification against Blizzard’s leaderboards is not live yet.' }));
    } catch (e) {
      if (e.status === 404 || e.status === 403) { box.hidden = true; return; }
      box.appendChild(UI.errorState(e.message, function () { UI.clear(box); box.appendChild(h('h2', { 'class': 'hs-h3', text: 'Roster' })); loadRoster(box); }));
    }
  }

  async function loadDecks(box) {
    try {
      var items = CLUB.items(await CLUB.get('/by-slug/' + encodeURIComponent(slug) + '/decks'));
      if (!items.length) return; // nothing featured: keep the section out of the page
      box.hidden = false;
      box.appendChild(h('h2', { 'class': 'hs-h3', text: 'Featured decks' }));
      box.appendChild(h('div', { 'class': 'hs-grid' }, items.map(function (d) { return UI.deckCard(d.deck && typeof d.deck === 'object' ? d.deck : d); })));
      box.appendChild(h('p', { 'class': 'hs-note', style: { 'margin-top': '.8rem' }, text: 'A club shows a deck as “claimed” when its members were first to publish that exact deck code on WOTAN. That is a record of who published first, not proof of invention.' }));
    } catch (e) { /* 404/403/other: featured decks are optional, stay quiet */ }
  }

  init();
})();
