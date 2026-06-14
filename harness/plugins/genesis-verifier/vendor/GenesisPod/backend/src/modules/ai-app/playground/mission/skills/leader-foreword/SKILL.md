---
name: leader-foreword
description: M6 leader foreword — meta-level executive preface that grades each successCriterion + lists open questions + reading guide + follow-up recommendations
version: "1.0.0"
tags:
  - leader
  - foreword
  - executive-summary
  - mission-end
activateFor:
  - leader
  - mission-leader
  - foreword-writer
---

# Leader Foreword Protocol (M6)

After Writer / Reviewer / Critic complete their passes, the leader writes a
**meta-level foreword** that goes at the very front of the report. This is the
"boss's perspective" the user sees first.

**This is NOT the writer's executive summary.** Do not duplicate that content.
This is your honest, accountable take on what you actually delivered vs. what
you committed to at M0.

## Inputs you receive

- `myPlan.goals.successCriteria` — what you said success looks like at M0
- `myPlan.goals.qualityBar` — minSources / minCoverage you committed to
- `myDecisions[]` — every key decision you made (M0 / M1 / earlier)
- `stageOutcomes.researcherStates[]` — per-dim final state
- `stageOutcomes.reconciliation` — fact count / conflicts / critical gaps
- `stageOutcomes.writerSections[]` — section list
- `stageOutcomes.qualitySnapshot` — sourceCount / coverageScore / overall / verdict / reviewer avg / critic verdict + blindspots/biases

## 4 fields to produce

### 1. `whatWeAnswered[]`

For each `successCriterion`, answer with:

- `criterion` — restate the criterion verbatim (or close paraphrase)
- `addressed` — `"yes"` / `"partial"` / `"no"` — **be honest**:
  - degraded dims → `partial` or `no`
  - critic blindspots that map to a criterion → at most `partial`
- `evidence` — one sentence pointing to specific `§N` or `dim-X` as proof

### 2. `whatRemainsUnclear[]`

Open questions / underspecified areas / critical gaps the report didn't answer.

**Must include:**

- Every critical gap from `reconciliation.criticalGaps`
- Every degraded / aborted dim
- Every critic blindspot that wasn't fully addressed in subsequent revisions

Do not hide gaps. The user will use this report to make decisions; pretending
"comprehensive coverage" when there are real holes is dereliction.

### 3. `howToRead`

≤ 200 chars reading guide:

- Which section(s) to prioritize
- Which sections have weaker evidence and should be supplemented with external sources
- Any sequencing tips ("read §3 before §5; §5 builds on §3's framework")

### 4. `recommendedFollowUp[]`

2–4 forward-looking research directions **not** already covered in this report.
Not "more of the same" — genuinely new questions surfaced by reading the result.

## Output shape — MUST use ReAct finalize wrapper

```json
{
  "thinking": "<reasoning>",
  "action": {
    "kind": "finalize",
    "output": {
      "phase": "foreword",
      "whatWeAnswered": [
        {
          "criterion": "<successCriterion verbatim>",
          "addressed": "yes" | "partial" | "no",
          "evidence": "<§N reference or dim-X reference>"
        }
        // exactly successCriteria.length entries, in same order
      ],
      "whatRemainsUnclear": ["...", "..."],
      "howToRead": "<≤ 200 chars>",
      "recommendedFollowUp": ["...", "..."]
    }
  }
}
```

## Hard rules

- `whatWeAnswered.length === successCriteria.length` — one entry per criterion, same order
- `addressed` enums only — no "mostly" / "kind-of" / "yes-but"
- `evidence` must reference a specific section or dim — generic "throughout" is rejected
- `whatRemainsUnclear` MUST include every `criticalGap`, every degraded/aborted dim,
  every uncrystallized critic blindspot
- `recommendedFollowUp` items must be NEW directions, not paraphrases of what's
  already in the report
- Outer `{thinking, action: {kind: "finalize", output: ...}}` wrapper required
- Do NOT include verbose section text — keep the foreword scannable

## What this skill is NOT

- Not the writer's executive summary (that's already in the report body)
- Not the leader's signoff (`leader-signoff` is M7, after this)
- Not a per-section review (`dimension-quality-review` covers that)

This skill produces **the front matter the user sees first**. M7 signoff
references the foreword content (`whatWeAnswered`, `whatRemainsUnclear`) for
the accountability note.
