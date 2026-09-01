// Public API boundary for Forwarder V2. Heavy Telegram work remains on a
// signed local device; this function only validates/authenticates metadata.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...cors, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || typeof body.config_ciphertext !== "string") {
    return new Response(JSON.stringify({ error: "invalid_job_payload" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
  const { data, error } = await supabase.from("forwarder_jobs").insert({ user_id: user.id, name: body.name, schema_version: 2, config_ciphertext: body.config_ciphertext }).select("id, name, schema_version, revision, status, created_at").single();
  if (error) return new Response(JSON.stringify({ error: "persist_failed" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  return new Response(JSON.stringify(data), { status: 201, headers: { ...cors, "Content-Type": "application/json" } });
});
