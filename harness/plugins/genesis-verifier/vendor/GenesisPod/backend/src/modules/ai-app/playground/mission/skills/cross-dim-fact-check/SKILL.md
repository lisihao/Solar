---
name: cross-dim-fact-check
description: Cross-dimension reconciliation protocol — extract fact table, detect conflicts/overlaps/gaps, build figure candidate pool from N parallel research streams
version: "1.0.0"
tags:
  - reconciliation
  - fact-checking
  - quality
  - research
allowedTools:
  - web-search
  - fetch
  - rag-search
activateFor:
  - reconciler
  - fact-checker
  - cross-dim-reviewer
---

# Cross-Dimension Fact Reconciliation Protocol

When N parallel research streams have completed and downstream synthesis (analyst / writer)
is about to start, run this reconciliation pass. **Do NOT produce new research** — your job
is to align, deduplicate, and surface conflicts.

## Inputs you will receive

- `topic` and `language`
- `plan.dimensions[]` — what each stream was supposed to cover
- `researcherResults[]` — per-dimension findings + figureCandidates

## 5-step protocol (execute in order)

### Step 1 — Extract fact table

Scan all findings, distill `(entity, attribute, value, sources[])` triples.

- `sources` is a list of URL or finding-source strings — multiple sources increase confidence
- Each fact gets a stable id like `fact-1`, `fact-2`, ...
- Aim for **≥ 3 facts** total (mission must surface core evidence)

### Step 2 — Detect conflicts

Same `(entity, attribute)` with different values → flag as conflict.

- `resolutionType`:
  - `preferred-one` — one source clearly more credible (gov / academic > blog) → set `preferredFactId`
  - `kept-both` — sources equally credible → keep both with annotation
  - `flagged-unresolved` — only when no info available to decide (rare; ≤ 30% of conflicts)
- `rationale` ≥ 20 characters explaining the decision

### Step 3 — Detect overlaps

Cross-dim claims with similar meaning (semantic, not exact-match).

- `similarityScore` 0–1 (judge by reading; you don't run embeddings)
- `resolutionAction`:
  - `merge-into-cross-dim` — core finding shared across dims → write once in cross-dim section
  - `keep-both` — different angle on same topic → keep in respective dims
  - `drop-from-second` — verbatim duplicate → keep in primary dim only

### Step 4 — Detect gaps

`plan.dimensions[i].rationale` promised aspects that findings don't cover.

- `severity: "critical"` if gap breaks the dim's purpose
- `severity: "minor"` if peripheral

### Step 5 — Aggregate figure candidate pool

Aggregate `researcherResults[*].figureCandidates` into a single deduplicated array.

- Deduplicate by `sourceUrl` — keep the entry with highest `relevanceHint`
- Cap at **20 figures** total (rank by `relevanceHint=high` first, then caption informativeness)
- **NEVER fabricate figures** — only aggregate what researchers actually extracted
- Empty array is acceptable — prefer correctness over coverage

## Reconciliation report (≤ 1500 chars markdown)

```
### 对账总览
- 事实表概要 (count + key entities)
- 冲突 (each conflict + resolution + rationale snippet)
- 重叠 (each overlap + action)
- 空白 (each gap + severity)
- 下游消费指引 (one-line guidance for Analyst/Writer)
```

Downstream Analyst & Writer **MUST** consume this — be precise and quotable.

**Heading discipline**: this report becomes the cross-dim chapter body when the
analyst skips `crossDimAnalysis`. The chapter title `## 跨维度分析` is added by
the report assembler, so **never use `# ` or `## ` headings inside this report**
— they would split into top-level chapters in the rendered report. Use `### `
or list bullets for sub-sections.

## Hard rules (never violate)

- `factTable.length ≥ 3`
- `conflicts[i].rationale.length ≥ 20`
- `flagged-unresolved` ≤ 30% of conflicts
- `figureCandidates.length ≤ 20`
- Every `factTable[i].id` is unique
- Every `conflict.factIds[j]` references a real `factTable[].id`
- Every `figure.evidenceCitationIndex` is set and points to a citation
- Every `figure.sourceUrl` starts with `https://`
- If two facts share `(entity, attribute)` they MUST appear in some `conflict.factIds`

## What this skill is NOT

- Not for generating new research findings (that's the researcher's job)
- Not for writing the final report (that's the writer's job)
- Not for evaluating overall quality (that's the reviewer's job)

This is an **alignment** pass — it fails fast if the inputs are inconsistent or thin,
and it stays silent (`gaps: []`) when the inputs are well-covered.
