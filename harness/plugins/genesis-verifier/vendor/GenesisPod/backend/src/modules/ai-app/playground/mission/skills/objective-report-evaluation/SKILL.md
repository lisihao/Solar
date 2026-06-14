---
name: objective-report-evaluation
description: Per-chapter 10-dimension structured report evaluation rubric — calibrated for cross-report consistency and multi-model comparison
version: "1.0.0"
tags:
  - evaluation
  - quality
  - chapter-level
  - rubric
  - multi-model
activateFor:
  - report-evaluator
  - chapter-grader
  - quality-rubric-judge
---

# Objective Report Evaluation Protocol (10-dimension chapter rubric)

You evaluate one chapter against a fixed 10-dimension rubric. The rubric is
**calibrated** — same input should yield the same score regardless of evaluator
identity. Multi-model systems use this skill to compare which model wrote which
chapter best.

## Inputs you receive

- `reportTitle`, `topicType`, `language` (zh / en)
- `chapter.chapterId`, `chapter.chapterTitle`
- `chapter.writerModel` — the model that produced this chapter (e.g. "gpt-4o", "claude-sonnet-4-6")
- `chapter.content` — chapter body (truncated at 4000 chars in deep reports)
- `chapter.sourcesUsed` — citation count

## The 10 dimensions (fixed weights — do NOT renormalize)

| #   | id (canonical)        | Weight | What to score                                                   |
| --- | --------------------- | ------ | --------------------------------------------------------------- |
| 1   | `factual_accuracy`    | 0.15   | Are claims/data traceable to citations? Are citations accurate? |
| 2   | `analytical_depth`    | 0.15   | Causal reasoning + trend judgment, vs. fact restatement only    |
| 3   | `evidence_coverage`   | 0.10   | High-credibility source diversity                               |
| 4   | `information_density` | 0.10   | Useful info per unit length; redundancy penalty                 |
| 5   | `logical_consistency` | 0.10   | Self-consistent narrative; no internal data contradictions      |
| 6   | `visual_quality`      | 0.10   | Figure source authority, fig-text correspondence, info gain     |
| 7   | `writing_quality`     | 0.10   | Professional prose, no AI-tells, structured paragraphs          |
| 8   | `originality`         | 0.05   | Cross-source synthesis, non-obvious insight                     |
| 9   | `timeliness`          | 0.05   | Latest data and recent sources                                  |
| 10  | `actionability`       | 0.10   | Concrete recommendations, prioritization, risk callouts         |

`chapterScore = round(Σ dim_i.score × dim_i.weight × 10)` — a 0–100 integer.

## Score calibration (each dim, 1–10)

- **9–10** Exceptional. Other chapters using the same dim would learn from this.
- **7–8** Strong. Meets professional reporting standards on this dim.
- **5–6** Adequate. Done but not distinguishing.
- **3–4** Weak. Visible deficiency on this dim.
- **1–2** Poor / largely absent.

Calibration anchors:

- A chapter with 12 citations, all primary, with verbatim quotes embedded → `factual_accuracy: 9–10`
- A chapter that restates news headlines without analysis → `analytical_depth: 3–4`
- A chapter with 2 stock photos and a chart from "shutterstock" → `visual_quality: 1–2`
- A chapter from 2024 still using 2020 data on a fast-moving topic → `timeliness: 2–3`

## Per-chapter feedback

Provide **one paragraph** per dimension you score below 7 — explain the gap and
suggest a fix. For dimensions ≥ 7, a one-line justification is sufficient.

## Output JSON shape

```json
{
  "chapterId": "<id>",
  "chapterTitle": "<title>",
  "writerModel": "<model id>",
  "dimensions": [
    {
      "id": "factual_accuracy",
      "name": "事实准确性",
      "nameEn": "Factual Accuracy",
      "weight": 0.15,
      "score": <int 1-10>,
      "comment": "<dim-specific justification or improvement note>"
    }
    // ... all 10 dimensions, in canonical order
  ],
  "chapterScore": <int 0-100>,
  "grade": "A" | "B" | "C" | "D" | "F",
  "feedback": "<chapter-level summary, ≤ 200 chars>"
}
```

## Grade thresholds

| Score   | Grade |
| ------- | ----- |
| ≥ 90    | A     |
| 80 – 89 | B     |
| 70 – 79 | C     |
| 60 – 69 | D     |
| < 60    | F     |

## Hard rules

- ALL 10 dimensions must be scored — partial output is rejected
- Use the **canonical id** (`factual_accuracy`, not `factualAccuracy`)
- Use the **fixed weight** — do not renormalize even if scoring fewer dims
- `chapterScore` must equal the weighted sum × 10, rounded to int
- `grade` must match `chapterScore` per the threshold table
- Comments for low scores (< 7) must reference specific text or specific gaps
- Do not bias toward the `writerModel` — score the prose, not the brand
- Score the chapter **as it stands** — do not assume future revisions

## What this skill is NOT

- Not for binary pass/fail (use `chapter-quality-gate`)
- Not for cross-chapter integration (use `dim-chapter-integration`)
- Not for citation verification (use `citation-audit`)

This skill produces **one calibrated 10-D score per chapter**. Aggregating
across chapters gives the report's overall score; aggregating by `writerModel`
across chapters drives cross-model comparison.
