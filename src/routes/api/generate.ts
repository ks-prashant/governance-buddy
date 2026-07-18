/**
 * Grounded-generation endpoint (build plan §D step 4) — the product's real answer path.
 *
 * Streams the pipeline's events as Server-Sent Events by default (restated
 * understanding first, stage names as work runs, the obligation map when ready), so
 * the UI can render progressively within the latency budget (system design §8.1).
 * Pass `{"stream": false}` to get the collected final result as one JSON object —
 * used by the eval harness and for quick curl testing.
 *
 * SERVER-ONLY. Uses the service-role admin client.
 */
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

export const Route = createFileRoute("/api/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: {
          input?: unknown;
          frameworkId?: unknown;
          stream?: unknown;
          mode?: unknown;
          sessionId?: unknown;
        };
        try {
          body = await request.json();
        } catch {
          return json({ error: "Request body must be JSON" }, { status: 400 });
        }
        const input = body.input;
        if (typeof input !== "string" || input.trim() === "") {
          return json({ error: "Missing required string field: input" }, { status: 400 });
        }
        const frameworkId = typeof body.frameworkId === "string" ? body.frameworkId : undefined;
        const wantStream = body.stream !== false;
        // "followup" routes to MODELS.followup (PRD FR-6.1-6.3 — same grounding rules as
        // the map, build plan §I step 1); anything else (including omitted) is the map.
        const mode = body.mode === "followup" ? "followup" : "map";
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "no-session";

        // Guard the dynamic imports + non-streaming path the same way retrieve.ts does —
        // a module-load hiccup here would otherwise fall through to the framework's
        // generic HTML error page instead of a clean JSON error (system design §15).
        let supabaseAdmin: Awaited<
          typeof import("@/integrations/supabase/client.server")
        >["supabaseAdmin"];
        let runPipeline: typeof import("@/server/pipeline/pipeline").runPipeline;
        let collectPipeline: typeof import("@/server/pipeline/pipeline").collectPipeline;
        let checkAndRecordRateLimit: typeof import("@/server/pipeline/rate-limit").checkAndRecordRateLimit;
        let clientIp: typeof import("@/server/pipeline/rate-limit").clientIp;
        let model: string | undefined;
        try {
          ({ supabaseAdmin } = await import("@/integrations/supabase/client.server"));
          ({ runPipeline, collectPipeline } = await import("@/server/pipeline/pipeline"));
          ({ checkAndRecordRateLimit, clientIp } = await import("@/server/pipeline/rate-limit"));
          if (mode === "followup") {
            ({ MODELS: { followup: model } } = await import("@/server/pipeline/config"));
          }

          // Rate limit BEFORE the expensive pipeline runs (build plan §I step 2) — a
          // refusal here is a 429, never a fabricated/degraded answer (system design §15).
          const rl = await checkAndRecordRateLimit(supabaseAdmin, sessionId, clientIp(request));
          if (!rl.allowed) {
            return json(
              {
                error:
                  rl.reason === "session"
                    ? "You've hit the request limit for this session. Please wait a few minutes and try again."
                    : "This network has hit the request limit. Please wait a while and try again.",
              },
              { status: 429 },
            );
          }

          if (!wantStream) {
            const result = await collectPipeline(supabaseAdmin, input, { frameworkId, model });
            return json(result);
          }
        } catch (err) {
          console.error("generate endpoint setup failed:", err);
          const message = err instanceof Error ? err.message : String(err);
          return json({ error: message }, { status: 500 });
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (obj: unknown) =>
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            try {
              for await (const ev of runPipeline(supabaseAdmin, input, { frameworkId, model })) {
                send(ev);
              }
            } catch (err) {
              // Never leave the stream on a fabricated partial answer — emit a clean
              // error event and close (system design §15).
              console.error("generate pipeline failed:", err);
              send({ type: "error", message: err instanceof Error ? err.message : String(err) });
              send({ type: "done" });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
          },
        });
      },
    },
  },
});
