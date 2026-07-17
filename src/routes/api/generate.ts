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
        let body: { input?: unknown; frameworkId?: unknown; stream?: unknown };
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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runPipeline, collectPipeline } = await import("@/server/pipeline/pipeline");

        if (!wantStream) {
          const result = await collectPipeline(supabaseAdmin, input, { frameworkId });
          return json(result);
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (obj: unknown) =>
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            try {
              for await (const ev of runPipeline(supabaseAdmin, input, { frameworkId })) {
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
