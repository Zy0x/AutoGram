// Metadata-only Forwarder V2 API. Telegram sessions, API hashes and media
// never cross this boundary; execution remains on a signed local device.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const jobsIndex = parts.indexOf("jobs");
  const jobId = jobsIndex >= 0 ? parts[jobsIndex + 1] : undefined;
  const action = jobId ? parts[jobsIndex + 2] : undefined;
  const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));

  if (!jobId) {
    if (req.method === "GET") {
      const { data, error } = await supabase.from("forwarder_jobs").select("id, name, schema_version, revision, status, created_at, updated_at").order("created_at", { ascending: false });
      return error ? json({ error: "query_failed" }, 500) : json(data ?? []);
    }
    if (req.method !== "POST" || typeof body.name !== "string" || typeof body.config_ciphertext !== "string" || body.config_ciphertext.length > 2_000_000) return json({ error: "invalid_job_payload" }, 400);
    const idempotencyKey = req.headers.get("Idempotency-Key") ?? (typeof body.idempotency_key === "string" ? body.idempotency_key : null);
    if (idempotencyKey) {
      const existing = await supabase.from("forwarder_jobs").select("id, name, schema_version, revision, status, created_at, updated_at").eq("user_id", user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (existing.data) return json(existing.data);
    }
    const { data, error } = await supabase.from("forwarder_jobs").insert({ user_id: user.id, name: body.name, schema_version: 2, config_ciphertext: body.config_ciphertext, idempotency_key: idempotencyKey }).select("id, name, schema_version, revision, status, created_at, updated_at").single();
    return error ? json({ error: "persist_failed" }, 500) : json(data, 201);
  }

  const job = await supabase.from("forwarder_jobs").select("id, revision, status").eq("id", jobId).eq("user_id", user.id).maybeSingle();
  if (job.error || !job.data) return json({ error: "job_not_found" }, 404);

  if (!action && req.method === "GET") {
    const detail = await supabase.from("forwarder_jobs").select("id, name, schema_version, revision, status, config_ciphertext, created_at, updated_at").eq("id", jobId).eq("user_id", user.id).single();
    return detail.error ? json({ error: "query_failed" }, 500) : json(detail.data);
  }
  if (!action && req.method === "PATCH") {
    if (typeof body.config_ciphertext !== "string" || body.config_ciphertext.length > 2_000_000) return json({ error: "invalid_job_payload" }, 400);
    if (typeof body.revision !== "number" || body.revision !== job.data.revision) return json({ error: "revision_conflict", current_revision: job.data.revision }, 409);
    const next = job.data.revision + 1;
    const updated = await supabase.from("forwarder_jobs").update({ name: typeof body.name === "string" ? body.name : undefined, config_ciphertext: body.config_ciphertext, revision: next, updated_at: new Date().toISOString() }).eq("id", jobId).eq("user_id", user.id).eq("revision", job.data.revision).select("id, name, schema_version, revision, status, updated_at").single();
    if (updated.error) return json({ error: "revision_conflict" }, 409);
    await supabase.from("job_revisions").insert({ job_id: jobId, user_id: user.id, revision: next, config_ciphertext: body.config_ciphertext });
    return json(updated.data);
  }

  if (action === "events" && req.method === "GET") {
    const since = Number(url.searchParams.get("since") ?? 0);
    const events = await supabase.from("event_streams").select("id, sequence, event_ciphertext, created_at").eq("job_id", jobId).eq("user_id", user.id).gt("sequence", Number.isFinite(since) ? since : 0).order("sequence", { ascending: true }).limit(1000);
    return events.error ? json({ error: "query_failed" }, 500) : json(events.data ?? []);
  }
  if (action === "decisions") {
    if (req.method === "GET") {
      const decisions = await supabase.from("decision_inbox").select("id, reason_code, payload_ciphertext, status, created_at, resolved_at").eq("job_id", jobId).eq("user_id", user.id).order("created_at", { ascending: true });
      return decisions.error ? json({ error: "query_failed" }, 500) : json(decisions.data ?? []);
    }
    if (req.method === "POST" && typeof body.decision_id === "string" && typeof body.status === "string") {
      const updated = await supabase.from("decision_inbox").update({ status: body.status, resolved_at: new Date().toISOString() }).eq("id", body.decision_id).eq("job_id", jobId).eq("user_id", user.id).eq("status", "OPEN").select("id, status, resolved_at").single();
      return updated.error ? json({ error: "decision_conflict" }, 409) : json(updated.data);
    }
    return json({ error: "invalid_decision" }, 400);
  }
  if (["validate", "run", "pause", "resume", "cancel"].includes(action ?? "")) {
    if (action === "validate") return json({ job_id: jobId, status: job.data.status, revision: job.data.revision, execution: "device_required" });
    if (typeof body.device_id !== "string" || typeof body.nonce !== "string" || typeof body.signature !== "string") return json({ error: "signed_device_command_required" }, 400);
    const inserted = await supabase.from("relay_commands").insert({ user_id: user.id, device_id: body.device_id, job_id: jobId, command: action.toUpperCase(), nonce: body.nonce, signature: body.signature, payload_ciphertext: typeof body.payload_ciphertext === "string" ? body.payload_ciphertext : "" }).select("id, status, created_at").single();
    return inserted.error ? json({ error: "relay_enqueue_failed" }, 500) : json(inserted.data, 202);
  }
  return json({ error: "method_not_allowed" }, 405);
});
