#!/usr/bin/env node
// Grounded Governance — Phase C retrieval-hit-rate check (build plan §C acceptance gate).
//
// Measures retrieval ALONE (no generation yet — Phase D) against the /api/retrieve
// diagnostic endpoint: for each golden item whose expected_citations are entirely
// within a given framework (default GDPR, since only GDPR is ingested in Phase C),
// checks whether every expected anchor appears among the retrieved+reranked chunks.
//
// Usage: node check_retrieval.mjs [baseUrl] [framework]
//   node check_retrieval.mjs https://your-preview.lovable.app GDPR

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseUrl = process.argv[2] ?? "http://localhost:8080";
const framework = process.argv[3] ?? "GDPR";

const lines = readFileSync(resolve(__dirname, "golden_set.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean);
const items = lines.map((l) => JSON.parse(l));

const scoped = items.filter(
  (it) =>
    (it.expected_citations ?? []).length > 0 &&
    it.expected_citations.every((c) => c.framework === framework),
);

/** "Article 22(1)" -> candidate citation_labels ["Art. 22(1)", "Art. 22"].
 *  Handles point-level anchors (drop trailing letter point -> paragraph chunk),
 *  and ranges ("Article 5(1)-(2)") by producing candidates for both ends. */
function anchorToLabels(anchor) {
  const m = /^Article (\d+)(?:\((\d+)\))?(?:\([a-z]\))?(?:-(?:\((\d+)\))?(?:\([a-z]\))?)?$/.exec(
    anchor,
  );
  if (!m) return [];
  const [, art, para1, para2] = m;
  const labels = new Set([`Art. ${art}`]);
  if (para1) labels.add(`Art. ${art}(${para1})`);
  if (para2) labels.add(`Art. ${art}(${para2})`);
  return [...labels];
}

async function retrieve(input) {
  const res = await fetch(`${baseUrl}/api/retrieve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`retrieve failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

function retrievedLabels(result) {
  const labels = new Set();
  for (const r of result.reranked ?? []) labels.add(r.citation_label);
  for (const p of result.parents ?? []) {
    labels.add(p.citation_label);
    for (const c of p.supporting_chunks ?? []) labels.add(c.citation_label);
  }
  return labels;
}

async function main() {
  console.log(`Retrieval-hit-rate check — ${framework} subset (${scoped.length} items) @ ${baseUrl}\n`);
  let hits = 0;
  const rows = [];

  for (const item of scoped) {
    let result;
    try {
      result = await retrieve(item.input);
    } catch (e) {
      rows.push({ id: item.id, ok: false, note: `error: ${e.message}` });
      continue;
    }
    if (result.clarify) {
      rows.push({ id: item.id, ok: false, note: "unexpected clarifying question" });
      continue;
    }
    const retrieved = retrievedLabels(result);
    const expectedAnchors = item.expected_citations.map((c) => c.anchor);
    const perAnchor = expectedAnchors.map((a) => {
      const candidates = anchorToLabels(a);
      const found = candidates.some((c) => retrieved.has(c));
      return { anchor: a, found };
    });
    const allFound = perAnchor.every((p) => p.found);
    if (allFound) hits++;
    rows.push({
      id: item.id,
      ok: allFound,
      note: perAnchor.map((p) => `${p.anchor}:${p.found ? "✓" : "✗"}`).join(" "),
    });
  }

  for (const r of rows) console.log(`  ${r.ok ? "✓" : "✗"} ${r.id}  ${r.note}`);
  const rate = scoped.length ? hits / scoped.length : 0;
  console.log(`\nretrieval-hit-rate: ${hits}/${scoped.length} = ${(rate * 100).toFixed(1)}%`);
  process.exit(rate >= 0.9 ? 0 : 1);
}

main().catch((e) => {
  console.error("check_retrieval failed:", e);
  process.exit(1);
});
