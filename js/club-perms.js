// Pure permission -> affordance logic for the Clubs admin console (CLUBS_NORTHSTAR.md §2, §7.1).
// No DOM, no network: loadable in the browser (window.ClubPerms) and in plain node
// (scripts/clubs-affordance-test.js). The UI is never the security boundary -- the server enforces;
// this only decides what to show, hide, or show disabled-with-a-reason, from GET /clubs/{id}/me perms[].
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClubPerms = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RANK = { player: 1, coach: 2, manager: 3 };
  var ROLE_LABEL = { player: 'Player', coach: 'Coach', manager: 'Manager' };
  var ROLE_EMOJI = { manager: '👑', coach: '📋', player: '⚔️' }; // crown, clipboard, swords

  function set(perms) {
    var o = {};
    (Array.isArray(perms) ? perms : []).forEach(function (p) { o[String(p)] = true; });
    return o;
  }
  function has(perms, node) { return !!set(perms)[node]; }
  function hasAny(perms, nodes) { var s = set(perms); return nodes.some(function (n) { return !!s[n]; }); }

  function roleOf(x) { var r = String(x || '').toLowerCase(); return RANK[r] ? r : ''; }

  // Is this member the club owner? Tolerates several server spellings.
  function isOwner(m) { return !!(m && (m.is_owner === true || m.owner === true || m.role === 'owner')); }

  // A target row -> { visible, enabled, reason } for the [Remove] button.
  // actor = { role, perms[] }, target = { role, is_owner?, is_me? }
  function removeAffordance(actor, target) {
    var perms = actor && actor.perms;
    var t = roleOf(target && target.role);
    if (!t) return { visible: false, enabled: false, reason: '' };
    if (target.is_me || target.me) return { visible: true, enabled: false, reason: 'This is you. Use “Leave club” instead.' };
    if (isOwner(target)) return { visible: true, enabled: false, reason: 'The club Owner cannot be removed. Transfer ownership first.' };
    var node = 'club.members.remove.' + t;
    if (has(perms, node)) return { visible: true, enabled: true, reason: '' };
    var actorRole = roleOf(actor && actor.role);
    var reason;
    if (t === 'manager') reason = 'Only Managers can remove other Managers.';
    else if (t === 'coach' && actorRole === 'coach') reason = 'Coaches cannot remove other Coaches. Ask a Manager.';
    else if (t === 'coach') reason = 'You do not have permission to remove Coaches.';
    else reason = 'You do not have permission to remove Players.';
    return { visible: true, enabled: false, reason: reason };
  }

  // Role-change options for one target. Returns { visible, options:[{role, enabled, reason}], reason }.
  // Contract: promote is one step (Player->Coach, Coach->Manager); demote lowers anyone below Owner.
  // Nobody changes their own role; the Owner's role is fixed; the last Manager cannot be demoted.
  function roleChangeAffordance(actor, target, managerCount) {
    var perms = actor && actor.perms;
    var cur = roleOf(target && target.role);
    var canPromote = has(perms, 'club.members.promote');
    var canDemote = has(perms, 'club.members.demote');
    if (!cur || (!canPromote && !canDemote)) return { visible: false, options: [], reason: '' };
    if (target.is_me || target.me) return { visible: true, options: [], reason: 'You cannot change your own role.' };
    if (isOwner(target)) return { visible: true, options: [], reason: 'The Owner’s role is fixed. Transfer ownership instead.' };
    var opts = [];
    Object.keys(RANK).forEach(function (r) {
      if (r === cur) return;
      var up = RANK[r] > RANK[cur];
      var o = { role: r, enabled: true, reason: '' };
      if (up) {
        if (!canPromote) { o.enabled = false; o.reason = 'Needs promote permission.'; }
        else if (RANK[r] - RANK[cur] > 1) { o.enabled = false; o.reason = 'Promote one step at a time.'; }
      } else {
        if (!canDemote) { o.enabled = false; o.reason = 'Needs demote permission.'; }
        else if (cur === 'manager' && managerCount !== undefined && managerCount <= 1) { o.enabled = false; o.reason = 'The last Manager cannot be demoted.'; }
      }
      opts.push(o);
    });
    return { visible: true, options: opts, reason: '' };
  }

  // Which roles may an invite grant? player needs club.members.invite; coach/manager need .elevated.
  function inviteRoles(perms) {
    var out = [];
    if (has(perms, 'club.members.invite')) out.push('player');
    if (has(perms, 'club.members.invite.elevated')) { out.push('coach'); out.push('manager'); }
    return out;
  }

  // Which console panels the viewer sees. Everything is computed from perms[] only.
  function panels(perms) {
    var p = perms;
    return {
      roster: has(p, 'club.roster.view'),
      invites: hasAny(p, ['club.members.invite', 'club.members.invite.elevated']),
      requests: has(p, 'club.members.requests'),
      featured: has(p, 'club.decks.feature'),
      moderate: has(p, 'club.feed.moderate'),
      settings: has(p, 'club.settings.edit'),
      visibility: has(p, 'club.visibility.set'),
      audit: has(p, 'club.audit.view'),
      transfer: has(p, 'club.owner.transfer'),
      del: has(p, 'club.delete'),
      any: p && p.length > 0
    };
  }

  // Tier selector with memory (§3.2). tier: 1 secret, 2 private, 3 social.
  function tierName(t) { return { 1: 'Secret', 2: 'Private', 3: 'Social' }[Number(t)] || 'Unknown'; }
  function normTier(v) {
    if (typeof v === 'string' && isNaN(Number(v))) return { secret: 1, private: 2, social: 3 }[v.toLowerCase()] || 0;
    var n = Number(v);
    return n >= 1 && n <= 3 ? n : 0;
  }
  // -> { mode:'reveal'|'dark'|'none', restoreTo, label }
  function stealthToggle(tier, prevTier) {
    var t = normTier(tier), p = normTier(prevTier);
    if (t === 1) return { mode: 'reveal', restoreTo: (p === 2 || p === 3) ? p : 0, label: p === 2 || p === 3 ? 'Reveal (back to ' + tierName(p) + ')' : 'Reveal' };
    if (t === 2 || t === 3) return { mode: 'dark', restoreTo: 0, label: 'Go dark (Secret)' };
    return { mode: 'none', restoreTo: 0, label: '' };
  }
  // join policy 'request' is only valid for Social clubs (§3.1, OQ-2).
  function joinPolicyOptions(tier) {
    return [
      { value: 'invite', enabled: true, reason: '' },
      { value: 'request', enabled: normTier(tier) === 3, reason: 'Request-to-join is only available for Social clubs.' }
    ];
  }

  return {
    RANK: RANK, ROLE_LABEL: ROLE_LABEL, ROLE_EMOJI: ROLE_EMOJI,
    has: has, hasAny: hasAny, roleOf: roleOf, isOwner: isOwner,
    removeAffordance: removeAffordance, roleChangeAffordance: roleChangeAffordance,
    inviteRoles: inviteRoles, panels: panels,
    tierName: tierName, normTier: normTier, stealthToggle: stealthToggle, joinPolicyOptions: joinPolicyOptions
  };
});
