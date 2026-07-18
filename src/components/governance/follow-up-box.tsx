/**
 * A follow-up question, scoped or general (PRD §8.6 FR-6.1/6.2). Owns its own
 * pipeline turn — same grounding, citation, and refusal rules as the map (FR-6.3),
 * rendered through the same AnswerPanel states. Context (the original description,
 * and for a scoped follow-up the specific obligation) is composed client-side into the
 * submitted text rather than kept as server-side session memory, consistent with the
 * stateless-server design (system design §10 principle #7 — nothing retained server-side).
 */
import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { useObligationStream, type Citation } from "@/hooks/use-obligation-stream";
import { track } from "@/lib/analytics";
import { AnswerPanel } from "./answer-panel";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function FollowUpBox({
  contextText,
  placeholder,
  onOpenSource,
  compact = false,
}: {
  contextText: string;
  placeholder: string;
  onOpenSource: (citation: Citation) => void;
  compact?: boolean;
}) {
  const { state, submit, reset } = useObligationStream();
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState(false);

  const composeAndSubmit = (q: string) => {
    const composed = `${contextText}\n\nFollow-up question: ${q}`;
    track("follow_up");
    submit(composed, { mode: "followup" });
  };

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setAsked(true);
    composeAndSubmit(question.trim());
  };

  const handleClarifyAnswer = (answer: string) => {
    composeAndSubmit(`${question.trim()}\n\n${answer}`);
  };

  const askAnother = () => {
    reset();
    setAsked(false);
    setQuestion("");
  };

  if (!asked) {
    return (
      <form onSubmit={handleAsk} className={compact ? "mt-3" : ""}>
        <div className="flex items-center gap-2">
          <MessageSquarePlus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={placeholder}
            rows={1}
            className="min-h-9 flex-1 resize-none border-border bg-background py-1.5 text-sm shadow-none"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!question.trim()} className="shrink-0 shadow-none">
            Ask
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className={compact ? "mt-3 border-l-2 border-border pl-3" : ""}>
      <p className="mb-2 text-xs font-medium text-muted-foreground">You asked: {question}</p>
      <AnswerPanel
        state={state}
        originalInput={contextText}
        onOpenSource={onOpenSource}
        onClarifyAnswer={handleClarifyAnswer}
        onRefine={askAnother}
        onRetry={() => composeAndSubmit(question.trim())}
        onTryAgain={askAnother}
        allowFollowUp={false}
      />
      {state.status === "result" && (
        <Button variant="ghost" size="sm" className="mt-3 shadow-none" onClick={askAnother}>
          Ask another follow-up
        </Button>
      )}
    </div>
  );
}
