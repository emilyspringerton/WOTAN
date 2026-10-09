// WOTAN shared topbar: wordmark, game switch (DEADWEIGHT | HEARTHSTONE), section tabs and the ONE
// account widget for the whole site. Mount point: <header id="wotan-nav" data-skin="hs|dw"
// data-section="decks"></header>. Needs /js/iduna-sso.js loaded first (getIdunaSession, buildSsoURL,
// clearIdunaSession, handleIdunaSsoReturn) and /css/wotan-hs.css (the .wn-* rules).
//
// Pages must NOT render their own "Sign in" buttons -- this widget is the only one. A page that needs
// to say "sign in to post" uses a plain-text anchor with data-signin (WotanNav.signInURL()); the
// document-level click handler below remembers where to come back to.
(function () {
  'use strict';

  var RETURN_KEY = 'wotan_return_to';
  var mount = document.getElementById('wotan-nav');
  if (!mount) return;

  var skin = mount.getAttribute('data-skin') === 'dw' ? 'dw' : 'hs';
  var section = mount.getAttribute('data-section') || '';

  var TABS = {
    hs: [
      ['decks', 'Decks', '/hearthstone/'],
      ['submit', 'Submit', '/hearthstone/submit.html'],
      ['feed', 'Feed', '/hearthstone/feed.html'],
      ['players', 'Players', '/hearthstone/players.html']
    ],
    dw: [
      ['home', 'Home', '/'],
      ['play', 'Play', '/DEADWEIGHT/'],
      ['decks', 'Draft Decks', '/decks.html'],
      ['matches', 'Matches', '/matches.html'],
      ['shankpit', 'SHANKPIT', '/shankpit.html'],
      ['store', 'Hat Store', '/store.html'],
      ['friends', 'Friends & Duels', '/friends.html']
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

  var accountBox = el('div', { 'class': 'wn-account' });

  function build() {
    mount.textContent = '';
    var inner = el('div', { 'class': 'wn-in' });

    var brand = el('a', { 'class': 'wn-brand', href: '/', 'aria-label': 'WOTAN home' }, [
      el('span', { text: 'Wotan' }),
      el('small', { text: 'EINHORN_INDUSTRIAL' })
    ]);

    var sw = el('div', { 'class': 'wn-switch', role: 'group', 'aria-label': 'Game' }, [
      el('a', { href: '/decks.html', text: 'Deadweight', 'aria-current': skin === 'dw' ? 'true' : null }),
      el('a', { href: '/hearthstone/', text: 'Hearthstone', 'aria-current': skin === 'hs' ? 'true' : null })
    ]);

    var tabs = el('nav', { 'class': 'wn-tabs', 'aria-label': skin === 'hs' ? 'Hearthstone sections' : 'WOTAN sections' });
    TABS[skin].forEach(function (t) {
      tabs.appendChild(el('a', { href: t[2], text: t[1], 'aria-current': t[0] === section ? 'page' : null }));
    });

    inner.appendChild(brand);
    inner.appendChild(sw);
    inner.appendChild(accountBox);
    inner.appendChild(tabs);
    mount.appendChild(inner);
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
    if (!handle) menu.appendChild(el('div', { 'class': 'wn-menu-who', text: 'No Hearthstone handle yet' }));
    menu.appendChild(el('a', {
      role: 'menuitem',
      href: handle ? '/hearthstone/u.html?h=' + encodeURIComponent(handle) : '/hearthstone/u.html',
      text: handle ? 'My profile' : 'Claim your handle'
    }));
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
