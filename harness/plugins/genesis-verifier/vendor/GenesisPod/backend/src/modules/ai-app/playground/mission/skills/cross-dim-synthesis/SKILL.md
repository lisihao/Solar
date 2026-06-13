---
name: cross-dim-synthesis
description: Cross-dimension synthesis — produce insights spanning ≥ 2 dims, resolve contradictions surfaced by reconciliation, output theme summary
version: "1.0.0"
tags:
  - synthesis
  - analysis
  - cross-dim
  - insights
allowedTools:
  - rag-search
  - web-search
activateFor:
  - analyst
  - cross-dim-synthesizer
  - insights-generator
---

# Cross-Dimension Synthesis Protocol

After researchers collect per-dim findings and the reconciler aligns them, you
synthesize **cross-cutting insights** that no single dim could produce alone.
You also resolve the contradictions the reconciler surfaced.

## Inputs you receive

- `topic`, `language`
- `researcherResults[]` — per-dim findings (claim / evidence / source) + summary
- `reconciliationReport` (optional but typical):
  - `factTable[]` — canonical (entity, attribute, value, sources[]) triples
  - `conflicts[]` — `(factIds, resolutionType, preferredFactId?, rationale)`
  - `overlaps[]`, `gaps[]`, `termGlossary[]`

## 3 outputs (mandatory)

### 1. `insights[]`

Cross-dim judgments spanning ≥ 2 dimensions. Each insight has:

- `headline` — one-sentence assertion (the insight itself)
- `narrative` — paragraph explaining the reasoning, citing specific findings
- `supportingDimensions[]` — list of dim names that contributed (length ≥ 2)
- `confidence` — 0..1 calibrated estimate

Calibration anchors:

- `0.9–1.0` — multiple primary sources align across dims; no plausible counter-reading
- `0.6–0.8` — strong but with one notable caveat (timing / scope / source quality)
- `0.3–0.5` — directional but evidence is thin or sources have known bias
- `< 0.3` — speculative; should probably go to `whatRemainsUnclear` instead

### 2. `contradictions[]`

For every reconciler `conflict` (and any new ones you spot):

- `claim` — the contested assertion
- `conflictingSources[]` — the conflicting source URLs / IDs
- `resolution` — how YOU resolve it (≥ 30 chars). Acceptable resolutions:
  - "Source A is more authoritative because [X] — adopt A's value"
  - "Both readings are valid in different contexts — A applies to context X, B to Y"
  - "Neither source is conclusive — flag as open question; note in `whatRemainsUnclear`"

**Never leave a contradiction unresolved** — `"resolution": "TBD"` or `"待定"` is rejected.

### 3. `themeSummary`

One paragraph (≤ 800 chars) framing the dominant narrative the insights tell
together. This becomes the writer's anchor for chapter sequencing.

## Hard rules (never violate)

- Every `insight.supportingDimensions.length ≥ 2` — single-dim observations
  are NOT insights, they're findings (already in `researcherResults`)
- Do NOT copy a `finding.claim` verbatim as an insight — synthesize, don't restate
- Every reconciler `conflict` must appear in your `contradictions[]` with a
  concrete `resolution`
- Use `termGlossary` canonical forms — don't write "AI" in some insights and
  "人工智能" in others when the glossary unifies them
- `confidence` calibration matters — overconfident insights drag the report's
  trustworthiness; under-confident ones get filtered out by the writer

## What this skill is NOT

- Not for collecting new findings (that's the researcher's job)
- Not for fact alignment (that's `cross-dim-fact-check`)
- Not for chapter writing (that's the writer's job)
- Not for grading the synthesis (that's the reviewer's job)

This skill produces **the analytic spine** of the report — insights + resolved
contradictions + theme summary. The writer uses this to decide chapter sequence
and load-bearing arguments.
