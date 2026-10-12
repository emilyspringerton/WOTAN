// /clubs/ -- directory + search + sort + create-club dialog. GET /clubs?q=&sort=&limit=&offset= (never Secret).
(function () {
  'use strict';
  var h = UI.h, PAGE = 24;
  var list = UI.$('list'), more = UI.$('more'), moreBtn = UI.$('more-btn'), q = UI.$('q'), sortSel = UI.$('sort');
  var st = { q: '', sort: 'prestige', offset: 0, total: 0, req: 0 };

  async function load(append) {
    var my = ++st.req;
    list.setAttribute('aria-busy', 'true');
    if (!append) { UI.skeleton(list, 6, 'row'); more.hidden = true; }
    try {
      var res = await CLUB.get('', { q: st.q, sort: st.sort, limit: PAGE, offset: st.offset });
      if (my !== st.req) return;
      var items = CLUB.items(res);
      st.total = (res && res.total) || 0;
      if (!append) UI.clear(list);
      items.forEach(function (c) { list.appendChild(CUI.clubCard(c)); });
      st.offset += items.length;
      if (!list.children.length) {
        list.appendChild(UI.emptyState(st.q ? 'No clubs match' : 'No clubs yet', st.q ? 'Try fewer letters.' : 'Be the first: create one above.'));
      }
      more.hidden = !(st.offset < st.total && items.length);
    } catch (e) {
      if (my !== st.req) return;
      if (!append) { UI.clear(list); list.appendChild(UI.errorState(e.message, function () { load(false); })); } else UI.toast(e.message, 'err');
    } finally { if (my === st.req) { list.setAttribute('aria-busy', 'false'); moreBtn.disabled = false; } }
  }
  function reload() { st.offset = 0; load(false); }
  q.addEventListener('input', UI.debounce(function () { st.q = q.value.trim(); reload(); }, 300));
  sortSel.addEventListener('change', function () { st.sort = sortSel.value; reload(); });
  moreBtn.addEventListener('click', function () { moreBtn.disabled = true; load(true); });

  // ---- create-club dialog ----
  var dlg = UI.$('create-dlg'), createBtn = UI.$('create-btn'), hint = UI.$('create-hint');
  var TIERS = [
    [1, 'Secret', 'Invisible to outsiders. Invite only.'],
    [2, 'Private', 'Public roster page. Everything else members only.'],
    [3, 'Social', 'Public roster and featured decks.']
  ];
  function buildDialog() {
    UI.clear(dlg);
    var name = h('input', { 'class': 'hs-input', id: 'cc-name', maxlength: '40', autocomplete: 'off', required: true });
    var slug = h('input', { 'class': 'hs-input', id: 'cc-slug', maxlength: '30', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-describedby': 'cc-slug-hint' });
    var slugHint = h('p', { 'class': 'hs-hint', id: 'cc-slug-hint', text: '3 to 30 characters: lowercase letters, numbers and hyphens. Cannot be changed later.' });
    var tag = h('input', { 'class': 'hs-input', id: 'cc-tag', maxlength: '120', autocomplete: 'off' });
    var excl = h('input', { type: 'checkbox', id: 'cc-excl' });
    var err = h('p', { 'class': 'hs-msg err', role: 'alert', hidden: true });
    var touched = false;
    name.addEventListener('input', function () { if (!touched) slug.value = CUI.slugify(name.value); });
    slug.addEventListener('input', function () { touched = true; var ok = !slug.value || CUI.SLUG_RE.test(slug.value); slugHint.className = 'hs-hint' + (ok ? '' : ' err'); });
    var tierBox = h('div', { 'class': 'club-radios', role: 'radiogroup', 'aria-label': 'Privacy tier' },
      TIERS.map(function (t) {
        return h('label', { 'class': 'club-radio' },
          h('input', { type: 'radio', name: 'cc-tier', value: String(t[0]), checked: t[0] === 1, 'aria-label': t[1] }),
          h('b', { text: t[1] }), h('span', { text: t[2] }));
      }));
    var submit = h('button', { type: 'submit', 'class': 'hs-btn solid', text: 'Create club' });
    var form = h('form', { novalidate: true },
      h('h2', { 'class': 'hs-h2', id: 'create-title', text: 'Create a club' }),
      h('div', { 'class': 'hs-field' }, h('label', { 'class': 'hs-label', 'for': 'cc-name', text: 'Name' }), name),
      h('div', { 'class': 'hs-field' }, h('label', { 'class': 'hs-label', 'for': 'cc-slug', text: 'Address' }), slug, slugHint),
      h('div', { 'class': 'hs-field' }, h('label', { 'class': 'hs-label', 'for': 'cc-tag', text: 'Tagline (optional)' }), tag),
      h('span', { 'class': 'hs-label', text: 'Who can see it' }), tierBox,
      h('label', { 'class': 'club-check' }, excl, h('span', null, h('b', { text: 'Exclusive. ' }), 'Members may not belong to any other club. You can turn this off later.')),
      h('div', { 'class': 'hs-actions', style: { 'margin-top': '1rem' } }, submit,
        h('button', { type: 'button', 'class': 'hs-btn ghost', text: 'Cancel', on: { click: function () { closeDlg(); } } })), err);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      err.hidden = true;
      var s = slug.value.trim().toLowerCase();
      if (name.value.trim().length < 2) { err.textContent = 'Give the club a name.'; err.hidden = false; return; }
      if (!CUI.SLUG_RE.test(s)) { err.textContent = 'The address must be 3 to 30 characters: lowercase letters, numbers and hyphens.'; err.hidden = false; return; }
      var tier = Number((form.querySelector('input[name=cc-tier]:checked') || {}).value || 1);
      UI.withBusy(submit, async function () {
        try {
          await CLUB.post('', { name: name.value.trim(), slug: s, tagline: tag.value.trim(), privacy_tier: tier, is_exclusive: !!excl.checked });
          location.href = '/clubs/manage.html?s=' + encodeURIComponent(s);
        } catch (e) {
          if (window.IDGate && window.IDGate.handleError(e, { action: 'create a club' })) { closeDlg(); return; }
          err.textContent = CUI.errMessage(e);
          err.hidden = false;
        }
      });
    });
    dlg.appendChild(form);
    setTimeout(function () { name.focus(); }, 0);
  }
  function openDlg() {
    buildDialog();
    if (typeof dlg.showModal === 'function') { try { dlg.showModal(); return; } catch (e) { /* fall through */ } }
    dlg.setAttribute('open', '');
  }
  function closeDlg() { if (typeof dlg.close === 'function') { try { dlg.close(); return; } catch (e) { /* ignore */ } } dlg.removeAttribute('open'); }

  createBtn.addEventListener('click', async function () {
    if (!CLUB.hasSession()) {
      UI.clear(hint);
      hint.hidden = false;
      hint.appendChild(UI.signInHint('to create a club'));
      UI.toast('Sign in from the top bar to create a club.', 'err');
      return;
    }
    // Creating a club needs a linked Battle.net account (IDENTITY_NORTHSTAR section 5); UX gate only, the server enforces.
    if (window.IDGate && !(await window.IDGate.require({ action: 'create a club' }))) return;
    openDlg();
  });
  if (window.IDGate) window.IDGate.banner(UI.$('id-grace'));
  load(false);
})();
