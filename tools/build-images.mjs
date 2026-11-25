// Downloads one photograph per place (its Wikipedia lead image, almost always from Wikimedia Commons) into img/places/,
// and writes data/images.js with author/licence credits. Runs in CI so photos load instantly and work offline.
import fs from 'node:fs'; import vm from 'node:vm';
const UA = { 'User-Agent': 'JustOneMoreLord/1.0 (https://titantechnogies-afk.github.io/bible-places-today/; Bible places education app)' };
const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync('data/places.js', 'utf8'), ctx);
const P = ctx.window.BPT_PLACES || [];
const api = async (q) => { for (let t = 0; t < 3; t++) { try { const r = await fetch('https://en.wikipedia.org/w/api.php?format=json&formatversion=2&' + q, { headers: UA }); if (r.ok) return r.json(); console.log('API status', r.status); } catch (e) { console.log('API error', e.message); } await new Promise(r => setTimeout(r, 1500)); } return null; };
const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
fs.mkdirSync('img/places', { recursive: true }); const out = {}; let ok = 0;
for (let i = 0; i < P.length; i += 40) {
  const chunk = P.slice(i, i + 40); const titles = chunk.map(p => p.wiki || p.n);
  const j = await api('action=query&redirects=1&prop=pageimages&piprop=name&titles=' + encodeURIComponent(titles.join('|')));
  if (!j) continue; const map = Object.fromEntries(titles.map(t => [t, t]));
  for (const n of j.query?.normalized || []) for (const k in map) if (map[k] === n.from) map[k] = n.to;
  for (const r of j.query?.redirects || []) for (const k in map) if (map[k] === r.from) map[k] = r.to;
  const pages = Object.fromEntries((j.query?.pages || []).map(p => [p.title, p]));
  const fileOf = {}; chunk.forEach((p, k) => { const pg = pages[map[titles[k]]]; if (pg?.pageimage) fileOf[p.id] = pg.pageimage; });
  const files = [...new Set(Object.values(fileOf))]; if (!files.length) continue;
  const ii = await api('action=query&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=800&titles=' + encodeURIComponent(files.map(f => 'File:' + f).join('|')));
  const info = {}; for (const pg of ii?.query?.pages || []) { const x = pg.imageinfo?.[0]; if (x) info[pg.title.replace(/^File:/, '').replace(/ /g, '_')] = x; }
  for (const [id, f] of Object.entries(fileOf)) {
    const x = info[f.replace(/ /g, '_')] || info[f]; if (!x || !/image\/(jpeg|png|webp)/.test(x.mime || '')) continue;
    const m = x.extmetadata || {}; const lic = strip(m.LicenseShortName?.value); if (/fair use|non-free/i.test(lic)) continue;
    try { const r = await fetch(x.thumburl || x.url, { headers: UA }); if (!r.ok) { console.log('img', id, r.status); continue; }
      const buf = Buffer.from(await r.arrayBuffer()); const ext = /png/.test(x.mime) ? 'png' : 'jpg'; fs.writeFileSync(`img/places/${id}.${ext}`, buf);
      out[id] = { f: `img/places/${id}.${ext}`, a: strip(m.Artist?.value).slice(0, 100), l: lic, lu: m.LicenseUrl?.value || '', u: x.descriptionurl || '' }; ok++; } catch (e) { console.log('img', id, e.message); }
  }
}
fs.writeFileSync('data/images.js', 'window.JOM_IMAGES = ' + JSON.stringify(out) + ';\n');
console.log(`Place photos: ${ok} of ${P.length} saved`);
