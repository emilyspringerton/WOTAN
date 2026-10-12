// /clubs/settings.html -- my clubs, tracker sync target, per-club roster/badge toggles, self-declared rank.
(function () {
  'use strict';
  var h = UI.h, P = ClubPerms;
  var root = UI.$('root');
  var clubs = [];

  function enc(x) { return encodeURIComponent(x); }
  function sec(title, desc) { return h('section', { 'class': 'hs-panel club-sec' }, h('h2', { 'class': 'club-sec-h', text: title }), desc ? h('p', { 'class': 'hs-meta', text: desc }) : null); }

  async function init() {
    if (CUI.requireSession(root, 'to manage your clubs')) return;
    UI.clear(root); root.setAttribute('aria-busy', 'false');
    root.appendChild(h('header', { 'class': 'hs-hero' }, h('div', null, h('p', { 'class': 'hs-eyebrow', text: 'Clubs' }), h('h1', { 'class': 'hs-h1', text: 'My clubs and sync' }),
      h('p', { 'class': 'hs-lede', text: 'Decide where your tracked games go, how you appear on club rosters, and the rank you declare.' }))));
    var mineBox = sec('My clubs'), syncBox = sec('Where my match data goes'), rankBox = sec('Rank');
    root.appendChild(mineBox); root.appendChild(syncBox); root.appendChild(rankBox);
    try { clubs = CLUB.items(await CLUB.get('/me/clubs')); }
    catch (e) {
      UI.clear(mineBox); mineBox.appendChild(UI.errorState(CUI.errMessage(e), init));
      clubs = [];
    }
    if (clubs.length || mineBox.children.length < 3) renderClubs(mineBox);
    renderSync(syncBox);
    renderRank(rankBox);
  }

  function renderClubs(box) {
    if (!clubs.length) {
      box.appendChild(UI.emptyState('You are not in any club', 'Browse the directory, or open an invite link someone sent you.', h('a', { 'class': 'hs-btn', href: '/clubs/', text: 'Browse clubs' })));
      return;
    }
    clubs.forEach(function (c) {
      var vis = h('input', { type: 'checkbox', checked: c.public_visible !== false && c.public_visible !== 0 });
      var badge = h('input', { type: 'checkbox', checked: c.show_badge !== false && c.show_badge !== 0 });
      function save(field, input) {
        var body = {}; body[field] = input.checked; input.disabled = true;
        CLUB.patch('/' + enc(c.id) + '/members/me', body).then(function () { input.disabled = false; UI.toast('Saved.'); },
          function (e) { input.checked = !input.checked; input.disabled = false; UI.toast(CUI.errMessage(e), 'err'); });
      }
      vis.addEventListener('change', function () { save('public_visible', vis); });
      badge.addEventListener('change', function () { save('show_badge', badge); });
      var leave = h('button', { type: 'button', 'class': 'hs-btn sm danger', text: 'Leave club' });
      leave.addEventListener('click', function () {
        if (!window.confirm('Leave ' + (c.name || 'this club') + '?')) return;
        UI.withBusy(leave, async function () {
          try { await CLUB.post('/' + enc(c.id) + '/leave'); UI.toast('You left the club.'); init(); }
          catch (e) { UI.toast(CUI.errMessage(e), 'err'); }
        });
      });
      var role = P.roleOf(c.role) || 'player';
      box.appendChild(h('article', { 'class': 'club-member', style: { 'margin-bottom': '.6rem' } },
        h('div', { 'class': 'who' }, h('a', { href: '/clubs/c.html?s=' + enc(c.slug || ''), text: c.name || c.slug || 'Club' }), CUI.roleBadge(role), CUI.tierBadge(CUI.tierOf(c))),
        h('div', { 'class': 'rk' }, h('a', { href: '/clubs/w.html?s=' + enc(c.slug || ''), text: 'Workspace' }),
          P.hasAny(c.perms || [], ['club.members.invite']) || role !== 'player' ? h('a', { href: '/clubs/manage.html?s=' + enc(c.slug || ''), text: 'Manage' }) : null),
        h('div', { 'class': 'acts' },
          h('label', { 'class': 'club-check', style: { margin: '0' } }, vis, h('span', { text: 'Show me on the public roster' })),
          h('label', { 'class': 'club-check', style: { margin: '0' } }, badge, h('span', { text: 'Show this club on my profile' })),
          leave)));
    });
    box.appendChild(h('p', { 'class': 'club-reason', text: 'Secret clubs never appear on profiles or public rosters, whatever these switches say.' }));
  }

  async function renderSync(box) {
    var cur = { kind: 'personal', club_id: '' };
    try { var r = await CLUB.hs.get('/me/sync-target'); if (r && r.kind) cur = r; }
    catch (e) {
      if (e.status === 404) { box.appendChild(h('p', { 'class': 'hs-meta', text: 'Match-data routing is not available on this server yet.' })); return; }
      box.appendChild(UI.errorState(CUI.errMessage(e), function () { UI.clear(box); box.appendChild(h('h2', { 'class': 'club-sec-h', text: 'Where my match data goes' })); renderSync(box); }));
      return;
    }
    var sel = h('select', { 'class': 'hs-select', id: 'sync', 'aria-describedby': 'sync-hint' });
    sel.appendChild(h('option', { value: 'personal', text: 'Personal wall', selected: cur.kind === 'personal' }));
    clubs.forEach(function (c) {
      if (c.perms && !P.has(c.perms, 'club.telemetry.contribute')) return;
      sel.appendChild(h('option', { value: 'club:' + c.id, text: 'Club: ' + (c.name || c.slug), selected: cur.kind === 'club' && String(cur.club_id) === String(c.id) }));
    });
    sel.appendChild(h('option', { value: 'none', text: 'None — private only', selected: cur.kind === 'none' }));
    var out = h('p', { 'class': 'hs-msg', role: 'status' });
    sel.addEventListener('change', function () {
      var v = sel.value, body = v === 'personal' ? { kind: 'personal' } : (v === 'none' ? { kind: 'none' } : { kind: 'club', club_id: v.slice(5) });
      sel.disabled = true; out.textContent = '';
      CLUB.hs.put('/me/sync-target', body).then(function () { sel.disabled = false; out.className = 'hs-msg ok'; out.textContent = 'Saved. New games follow this setting.'; },
        function (e) { sel.disabled = false; out.className = 'hs-msg err'; out.textContent = CUI.errMessage(e); });
    });
    if (cur.sync_target_invalid || cur.invalid) {
      box.appendChild(h('div', { 'class': 'club-callout', role: 'alert', text: 'Your previous club target is no longer valid (you may have been removed). New games are being kept private until you pick a target.' }));
    }
    box.appendChild(h('div', { 'class': 'hs-field' }, h('label', { 'class': 'hs-label', 'for': 'sync', text: 'Sync finished games to' }), sel,
      h('p', { 'class': 'hs-hint', id: 'sync-hint', text: 'The tracker never names a club itself. The server uses this choice and re-checks your membership for every game.' })));
    box.appendChild(out);
  }

  async function renderRank(box) {
    var cur = {};
    try { cur = (await CLUB.hs.get('/me/rank')) || {}; } catch (e) { if (e.status !== 404) { box.appendChild(h('p', { 'class': 'hs-msg err', text: CUI.errMessage(e) })); } }
    var bt = h('input', { 'class': 'hs-input', id: 'r-bt', maxlength: '40', placeholder: 'Name#1234', autocomplete: 'off', value: cur.battletag || '' });
    var region = h('select', { 'class': 'hs-select', id: 'r-reg' }, [['', 'Not set'], ['US', 'Americas'], ['EU', 'Europe'], ['AP', 'Asia-Pacific']].map(function (o) { return h('option', { value: o[0], text: o[1], selected: (cur.region || '') === o[0] }); }));
    var lr = h('input', { 'class': 'hs-input', id: 'r-lr', type: 'number', min: '1', max: '99999', inputmode: 'numeric', placeholder: 'e.g. 1500', value: cur.legend_rank ? String(cur.legend_rank) : '' });
    var err = h('p', { 'class': 'hs-msg', role: 'status' });
    var btn = h('button', { type: 'submit', 'class': 'hs-btn solid', text: 'Save' });
    box.appendChild(h('p', { 'class': 'hs-meta', text: 'You declare this yourself. It shows on club rosters marked “unverified” until WOTAN can check it against official data.' }));
    var form = h('form', { novalidate: true },
      h('div', { 'class': 'club-row' },
        h('label', { 'class': 'hs-field' }, h('span', { 'class': 'hs-label', text: 'BattleTag' }), bt),
        h('label', { 'class': 'hs-field', style: { 'flex': '0 1 11rem' } }, h('span', { 'class': 'hs-label', text: 'Region' }), region),
        h('label', { 'class': 'hs-field', style: { 'flex': '0 1 9rem' } }, h('span', { 'class': 'hs-label', text: 'Legend rank' }), lr)),
      h('div', { 'class': 'hs-actions' }, btn), err);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var body = {};
      if (bt.value.trim()) body.battletag = bt.value.trim();
      if (region.value) body.region = region.value;
      var n = lr.value.trim();
      if (n) {
        if (!/^\d{1,5}$/.test(n) || Number(n) < 1) { err.className = 'hs-msg err'; err.textContent = 'Legend rank is a whole number from 1 up.'; return; }
        body.legend_rank = Number(n);
      }
      UI.withBusy(btn, async function () {
        try { await CLUB.hs.put('/me/rank', body); err.className = 'hs-msg ok'; err.textContent = 'Saved. Shown as unverified.'; }
        catch (e) { err.className = 'hs-msg err'; err.textContent = CUI.errMessage(e); }
      });
    });
    box.appendChild(form);
  }

  init();
})();
