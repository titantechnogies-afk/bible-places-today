/* Just One More Lord — service worker: makes the app installable and usable offline.
   App files: served from cache, refreshed in the background. Bible/concordance data: cached on first use.
   Live sources (Wikipedia, Commons, Bible text, map tiles): network first, cached copy when offline. */
const V = 'jom-v6';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'data/places.js', 'data/discoveries.js', 'data/journeys.js', 'data/story.js', 'js/config.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png', 'img/hero.webp',
  'data/concordance/books.json'];
const LIMITS = { [V + '-img']: 400, [V + '-live']: 600 };
self.addEventListener('install', e => { e.waitUntil(caches.open(V + '-shell').then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !k.startsWith(V)).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
async function trim(name) { const max = LIMITS[name]; if (!max) return; const c = await caches.open(name); const ks = await c.keys(); for (let i = 0; i < ks.length - max; i++) await c.delete(ks[i]); }
async function put(name, req, res) { if (!res || !(res.ok || res.type === 'opaque')) return res; const c = await caches.open(name); await c.put(req, res.clone()); trim(name); return res; }
const staleWhileRevalidate = async (name, req) => { const hit = await caches.match(req); const net = fetch(req).then(r => put(name, req, r)).catch(() => null); return hit || (await net) || Response.error(); };
const cacheFirst = async (name, req) => (await caches.match(req)) || fetch(req).then(r => put(name, req, r));
const networkFirst = async (name, req) => { try { return await put(name, req, await fetch(req)); } catch { return (await caches.match(req)) || Response.error(); } };
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    if (req.mode === 'navigate') return e.respondWith(networkFirst(V + '-shell', new Request('index.html')).then(r => r.ok ? r : caches.match('index.html')));
    if (u.pathname.includes('/data/concordance/') || u.pathname.includes('/data/xrefs/')) return e.respondWith(cacheFirst(V + '-bible', req));
    return e.respondWith(staleWhileRevalidate(V + '-shell', req));
  }
  if (/(^|\.)(tile\.openstreetmap\.org|arcgisonline\.com|opentopomap\.org|upload\.wikimedia\.org|s3\.amazonaws\.com)$/.test(u.hostname)) return e.respondWith(cacheFirst(V + '-img', req));
  if (/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|unpkg\.com)$/.test(u.hostname)) return e.respondWith(staleWhileRevalidate(V + '-lib', req));
  if (/(wikipedia\.org|wikimedia\.org|wikidata\.org|bible-api\.com|githubusercontent\.com)$/.test(u.hostname)) return e.respondWith(networkFirst(V + '-live', req));
});
self.addEventListener('message', e => {
  if (e.data?.type !== 'cache-bible') return;
  const files = e.data.files || []; let done = 0;
  (async () => { const c = await caches.open(V + '-bible');
    for (let i = 0; i < files.length; i += 8) {
      await Promise.all(files.slice(i, i + 8).map(async f => { if (!(await c.match(f))) { try { const r = await fetch(f); if (r.ok) await c.put(f, r); } catch {} } done++; }));
      e.source?.postMessage({ type: 'cache-progress', done, total: files.length });
    } })();
});
