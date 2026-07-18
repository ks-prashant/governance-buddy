/**
 * Sufficiency / clarifying question (PRD §8.2, design guidelines §5.2). Exactly one
 * targeted question, framed as a colleague clarifying, never a form or an interrogation.
 * Answering appends the reply to the original description and resubmits — the product
 * never silently invents the missing attribute.
 */
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function ClarifyCard({
  question,
  missingAttribute,
  onAnswer,
}: {
  question: string;
  missingAttribute: string | null;
  onAnswer: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState("");

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        One quick question before mapping this
      </p>
      <p className="mt-2 text-base leading-relaxed text-foreground">{question}</p>
      {missingAttribute && (
        <p className="mt-1 text-xs text-muted-foreground">
          To map this reliably, the assistant needs a signal on: {missingAttribute}.
        </p>
      )}
      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (answer.trim()) onAnswer(answer.trim());
        }}
      >
        <Textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Your answer…"
          rows={2}
          className="flex-1 resize-none border-border bg-background shadow-none"
        />
        <Button type="submit" disabled={!answer.trim()} className="shadow-none sm:self-end">
          Continue
        </Button>
      </form>
    </div>
  );
}
