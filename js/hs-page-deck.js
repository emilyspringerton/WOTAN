// /hearthstone/deck.html?id= -- deck detail.
(function () {
  'use strict';
  var h = UI.h;
  var root = UI.$('root');
  var id = UI.params().get('id');

  function fail(msg, retry) { UI.clear(root); root.setAttribute('aria-busy', 'false'); root.appendChild(UI.errorState(msg, retry)); }

  async function init() {
    if (!id) { UI.clear(root); root.appendChild(UI.emptyState('No deck selected', 'Pick one from the library.', h('a', { 'class': 'hs-btn', href: '/hearthstone/', text: 'Browse decks' }))); root.setAttribute('aria-busy', 'false'); return; }
    var who = await HS.who();
    var d;
    try { d = await HS.get('/decks/' + encodeURIComponent(id)); }
    catch (e) {
      if (e.status === 404) { UI.clear(root); root.setAttribute('aria-busy', 'false'); root.appendChild(UI.emptyState('Deck not found', 'It may have been removed by its author.', h('a', { 'class': 'hs-btn', href: '/hearthstone/', text: 'Browse decks' }))); return; }
      return fail(e.message, init);
    }
    render(d, who);
    window.addEventListener('wotan:me', function () { /* topbar finished its own /me; our `who` already awaited the same promise */ });
  }

  function render(d, who) {
    document.title = (d.title || 'Deck') + ' — WOTAN Hearthstone';
    UI.clear(root); root.setAttribute('aria-busy', 'false');
    var author = d.author && d.author.handle;
    var mine = !!d.can_edit || !!(who.me && who.me.handle && author && who.me.handle.toLowerCase() === author.toLowerCase());

    var titleEl = h('h1', { 'class': 'hs-h1', text: d.title || 'Untitled deck' });
    var descEl = h('p', { 'class': 'hs-desc', text: d.description || '', hidden: !d.description });
    var headActions = h('div', { 'class': 'hs-actions', style: { 'margin-top': '1rem' } },
      h('button', { type: 'button', 'class': 'hs-btn solid', text: 'Copy deck code', on: { click: function () { UI.copyWithToast(d.deckstring, 'Deck code'); } } }),
      UI.likeButton({ liked: d.liked_by_me, count: d.likes, path: '/decks/' + d.id + '/like' }));
    if (mine) {
      var vis = h('button', { type: 'button', 'class': 'hs-btn ' + (d.private ? 'solid' : 'ghost'), text: d.private ? 'Publish deck' : 'Make private', on: { click: async function (ev) {
        await UI.withBusy(ev.currentTarget, async function () {
          try { await HS.patch('/decks/' + d.id, { private: !d.private }); location.reload(); } catch (e) { UI.toast(e.message, 'err'); }
        });
      } } });
      headActions.appendChild(vis);
      headActions.appendChild(h('button', { type: 'button', 'class': 'hs-btn ghost', text: 'Edit', on: { click: function () { editForm(d, titleEl, descEl); } } }));
      headActions.appendChild(h('button', { type: 'button', 'class': 'hs-btn danger', text: 'Delete', on: { click: async function (ev) {
        if (!confirm('Delete this deck? This cannot be undone.')) return;
        await UI.withBusy(ev.currentTarget, async function () {
          try { await HS.del('/decks/' + d.id); location.href = '/hearthstone/'; } catch (e) { UI.toast(e.message, 'err'); }
        });
      } } }));
    }

    root.appendChild(h('header', { 'class': 'hs-deckhead', 'data-class': UI.classKey(d.class) },
      h('div', { 'class': 'hs-deck-top' }, UI.classBadge(d.class || 'Unknown'), UI.fmtBadge(d.format), d.year ? h('span', { 'class': 'hs-meta', text: d.year }) : null),
      titleEl,
      h('p', { 'class': 'hs-meta', style: { 'margin-top': '.5rem' } }, 'by ', UI.handleLink(author), ' · ', UI.ago(d.created_at)),
      d.private ? h('p', { 'class': 'hs-note', text: 'Private: only you can see this deck. It was synced from your tracker; publish it when you are ready to share it.' }) : null,
      d.games ? h('p', { 'class': 'hs-meta', style: { 'margin-top': '.4rem' }, text: Math.round(d.winrate * 100) + '% win rate · ' + d.wins + ' of ' + d.games + (d.games === 1 ? ' tracked game' : ' tracked games') }) : null,
      descEl, headActions));

    // left: card list
    var cards = d.cards || [];
    var left = h('div', null,
      h('div', { 'class': 'hs-section-title', style: { margin: '0 0 .6rem' } }, h('h2', { 'class': 'hs-h2', text: 'Cards' }), h('span', { 'class': 'hs-meta', text: (d.card_count || cards.reduce(function (n, c) { return n + (c.count || 1); }, 0)) + ' total' })),
      UI.resolvedNote(d.names_resolved, cards),
      h('div', { 'class': 'hs-panel' }, UI.cardList(cards, d.names_resolved, d.class)));

    // right: curve + code
    var curve = UI.costCurve(cards, true);
    var side = h('aside', { 'class': 'hs-side', 'data-class': UI.classKey(d.class) },
      curve ? h('div', { 'class': 'hs-panel' }, h('h2', { 'class': 'hs-h3', text: 'Mana curve' }), curve) : null,
      h('div', { 'class': 'hs-panel' },
        h('h2', { 'class': 'hs-h3', text: 'Deck code' }),
        h('pre', { 'class': 'hs-code', tabindex: '0', text: d.deckstring || '' }),
        h('button', { type: 'button', 'class': 'hs-btn', text: 'Copy code', on: { click: function () { UI.copyWithToast(d.deckstring, 'Deck code'); } } }),
        h('p', { 'class': 'hs-hint', text: 'In Hearthstone, open Decks, choose New Deck, then Paste from clipboard.' })));
    root.appendChild(h('div', { 'class': 'hs-detail' }, left, side));

    // comments
    var cLabel = h('span', { 'class': 'hs-meta', text: (d.comments || 0) + ' total' });
    var thread = Social.commentThread({
      who: who, listPath: '/decks/' + d.id + '/comments', postPath: '/decks/' + d.id + '/comments',
      deletePath: function (c) { return '/comments/' + c.id; },
      onCount: function (delta) { d.comments = Math.max(0, (d.comments || 0) + delta); cLabel.textContent = d.comments + ' total'; }
    });
    root.appendChild(h('section', { style: { 'margin-top': '2rem' }, 'aria-labelledby': 'cm-h' },
      h('div', { 'class': 'hs-section-title', style: { margin: '0 0 .6rem' } }, h('h2', { 'class': 'hs-h2', id: 'cm-h', text: 'Comments' }), cLabel),
      thread.el));
    thread.load();
  }

  function editForm(d, titleEl, descEl) {
    var t = h('input', { 'class': 'hs-input', maxlength: '80', value: d.title || '', 'aria-label': 'Title' });
    var ds = h('textarea', { 'class': 'hs-textarea', maxlength: '500', rows: '3', 'aria-label': 'Description' });
    ds.value = d.description || '';
    var err = h('p', { 'class': 'hs-msg err', role: 'alert', hidden: true });
    var form = h('form', { 'class': 'hs-panel', style: { margin: '.8rem 0' } },
      h('label', { 'class': 'hs-field' }, h('span', { 'class': 'hs-label', text: 'Title' }), t),
      h('label', { 'class': 'hs-field' }, h('span', { 'class': 'hs-label', text: 'Description' }), ds),
      h('div', { 'class': 'hs-actions' },
        h('button', { type: 'submit', 'class': 'hs-btn solid', text: 'Save changes' }),
        h('button', { type: 'button', 'class': 'hs-btn ghost', text: 'Cancel', on: { click: function () { form.remove(); } } })), err);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = form.querySelector('button[type=submit]');
      UI.withBusy(btn, async function () {
        err.hidden = true;
        try {
          await HS.patch('/decks/' + d.id, { title: t.value.trim(), description: ds.value.trim() });
          d.title = t.value.trim(); d.description = ds.value.trim();
          titleEl.textContent = d.title || 'Untitled deck'; descEl.textContent = d.description; descEl.hidden = !d.description;
          document.title = d.title + ' — WOTAN Hearthstone';
          form.remove(); UI.toast('Deck updated.');
        } catch (e) { err.textContent = e.message; err.hidden = false; }
      });
    });
    descEl.parentNode.insertBefore(form, descEl.nextSibling);
    t.focus();
  }

  init();
})();
