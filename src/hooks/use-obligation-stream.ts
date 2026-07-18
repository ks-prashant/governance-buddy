/**
 * Client-side consumer of the SSE stream from /api/generate (system design §8.1,
 * build plan §D step 4 / §F). Mirrors src/server/pipeline/pipeline.ts's `PipelineEvent`
 * union — kept as a local, client-only type rather than importing the server module,
 * so nothing server-only (env-reading config, the Supabase admin client) ever risks
 * being pulled into the browser bundle.
 *
 * Every terminal state is exactly one of: clarify, refusal, empty, result, or error
 * (system design §15) — never a partial fabricated answer.
 */
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";

export type ApplicabilityLabel = "Direct" | "Inferred" | "Possible";
export type ImpactLabel = "high" | "medium" | "low";
export type Tier = "applies" | "likely" | "possibly";

export interface Citation {
  chunk_id: string;
  framework: string;
  citation_label: string;
  hierarchy_path: string[];
  source_url: string | null;
}

export interface AssembledObligation {
  statement: string;
  rationale: string;
  applicability: ApplicabilityLabel;
  impact: ImpactLabel;
  tier: Tier;
  tier_score: number;
  citations: Citation[];
  conflicts_with?: Citation;
}

export interface AssembledResult {
  restated_understanding?: string;
  tiers: { applies: AssembledObligation[]; likely: AssembledObligation[]; possibly: AssembledObligation[] };
  gaps: string[];
  overall_confidence: "high" | "medium" | "low";
  framing: string;
  corpus_as_of: string;
}

type PipelineEvent =
  | { type: "understanding"; input_type: string; restated_understanding?: string }
  | { type: "stage"; label: string }
  | { type: "clarify"; question: string; missing_attribute?: string }
  | { type: "refusal"; message: string }
  | { type: "empty"; message: string; gaps: string[] }
  | { type: "result"; result: AssembledResult }
  | { type: "error"; message: string }
  | { type: "done" };

export type StreamStatus =
  | "idle"
  | "loading"
  | "clarify"
  | "refusal"
  | "empty"
  | "result"
  | "error";

export interface ObligationStreamState {
  status: StreamStatus;
  stageLabel: string | null;
  restatedUnderstanding: string | null;
  inputType: string | null;
  clarifyQuestion: string | null;
  missingAttribute: string | null;
  refusalMessage: string | null;
  emptyMessage: string | null;
  emptyGaps: string[];
  result: AssembledResult | null;
  errorMessage: string | null;
}

const INITIAL_STATE: ObligationStreamState = {
  status: "idle",
  stageLabel: null,
  restatedUnderstanding: null,
  inputType: null,
  clarifyQuestion: null,
  missingAttribute: null,
  refusalMessage: null,
  emptyMessage: null,
  emptyGaps: [],
  result: null,
  errorMessage: null,
};

/** Parse one SSE frame's `data: ...` lines into a PipelineEvent, tolerating multi-line data. */
function parseSseFrame(frame: string): PipelineEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join("\n")) as PipelineEvent;
  } catch {
    return null;
  }
}

export function useObligationStream() {
  const [state, setState] = useState<ObligationStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  const submit = useCallback(async (input: string, opts: { frameworkId?: string } = {}) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ ...INITIAL_STATE, status: "loading", stageLabel: "Reading your description…" });

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, frameworkId: opts.frameworkId, stream: true }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        setState((s) => ({
          ...s,
          status: "error",
          errorMessage: body.error ?? `Request failed (${res.status}).`,
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex: number;
        while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const ev = parseSseFrame(frame);
          if (!ev) continue;
          applyEvent(ev, setState);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((s) => ({
        ...s,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  return { state, submit, reset };
}

function applyEvent(
  ev: PipelineEvent,
  setState: Dispatch<SetStateAction<ObligationStreamState>>,
) {
  switch (ev.type) {
    case "understanding":
      setState((s) => ({
        ...s,
        inputType: ev.input_type,
        restatedUnderstanding: ev.restated_understanding ?? null,
      }));
      break;
    case "stage":
      setState((s) => ({ ...s, stageLabel: ev.label }));
      break;
    case "clarify":
      setState((s) => ({
        ...s,
        status: "clarify",
        clarifyQuestion: ev.question,
        missingAttribute: ev.missing_attribute ?? null,
      }));
      break;
    case "refusal":
      setState((s) => ({ ...s, status: "refusal", refusalMessage: ev.message }));
      break;
    case "empty":
      setState((s) => ({
        ...s,
        status: "empty",
        emptyMessage: ev.message,
        emptyGaps: ev.gaps,
      }));
      break;
    case "result":
      setState((s) => ({ ...s, status: "result", result: ev.result }));
      break;
    case "error":
      setState((s) => ({ ...s, status: "error", errorMessage: ev.message }));
      break;
    case "done":
      break;
  }
}
