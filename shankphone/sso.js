// The SHANKPHONE's IDUNA sign-in return: forward the token to the app, then forget it (replaceState keeps it out of this tab's history).
// IDUNA lands here with #sso_token=<jwt>&player_id=<url-encoded>&display_name=<url-encoded> (sso_login.go / sso_google.go). Only the token
// and the player id go on to shankphone://sso; the app (shell/SsoLink) checks them again. The app opens this flow in a Custom Tab inside its
// own task, so when Android hands the link to the app the tab is closed for you; the button is only a fallback for a browser that waits
// for a tap before leaving the page.
(function () {
  'use strict';
  var msg = document.getElementById('msg'), back = document.getElementById('back');
  var q = new URLSearchParams(location.hash.replace(/^#/, ''));
  var token = q.get('sso_token') || '', player = q.get('player_id') || '';
  if (!/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(token)) {
    document.title = 'SHANKPHONE sign-in';
    document.querySelector('h1').textContent = 'Sign-in did not finish';
    msg.textContent = 'IDUNA did not hand back a sign-in. Go back to the SHANKPHONE and tap Sign in with IDUNA again.';
    return;
  }
  if (!/^[A-Za-z0-9:_\-]{0,128}$/.test(player)) player = '';
  var link = 'shankphone://sso#sso_token=' + token + (player ? '&player_id=' + encodeURIComponent(player) : '');
  history.replaceState(null, '', location.pathname);
  back.href = link;
  location.replace(link);
  // still here a moment later: this browser wants a tap to open the app
  setTimeout(function () {
    msg.textContent = 'Signed in. Tap below if the SHANKPHONE did not open by itself.';
    back.hidden = false;
  }, 1200);
  // and once the app has it, try to close this tab (works where the page may close itself; harmless elsewhere)
  document.addEventListener('visibilitychange', function () { if (document.hidden) setTimeout(function () { window.close(); }, 300); });
})();
