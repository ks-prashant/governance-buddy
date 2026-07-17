# Corpus — source frameworks (input to ingestion)

Five authoritative frameworks, chosen so the product answers questions no single
document can (PRD §5). This is a **dated snapshot**; each ingested unit carries a
framework version and snapshot date shown to the user.

| File | Framework | Governance dimension | Citation-anchor shape |
|---|---|---|---|
| `gdpr.pdf` | GDPR | Privacy regulation | `Art. 22(2)(a)`, Recitals |
| `eu-ai-act.pdf` | EU AI Act | AI regulation | `Art. 9`, `Annex III(5)(b)` |
| `nist-ai-rmf.pdf` | NIST AI RMF 1.0 | AI risk management | `MAP 1.1`, §3.x characteristics |
| `nist-csf-2.0.pdf` | NIST CSF 2.0 | Cybersecurity governance | `PR.DS-01` |
| `nist-ssdf.pdf` | NIST SSDF | Secure software development | `PW.4.1` |

These PDFs are the **input** to the ingestion pipeline (`/ingestion`). The reviewable,
auditable parse output (structured JSON, no embeddings) is committed under
`/corpus-build`. Snapshots are immutable once promoted (system design §5.5).
