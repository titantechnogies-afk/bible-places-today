/* BIBLE PLACES TODAY — application script (no build step, no API keys).
   Live sources: Wikipedia REST + Action API, Wikimedia Commons API, Wikidata Query Service, bible-api.com (World English Bible),
   OpenStreetMap / Esri / OpenTopoMap tiles via Leaflet, optional OpenBible.info gazetteer. Everything degrades to the
   built-in curated dataset when the network is unavailable. */
{
'use strict';
const PLACES = window.BPT_PLACES || [], DISCS = window.BPT_DISCOVERIES || [], JOURNEYS = window.BPT_JOURNEYS || [];
const byId = Object.fromEntries(PLACES.map(p => [p.id, p]));
const discById = Object.fromEntries(DISCS.map(d => [d.id, d]));
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const main = $('#main');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const strip = h => { const d = document.createElement('div'); d.innerHTML = String(h || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ''); return (d.textContent || '').replace(/\s+/g, ' ').trim(); };
const yr = y => y < 0 ? `${-y} BC` : (y < 1000 ? `AD ${y}` : `${y}`);
const km = (a, b) => { const R = 6371, t = Math.PI / 180, dLa = (b.lat - a.lat) * t, dLo = (b.lon - a.lon) * t; const h = Math.sin(dLa/2)**2 + Math.cos(a.lat*t)*Math.cos(b.lat*t)*Math.sin(dLo/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
const wikiLink = t => 'https://en.wikipedia.org/wiki/Special:Search?go=Go&search=' + encodeURIComponent(t);
const gwLink = ref => 'https://www.biblegateway.com/passage/?version=WEB&search=' + encodeURIComponent(ref.replace(/–/g, '-'));
const scholarLink = q => 'https://scholar.google.com/scholar?q=' + encodeURIComponent(q);
const commonsSearchLink = q => 'https://commons.wikimedia.org/w/index.php?search=' + encodeURIComponent(q) + '&title=Special:MediaSearch&type=image';
const STATUS = {
  confirmed:['Confirmed','An authentic find whose mainstream reading is accepted by specialists.'],
  interpretation:['Interpretation','The find is real; linking it to a specific biblical person, place or event is an interpretation many scholars hold.'],
  disputed:['Disputed','Its date, reading or identification is seriously contested among specialists.'],
  speculative:['Speculative','A claim most specialists have not accepted or could not verify.'],
  tradition:['Tradition','The identification rests on early tradition rather than excavated proof.']};
const PREC = {certain:['Location certain','Identified by inscriptions, continuous names or broad consensus.'],probable:['Location probable','Most scholars accept this identification.'],disputed:['Location disputed','Several candidate sites are proposed.'],traditional:['Traditional site','Marked by long tradition; not proven archaeologically.']};
const RELN = {direct:'Directly related',indirect:'Indirectly related',contextual:'Contextual background'};
const CATS = [['all','All places'],['jesus','Jesus'],['paul','Paul'],['ot','Old Testament'],['nt','New Testament'],['israel','Israel\'s history'],['patriarchs','Patriarchs'],['exodus','Exodus'],['mountain','Mountains'],['water','Seas & rivers'],['empire','Empires']];
const KINDLBL = {b:'Biblical account',h:'History & rulers',x:'Excavation',d:'Discovery'};
const state = { live: null, liveP: null, gaz: null, gazP: null, lastQuery: '' };

/* ---------------- storage & fetch ---------------- */
const mem = new Map();
const store = {
  get(k) { try { const v = localStorage.getItem('bpt:' + k); if (!v) return null; const o = JSON.parse(v); if (o.e && o.e < Date.now()) return null; return o.v; } catch { return null; } },
  set(k, v, days = 7) { try { const s = JSON.stringify({ v, e: Date.now() + days * 864e5 }); if (s.length < 300000) localStorage.setItem('bpt:' + k, s); } catch {} }
};
async function getJSON(url, { timeout = 15000, cache = true, days = 7 } = {}) {
  if (mem.has(url)) return mem.get(url);
  const c = cache && store.get(url); if (c) { mem.set(url, c); return c; }
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'Accept': 'application/json' } });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    const j = await r.json(); mem.set(url, j); if (cache) store.set(url, j, days); return j;
  } finally { clearTimeout(t); }
}
function isLive() {
  if (!state.liveP) state.liveP = getJSON('https://en.wikipedia.org/api/rest_v1/page/summary/Jerusalem', { timeout: 7000 })
    .then(() => true, () => false).then(v => { state.live = v; if (!v) showNet(); return v; });
  return state.liveP;
}
function showNet() {
  const n = $('#netnote'); n.hidden = false;
  n.innerHTML = '<span>Live sources (photographs, map tiles, Bible text, Wikidata) could not be reached from this page, so you are seeing the built-in research dataset with a schematic map. Everything works fully when the site is hosted normally.</span> <button class="inl" type="button">Dismiss</button>';
  $('button', n).onclick = () => { n.hidden = true; };
}

/* ---------------- Wikimedia ---------------- */
const WAPI = 'https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*';
const CAPI = 'https://commons.wikimedia.org/w/api.php?format=json&formatversion=2&origin=*';
const META = 'Artist|LicenseShortName|LicenseUrl|ImageDescription|Credit|DateTimeOriginal';
async function wikiSummary(title) {
  if (!(await isLive())) return null;
  try { return await getJSON('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_')) + '?redirect=true'); }
  catch { // resolve by search
    try { const s = await getJSON(WAPI + '&action=query&list=search&srlimit=1&srsearch=' + encodeURIComponent(title));
      const t = s?.query?.search?.[0]?.title; if (t && t !== title) return await getJSON('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(t.replace(/ /g, '_'))); } catch {}
    return null; }
}
function fileFromUrl(u) {
  if (!u || !/upload\.wikimedia\.org\/wikipedia\/commons\//.test(u)) return null; // free Commons files only
  const p = u.split('/'); const i = p.indexOf('thumb'); const f = i > -1 ? p[i + 3] : p[p.length - 1];
  try { return decodeURIComponent(f); } catch { return f; }
}
function imgFromInfo(page) {
  const ii = page?.imageinfo?.[0]; if (!ii) return null; const m = ii.extmetadata || {};
  return { title: page.title, src: ii.thumburl || ii.url, full: ii.url, page: ii.descriptionurl,
    author: strip(m.Artist?.value).slice(0, 120), license: strip(m.LicenseShortName?.value), licenseUrl: m.LicenseUrl?.value || '',
    desc: strip(m.ImageDescription?.value).slice(0, 260), mime: ii.mime || '' };
}
async function commonsInfo(files, width = 900) {
  const out = {}; files = [...new Set(files.filter(Boolean))];
  for (let i = 0; i < files.length; i += 40) {
    const chunk = files.slice(i, i + 40).map(f => 'File:' + f);
    try { const j = await getJSON(CAPI + '&action=query&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=' + width + '&iiextmetadatafilter=' + META + '&titles=' + encodeURIComponent(chunk.join('|')));
      for (const p of j?.query?.pages || []) { const im = imgFromInfo(p); if (im) out[p.title.replace(/^File:/, '').replace(/_/g, ' ')] = im; } } catch {}
  }
  return out;
}
const BAD = /\.(svg|pdf|tiff?|djvu|ogg|ogv|webm|mp3|wav|gif|stl)$/i, BADW = /\b(map|karte|carte|locator|location|flag|coat of arms|logo|diagram|plan of|chart|icon|stamp|banknote|signature|relief map|topographic)\b/i;
function goodImg(im) { return im && im.src && /image\/(jpeg|png|webp)/.test(im.mime || 'image/jpeg') && !BAD.test(im.title) && !BADW.test(im.title + ' ' + im.desc); }
async function commonsGeo(lat, lon, radius = 5000, limit = 40) {
  if (!(await isLive())) return [];
  try { const j = await getJSON(CAPI + `&action=query&generator=geosearch&ggscoord=${lat}|${lon}&ggsradius=${radius}&ggslimit=${limit}&ggsnamespace=6&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=900&iiextmetadatafilter=${META}`);
    return (j?.query?.pages || []).map(imgFromInfo).filter(goodImg); } catch { return []; }
}
async function commonsSearch(q, limit = 24) {
  if (!(await isLive())) return [];
  try { const j = await getJSON(CAPI + `&action=query&generator=search&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=900&iiextmetadatafilter=${META}`);
    return (j?.query?.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0)).map(imgFromInfo).filter(goodImg); } catch { return []; }
}
/* lead images for many Wikipedia titles at once → {requestedTitle: img} */
async function leadImages(titles) {
  const out = {}; if (!titles.length || !(await isLive())) return out;
  const uniq = [...new Set(titles)];
  const fileOf = {};
  for (let i = 0; i < uniq.length; i += 45) {
    const chunk = uniq.slice(i, i + 45);
    try {
      const j = await getJSON(WAPI + '&action=query&redirects=1&prop=pageimages&piprop=thumbnail|name&pithumbsize=900&titles=' + encodeURIComponent(chunk.join('|')));
      const map = {}; chunk.forEach(t => map[t] = t);
      for (const n of j?.query?.normalized || []) for (const k in map) if (map[k] === n.from) map[k] = n.to;
      for (const r of j?.query?.redirects || []) for (const k in map) if (map[k] === r.from) map[k] = r.to;
      const pages = Object.fromEntries((j?.query?.pages || []).map(p => [p.title, p]));
      for (const t of chunk) { const p = pages[map[t]]; if (p?.thumbnail?.source && fileFromUrl(p.thumbnail.source)) fileOf[t] = p.pageimage?.replace(/_/g, ' ') || fileFromUrl(p.thumbnail.source); }
    } catch {}
  }
  const info = await commonsInfo(Object.values(fileOf));
  for (const t in fileOf) { const im = info[fileOf[t]]; if (im) out[t] = im; }
  return out;
}
async function wikiExtractRefs(title) {
  try { const j = await getJSON(WAPI + '&action=query&redirects=1&prop=extracts&explaintext=1&titles=' + encodeURIComponent(title));
    const txt = j?.query?.pages?.[0]?.extract || ''; return findRefs(txt); } catch { return []; }
}
async function wikiSearch(q, n = 8) {
  if (!(await isLive())) return [];
  try { const j = await getJSON(WAPI + '&action=query&list=search&srlimit=' + n + '&srprop=snippet&srsearch=' + encodeURIComponent(q + ' bible OR biblical OR ancient'));
    return (j?.query?.search || []).map(s => ({ title: s.title, snippet: strip(s.snippet) })); } catch { return []; }
}
async function wikidataItem(title) {
  try { const j = await getJSON(WAPI + '&action=query&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=' + encodeURIComponent(title));
    return j?.query?.pages?.[0]?.pageprops?.wikibase_item || null; } catch { return null; }
}
const SPARQL = 'https://query.wikidata.org/sparql?format=json&query=';
async function wikidataLinks(qid) {
  if (!qid) return {};
  const q = `SELECT ?pleiades ?heritageLabel ?osm WHERE { OPTIONAL{wd:${qid} wdt:P1584 ?pleiades} OPTIONAL{wd:${qid} wdt:P1435 ?heritage} OPTIONAL{wd:${qid} wdt:P402 ?osm} SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 10`;
  try { const j = await getJSON(SPARQL + encodeURIComponent(q), { timeout: 20000 }); const b = j?.results?.bindings || [];
    return { pleiades: b.find(x => x.pleiades)?.pleiades?.value, heritage: [...new Set(b.map(x => x.heritageLabel?.value).filter(Boolean))], osm: b.find(x => x.osm)?.osm?.value }; } catch { return {}; }
}
async function nearbyArchSites(lat, lon, radiusKm = 12) {
  if (!(await isLive())) return [];
  const q = `SELECT ?item ?itemLabel ?lat ?lon ?article WHERE { SERVICE wikibase:around { ?item wdt:P625 ?loc . bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral . bd:serviceParam wikibase:radius "${radiusKm}" . } ?item wdt:P31/wdt:P279* wd:Q839954 . BIND(geof:latitude(?loc) AS ?lat) BIND(geof:longitude(?loc) AS ?lon) OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 80`;
  try { const j = await getJSON(SPARQL + encodeURIComponent(q), { timeout: 25000, days: 30 });
    const seen = new Set();
    return (j?.results?.bindings || []).map(b => ({ q: b.item.value.split('/').pop(), name: b.itemLabel?.value, lat: +b.lat.value, lon: +b.lon.value, article: b.article?.value }))
      .filter(s => s.name && !/^Q\d+$/.test(s.name) && !seen.has(s.q) && seen.add(s.q)); } catch { return []; }
}

/* ---------------- Bible text ---------------- */
const BOOKS = ['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth','1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah','Esther','Job','Psalm','Psalms','Proverbs','Ecclesiastes','Song of Solomon','Song of Songs','Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation'];
const REF_RE = new RegExp('\\b(' + BOOKS.slice().sort((a, b) => b.length - a.length).map(b => b.replace(/ /g, '\\s')).join('|') + ')\\s+(\\d{1,3}):(\\d{1,3})(?:\\s?[-–]\\s?(\\d{1,3}))?', 'g');
function findRefs(txt) {
  const out = new Set(); let m; REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(txt)) && out.size < 40) out.add(`${m[1].replace(/\s+/g, ' ')} ${m[2]}:${m[3]}${m[4] ? '-' + m[4] : ''}`);
  return [...out];
}
async function bibleText(ref) {
  const key = 'web:' + ref; const c = store.get(key); if (c) return c;
  if (!(await isLive())) throw new Error('offline');
  const j = await getJSON('https://bible-api.com/' + encodeURIComponent(ref.replace(/–/g, '-').toLowerCase()) + '?translation=web', { cache: false, timeout: 15000 });
  const v = { ref: j.reference || ref, verses: (j.verses || []).map(x => ({ c: x.chapter, v: x.verse, t: String(x.text || '').trim() })), text: j.text };
  store.set(key, v, 90); return v;
}
function verseHTML(v) { return v.verses.length ? v.verses.map(x => `<sup>${x.v}</sup>${esc(x.t)} `).join('') : esc(v.text); }

