/**
 * Ingestion orchestrator (build plan §B step 6, §J "promote only on clean validation").
 *
 * For each framework: read its committed parse artifact (corpus-build/<fw>.json),
 * run the validation gate, and only on a clean validation embed + load + promote it.
 *
 * Run (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY in .env.local):
 *   bun ingestion/run.ts            # defaults to gdpr
 *   bun ingestion/run.ts gdpr eu_ai_act
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFramework } from "./load";
import { validateFramework } from "./validate";
import type { ParsedFramework } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

async function main() {
  const frameworks = process.argv.slice(2);
  if (frameworks.length === 0) frameworks.push("gdpr");

  const goldenLines = readFileSync(resolve(repoRoot, "evals/golden_set.jsonl"), "utf8").split("\n");

  for (const fw of frameworks) {
    const parsed = JSON.parse(
      readFileSync(resolve(repoRoot, `corpus-build/${fw}.json`), "utf8"),
    ) as ParsedFramework;

    const v = validateFramework(parsed, goldenLines);
    console.log(
      `${fw}: validation ${v.ok ? "PASS" : "FAIL"} ` +
        `(${v.anchorHits}/${v.anchorTotal} golden anchors, ${v.errors.length} errors)`,
    );
    if (!v.ok) {
      console.error(`  Refusing to load ${fw} — snapshot not promoted. First error: ${v.errors[0]}`);
      process.exit(1);
    }

    console.log(`  loading ${fw} (embedding via ${process.env.EMBEDDING_MODEL ?? "voyage-3-large"})…`);
    const r = await loadFramework(parsed);
    console.log(`  ✓ snapshot ${r.snapshot_id}: ${r.parents} parents, ${r.chunks} chunks — promoted active`);
  }
}

main().catch((e) => {
  console.error("Ingestion failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
