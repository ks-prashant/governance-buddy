/**
 * Grounded-generation pipeline seams (server-only).
 *
 * The staged pipeline (system design §2): query understanding → retrieval →
 * grounded generation → citation validation → assembly. These modules are the
 * swap points; pipeline logic (added in Phases 2–4) imports from here.
 */
export * from "./config";
export * from "./llm";
export * from "./embed";
export * from "./rerank";
