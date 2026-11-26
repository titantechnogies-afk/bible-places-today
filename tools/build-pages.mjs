// Builds share/SEO pages for every place (p/<id>.html), a sitemap.xml and robots.txt.
// Each page has its own title, description and preview image for WhatsApp/Facebook/Google, then opens the app.
import fs from 'node:fs'; import vm from 'node:vm';
const SITE = 'https://titantechnogies-afk.github.io/bible-places-today/';
const ctx = { window: {} }; vm.createContext(ctx);
for (const f of ['data/places.js', 'data/journeys.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
const P = ctx.window.BPT_PLACES || [], J = ctx.window.BPT_JOURNEYS || [];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (path, hash, title, desc, img = 'icons/og.jpg') => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${SITE}${path}">
<meta property="og:type" content="article"><meta property="og:site_name" content="Just One More Lord"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE}${img}"><meta property="og:url" content="${SITE}${path}"><meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#020a10"><link rel="icon" href="../icons/app-favicon-32.png"><meta http-equiv="refresh" content="0; url=../#${hash}">
<style>body{background:#020a10;color:#eefbff;font:18px system-ui;padding:40px}a{color:#00d1ff}</style></head>
<body><h1>${esc(title)}</h1><p>${esc(desc)}</p><p><a href="../#${hash}">Open in Just One More Lord →</a></p><script>location.replace('../#${hash}')</script></body></html>`;
fs.mkdirSync('p', { recursive: true });
const urls = [SITE];
for (const p of P) { const d = (p.sum || `${p.n} in the Bible: maps, photographs, archaeology and Scripture.`).slice(0, 200);
  fs.writeFileSync(`p/${p.id}.html`, page(`p/${p.id}.html`, 'place-' + p.id, `${p.n} — Bible place today | Just One More Lord`, d, fs.existsSync(`og/${p.id}.jpg`) ? `og/${p.id}.jpg` : 'icons/og.jpg')); urls.push(`${SITE}p/${p.id}.html`); }
for (const j of J) { fs.writeFileSync(`p/journey-${j.id}.html`, page(`p/journey-${j.id}.html`, 'journey-' + j.id, `${j.n} — map and reading plan | Just One More Lord`, (j.intro || j.ref || '').slice(0, 200))); urls.push(`${SITE}p/journey-${j.id}.html`); }
fs.writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
console.log(`Built ${urls.length - 1} share pages, sitemap.xml and robots.txt`);
