import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useObligationStream, type Citation } from "@/hooks/use-obligation-stream";
import { track } from "@/lib/analytics";
import { CorpusIndicator } from "@/components/governance/corpus-indicator";
import { DecisionSupportLine } from "@/components/governance/decision-support-line";
import { HeroInput } from "@/components/governance/hero-input";
import { ProgressiveLoading } from "@/components/governance/progressive-loading";
import { RestatedUnderstanding } from "@/components/governance/restated-understanding";
import { ClarifyCard } from "@/components/governance/clarify-card";
import { RefusalCard } from "@/components/governance/refusal-card";
import { EmptyState } from "@/components/governance/empty-state";
import { ErrorState } from "@/components/governance/error-state";
import { ObligationMap } from "@/components/governance/obligation-map";
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
          <Link to="/evaluation" className="text-xs font-medium text-muted-foreground hover:text-primary">
            Evaluation
          </Link>
          <a
            href="mailto:prashant.dpsrkp@gmail.com"
            className="text-xs font-medium text-muted-foreground hover:text-primary"
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

            {state.restatedUnderstanding && state.status !== "clarify" && (
              <RestatedUnderstanding text={state.restatedUnderstanding} onRefine={handleRefine} />
            )}

            {state.status === "loading" && (
              <ProgressiveLoading label={state.stageLabel ?? "Working…"} />
            )}

            {state.status === "clarify" && state.clarifyQuestion && (
              <ClarifyCard
                question={state.clarifyQuestion}
                missingAttribute={state.missingAttribute}
                onAnswer={handleClarifyAnswer}
              />
            )}

            {state.status === "refusal" && state.refusalMessage && (
              <RefusalCard message={state.refusalMessage} onTryAgain={startOver} />
            )}

            {state.status === "empty" && state.emptyMessage && (
              <EmptyState
                message={state.emptyMessage}
                gaps={state.emptyGaps}
                onTryAgain={startOver}
              />
            )}

            {state.status === "error" && (
              <ErrorState message={state.errorMessage ?? ""} onRetry={() => submit(lastInput)} />
            )}

            {state.status === "result" && state.result && (
              <div className="space-y-6">
                <DecisionSupportLine corpusAsOf={state.result.corpus_as_of} />
                <ObligationMap result={state.result} onOpenSource={handleOpenSource} />
              </div>
            )}
          </div>
        )}
      </div>

      <SourceViewer citation={openCitation} onClose={() => setOpenCitation(null)} />
    </main>
  );
}
