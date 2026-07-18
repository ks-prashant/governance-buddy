import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useObligationStream, type Citation } from "@/hooks/use-obligation-stream";
import { track } from "@/lib/analytics";
import { CorpusIndicator } from "@/components/governance/corpus-indicator";
import { HeroInput } from "@/components/governance/hero-input";
import { AnswerPanel } from "@/components/governance/answer-panel";
import { SourceViewer } from "@/components/governance/source-viewer";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { state, submit, reset } = useObligationStream();
  const [lastInput, setLastInput] = useState("");
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);

  const started = state.status !== "idle";

  const startOver = () => {
    reset();
    setLastInput("");
  };

  const handleSubmit = (input: string) => {
    setLastInput(input);
    submit(input);
  };

  const handleClarifyAnswer = (answer: string) => {
    const combined = `${lastInput}\n\n${answer}`;
    setLastInput(combined);
    submit(combined);
  };

  const handleRefine = () => {
    // Deliberately don't clear lastInput — the hero field re-mounts pre-filled with it
    // (PRD §6.1 Step 4: refine is an edit, not a restart).
    reset();
  };

  const handleOpenSource = (citation: Citation) => {
    track("citation_click", { framework: citation.framework, citation_label: citation.citation_label });
    setOpenCitation(citation);
  };

  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 pt-8 sm:px-6">
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Grounded Governance
        </span>
        <div className="flex items-center gap-4">
          <Link
            to="/evaluation"
            className="rounded-sm text-xs font-medium text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            Evaluation
          </Link>
          <a
            href="mailto:prashant.dpsrkp@gmail.com"
            className="rounded-sm text-xs font-medium text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            Contact
          </a>
          <CorpusIndicator />
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        {!started && (
          <>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Know what applies. See where it's written.
            </h1>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
              Describe the AI system you're building. Get a prioritized, source-cited map of the
              governance obligations that apply to it — grounded in primary sources, honest about
              the gaps, and verifiable in one click.
            </p>
            <div className="mt-8">
              <HeroInput onSubmit={handleSubmit} disabled={false} initialValue={lastInput} />
            </div>
          </>
        )}

        {started && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{lastInput}</p>
              <Button variant="ghost" size="sm" className="shrink-0 shadow-none" onClick={startOver}>
                Start over
              </Button>
            </div>

            <AnswerPanel
              state={state}
              originalInput={lastInput}
              onOpenSource={handleOpenSource}
              onClarifyAnswer={handleClarifyAnswer}
              onRefine={handleRefine}
              onRetry={() => submit(lastInput)}
              onTryAgain={startOver}
            />
          </div>
        )}
      </div>

      <SourceViewer citation={openCitation} onClose={() => setOpenCitation(null)} />
    </main>
  );
}
