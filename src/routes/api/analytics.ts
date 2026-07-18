/**
 * Analytics endpoint (PRD §14, system design §13, build plan §H step 3) — anonymous
 * counters only. `session_id` is client-generated and not tied to identity; `payload`
 * must never carry the user's system description or question text — only structured,
 * low-cardinality fields (stage names, framework ids, timings). Enforced here by an
 * event_type allow-list and a payload size cap, not just by client-side discipline.
 *
 * SERVER-ONLY. Uses the service-role admin client (RLS is enabled with zero policies
 * on analytics_events, system design §14.1 — this route is the only write path).
 */
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

const ALLOWED_EVENTS = new Set([
  "map_completed",
  "clarifying_question",
  "citation_click",
  "follow_up",
  "refusal",
  "empty",
  "error",
]);

const MAX_PAYLOAD_BYTES = 2000;

export const Route = createFileRoute("/api/analytics")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { session_id?: unknown; event_type?: unknown; payload?: unknown };
        try {
          body = await request.json();
        } catch {
          return json({ error: "Request body must be JSON" }, { status: 400 });
        }

        const sessionId = body.session_id;
        const eventType = body.event_type;
        if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 100) {
          return json({ error: "Missing/invalid session_id" }, { status: 400 });
        }
        if (typeof eventType !== "string" || !ALLOWED_EVENTS.has(eventType)) {
          return json({ error: "Unknown event_type" }, { status: 400 });
        }
        const payload = body.payload ?? {};
        if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
          return json({ error: "payload too large" }, { status: 400 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("analytics_events").insert({
            session_id: sessionId,
            event_type: eventType,
            payload: payload as never,
          });
          if (error) throw new Error(error.message);
          return json({ ok: true });
        } catch (err) {
          // Analytics is best-effort — never let a logging failure surface to the user
          // or block the product flow it's instrumenting.
          console.error("analytics endpoint failed:", err);
          return json({ ok: false }, { status: 200 });
        }
      },
    },
  },
});
