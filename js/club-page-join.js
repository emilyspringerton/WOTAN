// /clubs/join.html#<token> -- redeem an invite. The token lives in the URL fragment (never sent to a
// server, proxy or Referer). It is read once, then the fragment is stripped with history.replaceState
// so it cannot leak from the address bar, a screenshot or a shared link. It is held only in this
// closure -- plus, ONLY while the invitee signs in (the SSO redirect would otherwise lose it), in
// sessionStorage for this tab; that copy is removed the moment the invite is redeemed or rejected.
(function () {
  'use strict';
  var h = UI.h;
  var root = UI.$('root');
  var KEY = 'wotan_club_invite_pending';

  var token = (location.hash || '').replace(/^#/, '').replace(/^token=/, '').trim();
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
  if (token) { try { sessionStorage.setItem(KEY, token); } catch (e) { /* storage unavailable: signed-out flow just asks to reopen the link */ } }
  else { try { token = sessionStorage.getItem(KEY) || ''; } catch (e) { token = ''; } }
  function forget() { token = ''; try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  function done() { root.setAttribute('aria-busy', 'false'); }
  function put(node) { UI.clear(root); done(); root.appendChild(node); }
  function card(eyebrow, title, body, actions) {
    return h('section', { 'class': 'hs-panel gold', style: { 'max-width': '560px', margin: '1rem auto 0' } },
      h('p', { 'class': 'hs-eyebrow', text: eyebrow }), h('h1', { 'class': 'hs-h1', text: title }), body || null, actions || null);
  }

  async function init() {
    if (!token) {
      put(card('Invite', 'No invite link', h('p', { 'class': 'hs-lede', text: 'Open the full link you were sent. It looks like this page’s address followed by a long code.' }),
        h('div', { 'class': 'hs-actions' }, h('a', { 'class': 'hs-btn', href: '/clubs/', text: 'Browse clubs' }))));
      return;
    }
    if (!CLUB.hasSession()) {
      put(card('Invite', 'Sign in to accept', h('p', { 'class': 'hs-lede', text: 'You have been invited to a club. Sign in, and this page will pick the invite back up.' }), h('div', null, UI.signInHint('to accept the invite'))));
      return;
    }
    var pv;
    try { pv = await CLUB.post('/invites/peek', { token: token }); }
    catch (e) { return fail(e); }
    var club = (pv && pv.club && typeof pv.club === 'object') ? pv.club : (pv || {});
    var role = pv && (pv.role || (pv.invite && pv.invite.role));
    var inviter = pv && (pv.invited_by_handle || pv.created_by_handle || pv.inviter_handle);
    var bound = pv && (pv.bound_handle || (pv.invite && pv.invite.bound_handle));

    var err = h('p', { 'class': 'hs-msg err', role: 'alert', hidden: true });
    var btn = h('button', { type: 'button', 'class': 'hs-btn solid lg', text: 'Join ' + (club.name || 'this club') });
    btn.addEventListener('click', function () {
      err.hidden = true;
      UI.withBusy(btn, async function () {
        try {
          var r = await CLUB.post('/join', { token: token });
          forget();
          var s = (r && (r.slug || (r.club && r.club.slug))) || club.slug || '';
          location.href = s ? '/clubs/w.html?s=' + encodeURIComponent(s) : '/clubs/settings.html';
        } catch (e) { fail(e, err); }
      });
    });
    put(card('You are invited', club.name || 'A club',
      h('div', null,
        h('div', { 'class': 'badges', style: { display: 'flex', gap: '.4rem', 'flex-wrap': 'wrap', margin: '.5rem 0' } }, CUI.tierBadge(CUI.tierOf(club)), role ? CUI.roleBadge(role) : null,
          club.is_exclusive ? h('span', { 'class': 'hs-badge plain fmt', text: 'Exclusive' }) : null),
        club.tagline ? h('p', { 'class': 'hs-lede', text: club.tagline }) : null,
        h('p', { 'class': 'hs-meta', text: [inviter ? 'Invited by @' + inviter : '', role ? 'You would join as a ' + (ClubPerms.ROLE_LABEL[ClubPerms.roleOf(role)] || role) : '', bound ? 'This link is bound to @' + bound : ''].filter(Boolean).join('. ') + '.' }),
        club.is_exclusive ? h('p', { 'class': 'hs-note', text: 'This club is exclusive: you cannot be in any other club while you are a member.' }) : null),
      h('div', null, h('div', { 'class': 'hs-actions', style: { 'margin-top': '1rem' } }, btn, h('a', { 'class': 'hs-btn ghost', href: '/clubs/', text: 'Not now' })), err)));
  }

  function fail(e, inline) {
    var code = e && e.code;
    var terminal = code === 'invite_expired' || code === 'invite_used' || e.status === 404 || e.status === 410;
    if (terminal) forget();
    var title, text, actions = [h('a', { 'class': 'hs-btn', href: '/clubs/', text: 'Browse clubs' })];
    if (code === 'handle_required') {
      title = 'Claim a handle first'; text = 'Clubs use your Hearthstone handle as your name. Claim one, then open this invite link again.';
      actions = [h('a', { 'class': 'hs-btn solid', href: '/hearthstone/u.html', text: 'Claim a handle' })];
    } else if (code === 'exclusive_conflict') {
      title = 'You are in another club'; text = CUI.errMessage(e);
      actions = [h('a', { 'class': 'hs-btn', href: '/clubs/settings.html', text: 'Review my clubs' })];
    } else if (code === 'invite_expired') { title = 'This invite has expired'; text = 'Ask the club for a fresh link.'; }
    else if (code === 'invite_used') { title = 'This invite was already used'; text = 'Invite links work once. Ask the club for a new one.'; }
    else if (e.status === 404 || e.status === 410) { title = 'This invite is not valid'; text = 'The link may be mistyped, or it was revoked.'; }
    else if (e.status === 401) { title = 'Sign in to accept'; text = 'Your session has ended.'; }
    else { title = 'That did not work'; text = CUI.errMessage(e); }
    if (inline) { inline.textContent = title + '. ' + text; inline.hidden = false; return; }
    put(card('Invite', title, h('p', { 'class': 'hs-lede', text: text }), h('div', { 'class': 'hs-actions' }, actions)));
  }

  init();
})();
