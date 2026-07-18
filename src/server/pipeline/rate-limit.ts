/**
 * Rate limiting / cost caps on the generation endpoint (system design §14, build plan
 * §I step 2). DB-backed (not in-memory) because Cloudflare Workers isolates don't share
 * memory reliably across requests/regions — a counter has to live somewhere durable,
 * and this project already treats Postgres as the single source of truth for
 * everything else (system design §9).
 *
 * Records every /api/generate attempt (session_id + ip, never the input text — PRD §13
 * privacy) and refuses BEFORE the expensive pipeline runs once either the per-session or
 * per-IP window is exceeded. A refusal here is a 429, not a fabricated/degraded answer.
 *
 * SERVER-ONLY.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { RATE_LIMIT } from "./config";

export interface RateLimitResult {
  allowed: boolean;
  reason?: "session" | "ip";
}

export async function checkAndRecordRateLimit(
  db: SupabaseClient,
  sessionId: string,
  ip: string,
): Promise<RateLimitResult> {
  const { error: insertError } = await db
    .from("generation_requests")
    .insert({ session_id: sessionId, ip });
  if (insertError) {
    // Fail OPEN, not closed — a rate-limit bookkeeping hiccup should never block a
    // legitimate user from a real answer (system design §15's "never fabricate, but
    // also never let an ops problem masquerade as a product failure").
    console.error("rate-limit insert failed (failing open):", insertError.message);
    return { allowed: true };
  }

  const sessionSince = new Date(Date.now() - RATE_LIMIT.sessionWindowMinutes * 60_000).toISOString();
  const { count: sessionCount, error: sessionErr } = await db
    .from("generation_requests")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .gte("ts", sessionSince);
  if (sessionErr) console.error("rate-limit session count failed:", sessionErr.message);
  if (!sessionErr && (sessionCount ?? 0) > RATE_LIMIT.perSessionMax) {
    return { allowed: false, reason: "session" };
  }

  const ipSince = new Date(Date.now() - RATE_LIMIT.ipWindowMinutes * 60_000).toISOString();
  const { count: ipCount, error: ipErr } = await db
    .from("generation_requests")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("ts", ipSince);
  if (ipErr) console.error("rate-limit ip count failed:", ipErr.message);
  if (!ipErr && (ipCount ?? 0) > RATE_LIMIT.perIpMax) {
    return { allowed: false, reason: "ip" };
  }

  return { allowed: true };
}

/** Best-effort real client IP from Cloudflare/standard proxy headers. */
export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
