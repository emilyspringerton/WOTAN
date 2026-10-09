// /hearthstone/players.html -- handle search + list.
(function () {
  'use strict';
  var h = UI.h, PAGE = 24;
  var list = UI.$('list'), more = UI.$('more'), moreBtn = UI.$('more-btn'), q = UI.$('q'), sortSel = UI.$('sort');
  var st = { q: '', sort: 'followed', offset: 0, total: 0, req: 0 };

  function row(u) {
    var n = u.followers || 0;
    return h('article', { 'class': 'hs-person' },
      h('a', { 'class': 'handle', href: '/hearthstone/u.html?h=' + encodeURIComponent(u.handle), text: '@' + u.handle }),
      h('div', { 'class': 'num' }, h('b', { text: String(n) }), n === 1 ? 'follower' : 'followers'),
      u.bio ? h('p', { 'class': 'bio', text: u.bio }) : null,
      u.created_at ? h('p', { 'class': 'hs-meta', style: { margin: '0', 'grid-column': '1 / -1' }, text: 'Joined ' + UI.monthYear(u.created_at) }) : null);
  }

  async function load(append) {
    var my = ++st.req;
    list.setAttribute('aria-busy', 'true');
    if (!append) { UI.skeleton(list, 5, 'row'); more.hidden = true; }
    try {
      var res = await HS.get('/users', { q: st.q, sort: st.sort, limit: PAGE, offset: st.offset });
      if (my !== st.req) return;
      var items = (res && res.items) || [];
      st.total = (res && res.total) || 0;
      if (!append) UI.clear(list);
      items.forEach(function (u) { list.appendChild(row(u)); });
      st.offset += items.length;
      if (!list.children.length) list.appendChild(UI.emptyState(st.q ? 'No one by that name' : 'No players yet', st.q ? 'Check the spelling, or try fewer letters.' : 'Claim a handle from the account menu to be the first.'));
      more.hidden = !(st.offset < st.total && items.length);
    } catch (e) {
      if (my !== st.req) return;
      if (!append) { UI.clear(list); list.appendChild(UI.errorState(e.message, function () { load(false); })); } else UI.toast(e.message, 'err');
    } finally { if (my === st.req) { list.setAttribute('aria-busy', 'false'); moreBtn.disabled = false; } }
  }
  function reload() { st.offset = 0; load(false); }
  q.addEventListener('input', UI.debounce(function () { st.q = q.value.trim().replace(/^@/, ''); reload(); }, 300));
  sortSel.addEventListener('change', function () { st.sort = sortSel.value; reload(); });
  moreBtn.addEventListener('click', function () { moreBtn.disabled = true; load(true); });
  load(false);
})();
