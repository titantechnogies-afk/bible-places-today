// Builds data/xrefs/<BookCode>.json from the OpenBible.info cross-reference list (CC BY 4.0, ~340,000 links).
// Run in CI: downloads the zip, unzips it, keeps the 12 most-voted links per verse.
// Usage: node tools/build-xrefs.mjs [path/to/cross_references.txt]   (downloads if no path is given)
import fs from 'node:fs'; import { execSync } from 'node:child_process';
const OSIS = ['Gen','Exod','Lev','Num','Deut','Josh','Judg','Ruth','1Sam','2Sam','1Kgs','2Kgs','1Chr','2Chr','Ezra','Neh','Esth','Job','Ps','Prov','Eccl','Song','Isa','Jer','Lam','Ezek','Dan','Hos','Joel','Amos','Obad','Jonah','Mic','Nah','Hab','Zeph','Hag','Zech','Mal','Matt','Mark','Luke','John','Acts','Rom','1Cor','2Cor','Gal','Eph','Phil','Col','1Thess','2Thess','1Tim','2Tim','Titus','Phlm','Heb','Jas','1Pet','2Pet','1John','2John','3John','Jude','Rev'];
const books = JSON.parse(fs.readFileSync('data/concordance/books.json', 'utf8')); // [code, name, counts]
const idx = Object.fromEntries(OSIS.map((o, i) => [o, i]));
let file = process.argv[2];
if (!file) {
  fs.mkdirSync('/tmp/xr', { recursive: true });
  execSync('curl -fsSL -o /tmp/xr/x.zip https://a.openbible.info/data/cross-references.zip && cd /tmp/xr && unzip -o -q x.zip', { stdio: 'inherit' });
  file = fs.readdirSync('/tmp/xr').filter(f => f.endsWith('.txt')).map(f => '/tmp/xr/' + f)[0];
}
const ref = s => { const m = s.match(/^(\w+)\.(\d+)\.(\d+)$/); if (!m || idx[m[1]] == null) return null; return { b: idx[m[1]], c: +m[2], v: +m[3] }; };
const fmt = (a, z) => { const n = books[a.b][1]; if (!z) return `${n} ${a.c}:${a.v}`; if (z.b !== a.b) return `${n} ${a.c}:${a.v}`; return z.c === a.c ? `${n} ${a.c}:${a.v}-${z.v}` : `${n} ${a.c}:${a.v}-${z.c}:${z.v}`; };
const out = books.map(() => ({})); let n = 0;
const chStart = []; { let k = 0; for (const b of books) { chStart.push(k); k += b[2].length; } }
const gi = r => chStart[r.b] + r.c - 1; const pairs = new Map();
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const [from, to, votes] = line.split('\t'); if (!to || !/^\-?\d+$/.test(votes || '')) continue;
  const f = ref(from); const [t1, t2] = to.split('-'); const a = ref(t1), z = t2 ? ref(t2) : null; if (!f || !a || +votes < 0) continue;
  (out[f.b][`${f.c}:${f.v}`] ||= []).push([fmt(a, z), +votes]); n++;
  const x = gi(f), y = gi(a); if (x !== y && +votes > 0) { const key = x < y ? x * 2000 + y : y * 2000 + x; pairs.set(key, (pairs.get(key) || 0) + +votes); }
}
fs.mkdirSync('data/xrefs', { recursive: true }); let kept = 0;
out.forEach((m, i) => { for (const k in m) { m[k] = m[k].sort((x, y) => y[1] - x[1]).slice(0, 12).map(x => x[0]); kept += m[k].length; } fs.writeFileSync(`data/xrefs/${books[i][0]}.json`, JSON.stringify(m)); });
console.log(`Cross-references: read ${n}, kept ${kept} in ${books.length} files`);
// chapter-to-chapter arcs for the cross-reference rainbow: [fromChapter, toChapter, weight] (strongest 7000)
const arcs = [...pairs].sort((p, q) => q[1] - p[1]).slice(0, 7000).map(([k, w]) => [Math.floor(k / 2000), k % 2000, w]);
fs.writeFileSync('data/xrefs/arcs.json', JSON.stringify(arcs)); console.log(`Arcs: ${arcs.length}`);
