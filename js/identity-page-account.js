// /account/ -- linked accounts, privacy toggles and tracker upload keys (IDENTITY_NORTHSTAR.md section 8).
// All backend access goes through js/identity-api.js (IDAPI). User-supplied text only reaches the DOM through
// textContent (UI.h).
(function () {
  'use strict';
  var h = UI.h, API = window.IDAPI, GATE = window.IDGate;
  var root = UI.$('root');
  var state = { ids: null };

  function sec(id, title, desc) {
    return h('section', { 'class': 'hs-panel club-sec', id: id },
      h('h2', { 'class': 'club-sec-h', text: title }), desc ? h('p', { 'class': 'hs-meta', text: desc }) : null);
  }
  function errMsg(e) { return (e && e.message) || 'Something went wrong.'; }
  function when(iso) { return iso ? UI.ago(iso) : 'never'; }
  function provLabel(p) { return API.PROVIDER_LABEL[p] || p; }

  // ---- linked accounts ----
  function identityRow(i, canUnlink, onChange) {
    var unlinkBtn;
    var reason = 'This is your last way to sign in, or your upload keys depend on it. Add another sign-in method or revoke your upload keys first.';
    if (canUnlink === false) {
      unlinkBtn = h('span', { 'class': 'club-tip', title: reason, tabindex: '0', 'data-reason': reason },
        h('button', { type: 'button', 'class': 'hs-btn sm ghost', text: 'Unlink', disabled: true, 'aria-disabled': 'true' }),
        h('span', { 'class': 'hs-sr', text: ' (' + reason + ')' }));
    } else {
      unlinkBtn = h('button', { type: 'button', 'class': 'hs-btn sm danger', text: 'Unlink' });
      unlinkBtn.addEventListener('click', function () {
        if (!window.confirm('Unlink ' + provLabel(i.provider) + (i.display ? ' (' + i.display + ')' : '') + ' from your WOTAN account?')) return;
        UI.withBusy(unlinkBtn, async function () {
          try { await API.unlink(i.id); UI.toast('Unlinked.'); onChange(); }
          catch (e) { UI.toast(errMsg(e), 'err'); }
        });
      });
    }
    var revoked = i.status && i.status !== 'active';
    return h('article', { 'class': 'club-member id-identity', style: { 'margin-bottom': '.5rem' } },
      h('div', { 'class': 'who' },
        h('span', { text: provLabel(i.provider) }),
        i.display ? h('span', { 'class': 'bt', text: i.display }) : null,
        i.verified ? h('span', { 'class': 'hs-badge plain', text: 'Verified', title: 'Ownership confirmed by the provider' }) : null,
        revoked ? h('span', { 'class': 'hs-badge plain warn', text: i.status }) : null),
      h('div', { 'class': 'rk hs-meta' },
        h('span', { text: 'Linked ' + when(i.linked_at) }), h('span', { text: 'Last sign-in ' + when(i.last_login_at) })),
      h('div', { 'class': 'acts' }, unlinkBtn));
  }

  function renderLinked(box, d, onChange) {
    var by = { battlenet: [], google: [], twitch: [], other: [] };
    d.identities.forEach(function (i) { (by[i.provider] || by.other).push(i); });
    function group(title, items, note) {
      var g = h('div', { 'class': 'id-group' }, h('h3', { 'class': 'hs-h3', text: title }), note ? h('p', { 'class': 'hs-meta', text: note }) : null);
      items.forEach(function (i) { g.appendChild(identityRow(i, d.canUnlink[String(i.id)], onChange)); });
      return g;
    }
    var bn = group('Battle.net', by.battlenet,
      'Your competitive identity. Link one per Battle.net account you play on; smurfs and alternate accounts are separate Battle.net accounts, so link each one.');
    if (!by.battlenet.length) bn.appendChild(h('p', { 'class': 'hs-meta', text: 'No Battle.net account linked yet.' }));
    bn.appendChild(h('div', { 'class': 'hs-actions' }, h('button', { type: 'button', 'class': 'hs-btn', id: 'link-bnet',
      text: by.battlenet.length ? 'Link another Battle.net account' : 'Link a Battle.net account',
      on: { click: function () { API.beginLink('battlenet'); } } })));
    box.appendChild(bn);

    var tw = group('Twitch', by.twitch, 'Optional. Lets WOTAN show your Twitch name instead of your handle, only if you turn that on below. WOTAN requests no Twitch permissions.');
    if (!by.twitch.length) tw.appendChild(h('div', { 'class': 'hs-actions' }, h('button', { type: 'button', 'class': 'hs-btn', id: 'link-twitch', text: 'Link Twitch',
      on: { click: function () { API.beginLink('twitch'); } } })));
    box.appendChild(tw);

    var other = by.google.concat(by.other);
    if (other.length) box.appendChild(group('Sign-in methods', other));
  }

  // ---- privacy ----
  function renderPrivacy(box, d) {
    var hasTwitch = d.identities.some(function (i) { return i.provider === 'twitch' && (!i.status || i.status === 'active'); });
    function toggle(field, label, hint, disabled) {
      var cb = h('input', { type: 'checkbox', checked: !!d.prefs[field], disabled: !!disabled });
      cb.addEventListener('change', function () {
        var want = cb.checked, body = {}; body[field] = want; cb.disabled = true;
        API.setPrefs(body).then(function () { d.prefs[field] = want; cb.disabled = false; UI.toast('Saved.'); },
          function (e) { cb.checked = !want; cb.disabled = false; UI.toast(errMsg(e), 'err'); });
      });
      return h('label', { 'class': 'club-check' }, cb, h('span', null, h('b', { text: label + ' ' }), hint));
    }
    box.appendChild(toggle('show_twitch_name', 'Show my Twitch name.', hasTwitch
      ? 'Rosters and posts show your Twitch name (with a Twitch mark) instead of your @handle.'
      : 'Link Twitch above to use this.', !hasTwitch));
    box.appendChild(toggle('show_battletag', 'Show my BattleTag publicly.',
      'Off by default. Your BattleTag stays private unless you turn this on.', false));
  }

  // ---- upload keys ----
  function copyBtn(getText, what) {
    return h('button', { type: 'button', 'class': 'hs-btn sm', text: 'Copy', on: { click: function () { UI.copyWithToast(getText(), what); } } });
  }
  function cmdBlock(title, text, note) {
    var ta = h('textarea', { 'class': 'hs-textarea trk-cmd', readonly: true, spellcheck: 'false', rows: '3', 'aria-label': title });
    ta.value = text;
    return h('div', { 'class': 'id-cmd' }, h('h4', { 'class': 'hs-h3', text: title }), note ? h('p', { 'class': 'hs-meta', text: note }) : null, ta,
      h('p', null, copyBtn(function () { return ta.value; }, title)));
  }
  function renderReveal(host, created) {
    UI.clear(host);
    var cmds = API.oneLiners(location.origin, created.key);
    var keyInput = h('input', { 'class': 'hs-input id-keybox', readonly: true, 'aria-label': 'Your new upload key' });
    keyInput.value = created.key;
    var dismiss = h('button', { type: 'button', 'class': 'hs-btn ghost', text: 'I have saved it', on: { click: function () { UI.clear(host); host.hidden = true; } } });
    host.hidden = false;
    host.appendChild(h('div', { 'class': 'id-reveal', role: 'alert' },
      h('h3', { 'class': 'hs-h3', text: 'Your new upload key' }),
      h('p', { 'class': 'id-grace', text: 'This is the only time the key is shown. WOTAN stores only a hash, so it cannot be recovered. If you lose it, revoke it and make a new one.' }),
      h('div', { 'class': 'hs-actions' }, keyInput, copyBtn(function () { return created.key; }, 'Upload key')),
      cmdBlock('Quick install (key in the command)', cmds.inline,
        'Convenient, but the key ends up in your PowerShell history and any process logging. Fine on a PC only you use.'),
      cmdBlock('Safer: paste the key once', cmds.saveOnce,
        'The key is not in the command. The script asks for it at a hidden prompt (paste the key above), then saves it encrypted for your Windows user under %APPDATA%\\WOTAN. After that, the Desktop shortcut just works.'),
      dismiss));
    try { keyInput.focus(); keyInput.select(); } catch (e) { /* ignore */ }
  }

  function keyCounters(k) {
    var parts = [h('span', { text: k.uploads_ok + ' accepted' })];
    if (k.rejected_tag_mismatch) parts.push(h('span', { 'class': 'id-rej', text: k.rejected_tag_mismatch + ' rejected: BattleTag not linked' }));
    return parts;
  }
  function renderKeyList(host, keys, onChange) {
    UI.clear(host);
    if (!keys.length) { host.appendChild(h('p', { 'class': 'hs-meta', text: 'No upload keys yet.' })); return; }
    var anyRej = false;
    keys.forEach(function (k) {
      if (k.rejected_tag_mismatch) anyRej = true;
      var revoked = !!k.revoked_at;
      var rev = h('button', { type: 'button', 'class': 'hs-btn sm danger', text: 'Revoke' });
      rev.addEventListener('click', function () {
        if (!window.confirm('Revoke key ' + k.key_prefix + '? Trackers using it stop uploading right away.')) return;
        UI.withBusy(rev, async function () {
          try { await API.revokeUploadKey(k.id); UI.toast('Key revoked.'); onChange(); }
          catch (e) { UI.toast(errMsg(e), 'err'); }
        });
      });
      host.appendChild(h('article', { 'class': 'club-member id-key' + (revoked ? ' revoked' : ''), style: { 'margin-bottom': '.5rem' } },
        h('div', { 'class': 'who' }, h('span', { 'class': 'bt', text: k.key_prefix + '…' }), k.label ? h('span', { text: k.label }) : null,
          revoked ? h('span', { 'class': 'hs-badge plain warn', text: 'Revoked ' + UI.ago(k.revoked_at) }) : h('span', { 'class': 'hs-badge plain', text: 'Active' })),
        h('div', { 'class': 'rk hs-meta' }, h('span', { text: 'Created ' + when(k.created_at) }), h('span', { text: 'Last used ' + when(k.last_used_at) }), keyCounters(k)),
        h('div', { 'class': 'acts' }, revoked ? null : rev)));
    });
    if (anyRej) {
      host.appendChild(h('p', { 'class': 'hs-meta id-rej-note', text: 'Rejected uploads are games whose log named a BattleTag that is not linked to your WOTAN account (for example an alternate account you have not linked, or someone else’s log). They are dropped, so those games are missing from your stats. Link that Battle.net account above to include them going forward.' }));
    }
  }

  async function renderKeys(box, d) {
    var revealHost = h('div', { hidden: true });
    var listHost = h('div', { 'aria-busy': 'true' });
    var gated = !d.battlenetLinked && !API.graceActive(d.graceUntil);

    var label = h('input', { 'class': 'hs-input', maxlength: '40', placeholder: 'Label, e.g. Gaming PC', 'aria-label': 'Key label', autocomplete: 'off' });
    var create = h('button', { type: 'button', 'class': 'hs-btn solid', id: 'create-key', text: 'Create upload key' });
    create.addEventListener('click', async function () {
      if (GATE && !(await GATE.require({ action: 'create a tracker upload key' }))) return;
      UI.withBusy(create, async function () {
        try {
          var c = await API.createUploadKey(label.value.trim());
          if (!c.key) throw new Error('The server did not return a key. Try again.');
          label.value = '';
          renderReveal(revealHost, c);
          await loadList();
        } catch (e) {
          if (GATE && GATE.handleError(e, { action: 'create a tracker upload key' })) return;
          UI.toast(errMsg(e), 'err');
        }
      });
    });
    async function loadList() {
      try { renderKeyList(listHost, await API.uploadKeys(), loadList); }
      catch (e) { UI.clear(listHost); listHost.appendChild(UI.errorState(errMsg(e), loadList)); }
      listHost.setAttribute('aria-busy', 'false');
    }

    if (gated) {
      box.appendChild(h('p', { 'class': 'id-grace', role: 'note', text: 'Upload keys need a linked Battle.net account. Link one above, then come back here.' }));
    } else {
      box.appendChild(h('div', { 'class': 'hs-actions' }, label, create));
    }
    var generic = API.oneLiners(location.origin, '');
    box.appendChild(revealHost);
    box.appendChild(listHost);
    box.appendChild(h('details', { 'class': 'id-saveonce' },
      h('summary', { 'class': 'hs-meta', text: 'Already have a key? Save it on a new PC' }),
      cmdBlock('Paste the key once', generic.saveOnce, 'Runs the tracker and asks for your key at a hidden prompt, then stores it encrypted for this Windows user.')));
    await loadList();
  }

  // ---- page ----
  async function init() {
    if (!API.hasSession()) {
      UI.clear(root); root.setAttribute('aria-busy', 'false');
      root.appendChild(UI.emptyState('Sign in required', 'Account settings are only for signed-in players.', h('div', null, UI.signInHint('to manage your account'))));
      return;
    }
    var ret = API.readLinkReturn(location.search, location.hash);
    if (ret.linked || ret.error) {
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
    }
    UI.clear(root);
    root.setAttribute('aria-busy', 'false');
    root.appendChild(h('header', { 'class': 'hs-hero' }, h('div', null, h('p', { 'class': 'hs-eyebrow', text: 'Account' }),
      h('h1', { 'class': 'hs-h1', text: 'Linked accounts and tracker keys' }),
      h('p', { 'class': 'hs-lede', text: 'Link the accounts you play and stream with, choose what others see, and manage the keys your PC tracker uses to upload games.' }))));
    var notice = h('div', { role: 'status' });
    if (ret.linked) notice.appendChild(h('p', { 'class': 'hs-msg ok', text: (API.PROVIDER_LABEL[ret.linked] || ret.linked) + ' account linked.' }));
    if (ret.error) { notice.appendChild(h('p', { 'class': 'hs-msg err', role: 'alert', text: API.friendly(ret.error, 'Linking did not finish (' + ret.error + '). Try again.') })); }
    root.appendChild(notice);
    var graceHost = h('div', { hidden: true });
    root.appendChild(graceHost);
    var linkedBox = sec('linked', 'Linked accounts', 'Every account here signs in to the same WOTAN profile.');
    var privBox = sec('privacy', 'Privacy', 'What other players can see about you.');
    var keysBox = sec('keys', 'Tracker upload keys', 'A key lets the tracker on your PC upload your games without signing in each time. It can only upload; it cannot read your account.');
    root.appendChild(linkedBox); root.appendChild(privBox); root.appendChild(keysBox);
    linkedBox.appendChild(h('div', { 'class': 'hs-skel', style: { 'min-height': '6rem' } }));

    var d;
    try { d = await API.identities(); }
    catch (e) {
      UI.clear(linkedBox); linkedBox.appendChild(UI.errorState(errMsg(e), init));
      privBox.hidden = true; keysBox.hidden = true;
      return;
    }
    state.ids = d;
    if (GATE) await GATE.banner(graceHost);
    function reload() { init(); }
    UI.clear(linkedBox);
    linkedBox.appendChild(h('h2', { 'class': 'club-sec-h', text: 'Linked accounts' }));
    renderLinked(linkedBox, d, reload);
    renderPrivacy(privBox, d);
    await renderKeys(keysBox, d);
  }
  init();
})();
