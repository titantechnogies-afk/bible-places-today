/* Just One More Lord — site settings you can change without touching the app code.
   COMMENTS: uses giscus (free, comments are stored in this repository's GitHub Discussions).
   To switch comments on: 1) In the repository's Settings, tick "Discussions".
   2) Install the giscus app: https://github.com/apps/giscus  (choose this repository only).
   3) Open https://giscus.app, enter titantechnogies-afk/bible-places-today, pick the "General" (or a new "Community")
      category, and copy the values of data-repo-id and data-category-id into repoId and categoryId below. */
window.JOM_CONFIG = {
  giscus: { repo: 'titantechnogies-afk/bible-places-today', repoId: 'R_kgDOV7vntw', category: 'General', categoryId: 'DIC_kwDOV7vnt84DL-Au' },
  whatsappGroup: '',        // optional: an invite link to a WhatsApp community, e.g. https://chat.whatsapp.com/...
  developer: 'Titan Technogies',
  // ACCOUNTS (profiles + sync). Create a free project at supabase.com, run supabase/setup.sql, then paste the Project URL and the anon public key.
  supabase: { url: 'https://zjgfvyrbliygcldkbjkd.supabase.co', anonKey: 'sb_publishable_2kiddhtDDbO6_2-I2dK5Jw_gXSGXoYg', google: false },
  // VISITOR COUNTS: free Cloudflare Web Analytics token (no cookies). Leave '' to switch off.
  cloudflareToken: '',
  // Optional links shown in the footer: a WhatsApp channel and a donation page (e.g. PayFast, GitHub Sponsors).
  whatsappChannel: '',
  donateUrl: '',
  contactEmail: '',
  // Favourite teaching videos shown on the Teachings page. teacher: 'wommack', 'olivier' or 'mohler'. Paste any YouTube link.
  teachings: [
    // { teacher: 'wommack', title: 'Title of the teaching', youtube: 'https://www.youtube.com/watch?v=XXXXXXXXXXX', topic: 'Grace', verse: 'Ephesians 2:8' },
  ]
};
