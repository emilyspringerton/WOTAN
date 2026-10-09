// Shared UI primitives for the HEARTHSTONE section (pairs with css/wotan-hs.css).
// Rule of the house: user-supplied text only ever goes through textContent (h() below, or esc() when a
// string must be assembled). There is no innerHTML of user data anywhere in this section.
(function () {
  'use strict';

  var CLASSES = ['Death Knight', 'Demon Hunter', 'Druid', 'Hunter', 'Mage', 'Paladin', 'Priest', 'Rogue', 'Shaman', 'Warlock', 'Warrior'];
  var FORMATS = ['Standard', 'Wild', 'Classic', 'Twist'];

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // h('div', {class:'x', text:'hi', on:{click:fn}, dataset:{a:1}}, child, [child...])
  function h(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') n.textContent = v;
        else if (k === 'class') n.className = v;
        else if (k === 'on') Object.keys(v).forEach(function (ev) { n.addEventListener(ev, v[ev]); });
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { n.dataset[d] = v[d]; });
        else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (p) { n.style.setProperty(p, v[p]); });
        else n.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(n, arguments[i]);
    return n;
  }
  function append(parent, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(parent, k); }); return; }
    parent.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function $(id) { return document.getElementById(id); }

  function params() { return new URLSearchParams(location.search); }

  function debounce(fn, ms) {
    var t;
    var d = function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); };
    d.cancel = function () { clearTimeout(t); };
    return d;
  }

  // ---- dates ----
  function ago(iso) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
    return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function monthYear(iso) {
    var t = new Date(iso);
    return isNaN(t) ? '' : t.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  }

  // ---- toast ----
  var toastBox = null;
  function toast(msg, kind) {
    if (!toastBox) {
      toastBox = h('div', { 'class': 'hs-toasts', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastBox);
    }
    var t = h('div', { 'class': 'hs-toast' + (kind === 'err' ? ' err' : ''), text: msg });
    toastBox.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, kind === 'err' ? 5200 : 2800);
  }

  // ---- clipboard (async API, textarea fallback for http / old browsers) ----
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* fall through */ }
    var ta = h('textarea', { 'aria-hidden': 'true', tabindex: '-1', style: { position: 'fixed', top: '0', left: '-9999px', opacity: '0' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  async function copyWithToast(text, what) {
    var ok = await copyText(text);
    if (ok) toast((what || 'Copied') + ' copied to clipboard.');
    else toast('Could not copy automatically. Select the code and copy it by hand.', 'err');
    return ok;
  }

  // ---- classes / formats ----
  function classKey(name) { return String(name || '').toLowerCase().replace(/[^a-z]/g, ''); }
  function classBadge(name) {
    if (!name) return null;
    return h('span', { 'class': 'hs-badge', 'data-class': classKey(name), text: name });
  }
  function fmtBadge(fmt) { return fmt ? h('span', { 'class': 'hs-badge fmt', text: fmt }) : null; }
  function handleLink(handle, cls) {
    if (!handle) return h('span', { text: 'anonymous' });
    return h('a', { href: '/hearthstone/u.html?h=' + encodeURIComponent(handle), 'class': cls || '', text: '@' + handle });
  }
  function deckURL(id) { return '/hearthstone/deck.html?id=' + encodeURIComponent(id); }

  // ---- cost curve ----
  function curveBuckets(cards) {
    var b = [0, 0, 0, 0, 0, 0, 0, 0], any = false;
    (cards || []).forEach(function (c) {
      if (typeof c.cost !== 'number' || c.cost < 0) return;
      any = true;
      b[Math.min(7, c.cost)] += (c.count || 1);
    });
    return any ? b : null;
  }
  // large=true adds count labels over the bars and a 0..7+ axis underneath.
  function costCurve(cards, large) {
    var b = curveBuckets(cards);
    if (!b) return null;
    var max = Math.max.apply(null, b) || 1;
    if (!large) {
      return h('div', { 'class': 'hs-curve', role: 'img', 'aria-label': 'Mana curve: ' + b.map(function (n, i) { return n + ' at ' + (i === 7 ? '7+' : i); }).join(', ') },
        b.map(function (n) { return h('i', { 'class': n ? '' : 'z', style: { height: (n ? Math.max(8, Math.round(n / max * 100)) : 4) + '%' } }); }));
    }
    var wrap = h('div', null);
    wrap.appendChild(h('div', { 'class': 'hs-curve lg', role: 'img', 'aria-label': 'Mana curve: ' + b.map(function (n, i) { return n + ' at ' + (i === 7 ? '7+' : i); }).join(', ') },
      b.map(function (n) {
        return h('div', null, n ? h('span', { text: String(n) }) : null,
          h('i', { 'class': n ? '' : 'z', style: { height: (n ? Math.max(6, Math.round(n / max * 86)) : 3) + '%' } }));
      })));
    wrap.appendChild(h('div', { 'class': 'hs-curve-axis', 'aria-hidden': 'true' }, b.map(function (_, i) { return h('span', { text: i === 7 ? '7+' : String(i) }); })));
    return wrap;
  }

  // ---- card list grouped by cost ----
  function cardList(cards, namesResolved, className) {
    cards = cards || [];
    var groups = {}, unknown = [];
    cards.forEach(function (c) {
      if (typeof c.cost === 'number') (groups[c.cost] = groups[c.cost] || []).push(c);
      else unknown.push(c);
    });
    var root = h('div', { 'class': 'hs-cardlist', 'data-class': classKey(className) });
    function group(title, list, cost) {
      list.sort(function (a, b) { return String(a.name || '~' + a.dbf_id).localeCompare(String(b.name || '~' + b.dbf_id)); });
      var total = list.reduce(function (n, c) { return n + (c.count || 1); }, 0);
      var g = h('section', { 'class': 'hs-cost-group' }, h('h4', { text: title + ' · ' + total }));
      list.forEach(function (c) {
        g.appendChild(h('div', { 'class': 'hs-cardrow' },
          h('span', { 'class': 'gem', text: cost === null ? '?' : String(cost), 'aria-hidden': 'true' }),
          h('span', { 'class': 'nm' + (c.name ? '' : ' ph'), text: c.name || ('Card #' + c.dbf_id) }),
          h('span', { 'class': 'ct', text: '×' + (c.count || 1), 'aria-label': (c.count || 1) + ' copies' })));
      });
      root.appendChild(g);
    }
    Object.keys(groups).map(Number).sort(function (a, b) { return a - b; }).forEach(function (k) { group('Cost ' + k, groups[k], k); });
    if (unknown.length) group(Object.keys(groups).length ? 'Cost unknown' : 'Cards', unknown, null);
    return root;
  }
  function resolvedNote(namesResolved, cards) {
    var anyUnnamed = (cards || []).some(function (c) { return !c.name; });
    if (namesResolved !== false && !anyUnnamed) return null;
    return h('p', { 'class': 'hs-note', text: 'Card names arrive with the card database. Until then, decks submitted as a bare code list each card by its database number. The code itself is complete and pastes straight into Hearthstone.' });
  }

  // ---- deck card (browse grid) ----
  function deckCard(d) {
    var a = d.author && d.author.handle;
    var card = h('article', { 'class': 'hs-deck', 'data-class': classKey(d.class) },
      h('div', { 'class': 'hs-deck-top' }, classBadge(d.class || 'Unknown'), fmtBadge(d.format), d.year ? h('span', { 'class': 'hs-meta', text: d.year }) : null),
      h('h3', { 'class': 'hs-deck-title' }, h('a', { href: deckURL(d.id), text: d.title || 'Untitled deck' })),
      h('div', { 'class': 'hs-deck-by' }, 'by ', handleLink(a), ' · ', ago(d.created_at)),
      costCurve(d.cards, false),
      h('div', { 'class': 'hs-deck-foot' },
        h('span', { 'class': 'hs-stats' },
          h('span', { text: '♥ ' + (d.likes || 0), title: 'Likes' }),
          h('span', { text: (d.comments || 0) + (d.comments === 1 ? ' comment' : ' comments') }),
          d.card_count ? h('span', { text: d.card_count + ' cards' }) : null),
        d.deckstring ? h('button', { type: 'button', 'class': 'hs-btn sm ghost', text: 'Copy code', 'aria-label': 'Copy deck code for ' + (d.title || 'deck'),
          on: { click: function () { copyWithToast(d.deckstring, 'Deck code'); } } }) : null));
    return card;
  }

  // ---- states ----
  function skeleton(container, n, cls) {
    clear(container);
    for (var i = 0; i < n; i++) container.appendChild(h('div', { 'class': 'hs-skel ' + (cls || ''), 'aria-hidden': 'true' }));
  }
  function emptyState(title, text, action) {
    return h('div', { 'class': 'hs-empty', role: 'status' }, h('div', { 'class': 'hs-h3', text: title }), text ? h('p', { text: text }) : null, action || null);
  }
  function errorState(msg, retry) {
    return h('div', { 'class': 'hs-empty err', role: 'alert' }, h('div', { 'class': 'hs-h3', text: 'That did not load' }), h('p', { text: msg || 'Something went wrong.' }),
      retry ? h('button', { type: 'button', 'class': 'hs-btn', text: 'Try again', on: { click: retry } }) : null);
  }

  // Plain-text, link-style "Sign in" line for contextual hints. Never a button.
  function signInHint(after) {
    var url = window.WotanNav ? window.WotanNav.signInURL() : 'https://iam.okemily.com/';
    return h('p', { 'class': 'hs-signin-hint' }, h('a', { href: url, 'data-signin': '', text: 'Sign in' }), ' ' + (after || 'to take part') + '.');
  }

  // Busy helper for buttons.
  async function withBusy(btn, fn) {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
    try { return await fn(); } finally { btn.removeAttribute('aria-busy'); btn.disabled = false; }
  }

  // Like toggle used by decks and wall posts. cfg: {liked,count,path} -> PUT/DELETE path.
  function likeButton(cfg, onChange) {
    var state = { liked: !!cfg.liked, count: cfg.count || 0 };
    var btn = h('button', { type: 'button', 'class': 'hs-btn sm ghost like' });
    function paint() {
      btn.setAttribute('aria-pressed', String(state.liked));
      btn.textContent = (state.liked ? '♥ ' : '♡ ') + state.count;
      btn.setAttribute('aria-label', (state.liked ? 'Unlike' : 'Like') + ', ' + state.count + ' likes');
    }
    paint();
    btn.addEventListener('click', async function () {
      if (!HS.hasSession()) { toast('Sign in to like things.', 'err'); return; }
      var was = { liked: state.liked, count: state.count };
      state.liked = !state.liked; state.count += state.liked ? 1 : -1; paint();
      btn.disabled = true;
      try {
        var res = state.liked ? await HS.put(cfg.path) : await HS.del(cfg.path);
        if (res && typeof res.likes === 'number') { state.count = res.likes; paint(); }
        if (onChange) onChange(state);
      } catch (e) {
        state.liked = was.liked; state.count = was.count; paint();
        toast(e.message, 'err');
      } finally { btn.disabled = false; }
    });
    return btn;
  }

  window.UI = {
    CLASSES: CLASSES, FORMATS: FORMATS,
    esc: esc, h: h, clear: clear, $: $, params: params, debounce: debounce,
    ago: ago, monthYear: monthYear, toast: toast, copyText: copyText, copyWithToast: copyWithToast,
    classKey: classKey, classBadge: classBadge, fmtBadge: fmtBadge, handleLink: handleLink, deckURL: deckURL,
    costCurve: costCurve, cardList: cardList, resolvedNote: resolvedNote, deckCard: deckCard,
    skeleton: skeleton, emptyState: emptyState, errorState: errorState, signInHint: signInHint,
    withBusy: withBusy, likeButton: likeButton
  };
})();
