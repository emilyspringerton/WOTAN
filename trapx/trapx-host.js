// trapx/trapx-host.js -- the page. DOM, keyboard and the two arena surfaces; the city is trapx-city.js.
//
// Every number on screen comes from trapx-rules.js (generated from PARENA) through trapx-city.js (tested under Node
// by scripts/trapx-rules-test.mjs against the same fixture SHANKPIT's C asserts). This file decides nothing: it
// reads the city, writes text, and forwards button presses.
//
// This JS is hand-written, and that is the one place this page breaks WOTAN's "generated host" convention. Stated
// plainly rather than hidden: shankpit-460's and Bedrock Racers' hosts are PARENA -> TypeScript because their
// logic IS the game; here the game logic is the wasm-free rules module and this is a control panel. If the panel
// ever grows rules of its own, it becomes a .prn like everything else.
//
// The city comes from trapx-engine.js: trapx.wasm (the PARENA-built module at /trapx/trapx.wasm) when it loads,
// trapx-city.js when it does not. Both answer the same calls, so nothing below knows the difference.
import C from './trapx-engine.js';
import * as R from './trapx-rules.js';

const $ = (id) => document.getElementById(id);
const SCENE_NAME = { 200: 'Detroit Apartment', 201: 'Detroit School' };
const DISTRICT_NAME = ['Residential', 'Custody', 'Unknown'];

const city = C.initCity(C.APARTMENT);
let quiet = 0;
let running = false;
let timer = 0;

// ---- identity ----------------------------------------------------------------------------------------
// WOTAN's shared SSO session (js/iduna-sso.js). The city uses the player id as the citizen id, so two people in
// one browser are two citizens -- and nobody is asked to make an account to watch the city tick.
let citizen = 'guest';
function readIdentity() {
  let session = null;
  try { if (typeof handleIdunaSsoReturn === 'function') session = handleIdunaSsoReturn(); } catch (e) { session = null; }
  if (!session) {
    try { session = typeof getIdunaSession === 'function' ? getIdunaSession() : null; } catch (e) { session = null; }
  }
  if (session && session.playerID) {
    citizen = String(session.playerID);
    $('tp-who').textContent = (session.displayName || 'citizen') + ' · citizen ' + citizen;
    $('tp-signin').hidden = true;
  } else {
    $('tp-who').textContent = 'watching as a guest';
    $('tp-signin').hidden = false;
  }
  $('tp-citizen').textContent = citizen;
}

// ---- text ---------------------------------------------------------------------------------------------
function bar(value, max, width) {
  const n = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '█'.repeat(n) + '·'.repeat(width - n);
}

function render() {
  const d = C.here(city);
  const district = d ? DISTRICT_NAME[R.trapxSceneDistrict(d.scene)] : 'Unknown';
  $('tp-scene').textContent = (SCENE_NAME[city.scene] || 'unknown scene') + ' · ' + district;
  $('tp-tick').textContent = String(city.tick);
  $('tp-flow').textContent = String(city.flow);
  $('tp-receipts').textContent = String(city.receipts);
  $('tp-ledger').textContent = String(city.ledger);
  if (!d) return;

  $('tp-alert').textContent = bar(d.alertness, 100, 20) + ' ' + d.alertness + '/100';
  $('tp-heat').textContent = bar(d.heat, 100, 20) + ' ' + d.heat + '/100';
  $('tp-trust').textContent = (d.trust >= 0 ? '+' : '') + d.trust;
  $('tp-enforce').textContent = 'level ' + d.enforcement + (R.trapxMediaPress(d.enforcement, d.alertness) ? ' · MEDIA ON' : '');
  $('tp-fos').textContent = d.fos_held + ' / ' + d.fos_total + ' held';
  $('tp-integrity').textContent = d.integrity + '/100' + (d.rogue ? ' · ROGUE SWARM' : '');
  $('tp-attention').textContent = d.attention + '/100';
  $('tp-pressure').textContent = d.pressure + '/100';
  $('tp-k9').textContent = d.k9 + (d.k9 ? ' units · worth ' + R.trapxK9Worth(d.k9) : ' units · none out');
  $('tp-quiet').textContent = quiet ? 'ON' : 'OFF';

  const next = R.trapxClaimCost(city.scene, d.fos_held);
  $('tp-nextcost').textContent = d.fos_held >= d.fos_total ? 'full' : next + ' Flow';

  // the spend of the last press, in plain words
  $('tp-status').textContent = city.status || 'The city is running. Nothing here is required.';
}

function refresh() {
  render();
  renderFeed();
  renderMods();
}

