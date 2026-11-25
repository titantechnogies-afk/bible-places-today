# Bible Places Today

**Explore the places. Discover the evidence. Walk through biblical history.**

A free, static web application for exploring the geographical locations of the Bible: what each place looks like today, where it is, what archaeologists have found there, and how those finds relate to the biblical text. It is graded honestly, so interpretations and disputes are not presented as proof.

No build step, no server, no paid API keys. It runs on any free static host.

---

## What it does

| Feature | How it works |
|---|---|
| **Search any Bible place** | Fuzzy, spelling-tolerant search (Damerau–Levenshtein distance plus phonetic folding) across 100 curated places and their alternative names (e.g. *Ninevah*, *Capernum*, *Kinneret*, *Jebus*), 84 discoveries, the optional OpenBible.info index of ~1,300 places named in the Bible, and Wikipedia. |
| **Photographs today** | Live from Wikimedia Commons: photos geotagged near each site plus photos matching its name. Only freely licensed Commons files are shown, each with photographer and licence. |
| **Interactive map** | Leaflet with OpenStreetMap, Esri World Imagery (satellite) and OpenTopoMap (terrain). It shows the site, documented discoveries, nearby Bible places, related-place links and archaeological sites queried live from Wikidata. Street-level imagery opens in Mapillary or Google Street View. |
| **Archaeological discoveries** | 84 curated entries. Each has its name, photo, find-spot, date, excavator and institution, what it shows, the scholarly assessment, its relation to Scripture (direct, indirect or contextual), Bible passages and sources, plus an evidence grade: **confirmed, interpretation, disputed, speculative or tradition**. |
| **Bible verse connections** | Every reference can be selected to read it in the World English Bible (public domain) via bible-api.com, with context notes and links to read the chapter. |
| **Timeline** | Per-place timeline merging biblical events, rulers, discoveries and excavation dates, filterable by type and by occupying civilisation. |
| **History** | Biblical and modern names, location today, historical and biblical importance, civilisations and what remains visible. |
| **Journeys** | Abraham, the Exodus, Jesus' ministry, Paul's three journeys, the voyage to Rome, and Peter and Philip in Acts, drawn as routes with clickable stages. |
| **Uncurated places** | Any Wikipedia article or OpenBible.info place gets a live page with map, photos, nearby archaeological sites and verse references. |

## Project structure

```
index.html              App shell (header, search, footer, dialog)
css/style.css           All styles (mobile-first, dark navy / sandstone / gold)
js/app.js               Router, search, views, map, live data clients
data/places.js          Curated places (edit to add or correct places)
data/discoveries.js     Curated archaeological discoveries
data/journeys.js        Journey routes
tools/build-gazetteer.mjs  Optional: builds data/gazetteer.json from OpenBible.info
.github/workflows/pages.yml  One-click GitHub Pages deployment
```

## Deploy for free

### Option A: GitHub Pages (recommended)
1. Create a new public repository on GitHub and upload all these files, keeping the folders. This includes the hidden `.github` folder; if your upload tool skips hidden folders, use Option B below.
2. In the repository go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main` (or run the workflow from the **Actions** tab). The workflow also tries to build the full Bible-places index. Your site appears at `https://<your-username>.github.io/<repository>/`.

*Without Actions:* under Settings → Pages choose **Deploy from a branch → main → / (root)**. Everything works; the full index then loads on request in the browser.

### Option B: Cloudflare Pages
Create a project, connect the repository (or upload the folder directly), set **Build command** to `node tools/build-gazetteer.mjs` (or leave it empty) and **Build output directory** to `/`.

### Option C: Netlify Drop
Drag the folder onto <https://app.netlify.com/drop>.

### Run locally
```
python3 -m http.server 8000
# open http://localhost:8000
```
(Opening `index.html` directly from disk also works, apart from the gazetteer file.)

## Data sources and licences

| Source | Used for | Licence |
|---|---|---|
| Curated dataset (this project) | Places, discoveries, journeys, timelines, grades | CC BY 4.0 |
| Wikipedia (REST + Action API) | Summaries, lead images, verse references in articles | CC BY-SA |
| Wikimedia Commons API | Photographs and their credits | Per image (shown) |
| Wikidata Query Service | Nearby archaeological sites, Pleiades IDs, heritage status | CC0 |
| bible-api.com | World English Bible text | Public domain |
| OpenStreetMap / Esri / OpenTopoMap | Map tiles | ODbL / Esri terms / CC BY-SA |
| OpenBible.info Bible Geocoding Data | Index of all Bible places with verses and coordinates | CC BY 4.0 |

All of these work without API keys. **Limits to be aware of:** bible-api.com allows about 15 requests per 30 seconds (the app paces bulk loading); Esri imagery tiles are free for non-commercial use with attribution; Wikimedia and Wikidata ask for reasonable request volumes (the app caches responses in the browser for 7 days).

## Research standards

* No discovery, date, citation or verse reference was invented. Each discovery links to its Wikipedia article, whose footnotes cite the excavation reports and publications, and to a Google Scholar search for the primary literature.
* Archaeological findings are kept separate from theological interpretation. The *Scholarly assessment* field reports what specialists generally accept, including where the evidence does **not** fit a simple reading (for example Jericho, Hazor, Arad and the Ebal "curse tablet").
* Disputed and traditional locations (Mount Sinai, Golgotha, Cana, Bethsaida, Bethel, Malta's shipwreck site and others) are labelled as such.
* Dates for the patriarchs, the Exodus and the conquest are given as alternatives.

Found an error? Edit the relevant entry in `data/` (each is a plain JavaScript object) and cite your source in the commit message.

## Adding a place

Add an object to `data/places.js`:

```js
{id:'emmaus', n:'Emmaus', alt:['Nicopolis','Emmaus Nicopolis','Abu Ghosh'], bn:'Emmaus', mn:'Several candidate sites',
 loc:'Near Jerusalem, Israel', lat:31.8389, lon:34.9897, pr:'disputed', ty:'Village', cat:['nt','jesus'], wiki:'Emmaus',
 sum:'…', v:[['Luke 24:13-35','The risen Jesus walks with two disciples.']], rel:['jerusalem']}
```

Photographs, map layers, nearby sites and verse text are then loaded automatically.

## Licence

Code: MIT. Curated text and data: CC BY 4.0. Third-party content remains under its own licence as listed above.
