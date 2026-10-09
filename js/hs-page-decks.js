// /hearthstone/ -- deck browser.
(function () {
  'use strict';
  var h = UI.h, PAGE = 24;
  var st = { cls: '', format: '', sort: 'new', q: '', offset: 0, total: 0, req: 0 };
  var grid = UI.$('grid'), more = UI.$('more'), count = UI.$('count');
  var chipBox = UI.$('class-chips'), fmtSel = UI.$('format'), sortSel = UI.$('sort'), q = UI.$('q');

  // ---- controls ----
  var chips = {};
  function chip(label, val) {
    var b = h('button', { type: 'button', 'class': 'hs-chip' + (val ? '' : ' all'), 'aria-pressed': 'false', text: label, 'data-class': val ? UI.classKey(val) : null,
      on: { click: function () { st.cls = (st.cls === val) ? '' : val; paintChips(); reload(); } } });
    chips[val] = b;
    chipBox.appendChild(b);
  }
  chip('All classes', '');
  UI.CLASSES.forEach(function (c) { chip(c, c); });
  function paintChips() {
    Object.keys(chips).forEach(function (k) { chips[k].setAttribute('aria-pressed', String(k === st.cls)); });
  }
  UI.FORMATS.forEach(function (f) { fmtSel.appendChild(h('option', { value: f, text: f })); });

  // ---- URL <-> state (shareable filters) ----
  function readURL() {
    var p = UI.params();
    st.cls = UI.CLASSES.indexOf(p.get('class')) >= 0 ? p.get('class') : '';
    st.format = UI.FORMATS.indexOf(p.get('format')) >= 0 ? p.get('format') : '';
    st.sort = ['new', 'top', 'trending'].indexOf(p.get('sort')) >= 0 ? p.get('sort') : 'new';
    st.q = (p.get('q') || '').slice(0, 80);
    fmtSel.value = st.format; sortSel.value = st.sort; q.value = st.q;
    paintChips();
  }
  function writeURL() {
    var p = new URLSearchParams();
    if (st.cls) p.set('class', st.cls);
    if (st.format) p.set('format', st.format);
    if (st.sort !== 'new') p.set('sort', st.sort);
    if (st.q) p.set('q', st.q);
    var s = p.toString();
    try { history.replaceState(null, '', location.pathname + (s ? '?' + s : '')); } catch (e) { /* ignore */ }
  }

  // ---- loading ----
  async function load(append) {
    var my = ++st.req;
    grid.setAttribute('aria-busy', 'true');
    if (!append) { UI.skeleton(grid, 6); more.hidden = true; count.textContent = ''; }
    try {
      var res = await HS.get('/decks', { sort: st.sort, 'class': st.cls, format: st.format, q: st.q, limit: PAGE, offset: st.offset });
      if (my !== st.req) return; // a newer request superseded this one
      var items = (res && res.items) || [];
      st.total = (res && res.total) || 0;
      if (!append) UI.clear(grid);
      items.forEach(function (d) { grid.appendChild(UI.deckCard(d)); });
      st.offset += items.length;
      count.textContent = st.total + (st.total === 1 ? ' deck' : ' decks');
      if (!grid.children.length) {
        var filtered = st.cls || st.format || st.q;
        grid.appendChild(UI.emptyState(filtered ? 'No decks match' : 'No decks yet',
          filtered ? 'Try clearing a filter or searching for something broader.' : 'Be the first to share one.',
          filtered ? h('button', { type: 'button', 'class': 'hs-btn', text: 'Clear filters', on: { click: clearAll } })
                   : h('a', { 'class': 'hs-btn', href: '/hearthstone/submit.html', text: 'Share a deck' })));
        grid.firstChild.style.gridColumn = '1 / -1';
      }
      more.hidden = !(st.offset < st.total && items.length);
    } catch (e) {
      if (my !== st.req) return;
      if (!append) {
        UI.clear(grid);
        var er = UI.errorState(e.message, function () { load(false); });
        er.style.gridColumn = '1 / -1';
        grid.appendChild(er);
      } else UI.toast(e.message, 'err');
    } finally { if (my === st.req) { grid.setAttribute('aria-busy', 'false'); UI.$('more-btn').disabled = false; } }
  }
  function reload() { st.offset = 0; writeURL(); load(false); }
  function clearAll() { st.cls = st.format = st.q = ''; st.sort = 'new'; fmtSel.value = ''; sortSel.value = 'new'; q.value = ''; paintChips(); reload(); }

  fmtSel.addEventListener('change', function () { st.format = fmtSel.value; reload(); });
  sortSel.addEventListener('change', function () { st.sort = sortSel.value; reload(); });
  var deb = UI.debounce(function () { st.q = q.value.trim(); reload(); }, 300);
  q.addEventListener('input', deb);
  UI.$('more-btn').addEventListener('click', function (e) { e.currentTarget.disabled = true; load(true); });

  readURL();
  load(false);
})();