function renderFeed() {
  const feed = $('tp-feed');
  feed.textContent = '';
  const seen = city.events.slice(0, 12);
  if (!seen.length) {
    const li = document.createElement('li');
    li.textContent = 'no receipts yet — claim an office';
    feed.appendChild(li);
    return;
  }
  for (const ev of seen) {
    const li = document.createElement('li');
    const name = C.EV_NAMES[ev.kind] || 'event';
    li.className = ev.kind === C.EV.RECEIPT ? 'tp-receipt' : '';
    li.textContent = `t${String(ev.tick).padStart(3, '0')} ${name.padEnd(7, ' ')} ` +
      `${SCENE_NAME[ev.scene] ? SCENE_NAME[ev.scene].replace('Detroit ', '') : ev.scene} ${ev.a}/${ev.b}`;
    feed.appendChild(li);
  }
}

function renderMods() {
  const list = $('tp-mods');
  list.textContent = '';
  city.mods.forEach((m) => {
    const li = document.createElement('li');
    const kinds = C.EV_NAMES.filter((_, i) => (m.mask >> i) & 1).join(', ');
    li.textContent = `${m.name} · p${m.priority} · ${kinds}${m.enabled ? '' : ' · disabled'}`;
    list.appendChild(li);
  });
}

// ---- verbs ---------------------------------------------------------------------------------------------
const REASONS = {
  [C.ERR_SCENE]: 'that scene does not exist in VS0',
  [C.ERR_NOT_HERE]: 'you have to be there',
  [C.ERR_FULL]: 'every office here is already yours',
  [C.ERR_POOR]: 'not enough Flow',
  [C.ERR_NONE_HELD]: 'you hold nothing here to contest',
  [C.ERR_NO_PORTAL]: 'no portal that way',
  [C.ERR_ARG]: 'out of range',
};

function say(text) {
  city.status = text;
  render();
}

function act(label, fn) {
  const code = fn();
  if (code === C.OK) say(label + ' — it happened.');
  else say(label + ' refused: ' + (REASONS[code] || 'error ' + code));
  refresh();
}

$('tp-claim').addEventListener('click', () => act('Claim', () => C.claim(city, city.scene)));
$('tp-contest').addEventListener('click', () => act('Contest', () => C.contest(city, city.scene)));
$('tp-k9').addEventListener('click', () => act('K9 deployment', () => C.deployK9(city, city.scene, 2)));
$('tp-kill').addEventListener('click', () => act('Killing in public (3 witnesses)', () => C.publicKill(city, city.scene, 3)));
$('tp-portal').addEventListener('click', () => {
  const target = R.trapxPortalTarget(city.scene);
  act('Portal to ' + (SCENE_NAME[target] || target), () => C.portal(city, target));
});
$('tp-tick').addEventListener('click', () => { C.tick(city, quiet); refresh(); });
$('tp-quiet').addEventListener('click', () => { quiet = quiet ? 0 : 1; refresh(); });

// TAKE CONTROL: the Channel 11 entry. It starts the city's clock; there is no loading screen because there is
// nothing to load -- the whole simulation is a few hundred integer decisions.
$('tp-start').addEventListener('click', () => {
  running = !running;
  if (running) {
    timer = setInterval(() => { C.tick(city, quiet); refresh(); }, 700);
    $('tp-start').textContent = 'Stop the city';
    say('Channel 11: you are in the city. It was already running.');
  } else {
    clearInterval(timer);
    $('tp-start').textContent = 'Take control';
    say('The city keeps running without you — that is the design.');
  }
  refresh();
});

// ---- the two surfaces ------------------------------------------------------------------------------------
// SHANKPIT 460 and Bedrock Racers are separate, committed wasm modules: each is a whole game with its own memory
// and zero imports. "Combining" them means one shell and one identity, not merging two binaries -- there is no
// shared ABI to merge, and pretending otherwise would be the fake this repo does not ship.
const SURFACES = {
  street: { url: '/shankpit-460/', what: 'shankpit-460: the FPS client, on the street' },
  wheels: { url: '/bedrockracers/', what: 'Bedrock Racers: the driving surface' },
};
function surface(which) {
  const pick = SURFACES[which];
  if (!pick) return;
  const frame = $('tp-frame');
  if (frame.getAttribute('src') !== pick.url) frame.setAttribute('src', pick.url);
  $('tp-surface-what').textContent = pick.what;
  for (const btn of document.querySelectorAll('[data-surface]')) {
    btn.setAttribute('aria-pressed', btn.dataset.surface === which ? 'true' : 'false');
  }
}
for (const btn of document.querySelectorAll('[data-surface]')) {
  btn.addEventListener('click', () => surface(btn.dataset.surface));
}

readIdentity();
refresh();
surface('street');
