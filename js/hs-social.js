// Social building blocks for the HEARTHSTONE section: composer, comment thread, wall post card.
// Depends on hs-api.js (HS) and hs-ui.js (UI). All user text is rendered with textContent via UI.h().
(function () {
  'use strict';
  var h = UI.h;

  function authorHandle(o) {
    if (!o) return '';
    return (o.author && o.author.handle) || o.handle || o.author_handle || '';
  }
  function isMine(who, o) {
    var mine = who && who.me && who.me.handle;
    var theirs = authorHandle(o);
    return !!(mine && theirs && mine.toLowerCase() === theirs.toLowerCase());
  }

  // Composer. cfg: {who, placeholder, max, label, rows, onSubmit(body) -> Promise, needHandleText}
  // Signed out -> a plain "Sign in to ..." line. Signed in without a handle -> link to claim one.
  function composer(cfg) {
    var who = cfg.who || { signedIn: false };
    if (!who.signedIn) return h('div', { 'class': 'hs-composer' }, UI.signInHint(cfg.signInText || 'to post'));
    if (!(who.me && who.me.handle)) {
      return h('div', { 'class': 'hs-composer' }, h('p', { 'class': 'hs-signin-hint' },
        h('a', { href: '/hearthstone/u.html', text: 'Claim a handle' }), ' first, then you can ' + (cfg.verb || 'post') + '.'));
    }
    var max = cfg.max || 500;
    var ta = h('textarea', { 'class': 'hs-textarea', maxlength: String(max), rows: String(cfg.rows || 3), placeholder: cfg.placeholder || '', 'aria-label': cfg.placeholder || 'Write something' });
    var count = h('span', { 'class': 'hs-count', text: '0 / ' + max });
    var msg = h('p', { 'class': 'hs-msg err', role: 'alert', hidden: true });
    var btn = h('button', { type: 'button', 'class': 'hs-btn', text: cfg.label || 'Post', disabled: true });
    ta.addEventListener('input', function () {
      count.textContent = ta.value.length + ' / ' + max;
      btn.disabled = !ta.value.trim();
    });
    ta.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !btn.disabled) btn.click(); });
    btn.addEventListener('click', function () {
      UI.withBusy(btn, async function () {
        msg.hidden = true;
        try {
          await cfg.onSubmit(ta.value.trim());
          ta.value = ''; count.textContent = '0 / ' + max; btn.disabled = true;
        } catch (e) { msg.textContent = e.message; msg.hidden = false; }
      });
    });
    return h('div', { 'class': 'hs-composer' }, ta, h('div', { 'class': 'hs-composer-foot' }, count, btn), msg);
  }

  function commentView(c, cfg) {
    var del = cfg.deletePath && isMine(cfg.who, c)
      ? h('button', { type: 'button', 'class': 'hs-link-btn x', text: 'Delete', 'aria-label': 'Delete comment',
          on: { click: async function (ev) {
            if (!confirm('Delete this comment?')) return;
            var b = ev.currentTarget;
            try { await HS.del(cfg.deletePath(c)); var n = b.closest('.hs-comment'); if (n) n.remove(); if (cfg.onCount) cfg.onCount(-1); }
            catch (e) { UI.toast(e.message, 'err'); }
          } } })
      : null;
    return h('div', { 'class': 'hs-comment' },
      h('div', { 'class': 'hs-comment-head' }, UI.handleLink(authorHandle(c)), h('span', { text: UI.ago(c.created_at) }), del),
      h('div', { 'class': 'hs-comment-body', text: c.body }));
  }

  // Comment thread. cfg: {who, listPath, postPath, deletePath(c)->path|null, onCount(delta)}
  // Returns {el, load()}; load() fetches the first page (call when it becomes visible).
  function commentThread(cfg) {
    var list = h('div', { 'class': 'hs-thread-list', style: { display: 'grid', gap: '.6rem' } });
    var more = h('div', { 'class': 'hs-more', hidden: true });
    var state = { offset: 0, total: 0, loaded: false };
    var box = h('div', { 'class': 'hs-thread' }, list, more);
    var form = composer({
      who: cfg.who, placeholder: 'Add a comment', max: 500, rows: 2, label: 'Comment', verb: 'comment', signInText: 'to comment',
      onSubmit: async function (body) {
        var c = await HS.post(cfg.postPath, { body: body });
        var comment = (c && c.body) ? c : { body: body, created_at: new Date().toISOString(), author: { handle: cfg.who.me && cfg.who.me.handle } , id: c && c.id };
        if (!comment.author) comment.author = { handle: cfg.who.me && cfg.who.me.handle };
        list.appendChild(commentView(comment, cfg));
        if (cfg.onCount) cfg.onCount(1);
      }
    });
    box.appendChild(form);

    async function page() {
      var res = await HS.get(cfg.listPath, { limit: 20, offset: state.offset });
      var items = (res && res.items) || [];
      items.forEach(function (c) { list.appendChild(commentView(c, cfg)); });
      state.offset += items.length;
      state.total = (res && res.total) || state.offset;
      UI.clear(more);
      if (state.offset < state.total && items.length) {
        more.hidden = false;
        more.appendChild(h('button', { type: 'button', 'class': 'hs-btn sm ghost', text: 'Older comments', on: { click: function () { load(true); } } }));
      } else more.hidden = true;
    }
    async function load(next) {
      if (state.loaded && !next) return;
      state.loaded = true;
      try { await page(); if (!state.offset && !next) list.appendChild(h('p', { 'class': 'hs-meta', text: 'No comments yet.' })); }
      catch (e) { list.appendChild(UI.errorState(e.message, function () { state.loaded = false; UI.clear(list); load(); })); }
    }
    return { el: box, load: load };
  }

  // Wall post card. post: {id, body, created_at, author:{handle}, likes, comments, liked_by_me}
  function postCard(post, cfg) {
    cfg = cfg || {};
    var who = cfg.who;
    var commentsN = post.comments || 0;
    var thread = null;
    var toggle = h('button', { type: 'button', 'class': 'hs-btn sm ghost', 'aria-expanded': 'false' });
    function paintToggle() { toggle.textContent = commentsN + (commentsN === 1 ? ' comment' : ' comments'); }
    paintToggle();
    var card = h('article', { 'class': 'hs-post', id: 'post-' + post.id });
    var actions = h('div', { 'class': 'hs-post-actions' }, UI.likeButton({ liked: post.liked_by_me, count: post.likes, path: '/wall/' + post.id + '/like' }), toggle);
    if (isMine(who, post)) {
      actions.appendChild(h('button', { type: 'button', 'class': 'hs-link-btn', text: 'Delete post', on: { click: async function () {
        if (!confirm('Delete this post?')) return;
        try { await HS.del('/wall/' + post.id); card.remove(); if (cfg.onDelete) cfg.onDelete(post); }
        catch (e) { UI.toast(e.message, 'err'); }
      } } }));
    }
    toggle.addEventListener('click', function () {
      if (!thread) {
        thread = commentThread({
          who: who, listPath: '/wall/' + post.id + '/comments', postPath: '/wall/' + post.id + '/comments', deletePath: null,
          onCount: function (d) { commentsN = Math.max(0, commentsN + d); paintToggle(); }
        });
        card.appendChild(thread.el);
        thread.load();
        toggle.setAttribute('aria-expanded', 'true');
      } else {
        thread.el.hidden = !thread.el.hidden;
        toggle.setAttribute('aria-expanded', String(!thread.el.hidden));
      }
    });
    card.appendChild(h('div', { 'class': 'hs-post-head' }, UI.handleLink(authorHandle(post)), h('span', { text: UI.ago(post.created_at) })));
    card.appendChild(h('div', { 'class': 'hs-post-body', text: post.body }));
    card.appendChild(actions);
    return card;
  }

  window.Social = { composer: composer, commentThread: commentThread, postCard: postCard, authorHandle: authorHandle, isMine: isMine };
})();
