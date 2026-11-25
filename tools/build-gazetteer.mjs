// Builds data/gazetteer.json — a compact index of every place named in the Bible — from the
// OpenBible.info Bible Geocoding Data (CC BY 4.0): https://github.com/openbibleinfo/Bible-Geocoding-Data
// Usage: node tools/build-gazetteer.mjs        (Node 18+; runs automatically in the GitHub Pages workflow)
// If this step fails, the site still works: it falls back to loading the index in the browser on request.
import { writeFile } from 'node:fs/promises';

const SOURCES = [
  'https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/data/ancient.jsonl',
  'https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/ancient.jsonl',
];
const OSIS = {Gen:'Genesis',Exod:'Exodus',Lev:'Leviticus',Num:'Numbers',Deut:'Deuteronomy',Josh:'Joshua',Judg:'Judges',Ruth:'Ruth','1Sam':'1 Samuel','2Sam':'2 Samuel','1Kgs':'1 Kings','2Kgs':'2 Kings','1Chr':'1 Chronicles','2Chr':'2 Chronicles',Ezra:'Ezra',Neh:'Nehemiah',Esth:'Esther',Job:'Job',Ps:'Psalm',Prov:'Proverbs',Eccl:'Ecclesiastes',Song:'Song of Solomon',Isa:'Isaiah',Jer:'Jeremiah',Lam:'Lamentations',Ezek:'Ezekiel',Dan:'Daniel',Hos:'Hosea',Joel:'Joel',Amos:'Amos',Obad:'Obadiah',Jonah:'Jonah',Mic:'Micah',Nah:'Nahum',Hab:'Habakkuk',Zeph:'Zephaniah',Hag:'Haggai',Zech:'Zechariah',Mal:'Malachi',Matt:'Matthew',Mark:'Mark',Luke:'Luke',John:'John',Acts:'Acts',Rom:'Romans','1Cor':'1 Corinthians','2Cor':'2 Corinthians',Gal:'Galatians',Eph:'Ephesians',Phil:'Philippians',Col:'Colossians','1Thess':'1 Thessalonians','2Thess':'2 Thessalonians','1Tim':'1 Timothy','2Tim':'2 Timothy',Titus:'Titus',Phlm:'Philemon',Heb:'Hebrews',Jas:'James','1Pet':'1 Peter','2Pet':'2 Peter','1John':'1 John','2John':'2 John','3John':'3 John',Jude:'Jude',Rev:'Revelation'};
const osisToRef = o => { const [b, c, v] = String(o).split('.'); return `${OSIS[b] || b} ${c}:${v}`; };
const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function slim(r) {
  const id = r.id, n = r.friendly_id || r.name; if (!id || !n) return null;
  const ident = (r.identifications || [])[0] || {};
  const res = (r.resolutions || ident.resolutions || [])[0] || {};
  let ll = null; const s = res.lonlat || ident.lonlat;
  if (typeof s === 'string' && s.includes(',')) { const [lo, la] = s.split(',').map(Number); if (isFinite(la) && isFinite(lo)) ll = [+la.toFixed(5), +lo.toFixed(5)]; }
  const v = (r.verses || []).map(x => x.readable || (x.osis ? osisToRef(x.osis) : null)).filter(Boolean);
  const ld = r.linked_data || {};
  return { i: id, n: String(n).replace(/\s+\d+$/, ''), f: n, a: Object.keys(r.translation_name_counts || {}).filter(a => a !== n).slice(0, 6), t: r.type || '', ll,
    v: v.slice(0, 200), vc: v.length, ids: (r.identifications || []).length, d: strip(res.description || ident.description).slice(0, 200),
    wd: ld.wikidata?.id, wp: ld.wikipedia?.url || ld.wikipedia_article?.url || ld.wikipedia?.id };
}

for (const url of SOURCES) {
  try {
    console.log('Fetching', url);
    const r = await fetch(url);
    if (!r.ok) { console.log('  HTTP', r.status); continue; }
    const text = await r.text();
    if (text.startsWith('version https://git-lfs')) { console.log('  Git LFS pointer, skipping'); continue; }
    const out = [];
    for (const line of text.split('\n')) { const l = line.trim(); if (!l.startsWith('{')) continue; try { const s = slim(JSON.parse(l)); if (s) out.push(s); } catch {} }
    if (out.length < 50) { console.log('  too few records:', out.length); continue; }
    await writeFile(new URL('../data/gazetteer.json', import.meta.url), JSON.stringify(out));
    console.log(`Wrote data/gazetteer.json with ${out.length} places (${out.filter(x => x.ll).length} with coordinates).`);
    process.exit(0);
  } catch (e) { console.log('  failed:', e.message); }
}
console.log('Gazetteer could not be built; the site will load it on demand instead.');
