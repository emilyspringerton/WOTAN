// Sitewide cookie notice + legal footer (founder real-time, 2026-10-11: "put something on top of
// iduna iam and wotan that says by continuing use you consent to cookies with links to the full
// terms and privacy policy"). Every WOTAN page loads this, including DEADWEIGHT/index.html, which
// uses neither iduna-sso.js nor wotan-nav.js -- so this file is deliberately self-contained (no
// dependency on either) and styles itself with hardcoded colors rather than wotan-theme.css
// variables, since not every page that needs this loads that stylesheet.
//
// Inserted as the FIRST child of <body> (not position:fixed) so it pushes the page's own sticky
// topbar down in normal flow instead of overlapping it, and collapses cleanly when dismissed.
// The footer (Terms/Privacy links) is separate and permanent -- it stays after the banner is
// dismissed, so the links are never only reachable for one page view.
(function () {
  'use strict';
  var CONSENT_KEY = 'wotan_cookie_consent';

  function hasConsented() {
    try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch (e) { return false; }
  }
  function giveConsent() {
    try { localStorage.setItem(CONSENT_KEY, '1'); } catch (e) { /* private browsing / storage disabled */ }
    var b = document.getElementById('wcc-banner');
    if (b) b.parentNode.removeChild(b);
  }

  function injectStyle() {
    var style = document.createElement('style');
    style.textContent =
      '#wcc-banner{background:#13101d;color:#f1ece2;border-bottom:2px solid #d8b463;' +
      'font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;' +
      'padding:.7rem 1rem;display:flex;flex-wrap:wrap;gap:.6rem 1.2rem;align-items:center;justify-content:center}' +
      '#wcc-banner a{color:#eecb84;text-decoration:underline}' +
      '#wcc-banner a:hover{color:#fff}' +
      '#wcc-banner .wcc-text{max-width:56rem;text-align:center}' +
      '#wcc-banner button{flex:0 0 auto;background:#d8b463;color:#13101d;border:none;border-radius:6px;' +
      'padding:.4rem .9rem;font-weight:700;font-size:.85rem;cursor:pointer;font-family:inherit}' +
      '#wcc-banner button:hover{background:#eecb84}' +
      '#wcc-footer{font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;' +
      'text-align:center;color:#8a8398;padding:1.75rem 1rem 2.25rem}' +
      '#wcc-footer a{color:#b6a7d1;text-decoration:underline;margin:0 .35rem}' +
      '#wcc-footer a:hover{color:#eecb84}';
    document.head.appendChild(style);
  }

  function legalLink(href, label) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    return a;
  }

  function mountFooter() {
    var footer = document.createElement('footer');
    footer.id = 'wcc-footer';
    footer.appendChild(document.createTextNode('© ' + new Date().getFullYear() + ' EINHORN_INDUSTRIAL'));
    footer.appendChild(legalLink('/terms.html', 'Terms of Service'));
    footer.appendChild(document.createTextNode('·'));
    footer.appendChild(legalLink('/privacy.html', 'Privacy Policy'));
    document.body.appendChild(footer);
  }

  function mountBanner() {
    if (hasConsented()) return;
    var banner = document.createElement('div');
    banner.id = 'wcc-banner';

    var text = document.createElement('span');
    text.className = 'wcc-text';
    text.appendChild(document.createTextNode('By continuing to use this site, you consent to cookies. See our '));
    text.appendChild(legalLink('/terms.html', 'Terms of Service'));
    text.appendChild(document.createTextNode(' and '));
    text.appendChild(legalLink('/privacy.html', 'Privacy Policy'));
    text.appendChild(document.createTextNode('.'));

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Got it';
    btn.addEventListener('click', giveConsent);

    banner.appendChild(text);
    banner.appendChild(btn);
    document.body.insertBefore(banner, document.body.firstChild);
  }

  function mount() {
    injectStyle();
    mountFooter();
    mountBanner();
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
