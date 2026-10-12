// Club badges for a Hearthstone profile (hearthstone/u.html). Contract: the club-side route is
// GET /api/v1/clubs/users/{handle}/clubs (the spec writes it as /users/{handle}/clubs under /clubs/).
// Server returns only badges the viewer may see (never Secret, never member-hidden), so anything it
// sends is rendered. Fails silently: a missing endpoint or an empty list adds nothing to the page.
(function () {
  'use strict';
  var EMOJI = { manager: '👑', coach: '📋', player: '⚔️' };
  async function mount(container, handle) {
    if (!window.CLUB || !window.UI || !container || !handle) return;
    var items;
    try { items = CLUB.items(await CLUB.get('/users/' + encodeURIComponent(handle) + '/clubs')); } catch (e) { return; }
    if (!items.length) return;
    var h = UI.h;
    var wrap = h('div', { 'class': 'club-profile-badges', role: 'list', 'aria-label': 'Clubs' });
    items.forEach(function (c) {
      if (!c || !c.slug) return;
      var role = String(c.role || '').toLowerCase();
      // "mutual" = the viewer is also in this club: link to the workspace, else the public page.
      var mutual = c.mutual === true || c.mutual_workspace === true || c.viewer_is_member === true;
      var href = (mutual ? '/clubs/w.html?s=' : '/clubs/c.html?s=') + encodeURIComponent(c.slug);
      wrap.appendChild(h('a', { href: href, role: 'listitem', title: (role ? role.charAt(0).toUpperCase() + role.slice(1) + ' of ' : 'Member of ') + (c.name || c.slug) },
        EMOJI[role] ? h('span', { 'aria-hidden': 'true', text: EMOJI[role] }) : null, h('span', { text: c.name || c.slug })));
    });
    if (wrap.children.length) container.appendChild(wrap);
  }
  window.ClubBadges = { mount: mount };
})();
