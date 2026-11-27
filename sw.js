/* Just One More Lord — service worker: makes the app installable and usable offline.
   App files: served from cache, refreshed in the background. Bible/concordance data: cached on first use.
   Live sources (Wikipedia, Commons, Bible text, map tiles): network first, cached copy when offline. */
const V = 'jom-v9';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'data/places.js', 'data/discoveries.js', 'data/journeys.js', 'data/story.js', 'data/study.js', 'data/books-intro.js', 'data/grace.js', 'data/gospel.js', 'data/teachnotes.js', 'data/testimonies.js', 'js/config.js',
  'manifest.webmanifest', 'icons/app-192.png', 'icons/app-512.png', 'icons/app-favicon-32.png', 'img/hero.webp', 'img/logo.png', 'img/logo-sm.png',
  'data/concordance/books.json'];
const BIBLE = 'jom-bible-1', IMG = 'jom-img-1'; // kept across updates so offline downloads are not lost
const LIMITS = { [IMG]: 600, [V + '-live']: 600 };
self.addEventListener('install', e => { e.waitUntil(caches.open(V + '-shell').then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !k.startsWith(V) && k !== BIBLE && k !== IMG).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
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
    if (u.pathname.includes('/data/concordance/') || u.pathname.includes('/data/xrefs/') || /\/data\/(people|topics|dict|sites|web|gracech)\//.test(u.pathname)) return e.respondWith(cacheFirst(BIBLE, req));
    if (/\.(js|css|html|webmanifest)$/.test(u.pathname) || u.pathname.endsWith('/')) return e.respondWith(networkFirst(V + '-shell', req));
    return e.respondWith(staleWhileRevalidate(V + '-shell', req));
  }
  if (/(^|\.)(tile\.openstreetmap\.org|arcgisonline\.com|opentopomap\.org|upload\.wikimedia\.org|s3\.amazonaws\.com)$/.test(u.hostname)) return e.respondWith(cacheFirst(IMG, req));
  if (/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|unpkg\.com)$/.test(u.hostname)) return e.respondWith(staleWhileRevalidate(V + '-lib', req));
  if (/(wikipedia\.org|wikimedia\.org|wikidata\.org|bible-api\.com|githubusercontent\.com)$/.test(u.hostname)) return e.respondWith(networkFirst(V + '-live', req));
});
self.addEventListener('message', e => {
  if (e.data?.type !== 'cache-bible') return;
  const files = e.data.files || []; let done = 0;
  (async () => { const c = await caches.open(BIBLE);
    for (let i = 0; i < files.length; i += 8) {
      await Promise.all(files.slice(i, i + 8).map(async f => { if (!(await c.match(f))) { try { const r = await fetch(f); if (r.ok) await c.put(f, r); } catch {} } done++; }));
      e.source?.postMessage({ type: 'cache-progress', done, total: files.length });
    } })();
});
/* phone notifications */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Just One More Lord', { body: d.body || '', icon: 'icons/app-192.png', badge: 'icons/app-192.png', tag: d.tag || 'jom', data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const n = e.notification; let url = (n.data && n.data.url) || './';
  const m = n.tag === 'votd' && /#home$|\/$/.test(url) && String(n.title || '').match(/·\s*(.+?)\s+(\d+):(\d+)/);
  if (m) url = url.replace(/#.*$/, '') + '#read-' + m[1].replace(/\s+/g, '_') + '.' + m[2] + '.' + m[3];
  const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => 'focus' in x);
    if (w) { w.postMessage({ go: hash }); return w.focus(); }
    return clients.openWindow(url);
  }));
});
