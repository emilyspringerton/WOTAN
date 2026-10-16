// /account/ overview (founder real-time 2026-10-16, modelled on Battle.net's Account Overview): a "Redeem a code"
// card, per-game status (Battle.net's "Subscriptions & Game Time") and recent redemptions (its "Recent Purchases").
// Mounted by identity-page-account.js under its hero. Optional by design: if this file or its API is missing the
// identity sections below still render, and a failure here never blocks them. Signed-out visitors get nothing --
// the identity page already shows its own sign-in notice.
(function (root) {
  'use strict';

  function mount(host) {
    var API = root.RedeemAPI, W = root.RedeemWidget;
    if (!API || !W || !API.hasSession()) return;
    var h = function (tag, cls, kids) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      (kids || []).forEach(function (k) { if (k) n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
      return n;
    };
    var title = function (text) { var t = h('h2', 'club-sec-h'); t.textContent = text; return t; };

    var formHost = h('div'), gamesHost = h('div'), historyHost = h('div');
    var moreLink = h('p', 'hs-meta');
    var a = document.createElement('a'); a.href = '/redeem/'; a.textContent = 'Open the Redeem a Code page';
    moreLink.appendChild(a);

    var redeemCard = h('section', 'hs-panel club-sec', [title('Redeem a code'), formHost, moreLink]);
    redeemCard.id = 'redeem';
    var gamesCard = h('section', 'hs-panel club-sec', [title('Games'), gamesHost]);
    var historyCard = h('section', 'hs-panel club-sec', [title('Recent redemptions'), historyHost]);
    var grid = h('div', 'rd-grid', [redeemCard, gamesCard]);
    host.classList.add('rd-overview');
    host.appendChild(grid);
    host.appendChild(historyCard);

    function load() {
      return API.entitlements().then(function (e) {
        W.renderGames(gamesHost, e.games);
        W.renderHistory(historyHost, e.redemptions);
      }, function (err) {
        var msg = err && err.status === 404 ? 'Games and redemption history are not available yet.' : API.friendlyError(err);
        [gamesHost, historyHost].forEach(function (x) {
          x.textContent = '';
          x.classList.add('rd');
          var p = h('p', 'rd-empty'); p.textContent = msg; x.appendChild(p);
        });
      });
    }
    W.mountForm(formHost, { compact: true, onRedeemed: function () { load(); } });
    [gamesHost, historyHost].forEach(function (x) {
      x.classList.add('rd');
      var p = h('p', 'rd-empty'); p.textContent = 'Loading…'; x.appendChild(p);
    });
    load();
  }

  root.AccountOverview = { mount: mount };
})(window);
