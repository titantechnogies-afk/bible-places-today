# Just One More Lord — setup checklist

Everything in the app is built. The steps below switch on the parts that need **your own accounts** (they must be in your name). Each step is free unless it says otherwise. After each step, send the codes to Claude and they will be added for you — or paste them into `js/config.js` yourself.

---

## 1. Profiles and sign-up (free — Supabase)

1. Go to **supabase.com** → *Start your project* → sign in with GitHub.
2. *New project* → name it `just-one-more-lord`, choose a strong database password, region **South Africa (Cape Town)** if offered, otherwise the closest. Plan: **Free**.
3. When it is ready: left menu → **SQL Editor** → *New query* → paste everything from `supabase/setup.sql` → **Run**.
4. Left menu → **Authentication → URL Configuration**:
   - *Site URL*: `https://titantechnogies-afk.github.io/bible-places-today/`
   - *Redirect URLs*: add the same address.
5. Left menu → **Project Settings → API**. Copy:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long text starting with `eyJ…`). *Never* share the `service_role` key.
6. Send both to Claude (or put them in `js/config.js` → `supabase: { url: '…', anonKey: '…' }`).

Optional — *Continue with Google*: Supabase → Authentication → Providers → Google (needs a free Google Cloud OAuth client). Then set `google: true` in `js/config.js`.

## 2. Visitor counts (free — Cloudflare Web Analytics)

1. Go to **dash.cloudflare.com** → sign up (free).
2. *Analytics & Logs* → **Web Analytics** → *Add a site* → enter `titantechnogies-afk.github.io`.
3. Choose the **JavaScript snippet** option and copy only the **token** (the value after `"token":`).
4. Send it to Claude, or paste it into `js/config.js` → `cloudflareToken`.

## 3. WhatsApp channel and donations (optional)

- **WhatsApp channel**: WhatsApp → *Updates* tab → **+** → *Create channel* → name it *Just One More Lord*. Copy the channel link → `whatsappChannel`.
- **Donations**: create a free **PayFast** payment link (payfast.io) or **GitHub Sponsors** profile → `donateUrl`.
- **Contact email** for the privacy policy → `contactEmail`.

## 4. Android — Google Play Store (once-off US$25)

**A. Developer account**
1. Go to **play.google.com/console** → sign up as an **individual** (you will need ID verification and a phone number). Pay the US$25 once.
2. Note: new personal accounts must run a **closed test with at least 12 testers for 14 days** before the app can go public. Ask friends/church members with Android phones — you add their Gmail addresses.

**B. Make the app package (free, no coding)**
1. First create a second GitHub repository named exactly **`titantechnogies-afk.github.io`** (public, empty). Android needs a small verification file at the root of your website, and only this repository can put it there. Tell Claude when it exists — Claude will set it up.
2. Go to **pwabuilder.com** → enter `https://titantechnogies-afk.github.io/bible-places-today/` → *Start* → **Package for stores** → **Android** → *Generate*.
   - Package ID: `io.github.titantechnogies_afk.justonemorelord`
   - App name: `Just One More Lord`, short name: `One More Lord`
   - Keep *Signing key: Create new*.
3. Download the zip. **Keep `signing.keystore` and `signing-key-info.txt` safe forever** — you need them for every update.
4. Send Claude the **assetlinks.json** file from the zip (or the SHA-256 fingerprint in `signing-key-info.txt`) — Claude adds it to your website so the app opens full-screen without a browser bar.

**C. Upload**
1. Play Console → *Create app* → name, language English (South Africa), App, Free.
2. Fill in the store listing with the text in `store/listing.md`, the icon `store/icon-512.png`, the feature graphic `store/feature-graphic.png` and the screenshots in `store/screenshots/`.
3. Privacy policy URL: `https://titantechnogies-afk.github.io/bible-places-today/privacy.html`
4. *Testing → Closed testing* → upload the `.aab` file from the zip → add your 12+ testers → after 14 days apply for production.

## 5. Apple — App Store (US$99 per year, needs a Mac)

1. Join the **Apple Developer Program** at developer.apple.com (US$99/year).
2. On **pwabuilder.com** choose **iOS** → download the Xcode project.
3. Open it on a **Mac** with Xcode, sign in with your Apple developer account, and upload it to App Store Connect. (No Mac? Rent one online, e.g. MacinCloud, or ask a friend with a Mac.)
4. Use the same listing text, screenshots (Apple also wants iPhone 6.7" screenshots — Claude can make them) and privacy policy.

Until then, iPhone users can already install it: open the site in **Safari → Share → Add to Home Screen**.

## 6. Comments (already done ✓)

Comments, the prayer wall and the community board are switched on through GitHub Discussions.
