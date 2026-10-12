// /clubs/manage.html?s=slug -- club admin console. Every affordance is computed ONLY from the
// GET /clubs/{id}/me perms[] (js/club-perms.js, unit-tested by scripts/clubs-affordance-test.js).
// The server enforces; this page only decides what to show, hide, or show disabled with a reason.
(function () {
  'use strict';
  var h = UI.h, P = ClubPerms;
  var root = UI.$('root');
  var slug = (UI.params().get('s') || '').trim().toLowerCase();
  var g, club = {}, myHandle = '', members = [], host = {};

  function enc(x) { return encodeURIComponent(x); }
  function base() { return '/' + enc(g.id); }
  function actor() { return { role: g.role, perms: g.perms }; }
  function panelBox(title, id, desc) {
    return h('section', { 'class': 'hs-panel club-sec', id: id }, h('h2', { 'class': 'club-sec-h', text: title }), desc ? h('p', { 'class': 'hs-meta', text: desc }) : null);
  }
  function errLine() { return h('p', { 'class': 'hs-msg err', role: 'alert', hidden: true }); }
  function showErr(el, e) { el.textContent = CUI.errMessage(e); el.hidden = false; }

  async function init() {
    g = await CUI.memberGate(root, slug, init);
    if (!g) return;
    var pan = P.panels(g.perms);
    try { club = await CLUB.get('/by-slug/' + enc(slug)); } catch (e) { club = g.club || g.summary || {}; }
    try { var who = await HS.who(); myHandle = (who.me && who.me.handle) || ''; } catch (e) { myHandle = ''; }
    document.title = 'Manage ' + (club.name || slug) + ' — WOTAN Clubs';
    UI.clear(root); root.setAttribute('aria-busy', 'false');
    CUI.setBrand(root, club.brand);

    root.appendChild(h('header', { 'class': 'club-head' },
      h('div', { 'class': 'badges' }, CUI.tierBadge(CUI.tierOf(club)), CUI.roleBadge(g.role), pan.del ? h('span', { 'class': 'hs-badge plain', text: 'Owner' }) : null),
      h('h1', { 'class': 'hs-h1', text: 'Manage ' + (club.name || slug) }),
      h('p', { 'class': 'hs-meta', text: 'You can only see the tools your role allows. The server checks every action again.' })));
    root.appendChild(CUI.subnav(slug, 'm', g.perms));

    var canActOnRoster = P.hasAny(g.perms, ['club.members.remove.player', 'club.members.remove.coach', 'club.members.remove.manager', 'club.members.promote', 'club.members.demote']);
    // Viewing the roster alone is not "managing": a plain Player landing here gets a clear dead end.
    var anyTool = canActOnRoster || pan.invites || pan.requests || pan.visibility || pan.settings || pan.featured || pan.audit || pan.transfer || pan.del;
    if (!anyTool) {
      root.appendChild(UI.emptyState('Nothing to manage', 'Your role has no management tools in this club.', h('a', { 'class': 'hs-btn', href: '/clubs/w.html?s=' + enc(slug), text: 'Back to the workspace' })));
      return;
    }

    if (pan.roster) { host.roster = panelBox('Roster', 'roster'); root.appendChild(host.roster); }
    if (pan.invites) { host.invites = panelBox('Invites', 'invites', 'Single-use links. The link is shown once, when you create it.'); root.appendChild(host.invites); buildInvites(host.invites, pan); }
    if (pan.requests) { host.requests = panelBox('Join requests', 'requests'); root.appendChild(host.requests); loadRequests(host.requests); }
    if (pan.visibility) { host.vis = panelBox('Privacy and joining', 'visibility'); root.appendChild(host.vis); renderVisibility(); }
    if (pan.settings) { host.settings = panelBox('Branding and details', 'settings'); root.appendChild(host.settings); renderSettings(); }
    if (pan.featured) { host.featured = panelBox('Featured decks', 'featured', 'Shown on the public page of Social clubs.'); root.appendChild(host.featured); renderFeatured(); }
    if (pan.audit) { host.audit = panelBox('Audit log', 'audit', 'Append-only record of management actions in this club.'); root.appendChild(host.audit); renderAudit(); }
    if (pan.transfer) { host.transfer = panelBox('Transfer ownership', 'transfer'); root.appendChild(host.transfer); }
    if (pan.del) { host.del = panelBox('Delete club', 'delete'); host.del.classList.add('club-danger'); root.appendChild(host.del); renderDelete(); }
    // Roster + transfer both need the member list.
    await loadMembers();
    if (pan.transfer) renderTransfer();
  }

  // ---- roster ----
  async function loadMembers() {
    if (!P.has(g.perms, 'club.roster.view')) return;
    try {
      members = CLUB.items(await CLUB.get(base() + '/members'));
      if (host.roster) renderRoster();
    } catch (e) {
      if (host.roster) { UI.clear(host.roster); host.roster.appendChild(UI.errorState(CUI.errMessage(e), loadMembers)); }
    }
  }
  function isMe(m) { return m.is_me === true || m.me === true || !!(myHandle && CUI.handleOf(m).toLowerCase() === myHandle.toLowerCase()); }

  function renderRoster() {
    var box = host.roster;
    UI.clear(box);
    box.appendChild(h('h2', { 'class': 'club-sec-h', text: 'Roster' }));
    var mgrs = members.filter(function (m) { return CUI.roleOfMember(m) === 'manager'; }).length;
    members.slice().sort(function (a, b) { return (P.RANK[CUI.roleOfMember(b)] || 0) - (P.RANK[CUI.roleOfMember(a)] || 0) || CUI.handleOf(a).localeCompare(CUI.handleOf(b)); })
      .forEach(function (m) { box.appendChild(rosterRow(m, mgrs)); });
    if (!members.length) box.appendChild(UI.emptyState('No members', ''));
    // Self-service: leave.
    box.appendChild(h('p', { 'class': 'club-reason', style: { 'margin-top': '.8rem' } }, 'To leave this club yourself, use ', h('a', { href: '/clubs/settings.html', text: 'My clubs' }), '.'));
  }

  function rosterRow(m, mgrs) {
    var target = { role: CUI.roleOfMember(m), is_owner: P.isOwner(m), is_me: isMe(m) };
    var acts = h('div', { 'class': 'acts' });
    if (m.sub) {
      var rm = P.removeAffordance(actor(), target);
      if (rm.visible) {
        acts.appendChild(CUI.reasonButton('Remove', {
          enabled: rm.enabled, reason: rm.reason, cls: 'danger',
          onClick: function (btn) {
            if (!window.confirm('Remove @' + CUI.handleOf(m) + ' from the club?')) return;
            UI.withBusy(btn, async function () {
              try { await CLUB.del(base() + '/members/' + enc(m.sub)); UI.toast('Member removed.'); await loadMembers(); }
              catch (e) { UI.toast(CUI.errMessage(e), 'err'); }
            });
          }
        }));
      }
      var rc = P.roleChangeAffordance(actor(), target, mgrs);
      if (rc.visible) {
        if (!rc.options.length) {
          acts.appendChild(h('span', { 'class': 'club-reason', text: rc.reason }));
        } else {
          var sel = h('select', { 'class': 'hs-select', style: { width: 'auto', 'min-height': '32px', padding: '0 2rem 0 .6rem', 'font-size': '.8rem' }, 'aria-label': 'New role for @' + CUI.handleOf(m) },
            h('option', { value: '', text: 'Change role…' }),
            rc.options.map(function (o) { return h('option', { value: o.role, text: P.ROLE_LABEL[o.role] + (o.enabled ? '' : ' (' + o.reason + ')'), disabled: !o.enabled, title: o.reason }); }));
          sel.addEventListener('change', function () {
            var to = sel.value;
            if (!to) return;
            if (!window.confirm('Make @' + CUI.handleOf(m) + ' a ' + P.ROLE_LABEL[to] + '?')) { sel.value = ''; return; }
            sel.disabled = true;
            CLUB.patch(base() + '/members/' + enc(m.sub), { role: to }).then(function () { UI.toast('Role updated.'); return loadMembers(); }, function (e) { UI.toast(CUI.errMessage(e), 'err'); sel.value = ''; sel.disabled = false; });
          });
          acts.appendChild(sel);
        }
      }
    }
    return h('div', { 'class': 'club-member', style: { 'margin-bottom': '.5rem' } },
      h('div', { 'class': 'who' }, CUI.handleOf(m) ? UI.handleLink(CUI.handleOf(m)) : h('span', { 'class': 'hs-meta', text: 'former member' }),
        CUI.roleBadge(target.role), target.is_owner ? h('span', { 'class': 'hs-badge plain', text: 'Owner' }) : null, target.is_me ? h('span', { 'class': 'hs-meta', text: '(you)' }) : null),
      h('div', { 'class': 'rk' }, CUI.rankBadge(m)),
      acts.children.length ? acts : null);
  }

  // ---- invites ----
  function buildInvites(box, pan) {
    var roles = P.inviteRoles(g.perms);
    var form = null;
    var result = h('div', { 'aria-live': 'polite' });
    var listEl = h('div', { 'class': 'club-scroll' });
    if (roles.length) {
      var role = h('select', { 'class': 'hs-select', id: 'inv-role' }, roles.map(function (r) { return h('option', { value: r, text: P.ROLE_LABEL[r] }); }));
      var ttl = h('select', { 'class': 'hs-select', id: 'inv-ttl' }, [[1, '1 hour'], [6, '6 hours'], [24, '1 day'], [48, '48 hours'], [72, '3 days'], [168, '7 days']].map(function (o) { return h('option', { value: String(o[0]), text: o[1], selected: o[0] === 48 }); }));
      var bound = h('input', { 'class': 'hs-input', id: 'inv-bound', maxlength: '20', placeholder: 'any player', autocomplete: 'off', autocapitalize: 'off' });
      var err = errLine();
      var btn = h('button', { type: 'submit', 'class': 'hs-btn solid', text: 'Create invite link' });
      form = h('form', { novalidate: true },
        h('div', { 'class': 'club-row' },
          h('label', { 'class': 'hs-field' }, h('span', { 'class': 'hs-label', text: 'Role' }), role),
          h('label', { 'class': 'hs-field' }, h('span', { 'class': 'hs-label', text: 'Expires after' }), ttl),
          h('label', { 'class': 'hs-field' }, h('span', { 'class': 'hs-label', text: 'Only for handle (optional)' }), bound)),
        h('div', { 'class': 'hs-actions' }, btn), err);
      if (roles.length === 1) box.appendChild(h('p', { 'class': 'club-reason', text: 'Your role can invite Players only. Inviting Coaches or Managers needs a Manager.' }));
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        err.hidden = true;
        UI.withBusy(btn, async function () {
          var body = { role: role.value, ttl_hours: Number(ttl.value) };
          var b = bound.value.trim().replace(/^@/, '').toLowerCase();
          if (b) body.bound_handle = b;
          try {
            var r = await CLUB.post(base() + '/invites', body);
            var url = (r && r.url) || ((r && r.token) ? location.origin + '/clubs/join.html#' + r.token : '');
            if (!url) throw new Error('The server did not return an invite link.');
            showLink(result, url);
            loadInvites(listEl);
          } catch (e) { showErr(err, e); }
        });
      });
      box.appendChild(form);
    } else {
      box.appendChild(h('p', { 'class': 'club-reason', text: 'Your role cannot create invites.' }));
    }
    box.appendChild(result);
    box.appendChild(h('h3', { 'class': 'hs-h3', style: { 'margin-top': '1rem' }, text: 'Active invites' }));
    box.appendChild(listEl);
    loadInvites(listEl);
  }
  function showLink(out, url) {
    UI.clear(out);
    var inp = h('input', { 'class': 'hs-input', readonly: true, value: url, 'aria-label': 'Invite link', on: { focus: function (e) { e.target.select(); } } });
    out.appendChild(h('div', { 'class': 'club-callout' },
      h('b', { text: 'Copy this link now. ' }), 'It is shown once and cannot be recovered. It works one time only.',
      h('div', { 'class': 'club-link' }, inp, h('button', { type: 'button', 'class': 'hs-btn', text: 'Copy link', on: { click: function () { UI.copyWithToast(url, 'Invite link'); } } }))));
  }
  async function loadInvites(listEl) {
    UI.clear(listEl);
    try {
      var items = CLUB.items(await CLUB.get(base() + '/invites'));
      var live = items.filter(function (i) { return !i.used_at && !i.used_by && !i.revoked_at; });
      if (!live.length) { listEl.appendChild(h('p', { 'class': 'hs-meta', text: 'No active invites.' })); return; }
      var rows = live.map(function (i) {
        var by = i.created_by_handle || i.created_by || '';
        return h('tr', null,
          h('td', null, CUI.roleBadge(i.role)),
          h('td', { text: i.bound_handle ? '@' + i.bound_handle : 'anyone' }),
          h('td', { text: i.expires_at ? 'expires ' + new Date(i.expires_at).toLocaleString() : '' }),
          h('td', { text: by && String(by).indexOf('|') < 0 && String(by).length < 30 ? 'by ' + by : '' }),
          h('td', null, h('button', { type: 'button', 'class': 'hs-btn sm danger', text: 'Revoke', on: { click: function (ev) {
            var b = ev.currentTarget;
            UI.withBusy(b, async function () {
              try { await CLUB.del(base() + '/invites/' + enc(i.id)); UI.toast('Invite revoked.'); loadInvites(listEl); }
              catch (e) { UI.toast(CUI.errMessage(e), 'err'); }
            });
          } } })));
      });
      listEl.appendChild(h('table', { 'class': 'club-table' }, h('thead', null, h('tr', null, h('th', { text: 'Role' }), h('th', { text: 'For' }), h('th', { text: 'Expiry' }), h('th', { text: '' }), h('th', { text: '' }))), h('tbody', null, rows)));
    } catch (e) { listEl.appendChild(UI.errorState(CUI.errMessage(e), function () { loadInvites(listEl); })); }
  }

  // ---- join requests ----
  async function loadRequests(box) {
    UI.clear(box); box.appendChild(h('h2', { 'class': 'club-sec-h', text: 'Join requests' }));
    try {
      var items = CLUB.items(await CLUB.get(base() + '/requests')).filter(function (r) { return !r.status || r.status === 'pending'; });
      if (!items.length) { box.appendChild(h('p', { 'class': 'hs-meta', text: 'No pending requests.' })); return; }
      items.forEach(function (r) {
        var who = CUI.handleOf(r);
        function decide(accept, btn) {
          UI.withBusy(btn, async function () {
            try { await CLUB.post(base() + '/requests/' + enc(r.id) + '/decision', { accept: accept }); UI.toast(accept ? 'Request accepted.' : 'Request declined.'); await loadRequests(box); if (accept) loadMembers(); }
            catch (e) { UI.toast(CUI.errMessage(e), 'err'); }
          });
        }
        box.appendChild(h('article', { 'class': 'hs-post' },
          h('div', { 'class': 'hs-post-head' }, who ? UI.handleLink(who) : h('span', { text: 'a player' }), h('span', { 'class': 'hs-meta', text: UI.ago(r.created_at) })),
          r.message ? h('div', { 'class': 'hs-post-body', text: r.message }) : null,
          h('div', { 'class': 'hs-post-actions' },
            h('button', { type: 'button', 'class': 'hs-btn sm solid', text: 'Accept', on: { click: function (e) { decide(true, e.currentTarget); } } }),
            h('button', { type: 'button', 'class': 'hs-btn sm ghost', text: 'Decline', on: { click: function (e) { decide(false, e.currentTarget); } } }))));
      });
    } catch (e) { box.appendChild(UI.errorState(CUI.errMessage(e), function () { loadRequests(box); })); }
  }

  // ---- visibility: tier (with Go dark / Reveal memory), exclusive, join policy, contributors ----
  async function refreshClub() { try { club = await CLUB.get('/by-slug/' + enc(slug)); } catch (e) { /* keep old */ } }

  async function putVis(patch) {
    var res = await CLUB.put(base() + '/visibility', patch);
    await refreshClub();
    return res;
  }

  function renderVisibility() {
    var box = host.vis;
    UI.clear(box);
    box.appendChild(h('h2', { 'class': 'club-sec-h', text: 'Privacy and joining' }));
    var tier = CUI.tierOf(club);
    var prev = P.normTier(club.prev_tier);
    var err = errLine();
    var conflicts = h('div', { 'aria-live': 'polite' });

    // Tier selector with memory.
    var TIERS = [[1, 'Secret', 'Invisible. Invite only.'], [2, 'Private', 'Public roster page only.'], [3, 'Social', 'Public roster and featured decks.']];
    var radios = h('div', { 'class': 'club-radios', role: 'radiogroup', 'aria-label': 'Privacy tier' }, TIERS.map(function (t) {
      return h('label', { 'class': 'club-radio' }, h('input', { type: 'radio', name: 'tier', value: String(t[0]), checked: t[0] === tier }), h('b', { text: t[1] }), h('span', { text: t[2] }));
    }));
    var saveTier = h('button', { type: 'button', 'class': 'hs-btn', text: 'Save tier' });
    saveTier.addEventListener('click', function () {
      var v = Number((radios.querySelector('input:checked') || {}).value || 0);
      if (!v || v === tier) return;
      if (v === 1 && !window.confirm('Go Secret? The club disappears from the directory and from member profiles, and its public page returns not-found to outsiders.')) return;
      err.hidden = true;
      UI.withBusy(saveTier, async function () {
        try { await putVis({ privacy_tier: v }); UI.toast('Tier set to ' + P.tierName(v) + '.'); renderVisibility(); }
        catch (e) { showErr(err, e); }
      });
    });
    var st = P.stealthToggle(tier, prev);
    var stealthBtn = null;
    if (st.mode !== 'none') {
      stealthBtn = h('button', { type: 'button', 'class': 'hs-btn ' + (st.mode === 'dark' ? 'ghost' : 'solid'), text: st.label });
      stealthBtn.addEventListener('click', function () {
        var target = st.mode === 'dark' ? 1 : (st.restoreTo || 2);
        if (st.mode === 'dark' && !window.confirm('Go dark? The club becomes Secret now. You can Reveal it in one click and it returns to ' + P.tierName(tier) + '.')) return;
        err.hidden = true;
        UI.withBusy(stealthBtn, async function () {
          try { await putVis({ privacy_tier: target }); UI.toast(st.mode === 'dark' ? 'Club is now Secret.' : 'Club revealed as ' + P.tierName(target) + '.'); renderVisibility(); }
          catch (e) { showErr(err, e); }
        });
      });
    }
    box.appendChild(h('span', { 'class': 'hs-label', text: 'Privacy tier' }));
    box.appendChild(radios);
    box.appendChild(h('div', { 'class': 'hs-actions' }, saveTier, stealthBtn));
    if (st.mode === 'reveal' && !st.restoreTo) box.appendChild(h('p', { 'class': 'club-reason', text: 'No earlier tier is remembered. Reveal will make the club Private.' }));

    // Exclusive toggle.
    var excl = h('input', { type: 'checkbox', id: 'v-excl', checked: !!club.is_exclusive });
    excl.addEventListener('change', function () {
      var want = excl.checked;
      err.hidden = true; UI.clear(conflicts);
      excl.disabled = true;
      putVis({ is_exclusive: want }).then(function () { UI.toast(want ? 'Club is now exclusive.' : 'Club is no longer exclusive.'); excl.disabled = false; },
        function (e) {
          excl.checked = !want; excl.disabled = false;
          if (e.code === 'exclusive_conflict' || e.status === 409) {
            var d = e.data || {};
            var list = d.members || d.conflicts || d.conflicting_members || d.items || [];
            var lis = (Array.isArray(list) ? list : []).map(function (x) { return h('li', { text: typeof x === 'string' ? '@' + x : ('@' + (CUI.handleOf(x) || 'member')) + (x.clubs ? ' (' + x.clubs.join(', ') + ')' : '') }); });
            conflicts.appendChild(h('div', { 'class': 'club-callout', role: 'alert' }, h('b', { text: 'Cannot go exclusive yet. ' }), e.message || 'Some members belong to other clubs.',
              lis.length ? h('ul', null, lis) : null, lis.length ? h('p', { 'class': 'club-reason', text: 'Ask these members to leave their other clubs, or remove them, then try again.' }) : null));
          } else showErr(err, e);
        });
    });
    box.appendChild(h('label', { 'class': 'club-check' }, excl, h('span', null, h('b', { text: 'Exclusive. ' }), 'Members may not belong to any other club (Secret clubs count).')));
    box.appendChild(conflicts);

    // Join policy.
    var jp = h('select', { 'class': 'hs-select', id: 'v-join', 'aria-describedby': 'v-join-hint' },
      P.joinPolicyOptions(tier).map(function (o) {
        return h('option', { value: o.value, text: o.value === 'invite' ? 'Invite only' : 'Invite or request' + (o.enabled ? '' : ' (Social only)'), disabled: !o.enabled, title: o.enabled ? '' : o.reason, selected: (club.join_policy || 'invite') === o.value });
      }));
    jp.addEventListener('change', function () {
      err.hidden = true; jp.disabled = true;
      putVis({ join_policy: jp.value }).then(function () { UI.toast('Join policy saved.'); jp.disabled = false; }, function (e) { showErr(err, e); jp.value = club.join_policy || 'invite'; jp.disabled = false; });
    });
    box.appendChild(h('div', { 'class': 'hs-field', style: { 'margin-top': '.8rem' } }, h('label', { 'class': 'hs-label', 'for': 'v-join', text: 'How people join' }), jp,
      h('p', { 'class': 'hs-hint', id: 'v-join-hint', text: tier === 3 ? 'Requests go to coaches and managers.' : 'Request-to-join is only available for Social clubs.' })));

    // Contributor board toggle.
    var cb = h('input', { type: 'checkbox', id: 'v-contrib', checked: !!club.show_contributors });
    cb.addEventListener('change', function () {
      var want = cb.checked; err.hidden = true; cb.disabled = true;
      putVis({ show_contributors: want }).then(function () { UI.toast(want ? 'Contributor board is public.' : 'Contributor board hidden.'); cb.disabled = false; }, function (e) { showErr(err, e); cb.checked = !want; cb.disabled = false; });
    });
    box.appendChild(h('label', { 'class': 'club-check' }, cb, h('span', null, h('b', { text: 'Public contributor board. ' }), 'Social clubs only. Lists only members who chose to be visible. The win-rate matrix always stays members only.')));
    box.appendChild(err);
  }

  // ---- branding / details ----
  function renderSettings() {
    var box = host.settings;
    UI.clear(box);
    box.appendChild(h('h2', { 'class': 'club-sec-h', text: 'Branding and details' }));
    var br = (club.brand && typeof club.brand === 'object') ? club.brand : {};
    var name = h('input', { 'class': 'hs-input', id: 's-name', maxlength: '40', value: club.name || '' });
    var tag = h('input', { 'class': 'hs-input', id: 's-tag', maxlength: '120', value: club.tagline || '' });
    var desc = h('textarea', { 'class': 'hs-textarea', id: 's-desc', maxlength: '1000', rows: '4' });
    desc.value = club.description || '';
    var accent = h('input', { type: 'color', id: 's-accent', value: /^#[0-9a-fA-F]{6}$/.test(br.accent || '') ? br.accent : '#c6a75e', style: { width: '4rem', height: '2.4rem' } });
    var banner = h('input', { 'class': 'hs-input', id: 's-banner', maxlength: '120', value: br.banner_text || '' });
    var err = errLine();
    var save = h('button', { type: 'submit', 'class': 'hs-btn solid', text: 'Save details' });
    var form = h('form', { novalidate: true },
      h('div', { 'class': 'hs-field' }, h('label', { 'class': 'hs-label', 'for': 's-name', text: 'Name' }), name),
      h('div', { 'class': 'hs-field' }, h('label', { 'class': 'hs-label', 'for': 's-tag', text: 'Tagline' }), tag),
      h('div', { 'class': 'hs-field' }, h('label', { 'class': 'hs-label', 'for': 's-desc', text: 'Description' }), desc),
      h('div', { 'class': 'club-row' },
        h('div', { 'class': 'hs-field', style: { 'flex': '0 0 auto' } }, h('label', { 'class': 'hs-label', 'for': 's-accent', text: 'Accent colour' }), accent),
        h('div', { 'class': 'hs-field' }, h('label', { 'class': 'hs-label', 'for': 's-banner', text: 'Banner line' }), banner)),
      h('p', { 'class': 'hs-hint', text: 'Text and a colour only. Image uploads are not supported yet.' }),
      h('div', { 'class': 'hs-actions' }, save), err);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault(); err.hidden = true;
      if (name.value.trim().length < 2) { err.textContent = 'The club needs a name.'; err.hidden = false; return; }
      UI.withBusy(save, async function () {
        try {
          var nb = Object.assign({}, br, { accent: accent.value, banner_text: banner.value.trim() });
          await CLUB.patch(base(), { name: name.value.trim(), tagline: tag.value.trim(), description: desc.value.trim(), brand: nb });
          await refreshClub(); CUI.setBrand(root, club.brand); UI.toast('Details saved.');
        } catch (e) { showErr(err, e); }
      });
    });
    box.appendChild(form);
  }

  // ---- featured decks ----
  async function renderFeatured() {
    var box = host.featured;
    UI.clear(box);
    box.appendChild(h('h2', { 'class': 'club-sec-h', text: 'Featured decks' }));
    box.appendChild(h('p', { 'class': 'hs-meta', text: 'Shown on the public page of Social clubs.' }));
    var cur = [];
    try { cur = CLUB.items(await CLUB.get('/by-slug/' + enc(slug) + '/decks')); } catch (e) { cur = []; }
    function idOf(d) { var x = d.deck && typeof d.deck === 'object' ? d.deck : d; return x.deck_id !== undefined ? x.deck_id : x.id; }
    var featuredIds = {};
    cur.forEach(function (d) { featuredIds[String(idOf(d))] = true; });
    var curBox = h('div', { 'class': 'hs-list' });
    if (!cur.length) curBox.appendChild(h('p', { 'class': 'hs-meta', text: 'No decks featured yet.' }));
    cur.forEach(function (d) {
      var x = d.deck && typeof d.deck === 'object' ? d.deck : d;
      curBox.appendChild(h('div', { 'class': 'club-member' },
        h('div', { 'class': 'who' }, h('a', { href: UI.deckURL(idOf(d)), text: x.title || 'Deck #' + idOf(d) }), x.class ? UI.classBadge(x.class) : null),
        h('button', { type: 'button', 'class': 'hs-btn sm danger', text: 'Unfeature', on: { click: function (ev) {
          UI.withBusy(ev.currentTarget, async function () {
            try { await CLUB.del(base() + '/featured-decks/' + enc(idOf(d))); renderFeatured(); } catch (e) { UI.toast(CUI.errMessage(e), 'err'); }
          });
        } } })));
    });
    box.appendChild(curBox);

    // Picker: my own public decks (everything WOTAN already exposes) + paste a deck id.
    box.appendChild(h('h3', { 'class': 'hs-h3', style: { 'margin-top': '1rem' }, text: 'Feature a deck' }));
    var pick = h('div', { 'class': 'hs-list' });
    box.appendChild(pick);
    if (myHandle) {
      try {
        var mine = CLUB.items(await CLUB.hs.get('/users/' + enc(myHandle) + '/decks', { limit: 30 }));
        mine.filter(function (d) { return !featuredIds[String(d.id)]; }).forEach(function (d) {
          pick.appendChild(h('div', { 'class': 'club-member' },
            h('div', { 'class': 'who' }, h('a', { href: UI.deckURL(d.id), text: d.title || 'Untitled deck' }), d.class ? UI.classBadge(d.class) : null),
            h('button', { type: 'button', 'class': 'hs-btn sm', text: 'Feature', on: { click: function (ev) { featureDeck(d.id, ev.currentTarget); } } })));
        });
        if (!pick.children.length) pick.appendChild(h('p', { 'class': 'hs-meta', text: 'None of your own public decks are left to feature.' }));
      } catch (e) { pick.appendChild(h('p', { 'class': 'hs-meta', text: 'Could not load your decks. Paste a deck number below instead.' })); }
    }
    var idIn = h('input', { 'class': 'hs-input', id: 'f-id', inputmode: 'numeric', placeholder: 'Deck number (from its page address)', maxlength: '12' });
    var addBtn = h('button', { type: 'button', 'class': 'hs-btn', text: 'Feature this deck', on: { click: function (ev) {
      var v = idIn.value.trim().replace(/^.*[?&]id=/, '');
      if (!/^\d+$/.test(v)) { UI.toast('Enter a deck number, for example 42.', 'err'); return; }
      featureDeck(v, ev.currentTarget);
    } } });
    box.appendChild(h('div', { 'class': 'club-row', style: { 'margin-top': '.8rem' } }, h('label', { 'class': 'hs-field' }, h('span', { 'class': 'hs-label', text: 'Or paste a deck number' }), idIn), addBtn));
  }
  function featureDeck(id, btn) {
    UI.withBusy(btn, async function () {
      try { await CLUB.put(base() + '/featured-decks/' + enc(id)); UI.toast('Deck featured.'); renderFeatured(); }
      catch (e) { UI.toast(CUI.errMessage(e), 'err'); }
    });
  }

  // ---- audit ----
  async function renderAudit() {
    var box = host.audit;
    var rows = h('tbody'), more = h('button', { type: 'button', 'class': 'hs-btn', text: 'Load older entries', hidden: true });
    var before = '';
    var table = h('div', { 'class': 'club-scroll' }, h('table', { 'class': 'club-table' },
      h('thead', null, h('tr', null, h('th', { text: 'When' }), h('th', { text: 'Who' }), h('th', { text: 'Action' }), h('th', { text: 'Target' }), h('th', { text: 'Detail' }))), rows));
    var empty = h('p', { 'class': 'hs-meta', text: 'Loading…' });
    box.appendChild(empty); box.appendChild(table); box.appendChild(h('div', { 'class': 'hs-more' }, more));
    async function load() {
      more.disabled = true;
      try {
        var items = CLUB.items(await CLUB.get(base() + '/audit', { limit: 25, before: before }));
        items.forEach(function (a) {
          var meta = a.meta !== undefined ? a.meta : a.meta_json;
          var ms = '';
          if (meta && typeof meta === 'object') { try { ms = JSON.stringify(meta); } catch (e) { ms = ''; } } else if (meta) ms = String(meta);
          if (ms === '{}' || ms === 'null') ms = '';
          rows.appendChild(h('tr', null,
            h('td', { text: a.at ? new Date(a.at).toLocaleString() : '' }),
            h('td', { text: (a.actor_handle ? '@' + a.actor_handle : '') + (a.platform_admin ? ' (platform admin)' : '') }),
            h('td', { text: a.action || '' }),
            h('td', { text: a.target_handle ? '@' + a.target_handle : '' }),
            h('td', { text: ms.length > 160 ? ms.slice(0, 160) + '…' : ms })));
          before = a.id !== undefined ? a.id : before;
        });
        empty.textContent = rows.children.length ? '' : 'No entries yet.';
        more.hidden = items.length < 25;
      } catch (e) { empty.textContent = CUI.errMessage(e); }
      more.disabled = false;
    }
    more.addEventListener('click', load);
    load();
  }

  // ---- transfer / delete ----
  function renderTransfer() {
    var box = host.transfer;
    UI.clear(box);
    box.appendChild(h('h2', { 'class': 'club-sec-h', text: 'Transfer ownership' }));
    var cands = members.filter(function (m) { return m.sub && CUI.roleOfMember(m) === 'manager' && !isMe(m) && !P.isOwner(m); });
    if (!cands.length) { box.appendChild(h('p', { 'class': 'club-reason', text: 'Ownership can only go to another Manager. Promote a member to Manager first.' })); return; }
    var sel = h('select', { 'class': 'hs-select', id: 't-to' }, cands.map(function (m) { return h('option', { value: m.sub, text: '@' + CUI.handleOf(m) }); }));
    var err = errLine();
    var btn = h('button', { type: 'button', 'class': 'hs-btn danger', text: 'Transfer ownership' });
    btn.addEventListener('click', function () {
      var label = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : 'this member';
      if (!window.confirm('Hand ownership of ' + (club.name || slug) + ' to ' + label + '? You will remain a Manager, but only they can delete the club or hand it on.')) return;
      err.hidden = true;
      UI.withBusy(btn, async function () {
        try { await CLUB.post(base() + '/transfer', { to_sub: sel.value }); UI.toast('Ownership transferred.'); location.reload(); }
        catch (e) { showErr(err, e); }
      });
    });
    box.appendChild(h('div', { 'class': 'club-row' }, h('label', { 'class': 'hs-field' }, h('span', { 'class': 'hs-label', text: 'New owner' }), sel), btn));
    box.appendChild(err);
  }

  function renderDelete() {
    var box = host.del;
    box.appendChild(h('p', { text: 'Deleting a club removes it for every member. This cannot be undone from here.' }));
    var inp = h('input', { 'class': 'hs-input', id: 'd-slug', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: slug, 'aria-label': 'Type the club address to confirm' });
    var btn = h('button', { type: 'button', 'class': 'hs-btn danger', text: 'Delete this club', disabled: true });
    var err = errLine();
    inp.addEventListener('input', function () { btn.disabled = inp.value.trim().toLowerCase() !== slug; });
    btn.addEventListener('click', function () {
      if (inp.value.trim().toLowerCase() !== slug) return;
      err.hidden = true;
      UI.withBusy(btn, async function () {
        try { await CLUB.del(base()); location.href = '/clubs/'; }
        catch (e) { showErr(err, e); }
      });
    });
    box.appendChild(h('div', { 'class': 'club-row' }, h('label', { 'class': 'hs-field' }, h('span', { 'class': 'hs-label', text: 'Type “' + slug + '” to confirm' }), inp), btn));
    box.appendChild(err);
  }

  init();
})();