/* ---------------- search ---------------- */
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`ʼ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const phon = s => norm(s).replace(/ph/g, 'f').replace(/ck|q|k/g, 'c').replace(/z/g, 's').replace(/[yj]/g, 'i').replace(/w/g, 'v').replace(/([bcdfgstvr])h/g, '$1').replace(/ae|oe/g, 'e').replace(/(.)\1+/g, '$1');
function dl(a, b) { // Damerau-Levenshtein (optimal string alignment)
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i-1] === b[j-1] ? 0 : 1; d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + c);
    if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) d[i][j] = Math.min(d[i][j], d[i-2][j-2] + 1);
  } return d[m][n];
}
function scoreName(q, name) {
  const n = norm(name), qn = q.n; if (!n || !qn) return 0;
  if (n === qn) return 100; if (n.startsWith(qn)) return 92 - Math.min(10, n.length - qn.length) / 2;
  if ((' ' + n).includes(' ' + qn)) return 84; if (qn.length >= 3 && n.includes(qn)) return 74;
  const pn = phon(name); if (pn === q.p) return 88; if (q.p.length >= 3 && pn.startsWith(q.p)) return 80;
  if (q.n.length < 3) return 0;
  let best = 0;
  for (const w of [pn, ...pn.split(' ')]) { const cut = w.slice(0, Math.max(q.p.length, Math.min(w.length, q.p.length + 2))); const d = Math.min(dl(q.p, w), dl(q.p, cut)); const sim = 1 - d / Math.max(q.p.length, 1); if (sim > best) best = sim; }
  return best >= .6 ? 30 + best * 45 : 0;
}
function bestScore(q, names) { let s = 0; names.forEach((nm, i) => { const v = scoreName(q, nm) - (i ? 2 : 0); if (v > s) s = v; }); return s; }
function searchAll(raw, lim = 40) {
  const q = { n: norm(raw), p: phon(raw) }; if (!q.n) return { places: [], discs: [], gaz: [] };
  const places = PLACES.map(p => ({ p, s: bestScore(q, [p.n, ...(p.alt || []), p.mn || '']) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, lim);
  const discs = DISCS.map(d => ({ d, s: Math.max(bestScore(q, [d.n]), d.kind && norm(d.kind) === q.n ? 70 : 0) })).filter(x => x.s >= 55).sort((a, b) => b.s - a.s).slice(0, lim);
  const curNames = new Set(PLACES.flatMap(p => [norm(p.n), ...(p.alt || []).map(norm)]));
  const gaz = (state.gaz || []).map(g => ({ g, s: bestScore(q, [g.n, ...(g.a || [])]) })).filter(x => x.s > 0 && !curNames.has(norm(x.g.n))).sort((a, b) => b.s - a.s).slice(0, lim);
  return { places, discs, gaz };
}

/* ---------------- OpenBible.info gazetteer (optional, all ~1,300 Bible places) ---------------- */
const GAZ_REMOTE = ['https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/data/ancient.jsonl', 'https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/ancient.jsonl'];
function osisToRef(o) { const [b, c, v] = String(o).split('.'); const map = {Gen:'Genesis',Exod:'Exodus',Lev:'Leviticus',Num:'Numbers',Deut:'Deuteronomy',Josh:'Joshua',Judg:'Judges',Ruth:'Ruth','1Sam':'1 Samuel','2Sam':'2 Samuel','1Kgs':'1 Kings','2Kgs':'2 Kings','1Chr':'1 Chronicles','2Chr':'2 Chronicles',Ezra:'Ezra',Neh:'Nehemiah',Esth:'Esther',Job:'Job',Ps:'Psalm',Prov:'Proverbs',Eccl:'Ecclesiastes',Song:'Song of Solomon',Isa:'Isaiah',Jer:'Jeremiah',Lam:'Lamentations',Ezek:'Ezekiel',Dan:'Daniel',Hos:'Hosea',Joel:'Joel',Amos:'Amos',Obad:'Obadiah',Jonah:'Jonah',Mic:'Micah',Nah:'Nahum',Hab:'Habakkuk',Zeph:'Zephaniah',Hag:'Haggai',Zech:'Zechariah',Mal:'Malachi',Matt:'Matthew',Mark:'Mark',Luke:'Luke',John:'John',Acts:'Acts',Rom:'Romans','1Cor':'1 Corinthians','2Cor':'2 Corinthians',Gal:'Galatians',Eph:'Ephesians',Phil:'Philippians',Col:'Colossians','1Thess':'1 Thessalonians','2Thess':'2 Thessalonians','1Tim':'1 Timothy','2Tim':'2 Timothy',Titus:'Titus',Phlm:'Philemon',Heb:'Hebrews',Jas:'James','1Pet':'1 Peter','2Pet':'2 Peter','1John':'1 John','2John':'2 John','3John':'3 John',Jude:'Jude',Rev:'Revelation'}; return `${map[b] || b} ${c}:${v}`; }
function slimRecord(r) { // tolerant of schema variations
  const id = r.id, n = r.friendly_id || r.name; if (!id || !n) return null;
  const ident = (r.identifications || [])[0] || {};
  const res = (r.resolutions || ident.resolutions || [])[0] || {};
  let ll = null; const s = res.lonlat || ident.lonlat; if (typeof s === 'string' && s.includes(',')) { const [lo, la] = s.split(',').map(Number); if (isFinite(la) && isFinite(lo)) ll = [+la.toFixed(5), +lo.toFixed(5)]; }
  const v = (r.verses || []).map(x => x.readable || (x.osis ? osisToRef(x.osis) : null)).filter(Boolean);
  const ld = r.linked_data || {}; const wd = ld.wikidata?.id; const wp = ld.wikipedia?.url || ld.wikipedia_article?.url || ld.wikipedia?.id;
  const alts = Object.keys(r.translation_name_counts || {}).filter(a => a !== n).slice(0, 6);
  return { i: id, n: String(n).replace(/\s+\d+$/, ''), f: n, a: alts, t: r.type || '', ll, v: v.slice(0, 200), vc: v.length, ids: (r.identifications || []).length, d: strip(res.description || ident.description || '').slice(0, 200), wd, wp };
}
async function loadGazetteer(onProgress) {
  if (state.gaz) return state.gaz; if (state.gazP) return state.gazP;
  state.gazP = (async () => {
    try { const r = await fetch('data/gazetteer.json'); if (r.ok) { state.gaz = await r.json(); return state.gaz; } } catch {}
    if (!(await isLive())) throw new Error('offline');
    for (const url of GAZ_REMOTE) {
      try {
        const r = await fetch(url); if (!r.ok || !r.body) continue;
        const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '', out = [], bytes = 0;
        for (;;) { const { done, value } = await rd.read(); if (done) break; bytes += value.length; buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf('\n')) > -1) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line && line[0] === '{') { try { const s = slimRecord(JSON.parse(line)); if (s) out.push(s); } catch {} } }
          onProgress && onProgress(bytes, out.length); }
        if (buf.trim().startsWith('{')) { try { const s = slimRecord(JSON.parse(buf)); if (s) out.push(s); } catch {} }
        if (out.length > 50) { state.gaz = out; return out; }
      } catch {}
    }
    throw new Error('unavailable');
  })();
  state.gazP.catch(() => { state.gazP = null; });
  return state.gazP;
}

/* ---------------- map component (Leaflet when live, schematic SVG otherwise) ---------------- */
const KCOL = { main: '#ffffff', place: '#00d1ff', disc: '#ff7a3d', site: '#39ff9c', near: '#7aa8ff', stop: '#00d1ff' };
async function makeMap(box, { markers = [], lines = [], fitPad = 40, maxZoom = 13, overlays = {} } = {}) {
  const live = await isLive();
  if (live && window.L) return leafletMap(box, { markers, lines, fitPad, maxZoom, overlays });
  return svgMap(box, { markers, lines });
}
function popupHTML(m) { return `<b>${esc(m.label)}</b>${m.sub ? `<br><span>${esc(m.sub)}</span>` : ''}${m.go ? `<br><a href="#${esc(m.go)}">Explore this place →</a>` : ''}${m.url ? `<br><a href="${esc(m.url)}" target="_blank" rel="noopener">Read more ↗</a>` : ''}`; }
function leafletMap(box, { markers, lines, fitPad, maxZoom, overlays }) {
  box.innerHTML = ''; const L = window.L;
  const map = L.map(box, { scrollWheelZoom: false, worldCopyJump: true, zoomControl: true });
  const base = {
    'Night': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>' }),
    'Map': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }),
    'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics and the GIS user community' }),
    'Terrain': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenStreetMap contributors, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC BY-SA)' })
  };
  base['Night'].addTo(map);
  const groups = {}; const all = [];
  const icon = m => L.divIcon({ className: '', html: `<div class="mk ${m.kind}" style="width:${m.size || 14}px;height:${m.size || 14}px">${m.num ?? ''}</div>`, iconSize: [m.size || 14, m.size || 14], iconAnchor: [(m.size || 14) / 2, (m.size || 14) / 2] });
  function add(list, gname = 'Places') {
    const g = groups[gname] || (groups[gname] = L.layerGroup().addTo(map));
    for (const m of list) { const mk = L.marker([m.lat, m.lon], { icon: icon(m), title: m.label, zIndexOffset: m.kind === 'main' ? 1000 : m.kind === 'stop' ? 500 : 0 }).bindPopup(popupHTML(m)); if (m.onClick) mk.on('click', () => m.onClick(m)); mk.addTo(g); all.push([m.lat, m.lon]); m._mk = mk; }
    return g;
  }
  for (const ln of lines) L.polyline(ln.pts, { color: ln.color || '#00d1ff', weight: ln.weight || 3, opacity: .9, dashArray: ln.dash || null }).addTo(map);
  add(markers);
  const ctl = L.control.layers(base, {}, { collapsed: true }).addTo(map);
  const fit = () => { if (all.length === 1) map.setView(all[0], Math.min(maxZoom, 12)); else if (all.length) map.fitBounds(all, { padding: [fitPad, fitPad], maxZoom }); else map.setView([31.8, 35.2], 6); };
  fit(); map.on('focus', () => map.scrollWheelZoom.enable()); map.on('blur', () => map.scrollWheelZoom.disable());
  new ResizeObserver(() => map.invalidateSize()).observe(box);
  return { kind: 'leaflet', map, add(list, name) { const g = add(list, name); ctl.addOverlay(g, name); return g; }, toggle(name, on) { const g = groups[name]; if (!g) return; on ? g.addTo(map) : map.removeLayer(g); }, focus(m, zoom = 11) { map.setView([m.lat, m.lon], zoom); m._mk?.openPopup(); }, fit };
}
function svgMap(box, { markers, lines }) {
  box.innerHTML = '<div class="svgmap"><svg role="img" aria-label="Schematic map"></svg><div class="note">Schematic map (live map tiles unavailable) — positions are true latitude/longitude</div></div>';
  const svg = $('svg', box); const sets = { Places: markers.slice() }; const hidden = new Set(); let focusId = null;
  const draw = () => {
    const W = box.clientWidth || 600, H = box.clientHeight || 400;
    const pts = Object.entries(sets).filter(([k]) => !hidden.has(k)).flatMap(([, v]) => v).concat(lines.flatMap(l => l.pts.map(p => ({ lat: p[0], lon: p[1] }))));
    if (!pts.length) { svg.innerHTML = ''; return; }
    let la0 = Math.min(...pts.map(p => p.lat)), la1 = Math.max(...pts.map(p => p.lat)), lo0 = Math.min(...pts.map(p => p.lon)), lo1 = Math.max(...pts.map(p => p.lon));
    const minSpan = .08; if (la1 - la0 < minSpan) { la0 -= minSpan; la1 += minSpan; } if (lo1 - lo0 < minSpan) { lo0 -= minSpan; lo1 += minSpan; }
    const k = Math.cos((la0 + la1) / 2 * Math.PI / 180), pad = 46;
    const sx = (W - pad * 2) / ((lo1 - lo0) * k), sy = (H - pad * 2) / (la1 - la0), s = Math.min(sx, sy);
    const ox = (W - (lo1 - lo0) * k * s) / 2, oy = (H - (la1 - la0) * s) / 2;
    const X = lon => ox + (lon - lo0) * k * s, Y = lat => H - oy - (lat - la0) * s;
    const span = Math.max(la1 - la0, lo1 - lo0), step = span > 20 ? 5 : span > 8 ? 2 : span > 3 ? 1 : span > 1 ? .5 : .1;
    let g = `<rect width="${W}" height="${H}" fill="#031019"/>`;
    const gLo0 = Math.floor((lo0 - span) / step) * step, gLa0 = Math.floor((la0 - span) / step) * step;
    for (let lo = gLo0; lo <= lo1 + span; lo += step) { const x = X(lo); if (x < 0 || x > W) continue; g += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#0f2a36"/><text x="${x + 3}" y="${H - 6}" fill="#4f7f8f" font-size="10">${(+lo.toFixed(1))}°E</text>`; }
    for (let la = gLa0; la <= la1 + span; la += step) { const y = Y(la); if (y < 0 || y > H) continue; g += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#0f2a36"/><text x="4" y="${y - 3}" fill="#4f7f8f" font-size="10">${(+la.toFixed(1))}°N</text>`; }
    for (const l of lines) g += `<polyline points="${l.pts.map(p => X(p[1]) + ',' + Y(p[0])).join(' ')}" fill="none" stroke="${l.color || '#00d1ff'}" stroke-width="2.5" ${l.dash ? 'stroke-dasharray="6 5"' : ''} opacity=".9"/>`;
    const labels = []; const narrow = W < 520;
    const vis = Object.entries(sets).filter(([k]) => !hidden.has(k)).flatMap(([, v]) => v).sort((a, b) => (a.kind === 'main') - (b.kind === 'main'));
    vis.forEach((m, i) => {
      const x = X(m.lon), y = Y(m.lat), r = m.kind === 'main' ? 8 : m.kind === 'stop' ? 9 : 5;
      const shape = m.kind === 'disc' ? `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${x} ${y})" fill="${KCOL.disc}" stroke="#020a10" stroke-width="2"/>` : `<circle cx="${x}" cy="${y}" r="${r}" fill="${KCOL[m.kind] || '#00d1ff'}" stroke="${m.kind === 'main' ? '#ffc72c' : '#020a10'}" stroke-width="${m.kind === 'main' ? 4 : 2}"/>`;
      g += `<g class="pt" data-i="${i}" tabindex="0" role="button" aria-label="${esc(m.label)}">${shape}${m.num != null ? `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#021219">${m.num}</text>` : ''}<title>${esc(m.label)}</title></g>`;
      if ((m.kind === 'main' || m.kind === 'stop' || m.kind === 'place' || (!narrow && m.kind === 'near')) ) labels.push({ x, y, t: m.label, main: m.kind === 'main' });
    });
    const placed = [];
    for (const L1 of labels.sort((a, b) => b.main - a.main)) {
      const w = Math.min(L1.t.length * 6.6, 170), cand = [[10, 4], [-w - 10, 4], [10, -10], [-w - 10, -10], [10, 18]];
      for (const [dx, dy] of cand) { const bx = L1.x + dx, by = L1.y + dy - 11; if (bx < 2 || bx + w > W - 2 || by < 2 || by + 14 > H - 18) continue;
        if (placed.some(p => bx < p.x + p.w && bx + w > p.x && by < p.y + 14 && by + 14 > p.y)) continue;
        placed.push({ x: bx, y: by, w }); g += `<text x="${bx}" y="${by + 11}" font-size="${L1.main ? 13 : 11.5}" font-weight="${L1.main ? 700 : 600}" fill="${L1.main ? '#fff' : '#cfe7ee'}" paint-order="stroke" stroke="#031019" stroke-width="3">${esc(L1.t.length > 26 ? L1.t.slice(0, 25) + '…' : L1.t)}</text>`; break; }
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g;
    $$('.pt', svg).forEach(el => { const m = vis[+el.dataset.i]; const act = () => { if (m.onClick) m.onClick(m); else if (m.go) location.hash = m.go; else if (m.url) window.open(m.url, '_blank', 'noopener'); };
      el.addEventListener('click', act); el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } }); });
  };
  const ro = new ResizeObserver(draw); ro.observe(box); draw();
  return { kind: 'svg', add(list, name) { sets[name] = list; draw(); }, toggle(name, on) { on ? hidden.delete(name) : hidden.add(name); draw(); }, focus(m) { focusId = m; }, fit: draw };
}

