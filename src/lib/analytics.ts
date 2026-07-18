/**
 * Client-side analytics (PRD §14, build plan §H step 3) — fire-and-forget, anonymous.
 * `sessionId()` is a random id kept only in sessionStorage (cleared when the tab
 * closes, never tied to identity). `track()` never sends the user's description or
 * question text — only structured, low-cardinality payload fields.
 */
const SESSION_KEY = "gg_session_id";

export function sessionId(): string {
  if (typeof window === "undefined") return "server";
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "unavailable";
  }
}

export type AnalyticsEvent =
  | "map_completed"
  | "clarifying_question"
  | "citation_click"
  | "follow_up"
  | "refusal"
  | "empty"
  | "error";

export function track(eventType: AnalyticsEvent, payload: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  fetch("/api/analytics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id: sessionId(), event_type: eventType, payload }),
    keepalive: true,
  }).catch(() => {
    // Best-effort — a dropped analytics call must never affect the product flow.
  });
}
