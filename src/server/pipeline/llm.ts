/**
 * Single LLM wrapper around the Anthropic Messages API. Every model call in the
 * pipeline goes through here so routing, prompt-caching, and (later) structured
 * output / Citations are configured in exactly one place (build plan §A.5).
 *
 * SERVER-ONLY. Reads ANTHROPIC_API_KEY. Never import into client code.
 *
 * Dependency-light on purpose (uses fetch, no SDK) so it runs unchanged in the
 * TanStack/Nitro server runtime. Swap to @anthropic-ai/sdk later if desired —
 * the `llm()` signature is the seam that keeps that change local.
 */
import { requireEnv } from "./config";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** A system prompt: a plain string, or blocks so a stable prefix can be cache-controlled. */
export type SystemPrompt =
  | string
  | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmOptions {
  model: string;
  system?: SystemPrompt;
  messages: LlmMessage[];
  maxTokens: number;
  /** Adaptive thinking effort. Omit to disable extended thinking. */
  effort?: "low" | "medium" | "high";
  temperature?: number;
  stopSequences?: string[];
  /** Abort/timeout signal — the orchestrator budgets per-stage timeouts (system design §8.3). */
  signal?: AbortSignal;
}

export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface LlmResult {
  text: string;
  usage: LlmUsage;
  stopReason: string | null;
  raw: unknown;
}

/**
 * Call the Anthropic Messages API. Returns concatenated text output plus usage
 * (check `usage.cache_read_input_tokens > 0` to verify prompt-cache hits — system
 * design §8.2). Structured-output and Citations variants are layered in Phase 3
 * (system design §7); they are deliberately separate calls (§4.5).
 */
export async function llm(opts: LlmOptions): Promise<LlmResult> {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    messages: opts.messages,
  };
  if (opts.system !== undefined) body.system = opts.system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.stopSequences) body.stop_sequences = opts.stopSequences;
  if (opts.effort) {
    // Extended thinking with an effort hint. The map step runs at effort:high.
    body.thinking = { type: "enabled", effort: opts.effort };
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: LlmUsage;
    stop_reason?: string | null;
  };

  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");

  return {
    text,
    usage: data.usage ?? { input_tokens: 0, output_tokens: 0 },
    stopReason: data.stop_reason ?? null,
    raw: data,
  };
}
