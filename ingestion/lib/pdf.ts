/**
 * PDF text extraction for the ingestion pipeline. Deterministic and swappable.
 *
 * Uses poppler/xpdf `pdftotext` (reading-order, UTF-8, unix EOL) because it produces
 * clean, stable text for these legal/framework PDFs. This is a build-time system
 * dependency for local ingestion only (never shipped to the app). If it needs to be
 * portable later, swap this one function for a JS lib (unpdf/pdfjs) — the parsers
 * depend only on `extractText`.
 */
import { spawnSync } from "node:child_process";

export function extractText(pdfPath: string): string {
  const res = spawnSync(
    "pdftotext",
    ["-enc", "UTF-8", "-eol", "unix", "-nopgbrk", pdfPath, "-"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    throw new Error(
      `pdftotext failed for ${pdfPath} (status ${res.status}). ` +
        `Ensure poppler/xpdf 'pdftotext' is installed and on PATH.\n${res.stderr ?? ""}`,
    );
  }
  return res.stdout;
}
