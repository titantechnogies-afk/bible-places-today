// Just One More Lord — sends the daily phone notification to everyone who switched notifications on.
// Deploy: Supabase → Edge Functions → Deploy a new function → name "daily-verse" → paste this file → turn OFF "Verify JWT".
// Secrets (Edge Functions → Secrets): VAPID_PUBLIC, VAPID_PRIVATE, CRON_SECRET, CONTACT_EMAIL.
// Schedule: hourly (see supabase/setup.sql).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = "https://titantechnogies-afk.github.io/bible-places-today/";
const VERSES: [string, string][] = [
  ["John 3:16", "For God so loved the world, that he gave his one and only Son…"], ["Psalm 23:1", "The Lord is my shepherd; I shall lack nothing."],
  ["Philippians 4:13", "I can do all things through Christ, who strengthens me."], ["Ephesians 1:3", "Blessed be God, who has blessed us with every spiritual blessing in Christ."],
  ["Romans 8:28", "All things work together for good for those who love God…"], ["Joshua 1:9", "Be strong and courageous… the Lord your God is with you."],
  ["Isaiah 40:31", "Those who wait for the Lord will renew their strength…"], ["Matthew 11:28", "Come to me, all you who labour and are heavily burdened, and I will give you rest."],
  ["Lamentations 3:22-23", "His compassion doesn't fail. They are new every morning."], ["Psalm 46:1", "God is our refuge and strength, a very present help in trouble."],
  ["2 Corinthians 5:17", "If anyone is in Christ, he is a new creation."], ["Galatians 2:20", "I have been crucified with Christ, and it is no longer I that live, but Christ lives in me."],
  ["Ephesians 2:8", "For by grace you have been saved through faith…"], ["Hebrews 13:5", "I will in no way leave you, neither will I in any way forsake you."],
  ["1 John 4:19", "We love him, because he first loved us."], ["Romans 8:1", "There is therefore now no condemnation to those who are in Christ Jesus."],
  ["Jeremiah 29:11", "Plans for peace, and not for evil, to give you hope and a future."], ["Psalm 119:105", "Your word is a lamp to my feet, and a light for my path."],
  ["John 14:6", "I am the way, the truth, and the life."], ["Isaiah 41:10", "Don't you be afraid, for I am with you."],
  ["Romans 5:8", "While we were yet sinners, Christ died for us."], ["Zephaniah 3:17", "He will rejoice over you with singing."],
  ["John 10:10", "I came that they may have life, and may have it abundantly."], ["1 Peter 2:24", "By his stripes you were healed."],
  ["2 Corinthians 5:21", "He made him who knew no sin to be sin on our behalf, so that in him we might become the righteousness of God."], ["1 Peter 5:7", "Casting all your worries on him, because he cares for you."],
  ["Matthew 6:33", "Seek first God's Kingdom and his righteousness."], ["John 19:30", "It is finished."], ["Psalm 34:8", "Oh taste and see that the Lord is good."],
  ["2 Corinthians 12:9", "My grace is sufficient for you, for my power is made perfect in weakness."], ["Revelation 21:4", "He will wipe away every tear from their eyes."]
];
Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("Forbidden", { status: 403 });
  webpush.setVapidDetails("mailto:" + (Deno.env.get("CONTACT_EMAIL") || "hello@example.com"), Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const day = Math.floor(Date.now() / 864e5); const [ref, text] = VERSES[day % VERSES.length];
  const payload = JSON.stringify({ title: body.title || "Verse of the day · " + ref, body: body.body || text, url: body.url || SITE + "#read-" + ref.replace(/^(.+?)\s+(\d+):(\d+).*$/, (_, b, c, v) => b.replace(/\s+/g, "_") + "." + c + "." + v), tag: "votd" });
  // Runs every hour; each phone gets the verse at the hour its owner chose (send_utc, in UTC; empty = 05:00 UTC = 07:00 in South Africa).
  // Send {"all": true} in the body to send to everyone right now (for testing).
  const hour = new Date().getUTCHours();
  let q = sb.from("push_subscriptions").select("endpoint,keys");
  if (!body.all) q = hour === 5 ? q.or("send_utc.eq.5,send_utc.is.null") : q.eq("send_utc", hour);
  const { data: subs } = await q;
  let sent = 0, removed = 0;
  for (const s of subs || []) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload); sent++; }
    catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) { await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint); removed++; } }
  }
  return Response.json({ sent, removed });
});
