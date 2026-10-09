// /hearthstone/submit.html -- paste an export block or bare deck code, live preview, publish.
(function () {
  'use strict';
  var h = UI.h;
  var EXAMPLE = [
    'FilthyRat', 'Class: Warlock', 'Format: Standard', 'Year of the Scarab', '#',
    '2x (1) Mortal Coil', '1x (2) Bloodmage Thalnos', '1x (2) Brightwing', '1x (2) Cult Neophyte', '2x (2) Dark Peddler',
    '2x (2) Dirty Rat', '2x (2) Sunfury Protector', '1x (2) Warden Maiev', '2x (3) Menagerie Mug', '2x (5) Doomguard',
    '1x (5) The Curator', '1x (7) Chillmaw', '1x (7) Keymaster Alabaster', '1x (7) Vanessa the Ringleader',
    '1x (8) Archwitch Willow', '1x (8) Lord Jaraxxus', '2x (8) Mo\'arg Forgefiend', '2x (8) Twisting Nether',
    '1x (9) Avatar of Hearthstone', '1x (9) M.O.T.H.E.R.', '2x (9) Voidlord', '#',
    'AAECAf0GDIWgBJegBKigBNCeBvSqB8ytB/bJB4jdB+vkB4TpB9HqB7r2BwmxnwSDoATRngbh5gagrAeTrQeBrgeCrget3wcAAA==', '#'
  ].join('\n');

  var text = UI.$('text'), title = UI.$('title'), desc = UI.$('desc'), publish = UI.$('publish');
  var pBody = UI.$('preview-body'), pEmpty = UI.$('preview-empty'), pubErr = UI.$('pub-err'), authLine = UI.$('auth-line');
  var who = { signedIn: false, me: null };
  var titleTouched = false, ok = false, reqN = 0;

  function guessTitle(t) {
    var first = (t.split(/\r?\n/)[0] || '').trim().replace(/^#+\s*/, '').trim();
    if (!first || /^(class|format|year)\s*:/i.test(first)) return '';
    if (/^[A-Za-z0-9+\/=]{24,}$/.test(first)) return ''; // a bare deck code
    return first.slice(0, 80);
  }

  function refreshPublish() {
    var canPost = who.signedIn && who.me && who.me.handle;
    publish.disabled = !(ok && canPost && title.value.trim());
  }

  function paintAuth() {
    UI.clear(authLine);
    if (!who.signedIn) {
      authLine.appendChild(h('p', { 'class': 'hs-signin-hint' }, 'Previewing works without an account. ', h('a', { href: window.WotanNav ? WotanNav.signInURL() : '#', 'data-signin': '', text: 'Sign in' }), ' to publish.'));
    } else if (!(who.me && who.me.handle)) {
      authLine.appendChild(h('p', { 'class': 'hs-signin-hint' }, h('a', { href: '/hearthstone/u.html', text: 'Claim a handle' }), ' first, then you can publish.'));
    }
    refreshPublish();
  }

  function renderPreview(r) {
    UI.clear(pBody); pEmpty.hidden = true;
    var n = r.card_count || (r.cards || []).reduce(function (a, c) { return a + (c.count || 1); }, 0);
    pBody.appendChild(h('div', { 'class': 'hs-preview-head', 'data-class': UI.classKey(r.class) },
      UI.classBadge(r.class || 'Unknown'), UI.fmtBadge(r.format), r.year ? h('span', { 'class': 'hs-meta', text: r.year }) : null,
      h('span', { 'class': n === 30 ? 'hs-badge plain' : 'hs-badge warn', text: n + ' / 30 cards' })));
    if (r.warnings && r.warnings.length) {
      pBody.appendChild(h('ul', { 'class': 'hs-warnlist' }, r.warnings.map(function (w) { return h('li', { text: w }); })));
    }
    var note = UI.resolvedNote(r.names_resolved, r.cards);
    if (note) pBody.appendChild(note);
    var curve = UI.costCurve(r.cards, false);
    if (curve) pBody.appendChild(h('div', { style: { margin: '0 0 1rem', '--cls': 'var(--hs-gold)' } }, curve));
    pBody.appendChild(UI.cardList(r.cards, r.names_resolved, r.class));
  }
  function renderError(msg) {
    UI.clear(pBody); pEmpty.hidden = true;
    pBody.appendChild(h('p', { 'class': 'hs-msg err', role: 'alert', text: msg }));
  }
  function renderIdle() { UI.clear(pBody); pEmpty.hidden = false; }

  async function preview() {
    var t = text.value.trim();
    var my = ++reqN;
    pubErr.hidden = true;
    if (!t) { ok = false; renderIdle(); refreshPublish(); return; }
    UI.clear(pBody); pEmpty.hidden = true;
    pBody.appendChild(h('div', { 'class': 'hs-skel', style: { 'min-height': '180px' }, 'aria-hidden': 'true' }));
    try {
      var r = await HS.post('/decks/parse', { text: t });
      if (my !== reqN) return;
      ok = true; renderPreview(r);
    } catch (e) {
      if (my !== reqN) return;
      ok = false; renderError(e.message);
    }
    refreshPublish();
  }
  var deb = UI.debounce(preview, 450);

  text.addEventListener('input', function () {
    if (!titleTouched) title.value = guessTitle(text.value);
    ok = false; refreshPublish(); deb();
  });
  title.addEventListener('input', function () { titleTouched = true; refreshPublish(); });
  desc.addEventListener('input', function () { UI.$('desc-count').textContent = desc.value.length + ' / 500'; });
  UI.$('example').addEventListener('click', function () {
    text.value = EXAMPLE; titleTouched = false; title.value = guessTitle(EXAMPLE); deb.cancel(); preview(); text.focus();
  });
  UI.$('clear').addEventListener('click', function () {
    text.value = ''; title.value = ''; titleTouched = false; desc.value = ''; UI.$('desc-count').textContent = '0 / 500'; deb.cancel(); preview(); text.focus();
  });

  UI.$('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (publish.disabled) return;
    UI.withBusy(publish, async function () {
      pubErr.hidden = true; UI.clear(pubErr);
      try {
        var r = await HS.post('/decks', { title: title.value.trim(), description: desc.value.trim(), text: text.value.trim() });
        location.href = UI.deckURL(r.id);
      } catch (e) {
        pubErr.textContent = e.message;
        var existing = e.data && (e.data.id || e.data.deck_id || e.data.existing_id);
        if (e.status === 409 && existing) { pubErr.appendChild(document.createTextNode(' ')); pubErr.appendChild(h('a', { href: UI.deckURL(existing), text: 'View the existing deck' })); }
        pubErr.hidden = false;
        pubErr.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    });
  });

  paintAuth();
  HS.who().then(function (w) { who = w; paintAuth(); });
})();
