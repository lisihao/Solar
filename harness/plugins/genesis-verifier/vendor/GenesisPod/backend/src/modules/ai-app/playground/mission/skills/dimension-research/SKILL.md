---
name: dimension-research
description: Single-dimension efficient research protocol — bounded search rounds, source-traceable findings, figure red-lines
version: "1.0.0"
tags:
  - research
  - data-collection
  - per-dimension
  - efficiency
allowedTools:
  - rag-search
  - web-search
  - fetch
  - parallel_tool_call
activateFor:
  - researcher
  - dimension-researcher
  - per-dim-collector
---

# Dimension Research Protocol

You collect evidence for **one dimension** of a multi-dim mission. Stay efficient —
do NOT iterate beyond what's needed. Other dims run in parallel.

## Inputs you receive

- `topic`, `dimension` (the one you own), `language`
- `toolHint.categories` and optional `toolHint.preferIds`
- `<available_tools>` block listing the tool catalog

## Workflow (4 phases, each at most one round)

### Phase 1 — Internal knowledge probe (optional)

If the tool catalog includes a `rag-search`:

- Issue ONE rag-search query to see if internal knowledge already covers the dim
- If high-quality hits → skip phase 2, go to phase 3
- If thin / outdated → continue to phase 2

### Phase 2 — One specialized search round

- Emit ONE `parallel_tool_call` with 2–4 search queries
- Vary terminology / angle; do NOT repeat the same query verbatim
- Prefer the categories in `toolHint.categories`

### Phase 3 — At most one scrape/parse round

- Pick the 2–4 highest-value URLs from phase 1/2 results
- One round of `fetch` to retrieve full content
- Do not chain fetch → fetch → fetch — pick well, fetch once

### Phase 4 — Finalize

Emit:

```json
{
  "kind": "finalize",
  "output": {
    "dimension": "<the dim id>",
    "findings": [
      {
        "claim": "<specific, falsifiable assertion>",
        "evidence": "<short verbatim quote from source>",
        "source": "<URL or citation>"
      }
      // 4-5 findings ideal
    ],
    "summary": "<one-paragraph synthesis of the dim>",
    "figureCandidates": [
      /* optional, see figure red lines below */
    ]
  }
}
```

## Hard constraints

- **Target 4–5 findings** — quality over quantity. Don't pad.
- **1 short evidence quote per finding** — not a multi-paragraph block
- **Each finding has a real, fetchable source** — fabricated URLs are dereliction
- **Stay within the dim** — drift to neighboring dims is rejected by the reconciler
- **Stop when you have enough** — extra search rounds waste budget without adding evidence

## Figure red lines (4 rules — never violate)

When extracting figure candidates from sources, every `figureCandidate` MUST satisfy:

1. **No fabrication** — never invent figure URLs or generate "this would be a great chart"
2. **No stock photos** — generic stock imagery is rejected; only data-bearing figures count
3. **No AI-generated illustrations** — rejected at the verifier
4. **Real source URL** — `https://` only; the URL must be fetchable

If a dim has no genuine figure candidates → `figureCandidates: []`. Empty is correct.

## What this skill is NOT

- Not for cross-dim reconciliation (`cross-dim-fact-check` does that)
- Not for synthesizing a final report (writer does that)
- Not for self-grading (reviewer does that)

This skill produces **one dim's findings + figure candidates**. N parallel
researcher calls produce N independent dim outputs that the reconciler aligns.
