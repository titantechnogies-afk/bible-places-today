/* BIBLE PLACES TODAY — application script (no build step, no API keys).
   Live sources: Wikipedia REST + Action API, Wikimedia Commons API, Wikidata Query Service, bible-api.com (World English Bible),
   OpenStreetMap / Esri / OpenTopoMap tiles via Leaflet, optional OpenBible.info gazetteer. Everything degrades to the
   built-in curated dataset when the network is unavailable. */
/* Guard: slow-loading extras may try to add content next to an element the user has already navigated away from. Skip quietly instead of crashing. */
(() => { const o = Element.prototype.insertAdjacentHTML; Element.prototype.insertAdjacentHTML = function (pos, html) { if ((pos === 'beforebegin' || pos === 'afterend') && !this.parentNode) return; return o.call(this, pos, html); }; })();

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
    desc: strip(m.ImageDescription?.value).slice(0, 260), mime: ii.mime || '', w: ii.thumbwidth || ii.width || 0, h: ii.thumbheight || ii.height || 0 };
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
let W2ID = null;
async function leadImages(titles) {
  const out = {}; titles = titles.filter(Boolean); if (!titles.length) return out;
  const L = window.JOM_IMAGES || {}; if (!W2ID) { W2ID = {}; for (const p of PLACES) { W2ID[p.wiki || p.n] = p.id; W2ID[p.n] = W2ID[p.n] || p.id; } }
  for (const t of titles) { const x = L[W2ID[t]]; if (x) out[t] = { src: x.f, full: x.f, author: x.a, license: x.l, licenseUrl: x.lu, page: x.u, title: t, desc: '', mime: 'image/jpeg' }; }
  titles = titles.filter(t => !out[t]); if (!titles.length || !(await isLive())) return out;
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
async function bibleText(ref, tr = 'web') {
  const key = tr + ':' + ref; const c = store.get(key); if (c) return c;
  if (tr === 'web') { try { const v = await webLocal(ref); if (v) return v; } catch {} }
  if (!(await isLive())) throw new Error('offline');
  const j = await getJSON('https://bible-api.com/' + encodeURIComponent(ref.replace(/–/g, '-').toLowerCase()) + '?translation=' + tr, { cache: false, timeout: 15000 });
  const v = { ref: j.reference || ref, verses: (j.verses || []).map(x => ({ c: x.chapter, v: x.verse, t: String(x.text || '').trim() })), text: j.text };
  store.set(key, v, 90); return v;
}
const WEBC = {};
async function webChapter(code, ch) { const k = code + '.' + ch; if (!WEBC[k]) WEBC[k] = fetch(`data/web/${k}.json`).then(r => { if (!r.ok) throw new Error('no local text'); return r.json(); }).catch(e => { delete WEBC[k]; throw e; }); return WEBC[k]; }
async function webLocal(ref) { await loadConc(); const p = parseRef(ref); if (!p) return null; const rows = await webChapter(p.book.code, p.ch);
  const vs = rows.filter(([v]) => v >= p.v1 && v <= p.v2).map(([v, t]) => ({ c: p.ch, v, t })); if (!vs.length) return null; return { ref, verses: vs, text: vs.map(x => x.t).join(' '), local: 1 }; }
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
async function makeMap(box, { markers = [], lines = [], fitPad = 40, maxZoom = 13, overlays = {}, areas = [] } = {}) {
  const live = await isLive();
  if (live && window.L) return leafletMap(box, { markers, lines, fitPad, maxZoom, overlays, areas });
  return svgMap(box, { markers, lines, areas });
}
function popupHTML(m) { return `<b>${esc(m.label)}</b>${m.sub ? `<br><span>${esc(m.sub)}</span>` : ''}${m.go ? `<br><a href="#${esc(m.go)}">Explore this place →</a>` : ''}${m.url ? `<br><a href="${esc(m.url)}" target="_blank" rel="noopener">Read more ↗</a>` : ''}`; }
function leafletMap(box, { markers, lines, fitPad, maxZoom, overlays, areas = [] }) {
  box.innerHTML = ''; const L = window.L;
  const map = L.map(box, { scrollWheelZoom: false, worldCopyJump: true, zoomControl: true });
  const base = {
    'Night': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'tiles-night', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }),
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
  for (const a of areas) { L.polygon(a.pts, { color: a.color, weight: 2, opacity: .9, fillColor: a.color, fillOpacity: .22, dashArray: a.dash || null }).bindTooltip(a.label, { permanent: !!a.permanent, direction: 'center', className: 'arealbl' }).addTo(map); a.pts.forEach(pt => all.push(pt)); }
  for (const ln of lines) L.polyline(ln.pts, { color: ln.color || '#00d1ff', weight: ln.weight || 3, opacity: .9, dashArray: ln.dash || null }).addTo(map);
  add(markers);
  const ctl = L.control.layers(base, {}, { collapsed: true }).addTo(map);
  const fit = () => { if (all.length === 1) map.setView(all[0], Math.min(maxZoom, 12)); else if (all.length) map.fitBounds(all, { padding: [fitPad, fitPad], maxZoom }); else map.setView([31.8, 35.2], 6); };
  fit(); map.on('focus', () => map.scrollWheelZoom.enable()); map.on('blur', () => map.scrollWheelZoom.disable());
  new ResizeObserver(() => map.invalidateSize()).observe(box);
  return { kind: 'leaflet', map, add(list, name) { const g = add(list, name); ctl.addOverlay(g, name); return g; }, toggle(name, on) { const g = groups[name]; if (!g) return; on ? g.addTo(map) : map.removeLayer(g); }, focus(m, zoom = 11) { map.setView([m.lat, m.lon], zoom); m._mk?.openPopup(); }, fit };
}
function svgMap(box, { markers, lines, areas = [] }) {
  box.innerHTML = '<div class="svgmap"><svg role="img" aria-label="Schematic map"></svg><div class="note">Schematic map (live map tiles unavailable) — positions are true latitude/longitude</div></div>';
  const svg = $('svg', box); const sets = { Places: markers.slice() }; const hidden = new Set(); let focusId = null;
  const draw = () => {
    const W = box.clientWidth || 600, H = box.clientHeight || 400;
    const pts = Object.entries(sets).filter(([k]) => !hidden.has(k)).flatMap(([, v]) => v).concat(lines.flatMap(l => l.pts.map(p => ({ lat: p[0], lon: p[1] }))), areas.flatMap(a => a.pts.map(p => ({ lat: p[0], lon: p[1] }))));
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
    for (const a of areas) { const cx = a.pts.reduce((s, p) => s + X(p[1]), 0) / a.pts.length, cy = a.pts.reduce((s, p) => s + Y(p[0]), 0) / a.pts.length;
      g += `<polygon points="${a.pts.map(p => X(p[1]) + ',' + Y(p[0])).join(' ')}" fill="${a.color}" fill-opacity=".22" stroke="${a.color}" stroke-width="2"/><text x="${cx}" y="${cy}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" paint-order="stroke" stroke="#031019" stroke-width="3">${esc(a.label)}</text>`; }
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
    ${verseTools(ref)}
    ${others.length ? `<h3 style="margin-top:20px">Places in ${esc(ck)}</h3><div class="chips">${others.map(p => `<button class="chip" data-go="place-${p.id}">${esc(p.n)}</button>`).join('')}</div>` : ''}`, 'Bible verse');
  let vtxt = ''; wireVerseTools(b, ref, () => vtxt);
  loadConc().then(() => { const pr = parseRef(ref); if (!pr) return; const ns = graceNotesFor(pr.book.code, pr.ch, pr.v1); if (!ns.length || !b.isConnected) return; $('#vt', b)?.insertAdjacentHTML('afterend', `<details class="gracepanel" open><summary><h3 style="display:inline">Grace lens</h3></summary>${ns.map(n => graceNoteHTML(pr.book, pr.ch, n)).join('')}</details>`); }).catch(() => {});
  b.insertAdjacentHTML('beforeend', '<div id="vil" style="margin-top:18px"><p class="muted small"><span class="spin"></span>Loading the Hebrew/Greek…</p></div>');
  interlinearHTML(ref).then(h => { const e = $('#vil', b); if (e) e.innerHTML = h || ''; }, () => { const e = $('#vil', b); if (e) e.innerHTML = ''; });
  try { const v = await bibleText(ref); vtxt = v.verses.map(x => x.t).join(' ') || v.text || ''; $('#vt', b).innerHTML = verseHTML(v); }
  catch (e) { try { const g = await glossVerse(ref); if (g) { vtxt = g; $('#vt', b).innerHTML = `${esc(g)}<br><span class="small muted">Word-for-word English from the Hebrew/Greek (the World English Bible text needs a connection).</span>`; return; } } catch {}
    $('#vt', b).innerHTML = `<span class="small muted">${e.status === 429 ? 'The free Bible text service is busy (rate limit). Wait a few seconds and try again, or' : 'Verse text could not be loaded here.'} Use the link below to read ${esc(ref)} in the World English Bible.</span>`; }
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
const IMGS = window.JOM_IMAGES || {};
const localImg = id => { const x = IMGS[id]; return x ? { src: x.f, author: x.a, license: x.l, licenseUrl: x.lu, page: x.u, title: '', desc: '' } : null; };
async function fillCardImages(root) {
  const cards = $$('[data-wiki]', root); if (!cards.length) return;
  for (const c of cards) { const id = (c.dataset.go || '').replace(/^place-/, '') || Object.keys(IMGS).find(k => byId[k] && (byId[k].wiki || byId[k].n) === c.dataset.wiki); const im = localImg(id); const ph = $('.ph', c);
    if (im && ph && !$('img', ph)) { const img = new Image(); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = im.src; img.title = 'Photo: ' + (im.author || 'Wikimedia Commons') + (im.license ? ' (' + im.license + ')' : ''); ph.prepend(img); c.dataset.wiki = ''; } }
  if (!$$('[data-wiki]', root).some(c => c.dataset.wiki)) return;
  const imgs = await leadImages(cards.map(c => c.dataset.wiki));
  for (const c of cards) { const im = imgs[c.dataset.wiki]; const ph = $('.ph', c); if (im && ph && !$('img', ph)) { const img = new Image(); img.alt = ''; img.loading = 'lazy'; img.src = im.src; img.title = 'Photo: ' + (im.author || 'Wikimedia Commons') + (im.license ? ' (' + im.license + ')' : ''); ph.prepend(img); } }
}
function discsFor(pid) { return DISCS.filter(d => d.place === pid || (d.also || []).includes(pid)); }
function journeysWith(pid) { return JOURNEYS.filter(j => j.stops.some(s => s[0] === pid)); }
function setNav(name) { $$('.nav button').forEach(b => { if (b.dataset.go === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }); }
function nearest(p, n = 6, maxKm = 120) { return PLACES.filter(o => o.id !== p.id).map(o => ({ o, d: km(p, o) })).filter(x => x.d <= maxKm).sort((a, b) => a.d - b.d).slice(0, n); }

/* ---------------- views ---------------- */
function heroSVG() {
  const rays = Array.from({ length: 18 }, (_, i) => { const a = (-80 + i * 9.4) * Math.PI / 180, b = a + 0.05 + (i % 3) * 0.02, R = 1400;
    return `<path d="M1060 330 L${(1060 + Math.sin(a) * R).toFixed(0)} ${(330 - Math.cos(a) * R).toFixed(0)} L${(1060 + Math.sin(b) * R).toFixed(0)} ${(330 - Math.cos(b) * R).toFixed(0)}Z" opacity="${(0.05 + (i % 4) * 0.03).toFixed(2)}"/>`; }).join('');
  return `<svg viewBox="${innerWidth < 760 ? '640 0 840 800' : '0 0 1600 800'}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#02080d"/><stop offset=".45" stop-color="#0b2430"/><stop offset=".75" stop-color="#6b4a1c"/><stop offset="1" stop-color="#d98d2b"/></linearGradient>
  <radialGradient id="sun" cx="1060" cy="330" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff6d8"/><stop offset=".08" stop-color="#ffd88a" stop-opacity=".95"/><stop offset=".3" stop-color="#ffb347" stop-opacity=".45"/><stop offset="1" stop-color="#ff9a2b" stop-opacity="0"/></radialGradient>
  <filter id="clouds" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".0026 .009" numOctaves="6" seed="7"/><feColorMatrix values="0 0 0 0 .05  0 0 0 0 .1  0 0 0 0 .13  0 0 0 2.6 -1.15"/></filter>
  <filter id="cloudsLit" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".004 .014" numOctaves="5" seed="3"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 .72  0 0 0 0 .35  0 0 0 2.2 -1.1"/></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9 .03" numOctaves="3" seed="2"/><feColorMatrix values="0 0 0 0 .16  0 0 0 0 .1  0 0 0 0 .05  0 0 0 .45 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
  <filter id="blur"><feGaussianBlur stdDeviation="3"/></filter>
  <linearGradient id="rim" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".9"/><stop offset=".12" stop-color="#ffcf7a" stop-opacity="0"/></linearGradient>
  <radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></radialGradient></defs>
  <rect width="1600" height="800" fill="url(#sky)"/>
  <rect width="1600" height="800" fill="url(#sun)"/>
  <g fill="#ffe2a6">${rays}</g>
  <rect width="1600" height="560" filter="url(#cloudsLit)" opacity=".55"/>
  <rect width="1600" height="620" filter="url(#clouds)"/>
  <rect width="1600" height="800" fill="url(#sun)" opacity=".7"/>
  <g fill="#fff">${Array.from({ length: 30 }, (_, i) => `<circle cx="${(i * 397) % 900}" cy="${(i * 131) % 180}" r="${i % 5 ? .7 : 1.3}" opacity=".5"/>`).join('')}</g>
  <path d="M0 660 C220 610 420 640 640 600 S960 560 1110 572 1380 610 1600 590 V800 H0Z" fill="#120c06"/>
  <path d="M640 600 C760 560 900 548 1060 556 C1180 562 1300 590 1420 610" fill="none" stroke="#ffb347" stroke-width="2" opacity=".55" filter="url(#blur)"/>
  <g transform="translate(1060 0)">
    <path d="M-18 150 L18 150 L20 562 L-20 562Z" fill="#0d0805"/>
    <path d="M-128 240 L128 236 L128 268 L-128 272Z" fill="#0d0805"/>
    <path d="M-18 150 L18 150 L20 562 L-20 562Z M-128 240 L128 236 L128 268 L-128 272Z" filter="url(#grain)" fill="#000"/>
    <path d="M-18 150 L18 150 L20 562 L-20 562Z M-128 240 L128 236 L128 268 L-128 272Z" fill="url(#rim)"/>
    <path d="M-18 150 L18 150 M-128 240 L128 236" stroke="#ffd88a" stroke-width="1.5" opacity=".7"/>
  </g>
  <path d="M0 720 C300 680 600 700 900 690 S1400 700 1600 680 V800 H0Z" fill="#070402"/>
  <rect width="1600" height="800" fill="url(#vig)"/></svg>`;
}
/* hero picture: a self-hosted file first (img/hero.webp), else a dramatic cross photo from Wikimedia Commons */
const HERO_FILE = 'img/hero.webp', HERO_CREDIT = 'Image: @wallpaper_233 (TikTok)';
async function heroCrossImage() {
  const local = await new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth > 0); i.onerror = () => r(false); i.src = HERO_FILE; });
  if (local) return { src: HERO_FILE, local: true };
  if (!(await isLive())) return null;
  try { const c = JSON.parse(localStorage.getItem('jom:heroCross') || 'null'); if (c && c.src && Date.now() - c.t < 7 * 864e5) return c; } catch {}
  const OK = /\b(cross|crucifix|calvary|golgotha|kreuz|gipfelkreuz|croix|cruz|krzyż)\b/i, NO = /\b(red cross|grave|gravestone|cemetery|tomb|pharmacy|road|traffic|railway|stitch|swiss|flag|hospital|church interior|necklace|pendant|tattoo|celtic knot|cross-section|crossing)\b/i;
  for (const q of ['Christian cross silhouette sunset', 'wooden cross hill sunset', 'cross silhouette dramatic sky', 'Gipfelkreuz Sonnenuntergang']) {
    try { const j = await getJSON(CAPI + `&action=query&generator=search&gsrnamespace=6&gsrlimit=40&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=1920&iiextmetadatafilter=${META}`);
      const pick = (j?.query?.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0)).map(imgFromInfo)
        .filter(im => goodImg(im) && im.w >= 1400 && im.h && im.w / im.h >= 1.25 && OK.test(im.title) && !NO.test(im.title + ' ' + im.desc))[0];
      if (pick) { try { localStorage.setItem('jom:heroCross', JSON.stringify({ ...pick, t: Date.now() })); } catch {} return pick; }
    } catch {}
  }
  return null;
}
async function viewHome() {
  setNav('home'); document.title = 'Just One More Lord — Explore the world of the Bible';
  const feat = ['jerusalem','bethlehem','nazareth','capernaum','sea-of-galilee','jericho','ephesus','babylon'].map(id => byId[id]);
  main.innerHTML = `
  <section class="hero"><div class="bg">${heroSVG()}</div><div class="credit" id="heroCredit" hidden></div>
    <div class="wrap in"><p class="kicker eyebrow">Just One More Lord</p><img class="herologo" src="img/logo.png" alt="Just One More Lord" width="475" height="597"><h1>Explore the world of <span class="neon-txt">the Bible.</span></h1><div class="orn" aria-hidden="true"><span></span><svg viewBox="0 0 24 24"><path d="M12 3v18M6 9h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span></span></div>
    <p class="lede">A grace-based Bible app: the finished work of Jesus and the love of God, with the places, the evidence and the original words of Scripture.</p>
    <form class="bigsearch" id="bigSearch" role="search"><label class="sr" for="bq">Search for a Bible place</label><input id="bq" type="search" placeholder="Try Capernaum, Ninevah, Sinai, Ephesus…" spellcheck="false"><button class="btn" type="submit">Search</button></form>
    <div class="chips">${['Jerusalem','Bethlehem','Sea of Galilee','Mount Sinai','Golgotha','Corinth','Nineveh'].map(n => `<button class="chip" data-go="place-${PLACES.find(p => p.n.startsWith(n)).id}">${esc(n)}</button>`).join('')}</div></div></section>
  ${graceHomeBand()}
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
  const hb = $('.hero .bg'), im = await heroCrossImage();
  if (im && hb) { const img = new Image(); img.alt = im.local ? 'Jesus walking ahead of his flock of sheep across a sunlit field' : 'The cross'; img.onload = () => { img.classList.add('on'); $('.hero .bg svg')?.remove(); }; img.src = im.src; hb.prepend(img); hb.style.setProperty('--hero-img', `url("${im.src}")`);
    const c = $('#heroCredit'); c.hidden = false; c.innerHTML = im.local ? esc(HERO_CREDIT) : 'Photo: ' + credit(im); }
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
    ${verseTools(ref)}`, 'Verse word by word');
  let vtxt = ''; wireVerseTools(b, ref, () => vtxt);
  bibleText(ref).then(v => { vtxt = v.verses.map(x => x.t).join(' ') || v.text || ''; const e = $('#ivt', b); if (e) e.innerHTML = verseHTML(v); }, () => { const e = $('#ivt', b); if (e) e.innerHTML = '<span class="small muted">English text not available right now; the word-by-word translation is below.</span>'; });
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

/* ======================================================================================
   APP FEATURES: Bible reader, My Library (saved places, verses, highlights, notes, backup),
   verse of the day, reading plans, quizzes, near me, sharing, display settings, install/offline.
   Everything is stored on the device (localStorage); nothing needs an account or an API key.
   ====================================================================================== */
const SITE = 'https://titantechnogies-afk.github.io/bible-places-today/';
const MY = (() => { let d = {}; try { d = JSON.parse(localStorage.getItem('jom:my') || '{}') || {}; } catch {}
  for (const k of ['places', 'verses', 'notes', 'hl', 'plans', 'quiz', 'friends']) if (!d[k] || typeof d[k] !== 'object') d[k] = {}; return d; })();
let saveMy = () => { try { localStorage.setItem('jom:my', JSON.stringify(MY)); } catch {} };
function toast(msg) { let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2400); }
async function shareIt({ title, text = '', hash = '' }) {
  const pm = hash.match(/^place-(.+)$/), jm = hash.match(/^journey-(.+)$/);
  const url = pm ? `${SITE}p/${pm[1]}.html` : jm ? `${SITE}p/journey-${jm[1]}.html` : SITE + (hash ? '#' + hash : '');
  if (navigator.share) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(`${text ? text + '\n' : ''}${url}`); toast('Link copied — paste it anywhere to share'); } catch { prompt('Copy this link:', url); }
}
const ICON = {
  star: f => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9z" fill="${f ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  share: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6h14v-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  note: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h10l4 4v12H5z M14 4v5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`
};
const HLC = [['gold', 'Gold'], ['aqua', 'Aqua'], ['green', 'Green'], ['rose', 'Rose']];

/* ---------- verse tools (added to every verse window) ---------- */
function verseTools(ref) {
  const saved = !!MY.verses[ref];
  return `<div class="vtools" data-ref="${esc(ref)}">
    <button class="pill${saved ? ' on' : ''}" data-act="save" aria-pressed="${saved}">${ICON.star(saved)}<span>${saved ? 'Saved' : 'Save verse'}</span></button>
    <span class="hlrow" role="group" aria-label="Highlight colour">${HLC.map(([c, l]) => `<button class="hl-dot hl-${c}${MY.hl[ref] === c ? ' on' : ''}" data-hl="${c}" aria-label="Highlight ${l}" aria-pressed="${MY.hl[ref] === c}"></button>`).join('')}<button class="hl-dot hl-none" data-hl="" aria-label="Remove highlight">×</button></span>
    <button class="pill" data-act="share">${ICON.share}<span>Share</span></button>
    <button class="pill" data-act="read">Read chapter</button><button class="pill" data-act="cmp">Compare translations</button><button class="pill" data-act="mem">Memorise</button><button class="pill" data-act="cmt">Commentary</button><button class="pill" data-act="pic">Make a picture</button><button class="pill" data-act="journal">✏️ Journal</button><button class="pill" data-act="les">Add to lesson</button></div>
    <label class="notebox"><span class="kicker">My note</span><textarea rows="2" placeholder="Write a thought, prayer or question…" data-note>${esc(MY.notes[ref]?.t || '')}</textarea></label>`;
}
function wireVerseTools(box, ref, getText) {
  const t = $('.vtools', box); if (!t) return;
  t.onclick = async e => {
    const hb = e.target.closest('[data-hl]'); if (hb) { const c = hb.dataset.hl; if (c) MY.hl[ref] = c; else delete MY.hl[ref]; saveMy();
      $$('[data-hl]', t).forEach(b => { b.classList.toggle('on', b.dataset.hl === c && !!c); b.setAttribute('aria-pressed', b.dataset.hl === c && !!c); });
      $$(`.rverse[data-ref="${CSS.escape(ref)}"]`).forEach(v => v.dataset.hl = c || ''); toast(c ? 'Highlighted' : 'Highlight removed'); return; }
    const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
    if (a === 'save') { if (MY.verses[ref]) delete MY.verses[ref]; else MY.verses[ref] = { t: (await getText?.()) || '', d: Date.now() }; saveMy();
      const on = !!MY.verses[ref]; const b = $('[data-act=save]', t); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.innerHTML = `${ICON.star(on)}<span>${on ? 'Saved' : 'Save verse'}</span>`;
      $$(`.rverse[data-ref="${CSS.escape(ref)}"]`).forEach(v => v.classList.toggle('saved', on)); toast(on ? 'Saved to your library' : 'Removed from your library'); }
    if (a === 'share') { const txt = await getText?.(); shareIt({ title: ref, text: `“${(txt || '').slice(0, 240)}” — ${ref} (WEB)`, hash: 'read-' + readHash(ref) }); }
    if (a === 'read') { if (dlg.open) dlg.close(); go('read-' + readHash(ref)); }
    if (a === 'journal') { if (dlg.open) dlg.close(); go('journal-' + encodeURIComponent(ref)); }
    if (a === 'mem') addMemory(ref, (await getText?.()) || '');
    if (a === 'les') lessonAdd({ k: 'verse', ref, t: (await getText?.()) || '' });
    if (a === 'pic') { if (dlg.open) dlg.close(); go('versepic-' + encodeURIComponent(ref)); }
    if (a === 'cmt') { const old = $('.cmtbox', box); if (old) { old.remove(); return; } await loadConc(); const pr = parseRef(ref); if (!pr) return; const c = document.createElement('div'); c.className = 'cmtbox'; c.innerHTML = `<div class="linkrow">${commPicker()}</div><div class="cmtin"><p class="small muted"><span class="spin"></span>Loading commentary…</p></div>`; t.after(c);
      const load = async () => { $('.cmtin', c).innerHTML = await commentaryHTML(pr.book.i, pr.ch, pr.v1); }; $('#commSel', c).onchange = e => { localStorage.setItem('jom:comm', e.target.value); load(); }; load(); }
    if (a === 'cmp') { const old = $('.cmpbox', box); if (old) { old.remove(); return; } const c = document.createElement('div'); c.className = 'cmpbox'; c.innerHTML = '<p class="muted small"><span class="spin"></span>Loading translations…</p>'; t.after(c); c.innerHTML = await compareHTML(ref); }
  };
  const ta = $('[data-note]', box); let tm;
  ta.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { const v = ta.value.trim(); if (v) MY.notes[ref] = { t: v, d: Date.now() }; else delete MY.notes[ref]; saveMy();
    $$(`.rverse[data-ref="${CSS.escape(ref)}"]`).forEach(x => x.classList.toggle('noted', !!v)); checkBadges(); }, 400); };
  addXrefs(box, ref); addDictChips(box, () => { const v = getText?.(); return typeof v === 'string' ? v : ''; });
}
function readHash(ref) { const p = conc.books ? parseRef(ref) : null; if (p) return `${p.book.code}.${p.ch}${/:\d/.test(ref) ? '.' + p.v1 : ''}`; const m = String(ref).match(/^(.+?)\s+(\d+)(?::(\d+))?/); return m ? `${m[1].replace(/\s+/g, '_')}.${m[2]}${m[3] ? '.' + m[3] : ''}` : ''; }

/* ---------- Bible reader ---------- */
const NAMES_SKIP = /^(god|lord|the|sea|river|land|city|mount|valley|east|west|south|north|great|king|salt|tower)$/i;
let placeNameRe = null;
function placesInText(txt) {
  if (!placeNameRe) { const pairs = []; for (const p of PLACES) for (const n of [p.n, p.bn, ...(p.alt || [])].filter(Boolean)) { const nn = String(n).trim(); if (nn.length >= 4 && !NAMES_SKIP.test(nn) && !/[()]/.test(nn)) pairs.push([nn, p.id]); }
    pairs.sort((a, b) => b[0].length - a[0].length); placeNameRe = { re: new RegExp('\\b(' + pairs.map(([n]) => n.replace(/[.*+?^${}|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'g'), map: Object.fromEntries(pairs.map(([n, id]) => [n, id])) }; }
  const found = new Set(); let m; placeNameRe.re.lastIndex = 0; while ((m = placeNameRe.re.exec(txt))) { const id = placeNameRe.map[m[1]]; if (id) found.add(id); } return [...found];
}
async function glossVerse(ref) { await loadConc(); const p = parseRef(ref); if (!p) return ''; const d = await getLocal(`text/${p.book.code}.${p.ch}.json`);
  return d.filter(([v]) => v >= p.v1 && v <= p.v2).map(([, rows]) => rows.map(r => r[2]).filter(Boolean).join(' ').replace(/[<>]/g, '')).join(' '); }
async function chapterText(b, ch) {
  try { const v = await bibleText(`${b.name} ${ch}`, curTr()); if (v.verses.length) return { src: curTr(), verses: v.verses.map(x => ({ v: x.v, t: x.t })) }; } catch {}
  const data = await getLocal(`text/${b.code}.${ch}.json`);
  return { src: 'gloss', verses: data.map(([v, rows]) => ({ v, t: rows.map(r => r[2]).filter(Boolean).join(' ').replace(/\s+([,.;:?!])/g, '$1').replace(/[<>]/g, '') })) };
}
async function viewRead(arg) {
  setNav('read');
  main.innerHTML = `<section class="band"><div class="wrap"><p class="muted"><span class="spin"></span>Opening the Bible…</p></div></section>`;
  try { await loadConc(); } catch { main.innerHTML = `<section class="band"><div class="wrap"><p class="empty">The Bible data could not be loaded.</p></div></section>`; return; }
  const books = conc.starts; let [code, ch, hv] = String(arg || MY.last || 'Jhn.1').split('.');
  let b = conc.byCode[code] || parseRef(String(code).replace(/_/g, ' ') + ' ' + (+ch || 1))?.book || conc.byCode.Jhn;
  ch = Math.min(Math.max(+ch || 1, 1), b.counts.length); hv = +hv || 0;
  MY.last = `${b.code}.${ch}`; saveMy(); document.title = `${b.name} ${ch} — Bible — Just One More Lord`;
  const prev = ch > 1 ? `${b.code}.${ch - 1}` : (b.i > 0 ? `${books[b.i - 1].code}.${books[b.i - 1].counts.length}` : null);
  const next = ch < b.counts.length ? `${b.code}.${ch + 1}` : (b.i < books.length - 1 ? `${books[b.i + 1].code}.1` : null);
  main.innerHTML = `<section class="band reader-band"><div class="wrap">
    <div class="readbar"><label class="sr" for="rbk">Book</label><select id="rbk">${['Old Testament', 'New Testament'].map((g, gi) => `<optgroup label="${g}">${books.filter(x => (x.i >= 39) === !!gi).map(x => `<option value="${x.code}"${x.code === b.code ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}</select>
      <label class="sr" for="rch">Chapter</label><select id="rch">${b.counts.map((_, i) => `<option value="${i + 1}"${i + 1 === ch ? ' selected' : ''}>Chapter ${i + 1}</option>`).join('')}</select>
      <label class="sr" for="rtr">Translation</label><select id="rtr">${TRANS.map(([k, n]) => `<option value="${k}"${k === curTr() ? ' selected' : ''}>${k.toUpperCase()} · ${esc(n)}</option>`).join('')}</select>
      ${readModeBar()}<button class="btn ghost sm" data-go="books-${b.i}">About ${esc(b.name)}</button>
      <button class="btn sm" id="rgl">✝ Grace lens</button><button class="btn ghost sm" data-go="parallel-${b.code}.${ch}">Parallel</button>
      <button class="btn ghost sm" id="rws" aria-pressed="${localStorage.getItem('jom:ws') === '1'}">Word study</button>
      <span class="grow"></span><button class="btn ghost sm" ${prev ? `data-go="read-${prev}"` : 'disabled'} aria-label="Previous chapter">←</button><button class="btn ghost sm" ${next ? `data-go="read-${next}"` : 'disabled'} aria-label="Next chapter">→</button></div>
    <div class="readlayout"><article class="reader"><p class="kicker" id="rsrc">World English Bible</p><h1>${esc(b.name)} <span class="neon-txt">${ch}</span></h1>
      ${writtenLine(b.i)}<p class="small muted">Tap any verse for its Hebrew or Greek words, related verses, to highlight it, save it or add a note.</p>${ttsBar(next)}<div id="rtext"><p class="muted"><span class="spin"></span>Loading the chapter…</p></div>
      <div class="linkrow"><button class="btn ghost sm" ${prev ? `data-go="read-${prev}"` : 'disabled'}>← Previous</button><button class="btn sm" ${next ? `data-go="read-${next}"` : 'disabled'}>Next chapter →</button></div></article>
      <aside class="readside"><details class="gracepanel" open><summary><h2 style="display:inline">Grace lens</h2></summary><div id="rgrace"></div></details><details class="cmtpanel"><summary><h2 style="display:inline">Commentary</h2></summary><div class="linkrow">${commPicker()}</div><div id="rcmt"></div></details><h2>Places in this chapter</h2><div class="mapbox" id="rmap" style="height:320px"></div><div class="chips" id="rplaces"></div></aside></div></div></section>`;
  $('#rgrace').innerHTML = graceHTML(b, ch); fillGraceChapter(); $('#rgl').onclick = () => { const g = $('.gracepanel'); g.open = true; g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; if (localStorage.getItem('jom:gopen') === '0') $('.gracepanel').open = false; $('.gracepanel').addEventListener('toggle', e => localStorage.setItem('jom:gopen', e.target.open ? '1' : '0'));
  $('#rbk').onchange = e => go(`read-${e.target.value}.1`); $('#rch').onchange = e => go(`read-${b.code}.${e.target.value}`);
  const ct = await chapterText(b, ch); const ref = v => `${b.name} ${ch}:${v}`;
  $('#rtr').onchange = e => { localStorage.setItem('jom:tr', e.target.value); localStorage.setItem('jom:ws', '0'); viewRead(`${b.code}.${ch}`); };
  $('#rws').onclick = () => { localStorage.setItem('jom:ws', localStorage.getItem('jom:ws') === '1' ? '0' : '1'); viewRead(`${b.code}.${ch}`); };
  $('#rsrc').textContent = (TRANS.find(t => t[0] === ct.src) || [, 'World English Bible'])[1];
  if (ct.src === 'gloss') $('#rsrc').textContent = 'Word-for-word English (offline) · from the Hebrew/Greek';
  $('#rtext').innerHTML = ct.verses.map(x => `<span class="rverse${MY.verses[ref(x.v)] ? ' saved' : ''}${MY.notes[ref(x.v)] ? ' noted' : ''}" data-ref="${esc(ref(x.v))}" data-hl="${MY.hl[ref(x.v)] || ''}" id="v${x.v}" tabindex="0" role="button"><sup>${x.v}</sup>${esc(x.t)} </span>`).join('');
  $('#rtext').onclick = e => { const v = e.target.closest('.rverse'); if (v) openVerse(v.dataset.ref); };
  wireTTS(); track('readCh', `${b.name} ${ch}`);
  { const det = $('.cmtpanel'); const load = async () => { $('#rcmt').innerHTML = '<p class="small muted"><span class="spin"></span>Loading…</p>'; $('#rcmt').innerHTML = await commentaryHTML(b.i, ch); }; det.addEventListener('toggle', () => { if (det.open && !$('#rcmt').dataset.l) { $('#rcmt').dataset.l = 1; load(); } }); $('#commSel', det).onchange = e => { localStorage.setItem('jom:comm', e.target.value); load(); }; }
  if (localStorage.getItem('jom:ws') === '1') { $('#rsrc').textContent = `Word study · ${b.i < 39 ? 'Hebrew' : 'Greek'} with literal English`; $('.ttsbar')?.remove(); $('#rtext').innerHTML = await wordStudyHTML(b, ch); $('#rtext').onclick = null; }
  $('#rtext').onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('rverse')) { e.preventDefault(); openVerse(e.target.dataset.ref); } };
  if (hv) { const el = $('#v' + hv); if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'center' }); } }
  const key = `${b.name} ${ch}`; const fromRefs = PLACES.filter(p => (p.v || []).some(v => chapterKey(v[0]) === key || chapterKey(v[0]).replace(/^Psalm /, 'Psalms ') === key)).map(p => p.id);
  const ids = [...new Set([...fromRefs, ...placesInText(ct.verses.map(x => x.t).join(' '))])].slice(0, 30); const ps = ids.map(i => byId[i]).filter(Boolean);
  $('#rplaces').innerHTML = ps.length ? ps.map(p => `<button class="chip" data-go="place-${p.id}">${esc(p.n)}</button>`).join('') : '<p class="muted small">No mapped places are named in this chapter.</p>';
  if (ps.length) makeMap($('#rmap'), { markers: ps.map(p => ({ lat: p.lat, lon: p.lon, label: p.n, sub: p.mn, kind: 'place', go: 'place-' + p.id })), maxZoom: 9 }); else $('#rmap').remove();
  markPlanProgress(`${b.name} ${ch}`);
}

/* ---------- My Library ---------- */
function viewLibrary() {
  setNav('library'); document.title = 'My library — Just One More Lord';
  const pl = Object.keys(MY.places).map(id => byId[id]).filter(Boolean);
  const vs = Object.entries(MY.verses).sort((a, b) => b[1].d - a[1].d);
  const hls = Object.entries(MY.hl); const ns = Object.entries(MY.notes).sort((a, b) => b[1].d - a[1].d);
  const plans = Object.entries(MY.plans).map(([id, d]) => [ALLPLANS.find(j => j.id === id), d]).filter(x => x[0]);
  const vbtn = (r, extra = '') => `<button class="ritem" data-verse="${esc(r)}"><div><b>${esc(r)}</b>${extra}</div><span class="tag">Open</span></button>`;
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Saved on this device</p><h1>My library</h1><p>Your saved places, verses, highlights, notes and reading plans. Nothing is uploaded; use the backup below to move them to another phone.</p></div>
    <div class="linkrow"><button class="btn ghost sm" id="bk">Download backup</button><label class="btn ghost sm" for="rs">Restore backup</label><input id="rs" type="file" accept="application/json" hidden></div></div>
    <div class="statrow">${[[pl.length, 'places'], [vs.length, 'verses'], [hls.length, 'highlights'], [ns.length, 'notes'], [plans.length, 'plans']].map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('')}</div>
    <h2 class="libh">My progress</h2>${progressHTML()}
    <div class="linkrow" style="margin-top:14px"><button class="btn sm" data-go="memory">Scripture memory (${Object.keys(MY.mem || {}).length})</button><button class="btn ghost sm" data-go="prayer">Prayer journal</button><button class="btn ghost sm" data-go="plan-year">Bible in a year</button><button class="btn ghost sm" data-go="progress">My Bible progress map</button><button class="btn ghost sm" data-go="journal">My journal</button><button class="btn ghost sm" data-go="wrapped">My year in the Word</button></div>
    <h2 class="libh">Saved places</h2>${pl.length ? `<div class="grid" id="libp">${pl.map(placeCard).join('')}</div>` : '<p class="empty">Tap “Save place” on any place page.</p>'}
    <h2 class="libh">Saved verses</h2>${vs.length ? `<div class="rlist">${vs.map(([r, x]) => vbtn(r, x.t ? `<span>${esc(x.t.slice(0, 160))}${x.t.length > 160 ? '…' : ''}</span>` : '')).join('')}</div>` : '<p class="empty">Tap any verse, then “Save verse”.</p>'}
    <h2 class="libh">Highlights</h2>${hls.length ? `<div class="chips">${hls.map(([r, c]) => `<button class="chip hlchip hl-${c}" data-verse="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : '<p class="empty">No highlights yet.</p>'}
    <h2 class="libh">Notes</h2>${ns.length ? `<div class="rlist">${ns.map(([r, x]) => vbtn(r, `<span>${esc(x.t.slice(0, 220))}</span>`)).join('')}</div>` : '<p class="empty">No notes yet.</p>'}
    <h2 class="libh">Reading plans</h2>${plans.length ? `<div class="rlist">${plans.map(([j, d]) => `<button class="ritem" data-go="plan-${j.id}"><div><b>${esc(j.n)}</b><span>${(d.done || []).length} of ${j.stops.length} days done</span></div><span class="tag">${Math.round(100 * (d.done || []).length / j.stops.length)}%</span></button>`).join('')}</div>` : '<p class="empty">Start a plan from the <button class="inl" data-go="plans">Plans</button> page.</p>'}
    <h2 class="libh">Offline Bible</h2><p class="muted">Save the whole English Bible (World English Bible) plus the Hebrew and Greek with word-by-word English (about 45 MB), so the reader, search and concordance work without signal.</p>
    <div class="linkrow"><button class="btn sm" id="offl">Save the Bible for offline use</button><span class="small muted" id="offp"></span></div></div></section>`;
  fillCardImages($('#libp') || main);
  $('#bk').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(MY, null, 1)], { type: 'application/json' })); a.download = `just-one-more-lord-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };
  $('#rs').onchange = async e => { try { const d = JSON.parse(await e.target.files[0].text()); for (const k of ['places', 'verses', 'notes', 'hl', 'plans', 'quiz']) Object.assign(MY[k], d[k] || {}); if (Array.isArray(d.prayers)) MY.prayers = [...MY.prayers, ...d.prayers.filter(p => !MY.prayers.some(x => x.id === p.id))]; saveMy(); toast('Backup restored'); viewLibrary(); } catch { toast('That file is not a valid backup'); } };
  $('#offl').onclick = async () => { const reg = await navigator.serviceWorker?.ready; if (!reg?.active) { toast('Offline saving needs the installed site — open it online first'); return; }
    await loadConc(); const files = ['lex-h.json', 'lex-g.json']; conc.starts.forEach(b => b.counts.forEach((_, i) => files.push(`text/${b.code}.${i + 1}.json`))); const webs = []; conc.starts.forEach(b => b.counts.forEach((_, i) => webs.push(new URL(`data/web/${b.code}.${i + 1}.json`, location.href).href))); conc.starts.forEach(b => webs.push(new URL(`data/gracech/${b.code}.json`, location.href).href));
    const base = new URL(CONC, location.href).href; navigator.serviceWorker.onmessage = m => { if (m.data?.type === 'cache-progress') { $('#offp') && ($('#offp').textContent = m.data.done >= m.data.total ? 'Saved — the Bible now works offline.' : `Saving… ${Math.round(100 * m.data.done / m.data.total)}%`); } };
    reg.active.postMessage({ type: 'cache-bible', files: [...webs, ...files.map(f => base + f)] }); $('#offp').textContent = 'Starting…'; };
}
function placeTools(p) {
  const on = !!MY.places[p.id];
  return `<div class="ptools"><button class="pill${on ? ' on' : ''}" id="savePlace" aria-pressed="${on}">${ICON.star(on)}<span>${on ? 'Saved' : 'Save place'}</span></button><button class="pill" id="sharePlace">${ICON.share}<span>Share</span></button><button class="pill" data-go="quiz-${p.id}">Quiz</button><button class="pill" data-go="study-${p.id}">Group study</button><button class="pill" data-go="present-place-${p.id}">Present</button><button class="pill" id="lessPlace">Add to lesson</button><button class="pill" data-go="embed">Add to a website</button></div>`;
}
function enhancePlace(id) {
  const p = byId[id]; const host = $('.phero .in'); if (!p || !host || $('.ptools', host)) return; track('visited', id);
  const li = localImg(id), pb = $('#pbg'); if (li && pb && !$('img', pb)) pb.innerHTML = `<img src="${esc(li.src)}" alt="${esc(p.n)} today">`;
  host.insertAdjacentHTML('beforeend', placeTools(p));
  $('#savePlace').onclick = e => { if (MY.places[p.id]) delete MY.places[p.id]; else MY.places[p.id] = Date.now(); saveMy(); const on = !!MY.places[p.id]; const b = e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.innerHTML = `${ICON.star(on)}<span>${on ? 'Saved' : 'Save place'}</span>`; toast(on ? 'Saved to your library' : 'Removed from your library'); };
  $('#lessPlace').onclick = () => lessonAdd({ k: 'place', ref: p.id, t: p.n });
  $('#sharePlace').onclick = () => shareIt({ title: `${p.n} — Just One More Lord`, text: `${p.n}: ${p.sum || ''}`.slice(0, 220), hash: 'place-' + p.id });
}

/* ---------- verse of the day ---------- */
const ALLV = PLACES.flatMap(p => (p.v || []).filter(v => /:\d/.test(v[0])).map(v => ({ ref: v[0], ctx: v[1], p })));
function dayIndex() { const d = new Date(); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 864e5); }
function votd() { const n = ALLV.length; if (!n) return null; let i = ((dayIndex() * 7919) % n + n) % n; return ALLV[i]; }
async function homeVotd() {
  const x = votd(); const feat = $('#feat')?.closest('.band'); if (!x || !feat) return;
  feat.insertAdjacentHTML('beforebegin', `<section class="band votd"><div class="wrap"><div class="votdcard"><div><p class="kicker">Verse of the day · ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${streak() ? ` <span class="streakchip">🔥 ${streak()}-day streak</span>` : ''}</p>
    <blockquote class="vtext" id="votdt"><span class="spin"></span>Loading…</blockquote><p class="votdref"><button class="vref" data-verse="${esc(x.ref)}">${esc(x.ref)}</button> <span class="muted">· ${esc(x.ctx)}</span></p>
    <div class="linkrow"><button class="btn sm" data-go="place-${x.p.id}">Visit ${esc(x.p.n)} →</button><button class="btn ghost sm" data-go="read-${esc(readHash(x.ref))}">Read the chapter</button><button class="btn ghost sm" id="votdShare">${ICON.share} Share</button><a class="btn ghost sm" id="votdCal" download="verse-of-the-day.ics">Daily reminder</a></div></div>
    <button class="votdph" data-go="place-${x.p.id}" data-wiki="${esc(x.p.wiki || x.p.n)}" aria-label="${esc(x.p.n)}"><div class="ph"><div class="mono">${monogram(x.p.n)}</div></div><span>${esc(x.p.n)}</span></button></div></div></section>`);
  fillCardImages($('.votd'));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Just One More Lord//EN', 'BEGIN:VEVENT', 'UID:votd-' + Date.now() + '@justonemorelord', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
    'DTSTART:' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + 'T070000', 'DURATION:PT10M', 'RRULE:FREQ=DAILY', 'SUMMARY:Verse of the day — Just One More Lord', 'DESCRIPTION:Open today\'s verse and place: ' + SITE, 'URL:' + SITE,
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Verse of the day', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  $('#votdCal').href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  let txt = ''; try { const v = await bibleText(x.ref); txt = v.verses.map(y => y.t).join(' ') || v.text; $('#votdt').innerHTML = esc(txt); } catch { try { txt = await glossVerse(x.ref); } catch {} $('#votdt').innerHTML = txt ? esc(txt) : `<span class="muted">${esc(x.ctx)}</span>`; }
  $('#votdShare').onclick = () => shareIt({ title: 'Verse of the day', text: txt ? `“${txt}” — ${x.ref}` : x.ref, hash: 'place-' + x.p.id });
}

/* ---------- reading plans (one day per journey stage) ---------- */
function viewPlans() {
  setNav('plans'); document.title = 'Reading plans — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Read and travel</p><h1>Reading plans</h1><p>Walk through Scripture one stage at a time: each day gives you a passage, the place where it happened and a map. Your progress is saved on this device.</p></div></div>
    <div class="grid">${ALLPLANS.map(j => { const d = MY.plans[j.id]?.done || []; const pc = Math.round(100 * d.length / j.stops.length);
      return `<button class="jcard plancard" data-go="plan-${j.id}"><h3>${esc(j.n)}</h3><p class="muted small" style="margin:0">${j.stops.length} days · ${esc(j.ref)}</p><div class="prog" aria-label="${pc}% complete"><i style="width:${pc}%"></i></div><span class="small">${d.length ? `${d.length} of ${j.stops.length} days done` : 'Start this plan →'}</span></button>`; }).join('')}</div></div></section>`;
}
function viewPlan(id) {
  const j = ALLPLANS.find(x => x.id === id); if (!j) return viewNotFound(); setNav('plans'); document.title = `${j.n} — reading plan`;
  const st = MY.plans[j.id] || (MY.plans[j.id] = { done: [], start: Date.now() }); saveMy();
  const draw = () => { const d = st.done; const nextDay = j.stops.findIndex((_, i) => !d.includes(i)); const pc = Math.round(100 * d.length / j.stops.length);
    main.innerHTML = `<section class="band"><div class="wrap"><div class="crumbs"><button data-go="plans">Plans</button> › ${esc(j.n)}</div><h1>${esc(j.n)}</h1><p class="lead">${esc(j.intro || j.ref)}</p>
      <div class="prog big"><i style="width:${pc}%"></i></div><p class="small muted">${d.length} of ${j.stops.length} days done${nextDay >= 0 ? '' : ' — plan complete! 🎉'}</p>
      <ol class="days">${j.stops.map((s, i) => { const p = byId[s[0]]; return `<li class="${d.includes(i) ? 'done' : ''}${i === nextDay ? ' today' : ''}"><label class="chk"><input type="checkbox" data-day="${i}" ${d.includes(i) ? 'checked' : ''}><span>Day ${i + 1}</span></label>
        <div>${p ? `<b>${esc(p.n)}</b> · ` : ''}${s[3] ? `<b>${esc(s[2])}</b>` : `<button class="vref" data-verse="${esc(s[1])}">${esc(s[1])}</button><p class="muted small">${esc(s[2] || '')}</p>`}
        <div class="linkrow"><button class="btn ghost sm" data-go="read-${esc(readHash(s[1]))}">Read</button>${p ? `<button class="btn ghost sm" data-go="place-${p.id}">The place</button>` : ''}</div></div></li>`; }).join('')}</ol>
      <div class="linkrow">${byId[j.stops[0][0]] ? `<button class="btn ghost sm" data-go="journey-${j.id}">See the whole journey on the map</button><button class="btn ghost sm" data-go="fly-${j.id}">3D fly-over</button>` : ''}<button class="btn ghost sm" id="rstPlan">Restart plan</button></div></div></section>`;
    main.querySelector('.days').onchange = e => { const i = +e.target.dataset.day; if (e.target.checked) { if (!st.done.includes(i)) st.done.push(i); } else st.done = st.done.filter(x => x !== i); saveMy(); draw(); track(); if (e.target.checked) toast(st.done.length === j.stops.length ? 'Plan complete — well done!' : `Day ${i + 1} done`); };
    $('#rstPlan').onclick = () => { if (confirm('Clear your progress for this plan?')) { st.done = []; saveMy(); draw(); } }; };
  draw();
}
function markPlanProgress(chapter) { // reading a plan's chapter in the reader ticks that day
  for (const j of ALLPLANS) { const st = MY.plans[j.id]; if (!st) continue; j.stops.forEach((s, i) => { if ((s[3] ? s[3].includes(chapter) && s[3].every(c => MY.readCh[c] || c === chapter) : chapterKey(s[1]) === chapter) && !st.done.includes(i)) { st.done.push(i); saveMy(); toast(`${j.n}: day ${i + 1} marked as read`); } }); }
}

/* ---------- quizzes ---------- */
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [a[i], a[k]] = [a[k], a[i]]; } return a; };
const pickN = (arr, n, not) => shuffle(arr.filter(x => !not.includes(x))).slice(0, n);
const bookOf = r => (String(r).match(/^(.+?)\s+\d/) || [])[1];
function questionsFor(p) {
  const qs = []; const others = PLACES.filter(o => o.id !== p.id);
  const locOf = o => (o.loc || '').split(/[;.]/)[0].trim();
  if (locOf(p)) { const wrong = [...new Set(others.map(locOf).filter(l => l && l !== locOf(p)))]; if (wrong.length >= 3) qs.push({ q: `Where is ${p.n} today?`, a: locOf(p), o: pickN(wrong, 3, []), go: 'place-' + p.id }); }
  const bks = [...new Set((p.v || []).map(v => bookOf(v[0])).filter(Boolean))];
  if (bks.length) { const allB = [...new Set(ALLV.map(x => bookOf(x.ref)).filter(Boolean))]; const w = pickN(allB, 3, bks); if (w.length === 3) qs.push({ q: `Which book of the Bible mentions ${p.n}?`, a: shuffle(bks)[0], o: w, go: 'place-' + p.id }); }
  const v = shuffle(p.v || [])[0]; if (v && v[1]) { const w = pickN(others.filter(o => o.v?.length).map(o => o.n), 3, [p.n]); qs.push({ q: `Where did this happen? “${v[1]}” (${v[0]})`, a: p.n, o: w, go: 'place-' + p.id }); }
  const ds = discsFor(p.id); if (ds.length) { const d = shuffle(ds)[0]; const w = pickN(DISCS.filter(x => x.place !== p.id).map(x => x.n), 3, [d.n]); if (w.length === 3) qs.push({ q: `Which discovery is connected with ${p.n}?`, a: d.n, o: w, go: 'disc-' + d.id }); }
  const js = journeysWith(p.id); if (js.length) { const w = pickN(JOURNEYS.filter(x => !js.includes(x)).map(x => x.n), 3, []); if (w.length) qs.push({ q: `${p.n} is a stop on which journey?`, a: js[0].n, o: w, go: 'journey-' + js[0].id }); }
  if (p.pr && PREC[p.pr]) qs.push({ q: `How sure are scholars about the location of ${p.n}?`, a: PREC[p.pr][0], o: Object.values(PREC).map(x => x[0]).filter(x => x !== PREC[p.pr][0]), go: 'place-' + p.id });
  return qs;
}
function viewQuiz(id) {
  setNav('quiz'); const p = id ? byId[id] : null;
  let qs = p ? questionsFor(p) : shuffle(PLACES.filter(x => x.v?.length)).slice(0, 14).flatMap(x => shuffle(questionsFor(x)).slice(0, 1)).slice(0, 10);
  qs = qs.map(q => ({ ...q, opts: shuffle([q.a, ...q.o.slice(0, 3)]) }));
  const title = p ? `Quiz: ${p.n}` : 'Bible places quiz'; document.title = title + ' — Just One More Lord';
  let i = 0, score = 0;
  const draw = () => {
    if (i >= qs.length) { const best = MY.quiz[id || 'all'] = Math.max(MY.quiz[id || 'all'] || 0, score); if (score === qs.length) MY.quizPerfect = 1; saveMy(); track();
      main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">${esc(title)}</p><h1>You scored <span class="neon-txt">${score} / ${qs.length}</span></h1><p class="lead">${score === qs.length ? 'Perfect — outstanding!' : score >= qs.length * .7 ? 'Excellent knowledge of the Bible lands.' : 'Good effort — explore the places and try again.'}</p><p class="muted small">Your best: ${best} / ${qs.length}</p>
        <div class="linkrow"><button class="btn" id="again">Play again</button><button class="btn ghost" id="shq">${ICON.share} Challenge a friend</button><button class="btn ghost" data-go="battle">Quiz battle</button>${p ? `<button class="btn ghost" data-go="place-${p.id}">Back to ${esc(p.n)}</button>` : ''}</div></div></section>`;
      $('#again').onclick = () => viewQuiz(id); $('#shq').onclick = () => shareIt({ title, text: `I scored ${score}/${qs.length} on the ${title} — can you beat me?`, hash: id ? 'quiz-' + id : 'quiz' }); return; }
    const q = qs[i];
    main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">${esc(title)} · question ${i + 1} of ${qs.length}</p><div class="prog"><i style="width:${100 * i / qs.length}%"></i></div>
      <h2 class="qq">${esc(q.q)}</h2><div class="qopts">${q.opts.map((o, k) => `<button class="qopt" data-k="${k}">${esc(o)}</button>`).join('')}</div><div id="qfb" aria-live="polite"></div></div></section>`;
    $('.qopts').onclick = e => { const b = e.target.closest('.qopt'); if (!b || $('.qopts').dataset.done) return; $('.qopts').dataset.done = 1; const ok = q.opts[+b.dataset.k] === q.a; if (ok) score++;
      $$('.qopt').forEach(x => { if (q.opts[+x.dataset.k] === q.a) x.classList.add('right'); else if (x === b) x.classList.add('wrong'); x.disabled = true; });
      $('#qfb').innerHTML = `<p class="${ok ? 'notice' : 'notice warn'}">${ok ? 'Correct!' : `The answer is <b>${esc(q.a)}</b>.`} <button class="inl" data-go="${q.go}">Learn more</button></p><div class="linkrow"><button class="btn" id="qn">${i + 1 < qs.length ? 'Next question →' : 'See my score'}</button></div>`;
      $('#qn').onclick = () => { i++; draw(); }; $('#qn').focus(); };
  };
  if (!qs.length) { main.innerHTML = `<section class="band"><div class="wrap"><p class="empty">No quiz is available for this place yet.</p></div></section>`; return; }
  draw();
}

/* ---------- near me ---------- */
function viewNear() {
  setNav(''); document.title = 'Bible places near me — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Travelling?</p><h1>Bible places near me</h1><p>Find the nearest biblical sites to where you are now — useful in Israel, Jordan, Egypt, Turkey, Greece, Italy or anywhere else. Your location stays on your device.</p></div></div>
    <div class="linkrow"><button class="btn" id="locate">Use my location</button></div><div id="nearres" style="margin-top:20px"></div></div></section>`;
  $('#locate').onclick = () => { if (!navigator.geolocation) { $('#nearres').innerHTML = '<p class="empty">This device cannot share its location.</p>'; return; }
    $('#nearres').innerHTML = '<p class="muted"><span class="spin"></span>Finding you…</p>';
    navigator.geolocation.getCurrentPosition(async pos => { const me = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      const list = PLACES.map(p => ({ p, d: km(me, p) })).sort((a, b) => a.d - b.d).slice(0, 12); const fmt = d => d < 10 ? d.toFixed(1) + ' km' : Math.round(d).toLocaleString() + ' km';
      $('#nearres').innerHTML = `<div class="jlayout"><div class="mapbox tall" id="nmap"></div><div class="rlist">${list.map(x => `<button class="ritem" data-go="place-${x.p.id}"><div><b>${esc(x.p.n)}</b><span>${esc(x.p.loc || '')}</span></div><span class="tag">${fmt(x.d)}</span></button>`).join('')}</div></div>`;
      const mp = await makeMap($('#nmap'), { markers: [{ ...me, label: 'You are here', kind: 'main' }, ...list.map(x => ({ lat: x.p.lat, lon: x.p.lon, label: x.p.n, sub: fmt(x.d), kind: 'place', go: 'place-' + x.p.id }))], maxZoom: 11 }); },
    err => { $('#nearres').innerHTML = `<p class="empty">${err.code === 1 ? 'Location permission was declined. Allow location for this site in your browser settings, then try again.' : 'Your location could not be found right now. Try again outdoors or with Wi-Fi on.'}</p>`; }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }); };
}

/* ---------- display settings, install, offline ---------- */
const PREF = (() => { try { return JSON.parse(localStorage.getItem('jom:pref') || '{}') || {}; } catch { return {}; } })();
function applyPrefs() { const r = document.documentElement; r.style.setProperty('--fs', PREF.size || 1); r.dataset.contrast = PREF.hc ? 'high' : ''; r.dataset.motion = PREF.rm ? 'reduce' : '';
  const th = PREF.theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : '') : PREF.theme === 'light' ? 'light' : ''; r.dataset.theme = th;
  const tc = $('meta[name="theme-color"]'); if (tc) tc.content = th === 'light' ? '#f3fbfd' : '#020a10'; const lt = $('#ltTog'); if (lt) lt.checked = th === 'light';
  $$('#aaPanel [data-size]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.size === +(PREF.size || 1)))); const hc = $('#hcTog'), rm = $('#rmTog'); if (hc) hc.checked = !!PREF.hc; if (rm) rm.checked = !!PREF.rm; }
function savePrefs() { try { localStorage.setItem('jom:pref', JSON.stringify(PREF)); } catch {} applyPrefs(); }
(() => { const btn = $('#aaBtn'), pan = $('#aaPanel'); if (!btn) return; applyPrefs();
  btn.onclick = e => { e.stopPropagation(); pan.hidden = !pan.hidden; btn.setAttribute('aria-expanded', !pan.hidden); };
  document.addEventListener('click', e => { if (!pan.hidden && !e.target.closest('.tools')) { pan.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  pan.onclick = e => { const s = e.target.closest('[data-size]'); if (s) { PREF.size = +s.dataset.size; savePrefs(); } };
  $('#hcTog').onchange = e => { PREF.hc = e.target.checked; savePrefs(); }; const lt = $('#ltTog'); if (lt) lt.onchange = e => { PREF.theme = e.target.checked ? 'light' : 'dark'; savePrefs(); };
  try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (PREF.theme === 'auto') applyPrefs(); }); } catch {} $('#rmTog').onchange = e => { PREF.rm = e.target.checked; savePrefs(); };
  let deferred = null; const ib = $('#installBtn');
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; ib.hidden = false; showInstallBanner(); });
  ib.onclick = async () => { if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; ib.hidden = true; } };
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
  function showInstallBanner() { if (document.documentElement.classList.contains('embed') || window.top !== window || localStorage.getItem('jom:noinstall') || matchMedia('(display-mode: standalone)').matches || $('#instb')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="instb" id="instb" role="dialog" aria-label="Install the app"><img src="icons/app-192.png" alt=""><div><b>Install Just One More Lord</b><span>${ios ? 'Tap the Share button, then “Add to Home Screen”.' : 'Add it to your home screen — it works offline too.'}</span></div>${ios ? '' : '<button class="btn sm" id="instgo">Install</button>'}<button class="dx" id="instx" aria-label="Not now">×</button></div>`);
    $('#instgo')?.addEventListener('click', () => { ib.click(); $('#instb')?.remove(); }); $('#instx').onclick = () => { localStorage.setItem('jom:noinstall', 1); $('#instb').remove(); }; }
  if (ios) setTimeout(showInstallBanner, 20000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();

/* ======================================================================================
   STAGE 2: Bible timeline, family tree, group study, chapter reading plans, then & now, 3D fly-overs.
   ====================================================================================== */
const TL = window.JOM_TIMELINE || [], FAM = window.JOM_FAMILY || [];
const LANES = [['em', 'Empires'], ['ld', 'Leaders & kings'], ['pr', 'Prophets'], ['ev', 'Events']];
const yrLbl = y => y < 0 ? `${-y} BC` : `AD ${y || 1}`;
function viewTimeline() {
  setNav('timeline'); document.title = 'Bible timeline — Just One More Lord';
  let pxy = +(localStorage.getItem('jom:tlz') || 0.5); const Y0 = -2100, Y1 = 110;
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">From Abraham to Revelation</p><h1>Bible timeline</h1><p>Empires, kings, prophets and events side by side. Zoom in, scroll sideways and tap anything to read about it. Dates are approximate; items marked ≈ are debated.</p></div>
    <div class="linkrow"><button class="btn ghost sm" data-go="chronology">From Adam to today</button><button class="btn ghost sm" data-go="feasts">Feasts</button><button class="btn ghost sm" data-go="kingdoms">Kingdom maps</button><button class="btn ghost sm" id="tlout" aria-label="Zoom out">−</button><button class="btn ghost sm" id="tlin" aria-label="Zoom in">+</button><button class="btn sm" data-go="family">Family tree</button></div></div>
    <div class="chips" id="tljump">${[['Patriarchs', -2000], ['Exodus', -1460], ['Judges', -1380], ['Kings', -1060], ['Exile', -620], ['Return', -545], ['Jesus', -10], ['Apostles', 30]].map(([l, y]) => `<button class="chip" data-y="${y}">${l}</button>`).join('')}</div>
    </div><div class="tlwrap" id="tlw" tabindex="0" aria-label="Timeline, scroll sideways"><div class="tlin" id="tli"></div></div>
    <div class="wrap"><h2 class="libh">The story in order</h2><ol class="tllist">${TL.filter(r => r[3] === 'ev' || r[3] === 'ld').slice().sort((a, b) => a[0] - b[0]).map(r => `<li><span class="yr">${r[7] ? '≈ ' : ''}${yrLbl(r[0])}</span><button class="inl" data-tl="${TL.indexOf(r)}">${esc(r[2])}</button>${r[4] ? ` <button class="vref sm" data-verse="${esc(r[4])}">${esc(r[4])}</button>` : ''}</li>`).join('')}</ol></div></section>`;
  const draw = () => {
    const W = (Y1 - Y0) * pxy, X = y => (y - Y0) * pxy; let html = `<div class="tlaxis" style="width:${W}px">`;
    const step = pxy >= 2 ? 50 : pxy >= 1 ? 100 : 200;
    for (let y = Math.ceil(Y0 / step) * step; y <= Y1; y += step) html += `<span style="left:${X(y)}px">${y === 0 ? 'BC | AD' : yrLbl(y)}</span>`;
    html += '</div>';
    for (const [lane, lbl] of LANES) {
      const rows = TL.map((r, i) => [r, i]).filter(([r]) => r[3] === lane); const ends = [];
      const items = rows.map(([r, i]) => { const x = X(r[0]), w = Math.max(r[1] != null ? (r[1] - r[0]) * pxy : 0, 8); const lab = r[2].length * 7.8 + 22, est = (lane === 'em' || lane === 'ld') ? Math.max(w, lab) : w + 6 + lab;
        let row = ends.findIndex(e => e < x - 4); if (row < 0) { row = ends.length; ends.push(0); } ends[row] = x + est;
        return `<button class="tli ${lane}${r[1] == null ? ' pt' : ''}" data-tl="${i}" style="left:${x}px;top:${row * 38}px;--w:${w}px" title="${esc(r[2])} (${yrLbl(r[0])}${r[1] != null ? '–' + yrLbl(r[1]) : ''})"><i></i><span>${r[7] ? '≈ ' : ''}${esc(r[2])}</span></button>`; });
      html += `<div class="tllane" style="width:${W}px;height:${Math.max(1, ends.length) * 38 + 8}px"><b class="tlname">${lbl}</b>${items.join('')}</div>`;
    }
    $('#tli').innerHTML = html;
  };
  const zoom = f => { const w = $('#tlw'); const mid = (w.scrollLeft + w.clientWidth / 2) / pxy + Y0; pxy = Math.min(6, Math.max(0.25, pxy * f)); localStorage.setItem('jom:tlz', pxy); draw(); w.scrollLeft = (mid - Y0) * pxy - w.clientWidth / 2; };
  $('#tlin').onclick = () => zoom(1.6); $('#tlout').onclick = () => zoom(1 / 1.6);
  $('#tljump').onclick = e => { const b = e.target.closest('[data-y]'); if (b) $('#tlw').scrollTo({ left: (+b.dataset.y - Y0) * pxy - 20, behavior: 'smooth' }); };
  draw();
}
document.addEventListener('click', e => { const t = e.target.closest('[data-tl]'); if (!t) return; e.preventDefault(); const r = TL[+t.dataset.tl]; if (!r) return; const p = byId[r[5]];
  openDlg(`<p class="kicker">${r[7] ? 'Approximate · debated · ' : 'Approximate · '}${yrLbl(r[0])}${r[1] != null ? ' – ' + yrLbl(r[1]) : ''}</p><h2>${esc(r[2])}</h2><p class="lead">${esc(r[6] || '')}</p>
    <div class="linkrow">${r[4] ? `<button class="btn sm" data-verse="${esc(r[4])}">Read ${esc(r[4])}</button>` : ''}${p ? `<button class="btn ghost sm" data-go="place-${p.id}">Visit ${esc(p.n)}</button>` : ''}</div>`, r[2]); });

/* ---------- family tree ---------- */
function viewFamily() {
  setNav('timeline'); document.title = 'Family tree from Adam to Jesus — Just One More Lord';
  const kids = {}; FAM.forEach(r => { (kids[r[2]] ||= []).push(r); });
  const node = (r, depth) => { const ch = kids[r[0]] || []; const main = r[5]; const open = main || depth < 1;
    return `<li class="fnode${main ? ' main' : ''}" data-name="${esc(r[1].toLowerCase())}"><div class="fcard"><b>${esc(r[1])}</b>${r[4] ? `<span>${esc(r[4])}</span>` : ''}<span class="frow">${r[3] ? `<button class="vref sm" data-verse="${esc(r[3])}">${esc(r[3])}</button>` : ''}${ch.length ? `<button class="ftog" aria-expanded="${open}">${ch.length} ${ch.length === 1 ? 'child' : 'children'}</button>` : ''}</span></div>${ch.length ? `<ul${open ? '' : ' hidden'}>${ch.sort((a, b) => (a[5] || 0) - (b[5] || 0)).map(c => node(c, depth + 1)).join('')}</ul>` : ''}</li>`; };
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Genesis 5 & 11 · Ruth 4 · Matthew 1 · Luke 3</p><h1>Family tree: Adam to Jesus</h1><p>The highlighted line runs from Adam to Jesus as Genesis, Ruth and Matthew record it. Tap “children” to open other branches — the twelve tribes, Moses and Aaron, Lot and more.</p></div>
    <div class="linkrow"><button class="btn ghost sm" data-go="timeline">Timeline</button></div></div>
    <div class="filters"><label class="sr" for="fq">Find a person</label><input id="fq" type="search" placeholder="Find a person — e.g. Ruth, Boaz, Levi" style="flex:1;max-width:420px"><button class="btn ghost sm" id="fall">Open all</button><button class="btn ghost sm" id="fmain">Main line only</button></div>
    <ul class="ftree">${(kids[null] || kids['null'] || []).map(r => node(r, 0)).join('')}</ul></div></section>`;
  const tree = $('.ftree');
  tree.onclick = e => { const t = e.target.closest('.ftog'); if (!t) return; const ul = t.closest('li').querySelector(':scope > ul'); ul.hidden = !ul.hidden; t.setAttribute('aria-expanded', !ul.hidden); };
  const setAll = (fn) => $$('.fnode', tree).forEach(li => { const ul = li.querySelector(':scope > ul'); if (ul) { ul.hidden = !fn(li); const t = li.querySelector(':scope > .fcard .ftog'); t && t.setAttribute('aria-expanded', !ul.hidden); } });
  $('#fall').onclick = () => setAll(() => true); $('#fmain').onclick = () => setAll(li => li.classList.contains('main'));
  $('#fq').oninput = e => { const q = e.target.value.trim().toLowerCase(); $$('.fnode', tree).forEach(li => li.classList.remove('hit')); if (q.length < 2) return;
    const hits = $$('.fnode', tree).filter(li => li.dataset.name.includes(q)); hits.forEach(li => { li.classList.add('hit'); let p = li.parentElement; while (p && p !== tree) { if (p.tagName === 'UL') p.hidden = false; p = p.parentElement; } });
    hits[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
}

/* ---------- group study (printable, shareable) ---------- */
function viewStudy(id) {
  const p = byId[id]; if (!p) return viewNotFound(); setNav(''); document.title = `Group study: ${p.n} — Just One More Lord`;
  const vs = (p.v || []).slice(0, 3); const ds = discsFor(p.id).slice(0, 2); const js = journeysWith(p.id);
  const qs = [`Read ${vs.map(v => v[0]).join(', ') || 'the passages'} aloud. What happens at ${p.n}? Who is there, and what do they do?`,
    vs[0] ? `${vs[0][1]} — what does this show us about God's character?` : `Why do you think ${p.n} matters in the Bible's story?`,
    `Look at the map. What would it have been like to live in or travel to ${p.n}?`,
    ds.length ? `Archaeologists found “${ds[0].n}”. How does knowing the real place help you read the Bible?` : `What does ${p.n} look like today? What has changed, and what has stayed the same?`,
    `What is one thing from this passage you want to remember or put into practice this week?`];
  main.innerHTML = `<section class="band study"><div class="wrap prose"><div class="crumbs noprint"><button data-go="place-${p.id}">${esc(p.n)}</button> › Group study</div>
    <p class="kicker">Small group study · about 45 minutes</p><h1>${esc(p.n)}</h1><p class="lead">${esc(p.sum || '')}</p>
    <div class="linkrow noprint"><button class="btn sm" onclick="print()">Print or save as PDF</button><button class="btn ghost sm" id="stsh">${ICON.share} Send to the group</button></div>
    <h3>1 · Open (5 min)</h3><p>Pray together. Ask: <i>Have you ever visited a place that made a story come alive?</i></p>
    <h3>2 · Read (10 min)</h3><div class="verses">${vs.map(v => `<div class="verse"><div class="row"><button class="vref" data-verse="${esc(v[0])}">${esc(v[0])}</button><span>${esc(v[1])}</span></div><div class="vtext stv" data-ref="${esc(v[0])}"></div></div>`).join('')}</div>
    <h3>3 · See the place (10 min)</h3><div class="mapbox" id="stmap" style="height:300px"></div><p>${esc((p.vis || p.hist || '').slice(0, 420))}</p>
    ${ds.length ? `<p><b>Archaeology:</b> ${ds.map(d => `${esc(d.n)} (${esc(STATUS[d.status]?.[0] || d.status)})`).join('; ')}.</p>` : ''}${js.length ? `<p><b>Journeys:</b> ${js.map(j => esc(j.n)).join(', ')}.</p>` : ''}
    <h3>4 · Discuss (15 min)</h3><ol>${qs.map(q => `<li>${esc(q)}</li>`).join('')}</ol>
    <h3>5 · Pray and go (5 min)</h3><p>Pray for one another, and for the people who live in ${esc((p.loc || p.n).split(/[,;.]/)[0])} today.</p>
    <p class="small muted">From Just One More Lord · ${SITE}p/${p.id}.html</p></div></section>`;
  $('#stsh').onclick = () => shareIt({ title: `Group study: ${p.n}`, text: `This week's group study: ${p.n}`, hash: 'study-' + p.id });
  makeMap($('#stmap'), { markers: [{ lat: p.lat, lon: p.lon, label: p.n, kind: 'main' }, ...nearest(p, 5, 60).map(x => ({ lat: x.o.lat, lon: x.o.lon, label: x.o.n, kind: 'near', go: 'place-' + x.o.id }))], maxZoom: 10 });
  $$('.stv').forEach(async el => { try { const v = await bibleText(el.dataset.ref); el.innerHTML = verseHTML(v); } catch { try { const g = await glossVerse(el.dataset.ref); el.textContent = g; } catch {} } });
}

/* ---------- chapter reading plans ---------- */
const chapters = (book, from, to, note = '') => Array.from({ length: to - from + 1 }, (_, i) => [null, `${book} ${from + i}`, note]);
const EXTRA_PLANS = [
  { id: 'john21', n: 'The Gospel of John in 21 days', ref: 'John 1–21', intro: 'Meet Jesus through the eyes of the beloved disciple, one chapter a day.', stops: chapters('John', 1, 21) },
  { id: 'mark16', n: 'Mark in 16 days', ref: 'Mark 1–16', intro: 'The fastest-moving Gospel — perfect for a first read.', stops: chapters('Mark', 1, 16) },
  { id: 'acts28', n: 'Walk with Paul: Acts in 28 days', ref: 'Acts 1–28', intro: 'From Jerusalem to Rome: the church spreads across the Roman world. The places in each chapter appear on the map as you read.', stops: chapters('Acts', 1, 28) },
  { id: 'genesis50', n: 'Genesis in 50 days', ref: 'Genesis 1–50', intro: 'Creation, the flood, and the journeys of Abraham, Isaac, Jacob and Joseph.', stops: chapters('Genesis', 1, 50) },
  { id: 'psalms30', n: '30 Psalms of hope', ref: 'Psalms', intro: 'A Psalm a day for comfort and praise.', stops: [1, 4, 8, 16, 19, 23, 27, 30, 31, 32, 34, 37, 40, 42, 46, 51, 62, 63, 84, 90, 91, 96, 100, 103, 112, 116, 121, 139, 145, 150].map(n => [null, `Psalms ${n}`, '']) }
];
const ALLPLANS = [...JOURNEYS, ...EXTRA_PLANS];

/* ---------- then & now (historic photograph vs today) ---------- */
async function thenAndNow(p) {
  if (!(await isLive())) return; const host = $('#s-photos'); if (!host || $('#tnn')) return;
  const name = p.wiki || p.n; const OLD = /(18[4-9]\d|19[0-3]\d|photochrom|american colony|bonfils|frith|matson|g\. ?eric|antique|historic|old photograph)/i;
  let old = null;
  for (const q of [`${p.n} photochrom`, `${p.n} American Colony`, `${p.n} 1890`, `${p.n} 19th century photograph`]) {
    const r = (await commonsSearch(q, 30)).filter(im => OLD.test(im.title + ' ' + im.desc) && new RegExp(p.n.split(/[\s(]/)[0], 'i').test(im.title + ' ' + im.desc));
    if (r.length) { old = r[0]; break; } }
  if (!old) return; const now = (await leadImages([name]))[name]; if (!now) return;
  host.insertAdjacentHTML('afterend', `<section class="sec" id="tnn"><div class="wrap"><div class="sh"><div><h2>Then and now</h2><p>Drag the slider to compare an early photograph of ${esc(p.n)} with the place today.</p></div></div>
    <div class="tnn"><img src="${esc(now.src)}" alt="${esc(p.n)} today"><div class="tnn-old"><img src="${esc(old.src)}" alt="${esc(p.n)} in an early photograph"></div><i class="tnn-bar"></i><span class="tnn-l">Then</span><span class="tnn-r">Now</span>
    <input type="range" min="0" max="100" value="50" aria-label="Compare then and now"></div><p class="small muted">Then: ${credit(old)} · Now: ${credit(now)}</p></div></section>`);
  const box = $('.tnn'); const upd = v => box.style.setProperty('--x', v + '%'); $('input', box).oninput = e => upd(e.target.value); upd(50);
}

/* ---------- 3D fly-overs (MapLibre GL, free terrain and imagery, no keys) ---------- */
let mlP = null;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mlP) return mlP;
  const add = (tag, attrs) => new Promise((res, rej) => { const el = document.createElement(tag); Object.assign(el, attrs); el.onload = res; el.onerror = rej; document.head.append(el); });
  const V = '4.7.1', tryFrom = base => Promise.all([add('link', { rel: 'stylesheet', href: base + 'maplibre-gl.css' }), add('script', { src: base + 'maplibre-gl.js' })]);
  mlP = tryFrom(`https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/${V}/`).catch(() => tryFrom(`https://unpkg.com/maplibre-gl@${V}/dist/`)).then(() => window.maplibregl).catch(e => { mlP = null; throw e; });
  return mlP;
}
async function viewFly(id) {
  const j = ALLPLANS.find(x => x.id === id && x.stops?.[0]?.[0]) || JOURNEYS[0]; setNav('journeys'); document.title = `3D fly-over: ${j.n} — Just One More Lord`;
  const stops = j.stops.map(s => ({ p: byId[s[0]], ref: s[1], note: s[2] })).filter(s => s.p);
  main.innerHTML = `<section class="flywrap"><div id="fly" class="flymap" role="region" aria-label="3D map"></div>
    <div class="flyhud"><div class="crumbs"><button data-go="journey-${j.id}">${esc(j.n)}</button> › 3D fly-over</div><p class="kicker" id="flyn">Stage 1 of ${stops.length}</p><h2 id="flyt">${esc(stops[0]?.p.n || '')}</h2><p id="flyd" class="small"></p>
      <div class="linkrow"><button class="btn ghost sm" id="flyprev" aria-label="Previous stage">←</button><button class="btn sm" id="flyplay">▶ Play</button><button class="btn ghost sm" id="flynext" aria-label="Next stage">→</button><button class="btn ghost sm" id="flyread">Read</button></div>
      <div class="chips" id="flyj">${JOURNEYS.map(x => `<button class="chip" data-go="fly-${x.id}" aria-pressed="${x.id === j.id}">${esc(x.n)}</button>`).join('')}</div></div></section>`;
  const setInfo = i => { const s = stops[i]; $('#flyn').textContent = `Stage ${i + 1} of ${stops.length}`; $('#flyt').textContent = s.p.n; $('#flyd').textContent = `${s.ref}${s.note ? ' — ' + s.note : ''}`; $('#flyread').onclick = () => openVerse(s.ref); };
  setInfo(0);
  let ml; try { if (!(await isLive())) throw 0; ml = await loadMapLibre(); } catch { $('#fly').innerHTML = '<p class="empty" style="margin:20px">The 3D map needs an internet connection. Showing the flat map instead.</p><div class="mapbox tall" id="flyflat"></div>';
    makeMap($('#flyflat'), { markers: stops.map((s, i) => ({ lat: s.p.lat, lon: s.p.lon, label: `${i + 1}. ${s.p.n}`, kind: 'stop', num: i + 1, go: 'place-' + s.p.id })), lines: [{ pts: stops.map(s => [s.p.lat, s.p.lon]), color: j.color }] }); return; }
  let map; try { map = new ml.Map({ container: 'fly', pitch: 60, bearing: 0, center: [stops[0].p.lon, stops[0].p.lat], zoom: 7, maxPitch: 80, attributionControl: { compact: true },
    style: { version: 8, sources: {
      sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, encoding: 'terrarium', maxzoom: 14, attribution: 'Terrain: Mapzen / AWS Terrain Tiles' } },
      layers: [{ id: 'sat', type: 'raster', source: 'sat' }], terrain: { source: 'dem', exaggeration: 1.6 },
      sky: { 'sky-color': '#0b2a36', 'horizon-color': '#c77a1a', 'fog-color': '#020a10', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.4 } } });
  } catch { $('#fly').innerHTML = '<p class="empty" style="margin:20px">This device cannot show 3D maps (WebGL is unavailable).</p>'; return; }
  map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
  map.on('load', () => {
    map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: stops.map(s => [s.p.lon, s.p.lat]) } } });
    map.addLayer({ id: 'route-glow', type: 'line', source: 'route', paint: { 'line-color': j.color || '#00d1ff', 'line-width': 10, 'line-opacity': 0.35, 'line-blur': 6 } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': j.color || '#00d1ff', 'line-width': 3 } });
    stops.forEach((s, i) => { const el = document.createElement('button'); el.className = 'mk stop flymk'; el.textContent = i + 1; el.title = s.p.n; el.onclick = () => { stop(); goTo(i); };
      new ml.Marker({ element: el }).setLngLat([s.p.lon, s.p.lat]).addTo(map); });
  });
  let cur = 0, playing = false, timer = null;
  const bearingTo = (a, b) => { if (!b) return map.getBearing(); const t = Math.PI / 180, y = Math.sin((b.lon - a.lon) * t) * Math.cos(b.lat * t), x = Math.cos(a.lat * t) * Math.sin(b.lat * t) - Math.sin(a.lat * t) * Math.cos(b.lat * t) * Math.cos((b.lon - a.lon) * t); return Math.atan2(y, x) / t; };
  const goTo = i => { cur = (i + stops.length) % stops.length; setInfo(cur); const s = stops[cur].p, nx = stops[cur + 1]?.p;
    map.flyTo({ center: [s.lon, s.lat], zoom: 10.5, pitch: 68, bearing: bearingTo(s, nx), speed: 0.6, curve: 1.6, essential: true }); };
  const stop = () => { playing = false; clearTimeout(timer); $('#flyplay').textContent = '▶ Play'; };
  const step = () => { if (!playing) return; goTo(cur + 1); map.once('moveend', () => { timer = setTimeout(step, 3500); }); if (cur === stops.length - 1) stop(); };
  $('#flyplay').onclick = () => { if (playing) return stop(); playing = true; $('#flyplay').textContent = '❚❚ Pause'; if (cur >= stops.length - 1) cur = -1; step(); };
  $('#flynext').onclick = () => { stop(); goTo(cur + 1); }; $('#flyprev').onclick = () => { stop(); goTo(cur - 1); };
  map.once('load', () => goTo(0));
  const off = () => { stop(); try { map.remove(); } catch {} window.removeEventListener('hashchange', off); }; window.addEventListener('hashchange', off);
}

/* ---------- explore-more tiles on home ---------- */
function homeMore() {
  const host = $('#feat')?.closest('.band'); if (!host || $('.moretiles')) return;
  const T = [['read', 'Read the Bible', 'Every chapter, with its places on a map and the Hebrew & Greek behind each verse.'], ['timeline', 'Bible timeline', 'Empires, kings, prophets and events from Abraham to Revelation.'], ['family', 'Family tree', 'The line from Adam to Jesus, with the twelve tribes and more.'],
    ['identity', 'Who you are in Christ', 'Your new creation identity broken down: spirit, soul and body, 12 truths and daily declarations.'], ['receive', 'Receive Jesus & the Holy Spirit', 'A simple prayer, what just happened, and your next steps.'], ['miracles', 'Miracles of Jesus', 'All the miracles on the map, with what each shows about the Father\'s heart.'], ['parables', 'Parables of Jesus', 'Every parable explained through grace, with a question to think about.'], ['names', 'Names of God', 'El Shaddai, Jehovah Jireh, Abba and more, with the Hebrew and Greek.'], ['measures', 'Bible money & measures', 'A denarius in rand, a cubit in centimetres, and every unit in today\'s terms.'], ['grace-minute', 'Grace minute', 'One minute a day: a verse, the finished work, a reflection and a prayer.'], ['grace', 'Grace lens', 'Every passage in the light of the finished work of Jesus and the love of God.'], ['journal', 'Bible journal', 'Draw, write and add stickers on any verse.'], ['wrapped', 'My year in the Word', 'Your chapters, streaks and favourite verses this year — share it.'], ['friends', 'Friends', 'See who is online and pray for each other.'], ['testimonies', 'Testimonies', 'Answered prayers and healings.'], ['churches', 'Church finder', 'Find a grace-teaching church near you.'], ['concordance', 'Strong\'s Concordance', 'Every Hebrew and Greek word, its meaning and every place it appears.'], ['fly-' + (JOURNEYS.find(j => j.id === 'apostles') || JOURNEYS[0])?.id, '3D fly-overs', 'Fly over the real terrain of the journeys of Abraham, Moses, Jesus and Paul.'], ['kingdoms', 'Kingdom maps', 'See the borders change from David to the Romans.'], ['distance', 'How far was it?', 'Distances and walking days between Bible places.'], ['kids', 'Kids\' corner', 'Stories, a fun quiz and pictures to colour.'], ['plans', 'Reading plans', 'John in 21 days, Acts with Paul, Psalms of hope and journey plans.'], ['quiz', 'Quiz', 'Test yourself and challenge a friend.'], ['near', 'Near me', 'Find Bible places close to where you are.'], ['library', 'My library', 'Your saved places, verses, highlights and notes.'], ['books', 'Books of the Bible', 'An introduction to all 66 books: author, date, themes and outline.'], ['tabernacle', 'Tabernacle & Temple', 'Tap each part and see how it points to Jesus.'], ['jerusalem', 'Jerusalem through time', 'The city from David to Jesus on the map.'], ['learn', 'Learn Hebrew & Greek', 'Alphabets, the 100 most common words and flashcards.'], ['family-devotion', 'Family devotion', 'A 10-minute story, questions and prayer for the whole family.'], ['fasting', 'Fasting', 'Track a fast with Scripture and prayer reminders.'], ['battle', 'Quiz battles', 'Same questions, beat your friend\'s score.'], ['study', 'Study tools', 'Commentaries, topical Bible, dictionary, prophecy and the four Gospels side by side.'], ['daily', 'Daily challenge', 'One Bible question a day — keep your streak going.'], ['versepic', 'Verse pictures', 'Make a verse picture on a photo of a real Bible place.'], ['groups', 'Church groups', 'Read the same plan and pray together as a church.'], ['places', 'Every Bible place', 'All 1,300 Bible places on one map, plus the events map.'], ['people', 'People of the Bible', 'Look up anyone in the Bible: family, age, map, journeys and every verse.'], ['chronology', 'From Adam to today', 'Lifespans from Adam to Jesus and the age of mankind in the Bible.'], ['memory', 'Scripture memory', 'Learn verses by heart with a few minutes\' practice a day.'], ['devotionals', 'Devotionals', 'Short reflections and prayers from the Bible lands.'], ['feasts', 'Feasts & holy days', 'Passover, Pentecost, Tabernacles and Easter — dates for the year ahead.'], ['teachings', 'Teachings', 'Watch Andrew Wommack and Dan Mohler from their official channels.'], ['prayer', 'Prayer', 'A private prayer journal and a shared prayer wall.'], ['community', 'Friends & community', 'Invite friends, read plans together and join the conversation.'], ['embed', 'For churches', 'Put any Bible place or journey on your church or school website.'], ['devnotes', 'Developer notes', 'What\'s new, what\'s next, and a place for your feedback.']];
  host.insertAdjacentHTML('afterend', `<section class="band moretiles"><div class="wrap"><div class="sh"><div><h2>More ways to explore</h2><p>Tools for personal study, families, churches and travellers — free, and they work on your phone.</p></div></div>
    <div class="tiles">${T.map(([h, t, d]) => `<button class="tile" data-go="${h}"><b>${t}</b><span>${d}</span></button>`).join('')}</div></div></section>`);
}

/* ======================================================================================
   COMMUNITY: friends & invitations, comments (giscus), developer notes.
   ====================================================================================== */
const CFG = window.JOM_CONFIG || {}; const GZ = CFG.giscus || {};
const commentsOn = () => !!(GZ.repo && GZ.repoId && GZ.categoryId);
function giscus(host, term, { title = 'Comments' } = {}) {
  if (!host) return;
  if (!commentsOn()) { host.innerHTML = `<div class="empty">Comments are almost ready — the site owner needs to switch them on (see <code>js/config.js</code>).</div>`; return; }
  host.innerHTML = `<p class="small muted">Sign in with a free GitHub account to comment. Please be kind — comments are public.</p>`;
  const s = document.createElement('script'); s.src = 'https://giscus.app/client.js'; s.async = true; s.crossOrigin = 'anonymous';
  Object.entries({ 'data-repo': GZ.repo, 'data-repo-id': GZ.repoId, 'data-category': GZ.category || 'General', 'data-category-id': GZ.categoryId, 'data-mapping': 'specific', 'data-term': term,
    'data-strict': '1', 'data-reactions-enabled': '1', 'data-emit-metadata': '0', 'data-input-position': 'top', 'data-theme': 'transparent_dark', 'data-lang': 'en', 'data-loading': 'lazy' }).forEach(([k, v]) => s.setAttribute(k, v));
  host.append(s);
}
function placeComments(id) { if (!commentsOn() || $('#s-comments')) return; const last = $$('main .sec').pop(); if (!last) return;
  last.insertAdjacentHTML('afterend', `<section class="sec" id="s-comments"><div class="wrap"><h2>Comments and questions</h2><div id="pcm"></div></div></section>`); giscus($('#pcm'), 'place-' + id); }

/* friends: a personal name + invite links + study-together invitations, all without an account */
function myName() { return MY.name || ''; }
function viewCommunity() {
  setNav('community'); document.title = 'Community — Just One More Lord';
  const plans = Object.entries(MY.plans).map(([id, d]) => [ALLPLANS.find(j => j.id === id), d]).filter(x => x[0]);
  const friends = Object.values(MY.friends || {});
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Grow together</p><h1>Community</h1><p>Invite friends, study the same plan together, and talk with other readers. Everything personal stays on your phone; comments use free GitHub sign-in.</p></div></div>
    <div class="commgrid">
      <div class="panel"><h2>Friends</h2><p class="small muted">Add friends with their code, see who is online and pray for each other.</p><div class="linkrow"><button class="btn" data-go="friends">Open friends</button><button class="btn ghost sm" data-go="partner">Prayer partner</button></div></div>
      <div class="panel"><h2>Testimonies & churches</h2><p class="small muted">Read and share what God has done, and find a grace-teaching church near you.</p><div class="linkrow"><button class="btn" data-go="testimonies">Testimonies</button><button class="btn ghost sm" data-go="churches">Church finder</button></div></div>
      <div class="panel"><h2>Church groups</h2><p class="small muted">Create or join a group: read the same plan, see progress and share prayer requests.</p><div class="linkrow"><button class="btn" data-go="groups">Open groups</button></div></div>
      <div id="alertsSlot"></div>
      <div class="panel"><h2>Prayer</h2><p class="small muted">Keep a private prayer journal and pray with others on the prayer wall.</p><div class="linkrow"><button class="btn" data-go="prayer">Open prayer</button></div></div>
      <div class="panel"><h2>Your name</h2><p class="small muted">Shown on the invitations you send.</p><div class="filters"><label class="sr" for="mynm">Your first name</label><input id="mynm" type="text" maxlength="40" placeholder="Your first name" value="${esc(myName())}" style="flex:1"><button class="btn sm" id="mynmS">Save</button></div></div>
      <div class="panel"><h2>Invite a friend</h2><p class="small muted">Send a personal invitation by WhatsApp, SMS or email.</p><div class="linkrow"><button class="btn" id="invite">${ICON.share} Invite a friend</button>${CFG.whatsappGroup ? `<a class="btn ghost" href="${esc(CFG.whatsappGroup)}" target="_blank" rel="noopener">Join our WhatsApp community</a>` : ''}</div></div>
      <div class="panel"><h2>Study together</h2><p class="small muted">Pick a plan and invite friends to start it with you. When they open your link, it starts the same plan for them.</p>
        <div class="filters"><label class="sr" for="tplan">Plan</label><select id="tplan" style="flex:1">${ALLPLANS.map(j => `<option value="${j.id}">${esc(j.n)}</option>`).join('')}</select><button class="btn sm" id="tinv">Invite</button></div>
        ${plans.length ? `<p class="small">Your plans: ${plans.map(([j, d]) => `<button class="inl" data-go="plan-${j.id}">${esc(j.n)}</button> (${(d.done || []).length}/${j.stops.length})`).join(' · ')}</p>` : ''}</div>
      <div class="panel"><h2>Friends</h2><p class="small muted">People whose invitations you accepted on this phone.</p>${friends.length ? `<ul class="flist">${friends.map(f => `<li><b>${esc(f.n)}</b><span class="small muted"> · since ${new Date(f.d).toLocaleDateString()}${f.plan ? ' · studying ' + esc(ALLPLANS.find(j => j.id === f.plan)?.n || '') : ''}</span></li>`).join('')}</ul>` : '<p class="empty">No friends yet — send an invitation.</p>'}</div>
    </div>
    <h2 class="libh">Community board</h2><p class="muted">Introduce yourself, share prayer requests and ask questions about the Bible lands.</p><div id="cmm"></div></div></section>`;
  $('#mynmS').onclick = () => { MY.name = $('#mynm').value.trim().slice(0, 40); saveMy(); toast('Saved'); };
  const nm = () => myName() || 'A friend';
  $('#invite').onclick = () => shareIt({ title: 'Just One More Lord', text: `${nm()} invites you to explore the places of the Bible on Just One More Lord — maps, photos, a Bible reader and more. Free, no sign-up.`, hash: `friend-${encodeURIComponent(nm())}` });
  $('#tinv').onclick = () => { const j = ALLPLANS.find(x => x.id === $('#tplan').value); if (!MY.plans[j.id]) { MY.plans[j.id] = { done: [], start: Date.now() }; saveMy(); }
    shareIt({ title: `Study ${j.n} with me`, text: `${nm()} invites you to read “${j.n}” together on Just One More Lord. Tap to start the same plan:`, hash: `friend-${encodeURIComponent(nm())}-${j.id}` }); };
  alertsPanel().then(h => { const el = $('#alertsSlot'); if (el) el.outerHTML = h; }); giscus($('#cmm'), 'community');
}
function acceptInvite(arg) { // #friend-<name>[-<planId>]
  const parts = String(arg).split('-'); let plan = null; if (parts.length > 1 && ALLPLANS.find(j => j.id === parts[parts.length - 1])) plan = parts.pop();
  const name = decodeURIComponent(parts.join('-')).slice(0, 40) || 'A friend'; const j = plan && ALLPLANS.find(x => x.id === plan);
  setNav(''); document.title = 'You have been invited — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Invitation</p><h1><span class="neon-txt">${esc(name)}</span> invited you</h1>
    <p class="lead">${j ? `to read <b>${esc(j.n)}</b> together — ${esc(j.intro || j.ref)}` : 'to explore the places of the Bible: maps, photographs, archaeology, a Bible reader and Hebrew & Greek word meanings.'}</p>
    <div class="linkrow"><button class="btn" id="acc">${j ? 'Start the plan together' : 'Accept and explore'}</button><button class="btn ghost" data-go="home">Just look around</button></div></div></section>`;
  $('#acc').onclick = () => { MY.friends ||= {}; MY.friends[name.toLowerCase()] = { n: name, d: Date.now(), plan }; if (j && !MY.plans[j.id]) MY.plans[j.id] = { done: [], start: Date.now() }; saveMy();
    toast(`${name} added to your friends`); checkBadges(); go(j ? 'plan-' + j.id : 'home'); };
}

/* developer notes: what's new, what's next, and a feedback thread */
const DEVNOTES = [
  ['2026-11-26', 'Grace lens and the biggest update yet', ['Grace lens on every chapter and a daily Grace minute', 'Offline English Bible, parallel Bible and advanced search', 'Cross-reference rainbow, when each book was written, Bible progress map', 'Profile pictures, friends with online status, prayer partners', 'Testimonies, grace church finder, live group reading', 'Bible journaling and My year in the Word', 'Choose your notification time; display and accessibility settings']],
  ['2026-11-26', 'Notifications, books and more', ['Notification bell and phone notifications', 'Introductions to all 66 books', 'Interactive Tabernacle and Temple', 'Jerusalem through time', 'Learn Hebrew and Greek', 'Fasting tracker', 'Family devotion every day', 'Paper, sepia and night reading modes', 'Quiz battles with friends', 'Share your badges and streak']],
  ['2026-11-26', 'Study tools and church groups', ['New logo and app icon', 'Commentary on every chapter (Matthew Henry, JFB, Clarke, Gill, Keil-Delitzsch, Tyndale)', 'Topical Bible: 5,000 topics', 'Bible dictionary and the meaning of names', 'Prophecy and fulfilment', 'Gospel harmony', 'Every Bible place (1,300) and a map of 500 events', 'Bible finds in museums', 'Verse picture maker', 'Lesson builder', 'Daily challenge', 'Church groups', 'Daily verse alerts']],
  ['2026-11-26', 'People of the Bible', ['Look up any of 3,000+ people: family, dates and age, birthplace and place of death, a map of where they lived, journeys, life events, biography and every verse', 'Hebrew and Greek spelling of names', '“From Adam to today”: lifespans from Adam to Jesus and the age of mankind by traditional Bible chronology']],
  ['2026-11-25', 'Profiles, memory verses and a year in the Bible', ['Free profiles with sign-up and sync across devices', 'The whole Bible in a year plan', 'Scripture memory with daily practice', 'Devotionals from 13 Bible places', 'Feasts and holy days for the year ahead', 'A photograph for every place, and a share picture for every place', 'Faster loading', 'Privacy policy and app-store preparation']],
  ['2026-11-25', 'Kingdom maps, distances, kids\' corner and languages', ['Kingdom maps for six eras, from David and Solomon to the time of Jesus', '“How far was it?” — distances and walking days, and totals for every journey', 'Kids\' corner: stories read aloud, a fun quiz and pictures to colour', '360° views of places where a panorama is available', 'Save a journey for offline travel', 'Menus in Afrikaans, isiZulu and isiXhosa (help us improve them!)']],
  ['2026-11-25', 'Prayer, translations and smarter search', ['Prayer journal (mark prayers as answered) and a shared prayer wall', 'Choose WEB, KJV, ASV, Basic English or Young\'s Literal in the reader, and compare them verse by verse', 'Word study: tap any word for its Hebrew or Greek meaning', 'Ask questions in the search box, e.g. “Where was Paul shipwrecked?”']],
  ['2026-11-25', 'Listen, badges, cross-references, presenting', ['Listen to any chapter read aloud', 'Daily streaks and 17 badges to earn', '250,000 cross-references between verses', 'Present any place or journey full-screen for church and class', 'Churches can put Bible places on their own websites']],
  ['2026-11-25', 'Community and developer notes', ['Invite friends and study plans together', 'Community board and comments on every place (once switched on)', 'This page: developer notes and feedback']],
  ['2026-11-25', 'Stage 2: timeline, family tree, 3D', ['Zoomable Bible timeline: empires, kings, prophets and events', 'Family tree from Adam to Jesus with all twelve tribes', '3D fly-overs of the journeys over real terrain', 'Then-and-now photo slider on place pages', 'Group study pages you can print or send', 'New plans: John, Mark, Acts with Paul, Genesis, Psalms of hope']],
  ['2026-11-25', 'Stage 1: a real app', ['Install to your home screen; works offline', 'Bible reader with a live map of every chapter\'s places', 'Save places and verses, highlight, write notes, backup', 'Verse of the day with a daily reminder', 'Reading plans, quizzes, “near me”, sharing previews', 'Text size, high contrast and reduce motion']],
  ['2026-11-25', 'New look', ['Aqua-and-gold neon design', 'Shepherd and flock home picture', 'Dark night map']]
];
const ROADMAP = ['Bible text in Afrikaans, isiZulu and isiXhosa', 'More places, journeys and discoveries', 'More kids\' stories and colouring pages'];
function viewDevNotes() {
  setNav(''); document.title = 'Developer notes — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap prose"><p class="kicker">From the developer${CFG.developer ? ' · ' + esc(CFG.developer) : ''}</p><h1>Developer notes</h1>
    <p class="lead">What's new, what's coming next, and a place to send ideas, report a mistake or say hello.</p>
    <h3>Coming next</h3><ul>${ROADMAP.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    ${DEVNOTES.map(([d, t, items]) => `<h3>${esc(t)} <span class="small muted">· ${new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</span></h3><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
    <h3>Feedback and comments</h3><div id="dcm"></div>
    <p class="small muted">Prefer email or a private message? Use the GitHub repository's Issues tab: <a href="https://github.com/${esc(GZ.repo || 'titantechnogies-afk/bible-places-today')}/issues" target="_blank" rel="noopener">report an issue or idea ↗</a></p></div></section>`;
  giscus($('#dcm'), 'developer-notes');
}

/* ======================================================================================
   STAGE 3: listen (read aloud), streaks & badges, cross-references, presentation mode, church embeds.
   ====================================================================================== */
/* ---------- activity, streaks and badges ---------- */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
for (const k of ['days', 'readCh', 'visited', 'strongs', 'badges', 'journal', 'grace', 'saved']) if (!MY[k] || typeof MY[k] !== 'object') MY[k] = {};
function streak() { let n = 0; const d = new Date(); if (!MY.days[today()]) d.setDate(d.getDate() - 1);
  for (;;) { const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; if (!MY.days[k]) break; n++; d.setDate(d.getDate() - 1); } return n; }
function bestStreak() { const ks = Object.keys(MY.days).sort(); let best = 0, run = 0, prev = null;
  for (const k of ks) { const t = Date.parse(k + 'T12:00:00'); run = prev && t - prev < 1.5 * 864e5 ? run + 1 : 1; prev = t; best = Math.max(best, run); } return best; }
const countCh = book => Object.keys(MY.readCh).filter(k => k.startsWith(book + ' ')).length;
const planDone = () => ALLPLANS.filter(j => (MY.plans[j.id]?.done || []).length >= j.stops.length);
const BADGES = [
  ['first', '📖', 'First steps', 'Read your first chapter', () => Object.keys(MY.readCh).length >= 1],
  ['s3', '🔥', 'On fire', 'A 3-day reading streak', () => bestStreak() >= 3],
  ['s7', '⭐', 'Faithful week', 'A 7-day streak', () => bestStreak() >= 7],
  ['s30', '👑', 'Thirty days', 'A 30-day streak', () => bestStreak() >= 30],
  ['ch10', '📚', 'Bookworm', 'Read 10 chapters', () => Object.keys(MY.readCh).length >= 10],
  ['ch100', '🏛️', 'Scholar', 'Read 100 chapters', () => Object.keys(MY.readCh).length >= 100],
  ['john', '✝️', 'Beloved disciple', 'Read all 21 chapters of John', () => countCh('John') >= 21],
  ['mark', '🦁', 'Straight away', 'Read all 16 chapters of Mark', () => countCh('Mark') >= 16],
  ['acts', '⛵', 'With Paul', 'Read all 28 chapters of Acts', () => countCh('Acts') >= 28],
  ['p10', '🧭', 'Explorer', 'Visit 10 Bible places', () => Object.keys(MY.visited).length >= 10],
  ['p50', '🗺️', 'Pilgrim', 'Visit 50 Bible places', () => Object.keys(MY.visited).length >= 50],
  ['jour', '👣', 'Footsteps', 'Visit every stop of a journey', () => JOURNEYS.some(j => j.stops.every(s => MY.visited[s[0]]))],
  ['plan', '🏁', 'Finisher', 'Complete a reading plan', () => planDone().length >= 1],
  ['quiz', '🧠', 'Quiz master', 'Get a perfect quiz score', () => !!MY.quizPerfect],
  ['heb', '🔤', 'Word digger', 'Study 10 Hebrew or Greek words', () => Object.keys(MY.strongs).length >= 10],
  ['note', '✍️', 'Journaler', 'Write 10 notes', () => Object.keys(MY.notes).length >= 10],
  ['friend', '🤝', 'Together', 'Accept a friend\'s invitation', () => Object.keys(MY.friends || {}).length >= 1]
];
function checkBadges() { for (const [id, ic, name, , ok] of BADGES) { if (!MY.badges[id] && ok()) { MY.badges[id] = Date.now(); saveMy(); setTimeout(() => toast(`${ic} Badge earned: ${name}`), 600); } } }
function track(kind, key) { MY.days[today()] = (MY.days[today()] || 0) + 1; if (kind && key) MY[kind][key] = MY[kind][key] || Date.now(); saveMy(); checkBadges(); }
function progressHTML() { const s = streak(), got = BADGES.filter(b => MY.badges[b[0]]).length;
  return `<div class="progbox"><div class="streak${s ? ' hot' : ''}"><b>${s ? '🔥 ' + s : '0'}</b><span>day streak</span>${s ? '<button class="inl small" data-sharebadge="streak">Share</button>' : ''}</div><div class="statrow">${[[Object.keys(MY.readCh).length, 'chapters read'], [Object.keys(MY.visited).length, 'places visited'], [got + '/' + BADGES.length, 'badges'], [bestStreak(), 'best streak']].map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('')}</div></div>
    <div class="badges">${BADGES.map(([id, ic, n, d]) => `<div class="badge${MY.badges[id] ? ' on' : ''}" title="${esc(d)}"><i>${ic}</i><b>${esc(n)}</b><span>${esc(d)}</span>${MY.badges[id] ? `<button class="bshare" data-sharebadge="${id}" aria-label="Share badge ${esc(n)}">${ICON.share}</button>` : ''}</div>`).join('')}</div>`; }

/* ---------- listen: read the chapter aloud with the device's own voices ---------- */
const TTS = { on: false, i: 0 };
function ttsVoice() { const vs = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)); return vs.find(v => /en-ZA/i.test(v.lang)) || vs.find(v => /natural|premium|enhanced|google/i.test(v.name)) || vs.find(v => /en-GB/i.test(v.lang)) || vs[0] || null; }
function ttsStop() { TTS.on = false; try { speechSynthesis.cancel(); } catch {} $$('.rverse.speaking').forEach(x => x.classList.remove('speaking')); const b = $('#ttsPlay'); if (b) b.innerHTML = '▶ Listen'; }
function ttsSpeak(i) {
  const vs = $$('#rtext .rverse'); if (i >= vs.length) { ttsStop(); if ($('#ttsCont')?.checked && TTS.next) { try { sessionStorage.setItem('jom:autoplay', '1'); } catch {} go('read-' + TTS.next); } return; }
  TTS.i = i; $$('.rverse.speaking').forEach(x => x.classList.remove('speaking')); const el = vs[i]; el.classList.add('speaking'); el.scrollIntoView({ block: 'center', behavior: PREF.rm ? 'auto' : 'smooth' });
  const u = new SpeechSynthesisUtterance(el.textContent.replace(/^\s*\d+\s*/, '').replace(/[/\[\]<>]/g, ' ')); const v = ttsVoice(); if (v) u.voice = v; u.lang = v?.lang || 'en-GB'; u.rate = +(localStorage.getItem('jom:rate') || 1);
  u.onend = () => { if (TTS.on) ttsSpeak(i + 1); }; u.onerror = e => { if (e.error !== 'interrupted' && e.error !== 'canceled') ttsStop(); };
  speechSynthesis.speak(u);
}
function ttsBar(next) {
  TTS.next = next; if (!('speechSynthesis' in window)) return '';
  return `<div class="ttsbar"><button class="btn sm" id="ttsPlay">▶ Listen</button><label class="sr" for="ttsRate">Speed</label><select id="ttsRate">${[[0.8, 'Slow'], [1, 'Normal'], [1.2, 'Faster'], [1.5, 'Fast']].map(([r, l]) => `<option value="${r}"${+(localStorage.getItem('jom:rate') || 1) === r ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <label class="tog small"><input type="checkbox" id="ttsCont" ${localStorage.getItem('jom:cont') === '1' ? 'checked' : ''}> Keep going to the next chapter</label></div>`;
}
function wireTTS() {
  const b = $('#ttsPlay'); if (!b) return;
  b.onclick = () => { if (TTS.on) { ttsStop(); return; } TTS.on = true; b.innerHTML = '❚❚ Pause'; speechSynthesis.cancel(); ttsSpeak(TTS.i || 0); };
  $('#ttsRate').onchange = e => { localStorage.setItem('jom:rate', e.target.value); if (TTS.on) { speechSynthesis.cancel(); ttsSpeak(TTS.i); } };
  $('#ttsCont').onchange = e => localStorage.setItem('jom:cont', e.target.checked ? '1' : '0');
  TTS.i = 0; let auto = false; try { auto = sessionStorage.getItem('jom:autoplay') === '1'; sessionStorage.removeItem('jom:autoplay'); } catch {}
  if (auto) setTimeout(() => b.click(), 400);
}
window.addEventListener('hashchange', () => { if (TTS.on) ttsStop(); });

/* ---------- cross-references (OpenBible.info, CC BY) ---------- */
const xrefCache = {};
async function xrefsFor(ref) { await loadConc(); const p = parseRef(ref); if (!p) return [];
  const code = p.book.code; if (!(code in xrefCache)) xrefCache[code] = fetch(`data/xrefs/${code}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const m = await xrefCache[code]; return m[`${p.ch}:${p.v1}`] || []; }
async function addXrefs(box, ref) {
  const host = document.createElement('div'); host.className = 'xrefs'; const nb = $('.notebox', box); (nb || $('.vtools', box))?.after(host); if (!host.isConnected) return;
  const list = await xrefsFor(ref); if (!list.length) { host.remove(); return; }
  host.innerHTML = `<p class="kicker">Related verses</p><div class="chips">${list.map(r => `<button class="chip xr" data-verse="${esc(r)}">${esc(r)}</button>`).join('')}</div><p class="small muted">Cross-references: OpenBible.info (CC BY), most-voted first.</p>`;
}

/* ---------- presentation mode (projector / big screen) ---------- */
async function viewPresent(arg) {
  const [kind, ...rest] = String(arg).split('-'); const id = rest.join('-'); const slides = [];
  const p = kind === 'place' ? byId[id] : null, j = kind === 'journey' ? JOURNEYS.find(x => x.id === id) : null;
  if (!p && !j) return viewNotFound();
  if (p) {
    slides.push({ cls: 'title', bg: p.wiki || p.n, html: `<p class="kicker">Just One More Lord</p><h1>${esc(p.n)}</h1><p class="sub">${esc(p.mn && p.mn !== p.n ? p.mn + ' · ' : '')}${esc((p.loc || '').split(/[;.]/)[0])}</p>` });
    if (p.sum) slides.push({ html: `<h2>About ${esc(p.n)}</h2><p class="big">${esc(p.sum)}</p>` });
    (p.v || []).slice(0, 4).forEach(v => slides.push({ verse: v[0], html: `<p class="kicker">${esc(v[1])}</p><blockquote class="pv" data-ref="${esc(v[0])}">…</blockquote><p class="pvref">${esc(v[0])}</p>` }));
    slides.push({ map: { markers: [{ lat: p.lat, lon: p.lon, label: p.n, kind: 'main' }, ...nearest(p, 6, 80).map(x => ({ lat: x.o.lat, lon: x.o.lon, label: x.o.n, kind: 'near' }))], maxZoom: 10 }, html: `<h2>Where is ${esc(p.n)}?</h2>` });
    const ds = discsFor(p.id).slice(0, 4); if (ds.length) slides.push({ html: `<h2>What archaeologists found</h2><ul class="big">${ds.map(d => `<li><b>${esc(d.n)}</b> — ${esc(STATUS[d.status]?.[0] || '')}</li>`).join('')}</ul>` });
    if (p.vis) slides.push({ bg: p.wiki || p.n, html: `<h2>${esc(p.n)} today</h2><p class="big">${esc(p.vis.slice(0, 380))}</p>` });
  } else {
    const st = j.stops.map(s => ({ p: byId[s[0]], ref: s[1], note: s[2] })).filter(s => s.p);
    slides.push({ cls: 'title', html: `<p class="kicker">Journey · ${esc(j.ref)}</p><h1>${esc(j.n)}</h1><p class="sub">${esc(j.intro || '')}</p>` });
    slides.push({ map: { markers: st.map((s, i) => ({ lat: s.p.lat, lon: s.p.lon, label: `${i + 1}. ${s.p.n}`, kind: 'stop', num: i + 1 })), lines: [{ pts: st.map(s => [s.p.lat, s.p.lon]), color: j.color }] }, html: `<h2>The route</h2>` });
    st.forEach((s, i) => slides.push({ bg: s.p.wiki || s.p.n, verse: s.ref, html: `<p class="kicker">Stage ${i + 1} of ${st.length}</p><h2>${esc(s.p.n)}</h2><blockquote class="pv" data-ref="${esc(s.ref)}">…</blockquote><p class="pvref">${esc(s.ref)}${s.note ? ' — ' + esc(s.note) : ''}</p>` }));
  }
  slides.push({ cls: 'title', html: `<h2>Explore more</h2><p class="big">${esc(SITE.replace(/^https:\/\//, ''))}</p><p class="sub">Maps · photographs · archaeology · Hebrew & Greek</p>` });
  document.title = `Present: ${(p || j).n}`;
  $('#deck')?.remove(); document.body.insertAdjacentHTML('beforeend', `<div class="deck" id="deck" role="dialog" aria-label="Presentation"><div class="slides">${slides.map((s, i) => `<section class="slide ${s.cls || ''}" data-i="${i}" ${i ? 'hidden' : ''}><div class="sbg"></div><div class="sin">${s.html}${s.map ? '<div class="smap"></div>' : ''}</div></section>`).join('')}</div>
    <div class="dctl"><button id="dprev" aria-label="Previous slide">←</button><span id="dnum">1 / ${slides.length}</span><button id="dnext" aria-label="Next slide">→</button><button id="dfs" aria-label="Full screen">⛶</button><button id="dx" aria-label="Close presentation">✕</button></div></div>`);
  const deck = $('#deck'); let cur = 0; const back = () => { deck.remove(); document.removeEventListener('keydown', key); if (document.fullscreenElement) document.exitFullscreen?.(); history.length > 1 ? history.back() : go(p ? 'place-' + p.id : 'journey-' + j.id); };
  const show = async i => { cur = Math.max(0, Math.min(slides.length - 1, i)); $$('.slide', deck).forEach((el, k) => el.hidden = k !== cur); $('#dnum').textContent = `${cur + 1} / ${slides.length}`;
    const s = slides[cur], el = $(`.slide[data-i="${cur}"]`, deck);
    if (s.map && !s.mapDone) { s.mapDone = 1; await makeMap($('.smap', el), s.map); }
    if (s.verse && !s.vDone) { s.vDone = 1; const q = $('.pv', el); let t = ''; try { const v = await bibleText(s.verse); t = v.verses.map(x => x.t).join(' ') || v.text; } catch { try { t = await glossVerse(s.verse); } catch {} }
      if (t.length > 420) t = t.slice(0, 400).replace(/\s+\S*$/, '') + ' …'; q.textContent = t; q.classList.toggle('long', t.length > 200); }
    if (s.bg && !s.bgDone) { s.bgDone = 1; const im = (await leadImages([s.bg]))[s.bg]; if (im) $('.sbg', el).style.backgroundImage = `url("${im.src.replace(/\/\d+px-/, '/1600px-')}")`; } };
  const key = e => { if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); show(cur + 1); } if (['ArrowLeft', 'PageUp'].includes(e.key)) show(cur - 1); if (e.key === 'Escape' && !document.fullscreenElement) back(); };
  document.addEventListener('keydown', key);
  $('#dnext').onclick = () => show(cur + 1); $('#dprev').onclick = () => show(cur - 1); $('#dx').onclick = back;
  $('#dfs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : deck.requestFullscreen?.().catch(() => {});
  let x0 = null; deck.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true }); deck.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1)); x0 = null; });
  deck.querySelector('.slides').addEventListener('click', e => { if (e.target.closest('a,button,.leaflet-container')) return; show(cur + 1); });
  main.innerHTML = `<section class="band"><div class="wrap"><p class="muted">Presenting ${esc((p || j).n)}… <button class="inl" id="reopen">Open the slides again</button></p></div></section>`;
  $('#reopen').onclick = () => viewPresent(arg);
  show(0);
}
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#present-')) $('#deck')?.remove(); });

/* ---------- embed: a compact card any church or school website can show ---------- */
function viewEmbed(arg) {
  document.documentElement.classList.add('embed'); const [kind, ...rest] = String(arg).split('-'); const id = rest.join('-');
  const p = kind === 'place' ? byId[id] : null, j = kind === 'journey' ? JOURNEYS.find(x => x.id === id) : null; if (!p && !j) { main.innerHTML = '<p class="empty">Not found.</p>'; return; }
  const it = p || j; const link = SITE + '#' + (p ? 'place-' + p.id : 'journey-' + j.id); const v = p ? (p.v || [])[0] : [j.stops[0][1], j.stops[0][2]];
  main.innerHTML = `<article class="emb"><div class="emb-ph" data-wiki="${esc(p ? (p.wiki || p.n) : (byId[j.stops[0][0]]?.wiki || ''))}"><div class="ph"></div></div><div class="emb-bd"><p class="kicker">${p ? 'Bible place' : 'Bible journey · ' + esc(j.ref)}</p><h1>${esc(it.n)}</h1>
    <p>${esc((p ? p.sum : j.intro) || '')}</p>${v ? `<p class="emb-v"><b>${esc(v[0])}</b> · ${esc(v[1] || '')}</p>` : ''}<div class="mapbox emb-map" id="embmap"></div>
    <a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">Explore on Just One More Lord ↗</a></div></article>`;
  const ph = $('.emb-ph'); leadImages([ph.dataset.wiki].filter(Boolean)).then(m => { const im = m[ph.dataset.wiki]; if (im) ph.querySelector('.ph').style.backgroundImage = `url("${im.src}")`; else { ph.remove(); $('.emb')?.classList.add('nophoto'); } });
  if (p) makeMap($('#embmap'), { markers: [{ lat: p.lat, lon: p.lon, label: p.n, kind: 'main' }], maxZoom: 9 });
  else { const st = j.stops.map(s => byId[s[0]]).filter(Boolean); makeMap($('#embmap'), { markers: st.map((x, i) => ({ lat: x.lat, lon: x.lon, label: `${i + 1}. ${x.n}`, kind: 'stop', num: i + 1 })), lines: [{ pts: st.map(x => [x.lat, x.lon]), color: j.color }] }); }
}
function viewEmbedMaker() {
  setNav(''); document.title = 'Add Just One More Lord to your website';
  const opts = [...PLACES.slice().sort((a, b) => a.n.localeCompare(b.n)).map(p => [`place-${p.id}`, p.n]), ...JOURNEYS.map(j => [`journey-${j.id}`, 'Journey: ' + j.n])];
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">For churches, schools and bloggers</p><h1>Put a Bible place on your website</h1><p>Choose a place or journey, copy the code and paste it into your website (WordPress, Wix, Squarespace or any HTML page). It shows a photo, a short description, a key verse and a live map, with a link to explore more. Free, no sign-up.</p></div></div>
    <div class="commgrid"><div class="panel"><h2>1 · Choose</h2><div class="filters"><label class="sr" for="emw">What to show</label><select id="emw" style="flex:1">${opts.map(([v, l]) => `<option value="${v}"${v === 'place-jerusalem' ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <label class="sr" for="emh">Height</label><select id="emh"><option value="560">Normal</option><option value="680">Tall</option><option value="440">Short</option></select></div>
      <h2 style="margin-top:14px">2 · Copy the code</h2><textarea id="emc" rows="5" readonly class="codebox"></textarea><div class="linkrow"><button class="btn sm" id="emcp">Copy code</button></div></div>
      <div class="panel"><h2>Preview</h2><iframe id="emp" title="Preview" style="width:100%;height:560px;border:0;border-radius:14px;background:#020a10" loading="lazy"></iframe></div></div></div></section>`;
  const upd = () => { const v = $('#emw').value, h = $('#emh').value, src = `${SITE}#embed-${v}`;
    $('#emc').value = `<iframe src="${src}" title="${esc($('#emw').selectedOptions[0].textContent)} — Just One More Lord" style="width:100%;max-width:720px;height:${h}px;border:0;border-radius:16px" loading="lazy" allow="fullscreen"></iframe>`;
    $('#emp').src = location.href.split('#')[0] + '#embed-' + v; $('#emp').style.height = h + 'px'; };
  $('#emw').onchange = $('#emh').onchange = upd; upd();
  $('#emcp').onclick = async () => { try { await navigator.clipboard.writeText($('#emc').value); toast('Code copied — paste it into your website'); } catch { $('#emc').select(); document.execCommand('copy'); toast('Code copied'); } };
}

/* ======================================================================================
   STAGE 4: prayer journal & wall, translations, word study, smart search answers.
   ====================================================================================== */
/* ---------- prayer journal (private) and prayer wall (shared) ---------- */
if (!Array.isArray(MY.prayers)) MY.prayers = [];
function viewPrayer() {
  setNav('community'); document.title = 'Prayer — Just One More Lord';
  let show = 'open';
  const draw = () => {
    const list = MY.prayers.filter(p => show === 'all' || (show === 'open' ? !p.a : p.a)).sort((a, b) => b.d - a.d);
    const nOpen = MY.prayers.filter(p => !p.a).length, nAns = MY.prayers.filter(p => p.a).length;
    main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">“Pray without ceasing” · 1 Thessalonians 5:17</p><h1>Prayer</h1><p>Keep a private prayer journal on this phone, mark prayers as answered, and pray with others on the prayer wall.</p></div></div>
      <div class="commgrid"><div class="panel"><h2>My prayer journal</h2><p class="small muted">Private — saved only on this phone (included in your library backup).</p>
        <label class="notebox"><span class="sr">New prayer</span><textarea id="pnew" rows="3" placeholder="Write a prayer, a request or a thanksgiving…"></textarea></label>
        <div class="filters"><label class="sr" for="pfor">For</label><input id="pfor" type="text" maxlength="60" placeholder="For whom? (optional)" style="flex:1"><button class="btn sm" id="padd">Add prayer</button></div>
        <div class="chips" id="pfil"><button class="chip" data-f="open" aria-pressed="${show === 'open'}">Praying (${nOpen})</button><button class="chip" data-f="ans" aria-pressed="${show === 'ans'}">Answered (${nAns})</button><button class="chip" data-f="all" aria-pressed="${show === 'all'}">All</button></div>
        <ul class="plist">${list.map(p => `<li class="${p.a ? 'ans' : ''}" data-id="${p.id}"><p>${esc(p.t)}</p><span class="small muted">${p.f ? 'For ' + esc(p.f) + ' · ' : ''}${new Date(p.d).toLocaleDateString()}${p.a ? ' · answered ' + new Date(p.a).toLocaleDateString() : ''}</span>
          <div class="linkrow"><button class="btn ghost sm" data-act="ans">${p.a ? 'Mark as still praying' : '✓ Answered'}</button><button class="btn ghost sm" data-act="share">${ICON.share} Ask friends to pray</button><button class="btn ghost sm" data-act="del">Delete</button></div></li>`).join('') || `<li class="emptyli"><p class="muted">${show === 'ans' ? 'Answered prayers will appear here — a record of God\'s faithfulness.' : 'No prayers yet.'}</p></li>`}</ul>
        <div class="linkrow"><a class="btn ghost sm" id="pcal" download="prayer-reminder.ics">Daily prayer reminder</a></div></div>
        <div class="panel"><h2>Prayer wall</h2><p class="small muted">Share a request and pray for others. Posts are public — share only what you are happy for anyone to read.</p><div id="pwall"></div></div></div></div></section>`;
    $('#padd').onclick = () => { const t = $('#pnew').value.trim(); if (!t) { $('#pnew').focus(); return; } MY.prayers.push({ id: Date.now().toString(36), t, f: $('#pfor').value.trim(), d: Date.now(), a: 0 }); saveMy(); track(); toast('Prayer added'); show = 'open'; draw(); };
    $('#pfil').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { show = b.dataset.f; draw(); } };
    $('.plist').onclick = e => { const b = e.target.closest('[data-act]'); if (!b) return; const id = b.closest('li').dataset.id, p = MY.prayers.find(x => x.id === id); if (!p) return;
      if (b.dataset.act === 'ans') { p.a = p.a ? 0 : Date.now(); saveMy(); if (p.a) toast('Praise God — marked as answered'); draw(); }
      if (b.dataset.act === 'del' && confirm('Delete this prayer?')) { MY.prayers = MY.prayers.filter(x => x.id !== id); saveMy(); draw(); }
      if (b.dataset.act === 'share') shareIt({ title: 'Please pray with me', text: `Please pray with me${p.f ? ' for ' + p.f : ''}: ${p.t}`, hash: 'prayer' }); };
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Just One More Lord//EN', 'BEGIN:VEVENT', 'UID:prayer-' + Date.now() + '@justonemorelord', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
      'DTSTART:' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + 'T200000', 'DURATION:PT10M', 'RRULE:FREQ=DAILY', 'SUMMARY:Time to pray', 'DESCRIPTION:Open your prayer journal: ' + SITE + '#prayer', 'URL:' + SITE + '#prayer',
      'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Time to pray', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    $('#pcal').href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    giscus($('#pwall'), 'prayer-wall');
  };
  draw();
}

/* ---------- Bible translations (public domain, via bible-api.com) ---------- */
const TRANS = [['web', 'World English Bible'], ['kjv', 'King James Version'], ['asv', 'American Standard Version'], ['bbe', 'Bible in Basic English'], ['ylt', 'Young\'s Literal Translation']];
const curTr = () => { const t = localStorage.getItem('jom:tr'); return TRANS.some(x => x[0] === t) ? t : 'web'; };
async function compareHTML(ref) {
  const rows = await Promise.all(TRANS.map(async ([k, n]) => { try { const v = await bibleText(ref, k); return `<div class="cmp"><b>${esc(n)}</b><p>${esc(v.verses.map(x => x.t).join(' ') || v.text)}</p></div>`; } catch { return `<div class="cmp"><b>${esc(n)}</b><p class="muted small">Not available offline.</p></div>`; } }));
  return rows.join('');
}

/* ---------- word study: tap any word for its Hebrew or Greek ---------- */
async function wordStudyHTML(b, ch) {
  const data = await getLocal(`text/${b.code}.${ch}.json`); const heb = b.i < 39;
  return data.map(([v, rows]) => `<p class="wsv" id="v${v}"><sup>${v}</sup>${rows.map(r => { const k = ((r[3] || '').split('/').find(x => x.startsWith('{')) || '').replace(/[{}]/g, '');
    return `<button class="gw" ${k ? `data-k="${k}"` : 'disabled'} data-o="${esc(r[0])}" data-x="${esc(r[1])}">${esc(String(r[2] || '').replace(/[<>]/g, ''))}</button>`; }).join(' ')}</p>`).join('') + `<p class="small muted">${heb ? 'Hebrew' : 'Greek'} words with literal English from STEPBible.org (CC BY 4.0). Tap a word for its meaning.</p>`;
}
document.addEventListener('click', async e => { const w = e.target.closest('.gw[data-k]'); if (!w) return; e.preventDefault(); await loadConc(); const k = w.dataset.k;
  openDlg(`<p class="kicker">Word study</p><div class="lemma">${origSpan(w.dataset.o, k)}</div><p class="xl"><b>${esc(w.dataset.x)}</b> · translated here as “${esc(w.textContent)}”</p>${strongCard(k)}`, 'Word study'); track('strongs', k); });

/* ---------- smart search: answer questions from the atlas ---------- */
const QSTOP = new Set('where what which who whom whose when why how was were is are am be been did does do the a an of in on at to for from by with and or about tell me show find there their his her its it this that bible place places happen happened located location city town site story'.split(' '));
const stem = w => w.replace(/(ings|ing|edly|ed|es|s)$/, m => w.length - m.length >= 4 ? '' : m);
const toks = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
let QIDX = null;
function buildQIdx() {
  const docs = [];
  for (const p of PLACES) docs.push({ go: 'place-' + p.id, title: p.n, kind: 'Place', name: [p.n, p.bn, p.mn, ...(p.alt || [])].join(' '), text: [p.sum, p.hist, p.bib, p.loc, p.vis, ...(p.v || []).map(v => v.join(' ')), ...(p.tl || []).map(t => t[1] + ' ' + t[2])].join(' '), snip: [p.sum, ...(p.v || []).map(v => `${v[1]} (${v[0]})`), p.hist] });
  for (const d of DISCS) { const txt = Object.values(d).filter(v => typeof v === 'string').join(' '); docs.push({ go: 'disc-' + d.id, title: d.n, kind: 'Discovery', name: d.n, text: txt, snip: Object.values(d).filter(v => typeof v === 'string' && v.length > 40) }); }
  for (const j of JOURNEYS) j.stops.forEach(s => { const p = byId[s[0]]; if (p) docs.push({ go: 'place-' + p.id, title: `${p.n} — ${j.n}`, kind: 'Journey stop', name: p.n, text: `${j.n} ${s[1]} ${s[2]}`, snip: [`${s[2]} (${s[1]})`] }); });
  for (const r of TL) docs.push({ go: r[5] ? 'place-' + r[5] : 'timeline', title: r[2], kind: 'Timeline', name: r[2], text: `${r[2]} ${r[6]} ${r[4]}`, snip: [`${r[6]} (${yrLbl(r[0])}${r[4] ? ', ' + r[4] : ''})`] });
  for (const d of docs) { d.nt = new Set(toks(d.name).map(stem)); d.tt = toks(d.text).map(stem); d.ts = new Set(d.tt); }
  QIDX = docs;
}
function answerSearch(q) {
  q = String(q || '').replace(/\b5,?000\b/g, 'five thousand').replace(/\b4,?000\b/g, 'four thousand').replace(/\b12\b/g, 'twelve');
  const qt = toks(q).filter(w => !QSTOP.has(w)).map(stem); if (!qt.length) return [];
  if (!QIDX) buildQIdx();
  const out = [];
  for (const d of QIDX) { let s = 0, hit = 0; for (const t of qt) { let h = 0; if (d.nt.has(t)) { s += 6; h = 1; } if (d.ts.has(t)) { s += 2 + Math.min(3, d.tt.filter(x => x === t).length) * 0.5; h = 1; } else if (t.length >= 5 && d.tt.some(x => x.startsWith(t.slice(0, 5)))) { s += 1; h = 1; } hit += h; }
    if (hit) { s *= hit / qt.length; if (hit === qt.length) s *= 1.6; out.push({ d, s, hit }); } }
  const seen = new Set();
  return out.sort((a, b) => b.s - a.s).filter(x => x.hit >= Math.min(2, qt.length) && !seen.has(x.d.go + x.d.kind) && seen.add(x.d.go + x.d.kind)).slice(0, 6).map(({ d }) => {
    const snip = (d.snip || []).filter(Boolean).map(String).find(s => qt.some(t => toks(s).map(stem).includes(t))) || (d.snip || [])[0] || '';
    return { ...d, snippet: snip.length > 220 ? snip.slice(0, 217) + '…' : snip }; });
}
function addAnswers(q) {
  const a = answerSearch(q); const h1 = $('main h1'); if (!a.length || !h1) return;
  h1.insertAdjacentHTML('afterend', `<div class="answers"><p class="kicker">Best answers</p><div class="rlist">${a.map(x => `<button class="ritem ans" data-go="${esc(x.go)}"><div><b>${esc(x.title)}</b><span>${esc(x.snippet)}</span></div><span class="tag">${esc(x.kind)}</span></button>`).join('')}</div></div>`);
}

/* ======================================================================================
   STAGE 5: kingdom maps by era, distances, kids' corner, 360° tours, languages, travel pack.
   ====================================================================================== */
/* ---------- kingdom maps by era (deliberately simplified; ancient borders shifted and were often undefined) ---------- */
const ERAS = [
  { id: 'united', n: 'United kingdom of David and Solomon', y: 'c. 1000–931 BC', ref: '1 Kings 4:21', note: 'Israel at its greatest extent, from Dan to Beersheba and beyond the Jordan.',
    areas: [['Israel', '#ffc72c', [[33.35, 35.25], [33.3, 35.85], [32.7, 36.3], [31.9, 36.05], [31.2, 35.85], [30.6, 35.3], [30.9, 34.45], [31.45, 34.75], [32.2, 34.85], [33.05, 35.1]]], ['Philistines', '#ff7276', [[31.85, 34.65], [31.8, 34.85], [31.35, 34.62], [31.25, 34.3]]]] },
  { id: 'divided', n: 'Israel and Judah', y: 'c. 900–722 BC', ref: '1 Kings 12:19-20', note: 'After Solomon the kingdom splits: Israel in the north (capital Samaria), Judah in the south (capital Jerusalem).',
    areas: [['Israel', '#00d1ff', [[33.35, 35.25], [33.3, 35.8], [32.65, 36.15], [32.0, 35.95], [31.95, 35.3], [32.15, 34.9], [32.95, 35.05]]], ['Judah', '#ffc72c', [[31.95, 35.3], [31.95, 35.55], [31.4, 35.48], [30.9, 35.4], [30.55, 35.1], [30.9, 34.5], [31.45, 34.8], [31.8, 34.95]]], ['Philistines', '#ff7276', [[31.85, 34.65], [31.8, 34.85], [31.35, 34.62], [31.25, 34.3]]], ['Moab', '#8fb8ff', [[31.75, 35.6], [31.7, 36.1], [31.05, 36.1], [31.1, 35.55]]], ['Edom', '#39ff9c', [[31.0, 35.45], [31.0, 35.9], [30.0, 35.6], [29.6, 35.0], [30.4, 35.1]]], ['Aram (Damascus)', '#b49cff', [[33.9, 35.9], [33.9, 36.8], [33.0, 36.8], [32.8, 36.2], [33.3, 35.9]]]] },
  { id: 'assyria', n: 'The Assyrian Empire', y: 'c. 670 BC', ref: '2 Kings 17:6', note: 'Assyria destroys Israel (722 BC) and dominates Judah; at its height it briefly ruled Egypt.',
    areas: [['Assyria', '#ffa62b', [[37.6, 35.8], [37.9, 40], [37.6, 44], [36.2, 45.8], [33.6, 46.8], [31.2, 47.5], [32.6, 44.5], [34.1, 41.2], [33.2, 38.2], [31.2, 36.3], [30.1, 32.8], [31.3, 31.6], [31.5, 34.3], [33.5, 35.3], [36.2, 35.9]]], ['Judah (vassal)', '#ffc72c', [[31.95, 35.3], [31.95, 35.55], [31.4, 35.48], [30.9, 35.4], [30.9, 34.9], [31.45, 34.85], [31.8, 34.95]]]] },
  { id: 'babylon', n: 'The Babylonian Empire', y: 'c. 560 BC', ref: '2 Kings 25:8-11', note: 'Nebuchadnezzar takes Jerusalem (586 BC) and carries Judah into exile.',
    areas: [['Babylonia', '#ff7276', [[37.0, 38.2], [36.6, 43.2], [34.2, 45.6], [31.0, 47.8], [29.9, 47.6], [31.4, 44.3], [32.4, 41.2], [30.5, 37.2], [29.5, 34.9], [31.2, 34.2], [33.5, 35.3], [36.1, 35.9]]]] },
  { id: 'persia', n: 'The Persian Empire', y: 'c. 500 BC', ref: 'Esther 1:1', note: 'From India to Cush: the largest empire the world had yet seen. Cyrus lets the exiles return.',
    areas: [['Persia', '#8fb8ff', [[41.2, 27.5], [42.0, 35.0], [41.2, 45.0], [40.5, 55.0], [38.5, 62.0], [36.5, 70.5], [30.0, 70.5], [25.3, 62.0], [26.5, 56.0], [29.8, 48.5], [30.0, 40.5], [24.5, 33.5], [24.0, 31.0], [31.3, 25.5], [31.6, 30.0], [36.5, 27.0]]], ['Yehud (Judah)', '#ffc72c', [[31.95, 35.0], [31.95, 35.5], [31.55, 35.45], [31.55, 35.0]]]] },
  { id: 'jesus', n: 'The land in the time of Jesus', y: 'c. AD 30', ref: 'Luke 3:1', note: 'Judea and Samaria under a Roman prefect (Pontius Pilate); Galilee and Perea under Herod Antipas; the north-east under Philip.',
    areas: [['Galilee', '#39ff9c', [[33.1, 35.2], [33.1, 35.62], [32.9, 35.68], [32.7, 35.62], [32.55, 35.3], [32.75, 35.05]]], ['Samaria', '#8fb8ff', [[32.55, 35.0], [32.55, 35.55], [32.05, 35.55], [32.05, 34.9]]], ['Judea', '#ffc72c', [[32.05, 34.75], [32.05, 35.55], [31.4, 35.45], [31.2, 34.9], [31.6, 34.6]]], ['Perea', '#ff7276', [[32.35, 35.6], [32.3, 35.85], [31.6, 35.75], [31.55, 35.55]]], ['Philip\'s territory', '#b49cff', [[33.3, 35.65], [33.3, 36.5], [32.7, 36.6], [32.75, 35.7]]], ['Decapolis', '#00d1ff', [[32.7, 35.72], [32.7, 36.4], [32.0, 36.2], [32.1, 35.78]]]] }
];
function viewKingdoms(id) {
  setNav('timeline'); const e = ERAS.find(x => x.id === id) || ERAS[0]; document.title = `${e.n} — kingdom maps — Just One More Lord`;
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Kingdom maps by era</p><h1>${esc(e.n)}</h1><p>${esc(e.y)} · ${esc(e.note)} <button class="vref sm" data-verse="${esc(e.ref)}">${esc(e.ref)}</button></p></div><div class="linkrow"><button class="btn ghost sm" data-go="timeline">Timeline</button></div></div>
    <div class="chips eras">${ERAS.map(x => `<button class="chip" data-go="kingdoms-${x.id}" aria-pressed="${x.id === e.id}">${esc(x.y.replace(/^c\. /, ''))} · ${esc(x.n.replace(/^The /, ''))}</button>`).join('')}</div>
    <div class="mapbox tall" id="kmap" style="margin-top:14px"></div><div class="maplegend">${e.areas.map(([l, c]) => `<span><span class="dot" style="background:${c};color:${c}"></span> ${esc(l)}</span>`).join('')}</div>
    <p class="small muted">Borders are simplified sketches for orientation. Ancient frontiers moved often and were rarely fixed lines; scholars differ on many details.</p>
    <div class="linkrow">${ERAS.indexOf(e) > 0 ? `<button class="btn ghost sm" data-go="kingdoms-${ERAS[ERAS.indexOf(e) - 1].id}">← Earlier</button>` : ''}${ERAS.indexOf(e) < ERAS.length - 1 ? `<button class="btn sm" data-go="kingdoms-${ERAS[ERAS.indexOf(e) + 1].id}">Later →</button>` : ''}</div></div></section>`;
  const keyIds = ['assyria', 'babylon', 'persia'].includes(e.id) ? ['jerusalem', 'babylon', 'nineveh', 'susa', 'damascus', 'memphis'] : e.id === 'jesus' ? ['jerusalem', 'bethlehem', 'nazareth', 'capernaum', 'samaria', 'caesarea', 'jericho'] : ['jerusalem', 'samaria', 'dan', 'beersheba', 'shechem', 'hebron', 'damascus'];
  makeMap($('#kmap'), { areas: e.areas.map(([label, color, pts]) => ({ label, color, pts, permanent: true })), markers: keyIds.map(i => byId[i]).filter(Boolean).map(p => ({ lat: p.lat, lon: p.lon, label: p.n, kind: 'place', go: 'place-' + p.id })), maxZoom: 9, fitPad: 20 });
}

/* ---------- distances ---------- */
const ROADF = 1.25, KMDAY = 30;
const fmtKm = d => d < 10 ? d.toFixed(1) + ' km' : Math.round(d).toLocaleString() + ' km';
function journeyKm(j) { const st = j.stops.map(s => byId[s[0]]).filter(Boolean); let d = 0; for (let i = 1; i < st.length; i++) d += km(st[i - 1], st[i]); return d; }
const DPRESETS = [['nazareth', 'bethlehem', 'Mary and Joseph travel to Bethlehem', 'Luke 2:4'], ['nazareth', 'jerusalem', 'The family goes up for Passover', 'Luke 2:41'], ['capernaum', 'jerusalem', 'Jesus goes up to Jerusalem', 'John 2:13'], ['jericho', 'jerusalem', 'The road of the Good Samaritan', 'Luke 10:30'], ['jerusalem', 'damascus', 'Saul sets out for Damascus', 'Acts 9:2'], ['ur', 'haran', 'Terah and Abram leave Ur', 'Genesis 11:31'], ['jerusalem', 'babylon', 'Judah is taken into exile', '2 Kings 25:11'], ['bethlehem', 'memphis', 'The flight to Egypt (Memphis as a stand-in)', 'Matthew 2:14']];
function viewDistance(arg) {
  setNav(''); document.title = 'How far was it? — Just One More Lord';
  const [a0, b0] = String(arg || 'nazareth.bethlehem').split('.'); const opts = PLACES.slice().sort((x, y) => x.n.localeCompare(y.n));
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">How far was it?</p><h1>Distances in the Bible</h1><p>Pick two places to see how far apart they are and how long the journey would have taken on foot (about ${KMDAY} km a day).</p></div></div>
    <div class="filters"><label class="sr" for="da">From</label><select id="da">${opts.map(p => `<option value="${p.id}"${p.id === a0 ? ' selected' : ''}>${esc(p.n)}</option>`).join('')}</select><span class="muted">to</span><label class="sr" for="db">To</label><select id="db">${opts.map(p => `<option value="${p.id}"${p.id === b0 ? ' selected' : ''}>${esc(p.n)}</option>`).join('')}</select></div>
    <div class="jlayout"><div><div class="statrow" id="dres"></div><div class="mapbox" id="dmap" style="height:380px;margin-top:14px"></div></div>
      <div><h2 class="libh" style="margin-top:0">Famous journeys</h2><div class="rlist">${DPRESETS.filter(([a, b]) => byId[a] && byId[b]).map(([a, b, t, r]) => `<button class="ritem" data-go="distance-${a}.${b}"><div><b>${esc(t)}</b><span>${esc(byId[a].n)} → ${esc(byId[b].n)} · ${esc(r)}</span></div><span class="tag">${fmtKm(km(byId[a], byId[b]) * ROADF)}</span></button>`).join('')}</div>
      <h2 class="libh">Whole journeys</h2><div class="rlist">${JOURNEYS.map(j => `<button class="ritem" data-go="journey-${j.id}"><div><b>${esc(j.n)}</b><span>${j.stops.length} stages · straight-line total</span></div><span class="tag">${fmtKm(journeyKm(j))}</span></button>`).join('')}</div></div></div>
    <p class="small muted">Distances are straight lines between the sites; the road estimate adds a quarter for winding roads and hills. Sea voyages depended on the wind.</p></div></section>`;
  const upd = () => { const a = byId[$('#da').value], b = byId[$('#db').value]; const d = km(a, b), r = d * ROADF, days = r / KMDAY;
    $('#dres').innerHTML = [[fmtKm(d), 'straight line'], ['≈ ' + fmtKm(r), 'by road'], [days < 1 ? '< 1 day' : `≈ ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`, 'on foot'], [`≈ ${Math.max(1, Math.round(r / 5))} h`, 'walking time']].map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('');
    makeMap($('#dmap'), { markers: [{ lat: a.lat, lon: a.lon, label: a.n, kind: 'main', go: 'place-' + a.id }, { lat: b.lat, lon: b.lon, label: b.n, kind: 'place', go: 'place-' + b.id }], lines: [{ pts: [[a.lat, a.lon], [b.lat, b.lon]], color: '#ffc72c', dash: '6 6' }], maxZoom: 10 }); };
  $('#da').onchange = $('#db').onchange = upd; upd();
}

/* ---------- kids' corner ---------- */
const KSTORIES = [
  ['🏹', 'Abram trusts God', 'ur', 'Genesis 12:1-4', 'God told Abram to pack up and leave his home for a land he had never seen. Abram did not know the way, but he trusted God and set off with his family, his sheep and his camels. God promised to bless him and to make his family as many as the stars.'],
  ['⛰️', 'Moses on the mountain', 'mount-sinai', 'Exodus 19:20', 'After God rescued his people from Egypt, they camped by a great mountain. Moses climbed up to meet God, and God gave him the Ten Commandments — good rules to help people love God and love each other.'],
  ['🎺', 'The walls of Jericho', 'jericho', 'Joshua 6:20', 'Jericho had big, strong walls. God told Joshua to march around the city for seven days. On the seventh day the priests blew their trumpets, the people shouted — and the walls came tumbling down!'],
  ['🪨', 'David and the giant', 'valley-of-elah', '1 Samuel 17:49', 'Goliath was a giant soldier and everyone was scared of him. But David, a young shepherd boy, trusted God. With a sling and one smooth stone, David knocked the giant down.'],
  ['🐋', 'Jonah and the big fish', 'nineveh', 'Jonah 2:10', 'God asked Jonah to go to the city of Nineveh, but Jonah sailed the other way. A storm came, and a big fish swallowed Jonah! After three days the fish spat him out, and this time Jonah went to Nineveh.'],
  ['⭐', 'Jesus is born', 'bethlehem', 'Luke 2:7', 'Mary and Joseph travelled to the little town of Bethlehem. There was no room at the inn, so baby Jesus was born and laid in a manger. Angels told the shepherds the good news!'],
  ['🌊', 'Jesus calms the storm', 'sea-of-galilee', 'Mark 4:39', 'Jesus and his friends were in a boat when a huge storm came. The friends were afraid, but Jesus stood up and said, “Peace! Be still!” — and the wind and the waves became calm.'],
  ['🌳', 'Zacchaeus climbs a tree', 'jericho', 'Luke 19:4', 'Zacchaeus was too short to see Jesus over the crowd, so he climbed a sycamore tree. Jesus stopped, looked up and said, “Zacchaeus, come down! I’m coming to your house today.”'],
  ['⛵', 'Paul and the shipwreck', 'malta', 'Acts 27:44', 'Paul was sailing to Rome when a terrible storm broke the ship apart. Everyone swam or floated on planks to the island of Malta — and God kept every single person safe!']
];
const KQUIZ = [['Who knocked down a giant with a stone?', 'David', ['Moses', 'Jonah']], ['What swallowed Jonah?', 'A big fish', ['A lion', 'A camel']], ['Where was Jesus born?', 'Bethlehem', ['Rome', 'Nineveh']], ['What did Jesus say to the storm?', 'Peace! Be still!', ['Go away!', 'Hurry up!']], ['Which city\'s walls fell down?', 'Jericho', ['Jerusalem', 'Malta']], ['Who climbed a tree to see Jesus?', 'Zacchaeus', ['Abram', 'Paul']], ['On which island was Paul shipwrecked?', 'Malta', ['Cyprus', 'Crete']], ['What did God give Moses on the mountain?', 'The Ten Commandments', ['A boat', 'A crown']]];
const KCOL_PAGES = [
  ['Boat on the Sea of Galilee', `<rect class="cz" x="0" y="0" width="400" height="190" /><circle class="cz" cx="320" cy="70" r="36"/><path class="cz" d="M0 190 Q50 170 100 190 T200 190 T300 190 T400 190 V300 H0Z"/><path class="cz" d="M90 200 L310 200 L270 250 L130 250Z"/><path class="cz" d="M200 60 L200 195 L130 195Z"/><path class="cz" d="M205 70 L205 195 L270 195Z"/><path d="M200 55 V200" stroke="#000" stroke-width="5" fill="none"/>`],
  ['Star over Bethlehem', `<rect class="cz" x="0" y="0" width="400" height="300"/><path class="cz" d="M200 20 L214 60 L256 60 L222 84 L235 124 L200 100 L165 124 L178 84 L144 60 L186 60Z"/><path class="cz" d="M40 300 V200 H120 V300Z"/><path class="cz" d="M30 205 L80 160 L130 205Z"/><path class="cz" d="M150 300 V180 H260 V300Z"/><path class="cz" d="M140 185 L205 135 L270 185Z"/><path class="cz" d="M280 300 V215 H370 V300Z"/><rect class="cz" x="190" y="240" width="30" height="60"/>`],
  ['The walls of Jericho', `<rect class="cz" x="0" y="0" width="400" height="300"/><path class="cz" d="M20 300 V150 H60 V130 H80 V150 H120 V130 H140 V150 H180 V130 H200 V150 H240 V130 H260 V150 H300 V130 H320 V150 H380 V300Z"/><path class="cz" d="M170 300 V240 A30 30 0 0 1 230 240 V300Z"/><path class="cz" d="M30 60 Q60 40 90 60 L80 80 Q60 70 40 80Z"/><circle class="cz" cx="330" cy="60" r="30"/>`],
  ['A sheep for the Good Shepherd', `<rect class="cz" x="0" y="0" width="400" height="300"/><path class="cz" d="M0 230 Q200 190 400 230 V300 H0Z"/><path class="cz" d="M120 170 q-20 -40 20 -50 q10 -30 45 -20 q25 -25 55 -5 q35 -5 40 30 q35 15 15 50 q5 35 -35 35 h-120 q-35 -5 -20 -40Z"/><ellipse class="cz" cx="285" cy="150" rx="30" ry="24"/><rect class="cz" x="150" y="200" width="14" height="40"/><rect class="cz" x="230" y="200" width="14" height="40"/><circle cx="295" cy="145" r="4" fill="#000"/>`]
];
function viewKids(tab) {
  setNav(''); document.title = 'Kids\' corner — Just One More Lord'; tab = tab || 'stories';
  main.innerHTML = `<section class="band kids"><div class="wrap"><div class="sh"><div><p class="kicker">For children and families</p><h1>Kids' corner</h1><p>Bible stories with the real places on a map, a fun quiz and pictures to colour.</p></div></div>
    <div class="chips" id="ktabs">${[['stories', '📖 Stories'], ['quiz', '❓ Quiz'], ['colour', '🖍️ Colouring']].map(([k, l]) => `<button class="chip" data-k="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div><div id="kbody" style="margin-top:18px"></div></div></section>`;
  $('#ktabs').onclick = e => { const b = e.target.closest('[data-k]'); if (b) viewKids(b.dataset.k); };
  const body = $('#kbody');
  if (tab === 'stories') {
    body.innerHTML = `<div class="kgrid">${KSTORIES.map(([ic, t, pid, ref, txt], i) => { const p = byId[pid]; return `<article class="kcard"><div class="kic">${ic}</div><h3>${esc(t)}</h3><p>${esc(txt)}</p>
      <div class="linkrow"><button class="btn sm" data-ks="${i}">🔊 Read to me</button>${p ? `<button class="btn ghost sm" data-go="place-${p.id}">📍 ${esc(p.n)}</button>` : ''}<button class="btn ghost sm" data-verse="${esc(ref)}">${esc(ref)}</button></div></article>`; }).join('')}</div>`;
    body.onclick = e => { const b = e.target.closest('[data-ks]'); if (!b || !('speechSynthesis' in window)) return; speechSynthesis.cancel(); const s = KSTORIES[+b.dataset.ks]; const u = new SpeechSynthesisUtterance(s[1] + '. ' + s[4]); const v = ttsVoice(); if (v) u.voice = v; u.rate = .92; speechSynthesis.speak(u); };
  } else if (tab === 'quiz') {
    const qs = shuffle(KQUIZ).slice(0, 6); let i = 0, sc = 0;
    const draw = () => { if (i >= qs.length) { body.innerHTML = `<div class="kdone"><div class="kic">${sc >= qs.length - 1 ? '🏆' : '🌟'}</div><h2>You got ${sc} out of ${qs.length}!</h2><p>${sc === qs.length ? 'Amazing — every answer right!' : 'Well done! Try again to get them all.'}</p><button class="btn" id="kagain">Play again</button></div>`; $('#kagain').onclick = () => viewKids('quiz'); if (sc === qs.length) { MY.quizPerfect = 1; saveMy(); checkBadges(); } return; }
      const [q, a, w] = qs[i]; const opts = shuffle([a, ...w]);
      body.innerHTML = `<div class="kq"><p class="kicker">Question ${i + 1} of ${qs.length}</p><h2>${esc(q)}</h2><div class="kopts">${opts.map(o => `<button class="kopt" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div><div id="kfb"></div></div>`;
      $('.kopts').onclick = e => { const b = e.target.closest('.kopt'); if (!b || $('.kopts').dataset.done) return; $('.kopts').dataset.done = 1; const ok = b.dataset.o === a; if (ok) sc++; b.classList.add(ok ? 'right' : 'wrong'); if (!ok) $$('.kopt').find(x => x.dataset.o === a)?.classList.add('right');
        $('#kfb').innerHTML = `<p class="kfb">${ok ? '🎉 Yes, well done!' : `💡 It was ${esc(a)}.`}</p><button class="btn" id="knext">Next →</button>`; $('#knext').onclick = () => { i++; draw(); }; }; };
    draw();
  } else {
    const COLS = ['#ff4d4d', '#ffa62b', '#ffd23f', '#39d353', '#2bb3ff', '#3a5bff', '#a259ff', '#ff6fb5', '#8b5a2b', '#ffffff', '#9aa5b1', '#222222']; let col = COLS[4], pg = 0;
    const draw = () => { body.innerHTML = `<div class="kcol"><div class="chips">${KCOL_PAGES.map(([t], k) => `<button class="chip" data-p="${k}" aria-pressed="${k === pg}">${esc(t)}</button>`).join('')}</div>
      <div class="palette" role="group" aria-label="Colours">${COLS.map(c => `<button class="sw${c === col ? ' on' : ''}" data-c="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
      <svg class="colsvg" viewBox="0 0 400 300" role="img" aria-label="${esc(KCOL_PAGES[pg][0])} — tap the shapes to colour them">${KCOL_PAGES[pg][1]}</svg>
      <div class="linkrow"><button class="btn ghost sm" id="kclr">Start again</button><button class="btn ghost sm" onclick="print()">Print</button></div></div>`;
      $$('.colsvg .cz', body).forEach(el => el.setAttribute('fill', '#ffffff'));
      body.onclick = e => { const pb = e.target.closest('[data-p]'); if (pb) { pg = +pb.dataset.p; draw(); return; } const sw = e.target.closest('[data-c]'); if (sw) { col = sw.dataset.c; $$('.sw', body).forEach(x => x.classList.toggle('on', x === sw)); return; }
        const z = e.target.closest('.cz'); if (z) z.setAttribute('fill', col); };
      $('#kclr').onclick = draw; };
    draw();
  }
}

/* ---------- 360° panoramas from Wikimedia Commons ---------- */
let pnP = null;
function loadPannellum() { if (window.pannellum) return Promise.resolve(); if (pnP) return pnP;
  const add = (tag, a) => new Promise((res, rej) => { const el = document.createElement(tag); Object.assign(el, a); el.onload = res; el.onerror = rej; document.head.append(el); });
  pnP = Promise.all([add('link', { rel: 'stylesheet', href: 'https://cdnjs.cloudflare.com/ajax/libs/pannellum/2.5.6/pannellum.css' }), add('script', { src: 'https://cdnjs.cloudflare.com/ajax/libs/pannellum/2.5.6/pannellum.js' })]).catch(e => { pnP = null; throw e; }); return pnP; }
async function pano360(p) {
  if (!(await isLive())) return; const host = $('#s-photos'); if (!host || $('#pano')) return;
  const word = p.n.split(/[\s(]/)[0]; let pick = null;
  for (const q of [`${p.n} 360`, `${p.n} equirectangular`, `${p.n} spherical panorama`]) {
    const r = (await commonsSearch(q, 30)).filter(im => /360|equirect|spheric|photosphere/i.test(im.title + ' ' + im.desc) && new RegExp(word, 'i').test(im.title + ' ' + im.desc) && im.w && im.h && Math.abs(im.w / im.h - 2) < 0.08);
    if (r.length) { pick = r[0]; break; } }
  if (!pick) return;
  host.insertAdjacentHTML('afterend', `<section class="sec" id="pano"><div class="wrap"><div class="sh"><div><h2>360° view</h2><p>Drag to look all around ${esc(p.n)}. Tap the button to load it (it is a large picture).</p></div></div>
    <div class="panobox" id="panov"><button class="btn" id="panogo">Look around in 360°</button></div><p class="small muted">Photo: ${credit(pick)}</p></div></section>`);
  $('#panogo').onclick = async () => { $('#panov').innerHTML = '<p class="muted" style="padding:20px"><span class="spin"></span>Loading the 360° view…</p>';
    try { await loadPannellum(); const src = /\/thumb\//.test(pick.src) ? pick.src.replace(/\/\d+px-/, '/3000px-') : pick.full; $('#panov').innerHTML = '';
      window.pannellum.viewer('panov', { type: 'equirectangular', panorama: src, autoLoad: true, autoRotate: -2, showZoomCtrl: true, compass: false, crossOrigin: 'anonymous' }); }
    catch { $('#panov').innerHTML = '<p class="empty" style="margin:16px">The 360° viewer could not load. Check your connection and try again.</p>'; } };
}

/* ---------- languages (menus and main headings) ---------- */
const I18N = {
  af: { name: 'Afrikaans', nav: { home: 'Verken', atlas: 'Atlas', journeys: 'Reise', discoveries: 'Ontdekkings', read: 'Bybel', timeline: 'Tydlyn', concordance: 'Konkordansie', plans: 'Leesplanne', quiz: 'Vasvra', library: 'Gestoor', community: 'Gemeenskap' },
    search: 'Soek enige Bybelse plek…', h1: 'Verken die wêreld van <span class="neon-txt">die Bybel.</span>', lede: 'Sien die plekke waar Bybelse geskiedenis afgespeel het. Verken die plekke soos hulle vandag is. Ontdek die argeologiese bewyse. Stap deur die geskiedenis.', bigsearch: 'Soek', more: 'Meer maniere om te verken', votd: 'Vers van die dag', feat: 'Uitgesoekte plekke' },
  zu: { name: 'isiZulu', nav: { home: 'Hlola', atlas: 'I-Atlasi', journeys: 'Uhambo', discoveries: 'Okutholakele', read: 'IBhayibheli', timeline: 'Isikhathi', concordance: 'Inkomba', plans: 'Izinhlelo', quiz: 'Imibuzo', library: 'Okulondoloziwe', community: 'Umphakathi' },
    search: 'Sesha noma iyiphi indawo yeBhayibheli…', h1: 'Hlola izwe <span class="neon-txt">leBhayibheli.</span>', lede: 'Bona izindawo lapho umlando weBhayibheli wenzeka khona. Hlola lezi zindawo namuhla. Thola ubufakazi bemivubukulo.', bigsearch: 'Sesha', more: 'Ezinye izindlela zokuhlola', votd: 'Ivesi losuku', feat: 'Izindawo ezikhethiwe' },
  xh: { name: 'isiXhosa', nav: { home: 'Phonononga', atlas: 'Iatlasi', journeys: 'Uhambo', discoveries: 'Izinto ezifunyenweyo', read: 'IBhayibhile', timeline: 'Ixesha', concordance: 'Isalathiso', plans: 'Izicwangciso', quiz: 'Imibuzo', library: 'Okugciniweyo', community: 'Uluntu' },
    search: 'Khangela nayiphi na indawo yeBhayibhile…', h1: 'Phonononga ihlabathi <span class="neon-txt">leBhayibhile.</span>', lede: 'Bona iindawo apho imbali yeBhayibhile yenzeka khona. Phonononga ezi ndawo namhlanje. Fumana ubungqina bezinto zakudala.', bigsearch: 'Khangela', more: 'Ezinye iindlela zokuphonononga', votd: 'Ivesi yosuku', feat: 'Iindawo ezikhethiweyo' }
};
const EN = {}; const lang = () => I18N[localStorage.getItem('jom:lang')] ? localStorage.getItem('jom:lang') : 'en';
function applyLang() {
  const L = I18N[lang()]; document.documentElement.lang = lang() === 'en' ? 'en' : lang();
  $$('.nav button[data-go]').forEach(b => { if (!(b.dataset.go in EN)) EN[b.dataset.go] = b.textContent; b.textContent = L?.nav[b.dataset.go] || EN[b.dataset.go]; });
  const q = $('#q'); if (q) { EN.search ||= q.placeholder; q.placeholder = L?.search || EN.search; }
  const h1 = $('.hero h1'); if (h1) { EN.h1 ||= h1.innerHTML; h1.innerHTML = L?.h1 || EN.h1; }
  const ld = $('.hero .lede'); if (ld) { EN.lede ||= ld.textContent; ld.textContent = L?.lede || EN.lede; }
  const bs = $('#bigSearch .btn'); if (bs) { EN.bigsearch ||= bs.textContent; bs.textContent = L?.bigsearch || EN.bigsearch; }
  const mt = $('.moretiles h2'); if (mt) { EN.more ||= mt.textContent; mt.textContent = L?.more || EN.more; }
  const fh = $('#feat')?.closest('.band')?.querySelector('h2'); if (fh) { EN.feat ||= fh.textContent; fh.textContent = L?.feat || EN.feat; }
}
(() => { const pan = $('#aaPanel'); if (!pan) return;
  pan.insertAdjacentHTML('afterbegin', `<label class="tog" style="display:grid;gap:4px"><span class="kicker">Language · Taal · Ulimi · Ulwimi</span><select id="langSel">${[['en', 'English'], ...Object.entries(I18N).map(([k, v]) => [k, v.name])].map(([k, n]) => `<option value="${k}"${k === lang() ? ' selected' : ''}>${n}</option>`).join('')}</select></label><p class="small muted" style="margin:0">Menus and headings are translated; Bible text stays in English for now.</p>`);
  $('#langSel').onchange = e => { localStorage.setItem('jom:lang', e.target.value); applyLang(); toast(e.target.value === 'en' ? 'English' : I18N[e.target.value].name); };
})();

/* ---------- travel pack: save a journey's places, photos and verses for offline use ---------- */
async function travelPack(j, btn) {
  const st = j.stops.map(s => ({ p: byId[s[0]], ref: s[1] })).filter(s => s.p); let done = 0; const tot = st.length;
  btn.disabled = true; const upd = () => btn.textContent = `Saving… ${Math.round(100 * done / tot)}%`; upd();
  for (const s of st) { try { const w = s.p.wiki || s.p.n; await wikiSummary(w); const im = (await leadImages([w]))[w]; if (im) await fetch(im.src, { mode: 'no-cors' }).catch(() => {}); await bibleText(s.ref).catch(() => {}); } catch {} done++; upd(); }
  btn.textContent = '✓ Saved for offline'; toast('Journey saved — photos, summaries and verses now work without signal');
}

/* ======================================================================================
   TEACHINGS: trusted teachers, shown from their own official channels (nothing copied).
   Add favourite videos in js/config.js → teachings: [{ teacher, title, youtube, topic, verse }]
   ====================================================================================== */
const TEACHERS = [
  { id: 'wommack', n: 'Andrew Wommack', org: 'Andrew Wommack Ministries · Charis Bible College', about: 'Bible teacher known for teaching on grace, faith and the believer\'s identity in Christ, through the Gospel Truth broadcast and Charis Bible College.',
    links: [['Official website', 'https://www.awmi.net'], ['YouTube channel', 'https://www.youtube.com/channel/UC8H3lzJU5Qm-s3WVroB87kw'], ['Podcast', 'https://podcasts.apple.com/podcast/id293048670']], uploads: 'UU8H3lzJU5Qm-s3WVroB87kw', face: 'img/teacher-wommack-face.jpg', photo: 'img/teacher-wommack.jpg', photoAlt: 'Andrew Wommack teaching with a Bible in his hand' },
  { id: 'olivier', n: 'Richard Olivier', org: 'Head pastor · Harvest Church, uMhlanga, Durban', about: 'Head pastor of Harvest Church in uMhlanga, Durban. Richard preaches and teaches the finished work of Jesus and the love of God. The church\'s mission is: Know God, Find Freedom, Discover Purpose, Make a Difference. Sunday services at 08:00 and 10:00 (the 10:00 service is live-streamed to YouTube).',
    links: [['Harvest Church', 'https://harvestchurch.co.za/'], ['YouTube channel', 'https://www.youtube.com/@harvestchurchza'], ['Latest message', 'https://harvestchurch.co.za/media.html#latest-message'], ['Message library', 'https://harvestchurch.co.za/media.html#resources'], ['Directions: 1 Wincanton Way, Umhlanga', 'https://www.openstreetmap.org/search?query=1%20Wincanton%20Way%2C%20Umhlanga']], uploads: 'UUZLU13MUaHcWmS9lOpT7mOg', face: 'img/teacher-olivier-face.jpg', photo: 'img/teacher-olivier.jpg', photoAlt: 'Pastors Richard and Tanya Olivier, Harvest Church', caption: 'Richard and his wife Tanya Olivier' },
  { id: 'mohler', n: 'Dan Mohler', org: 'Neck Ministries · Harvest Chapel', about: 'Former firefighter and pastor who travels teaching on loving people, becoming who God made us to be, and praying for the sick. His talks are recorded by the churches he visits.',
    links: [['Ministry page', 'https://sites.google.com/site/danmohlerbecominglove/dan-mohler'], ['Talks on YouTube', 'https://www.youtube.com/results?search_query=Dan+Mohler']], face: 'img/teacher-mohler-face.jpg', photo: 'img/teacher-mohler.jpg', photoAlt: 'Dan Mohler smiling' }
];
const ytId = u => (String(u || '').match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/) || [])[1];
function ytFrame(src, title) { return `<button class="ytbox" data-src="${esc(src)}" aria-label="Play: ${esc(title)}"><span class="ytplay">▶</span><span class="yttitle">${esc(title)}</span></button>`; }
document.addEventListener('click', e => { const b = e.target.closest('.ytbox[data-src]'); if (!b) return; e.preventDefault();
  b.outerHTML = `<div class="ytwrap"><iframe src="${esc(b.dataset.src)}${b.dataset.src.includes('?') ? '&' : '?'}autoplay=1&rel=0" title="${esc(b.querySelector('.yttitle')?.textContent || 'Video')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`; });
function viewTeachings(id) {
  setNav(''); document.title = 'Teachings — Just One More Lord';
  const extra = (CFG.teachings || []).filter(t => ytId(t.youtube)); const T = id ? TEACHERS.filter(t => t.id === id) : TEACHERS;
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Grow in the Word</p><h1>Grace teachings</h1><p>Teachers of the finished work of Jesus and the love of God, played straight from their own official channels. Watch with your Bible open.</p></div><div class="linkrow"><button class="btn" data-go="notes">📝 Teaching notes</button><button class="btn ghost" data-go="stories">🙌 Healing testimonies</button></div></div>
    ${T.map(t => { const mine = extra.filter(x => x.teacher === t.id);
      return `<article class="teacher"><div class="thead">${t.face ? `<img class="tav tphoto" src="${esc(t.face)}" alt="${esc(t.n)}">` : `<div class="tav">${esc(t.n.split(' ').map(w => w[0]).join(''))}</div>`}<div><h2>${esc(t.n)}</h2><p class="kicker">${esc(t.org)}</p></div></div>${t.photo ? `<div class="tbio"><figure class="tfig"><img class="tpic" src="${esc(t.photo)}" alt="${esc(t.photoAlt || t.n)}" loading="lazy">${t.caption ? `<figcaption class="small muted">${esc(t.caption)}</figcaption>` : ''}</figure><p>${esc(t.about)}</p></div>` : `<p>${esc(t.about)}</p>`}
        <div class="linkrow">${t.links.map(([l, u]) => `<a class="btn ghost sm" href="${esc(u)}" target="_blank" rel="noopener">${esc(l)} ↗</a>`).join('')}</div>
        ${mine.length ? `<h3 class="libh" style="font-size:20px">Recommended</h3><div class="ytgrid">${mine.map(v => `<div>${ytFrame('https://www.youtube-nocookie.com/embed/' + ytId(v.youtube), v.title || t.n)}<p class="small">${v.topic ? esc(v.topic) + ' · ' : ''}${v.verse ? `<button class="vref sm" data-verse="${esc(v.verse)}">${esc(v.verse)}</button>` : ''}</p></div>`).join('')}</div>` : ''}
        ${t.uploads ? `<h3 class="libh" style="font-size:20px">Latest from the official channel</h3><div class="ytgrid one">${ytFrame('https://www.youtube-nocookie.com/embed/videoseries?list=' + t.uploads, `Latest teachings — ${t.n}`)}</div>` : ''}</article>`; }).join('')}
    <p class="small muted">All teachings belong to the speakers and their ministries and are shown from their own channels; videos only load when you tap play. Teachers are listed by the site owner; as always, test everything against Scripture (Acts 17:11).</p></div></section>`;
}

/* ======================================================================================
   STAGE 6: Bible in a year, Scripture memory, devotionals by place, feasts calendar.
   ====================================================================================== */
const BOOKCH = [["Genesis",50],["Exodus",40],["Leviticus",27],["Numbers",36],["Deuteronomy",34],["Joshua",24],["Judges",21],["Ruth",4],["1 Samuel",31],["2 Samuel",24],["1 Kings",22],["2 Kings",25],["1 Chronicles",29],["2 Chronicles",36],["Ezra",10],["Nehemiah",13],["Esther",10],["Job",42],["Psalms",150],["Proverbs",31],["Ecclesiastes",12],["Song of Solomon",8],["Isaiah",66],["Jeremiah",52],["Lamentations",5],["Ezekiel",48],["Daniel",12],["Hosea",14],["Joel",3],["Amos",9],["Obadiah",1],["Jonah",4],["Micah",7],["Nahum",3],["Habakkuk",3],["Zephaniah",3],["Haggai",2],["Zechariah",14],["Malachi",4],["Matthew",28],["Mark",16],["Luke",24],["John",21],["Acts",28],["Romans",16],["1 Corinthians",16],["2 Corinthians",13],["Galatians",6],["Ephesians",6],["Philippians",4],["Colossians",4],["1 Thessalonians",5],["2 Thessalonians",3],["1 Timothy",6],["2 Timothy",4],["Titus",3],["Philemon",1],["Hebrews",13],["James",5],["1 Peter",5],["2 Peter",3],["1 John",5],["2 John",1],["3 John",1],["Jude",1],["Revelation",22]];
(() => { // Bible in a year: every chapter, in order, over 365 days
  const all = BOOKCH.flatMap(([b, n]) => Array.from({ length: n }, (_, i) => `${b} ${i + 1}`)); const days = 365, stops = [];
  for (let d = 0; d < days; d++) { const a = Math.round(d * all.length / days), z = Math.round((d + 1) * all.length / days); const ch = all.slice(a, z); if (!ch.length) continue;
    const f = ch[0], l = ch[ch.length - 1], fb = f.replace(/ \d+$/, ''), lb = l.replace(/ \d+$/, '');
    const label = ch.length === 1 ? f : fb === lb ? `${f}–${l.split(' ').pop()}` : `${f} – ${l}`; stops.push([null, f, label, ch]); }
  ALLPLANS.unshift({ id: 'year', n: 'The whole Bible in a year', ref: 'Genesis – Revelation', intro: 'Every chapter of the Bible, in order, in 365 days — about three chapters (15 minutes) a day. Days tick off automatically when you read them in the reader.', stops });
})();

/* ---------- Scripture memory (spaced repetition) ---------- */
if (!MY.mem || typeof MY.mem !== 'object') MY.mem = {};
const BOXDAYS = [0, 1, 2, 4, 8, 16, 32, 64];
const firstLetters = t => t.replace(/([A-Za-zÀ-ɏ])[A-Za-zÀ-ɏ'’]*/g, '$1');
async function memText(ref) { const m = MY.mem[ref]; if (m?.t) return m.t; let t = MY.verses[ref]?.t || ''; if (!t) { try { const v = await bibleText(ref); t = v.verses.map(x => x.t).join(' ') || v.text; } catch { try { t = await glossVerse(ref); } catch {} } } if (m && t) { m.t = t; saveMy(); } return t; }
function addMemory(ref, t) { if (!MY.mem[ref]) { MY.mem[ref] = { box: 0, due: Date.now(), t: t || '', d: Date.now() }; saveMy(); toast('Added to Scripture memory'); } else toast('Already in your memory verses'); }
function viewMemory() {
  setNav('library'); document.title = 'Scripture memory — Just One More Lord';
  const refs = Object.keys(MY.mem), due = refs.filter(r => MY.mem[r].due <= Date.now());
  const saved = Object.keys(MY.verses).filter(r => !MY.mem[r]);
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">“I have hidden your word in my heart” · Psalm 119:11</p><h1>Scripture memory</h1><p>Learn verses by heart with short daily practice. Verses you know well come back less often; ones you find hard come back sooner.</p></div></div>
    <div class="statrow"><div><b>${due.length}</b><span>to practise today</span></div><div><b>${refs.length}</b><span>memory verses</span></div><div><b>${refs.filter(r => MY.mem[r].box >= 5).length}</b><span>learned</span></div></div>
    <div class="linkrow" style="margin:16px 0">${due.length ? '<button class="btn" id="mpr">Start practice</button>' : '<span class="notice">All caught up — well done! Come back tomorrow.</span>'}<a class="btn ghost sm" id="mcal" download="memory-reminder.ics">Daily reminder</a></div>
    <div class="filters"><label class="sr" for="madd">Add a verse</label><input id="madd" type="text" placeholder="Add a verse, e.g. John 3:16 or Psalm 23:1" style="flex:1;max-width:420px"><button class="btn sm" id="maddb">Add</button></div>
    ${['John 3:16', 'Psalms 23:1', 'Philippians 4:13', 'Proverbs 3:5', 'Romans 8:28', 'Joshua 1:9', 'Isaiah 40:31', 'Matthew 11:28'].filter(r => !MY.mem[r]).length ? `<p class="small muted">Popular: ${['John 3:16', 'Psalms 23:1', 'Philippians 4:13', 'Proverbs 3:5', 'Romans 8:28', 'Joshua 1:9', 'Isaiah 40:31', 'Matthew 11:28'].filter(r => !MY.mem[r]).map(r => `<button class="inl" data-madd="${r}">${r}</button>`).join(' · ')}</p>` : ''}
    ${saved.length ? `<p class="small muted">From your saved verses: ${saved.slice(0, 12).map(r => `<button class="inl" data-madd="${esc(r)}">${esc(r)}</button>`).join(' · ')}</p>` : ''}
    <h2 class="libh">My memory verses</h2>${refs.length ? `<div class="rlist">${refs.sort((a, b) => MY.mem[a].due - MY.mem[b].due).map(r => `<div class="ritem"><div><b>${esc(r)}</b><span>${MY.mem[r].box >= 5 ? 'Learned ✓' : 'Level ' + MY.mem[r].box + ' of 5'} · next ${MY.mem[r].due <= Date.now() ? 'today' : new Date(MY.mem[r].due).toLocaleDateString()}</span></div><button class="btn ghost sm" data-mdel="${esc(r)}">Remove</button></div>`).join('')}</div>` : '<p class="empty">Add your first verse above.</p>'}</div></section>`;
  const add = async r => { await loadConc(); const p = parseRef(r); if (!p) { toast('Type a reference like John 3:16'); return; } const ref = `${p.book.name} ${p.ch}:${p.v1}${p.v2 !== p.v1 && p.v2 < 999 ? '-' + p.v2 : ''}`; addMemory(ref); await memText(ref); viewMemory(); };
  $('#maddb').onclick = () => add($('#madd').value); $('#madd').onkeydown = e => { if (e.key === 'Enter') add(e.target.value); };
  main.querySelector('.wrap').addEventListener('click', e => { const a = e.target.closest('[data-madd]'); if (a) add(a.dataset.madd); const d = e.target.closest('[data-mdel]'); if (d) { delete MY.mem[d.dataset.mdel]; saveMy(); viewMemory(); } });
  $('#mpr')?.addEventListener('click', () => practise(due));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Just One More Lord//EN', 'BEGIN:VEVENT', 'UID:memory-' + Date.now() + '@justonemorelord', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', 'DTSTART:' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + 'T071500', 'DURATION:PT5M', 'RRULE:FREQ=DAILY', 'SUMMARY:Scripture memory practice', 'URL:' + SITE + '#memory', 'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Practise your memory verses', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  $('#mcal').href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
}
async function practise(list) {
  let i = 0, ok = 0; list = shuffle(list);
  const step = async () => { if (i >= list.length) { main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Practice complete</p><h1>${ok} of ${list.length} remembered</h1><p class="lead">Every verse you practise is going deeper into your heart.</p><div class="linkrow"><button class="btn" data-go="memory">Back to memory verses</button></div></div></section>`; track(); return; }
    const ref = list[i], t = await memText(ref), words = t.split(/\s+/); let mode = 0;
    const draw = () => { const shown = mode === 0 ? `<p class="mhint">${esc(firstLetters(t))}</p><p class="small muted">First letters only — say the verse aloud, then reveal.</p>` : mode === 1 ? `<p class="mtext">${words.map((w, k) => k % 3 === 1 ? `<button class="blank" data-w="${esc(w)}">${'_'.repeat(Math.max(3, w.replace(/\W/g, '').length))}</button>` : esc(w)).join(' ')}</p><p class="small muted">Tap a blank to check it.</p>` : `<p class="mtext full">${esc(t)}</p>`;
      main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Verse ${i + 1} of ${list.length}</p><h1 class="mref">${esc(ref)}</h1>${shown}
        <div class="linkrow">${mode < 2 ? `<button class="btn ghost" id="mnext">${mode === 0 ? 'Fill in the blanks' : 'Show the whole verse'}</button>` : `<button class="btn" id="mgood">✓ I knew it</button><button class="btn ghost" id="mbad">Not yet</button>`}</div></div></section>`;
      $('#mnext')?.addEventListener('click', () => { mode++; draw(); });
      main.querySelectorAll('.blank').forEach(b => b.onclick = () => { b.textContent = b.dataset.w; b.classList.add('on'); });
      $('#mgood')?.addEventListener('click', () => grade(true)); $('#mbad')?.addEventListener('click', () => grade(false)); };
    const grade = good => { const m = MY.mem[ref]; if (good) { ok++; m.box = Math.min(7, m.box + 1); } else m.box = Math.max(0, m.box - 2); m.due = Date.now() + (good ? BOXDAYS[m.box] * 864e5 : 6e5); saveMy(); i++; step(); };
    draw(); };
  step();
}

/* ---------- devotionals by place (written for this app) ---------- */
const DEVOS = {
  bethlehem: ['Small places, great purposes', 'Micah 5:2', 'Bethlehem was "little among the clans of Judah" — a village, not a capital. Yet God chose it for the birth of David and of Jesus. God often works through what the world overlooks. Your street, your job and your season may feel small, but nothing given to God is insignificant.', 'Lord, help me to be faithful in the small place where you have put me today.'],
  nazareth: ['Can anything good come from Nazareth?', 'John 1:46', 'Nathanael doubted that anything good could come from Nazareth. Philip did not argue; he said, "Come and see." People\'s opinions about where we are from do not define us. Jesus grew up in an ordinary town and was not ashamed of it — and he is not ashamed of us.', 'Jesus, thank you that my past and my background do not limit what you can do in me.'],
  capernaum: ['Jesus at home among us', 'Mark 2:1-5', 'Capernaum became Jesus\' home town. In a crowded house there, four friends dug through a roof to bring a paralysed man to him. Jesus saw their faith. Who could you carry to Jesus today — in prayer, in kindness, or by inviting them to come and see?', 'Lord, show me someone I can bring to you, and give me the courage of those four friends.'],
  'sea-of-galilee': ['Peace in the storm', 'Mark 4:39', 'The disciples were experienced fishermen, yet this storm terrified them. Jesus was asleep in the same boat. He spoke, and the wind and waves obeyed. The storm was real, but so was his presence. Whatever is raging around you, Jesus is in the boat with you.', 'Jesus, speak peace over my storm, and teach me to trust you while I wait.'],
  jericho: ['Walls that fall', 'Joshua 6:20', 'Jericho\'s walls looked impossible. God\'s plan — marching, waiting, shouting — looked foolish. But it was faith in God\'s word, not their strength, that brought them down (Hebrews 11:30). Centuries later, in the same town, Jesus called Zacchaeus down from a tree and the walls around a lonely heart fell too.', 'Father, I bring you the walls I cannot move. Thank you that the battle is yours; I trust your word and watch you work.'],
  'mount-sinai': ['God speaks', 'Exodus 20:2', 'Before God gave a single commandment at Sinai, he reminded Israel who he was: the God who brought them out of slavery. His commands came after his rescue, not before it. We do not obey in order to be loved; we obey because we already are.', 'Lord, thank you for rescuing me. Help me to live as someone who is free and loved.'],
  'valley-of-elah': ['The battle belongs to the Lord', '1 Samuel 17:47', 'An army froze in fear while a shepherd boy remembered what God had already done — the lion, the bear. David\'s courage came from memory. Remembering God\'s past faithfulness is how we face today\'s giants.', 'God, remind me of every time you have helped me, so I can face what is in front of me with courage.'],
  gethsemane: ['Not my will, but yours', 'Luke 22:42', 'In the olive grove Jesus was honest about his anguish and asked if there was another way. Then he surrendered: "Not my will, but yours." Prayer is not pretending to be strong; it is bringing our real feelings to the Father and trusting him with the outcome.', 'Father, here is what I really feel. I trust you with what happens next.'],
  golgotha: ['It is finished', 'John 19:30', 'At Golgotha Jesus cried, "It is finished." Not "I am finished" — but the work is complete. Every sin, every debt, every barrier between us and God was dealt with at the cross. There is nothing left for us to add, only to receive with thanks.', 'Jesus, thank you that what you did on the cross is complete. I receive it with all my heart.'],
  jerusalem: ['He is not here — he is risen', 'Luke 24:6', 'Jerusalem saw Jesus\' trial, death and burial — and then an empty tomb. The city of his suffering became the city of his victory and the birthplace of the church at Pentecost. The place of your deepest loss can become the place where God\'s power is most seen.', 'Risen Lord, bring resurrection life into the places in me that feel dead.'],
  bethany: ['Jesus wept', 'John 11:35', 'At Bethany Jesus knew he was about to raise Lazarus, yet he wept with Mary and Martha. He does not rush past our grief. The Lord of life stands beside us in sorrow, sharing our tears, before he speaks the word that changes everything.', 'Lord, thank you that you understand my sorrow. Stay close to me and bring life.'],
  malta: ['Safe through the shipwreck', 'Acts 27:44', 'God had promised Paul that no life would be lost — and still the ship broke apart. Some swam, some clung to planks, but all reached Malta safely. God\'s promises do not always mean an easy journey, but they do mean a sure arrival.', 'Lord, when my plans break apart, help me hold on to your promise and to whatever plank you give me.'],
  philippi: ['Songs at midnight', 'Acts 16:25', 'Beaten and locked in stocks, Paul and Silas prayed and sang at midnight — and the other prisoners listened. Their worship in the dark led a whole family to faith. Someone is listening to how you respond to your hardest moments.', 'Jesus, put a song in my heart even at midnight, and let others see you in me.']
};
function addDevotional(id) {
  const d = DEVOS[id]; const host = $('#s-ov'); if (!d || !host || $('#devo')) return;
  host.insertAdjacentHTML('afterend', `<section class="sec" id="devo"><div class="wrap"><div class="devo"><p class="kicker">Devotional · ${esc(byId[id]?.n || '')}</p><h2>${esc(d[0])}</h2><p class="pvref" style="font-size:16px"><button class="vref" data-verse="${esc(d[1])}">${esc(d[1])}</button></p><p class="lead">${esc(d[2])}</p><p class="devopray"><b>Pray:</b> ${esc(d[3])}</p>
    <div class="linkrow"><button class="btn ghost sm" id="devosh">${ICON.share} Share</button><button class="btn ghost sm" data-go="devotionals">All devotionals</button></div></div></div></section>`);
  $('#devosh').onclick = () => shareIt({ title: d[0], text: `${d[0]} — ${d[2].slice(0, 160)}… (${d[1]})`, hash: 'place-' + id });
}
function viewDevotionals() {
  setNav(''); document.title = 'Devotionals — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Short reflections</p><h1>Devotionals from the Bible lands</h1><p>A short reflection, a verse and a prayer from the places where it happened.</p></div></div>
    <div class="kgrid">${Object.entries(DEVOS).map(([id, d]) => `<article class="kcard devocard"><p class="kicker">${esc(byId[id]?.n || id)}</p><h3>${esc(d[0])}</h3><p>${esc(d[2])}</p><p class="devopray"><b>Pray:</b> ${esc(d[3])}</p><div class="linkrow"><button class="btn ghost sm" data-verse="${esc(d[1])}">${esc(d[1])}</button><button class="btn ghost sm" data-go="place-${id}">Visit ${esc(byId[id]?.n || '')}</button></div></article>`).join('')}</div></div></section>`;
}

/* ---------- feasts and holy days (Hebrew dates computed by the device's own calendar) ---------- */
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
function hebrewDays(from, to) { let fmt; try { fmt = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long' }); } catch { return []; } const out = [];
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) { const p = fmt.formatToParts(d); out.push({ date: new Date(d), m: p.find(x => x.type === 'month')?.value || '', day: +(p.find(x => x.type === 'day')?.value || 0) }); } return out; }
const FEASTS = [['Purim', ['Adar', 'Adar II'], 14, 'Esther 9:21-22', 'susa', 'Celebrates the deliverance of the Jewish people in Persia through Queen Esther.'], ['Passover (Pesach)', ['Nisan'], 15, 'Exodus 12:14', 'rameses', 'Remembers the Exodus from Egypt. Jesus\' Last Supper was a Passover meal.'], ['Pentecost (Shavuot)', ['Sivan'], 6, 'Acts 2:1', 'jerusalem', 'Harvest feast fifty days after Passover; the day the Holy Spirit was given.'], ['Feast of Trumpets (Rosh Hashanah)', ['Tishri'], 1, 'Leviticus 23:24', 'jerusalem', 'The Jewish New Year, announced with trumpet blasts.'], ['Day of Atonement (Yom Kippur)', ['Tishri'], 10, 'Leviticus 16:30', 'temple-mount', 'The holiest day: fasting, repentance and atonement.'], ['Feast of Tabernacles (Sukkot)', ['Tishri'], 15, 'John 7:37', 'jerusalem', 'Living in shelters to remember the wilderness; Jesus taught at this feast.'], ['Feast of Dedication (Hanukkah)', ['Kislev'], 25, 'John 10:22-23', 'temple-mount', 'Remembers the rededication of the Temple; Jesus was in Jerusalem at this feast.']];
function viewFeasts() {
  setNav('timeline'); document.title = 'Feasts and holy days — Just One More Lord';
  const now = new Date(); now.setHours(0, 0, 0, 0); const end = new Date(now); end.setFullYear(end.getFullYear() + 1); const list = [];
  for (const h of hebrewDays(now, end)) for (const f of FEASTS) if (f[1].includes(h.m) && h.day === f[2]) list.push({ date: h.date, n: f[0], ref: f[3], pl: f[4], d: f[5], heb: true });
  for (const y of [now.getFullYear(), now.getFullYear() + 1]) { const e = easter(y); const add = (n, off, ref, pl, d) => { const x = new Date(e); x.setDate(x.getDate() + off); list.push({ date: x, n, ref, pl, d }); };
    add('Palm Sunday', -7, 'John 12:13', 'mount-of-olives', 'Jesus rides into Jerusalem.'); add('Good Friday', -2, 'Luke 23:33', 'golgotha', 'The crucifixion of Jesus.'); add('Easter Sunday', 0, 'Luke 24:6', 'jerusalem', 'The resurrection of Jesus.'); add('Ascension Day', 39, 'Acts 1:9', 'mount-of-olives', 'Jesus ascends to heaven.'); add('Pentecost Sunday', 49, 'Acts 2:4', 'jerusalem', 'The church celebrates the coming of the Holy Spirit.');
    list.push({ date: new Date(y, 11, 25), n: 'Christmas', ref: 'Luke 2:11', pl: 'bethlehem', d: 'The birth of Jesus.' }); }
  const items = list.filter(x => x.date >= now && x.date <= end).sort((a, b) => a.date - b.date);
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">The year ahead</p><h1>Feasts and holy days</h1><p>The biblical feasts and the main Christian holy days for the next twelve months, with their Bible readings and places. Jewish feasts begin at sunset the evening before the date shown.</p></div><div class="linkrow"><button class="btn ghost sm" data-go="timeline">Timeline</button></div></div>
    ${items.length ? `<div class="rlist">${items.map(x => `<div class="ritem feast${x.heb ? ' hebfeast' : ''}"><div><b>${esc(x.n)}</b><span>${x.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${esc(x.d)}</span><span class="linkrow" style="margin-top:6px"><button class="btn ghost sm" data-verse="${esc(x.ref)}">${esc(x.ref)}</button>${byId[x.pl] ? `<button class="btn ghost sm" data-go="place-${x.pl}">${esc(byId[x.pl].n)}</button>` : ''}</span></div><span class="tag">${Math.round((x.date - now) / 864e5) === 0 ? 'Today' : 'in ' + Math.round((x.date - now) / 864e5) + ' days'}</span></div>`).join('')}</div>` : '<p class="empty">This device cannot calculate the Hebrew calendar.</p>'}
    <p class="small muted">Hebrew dates are calculated by your device's built-in Hebrew calendar. Some traditions keep feasts on different days (for example, Orthodox Easter).</p></div></section>`;
}

/* ======================================================================================
   ACCOUNTS: sign up / sign in, profile and cloud sync (Supabase, free tier). Switched on by js/config.js → supabase.
   Also: privacy-friendly visitor counts (Cloudflare), donate button, WhatsApp channel.
   ====================================================================================== */
const SB = CFG.supabase || {}; const sbOn = () => !!(SB.url && SB.anonKey);
const AUTH = (() => { try { return JSON.parse(localStorage.getItem('jom:auth') || 'null'); } catch { return null; } })() || {};
const saveAuth = () => { try { localStorage.setItem('jom:auth', JSON.stringify(AUTH)); } catch {} };
async function sbFetch(path, opts = {}, auth = true) {
  if (auth && AUTH.exp && Date.now() > AUTH.exp - 60000) await sbRefresh();
  const r = await fetch(SB.url.replace(/\/$/, '') + path, { ...opts, headers: { apikey: SB.anonKey, 'Content-Type': 'application/json', ...(auth && AUTH.access ? { Authorization: 'Bearer ' + AUTH.access } : {}), ...(opts.headers || {}) } });
  const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
  if (!r.ok) { const e = new Error(j?.msg || j?.error_description || j?.message || j?.error || 'Request failed (' + r.status + ')'); e.status = r.status; throw e; } return j;
}
function setSession(j) { if (!j?.access_token) return false; Object.assign(AUTH, { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, user: j.user || AUTH.user }); saveAuth(); return true; }
async function sbRefresh() { if (!AUTH.refresh) return; try { setSession(await sbFetch('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: AUTH.refresh }) }, false)); } catch { signOutLocal(); } }
function signOutLocal() { for (const k of Object.keys(AUTH)) delete AUTH[k]; saveAuth(); }
const signedIn = () => !!(AUTH.access && AUTH.user);
function handleAuthRedirect() { // magic-link / confirmation / Google sign-in come back as #access_token=...
  const h = location.hash.slice(1); if (!/access_token=/.test(h) && !/error_description=/.test(h)) return false;
  const q = new URLSearchParams(h); if (q.get('error_description')) { history.replaceState(null, '', location.pathname + '#profile'); setTimeout(() => toast(q.get('error_description')), 500); return true; }
  setSession({ access_token: q.get('access_token'), refresh_token: q.get('refresh_token'), expires_in: +q.get('expires_in') || 3600 });
  history.replaceState(null, '', location.pathname + '#profile');
  sbFetch('/auth/v1/user').then(u => { AUTH.user = u; saveAuth(); pullProfile().then(() => { toast('Signed in'); if (location.hash === '#profile') viewProfile(); }); }).catch(() => {});
  return true;
}
/* sync: the whole library (MY) is stored in your own profile row, merged with what is on this phone */
const SYNC_KEYS = ['places', 'verses', 'notes', 'hl', 'plans', 'quiz', 'friends', 'days', 'readCh', 'visited', 'strongs', 'badges', 'mem'];
function mergeMy(remote) { if (!remote || typeof remote !== 'object') return;
  for (const k of SYNC_KEYS) if (remote[k] && typeof remote[k] === 'object') { MY[k] = MY[k] || {}; for (const [kk, v] of Object.entries(remote[k])) {
    if (k === 'plans') { const a = MY.plans[kk]?.done || [], b = v?.done || []; MY.plans[kk] = { ...(MY.plans[kk] || v), done: [...new Set([...a, ...b])] }; }
    else if (!(kk in MY[k])) MY[k][kk] = v; else if (v && typeof v === 'object' && (v.d || 0) > (MY[k][kk]?.d || 0)) MY[k][kk] = v; } }
  if (Array.isArray(remote.prayers)) MY.prayers = [...(MY.prayers || []), ...remote.prayers.filter(p => !(MY.prayers || []).some(x => x.id === p.id))];
  ['name', 'quizPerfect', 'last'].forEach(k => { if (remote[k] && !MY[k]) MY[k] = remote[k]; });
  try { localStorage.setItem('jom:my', JSON.stringify(MY)); } catch {} }
async function pullProfile() { if (!sbOn() || !signedIn()) return null; try { const rows = await sbFetch(`/rest/v1/profiles?id=eq.${AUTH.user.id}&select=*`); const r = rows?.[0]; if (r) { AUTH.profile = { name: r.name, church: r.church, country: r.country, bio: r.bio, public: r.is_public, avatar: r.avatar_url || null, code: r.friend_code || null, online: r.show_online !== false, focus: r.prayer_focus || '' }; $('#meBtn')?.remove(); profileBtn(); saveAuth(); mergeMy(r.data); } await pushProfile(); return r; } catch (e) { console.warn(e); return null; } }
let pushT = null, pushing = false;
async function pushProfile() { if (!sbOn() || !signedIn() || pushing) return; pushing = true;
  try { const pr = AUTH.profile || {}; await sbFetch('/rest/v1/profiles', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: AUTH.user.id, name: pr.name || MY.name || null, church: pr.church || null, country: pr.country || null, bio: pr.bio || null, is_public: !!pr.public, data: MY, updated_at: new Date().toISOString() }) }); AUTH.synced = Date.now(); saveAuth(); }
  catch (e) { console.warn('sync', e.message); } finally { pushing = false; } }
const _saveMy = saveMy;
saveMy = () => { _saveMy(); if (sbOn() && signedIn()) { clearTimeout(pushT); pushT = setTimeout(pushProfile, 4000); } };
function profileBtn() { const t = $('.tools'); if (!t || $('#meBtn')) return; const n = (AUTH.profile?.name || MY.name || '').trim();
  t.insertAdjacentHTML('afterbegin', `<button class="tbtn me" id="meBtn" data-go="profile" title="My profile" aria-label="My profile">${AUTH.profile?.avatar ? `<img class="meimg" src="${esc(AUTH.profile.avatar)}" alt="">` : n ? esc(n[0].toUpperCase()) : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'}</button>`); }
function viewProfile() {
  setNav(''); document.title = 'My profile — Just One More Lord';
  if (!sbOn()) { main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Accounts</p><h1>Profiles are almost ready</h1><p class="lead">Sign-up needs the site owner to connect a free Supabase account (see <code>SETUP.md</code>). Until then, everything you save is kept on this phone — use <button class="inl" data-go="library">My library</button> → Download backup to move it.</p></div></section>`; return; }
  if (!signedIn()) {
    let mode = 'in';
    const draw = () => { main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Free account</p><h1>${mode === 'in' ? 'Sign in' : 'Create your profile'}</h1><p class="lead">Keep your saved places, verses, notes, prayers, plans, streaks and badges safe — and on every device you use.</p>
      <form class="authform" id="af"><label>Email<input type="email" id="ae" required autocomplete="email"></label><label>Password<input type="password" id="ap" required minlength="8" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" placeholder="At least 8 characters"></label>
      ${mode === 'up' ? '<label>Your name<input type="text" id="an" maxlength="40" autocomplete="given-name"></label>' : ''}<button class="btn" type="submit">${mode === 'in' ? 'Sign in' : 'Create account'}</button><p class="small" id="amsg" aria-live="polite"></p></form>
      ${SB.google ? '<button class="btn ghost" id="agoogle">Continue with Google</button>' : ''}
      <p class="small">${mode === 'in' ? 'New here? <button class="inl" id="asw">Create a free account</button>' : 'Already have an account? <button class="inl" id="asw">Sign in</button>'} · <button class="inl" id="amagic">Email me a sign-in link</button></p>
      <p class="small muted">By creating an account you agree to the <a href="privacy.html" target="_blank">privacy policy</a>. Your data is never sold.</p></div></section>`;
      $('#asw').onclick = () => { mode = mode === 'in' ? 'up' : 'in'; draw(); };
      const msg = (t, bad) => { const m = $('#amsg'); m.textContent = t; m.className = 'small ' + (bad ? 'warnt' : 'okt'); };
      $('#af').onsubmit = async e => { e.preventDefault(); const email = $('#ae').value.trim(), password = $('#ap').value; msg('Please wait…');
        try { if (mode === 'up') { const j = await sbFetch('/auth/v1/signup?redirect_to=' + encodeURIComponent(SITE), { method: 'POST', body: JSON.stringify({ email, password, data: { name: $('#an')?.value.trim() || '' } }) }, false);
            if (!setSession(j)) { msg('Check your email and tap the confirmation link to finish creating your account.'); return; } MY.name = MY.name || $('#an')?.value.trim(); AUTH.profile = { name: MY.name }; }
          else setSession(await sbFetch('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }, false));
          await pullProfile(); toast('Welcome!'); $('#meBtn')?.remove(); profileBtn(); viewProfile(); }
        catch (er) { msg(/invalid login/i.test(er.message) ? 'Wrong email or password.' : er.message, true); } };
      $('#amagic').onclick = async () => { const email = $('#ae').value.trim(); if (!email) { msg('Type your email first.', true); return; }
        try { await sbFetch('/auth/v1/otp?redirect_to=' + encodeURIComponent(SITE), { method: 'POST', body: JSON.stringify({ email, create_user: true, options: { email_redirect_to: SITE } }) }, false); msg('Check your email for a sign-in link.'); } catch (er) { msg(er.message, true); } };
      $('#agoogle')?.addEventListener('click', () => { location.href = `${SB.url.replace(/\/$/, '')}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(SITE)}`; }); };
    draw(); return;
  }
  const pr = AUTH.profile || {}; const u = AUTH.user || {};
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Signed in as ${esc(u.email || '')}</p><h1>${esc(pr.name || 'My profile')}</h1><p>Your library is saved to your account and syncs to every device where you sign in.</p></div></div>
    <div class="commgrid"><form class="panel authform" id="pf"><h2>Profile</h2><label>Name<input id="pn" maxlength="40" value="${esc(pr.name || MY.name || '')}"></label><label>Church (optional)<input id="pc" maxlength="80" value="${esc(pr.church || '')}"></label>
      <label>Country (optional)<input id="pco" maxlength="60" value="${esc(pr.country || '')}"></label><label>About me (optional)<textarea id="pb" rows="3" maxlength="300">${esc(pr.bio || '')}</textarea></label>
      <label class="tog"><input type="checkbox" id="ppub" ${pr.public ? 'checked' : ''}> Let friends find me by name</label><button class="btn" type="submit">Save profile</button></form>
      <div class="panel"><h2>Sync</h2><p class="small muted">Last synced: ${AUTH.synced ? new Date(AUTH.synced).toLocaleString() : 'not yet'}</p><div class="linkrow"><button class="btn sm" id="psync">Sync now</button><button class="btn ghost sm" data-go="library">My library</button></div>
        <h2 style="margin-top:18px">Account</h2><div class="linkrow"><button class="btn ghost sm" id="pout">Sign out</button><button class="btn ghost sm" id="pdel">Delete my data</button></div>
        <p class="small muted">Deleting removes your profile and synced library from our database. To remove the login itself, email the address in the <a href="privacy.html" target="_blank">privacy policy</a>.</p></div></div>
    <h2 class="libh">My progress</h2>${progressHTML()}</div></section>`;
  $('#pf').onsubmit = async e => { e.preventDefault(); AUTH.profile = { ...AUTH.profile, name: $('#pn').value.trim(), church: $('#pc').value.trim(), country: $('#pco').value.trim(), bio: $('#pb').value.trim(), public: $('#ppub').checked }; MY.name = AUTH.profile.name; saveAuth(); _saveMy(); await pushProfile(); toast('Profile saved'); $('#meBtn')?.remove(); profileBtn(); };
  $('#psync').onclick = async () => { await pullProfile(); toast('Synced'); viewProfile(); };
  $('#pout').onclick = async () => { try { await sbFetch('/auth/v1/logout', { method: 'POST' }); } catch {} signOutLocal(); toast('Signed out'); $('#meBtn')?.remove(); profileBtn(); viewProfile(); };
  $('#pdel').onclick = async () => { if (!confirm('Delete your profile and synced library from the server? What is on this phone stays.')) return; try { await sbFetch(`/rest/v1/profiles?id=eq.${u.id}`, { method: 'DELETE' }); toast('Your data was deleted from the server'); } catch (er) { toast(er.message); } signOutLocal(); $('#meBtn')?.remove(); profileBtn(); viewProfile(); };
}

/* ---------- extras switched on in js/config.js ---------- */
(() => {
  if (CFG.cloudflareToken) { const s = document.createElement('script'); s.defer = true; s.src = 'https://static.cloudflareinsights.com/beacon.min.js'; s.setAttribute('data-cf-beacon', JSON.stringify({ token: CFG.cloudflareToken })); document.head.append(s); }
  const f = $('.foot-in > div'); if (f && (CFG.donateUrl || CFG.whatsappChannel)) f.insertAdjacentHTML('beforeend', `<div class="linkrow">${CFG.whatsappChannel ? `<a class="btn ghost sm" href="${esc(CFG.whatsappChannel)}" target="_blank" rel="noopener">Follow on WhatsApp</a>` : ''}${CFG.donateUrl ? `<a class="btn sm" href="${esc(CFG.donateUrl)}" target="_blank" rel="noopener">❤ Support this app</a>` : ''}</div>`);
  if (location.hash.includes('access_token=') || location.hash.includes('error_description=')) handleAuthRedirect();
  profileBtn(); if (sbOn() && signedIn()) setTimeout(pullProfile, 1500);
})();

/* ======================================================================================
   PEOPLE OF THE BIBLE: a searchable profile for all 3,000+ named people.
   Data: Theographic Bible Metadata (CC BY-SA 4.0) and Easton's Bible Dictionary (1897, public domain), built in CI.
   ====================================================================================== */
let PIDX = null; const PSH = {};
async function peopleIndex() { if (PIDX) return PIDX; try { const r = await fetch('data/people/index.json'); if (!r.ok) throw 0; PIDX = await r.json(); } catch { PIDX = []; } return PIDX; }
async function personData(slug) { const row = (await peopleIndex()).find(r => r[0] === slug); if (!row) return null; const L = row[6];
  if (!PSH[L]) PSH[L] = fetch(`data/people/${L}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})); return (await PSH[L])[slug] || null; }
const pyr = y => y == null ? '' : y < 0 ? `${-y} BC` : `AD ${y}`;
const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '');
function personMatches(q, idx, n = 30) { q = normName(q).trim(); if (!q) return [];
  const sc = r => { const nm = normName(r[1]), al = normName(r[2]); if (nm === q) return 100; if (nm.startsWith(q)) return 60; if (al.split(/\s*,?\s+/).includes(q)) return 50; if (nm.includes(q)) return 30; if (al.includes(q)) return 20; return 0; };
  return idx.map(r => [r, sc(r)]).filter(x => x[1]).sort((a, b) => b[1] - a[1] || b[0][5] - a[0][5]).slice(0, n).map(x => x[0]); }
const prow = r => `<button class="ritem" data-go="person-${esc(r[0])}"><div><b>${esc(r[7] || r[1])}</b><span>${r[2] ? 'Also: ' + esc(r[2].split(',').slice(0, 4).join(', ')) + ' · ' : ''}${esc(r[4])}${r[4].length >= 110 ? '…' : ''}</span></div><span class="tag">${r[5]} verse${r[5] === 1 ? '' : 's'}</span></button>`;
async function viewPeople(q) {
  setNav(''); document.title = 'People of the Bible — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Who's who in the Bible</p><h1>People of the Bible</h1><p>Look up anyone named in the Bible — over 3,000 people. Each profile brings together their family, dates and age, where they were born, lived and died on a map, their journeys, life events, every verse that mentions them and a biography.</p></div></div>
    <form class="bigsearch" id="pform" role="search" style="max-width:640px"><label class="sr" for="pq">Search for a person</label><input id="pq" type="search" placeholder="Try Abraham, Ruth, David, Mary, Paul…" value="${esc(q || '')}" autocomplete="off"><button class="btn" type="submit">Search</button></form>
    <div id="pres" style="margin-top:18px"><p class="muted"><span class="spin"></span>Loading people…</p></div></div></section>`;
  const idx = await peopleIndex();
  if (!idx.length) { $('#pres').innerHTML = '<p class="empty">The people data is not available yet. It is added automatically the next time the site is published.</p>'; return; }
  const show = v => { const m = personMatches(v, idx); $('#pres').innerHTML = v.trim() ? (m.length ? `<p class="small muted">${m.length >= 30 ? 'Top 30 matches' : m.length + ' match' + (m.length === 1 ? '' : 'es')}</p><div class="rlist">${m.map(prow).join('')}</div>` : '<p class="empty">No one by that name. Try another spelling.</p>')
    : `<h2 class="libh" style="margin-top:6px">Most mentioned</h2><div class="rlist">${idx.filter(r => r[0] !== 'god_1324').slice(0, 24).map(prow).join('')}</div>
      <h2 class="libh">Browse A–Z</h2><div class="chips">${[...new Set(idx.map(r => r[1][0].toUpperCase()))].sort().map(L => `<button class="chip" data-az="${L}">${L}</button>`).join('')}</div><div id="paz" style="margin-top:12px"></div>`;
    $$('[data-az]').forEach(b => b.onclick = () => { $$('[data-az]').forEach(x => x.setAttribute('aria-pressed', x === b)); $('#paz').innerHTML = `<div class="rlist">${idx.filter(r => r[1][0].toUpperCase() === b.dataset.az).sort((a, c) => a[1].localeCompare(c[1])).map(prow).join('')}</div>`; }); };
  let tm; $('#pq').oninput = e => { clearTimeout(tm); tm = setTimeout(() => show(e.target.value), 150); };
  $('#pform').onsubmit = e => { e.preventDefault(); show($('#pq').value); }; show(q || '');
}
const placeByName = n => { const k = normName(n); return PLACES.find(p => [p.n, p.bn, p.mn, ...(p.alt || [])].some(x => normName(x) === k)); };
async function viewPerson(slug) {
  setNav(''); main.innerHTML = `<section class="band"><div class="wrap"><p class="muted"><span class="spin"></span>Loading profile…</p></div></section>`;
  const d = await personData(slug); if (!d) { main.innerHTML = `<section class="band"><div class="wrap"><h1>Person not found</h1><p><button class="inl" data-go="people">Search the people of the Bible</button></p></div></section>`; return; }
  const name = d.t || d.n; document.title = `${name} — People of the Bible — Just One More Lord`; track('visited', 'person:' + slug);
  const link = x => `<button class="chip" data-go="person-${esc(x[0])}">${esc(x[1])}</button>`;
  const fam = [['Father', d.f], ['Mother', d.m], [d.g === 'Female' ? 'Husband' : d.g === 'Male' ? 'Wife / wives' : 'Spouse', d.sp], ['Brothers and sisters', d.sib], ['Children', d.ch]].filter(x => x[1].length);
  const vrefs = d.v.map(osisToRef); const first = vrefs[0], last = vrefs[vrefs.length - 1];
  const nm = [d.n, ...d.a].map(normName); const js = JOURNEYS.filter(j => nm.some(x => x.length > 2 && new RegExp('\\b' + x + 's?\\b').test(normName(j.n))));
  const facts = [d.b != null && ['Born', `${pyr(d.b)}${d.bp ? ' · ' + d.bp.n : ''}`], d.b == null && d.bp && ['Birthplace', d.bp.n], d.x != null && ['Died', `${pyr(d.x)}${d.dp ? ' · ' + d.dp.n : ''}`], d.x == null && d.dp && ['Place of death', d.dp.n],
    d.age != null && d.age > 0 && ['Age at death', `${d.age} years`], d.g && ['Gender', d.g], d.a.length && ['Also called', d.a.slice(0, 8).join(', ')], d.gr.length && ['Groups', d.gr.join(', ')],
    d.w.length && ['Wrote', d.w.join(', ')], ['Mentioned', `${d.vc} verse${d.vc === 1 ? '' : 's'}${first ? ` · first in ${first}` : ''}${last && last !== first ? `, last in ${last}` : ''}`], (d.y0 != null) && ['Appears in history', d.y0 === d.y1 ? pyr(d.y0) : `${pyr(d.y0)} – ${pyr(d.y1)}`]].filter(Boolean);
  main.innerHTML = `<section class="phero person"><div class="wrap in"><div class="crumbs"><button data-go="people">People of the Bible</button> › ${esc(d.n)}</div><p class="kicker">${esc(d.gr[0] || (d.g === 'Female' ? 'Woman of the Bible' : d.g === 'Male' ? 'Man of the Bible' : 'Named in the Bible'))}</p>
      <h1>${esc(name)}</h1><p class="sub">${d.a.length ? 'Also called ' + esc(d.a.slice(0, 5).join(', ')) : ''}</p>
      <div class="ptools"><button class="pill" id="pshare">${ICON.share}<span>Share</span></button><button class="pill" id="porig">Hebrew / Greek name</button><button class="pill" id="pless">Add to lesson</button></div><div id="porigbox"></div></div></section>
    <section class="sec"><div class="wrap"><div class="facts pfacts">${facts.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
      ${d.b != null || d.x != null ? '<p class="small muted">Dates follow a traditional Bible chronology and are approximate; scholars differ, especially for the earliest periods.</p>' : ''}</div></section>
    ${fam.length ? `<section class="sec"><div class="wrap"><h2>Family</h2><div class="famgrid">${fam.map(([k, list]) => `<div class="panel"><p class="kicker">${k}</p><div class="chips">${list.map(link).join('')}</div></div>`).join('')}</div></div></section>` : ''}
    ${d.pl.length || d.bp || d.dp ? `<section class="sec"><div class="wrap"><h2>Where ${esc(d.n)} lived and travelled</h2><p class="muted">Places named in the same verses as ${esc(d.n)}${d.bp ? ', with the birthplace' : ''}${d.dp ? ' and place of death' : ''} highlighted.</p><div class="mapbox tall" id="pmap"></div>
      <div class="maplegend">${d.bp ? '<span><span class="dot" style="background:#fff;color:#ff3ec8"></span> Born</span>' : ''}${d.dp ? '<span><span class="dot" style="background:#ff7a3d;color:#ff7a3d"></span> Died</span>' : ''}<span><span class="dot" style="background:#00d1ff;color:#00d1ff"></span> Places in the story</span></div>
      <div class="chips" style="margin-top:12px">${d.pl.slice(0, 18).map(x => { const pp = placeByName(x.n); return pp ? `<button class="chip" data-go="place-${pp.id}">${esc(x.n)} · ${x.c}</button>` : `<span class="chip static">${esc(x.n)} · ${x.c}</span>`; }).join('')}</div></div></section>` : ''}
    ${js.length ? `<section class="sec"><div class="wrap"><h2>Journeys</h2><div class="rlist">${js.map(j => `<div class="ritem"><div><b>${esc(j.n)}</b><span>${esc(j.ref)} · ${j.stops.length} stages · ≈ ${fmtKm(journeyKm(j))}</span></div><span class="linkrow"><button class="btn sm" data-go="journey-${j.id}">Map</button><button class="btn ghost sm" data-go="fly-${j.id}">3D</button></span></div>`).join('')}</div></div></section>` : ''}
    ${d.tl.length ? `<section class="sec"><div class="wrap"><h2>Life events</h2><ol class="ptl">${d.tl.map(e => `<li><span class="yr">${e.y != null ? pyr(e.y) : ''}</span><div><b>${esc(e.t)}</b>${e.r ? ` <button class="vref sm" data-verse="${esc(e.r)}">${esc(e.r)}</button>` : ''}</div></li>`).join('')}</ol></div></section>` : ''}
    ${d.bio || d.ea ? `<section class="sec"><div class="wrap prose"><h2>Biography</h2>${d.bio ? d.bio.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join('') : ''}
      ${d.ea ? `<details class="easton"${d.bio ? '' : ' open'}><summary>Easton's Bible Dictionary (1897)</summary>${d.ea.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join('')}</details>` : ''}</div></section>` : ''}
    ${d.bk.length ? `<section class="sec"><div class="wrap"><h2>Where ${esc(d.n)} appears in the Bible</h2><div class="bkbars">${d.bk.map(([b, c]) => `<div><span>${esc(b)}</span><i style="width:${Math.max(4, 100 * c / d.bk[0][1])}%"></i><b>${c}</b></div>`).join('')}</div></div></section>` : ''}
    <section class="sec"><div class="wrap"><h2>Every verse that mentions ${esc(d.n)} <span class="small muted">(${vrefs.length})</span></h2><div class="chips" id="pverses">${vrefs.slice(0, 40).map(r => `<button class="chip xr" data-verse="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      ${vrefs.length > 40 ? `<button class="btn ghost sm" id="pmore" style="margin-top:10px">Show all ${vrefs.length}</button>` : ''}</div></section>
    <section class="sec"><div class="wrap"><p class="small muted">Profile data: <a href="https://theographic.netlify.app/" target="_blank" rel="noopener">Theographic Bible Metadata</a> by Robert Rouse (CC BY-SA 4.0) and Easton's Bible Dictionary (1897, public domain). Places are shown where the dataset has coordinates.</p></div></section>`;
  $('#pless').onclick = () => lessonAdd({ k: 'person', ref: slug, t: name });
  $('#pmore')?.addEventListener('click', e => { $('#pverses').innerHTML = vrefs.map(r => `<button class="chip xr" data-verse="${esc(r)}">${esc(r)}</button>`).join(''); e.target.remove(); });
  $('#pshare').onclick = () => shareIt({ title: `${name} — People of the Bible`, text: `${name}: ${(d.bio || d.ea).slice(0, 180)}…`, hash: 'person-' + slug });
  $('#porig').onclick = async () => { const box = $('#porigbox'); box.innerHTML = '<p class="small muted"><span class="spin"></span>Looking in the Hebrew and Greek lexicons…</p>';
    try { await loadConc(); const keys = conc.keys.filter(k => { const L = conc.lex[k]; return L && nm.includes(normName(L[3])); }).slice(0, 6);
      box.innerHTML = keys.length ? `<div class="chips" style="margin-top:10px">${keys.map(k => `<button class="chip" data-go="strong-${k}"><span class="${k[0] === 'H' ? 'heb' : 'grk'}">${esc(conc.lex[k][0])}</span> · ${esc(conc.lex[k][1])} · ${k}</button>`).join('')}</div>` : '<p class="small muted">No exact match in the lexicon for this name.</p>'; }
    catch { box.innerHTML = '<p class="small muted">The lexicon could not be loaded.</p>'; } };
  if ($('#pmap')) { const mk = d.pl.filter(x => x.lat && x.lon).map(x => { const pp = placeByName(x.n); return { lat: x.lat, lon: x.lon, label: x.n, sub: `${x.c} verse${x.c === 1 ? '' : 's'} with ${d.n}`, kind: 'place', go: pp ? 'place-' + pp.id : undefined }; });
    if (d.bp?.lat) mk.unshift({ lat: d.bp.lat, lon: d.bp.lon, label: 'Born: ' + d.bp.n, kind: 'main' }); if (d.dp?.lat) mk.unshift({ lat: d.dp.lat, lon: d.dp.lon, label: 'Died: ' + d.dp.n, kind: 'disc' });
    if (mk.length) makeMap($('#pmap'), { markers: mk, maxZoom: 9 }); else $('#pmap').closest('.sec').remove(); }
}
async function addPeopleAnswers(q) { if (!q || q.length < 2) return; const idx = await peopleIndex(); const m = personMatches(q.replace(/^(who (was|is)|tell me about)\s+/i, '').replace(/\?$/, ''), idx, 4).filter(r => r[0] !== 'god_1324'); const h1 = $('main h1'); if (!m.length || !h1) return;
  h1.insertAdjacentHTML('afterend', `<div class="answers"><p class="kicker">People</p><div class="rlist">${m.map(prow).join('')}</div></div>`); }

/* ---------- the age of mankind: from Adam to the apostles (traditional Bible chronology) ---------- */
async function viewChronology() {
  setNav('timeline'); document.title = 'From Adam to today — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><p class="muted"><span class="spin"></span>Loading…</p></div></section>`;
  const idx = await peopleIndex(); const dated = idx.filter(r => r[8] != null && r[9] != null && r[9] > r[8]).sort((a, b) => a[8] - b[8]);
  if (!dated.length) { main.innerHTML = `<section class="band"><div class="wrap"><p class="empty">The people data is not available yet.</p></div></section>`; return; }
  const adam = dated.find(r => r[1] === 'Adam') || dated[0]; const creation = adam[8], nowY = new Date().getFullYear(), sinceCreation = nowY - creation - (creation < 0 ? 1 : 0);
  const lastY = Math.max(...idx.map(r => r[10] ?? -9999)); const Y0 = creation, Y1 = Math.max(100, lastY), span = Y1 - Y0;
  const pct = y => (100 * (y - Y0) / span).toFixed(2);
  const byName = n => dated.find(r => r[1] === n);
  const facts = []; const ov = (a, b) => { const A = byName(a), B = byName(b); if (!A || !B) return; const o = Math.min(A[9], B[9]) - Math.max(A[8], B[8]); if (o > 0) facts.push(`${a} and ${b} were alive at the same time for about ${o} years.`); };
  ov('Adam', 'Methuselah'); ov('Methuselah', 'Noah'); ov('Adam', 'Lamech'); ov('Shem', 'Abraham'); ov('Noah', 'Abraham'); ov('Shem', 'Isaac'); ov('Shem', 'Israel');
  const flood = byName('Noah') ? byName('Noah')[8] + 600 : null;
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">The age of mankind in the Bible</p><h1>From Adam to today</h1><p>Adding up the ages in the Bible's genealogies (Genesis 5 and 11) and the reigns of the kings gives a traditional date for creation and for each generation since. This page follows the chronology used by Theographic, which is close to Archbishop James Ussher's famous 1650 calculation.</p></div><div class="linkrow"><button class="btn ghost sm" data-go="timeline">Timeline</button><button class="btn ghost sm" data-go="people">People</button></div></div>
    <div class="statrow"><div><b>${pyr(creation)}</b><span>creation of Adam (traditional)</span></div><div><b>≈ ${sinceCreation.toLocaleString()}</b><span>years from Adam to ${nowY}</span></div>${flood ? `<div><b>${pyr(flood)}</b><span>the Flood (Noah aged 600)</span></div>` : ''}<div><b>${(-creation - 4 + 1).toLocaleString()}</b><span>years from Adam to Jesus' birth</span></div></div>
    <h2 class="libh">Lifespans from Adam to Jesus</h2><p class="small muted">Each bar shows a life from birth to death. Tap a name for the full profile.</p>
    <div class="lifechart">${dated.map(r => `<button class="life" data-go="person-${esc(r[0])}" title="${esc(r[1])}: ${pyr(r[8])} – ${pyr(r[9])}"><span class="lname">${esc(r[1])}<small>${r[9] - r[8]} yrs · ${pyr(r[8])}</small></span><span class="ltrack"><i style="left:${pct(r[8])}%;width:${Math.max(.6, 100 * (r[9] - r[8]) / span).toFixed(2)}%"></i></span></button>`).join('')}
      <div class="laxis">${[-4000, -3000, -2000, -1000, 0].filter(y => y >= Y0).map(y => `<span style="left:${pct(y)}%">${y === 0 ? 'BC | AD' : pyr(y)}</span>`).join('')}</div></div>
    ${facts.length ? `<h2 class="libh">Did you know?</h2><ul class="dyk">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    <h2 class="libh">Different ways Christians read these numbers</h2><div class="prose"><ul>
      <li><b>Traditional (Ussher) chronology:</b> reads the genealogies as complete and adds them up to creation in about ${-creation} BC — the dates used on this page.</li>
      <li><b>Septuagint chronology:</b> the ancient Greek Old Testament gives longer ages in Genesis 5 and 11, placing creation around 5500 BC.</li>
      <li><b>Gaps in the genealogies:</b> many scholars note that biblical genealogies sometimes skip generations (compare Matthew 1:8 with 1 Chronicles 3:11-12), so the total may be longer.</li>
      <li><b>Science:</b> mainstream science dates the universe at about 13.8 billion years and modern humans at about 300,000 years; many Christians read Genesis 1–11 in ways that fit these dates.</li></ul>
      <p class="small muted">Dates before about 1000 BC are approximate and debated. Birth and death years and ages come from Theographic Bible Metadata (CC BY-SA 4.0), which derives them from the ages given in Scripture.</p></div></div></section>`;
}

/* ======================================================================================
   STUDY TOOLS: commentaries, topical Bible, Bible dictionary, prophecy & fulfilment, Gospel harmony.
   ====================================================================================== */
const USFM = ['GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA','1KI','2KI','1CH','2CH','EZR','NEH','EST','JOB','PSA','PRO','ECC','SNG','ISA','JER','LAM','EZK','DAN','HOS','JOL','AMO','OBA','JON','MIC','NAM','HAB','ZEP','HAG','ZEC','MAL','MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV'];
const COMMS_NOTE = 'Classic commentaries from historic writers with a range of views. Read them alongside the Grace lens.';
const COMMS = [['matthew-henry', 'Matthew Henry (1706)'], ['jamieson-fausset-brown', 'Jamieson, Fausset & Brown (1871)'], ['adam-clarke', 'Adam Clarke (1832)'], ['john-gill', 'John Gill (1763)'], ['keil-delitzsch', 'Keil & Delitzsch (OT, 1891)'], ['tyndale', 'Tyndale Open Study Notes']];
const curComm = () => { const c = localStorage.getItem('jom:comm'); return COMMS.some(x => x[0] === c) ? c : 'matthew-henry'; };
const flat = x => typeof x === 'string' ? x : Array.isArray(x) ? x.map(flat).join(' ') : x && typeof x === 'object' ? (x.text != null ? flat(x.text) : x.content != null ? flat(x.content) : x.lineBreak ? '\n' : '') : '';
async function commentaryChapter(bookIdx, ch, id = curComm()) {
  const url = `https://bible.helloao.org/api/c/${id}/${USFM[bookIdx]}/${ch}.json`;
  const j = await getJSON(url, { timeout: 15000 }); const c = j?.chapter || j;
  const out = []; if (c?.introduction) out.push({ v: 0, t: flat(c.introduction) });
  for (const it of c?.content || []) { if (it.type === 'verse' || it.number != null) { const t = flat(it.content).replace(/\s+\n/g, '\n').trim(); if (t) out.push({ v: +it.number || 0, t }); } else if (it.type === 'heading') out.push({ v: -1, t: flat(it.content) }); }
  return out;
}
async function commentaryHTML(bookIdx, ch, verse) {
  try { const items = await commentaryChapter(bookIdx, ch); if (!items.length) throw 0;
    let use = items; if (verse) { const before = items.filter(x => x.v > 0 && x.v <= verse); const at = before.length ? before[before.length - 1].v : null; use = items.filter(x => x.v === at); if (!use.length) use = items.filter(x => x.v === 0); }
    return use.map(x => x.v === -1 ? `<h4>${esc(x.t)}</h4>` : `<div class="cmnt">${x.v > 0 ? `<b class="cv">v. ${x.v}</b>` : ''}${x.t.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join('')}</div>`).join('');
  } catch { return `<p class="small muted">The commentary could not be loaded (it needs an internet connection). <a href="https://www.ccel.org/study/${encodeURIComponent((conc.starts?.[bookIdx]?.name || '') + ' ' + ch)}" target="_blank" rel="noopener">Read it on CCEL ↗</a></p>`; }
}
const commPicker = () => `<label class="sr" for="commSel">Commentary</label><select id="commSel" class="commsel">${COMMS.map(([k, n]) => `<option value="${k}"${k === curComm() ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;

/* ---------- topical Bible (Nave's) ---------- */
let TIDX = null; const TSH = {};
async function topicIndex() { if (TIDX) return TIDX; try { TIDX = await (await fetch('data/topics/index.json')).json(); } catch { TIDX = []; } return TIDX; }
async function topicData(subj) { const row = (await topicIndex()).find(r => r[0] === subj); if (!row) return null; if (!TSH[row[2]]) TSH[row[2]] = fetch(`data/topics/${row[2]}.json`).then(r => r.json()).catch(() => ({})); return (await TSH[row[2]])[subj]; }
const tcase = s => s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
function topicMatches(q, idx, n = 30) { q = q.trim().toUpperCase(); if (!q) return []; const sc = r => r[0] === q ? 100 : r[0].startsWith(q) ? 60 : r[0].includes(q) ? 30 : 0;
  return idx.map(r => [r, sc(r)]).filter(x => x[1]).sort((a, b) => b[1] - a[1] || b[0][1] - a[0][1]).slice(0, n).map(x => x[0]); }
const POPULAR_TOPICS = ['LOVE', 'FAITH', 'PRAYER', 'FORGIVENESS', 'HOPE', 'PEACE', 'JOY', 'FEAR', 'GRACE', 'SALVATION', 'HEALING', 'MARRIAGE', 'CHILDREN', 'WISDOM', 'HUMILITY', 'PATIENCE', 'REPENTANCE', 'HOLY SPIRIT', 'HEAVEN', 'WORSHIP', 'GIVING', 'FRIENDSHIP'];
async function viewTopics(q) {
  setNav('read'); document.title = 'Topical Bible — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Nave's Topical Bible</p><h1>Find what the Bible says about…</h1><p>Over 5,000 topics with 100,000 verses, arranged by Orville Nave. Search a subject — love, anxiety, money, marriage, leadership — and open every verse.</p></div></div>
    <form class="bigsearch" id="tform" role="search" style="max-width:640px"><label class="sr" for="tq">Topic</label><input id="tq" type="search" placeholder="Search a topic…" value="${esc(q || '')}" autocomplete="off"><button class="btn" type="submit">Search</button></form><div id="tres" style="margin-top:18px"></div></div></section>`;
  const idx = await topicIndex(); if (!idx.length) { $('#tres').innerHTML = '<p class="empty">The topical Bible is added the next time the site is published.</p>'; return; }
  const show = v => { const m = topicMatches(v, idx); $('#tres').innerHTML = v.trim() ? (m.length ? `<div class="rlist">${m.map(r => `<button class="ritem" data-go="topic-${encodeURIComponent(r[0])}"><div><b>${esc(tcase(r[0]))}</b></div><span class="tag">${r[1]} verses</span></button>`).join('')}</div>` : '<p class="empty">No topic found. Try a simpler word.</p>')
    : `<h2 class="libh" style="margin-top:4px">Popular topics</h2><div class="chips">${POPULAR_TOPICS.filter(t => idx.some(r => r[0] === t)).map(t => `<button class="chip" data-go="topic-${encodeURIComponent(t)}">${esc(tcase(t))}</button>`).join('')}</div>`; };
  let tm; $('#tq').oninput = e => { clearTimeout(tm); tm = setTimeout(() => show(e.target.value), 150); }; $('#tform').onsubmit = e => { e.preventDefault(); show($('#tq').value); }; show(q || '');
}
async function viewTopic(subj) {
  setNav('read'); subj = decodeURIComponent(subj); const lines = await topicData(subj); document.title = `${tcase(subj)} — Topical Bible`;
  if (!lines) { main.innerHTML = `<section class="band"><div class="wrap"><h1>Topic not found</h1><p><button class="inl" data-go="topics">Search topics</button></p></div></section>`; return; }
  const total = lines.reduce((s, l) => s + l[2].length, 0);
  main.innerHTML = `<section class="band"><div class="wrap"><div class="crumbs"><button data-go="topics">Topical Bible</button> › ${esc(tcase(subj))}</div><h1>${esc(tcase(subj))}</h1><p class="muted">${total} verses in Nave's Topical Bible. Tap a verse to read it.</p>
    <div class="linkrow"><button class="btn ghost sm" id="tshare">${ICON.share} Share</button><button class="btn ghost sm" id="tsermon">Add to my lesson</button></div>
    <div class="topic">${lines.map(([ind, label, refs, see]) => see ? `<p class="tsee${ind ? ' ind' : ''}">See: ${see.map(s => `<button class="inl" data-go="topic-${encodeURIComponent(s.toUpperCase().replace(/[.,]$/, ''))}">${esc(tcase(s))}</button>`).join(', ')}</p>`
      : `<div class="tline${ind ? ' ind' : ''}">${label ? `<b>${esc(label)}</b>` : ''}${refs.length ? `<div class="chips">${refs.map(r => `<button class="chip xr" data-verse="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}</div>`).join('')}</div>
    <p class="small muted">Nave's Topical Bible (public domain); digital edition from Bible-Data by Brady Stephenson (CC BY 4.0).</p></div></section>`;
  $('#tshare').onclick = () => shareIt({ title: `What the Bible says about ${tcase(subj)}`, text: `${total} verses on ${tcase(subj)}`, hash: 'topic-' + encodeURIComponent(subj) });
  $('#tsermon').onclick = () => lessonAdd({ k: 'topic', t: tcase(subj), ref: subj });
}

/* ---------- Bible dictionary (Easton's + Hitchcock's names) ---------- */
let DIDX = null; const DSH = {};
async function dictIndex() { if (DIDX) return DIDX; try { DIDX = await (await fetch('data/dict/index.json')).json(); } catch { DIDX = []; } return DIDX; }
async function dictEntry(term) { const k = term.toLowerCase(); const row = (await dictIndex()).find(r => r[0].toLowerCase() === k); if (!row) return null; if (!DSH[row[1]]) DSH[row[1]] = fetch(`data/dict/${row[1]}.json`).then(r => r.json()).catch(() => ({})); return (await DSH[row[1]])[k]; }
function dictHTML(e) { return `${e.h ? `<p class="dmean"><span class="kicker">Name meaning (Hitchcock)</span><br>${esc(e.h)}</p>` : ''}${e.e.map((t, i) => `<div class="dent">${e.e.length > 1 ? `<p class="kicker">${i + 1}.</p>` : ''}${t.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join('')}</div>`).join('')}`; }
async function viewDictionary(q) {
  setNav('read'); document.title = 'Bible dictionary — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Easton's Bible Dictionary · Hitchcock's Bible Names</p><h1>Bible dictionary</h1><p>Nearly 5,000 entries: people, places, customs, objects and ideas of the Bible, plus the meaning of 2,600 Bible names.</p></div></div>
    <form class="bigsearch" id="dform" role="search" style="max-width:640px"><label class="sr" for="dq">Word</label><input id="dq" type="search" placeholder="Look up a word, e.g. Ark, Tabernacle, Pharisee…" value="${esc(q || '')}" autocomplete="off"><button class="btn" type="submit">Look up</button></form><div id="dres" style="margin-top:18px"></div></div></section>`;
  const idx = await dictIndex(); if (!idx.length) { $('#dres').innerHTML = '<p class="empty">The dictionary is added the next time the site is published.</p>'; return; }
  const show = v => { v = v.trim().toLowerCase(); const m = v ? idx.filter(r => r[0].toLowerCase().startsWith(v)).slice(0, 40).concat(v.length > 2 ? idx.filter(r => !r[0].toLowerCase().startsWith(v) && r[0].toLowerCase().includes(v)).slice(0, 20) : []) : [];
    $('#dres').innerHTML = v ? (m.length ? `<div class="chips">${m.map(r => `<button class="chip" data-go="dict-${encodeURIComponent(r[0])}">${esc(r[0])}</button>`).join('')}</div>` : '<p class="empty">Not found.</p>')
      : `<div class="chips">${['Ark of the covenant', 'Atonement', 'Baptism', 'Covenant', 'Grace', 'Pharisees', 'Passover', 'Sabbath', 'Tabernacle', 'Temple', 'Messiah', 'Redemption'].map(t => `<button class="chip" data-go="dict-${encodeURIComponent(t)}">${t}</button>`).join('')}</div>`; };
  let tm; $('#dq').oninput = e => { clearTimeout(tm); tm = setTimeout(() => show(e.target.value), 150); }; $('#dform').onsubmit = e => { e.preventDefault(); const v = $('#dq').value.trim(); if (idx.some(r => r[0].toLowerCase() === v.toLowerCase())) go('dict-' + encodeURIComponent(v)); else show(v); }; show(q || '');
}
async function viewDictEntry(term) {
  setNav('read'); term = decodeURIComponent(term); const e = await dictEntry(term); document.title = `${term} — Bible dictionary`;
  if (!e) { main.innerHTML = `<section class="band"><div class="wrap"><h1>${esc(term)}</h1><p class="empty">No dictionary entry. <button class="inl" data-go="dictionary">Search the dictionary</button></p></div></section>`; return; }
  const pidx = await peopleIndex(); const person = pidx.find(r => normName(r[1]) === normName(e.t)); const place = placeByName(e.t); const topic = (await topicIndex()).find(r => r[0] === e.t.toUpperCase());
  main.innerHTML = `<section class="band"><div class="wrap prose"><div class="crumbs"><button data-go="dictionary">Bible dictionary</button> › ${esc(e.t)}</div><h1>${esc(e.t)}</h1>
    <div class="linkrow">${person ? `<button class="btn sm" data-go="person-${person[0]}">Person profile</button>` : ''}${place ? `<button class="btn sm" data-go="place-${place.id}">Place page</button>` : ''}${topic ? `<button class="btn ghost sm" data-go="topic-${encodeURIComponent(topic[0])}">Topical verses</button>` : ''}</div>
    ${dictHTML(e)}<p class="small muted">Easton's Bible Dictionary (1897) and Hitchcock's Bible Names (1869), public domain; digital editions via Theographic (CC BY-SA 4.0) and Bible-Data (CC BY 4.0).</p></div></section>`;
}
async function addDictChips(box, getText) { // dictionary words found in a verse
  let t = ''; for (let i = 0; i < 25 && !(t = getText()); i++) await new Promise(r => setTimeout(r, 200)); if (!t || !box.isConnected) return;
  const idx = await dictIndex(); if (!idx.length) return; const set = new Map(idx.map(r => [r[0].toLowerCase(), r[0]]));
  const words = [...new Set(t.replace(/[^A-Za-z' -]/g, ' ').split(/\s+/).filter(w => w.length > 3).map(w => w.replace(/'s$/, '')))]; const hits = [];
  for (const w of words) { const k = w.toLowerCase(); if (set.has(k) && (/^[A-Z]/.test(w) || !['said', 'came', 'went', 'from', 'that', 'with', 'them', 'they', 'there'].includes(k))) hits.push(set.get(k)); }
  if (!hits.length) return; const host = document.createElement('div'); host.className = 'xrefs';
  host.innerHTML = `<p class="kicker">In the dictionary</p><div class="chips">${hits.slice(0, 12).map(h => `<button class="chip xr" data-dict="${esc(h)}">${esc(h)}</button>`).join('')}</div>`;
  ($('.xrefs', box) || $('.notebox', box) || $('.vtools', box))?.after(host);
}
document.addEventListener('click', async e => { const b = e.target.closest('[data-dict]'); if (!b) return; e.preventDefault(); const en = await dictEntry(b.dataset.dict); if (!en) return;
  openDlg(`<p class="kicker">Bible dictionary</p><h2>${esc(en.t)}</h2>${dictHTML(en)}<div class="linkrow"><button class="btn ghost sm" data-go="dict-${encodeURIComponent(en.t)}">Open full entry</button></div>`, en.t); });

/* ---------- prophecy and fulfilment ---------- */
function viewProphecy() {
  setNav('read'); document.title = 'Prophecy and fulfilment — Just One More Lord'; const P = window.JOM_PROPHECY || []; const groups = [...new Set(P.map(p => p[3]))];
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Promise and fulfilment</p><h1>Prophecy and fulfilment</h1><p>Old Testament promises and the New Testament passages that point back to them — especially the promises about the Messiah. Tap either side to read and compare.</p></div></div>
    ${groups.map(g => `<h2 class="libh">${esc(g)}</h2><div class="proph">${P.filter(p => p[3] === g).map(p => `<div class="pro"><b>${esc(p[0])}</b><div class="pro2"><button class="pside" data-verse="${esc(p[1])}"><span class="kicker">Promised</span>${esc(p[1])}</button><span class="parrow">→</span><button class="pside ful" data-verse="${esc(p[2])}"><span class="kicker">Fulfilled</span>${esc(p[2])}</button></div></div>`).join('')}</div>`).join('')}
    <p class="small muted">${P.length} prophecies. Christians read some of these as direct predictions and others as patterns that find their fullest meaning in Jesus.</p></div></section>`;
}

/* ---------- Gospel harmony ---------- */
function viewHarmony(n) {
  setNav('read'); const G = window.JOM_GOSPELS || [];
  if (n !== '' && n != null && G[+n]) { const r = G[+n]; document.title = `${r[0]} — Gospel harmony`;
    const cols = [['Matthew', r[1]], ['Mark', r[2]], ['Luke', r[3]], ['John', r[4]]].filter(c => c[1]);
    main.innerHTML = `<section class="band"><div class="wrap"><div class="crumbs"><button data-go="harmony">Gospel harmony</button> › ${esc(r[0])}</div><h1>${esc(r[0])}</h1><div class="linkrow">${+n > 0 ? `<button class="btn ghost sm" data-go="harmony-${+n - 1}">← Previous</button>` : ''}${+n < G.length - 1 ? `<button class="btn sm" data-go="harmony-${+n + 1}">Next event →</button>` : ''}</div>
      <div class="hcols" style="--n:${cols.length}">${cols.map(([g, ref]) => `<article class="hcol"><p class="kicker">${g}</p><h3><button class="vref" data-verse="${esc(ref)}">${esc(ref)}</button></h3><div class="vtext htext" data-ref="${esc(ref)}"><span class="spin"></span></div></article>`).join('')}</div></div></section>`;
    $$('.htext').forEach(async el => { try { const v = await bibleText(el.dataset.ref); el.innerHTML = verseHTML(v); } catch { el.innerHTML = '<span class="small muted">Needs an internet connection.</span>'; } }); return; }
  document.title = 'Gospel harmony — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">The four Gospels side by side</p><h1>Gospel harmony</h1><p>The life of Jesus in order, showing where Matthew, Mark, Luke and John each tell the same event. Tap an event to read all the accounts side by side.</p></div></div>
    <div class="htable" role="table"><div class="hrow hhead" role="row"><span>Event</span><span>Matthew</span><span>Mark</span><span>Luke</span><span>John</span></div>
    ${G.map((r, i) => `<button class="hrow" role="row" data-go="harmony-${i}"><span><b>${esc(r[0])}</b></span>${r.slice(1).map(x => `<span class="${x ? 'has' : ''}">${esc(x.replace(/^(Matthew|Mark|Luke|John) /, ''))}</span>`).join('')}</button>`).join('')}</div></div></section>`;
}

/* ======================================================================================
   ALL PLACES & EVENTS, MUSEUMS, VERSE PICTURES, LESSON BUILDER, DAILY CHALLENGE, CHURCH GROUPS, DAILY VERSE ALERTS
   ====================================================================================== */
let SIDX = null, EVTS = null; const SSH = {};
async function siteIndex() { if (SIDX) return SIDX; try { SIDX = await (await fetch('data/sites/index.json')).json(); } catch { SIDX = []; } return SIDX; }
async function siteData(slug) { const r = (await siteIndex()).find(x => x[0] === slug); if (!r) return null; if (!SSH[r[5]]) SSH[r[5]] = fetch(`data/sites/${r[5]}.json`).then(x => x.json()).catch(() => ({})); return (await SSH[r[5]])[slug]; }
async function eventList() { if (EVTS) return EVTS; try { EVTS = await (await fetch('data/events.json')).json(); } catch { EVTS = []; } return EVTS; }
const ERA_RANGES = [['All', -5000, 200], ['Creation to Flood', -5000, -2300], ['Patriarchs', -2299, -1550], ['Exodus & conquest', -1549, -1380], ['Judges', -1379, -1051], ['Kings', -1050, -587], ['Exile & return', -586, -400], ['Jesus', -10, 33], ['Early church', 30, 200]];
async function viewAllPlaces(q) {
  setNav('atlas'); document.title = 'Every Bible place — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Complete gazetteer</p><h1>Every Bible place</h1><p>All 1,300 places named in the Bible that can be located, on one map. The 100 featured places have full pages with photos and archaeology; every place has its verses and the people connected with it.</p></div><div class="linkrow"><button class="btn ghost sm" data-go="atlas">Featured atlas</button><button class="btn sm" data-go="events">Events map</button></div></div>
    <form class="bigsearch" id="sform" role="search" style="max-width:600px"><label class="sr" for="sq">Place</label><input id="sq" type="search" placeholder="Find a place…" value="${esc(q || '')}"><button class="btn" type="submit">Find</button></form>
    <div class="mapbox tall" id="smap" style="margin-top:14px"></div><div id="sres" style="margin-top:14px"></div></div></section>`;
  const idx = await siteIndex(); if (!idx.length) { $('#sres').innerHTML = '<p class="empty">The full place list is added the next time the site is published.</p>'; return; }
  const draw = v => { v = normName(v); const list = (v ? idx.filter(r => normName(r[1]).includes(v)) : idx).filter(r => r[2]);
    makeMap($('#smap'), { markers: list.slice(0, v ? 300 : 1300).map(r => { const fp = placeByName(r[1]); return { lat: r[2], lon: r[3], label: r[1], sub: `${r[4]} verse${r[4] === 1 ? '' : 's'}`, kind: fp ? 'place' : 'near', go: fp ? 'place-' + fp.id : 'site-' + r[0] }; }), maxZoom: 10 });
    $('#sres').innerHTML = v ? `<div class="rlist">${list.slice(0, 40).map(r => `<button class="ritem" data-go="site-${r[0]}"><div><b>${esc(r[1])}</b></div><span class="tag">${r[4]} verses</span></button>`).join('')}</div>` : ''; };
  $('#sform').onsubmit = e => { e.preventDefault(); draw($('#sq').value); }; draw(q || '');
}
async function viewSite(slug) {
  setNav('atlas'); const d = await siteData(slug); if (!d) return viewNotFound(); const fp = placeByName(d.n); if (fp) { go('place-' + fp.id); return; }
  document.title = `${d.n} — Bible places`; const vr = d.v.map(osisToRef);
  main.innerHTML = `<section class="band"><div class="wrap"><div class="crumbs"><button data-go="places">Every Bible place</button> › ${esc(d.n)}</div><h1>${esc(d.n)}</h1><p class="muted">${vr.length} verse${vr.length === 1 ? '' : 's'}${d.lat ? '' : ' · location unknown'}</p>
    ${d.lat ? '<div class="mapbox" id="sitemap" style="height:340px"></div>' : ''}
    ${d.p.length ? `<h2 class="libh">People connected with ${esc(d.n)}</h2><div class="chips">${d.p.map(x => `<button class="chip" data-go="person-${esc(x[0])}">${esc(x[1])} · ${x[2]}</button>`).join('')}</div>` : ''}
    ${d.d ? `<h2 class="libh">From Easton's Bible Dictionary</h2><div class="prose">${d.d.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join('')}</div>` : ''}
    <h2 class="libh">Verses</h2><div class="chips">${vr.map(r => `<button class="chip xr" data-verse="${esc(r)}">${esc(r)}</button>`).join('')}</div>
    <p class="small muted">Data: Theographic Bible Metadata (CC BY-SA 4.0), locations from OpenBible.info.</p></div></section>`;
  if (d.lat) { const near = (await siteIndex()).filter(r => r[2] && r[0] !== slug).map(r => [r, km({ lat: d.lat, lon: d.lon }, { lat: r[2], lon: r[3] })]).sort((a, b) => a[1] - b[1]).slice(0, 8);
    makeMap($('#sitemap'), { markers: [{ lat: d.lat, lon: d.lon, label: d.n, kind: 'main' }, ...near.map(([r, k]) => ({ lat: r[2], lon: r[3], label: r[1], sub: fmtKm(k), kind: 'near', go: 'site-' + r[0] }))], maxZoom: 10 }); }
}
async function viewEvents(era) {
  setNav('timeline'); document.title = 'Bible events map — Just One More Lord'; const E = await eventList(); const er = ERA_RANGES.find(x => x[0] === decodeURIComponent(era || '')) || ERA_RANGES[0];
  const list = E.filter(e => e[1] != null ? e[1] >= er[1] && e[1] <= er[2] : er[0] === 'All');
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">500 events</p><h1>Bible events map</h1><p>Every major event in the Bible, where and when it happened. Choose an era to see its events on the map.</p></div><div class="linkrow"><button class="btn ghost sm" data-go="timeline">Timeline</button><button class="btn ghost sm" data-go="places">Every place</button></div></div>
    <div class="chips">${ERA_RANGES.map(x => `<button class="chip" data-go="events-${encodeURIComponent(x[0])}" aria-pressed="${x[0] === er[0]}">${esc(x[0])}</button>`).join('')}</div>
    <div class="jlayout" style="margin-top:14px"><div class="mapbox tall" id="emap"></div><div class="rlist evlist">${list.slice(0, 200).map((e, i) => `<button class="ritem" data-ev="${E.indexOf(e)}"><div><b>${esc(e[0])}</b><span>${e[1] != null ? pyr(e[1]) + ' · ' : ''}${esc(e[4].map(l => l[1]).join(', ') || 'place unknown')}</span></div>${e[3] ? `<span class="tag">${esc(e[3].replace(/-$/, ''))}</span>` : ''}</button>`).join('') || '<p class="empty">No events in this era.</p>'}</div></div>
    <p class="small muted">Event dates follow a traditional chronology and are approximate. Data: Theographic Bible Metadata (CC BY-SA 4.0).</p></div></section>`;
  const mk = []; list.forEach(e => e[4].forEach(l => { if (l[2]) mk.push({ lat: l[2], lon: l[3], label: e[0], sub: `${e[1] != null ? pyr(e[1]) + ' · ' : ''}${l[1]}`, kind: 'stop' }); }));
  makeMap($('#emap'), { markers: mk.slice(0, 400), maxZoom: 9 });
  $('.evlist').onclick = ev => { const b = ev.target.closest('[data-ev]'); if (!b) return; const e = E[+b.dataset.ev];
    openDlg(`<p class="kicker">${e[1] != null ? pyr(e[1]) : 'Bible event'}</p><h2>${esc(e[0])}</h2>${e[3] ? `<p><button class="btn sm" data-verse="${esc(e[3].replace(/-$/, ''))}">Read ${esc(e[3].replace(/-$/, ''))}</button></p>` : ''}
      ${e[4].length ? `<p class="kicker">Where</p><div class="chips">${e[4].map(l => `<button class="chip" data-go="site-${esc(l[0])}">${esc(l[1])}</button>`).join('')}</div>` : ''}${e[5].length ? `<p class="kicker">Who</p><div class="chips">${e[5].map(p => `<button class="chip" data-go="person-${esc(p[0])}">${esc(p[1])}</button>`).join('')}</div>` : ''}`, e[0]); };
}

/* ---------- where Bible finds are displayed today ---------- */
const MUSEUMS = [
  ['Israel Museum, Jerusalem', 31.7725, 35.2044, [['Dead Sea Scrolls (Shrine of the Book)', 'Isaiah 40:8'], ['Tel Dan Stele — "House of David"', '2 Samuel 7:16'], ['Pontius Pilate inscription', 'Luke 23:1'], ['Silver Ketef Hinnom scrolls — the priestly blessing', 'Numbers 6:24-26'], ['Caiaphas ossuary', 'Matthew 26:57']]],
  ['British Museum, London', 51.5194, -0.1270, [['Cyrus Cylinder', 'Ezra 1:1-3'], ['Lachish reliefs', '2 Kings 18:13-14'], ['Black Obelisk of Shalmaneser III — King Jehu', '2 Kings 10:34'], ['Babylonian Chronicle — fall of Jerusalem', '2 Kings 24:10-12'], ['Lachish letters', 'Jeremiah 34:7']]],
  ['Louvre, Paris', 48.8606, 2.3376, [['Mesha Stele (Moabite Stone)', '2 Kings 3:4-5'], ['Code of Hammurabi', 'Exodus 21:23-25']]],
  ['Istanbul Archaeology Museums', 41.0117, 28.9813, [['Siloam inscription — Hezekiah\'s tunnel', '2 Kings 20:20'], ['Temple warning inscription', 'Acts 21:28-29'], ['Gezer calendar', 'Ruth 1:22']]],
  ['Oriental Institute, Chicago', 41.7893, -87.5975, [['Sennacherib Prism', '2 Kings 18:13'], ['Lamassu from Khorsabad', 'Isaiah 20:1']]],
  ['Pergamon Museum, Berlin', 52.5212, 13.3967, [['Ishtar Gate of Babylon', 'Daniel 4:30'], ['Altar of Pergamon', 'Revelation 2:13']]],
  ['Vatican Library, Rome', 41.9049, 12.4547, [['Codex Vaticanus — one of the oldest complete Bibles', '2 Timothy 3:16']]],
  ['Chester Beatty Library, Dublin', 53.3425, -6.2675, [['Chester Beatty papyri — early New Testament', 'John 20:31']]],
  ['John Rylands Library, Manchester', 53.4801, -2.2484, [['Rylands Papyrus P52 — oldest known New Testament fragment', 'John 18:31-33']]],
  ['Egyptian Museum, Cairo', 30.0478, 31.2336, [['Merneptah Stele — earliest mention of "Israel"', 'Genesis 32:28']]]
];
function viewMuseums() {
  setNav('discoveries'); document.title = 'Bible finds in museums — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">See them for yourself</p><h1>Bible finds in museums</h1><p>Where some of the most important discoveries connected with the Bible are displayed today — with the passage each one relates to.</p></div><div class="linkrow"><button class="btn ghost sm" data-go="discoveries">All discoveries</button></div></div>
    <div class="mapbox" id="mmap" style="height:380px"></div><div class="kgrid" style="margin-top:16px">${MUSEUMS.map(([n, , , items]) => `<article class="kcard"><h3>${esc(n)}</h3><ul class="mlist">${items.map(([t, r]) => `<li>${esc(t)} <button class="vref sm" data-verse="${esc(r)}">${esc(r)}</button></li>`).join('')}</ul></article>`).join('')}</div>
    <p class="small muted">Displays change and objects travel on loan — check with the museum before you visit.</p></div></section>`;
  makeMap($('#mmap'), { markers: MUSEUMS.map(([n, lat, lon, items]) => ({ lat, lon, label: n, sub: items.length + ' Bible-related finds', kind: 'disc' })), maxZoom: 6 });
}

/* ---------- verse picture maker ---------- */
async function viewVersePic(ref) {
  setNav(''); ref = decodeURIComponent(ref || '') || (votd()?.ref || 'John 3:16').replace(/(:\d+)-\d+$/, '$1'); document.title = 'Verse picture — Just One More Lord';
  const photos = Object.entries(window.JOM_IMAGES || {}).filter(([id]) => byId[id]).slice(0, 60);
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Share the Word</p><h1>Verse picture maker</h1><p>Make a picture of a Bible verse on a photo of a real Bible place — for WhatsApp status, Instagram or Facebook.</p></div></div>
    <div class="vpgrid"><div><canvas id="vpc" width="1080" height="1080" class="vpcanvas" aria-label="Verse picture preview"></canvas></div>
    <div class="panel authform" style="max-width:none"><label>Verse<input id="vpr" value="${esc(ref)}"></label><label>Text (you can edit it)<textarea id="vpt" rows="4"></textarea></label>
      <label>Shape<select id="vps"><option value="1080x1080">Square (posts)</option><option value="1080x1920">Tall (status / stories)</option></select></label>
      <label>Background</label><div class="vpbgs">${['#grad', '#dark', ...photos.map(([id]) => id)].map(b => `<button class="vpbg" data-bg="${esc(b)}" style="${b === '#grad' ? 'background:linear-gradient(135deg,#00d1ff,#ffc72c)' : b === '#dark' ? 'background:#020a10' : `background-image:url('${esc(window.JOM_IMAGES[b].f)}')`}" title="${esc(byId[b]?.n || b)}"></button>`).join('')}</div>
      <div class="linkrow"><button class="btn" id="vpdl">Download picture</button><button class="btn ghost" id="vpsh">${ICON.share} Share</button></div></div></div></div></section>`;
  let bg = photos[0]?.[0] || '#grad', img = null;
  const draw = () => { const c = $('#vpc'), [W, H] = $('#vps').value.split('x').map(Number); c.width = W; c.height = H; const x = c.getContext('2d');
    if (img) { const r = Math.max(W / img.width, H / img.height); x.drawImage(img, (W - img.width * r) / 2, (H - img.height * r) / 2, img.width * r, img.height * r); x.fillStyle = 'rgba(2,10,16,.55)'; x.fillRect(0, 0, W, H); }
    else if (bg === '#dark') { x.fillStyle = '#020a10'; x.fillRect(0, 0, W, H); } else { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#04324a'); g.addColorStop(1, '#5a3a06'); x.fillStyle = g; x.fillRect(0, 0, W, H); }
    const txt = $('#vpt').value.trim(), rf = $('#vpr').value.trim(); let fs = 78; const maxW = W - 160; x.textAlign = 'center'; x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 18;
    let lines; for (;;) { x.font = `600 ${fs}px "Cormorant Garamond", Georgia, serif`; lines = []; let ln = ''; for (const w of `“${txt}”`.split(/\s+/)) { const t = ln ? ln + ' ' + w : w; if (x.measureText(t).width > maxW && ln) { lines.push(ln); ln = w; } else ln = t; } lines.push(ln); if (lines.length * fs * 1.25 < H * .62 || fs < 34) break; fs -= 4; }
    const top = H / 2 - lines.length * fs * 1.25 / 2; lines.forEach((l, i) => x.fillText(l, W / 2, top + i * fs * 1.25 + fs * .9));
    x.font = `700 ${Math.round(fs * .5)}px Sora, sans-serif`; x.fillStyle = '#ffc72c'; x.fillText(rf.toUpperCase(), W / 2, top + lines.length * fs * 1.25 + fs * .9);
    x.shadowBlur = 0; x.font = '600 30px Sora, sans-serif'; x.fillStyle = 'rgba(255,255,255,.85)'; x.fillText('Just One More Lord' + (bg[0] !== '#' && byId[bg] ? ' · ' + byId[bg].n : ''), W / 2, H - 60); };
  const setBg = b => { bg = b; $$('.vpbg').forEach(x => x.classList.toggle('on', x.dataset.bg === b)); if (b[0] === '#') { img = null; draw(); return; } const i = new Image(); i.onload = () => { img = i; draw(); }; i.src = window.JOM_IMAGES[b].f; };
  const loadText = async () => { const r = $('#vpr').value.trim(); try { const v = await bibleText(r); $('#vpt').value = v.verses.map(x => x.t).join(' ') || v.text; } catch { try { $('#vpt').value = await glossVerse(r); } catch {} } draw(); };
  $('.vpbgs').onclick = e => { const b = e.target.closest('[data-bg]'); if (b) setBg(b.dataset.bg); };
  $('#vpr').onchange = loadText; $('#vpt').oninput = draw; $('#vps').onchange = draw;
  const blob = () => new Promise(r => $('#vpc').toBlob(r, 'image/jpeg', .92));
  $('#vpdl').onclick = async () => { const a = document.createElement('a'); a.href = URL.createObjectURL(await blob()); a.download = `${$('#vpr').value.replace(/[^\w]+/g, '-')}.jpg`; a.click(); };
  $('#vpsh').onclick = async () => { const f = new File([await blob()], 'verse.jpg', { type: 'image/jpeg' }); if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], title: $('#vpr').value, text: SITE }); } catch {} } else $('#vpdl').click(); };
  setBg(bg); await loadText();
}

/* ---------- lesson & sermon builder ---------- */
if (!Array.isArray(MY.lesson)) MY.lesson = [];
function lessonAdd(item) { MY.lesson.push({ ...item, id: Date.now().toString(36) }); saveMy(); toast('Added to your lesson'); }
function viewLesson() {
  setNav(''); document.title = 'Lesson builder — Just One More Lord'; const L = MY.lesson;
  const render = it => it.k === 'verse' ? `<button class="vref" data-verse="${esc(it.ref)}">${esc(it.ref)}</button>${it.t ? `<blockquote class="vtext">${esc(it.t)}</blockquote>` : ''}` : it.k === 'place' ? `📍 <button class="inl" data-go="place-${esc(it.ref)}">${esc(it.t)}</button>` : it.k === 'person' ? `👤 <button class="inl" data-go="person-${esc(it.ref)}">${esc(it.t)}</button>` : it.k === 'topic' ? `🏷 <button class="inl" data-go="topic-${encodeURIComponent(it.ref)}">${esc(it.t)}</button>` : it.k === 'head' ? `<h3>${esc(it.t)}</h3>` : `<p>${esc(it.t)}</p>`;
  main.innerHTML = `<section class="band study"><div class="wrap"><div class="sh noprint"><div><p class="kicker">For preachers, teachers and small groups</p><h1>Lesson builder</h1><p>Collect verses, places, people and notes into an outline. Add verses from any verse window (“Add to lesson”), places and people from their pages, then print, present or share.</p></div></div>
    <div class="panel noprint" style="max-width:720px"><div class="filters"><input id="lt" placeholder="Lesson title" value="${esc(MY.lessonTitle || '')}" style="flex:1"></div>
      <div class="filters"><input id="lv" placeholder="Add a verse, e.g. John 3:16" style="flex:1"><button class="btn sm" id="lva">Add verse</button></div>
      <div class="filters"><input id="ln" placeholder="Add a heading or a note" style="flex:1"><button class="btn ghost sm" id="lha">Heading</button><button class="btn ghost sm" id="lna">Note</button></div></div>
    <h1 class="onlyprint">${esc(MY.lessonTitle || 'Lesson')}</h1>
    <ol class="lesson">${L.map((it, i) => `<li data-i="${i}"><div class="lbody">${render(it)}</div><span class="lctl noprint"><button aria-label="Move up" data-m="-1">↑</button><button aria-label="Move down" data-m="1">↓</button><button aria-label="Remove" data-m="x">✕</button></span></li>`).join('') || '<p class="empty">Your lesson is empty.</p>'}</ol>
    <div class="linkrow noprint"><button class="btn" onclick="print()">Print or save as PDF</button><button class="btn ghost" id="lpres">Present</button><button class="btn ghost" id="lsh">${ICON.share} Share outline</button><button class="btn ghost" id="lclr">Clear</button></div></div></section>`;
  $('#lt').onchange = e => { MY.lessonTitle = e.target.value; saveMy(); };
  $('#lva').onclick = async () => { await loadConc(); const p = parseRef($('#lv').value); if (!p) { toast('Type a reference like John 3:16'); return; } const r = `${p.book.name} ${p.ch}${/:/.test($('#lv').value) ? ':' + p.v1 + (p.v2 !== p.v1 && p.v2 < 999 ? '-' + p.v2 : '') : ''}`; let t = ''; try { const v = await bibleText(r); t = v.verses.map(x => x.t).join(' '); } catch {} lessonAdd({ k: 'verse', ref: r, t }); viewLesson(); };
  $('#lha').onclick = () => { const t = $('#ln').value.trim(); if (t) { lessonAdd({ k: 'head', t }); viewLesson(); } }; $('#lna').onclick = () => { const t = $('#ln').value.trim(); if (t) { lessonAdd({ k: 'note', t }); viewLesson(); } };
  $('.lesson').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; const i = +b.closest('li').dataset.i; if (b.dataset.m === 'x') L.splice(i, 1); else { const j = i + +b.dataset.m; if (j >= 0 && j < L.length) [L[i], L[j]] = [L[j], L[i]]; } saveMy(); viewLesson(); };
  $('#lclr').onclick = () => { if (confirm('Clear this lesson?')) { MY.lesson = []; saveMy(); viewLesson(); } };
  $('#lsh').onclick = () => shareIt({ title: MY.lessonTitle || 'Bible lesson', text: `${MY.lessonTitle || 'Bible lesson'}\n` + L.map(it => it.k === 'verse' ? '• ' + it.ref : it.k === 'head' ? '\n' + it.t : it.k === 'note' ? '  ' + it.t : '• ' + it.t).join('\n') });
  $('#lpres').onclick = () => { const slides = L.filter(it => it.k === 'verse' || it.k === 'head'); if (!slides.length) return;
    let i = 0; document.body.insertAdjacentHTML('beforeend', `<div class="deck" id="deck"><div class="slides"><section class="slide"><div class="sin" id="ls"></div></section></div><div class="dctl"><button id="dprev">←</button><span id="dnum"></span><button id="dnext">→</button><button id="dx">✕</button></div></div>`);
    const show = () => { const it = slides[i]; $('#ls').innerHTML = it.k === 'head' ? `<h1>${esc(it.t)}</h1>` : `<blockquote class="pv${(it.t || '').length > 200 ? ' long' : ''}">${esc(it.t || '')}</blockquote><p class="pvref">${esc(it.ref)}</p>`; $('#dnum').textContent = `${i + 1} / ${slides.length}`; };
    $('#dnext').onclick = () => { i = Math.min(slides.length - 1, i + 1); show(); }; $('#dprev').onclick = () => { i = Math.max(0, i - 1); show(); }; $('#dx').onclick = () => $('#deck').remove(); show(); };
}

/* ---------- daily challenge ---------- */
if (!MY.daily || typeof MY.daily !== 'object') MY.daily = {};
function dailyQuestion() { const pool = PLACES.filter(p => p.v?.length).flatMap(p => questionsFor(p)); const d = dayIndex(); const q = pool[((d * 2654435761) >>> 0) % pool.length];
  const seeded = (a, s) => a.map((x, i) => [x, ((s + i) * 9301 + 49297) % 233280]).sort((x, y) => x[1] - y[1]).map(x => x[0]); return { ...q, opts: seeded([q.a, ...q.o.slice(0, 3)], d) }; }
function dailyStreak() { let n = 0; const d = new Date(); for (;;) { const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; if (!MY.daily[k]?.ok) { if (n === 0 && k === today()) { d.setDate(d.getDate() - 1); continue; } break; } n++; d.setDate(d.getDate() - 1); } return n; }
function viewDaily() {
  setNav('quiz'); document.title = 'Daily challenge — Just One More Lord'; const q = dailyQuestion(), done = MY.daily[today()];
  main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Daily challenge · ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>One question a day</h1><p class="muted">Everyone gets the same question today. Correct-answer streak: <b>🔥 ${dailyStreak()}</b></p>
    <h2 class="qq">${esc(q.q)}</h2><div class="qopts">${q.opts.map((o, k) => `<button class="qopt${done ? (o === q.a ? ' right' : o === done.pick ? ' wrong' : '') : ''}" data-k="${k}" ${done ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>
    <div id="qfb">${done ? `<p class="notice">${done.ok ? 'You got today\'s question right!' : `Today's answer was <b>${esc(q.a)}</b>.`} Come back tomorrow for a new one.</p>` : ''}</div>
    <div class="linkrow"><button class="btn ghost" id="dsh">${ICON.share} Challenge a friend</button><button class="btn ghost" data-go="quiz">Full quiz</button>${GROUP_ON() ? '<button class="btn ghost" data-go="groups">My group\'s scores</button>' : ''}</div></div></section>`;
  if (!done) $('.qopts').onclick = e => { const b = e.target.closest('.qopt'); if (!b) return; const pick = q.opts[+b.dataset.k]; MY.daily[today()] = { ok: pick === q.a, pick }; saveMy(); track(); groupReport(); viewDaily(); };
  $('#dsh').onclick = () => shareIt({ title: 'Daily Bible challenge', text: `Today's Bible question: ${q.q}`, hash: 'daily' });
}

/* ---------- church groups (Supabase) ---------- */
const GROUP_ON = () => sbOn() && signedIn();
const code6 = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
async function myGroups() { return await sbFetch(`/rest/v1/group_members?user_id=eq.${AUTH.user.id}&select=group_id,role,groups(id,name,code,plan_id,owner)`); }
async function groupReport() { if (!GROUP_ON()) return; try { const gs = await myGroups(); const stats = { streak: streak(), chapters: Object.keys(MY.readCh).length, daily: dailyStreak(), plans: Object.fromEntries(Object.entries(MY.plans).map(([k, v]) => [k, (v.done || []).length])) };
  await Promise.all(gs.map(g => sbFetch(`/rest/v1/group_members?group_id=eq.${g.group_id}&user_id=eq.${AUTH.user.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ name: AUTH.profile?.name || MY.name || 'Member', stats, updated_at: new Date().toISOString() }) }))); } catch {} }
async function viewGroups(id) {
  setNav('community'); document.title = 'Church groups — Just One More Lord';
  if (!sbOn()) { main.innerHTML = `<section class="band"><div class="wrap quizwrap"><h1>Church groups</h1><p class="lead">Groups need accounts to be switched on.</p></div></section>`; return; }
  if (!signedIn()) { main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Church groups</p><h1>Read and pray together</h1><p class="lead">Create a group for your church, cell group, youth or family. Members join with a code, read the same plan, see each other's progress and share prayer requests.</p><div class="linkrow"><button class="btn" data-go="profile">Sign in or create a free account</button></div></div></section>`; return; }
  main.innerHTML = `<section class="band"><div class="wrap"><p class="muted"><span class="spin"></span>Loading your groups…</p></div></section>`;
  try { await groupReport(); const gs = await myGroups();
    if (id) { const g = gs.find(x => x.group_id === id)?.groups; if (!g) { go('groups'); return; }
      const [mem, prs] = await Promise.all([sbFetch(`/rest/v1/group_members?group_id=eq.${id}&select=user_id,name,role,stats,updated_at`), sbFetch(`/rest/v1/group_prayers?group_id=eq.${id}&select=id,name,text,created_at,user_id&order=created_at.desc&limit=50`)]);
      const plan = ALLPLANS.find(j => j.id === g.plan_id); const owner = g.owner === AUTH.user.id;
      main.innerHTML = `<section class="band"><div class="wrap"><div class="crumbs"><button data-go="groups">My groups</button> › ${esc(g.name)}</div><h1>${esc(g.name)}</h1>
        <div class="linkrow"><span class="tag">Join code: <b>${esc(g.code)}</b></span><button class="btn ghost sm" id="ginv">${ICON.share} Invite</button><button class="btn sm" data-go="live-${id}">📖 Live reading</button>${plan ? `<button class="btn sm" data-go="plan-${plan.id}">Group plan: ${esc(plan.n)}</button>` : ''}</div>
        ${owner ? `<div class="filters" style="margin-top:12px"><label class="sr" for="gplan">Group plan</label><select id="gplan"><option value="">— choose a reading plan for the group —</option>${ALLPLANS.map(j => `<option value="${j.id}"${j.id === g.plan_id ? ' selected' : ''}>${esc(j.n)}</option>`).join('')}</select></div>` : ''}
        <h2 class="libh">Members (${mem.length})</h2><div class="rlist">${mem.sort((a, b) => (b.stats?.chapters || 0) - (a.stats?.chapters || 0)).map(m => { const st = m.stats || {}; const pd = plan ? (st.plans?.[plan.id] || 0) : null;
          return `<div class="ritem"><div><b>${esc(m.name || 'Member')}${m.role === 'leader' ? ' · leader' : ''}</b><span>🔥 ${st.streak || 0}-day streak · ${st.chapters || 0} chapters read · daily challenge ${st.daily || 0}${pd != null ? ` · plan ${pd}/${plan.stops.length}` : ''}</span></div></div>`; }).join('')}</div>
        <h2 class="libh">Prayer requests</h2><div class="filters"><input id="gpr" placeholder="Share a prayer request with the group" style="flex:1"><button class="btn sm" id="gpra">Post</button></div>
        <ul class="plist">${prs.map(p => `<li><p>${esc(p.text)}</p><span class="small muted">${esc(p.name || '')} · ${new Date(p.created_at).toLocaleDateString()}</span>${p.user_id === AUTH.user.id || owner ? ` <button class="inl" data-del="${p.id}">delete</button>` : ''}</li>`).join('') || '<li class="emptyli"><p class="muted">No prayer requests yet.</p></li>'}</ul>
        <div class="linkrow"><button class="btn ghost sm" id="gleave">Leave group</button></div></div></section>`;
      $('#ginv').onclick = () => shareIt({ title: `Join ${g.name}`, text: `Join our group "${g.name}" on Just One More Lord. Open the app → Community → Church groups → Join, and enter the code ${g.code}`, hash: 'groups' });
      $('#gplan')?.addEventListener('change', async e => { await sbFetch(`/rest/v1/groups?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ plan_id: e.target.value || null }) }); if (e.target.value && !MY.plans[e.target.value]) { MY.plans[e.target.value] = { done: [], start: Date.now() }; saveMy(); } toast('Group plan updated'); viewGroups(id); });
      $('#gpra').onclick = async () => { const t = $('#gpr').value.trim(); if (!t) return; await sbFetch('/rest/v1/group_prayers', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ group_id: id, user_id: AUTH.user.id, name: AUTH.profile?.name || MY.name || 'Member', text: t.slice(0, 600) }) }); viewGroups(id); };
      $('.plist').onclick = async e => { const b = e.target.closest('[data-del]'); if (b && confirm('Delete this request?')) { await sbFetch(`/rest/v1/group_prayers?id=eq.${b.dataset.del}`, { method: 'DELETE' }); viewGroups(id); } };
      $('#gleave').onclick = async () => { if (!confirm('Leave this group?')) return; await sbFetch(`/rest/v1/group_members?group_id=eq.${id}&user_id=eq.${AUTH.user.id}`, { method: 'DELETE' }); go('groups'); };
      if (plan && !MY.plans[plan.id]) { MY.plans[plan.id] = { done: [], start: Date.now() }; saveMy(); }
      return; }
    main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Church groups</p><h1>My groups</h1><p>Read the same plan, encourage each other and pray together.</p></div></div>
      ${gs.length ? `<div class="rlist">${gs.map(x => `<button class="ritem" data-go="group-${x.group_id}"><div><b>${esc(x.groups?.name || 'Group')}</b><span>${x.role === 'leader' ? 'Leader' : 'Member'} · code ${esc(x.groups?.code || '')}</span></div></button>`).join('')}</div>` : '<p class="empty">You are not in a group yet.</p>'}
      <div class="commgrid" style="margin-top:18px"><div class="panel"><h2>Join a group</h2><div class="filters"><input id="gcode" placeholder="6-letter code" maxlength="6" style="flex:1;text-transform:uppercase"><button class="btn sm" id="gjoin">Join</button></div></div>
      <div class="panel"><h2>Start a group</h2><div class="filters"><input id="gname" placeholder="e.g. Grace Church youth" maxlength="60" style="flex:1"><button class="btn sm" id="gnew">Create</button></div></div></div></div></section>`;
    $('#gjoin').onclick = async () => { try { const r = await sbFetch('/rest/v1/rpc/join_group', { method: 'POST', body: JSON.stringify({ p_code: $('#gcode').value.trim().toUpperCase(), p_name: AUTH.profile?.name || MY.name || 'Member' }) }); toast('Welcome to the group!'); go('group-' + r); } catch (e) { toast(/not found/i.test(e.message) ? 'No group has that code' : e.message); } };
    $('#gnew').onclick = async () => { const n = $('#gname').value.trim(); if (!n) return; try { const r = await sbFetch('/rest/v1/rpc/create_group', { method: 'POST', body: JSON.stringify({ p_name: n, p_code: code6(), p_member_name: AUTH.profile?.name || MY.name || 'Leader' }) }); toast('Group created'); go('group-' + r); } catch (e) { toast(e.message); } };
  } catch (e) { main.innerHTML = `<section class="band"><div class="wrap"><h1>Church groups</h1><p class="empty">Groups are not set up in the database yet (the site owner needs to run the groups part of <code>supabase/setup.sql</code>). ${esc(e.message)}</p></div></section>`; }
}

/* ---------- daily verse alerts (on-device notifications while the app is installed) ---------- */
async function alertsPanel() { return `<div class="panel"><h2>Notifications</h2><p class="small muted">Verse of the day, reminders, badges and group prayer requests — in the app and on your phone.</p><div class="linkrow"><button class="btn" data-go="notifications">Notification settings</button></div></div>`;
  const ok = 'Notification' in window; const on = localStorage.getItem('jom:alert') === '1';
  return `<div class="panel"><h2>Daily verse alert</h2><p class="small muted">${ok ? 'Shows the verse of the day as a notification each morning when you open the installed app, and through your phone\'s calendar reminder (on the home page) at a fixed time.' : 'This device does not support notifications — use the calendar reminder on the home page instead.'}</p>${ok ? `<button class="btn sm" id="alertBtn">${on ? 'Turn off' : 'Turn on'} verse alerts</button>` : ''}</div>`;
}
async function showDailyAlert() {
  if (localStorage.getItem('jom:alert') !== '1' || !('Notification' in window) || Notification.permission !== 'granted') return; if (localStorage.getItem('jom:alertDay') === today()) return;
  const x = votd(); if (!x) return; let t = ''; try { const v = await bibleText(x.ref); t = v.verses.map(y => y.t).join(' '); } catch {}
  const reg = await navigator.serviceWorker?.getRegistration(); const opts = { body: (t ? `“${t.slice(0, 160)}” ` : '') + `— ${x.ref}`, icon: 'icons/app-192.png', badge: 'icons/app-192.png', tag: 'votd', data: { url: SITE + '#place-' + x.p.id } };
  try { reg ? await reg.showNotification('Verse of the day', opts) : new Notification('Verse of the day', opts); localStorage.setItem('jom:alertDay', today()); } catch {}
}
document.addEventListener('click', async e => { if (!e.target.closest('#alertBtn')) return; const on = localStorage.getItem('jom:alert') === '1';
  if (on) { localStorage.setItem('jom:alert', '0'); toast('Verse alerts off'); } else { const p = await Notification.requestPermission(); if (p === 'granted') { localStorage.setItem('jom:alert', '1'); localStorage.removeItem('jom:alertDay'); toast('Verse alerts on'); showDailyAlert(); } else toast('Notifications were not allowed'); }
  e.target.closest('#alertBtn').textContent = (localStorage.getItem('jom:alert') === '1' ? 'Turn off' : 'Turn on') + ' verse alerts'; });


function viewStudyHub() {
  setNav('read'); document.title = 'Study tools — Just One More Lord';
  const T = [['books', 'Books of the Bible', 'Introductions to all 66 books.'], ['tabernacle', 'Tabernacle & Temple', 'Interactive plan: how each part points to Jesus.'], ['jerusalem', 'Jerusalem through time', 'The city from David to Jesus.'], ['learn', 'Learn Hebrew & Greek', 'Alphabets, top 100 words, flashcards.'], ['read', 'Bible reader', 'Five translations, listen aloud, word study and commentary on every chapter.'], ['topics', 'Topical Bible', '5,000 topics and 100,000 verses (Nave\'s).'], ['dictionary', 'Bible dictionary', 'Easton\'s dictionary and the meaning of 2,600 names.'], ['people', 'People of the Bible', '3,000+ profiles with family, maps and every verse.'],
    ['grace', 'Grace lens', 'Read every passage through the finished work of Jesus.'], ['search-adv', 'Advanced search', 'Search all 31,102 verses by word, phrase, book or Strong\'s number.'], ['parallel', 'Parallel Bible', 'Two or three translations side by side.'], ['rainbow', 'Cross-reference rainbow', 'See the 7,000 strongest links between chapters.'], ['written', 'When was it written?', 'All 66 books on one timeline.'], ['concordance', 'Hebrew & Greek concordance', 'Strong\'s numbers and every occurrence.'], ['prophecy', 'Prophecy and fulfilment', '44 promises and where they were fulfilled.'], ['harmony', 'Gospel harmony', 'The four Gospels side by side, event by event.'], ['places', 'Every Bible place', '1,300 places on one map.'], ['events', 'Events map', '500 events by era.'], ['museums', 'Bible finds in museums', 'Where to see the discoveries today.'], ['lesson', 'Lesson builder', 'Build, print and present a sermon or lesson.'], ['versepic', 'Verse pictures', 'Share a verse on a photo of a Bible place.'], ['measures', 'Money, weights & measures', 'Every Bible unit in today\'s terms, with money in rand.'], ['names', 'Names of God', 'The Hebrew and Greek names of God and what they mean.'], ['parables', 'Parables of Jesus', 'Every parable through the lens of grace.'], ['miracles', 'Miracles of Jesus', 'The miracles on the map.']];
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Everything for deeper study</p><h1>Study tools</h1></div></div><div class="tiles">${T.map(([h, t, d]) => `<button class="tile" data-go="${h}"><b>${t}</b><span>${d}</span></button>`).join('')}</div></div></section>`;
}

/* ======================================================================================
   STAGE 8: book introductions, Tabernacle & Temple, Jerusalem through time, learn Hebrew & Greek,
   fasting tracker, family devotions, reading modes, quiz battles, shareable badges.
   ====================================================================================== */
/* ---------- book introductions ---------- */
const BINTRO = window.JOM_BOOKS || [];
function viewBooks(n) {
  setNav('read'); const i = n === '' || n == null ? -1 : +n;
  if (i >= 0 && BINTRO[i]) { const [name, au, dt, to, th, kv, ol, sum] = BINTRO[i]; document.title = `${name} — introduction — Just One More Lord`;
    main.innerHTML = `<section class="band"><div class="wrap prose"><div class="crumbs"><button data-go="books">Books of the Bible</button> › ${esc(name)}</div><p class="kicker">${i < 39 ? 'Old Testament' : 'New Testament'} · book ${i + 1} of 66</p><h1>${esc(name)}</h1><p class="lead">${esc(sum)}</p>
      <div class="facts pfacts">${[['Author', au], ['Written', dt], ['Written to', to], ['Chapters', (conc.byCode ? (conc.starts?.[i]?.counts.length || '') : '') || '']].filter(x => x[1]).map(([k, v]) => `<div><span>${k}</span><b>${esc(String(v))}</b></div>`).join('')}</div>
      <h3>Key themes</h3><div class="chips">${th.split(/;\s*/).map(t => `<span class="chip static">${esc(t)}</span>`).join('')}</div>
      <h3>Key verse</h3><div class="verse"><button class="vref" data-verse="${esc(kv)}">${esc(kv)}</button><div class="vtext" id="bkv"><span class="spin"></span></div></div>
      <h3>Outline</h3><ol class="outline">${ol.map(([s, c]) => { const ch1 = String(c).split(/[–-]/)[0].trim(); return `<li><button class="inl" data-read-book="${i}" data-ch="${ch1}">${esc(s)}</button> <span class="muted">chapter${/[–-]/.test(c) ? 's' : ''} ${esc(c)}</span></li>`; }).join('')}</ol>
      <div class="linkrow"><button class="btn" data-read-book="${i}" data-ch="1">Start reading ${esc(name)}</button>${i > 0 ? `<button class="btn ghost sm" data-go="books-${i - 1}">← ${esc(BINTRO[i - 1][0])}</button>` : ''}${i < 65 ? `<button class="btn ghost sm" data-go="books-${i + 1}">${esc(BINTRO[i + 1][0])} →</button>` : ''}</div>
      <p class="small muted">Authorship and dates follow common evangelical reference works; scholars debate many of them.</p></div></section>`;
    loadConc().then(() => { const c = conc.starts?.[i]; const f = $('.pfacts'); if (c && f && !/Chapters/.test(f.textContent)) f.insertAdjacentHTML('beforeend', `<div><span>Chapters</span><b>${c.counts.length}</b></div>`); }).catch(() => {});
    bibleText(kv).then(v => { $('#bkv').innerHTML = verseHTML(v); }).catch(() => glossVerse(kv).then(t => { $('#bkv').textContent = t; }).catch(() => { $('#bkv').textContent = ''; })); return; }
  document.title = 'Books of the Bible — Just One More Lord';
  const grp = [['The Law', 0, 5], ['History', 5, 17], ['Poetry & wisdom', 17, 22], ['Major prophets', 22, 27], ['Minor prophets', 27, 39], ['Gospels', 39, 43], ['Acts', 43, 44], ['Paul\'s letters', 44, 57], ['Other letters', 57, 65], ['Prophecy', 65, 66]];
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">66 books, one story</p><h1>Books of the Bible</h1><p>An introduction to every book: who wrote it, when and to whom, its key themes, a key verse and an outline.</p></div></div>
    ${grp.map(([g, a, b]) => `<h2 class="libh">${g}</h2><div class="bookgrid">${BINTRO.slice(a, b).map((x, k) => `<button class="bookcard${a + k < 39 ? ' ot' : ' nt'}" data-go="books-${a + k}"><b>${esc(x[0])}</b><span>${esc(x[7])}</span></button>`).join('')}</div>`).join('')}</div></section>`;
}
document.addEventListener('click', async e => { const b = e.target.closest('[data-read-book]'); if (!b) return; e.preventDefault(); await loadConc(); const bk = conc.starts[+b.dataset.readBook]; if (bk) go(`read-${bk.code}.${b.dataset.ch || 1}`); });

/* ---------- Tabernacle and Temple (interactive diagrams) ---------- */
const TAB = [
  ['gate', 'The gate', 'Exodus 27:16', 'The only way into the courtyard — one wide gate facing east, woven in blue, purple and scarlet.', 'Jesus said, "I am the gate; whoever enters through me will be saved" (John 10:9).'],
  ['altar', 'Bronze altar', 'Exodus 27:1-8', 'The altar of burnt offering, where animals were sacrificed for sin. Everyone who came near God came first to the altar.', 'Jesus is the Lamb of God who takes away the sin of the world (John 1:29; Hebrews 10:10).'],
  ['laver', 'Bronze basin', 'Exodus 30:17-21', 'The priests washed their hands and feet here before serving, made from the bronze mirrors of the women (Exodus 38:8).', 'Cleansing by the washing of water with the word (Ephesians 5:26; Titus 3:5).'],
  ['table', 'Table of the bread', 'Exodus 25:23-30', 'Twelve loaves, one for each tribe, always set before the Lord — the "bread of the Presence".', 'Jesus said, "I am the bread of life" (John 6:35).'],
  ['lamp', 'Golden lampstand', 'Exodus 25:31-40', 'A seven-branched lampstand of pure gold, the only light in the Holy Place, kept burning always.', 'Jesus said, "I am the light of the world" (John 8:12).'],
  ['incense', 'Altar of incense', 'Exodus 30:1-10', 'Fragrant incense burned morning and evening before the curtain — a picture of prayer rising to God (Psalm 141:2).', 'Jesus always lives to intercede for us (Hebrews 7:25).'],
  ['veil', 'The curtain', 'Exodus 26:31-33', 'A thick curtain embroidered with cherubim separated the Holy Place from the Most Holy Place.', 'At Jesus\' death the Temple curtain tore from top to bottom — the way to God is open (Matthew 27:51; Hebrews 10:19-20).'],
  ['ark', 'Ark of the covenant', 'Exodus 25:10-22', 'A gold-covered chest holding the tablets of the Law, with the "mercy seat" on top where the high priest sprinkled blood once a year on the Day of Atonement.', 'God put forward Christ as the place of atonement by his blood (Romans 3:25; Hebrews 9:11-12).']
];
function tabSVG(kind) {
  const herod = kind === 'temple';
  const box = (id, x, y, w, h, label, cls = '') => `<g class="tpart ${cls}" data-tp="${id}" tabindex="0" role="button" aria-label="${label}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/><text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle">${label}</text></g>`;
  return `<svg viewBox="0 0 800 420" class="tabsvg" role="img" aria-label="${herod ? 'Plan of the Temple' : 'Plan of the Tabernacle'}">
    <rect x="10" y="10" width="780" height="400" rx="10" class="court"/><text x="400" y="34" text-anchor="middle" class="clabel">${herod ? 'Courts of the Temple (Solomon\'s Temple followed the same plan)' : 'Courtyard of the Tabernacle (about 50 × 25 metres)'}</text>
    ${box('gate', 14, 170, 34, 80, 'Gate', 'gate')}
    ${box('altar', 110, 175, 90, 70, 'Altar')}
    ${box('laver', 250, 185, 60, 50, 'Basin')}
    <rect x="360" y="110" width="410" height="200" rx="6" class="tent"/><text x="520" y="132" text-anchor="middle" class="clabel">Holy Place</text><text x="700" y="132" text-anchor="middle" class="clabel">Most Holy</text>
    ${box('table', 400, 145, 120, 40, 'Table of bread')}
    ${box('lamp', 400, 245, 120, 40, 'Lampstand')}
    ${box('incense', 545, 190, 70, 40, 'Incense')}
    ${box('veil', 632, 115, 14, 190, '', 'veil')}
    ${box('ark', 665, 180, 90, 60, 'Ark')}
    <text x="400" y="395" text-anchor="middle" class="clabel small">East ← entrance · Tap any part</text></svg>`;
}
function viewTabernacle(kind) {
  setNav('read'); kind = kind === 'temple' ? 'temple' : 'tabernacle'; document.title = (kind === 'temple' ? 'The Temple' : 'The Tabernacle') + ' — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Exodus 25–40 · 1 Kings 6–8 · Hebrews 8–10</p><h1>${kind === 'temple' ? 'The Temple' : 'The Tabernacle'}</h1><p>${kind === 'temple' ? 'Solomon\'s Temple in Jerusalem (and later the Second Temple rebuilt by Herod) kept the same pattern as the Tabernacle, on a grander scale. Jesus taught in its courts.' : 'The portable tent where God met with Israel in the wilderness. Every part was a picture — and the New Testament shows how each points to Jesus.'} Tap any part of the plan.</p></div>
    <div class="linkrow"><button class="chip" data-go="tabernacle" aria-pressed="${kind !== 'temple'}">Tabernacle</button><button class="chip" data-go="tabernacle-temple" aria-pressed="${kind === 'temple'}">Temple</button><button class="btn ghost sm" data-go="jerusalem">Jerusalem through time</button></div></div>
    <div class="tabwrap">${tabSVG(kind)}</div><div id="tabinfo" class="panel" style="margin-top:14px"><p class="muted">Start at the gate on the left, the way a worshipper would enter, and move towards the Ark.</p></div>
    <h2 class="libh">Walk through in order</h2><ol class="outline">${TAB.map(t => `<li><button class="inl" data-tp="${t[0]}">${esc(t[1])}</button> <span class="muted">${esc(t[2])}</span></li>`).join('')}</ol>
    ${kind === 'temple' ? `<p>Solomon dedicated the first Temple about 960 BC (<button class="vref sm" data-verse="1 Kings 8:10-11">1 Kings 8:10-11</button>). Babylon destroyed it in 586 BC; the returned exiles rebuilt it (<button class="vref sm" data-verse="Ezra 6:15">Ezra 6:15</button>), and Herod the Great rebuilt and enlarged it from about 20 BC. The Romans destroyed it in AD 70, as Jesus foretold (<button class="vref sm" data-verse="Luke 21:6">Luke 21:6</button>). <button class="inl" data-go="place-temple-mount">Visit the Temple Mount →</button></p>` : ''}</div></section>`;
  const show = id => { const t = TAB.find(x => x[0] === id); if (!t) return; $$('.tpart').forEach(g => g.classList.toggle('on', g.dataset.tp === id));
    $('#tabinfo').innerHTML = `<p class="kicker">${esc(t[2])}</p><h2>${esc(t[1])}</h2><p>${esc(t[3])}</p><p class="devopray"><b>Pointing to Jesus:</b> ${esc(t[4])}</p><div class="linkrow"><button class="btn ghost sm" data-verse="${esc(t[2])}">Read ${esc(t[2])}</button>${TAB.indexOf(t) < TAB.length - 1 ? `<button class="btn sm" data-tp="${TAB[TAB.indexOf(t) + 1][0]}">Next: ${esc(TAB[TAB.indexOf(t) + 1][1])} →</button>` : ''}</div>`; };
  main.onclick = e => { const g = e.target.closest('[data-tp]'); if (g) { show(g.dataset.tp); if (!g.closest('svg')) $('#tabinfo').scrollIntoView({ block: 'center', behavior: 'smooth' }); } };
  main.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.tp) { e.preventDefault(); show(e.target.dataset.tp); } };
}

/* ---------- Jerusalem through time ---------- */
const JPOLY = { david: [[31.7766, 35.2352], [31.7766, 35.2366], [31.7720, 35.2363], [31.7700, 35.2356], [31.7712, 35.2341], [31.7745, 35.2343]], mount: [[31.7810, 35.2343], [31.7810, 35.2364], [31.7764, 35.2366], [31.7762, 35.2347]],
  west: [[31.7790, 35.2298], [31.7776, 35.2346], [31.7712, 35.2341], [31.7700, 35.2300], [31.7738, 35.2283], [31.7772, 35.2287]], north: [[31.7832, 35.2296], [31.7832, 35.2342], [31.7792, 35.2344], [31.7790, 35.2298]], mount2: [[31.7812, 35.2338], [31.7812, 35.2368], [31.7755, 35.2368], [31.7752, 35.2342]] };
const JSITES = [['Gihon Spring', 31.7732, 35.2366, 'all'], ['Pool of Siloam', 31.7705, 35.2353, 'hez'], ['Hezekiah\'s tunnel', 31.7720, 35.2361, 'hez'], ['Golgotha (Church of the Holy Sepulchre)', 31.7784, 35.2296, 'jesus'], ['Antonia Fortress', 31.7807, 35.2337, 'jesus'], ['Herod\'s palace', 31.7762, 35.2283, 'jesus'], ['Garden of Gethsemane', 31.7795, 35.2397, 'jesus'], ['Pool of Bethesda', 31.7815, 35.2360, 'jesus']];
const JERAS = [
  ['david', 'David\'s city', 'c. 1000 BC', '2 Samuel 5:6-9', 'David captures the Jebusite fortress of Zion on a narrow ridge above the Gihon Spring and makes it his capital — about 4 hectares.', [['City of David', '#ffc72c', 'david']]],
  ['solomon', 'Solomon\'s Jerusalem', 'c. 950 BC', '1 Kings 6:1', 'Solomon extends the city north to Mount Moriah and builds the Temple and his palace there.', [['City of David', '#ffc72c', 'david'], ['Temple and palace', '#00d1ff', 'mount']]],
  ['hez', 'Hezekiah\'s Jerusalem', 'c. 700 BC', '2 Chronicles 32:30', 'Refugees from the fallen north swell the city onto the western hill. Hezekiah builds a broad wall and cuts a tunnel to bring the Gihon water inside before the Assyrian siege.', [['City of David', '#ffc72c', 'david'], ['Temple Mount', '#00d1ff', 'mount'], ['Western hill (Mishneh)', '#39ff9c', 'west']]],
  ['neh', 'Nehemiah\'s Jerusalem', 'c. 445 BC', 'Nehemiah 6:15', 'After the exile the returned community is small. Nehemiah rebuilds the walls around the old City of David and the rebuilt Temple in 52 days.', [['Rebuilt city', '#ffc72c', 'david'], ['Second Temple', '#00d1ff', 'mount']]],
  ['jesus', 'Jerusalem in the time of Jesus', 'c. AD 30', 'Luke 19:41', 'Herod the Great has doubled the Temple platform and built palaces and towers. The city covers both hills and is spreading north. Golgotha lies just outside the wall.', [['Lower city', '#ffc72c', 'david'], ['Herod\'s Temple platform', '#00d1ff', 'mount2'], ['Upper city', '#39ff9c', 'west'], ['New northern quarter', '#ff7aa8', 'north']]]
];
function viewJerusalem(id) {
  setNav('atlas'); const e = JERAS.find(x => x[0] === id) || JERAS[JERAS.length - 1]; document.title = `${e[1]} — Jerusalem through time`;
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Jerusalem through time</p><h1>${esc(e[1])}</h1><p>${esc(e[2])} · ${esc(e[4])} <button class="vref sm" data-verse="${esc(e[3])}">${esc(e[3])}</button></p></div><div class="linkrow"><button class="btn ghost sm" data-go="place-jerusalem">Jerusalem today</button><button class="btn ghost sm" data-go="tabernacle-temple">The Temple</button></div></div>
    <div class="chips">${JERAS.map(x => `<button class="chip" data-go="jerusalem-${x[0]}" aria-pressed="${x[0] === e[0]}">${esc(x[2])} · ${esc(x[1].replace(/'s Jerusalem|Jerusalem in the time of /, ''))}</button>`).join('')}</div>
    <div class="mapbox tall" id="jmap" style="margin-top:14px"></div><div class="maplegend">${e[5].map(([l, c]) => `<span><span class="dot" style="background:${c};color:${c}"></span> ${esc(l)}</span>`).join('')}</div>
    <p class="small muted">Outlines are simplified sketches based on archaeological reconstructions; the exact lines of the ancient walls are still debated.</p>
    <div class="linkrow">${JERAS.indexOf(e) > 0 ? `<button class="btn ghost sm" data-go="jerusalem-${JERAS[JERAS.indexOf(e) - 1][0]}">← Earlier</button>` : ''}${JERAS.indexOf(e) < JERAS.length - 1 ? `<button class="btn sm" data-go="jerusalem-${JERAS[JERAS.indexOf(e) + 1][0]}">Later →</button>` : ''}</div></div></section>`;
  const order = JERAS.map(x => x[0]), at = order.indexOf(e[0]);
  makeMap($('#jmap'), { areas: e[5].map(([label, color, k]) => ({ label, color, pts: JPOLY[k], permanent: true })), markers: JSITES.filter(s => s[3] === 'all' || order.indexOf(s[3]) <= at).map(s => ({ lat: s[1], lon: s[2], label: s[0], kind: 'place' })), maxZoom: 16, fitPad: 30 });
}

/* ---------- learn Hebrew and Greek ---------- */
const HEB = [['א', 'Aleph', 'silent', 'ox'], ['ב', 'Bet', 'b / v', 'house'], ['ג', 'Gimel', 'g', 'camel'], ['ד', 'Dalet', 'd', 'door'], ['ה', 'He', 'h', 'window'], ['ו', 'Vav', 'v / o / u', 'hook'], ['ז', 'Zayin', 'z', 'weapon'], ['ח', 'Het', 'ch (as in Bach)', 'fence'], ['ט', 'Tet', 't', 'basket'], ['י', 'Yod', 'y', 'hand'], ['כ', 'Kaf', 'k / kh', 'palm'], ['ל', 'Lamed', 'l', 'ox-goad'], ['מ', 'Mem', 'm', 'water'], ['נ', 'Nun', 'n', 'fish'], ['ס', 'Samekh', 's', 'prop'], ['ע', 'Ayin', 'silent (throat)', 'eye'], ['פ', 'Pe', 'p / f', 'mouth'], ['צ', 'Tsadi', 'ts', 'fish-hook'], ['ק', 'Qof', 'q', 'back of head'], ['ר', 'Resh', 'r', 'head'], ['שׁ', 'Shin', 'sh / s', 'tooth'], ['ת', 'Tav', 't', 'mark']];
const GRK = [['Α α', 'Alpha', 'a'], ['Β β', 'Beta', 'b'], ['Γ γ', 'Gamma', 'g'], ['Δ δ', 'Delta', 'd'], ['Ε ε', 'Epsilon', 'e (short)'], ['Ζ ζ', 'Zeta', 'z / dz'], ['Η η', 'Eta', 'ē (long)'], ['Θ θ', 'Theta', 'th'], ['Ι ι', 'Iota', 'i'], ['Κ κ', 'Kappa', 'k'], ['Λ λ', 'Lambda', 'l'], ['Μ μ', 'Mu', 'm'], ['Ν ν', 'Nu', 'n'], ['Ξ ξ', 'Xi', 'x'], ['Ο ο', 'Omicron', 'o (short)'], ['Π π', 'Pi', 'p'], ['Ρ ρ', 'Rho', 'r'], ['Σ σ ς', 'Sigma', 's'], ['Τ τ', 'Tau', 't'], ['Υ υ', 'Upsilon', 'u / y'], ['Φ φ', 'Phi', 'ph'], ['Χ χ', 'Chi', 'ch'], ['Ψ ψ', 'Psi', 'ps'], ['Ω ω', 'Omega', 'ō (long)']];
async function viewLearn(arg) {
  setNav('read'); const [lang, tab] = String(arg || 'hebrew').split('-'); const heb = lang !== 'greek'; document.title = `Learn ${heb ? 'Hebrew' : 'Greek'} — Just One More Lord`;
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Read the Bible in its original languages</p><h1>Learn ${heb ? 'Biblical Hebrew' : 'New Testament Greek'}</h1><p>${heb ? 'The Old Testament was written mostly in Hebrew, read from right to left.' : 'The New Testament was written in Koine (common) Greek.'} Start with the alphabet, then learn the most common words — the top 100 cover about half of all the words in the ${heb ? 'Old' : 'New'} Testament.</p></div></div>
    <div class="chips"><button class="chip" data-go="learn-hebrew" aria-pressed="${heb}">Hebrew</button><button class="chip" data-go="learn-greek" aria-pressed="${!heb}">Greek</button><span style="width:16px"></span>${[['abc', 'Alphabet'], ['words', 'Top 100 words'], ['cards', 'Flashcards']].map(([k, l]) => `<button class="chip" data-go="learn-${heb ? 'hebrew' : 'greek'}-${k}" aria-pressed="${(tab || 'abc') === k}">${l}</button>`).join('')}</div><div id="lbody" style="margin-top:18px"><p class="muted"><span class="spin"></span></p></div></div></section>`;
  const body = $('#lbody'); const t = tab || 'abc';
  if (t === 'abc') { body.innerHTML = `<div class="abcgrid${heb ? ' rtl' : ''}">${(heb ? HEB : GRK).map(l => `<div class="abc"><b class="${heb ? 'heb' : 'grk'}">${l[0]}</b><span>${esc(l[1])}</span><small>${esc(l[2])}${l[3] ? ' · “' + esc(l[3]) + '”' : ''}</small></div>`).join('')}</div>
    <p class="small muted">${heb ? 'Five letters have a different form at the end of a word: ך ם ן ף ץ. Vowels are written as small marks above and below the letters.' : 'Σ is written ς at the end of a word. Breathing marks (῾ ᾿) show whether a word starts with an "h" sound.'}</p>`; return; }
  await loadConc(); const top = conc.keys.filter(k => k[0] === (heb ? 'H' : 'G') && conc.lex[k][7] > 0 && /[a-z]{2}/.test(conc.lex[k][3] || '') && !/^(of |to |the |a |and )?[A-Z]/.test(conc.lex[k][3]) && !/^(the |[^a-z])$/.test(conc.lex[k][3])).sort((a, b) => conc.lex[b][7] - conc.lex[a][7]).slice(0, 100);
  if (t === 'words') { body.innerHTML = `<div class="rlist">${top.map((k, i) => { const L = conc.lex[k]; return `<button class="ritem" data-go="strong-${k}"><div><b><span class="${heb ? 'heb' : 'grk'}">${esc(L[0])}</span> · ${esc(L[1])}</b><span>${i + 1}. ${esc(L[3])} — ${esc(String(L[4] || '').slice(0, 90))}</span></div><span class="tag">${L[7].toLocaleString()}×</span></button>`; }).join('')}</div>`; return; }
  if (!MY.lang || typeof MY.lang !== 'object') MY.lang = {}; let deck = shuffle(top.filter(k => !(MY.lang[k] >= 3))).slice(0, 20), i = 0, known = 0;
  const card = () => { if (i >= deck.length) { body.innerHTML = `<div class="kdone"><div class="kic">🎓</div><h2>${known} of ${deck.length} known</h2><p>${Object.values(MY.lang).filter(v => v >= 3).length} of 100 words learned so far.</p><button class="btn" data-go="learn-${heb ? 'hebrew' : 'greek'}-cards">Another round</button></div>`; track(); return; }
    const k = deck[i], L = conc.lex[k];
    body.innerHTML = `<div class="flash" id="fc" tabindex="0"><p class="kicker">Card ${i + 1} of ${deck.length}</p><div class="fw ${heb ? 'heb' : 'grk'}">${esc(L[0])}</div><div class="fb" hidden><p class="xl"><b>${esc(L[3])}</b> · ${esc(L[1])}</p><p class="small muted">${esc(String(L[4] || '').slice(0, 160))} · used ${L[7].toLocaleString()} times</p></div>
      <div class="linkrow" style="justify-content:center"><button class="btn ghost" id="fshow">Show meaning</button><button class="btn" id="fyes" hidden>✓ I knew it</button><button class="btn ghost" id="fno" hidden>Not yet</button></div></div>`;
    $('#fshow').onclick = () => { $('.fb').hidden = false; $('#fshow').hidden = true; $('#fyes').hidden = $('#fno').hidden = false; };
    $('#fyes').onclick = () => { MY.lang[k] = (MY.lang[k] || 0) + 1; known++; saveMy(); i++; card(); }; $('#fno').onclick = () => { MY.lang[k] = 0; saveMy(); i++; card(); }; };
  card();
}

/* ---------- fasting tracker ---------- */
if (!Array.isArray(MY.fasts)) MY.fasts = [];
const FTYPES = [['water', 'Water fast', 'Water only.'], ['daniel', 'Daniel fast', 'Vegetables, fruit, grains and water — no meat, sweets or wine (Daniel 1:12; 10:3).'], ['meal', 'Skip a meal', 'Give up one or more meals and pray instead.'], ['media', 'Media fast', 'Put down phone, TV or social media and seek God.'], ['partial', 'Sunrise to sunset', 'No food during daylight hours.']];
const FVERSES = ['Matthew 6:16-18', 'Isaiah 58:6', 'Joel 2:12', 'Ezra 8:23', 'Matthew 4:4', 'Acts 13:2-3', 'Esther 4:16', 'Daniel 9:3', 'Psalms 35:13', 'Nehemiah 1:4'];
function viewFasting() {
  setNav('community'); document.title = 'Fasting — Just One More Lord'; const cur = MY.fasts.find(f => !f.end);
  const hrs = ms => { const h = Math.floor(ms / 36e5), m = Math.floor(ms % 36e5 / 6e4); return `${h} h ${String(m).padStart(2, '0')} min`; };
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">"When you fast…" · Matthew 6:17</p><h1>Fasting</h1><p>Set aside food or distractions to seek God. Track your fast, read encouraging Scripture and record what God shows you. Please check with a doctor first if you have a medical condition, are pregnant or take medication, and never fast from water.</p></div></div>
    ${cur ? `<div class="panel fastnow"><p class="kicker">Fasting now · ${esc(FTYPES.find(t => t[0] === cur.type)?.[1] || '')}</p><div class="fclock" id="fclock">${hrs(Date.now() - cur.start)}</div><div class="prog big"><i style="width:${Math.min(100, 100 * (Date.now() - cur.start) / (cur.goal * 36e5)).toFixed(1)}%"></i></div><p class="small muted">Goal: ${cur.goal} hours${cur.for ? ' · praying for ' + esc(cur.for) : ''}</p>
      <div class="verse"><button class="vref" data-verse="${esc(FVERSES[Math.floor((Date.now() - cur.start) / 36e5) % FVERSES.length])}">${esc(FVERSES[Math.floor((Date.now() - cur.start) / 36e5) % FVERSES.length])}</button><span class="small muted"> · a new verse each hour</span></div>
      <label class="notebox"><span class="kicker">What is God showing you?</span><textarea id="fnote" rows="3">${esc(cur.note || '')}</textarea></label><div class="linkrow"><button class="btn" id="fend">End fast</button></div></div>`
      : `<div class="panel authform" style="max-width:560px"><h2>Start a fast</h2><label>Type<select id="ftype">${FTYPES.map(t => `<option value="${t[0]}">${t[1]} — ${t[2]}</option>`).join('')}</select></label><label>Length<select id="fgoal">${[12, 16, 24, 36, 48, 72, 168, 504].map(h => `<option value="${h}"${h === 24 ? ' selected' : ''}>${h < 168 ? h + ' hours' : h / 24 + ' days'}</option>`).join('')}</select></label><label>Praying for (optional)<input id="ffor" maxlength="80"></label><button class="btn" id="fstart">Start fasting</button><a class="btn ghost sm" id="fcal" download="fast-reminders.ics">Add hourly prayer reminders to my calendar</a></div>`}
    <h2 class="libh">My fasts</h2>${MY.fasts.filter(f => f.end).length ? `<div class="rlist">${MY.fasts.filter(f => f.end).reverse().map(f => `<div class="ritem"><div><b>${esc(FTYPES.find(t => t[0] === f.type)?.[1] || 'Fast')} · ${hrs(f.end - f.start)}</b><span>${new Date(f.start).toLocaleDateString()}${f.for ? ' · for ' + esc(f.for) : ''}${f.note ? ' — ' + esc(f.note.slice(0, 120)) : ''}</span></div></div>`).join('')}</div>` : '<p class="empty">No fasts recorded yet.</p>'}</div></section>`;
  if (cur) { const t = setInterval(() => { const el = $('#fclock'); if (!el) return clearInterval(t); el.textContent = hrs(Date.now() - cur.start); }, 30000);
    $('#fnote').oninput = e => { cur.note = e.target.value; saveMy(); }; $('#fend').onclick = () => { cur.end = Date.now(); saveMy(); toast('Fast ended — well done'); notify('Fast completed', `You fasted for ${hrs(cur.end - cur.start)}.`, 'fasting'); viewFasting(); }; }
  else { $('#fstart').onclick = () => { MY.fasts.push({ type: $('#ftype').value, goal: +$('#fgoal').value, for: $('#ffor').value.trim(), start: Date.now() }); saveMy(); track(); toast('Fast started — God bless you'); viewFasting(); };
    const mk = () => { const g = +$('#fgoal').value, n = Math.min(g, 72); const s = new Date(); const ev = []; for (let h = 3; h <= n; h += 3) { const d = new Date(s.getTime() + h * 36e5); const z = d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
        ev.push('BEGIN:VEVENT', `UID:fast-${h}-${Date.now()}@justonemorelord`, `DTSTAMP:${z}`, `DTSTART:${z}`, 'DURATION:PT5M', `SUMMARY:Fasting: pause and pray (${h} h)`, 'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Pause and pray', 'END:VALARM', 'END:VEVENT'); }
      $('#fcal').href = URL.createObjectURL(new Blob([['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Just One More Lord//EN', ...ev, 'END:VCALENDAR'].join('\r\n')], { type: 'text/calendar' })); };
    $('#fgoal').onchange = mk; mk(); }
}

/* ---------- family devotions ---------- */
function familyToday() { const d = dayIndex(); const s = KSTORIES[((d % KSTORIES.length) + KSTORIES.length) % KSTORIES.length]; const dv = Object.entries(DEVOS); const v = dv[((d % dv.length) + dv.length) % dv.length]; return { s, v }; }
function viewFamily2() {
  setNav(''); document.title = 'Family devotion — Just One More Lord'; const { s: [ic, title, pid, ref, txt], v: [vid, dvv] } = familyToday(); const p = byId[pid];
  const qs = [`What happened in the story of “${title}”?`, `How did the people in this story trust God — or not?`, `When do you need to trust God like this?`, `What is one thing we can thank God for today?`];
  const acts = ['Find the place on the map together and guess how long it would take to walk there.', 'Act out the story — everyone takes a part!', 'Draw a picture of the story and put it on the fridge.', 'Say the key verse together three times, then try it without looking.', 'Each person names one thing they want to pray about this week.'];
  main.innerHTML = `<section class="band kids"><div class="wrap prose"><p class="kicker">Family devotion · ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · about 10 minutes</p><h1>${ic} ${esc(title)}</h1>
    <div class="linkrow"><button class="btn sm" id="fread">🔊 Read the story aloud</button>${p ? `<button class="btn ghost sm" data-go="place-${p.id}">📍 ${esc(p.n)}</button>` : ''}<button class="btn ghost sm" data-verse="${esc(ref)}">${esc(ref)}</button></div>
    <h3>1 · Read</h3><p class="lead">${esc(txt)}</p>
    <h3>2 · Talk about it</h3><ol>${qs.map(q => `<li>${esc(q)}</li>`).join('')}</ol>
    <h3>3 · For the grown-ups</h3><p><b>${esc(dvv[0])}</b> — ${esc(dvv[2])}</p>
    <h3>4 · Do it together</h3><p>${esc(acts[dayIndex() % acts.length])}</p>
    <h3>5 · Pray</h3><p class="devopray">${esc(dvv[3])} Amen.</p>
    <div class="linkrow"><button class="btn" id="fdone">✓ We did it today</button><button class="btn ghost sm" data-go="kids">Kids' corner</button><a class="btn ghost sm" id="fcal2" download="family-devotion.ics">Daily reminder</a></div>
    <p class="small muted">A new story and reflection every day.</p></div></section>`;
  $('#fread').onclick = () => { if (!('speechSynthesis' in window)) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(title + '. ' + txt); const vv = ttsVoice(); if (vv) u.voice = vv; u.rate = .92; speechSynthesis.speak(u); };
  $('#fdone').onclick = () => { MY.famDays = MY.famDays || {}; MY.famDays[today()] = 1; saveMy(); track(); toast(`Family devotions: ${Object.keys(MY.famDays).length} day${Object.keys(MY.famDays).length === 1 ? '' : 's'} together`); };
  $('#fcal2').href = URL.createObjectURL(new Blob([['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Just One More Lord//EN', 'BEGIN:VEVENT', 'UID:family-' + Date.now() + '@justonemorelord', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', 'DTSTART:' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + 'T183000', 'DURATION:PT15M', 'RRULE:FREQ=DAILY', 'SUMMARY:Family devotion', 'URL:' + SITE + '#family-devotion', 'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Family devotion time', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')], { type: 'text/calendar' }));
}

/* ---------- reading modes (reader) ---------- */
const RMODES = [['', 'Neon'], ['paper', 'Paper'], ['sepia', 'Sepia'], ['night', 'Night']];
function applyReadMode() { document.documentElement.dataset.read = localStorage.getItem('jom:readmode') || ''; }
applyReadMode();
function readModeBar() { const m = localStorage.getItem('jom:readmode') || ''; return `<span class="rmodes" role="group" aria-label="Reading mode">${RMODES.map(([k, l]) => `<button class="rm rm-${k || 'neon'}" data-rm="${k}" aria-pressed="${k === m}" title="${l} mode">${l}</button>`).join('')}</span>`; }
document.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; localStorage.setItem('jom:readmode', b.dataset.rm); applyReadMode(); $$('[data-rm]').forEach(x => x.setAttribute('aria-pressed', x.dataset.rm === b.dataset.rm)); });

/* ---------- quiz battles (same questions for everyone with the link) ---------- */
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function battleQs(seed) { const r = rng(seed); const pool = PLACES.filter(p => p.v?.length); const picks = [];
  while (picks.length < 10) { const p = pool[Math.floor(r() * pool.length)]; const qs = questionsFor(p); if (!qs.length) continue; const q = qs[Math.floor(r() * qs.length)]; if (picks.some(x => x.q === q.q)) continue;
    const o = [q.a, ...q.o.slice(0, 3)]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } picks.push({ ...q, opts: o }); } return picks; }
function viewBattle(arg) {
  setNav('quiz'); const [seedS, scoreS, ...nm] = String(arg || '').split('-'); const seed = +seedS || Math.floor(Math.random() * 1e9); const rival = nm.length ? decodeURIComponent(nm.join('-')) : '', rivalScore = scoreS !== undefined && scoreS !== '' ? +scoreS : null;
  document.title = 'Quiz battle — Just One More Lord'; const qs = battleQs(seed); let i = 0, sc = 0;
  const intro = () => { main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Quiz battle</p><h1>${rival ? `<span class="neon-txt">${esc(rival)}</span> challenges you!` : 'Start a quiz battle'}</h1>
    <p class="lead">${rival ? `${esc(rival)} scored <b>${rivalScore} / 10</b> on these ten questions. Can you beat that?` : 'Ten questions. When you finish, send the link — your friends get exactly the same questions and see your score to beat.'}</p><div class="linkrow"><button class="btn" id="bgo">Start</button></div></div></section>`; $('#bgo').onclick = step; };
  const step = () => { if (i >= qs.length) { const me = myName() || 'A friend'; const won = rivalScore == null ? null : sc > rivalScore ? 'win' : sc === rivalScore ? 'draw' : 'lose'; MY.battles = (MY.battles || 0) + 1; if (sc === 10) MY.quizPerfect = 1; saveMy(); track(); groupReport();
      main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Quiz battle</p><h1>You scored <span class="neon-txt">${sc} / 10</span></h1>${won ? `<p class="lead">${won === 'win' ? `🏆 You beat ${esc(rival)}!` : won === 'draw' ? `🤝 A draw with ${esc(rival)}!` : `${esc(rival)} wins this time (${rivalScore}).`}</p>` : ''}
        ${myName() ? '' : `<label class="notebox"><span class="kicker">Your name for the challenge</span><input id="bname" maxlength="30" class="authinput"></label>`}<div class="linkrow"><button class="btn" id="bsend">${ICON.share} ${rival ? 'Send it back' : 'Challenge friends'}</button><button class="btn ghost" data-go="battle">New battle</button></div></div></section>`;
      $('#bsend').onclick = () => { const n = ($('#bname')?.value.trim() || myName() || 'A friend'); if ($('#bname')?.value.trim()) { MY.name = n; saveMy(); } shareIt({ title: 'Bible quiz battle', text: `⚔️ I scored ${sc}/10 in a Bible quiz battle. Same 10 questions — can you beat me?`, hash: `battle-${seed}-${sc}-${encodeURIComponent(n)}` }); }; return; }
    const q = qs[i]; main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Question ${i + 1} of 10${rival ? ` · ${esc(rival)}: ${rivalScore}` : ''} · you: ${sc}</p><div class="prog"><i style="width:${i * 10}%"></i></div><h2 class="qq">${esc(q.q)}</h2><div class="qopts">${q.opts.map((o, k) => `<button class="qopt" data-k="${k}">${esc(o)}</button>`).join('')}</div><div id="qfb"></div></div></section>`;
    $('.qopts').onclick = e => { const b = e.target.closest('.qopt'); if (!b || $('.qopts').dataset.done) return; $('.qopts').dataset.done = 1; const ok = q.opts[+b.dataset.k] === q.a; if (ok) sc++; $$('.qopt').forEach(x => { if (q.opts[+x.dataset.k] === q.a) x.classList.add('right'); else if (x === b) x.classList.add('wrong'); x.disabled = true; });
      setTimeout(() => { i++; step(); }, ok ? 700 : 1500); }; };
  intro();
}

/* ---------- shareable badges and streaks ---------- */
async function shareCard(big, line1, line2) {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1080; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1080, 1080); g.addColorStop(0, '#032433'); g.addColorStop(1, '#3a2a06'); x.fillStyle = g; x.fillRect(0, 0, 1080, 1080);
  const lg = new Image(); lg.src = 'img/logo.png'; await new Promise(r => { lg.onload = r; lg.onerror = r; }); if (lg.width) x.drawImage(lg, 1080 - 230, 40, 190, 190 * lg.height / lg.width);
  x.textAlign = 'center'; x.font = '280px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; x.fillText(big, 540, 560);
  x.fillStyle = '#fff'; x.font = '800 76px Sora, sans-serif'; x.fillText(line1, 540, 720); x.fillStyle = '#ffc72c'; x.font = '600 44px Sora, sans-serif'; x.fillText(line2, 540, 800);
  x.fillStyle = 'rgba(255,255,255,.8)'; x.font = '600 34px Sora, sans-serif'; x.fillText('Just One More Lord', 540, 1000);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .92)); const f = new File([blob], 'just-one-more-lord.jpg', { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], text: `${line1} — ${SITE}` }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'just-one-more-lord.jpg'; a.click();
}
document.addEventListener('click', e => { const b = e.target.closest('[data-sharebadge]'); if (!b) return; e.preventDefault(); const id = b.dataset.sharebadge;
  if (id === 'streak') { shareCard('🔥', `${streak()}-day streak`, 'reading the Bible every day'); return; }
  const bd = BADGES.find(x => x[0] === id); if (bd) shareCard(bd[1], bd[2], bd[3]); });

/* ======================================================================================
   NOTIFICATIONS: in-app notification centre (bell) + phone push notifications (Web Push via Supabase).
   ====================================================================================== */
if (!Array.isArray(MY.inbox)) MY.inbox = [];
if (!MY.nprefs || typeof MY.nprefs !== 'object') MY.nprefs = { badges: 1, reminders: 1, groups: 1, verse: 1 };
function notify(title, body = '', go = '', kind = 'info') {
  if (MY.nprefs[kind] === 0) return; MY.inbox.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: title, b: body, go, k: kind, d: Date.now(), r: 0 }); MY.inbox = MY.inbox.slice(0, 80); saveMy(); bellUpdate();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') navigator.serviceWorker?.getRegistration().then(r => r?.showNotification(title, { body, icon: 'icons/app-192.png', badge: 'icons/app-192.png', data: { url: SITE + (go ? '#' + go : '') } })).catch(() => {});
}
function bellUpdate() { const b = $('#bellBtn'); if (!b) return; const n = MY.inbox.filter(x => !x.r).length; b.querySelector('.bcount').textContent = n > 9 ? '9+' : n || ''; b.classList.toggle('has', n > 0); b.setAttribute('aria-label', `Notifications${n ? ', ' + n + ' new' : ''}`); }
function bellBtn() { const t = $('.tools'); if (!t || $('#bellBtn')) return; t.insertAdjacentHTML('afterbegin', `<button class="tbtn bell" id="bellBtn" data-go="notifications" title="Notifications"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span class="bcount"></span></button>`); bellUpdate(); }
// wrap badge earning so it also lands in the notification centre
const _checkBadges = checkBadges;
checkBadges = function () { const before = new Set(Object.keys(MY.badges)); _checkBadges(); for (const [id, ic, n, d] of BADGES) if (MY.badges[id] && !before.has(id)) notify(`${ic} Badge earned: ${n}`, d, 'library', 'badges'); };
/* daily reminders, worked out on the device when the app opens */
async function dailyChecks() {
  const k = today(); if (MY.nchk === k && new Date().getHours() < 17) return; const hr = new Date().getHours(); const done = MY.nchkDone || (MY.nchkDone = {});
  const once = (id, fn) => { const key = k + ':' + id; if (done[key]) return; if (fn()) done[key] = 1; };
  once('verse', () => { const x = votd(); if (!x) return false; notify('📖 Verse of the day', `${x.ref} — ${x.ctx}`, 'place-' + x.p.id, 'verse'); return true; });
  once('mem', () => { const n = Object.values(MY.mem || {}).filter(m => m.due <= Date.now()).length; if (!n) return false; notify('🧠 Memory verses to practise', `${n} verse${n === 1 ? '' : 's'} ready for today.`, 'memory', 'reminders'); return true; });
  if (hr >= 17) { once('streak', () => { if (MY.days[k] || !streak()) return false; notify('🔥 Keep your streak going', `You have a ${streak()}-day streak — read a chapter today to keep it.`, 'read', 'reminders'); return true; });
    once('daily', () => { if (MY.daily?.[k]) return false; notify('❓ Today\'s daily challenge', 'One Bible question — can you get it right?', 'daily', 'reminders'); return true; }); }
  once('plan', () => { const act = Object.entries(MY.plans || {}).map(([id, d]) => [ALLPLANS.find(j => j.id === id), d]).filter(([j, d]) => j && (d.done || []).length < j.stops.length); if (!act.length) return false; const [j, d] = act[0]; notify('📅 Your reading plan', `${j.n}: day ${(d.done || []).length + 1} of ${j.stops.length}.`, 'plan-' + j.id, 'reminders'); return true; });
  const f = (MY.fasts || []).find(x => !x.end); if (f && Date.now() - f.start >= f.goal * 36e5) once('fastgoal', () => { notify('🙏 Fasting goal reached', `You reached your ${f.goal}-hour goal. End your fast when you are ready.`, 'fasting', 'reminders'); return true; });
  MY.nchk = k; for (const key of Object.keys(done)) if (!key.startsWith(k)) delete done[key]; saveMy();
  if (typeof GROUP_ON === 'function' && GROUP_ON() && MY.nprefs.groups !== 0) { try { const gs = await myGroups(); const since = MY.ngrp || new Date(Date.now() - 864e5).toISOString();
      for (const g of gs) { const ps = await sbFetch(`/rest/v1/group_prayers?group_id=eq.${g.group_id}&created_at=gt.${encodeURIComponent(since)}&user_id=neq.${AUTH.user.id}&select=name,text&order=created_at.desc&limit=5`);
        ps.forEach(p => notify(`🙏 Prayer request · ${g.groups?.name || 'your group'}`, `${p.name || 'Someone'}: ${p.text.slice(0, 120)}`, 'group-' + g.group_id, 'groups')); }
      MY.ngrp = new Date().toISOString(); saveMy(); } catch {} }
}
/* phone push notifications */
const PUSHKEY = CFG.pushPublicKey || '';
const b64u = s => { const p = '='.repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };
async function pushState() { if (!('serviceWorker' in navigator) || !('PushManager' in window) || !PUSHKEY || !sbOn()) return 'unsupported'; const reg = await navigator.serviceWorker.getRegistration(); if (!reg) return 'unsupported'; const s = await reg.pushManager.getSubscription(); return s ? 'on' : 'off'; }
async function pushOn() {
  const p = await Notification.requestPermission(); if (p !== 'granted') { toast('Notifications were not allowed — check your phone settings'); return false; }
  const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(PUSHKEY) }); const j = sub.toJSON();
  await pushSave(sub);
  localStorage.setItem('jom:alert', '1'); toast('Phone notifications are on'); return true;
}
async function pushSave(sub) { const j = sub.toJSON();
  try { await sbFetch('/rest/v1/push_subscriptions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys, user_id: signedIn() ? AUTH.user.id : null }) }, signedIn()); }
  catch (e) { if (e.status !== 409 && !/duplicate/i.test(e.message)) { localStorage.removeItem('jom:pushsaved'); await sub.unsubscribe().catch(() => {}); throw new Error('Could not register this phone: ' + e.message); } }
  localStorage.setItem('jom:pushsaved', j.endpoint); pushHour(j.endpoint).catch(() => {}); }
const pushLocalHour = () => +(localStorage.getItem('jom:pushhour') ?? 7);
async function pushHour(endpoint) { if (!endpoint) { const s = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription(); endpoint = s?.endpoint; } if (!endpoint) return; const utc = ((Math.round(pushLocalHour() + new Date().getTimezoneOffset() / 60)) % 24 + 24) % 24; await sbFetch('/rest/v1/rpc/set_push_hour', { method: 'POST', body: JSON.stringify({ p_endpoint: endpoint, p_hour: utc }) }, false); }
async function pushResync() { try { if ((await pushState()) !== 'on') return; const s = await (await navigator.serviceWorker.getRegistration()).pushManager.getSubscription(); if (s && localStorage.getItem('jom:pushsaved') !== s.endpoint) await pushSave(s); } catch {} }
async function pushOff() { const reg = await navigator.serviceWorker.getRegistration(); const s = await reg?.pushManager.getSubscription(); if (s) await s.unsubscribe(); localStorage.setItem('jom:alert', '0'); toast('Phone notifications are off'); }
async function viewNotifications() {
  setNav(''); document.title = 'Notifications — Just One More Lord'; const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ps = await pushState(); const L = MY.inbox; const ago = d => { const m = Math.round((Date.now() - d) / 6e4); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(d).toLocaleDateString(); };
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Stay connected</p><h1>Notifications</h1></div><div class="linkrow">${L.some(x => !x.r) ? '<button class="btn ghost sm" id="nall">Mark all as read</button>' : ''}${L.length ? '<button class="btn ghost sm" id="nclr">Clear</button>' : ''}</div></div>
    <div class="panel"><h2>Phone notifications</h2>${ps === 'unsupported' ? `<p class="small muted">${ios && !standalone ? 'On iPhone, first add the app to your home screen (Safari → Share → Add to Home Screen), then open it from there and come back to this page.' : !PUSHKEY || !sbOn() ? 'Phone notifications are being set up by the site owner.' : 'This browser cannot receive push notifications.'}</p>`
      : `<p class="small muted">Get the verse of the day on your phone each morning, even when the app is closed.</p><button class="btn sm" id="npush">${ps === 'on' ? 'Turn off phone notifications' : 'Turn on phone notifications'}</button>${ps === 'on' ? `<label class="tog" style="margin-top:12px">Send my verse at <select id="nhour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === pushLocalHour() ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>` : ''}`}
      <h3 style="margin-top:16px">In the app, tell me about</h3>${[['verse', 'Verse of the day'], ['reminders', 'Reading plan, streak, memory verses and daily challenge reminders'], ['badges', 'Badges I earn'], ['groups', 'Prayer requests in my church groups']].map(([k, l]) => `<label class="tog"><input type="checkbox" data-np="${k}" ${MY.nprefs[k] !== 0 ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <div class="rlist" style="margin-top:18px">${L.map(x => `<button class="ritem nitem${x.r ? '' : ' unread'}" data-nid="${x.id}"><div><b>${esc(x.t)}</b><span>${esc(x.b)}</span></div><span class="tag">${ago(x.d)}</span></button>`).join('') || '<p class="empty">No notifications yet.</p>'}</div></div></section>`;
  $('#nall')?.addEventListener('click', () => { L.forEach(x => x.r = 1); saveMy(); bellUpdate(); viewNotifications(); });
  $('#nclr')?.addEventListener('click', () => { MY.inbox = []; saveMy(); bellUpdate(); viewNotifications(); });
  $('#npush')?.addEventListener('click', async e => { e.target.disabled = true; try { ps === 'on' ? await pushOff() : await pushOn(); } catch (er) { toast(er.message || 'Could not change notifications'); } viewNotifications(); });
  $('#nhour')?.addEventListener('change', async e => { localStorage.setItem('jom:pushhour', e.target.value); try { await pushHour(); toast(`Your verse will arrive at ${String(e.target.value).padStart(2, '0')}:00`); } catch { toast('Saved on this phone — it will update when you are online'); } });
  $$('[data-np]').forEach(c => c.onchange = () => { MY.nprefs[c.dataset.np] = c.checked ? 1 : 0; saveMy(); });
  main.querySelector('.rlist').onclick = e => { const b = e.target.closest('[data-nid]'); if (!b) return; const x = L.find(y => y.id === b.dataset.nid); if (!x) return; x.r = 1; saveMy(); bellUpdate(); if (x.go) go(x.go); else viewNotifications(); };
}
navigator.serviceWorker?.addEventListener('message', e => { const g = e.data && e.data.go; if (g && location.hash !== g) location.hash = g; else if (g) render(); });
bellBtn(); setTimeout(dailyChecks, 2500); setTimeout(pushResync, 4000); document.addEventListener('visibilitychange', () => { if (!document.hidden) dailyChecks(); });

/* ---------- site-owner tool: make phone-notification keys in the browser (the private key never leaves this device) ---------- */
async function viewPushKeys() {
  setNav(''); document.title = 'Notification keys';
  main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">For the site owner</p><h1>Make notification keys</h1><p class="lead">This makes a pair of keys on this phone. Paste the private key into Supabase only; send the public key to your developer.</p><button class="btn" id="pkgo">Make keys</button><div id="pkout"></div></div></section>`;
  $('#pkgo').onclick = async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const pub = b64(await crypto.subtle.exportKey('raw', kp.publicKey)); const priv = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d;
    const cron = b64(crypto.getRandomValues(new Uint8Array(18)));
    $('#pkout').innerHTML = [['VAPID_PUBLIC (Supabase secret, and send this one to your developer)', pub], ['VAPID_PRIVATE (Supabase secret only — never share)', priv], ['CRON_SECRET (Supabase secret, and in the schedule script)', cron]].map(([l, v]) => `<label class="notebox"><span class="kicker">${l}</span><textarea rows="2" readonly>${v}</textarea></label><button class="btn ghost sm" data-copy="${v}">Copy</button>`).join('');
    $$('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied'); } catch { toast('Press and hold the box to copy'); } });
  };
}


/* ---------- Grace lens: every passage in the light of the finished work and the love of God ---------- */
const GRACE = window.JOM_GRACE || { books: [], passages: {} };
const GCH = {};
async function graceChapter(code, ch) { if (!GCH[code]) GCH[code] = fetch(`data/gracech/${code}.json`).then(r => { if (!r.ok) throw 0; return r.json(); }).catch(e => { delete GCH[code]; throw e; }); return (await GCH[code])[ch - 1] || ''; }
async function fillGraceChapter() { const el = document.getElementById('gch'); if (!el) return; try { const t = await graceChapter(el.dataset.code, +el.dataset.ch); if (el.isConnected) el.querySelector('p:last-child').outerHTML = `<p>${esc(t)}</p>`; } catch { el.remove(); } }
const GOSPEL_PHASE = { Mat: [26, 28], Mrk: [14, 16], Luk: [22, 24], Jhn: [18, 20] };
function covenantNote(b, ch) {
  const c = b.code, i = b.i;
  if (i < 39) return ['Old covenant · before the cross', 'Written under the old covenant (the law given through Moses). Read it in the light of Jesus, who fulfilled the law, took its curse and brought a better covenant (Matthew 5:17; Galatians 3:13; Hebrews 8:6).'];
  if (GOSPEL_PHASE[c]) { const [x, r] = GOSPEL_PHASE[c];
    if (ch >= r) return ['After the resurrection · new covenant', 'Jesus has finished the work and risen. From here on, everything is "new covenant": forgiveness preached in his name and his followers sent out (Luke 24:46-47).'];
    if (ch >= x) return ['The cross · the new covenant is made', 'This is the turning point of the Bible. Jesus gives his body and blood for the new covenant, and cries "It is finished" (Luke 22:20; John 19:30).'];
    return ['Before the cross · Jesus speaking to people under the law', 'Jesus was born under the law (Galatians 4:4) and often spoke to people trying to be right with God by keeping it. Sometimes he raised the law\'s standard to show that no one can reach it on their own, so that all would need grace. Ask: is he revealing the Father\'s heart, or showing the impossibility of the law?']; }
  if (c === 'Act') return ['Transition · the church learning grace', 'Acts shows the first believers moving from the old covenant into the new: the Spirit poured out, the gospel going to the nations, and the decision that people are saved by grace, not by keeping the law of Moses (Acts 15:11).'];
  if (c === 'Heb') return ['New covenant · comparing the covenants', 'Written to Jewish believers tempted to go back to the temple and its sacrifices. Its warnings make the point that Jesus\' one sacrifice is enough; there is no other (Hebrews 10:12-14).'];
  if (c === 'Rev') return ['New covenant · the Lamb who was slain', 'Revelation unveils Jesus, the Lamb who freed us from our sins by his blood (1:5), and his final victory over evil.'];
  return ['New covenant · written to believers', 'This letter was written after the cross, directly to believers. It tells you who you already are and what you already have in Christ.'];
}
function verseHits(spec, v) { return String(spec).split(/,\s*/).some(p => { const [a, z] = p.split('-').map(Number); return v >= a && v <= (z || a); }); }
function graceNotesFor(code, ch, v) { return (GRACE.passages[`${code}.${ch}`] || []).filter(n => !v || verseHits(n[0], v)); }
function graceNoteHTML(b, ch, n) { return `<div class="gnote"><p class="kicker">${esc(b.name)} ${ch}:${esc(n[0])}</p><h3>${esc(n[1])}</h3><p>${esc(n[2])}</p>${n[3]?.length ? `<div class="chips">${n[3].map(r => `<button class="chip" data-verse="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}</div>`; }
function hearItLinks(q) { const e = encodeURIComponent(q);
  return `<div class="linkrow"><a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.youtube.com/channel/UC8H3lzJU5Qm-s3WVroB87kw/search?query=${e}">Andrew Wommack</a><a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.youtube.com/@harvestchurchza/search?query=${e}">Richard Olivier</a><a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent('Dan Mohler ' + q)}">Dan Mohler</a></div>`; }
function graceHTML(b, ch) {
  const [tag, cov] = covenantNote(b, ch); const notes = graceNotesFor(b.code, ch);
  return `<p class="gtag">${esc(tag)}</p><p class="small">${esc(cov)}</p>
    <div class="gnote gch" id="gch" data-code="${b.code}" data-ch="${ch}"><p class="kicker">${esc(b.name === 'Psalms' ? 'Psalm' : b.name)} ${ch} through grace</p><p class="muted small"><span class="spin"></span></p></div>
    ${notes.map(n => graceNoteHTML(b, ch, n)).join('')}
    <h3>How ${esc(b.name)} points to Jesus</h3><p class="small">${esc(GRACE.books[b.i] || '')}</p>
    <h3>Four questions for any passage</h3><ol class="small gq"><li>Who is speaking, and to whom?</li><li>Is this before or after the cross, under the law or under grace?</li><li>What did Jesus fulfil, finish or provide here?</li><li>What does this show about the Father\'s love? Jesus is the exact picture of him (Hebrews 1:3; John 14:9).</li></ol>
    <h3>Hear it taught</h3><p class="small muted">Search the teachers\' channels for ${esc(b.name)} ${ch}:</p>${hearItLinks(`${b.name} ${ch}`)}
    <p class="small muted">A devotional lens from the finished-work, new covenant grace teaching. Test everything with Scripture (Acts 17:11). <button class="inl" data-go="grace">All grace notes</button></p>`;
}
function viewGrace() {
  setNav('study'); document.title = 'Grace lens — Just One More Lord'; const books = conc.starts || [];
  const names = Object.fromEntries((window.__concBooks || []).map(x => [x[0], x[1]]));
  const nm = c => (conc.byCode?.[c]?.name) || names[c] || c;
  const groups = Object.entries(GRACE.passages);
  main.innerHTML = `<section class="band"><div class="wrap"><p class="kicker">The finished work and the love of God</p><h1>Grace lens</h1>
    <p class="lead">Read every passage in the light of the cross. Open any chapter in the Bible reader and the Grace lens panel shows a note on that chapter through the finished work of Jesus (all 1,189 chapters), its covenant context, how the book points to Jesus, and notes on passages that are often misread.</p>
    <div class="panel"><h2>Four questions for any passage</h2><ol class="gq"><li>Who is speaking, and to whom?</li><li>Is this before or after the cross, under the law or under grace?</li><li>What did Jesus fulfil, finish or provide here?</li><li>What does this show about the Father\'s love? Jesus is the exact picture of him (Hebrews 1:3).</li></ol></div>
    <input class="gfind" id="gfind" type="search" placeholder="Search the grace notes (e.g. tithe, healing, forgiveness)" aria-label="Search the grace notes">
    <div class="rlist" id="glist">${groups.map(([k, ns]) => { const [c, ch] = k.split('.'); return ns.map(n => `<button class="ritem" data-go="read-${c}.${ch}.${parseInt(n[0])}" data-s="${esc((nm(c) + ' ' + ch + ' ' + n[1] + ' ' + n[2]).toLowerCase())}"><div><b>${esc(nm(c))} ${ch}:${esc(n[0])} · ${esc(n[1])}</b><span>${esc(n[2].slice(0, 170))}${n[2].length > 170 ? '…' : ''}</span></div><span class="tag">Read</span></button>`).join(''); }).join('')}</div>
    <p class="small muted" style="margin-top:16px">A devotional lens from the finished-work, new covenant grace teaching of teachers such as Andrew Wommack and Richard Olivier. Test everything with Scripture (Acts 17:11).</p></div></section>`;
  $('#gfind').oninput = e => { const q = e.target.value.trim().toLowerCase(); $$('#glist [data-s]').forEach(x => x.hidden = q && !x.dataset.s.includes(q)); };
}

/* ---------- display & accessibility settings (shares PREF with the Aa panel) ---------- */
function applyA11y() { const r = document.documentElement; r.dataset.font = PREF.font || ''; r.dataset.spacing = PREF.sp ? '1' : '';
  if (PREF.font && !document.getElementById('a11yfont')) { const l = document.createElement('link'); l.id = 'a11yfont'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Lexend:wght@400;600&display=swap'; document.head.appendChild(l); } }
applyA11y();
function viewSettings() {
  setNav(''); document.title = 'Display & accessibility — Just One More Lord'; const pct = () => Math.round((PREF.size || 1) * 100);
  main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Make it yours</p><h1>Display &amp; accessibility</h1>
    <div class="panel"><h2>Text size</h2><div class="linkrow"><button class="btn ghost sm" data-sz="-0.1" aria-label="Smaller text">A−</button><b id="szv" aria-live="polite">${pct()}%</b><button class="btn ghost sm" data-sz="0.1" aria-label="Bigger text">A+</button><button class="btn ghost sm" data-sz="0">Reset</button></div>
      <h2 style="margin-top:18px">Theme</h2><div class="linkrow" role="radiogroup" aria-label="Theme">${[['dark', '🌙 Dark neon'], ['light', '☀ Light'], ['auto', 'Match my phone']].map(([k, l]) => `<button class="btn ghost sm" role="radio" data-thm="${k}" aria-checked="${(PREF.theme || 'dark') === k}">${l}</button>`).join('')}</div>
      <p class="small muted">Light mode is easier to read outside in bright sunlight.</p>
      <h2 style="margin-top:18px">Font</h2><div class="linkrow" role="radiogroup" aria-label="Font">${[['', 'Standard'], ['easy', 'Easy-read (Atkinson Hyperlegible)'], ['lexend', 'Dyslexia-friendly (Lexend)']].map(([k, l]) => `<button class="btn ghost sm" role="radio" data-fnt="${k}" aria-checked="${(PREF.font || '') === k}">${l}</button>`).join('')}</div>
      <h2 style="margin-top:18px">Reading comfort</h2>
      ${[['hc', 'High contrast (no glow, stronger text)'], ['rm', 'Reduce motion and animations'], ['sp', 'Extra line and letter spacing']].map(([k, l]) => `<label class="tog"><input type="checkbox" data-a11y="${k}" ${PREF[k] ? 'checked' : ''}> ${l}</label>`).join('')}
      <h2 style="margin-top:18px">Bible reading colours</h2>${readModeBar()}</div>
    <p class="small muted" style="margin-top:14px">Saved on this device. Screen readers (VoiceOver and TalkBack) work throughout the app, and the Bible reader can read chapters aloud.</p></div></section>`;
  const save = () => { savePrefs(); applyA11y(); };
  $$('[data-sz]').forEach(b => b.onclick = () => { const d = +b.dataset.sz; PREF.size = d ? Math.min(1.6, Math.max(0.8, Math.round(((PREF.size || 1) + d) * 10) / 10)) : 1; save(); $('#szv').textContent = pct() + '%'; });
  $$('[data-thm]').forEach(b => b.onclick = () => { PREF.theme = b.dataset.thm; save(); $$('[data-thm]').forEach(x => x.setAttribute('aria-checked', x === b)); });
  $$('[data-fnt]').forEach(b => b.onclick = () => { PREF.font = b.dataset.fnt; save(); $$('[data-fnt]').forEach(x => x.setAttribute('aria-checked', x === b)); });
  $$('[data-a11y]').forEach(c => c.onchange = () => { PREF[c.dataset.a11y] = c.checked; save(); });
}
/* ---------- crash reports (anonymous: message, page and browser only) ---------- */
let errSent = 0;
function reportError(msg, src) { if (!sbOn() || errSent >= 5 || !navigator.onLine) return; const m = String(msg || '').slice(0, 500); if (!m || /ResizeObserver|Script error|extension:\/\//i.test(m + src)) return; errSent++;
  fetch(SB.url.replace(/\/$/, '') + '/rest/v1/app_errors', { method: 'POST', headers: { apikey: SB.anonKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ message: m, source: String(src || '').slice(0, 300), page: location.hash.slice(0, 100), agent: navigator.userAgent.slice(0, 200), version: document.querySelector('script[src*="app.js"]')?.src.split('v=')[1] || '' }) }).catch(() => {}); }
addEventListener('error', e => reportError(e.message, `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''} ${e.error?.stack?.slice(0, 200) || ''}`));
addEventListener('unhandledrejection', e => { const r = e.reason; if (r?.name === 'AbortError' || /offline|Failed to fetch|NetworkError|Load failed|rate limit|429/i.test(String(r?.message || r))) return; reportError(r?.message || String(r), r?.stack?.slice(0, 300)); });
/* ---------- offline banner + sync when the app opens ---------- */
function netBanner() { let b = document.getElementById('netb'); if (navigator.onLine) { b?.remove(); return; } if (b) return; b = document.createElement('div'); b.id = 'netb'; b.setAttribute('role', 'status'); b.textContent = 'You are offline — saved chapters, places and your library still work.'; document.body.appendChild(b); }
addEventListener('online', netBanner); addEventListener('offline', netBanner); netBanner();
let lastPull = 0; function syncOnOpen() { if (!sbOn() || !signedIn() || !navigator.onLine || Date.now() - lastPull < 6e5) return; lastPull = Date.now(); pullProfile(); }
setTimeout(syncOnOpen, 3000); document.addEventListener('visibilitychange', () => { if (!document.hidden) syncOnOpen(); });

/* ---------- deeper study: parallel Bible, advanced search, cross-reference rainbow, when written, progress map ---------- */
const PTRANS = () => { try { const a = JSON.parse(localStorage.getItem('jom:par') || 'null'); if (Array.isArray(a) && a.length) return a; } catch {} return ['web', 'kjv', 'bbe']; };
async function viewParallel(arg) {
  setNav('read'); await loadConc(); let [code, ch] = String(arg || MY.last || 'Jhn.1').split('.'); const b = conc.byCode[code] || conc.byCode.Jhn; ch = Math.min(Math.max(+ch || 1, 1), b.counts.length);
  const tr = PTRANS(); document.title = `${b.name} ${ch} side by side — Just One More Lord`; const books = conc.starts;
  const prev = ch > 1 ? `${b.code}.${ch - 1}` : (b.i > 0 ? `${books[b.i - 1].code}.${books[b.i - 1].counts.length}` : null), next = ch < b.counts.length ? `${b.code}.${ch + 1}` : (b.i < 65 ? `${books[b.i + 1].code}.1` : null);
  const sel = (i) => `<select data-pt="${i}" aria-label="Translation ${i + 1}">${i ? '<option value="">—</option>' : ''}${TRANS.map(([k, n]) => `<option value="${k}"${tr[i] === k ? ' selected' : ''}>${k.toUpperCase()} · ${esc(n)}</option>`).join('')}</select>`;
  main.innerHTML = `<section class="band"><div class="wrap"><p class="kicker">Parallel Bible</p><h1>${esc(b.name)} <span class="neon-txt">${ch}</span> side by side</h1>
    <div class="readbar"><select id="pbk" aria-label="Book">${books.map(x => `<option value="${x.code}"${x.code === b.code ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select><select id="pch" aria-label="Chapter">${b.counts.map((_, i) => `<option${i + 1 === ch ? ' selected' : ''}>${i + 1}</option>`).join('')}</select>${[0, 1, 2].map(sel).join('')}
      <span class="grow"></span><button class="btn ghost sm" ${prev ? `data-go="parallel-${prev}"` : 'disabled'} aria-label="Previous chapter">←</button><button class="btn ghost sm" ${next ? `data-go="parallel-${next}"` : 'disabled'} aria-label="Next chapter">→</button><button class="btn ghost sm" data-go="read-${b.code}.${ch}">Single</button></div>
    <div id="ptext"><p class="muted"><span class="spin"></span>Loading translations…</p></div></div></section>`;
  $('#pbk').onchange = e => go(`parallel-${e.target.value}.1`); $('#pch').onchange = e => go(`parallel-${b.code}.${e.target.value}`);
  $$('[data-pt]').forEach(x => x.onchange = () => { const a = $$('[data-pt]').map(y => y.value).filter(Boolean); localStorage.setItem('jom:par', JSON.stringify([...new Set(a)])); viewParallel(`${b.code}.${ch}`); });
  const cols = []; for (const t of tr) { try { const v = await bibleText(`${b.name} ${ch}`, t); cols.push([t, Object.fromEntries(v.verses.map(x => [x.v, x.t]))]); } catch { cols.push([t, null]); } }
  const n = b.counts[ch - 1]; if (!$('#ptext')) return;
  $('#ptext').innerHTML = `<div class="ptable" style="--pc:${cols.length}"><div class="prow phead">${cols.map(([t, m]) => `<div>${t.toUpperCase()}${m ? '' : ' <span class="small muted">(needs a connection)</span>'}</div>`).join('')}</div>
    ${Array.from({ length: n }, (_, i) => i + 1).map(v => `<div class="prow" id="pv${v}">${cols.map(([t, m]) => `<div><span class="ptl">${t.toUpperCase()}</span><sup>${v}</sup>${m?.[v] ? esc(m[v]) : '<span class="small muted">not available right now</span>'}</div>`).join('')}</div>`).join('')}</div>`;
}
let WEBALL = null;
async function webAll() { if (!WEBALL) WEBALL = fetch('data/web/all.json').then(r => { if (!r.ok) throw new Error('The search data is not available yet.'); return r.json(); }).catch(e => { WEBALL = null; throw e; }); return WEBALL; }
async function viewAdvSearch(q0) {
  setNav('study'); await loadConc(); document.title = 'Advanced Bible search — Just One More Lord'; q0 = decodeURIComponent(q0 || '');
  main.innerHTML = `<section class="band"><div class="wrap"><p class="kicker">Search every verse</p><h1>Advanced Bible search</h1>
    <form id="asf" class="panel asearch"><input id="asq" type="search" placeholder="Words, a phrase, or a Strong's number like G26 or H2617" value="${esc(q0)}" aria-label="Search the Bible">
      <div class="linkrow"><select id="asm" aria-label="Match"><option value="all">All the words</option><option value="phrase">Exact phrase</option><option value="any">Any of the words</option></select>
      <select id="ass" aria-label="Where"><option value="">Whole Bible</option><option value="ot">Old Testament</option><option value="nt">New Testament</option><option value="gos">The Gospels</option><option value="ep">Letters (Romans–Jude)</option>${conc.starts.map(x => `<option value="b${x.i}">${esc(x.name)}</option>`).join('')}</select><button class="btn sm">Search</button></div>
      <p class="small muted">World English Bible, all 31,102 verses, works offline once downloaded. For Hebrew and Greek words, type a Strong's number (H… or G…).</p></form>
    <div id="asr"></div></div></section>`;
  const run = async () => { const q = $('#asq').value.trim(); if (!q) return; if (/^[HG]\d{1,5}$/i.test(q)) { go('strong-' + q.toUpperCase()); return; }
    $('#asr').innerHTML = '<p class="muted"><span class="spin"></span>Searching 31,102 verses…</p>'; let all; try { all = await webAll(); } catch (e) { $('#asr').innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    const m = $('#asm').value, sc = $('#ass').value, ql = norm(q), words = ql.split(' ').filter(Boolean);
    const inScope = c => { const i = conc.byCode[c].i; return !sc || (sc === 'ot' ? i < 39 : sc === 'nt' ? i >= 39 : sc === 'gos' ? i >= 39 && i <= 42 : sc === 'ep' ? i >= 44 && i <= 64 : i === +sc.slice(1)); };
    const test = t => { const n = ' ' + norm(t) + ' '; return m === 'phrase' ? n.includes(' ' + ql + ' ') : m === 'any' ? words.some(w => n.includes(' ' + w + ' ')) : words.every(w => n.includes(' ' + w + ' ')); };
    const hits = all.filter(([c, , , t]) => inScope(c) && test(t)); const per = {}; hits.forEach(([c]) => per[c] = (per[c] || 0) + 1);
    const re = new RegExp('(' + (m === 'phrase' ? [q] : q.split(/\s+/)).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    $('#asr').innerHTML = `<h2>${hits.length.toLocaleString()} verse${hits.length === 1 ? '' : 's'}</h2>${hits.length ? `<div class="chips">${Object.entries(per).map(([c, k]) => `<button class="chip" data-asb="${c}">${esc(conc.byCode[c].name)} · ${k}</button>`).join('')}</div>` : '<p class="empty">No verses found. Try "Any of the words" or fewer words.</p>'}
      <div class="rlist" id="ashits">${hits.slice(0, 400).map(([c, ch, v, t]) => `<button class="ritem" data-go="read-${c}.${ch}.${v}" data-c="${c}"><div><b>${esc(conc.byCode[c].name)} ${ch}:${v}</b><span>${esc(t).replace(re, '<mark>$1</mark>')}</span></div></button>`).join('')}</div>${hits.length > 400 ? '<p class="small muted">Showing the first 400 — tap a book above or narrow the search.</p>' : ''}`;
    $$('[data-asb]').forEach(x => x.onclick = () => { $('#ass').value = 'b' + conc.byCode[x.dataset.asb].i; run(); });
    history.replaceState(null, '', '#search-' + encodeURIComponent(q)); };
  $('#asf').onsubmit = e => { e.preventDefault(); run(); }; if (q0) run();
}
function chStarts() { const out = []; let k = 0; for (const b of conc.starts) { out.push(k); k += b.counts.length; } return [out, k]; }
async function viewRainbow() {
  setNav('study'); await loadConc(); document.title = 'Cross-reference rainbow — Just One More Lord'; const [st, total] = chStarts();
  main.innerHTML = `<section class="band"><div class="wrap"><p class="kicker">One story, connected</p><h1>The cross-reference rainbow</h1>
    <p class="lead">Every bar along the bottom is one of the 1,189 chapters of the Bible. Every arc joins two chapters that quote or echo each other: the 7,000 strongest of 340,000 links. Tap anywhere along the bar to see a chapter's connections.</p>
    <div class="rbwrap"><canvas id="rbc" role="img" aria-label="Arcs connecting chapters of the Bible that refer to each other"></canvas></div>
    <div class="linkrow small muted"><span>Genesis</span><span class="grow"></span><span>Malachi | Matthew</span><span class="grow"></span><span>Revelation</span></div><div id="rbinfo"><p class="muted">Loading the connections…</p></div>
    <p class="small muted">Cross-references: OpenBible.info (CC BY). Inspired by Chris Harrison and Christoph Römhild's visualisation.</p></div></section>`;
  let arcs; try { const r = await fetch(xrefBase() + 'arcs.json'); if (!r.ok) throw 0; arcs = await r.json(); } catch { $('#rbinfo').innerHTML = '<p class="empty">The connection data is not available yet.</p>'; return; }
  const cv = $('#rbc'), ctx = cv.getContext('2d'); const bookOf = g => { let i = st.length - 1; while (st[i] > g) i--; return i; }; let sel = -1;
  const draw = () => { const W = cv.clientWidth, H = Math.round(W * 0.5), dpr = devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const base = H - 14, x = g => (g + 0.5) / total * W, mx = Math.max(...arcs.map(a => a[2]));
    ctx.lineWidth = 0.6;
    for (const [a, z, w] of arcs) { const on = sel >= 0 && (a === sel || z === sel); if (sel >= 0 && !on) continue; const d = Math.abs(z - a) / total; ctx.strokeStyle = `hsla(${Math.round(280 - d * 280)},95%,${on ? 70 : 58}%,${on ? 0.9 : Math.min(0.55, 0.08 + w / mx)})`; const xa = x(a), xz = x(z), r = Math.abs(xz - xa) / 2; ctx.beginPath(); ctx.arc((xa + xz) / 2, base, r, Math.PI, 0); ctx.stroke(); }
    if (sel >= 0) { ctx.globalAlpha = .12; for (const [a, z, w] of arcs) { if (a === sel || z === sel) continue; } ctx.globalAlpha = 1; }
    conc.starts.forEach((b, i) => { ctx.fillStyle = i < 39 ? (i % 2 ? '#0e7f9a' : '#16b6d8') : (i % 2 ? '#c99a1e' : '#ffc72c'); for (let c = 0; c < b.counts.length; c++) { const g = st[i] + c; const h = 4 + Math.min(10, b.counts[c] / 8); ctx.fillRect(x(g) - W / total / 2, base + 2, Math.max(1, W / total - 0.2), h); } });
    if (sel >= 0) { ctx.fillStyle = '#fff'; ctx.fillRect(x(sel) - 1.5, base - 6, 3, 22); } };
  const name = g => { const i = bookOf(g); return `${conc.starts[i].name} ${g - st[i] + 1}`; }, code = g => { const i = bookOf(g); return `${conc.starts[i].code}.${g - st[i] + 1}`; };
  const pick = g => { sel = g; draw(); const links = arcs.filter(a => a[0] === g || a[1] === g).map(a => [a[0] === g ? a[1] : a[0], a[2]]).sort((p, q) => q[1] - p[1]);
    $('#rbinfo').innerHTML = `<h2>${esc(name(g))}</h2><p class="small muted">${links.length ? `Strongest connections (${links.length}):` : 'No strong connections in the top 7,000 — try a nearby chapter.'}</p><div class="chips">${links.slice(0, 24).map(([o]) => `<button class="chip" data-go="read-${code(o)}">${esc(name(o))}</button>`).join('')}</div><div class="linkrow"><button class="btn sm" data-go="read-${code(g)}">Read ${esc(name(g))}</button></div>`; };
  cv.onclick = e => { const r = cv.getBoundingClientRect(); pick(Math.max(0, Math.min(total - 1, Math.floor((e.clientX - r.left) / r.width * total)))); };
  draw(); addEventListener('resize', draw, { once: true }); $('#rbinfo').innerHTML = '<p class="muted">Tap the coloured bar or an arc\'s end to explore. Blue = Old Testament, gold = New Testament.</p>';
}
function xrefBase() { return 'data/xrefs/'; }
function writtenYear(dt) { const seg = String(dt).split('(')[0]; const m = seg.match(/(\d{1,4})/); if (!m) return null; const n = +m[1]; return /BC/.test(seg) ? -n : n; }
function writtenLine(i) { const x = BINTRO[i]; if (!x) return ''; return `<p class="small muted wline">✍ Written ${esc(x[2].split('(')[0].trim())} · ${esc(x[1])} · to ${esc(x[3])} <button class="inl" data-go="written">When was each book written?</button></p>`; }
function viewWritten() {
  setNav('study'); document.title = 'When was each book written? — Just One More Lord';
  const rows = BINTRO.map((x, i) => ({ i, n: x[0], au: x[1], dt: x[2], to: x[3], y: writtenYear(x[2]) })).filter(r => r.y != null).sort((a, b) => a.y - b.y);
  const lo = Math.min(...rows.map(r => r.y)), hi = Math.max(...rows.map(r => r.y)); const pct = y => ((y - lo) / (hi - lo) * 100).toFixed(2);
  main.innerHTML = `<section class="band"><div class="wrap"><p class="kicker">The story behind the books</p><h1>When was each book written?</h1>
    <p class="lead">All 66 books in the order they were probably written, from Moses to John on Patmos, about 1,500 years by some 40 authors, one message: Jesus. Dates are approximate and follow common evangelical reference works; scholars debate many of them.</p>
    <div class="wtl">${rows.map(r => `<button class="wrow" data-go="books-${r.i}"><span class="wn">${esc(r.n)}</span><span class="wbar"><i style="left:${pct(r.y)}%" class="${r.i < 39 ? 'ot' : 'nt'}"></i></span><span class="wd">${esc(r.dt.split('(')[0].trim())}</span></button>`).join('')}</div>
    <div class="linkrow small muted"><span>${Math.abs(lo)} BC</span><span class="grow"></span><span>AD ${hi}</span></div></div></section>`;
}
function viewProgress() {
  setNav('library'); document.title = 'My Bible progress — Just One More Lord'; const read = MY.readCh || {};
  const isRead = (b, c) => !!(read[`${b.name} ${c}`] || (b.name === 'Psalms' && read[`Psalm ${c}`])); let done = 0, total = 0;
  const html = conc.starts.map(b => { let k = 0; const cells = b.counts.map((_, c) => { const r = isRead(b, c + 1); total++; if (r) { done++; k++; } return `<button class="pc${r ? ' on' : ''}" data-go="read-${b.code}.${c + 1}" aria-label="${esc(b.name)} ${c + 1}${r ? ', read' : ''}"></button>`; }).join('');
    return `<div class="pbook${k === b.counts.length ? ' full' : ''}"><div class="pbh"><b>${esc(b.name)}</b><span>${k}/${b.counts.length}</span></div><div class="pcells">${cells}</div></div>`; }).join('');
  main.innerHTML = `<section class="band"><div class="wrap"><p class="kicker">Every chapter you have read</p><h1>My Bible progress</h1>
    <div class="statrow"><div><b>${done}</b><span>of ${total} chapters</span></div><div><b>${(done / total * 100).toFixed(1)}%</b><span>of the Bible</span></div><div><b>${conc.starts.filter(b => b.counts.every((_, c) => isRead(b, c + 1))).length}</b><span>books finished</span></div></div>
    <p class="small muted">Each square is a chapter; it lights up when you open it in the Bible reader. Tap any square to read it.</p><div class="pgrid">${html}</div></div></section>`;
}

/* ---------- community: profile pictures, friends & online status, testimonies, church finder, prayer partners, live group reading ---------- */
const needSQL = e => /does not exist|Could not find|schema cache|404/i.test(e?.message || '') ? 'This part is not switched on yet: the site owner needs to run supabase/community.sql in Supabase.' : (e?.message || 'Something went wrong');
const isOnline = t => t && Date.now() - new Date(t).getTime() < 150000;
const agoTxt = t => { if (!t) return ''; const m = Math.round((Date.now() - new Date(t)) / 6e4); return m < 2 ? 'online now' : m < 60 ? `active ${m} min ago` : m < 1440 ? `active ${Math.round(m / 60)} h ago` : `active ${new Date(t).toLocaleDateString()}`; };
function avatarHTML(url, name, size = 44, online = null) { const ini = esc(String(name || '?').trim()[0]?.toUpperCase() || '?');
  return `<span class="av" style="--av:${size}px">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : `<b>${ini}</b>`}${online == null ? '' : `<i class="dot${online ? ' on' : ''}" title="${online ? 'Online' : 'Offline'}"></i>`}</span>`; }
const rpc = (fn, body = {}) => sbFetch('/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(body) });
let beatOff = false;
async function heartbeat() { if (beatOff || document.hidden || !sbOn() || !signedIn() || !navigator.onLine) return; try { await rpc('touch_online'); } catch (e) { if (e.status === 404) beatOff = true; } }
setTimeout(heartbeat, 5000); setInterval(heartbeat, 60000); document.addEventListener('visibilitychange', () => { if (!document.hidden) heartbeat(); });
async function resizeImage(file, max = 320) { const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(file); });
  const sz = Math.min(img.width, img.height), cv = document.createElement('canvas'); cv.width = cv.height = max; cv.getContext('2d').drawImage(img, (img.width - sz) / 2, (img.height - sz) / 2, sz, sz, 0, 0, max, max);
  return new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.86)); }
async function uploadAvatar(file) { const blob = await resizeImage(file); const uid = AUTH.user.id; if (AUTH.exp && Date.now() > AUTH.exp - 60000) await sbRefresh();
  const r = await fetch(`${SB.url.replace(/\/$/, '')}/storage/v1/object/avatars/${uid}.jpg`, { method: 'POST', headers: { apikey: SB.anonKey, Authorization: 'Bearer ' + AUTH.access, 'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'cache-control': '3600' }, body: blob });
  if (!r.ok) { const t = await r.text(); throw new Error(/bucket not found/i.test(t) ? 'does not exist' : (t.slice(0, 160) || 'Upload failed')); }
  const url = `${SB.url.replace(/\/$/, '')}/storage/v1/object/public/avatars/${uid}.jpg?v=${Date.now()}`;
  await sbFetch(`/rest/v1/profiles?id=eq.${uid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ avatar_url: url }) });
  AUTH.profile = { ...AUTH.profile, avatar: url }; saveAuth(); $('#meBtn')?.remove(); profileBtn(); return url; }
const _viewProfile = viewProfile;
viewProfile = function () { _viewProfile(); if (!sbOn() || !signedIn() || !$('#pf')) return; const pr = AUTH.profile || {};
  $('.sh', main)?.insertAdjacentHTML('afterbegin', `<label class="avedit" title="Change profile picture">${avatarHTML(pr.avatar, pr.name || MY.name, 96, true)}<span class="btn ghost sm">📷 ${pr.avatar ? 'Change' : 'Add'} photo</span><input type="file" id="avf" accept="image/*" hidden></label>`);
  $('#pf').insertAdjacentHTML('afterend', `<div class="panel"><h2>Friends</h2><p class="small muted">Your friend code: <b class="fcode" id="myfc">${esc(pr.code || '…')}</b> — share it so friends can add you.</p>
    <label class="tog"><input type="checkbox" id="pon" ${pr.online !== false ? 'checked' : ''}> Show friends when I am online</label>
    <label>Prayer focus this week (friends and your prayer partner see it)<textarea id="pfoc" rows="2" maxlength="300" placeholder="e.g. My mom's health, a new job">${esc(pr.focus || '')}</textarea></label>
    <div class="linkrow"><button class="btn sm" id="pexs">Save</button><button class="btn ghost sm" data-go="friends">My friends</button></div></div>`);
  $('#avf').onchange = async e => { const f = e.target.files[0]; if (!f) return; toast('Uploading your photo…'); try { await uploadAvatar(f); toast('Profile picture updated'); viewProfile(); } catch (er) { toast(needSQL(er)); } };
  const saveEx = async (quiet) => { try { const code = await rpc('set_my_extras', { p_show_online: $('#pon').checked, p_prayer_focus: $('#pfoc').value.trim() }); AUTH.profile = { ...AUTH.profile, online: $('#pon').checked, focus: $('#pfoc').value.trim(), code: code || AUTH.profile.code }; saveAuth(); if (code) $('#myfc').textContent = code; if (!quiet) toast('Saved'); } catch (er) { if (!quiet) toast(needSQL(er)); } };
  $('#pexs').onclick = () => saveEx(); $('#pon').onchange = () => saveEx(true); if (!pr.code) saveEx(true);
};
function signInFirst(what) { main.innerHTML = `<section class="band"><div class="wrap quizwrap"><h1>${esc(what)}</h1><p class="lead">Create a free profile or sign in to use this.</p><button class="btn" data-go="profile">Sign in or sign up</button></div></section>`; }
let friendsTimer = null;
async function viewFriends() {
  setNav('community'); document.title = 'Friends — Just One More Lord'; clearInterval(friendsTimer); if (!sbOn() || !signedIn()) return signInFirst('Friends');
  const pr = AUTH.profile || {};
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Grow together</p><h1>Friends</h1><p>See who is online, what they are praying about, and encourage each other.</p></div></div>
    <div class="commgrid"><div class="panel"><h2>Add a friend</h2><form class="filters" id="faf"><input id="fcode" maxlength="6" placeholder="Their 6-letter code" style="flex:1;text-transform:uppercase" aria-label="Friend code"><button class="btn sm">Add</button></form>
      <p class="small muted">Your code: <b class="fcode">${esc(pr.code || '— open your profile once')}</b> <button class="inl" id="fshare">Share my code</button></p></div>
      <div class="panel"><h2>Your status</h2><div class="linkrow">${avatarHTML(pr.avatar, pr.name || MY.name, 44, pr.online !== false)}<span>${pr.online !== false ? 'Friends can see when you are online.' : 'You are hidden (offline to friends).'}</span></div><div class="linkrow"><button class="btn ghost sm" data-go="profile">Change photo or status</button></div></div></div>
    <div id="flist"><p class="muted"><span class="spin"></span>Loading friends…</p></div></div></section>`;
  $('#fshare').onclick = () => shareIt({ title: 'Add me on Just One More Lord', text: `Add me as a friend on Just One More Lord — my friend code is ${pr.code}. Open the app → Community → Friends.`, hash: 'friends' });
  $('#faf').onsubmit = async e => { e.preventDefault(); const c = $('#fcode').value.trim(); if (c.length < 6) return; try { const n = await rpc('add_friend', { p_code: c }); toast(`Friend request sent to ${n}`); $('#fcode').value = ''; load(); } catch (er) { toast(needSQL(er)); } };
  const load = async () => { if (!$('#flist')) { clearInterval(friendsTimer); return; } let rows; try { rows = await rpc('my_friends'); } catch (er) { $('#flist').innerHTML = `<p class="empty">${esc(needSQL(er))}</p>`; clearInterval(friendsTimer); return; }
    const inc = rows.filter(r => r.status === 'pending' && r.incoming), out = rows.filter(r => r.status === 'pending' && !r.incoming), acc = rows.filter(r => r.status === 'accepted').sort((a, b) => (isOnline(b.last_seen) - isOnline(a.last_seen)) || String(b.last_seen || '').localeCompare(String(a.last_seen || '')));
    const on = acc.filter(r => isOnline(r.last_seen)).length;
    $('#flist').innerHTML = `${inc.length ? `<h2 class="libh">Friend requests</h2><div class="rlist">${inc.map(r => `<div class="ritem fr">${avatarHTML(r.avatar_url, r.name, 44)}<div><b>${esc(r.name)}</b><span>${esc(r.church || 'wants to be your friend')}</span></div><span class="linkrow"><button class="btn sm" data-acc="${r.id}">Accept</button><button class="btn ghost sm" data-dec="${r.id}">Decline</button></span></div>`).join('')}</div>` : ''}
      <h2 class="libh">My friends (${acc.length}) · <span class="onl">${on} online</span></h2>${acc.length ? `<div class="rlist">${acc.map(r => `<div class="ritem fr">${avatarHTML(r.avatar_url, r.name, 48, isOnline(r.last_seen))}<div><b>${esc(r.name)}</b><span>${esc(r.last_seen ? agoTxt(r.last_seen) : 'status hidden')}${r.church ? ' · ' + esc(r.church) : ''}</span>${r.prayer_focus ? `<span class="pfoc">🙏 ${esc(r.prayer_focus)}</span>` : ''}</div><button class="inl small" data-rm="${r.id}" aria-label="Remove ${esc(r.name)}">remove</button></div>`).join('')}</div>` : '<p class="empty">No friends yet — share your code or add theirs above.</p>'}
      ${out.length ? `<h2 class="libh">Waiting for them to accept</h2><div class="chips">${out.map(r => `<span class="chip">${esc(r.name)}</span>`).join('')}</div>` : ''}`; };
  $('#flist').onclick = async e => { const a = e.target.closest('[data-acc],[data-dec],[data-rm]'); if (!a) return; try {
      if (a.dataset.acc) { await rpc('respond_friend', { p_other: a.dataset.acc, p_accept: true }); toast('Friend added'); }
      else if (a.dataset.dec) await rpc('respond_friend', { p_other: a.dataset.dec, p_accept: false });
      else if (confirm('Remove this friend?')) { const o = a.dataset.rm, me = AUTH.user.id; await sbFetch(`/rest/v1/friendships?or=(and(requester.eq.${me},addressee.eq.${o}),and(requester.eq.${o},addressee.eq.${me}))`, { method: 'DELETE' }); }
      load(); } catch (er) { toast(needSQL(er)); } };
  await load(); friendsTimer = setInterval(load, 30000);
}
async function viewTestimonies() {
  setNav('community'); document.title = 'Testimonies — Just One More Lord'; if (!sbOn()) return signInFirst('Testimonies');
  main.innerHTML = `<section class="band"><div class="wrap"><p class="kicker">What God has done</p><h1>Testimonies</h1><p class="lead">"They overcame him by the blood of the Lamb and by the word of their testimony" (Revelation 12:11). Share answered prayers, healings and God's goodness.</p>
    <div class="linkrow"><button class="btn ghost sm" data-go="stories">🙌 Healing testimonies from Andrew Wommack Ministries</button></div>
    ${signedIn() ? `<form class="panel authform" id="tf"><label>What kind?<select id="tk">${['answered prayer', 'healing', 'salvation', 'provision', 'other'].map(k => `<option>${k}</option>`).join('')}</select></label><label>Your testimony<textarea id="tt" rows="4" minlength="10" maxlength="1200" required placeholder="Share what God did…"></textarea></label><button class="btn">Share testimony</button><p class="small muted">Shown with your name and photo. Please keep other people's private details out.</p></form>` : '<div class="linkrow"><button class="btn" data-go="profile">Sign in to share yours</button></div>'}
    <div class="chips" id="tfilt"><button class="chip on" data-k="">All</button>${['answered prayer', 'healing', 'salvation', 'provision'].map(k => `<button class="chip" data-k="${k}">${k}</button>`).join('')}</div><div id="tlist"><p class="muted"><span class="spin"></span>Loading…</p></div></div></section>`;
  let kind = '';
  const load = async () => { try { const rows = await sbFetch(`/rest/v1/testimonies?select=id,user_id,name,avatar_url,kind,text,created_at&order=created_at.desc&limit=100${kind ? '&kind=eq.' + encodeURIComponent(kind) : ''}`, {}, signedIn());
      $('#tlist').innerHTML = rows.length ? rows.map(t => `<article class="tcard">${avatarHTML(t.avatar_url, t.name, 42)}<div><p class="kicker">${esc(t.kind)} · ${new Date(t.created_at).toLocaleDateString()}</p><p>${esc(t.text)}</p><span class="small muted">— ${esc(t.name || 'A believer')}</span>
        <div class="linkrow"><button class="inl small" data-praise="${t.id}">🙌 Praise God</button>${signedIn() && t.user_id === AUTH.user.id ? `<button class="inl small" data-tdel="${t.id}">delete</button>` : signedIn() ? `<button class="inl small" data-trep="${t.id}">report</button>` : ''}</div></div></article>`).join('') : '<p class="empty">No testimonies yet — be the first to share.</p>'; }
    catch (er) { $('#tlist').innerHTML = `<p class="empty">${esc(needSQL(er))}</p>`; } };
  $('#tfilt').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; $$('#tfilt .chip').forEach(x => x.classList.toggle('on', x === b)); load(); };
  $('#tf')?.addEventListener('submit', async e => { e.preventDefault(); try { await sbFetch('/rest/v1/testimonies', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: AUTH.user.id, name: AUTH.profile?.name || MY.name || 'A believer', avatar_url: AUTH.profile?.avatar || null, kind: $('#tk').value, text: $('#tt').value.trim() }) }); $('#tt').value = ''; toast('Thank you for sharing!'); load(); } catch (er) { toast(needSQL(er)); } });
  $('#tlist').onclick = async e => { const b = e.target.closest('[data-praise],[data-tdel],[data-trep]'); if (!b) return;
    if (b.dataset.praise) { b.textContent = '🙌 Amen!'; b.disabled = true; return; }
    try { if (b.dataset.tdel && confirm('Delete your testimony?')) { await sbFetch(`/rest/v1/testimonies?id=eq.${b.dataset.tdel}`, { method: 'DELETE' }); load(); }
      else if (b.dataset.trep && confirm('Report this testimony as inappropriate?')) { await rpc('report_testimony', { p_id: b.dataset.trep }); toast('Thank you — it will be reviewed'); b.remove(); } } catch (er) { toast(needSQL(er)); } };
  load();
}
async function viewChurches() {
  setNav('community'); document.title = 'Church finder — Just One More Lord'; if (!sbOn()) return signInFirst('Church finder');
  main.innerHTML = `<section class="band"><div class="wrap"><p class="kicker">Find a home church</p><h1>Grace church finder</h1><p class="lead">Churches that preach the finished work of Jesus and the love of God, added by members of the app.</p>
    <div class="mapbox" id="chmap" style="height:380px"></div><div class="linkrow"><button class="btn sm" id="chnear">📍 Sort by nearest to me</button><input id="chq" type="search" placeholder="Filter by name or city" style="flex:1;min-width:160px" aria-label="Filter churches"></div><div class="rlist" id="chlist"><p class="muted"><span class="spin"></span>Loading…</p></div>
    ${signedIn() ? `<details class="panel" style="margin-top:18px"><summary><h2 style="display:inline">Add a church</h2></summary><form class="authform" id="chf"><label>Church name<input id="cn" required maxlength="100"></label><label>Street address or area (to find it on the map)<input id="ca" required maxlength="160" placeholder="e.g. 1 Wincanton Way, Umhlanga"></label><label>Website (optional)<input id="cw" type="url" maxlength="200"></label><label>About (optional)<textarea id="cab" rows="2" maxlength="400" placeholder="Pastors, service times…"></textarea></label><button class="btn">Find on map and add</button><p class="small" id="chmsg"></p></form></details>` : '<div class="linkrow"><button class="btn ghost" data-go="profile">Sign in to add your church</button></div>'}
    <p class="small muted">Locations found with OpenStreetMap Nominatim. Report anything that is not a church and it will be hidden.</p></div></section>`;
  let rows = [], me = null;
  const dist = r => me ? Math.hypot(r.lat - me.lat, (r.lng - me.lon) * Math.cos(me.lat * Math.PI / 180)) * 111 : null;
  const list = () => { const q = norm($('#chq').value); const rs = rows.filter(r => !q || norm(`${r.name} ${r.city} ${r.country}`).includes(q)).sort((a, b) => me ? dist(a) - dist(b) : a.name.localeCompare(b.name));
    $('#chlist').innerHTML = rs.map(r => `<div class="ritem"><div><b>${esc(r.name)}</b><span>${esc([r.city, r.country].filter(Boolean).join(', '))}${me ? ` · ${Math.round(dist(r))} km` : ''}</span>${r.about ? `<span>${esc(r.about)}</span>` : ''}</div><span class="linkrow">${r.website ? `<a class="btn ghost sm" href="${esc(r.website)}" target="_blank" rel="noopener">Website</a>` : ''}<a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=16/${r.lat}/${r.lng}">Map</a>${signedIn() ? `<button class="inl small" data-crep="${r.id}">report</button>` : ''}</span></div>`).join('') || '<p class="empty">No churches yet — add yours.</p>'; };
  const load = async () => { try { rows = await sbFetch('/rest/v1/churches?select=*&order=name&limit=1000', {}, signedIn()); } catch (er) { $('#chlist').innerHTML = `<p class="empty">${esc(needSQL(er))}</p>`; return; }
    $('#chmap').innerHTML = ''; if (rows.length) makeMap($('#chmap'), { markers: rows.map(r => ({ lat: r.lat, lon: r.lng, label: r.name, sub: r.city || '', kind: 'main' })), maxZoom: 12 }); else $('#chmap').remove(); list(); };
  $('#chq').oninput = list;
  $('#chnear').onclick = () => navigator.geolocation?.getCurrentPosition(p => { me = { lat: p.coords.latitude, lon: p.coords.longitude }; list(); }, () => toast('Location was not allowed'));
  $('#chlist').onclick = async e => { const b = e.target.closest('[data-crep]'); if (b && confirm('Report this listing?')) { try { await rpc('report_church', { p_id: b.dataset.crep }); toast('Thank you'); b.remove(); } catch (er) { toast(needSQL(er)); } } };
  $('#chf')?.addEventListener('submit', async e => { e.preventDefault(); const m = $('#chmsg'); m.textContent = 'Finding the address…';
    try { const g = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=' + encodeURIComponent($('#ca').value.trim()))).json(); if (!g[0]) { m.textContent = 'That address could not be found — try adding the city and country.'; return; }
      const ad = g[0].address || {}; await sbFetch('/rest/v1/churches', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ name: $('#cn').value.trim(), city: ad.city || ad.town || ad.suburb || ad.village || '', country: ad.country || '', lat: +g[0].lat, lng: +g[0].lon, website: $('#cw').value.trim() || null, about: $('#cab').value.trim() || null, added_by: AUTH.user.id }) });
      m.textContent = 'Added — thank you!'; e.target.reset(); load(); } catch (er) { m.textContent = needSQL(er); } });
  load();
}
async function viewPartner() {
  setNav('community'); document.title = 'Prayer partner — Just One More Lord'; if (!sbOn() || !signedIn()) return signInFirst('Prayer partner');
  main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Pray for one another (James 5:16)</p><h1>Prayer partner</h1><p class="lead">Each week you are paired with another believer using the app. You each see the other's prayer focus and pray for them during the week.</p><div id="ppbox"><p class="muted"><span class="spin"></span>Loading…</p></div></div></section>`;
  const show = async join => { try { const r = (await rpc('prayer_partner', { p_join: !!join }))?.[0] || {};
      $('#ppbox').innerHTML = r.id ? `<div class="panel ppcard">${avatarHTML(r.avatar_url, r.name, 80)}<div><p class="kicker">This week's partner</p><h2>${esc(r.name)}</h2><p>${r.prayer_focus ? '🙏 ' + esc(r.prayer_focus) : '<span class="muted">They have not shared a prayer focus yet — pray for God\'s love and peace over them.</span>'}</p></div></div>
          <div class="panel"><h2>Your prayer focus</h2><p class="small muted">${AUTH.profile?.focus ? esc(AUTH.profile.focus) : 'You have not shared one yet.'}</p><button class="btn ghost sm" data-go="profile">Change it</button></div><p class="small muted">A new partner is matched each Monday.</p>`
        : r.waiting ? `<div class="panel"><h2>Finding you a partner…</h2><p>You are in the queue. As soon as someone else joins this week, you will be paired. Check back soon.</p><button class="btn ghost sm" data-go="profile">Set your prayer focus</button></div>`
        : `<div class="panel"><h2>Get a prayer partner this week</h2><p class="small muted">Your name, photo and prayer focus will be shared with your partner.</p><button class="btn" id="ppjoin">Find me a prayer partner</button></div>`;
      $('#ppjoin')?.addEventListener('click', () => show(true)); } catch (er) { $('#ppbox').innerHTML = `<p class="empty">${esc(needSQL(er))}</p>`; } };
  show(false);
}
let liveTimer = null;
async function viewLive(gid) {
  setNav('community'); clearInterval(liveTimer); if (!sbOn() || !signedIn()) return signInFirst('Live reading'); await loadConc();
  const [code, ch] = (sessionStorage.getItem('jom:live:' + gid) || MY.last || 'Jhn.1').split('.'); const b = conc.byCode[code] || conc.byCode.Jhn; const c = Math.min(+ch || 1, b.counts.length); const ref = `${b.name} ${c}`;
  document.title = `Live reading · ${ref} — Just One More Lord`;
  main.innerHTML = `<section class="band"><div class="wrap"><div class="crumbs"><button data-go="group-${gid}">Back to the group</button> › Live reading</div><h1>📖 Live reading <span class="neon-txt">${esc(ref)}</span></h1>
    <div class="readbar"><select id="lbk" aria-label="Book">${conc.starts.map(x => `<option value="${x.code}"${x.code === b.code ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select><select id="lch" aria-label="Chapter">${b.counts.map((_, i) => `<option${i + 1 === c ? ' selected' : ''}>${i + 1}</option>`).join('')}</select><button class="btn ghost sm" id="lshare">${ICON.share} Invite the group</button></div>
    <div class="livegrid"><article class="reader" id="ltext"><p class="muted"><span class="spin"></span>Loading…</p></article>
      <aside class="panel livechat"><h2>Group chat</h2><div id="lmsgs" aria-live="polite"></div><form class="filters" id="lf"><input id="lin" maxlength="400" placeholder="Share a thought on ${esc(ref)}…" style="flex:1" aria-label="Message"><button class="btn sm">Send</button></form><p class="small muted">Tap a verse to quote it. Messages refresh every few seconds.</p></aside></div></div></section>`;
  const setCh = (k, n) => { sessionStorage.setItem('jom:live:' + gid, `${k}.${n}`); viewLive(gid); };
  $('#lbk').onchange = e => setCh(e.target.value, 1); $('#lch').onchange = e => setCh(b.code, e.target.value);
  $('#lshare').onclick = () => shareIt({ title: 'Read with us live', text: `We are reading ${ref} together now — open Just One More Lord → Community → Church groups → Live reading.`, hash: 'live-' + gid });
  try { const v = await bibleText(ref); $('#ltext').innerHTML = v.verses.map(x => `<span class="rverse" data-q="${x.v}"><sup>${x.v}</sup>${esc(x.t)} </span>`).join(''); } catch { $('#ltext').innerHTML = '<p class="empty">The chapter text could not be loaded.</p>'; }
  $('#ltext').onclick = e => { const v = e.target.closest('[data-q]'); if (v) { $('#lin').value = `(${b.name} ${c}:${v.dataset.q}) ` + $('#lin').value; $('#lin').focus(); } };
  let last = 0; const me = AUTH.user.id;
  const pull = async () => { if (!$('#lmsgs')) { clearInterval(liveTimer); return; } try { const rows = await sbFetch(`/rest/v1/group_live?group_id=eq.${gid}&id=gt.${last}&select=id,user_id,name,ref,text,created_at&order=id.asc&limit=100`);
      if (rows.length) { last = rows[rows.length - 1].id; const box = $('#lmsgs'); box.insertAdjacentHTML('beforeend', rows.map(m => `<div class="lmsg${m.user_id === me ? ' mine' : ''}"><b>${esc(m.name || 'Member')}</b><span class="small muted"> · ${esc(m.ref || '')} · ${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><p>${esc(m.text)}</p></div>`).join('')); box.scrollTop = box.scrollHeight; } }
    catch (er) { $('#lmsgs').innerHTML = `<p class="empty">${esc(needSQL(er))}</p>`; clearInterval(liveTimer); } };
  $('#lf').onsubmit = async e => { e.preventDefault(); const t = $('#lin').value.trim(); if (!t) return; $('#lin').value = ''; try { await sbFetch('/rest/v1/group_live', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ group_id: gid, user_id: me, name: AUTH.profile?.name || MY.name || 'Member', ref, text: t }) }); pull(); } catch (er) { toast(needSQL(er)); } };
  await pull(); liveTimer = setInterval(() => { if (!document.hidden) pull(); }, 4000);
}

/* ---------- engagement: my year in the Word, Bible journaling, the Grace minute ---------- */
async function shareBlob(blob, name, text) { const f = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }
function yearStats(y) {
  const inY = t => t && new Date(t).getFullYear() === y; const ys = String(y);
  const ch = Object.entries(MY.readCh || {}).filter(([, t]) => inY(t)); const books = {}; ch.forEach(([k]) => { const b = k.replace(/\s+\d+$/, ''); books[b] = (books[b] || 0) + 1; });
  const top = Object.entries(books).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const days = Object.keys(MY.days || {}).filter(d => d.startsWith(ys)).sort(); let best = 0, run = 0, prev = null;
  for (const d of days) { const t = new Date(d + 'T12:00:00'); run = prev && (t - prev) / 864e5 < 1.5 ? run + 1 : 1; best = Math.max(best, run); prev = t; }
  const vs = Object.entries(MY.verses || {}).filter(([, x]) => inY(x.d)).sort((a, b) => b[1].d - a[1].d);
  return { y, chapters: ch.length, days: days.length, best, top, verses: vs.length, fav: vs[0]?.[0] || Object.keys(MY.hl || {})[0] || '', notes: Object.values(MY.notes || {}).filter(x => inY(x.d)).length,
    prayers: (MY.prayers || []).filter(p => inY(p.d)).length, answered: (MY.prayers || []).filter(p => p.a && inY(p.a === true ? p.d : p.a)).length, badges: Object.values(MY.badges || {}).filter(inY).length, places: Object.values(MY.visited || {}).filter(inY).length };
}
function viewWrapped(y) {
  setNav('library'); y = +y || new Date().getFullYear(); const st = yearStats(y); document.title = `My ${y} in the Word — Just One More Lord`;
  const card = (big, l, sub = '') => `<div class="wcard"><b>${big}</b><span>${l}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
  main.innerHTML = `<section class="band wrappedband"><div class="wrap"><p class="kicker">Your year with God's Word</p><h1>My <span class="neon-txt">${y}</span> in the Word</h1>
    <p class="lead">"Your word is a lamp to my feet and a light for my path" (Psalm 119:105).</p>
    <div class="wgrid">${card(st.chapters, 'chapters read', st.chapters ? `${(st.chapters / 1189 * 100).toFixed(1)}% of the Bible` : 'Open any chapter to start')}${card(st.days, 'days in the Word')}${card('🔥 ' + st.best, 'longest streak (days)')}
      ${card(st.top[0] ? esc(st.top[0][0]) : '—', 'most-read book', st.top.slice(1).map(x => esc(x[0])).join(' · '))}${card(st.verses, 'verses saved', st.fav ? esc(st.fav) : '')}${card(st.notes, 'notes written')}${card(st.prayers, 'prayers written', st.answered ? `${st.answered} answered 🙌` : '')}${card(st.badges, 'badges earned')}${card(st.places, 'Bible places explored')}</div>
    <div class="linkrow"><button class="btn" id="wshare">${ICON.share} Share my year</button><button class="btn ghost" data-go="progress">My Bible progress map</button>${[y - 1, y + 1].filter(v => v <= new Date().getFullYear() && v >= 2025).map(v => `<button class="btn ghost sm" data-go="wrapped-${v}">${v}</button>`).join('')}</div></div></section>`;
  $('#wshare').onclick = async () => { const c = document.createElement('canvas'); c.width = 1080; c.height = 1350; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1080, 1350); g.addColorStop(0, '#032433'); g.addColorStop(.6, '#05141c'); g.addColorStop(1, '#3a2a06'); x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
    const lg = new Image(); lg.src = 'img/logo.png'; await new Promise(r => { lg.onload = r; lg.onerror = r; }); if (lg.width) x.drawImage(lg, 440, 50, 200, 200 * lg.height / lg.width);
    x.textAlign = 'center'; x.fillStyle = '#8ae8ff'; x.font = '700 40px Sora, sans-serif'; x.fillText('MY YEAR IN THE WORD', 540, 330); x.fillStyle = '#ffc72c'; x.font = '800 150px Sora, sans-serif'; x.fillText(String(y), 540, 480);
    const rows = [[st.chapters, 'chapters read'], [st.days, 'days in the Word'], [st.best, 'day longest streak'], [st.verses, 'verses saved'], [st.prayers, 'prayers prayed']];
    rows.forEach(([n, l], i) => { const yy = 610 + i * 120; x.textAlign = 'right'; x.fillStyle = '#fff'; x.font = '800 86px Sora, sans-serif'; x.fillText(String(n), 470, yy); x.textAlign = 'left'; x.fillStyle = '#cfe7ee'; x.font = '500 46px Sora, sans-serif'; x.fillText(l, 500, yy - 8); });
    x.textAlign = 'center'; if (st.top[0]) { x.fillStyle = '#ffc72c'; x.font = '600 42px Sora, sans-serif'; x.fillText(`Most read: ${st.top[0][0]}`, 540, 1230); }
    x.fillStyle = 'rgba(255,255,255,.8)'; x.font = '600 32px Sora, sans-serif'; x.fillText('Just One More Lord', 540, 1300);
    shareBlob(await new Promise(r => c.toBlob(r, 'image/jpeg', .92)), `my-${y}-in-the-word.jpg`, `My ${y} in the Word — ${SITE}`); };
}
/* journaling: pictures stored on this device (IndexedDB) */
const jdb = () => new Promise((ok, bad) => { const r = indexedDB.open('jom-journal', 1); r.onupgradeneeded = () => r.result.createObjectStore('pages', { keyPath: 'id' }); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
const jtx = async (mode, fn) => { const db = await jdb(); return new Promise((ok, bad) => { const t = db.transaction('pages', mode); const st = t.objectStore('pages'); const res = fn(st); t.oncomplete = () => ok(res?.result); t.onerror = () => bad(t.error); }); };
const JTHEMES = [['Night', ['#032433', '#05141c']], ['Dawn', ['#3a2a06', '#7a4b12']], ['Paper', ['#f6efdf', '#e9dcc0']], ['Ocean', ['#043b4a', '#0a6b80']], ['Rose', ['#3b0d24', '#6d1f43']]];
async function viewJournal(arg) {
  setNav('library'); const ref = decodeURIComponent(arg || '');
  if (!ref) { document.title = 'My Bible journal — Just One More Lord'; let pages = []; try { pages = (await jtx('readonly', st => st.getAll())) || []; } catch {}
    pages.sort((a, b) => b.d - a.d);
    main.innerHTML = `<section class="band"><div class="wrap"><p class="kicker">Draw, write and pray</p><h1>My Bible journal</h1><p class="lead">Tap any verse in the Bible and choose <b>✏️ Journal</b> to draw, add stickers and write on it. Pages are kept on this device.</p>
      <div class="linkrow"><button class="btn" data-go="journal-${encodeURIComponent(votd()?.ref || 'John 3:16')}">Journal today's verse</button></div>
      <div class="jgrid">${pages.map(p => `<figure class="jthumb"><img src="${p.img}" alt="Journal page: ${esc(p.ref)}"><figcaption>${esc(p.ref)} · ${new Date(p.d).toLocaleDateString()} <button class="inl small" data-jshare="${p.id}">share</button> <button class="inl small" data-jdel="${p.id}">delete</button></figcaption></figure>`).join('') || '<p class="empty">No journal pages yet.</p>'}</div></div></section>`;
    main.onclick = async e => { const s = e.target.closest('[data-jshare]'), d = e.target.closest('[data-jdel]');
      if (s) { const p = pages.find(x => x.id === s.dataset.jshare); shareBlob(await (await fetch(p.img)).blob(), 'journal.jpg', p.ref); }
      if (d && confirm('Delete this page?')) { await jtx('readwrite', st => st.delete(d.dataset.jdel)); main.onclick = null; viewJournal(''); } };
    return; }
  main.onclick = null; document.title = `Journal · ${ref} — Just One More Lord`;
  main.innerHTML = `<section class="band"><div class="wrap"><div class="crumbs"><button data-go="journal">My journal</button> › ${esc(ref)}</div><h1>✏️ Journal ${esc(ref)}</h1>
    <div class="jtools"><span class="linkrow" role="group" aria-label="Colour">${['#ffffff', '#ffc72c', '#00d1ff', '#39ff9c', '#ff4d8d', '#111111'].map((c, i) => `<button class="jcol${i ? '' : ' on'}" data-col="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}</span>
      <select id="jsz" aria-label="Pen size"><option value="4">Fine</option><option value="9" selected>Medium</option><option value="18">Thick</option></select>
      <select id="jth" aria-label="Background">${JTHEMES.map(([n], i) => `<option value="${i}">${n}</option>`).join('')}</select>
      <span class="linkrow" role="group" aria-label="Stickers">${['✝️', '🕊️', '❤️', '🙏', '⭐', '🔥', '🌿', '👑'].map(e => `<button class="jst" data-st="${e}" aria-label="Sticker ${e}">${e}</button>`).join('')}</span>
      <button class="btn ghost sm" id="jtxt">Aa Text</button><button class="btn ghost sm" id="jundo">Undo</button><button class="btn ghost sm" id="jclr">Clear</button></div>
    <div class="jwrap"><canvas id="jc" width="1080" height="1350" aria-label="Journal page for ${esc(ref)}"></canvas></div>
    <div class="linkrow"><button class="btn" id="jsave">Save to my journal</button><button class="btn ghost" id="jshare">${ICON.share} Share</button></div><p class="small muted" id="jhint">Draw with your finger. Tap a sticker, then tap the page to place it.</p></div></section>`;
  const cv = $('#jc'), x = cv.getContext('2d'); let col = '#ffffff', sticker = null, text = '', theme = 0; const strokes = [];
  try { const v = await bibleText(ref); text = v.verses.map(y => y.t).join(' ') || v.text; } catch { text = ''; }
  const wrap = (t, maxW) => { const out = []; let line = ''; for (const w of t.split(/\s+/)) { const tl = line ? line + ' ' + w : w; if (x.measureText(tl).width > maxW && line) { out.push(line); line = w; } else line = tl; } if (line) out.push(line); return out; };
  const paint = () => { const [n, [a, b]] = JTHEMES[theme]; const g = x.createLinearGradient(0, 0, 0, 1350); g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
    const dark = n !== 'Paper'; x.fillStyle = dark ? '#ffffff' : '#2a1d08'; x.textAlign = 'center'; x.font = '600 50px "Cormorant Garamond", Georgia, serif';
    const lines = wrap(text ? `“${text}”` : '', 900).slice(0, 12); lines.forEach((l, i) => x.fillText(l, 540, 150 + i * 62)); x.fillStyle = dark ? '#ffc72c' : '#8a5a00'; x.font = '700 40px Sora, sans-serif'; x.fillText(ref, 540, 190 + lines.length * 62);
    x.fillStyle = dark ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.4)'; x.font = '500 26px Sora, sans-serif'; x.fillText('Just One More Lord', 540, 1320);
    for (const s of strokes) { if (s.t === 'st') { x.font = `${s.z}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; x.fillText(s.e, s.x, s.y); continue; }
      if (s.t === 'tx') { x.fillStyle = s.c; x.font = '600 52px Sora, sans-serif'; x.fillText(s.s, s.x, s.y); continue; }
      x.strokeStyle = s.c; x.lineWidth = s.w; x.lineCap = x.lineJoin = 'round'; x.beginPath(); s.p.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py)); x.stroke(); } };
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 1080, (e.clientY - r.top) / r.height * 1350]; };
  let cur = null, pendingText = null;
  cv.onpointerdown = e => { e.preventDefault(); const [px, py] = pos(e);
    if (pendingText) { strokes.push({ t: 'tx', s: pendingText, x: px, y: py, c: col }); pendingText = null; $('#jhint').textContent = 'Draw with your finger. Tap a sticker, then tap the page to place it.'; paint(); return; }
    if (sticker) { strokes.push({ t: 'st', e: sticker, x: px, y: py, z: 110 }); sticker = null; $$('.jst').forEach(b => b.classList.remove('on')); paint(); return; }
    cur = { t: 'ln', c: col, w: +$('#jsz').value * 1.6, p: [[px, py]] }; strokes.push(cur); cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = e => { if (!cur) return; cur.p.push(pos(e)); paint(); }; cv.onpointerup = cv.onpointercancel = () => { cur = null; };
  $$('.jcol').forEach(b => b.onclick = () => { col = b.dataset.col; $$('.jcol').forEach(y => y.classList.toggle('on', y === b)); });
  $$('.jst').forEach(b => b.onclick = () => { sticker = b.dataset.st; $$('.jst').forEach(y => y.classList.toggle('on', y === b)); $('#jhint').textContent = 'Now tap the page where the sticker should go.'; });
  $('#jth').onchange = e => { theme = +e.target.value; paint(); }; $('#jundo').onclick = () => { strokes.pop(); paint(); }; $('#jclr').onclick = () => { strokes.length = 0; paint(); };
  $('#jtxt').onclick = () => { const t = prompt('Text to add (for example a prayer or a word God showed you):'); if (t) { pendingText = t.slice(0, 60); $('#jhint').textContent = 'Now tap the page where the text should go.'; } };
  const blob = () => new Promise(r => cv.toBlob(r, 'image/jpeg', .85));
  $('#jsave').onclick = async () => { const b = await blob(); const img = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    try { await jtx('readwrite', st => st.put({ id: Date.now().toString(36), ref, d: Date.now(), img })); toast('Saved to your journal'); track('journal', ref + ' ' + Date.now()); } catch { toast('Could not save on this device'); } };
  $('#jshare').onclick = async () => shareBlob(await blob(), 'journal.jpg', `${ref} — ${SITE}`);
  if (document.fonts?.ready) await document.fonts.ready; paint();
}
const GRACE_PRAYERS = ['Father, thank you that Jesus finished the work. I rest in what he has already done for me today. Amen.', 'Father, thank you that I am loved and accepted in Jesus, not because of my performance but because of his. Amen.', 'Lord Jesus, thank you that there is no condemnation for me. Fill my heart with your love so that it overflows to others today. Amen.', 'Father, thank you that by his stripes I was healed and in him I have everything I need for life and godliness. Amen.', 'Holy Spirit, show me more of the Father\'s heart through Jesus today. Let grace teach me and strengthen me. Amen.', 'Father, thank you that nothing can separate me from your love. I receive your peace today. Amen.', 'Jesus, thank you that you will never leave me nor forsake me. I trust you with this day. Amen.'];
const GRACE_REFLECT = ['Who is speaking here, and to whom?', 'Is this before or after the cross, and how does that change how you read it?', 'What did Jesus finish or provide in this passage?', 'What does this show you about how the Father sees you?', 'How would you live today if you fully believed this?', 'Is there a lie about God this truth replaces for you?', 'Who could you share this good news with today?'];
function graceMinuteItem(d = dayIndex()) { const all = []; for (const [k, ns] of Object.entries(GRACE.passages)) ns.forEach(n => all.push([k, n])); if (!all.length) return null; const [k, n] = all[((d * 37) % all.length + all.length) % all.length]; const [c, ch] = k.split('.'); return { c, ch: +ch, n, i: ((d % 7) + 7) % 7 }; }
async function viewGraceMinute() {
  setNav('study'); await loadConc(); const it = graceMinuteItem(); if (!it) { go('grace'); return; } const b = conc.byCode[it.c]; const first = String(it.n[0]).split(',')[0].trim(); const ref = `${b.name} ${it.ch}:${first}`;
  document.title = 'Grace minute — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Grace minute · ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>${esc(it.n[1])}</h1>
    <div class="votdcard"><div class="vtext" id="gmv"><span class="spin"></span></div><p class="kicker" style="margin-top:8px">${esc(ref)}</p></div>
    <div class="gnote"><h3>The finished work</h3><p>${esc(it.n[2])}</p></div>
    <div class="panel"><h3>Reflect</h3><p>${esc(GRACE_REFLECT[it.i])}</p><h3>Pray</h3><p><i>${esc(GRACE_PRAYERS[it.i])}</i></p></div>
    <div class="linkrow"><button class="btn" id="gmplay">▶ Listen (1 minute)</button><button class="btn ghost" data-go="read-${b.code}.${it.ch}.${parseInt(first)}">Read the chapter</button><button class="btn ghost" id="gmshare">${ICON.share} Share</button><button class="btn ghost sm" data-go="journal-${encodeURIComponent(ref)}">✏️ Journal it</button></div>
    <p class="small muted">A new Grace minute every day, from the <button class="inl" data-go="grace">Grace lens</button> notes.</p></div></section>`;
  let vt = ''; try { const v = await bibleText(ref); vt = v.verses.map(x => x.t).join(' '); $('#gmv').textContent = vt; } catch { $('#gmv').textContent = ''; }
  track('grace', today());
  $('#gmshare').onclick = () => shareIt({ title: `Grace minute: ${it.n[1]}`, text: `${vt ? `“${vt.slice(0, 180)}” — ${ref}\n\n` : ''}${it.n[2].slice(0, 220)}`, hash: 'grace-minute' });
  $('#gmplay').onclick = () => { if (!('speechSynthesis' in window)) { toast('Listening is not supported on this device'); return; } if (speechSynthesis.speaking) { speechSynthesis.cancel(); $('#gmplay').textContent = '▶ Listen (1 minute)'; return; }
    const u = new SpeechSynthesisUtterance(`${vt} ${ref}. ${it.n[1]}. ${it.n[2]} Reflect: ${GRACE_REFLECT[it.i]} Let's pray. ${GRACE_PRAYERS[it.i]}`); const vv = ttsVoice(); if (vv) u.voice = vv; u.rate = +(localStorage.getItem('jom:rate') || 1);
    u.onend = () => { const b2 = $('#gmplay'); if (b2) b2.textContent = '▶ Listen again'; }; speechSynthesis.speak(u); $('#gmplay').textContent = '❚❚ Stop'; };
}

/* ---------- the gospel of grace, who I am in Christ, healing scriptures ---------- */
const GOSPEL = window.JOM_GOSPEL || { truths: [], identity: [], healing: [] };
const vchips = refs => `<div class="chips">${refs.map(r => `<button class="chip" data-verse="${esc(r)}">${esc(r)}</button>`).join('')}</div>`;
function graceHomeBand() { const it = typeof graceMinuteItem === 'function' ? graceMinuteItem() : null; const idn = GOSPEL.identity.length ? GOSPEL.identity[dayIndex() % GOSPEL.identity.length] : null;
  return `<section class="band graceband"><div class="wrap"><div class="sh"><div><p class="kicker">It is finished</p><h2>You are loved, forgiven and made new</h2><p>This is a grace-based Bible app. Everything here is read in the light of the finished work of Jesus and the love of the Father.</p></div><button class="btn" data-go="gospel">Start here: the gospel of grace</button></div>
    <div class="gcards">${it ? `<button class="gcard" data-go="grace-minute"><span class="kicker">Today's Grace minute</span><b>${esc(it.n[1])}</b><span>A verse, the finished work, a reflection and a prayer.</span></button>` : ''}
      ${idn ? `<button class="gcard" data-go="identity"><span class="kicker">Who you are in Christ</span><b>${esc(idn[0])}</b><span>${esc(idn[1])}</span></button>` : ''}
      <button class="gcard" data-go="receive"><span class="kicker">New here?</span><b>Receive Jesus and the Holy Spirit</b><span>A simple prayer, what happens next, and power for your new life.</span></button>
      <button class="gcard" data-go="miracles"><span class="kicker">Miracles of Jesus</span><b>${(window.JOM_MIRACLES || []).length} miracles on the map</b><span>Where each one happened and what it shows about the Father's heart.</span></button>
      <button class="gcard" data-go="healing"><span class="kicker">Healing scriptures</span><b>By his stripes you were healed</b><span>${GOSPEL.healing.length} promises to read, speak and listen to.</span></button>
      <button class="gcard" data-go="grace"><span class="kicker">Grace lens</span><b>Read every chapter through the cross</b><span>Covenant context and notes on often-misread passages.</span></button>
      <button class="gcard" data-go="teachings"><span class="kicker">Grace teachers</span><b>Andrew Wommack · Dan Mohler · Richard Olivier</b><span>Teaching on the finished work and the love of God.</span></button></div></div></section>`; }
function viewGospel() {
  setNav('gospel'); document.title = 'The gospel of grace — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Start here</p><h1>The gospel of <span class="neon-txt">grace</span></h1>
    <p class="lead">The good news is not what you must do for God. It is what God has already done for you through Jesus. Here are the foundations this app is built on.</p>
    <nav class="toc">${GOSPEL.truths.map((t, i) => `<a href="#gospel" data-jump="gt${i}">${i + 1}. ${esc(t[0])}</a>`).join('')}</nav>
    ${GOSPEL.truths.map((t, i) => `<article class="truth" id="gt${i}"><h2><span>${i + 1}</span>${esc(t[0])}</h2><p>${esc(t[1])}</p>${vchips(t[2])}</article>`).join('')}
    <div class="panel prayerbox"><h2>A prayer to receive Jesus and the Holy Spirit</h2><p><i>${esc(GOSPEL.salvationPrayer)}</i></p><p class="small muted">If you prayed this, you are born again and a new creation. Tell someone, find a grace-teaching church, and start reading the Gospel of John.</p>
      <div class="linkrow"><button class="btn" id="gsaved">I prayed this prayer</button><button class="btn ghost" data-go="receive">What happens next</button><button class="btn ghost" data-go="receive-spirit">Receive the Holy Spirit</button><button class="btn ghost" data-go="churches">Find a church</button><button class="btn ghost" data-go="read-Jhn.1">Read John</button></div></div>
    <div class="panel"><h2>Go deeper</h2><div class="linkrow"><button class="btn" data-go="identity">👑 Who you are in Christ</button><button class="btn" data-go="notes">📝 Teaching notes: grace, faith, healing and more</button><button class="btn ghost" data-go="parables">Parables of Jesus</button><button class="btn ghost" data-go="miracles">Miracles of Jesus</button><button class="btn ghost" data-go="names">Names of God</button></div><p class="small muted">Free teaching from the teachers this app follows:</p>
      <div class="rlist">${[['Andrew Wommack · Spirit, Soul and Body', 'https://www.youtube.com/channel/UC8H3lzJU5Qm-s3WVroB87kw/search?query=spirit%20soul%20and%20body'], ['Andrew Wommack · The True Nature of God', 'https://www.youtube.com/channel/UC8H3lzJU5Qm-s3WVroB87kw/search?query=true%20nature%20of%20god'], ['Andrew Wommack · You\'ve Already Got It', 'https://www.youtube.com/channel/UC8H3lzJU5Qm-s3WVroB87kw/search?query=already%20got%20it'], ['Andrew Wommack · God Wants You Well', 'https://www.youtube.com/channel/UC8H3lzJU5Qm-s3WVroB87kw/search?query=god%20wants%20you%20well'], ['Dan Mohler · identity and the love of God', 'https://www.youtube.com/results?search_query=Dan+Mohler+identity+love+of+God'], ['Richard Olivier · Harvest Church', 'https://www.youtube.com/@harvestchurchza/videos']].map(([t, u]) => `<a class="ritem" href="${u}" target="_blank" rel="noopener"><div><b>${esc(t)}</b><span>YouTube</span></div><span class="tag">Watch</span></a>`).join('')}</div></div>
    <p class="small muted">Written for this app in the spirit of the finished-work grace teaching of Andrew Wommack, Dan Mohler and Richard Olivier; it is not their own wording. Test everything with Scripture (Acts 17:11).</p></div></section>`;
  $$('[data-jump]').forEach(a => a.onclick = e => { e.preventDefault(); $('#' + a.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#gsaved').onclick = () => { markMilestone('jesus'); toast('Welcome to the family of God! Heaven is rejoicing (Luke 15:7).'); $('#gsaved').textContent = '🎉 Welcome to the family'; $('#gsaved').disabled = true; };
}
function speakList(items, btn) { if (!('speechSynthesis' in window)) { toast('Listening is not supported on this device'); return; } if (speechSynthesis.speaking) { speechSynthesis.cancel(); btn.textContent = '▶ Speak them over me'; return; }
  const u = new SpeechSynthesisUtterance(items.join('. ')); const vv = ttsVoice(); if (vv) u.voice = vv; u.rate = +(localStorage.getItem('jom:rate') || 1); u.onend = () => { btn.textContent = '▶ Speak them over me'; }; speechSynthesis.speak(u); btn.textContent = '❚❚ Stop'; }
function viewHealing() {
  setNav('gospel'); document.title = 'Healing scriptures — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">By his stripes you were healed</p><h1>Healing <span class="neon-txt">scriptures</span></h1>
    <p class="lead">Healing is part of what Jesus purchased at the cross. Faith comes by hearing the Word (Romans 10:17), so read these, speak them and listen to them often. Tap a reference to read the verse.</p>
    <div class="linkrow"><button class="btn" id="hlsp">▶ Speak them over me</button><button class="btn ghost" data-go="teachings">Teaching on healing</button></div>
    <div class="rlist">${GOSPEL.healing.map(([r, n]) => `<div class="ritem"><div><b><button class="inl" data-verse="${esc(r)}">${esc(r)}</button></b><span>${esc(n)}</span></div></div>`).join('')}</div>
    <p class="small muted" style="margin-top:14px">Believing God for healing goes hand in hand with wisdom. Keep seeing your doctor and taking prescribed medicine; God also works through medical care.</p></div></section>`;
  $('#hlsp').onclick = async e => { const b = e.target; let lines = GOSPEL.healing.map(([r, n]) => `${r}. ${n}`); try { const vs = []; for (const [r] of GOSPEL.healing) { const v = await bibleText(r); vs.push(`${v.verses.map(x => x.t).join(' ')} ${r}.`); } lines = vs; } catch {} speakList(lines, b); };
}

/* ---------- teaching notes (summaries in our own words, with links to the full free teaching) ---------- */
const TNOTES = window.JOM_TEACHNOTES || [];
const TNAME = { wommack: 'Andrew Wommack', mohler: 'Dan Mohler', olivier: 'Richard Olivier' };
function tnoteWatch(n) { return n.t === 'wommack' ? `https://www.youtube.com/channel/UC8H3lzJU5Qm-s3WVroB87kw/search?query=${encodeURIComponent(n.q)}` : n.t === 'olivier' ? `https://www.youtube.com/@harvestchurchza/search?query=${encodeURIComponent(n.q)}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(TNAME[n.t] + ' ' + n.q)}`; }
function viewNotes(id) {
  setNav('teachings'); const n = TNOTES.find(x => x.id === id);
  if (!n) { document.title = 'Teaching notes — Just One More Lord'; const topics = [...new Set(TNOTES.map(x => x.topic))];
    main.innerHTML = `<section class="band"><div class="wrap"><div class="crumbs"><button data-go="teachings">Grace teachings</button> › Teaching notes</div><h1>📝 Teaching notes</h1>
      <p class="lead">Study notes on the main teachings of Andrew Wommack, Dan Mohler and Richard Olivier: grace, faith, healing, identity, authority, prayer and the love of God. Read the key points and scriptures, then watch the full teaching free.</p>
      <div class="chips" id="tnf"><button class="chip on" data-tp="">All</button>${topics.map(t => `<button class="chip" data-tp="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="tngrid">${TNOTES.map(x => `<button class="tncard" data-go="notes-${x.id}" data-tp="${esc(x.topic)}"><span class="kicker">${esc(x.topic)} · ${esc(TNAME[x.t])}</span><b>${esc(x.title)}</b><span>${esc(x.sum.slice(0, 140))}…</span></button>`).join('')}</div>
      <p class="small muted" style="margin-top:16px">These are study summaries written for this app in our own words. They are not the teachers' own notes. For the complete teaching and official study guides, see <a href="https://www.awmi.net/" target="_blank" rel="noopener">awmi.net</a> (Andrew Wommack Ministries, free teaching) and the teachers' YouTube channels.</p></div></section>`;
    $('#tnf').onclick = e => { const b = e.target.closest('[data-tp]'); if (!b) return; $$('#tnf .chip').forEach(x => x.classList.toggle('on', x === b)); $$('.tncard').forEach(c => c.hidden = b.dataset.tp && c.dataset.tp !== b.dataset.tp); };
    return; }
  document.title = `${n.title} — teaching notes — Just One More Lord`; const i = TNOTES.indexOf(n), nx = TNOTES[(i + 1) % TNOTES.length];
  main.innerHTML = `<section class="band"><div class="wrap quizwrap"><div class="crumbs"><button data-go="teachings">Grace teachings</button> › <button data-go="notes">Teaching notes</button> › ${esc(n.title)}</div>
    <p class="kicker">${esc(n.topic)} · ${esc(TNAME[n.t])}</p><h1>${esc(n.title)}</h1><p class="lead">${esc(n.sum)}</p>
    <div class="panel"><h2>Key points</h2><ol class="tnpts">${n.pts.map(p => `<li>${esc(p)}</li>`).join('')}</ol></div>
    <div class="panel"><h2>Scriptures to study</h2><p class="small muted">Tap to read each one.</p>${vchips(n.vs)}</div>
    <div class="panel"><h2>Reflect</h2><ol class="small gq"><li>Which point stood out to you most, and why?</li><li>What have you believed about God that this changes?</li><li>Which scripture will you meditate on this week?</li></ol>
      <label class="notebox"><span class="kicker">My notes</span><textarea rows="3" id="tnmy" placeholder="Write what God is showing you…">${esc(MY.notes['tn:' + n.id]?.t || '')}</textarea></label></div>
    <div class="linkrow"><a class="btn" href="${tnoteWatch(n)}" target="_blank" rel="noopener">▶ Watch the full teaching</a>${n.t === 'wommack' ? '<a class="btn ghost" href="https://www.awmi.net/" target="_blank" rel="noopener">awmi.net</a>' : ''}${n.topic === 'Healing' ? '<button class="btn ghost" data-go="stories">🙌 Healing testimonies</button>' : ''}<button class="btn ghost" id="tnsh">${ICON.share} Share</button><button class="btn ghost sm" data-go="notes-${nx.id}">Next: ${esc(nx.title)} →</button></div>
    <p class="small muted" style="margin-top:14px">Study notes written for this app in our own words, summarising the main points of this teaching. They are not ${esc(TNAME[n.t])}'s own notes or wording. Test everything with Scripture (Acts 17:11).</p></div></section>`;
  $('#tnmy').oninput = e => { const v = e.target.value.trim(); if (v) MY.notes['tn:' + n.id] = { t: v, d: Date.now() }; else delete MY.notes['tn:' + n.id]; saveMy(); };
  $('#tnsh').onclick = () => shareIt({ title: n.title, text: `${n.title} (${TNAME[n.t]})\n\n${n.pts.slice(0, 4).map(p => '• ' + p).join('\n')}`, hash: 'notes-' + n.id });
}
/* ---------- healing testimonies (Andrew Wommack Ministries) ---------- */
const TESTI = window.JOM_TESTIMONIES || [];
function viewStories(id) {
  setNav('teachings'); const t = TESTI.find(x => x.id === id);
  if (!t) { document.title = 'Healing testimonies — Just One More Lord';
    main.innerHTML = `<section class="band"><div class="wrap"><div class="crumbs"><button data-go="teachings">Grace teachings</button> › Healing testimonies</div><p class="kicker">“They overcame by the blood of the Lamb and the word of their testimony” · Revelation 12:11</p><h1>🙌 Healing testimonies</h1>
      <p class="lead">Stories of healing shared through Andrew Wommack Ministries. God wants you well, and what He has done for others He has already provided for you through Jesus.</p>
      <div class="tngrid">${TESTI.map(x => `<button class="tncard" data-go="stories-${x.id}"><span class="kicker">${esc(x.kind)} · ${esc(x.when)}</span><b>${esc(x.title)}</b><span>${esc(x.sum.slice(0, 140))}…</span></button>`).join('')}</div>
      <div class="linkrow" style="margin-top:16px"><button class="btn" data-go="notes-healing">📝 Teaching notes: God wants you well</button><a class="btn ghost" href="https://www.awmi.net/" target="_blank" rel="noopener">awmi.net ↗</a><button class="btn ghost" data-go="testimonies">Share your own testimony</button></div>
      <p class="small muted" style="margin-top:16px">${esc(window.JOM_TESTIMONY_NOTE || '')}</p></div></section>`;
    return; }
  document.title = `${t.title} — healing testimonies — Just One More Lord`; const i = TESTI.indexOf(t), nx = TESTI[(i + 1) % TESTI.length];
  main.innerHTML = `<section class="band"><div class="wrap quizwrap"><div class="crumbs"><button data-go="teachings">Grace teachings</button> › <button data-go="stories">Healing testimonies</button> › ${esc(t.title)}</div>
    <p class="kicker">${esc(t.kind)} · ${esc(t.when)}</p><h1>${esc(t.title)}</h1><p class="small muted">${esc(t.who)}</p><p class="lead">${esc(t.sum)}</p>
    <div class="panel"><h2>Scriptures behind it</h2><p class="small muted">Tap to read each one.</p>${vchips(t.vs)}</div>
    <div class="panel"><h2>Hear it first-hand</h2><div class="linkrow">${t.src.map(([l, u]) => `<a class="btn ghost sm" href="${esc(u)}" target="_blank" rel="noopener">${esc(l)} ↗</a>`).join('')}</div></div>
    <div class="linkrow"><button class="btn ghost" id="tssh">${ICON.share} Share</button><button class="btn ghost sm" data-go="stories-${nx.id}">Next: ${esc(nx.title)} →</button></div>
    <p class="small muted" style="margin-top:14px">${esc(window.JOM_TESTIMONY_NOTE || '')}</p></div></section>`;
  $('#tssh').onclick = () => shareIt({ title: t.title, text: `${t.title}\n\n${t.sum}`, hash: 'stories-' + t.id });
}
/* ---------- milestones (prayed to receive Jesus / the Holy Spirit) ---------- */
function markMilestone(k) { if (!MY.milestones || typeof MY.milestones !== 'object') MY.milestones = {}; if (!MY.milestones[k]) MY.milestones[k] = Date.now(); MY.days[today()] = (MY.days[today()] || 0) + 1; saveMy(); }
const refChips = refs => vchips(refs.flatMap(r => String(r).split(/;\s*/)));
const backTop = '<p class="small muted"><button class="inl" data-totop>Back to top ↑</button></p>';
function wireJumps() { $$('[data-jump]').forEach(a => a.onclick = e => { e.preventDefault(); const t = $('#' + a.dataset.jump); if (t) { if (t.tagName === 'DETAILS') t.open = true; t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }); $$('[data-totop]').forEach(b => b.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' })); }

/* ---------- who you are in Christ: the new-creation breakdown ---------- */
const NEWC = window.JOM_NEWCREATION || { parts: [], swap: [], identity: [], renew: [], faq: [], declare: [] };
function viewIdentity() {
  setNav('gospel'); document.title = 'Who you are in Christ — your new creation identity — Just One More Lord';
  const t = GOSPEL.identity.length ? GOSPEL.identity[dayIndex() % GOSPEL.identity.length] : null;
  const toc = [['nc-parts', 'Spirit, soul and body'], ['nc-swap', 'The old you and the new you'], ['nc-id', 'Who you are now: 12 truths'], ['nc-renew', 'How to live from it'], ['nc-faq', 'Honest questions'], ['nc-declare', 'Speak it over yourself']];
  main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">2 Corinthians 5:17 · your new creation identity</p><h1>Who you are in <span class="neon-txt">Christ</span></h1>
    <p class="lead">${esc(NEWC.intro || 'This is what God says is already true of you in your spirit.')}</p>
    ${t ? `<div class="votdcard"><div><p class="kicker">Today's truth</p><div class="vtext">${esc(t[0])}</div><button class="chip" data-verse="${esc(t[1])}">${esc(t[1])}</button></div>
      <div class="linkrow" style="align-content:center"><button class="btn" id="idsp">▶ Speak today's truths</button><button class="btn ghost" id="idsh">${ICON.share} Share</button></div></div>` : ''}
    <nav class="toc" aria-label="On this page">${toc.map(([id, l], i) => `<a href="#identity" data-jump="${id}">${i + 1}. ${esc(l)}</a>`).join('')}</nav>

    <h2 id="nc-parts" class="nch">1. You are a spirit, you have a soul, you live in a body</h2>
    <p>1 Thessalonians 5:23 names all three parts of you. Knowing which part was made new is the key to understanding your identity.</p>
    <div class="ncparts">
      <svg class="ncdiag" viewBox="0 0 220 220" role="img" aria-label="Three circles: body on the outside, soul in the middle, spirit at the centre">
        <circle cx="110" cy="110" r="104" class="nc-b"/><circle cx="110" cy="110" r="70" class="nc-s"/><circle cx="110" cy="110" r="36" class="nc-sp"/>
        <text x="110" y="28" text-anchor="middle">BODY</text><text x="110" y="62" text-anchor="middle">SOUL</text><text x="110" y="106" text-anchor="middle" class="nc-spt">SPIRIT</text><text x="110" y="122" text-anchor="middle" class="nc-spt small">made new</text></svg>
      <div class="ncpcards">${NEWC.parts.map(([h, p, r], i) => `<article class="panel ncp ncp${i}"><h3>${esc(h)}</h3><p>${esc(p)}</p>${refChips(r)}</article>`).join('')}</div></div>

    <h2 id="nc-swap" class="nch">2. The old you and the new you</h2>
    <p>Everything you were in Adam, Jesus exchanged for everything he is. This is the great exchange of the cross.</p>
    <div class="ncswap" role="table" aria-label="In Adam compared with in Christ"><div class="ncrow nchead" role="row"><span role="columnheader">In Adam, I was</span><span role="columnheader">In Christ, I am</span></div>
      ${NEWC.swap.map(([a, b, r]) => `<div class="ncrow" role="row"><span role="cell" class="ncold">${esc(a)}</span><span role="cell" class="ncnew"><b>${esc(b)}</b>${refChips([r])}</span></div>`).join('')}</div>

    <h2 id="nc-id" class="nch">3. Who you are now: 12 truths</h2>
    <p>Tap each one to open it. Each has an explanation, five "I am" statements with the verse behind them, and a button to hear them spoken over you.</p>
    <div class="ncids">${NEWC.identity.map(x => `<details class="ncid" id="nc-${x.id}"><summary><span class="ncic" aria-hidden="true">${x.icon}</span><span><b>${esc(x.t)}</b><span class="small muted">${esc(x.sum)}</span></span></summary>
      <div class="ncbody"><p>${esc(x.text)}</p><ul class="ncam">${x.i.map(([s, r]) => `<li><span>${esc(s)}</span><button class="chip" data-verse="${esc(r)}">${esc(r)}</button></li>`).join('')}</ul>
      <div class="linkrow"><button class="btn sm" data-ncsp="${x.id}">▶ Speak these over me</button><button class="btn ghost sm" data-ncsh="${x.id}">${ICON.share} Share</button></div></div></details>`).join('')}</div>

    <h2 id="nc-renew" class="nch">4. How to live from who you already are</h2>
    <p>You do not become new by trying harder. You already are new in your spirit. The Christian life is renewing your mind to that truth so it shows up in how you think, feel and live (Romans 12:2).</p>
    <ol class="ncsteps">${NEWC.renew.map(([h, p, r]) => `<li><h3>${esc(h)}</h3><p>${esc(p)}</p>${refChips(r)}</li>`).join('')}</ol>

    <h2 id="nc-faq" class="nch">5. Honest questions</h2>
    ${NEWC.faq.map(([q, a, r]) => `<details class="ncfaq"><summary>${esc(q)}</summary><p>${esc(a)}</p>${refChips(r)}</details>`).join('')}

    <h2 id="nc-declare" class="nch">6. Speak it over yourself</h2>
    <p>Faith comes by hearing (Romans 10:17). Read these out loud every morning, or press play and listen.</p>
    <div class="panel prayerbox"><ol class="ncdecl">${NEWC.declare.map(d => `<li>${esc(d)}</li>`).join('')}</ol>
      <div class="linkrow"><button class="btn" id="ncdsp">▶ Speak them over me</button><button class="btn ghost" id="ncdsh">${ICON.share} Share</button><button class="btn ghost" data-go="memory">Learn them by heart</button></div></div>

    ${GOSPEL.identity.length ? `<details class="ncfaq"><summary>More "in Christ" statements (${GOSPEL.identity.length})</summary><ol class="idlist">${GOSPEL.identity.map(([s, r]) => `<li><span>${esc(s)}</span> <button class="chip" data-verse="${esc(r)}">${esc(r)}</button></li>`).join('')}</ol></details>` : ''}
    <div class="panel" style="margin-top:22px"><h2>Not sure you are in Christ yet?</h2><p>All of this becomes true of you the moment you receive Jesus. It is simple, and it is a gift.</p><div class="linkrow"><button class="btn" data-go="receive">Receive Jesus</button><button class="btn ghost" data-go="receive-spirit">Receive the Holy Spirit</button><button class="btn ghost" data-go="notes">Teaching notes on identity</button></div></div>
    ${backTop}
    <p class="small muted">Written for this app in the spirit of the finished-work grace teaching of Andrew Wommack, Dan Mohler and Richard Olivier; it is not their own wording. Test everything with Scripture (Acts 17:11).</p></div></section>`;
  wireJumps();
  if (t) { $('#idsp').onclick = e => speakList(GOSPEL.identity.map(([s, r]) => `${s}. ${r}`), e.target); $('#idsh').onclick = () => shareIt({ title: 'Who I am in Christ', text: GOSPEL.identity.map(([s, r]) => `• ${s} (${r})`).join('\n'), hash: 'identity' }); }
  $$('[data-ncsp]').forEach(b => b.onclick = () => { const x = NEWC.identity.find(y => y.id === b.dataset.ncsp); speakList(x.i.map(([s]) => s), b); });
  $$('[data-ncsh]').forEach(b => b.onclick = () => { const x = NEWC.identity.find(y => y.id === b.dataset.ncsh); shareIt({ title: `In Christ I am ${x.t.toLowerCase()}`, text: `${x.t}\n` + x.i.map(([s, r]) => `• ${s} (${r})`).join('\n'), hash: 'identity' }); });
  $('#ncdsp').onclick = e => speakList(NEWC.declare, e.target);
  $('#ncdsh').onclick = () => shareIt({ title: 'Who I am in Christ', text: NEWC.declare.map(d => '• ' + d).join('\n'), hash: 'identity' });
}

/* ---------- receive Jesus / receive the Holy Spirit ---------- */
const RCV = window.JOM_RECEIVE || null;
function viewReceive(which) {
  setNav('gospel'); if (!RCV) { viewNotFound(); return; }
  const sp = which === 'spirit', R = sp ? RCV.spirit : RCV.jesus, key = sp ? 'spirit' : 'jesus', done = MY.milestones?.[key];
  document.title = (sp ? 'Receive the Holy Spirit' : 'Receive Jesus') + ' — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap quizwrap"><div class="seg rcvtabs" role="tablist"><button role="tab" data-go="receive" aria-selected="${!sp}" aria-pressed="${!sp}">Receive Jesus</button><button role="tab" data-go="receive-spirit" aria-selected="${sp}" aria-pressed="${sp}">Receive the Holy Spirit</button></div>
    <p class="kicker">${sp ? 'Luke 11:13 · Acts 2:38-39' : 'Romans 10:9-10 · John 1:12'}</p><h1>${sp ? 'Receive the <span class="neon-txt">Holy Spirit</span>' : 'Receive <span class="neon-txt">Jesus</span>'}</h1>
    <p class="lead">${esc(R.lead)}</p>
    <ol class="ncsteps">${R.steps.map(([h, p, r]) => `<li><h3>${esc(h)}</h3><p>${esc(p)}</p>${refChips(r)}</li>`).join('')}</ol>
    <div class="panel prayerbox rcvprayer"><p class="kicker">Pray this out loud, from your heart</p><h2>${sp ? 'A prayer to receive the Holy Spirit' : 'A prayer to receive Jesus'}</h2><p class="rcvp"><i>${esc(R.prayer)}</i></p>
      <div class="linkrow"><button class="btn" id="rcvdone" ${done ? 'disabled' : ''}>${done ? '🎉 ' + (sp ? 'You asked and received' : 'Welcome to the family') : 'I prayed this prayer'}</button><button class="btn ghost" id="rcvsp">▶ Pray it with me</button></div>
      <div id="rcvafter" ${done ? '' : 'hidden'}><h2 style="margin-top:18px">${sp ? 'What now?' : 'What just happened'}</h2>${R.after.map(([h, p, r]) => `<div class="truth"><h3>${esc(h)}</h3><p>${esc(p)}</p>${refChips(r)}</div>`).join('')}</div></div>
    ${!sp ? `<div class="panel"><h2>Next: receive the Holy Spirit</h2><p>Jesus has more for you: the Holy Spirit's power to live this new life.</p><button class="btn" data-go="receive-spirit">Receive the Holy Spirit →</button></div>` : ''}
    <h2 class="nch">Your next steps</h2><div class="tiles">${RCV.next.map(([ic, h, d, go]) => `<button class="tile" data-go="${go}"><b>${ic} ${esc(h)}</b><span>${esc(d)}</span></button>`).join('')}</div>
    <h2 class="nch">Questions people ask</h2>${RCV.faq.map(([q, a, r]) => `<details class="ncfaq"><summary>${esc(q)}</summary><p>${esc(a)}</p>${refChips(r)}</details>`).join('')}
    <div class="panel" style="margin-top:20px"><h2>Free resources</h2><div class="rlist">${[['Andrew Wommack · free salvation and Holy Spirit booklets', 'https://www.awmi.net/reading/teaching-articles/'], ['Andrew Wommack · The New You & the Holy Spirit', 'https://www.youtube.com/channel/UC8H3lzJU5Qm-s3WVroB87kw/search?query=new%20you%20holy%20spirit'], ['Dan Mohler · the baptism of the Holy Spirit', 'https://www.youtube.com/results?search_query=Dan+Mohler+baptism+of+the+Holy+Spirit'], ['Richard Olivier · Harvest Church', 'https://www.youtube.com/@harvestchurchza/videos']].map(([l, u]) => `<a class="ritem" href="${u}" target="_blank" rel="noopener"><div><b>${esc(l)}</b><span>Free</span></div><span class="tag">Open ↗</span></a>`).join('')}</div></div>
    <p class="small muted">If you prayed today, tell someone, and if you'd like, share it on the <button class="inl" data-go="testimonies">testimonies</button> page. Written for this app in our own words; test everything with Scripture (Acts 17:11).</p></div></section>`;
  $('#rcvdone').onclick = e => { markMilestone(key); e.target.disabled = true; e.target.textContent = sp ? '🎉 You asked and received' : '🎉 Welcome to the family'; $('#rcvafter').hidden = false; $('#rcvafter').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(sp ? 'Your Father has given you the Holy Spirit (Luke 11:13). Now thank him and speak!' : 'Welcome to the family of God! Heaven is rejoicing (Luke 15:7).'); };
  $('#rcvsp').onclick = e => speakList([R.prayer], e.target);
}

/* ---------- the miracles of Jesus on the map ---------- */
const MIR = window.JOM_MIRACLES || [], MKIND = window.JOM_MIRACLE_KINDS || {};
const mirPos = m => m.at ? { lat: m.at[0], lon: m.at[1] } : byId[m.p] ? { lat: byId[m.p].lat, lon: byId[m.p].lon } : null;
async function viewMiracles(id) {
  setNav('journeys'); const m = MIR.find(x => x.id === id);
  if (m) {
    document.title = `${m.t} — the miracles of Jesus — Just One More Lord`; const i = MIR.indexOf(m), nx = MIR[(i + 1) % MIR.length], pv = MIR[(i - 1 + MIR.length) % MIR.length], pos = mirPos(m), [kl, kc] = MKIND[m.k] || ['', ''];
    main.innerHTML = `<section class="band"><div class="wrap quizwrap"><div class="crumbs"><button data-go="miracles">Miracles of Jesus</button> › ${esc(m.t)}</div>
      <p class="kicker"><span class="mirdot" style="background:${kc}"></span>${esc(kl)} · miracle ${i + 1} of ${MIR.length}</p><h1>${esc(m.t)}</h1><p class="small muted">📍 ${esc(m.w)}</p>
      <p class="lead">${esc(m.s)}</p><div class="panel prayerbox"><p class="kicker">The Father's heart</p><p>${esc(m.g)}</p></div>
      <div class="panel"><h2>Read it</h2><p class="small muted">Tap to read each account.</p>${vchips(m.r)}</div>
      ${pos ? `<div class="mapbox" id="mirmap1" style="height:300px;margin-top:16px"></div>` : ''}
      <div class="linkrow" style="margin-top:14px">${m.p && byId[m.p] ? `<button class="btn ghost sm" data-go="place-${m.p}">Explore ${esc(byId[m.p].n)} today →</button>` : ''}<button class="btn ghost sm" id="mirsh">${ICON.share} Share</button><button class="btn ghost sm" data-go="healing">Healing scriptures</button></div>
      <div class="linkrow"><button class="btn ghost sm" data-go="miracles-${pv.id}">← ${esc(pv.t)}</button><button class="btn ghost sm" data-go="miracles-${nx.id}">${esc(nx.t)} →</button></div></div></section>`;
    $('#mirsh').onclick = () => shareIt({ title: m.t, text: `${m.t} (${m.r[0]})\n\n${m.s}\n\n${m.g}`, hash: 'miracles-' + m.id });
    if (pos) await makeMap($('#mirmap1'), { markers: [{ ...pos, label: m.w, sub: m.t, kind: 'main', size: 18, go: m.p && byId[m.p] ? 'place-' + m.p : '' }], maxZoom: 10 });
    return;
  }
  document.title = 'The miracles of Jesus on the map — Just One More Lord';
  const counts = Object.fromEntries(Object.keys(MKIND).map(k => [k, MIR.filter(x => x.k === k).length]));
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Acts 10:38 · he went about doing good and healing all</p><h1>The miracles of <span class="neon-txt">Jesus</span></h1>
    <p class="lead">${MIR.length} miracles from the Gospels, pinned to where they happened. Every one shows the Father's heart: Jesus never refused anyone who came to him for healing, and he never made anyone sick.</p></div></div>
    <div class="chips" id="mirf" role="group" aria-label="Filter miracles"><button class="chip" data-k="" aria-pressed="true">All ${MIR.length}</button>${Object.entries(MKIND).map(([k, [l, c]]) => `<button class="chip" data-k="${k}" aria-pressed="false"><span class="mirdot" style="background:${c}"></span>${esc(l)} ${counts[k]}</button>`).join('')}</div>
    <div class="mapbox tall" id="mirmap" style="margin-top:14px"></div><p class="small muted">Numbers show how many miracles happened at each place. Where the Gospels name only a region, the pin is approximate. Tap a pin to see its miracles.</p>
    <div class="mirlist" id="mirlist"></div></div></section>`;
  let kind = '', place = '';
  const draw = () => {
    const L = MIR.filter(x => (!kind || x.k === kind) && (!place || (x.p || x.id) === place));
    $('#mirlist').innerHTML = (place ? `<p class="notice">Showing miracles at ${esc(byId[place]?.n || 'this place')} · <button class="inl" id="mirclr">show all</button></p>` : '') + L.map(x => { const [kl, kc] = MKIND[x.k] || ['', '']; return `<button class="ritem mirit" data-go="miracles-${x.id}" style="--kc:${kc}"><div><b>${esc(x.t)}</b><span>${esc(x.w)} · ${esc(x.r[0])}</span></div><span class="tag">${esc(kl)}</span></button>`; }).join('');
    $('#mirclr') && ($('#mirclr').onclick = () => { place = ''; draw(); });
  };
  $$('#mirf [data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; $$('#mirf [data-k]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); });
  draw();
  const groups = {}; for (const x of MIR) { const pos = mirPos(x); if (!pos) continue; const g = x.p || x.id; (groups[g] ||= { ...pos, list: [], g }).list.push(x); }
  await makeMap($('#mirmap'), { markers: Object.values(groups).map(g => ({ lat: g.lat, lon: g.lon, label: byId[g.g]?.n || g.list[0].w, sub: g.list.map(x => x.t).join(' · '), kind: 'stop', num: g.list.length, size: g.list.length > 1 ? 24 : 18,
    onClick: () => { place = g.g; kind = ''; $$('#mirf [data-k]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.k === ''))); draw(); } })), maxZoom: 9 });
}

/* ---------- the parables of Jesus ---------- */
const PARA = window.JOM_PARABLES || [];
function viewParables(id) {
  setNav('gospel'); const p = PARA.find(x => x.id === id);
  if (p) {
    document.title = `${p.t} — the parables of Jesus — Just One More Lord`; const i = PARA.indexOf(p), nx = PARA[(i + 1) % PARA.length], pv = PARA[(i - 1 + PARA.length) % PARA.length];
    main.innerHTML = `<section class="band"><div class="wrap quizwrap"><div class="crumbs"><button data-go="parables">Parables of Jesus</button> › ${esc(p.t)}</div>
      <p class="kicker">${esc(p.tp)} · parable ${i + 1} of ${PARA.length}</p><h1>${esc(p.t)}</h1>
      <h2 class="nch">The story</h2><p class="lead">${esc(p.s)}</p>
      <div class="panel prayerbox"><p class="kicker">Through the lens of grace</p><p>${esc(p.m)}</p></div>
      <div class="panel"><h2>Think about it</h2><p><i>${esc(p.q)}</i></p><div class="linkrow"><button class="btn ghost sm" data-go="journal-${encodeURIComponent(p.r[0])}">Write in my journal</button></div></div>
      <div class="panel"><h2>Read it</h2>${vchips(p.r)}</div>
      <div class="linkrow" style="margin-top:14px"><button class="btn ghost sm" id="parsp">▶ Listen</button><button class="btn ghost sm" id="parsh">${ICON.share} Share</button></div>
      <div class="linkrow"><button class="btn ghost sm" data-go="parables-${pv.id}">← ${esc(pv.t)}</button><button class="btn ghost sm" data-go="parables-${nx.id}">${esc(nx.t)} →</button></div></div></section>`;
    $('#parsp').onclick = e => speakList([p.t, p.s, p.m], e.target);
    $('#parsh').onclick = () => shareIt({ title: p.t, text: `${p.t} (${p.r[0]})\n\n${p.m}`, hash: 'parables-' + p.id });
    return;
  }
  document.title = 'The parables of Jesus — Just One More Lord'; const tps = [...new Set(PARA.map(x => x.tp))];
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Mark 4:34 · he explained everything to his disciples</p><h1>The parables of <span class="neon-txt">Jesus</span></h1>
    <p class="lead">${PARA.length} stories Jesus told, each explained through the finished work and the love of the Father, with a question to think about.</p></div></div>
    <div class="chips" id="parf" role="group" aria-label="Filter by theme"><button class="chip" data-tp="" aria-pressed="true">All</button>${tps.map(t => `<button class="chip" data-tp="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join('')}</div>
    <div class="gcards" id="parlist"></div></div></section>`;
  const draw = tp => { $('#parlist').innerHTML = PARA.filter(x => !tp || x.tp === tp).map(x => `<button class="gcard" data-go="parables-${x.id}"><span class="kicker">${esc(x.tp)} · ${esc(x.r[0])}</span><b>${esc(x.t)}</b><span>${esc(x.m.split(/(?<=[.!?])\s/)[0])}</span></button>`).join(''); };
  $$('#parf [data-tp]').forEach(b => b.onclick = () => { $$('#parf [data-tp]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(b.dataset.tp); });
  draw('');
}

/* ---------- the names of God ---------- */
const GNAMES = window.JOM_NAMES || [];
const NGROUP = { god: 'The names of God', jesus: 'The names of Jesus', spirit: 'The Holy Spirit' };
function viewNames(id) {
  setNav('concordance'); const n = GNAMES.find(x => x.id === id);
  if (n) {
    document.title = `${n.n} — the names of God — Just One More Lord`; const i = GNAMES.indexOf(n), nx = GNAMES[(i + 1) % GNAMES.length];
    main.innerHTML = `<section class="band"><div class="wrap quizwrap"><div class="crumbs"><button data-go="names">Names of God</button> › ${esc(n.n)}</div>
      <p class="kicker">${esc(NGROUP[n.g])}</p><h1>${esc(n.n)}</h1><p class="gname" lang="${n.s[0][0] === 'H' ? 'he' : 'el'}">${esc(n.o)}</p><p class="small muted">${esc(n.tr)}</p>
      <p class="lead"><b>${esc(n.m)}</b></p><div class="panel prayerbox"><p>${esc(n.x)}</p></div>
      <div class="panel"><h2>The original words</h2><p class="small muted">Open each Strong's number to see its definition and every verse where it appears.</p><div class="chips">${n.s.map(s => `<button class="chip" data-go="strong-${s}">${s}</button>`).join('')}</div></div>
      <div class="panel"><h2>Read it</h2>${vchips(n.r)}</div>
      <div class="linkrow" style="margin-top:14px"><button class="btn ghost sm" id="gnsh">${ICON.share} Share</button><button class="btn ghost sm" data-go="names-${nx.id}">Next: ${esc(nx.n)} →</button></div></div></section>`;
    $('#gnsh').onclick = () => shareIt({ title: n.n, text: `${n.n} (${n.o}): ${n.m}\n\n${n.x}`, hash: 'names-' + n.id });
    return;
  }
  document.title = 'The names of God — Just One More Lord';
  main.innerHTML = `<section class="band"><div class="wrap"><div class="sh"><div><p class="kicker">Proverbs 18:10 · the name of the LORD is a strong tower</p><h1>The names of <span class="neon-txt">God</span></h1>
    <p class="lead">In the Bible a name reveals character. Each name below shows something of who God is for you, with the original Hebrew or Greek and a link into the Strong's concordance.</p></div></div>
    ${Object.entries(NGROUP).map(([g, l]) => `<h2 class="nch">${esc(l)}</h2><div class="gcards">${GNAMES.filter(x => x.g === g).map(x => `<button class="gcard" data-go="names-${x.id}"><span class="gname sm" lang="${x.s[0][0] === 'H' ? 'he' : 'el'}">${esc(x.o)}</span><b>${esc(x.n)}</b><span>${esc(x.m)}</span></button>`).join('')}</div>`).join('')}
  </div></section>`;
}

/* ---------- Bible money, weights and measures today ---------- */
const MEAS = window.JOM_MEASURES || null;
function viewMeasures() {
  setNav('study'); if (!MEAS) { viewNotFound(); return; } document.title = 'Bible money, weights and measures today — Just One More Lord';
  let wage = +(localStorage.getItem('jom:wage') || MEAS.wage) || MEAS.wage;
  const R = v => v >= 1e9 ? 'R' + (v / 1e9).toLocaleString('en-ZA', { maximumFractionDigits: 1 }) + ' billion' : v >= 1e6 ? 'R' + (v / 1e6).toLocaleString('en-ZA', { maximumFractionDigits: 1 }) + ' million' : 'R' + v.toLocaleString('en-ZA', { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 });
  const days = d => d < 1 / 8 ? `${Math.round(d * 480)} minutes' work` : d < 1 ? `${+(d * 8).toFixed(1)} hours' work` : d === 1 ? `1 day's wages` : d < 30 ? `${+d.toFixed(1)} days' wages` : d < 365 ? `about ${Math.round(d / 26)} months' wages` : `about ${(d / 312 > 1000 ? Math.round(d / 312 / 1000) * 1000 : Math.round(d / 312)).toLocaleString('en-ZA')} years' wages`;
  const metric = (v, u) => u === 'm' ? (v < 1 ? `${+(v * 100).toFixed(1)} cm` : v < 1000 ? `${+v.toFixed(2)} m` : `${+(v / 1000).toFixed(2)} km`) : u === 'kg' ? (v < 1 ? `${+(v * 1000).toFixed(2)} g` : `${+v.toFixed(1)} kg`) : `${+v.toFixed(2)} litres`;
  const imp = (v, u) => u === 'm' ? (v < 1 ? `${+(v * 39.37).toFixed(1)} in` : v < 1000 ? `${+(v * 3.281).toFixed(1)} ft` : `${+(v / 1609.34).toFixed(2)} miles`) : u === 'kg' ? (v < 0.5 ? `${+(v * 35.274).toFixed(2)} oz` : `${+(v * 2.2046).toFixed(1)} lb`) : `${+(v * 0.2642).toFixed(2)} US gal`;
  const unitRows = list => list.map(x => `<div class="msrow"><div><b>${esc(x.n)}</b> ${x.s ? `<button class="chip sm" data-go="strong-${x.s}">${x.s}</button>` : ''}<p class="small">${esc(x.w)}</p>${vchips(x.r)}</div><div class="msval"><b>${metric(x.v, x.u)}</b><span class="small muted">${imp(x.v, x.u)}</span></div></div>`).join('');
  const all = [...MEAS.length, ...MEAS.weight, ...MEAS.volume];
  main.innerHTML = `<section class="band"><div class="wrap quizwrap"><p class="kicker">Luke 10:35 · two denarii for the inn</p><h1>Bible money, weights &amp; <span class="neon-txt">measures</span> today</h1>
    <p class="lead">What was a denarius worth? How big was a cubit? Here is every unit in the Bible in today's terms, with money shown in rand.</p>
    <nav class="toc" aria-label="On this page"><a href="#measures" data-jump="ms-money">1. Money in rand</a><a href="#measures" data-jump="ms-stories">2. Famous amounts</a><a href="#measures" data-jump="ms-conv">3. Quick converter</a><a href="#measures" data-jump="ms-len">4. Length and distance</a><a href="#measures" data-jump="ms-wt">5. Weight</a><a href="#measures" data-jump="ms-vol">6. Volume</a><a href="#measures" data-jump="ms-fam">7. Famous sizes</a></nav>
    <h2 class="nch" id="ms-money">1. Money in rand</h2>
    <p>A denarius was a day's pay for a labourer (Matthew 20:2), so the fairest way to understand Bible money is in days' wages. Change the daily wage to match your own if you like.</p>
    <div class="panel"><label for="mswage"><b>One day's wage (R)</b></label><div class="linkrow"><input id="mswage" type="number" min="1" step="0.01" inputmode="decimal" value="${wage}" style="max-width:160px"><button class="btn ghost sm" id="msreset">Reset</button></div><p class="small muted">Default: ${esc(MEAS.wageNote)}</p></div>
    <div id="msmoney"></div>
    <h2 class="nch" id="ms-stories">2. Famous amounts in the Bible</h2><div id="msstories" class="gcards"></div>
    <h2 class="nch" id="ms-conv">3. Quick converter</h2>
    <div class="panel msconv"><div class="linkrow"><input id="msn" type="number" min="0" step="any" value="1" aria-label="How many" style="max-width:110px"><select id="msu" aria-label="Unit">${all.map(x => `<option value="${x.id}">${esc(x.n)}</option>`).join('')}</select></div><p class="msout" id="msout" aria-live="polite"></p></div>
    <h2 class="nch" id="ms-len">4. Length and distance</h2>${unitRows(MEAS.length)}
    <h2 class="nch" id="ms-wt">5. Weight</h2>${unitRows(MEAS.weight)}
    <h2 class="nch" id="ms-vol">6. Volume</h2>${unitRows(MEAS.volume)}
    <h2 class="nch" id="ms-fam">7. Famous sizes</h2><div class="gcards">${MEAS.famous.map(([h, a, d, r]) => `<div class="gcard"><span class="kicker">${esc(a)}</span><b>${esc(h)}</b><span>${esc(d)}</span><button class="chip" data-verse="${esc(r)}">${esc(r)}</button></div>`).join('')}</div>
    ${backTop}<p class="small muted">Ancient units varied by time and place; these are the usual scholarly estimates, rounded. Money values compare buying power through wages, not exchange rates.</p></div></section>`;
  const drawMoney = () => {
    $('#msmoney').innerHTML = MEAS.money.map(x => `<div class="msrow"><div><b>${esc(x.n)}</b> <button class="chip sm" data-go="strong-${x.s}">${x.s}</button><p class="small">${esc(x.w)}</p>${vchips(x.r)}</div><div class="msval"><b>${R(x.d * wage)}</b><span class="small muted">${days(x.d)}</span></div></div>`).join('');
    $('#msstories').innerHTML = MEAS.stories.map(([h, d, t, r]) => `<div class="gcard"><span class="kicker">${d.toLocaleString('en-ZA')} denarii · ${days(d)}</span><b>${esc(h)}: about ${R(d * wage)}</b><span>${esc(t)}</span><button class="chip" data-verse="${esc(r)}">${esc(r)}</button></div>`).join('');
  };
  const conv = () => { const x = all.find(y => y.id === $('#msu').value), n = +$('#msn').value || 0; $('#msout').innerHTML = `${n} × ${esc(x.n)} ≈ <b>${metric(x.v * n, x.u)}</b> <span class="muted">(${imp(x.v * n, x.u)})</span>`; };
  $('#mswage').oninput = e => { const v = +e.target.value; if (v > 0) { wage = v; try { localStorage.setItem('jom:wage', v); } catch {} drawMoney(); } };
  $('#msreset').onclick = () => { wage = MEAS.wage; $('#mswage').value = wage; try { localStorage.removeItem('jom:wage'); } catch {} drawMoney(); };
  $('#msu').value = 'cubit'; $('#msu').onchange = conv; $('#msn').oninput = conv;
  drawMoney(); conv(); wireJumps();
}

/* ---------------- router ---------------- */
async function render() {
  const h = decodeURIComponent(location.hash.slice(1) || 'home');
  if (dlg.open) dlg.close(); window.scrollTo(0, 0); main.onclick = null; if (!h.startsWith('embed-')) document.documentElement.classList.remove('embed');
  try {
    if (h === 'home' || h === '') { await viewHome(); homeVotd(); homeMore(); }
    else if (h.startsWith('place-')) { await viewPlace(h.slice(6)); enhancePlace(h.slice(6)); if (byId[h.slice(6)]) { addDevotional(h.slice(6)); thenAndNow(byId[h.slice(6)]); pano360(byId[h.slice(6)]); placeComments(h.slice(6)); } }
    else if (h.startsWith('disc-')) { const d = discById[h.slice(5)]; d ? await viewPlace(d.place, d.id) : viewNotFound(); }
    else if (h === 'atlas') await viewAtlas();
    else if (h === 'journeys') viewJourneys();
    else if (h.startsWith('journey-')) { await viewJourney(h.slice(8)); const jj = h.slice(8); $('main h1')?.insertAdjacentHTML('afterend', `<div class="linkrow"><button class="btn sm" data-go="fly-${jj}">3D fly-over</button><button class="btn ghost sm" data-go="plan-${jj}">Reading plan</button><button class="btn ghost sm" data-go="present-journey-${jj}">Present</button><button class="btn ghost sm" id="tpack">Save for offline travel</button><span class="tag">≈ ${fmtKm(journeyKm(JOURNEYS.find(x => x.id === jj) || { stops: [] }))} in a straight line</span></div>`); $('#tpack')?.addEventListener('click', e => travelPack(JOURNEYS.find(x => x.id === jj), e.currentTarget)); }
    else if (h === 'discoveries') { await viewDiscoveries(); $('main h1')?.insertAdjacentHTML('afterend', '<div class="linkrow"><button class="btn ghost sm" data-go="museums">Where to see Bible finds today</button></div>'); }
    else if (h === 'search') { await viewSearch(); let q = state.lastQuery; if (!q) { try { q = sessionStorage.getItem('bpt:q') || ''; } catch {} } addAnswers(q); addPeopleAnswers(q); }
    else if (h === 'about') { viewAbout(); $('main .wrap')?.insertAdjacentHTML('afterbegin', `<div class="panel aboutpeople"><p class="kicker">People of the Bible</p><h2>Look up anyone in the Bible</h2><p>Family, dates and age, where they lived and died on a map, journeys, life events and every verse — for over 3,000 people.</p><form class="bigsearch" id="apf" role="search"><label class="sr" for="apq">Name</label><input id="apq" type="search" placeholder="Type a name, e.g. Moses"><button class="btn" type="submit">Look up</button></form><p class="small"><button class="inl" data-go="chronology">From Adam to today: the age of mankind in the Bible</button></p></div>`); $('#apf')?.addEventListener('submit', e => { e.preventDefault(); go('people-' + encodeURIComponent($('#apq').value.trim())); }); }
    else if (h === 'concordance') await viewConcordance();
    else if (h === 'read' || h.startsWith('read-')) await viewRead(h.slice(5));
    else if (h === 'library') viewLibrary();
    else if (h === 'plans') viewPlans();
    else if (h.startsWith('plan-')) viewPlan(h.slice(5));
    else if (h === 'quiz' || h.startsWith('quiz-')) viewQuiz(h.slice(5));
    else if (h === 'near') viewNear();
    else if (h === 'timeline') viewTimeline();
    else if (h === 'community') viewCommunity();
    else if (h === 'prayer') viewPrayer();
    else if (h === 'memory') viewMemory();
    else if (h === 'books' || h.startsWith('books-')) viewBooks(h.slice(6));
    else if (h === 'grace') { await loadConc().catch(() => {}); viewGrace(); }
    else if (h === 'tabernacle' || h.startsWith('tabernacle-')) viewTabernacle(h.slice(11));
    else if (h === 'jerusalem' || h.startsWith('jerusalem-')) viewJerusalem(h.slice(10));
    else if (h === 'learn' || h.startsWith('learn-')) await viewLearn(h.slice(6));
    else if (h === 'fasting') viewFasting();
    else if (h === 'family-devotion') viewFamily2();
    else if (h === 'battle' || h.startsWith('battle-')) viewBattle(h.slice(7));
    else if (h === 'notifications') await viewNotifications();
    else if (h === 'pushkeys') await viewPushKeys();
    else if (h === 'topics' || h.startsWith('topics-')) await viewTopics(decodeURIComponent(h.slice(7)));
    else if (h.startsWith('topic-')) await viewTopic(h.slice(6));
    else if (h === 'dictionary') await viewDictionary('');
    else if (h.startsWith('dict-')) await viewDictEntry(h.slice(5));
    else if (h === 'prophecy') viewProphecy();
    else if (h === 'harmony' || h.startsWith('harmony-')) viewHarmony(h.slice(8));
    else if (h === 'places') await viewAllPlaces('');
    else if (h.startsWith('site-')) await viewSite(h.slice(5));
    else if (h === 'events' || h.startsWith('events-')) await viewEvents(h.slice(7));
    else if (h === 'museums') viewMuseums();
    else if (h === 'versepic' || h.startsWith('versepic-')) await viewVersePic(h.slice(9));
    else if (h === 'lesson') viewLesson();
    else if (h === 'daily') viewDaily();
    else if (h === 'groups') await viewGroups('');
    else if (h.startsWith('group-')) await viewGroups(h.slice(6));
    else if (h === 'study') viewStudyHub();
    else if (h === 'people' || h.startsWith('people-')) await viewPeople(decodeURIComponent(h.slice(7)));
    else if (h.startsWith('person-')) await viewPerson(h.slice(7));
    else if (h === 'chronology') await viewChronology();
    else if (h === 'profile') viewProfile();
    else if (h === 'settings') viewSettings();
    else if (h === 'gospel') viewGospel();
    else if (h === 'notes' || h.startsWith('notes-')) viewNotes(h.slice(6));
    else if (h === 'stories' || h.startsWith('stories-')) viewStories(h.slice(8));
    else if (h === 'identity') viewIdentity();
    else if (h === 'receive' || h === 'receive-spirit') viewReceive(h === 'receive-spirit' ? 'spirit' : '');
    else if (h === 'miracles' || h.startsWith('miracles-')) await viewMiracles(h.slice(9));
    else if (h === 'parables' || h.startsWith('parables-')) viewParables(h.slice(9));
    else if (h === 'names' || h.startsWith('names-')) viewNames(h.slice(6));
    else if (h === 'measures') viewMeasures();
    else if (h === 'healing') viewHealing();
    else if (h === 'wrapped' || h.startsWith('wrapped-')) viewWrapped(h.slice(8));
    else if (h === 'journal' || h.startsWith('journal-')) await viewJournal(h.slice(8));
    else if (h === 'grace-minute') await viewGraceMinute();
    else if (h === 'friends') await viewFriends();
    else if (h === 'testimonies') await viewTestimonies();
    else if (h === 'churches') await viewChurches();
    else if (h === 'partner') await viewPartner();
    else if (h.startsWith('live-')) await viewLive(h.slice(5));
    else if (h.startsWith('parallel')) await viewParallel(h.slice(9));
    else if (h === 'search-adv' || h.startsWith('search-')) await viewAdvSearch(h === 'search-adv' ? '' : h.slice(7));
    else if (h === 'rainbow') await viewRainbow();
    else if (h === 'written') viewWritten();
    else if (h === 'progress') { await loadConc(); viewProgress(); }
    else if (h === 'devotionals') viewDevotionals();
    else if (h === 'feasts') viewFeasts();
    else if (h === 'teachings' || h.startsWith('teachings-')) viewTeachings(h.slice(10));
    else if (h === 'kingdoms' || h.startsWith('kingdoms-')) viewKingdoms(h.slice(9));
    else if (h === 'distance' || h.startsWith('distance-')) viewDistance(h.slice(9));
    else if (h === 'kids' || h.startsWith('kids-')) viewKids(h.slice(5));
    else if (h.startsWith('friend-')) acceptInvite(h.slice(7));
    else if (h === 'devnotes') viewDevNotes();
    else if (h.startsWith('present-')) await viewPresent(h.slice(8));
    else if (h.startsWith('embed-')) viewEmbed(h.slice(6));
    else if (h === 'embed') viewEmbedMaker();
    else if (h === 'family') viewFamily();
    else if (h.startsWith('study-')) viewStudy(h.slice(6));
    else if (h.startsWith('fly-')) await viewFly(h.slice(4));
    else if (h.startsWith('strong-')) { await viewStrong(h.slice(7)); track('strongs', h.slice(7).toUpperCase()); }
    else if (h.startsWith('w-')) await viewWiki(h.slice(2));
    else if (h.startsWith('og-')) await viewGaz(h.slice(3));
    else if (byId[h]) await viewPlace(h);
    else viewNotFound();
  } catch (err) { console.error(err); main.insertAdjacentHTML('beforeend', `<div class="wrap"><p class="notice warn">Part of this page failed to load (${esc(err.message)}). Try reloading.</p></div>`); }
  try { applyLang(); } catch {}
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
