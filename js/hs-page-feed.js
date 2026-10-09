// /hearthstone/feed.html -- All / Following feed with a composer.
(function () {
  'use strict';
  var h = UI.h, PAGE = 20;
  var panel = UI.$('panel'), more = UI.$('more'), moreBtn = UI.$('more-btn'), slot = UI.$('composer-slot');
  var tabs = { all: UI.$('tab-all'), following: UI.$('tab-following') };
  var who = { signedIn: false, me: null };
  var st = { scope: 'all', before: '', req: 0, shown: 0 };

  function setScope(scope) {
    st.scope = scope;
    Object.keys(tabs).forEach(function (k) {
      tabs[k].setAttribute('aria-selected', String(k === scope));
      tabs[k].tabIndex = k === scope ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', 'tab-' + scope);
    try { history.replaceState(null, '', location.pathname + (scope === 'all' ? '' : '?scope=following')); } catch (e) { /* ignore */ }
    load(false);
  }
  Object.keys(tabs).forEach(function (k) {
    tabs[k].addEventListener('click', function () { setScope(k); });
    tabs[k].addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { var o = k === 'all' ? 'following' : 'all'; setScope(o); tabs[o].focus(); }
    });
  });

  function mountComposer() {
    UI.clear(slot);
    slot.appendChild(Social.composer({
      who: who, placeholder: 'Post something to your wall', max: 500, label: 'Post', signInText: 'to post to your wall',
      onSubmit: async function (body) {
        var p = await HS.post('/wall', { body: body });
        if (!p || !p.body) p = { id: p && p.id, body: body, created_at: new Date().toISOString(), author: { handle: who.me.handle }, likes: 0, comments: 0 };
        if (!p.author) p.author = { handle: who.me.handle };
        var empty = panel.querySelector('.hs-empty'); if (empty) empty.remove();
        panel.insertBefore(Social.postCard(p, { who: who }), panel.firstChild);
        UI.toast('Posted.');
      }
    }));
  }

  async function load(append) {
    var my = ++st.req;
    panel.setAttribute('aria-busy', 'true');
    if (!append) { st.before = ''; st.shown = 0; UI.skeleton(panel, 3, 'row'); more.hidden = true; }
    if (st.scope === 'following' && !who.signedIn) {
      UI.clear(panel); panel.setAttribute('aria-busy', 'false');
      panel.appendChild(UI.emptyState('Your following feed', 'Posts from people you follow show up here.', h('div', { style: { 'margin-top': '.8rem' } }, UI.signInHint('to follow people'))));
      return;
    }
    try {
      var res = await HS.get('/feed', { scope: st.scope, limit: PAGE, before: st.before });
      if (my !== st.req) return;
      var items = (res && res.items) || [];
      if (!append) UI.clear(panel);
      items.forEach(function (p) { panel.appendChild(Social.postCard(p, { who: who })); });
      st.shown += items.length;
      // `before` is a cursor; the server may hand back next_before, otherwise use the last item's id.
      st.before = (res && res.next_before) || (items.length ? items[items.length - 1].id : st.before);
      if (!st.shown) {
        panel.appendChild(UI.emptyState(st.scope === 'following' ? 'Nothing here yet' : 'No posts yet',
          st.scope === 'following' ? 'Follow some players and their posts will gather here.' : 'Be the first to post on your wall.',
          st.scope === 'following' ? h('a', { 'class': 'hs-btn', href: '/hearthstone/players.html', text: 'Find players' }) : null));
      }
      more.hidden = items.length < PAGE;
    } catch (e) {
      if (my !== st.req) return;
      if (!append) { UI.clear(panel); panel.appendChild(UI.errorState(e.message, function () { load(false); })); }
      else UI.toast(e.message, 'err');
    } finally { if (my === st.req) { panel.setAttribute('aria-busy', 'false'); moreBtn.disabled = false; } }
  }
  moreBtn.addEventListener('click', function () { moreBtn.disabled = true; load(true); });

  HS.who().then(function (w) {
    who = w; mountComposer();
    setScope(UI.params().get('scope') === 'following' ? 'following' : 'all');
  });
})();
