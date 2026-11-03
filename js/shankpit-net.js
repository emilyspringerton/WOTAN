// WOTAN's client for the internet-of-SHANKPIT shim. EVERY path and every derived number the Citizens
// page shows lives in THIS file (same house rule as redeem-api.js / identity-api.js), so the page and
// scripts/shankpit-net-test.js can never drift apart.
//
// The feed is served by SHANKPIT's own tools/shankpit_netd.c -- the citizens' DEADWEIGHT ladder as the
// SHANKPIT process publishes it (SHANKPIT/packages/simulation/dw_net.c, schema 2). It is a READ-ONLY
// view of one world; identities and real match history stay in IDUNA.
//
//   GET /api/v1/shankpit-net/deadweight -> {schema, generated_ms, population, meta, records[],
//                                           challenges[], results[], recent[]}
//
// Schema 3 added `stage` -- the world's own tournament bracket (`"stage":null` when nobody is running
// one), which is what makes an esports stage publishable at all: this page can only read the file the
// game writes. Schema 2 added `rating` (the ladder's own field, from PARENA/stdlib/deadweight/rating.prn). The
// export deliberately does NOT ship a pre-sorted ranking: the order is (rating desc, wins desc, pid
// asc) and it is computed here, once, so two pages can never disagree about who is first.
//   GET /api/v1/shankpit-net/health     -> {ok, snapshot, snapshot_bytes, snapshot_age_ms, schema}
//   Errors: {error:<prose>}  -- the daemon's own sentence, which friendlyError passes through.
(function (root) {
  'use strict';

  var PREFIX = '/api/v1/shankpit-net';
  var SNAPSHOT = PREFIX + '/deadweight';
  var HEALTH = PREFIX + '/health';
  var KINDS = ['OFFENSE', 'OPERATIONS', 'DEFENSE'];
  var CHALLENGE_KINDS = { 1: 'citizen-vs-citizen', 2: 'citizen-vs-player', 3: 'player-vs-citizen', 4: 'player-vs-player' };

  // window.SHANKPIT_NET_BASE lets the page point at a daemon on another origin while developing; in
  // production the path is same-origin and nginx proxies it.
  function base() {
    try { return String(root.SHANKPIT_NET_BASE || '').replace(/\/+$/, ''); } catch (e) { return ''; }
  }
  function url(path) { return base() + path; }

  async function request(path) {
    var res, text = '', data = null;
    try { res = await root.fetch(url(path), { headers: { 'Accept': 'application/json' }, cache: 'no-store' }); }
    catch (e) { var ne = new Error('network'); ne.status = 0; ne.code = 'network'; throw ne; }
    try { text = await res.text(); } catch (e) { text = ''; }
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if (!res.ok) {
      var err = new Error(data && data.error ? String(data.error) : 'HTTP ' + res.status);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    if (!data) { var be = new Error('the feed answered something that is not JSON'); be.status = res.status; be.code = 'not_json'; throw be; }
    return data;
  }

  // ---------- derived numbers ----------

  function num(v, fallback) { var n = Number(v); return isFinite(n) ? n : (fallback === undefined ? 0 : fallback); }

  // permille -> '66.6%'. A win rate of exactly 500 with no games is not a 50% player, it is an unknown
  // one, and the page says so instead of inventing a record (see describe()'s `unknown` flag).
  function pct(permille) {
    var p = num(permille);
    if (p < 0) p = 0;
    if (p > 1000) p = 1000;
    return (p / 10).toFixed(p % 10 === 0 ? 0 : 1) + '%';
  }

  function nameOf(rec) {
    rec = rec || {};
    if (rec.name) return String(rec.name);
    if (rec.player) return 'player ' + num(rec.pid);
    return 'citizen ' + num(rec.pid);
  }

  // The sixteen cards as a kind mix -- what a citizen actually BUILT, which is the visible half of
  // "citizens craft their own decks based on their win rate and the current meta".
  function deckMix(deck) {
    var out = { offense: 0, operations: 0, defense: 0, total: 0 };
    if (!Array.isArray(deck)) return out;
    for (var i = 0; i < deck.length; i++) {
      var id = num(deck[i], -1);
      if (id < 0) continue;
      // the catalogue's base line decides kind by id here; anything past it is counted, not guessed
      var kind = id < 3 ? 0 : (id < 6 ? 1 : (id < 9 ? 2 : -1));
      if (kind === 0) out.offense++;
      else if (kind === 1) out.operations++;
      else if (kind === 2) out.defense++;
      out.total++;
    }
    return out;
  }

  function timeAgo(ms, now) {
    var t = num(ms, 0);
    var n = num(now, Date.now());
    if (!t) return '';
    var d = Math.max(0, n - t);
    if (d < 1500) return 'just now';
    if (d < 60000) return Math.round(d / 1000) + 's ago';
    if (d < 3600000) return Math.round(d / 60000) + 'm ago';
    return Math.round(d / 3600000) + 'h ago';
  }

  // One finished match in words. `who(pid)` resolves a pid to a display name (the page passes the
  // record lookup, so a name never has to be duplicated into the ticker).
  function resultLine(m, who) {
    m = m || {};
    var f = typeof who === 'function' ? who : function (pid) { return 'pid ' + num(pid); };
    var a = f(m.pid0), b = f(m.pid1);
    var hull = num(m.hull0) + '\u2013' + num(m.hull1);
    var rounds = num(m.rounds) + (num(m.rounds) === 1 ? ' round' : ' rounds');
    if (num(m.winner) === 2) return a + ' and ' + b + ' drew in ' + rounds + ' (' + hull + ')';
    var w = num(m.winner) === 0 ? a : b, l = num(m.winner) === 0 ? b : a;
    return w + ' beat ' + l + ' in ' + rounds + ' (' + hull + ')';
  }

  function kindName(id) { return KINDS[num(id)] || 'NONE'; }
  function challengeKind(m) {
    if (typeof m === 'string') return m;
    return CHALLENGE_KINDS[num(m && m.kind_id)] || String((m && m.kind) || 'none');
  }

  // ---------- the snapshot, normalised ----------

  // describe(raw, now) -> a plain object the page can render without a single defensive check of its
  // own. Throws on a feed that is not this schema, because rendering an unknown shape as zeros is how
  // a broken deploy looks like an empty world.
  function describe(raw, now) {
    if (!raw || typeof raw !== 'object') throw new Error('empty snapshot');
    if (num(raw.schema, -1) !== 3) throw new Error('unknown snapshot schema ' + raw.schema);
    var at = num(now, Date.now());
    var records = Array.isArray(raw.records) ? raw.records.map(function (r) {
      var games = num(r.games), wins = num(r.wins);
      return {
        pid: num(r.pid, -1),
        name: nameOf(r),
        player: !!r.player,
        hero: !!r.hero,
        path: String(r.path || 'IDLE'),
        wins: wins,
        games: games,
        winratePermille: num(r.winrate_permille, 500),
        rating: num(r.rating, 0),
        unknownRating: !(num(r.rating) > 0),
        unknownRecord: games === 0,
        aggression: num(r.aggression),
        deck: Array.isArray(r.deck) ? r.deck.slice() : [],
        mix: deckMix(r.deck)
      };
    }) : [];
    // THE LADDER'S ORDER, and the same tie-break NOOBTOPIA's own board uses (rating, then wins, then
    // pid): the number a player climbs comes first, so a page and the game never rank the same
    // population differently.
    records.sort(function (a, b) {
      if (b.rating !== a.rating) return b.rating - a.rating;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.pid - b.pid;
    });

    var challenges = Array.isArray(raw.challenges) ? raw.challenges.map(function (c) {
      return {
        id: num(c.id), fromPid: num(c.from_pid), toPid: num(c.to_pid),
        kind: challengeKind(c), kindId: num(c.kind_id),
        expiresInMs: Math.max(0, num(c.expires_in_ms))
      };
    }) : [];

    var results = Array.isArray(raw.results) ? raw.results.map(function (r) {
      return { kind: challengeKind(r), kindId: num(r.kind_id), matches: num(r.matches) };
    }) : [];

    var recent = Array.isArray(raw.recent) ? raw.recent.map(function (m) {
      return {
        kind: challengeKind(m), pid0: num(m.pid0), pid1: num(m.pid1), winner: num(m.winner),
        rounds: num(m.rounds), hull0: num(m.hull0), hull1: num(m.hull1), ms: num(m.ms),
        ago: timeAgo(m.ms, at)
      };
    }) : [];

    // THE STAGE: the world's bracket, or null. A page that invents an "empty" stage instead of showing
    // nothing is a page that cannot tell a quiet night from a server that stopped publishing.
    var stage = null;
    if (raw.stage && typeof raw.stage === 'object') {
      stage = {
        name: String(raw.stage.name || 'THE PIT'),
        round: num(raw.stage.round),
        rounds: num(raw.stage.rounds),
        roundName: String(raw.stage.round_name || ''),
        entrants: num(raw.stage.entrants),
        byes: num(raw.stage.byes),
        over: !!raw.stage.over,
        champion: num(raw.stage.champion, -1),
        match: (raw.stage.match && typeof raw.stage.match === 'object')
          ? { aPid: num(raw.stage.match.a_pid), bPid: num(raw.stage.match.b_pid) }
          : null,
        results: Array.isArray(raw.stage.results) ? raw.stage.results.map(function (r) {
          return {
            round: num(r.round), aPid: num(r.a_pid), bPid: num(r.b_pid),
            winnerPid: num(r.winner_pid, -1), played: !!r.played
          };
        }) : []
      };
    }

    var metaRaw = raw.meta || {};
    var meta = {
      kind: num(metaRaw.kind, -1),
      kindName: String(metaRaw.kind_name || kindName(metaRaw.kind)),
      sharePermille: num(metaRaw.share_permille),
      plays: num(metaRaw.plays),
      kinds: Array.isArray(metaRaw.kinds) ? metaRaw.kinds.map(function (x) { return num(x); }) : [0, 0, 0]
    };

    var winners = records.reduce(function (n, r) { return n + r.wins; }, 0);
    var played = records.reduce(function (n, r) { return n + r.games; }, 0);
    var byPid = {};
    records.forEach(function (r) { byPid[r.pid] = r.name; });

    return {
      schema: 3,
      generatedMs: num(raw.generated_ms),
      population: {
        citizens: num((raw.population || {}).citizens),
        players: num((raw.population || {}).players)
      },
      meta: meta,
      stage: stage,
      records: records,
      challenges: challenges,
      results: results,
      recent: recent,
      totals: { wins: winners, games: played, matches: Math.round(played / 2) },
      nameFor: function (pid) { return byPid[pid] || (pid === 0 ? 'you' : 'pid ' + pid); },
      // a population with nobody in it yet is a normal state, not an error
      empty: records.length === 0
    };
  }

  // Words for a failed read. The daemon's 404 for a missing snapshot already explains itself, so it is
  // passed through rather than replaced by a generic line.
  function friendlyError(err) {
    err = err || {};
    if (err.status === 0 || err.code === 'network') return 'Could not reach the SHANKPIT shim. Is shankpit_netd running?';
    if (err.code === 'not_json') return 'The SHANKPIT shim answered something that is not JSON.';
    if (err.status === 404) return err.message && err.message !== 'HTTP 404' ? err.message : 'No world is publishing a ladder here yet.';
    if (err.status === 502 || err.status === 503) return 'The SHANKPIT shim is not up (nginx could not reach shankpit_netd).';
    return err.message || 'Something went wrong (' + (err.status || '?') + ').';
  }

  var ShankpitNet = {
    SNAPSHOT: SNAPSHOT,
    HEALTH: HEALTH,
    base: base,
    url: url,
    getSnapshot: function () { return request(SNAPSHOT).then(function (raw) { return describe(raw, Date.now()); }); },
    getHealth: function () { return request(HEALTH); },
    describe: describe,
    pct: pct,
    nameOf: nameOf,
    deckMix: deckMix,
    timeAgo: timeAgo,
    resultLine: resultLine,
    kindName: kindName,
    challengeKind: challengeKind,
    friendlyError: friendlyError,
    _request: request
  };

  root.ShankpitNet = ShankpitNet;
  if (typeof module !== 'undefined' && module.exports) module.exports = ShankpitNet;
})(typeof window !== 'undefined' ? window : globalThis);
