// Builds the World English Bible (public domain) for offline reading and search.
// Usage: node tools/build-web.mjs <path-to-TehShrike/world-english-bible>
// Output: data/web/<Code>.<ch>.json  = [[verse, text], ...]
//         data/web/all.json           = [[code, ch, verse, text], ...]   (for search)
import fs from 'node:fs'; import path from 'node:path';
const src = process.argv[2]; if (!src) { console.error('pass the repo path'); process.exit(1); }
const books = JSON.parse(fs.readFileSync('data/concordance/books.json', 'utf8'));
const out = 'data/web'; fs.mkdirSync(out, { recursive: true });
const all = []; let n = 0;
for (const [code, name] of books) {
  const f = path.join(src, 'json', name.toLowerCase().replace(/\s+/g, '') + '.json');
  if (!fs.existsSync(f)) { console.error('missing', f); process.exit(1); }
  const rows = JSON.parse(fs.readFileSync(f, 'utf8')); const ch = new Map();
  for (const r of rows) {
    if (!r.chapterNumber || !r.verseNumber || typeof r.value !== 'string') continue;
    const c = ch.get(r.chapterNumber) || new Map(); ch.set(r.chapterNumber, c);
    c.set(r.verseNumber, ((c.get(r.verseNumber) || '') + ' ' + r.value));
  }
  for (const [c, vs] of ch) {
    const arr = [...vs].sort((a, b) => a[0] - b[0]).map(([v, t]) => [v, t.replace(/\s+/g, ' ').trim()]);
    fs.writeFileSync(path.join(out, `${code}.${c}.json`), JSON.stringify(arr)); n++;
    for (const [v, t] of arr) all.push([code, c, v, t]);
  }
}
fs.writeFileSync(path.join(out, 'all.json'), JSON.stringify(all));
console.log(`WEB: ${n} chapters, ${all.length} verses`);
