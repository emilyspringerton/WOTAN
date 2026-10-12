// Shared UI helpers for the CLUBS section (pairs with css/wotan-clubs.css, js/hs-ui.js, js/club-api.js,
// js/club-perms.js). Same house rule as hs-ui.js: user-supplied text only ever reaches the DOM through
// textContent (UI.h). There is no innerHTML of user data in this section.
(function () {
  'use strict';
  var h = UI.h;
  var P = window.ClubPerms;

  var SLUG_RE = /^[a-z0-9-]{3,30}$/;

  function slugify(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  }

  // ---- tolerant field readers (the contract lists shapes loosely; absent optional fields are fine) ----
  function handleOf(x) {
    if (!x) return '';
    return x.handle || x.author_handle || x.actor_handle || x.target_handle ||
      (x.author && x.author.handle) || (x.user && x.user.handle) || '';
  }
  function tierOf(c) { return P.normTier(c && (c.privacy_tier !== undefined ? c.privacy_tier : (c.tier !== undefined ? c.tier : c.visibility))); }
  function membersCount(c) {
    var n = c && (c.member_count !== undefined ? c.member_count : (c.members_count !== undefined ? c.members_count : c.members));
    return typeof n === 'number' ? n : null;
  }
  function rankOf(m) {
    var r = (m && typeof m.rank === 'object' && m.rank) ? m.rank : m || {};
    var lr = r.legend_rank !== undefined ? r.legend_rank : (m && m.legend_rank);
    var ver = r.rank_verified !== undefined ? r.rank_verified : (m && m.rank_verified);
    return {
      legend: (typeof lr === 'number' && lr > 0) ? lr : null,
      verified: ver === true || ver === 1,
      region: r.region || (m && m.region) || '',
      battletag: r.battletag || (m && m.battletag) || '',
      btVerified: (r.battletag_verified !== undefined ? r.battletag_verified : (m && m.battletag_verified)) === true
    };
  }
  function roleOfMember(m) { return P.isOwner(m) && !m.role ? 'manager' : P.roleOf(m && m.role); }

  // Display name for a person: Twitch name with a Twitch mark when the player opted in (IDENTITY_NORTHSTAR I9),
  // else the @handle. Falls back to the plain handle link if js/identity-api.js is absent. `fallbackHandle`
  // is for list items where the handle was already extracted from a nested field.
  function nameLink(obj, fallbackHandle) {
    var hd = (obj && handleOf(obj)) || fallbackHandle || '';
    if (!hd) return h('span', { 'class': 'hs-meta', text: 'former member' });
    var dn = window.IDAPI ? window.IDAPI.displayName(Object.assign({}, obj || {}, { handle: hd })) : null;
    if (!dn || !dn.twitch) return UI.handleLink(hd);
    return h('a', { href: '/hearthstone/u.html?h=' + encodeURIComponent(hd), title: 'Twitch name (WOTAN handle @' + hd + ')' },
      h('span', { 'class': 'id-tw', 'aria-label': 'Twitch', text: '\u25B6' }), h('span', { text: dn.text }));
  }

  // ---- badges ----
  function tierBadge(tier) {
    var t = P.normTier(tier);
    var cls = t === 1 ? 'warn' : (t === 3 ? '' : 'fmt');
    return h('span', { 'class': 'hs-badge plain club-tier t' + t + (cls ? ' ' + cls : ''), text: P.tierName(t), title: { 1: 'Secret: invisible to outsiders', 2: 'Private: roster is public, everything else is members only', 3: 'Social: roster and featured decks are public' }[t] || '' });
  }
  function roleBadge(role) {
    var r = P.roleOf(role);
    if (!r) return null;
    return h('span', { 'class': 'club-role r-' + r, title: P.ROLE_LABEL[r] }, h('span', { 'aria-hidden': 'true', text: P.ROLE_EMOJI[r] }), h('span', { text: P.ROLE_LABEL[r] }));
  }
  function ownerBadge() { return h('span', { 'class': 'hs-badge plain', text: 'Owner' }); }
  // Explicit "unverified" mark whenever rank_verified is not true (R4: no data source for verification yet).
  function rankBadge(m) {
    var r = rankOf(m);
    if (!r.legend) return h('span', { 'class': 'club-rank none', text: 'Unranked' });
    // "Leaderboard-matched", never "verified": the match is a name match against the public leaderboard, not proof.
    var lbl = window.IDAPI ? window.IDAPI.rankLabel(r.verified) : (r.verified ? 'Leaderboard-matched' : 'unverified');
    return h('span', { 'class': 'club-rank ' + (r.verified ? 'ok' : 'unv'), title: r.verified ? 'Matched to a public Hearthstone leaderboard entry for a linked BattleTag' : 'Self-declared rank, not verified' },
      h('b', { text: 'Legend #' + r.legend }), r.region ? h('span', { 'class': 'rg', text: r.region }) : null,
      h('span', { 'class': 'vf' + (r.verified ? ' matched' : ''), text: lbl }));
  }

  function memberRow(m, extra) {
    var hd = handleOf(m);
    var r = rankOf(m);
    return h('div', { 'class': 'club-member' },
      h('div', { 'class': 'who' },
        nameLink(m),
        roleBadge(roleOfMember(m)), P.isOwner(m) ? ownerBadge() : null),
      h('div', { 'class': 'rk' }, rankBadge(m),
        r.battletag ? h('span', { 'class': 'bt', text: r.battletag + (r.btVerified ? ' ✓' : ''), title: r.btVerified ? 'BattleTag linked via Battle.net' : 'Self-declared BattleTag' }) : null),
      extra || null);
  }

  // ---- cards / states ----
  function clubCard(c) {
    var n = membersCount(c);
    return h('article', { 'class': 'club-card' },
      h('div', { 'class': 'top' }, tierBadge(tierOf(c)), c.is_exclusive ? h('span', { 'class': 'hs-badge plain fmt', text: 'Exclusive', title: 'Members of this club cannot belong to other clubs' }) : null),
      h('h3', null, h('a', { href: '/clubs/c.html?s=' + encodeURIComponent(c.slug || ''), text: c.name || c.slug || 'Club' })),
      c.tagline ? h('p', { 'class': 'tag', text: c.tagline }) : null,
      h('div', { 'class': 'foot hs-meta' },
        n !== null ? h('span', { text: n + (n === 1 ? ' member' : ' members') }) : null,
        typeof c.prestige === 'number' ? h('span', { text: 'Prestige ' + c.prestige }) : null,
        c.created_at ? h('span', { text: 'Est. ' + UI.monthYear(c.created_at) }) : null));
  }

  // Generic 404-style state. Deliberately says nothing about whether the club exists (§3.3).
  function notFound(extra) {
    return UI.emptyState('Club not found', 'There is no club here, or you do not have access to it.',
      h('div', null, h('a', { 'class': 'hs-btn', href: '/clubs/', text: 'Browse clubs' }), extra ? h('div', { style: { 'margin-top': '1rem' } }, extra) : null));
  }

  function setBrand(el, brand) {
    if (!brand || typeof brand !== 'object') return;
    if (typeof brand.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(brand.accent)) el.style.setProperty('--club-accent', brand.accent);
  }

  // ---- resolve a club for the member pages ----
  // Prefer GET /me/clubs (gives id + role without needing the public view), fall back to by-slug.
  async function resolveClub(slug) {
    var s = String(slug || '').toLowerCase();
    if (CLUB.hasSession()) {
      try {
        var mine = CLUB.items(await CLUB.get('/me/clubs'));
        for (var i = 0; i < mine.length; i++) {
          if (String(mine[i].slug || '').toLowerCase() === s && mine[i].id) return { id: mine[i].id, slug: mine[i].slug, summary: mine[i] };
        }
      } catch (e) { /* fall through to by-slug */ }
    }
    var c = await CLUB.get('/by-slug/' + encodeURIComponent(s));
    return { id: c.id, slug: c.slug || s, club: c };
  }

  // My membership role for a slug (or '' when not a member / signed out). Never throws.
  async function myRole(slug) {
    if (!CLUB.hasSession()) return '';
    try {
      var mine = CLUB.items(await CLUB.get('/me/clubs'));
      var s = String(slug || '').toLowerCase();
      for (var i = 0; i < mine.length; i++) if (String(mine[i].slug || '').toLowerCase() === s) return P.roleOf(mine[i].role) || 'player';
    } catch (e) { /* ignore */ }
    return '';
  }


  // Gate for members-only pages (w.html, manage.html). Resolves {id, slug, club, role, perms, me} or
  // renders a state into root and returns null. 401/403/404 all look the same on purpose.
  async function memberGate(root, slug, retry) {
    function stop(node) { UI.clear(root); root.setAttribute('aria-busy', 'false'); root.appendChild(node); return null; }
    slug = String(slug || '').toLowerCase();
    if (!SLUG_RE.test(slug)) return stop(notFound());
    if (!CLUB.hasSession()) {
      return stop(UI.emptyState('Members only', 'Sign in to open this club\u2019s workspace.', h('div', null, UI.signInHint('to continue'), h('div', { style: { 'margin-top': '1rem' } }, h('a', { 'class': 'hs-btn', href: '/clubs/', text: 'Browse clubs' })))));
    }
    var r;
    try { r = await resolveClub(slug); }
    catch (e) { return stop(e.status === 404 || e.status === 403 || e.status === 401 ? notFound() : UI.errorState(e.message, retry)); }
    if (!r || !r.id) return stop(notFound());
    var me;
    try { me = await CLUB.get('/' + encodeURIComponent(r.id) + '/me'); }
    catch (e) { return stop(e.status === 404 || e.status === 403 || e.status === 401 ? notFound() : UI.errorState(e.message, retry)); }
    var perms = (me && Array.isArray(me.perms)) ? me.perms : [];
    return { id: r.id, slug: r.slug || slug, club: r.club || null, summary: r.summary || null, role: P.roleOf(me && me.role), perms: perms, me: me || {} };
  }

  // Sub-navigation shown on every club page.
  function subnav(slug, active, perms) {
    var q = '?s=' + encodeURIComponent(slug);
    var pan = P.panels(perms || []);
    var manageable = pan.invites || pan.requests || pan.settings || pan.visibility || pan.audit || pan.featured || pan.moderate ||
      P.hasAny(perms, ['club.members.remove.player', 'club.members.promote', 'club.members.demote']);
    var links = [['c', 'Public page', '/clubs/c.html' + q]];
    if (perms && P.has(perms, 'club.view')) links.push(['w', 'Workspace', '/clubs/w.html' + q]);
    if (manageable) links.push(['m', 'Manage', '/clubs/manage.html' + q]);
    return h('nav', { 'class': 'club-subnav', 'aria-label': 'Club sections' },
      links.map(function (l) { return h('a', { href: l[2], text: l[0] === 'c' ? 'Public page' : l[1], 'aria-current': l[0] === active ? 'page' : null }); }));
  }

  // A button that is disabled but still explains itself (disabled buttons swallow hover, so the
  // tooltip lives on a wrapper; the reason is also in the accessible name via sr-only text).
  function reasonButton(label, opts) {
    opts = opts || {};
    var btn = h('button', { type: 'button', 'class': 'hs-btn sm ' + (opts.cls || 'ghost'), text: label });
    if (opts.enabled === false) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      return h('span', { 'class': 'club-tip', title: opts.reason || '', tabindex: '0', 'data-reason': opts.reason || '' },
        btn, h('span', { 'class': 'hs-sr', text: opts.reason ? ' (' + opts.reason + ')' : '' }));
    }
    if (opts.onClick) btn.addEventListener('click', function () { opts.onClick(btn); });
    return btn;
  }

  function errMessage(e) {
    if (!e) return 'Something went wrong.';
    if (e.code === 'handle_required') return 'You need a Hearthstone handle first. Claim one from the account menu, then try again.';
    if (e.code === 'exclusive_conflict') return e.message || 'Exclusive clubs cannot be combined with other club memberships.';
    if (e.code === 'last_manager') return 'This is the last Manager. Promote or transfer to someone else first.';
    if (e.code === 'invite_expired') return 'This invite has expired. Ask for a new one.';
    if (e.code === 'invite_used') return 'This invite has already been used. Ask for a new one.';
    if (e.code === 'tier_forbidden') return e.message || 'That privacy tier is not allowed for this setting.';
    return e.message || 'Something went wrong.';
  }

  // Signed-out gate: plain text link, never a button (standing rule). Returns true when blocked.
  function requireSession(root, what) {
    if (CLUB.hasSession()) return false;
    UI.clear(root);
    root.setAttribute('aria-busy', 'false');
    root.appendChild(UI.emptyState('Sign in required', 'This page is only for signed-in players.', h('div', null, UI.signInHint(what || 'to continue'))));
    return true;
  }

  // Matchup matrix normaliser. Accepts either a nested object {matrix:{mine:{opp:{games,wins}}}} or a flat
  // array of {mine|player_class|class|archetype, opp|opponent|opponent_class|vs, games, wins, losses, winrate}.
  function matchupMatrix(res) {
    var cells = [];
    function pushCell(r, c, v) {
      if (!v || typeof v !== 'object') return;
      var wins = Number(v.wins) || 0, losses = Number(v.losses) || 0, ties = Number(v.ties) || 0;
      var games = v.games !== undefined ? Number(v.games) : wins + losses + ties;
      var wr = v.winrate !== undefined && v.winrate !== null ? Number(v.winrate) : (games ? wins / games : null);
      if (wr !== null && wr > 1) wr = wr / 100;
      cells.push({ r: String(r), c: String(c), games: games || 0, wins: wins, wr: games ? wr : null });
    }
    var min = (res && Number(res.min_sample)) || 5;
    if (res && res.matrix && typeof res.matrix === 'object' && !Array.isArray(res.matrix)) {
      Object.keys(res.matrix).forEach(function (r) {
        var row = res.matrix[r];
        if (row && typeof row === 'object') Object.keys(row).forEach(function (c) { pushCell(r, c, row[c]); });
      });
    } else {
      var arr = Array.isArray(res) ? res : (res && (res.items || res.matchups || res.cells || res.rows)) || [];
      (Array.isArray(arr) ? arr : []).forEach(function (x) {
        var r = x.mine || x.player_class || x.my_class || x.class || x.archetype || x.deck || x.row;
        var c = x.opp || x.opponent || x.opponent_class || x.opp_class || x.vs || x.against || x.col;
        if (r === undefined || c === undefined) return;
        pushCell(r, c, x);
      });
    }
    var rows = [], cols = [];
    cells.forEach(function (x) { if (rows.indexOf(x.r) < 0) rows.push(x.r); if (cols.indexOf(x.c) < 0) cols.push(x.c); });
    rows.sort(); cols.sort();
    var byKey = {};
    cells.forEach(function (x) { byKey[x.r + '\u0000' + x.c] = x; });
    return { rows: rows, cols: cols, get: function (r, c) { return byKey[r + '\u0000' + c] || null; }, min: min, empty: cells.length === 0 };
  }

  window.CUI = {
    SLUG_RE: SLUG_RE, slugify: slugify,
    handleOf: handleOf, tierOf: tierOf, membersCount: membersCount, rankOf: rankOf, roleOfMember: roleOfMember,
    tierBadge: tierBadge, roleBadge: roleBadge, rankBadge: rankBadge, nameLink: nameLink, memberRow: memberRow, clubCard: clubCard,
    memberGate: memberGate, notFound: notFound, setBrand: setBrand, resolveClub: resolveClub, myRole: myRole, subnav: subnav,
    reasonButton: reasonButton, errMessage: errMessage, requireSession: requireSession, matchupMatrix: matchupMatrix
  };
})();
