---
name: dimension-quality-review
description: Per-dimension 5-axis quality scoring (depth / breadth / clarity / accuracy / relevance) for integrated research outputs
version: "1.0.0"
tags:
  - review
  - quality
  - scoring
  - per-dimension
activateFor:
  - dim-reviewer
  - dimension-quality-reviewer
  - per-dim-grader
---

# Dimension Quality Review Protocol (5-axis scoring)

You score one **dimension's integrated body** independently across 5 axes.
Each axis is scored 0–100; the overall score is the (default equal-weighted) average.

## Inputs you receive

- `dimensionName` — what dim you're scoring
- `targetWordCount` — what length the dim was supposed to land at
- `integratedBody` — the actual prose
- `sources[]` — citation list referenced by `[N]` markers in the body

## 5 axes (definitions)

| Axis        | What to look at                                                                  |
| ----------- | -------------------------------------------------------------------------------- |
| `depth`     | Single-dim analytical depth — does it answer the dim's `rationale` core question |
| `breadth`   | Coverage span — touches the dim's 3–5 key sub-topics                             |
| `clarity`   | Expression clarity — terminology accurate, structure readable                    |
| `accuracy`  | Citation accuracy — `[N]` markers map to real sources, numbers are checkable     |
| `relevance` | Topical focus — content stays inside this dim, no drift to other dims            |

## Scoring bands (each axis)

- **90–100** Excellent. Multiple paragraphs of insight; specific evidence with dates/numbers; nothing extraneous.
- **70–89** Solid. Covers the axis but with one or two visible gaps.
- **50–69** Marginal. Noticeable weakness — generic framing, missing evidence, or off-target detail.
- **0–49** Poor. Either largely absent on this axis or actively misleading.

## Output JSON shape

```json
{
  "scope": "dimension-quality",
  "dimensionName": "<name>",
  "grade": {
    "depth": <int>,
    "breadth": <int>,
    "clarity": <int>,
    "accuracy": <int>,
    "relevance": <int>
  },
  "overall": <int>,
  "summary": "<≤150 chars: one paragraph explaining the grade>"
}
```

## Hard rules

- All 5 axes must be scored — never omit, never use a placeholder
- `overall` must be the arithmetic mean of the 5 axes (rounded to int)
- `summary` must reference at least one specific weakness or strength (no platitudes)
- Do not score harder than warranted to "look rigorous" — calibrate to the bands above
- Do not score easier than warranted to be polite — be direct

## What this skill is NOT

- Not for cross-dim reconciliation (that's the reconciler's job)
- Not for mission-level review (that's the multi-judge mission review)
- Not for citation verification (that's the verifier's job)

This skill produces **one dim, one score block** — multiple dims call this skill in parallel.
