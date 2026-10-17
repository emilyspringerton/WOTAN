// Builds data/empire-cards.json for the EMPIRE pages (cards, AIs, factions) from the REAL module and its PARENA sources, so the pages show the numbers the game
// uses and cannot drift from it. The numbers come from empire.wasm's own exports; the words come from the case tables in em_view.prn / em_ai.prn.
//   node scripts/empire-cards.mjs <empire.wasm> <PARENA stdlib/empire/web dir> <out.json>
import fs from 'node:fs';
const [wasmPath, srcDir, outPath] = process.argv.slice(2);
if (!wasmPath || !srcDir || !outPath) { console.error('usage: empire-cards.mjs <empire.wasm> <PARENA stdlib/empire/web> <out.json>'); process.exit(2); }
const x = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(wasmPath)), {}).exports;
x.em_init();
const src = fs.readFileSync(`${srcDir}/em_view.prn`, 'utf8') + '\n' + fs.readFileSync(`${srcDir}/em_ai.prn`, 'utf8');
// (defn name [...] : String (case v  0 "a" 1 "b" ... "default")) -> ["a","b",...,"default"] indexed by the numbers
function table(name) {
  const i = src.indexOf(`(defn ${name} `);
  if (i < 0) throw new Error('no ' + name);
  const j = src.indexOf('\n(defn ', i + 1);
  const body = src.slice(i, j < 0 ? undefined : j);
  const out = {}; let def = '';
  const re = /(?:(\d+)\s+)?"((?:[^"\\]|\\.)*)"/g; let m;
  const caseAt = body.indexOf('(case ');
  const text = body.slice(caseAt);
  while ((m = re.exec(text))) { if (m[1] !== undefined) out[+m[1]] = m[2]; else def = m[2]; }
  return { map: out, def };
}
const short = table('card-short'), full = table('card-name'), hero = table('card-hero'), desc = table('card-desc');
const bname = table('bot-name'), blurb = table('bot-blurb');
const fname = table('fac-name'), fblurb = table('fac-blurb'), fshort = table('fac-short');
const get = (t, k) => (t.map[k] !== undefined ? t.map[k] : t.def);
const cards = [];
for (let c = 0; c < 16; c++) {
  const f = (k) => x.em_card(c, k);
  cards.push({ id: c, name: get(full, c), short: get(short, c), hero: get(hero, c), desc: get(desc, c),
    spell: f(0) === 1, cost: f(1), count: f(2), hp: f(3), dmg: f(4), period: f(5), range: f(6), speed: f(7), sight: f(8), fx: f(9), mag: f(10), body: f(11),
    deploy: f(12), mythic: f(13) === 1, aoe: f(14), base: f(15) });
}
const factions = [0, 1, 2].map((id) => ({ id, name: get(fname, id), blurb: get(fblurb, id), detail: get(fshort, id),
  start: x.em_fac(id, 0), quiet: x.em_fac(id, 1), spend: x.em_fac(id, 2), pump: x.em_fac(id, 3), hp: x.em_fac(id, 4), dmg: x.em_fac(id, 5) }));
const bots = [];
for (let n = 1; n <= 8; n++) {
  const d = x.em_bot_deck(n) >>> 0;
  bots.push({ n, name: get(bname, n), blurb: get(blurb, n), faction: x.em_bot_faction(n), deck: Array.from({ length: 8 }, (_, k) => (d >>> (4 * k)) & 15) });
}
const g = (k) => x.em_geometry(k);
const geometry = { tile: g(0), width: g(1), height: g(2), regular: g(3), overtime: g(4), tps: g(5), princess_hp: g(6), king_hp: g(7), princess_dmg: g(8), king_dmg: g(9), elixir_start: g(10) };
for (const c of cards) if (!c.name || c.name === '?' || !c.hero || !c.desc) throw new Error('card ' + c.id + ' is missing words');
const out = { version: x.em_version() >>> 0, geometry, cards, factions, bots };
fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${outPath}: ${cards.length} cards, ${bots.length} AIs, sim version ${out.version}`);
