// Just One More Lord — sends a phone notification when a friend sends you a message.
// Deploy: Supabase → Edge Functions → Deploy a new function → name "friend-message" → paste this file.
// Leave "Verify JWT" ON (only signed-in members can call it). It uses the same secrets as daily-verse
// (VAPID_PUBLIC, VAPID_PRIVATE, CONTACT_EMAIL), so there is nothing else to set up.
// The app calls it right after sending a message. It only notifies for a message the caller really sent,
// in the last 5 minutes, and only once per message.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = "https://titantechnogies-afk.github.io/bible-places-today/";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (o: unknown, status = 200) => Response.json(o, { status, headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await sb.auth.getUser(token);
  if (!who?.user) return json({ error: "Please sign in" }, 401);
  const { id } = await req.json().catch(() => ({}));
  if (!id) return json({ error: "No message" }, 400);

  // Claim the message (only the sender, only once, only recent)
  const { data: m } = await sb.from("messages").update({ pushed: true })
    .eq("id", id).eq("sender", who.user.id).eq("pushed", false).gt("created_at", new Date(Date.now() - 5 * 60e3).toISOString())
    .select("sender,recipient,body,verse_ref").maybeSingle();
  if (!m) return json({ sent: 0 });

  const { data: me } = await sb.from("profiles").select("name").eq("id", m.sender).maybeSingle();
  const name = (me?.name || "A friend").trim();
  const text = (m.verse_ref ? "📖 " + m.verse_ref + " · " : "") + m.body;
  const payload = JSON.stringify({ title: "💬 " + name, body: text.length > 140 ? text.slice(0, 137) + "…" : text, url: SITE + "#chat-" + m.sender, tag: "msg-" + m.sender });

  webpush.setVapidDetails("mailto:" + (Deno.env.get("CONTACT_EMAIL") || "hello@example.com"), Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);
  const { data: subs } = await sb.from("push_subscriptions").select("endpoint,keys").eq("user_id", m.recipient);
  let sent = 0;
  for (const s of subs || []) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload); sent++; }
    catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint); }
  }
  return json({ sent });
});
