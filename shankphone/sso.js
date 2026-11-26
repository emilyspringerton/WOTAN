// The SHANKPHONE's IDUNA sign-in return: forward the fragment to the app, then forget it (location.replace keeps the token out of
// this tab's history). Hand-written and tiny on purpose: there is nothing to decide here.
(function () {
  'use strict';
  var h = location.hash;
  var msg = document.getElementById('msg'), back = document.getElementById('back');
  if (!/^#sso_token=[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+(&player_id=[A-Za-z0-9:_\-]*)?$/.test(h)) {
    msg.textContent = 'Nothing to hand back. Open the SHANKPHONE and tap Sign in with IDUNA again.';
    return;
  }
  var link = 'shankphone://sso' + h;
  history.replaceState(null, '', location.pathname);
  back.href = link;
  back.hidden = false;
  location.replace(link);
})();
