// /redeem/ -- the full Redeem a Code page (founder real-time 2026-10-16, after Battle.net's). All the work is in
// js/redeem-widget.js; this only mounts it and wires Cancel. Signed-out visitors get the plain "Sign in to redeem a
// code" line from the widget (the top bar owns the real Sign in button, per the site rule).
(function () {
  'use strict';
  var host = document.getElementById('rd-mount');
  if (!host || !window.RedeemWidget) return;
  var form = window.RedeemWidget.mountForm(host, {});
  if (window.RedeemAPI.hasSession()) form.focus();

  var cancel = document.getElementById('rd-cancel');
  if (cancel) cancel.addEventListener('click', function () {
    // Back to wherever the person came from (a game's menu, the account page); /account/ if this was a fresh tab.
    if (document.referrer && document.referrer.indexOf(location.origin) === 0 && history.length > 1) history.back();
    else location.href = '/account/';
  });
})();
