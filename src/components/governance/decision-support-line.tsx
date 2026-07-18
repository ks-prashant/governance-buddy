/**
 * "Decision support, not legal advice" (PRD §8.7 FR-7.2, design guidelines §5.13) —
 * appears with every generated result, at the point of answer, not only in a footer.
 */
export function DecisionSupportLine({ corpusAsOf }: { corpusAsOf?: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      Decision support, not legal advice.
      {corpusAsOf && <span> Corpus as of {corpusAsOf}.</span>}
    </p>
  );
}
