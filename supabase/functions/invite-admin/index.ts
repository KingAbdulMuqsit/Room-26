// Room 26 — invite-admin
// Sends a Supabase invite email and adds the person to public.admins.
// Only callable by someone who is already an admin.
// Deploy: supabase functions deploy invite-admin
// Secret needed: SITE_URL (e.g. https://room26.example.com). SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const siteUrl = Deno.env.get("SITE_URL") ?? "";

  // Who is calling?
  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json(401, { error: "Sign in first." });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: isAdmin } = await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!isAdmin) return json(403, { error: "Only admins can invite people." });

  let email = "";
  try { email = String((await req.json()).email ?? "").trim().toLowerCase(); } catch { /* fall through */ }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: "Enter a valid email address." });

  // Invite a new account, or reuse the existing one
  let userId: string | null = null;
  let emailed = false;
  const redirectTo = siteUrl ? `${siteUrl.replace(/\/$/, "")}/#admin` : undefined;
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (invited?.user) {
    userId = invited.user.id;
    emailed = true;
  } else {
    // Already has an account: find it and just grant admin
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break;
      const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
      if (hit) userId = hit.id;
      if (data.users.length < 1000) break;
    }
    if (!userId) return json(400, { error: inviteErr?.message ?? "Couldn't invite that address." });
  }

  const { data: existing } = await admin.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (existing) return json(200, { ok: true, already: true, emailed });

  const { error: insertErr } = await admin.from("admins").insert({ user_id: userId, email, invited_by: user.id });
  if (insertErr) return json(500, { error: "Invite sent, but adding them to the team failed. Try again." });

  return json(200, { ok: true, emailed });
});
