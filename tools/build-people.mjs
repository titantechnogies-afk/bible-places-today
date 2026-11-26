// Builds the "People of the Bible" data from Theographic Bible Metadata (CC BY-SA 4.0, github.com/robertrouse/theographic-bible-metadata)
// plus Easton's Bible Dictionary (1897, public domain, included in that dataset).
// Usage: node tools/build-people.mjs /path/to/theographic-bible-metadata   → data/people/index.json and data/people/<letter>.json
import fs from 'node:fs';
const dir = (process.argv[2] || '/tmp/theo') + '/json';
const J = f => JSON.parse(fs.readFileSync(`${dir}/${f}.json`, 'utf8')).map(r => ({ id: r.id, ...r.fields }));
const people = J('people'), places = J('places'), events = J('events'), groups = J('peopleGroups'), books = J('books'), chapters = J('chapters');
const defs = J('definitions'), verses = J('verses');
const arr = v => Array.isArray(v) ? v : typeof v === 'string' && v.startsWith('[') ? (() => { try { return JSON.parse(v.replace(/'/g, '"')); } catch { return []; } })() : v ? [v] : [];
const P = Object.fromEntries(people.map(p => [p.id, p])), PL = Object.fromEntries(places.map(p => [p.id, p])), EV = Object.fromEntries(events.map(e => [e.id, e]));
const BK = Object.fromEntries(books.map(b => [b.osisName, b.bookName])), BKID = Object.fromEntries(books.map(b => [b.id, b.bookName])), CH = Object.fromEntries(chapters.map(c => [c.id, c]));
const V = Object.fromEntries(verses.map(v => [v.id, v]));
const ORD = Object.fromEntries(books.map(b => [b.osisName, +b.bookOrder || 0]));
const vkey = o => { const [b, c, v] = String(o || '').split('.'); return (ORD[b] || 99) * 1e6 + (+c || 0) * 1e3 + (+v || 0); };
const refOf = osis => { const m = String(osis || '').match(/^(\w+)\.(\d+)\.(\d+)$/); return m ? `${BK[m[1]] || m[1]} ${m[2]}:${m[3]}` : osis; };
const defBy = {}; for (const d of defs) for (const pid of arr(d.person)) if (!defBy[pid]) defBy[pid] = d.text;
const groupsOf = {}; for (const g of groups) for (const m of arr(g.members)) (groupsOf[m] ||= []).push(g.groupName);
const clean = s => String(Array.isArray(s) ? s[0] : s || '').replace(/^\[?['"]=?/, '').replace(/['"]\]?$/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\\n/g, '\n').replace(/\s+\(\s+/g, ' (').replace(/\s+\)/g, ')').replace(/[ \t]+/g, ' ').trim();
const yr = v => v == null || v === '' ? null : +v;
const mini = id => { const p = P[id]; return p ? [p.slug, p.name] : null; };
const plMini = id => { const p = PL[id]; return p ? { n: p.displayTitle || p.kjvName, lat: +p.latitude || null, lon: +p.longitude || null } : null; };
const index = [], shards = {};
for (const p of people) {
  const vs = arr(p.verses).map(id => V[id]).filter(Boolean).sort((a, b) => vkey(a.osisRef) - vkey(b.osisRef));
  const plc = {}; for (const v of vs) for (const pid of arr(v.places)) plc[pid] = (plc[pid] || 0) + 1;
  const topPlaces = Object.entries(plc).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([id, c]) => ({ ...plMini(id), c })).filter(x => x.n);
  const bookCount = {}; for (const v of vs) { const b = BK[(v.osisRef || '').split('.')[0]]; if (b) bookCount[b] = (bookCount[b] || 0) + 1; }
  const evs = arr(p.timeline).concat(arr(p.events)).map(id => EV[id]).filter(Boolean);
  const seen = new Set(); const timeline = evs.filter(e => !seen.has(e.id) && seen.add(e.id)).sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0))
    .map(e => ({ t: e.title, y: yr(e.startDate), d: e.duration || '', r: refOf(V[arr(e.verses)[0]]?.osisRef) })).slice(0, 80);
  const written = [...new Set(arr(p.chaptersWritten).map(id => BKID[arr(CH[id]?.book)[0]]).filter(Boolean))];
  const born = yr(p.birthYear), died = yr(p.deathYear);
  const d = { s: p.slug, n: p.name, t: p.displayTitle !== p.name ? p.displayTitle : '', a: p.alsoCalled ? String(p.alsoCalled).split(/\s*,\s*/) : [], g: p.gender || '',
    b: born, x: died, age: born != null && died != null ? died - born : null, bp: arr(p.birthPlace).map(plMini).filter(Boolean)[0] || null, dp: arr(p.deathPlace).map(plMini).filter(Boolean)[0] || null,
    f: arr(p.father).map(mini).filter(Boolean), m: arr(p.mother).map(mini).filter(Boolean), sib: arr(p.siblings).concat(arr(p.halfSiblingsSameFather), arr(p.halfSiblingsSameMother)).map(mini).filter(Boolean),
    sp: arr(p.partners).map(mini).filter(Boolean), ch: arr(p.children).map(mini).filter(Boolean), gr: groupsOf[p.id] || [],
    bio: defBy[p.id] || '', ea: clean(p.dictText || p.dictionaryText).slice(0, 6000), vc: p.verseCount || vs.length,
    v: vs.map(v => v.osisRef), y0: yr(p.minYear), y1: yr(p.maxYear), pl: topPlaces, bk: Object.entries(bookCount).sort((a, b) => b[1] - a[1]).slice(0, 12), tl: timeline, w: written };
  const L = (p.alphaGroup || p.name[0] || 'X').toUpperCase().replace(/[^A-Z]/, 'X');
  (shards[L] ||= {})[p.slug] = d;
  index.push([p.slug, p.name, d.a.join(', '), d.g[0] || '', (d.bio || d.ea).replace(/\s+/g, ' ').slice(0, 110), d.vc, L, d.t, d.b, d.x, d.y1]);
}
fs.mkdirSync('data/people', { recursive: true });
index.sort((a, b) => b[5] - a[5]);
fs.writeFileSync('data/people/index.json', JSON.stringify(index));
for (const [L, m] of Object.entries(shards)) fs.writeFileSync(`data/people/${L}.json`, JSON.stringify(m));
console.log(`People: ${index.length} profiles in ${Object.keys(shards).length} files`);