/* ---------------- dialog, lightbox, verse viewer ---------------- */
const dlg = $('#dlg'), dlgBody = $('#dlgBody');
function openDlg(html, label = 'Details') { dlgBody.innerHTML = html; dlg.setAttribute('aria-label', label); if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } } return dlgBody; }
dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
dlg.addEventListener('close', () => { dlgBody.innerHTML = ''; });
function credit(im) { return `${im.author ? esc(im.author) : 'Unknown author'}${im.license ? ' · ' + (im.licenseUrl ? `<a href="${esc(im.licenseUrl)}" target="_blank" rel="noopener">${esc(im.license)}</a>` : esc(im.license)) : ''} · <a href="${esc(im.page)}" target="_blank" rel="noopener">Wikimedia Commons</a>`; }
function lightbox(list, i) {
  const show = () => { const im = list[i];
    const b = openDlg(`<div class="lb"><img src="${esc(im.src)}" alt="${esc(im.desc || im.title)}"><p class="small" style="margin-top:10px">${esc(im.desc || im.title.replace(/^File:/, '').replace(/\.\w+$/, ''))}</p><p class="small muted">Photo: ${credit(im)}</p>
      <div class="nav2"><button class="btn ghost sm" data-p ${list.length < 2 ? 'disabled' : ''}>← Previous</button><span class="small muted">${i + 1} / ${list.length}</span><button class="btn ghost sm" data-n ${list.length < 2 ? 'disabled' : ''}>Next →</button></div></div>`, 'Photograph');
    $('[data-p]', b).onclick = () => { i = (i - 1 + list.length) % list.length; show(); }; $('[data-n]', b).onclick = () => { i = (i + 1) % list.length; show(); }; };
  show();
}
document.addEventListener('keydown', e => { if (!dlg.open) return; if (e.key === 'ArrowRight') $('[data-n]', dlgBody)?.click(); if (e.key === 'ArrowLeft') $('[data-p]', dlgBody)?.click(); });
function chapterKey(ref) { const m = String(ref).match(/^(.+?)\s+(\d+)/); return m ? m[1] + ' ' + m[2] : ref; }
async function openVerse(ref, ctx) {
  const ck = chapterKey(ref);
  const others = PLACES.filter(p => (p.v || []).some(v => chapterKey(v[0]) === ck)).slice(0, 12);
  const b = openDlg(`<p class="kicker">World English Bible</p><h2>${esc(ref)}</h2>${ctx ? `<p class="muted">${esc(ctx)}</p>` : ''}<div class="vtext" id="vt"><span class="spin"></span>Loading verse text…</div>
    <div class="linkrow"><a class="btn ghost sm" href="${gwLink(ref)}" target="_blank" rel="noopener">Read the chapter in context ↗</a></div>
    ${others.length ? `<h3 style="margin-top:20px">Places in ${esc(ck)}</h3><div class="chips">${others.map(p => `<button class="chip" data-go="place-${p.id}">${esc(p.n)}</button>`).join('')}</div>` : ''}`, 'Bible verse');
  b.insertAdjacentHTML('beforeend', '<div id="vil" style="margin-top:18px"><p class="muted small"><span class="spin"></span>Loading the Hebrew/Greek…</p></div>');
  interlinearHTML(ref).then(h => { const e = $('#vil', b); if (e) e.innerHTML = h || ''; }, () => { const e = $('#vil', b); if (e) e.innerHTML = ''; });
  try { const v = await bibleText(ref); $('#vt', b).innerHTML = verseHTML(v); }
  catch (e) { $('#vt', b).innerHTML = `<span class="small muted">${e.status === 429 ? 'The free Bible text service is busy (rate limit). Wait a few seconds and try again, or' : 'Verse text could not be loaded here.'} Use the link below to read ${esc(ref)} in the World English Bible.</span>`; }
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); if (dlg.open) dlg.close(); go(g.dataset.go); return; }
  const cq = e.target.closest('[data-cq]'); if (cq && !location.hash.includes('concordance')) { e.preventDefault(); try { sessionStorage.setItem('bpt:cq', cq.dataset.cq); } catch {} go('concordance'); return; }
  const v = e.target.closest('[data-verse]'); if (v) { e.preventDefault(); openVerse(v.dataset.verse, v.dataset.ctx); }
});
function go(h) { if (location.hash.slice(1) === h) render(); else location.hash = h; }

