// WOTAN shared topbar: wordmark, game switch (DEADWEIGHT | HEARTHSTONE | REDGARDEN), section tabs and the ONE
// account widget for the whole site. Mount point: <header id="wotan-nav" data-skin="hs|dw|rg"
// data-section="decks"></header>. Needs /js/iduna-sso.js loaded first (getIdunaSession, buildSsoURL,
// clearIdunaSession, handleIdunaSsoReturn) and /css/wotan-hs.css (the .wn-* rules).
//
// Pages must NOT render their own "Sign in" buttons -- this widget is the only one. A page that needs
// to say "sign in to post" uses a plain-text anchor with data-signin (WotanNav.signInURL()); the
// document-level click handler below remembers where to come back to.
(function () {
  'use strict';

  var RETURN_KEY = 'wotan_return_to';
  var THEME_KEY = 'wotan_theme';
  var THEMES = [['void', 'Void'], ['ember', 'Ember'], ['terminal', 'Terminal'], ['daylight', 'Daylight']];
  function getTheme() {
    var t = null;
    try { t = localStorage.getItem(THEME_KEY); } catch (e) { /* storage blocked */ }
    return THEMES.some(function (x) { return x[0] === t; }) ? t : 'void';
  }
  function applyTheme(t) {
    if (t === 'void') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
  applyTheme(getTheme());
  var mount = document.getElementById('wotan-nav');
  if (!mount) return;

  var skinAttr = mount.getAttribute('data-skin');
  var SKINS = { dw: 1, rg: 1, d2: 1, em: 1, gfd: 1, bp: 1, sp: 1, br: 1, acct: 1 };
  var skin = SKINS[skinAttr] ? skinAttr : 'hs';
  var section = mount.getAttribute('data-section') || '';

  var TABS = {
    hs: [
      ['decks', 'Decks', '/hearthstone/'],
      ['submit', 'Submit', '/hearthstone/submit.html'],
      ['feed', 'Feed', '/hearthstone/feed.html'],
      ['players', 'Players', '/hearthstone/players.html'],
      ['tracker', 'Tracker', '/hearthstone/tracker.html'],
      ['clubs', 'Clubs', '/clubs/'],
      ['gfd', 'GFD', '/GFD/']
    ],
    rg: [
      ['board', 'Leaderboard', '/redgarden/'],
      ['heroes', 'Heroes', '/redgarden/heroes.html'],
      ['matches', 'Matches', '/redgarden/matches.html'],
      ['play', 'Play', '/redgarden/play.html'],
      ['gfd', 'GFD', '/GFD/']
    ],
    d2: [
      ['board', 'Ladder', '/d2/'],
      ['matches', 'Matches', '/d2/matches.html'],
      ['play', 'Play', '/d2/play.html'],
      ['gfd', 'GFD', '/GFD/']
    ],
    em: [
      ['board', 'Ladder', '/empire/'],
      ['ais', 'The AIs', '/empire/ais.html'],
      ['cards', 'Cards', '/empire/cards.html'],
      ['live', 'Live', '/empire/live.html'],
      ['matches', 'Matches', '/empire/matches.html'],
      ['play', 'Play', '/empire/play.html']
    ],
    gfd: [
      ['play', 'Play', '/GFD/'],
      ['store', 'Hat Store', '/store.html'],
      ['studio', 'Hat Studio', '/hat-studio.html']
    ],
    bp: [
      ['play', 'Play', '/BRAWLPIT/'],
      ['store', 'Hat Store', '/store.html'],
      ['studio', 'Hat Studio', '/hat-studio.html'],
      ['gfd', 'GFD', '/GFD/']
    ],
    sp: [
      ['play', 'Play', '/shankpit-460/'],
      ['account', 'Account', '/account/']
    ],
    br: [
      ['play', 'Play', '/bedrockracers/'],
      ['account', 'Account', '/account/']
    ],
    // Account-level pages (not tied to one game): /account/ and /redeem/. Cream like the hs skin, no theme picker.
    acct: [
      ['account', 'Account', '/account/'],
      ['redeem', 'Redeem a code', '/redeem/']
    ],
    dw: [
      ['home', 'Home', '/'],
      ['play', 'Play', '/DEADWEIGHT/'],
      ['decks', 'Draft Decks', '/decks.html'],
      ['matches', 'Matches', '/matches.html'],
      ['shankpit', 'SHANKPIT', '/shankpit.html'],
      ['friends', 'Friends', '/friends.html'],
      ['gfd', 'GFD', '/GFD/']
    ]
  };

  // ---- session helpers (all tolerate iduna-sso.js being absent) ----
  function session() {
    try { return typeof getIdunaSession === 'function' ? getIdunaSession() : null; } catch (e) { return null; }
  }
  function ssoURL() {
    try { return typeof buildSsoURL === 'function' ? buildSsoURL() : 'https://iam.okemily.com/'; } catch (e) { return 'https://iam.okemily.com/'; }
  }

  // buildSsoURL() redirects to origin+pathname only (query stripped so return trips don't chain),
  // which would drop e.g. ?id=12 on deck.html. Remember the full path+query for the trip and restore
  // it right after the token fragment has been consumed.
  function rememberReturn() {
    try { sessionStorage.setItem(RETURN_KEY, location.pathname + location.search); } catch (e) { /* ignore */ }
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-signin]') : null;
    if (a) rememberReturn();
  });

  // Consume a fresh SSO return on ANY page.
  var fresh = null;
  try { if (typeof handleIdunaSsoReturn === 'function') fresh = handleIdunaSsoReturn(); } catch (e) { fresh = null; }
  if (fresh) {
    var saved = '';
    try { saved = sessionStorage.getItem(RETURN_KEY) || ''; sessionStorage.removeItem(RETURN_KEY); } catch (e) { saved = ''; }
    if (saved && saved.indexOf(location.pathname) === 0 && saved !== location.pathname + location.search) {
      location.replace(saved);
      return; // the replacement load re-runs everything with the session already stored
    }
  }

  // ---- /api/v1/hs/me (cached) ----
  var mePromise = null;
  function fetchMe() {
    var s = session();
    if (!s) return Promise.resolve(null);
    return fetch('/api/v1/hs/me', { headers: { 'Authorization': 'Bearer ' + s.token, 'Accept': 'application/json' } })
      .then(function (r) {
        if (r.status === 401) return { __unauth: true, handle: null }; // expired token: offer sign-in again
        return r.ok ? r.json() : null;
      })
      .catch(function () { return null; });
  }
  function getMe() {
    if (!mePromise) mePromise = fetchMe();
    return mePromise;
  }
  function refreshMe() {
    mePromise = null;
    return getMe().then(function (me) { render(me); fire(me); return me; });
  }

  function fire(me) {
    try { window.dispatchEvent(new CustomEvent('wotan:me', { detail: { session: session(), me: me } })); } catch (e) { /* old browser */ }
  }

  // ---- tiny DOM builder (textContent only; no innerHTML anywhere) ----
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') n.textContent = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }


  // ---- GAMES strip + "All games" panel (2026-10-18 design: pinned strip, searchable panel) ----
  // The strip shows the games the visitor pinned (stars in the panel, kept in localStorage); the game they are
  // on is always shown. Everything else lives in the panel under MORE GAMES. Add a game: one row in GAMES.
  var PIN_KEY = 'wotan_pinned_games';
  var DEFAULT_PINNED = ['dw', 'hs', 'rg', 'd2', 'em', 'gfd', 'bp', 'sp'];
  var STAR = 'M8 1.5 9.9 5.6 14.3 6.2 11.1 9.3 11.9 13.7 8 11.6 4.1 13.7 4.9 9.3 1.7 6.2 6.1 5.6Z';
  function svgEl(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function icon(w, kids, attrs) {
    var a = { width: w, height: w, viewBox: '0 0 ' + (attrs && attrs.vb || w) + ' ' + (attrs && attrs.vb || w), 'aria-hidden': 'true' };
    var svg = svgEl('svg', a);
    kids.forEach(function (k) { svg.appendChild(k); });
    return svg;
  }
  function loadPins(ids) {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(PIN_KEY)); } catch (e) { v = null; }
    if (!Array.isArray(v)) return DEFAULT_PINNED.filter(function (i) { return ids.indexOf(i) >= 0; });
    return v.filter(function (i) { return ids.indexOf(i) >= 0; });
  }
  function savePins(p) { try { localStorage.setItem(PIN_KEY, JSON.stringify(p)); } catch (e) { /* storage blocked */ } }

  function gamesBar(GAMES) {
    var ids = GAMES.map(function (g) { return g[0]; });
    var pins = loadPins(ids);
    var wrap = el('div', { 'class': 'wn-games' });
    var strip = el('div', { 'class': 'wn-games-in' });
    var allBtn = el('button', { type: 'button', 'class': 'wn-allgames', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'wn-allpanel' });
    var panel = el('section', { 'class': 'wn-allpanel', id: 'wn-allpanel', 'aria-label': 'All games', hidden: true });
    var scrim = el('div', { 'class': 'wn-scrim', hidden: true });
    var open = false;

    function gameLink(g, inPanel) {
      return el('a', { 'class': inPanel ? 'wn-pg-link' : 'wn-game', href: g[3], 'aria-current': skin === g[0] ? 'true' : null }, [
        el('b', { text: g[1] }), el('small', { text: g[2] })
      ]);
    }
    function setOpen(v) {
      open = v;
      panel.hidden = !v; scrim.hidden = !v;
      allBtn.setAttribute('aria-expanded', String(v));
      allBtn.classList.toggle('wn-open', v);
      if (v) { var q = panel.querySelector('input'); if (q) { q.value = ''; filter(''); q.focus(); } }
    }
    function filter(q) {
      q = q.trim().toLowerCase();
      [].forEach.call(panel.querySelectorAll('.wn-pg'), function (c) {
        c.hidden = !!q && c.getAttribute('data-q').indexOf(q) < 0;
      });
      [].forEach.call(panel.querySelectorAll('.wn-pg-sec'), function (sec) {
        sec.hidden = !sec.querySelector('.wn-pg:not([hidden])');
      });
    }
    function pinBtn(g) {
      var on = pins.indexOf(g[0]) >= 0;
      var b = el('button', { type: 'button', 'class': 'wn-pin', 'aria-pressed': String(on),
        'aria-label': (on ? 'Unpin ' : 'Pin ') + g[1] + (on ? ' from' : ' to') + ' the top menu' });
      b.appendChild(icon(16, [svgEl('path', { d: STAR, fill: on ? '#f5b82e' : 'none', stroke: on ? '#a56f00' : '#6b6885', 'stroke-width': '1.2', 'stroke-linejoin': 'round' })], { vb: 16 }));
      b.addEventListener('click', function () {
        var i = pins.indexOf(g[0]);
        if (i >= 0) pins.splice(i, 1); else pins.push(g[0]);
        savePins(pins); draw();
        var again = panel.querySelector('.wn-pin[aria-label$="' + g[1] + (i >= 0 ? ' to the top menu"' : ' from the top menu"') + ']');
        if (again) again.focus();
      });
      return b;
    }
    function section(label, list, withHint) {
      var head = el('div', { 'class': 'wn-pg-head' }, [
        el('div', { 'class': 'wn-pg-title' }, [document.createTextNode(label), el('span', { text: String(list.length) })])
      ]);
      if (withHint) {
        var hint = el('div', { 'class': 'wn-pg-hint' });
        hint.appendChild(icon(14, [svgEl('path', { d: STAR, fill: 'none', stroke: '#6b6885', 'stroke-width': '1.3', 'stroke-linejoin': 'round' })], { vb: 16 }));
        hint.appendChild(document.createTextNode('Pin a game to keep it in the top menu'));
        head.appendChild(hint);
      }
      var grid = el('div', { 'class': 'wn-pg-grid' }, list.map(function (g) {
        return el('div', { 'class': 'wn-pg', 'data-q': (g[1] + ' ' + g[2]).toLowerCase(), 'aria-current': skin === g[0] ? 'true' : null }, [gameLink(g, true), pinBtn(g)]);
      }));
      return el('div', { 'class': 'wn-pg-sec' }, [head, grid]);
    }
    function draw() {
      strip.textContent = '';
      strip.appendChild(el('span', { 'class': 'wn-games-label', text: 'Games' }));
      GAMES.forEach(function (g) {
        if (pins.indexOf(g[0]) >= 0 || skin === g[0]) strip.appendChild(gameLink(g, false));
      });
      var pinned = GAMES.filter(function (g) { return pins.indexOf(g[0]) >= 0; });
      var more = GAMES.filter(function (g) { return pins.indexOf(g[0]) < 0; });
      allBtn.textContent = '';
      allBtn.appendChild(icon(14, [[0, 0], [5, 0], [10, 0], [0, 5], [5, 5], [10, 5], [0, 10], [5, 10], [10, 10]].map(function (xy) {
        return svgEl('rect', { x: xy[0], y: xy[1], width: 4, height: 4, rx: 1, fill: 'currentColor' });
      }), { vb: 14 }));
      allBtn.appendChild(el('span', { 'class': 'wn-allgames-t', text: 'All games' }));
      allBtn.appendChild(el('span', { 'class': 'wn-allgames-n', text: String(GAMES.length) }));
      allBtn.appendChild(icon(10, [svgEl('path', { d: open ? 'M1.5 6.5 5 3l3.5 3.5' : 'M1.5 3.5 5 7l3.5-3.5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })], { vb: 10 }));

      var q = el('input', { type: 'search', 'aria-label': 'Search games', placeholder: 'Search ' + GAMES.length + ' games' });
      q.addEventListener('input', function () { filter(q.value); });
      var search = el('div', { 'class': 'wn-pg-search' }, [q, el('span', { 'class': 'wn-pg-kbd', text: '/' })]);
      var inner = el('div', { 'class': 'wn-pg-in' }, [search]);
      if (pinned.length) inner.appendChild(section('In your menu', pinned, true));
      if (more.length) inner.appendChild(section('More games', more, !pinned.length));
      panel.textContent = '';
      panel.appendChild(inner);
    }
    draw();
    allBtn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!open); draw(); setOpen(open); });
    scrim.addEventListener('click', function () { setOpen(false); draw(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) { setOpen(false); draw(); allBtn.focus(); return; }
      var t = e.target && e.target.tagName;
      if (e.key === '/' && !open && t !== 'INPUT' && t !== 'TEXTAREA' && !(e.target && e.target.isContentEditable)) {
        e.preventDefault(); setOpen(true); draw(); setOpen(true);
      }
    });
    wrap.appendChild(el('div', { 'class': 'wn-games-row' }, [strip, allBtn]));
    wrap.appendChild(panel);
    wrap.appendChild(scrim);
    return wrap;
  }

  var accountBox = el('div', { 'class': 'wn-account' });

  function build() {
    mount.textContent = '';
    if (!document.getElementById('wn-fonts')) {
      var lk = document.createElement('link');
      lk.id = 'wn-fonts'; lk.rel = 'stylesheet';
      lk.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap';
      document.head.appendChild(lk);
    }
    var inner = el('div', { 'class': 'wn-in' });

    // Row 1: GAMES bar -- the three games, each with a one-line subtitle, active one underlined.
    var GAMES = [
      ['dw', 'Deadweight', 'Drafts \u00b7 Matches \u00b7 Duels', '/DEADWEIGHT/'],
      ['hs', 'Hearthstone', 'Shared deck library', '/hearthstone/'],
      ['rg', 'Redgarden', 'Knights of the Void', '/redgarden/play.html'],
      ['d2', 'D2', 'Hold Battles \u00b7 Backpack battler', '/d2/play.html'],
      ['em', 'EMPIRE', 'Cards \u00b7 Towers \u00b7 Standing', '/empire/play.html'],
      ['gfd', 'GoblinFoxDragon', 'MUD \u00b7 Hat Store', '/GFD/'],
      ['bp', 'Brawlpit', 'Arena fighter \u00b7 Hat Store', '/BRAWLPIT/'],
      ['sp', 'shankpit-460', 'Arena shooter \u00b7 Free-for-all', '/shankpit-460/'],
      ['br', 'Bedrock Racers', 'Rocket cars \u00b7 Quaffle', '/bedrockracers/']
    ];
    mount.appendChild(gamesBar(GAMES));

    // Row 2: brand bar -- wordmark, section tabs, the ONE account widget.
    var brand = el('a', { 'class': 'wn-brand', href: '/', 'aria-label': 'WOTAN home' }, [
      el('span', { text: 'Wotan' }),
      el('small', { text: 'EINHORN_INDUSTRIAL' })
    ]);

    var tabs = el('nav', { 'class': 'wn-tabs', 'aria-label': skin === 'hs' ? 'Hearthstone sections' : (skin === 'rg' ? 'Redgarden sections' : (skin === 'd2' ? 'D2 sections' : (skin === 'em' ? 'EMPIRE sections' : (skin === 'gfd' ? 'GoblinFoxDragon sections' : (skin === 'bp' ? 'Brawlpit sections' : (skin === 'sp' ? 'shankpit-460 sections' : (skin === 'br' ? 'Bedrock Racers sections' : (skin === 'acct' ? 'Account sections' : 'WOTAN sections')))))))) });
    TABS[skin].forEach(function (t) {
      tabs.appendChild(el('a', { href: t[2], text: t[1], 'aria-current': t[0] === section ? 'page' : null }));
    });

    inner.appendChild(brand);
    inner.appendChild(tabs);
    if (skin !== 'hs' && skin !== 'acct') inner.appendChild(themePicker());
    inner.appendChild(accountBox);
    mount.appendChild(el('div', { 'class': 'wn-bar' }, [inner]));
  }

  function themePicker() {
    var cur = getTheme();
    var wrap = el('div', { 'class': 'wn-theme' });
    var btn = el('button', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', text: 'Theme' });
    var menu = el('div', { 'class': 'wn-menu', role: 'menu', hidden: true });
    THEMES.forEach(function (t) {
      var b = el('button', { type: 'button', role: 'menuitemradio', 'aria-checked': t[0] === cur ? 'true' : 'false', text: t[1] });
      b.addEventListener('click', function () {
        try { localStorage.setItem(THEME_KEY, t[0]); } catch (e) { /* ignore */ }
        applyTheme(t[0]);
        [].forEach.call(menu.querySelectorAll('button'), function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
        menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
      });
      menu.appendChild(b);
    });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.hidden;
      menu.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function () { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
    wrap.appendChild(btn); wrap.appendChild(menu);
    return wrap;
  }

  var menuOpen = false;
  function closeMenu() {
    var m = accountBox.querySelector('.wn-menu');
    var b = accountBox.querySelector('.wn-user');
    if (m) m.hidden = true;
    if (b) b.setAttribute('aria-expanded', 'false');
    menuOpen = false;
  }

  function render(me) {
    accountBox.textContent = '';
    menuOpen = false;
    var s = session();
    if (!s || (me && me.__unauth)) {
      accountBox.appendChild(el('a', { 'class': 'wn-signin', href: ssoURL(), 'data-signin': '', text: 'Sign in' }));
      return;
    }
    var handle = me && me.handle ? me.handle : '';
    var label = handle ? '@' + handle : ((me && me.sub_display) || s.displayName || 'Account');
    var btn = el('button', { type: 'button', 'class': 'wn-user', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'wn-menu' }, [
      el('span', { text: label })
    ]);
    var menu = el('div', { 'class': 'wn-menu', id: 'wn-menu', role: 'menu', hidden: true });
    if (skin === 'em') {
      menu.appendChild(el('a', {
        role: 'menuitem',
        href: '/empire/u.html?id=' + encodeURIComponent(s.playerID || ''),
        text: 'My EMPIRE profile'
      }));
    } else if (skin === 'd2') {
      // Profiles are per game: on the D2 tab the account menu opens the D2 profile (keyed by the IDUNA player id).
      menu.appendChild(el('a', {
        role: 'menuitem',
        href: '/d2/u.html?id=' + encodeURIComponent(s.playerID || ''),
        text: 'My D2 profile'
      }));
    } else if (skin === 'rg') {
      // Profiles are per game: on the REDGARDEN tab the account menu opens the REDGARDEN profile
      // (keyed by the IDUNA player id), never the Hearthstone handle page.
      menu.appendChild(el('a', {
        role: 'menuitem',
        href: '/redgarden/u.html?id=' + encodeURIComponent(s.playerID || ''),
        text: 'My REDGARDEN profile'
      }));
    } else {
      if (!handle) menu.appendChild(el('div', { 'class': 'wn-menu-who', text: 'No Hearthstone handle yet' }));
      menu.appendChild(el('a', {
        role: 'menuitem',
        href: handle ? '/hearthstone/u.html?h=' + encodeURIComponent(handle) : '/hearthstone/u.html',
        text: handle ? 'My profile' : 'Claim your handle'
      }));
    }
    // Clubs (Phase 2): my clubs, tracker sync target, roster toggles. Not on the REDGARDEN tab (profiles are per game).
    if (skin !== 'rg' && skin !== 'd2' && skin !== 'em') menu.appendChild(el('a', { role: 'menuitem', href: '/clubs/settings.html', text: 'My clubs & sync' }));
    // Identity federation: linked accounts (Battle.net/Google/Twitch), privacy, tracker upload keys. Site-wide.
    menu.appendChild(el('a', { role: 'menuitem', href: '/account/', text: 'Account & linked accounts' }));
    // Redeem a code (founder real-time 2026-10-16, like Battle.net's account menu): Founder status, tickets and other perks.
    menu.appendChild(el('a', { role: 'menuitem', href: '/redeem/', text: 'Redeem a code' }));
    menu.appendChild(el('hr'));
    var out = el('button', { type: 'button', role: 'menuitem', text: 'Sign out' });
    out.addEventListener('click', function () {
      try { if (typeof clearIdunaSession === 'function') clearIdunaSession(); } catch (e) { /* ignore */ }
      // also drop page-local derived tokens (friends.html's DEADWEIGHT token, store.html's legacy key) so a
      // page-level fallback can't silently sign the user back in after they chose Sign out.
      try { ['wotan_dw_token', 'wotan_dw_player_id', 'wotan_token', 'wotan_player_id'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* ignore */ }
      mePromise = null;
      location.reload();
    });
    menu.appendChild(out);

    btn.addEventListener('click', function () {
      menuOpen = !menuOpen;
      menu.hidden = !menuOpen;
      btn.setAttribute('aria-expanded', String(menuOpen));
      if (menuOpen) { var f = menu.querySelector('a,button'); if (f) f.focus(); }
    });
    accountBox.appendChild(btn);
    accountBox.appendChild(menu);
  }

  document.addEventListener('click', function (e) {
    if (menuOpen && !accountBox.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menuOpen) {
      closeMenu();
      var b = accountBox.querySelector('.wn-user');
      if (b) b.focus();
    }
  });

  build();
  render(null);

  window.WotanNav = {
    skin: skin,
    session: session,
    signedIn: function () { return !!session(); },
    signInURL: ssoURL,
    getMe: getMe,
    refreshMe: refreshMe
  };

  getMe().then(function (me) {
    // 401 or network failure with a stored token -> keep the cached name but nothing else is known.
    render(me);
    fire(me);
  });
})();
