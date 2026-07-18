/**
 * Ingestion orchestrator (build plan §B step 6 + §E step 2, §J "promote only on clean validation").
 *
 * Reads each framework's committed parse artifact (corpus-build/<fw>.json), runs the
 * validation gate on ALL of them first, and only if EVERY requested framework validates
 * cleanly embeds + loads them into ONE combined snapshot and promotes it once. A single
 * framework that fails validation aborts the whole load — a snapshot is never partially
 * promoted (§J "promote only on a clean validation").
 *
 * Run (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY in the environment —
 * in practice Lovable's sandbox, where the service-role key lives; see SYSTEM_DESIGN §5.5):
 *   bun ingestion/run.ts                                            # defaults to gdpr
 *   bun ingestion/run.ts gdpr eu_ai_act nist_csf nist_ssdf nist_ai_rmf   # full Phase E snapshot
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFrameworks } from "./load";
import { validateFramework } from "./validate";
import type { ParsedFramework } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

async function main() {
  const frameworks = process.argv.slice(2);
  if (frameworks.length === 0) frameworks.push("gdpr");

  const goldenLines = readFileSync(resolve(repoRoot, "evals/golden_set.jsonl"), "utf8").split("\n");

  // 1. Parse + validate ALL requested frameworks first — fail before touching the DB.
  const parsedList: ParsedFramework[] = [];
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
      console.error(`  Refusing to load — no snapshot promoted. First error: ${v.errors[0]}`);
      process.exit(1);
    }
    parsedList.push(parsed);
  }

  // 2. All clean → embed + load into ONE snapshot, promote once.
  console.log(
    `loading ${parsedList.length} framework(s) into one snapshot ` +
      `(embedding via ${process.env.EMBEDDING_MODEL ?? "voyage-3-large"})…`,
  );
  const r = await loadFrameworks(parsedList);
  for (const f of r.per_framework) console.log(`  ${f.framework_id}: ${f.parents} parents, ${f.chunks} chunks`);
  console.log(
    `✓ snapshot ${r.snapshot_id}: ${r.parents} parents, ${r.chunks} chunks total — promoted active`,
  );
}

main().catch((e) => {
  console.error("Ingestion failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
