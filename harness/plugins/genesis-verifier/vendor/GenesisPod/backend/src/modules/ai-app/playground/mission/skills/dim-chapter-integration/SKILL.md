---
name: dim-chapter-integration
description: Per-dim chapter integration — knit N chapter drafts into a coherent dim section with transitions, dedup, and a closing takeaway
version: "1.0.0"
tags:
  - writing
  - integration
  - per-dimension
  - cohesion
activateFor:
  - writer
  - dim-integrator
  - chapter-knitter
---

# Dimension Chapter Integration Protocol

You merge N parallel-drafted chapters into a single coherent dim section. The
inputs are good chapters; your job is **flow, dedup, and a closing line**.

## Inputs you receive

- `dimensionName` — which dim's chapters you're knitting
- `chapters[]` — each with `index`, `heading`, `wordCount`, `body`

## Integration rules (do all four)

### 1. Transitional sentences

- Between consecutive chapters, add a 1–2 sentence transition that links them
- Transitions name the **substantive** connection (cause → effect, contrast,
  generalization, etc.) — not "additionally" / "moreover" filler

### 2. Deduplication

- When multiple chapters cite the same fact, **keep only the strongest citation**
  (primary source > secondary; recent > old; quantitative > qualitative)
- Drop the redundant restatement; preserve the strongest version inline

### 3. First chapter as the dim opener

- The first chapter's opening becomes the dim's opener — preserve its framing role
- Do not insert a meta-introduction before it ("This dimension covers...")

### 4. Closing takeaway paragraph

- Last paragraph (≤ 5 sentences) summarizes the dim's **core takeaway**
- Tie back to the dim's `rationale` if known
- Do NOT use templated closings like "综上所述" / "in summary"

## Preserve chapter sub-headings

Keep each original chapter heading as a `###` subheading inside the integrated body.
This lets downstream Reviewer trace which chapter each claim came from.

## Output JSON shape

```json
{
  "mode": "integrate",
  "dimensionName": "<dim name>",
  "integratedBody": "<coherent markdown with ### subheadings + transitions>",
  "totalWordCount": <int>,
  "sources": ["<unique source URLs>", "..."]
}
```

## Hard rules

- `integratedBody` must contain every chapter's `###` heading exactly once
- `sources[]` must be the deduplicated union of all chapter sources
- `totalWordCount` matches actual `integratedBody` word count (± 5%)
- Don't drop chapters — every input chapter contributes to the output
- Don't invent new claims during integration — only restructure / re-phrase / remove duplicates

## What this skill is NOT

- Not for writing original chapters (that's the chapter writer's job)
- Not for reviewing quality (that's `chapter-quality-gate` / `dimension-quality-review`)
- Not for cross-dim integration (that's a higher-level mission-knit step)

This skill produces **one dim's integrated body** — the unit the dimension
reviewer scores and the report assembler stitches.
