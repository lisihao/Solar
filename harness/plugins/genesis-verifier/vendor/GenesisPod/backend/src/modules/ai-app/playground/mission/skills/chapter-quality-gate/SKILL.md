---
name: chapter-quality-gate
description: Per-chapter QA gate — 6-criterion check (independent thesis / de-templating / evidence / argument / no-clichés / length) with pass-or-revise decision
version: "1.0.0"
tags:
  - review
  - chapter-level
  - writing-quality
  - quality-gate
activateFor:
  - chapter-reviewer
  - section-quality-gate
  - writer-self-eval
---

# Chapter Quality Gate Protocol

You inspect **one chapter** against 6 industry-aligned criteria and decide
`pass` or `revise`. The decision feeds the writer's revision loop.

## Inputs you receive

- `chapter.index`, `chapter.heading`, `chapter.body` — the chapter under review
- `chapter.wordCount`, `targetWordCount` — actual vs target

## 6 criteria (check all, in order)

### 1. Independent thesis claim per paragraph

- ✓ Each paragraph opens with a falsifiable, independent judgment
  ("This means...", "The core reason is...", "We cannot conclude that...")
- ✗ Paragraph opens by restating the chapter heading, or by paraphrasing evidence
  without a judgment

### 2. De-templating

- ✓ Each chapter has its own opening / closing rhythm
- ✗ Same template across all chapters: `> **核心判断**:` first paragraph + `**Implications**:`
  closing paragraph. If any 2 chapters in the report share the exact same opening
  / closing template, the chapter fails this criterion.

### 3. Evidence sufficiency

- ≥ 2 `[N]` citations in the chapter
- Each citation contains specific number / date / entity
- Citations are embedded **inside argument sentences** (not piled at paragraph end)

### 4. Argumentation completeness

- 3–5 middle paragraphs in the chapter (not counting opening/closing)
- Each middle paragraph elaborates ONE keypoint in 100–300 characters
- No telegram-style one-line paragraphs

### 5. No clichés / templated openings

Reject these openings (and analogous templates):

- "随着 X 的发展" / "with the development of X"
- "在当今" / "in today's age"
- "众所周知" / "as is well known"
- "综上所述" / "in summary"

These signal stale boilerplate. Replace with content-specific openings.

### 6. Length compliance

- `chapter.wordCount` must lie in `targetWordCount × [0.7, 1.3]`
- Outside this band → length fails

## Decision

| Outcome            | Score range | Conditions               |
| ------------------ | ----------- | ------------------------ |
| `decision: pass`   | 80–100      | All 6 criteria satisfied |
| `decision: revise` | < 70        | Any one criterion fails  |

`critique` (when revising) MUST be **paragraph-anchored**, naming which
criterion failed where:

```
§2 opens with chapter-heading restatement (criterion 1)
§3 closes with "**Implications**:" template (criterion 2)
§4 lacks any [N] citation (criterion 3)
```

Generic "the chapter could be improved" is rejected.

## Output JSON shape

```json
{
  "mode": "chapter-review",
  "decision": "pass" | "revise",
  "score": <int 0-100>,
  "critique": "<paragraph-anchored, criterion-tagged improvement notes>"
}
```

## Hard rules

- Always check all 6 criteria — do not stop at first failure
- `revise` decisions MUST tag which criterion(s) failed
- `pass` decisions MUST score ≥ 80; `revise` MUST score < 70 (the gap is intentional)
- Length-only failures are still `revise` — short or long chapters distort the report
- Do not soften criticism; do not invent failures

## What this skill is NOT

- Not for mission-level review (use `multi-judge-mission-review`)
- Not for citation verification (use `citation-audit`)
- Not for L4 meta-review (use `report-meta-critic`)

This skill operates per-chapter. N chapters call this skill N times. The writer
uses the verdicts to decide which chapters to revise before assembly.
