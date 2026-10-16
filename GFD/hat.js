// Shows the character's equipped hat on the bust in the page header. Best-effort: signed out, no
// character yet, or no hat equipped all just leave the badge hidden. Hat changes made in the store
// show here on the next load (the game itself picks them up on next entry).
(function () {
  'use strict';
  var box = document.getElementById('gfd-hat'), img = document.getElementById('gfd-hat-img');
  if (!box || typeof getIdunaSession !== 'function') return;
  var s = getIdunaSession();
  if (!s) return;
  function get(path) {
    return fetch('/api/v1' + path, { headers: { Authorization: 'Bearer ' + s.token } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  get('/characters/by-player/' + encodeURIComponent(s.playerID)).then(function (c) {
    return get('/characters/' + encodeURIComponent(c.character_id) + '/hats');
  }).then(function (owned) {
    var list = Array.isArray(owned) ? owned : (owned && (owned.hats || owned.items)) || [];
    var hat = list.filter(function (o) { return o.equipped; })[0];
    if (!hat || !hat.image_url) return;
    img.src = hat.image_url;
    box.title = 'Current Hat: ' + hat.name;
    box.hidden = false;
  }).catch(function () { /* leave hidden */ });
})();
