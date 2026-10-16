// "Redeem a code" widget, shared by /redeem/ (the full page) and /account/ (the compact overview card).
// Needs js/redeem-api.js loaded first; works with or without js/wotan-nav.js (it uses WotanNav.signInURL() when
// there is one). Self-contained on purpose: its own tiny DOM builder and its own rd-* classes
// (css/wotan-redeem.css), so it looks right on both the IDUNA style-guide pages (body.iduna) and the older
// body.hs pages. User-supplied text only ever reaches the DOM through textContent -- no innerHTML anywhere.
//
//   RedeemWidget.mountForm(host, {compact, onRedeemed(result)})   the code box + the "what it did" panel
//   RedeemWidget.renderGames(host, games)                          per-game status ("Founder", tickets)
//   RedeemWidget.renderHistory(host, redemptions)                  recent redemptions, newest first
(function (root) {
  'use strict';

  var API = root.RedeemAPI;
  var uid = 0;

  // el('div', {class:'x', text:'hi'}, [child, ...]) -- textContent only.
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

  function signInURL() {
    try { return root.WotanNav ? root.WotanNav.signInURL() : 'https://iam.okemily.com/'; } catch (e) { return 'https://iam.okemily.com/'; }
  }
  function signInLink(text) { return el('a', { href: signInURL(), 'data-signin': '', text: text || 'Sign in' }); }

  // ---------- the form ----------

  function mountForm(host, opts) {
    opts = opts || {};
    clear(host);
    var signedIn = API.hasSession();
    var id = 'rd-code-' + (++uid);
    var busy = false;

    var input = el('input', {
      // No maxlength on purpose: a browser trims PASTED text to it before any handler runs, so a code pasted with a
      // stray space or newline would lose its tail (the native client's own S520 bug). formatCodeInput caps at 25.
      id: id, 'class': 'rd-input', type: 'text', inputmode: 'text', placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX',
      autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
      'aria-describedby': id + '-msg', disabled: !signedIn
    });
    var btn = el('button', { type: 'submit', 'class': 'rd-btn primary', text: 'Redeem Code', disabled: true });
    var msg = el('p', { 'class': 'rd-msg', id: id + '-msg', role: 'status', 'aria-live': 'polite' });
    var resultHost = el('div', { 'class': 'rd-result-host' });
    var form = el('form', { 'class': 'rd-form', novalidate: true, autocomplete: 'off' }, [
      el('label', { 'class': 'rd-label', 'for': id, text: 'Enter code' }),
      el('div', { 'class': 'rd-row' }, [input, btn]),
      msg
    ]);
    host.classList.add('rd');
    if (opts.compact) host.classList.add('compact');
    host.appendChild(form);
    host.appendChild(resultHost);

    function setMsg(kids, kind) {
      clear(msg);
      msg.className = 'rd-msg' + (kind ? ' ' + kind : '');
      if (kind === 'error') msg.setAttribute('role', 'alert'); else msg.setAttribute('role', 'status');
      (Array.isArray(kids) ? kids : [kids]).forEach(function (k) { if (k) msg.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    }
    function sync() { btn.disabled = !(signedIn && !busy && API.isCodeShape(input.value)); }

    if (!signedIn) {
      setMsg([signInLink('Sign in'), ' to redeem a code.']);
    }

    input.addEventListener('input', function () {
      var before = input.value;
      var pos = typeof input.selectionStart === 'number' ? input.selectionStart : before.length;
      var count = before.slice(0, pos).replace(/[^A-Za-z0-9]/g, '').length;
      var f = API.formatCodeInput(before);
      if (f !== before) {
        input.value = f;
        var at = API.caretAfter(f, Math.min(count, 25));
        try { input.setSelectionRange(at, at); } catch (e) { /* not supported while hidden */ }
      }
      if (msg.className.indexOf('error') >= 0) setMsg('', '');
      sync();
    });

    // Enter on an incomplete code: the submit button is disabled, so the browser would silently do nothing. Say why.
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && btn.disabled && signedIn && !busy && input.value) {
        ev.preventDefault();
        setMsg(API.messages.invalid_code_format, 'error');
      }
    });

    // A code pasted inside a sentence ("Your code: ABCDE-... thanks!") goes in on its own, without the words.
    input.addEventListener('paste', function (ev) {
      var data = ev.clipboardData || root.clipboardData;
      var found = API.extractCode(data && data.getData ? data.getData('text') : '');
      if (!found) return; // anything else: let the browser paste, the input handler tidies it
      ev.preventDefault();
      input.value = found;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (busy || !signedIn) return;
      var code = API.formatCodeInput(input.value);
      if (!API.isCodeShape(code)) { setMsg(API.messages.invalid_code_format, 'error'); input.focus(); return; }
      busy = true; sync(); form.setAttribute('aria-busy', 'true');
      btn.textContent = 'Redeeming…';
      setMsg('', '');
      API.redeem(code).then(function (r) {
        busy = false; form.removeAttribute('aria-busy'); btn.textContent = 'Redeem Code';
        input.value = '';
        setMsg('', '');
        sync();
        showResult(r);
        if (opts.onRedeemed) { try { opts.onRedeemed(r); } catch (e) { /* the overview refresh must never break the answer */ } }
      }, function (err) {
        busy = false; form.removeAttribute('aria-busy'); btn.textContent = 'Redeem Code';
        sync();
        var text = API.friendlyError(err);
        var expired = err && err.status === 401;
        setMsg(expired ? [text + ' ', signInLink('Sign in')] : text, 'error');
        clear(resultHost);
        try { input.focus(); } catch (e) { /* ignore */ }
      });
    });

    function showResult(r) {
      var d = API.describe(r);
      clear(resultHost);
      var panel = el('section', { 'class': 'rd-result ' + d.kind, role: 'status', 'aria-live': 'polite' });
      panel.appendChild(el('p', { 'class': 'rd-badge' + (d.kind === 'nothing' ? ' dim' : ''), text: d.kind === 'nothing' ? 'Code used' : 'Code redeemed' }));
      panel.appendChild(el('h2', { 'class': 'rd-title', text: d.title }));
      if (d.lines.length) {
        var ul = el('ul', { 'class': 'rd-lines' });
        d.lines.forEach(function (l) { ul.appendChild(el('li', { text: l })); });
        panel.appendChild(ul);
      }
      if (d.tiles.length) {
        var tiles = el('div', { 'class': 'rd-tiles' });
        d.tiles.forEach(function (t) { tiles.appendChild(el('div', { 'class': 'rd-tile' }, [el('b', { text: t.value }), el('span', { text: t.label })])); });
        panel.appendChild(tiles);
      }
      var fine = [d.appliedTo, d.code ? 'Code ' + d.code : ''].filter(Boolean).join(' ');
      if (fine) panel.appendChild(el('p', { 'class': 'rd-fine', text: fine }));
      var acts = el('div', { 'class': 'rd-actions' });
      if (d.play) acts.appendChild(el('a', { 'class': 'rd-btn primary', href: d.play.href, text: d.play.label }));
      var again = el('button', { type: 'button', 'class': 'rd-btn', text: 'Redeem another code' });
      again.addEventListener('click', function () { clear(resultHost); input.focus(); });
      acts.appendChild(again);
      panel.appendChild(acts);
      resultHost.appendChild(panel);
      try { panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* old browser */ }
    }

    return { focus: function () { try { input.focus(); } catch (e) { /* ignore */ } } };
  }

  // ---------- the account overview's lists ----------

  function fmtDate(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return iso || '';
    try { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return new Date(t).toISOString().slice(0, 10); }
  }

  var PLAY = { deadweight: '/DEADWEIGHT/', brawlpit: '/BRAWLPIT/' };

  function renderGames(host, games) {
    clear(host);
    host.classList.add('rd');
    if (!games || !games.length) {
      host.appendChild(el('p', { 'class': 'rd-empty', text: 'No game accounts yet. Open DEADWEIGHT and sign in with IDUNA to start one.' }));
      host.appendChild(el('p', {}, [el('a', { 'class': 'rd-btn', href: PLAY.deadweight, text: 'Play DEADWEIGHT' })]));
      return;
    }
    games.forEach(function (g) {
      var row = el('div', { 'class': 'rd-game' });
      var head = el('div', { 'class': 'rd-game-head' }, [el('b', { text: g.name || String(g.game).toUpperCase() })]);
      if (g.founder) head.appendChild(el('span', { 'class': 'rd-chip', text: 'Founder' }));
      row.appendChild(head);
      var meta = [];
      if (g.display_name) meta.push('Playing as ' + g.display_name);
      meta.push(API.fmt(g.tickets) + ' ' + (g.game === 'deadweight' ? 'Draft tickets' : 'tickets'));
      row.appendChild(el('p', { 'class': 'rd-game-meta', text: meta.join(' · ') }));
      if (PLAY[g.game]) row.appendChild(el('a', { 'class': 'rd-link', href: PLAY[g.game], text: 'Open ' + (g.name || g.game) }));
      host.appendChild(row);
    });
  }

  function renderHistory(host, redemptions) {
    clear(host);
    host.classList.add('rd');
    if (!redemptions || !redemptions.length) {
      host.appendChild(el('p', { 'class': 'rd-empty', text: 'Nothing redeemed yet. Codes you redeem show up here.' }));
      return;
    }
    var list = el('ul', { 'class': 'rd-history' });
    redemptions.forEach(function (x) {
      list.appendChild(el('li', {}, [
        el('span', { 'class': 'rd-h-date', text: fmtDate(x.redeemed_at) }),
        el('span', { 'class': 'rd-h-what' }, [el('b', { text: (x.game_name || String(x.game).toUpperCase()) + ' ' }), API.summarize(x)]),
        el('code', { 'class': 'rd-h-code', text: x.code }),
        el('span', { 'class': 'rd-h-state', text: 'Complete' })
      ]));
    });
    host.appendChild(list);
  }

  root.RedeemWidget = { mountForm: mountForm, renderGames: renderGames, renderHistory: renderHistory, fmtDate: fmtDate };
})(typeof window !== 'undefined' ? window : globalThis);