/* ---------------- shared bits ---------------- */
const stBadge = s => `<span class="st ${s}" title="${esc(STATUS[s]?.[1] || '')}">${esc(STATUS[s]?.[0] || s)}</span>`;
const prBadge = s => `<span class="st ${s}" title="${esc(PREC[s]?.[1] || '')}">${esc(PREC[s]?.[0] || s)}</span>`;
const refBtn = (r, ctx = '') => `<button class="vref" data-verse="${esc(r)}" data-ctx="${esc(ctx)}">${esc(r)}</button>`;
const monogram = n => esc(n.replace(/^(The|Mount|Sea of|Valley of)\s+/i, '').slice(0, 1));
function placeCard(p) {
  const cats = (p.cat || []).map(c => CATS.find(x => x[0] === c)?.[1]).filter(Boolean).slice(0, 3);
  return `<button class="pcard" data-go="place-${p.id}" data-wiki="${esc(p.wiki || p.n)}"><div class="ph"><div class="mono">${monogram(p.n)}</div></div><div class="bd"><h3>${esc(p.n)}</h3><p>${esc(p.mn && p.mn !== p.n ? p.mn + ' · ' : '')}${esc((p.loc || '').split(/[,;.]/)[0])}</p><div class="tags">${cats.map(c => `<span class="tag">${esc(c)}</span>`).join('')}</div></div></button>`;
}
async function fillCardImages(root) {
  const cards = $$('[data-wiki]', root); if (!cards.length) return;
  const imgs = await leadImages(cards.map(c => c.dataset.wiki));
  for (const c of cards) { const im = imgs[c.dataset.wiki]; const ph = $('.ph', c); if (im && ph && !$('img', ph)) { const img = new Image(); img.alt = ''; img.loading = 'lazy'; img.src = im.src; img.title = 'Photo: ' + (im.author || 'Wikimedia Commons') + (im.license ? ' (' + im.license + ')' : ''); ph.prepend(img); } }
}
function discsFor(pid) { return DISCS.filter(d => d.place === pid || (d.also || []).includes(pid)); }
function journeysWith(pid) { return JOURNEYS.filter(j => j.stops.some(s => s[0] === pid)); }
function setNav(name) { $$('.nav button').forEach(b => { if (b.dataset.go === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }); }
function nearest(p, n = 6, maxKm = 120) { return PLACES.filter(o => o.id !== p.id).map(o => ({ o, d: km(p, o) })).filter(x => x.d <= maxKm).sort((a, b) => a.d - b.d).slice(0, n); }

/* ---------------- views ---------------- */
function heroSVG() {
  const floor = Array.from({ length: 9 }, (_, i) => { const y = 640 + Math.pow(i / 8, 1.8) * 160; return `<line x1="0" y1="${y.toFixed(1)}" x2="1600" y2="${y.toFixed(1)}"/>`; }).join('') + Array.from({ length: 25 }, (_, i) => `<line x1="800" y1="640" x2="${-1600 + i * 200}" y2="800"/>`).join('');
  return `<svg viewBox="0 0 1600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020a10"/><stop offset=".5" stop-color="#04202c"/><stop offset=".8" stop-color="#0b4a5a"/><stop offset="1" stop-color="#c77a1a"/></linearGradient>
  <linearGradient id="sunG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset=".5" stop-color="#ffa62b"/><stop offset="1" stop-color="#ffc72c"/></linearGradient>
  <radialGradient id="haze" cx=".5" cy=".78" r=".55"><stop offset="0" stop-color="#ffc72c" stop-opacity=".55"/><stop offset=".5" stop-color="#1fe0d0" stop-opacity=".18"/><stop offset="1" stop-color="#1fe0d0" stop-opacity="0"/></radialGradient>
  <mask id="bars"><rect x="560" y="200" width="480" height="440" fill="#fff"/>${Array.from({ length: 8 }, (_, i) => `<rect x="560" y="${440 + i * 18}" width="480" height="${3 + i * 1.6}" fill="#000"/>`).join('')}</mask>
  <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft"><feGaussianBlur stdDeviation="22"/></filter></defs>
  <rect width="1600" height="800" fill="url(#sky)"/><rect width="1600" height="800" fill="url(#haze)"/>
  <g fill="#fff">${Array.from({ length: 70 }, (_, i) => `<circle cx="${(i * 397) % 1600}" cy="${(i * 131) % 420}" r="${i % 5 ? .9 : 1.7}" opacity="${.35 + (i % 4) * .15}"/>`).join('')}</g>
  <circle cx="800" cy="430" r="210" fill="#ffc72c" opacity=".4" filter="url(#soft)"/>
  <circle cx="800" cy="430" r="190" fill="url(#sunG)" mask="url(#bars)"/>
  <path d="M0 600 C200 540 330 560 470 520 S760 470 900 505 1200 560 1600 515 V640 H0Z" fill="#041820" stroke="#1fe0d0" stroke-width="2" filter="url(#glow)" opacity=".95"/>
  <g transform="translate(565 420)" filter="url(#glow)"><path d="M0 220 L40 170 L120 160 L210 120 L330 130 L420 170 L470 220Z" fill="#03141c" stroke="#ffc72c" stroke-width="2"/>
  <path d="M40 200 V142 h22 v-14 h10 v14 h20 v-14 h10 v14 h46 V120 h10 v-12 h10 v12 h10 v-12 h10 v12 h12 v22 h70 v-14 h10 v14 h20 v-14 h10 v14 h60 V130 h10 v-12 h10 v12 h10 v-12 h10 v12 h10 v70Z" fill="#021219" stroke="#00d1ff" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M190 200 v-34 a18 18 0 0 1 36 0 v34" fill="none" stroke="#fff3b0" stroke-width="2.5"/>
  <g fill="#00d1ff"><rect x="90" y="154" width="6" height="12"/><rect x="300" y="154" width="6" height="12"/><rect x="380" y="146" width="6" height="12"/></g>
  <path d="M208 40 v52 M190 58 h36" stroke="#fff" stroke-width="4" stroke-linecap="round"/></g>
  <rect y="640" width="1600" height="160" fill="#020a10"/>
  <g stroke="#ffc72c" stroke-width="1.6" opacity=".7" filter="url(#glow)">${floor}</g>
  <line x1="0" y1="640" x2="1600" y2="640" stroke="#00d1ff" stroke-width="2.5" filter="url(#glow)"/></svg>`;
}
async function viewHome() {
  setNav('home'); document.title = 'Just One More Lord — Explore the world of the Bible';
  const feat = ['jerusalem','bethlehem','nazareth','capernaum','sea-of-galilee','jericho','ephesus','babylon'].map(id => byId[id]);
  main.innerHTML = `
  <section class="hero"><div class="bg">${heroSVG()}</div><div class="credit" id="heroCredit" hidden></div>
    <div class="wrap in"><p class="kicker eyebrow">Just One More Lord</p><h1>Explore the world of <span class="neon-txt">the Bible.</span></h1><div class="orn" aria-hidden="true"><span></span><svg viewBox="0 0 24 24"><path d="M12 3v18M6 9h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span></span></div>
    <p class="lede">See the places where biblical history unfolded. Explore the locations today. Discover the archaeological evidence. Walk through history.</p>
    <form class="bigsearch" id="bigSearch" role="search"><label class="sr" for="bq">Search for a Bible place</label><input id="bq" type="search" placeholder="Try Capernaum, Ninevah, Sinai, Ephesus…" spellcheck="false"><button class="btn" type="submit">Search</button></form>
    <div class="chips">${['Jerusalem','Bethlehem','Sea of Galilee','Mount Sinai','Golgotha','Corinth','Nineveh'].map(n => `<button class="chip" data-go="place-${PLACES.find(p => p.n.startsWith(n)).id}">${esc(n)}</button>`).join('')}</div></div></section>
  <section class="band"><div class="wrap"><div class="sh"><div><h2>Featured places</h2><p>Each page brings together photographs of the site today, an interactive map, the Bible passages, documented discoveries, a timeline and sources.</p></div><button class="btn ghost" data-go="atlas">Open the atlas</button></div>
    <div class="grid" id="feat">${feat.map(placeCard).join('')}</div></div></section>
  <section class="band" style="background:var(--bg2)"><div class="wrap"><div class="sh"><div><h2>How the evidence is graded</h2><p>Every archaeological entry carries one of five labels, so you can see at a glance what a find shows and what remains debated. Archaeology is kept separate from theological interpretation.</p></div><button class="btn ghost" data-go="discoveries">Browse ${DISCS.length} discoveries</button></div>
    <div class="legend5">${Object.entries(STATUS).map(([k, v]) => `<div>${stBadge(k)}<p>${esc(v[1])}</p><p class="small"><b>${DISCS.filter(d => d.status === k).length}</b> entries</p></div>`).join('')}</div></div></section>
  <section class="band"><div class="wrap"><div class="sh"><div><h2>Journeys through Scripture</h2><p>Follow Abraham, the Exodus, Jesus\' ministry, Paul\'s voyages and the apostles across the map.</p></div><button class="btn ghost" data-go="journeys">All journeys</button></div>
    <div class="grid">${JOURNEYS.slice(0, 4).map(journeyCard).join('')}</div></div></section>
  <section class="band" style="background:var(--bg2)"><div class="wrap"><div class="sh"><div><h2>Strong's Concordance</h2><p>Look up any English word to find the Hebrew and Greek words behind it, their meanings and every verse where they occur, with a word-by-word view of each verse.</p></div><button class="btn" data-go="concordance">Open the concordance</button></div>
    <div class="chips">${[['love','אָהַב · ἀγαπάω'],['peace','שָׁלוֹם · εἰρήνη'],['grace','חֵן · χάρις'],['word','דָּבָר · λόγος']].map(([w, o]) => `<button class="chip" data-cq="${w}"><b>${w}</b> <span class="muted">${o}</span></button>`).join('')}</div></div></section>
  <section class="band"><div class="wrap"><div class="sh"><div><h2>Browse all ${PLACES.length} places</h2><p>Cities, mountains, seas, regions and journey stops — or search above for any of the 1,300+ places named in the Bible.</p></div></div>
    <div class="chips" id="cats" role="group" aria-label="Filter places">${CATS.map(([k, l], i) => `<button class="chip" data-cat="${k}" aria-pressed="${i === 0}">${esc(l)}</button>`).join('')}</div>
    <div class="grid" id="allp" style="margin-top:18px"></div></div></section>`;
  const allp = $('#allp');
  const showCat = c => { const list = PLACES.filter(p => c === 'all' || (p.cat || []).includes(c)); allp.innerHTML = list.map(placeCard).join(''); fillCardImages(allp); };
  $('#cats').onclick = e => { const b = e.target.closest('[data-cat]'); if (!b) return; $$('#cats .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); showCat(b.dataset.cat); };
  showCat('all');
  $('#bigSearch').onsubmit = e => { e.preventDefault(); doSearch($('#bq').value); };
  attachSuggest($('#bq'));
  fillCardImages($('#feat'));
  const s = await wikiSummary('Old City of Jerusalem'); const f = fileFromUrl(s?.originalimage?.source);
  if (f) { const info = (await commonsInfo([f], 1600))[f.replace(/_/g, ' ')]; if (info && $('.hero .bg')) { const img = new Image(); img.alt = 'The Old City of Jerusalem today'; img.onload = () => { img.classList.add('on'); $('.hero .bg svg')?.remove(); }; img.src = info.src; $('.hero .bg').prepend(img); const c = $('#heroCredit'); c.hidden = false; c.innerHTML = 'Jerusalem today. Photo: ' + credit(info); } }
}
function journeyCard(j) {
  const pts = j.stops.map(s => byId[s[0]]).filter(Boolean);
  const la0 = Math.min(...pts.map(p => p.lat)), la1 = Math.max(...pts.map(p => p.lat)), lo0 = Math.min(...pts.map(p => p.lon)), lo1 = Math.max(...pts.map(p => p.lon));
  const W = 300, H = 90, k = Math.cos((la0 + la1) / 2 * Math.PI / 180), s = Math.min((W - 20) / Math.max((lo1 - lo0) * k, .01), (H - 20) / Math.max(la1 - la0, .01));
  const ox = (W - (lo1 - lo0) * k * s) / 2, oy = (H - (la1 - la0) * s) / 2, P = p => `${(ox + (p.lon - lo0) * k * s).toFixed(1)},${(H - oy - (p.lat - la0) * s).toFixed(1)}`;
  return `<button class="jcard" data-go="journey-${j.id}"><svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts.map(P).join(' ')}" fill="none" stroke="${j.color}" stroke-width="2.5" stroke-linejoin="round"/>${pts.map(p => `<circle cx="${P(p).split(',')[0]}" cy="${P(p).split(',')[1]}" r="3.5" fill="${j.color}" stroke="#020a10" stroke-width="1.5"/>`).join('')}</svg><h3>${esc(j.n)}</h3><p class="muted small" style="margin:0">${esc(j.ref)} · ${j.stops.length} stages</p></button>`;
}

async function viewPlace(id, focusDisc) {
  const p = byId[id]; if (!p) return viewNotFound();
  setNav(''); document.title = `${p.n} — Just One More Lord`;
  const ds = discsFor(p.id), js = journeysWith(p.id), near = nearest(p);
  const secs = [['ov','Overview'],['photos','Photographs'],['map','Map'],['bible','Bible references'],['arch','Discoveries'],['time','Timeline'],['hist','History'],['related','Related'],['src','Sources']];
  main.innerHTML = `
  <section class="phero"><div class="bg" id="pbg"></div><div class="wrap in"><div class="crumbs"><button data-go="home">Explore</button> › ${esc((p.cat || []).includes('ot') && (p.cat || []).includes('nt') ? 'Old and New Testament' : (p.cat || []).includes('nt') ? 'New Testament' : 'Old Testament')} › ${esc(p.ty || 'Place')}</div>
    <h1>${esc(p.n)}</h1><p class="sub">${esc(p.mn || '')}${p.loc ? ' · ' + esc(p.loc) : ''}</p><div class="tags" style="margin-top:12px">${prBadge(p.pr || 'probable')}${(p.alt || []).slice(0, 5).map(a => `<span class="tag">${esc(a)}</span>`).join('')}</div></div></section>
  <nav class="rail" aria-label="Sections"><div class="scroll">${secs.map(([k, l], i) => `<button data-sec="${k}" aria-current="${i === 0}">${esc(l)}</button>`).join('')}</div></nav>
  <section class="sec" id="s-ov"><div class="wrap two"><div><p class="lead">${esc(p.sum || '')}</p>
    <dl class="facts"><div><dt>Biblical name</dt><dd>${esc(p.bn || p.n)}</dd></div><div><dt>Modern name</dt><dd>${esc(p.mn || '—')}</dd></div><div><dt>Where it is today</dt><dd>${esc(p.loc || '—')}</dd></div><div><dt>Coordinates</dt><dd>${p.lat.toFixed(4)}° N, ${p.lon.toFixed(4)}° E <span class="small muted">(${esc(PREC[p.pr]?.[0] || '')})</span></dd></div></dl>
    <div class="statrow"><div><b>${(p.v || []).length}</b><span>Bible passages</span></div><div><b>${ds.length}</b><span>Documented discoveries</span></div><div><b>${js.length}</b><span>Journeys through here</span></div></div></div>
    <aside class="wikibox" id="wikibox"><h3>From Wikipedia</h3><p class="muted small"><span class="spin"></span>Loading summary…</p></aside></div></section>
  <section class="sec" id="s-photos"><div class="wrap"><div class="sh"><div><h2>The place today</h2><p>Real photographs taken at and around the site, from Wikimedia Commons. Each shows its photographer and licence.</p></div></div><div id="gal"><p class="muted"><span class="spin"></span>Finding photographs…</p></div>
    <div class="linkrow"><a class="btn ghost sm" href="${commonsSearchLink(p.n)}" target="_blank" rel="noopener">More on Wikimedia Commons ↗</a><a class="btn ghost sm" href="https://www.mapillary.com/app/?lat=${p.lat}&lng=${p.lon}&z=15" target="_blank" rel="noopener">Street-level imagery (Mapillary) ↗</a><a class="btn ghost sm" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lon}" target="_blank" rel="noopener">Google Street View ↗</a></div></div></section>
  <section class="sec" id="s-map"><div class="wrap"><div class="sh"><div><h2>Interactive map</h2><p>Switch between map, satellite and terrain views with the layer button. Diamonds mark documented discoveries; green dots are archaeological sites recorded in Wikidata.</p></div></div>
    <div class="mapbox" id="pmap"></div><div class="maplegend" id="mlg"><span><span class="dot" style="background:#fff;box-shadow:0 0 0 2px var(--gold)"></span> ${esc(p.n)}</span><label><input type="checkbox" data-g="Discoveries" checked><span class="dot" style="background:var(--clay);border-radius:2px"></span> Discoveries (${ds.length})</label><label><input type="checkbox" data-g="Nearby Bible places" checked><span class="dot" style="background:var(--sky)"></span> Nearby Bible places</label><label><input type="checkbox" data-g="Archaeological sites (Wikidata)" checked><span class="dot" style="background:var(--olive)"></span> Archaeological sites <span id="siteCount"></span></label></div>
    <div class="linkrow"><a class="btn ghost sm" href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=14/${p.lat}/${p.lon}" target="_blank" rel="noopener">OpenStreetMap ↗</a><a class="btn ghost sm" href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}" target="_blank" rel="noopener">Google Maps ↗</a></div></div></section>
  <section class="sec" id="s-bible"><div class="wrap"><div class="sh"><div><h2>Bible references</h2><p>Select a reference to read it in the World English Bible (public domain). Context notes summarise what happens there in the biblical account.</p></div><button class="btn ghost sm" id="loadAll">Show all verse texts</button></div>
    <div class="verses" id="vlist">${(p.v || []).map((v, i) => `<div class="verse"><div class="row">${refBtn(v[0], v[1])}<span>${esc(v[1])}</span></div><div class="vtext" id="vt-${i}" hidden></div><div class="small" style="margin-top:6px"><a class="vlink" href="${gwLink(v[0])}" target="_blank" rel="noopener">Read in context ↗</a></div></div>`).join('') || '<p class="empty">No curated references.</p>'}</div>
    <div id="morerefs"></div></div></section>
  <section class="sec" id="s-arch"><div class="wrap"><div class="sh"><div><h2>Archaeological discoveries</h2><p>Documented finds at or connected with ${esc(p.n)}. Each is graded, dated, attributed and sourced. Hover a label to see what it means.</p></div></div>
    <div class="dlist" id="dl">${ds.map(discCard).join('') || `<p class="empty">No discoveries are curated for this place yet. The map above lists archaeological sites recorded nearby in Wikidata, and the sources section links to further reading.</p>`}</div></div></section>
  <section class="sec" id="s-time"><div class="wrap"><div class="sh"><div><h2>Timeline</h2><p>Biblical events, rulers, discoveries and excavations in one sequence. Select a period to narrow it; dates before about 900 BC are approximate and debated.</p></div></div><div id="tlbox"></div></div></section>
  <section class="sec" id="s-hist"><div class="wrap two"><div class="prose"><h2>Biblical and modern history</h2>
    <h3>Historical importance</h3><p>${esc(p.hist || p.sum || '')}</p><h3>Biblical importance</h3><p>${esc(p.bib || p.sum || '')}</p>
    <h3>What remains visible today</h3><p>${esc(p.vis || '—')}</p>
    ${ds.length ? `<h3>Archaeological findings</h3><ul>${ds.map(d => `<li><button class="inl" data-disc="${d.id}">${esc(d.n)}</button> — ${stBadge(d.status)}</li>`).join('')}</ul>` : ''}</div>
    <div><h3 style="margin-bottom:10px">Who occupied the region</h3>${(p.civ || []).length ? `<ol class="tl" style="--x:0">${p.civ.map(c => `<li class="h"><span class="yr">${esc(yr(c[1]))}</span><span class="nd"></span><span class="tx"><b>${esc(c[0])}</b><span class="kd">${esc(yr(c[1]))} – ${c[2] >= 2026 ? 'today' : esc(yr(c[2]))}</span></span></li>`).join('')}</ol>` : '<p class="muted">Not recorded for this entry.</p>'}</div></div></section>
  <section class="sec" id="s-related"><div class="wrap"><h2>Related places</h2>
    <div class="grid" style="margin-top:16px" id="relg">${(p.rel || []).map(r => byId[r]).filter(Boolean).map(placeCard).join('')}</div>
    ${near.length ? `<h3 style="margin:28px 0 10px">Nearest places in this atlas</h3><div class="rlist">${near.map(x => `<button class="ritem" data-go="place-${x.o.id}"><div><b>${esc(x.o.n)}</b><span>${esc(x.o.sum || '')}</span></div><span class="tag">${x.d.toFixed(0)} km</span></button>`).join('')}</div>` : ''}
    ${js.length ? `<h3 style="margin:28px 0 10px">Journeys that pass through ${esc(p.n)}</h3><div class="grid">${js.map(journeyCard).join('')}</div>` : ''}</div></section>
  <section class="sec" id="s-src"><div class="wrap prose"><h2>Sources and further reading</h2><ul id="srcl">
    <li>Wikipedia: <a href="${wikiLink(p.wiki || p.n)}" target="_blank" rel="noopener">${esc(p.wiki || p.n)}</a> (summary text, CC BY-SA; the article\'s own citations point to excavation reports)</li>
    ${ds.map(d => `<li>${esc(d.n)}: <a href="${wikiLink(d.wiki)}" target="_blank" rel="noopener">Wikipedia — ${esc(d.wiki)}</a>${d.held ? `; held at ${esc(d.held)}` : ''}; <a href="${scholarLink(d.n + ' ' + (d.who || '').split(/[(;,.]/)[0])}" target="_blank" rel="noopener">search scholarly literature</a></li>`).join('')}
    <li>Photographs: <a href="${commonsSearchLink(p.n)}" target="_blank" rel="noopener">Wikimedia Commons</a> (licence on each image)</li>
    <li>Map data: <a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=13/${p.lat}/${p.lon}" target="_blank" rel="noopener">OpenStreetMap</a>; archaeological sites from <a href="https://www.wikidata.org/" target="_blank" rel="noopener">Wikidata</a> (CC0)</li>
    <li>Scripture: World English Bible (public domain), via <a href="https://bible-api.com/" target="_blank" rel="noopener">bible-api.com</a></li>
    <li><a href="https://pleiades.stoa.org/search?SearchableText=${encodeURIComponent(p.n.replace(/\s*\(.*\)/, ''))}" target="_blank" rel="noopener">Pleiades gazetteer of ancient places</a> · <a href="https://www.openbible.info/geo/" target="_blank" rel="noopener">OpenBible.info Bible geocoding</a> · <a href="${scholarLink(p.n.replace(/\s*\(.*\)/, '') + ' excavation')}" target="_blank" rel="noopener">Google Scholar: excavation reports</a></li>
  </ul><p class="small muted">Spotted an error? Please report it with a source; corrections are welcome (see About & Sources).</p></div></section>`;
  // rail behaviour
  const rail = $('.rail'); rail.style.setProperty('--railTop', $('.top').offsetHeight + 'px');
  rail.onclick = e => { const b = e.target.closest('[data-sec]'); if (!b) return; $('#s-' + b.dataset.sec).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
  const io = new IntersectionObserver(es => { for (const en of es) if (en.isIntersecting) { const k = en.target.id.slice(2); $$('.rail button').forEach(b => b.setAttribute('aria-current', b.dataset.sec === k)); $(`.rail button[data-sec="${k}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } }, { rootMargin: '-40% 0px -55% 0px' });
  $$('.sec').forEach(s => io.observe(s));
  main.onclick = e => { const d = e.target.closest('[data-disc]'); if (d) { const el = $('#d-' + d.dataset.disc); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
  // timeline
  renderTimeline($('#tlbox'), p, ds);
  // verses (all)
  $('#loadAll').onclick = async e => { const btn = e.target; btn.disabled = true; btn.textContent = 'Loading…';
    for (let i = 0; i < (p.v || []).length; i++) { const box = $('#vt-' + i); if (!box) return; box.hidden = false; box.innerHTML = '<span class="spin"></span>';
      try { const v = await bibleText(p.v[i][0]); box.innerHTML = verseHTML(v); } catch (er) { box.innerHTML = `<span class="small muted">${er.status === 429 ? 'Rate limit reached — wait a moment and try again.' : 'Not available offline.'}</span>`; if (er.status === 429) break; }
      if (!store.get('web:' + p.v[i + 1]?.[0])) await new Promise(r => setTimeout(r, 2100)); }
    btn.textContent = 'Verse texts shown'; };
  if (focusDisc) setTimeout(() => $('#d-' + focusDisc)?.scrollIntoView({ block: 'start' }), 60);
  // map
  const markers = [{ lat: p.lat, lon: p.lon, label: p.n, sub: p.mn, kind: 'main', size: 18 }];
  const dm = ds.filter(d => d.lat && km(p, d) < 400).map(d => ({ lat: d.lat, lon: d.lon, label: d.n, sub: (STATUS[d.status]?.[0] || '') + ' · ' + d.date, kind: 'disc', onClick: () => $('#d-' + d.id)?.scrollIntoView({ behavior: 'smooth' }) }));
  const nm = near.map(x => ({ lat: x.o.lat, lon: x.o.lon, label: x.o.n, sub: `${x.d.toFixed(0)} km away`, kind: 'near', go: 'place-' + x.o.id }));
  const relLines = (p.rel || []).map(r => byId[r]).filter(o => o && km(p, o) < 150).map(o => ({ pts: [[p.lat, p.lon], [o.lat, o.lon]], color: '#8fb8ff', dash: '4 6', weight: 1.5 }));
  const mp = await makeMap($('#pmap'), { markers, lines: relLines, maxZoom: 13 });
  if (!$('#pmap')) return;
  if (dm.length) mp.add(dm, 'Discoveries'); if (nm.length) mp.add(nm, 'Nearby Bible places');
  $('#mlg').onchange = e => { const c = e.target.closest('[data-g]'); if (c) mp.toggle(c.dataset.g, c.checked); };
  // async live enrichments
  enrichPlace(p, mp);
}
async function enrichPlace(p, mp) {
  const live = await isLive(); const wb = $('#wikibox');
  if (!live) { if (wb) wb.innerHTML = `<h3>Further reading</h3><p class="small">Open the <a href="${wikiLink(p.wiki || p.n)}" target="_blank" rel="noopener">Wikipedia article on ${esc(p.wiki || p.n)}</a> for a fuller account and its references.</p>`;
    const g = $('#gal'); if (g) g.innerHTML = `<p class="empty">Photographs load live from Wikimedia Commons when the site is online. <a href="${commonsSearchLink(p.n)}" target="_blank" rel="noopener">Open photographs of ${esc(p.n)} on Commons ↗</a></p>`;
    $$('.dcard .noimg').forEach(n => n.textContent = 'Photograph loads when online'); return; }
  // summary + hero
  wikiSummary(p.wiki || p.n).then(async s => {
    if (!$('#wikibox')) return;
    if (s?.extract) $('#wikibox').innerHTML = `<h3>From Wikipedia</h3><p>${esc(s.extract)}</p><p class="small"><a href="${esc(s.content_urls?.desktop?.page || wikiLink(p.wiki))}" target="_blank" rel="noopener">Read the full article ↗</a> <span class="muted">· CC BY-SA</span></p>`;
    else $('#wikibox').innerHTML = `<h3>Further reading</h3><p class="small"><a href="${wikiLink(p.wiki || p.n)}" target="_blank" rel="noopener">Wikipedia: ${esc(p.wiki || p.n)} ↗</a></p>`;
    const f = fileFromUrl(s?.originalimage?.source || s?.thumbnail?.source);
    if (f) { const im = (await commonsInfo([f], 1600))[f.replace(/_/g, ' ')]; if (im && $('#pbg')) { $('#pbg').innerHTML = `<img src="${esc(im.src)}" alt="${esc(p.n)} today">`; $('.phero .in').insertAdjacentHTML('beforeend', `<p class="small" style="color:#d8ccb4;margin-top:10px">Photo: ${credit(im)}</p>`); } }
  });
  // gallery: geo-tagged photos around the site + text search
  (async () => {
    const radius = /lake|sea|river|valley|mountain|island|region/i.test(p.ty) ? 10000 : 3000;
    const [geo, txt] = await Promise.all([commonsGeo(p.lat, p.lon, radius), commonsSearch(p.n.replace(/\s*\(.*\)/, '') + (/(ancient|tel|mount|sea|river)/i.test(p.n) ? '' : ' ancient'), 18)]);
    const seen = new Set(), list = [];
    for (const im of [...geo, ...txt]) if (!seen.has(im.title)) { seen.add(im.title); list.push(im); }
    const g = $('#gal'); if (!g) return;
    if (!list.length) { g.innerHTML = `<p class="empty">No freely licensed photographs were found automatically. <a href="${commonsSearchLink(p.n)}" target="_blank" rel="noopener">Search Wikimedia Commons ↗</a></p>`; return; }
    const show = list.slice(0, 24);
    g.innerHTML = `<div class="gallery big">${show.map((im, i) => `<button data-i="${i}" aria-label="Open photo: ${esc(im.desc || im.title)}"><img src="${esc(im.src)}" alt="${esc(im.desc || im.title)}" loading="lazy"><span class="cap">${esc(im.author || '')}${im.license ? ' · ' + esc(im.license) : ''}</span></button>`).join('')}</div><p class="small muted" style="margin-top:8px">${list.length} photographs found (geotagged within ${radius / 1000} km, plus matching titles). Select one to enlarge and see its full credit.</p>`;
    g.onclick = e => { const b = e.target.closest('[data-i]'); if (b) lightbox(show, +b.dataset.i); };
  })();
  // discovery images
  (async () => { const ds = $$('.dcard[data-wiki]'); const imgs = await leadImages(ds.map(d => d.dataset.wiki));
    for (const d of ds) { const im = imgs[d.dataset.wiki], ph = $('.ph', d); if (!ph) continue;
      if (im) ph.innerHTML = `<img src="${esc(im.src)}" alt="${esc(im.desc || d.dataset.name)}" loading="lazy"><div class="credit">${credit(im)}</div>`;
      else ph.innerHTML = `<div class="noimg">No free photograph found automatically. <a href="${commonsSearchLink(d.dataset.name)}" target="_blank" rel="noopener">Search Commons ↗</a></div>`; } })();
  // nearby archaeological sites
  (async () => { const radius = /lake|sea|river|valley|mountain|region/i.test(p.ty) ? 25 : 12; const sites = await nearbyArchSites(p.lat, p.lon, radius);
    const sc = $('#siteCount'); if (sc) sc.textContent = `(${sites.length} within ${radius} km)`;
    if (sites.length && $('#pmap')) mp.add(sites.map(s => ({ lat: s.lat, lon: s.lon, label: s.name, sub: 'Archaeological site · Wikidata ' + s.q, kind: 'site', size: 11, url: s.article || 'https://www.wikidata.org/wiki/' + s.q })), 'Archaeological sites (Wikidata)'); })();
  // identifiers
  (async () => { const qid = await wikidataItem(p.wiki || p.n); if (!qid) return; const l = await wikidataLinks(qid); const ul = $('#srcl'); if (!ul) return;
    ul.insertAdjacentHTML('beforeend', `<li>Linked data: <a href="https://www.wikidata.org/wiki/${esc(qid)}" target="_blank" rel="noopener">Wikidata ${esc(qid)}</a>${l.pleiades ? ` · <a href="https://pleiades.stoa.org/places/${esc(l.pleiades)}" target="_blank" rel="noopener">Pleiades ${esc(l.pleiades)}</a>` : ''}${l.heritage?.length ? ` · Heritage status: ${esc(l.heritage.join(', '))}` : ''}</li>`); })();
  // more references from OpenBible gazetteer if loaded
  if (state.gaz) showGazRefs(p);
}
function showGazRefs(p) {
  const box = $('#morerefs'); if (!box || !state.gaz) return;
  const names = new Set([norm(p.n.replace(/\s*\(.*\)/, '')), ...(p.alt || []).map(norm)]);
  const hits = state.gaz.filter(g => names.has(norm(g.n)) && g.ll && km(p, { lat: g.ll[0], lon: g.ll[1] }) < 30);
  const have = new Set((p.v || []).map(v => v[0]));
  const refs = [...new Set(hits.flatMap(h => h.v))].filter(r => !have.has(r));
  if (refs.length) box.innerHTML = `<h3 style="margin:24px 0 10px">Every other verse naming ${esc(p.n)} <span class="small muted">(${refs.length}, from OpenBible.info)</span></h3><div class="chips">${refs.slice(0, 300).map(r => `<button class="chip" data-verse="${esc(r)}">${esc(r)}</button>`).join('')}</div>`;
}
function discCard(d) {
  const pl = byId[d.place];
  return `<article class="dcard" id="d-${d.id}" data-wiki="${esc(d.wiki)}" data-name="${esc(d.n)}"><div class="ph"><div class="noimg"><span class="spin"></span></div></div><div class="bd">
    <p class="kicker">${esc(d.kind)}${pl ? ` · <button class="inl" data-go="place-${pl.id}">${esc(pl.n)}</button>` : ''}</p><h3>${esc(d.n)}</h3>
    <div class="meta">${stBadge(d.status)}<span class="rel">${esc(RELN[d.rel] || d.rel)}</span></div>
    <dl><dt>What it shows</dt><dd>${esc(d.shows)}</dd><dt>Where found</dt><dd>${esc(d.found)}</dd><dt>Date / period</dt><dd>${esc(d.date)}</dd>
    <dt>Discovered by</dt><dd>${esc(d.who)}${d.exy ? ` <span class="muted">(${d.exy})</span>` : ''}</dd><dt>Held / visible at</dt><dd>${esc(d.held || '—')}</dd>
    <dt>Scholarly assessment</dt><dd>${esc(d.accepted)}</dd><dt>Bible passages</dt><dd>${(d.verses || []).map(v => refBtn(v)).join(' · ')}</dd>
    <dt>Sources</dt><dd><a href="${wikiLink(d.wiki)}" target="_blank" rel="noopener">Wikipedia: ${esc(d.wiki)} ↗</a> · <a href="${scholarLink(d.n)}" target="_blank" rel="noopener">Scholarly literature ↗</a></dd></dl></div></article>`;
}
function renderTimeline(box, p, ds) {
  const ev = [...(p.tl || []).map(t => ({ y: t[0], l: t[1], t: t[2], k: t[3] })),
    ...ds.filter(d => d.yr != null).map(d => ({ y: d.yr, l: d.date.split(/[;(]/)[0].trim(), t: d.n, k: 'd', disc: d.id })),
    ...ds.filter(d => d.exy && !(p.tl || []).some(t => t[0] === d.exy && t[3] === 'x')).map(d => ({ y: d.exy, l: String(d.exy), t: `${d.n} discovered (${(d.who || '').split(/[.;(]/)[0]}).`, k: 'x', disc: d.id }))]
    .sort((a, b) => a.y - b.y);
  if (!ev.length) { box.innerHTML = '<p class="empty">No timeline events recorded.</p>'; return; }
  const civ = p.civ || []; let kind = 'all', per = null;
  box.innerHTML = `${civ.length ? `<div class="ribbon" role="group" aria-label="Periods">${civ.map((c, i) => `<button data-per="${i}" aria-pressed="false"><b>${esc(c[0])}</b><span>${esc(yr(c[1]))} – ${c[2] >= 2026 ? 'today' : esc(yr(c[2]))}</span></button>`).join('')}</div>` : ''}
    <div class="chips" role="group" aria-label="Event types" style="margin:0 0 10px">${[['all', 'Everything'], ['b', 'Biblical accounts'], ['h', 'History & rulers'], ['d', 'Discoveries'], ['x', 'Excavations']].map(([k, l], i) => `<button class="chip" data-k="${k}" aria-pressed="${i === 0}">${esc(l)}</button>`).join('')}</div><ol class="tl" id="tlol"></ol>`;
  const draw = () => {
    const c = per != null ? civ[per] : null;
    const list = ev.filter(e => (kind === 'all' || e.k === kind) && (!c || (e.k === 'x' ? false : e.y >= c[1] && e.y <= c[2])));
    $('#tlol', box).innerHTML = list.map(e => `<li class="${e.k}"><span class="yr">${esc(e.l)}</span><span class="nd"></span><span class="tx">${e.disc ? `<button class="inl" data-disc="${e.disc}">${esc(e.t)}</button>` : esc(e.t)}<span class="kd">${esc(KINDLBL[e.k] || '')}</span></span></li>`).join('') || '<li><span></span><span></span><span class="tx muted">Nothing recorded for this filter.</span></li>';
  };
  box.onclick = e => { const k = e.target.closest('[data-k]'), pr = e.target.closest('[data-per]');
    if (k) { kind = k.dataset.k; $$('[data-k]', box).forEach(b => b.setAttribute('aria-pressed', b === k)); draw(); }
    if (pr) { const i = +pr.dataset.per; per = per === i ? null : i; $$('[data-per]', box).forEach(b => b.setAttribute('aria-pressed', +b.dataset.per === per)); draw(); } };
  draw();
}

async function viewAtlas() {
  setNav('atlas'); document.title = 'Atlas — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><h1>Atlas of Bible places</h1><p>All ${PLACES.length} curated places on one map. Select a marker to open its page. Filter by theme below.</p></div></div>
    <div class="chips" id="acats" style="margin:0 0 14px">${CATS.map(([k, l], i) => `<button class="chip" data-cat="${k}" aria-pressed="${i === 0}">${esc(l)}</button>`).join('')}</div>
    <div class="mapbox tall" id="amap"></div><p class="small muted" style="margin-top:10px">Marker colour: cyan = certain or probable location; blue = disputed or traditional location.</p></div></section>`;
  const mk = c => PLACES.filter(p => c === 'all' || (p.cat || []).includes(c)).map(p => ({ lat: p.lat, lon: p.lon, label: p.n, sub: p.mn, kind: /disputed|traditional/.test(p.pr) ? 'near' : 'place', go: 'place-' + p.id }));
  let mp = await makeMap($('#amap'), { markers: mk('all'), maxZoom: 9 });
  $('#acats').onclick = async e => { const b = e.target.closest('[data-cat]'); if (!b) return; $$('#acats .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); if (mp.map) mp.map.remove(); mp = await makeMap($('#amap'), { markers: mk(b.dataset.cat), maxZoom: 9 }); };
}

function viewJourneys() {
  setNav('journeys'); document.title = 'Biblical journeys — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><h1>Journeys through Scripture</h1><p>Each route links the places in the order Scripture describes. Lines show sequence, not the exact roads or sea lanes travelled.</p></div></div><div class="grid">${JOURNEYS.map(journeyCard).join('')}</div></div></section>`;
}
async function viewJourney(id) {
  const j = JOURNEYS.find(x => x.id === id); if (!j) return viewNotFound();
  setNav('journeys'); document.title = `${j.n} — Just One More Lord`;
  const stops = j.stops.map((s, i) => ({ p: byId[s[0]], ref: s[1], note: s[2], i })).filter(s => s.p);
  main.innerHTML = `<section class="band"><div class="wrap"><div class="crumbs"><button data-go="journeys">Journeys</button> › ${esc(j.ref)}</div><h1>${esc(j.n)}</h1><p class="lead" style="max-width:70ch">${esc(j.intro)}</p>
    <div class="jlayout" style="margin-top:20px"><div class="mapbox tall" id="jmap"></div><ol class="stops" id="stops">${stops.map(s => `<li><button data-i="${s.i}"><span class="n">${s.i + 1}</span><span><b>${esc(s.p.n)}</b><span>${esc(s.ref)}${s.note ? ' — ' + esc(s.note) : ''}</span></span></button></li>`).join('')}</ol></div>
    <div id="stopcard"></div></div></section>`;
  const seen = {}; const markers = stops.map(s => { const n = (seen[s.p.id] = (seen[s.p.id] || 0) + 1); return { lat: s.p.lat, lon: s.p.lon, label: `${s.i + 1}. ${s.p.n}`, sub: s.ref, kind: 'stop', num: n > 1 ? null : s.i + 1, size: 22, onClick: () => pick(s.i) }; }).filter(m => m.num != null);
  const mp = await makeMap($('#jmap'), { markers, lines: [{ pts: stops.map(s => [s.p.lat, s.p.lon]), color: j.color, weight: 3 }], maxZoom: 9 });
  async function pick(i) {
    const s = stops.find(x => x.i === i); if (!s) return; $$('#stops button').forEach(b => b.setAttribute('aria-current', +b.dataset.i === i));
    const ds = discsFor(s.p.id);
    $('#stopcard').innerHTML = `<div class="stopcard"><div class="ph" id="scph"></div><div class="bd"><p class="kicker">Stage ${i + 1} · ${esc(s.ref)}</p><h2>${esc(s.p.n)}</h2><p>${esc(s.note || '')}</p><p class="muted">${esc(s.p.sum || '')}</p>
      <div class="tags">${prBadge(s.p.pr)}<span class="tag">${(s.p.v || []).length} Bible passages</span><span class="tag">${ds.length} discover${ds.length === 1 ? 'y' : 'ies'}</span></div>
      <div class="linkrow">${refBtn(s.ref, s.note)}<button class="btn sm" data-go="place-${s.p.id}">Explore ${esc(s.p.n)} →</button></div>
      ${ds.length ? `<p class="small" style="margin-top:12px">Discoveries: ${ds.slice(0, 4).map(d => `<button class="inl" data-go="disc-${d.id}">${esc(d.n)}</button>`).join(' · ')}</p>` : ''}</div></div>`;
    if (mp.kind === 'leaflet') mp.map.flyTo([s.p.lat, s.p.lon], Math.max(mp.map.getZoom(), 7), { duration: .6 });
    const im = (await leadImages([s.p.wiki || s.p.n]))[s.p.wiki || s.p.n]; if (im && $('#scph')) $('#scph').innerHTML = `<img src="${esc(im.src)}" alt="${esc(s.p.n)}"><div class="credit" style="position:absolute;left:0;right:0;bottom:0;font-size:11px;padding:14px 8px 5px;background:linear-gradient(transparent,rgba(0,0,0,.8))">${credit(im)}</div>`;
  }
  $('#stops').onclick = e => { const b = e.target.closest('[data-i]'); if (b) { pick(+b.dataset.i); $('#stopcard').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } };
  pick(0);
}

function viewDiscoveries() {
  setNav('discoveries'); document.title = 'Archaeological discoveries — Just One More Lord';
  const kinds = [...new Set(DISCS.map(d => d.kind))].sort();
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><h1>Archaeological discoveries</h1><p>${DISCS.length} documented finds, each graded for how securely it relates to the biblical account. Archaeology can confirm places, people and customs; it rarely proves theological claims, and this catalogue does not present it as doing so.</p></div></div>
    <div class="filters"><label class="sr" for="fq">Filter discoveries</label><input id="fq" type="search" placeholder="Filter by name, place, verse…">
    <label class="sr" for="fs">Evidence grade</label><select id="fs"><option value="">All grades</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${esc(v[0])}</option>`).join('')}</select>
    <label class="sr" for="fr">Relation</label><select id="fr"><option value="">Any relation</option>${Object.entries(RELN).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
    <label class="sr" for="fk">Type</label><select id="fk"><option value="">All types</option>${kinds.map(k => `<option>${esc(k)}</option>`).join('')}</select>
    <label class="sr" for="fo">Sort</label><select id="fo"><option value="date">Oldest first</option><option value="name">A–Z</option><option value="found">Most recently discovered</option></select><span class="small muted" id="fc"></span></div>
    <div class="dlist" id="dall"></div></div></section>`;
  const draw = () => {
    const q = norm($('#fq').value), s = $('#fs').value, r = $('#fr').value, k = $('#fk').value, o = $('#fo').value;
    let list = DISCS.filter(d => (!s || d.status === s) && (!r || d.rel === r) && (!k || d.kind === k) && (!q || norm([d.n, d.found, byId[d.place]?.n, d.verses.join(' '), d.who, d.shows].join(' ')).includes(q)));
    list.sort(o === 'name' ? (a, b) => a.n.localeCompare(b.n) : o === 'found' ? (a, b) => (b.exy || 0) - (a.exy || 0) : (a, b) => a.yr - b.yr);
    $('#fc').textContent = `${list.length} shown`; $('#dall').innerHTML = list.map(discCard).join('') || '<p class="empty">No discoveries match these filters.</p>';
    isLive().then(async live => { const cards = $$('#dall .dcard'); if (!live) { cards.forEach(c => { const n = $('.noimg', c); if (n) n.textContent = 'Photograph loads when online'; }); return; }
      const imgs = await leadImages(cards.map(c => c.dataset.wiki)); for (const c of cards) { const ph = $('.ph', c), im = imgs[c.dataset.wiki]; if (!ph || !c.isConnected) continue; ph.innerHTML = im ? `<img src="${esc(im.src)}" alt="${esc(c.dataset.name)}" loading="lazy"><div class="credit">${credit(im)}</div>` : `<div class="noimg"><a href="${commonsSearchLink(c.dataset.name)}" target="_blank" rel="noopener">Search Commons for a photo ↗</a></div>`; } });
  };
  let t; $('.filters').oninput = () => { clearTimeout(t); t = setTimeout(draw, 160); }; draw();
}

async function doSearch(q) { q = String(q || '').trim(); if (!q) return; state.lastQuery = q; try { sessionStorage.setItem('bpt:q', q); } catch {} $('#q').value = q; hideSugg(); go('search'); }
async function viewSearch() {
  setNav(''); let q = state.lastQuery; if (!q) { try { q = sessionStorage.getItem('bpt:q') || ''; } catch {} }
  document.title = `Search: ${q} — Just One More Lord`;
  const r = searchAll(q);
  const strong = r.places.filter(x => x.s >= 70);
  main.innerHTML = `<section class="band"><div class="wrap"><p class="kicker">Search</p><h1>${esc(q || 'Search')}</h1>
    ${r.places.length && !strong.length ? `<p class="muted">No exact match. Did you mean <button class="inl" data-go="place-${r.places[0].p.id}">${esc(r.places[0].p.n)}</button>?</p>` : ''}
    <h2 style="font-size:28px;margin:26px 0 12px">Places in this atlas</h2><div class="rlist">${r.places.slice(0, 15).map(x => `<button class="ritem" data-go="place-${x.p.id}"><div><b>${esc(x.p.n)}</b><span>${esc(x.p.mn || '')} · ${esc(x.p.sum || '')}</span></div>${prBadge(x.p.pr)}</button>`).join('') || '<p class="empty">No curated place matches. See the wider results below.</p>'}</div>
    ${r.discs.length ? `<h2 style="font-size:28px;margin:30px 0 12px">Discoveries</h2><div class="rlist">${r.discs.slice(0, 10).map(x => `<button class="ritem" data-go="disc-${x.d.id}"><div><b>${esc(x.d.n)}</b><span>${esc(byId[x.d.place]?.n || '')} · ${esc(x.d.date)}</span></div>${stBadge(x.d.status)}</button>`).join('')}</div>` : ''}
    <h2 style="font-size:28px;margin:30px 0 12px">All places named in the Bible <span class="small muted">(OpenBible.info)</span></h2><div id="gazres"></div>
    <h2 style="font-size:28px;margin:30px 0 12px">Wikipedia</h2><div id="wres" class="rlist"><p class="muted"><span class="spin"></span>Searching…</p></div></div></section>`;
  const gr = $('#gazres');
  const showGaz = () => { const res = searchAll(q).gaz.slice(0, 15); gr.innerHTML = res.length ? `<div class="rlist">${res.map(x => `<button class="ritem" data-go="og-${x.g.i}"><div><b>${esc(x.g.f)}</b><span>${esc(x.g.t)} · ${x.g.vc} verse${x.g.vc === 1 ? '' : 's'}${x.g.ll ? '' : ' · location unknown'}</span></div><span class="tag">${x.g.ids > 1 ? x.g.ids + ' proposed sites' : x.g.ll ? 'mapped' : '—'}</span></button>`).join('')}</div>` : '<p class="empty">No further matches in the full index.</p>'; };
  if (state.gaz) showGaz();
  else gr.innerHTML = `<p class="muted small" style="margin-bottom:10px">The full index of every place named in the Bible (about 1,300) can be loaded from OpenBible.info. It is a large download, so it loads only when you ask.</p><button class="btn ghost sm" id="gazbtn">Search all Bible places</button>`;
  $('#gazbtn')?.addEventListener('click', async e => { e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span>Loading index…';
    try { await loadGazetteer((b, n) => { if ($('#gazbtn')) $('#gazbtn').innerHTML = `<span class="spin"></span>${(b / 1048576).toFixed(1)} MB · ${n} places`; }); showGaz(); }
    catch { gr.innerHTML = '<p class="empty">The OpenBible.info index could not be loaded from here. Curated places and Wikipedia results are still available.</p>'; } });
  const w = await wikiSearch(q); const wr = $('#wres'); if (!wr) return;
  wr.innerHTML = w.length ? w.map(x => `<button class="ritem" data-go="w-${encodeURIComponent(x.title)}"><div><b>${esc(x.title)}</b><span>${esc(x.snippet)}</span></div><span class="tag">Wikipedia</span></button>`).join('') : `<p class="empty">${state.live ? 'No Wikipedia results.' : 'Wikipedia search needs a live connection.'}</p>`;
}
async function viewWiki(title) {
  setNav(''); document.title = `${title} — Just One More Lord`;
  main.innerHTML = `<section class="phero"><div class="bg" id="pbg"></div><div class="wrap in"><div class="crumbs"><button data-go="search">Search</button> › Live page</div><h1>${esc(title)}</h1><p class="sub" id="wsub"><span class="spin"></span>Loading from Wikipedia…</p></div></section>
   <section class="sec"><div class="wrap two"><div><p class="notice warn">This page is assembled live from Wikipedia, Wikimedia Commons and Wikidata. It has not been curated, so check claims against the sources.</p><div id="wtext" style="margin-top:14px"></div></div><div><div class="mapbox" id="wmap" style="height:340px"></div><p class="small muted" id="wcoord"></p></div></div></section>
   <section class="sec"><div class="wrap"><h2>Photographs</h2><div id="gal" style="margin-top:14px"></div></div></section>
   <section class="sec"><div class="wrap"><h2>Bible references cited in the article</h2><div id="wrefs" style="margin-top:14px"></div></div></section>`;
  const s = await wikiSummary(title);
  if (!s) { $('#wsub').textContent = 'This page could not be loaded.'; return; }
  $('#wsub').textContent = s.description || '';
  $('#wtext').innerHTML = `<p class="lead">${esc(s.extract)}</p><p><a href="${esc(s.content_urls?.desktop?.page || wikiLink(title))}" target="_blank" rel="noopener">Read the full article on Wikipedia ↗</a> <span class="muted small">CC BY-SA</span></p>`;
  const f = fileFromUrl(s.originalimage?.source || s.thumbnail?.source); if (f) { const im = (await commonsInfo([f], 1600))[f.replace(/_/g, ' ')]; if (im) $('#pbg').innerHTML = `<img src="${esc(im.src)}" alt="">`; }
  const refs = await wikiExtractRefs(s.title);
  $('#wrefs').innerHTML = refs.length ? `<div class="chips">${refs.map(r => `<button class="chip" data-verse="${esc(r)}">${esc(r)}</button>`).join('')}</div><p class="small muted">References found in the text of the Wikipedia article. <a href="https://www.biblegateway.com/quicksearch/?version=WEB&quicksearch=${encodeURIComponent(title.replace(/\s*\(.*\)/, ''))}" target="_blank" rel="noopener">Search the World English Bible for "${esc(title.replace(/\s*\(.*\)/, ''))}" ↗</a></p>` : `<p class="empty">The article cites no verse references. <a href="https://www.biblegateway.com/quicksearch/?version=WEB&quicksearch=${encodeURIComponent(title.replace(/\s*\(.*\)/, ''))}" target="_blank" rel="noopener">Search the World English Bible ↗</a></p>`;
  if (s.coordinates) {
    const c = { lat: s.coordinates.lat, lon: s.coordinates.lon }; $('#wcoord').textContent = `${c.lat.toFixed(4)}° N, ${c.lon.toFixed(4)}° E (Wikipedia coordinates)`;
    const near = PLACES.map(o => ({ o, d: km(c, o) })).filter(x => x.d < 60).sort((a, b) => a.d - b.d).slice(0, 8);
    const mp = await makeMap($('#wmap'), { markers: [{ ...c, label: title, kind: 'main', size: 18 }, ...near.map(x => ({ lat: x.o.lat, lon: x.o.lon, label: x.o.n, kind: 'near', go: 'place-' + x.o.id, sub: x.d.toFixed(0) + ' km' }))], maxZoom: 12 });
    nearbyArchSites(c.lat, c.lon, 10).then(sites => { if (sites.length && $('#wmap')) mp.add(sites.map(x => ({ lat: x.lat, lon: x.lon, label: x.name, kind: 'site', size: 11, url: x.article || 'https://www.wikidata.org/wiki/' + x.q })), 'Archaeological sites'); });
    const [geo, txt] = await Promise.all([commonsGeo(c.lat, c.lon, 3000), commonsSearch(title, 12)]);
    const list = [...new Map([...geo, ...txt].map(i => [i.title, i])).values()].slice(0, 20);
    $('#gal').innerHTML = list.length ? `<div class="gallery">${list.map((im, i) => `<button data-i="${i}"><img src="${esc(im.src)}" alt="${esc(im.desc || im.title)}" loading="lazy"><span class="cap">${esc(im.author)}${im.license ? ' · ' + esc(im.license) : ''}</span></button>`).join('')}</div>` : '<p class="empty">No photographs found.</p>';
    $('#gal').onclick = e => { const b = e.target.closest('[data-i]'); if (b) lightbox(list, +b.dataset.i); };
  } else { $('#wmap').innerHTML = '<p class="empty" style="margin:16px">Wikipedia gives no coordinates for this article.</p>'; const txt = await commonsSearch(title, 12); $('#gal').innerHTML = txt.length ? `<div class="gallery">${txt.map((im, i) => `<button data-i="${i}"><img src="${esc(im.src)}" alt="" loading="lazy"><span class="cap">${esc(im.author)}</span></button>`).join('')}</div>` : '<p class="empty">No photographs found.</p>'; $('#gal').onclick = e => { const b = e.target.closest('[data-i]'); if (b) lightbox(txt, +b.dataset.i); }; }
}
async function viewGaz(id) {
  setNav(''); main.innerHTML = '<div class="loading"><span class="spin"></span>Loading the OpenBible.info index…</div>';
  try { await loadGazetteer(); } catch { main.innerHTML = '<section class="band"><div class="wrap"><p class="empty">The OpenBible.info index is unavailable here.</p></div></section>'; return; }
  const g = state.gaz.find(x => x.i === id); if (!g) return viewNotFound();
  document.title = `${g.f} — Just One More Lord`;
  const c = g.ll ? { lat: g.ll[0], lon: g.ll[1] } : null;
  const near = c ? PLACES.map(o => ({ o, d: km(c, o) })).filter(x => x.d < 80).sort((a, b) => a.d - b.d).slice(0, 8) : [];
  main.innerHTML = `<section class="phero" style="min-height:300px"><div class="bg" id="pbg"></div><div class="wrap in"><div class="crumbs"><button data-go="search">Search</button> › OpenBible.info index</div><h1>${esc(g.f)}</h1><p class="sub">${esc(g.t)}${g.a?.length ? ' · also ' + esc(g.a.join(', ')) : ''}</p></div></section>
   <section class="sec"><div class="wrap two"><div><p class="notice">${g.ids > 1 ? `Scholars have proposed <b>${g.ids}</b> possible locations; the map shows the leading one.` : g.ll ? 'Location shown is the leading identification in the OpenBible.info dataset.' : 'This place has no established location.'} ${g.d ? esc(g.d) : ''}</p>
     <h2 style="margin:22px 0 10px">Every verse that names it <span class="small muted">(${g.vc})</span></h2><div class="chips">${g.v.map(r => `<button class="chip" data-verse="${esc(r)}">${esc(r)}</button>`).join('')}</div>
     <div class="linkrow"><a class="btn ghost sm" href="https://www.openbible.info/geo/" target="_blank" rel="noopener">OpenBible.info Bible geocoding ↗</a>${g.wd ? `<a class="btn ghost sm" href="https://www.wikidata.org/wiki/${esc(g.wd)}" target="_blank" rel="noopener">Wikidata ${esc(g.wd)} ↗</a>` : ''}<a class="btn ghost sm" href="${wikiLink(g.n)}" target="_blank" rel="noopener">Wikipedia ↗</a></div></div>
     <div>${c ? `<div class="mapbox" id="gmap" style="height:360px"></div><p class="small muted">${c.lat.toFixed(4)}° N, ${c.lon.toFixed(4)}° E</p>` : '<p class="empty">No coordinates.</p>'}
     ${near.length ? `<h3 style="margin:18px 0 8px">Nearby places in this atlas</h3><div class="rlist">${near.map(x => `<button class="ritem" data-go="place-${x.o.id}"><div><b>${esc(x.o.n)}</b></div><span class="tag">${x.d.toFixed(0)} km</span></button>`).join('')}</div>` : ''}</div></div></section>
   <section class="sec"><div class="wrap"><h2>Photographs near this location</h2><div id="gal" style="margin-top:14px"></div></div></section>
   <section class="sec"><div class="wrap small muted">Data: OpenBible.info Bible Geocoding Data (CC BY 4.0). Photographs: Wikimedia Commons.</div></section>`;
  if (c) { const mp = await makeMap($('#gmap'), { markers: [{ ...c, label: g.f, kind: 'main', size: 18 }, ...near.map(x => ({ lat: x.o.lat, lon: x.o.lon, label: x.o.n, kind: 'near', go: 'place-' + x.o.id }))], maxZoom: 12 });
    const list = (await commonsGeo(c.lat, c.lon, 2500, 24)).slice(0, 16); $('#gal').innerHTML = list.length ? `<div class="gallery">${list.map((im, i) => `<button data-i="${i}"><img src="${esc(im.src)}" alt="${esc(im.desc || im.title)}" loading="lazy"><span class="cap">${esc(im.author)}</span></button>`).join('')}</div>` : `<p class="empty">${state.live ? 'No geotagged photographs nearby.' : 'Photographs need a live connection.'}</p>`; $('#gal').onclick = e => { const b = e.target.closest('[data-i]'); if (b) lightbox(list, +b.dataset.i); };
    nearbyArchSites(c.lat, c.lon, 8).then(sites => { if (sites.length && $('#gmap')) mp.add(sites.map(x => ({ lat: x.lat, lon: x.lon, label: x.name, kind: 'site', size: 11, url: x.article || 'https://www.wikidata.org/wiki/' + x.q })), 'Archaeological sites'); });
  } else $('#gal').innerHTML = '<p class="empty">No location to search around.</p>';
}
function viewAbout() {
  setNav('about'); document.title = 'About & sources — Just One More Lord';
  const nc = DISCS.reduce((a, d) => (a[d.status] = (a[d.status] || 0) + 1, a), {});
  main.innerHTML = `<section class="band"><div class="wrap prose"><h1>About and sources</h1>
  <p class="lead">Just One More Lord brings together what each biblical place looks like now, where it is, what has been excavated there, and how those finds relate to the biblical text — without overstating what the evidence proves.</p>
  <h3>How the information is built</h3><ul>
  <li><b>Curated core.</b> ${PLACES.length} places, ${DISCS.length} discoveries and ${JOURNEYS.length} journeys were written for this site with coordinates, verse references, timelines and evidence grades (${Object.entries(nc).map(([k, v]) => `${v} ${STATUS[k][0].toLowerCase()}`).join(', ')}). Each discovery links to its Wikipedia article, whose footnotes cite the excavation reports and scholarly publications.</li>
  <li><b>Photographs</b> come live from Wikimedia Commons: images geotagged near each site plus images matching its name. Only freely licensed Commons files are shown, with author and licence.</li>
  <li><b>Maps</b> use Leaflet with OpenStreetMap, Esri World Imagery (satellite) and OpenTopoMap tiles. Nearby archaeological sites are queried live from Wikidata. Street-level imagery links to Mapillary and Google Street View.</li>
  <li><b>Scripture</b> is the World English Bible (public domain), fetched from bible-api.com when you select a reference.</li>
  <li><b>Strong's Concordance.</b> Every Hebrew and Greek word of the Bible, with transliteration, English translation, grammar and Strong's number, comes from STEPBible.org's Translators Amalgamated Hebrew OT and Greek NT (Tyndale House, Cambridge; CC BY 4.0). Definitions are from Strong's dictionaries (1890/1894, public domain; OpenScriptures edition, CC BY-SA). Greek words found only in some manuscripts are marked.</li>
  <li><b>Any other place.</b> The search covers every curated name and spelling variant with fuzzy matching, the OpenBible.info index of about 1,300 places named in the Bible (CC BY 4.0, loaded on request), and Wikipedia.</li></ul>
  <h3>Evidence grades</h3><ul>${Object.entries(STATUS).map(([k, v]) => `<li>${stBadge(k)} — ${esc(v[1])}</li>`).join('')}</ul>
  <p>Relation to Scripture is marked separately: <b>direct</b> (names a biblical person, place or event, or is the place itself), <b>indirect</b> (illuminates an account without naming it) or <b>contextual</b> (background to the biblical world).</p>
  <h3>Limitations</h3><ul><li>Dates for the patriarchs, the Exodus and the conquest are debated; the site gives alternatives rather than choosing one.</li><li>Some locations (Mount Sinai, Bethsaida, Cana, Golgotha) are disputed or traditional and are labelled as such.</li><li>Free services have rate limits: bible-api.com allows about 15 requests per 30 seconds, so loading many verses is paced.</li><li>Automatically found photographs are matched by location and name; occasionally an image shows a nearby place rather than the exact site.</li><li>Live pages built from Wikipedia for uncurated places are not reviewed.</li></ul>
  <h3>Licences</h3><p>Site code: MIT. Curated text: CC BY 4.0. Wikipedia text: CC BY-SA. Commons images: as stated on each image. Wikidata: CC0. OpenBible.info: CC BY 4.0. OpenStreetMap: ODbL. World English Bible: public domain.</p>
  <h3>Corrections</h3><p>Errors in a verse reference, a date or an attribution should be reported with a source. In the source code, every place and discovery lives in plain JavaScript files under <code>data/</code>, so corrections are easy to make.</p></div></section>`;
}
function viewNotFound() { main.innerHTML = `<section class="band"><div class="wrap"><h1>Not found</h1><p>That page does not exist. <button class="inl" data-go="home">Return home</button>.</p></div></section>`; }


/* ---------------- Strong's concordance (STEPBible TAHOT/TAGNT + Strong's dictionary) ---------------- */
const CONC = 'data/concordance/';
const conc = { p: null, lex: null, books: null, byName: {}, byCode: {}, starts: [], occ: {}, text: {} };
const ALIAS = { 'psalm': 'psalms', 'song of songs': 'song of solomon', 'canticles': 'song of solomon' };
async function getLocal(path) { if (conc.text[path]) return conc.text[path]; const r = await fetch(CONC + path); if (!r.ok) throw new Error('Not found: ' + path); const j = await r.json(); conc.text[path] = j; return j; }
function loadConc() {
  if (!conc.p) conc.p = Promise.all(['lex-h.json', 'lex-g.json', 'books.json'].map(f => fetch(CONC + f).then(r => { if (!r.ok) throw new Error('Concordance data missing'); return r.json(); })))
    .then(([h, g, books]) => {
      conc.lex = Object.assign({}, h, g); conc.books = books; let acc = 0;
      books.forEach((b, i) => { const [code, name, counts] = b; const row = { i, code, name, counts, start: acc }; acc += counts.reduce((a, n) => a + n, 0); conc.byName[name.toLowerCase()] = row; conc.byCode[code] = row; conc.starts.push(row); });
      conc.keys = Object.keys(conc.lex); return conc;
    }).catch(e => { conc.p = null; throw e; });
  return conc.p;
}
function vidToRef(vid) {
  let lo = 0, hi = conc.starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (conc.starts[m].start <= vid) lo = m; else hi = m - 1; }
  const b = conc.starts[lo]; let r = vid - b.start, c = 0; while (c < b.counts.length && r >= b.counts[c]) { r -= b.counts[c]; c++; }
  return { book: b, ch: c + 1, v: r + 1, ref: `${b.name} ${c + 1}:${r + 1}` };
}
function parseRef(ref) {
  const m = String(ref).replace(/–/g, '-').match(/^\s*(.+?)\s+(\d+)(?::(\d+)(?:\s*-\s*(\d+)(?::(\d+))?)?)?\s*$/); if (!m) return null;
  const nm = m[1].toLowerCase().replace(/\s+/g, ' '); const b = conc.byName[ALIAS[nm] || nm] || conc.byName[nm.replace(/^(i{1,3})\s/, (x, r) => r.length + ' ')]; if (!b) return null;
  const ch = +m[2], v1 = m[3] ? +m[3] : 1; let v2 = m[3] ? (m[5] ? 999 : (m[4] ? +m[4] : v1)) : 999;
  return { book: b, ch, v1, v2 };
}
const isHeb = k => k[0] === 'H';
const lexOf = k => conc.lex?.[k];
const origSpan = (t, k) => `<span class="${isHeb(k) ? 'heb' : 'grk'}" lang="${isHeb(k) ? 'he' : 'el'}">${esc(t)}</span>`;
const linkStrongs = txt => esc(txt).replace(/\b([HG])(\d{1,4})\b/g, (m, l, n) => `<button class="inl" data-go="strong-${l}${+n}">${l}${+n}</button>`);
const foldLat = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯʼʻʾʿ'’ʼʽᵉ-ᶿ-]/g, '').replace(/[^a-z]/g, '');
const foldOrig = s => String(s || '').normalize('NFD').replace(/[̀-֑ͯ-ׇ]/g, '').replace(/[^Ͱ-Ͽἀ-῿א-ת]/g, '').toLowerCase();
function concSearch(raw) {
  const q = raw.trim(); if (!q) return [];
  const sm = q.match(/^([hg])\s*0*(\d{1,4})$/i); if (sm) { const k = sm[1].toUpperCase() + (+sm[2]); return lexOf(k) ? [{ k, s: 1000 }] : []; }
  const ql = q.toLowerCase().replace(/[^a-z' ]/g, ' ').trim(), STOPW = /^(the|a|an|of|to|in|and|for|with|by|on|at|from|my|his|her|your|our|their|is|be)$/, qw = ql.split(/\s+/).filter(w => w && !STOPW.test(w)), qlat = foldLat(q), qo = foldOrig(q);
  const out = [];
  for (const k of conc.keys) {
    const L = conc.lex[k]; let s = 0;
    if (qo && foldOrig(L[0]) === qo) s += 900;
    if (qlat.length >= 3) { const x = foldLat(L[1]); if (x === qlat) s += 800; else if (x.startsWith(qlat) || (qlat.length >= 4 && dl(qlat, x) <= 1)) s += 400; }
    if (qw.length) {
      const tot = L[9].reduce((a, x) => a + x[1], 0) || 1;
      for (const [w, n] of L[9]) { for (const t of qw) { if (w === t) s += 60 + 120 * n / tot; else if (t.length >= 3 && w.startsWith(t) && w.length - t.length <= 3) s += 20 + 60 * n / tot; } }
      if (qw.length > 1) for (const [p, n] of L[8]) if (p === ql) s += 200 + n;
      const kd = (L[5] + ' ' + L[3]).toLowerCase(); for (const t of qw) if (new RegExp('\\b' + t.replace(/[^a-z']/g, '') + '\\b').test(kd)) s += 25;
    }
    if (s) out.push({ k, s: s + 8 * Math.log10(1 + L[7]) });
  }
  return out.sort((a, b) => b.s - a.s);
}
function strongCard(k, { full = false } = {}) {
  const L = lexOf(k); if (!L) return '';
  const [lemma, xlit, pron, gloss, def, kjv, deriv, n, phr, wds] = L;
  return `<article class="scard"><div class="shead"><div><p class="kicker">Strong's ${isHeb(k) ? 'Hebrew' : 'Greek'} ${esc(k)}</p><div class="lemma">${origSpan(lemma, k)}</div><p class="xl"><b>${esc(xlit)}</b>${pron ? ` · <span class="muted">${esc(pron)}</span>` : ''}${gloss ? ` · “${esc(gloss)}”` : ''}</p></div>
    <div class="scount"><b>${n.toLocaleString()}</b><span>occurrence${n === 1 ? '' : 's'}</span></div></div>
    ${def ? `<p><span class="muted small">Meaning (Strong's):</span> ${linkStrongs(def)}</p>` : ''}
    ${phr?.length ? `<p class="small"><span class="muted">Translated as:</span> ${phr.slice(0, full ? 8 : 5).map(([w, c]) => `<span class="tag">${esc(w)} <b>${c}</b></span>`).join(' ')}</p>` : ''}
    ${full && kjv ? `<p class="small"><span class="muted">KJV renderings (Strong's):</span> ${esc(kjv)}</p>` : ''}
    ${full && deriv ? `<p class="small"><span class="muted">Origin:</span> ${linkStrongs(deriv)}</p>` : ''}
    ${full ? '' : `<div class="linkrow"><button class="btn sm" data-go="strong-${k}">Meaning & all ${n.toLocaleString()} verses →</button></div>`}</article>`;
}
async function viewConcordance() {
  setNav('concordance'); document.title = "Strong's Concordance — Just One More Lord";
  let q = ''; try { q = sessionStorage.getItem('bpt:cq') || ''; } catch {}
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><h1>Strong's Concordance</h1><p>Search an English word to find the Hebrew and Greek words behind it, what they mean and every verse where they occur. You can also search a Strong's number (H7965, G26) or a Hebrew or Greek word (shalom, agape).</p></div></div>
    <form class="bigsearch" id="cform" role="search" style="max-width:760px"><label class="sr" for="cq">Search the concordance</label><input id="cq" type="search" placeholder="love, peace, grace, H7965, logos…" value="${esc(q)}" spellcheck="false"><button class="btn" type="submit">Search</button></form>
    <div class="chips">${['love', 'peace', 'grace', 'faith', 'mercy', 'word', 'spirit', 'H7965', 'G26', 'logos'].map(w => `<button class="chip" data-cq="${w}">${w}</button>`).join('')}</div>
    <div class="filters" style="margin-top:18px"><label class="sr" for="clang">Language</label><select id="clang"><option value="">Hebrew and Greek</option><option value="H">Hebrew (Old Testament)</option><option value="G">Greek (New Testament)</option></select><span class="small muted" id="ccount"></span></div>
    <div id="cres" class="slist"><p class="muted"><span class="spin"></span>Loading the concordance…</p></div></div></section>`;
  try { await loadConc(); } catch { $('#cres').innerHTML = '<p class="empty">The concordance data could not be loaded.</p>'; return; }
  const run = (submitted) => { const v = $('#cq').value.trim(); try { sessionStorage.setItem('bpt:cq', v); } catch {}
    if (!v) { $('#cres').innerHTML = `<p class="muted">Type a word above. The concordance covers ${conc.keys.length.toLocaleString()} Hebrew and Greek words and every word of the Bible.</p>`; $('#ccount').textContent = ''; return; }
    const lang = $('#clang').value; const r = concSearch(v).filter(x => !lang || x.k[0] === lang);
    if (submitted && r.length === 1 && r[0].s >= 1000) { go('strong-' + r[0].k); return; }
    $('#ccount').textContent = r.length ? `${r.length} Hebrew/Greek word${r.length === 1 ? '' : 's'} found` : '';
    $('#cres').innerHTML = r.slice(0, 40).map(x => strongCard(x.k)).join('') || `<p class="empty">No Hebrew or Greek word is translated “${esc(v)}”. Try a shorter or related word.</p>`; };
  $('#cform').onsubmit = e => { e.preventDefault(); run(true); };
  $('#clang').onchange = run;
  main.querySelector('.chips').onclick = e => { const b = e.target.closest('[data-cq]'); if (b) { $('#cq').value = b.dataset.cq; run(true); } };
  run();
}
async function loadOcc(k) { const shard = `occ/${k[0]}-${Math.floor(+k.slice(1) / 250)}.json`; const d = await getLocal(shard); return d[k] || []; }
async function viewStrong(k) {
  k = k.toUpperCase().replace(/^([HG])0*/, '$1'); setNav('concordance');
  main.innerHTML = `<section class="band"><div class="wrap"><div class="crumbs"><button data-go="concordance">Concordance</button> › ${esc(k)}</div><div id="sc"><p class="muted"><span class="spin"></span>Loading…</p></div>
    <h2 style="margin:30px 0 8px">Every occurrence</h2><p class="muted small" id="occnote"></p><div class="filters"><label class="sr" for="obk">Book</label><select id="obk"><option value="">All books</option></select><label class="sr" for="oen">Rendering</label><select id="oen"><option value="">Any translation</option></select></div><div id="occ"></div></div></section>`;
  try { await loadConc(); } catch { $('#sc').innerHTML = '<p class="empty">The concordance data could not be loaded.</p>'; return; }
  const L = lexOf(k); if (!L) { $('#sc').innerHTML = `<p class="empty">${esc(k)} is not a Strong's number in this concordance.</p>`; return; }
  document.title = `${k} ${L[1]} — Strong's Concordance`;
  $('#sc').innerHTML = strongCard(k, { full: true });
  const occ = (await loadOcc(k)).map(([vid, e]) => ({ ...vidToRef(vid), e, vid }));
  const books = [...new Map(occ.map(o => [o.book.code, o.book])).values()];
  const ens = [...new Set(occ.map(o => o.e.toLowerCase()))].map(e => [e, occ.filter(o => o.e.toLowerCase() === e).length]).sort((a, b) => b[1] - a[1]).slice(0, 40);
  $('#obk').innerHTML += books.map(b => `<option value="${b.code}">${esc(b.name)} (${occ.filter(o => o.book.code === b.code).length})</option>`).join('');
  $('#oen').innerHTML += ens.map(([e, c]) => `<option value="${esc(e)}">${esc(e)} (${c})</option>`).join('');
  $('#occnote').textContent = `${occ.length.toLocaleString()} occurrences in ${books.length} book${books.length === 1 ? '' : 's'}. The English shown is how this word is translated in that verse (STEPBible). Select a verse to see it word by word with the World English Bible text.`;
  let limit = 400;
  const draw = () => {
    const bk = $('#obk').value, en = $('#oen').value; const list = occ.filter(o => (!bk || o.book.code === bk) && (!en || o.e.toLowerCase() === en));
    let html = '', cur = null;
    for (const o of list.slice(0, limit)) { if (o.book.code !== cur) { if (cur) html += '</div>'; cur = o.book.code; html += `<h3 class="obk">${esc(o.book.name)}</h3><div class="occs">`; }
      html += `<button class="occ" data-il="${esc(o.ref)}" data-k="${k}"><b>${o.ch}:${o.v}</b> ${esc(o.e)}</button>`; }
    if (cur) html += '</div>';
    if (list.length > limit) html += `<div class="linkrow"><button class="btn ghost sm" id="more">Show more (${(list.length - limit).toLocaleString()} left)</button></div>`;
    $('#occ').innerHTML = html || '<p class="empty">No occurrences for this filter.</p>';
    $('#more')?.addEventListener('click', () => { limit += 800; draw(); });
  };
  $('#obk').onchange = $('#oen').onchange = () => { limit = 400; draw(); }; draw();
}
async function interlinearHTML(ref, hl) {
  await loadConc(); const p = parseRef(ref); if (!p) return '';
  const data = await getLocal(`text/${p.book.code}.${p.ch}.json`);
  const verses = data.filter(([v]) => v >= p.v1 && v <= p.v2).slice(0, 12); if (!verses.length) return '';
  const heb = p.book.i < 39;
  return `<div class="ilin">${verses.map(([v, rows]) => `<div class="ilv"><p class="kicker">${esc(p.book.name)} ${p.ch}:${v} · ${heb ? 'Hebrew' : 'Greek'} word by word</p><div class="words${heb ? ' rtl' : ''}">${rows.map(r => {
    const nums = r[3].split('/').filter(Boolean); const main = (nums.find(x => x.startsWith('{')) || '').replace(/[{}]/g, '');
    const L = lexOf(main);
    return `<div class="w${main && main === hl ? ' hl' : ''}${r[5] ? ' var' : ''}"${r[5] ? ' title="Not in the NA28 critical text (found in other manuscripts such as the Textus Receptus)"' : ''}><div class="o ${heb ? 'heb' : 'grk'}" lang="${heb ? 'he' : 'el'}">${esc(r[0])}</div><div class="t">${esc(r[1])}</div><div class="e">${esc(r[2])}</div>${main && L ? `<button class="sn" data-go="strong-${main}" title="${esc(L[1] + ' — ' + (L[3] || ''))}">${main}</button>` : ''}<div class="m">${esc(r[4])}</div></div>`; }).join('')}</div></div>`).join('')}
    <p class="small muted">Hebrew and Greek text with transliteration, translation and Strong's numbers: STEPBible.org (Tyndale House, CC BY 4.0). Select a Strong's number for its meaning and every occurrence.</p></div>`;
}
async function openInterlinear(ref, hl) {
  const b = openDlg(`<p class="kicker">Interlinear · World English Bible</p><h2>${esc(ref)}</h2><div class="vtext" id="ivt"><span class="spin"></span>Loading verse text…</div><div id="iil" style="margin-top:16px"><p class="muted"><span class="spin"></span>Loading Hebrew/Greek…</p></div>
    <div class="linkrow"><a class="btn ghost sm" href="${gwLink(ref)}" target="_blank" rel="noopener">Read the chapter in context ↗</a></div>`, 'Verse word by word');
  bibleText(ref).then(v => { const e = $('#ivt', b); if (e) e.innerHTML = verseHTML(v); }, () => { const e = $('#ivt', b); if (e) e.innerHTML = '<span class="small muted">English text not available right now; the word-by-word translation is below.</span>'; });
  try { const h = await interlinearHTML(ref, hl); const e = $('#iil', b); if (e) e.innerHTML = h || '<p class="empty">No interlinear text for this reference.</p>'; } catch { const e = $('#iil', b); if (e) e.innerHTML = '<p class="empty">Interlinear data could not be loaded.</p>'; }
}
document.addEventListener('click', e => { const il = e.target.closest('[data-il]'); if (il) { e.preventDefault(); openInterlinear(il.dataset.il, il.dataset.k); } });

/* ---------------- suggestions ---------------- */
const sugg = $('#sugg'); let suggFor = null, suggSel = -1, suggItems = [];
function hideSugg() { sugg.hidden = true; suggSel = -1; }
function attachSuggest(inp) {
  inp.addEventListener('input', () => showSugg(inp));
  inp.addEventListener('keydown', e => {
    if (sugg.hidden || suggFor !== inp) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); suggSel = (suggSel + (e.key === 'ArrowDown' ? 1 : -1) + suggItems.length) % suggItems.length; $$('button', sugg).forEach((b, i) => b.setAttribute('aria-selected', i === suggSel)); }
    else if (e.key === 'Enter' && suggSel > -1) { e.preventDefault(); $$('button', sugg)[suggSel].click(); }
    else if (e.key === 'Escape') hideSugg();
  });
  inp.addEventListener('blur', () => setTimeout(() => { if (suggFor === inp) hideSugg(); }, 200));
}
function showSugg(inp) {
  const q = inp.value.trim(); suggFor = inp;
  if (q.length < 2) return hideSugg();
  const r = searchAll(q, 8);
  let items = [...r.places.slice(0, 6).map(x => ({ sc: x.s, go: 'place-' + x.p.id, t: x.p.n, s: x.p.mn !== x.p.n ? x.p.mn : (x.p.loc || '').split(/[,;.]/)[0], k: 'Place' })),
    ...r.discs.slice(0, 3).map(x => ({ sc: x.s - 1, go: 'disc-' + x.d.id, t: x.d.n, s: byId[x.d.place]?.n, k: 'Discovery' })),
    ...r.gaz.slice(0, 4).map(x => ({ sc: x.s - 2, go: 'og-' + x.g.i, t: x.g.f, s: x.g.t, k: 'All Bible places' }))].sort((a, b) => b.sc - a.sc);
  if (items.length && items[0].sc >= 70) items = items.filter(x => x.sc >= 50);
  const sn = q.match(/^([hg])\s*0*(\d{1,4})$/i);
  if (!sn && /^[a-z' ]{3,30}$/i.test(q) && (items[0]?.sc || 0) < 80) items = [{ conc: q, t: `“${q}” in Hebrew and Greek`, s: "Strong's Concordance: original words and meanings", k: 'Concordance' }, ...items.filter(x => x.sc >= 60).slice(0, 4)];
  suggItems = [...(sn ? [{ go: 'strong-' + sn[1].toUpperCase() + (+sn[2]), t: `Strong's ${sn[1].toUpperCase()}${+sn[2]}`, s: 'Meaning and every occurrence', k: 'Concordance' }] : []), ...items.slice(0, 8),
    ...(!sn && /^[a-z' ]{3,30}$/i.test(q) && (items[0]?.sc || 0) >= 80 ? [{ conc: q, t: `“${q}” in Hebrew and Greek`, s: "Strong's Concordance: original words and meanings", k: 'Concordance' }] : []),
    { search: q, t: `Search everywhere for “${q}”`, s: 'Atlas, full Bible index and Wikipedia', k: '↵' }];
  if (inp.id === 'q') { const f = inp.closest('form'); f.appendChild(sugg); } else { inp.closest('form').style.position = 'relative'; inp.closest('form').appendChild(sugg); }
  sugg.innerHTML = suggItems.map((it, i) => `<button type="button" role="option" aria-selected="false" data-n="${i}"><span><span class="t">${esc(it.t)}</span>${it.s ? `<br><span class="s">${esc(it.s)}</span>` : ''}</span><span class="k">${esc(it.k)}</span></button>`).join('');
  sugg.hidden = false; suggSel = -1;
}
sugg.addEventListener('mousedown', e => e.preventDefault());
sugg.addEventListener('click', e => { const b = e.target.closest('[data-n]'); if (!b) return; const it = suggItems[+b.dataset.n]; hideSugg(); if (it.conc) { try { sessionStorage.setItem('bpt:cq', it.conc); } catch {} suggFor.value = ''; go('concordance'); } else if (it.search) doSearch(it.search); else { suggFor.value = ''; go(it.go); } });
$('#topSearch').addEventListener('submit', e => { e.preventDefault(); doSearch($('#q').value); });
attachSuggest($('#q'));

/* ---------------- router ---------------- */
async function render() {
  const h = decodeURIComponent(location.hash.slice(1) || 'home');
  if (dlg.open) dlg.close(); window.scrollTo(0, 0); main.onclick = null;
  try {
    if (h === 'home' || h === '') await viewHome();
    else if (h.startsWith('place-')) await viewPlace(h.slice(6));
    else if (h.startsWith('disc-')) { const d = discById[h.slice(5)]; d ? await viewPlace(d.place, d.id) : viewNotFound(); }
    else if (h === 'atlas') await viewAtlas();
    else if (h === 'journeys') viewJourneys();
    else if (h.startsWith('journey-')) await viewJourney(h.slice(8));
    else if (h === 'discoveries') viewDiscoveries();
    else if (h === 'search') await viewSearch();
    else if (h === 'about') viewAbout();
    else if (h === 'concordance') await viewConcordance();
    else if (h.startsWith('strong-')) await viewStrong(h.slice(7));
    else if (h.startsWith('w-')) await viewWiki(h.slice(2));
    else if (h.startsWith('og-')) await viewGaz(h.slice(3));
    else if (byId[h]) await viewPlace(h);
    else viewNotFound();
  } catch (err) { console.error(err); main.insertAdjacentHTML('beforeend', `<div class="wrap"><p class="notice warn">Part of this page failed to load (${esc(err.message)}). Try reloading.</p></div>`); }
  main.focus({ preventScroll: true });
}
window.addEventListener('hashchange', render);

/* ---------------- neon finish: cursor spotlight on cards + scroll reveal ---------------- */
document.addEventListener('pointermove', e => { const c = e.target.closest?.('.pcard,.jcard,.ritem,.dcard'); if (!c) return; const r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px'); }, { passive: true });
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const rvIO = new IntersectionObserver(es => { for (const en of es) if (en.isIntersecting) { en.target.classList.add('in'); rvIO.unobserve(en.target); } }, { rootMargin: '0px 0px -8% 0px' });
  const tagRv = () => $$('.band .sh, .pcard, .jcard, .dcard, .legend5>div, .scard, .sec>.wrap', main).forEach(el => { if (el.dataset.rv) return; el.dataset.rv = 1; const r = el.getBoundingClientRect(); if (r.top < innerHeight) return; el.classList.add('rv'); rvIO.observe(el); });
  new MutationObserver(tagRv).observe(main, { childList: true, subtree: true });
}
isLive(); render();
}
