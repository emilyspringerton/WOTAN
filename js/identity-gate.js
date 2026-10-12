// "Competitive Verification Required" gate + grace banner (IDENTITY_NORTHSTAR.md section 5).
// Reused by the tracker page (copy install command), the club-creation flow, and the account page. Needs
// js/identity-api.js and js/hs-ui.js (UI.h) loaded first. The gate is UX only: the server enforces the
// same rule and answers {error:"battlenet_required"} (IDGate.handleError turns that into the same modal).
(function () {
  'use strict';
  var h = window.UI && window.UI.h;
  var API = window.IDAPI;

  function fmtDate(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return iso;
    try { return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return new Date(t).toISOString().slice(0, 10); }
  }

  var dlg = null;
  function closeDlg() {
    if (!dlg) return;
    if (typeof dlg.close === 'function') { try { dlg.close(); } catch (e) { /* ignore */ } }
    dlg.removeAttribute('open');
    if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
    dlg = null;
  }

  // Resolves true when the user may proceed, false when they dismissed the modal.
  //  opts.action   -- what they were trying to do ("download the tracker", "create a club")
  //  opts.graceUntil -- shown with a "Continue for now" button when the 30-day grandfathering window is open
  function showModal(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!h) { resolve(true); return; }
      closeDlg();
      var done = false;
      function finish(v) { if (done) return; done = true; closeDlg(); resolve(v); }
      var grace = API.graceActive(opts.graceUntil);
      var link = h('button', { type: 'button', 'class': 'hs-btn solid', text: 'Link a Battle.net account',
        on: { click: function () { API.beginLink('battlenet'); } } });
      var later = grace
        ? h('button', { type: 'button', 'class': 'hs-btn ghost', text: 'Continue for now', on: { click: function () { finish(true); } } })
        : h('button', { type: 'button', 'class': 'hs-btn ghost', text: 'Not now', on: { click: function () { finish(false); } } });
      dlg = h('dialog', { 'class': 'id-dialog', 'aria-labelledby': 'id-gate-title' },
        h('h2', { 'class': 'hs-h2', id: 'id-gate-title', text: 'Competitive Verification Required' }),
        h('p', null, 'To ' + (opts.action || 'use this feature') + ', WOTAN needs to know which Hearthstone account you play on. ' +
          'Link your Battle.net account (a one-time sign-in with Blizzard; WOTAN only receives your BattleTag and a stable ID, never your password).'),
        grace ? h('p', { 'class': 'id-grace', role: 'note', text: 'You already use this feature, so it keeps working until ' + fmtDate(opts.graceUntil) + '. Link before then to keep it.' }) : null,
        h('p', { 'class': 'hs-meta', text: 'You can still browse, comment, follow and join clubs without linking.' }),
        h('div', { 'class': 'hs-actions' }, link, later,
          h('a', { 'class': 'hs-btn ghost', href: '/account/', text: 'Account settings' })));
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); finish(grace); });
      document.body.appendChild(dlg);
      if (typeof dlg.showModal === 'function') { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } }
      else dlg.setAttribute('open', '');
    });
  }

  // Resolves true when the action may proceed. Signed-out visitors and an unreachable backend are let
  // through (other flows own the sign-in prompt; the server still enforces) -- see status().unknown.
  async function require_(opts) {
    if (!API) return true;
    var st = await API.status();
    if (!st.signedIn || st.unknown || st.battlenetLinked) return true;
    return showModal({ action: opts && opts.action, graceUntil: st.graceUntil });
  }

  // For a failed API call: if it was the server-side gate, show the modal and return true.
  function handleError(err, opts) {
    if (!err || err.code !== 'battlenet_required') return false;
    showModal({ action: opts && opts.action });
    return true;
  }

  // Renders a grace notice into `container` when grace_until is set and still open. Resolves true if shown.
  async function banner(container) {
    if (!API || !container || !h) return false;
    var st = await API.status();
    while (container.firstChild) container.removeChild(container.firstChild);
    container.hidden = true;
    if (!st.signedIn || st.battlenetLinked || !st.graceActive) return false;
    container.hidden = false;
    container.appendChild(h('div', { 'class': 'id-banner', role: 'status' },
      h('b', { text: 'Link Battle.net by ' + fmtDate(st.graceUntil) + '. ' }),
      'You already create clubs or upload games, so those keep working for now. After that date they need a linked Battle.net account. ',
      h('a', { href: '/account/', text: 'Link it in account settings' }), '.'));
    return true;
  }

  window.IDGate = { require: require_, handleError: handleError, banner: banner, showModal: showModal, fmtDate: fmtDate };
})();
