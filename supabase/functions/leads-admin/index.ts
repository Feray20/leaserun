// LeaseRun lead admin API.
// Auth: shared admin password stored as the LEASERUN_ADMIN_PASSWORD Edge Function secret.
// Uses the service role server-side only; the browser never sees it.
// Deployed with verify_jwt = false (the function does its own password check).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = ["https://leaserun.vercel.app", "https://leaserun.com", "https://www.leaserun.com"];
const STATUSES = ["new", "contacted", "qualified", "won", "lost"];

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const preview = /^https:\/\/leaserun-[a-z0-9-]+-(feray20|klk19)\.vercel\.app$/.test(origin);
  const allow = ALLOWED_ORIGINS.includes(origin) || preview ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Vary": "Origin",
  };
}

async function digest(s: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

async function passwordOk(given: unknown) {
  const expected = Deno.env.get("LEASERUN_ADMIN_PASSWORD") ?? "";
  if (expected.length < 8 || typeof given !== "string" || !given) return false;
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  const headers = { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  if (!(await passwordOk(body.password))) {
    await new Promise((r) => setTimeout(r, 900)); // slow down guessing
    const configured = (Deno.env.get("LEASERUN_ADMIN_PASSWORD") ?? "").length >= 8;
    return new Response(JSON.stringify({ error: configured ? "unauthorized" : "not_configured" }), { status: 401, headers });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  if (body.action === "list") {
    const { data, error } = await db.from("leads").select("*").order("created_at", { ascending: false }).limit(1000);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
    return new Response(JSON.stringify({ leads: data }), { headers });
  }

  if (body.action === "update") {
    const id = String(body.id ?? "");
    const status = String(body.status ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || !STATUSES.includes(status)) {
      return new Response(JSON.stringify({ error: "bad_request" }), { status: 400, headers });
    }
    const { error } = await db.from("leads").update({ status }).eq("id", id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  if (body.action === "ping") return new Response(JSON.stringify({ ok: true }), { headers });
  return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers });
});
