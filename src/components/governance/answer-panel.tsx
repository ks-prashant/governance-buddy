/**
 * Shared state-machine rendering for one turn of the pipeline (PRD §6.2, §8.4-§8.6) —
 * restated understanding, progressive loading, clarify/refusal/empty/error, or the
 * result map. Used by both the main hero flow and each follow-up turn (build plan §I
 * step 1, FR-6.3: follow-ups obey the same grounding/citation/refusal rules as the map,
 * so they render through the exact same states, not a relaxed "chat" variant).
 */
import type { Citation, ObligationStreamState } from "@/hooks/use-obligation-stream";
import { RestatedUnderstanding } from "./restated-understanding";
import { ProgressiveLoading } from "./progressive-loading";
import { ClarifyCard } from "./clarify-card";
import { RefusalCard } from "./refusal-card";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { ObligationMap } from "./obligation-map";
import { DecisionSupportLine } from "./decision-support-line";

export function AnswerPanel({
  state,
  originalInput,
  onOpenSource,
  onClarifyAnswer,
  onRefine,
  onRetry,
  onTryAgain,
  allowFollowUp = true,
}: {
  state: ObligationStreamState;
  originalInput: string;
  onOpenSource: (citation: Citation) => void;
  onClarifyAnswer: (answer: string) => void;
  onRefine: () => void;
  onRetry: () => void;
  onTryAgain: () => void;
  allowFollowUp?: boolean;
}) {
  return (
    <div className="space-y-6">
      {state.restatedUnderstanding && state.status !== "clarify" && (
        <RestatedUnderstanding text={state.restatedUnderstanding} onRefine={onRefine} />
      )}

      {state.status === "loading" && <ProgressiveLoading label={state.stageLabel ?? "Working…"} />}

      {state.status === "clarify" && state.clarifyQuestion && (
        <ClarifyCard
          question={state.clarifyQuestion}
          missingAttribute={state.missingAttribute}
          onAnswer={onClarifyAnswer}
        />
      )}

      {state.status === "refusal" && state.refusalMessage && (
        <RefusalCard message={state.refusalMessage} onTryAgain={onTryAgain} />
      )}

      {state.status === "empty" && state.emptyMessage && (
        <EmptyState message={state.emptyMessage} gaps={state.emptyGaps} onTryAgain={onTryAgain} />
      )}

      {state.status === "error" && (
        <ErrorState message={state.errorMessage ?? ""} onRetry={onRetry} />
      )}

      {state.status === "result" && state.result && (
        <div className="space-y-6">
          <DecisionSupportLine corpusAsOf={state.result.corpus_as_of} />
          <ObligationMap
            result={state.result}
            originalInput={originalInput}
            onOpenSource={onOpenSource}
            allowFollowUp={allowFollowUp}
          />
        </div>
      )}
    </div>
  );
}
