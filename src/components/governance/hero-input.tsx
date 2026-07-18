/**
 * The hero input (PRD §8.1, design guidelines §5.1) — one free-text field accepting
 * either a system description or a direct question. Three example prompts defeat the
 * blank page and dismiss on focus. Empty submit gets an inline, friendly prompt —
 * never an error tone.
 */
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  {
    mode: "Describe your system" as const,
    text: "We score loan applicants with an ML model, using personal financial data, for EU customers.",
  },
  {
    mode: "Describe your system" as const,
    text: "We built a resume-screening tool that ranks job candidates before a recruiter sees them.",
  },
  {
    mode: "Ask a question" as const,
    text: "What does GDPR say about automated decisions that affect individuals?",
  },
];

export function HeroInput({
  onSubmit,
  disabled,
  initialValue = "",
}: {
  onSubmit: (input: string) => void;
  disabled: boolean;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [dismissedExamples, setDismissedExamples] = useState(initialValue.trim().length > 0);
  const [showEmptyPrompt, setShowEmptyPrompt] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setShowEmptyPrompt(true);
      return;
    }
    setShowEmptyPrompt(false);
    onSubmit(trimmed);
  };

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap gap-2">
        {(["Describe your system", "Ask a question"] as const).map((mode) => (
          <span
            key={mode}
            className="rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground"
          >
            {mode}
          </span>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setDismissedExamples(true)}
          rows={4}
          placeholder="Describe the AI system you're building, or ask a governance question…"
          disabled={disabled}
          className={cn(
            "resize-none border-border bg-card px-4 py-3.5 text-base shadow-none",
            "placeholder:text-muted-foreground/70",
          )}
        />

        {showEmptyPrompt && (
          <p className="mt-2 text-sm text-muted-foreground">
            Describe a system, or ask a question, to get started.
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Grounded in GDPR, the EU AI Act, NIST AI RMF, NIST CSF 2.0, and NIST SSDF.
          </p>
          <Button type="submit" disabled={disabled} className="shrink-0 shadow-none">
            Map obligations
          </Button>
        </div>
      </form>

      {!dismissedExamples && (
        <div className="mt-6 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Try an example
          </p>
          <div className="flex flex-col gap-2">
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setValue(ex.text);
                  setDismissedExamples(true);
                }}
                className="cursor-pointer rounded-md border border-border bg-card px-4 py-3 text-left text-sm text-foreground/90 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              >
                <span className="mr-2 text-xs font-medium text-muted-foreground">{ex.mode}:</span>
                {ex.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
