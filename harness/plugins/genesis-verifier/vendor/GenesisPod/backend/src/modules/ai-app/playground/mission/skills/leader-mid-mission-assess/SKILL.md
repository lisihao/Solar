---
name: leader-mid-mission-assess
description: M1 mid-mission assessment — leader decides accept-all / patch / redirect / abort + per-dim action with retry strategy after researcher results land
version: "1.0.0"
tags:
  - leader
  - mid-mission
  - decision
  - governance
activateFor:
  - leader
  - mission-leader
  - mid-mission-arbitrator
---

# Leader Mid-Mission Assessment Protocol (M1)

After all researchers report back, the leader inspects results and decides
the next action. **This decision becomes part of the M7 accountability record** —
choosing `accept-degraded` here means owning that choice at signoff.

## Inputs you receive

- `myPlan.goals` — what you committed to at M0 (successCriteria / qualityBar)
- `myPlan.dimensions[]` — the dims you decomposed
- `researcherOutcomes[]` — actual results: `{ dimensionId, dimensionName, state,
findingsCount, sources, failureCode?, summary }`

## Decision 1 — overall direction

| `decision`   | Meaning                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `accept-all` | All dims usable → proceed to reconciler                                                              |
| `patch`      | At least 1 dim needs patching (retry / critique). Each dim's action specified per-dim                |
| `redirect`   | Need new dims because some `successCriteria` can't be answered by current dims (use `newDimensions`) |
| `abort`      | Multiple critical failures, mission unsalvageable                                                    |

## Decision 2 — per-dimension action

| `action`              | Meaning                                                       |
| --------------------- | ------------------------------------------------------------- |
| `accept`              | This dim is good                                              |
| `accept-degraded`     | Has issues but no retry — foreword MUST flag this             |
| `retry-with-critique` | Same spec, run again with critique appended                   |
| `replace-spec`        | Different agent spec (fill `newAgentSpecId`)                  |
| `abort`               | Drop this dim — foreword MUST list it in `whatRemainsUnclear` |

## Decision 2.5 — retry/replace strategy (REQUIRED for retry / replace)

When `action ∈ {retry-with-critique, replace-spec}`, you MUST set `strategy`:

| `strategy`        | When to pick                                                                                       | Effect                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `fresh-collect`   | Findings themselves untrustworthy: too few / low-quality sources / key evidence missing / outdated | Re-run researcher from scratch; new task row; independent score           |
| `reuse-recompute` | Findings adequate but writing or scoring is the problem                                            | Reuse existing findings; only rewrite chapter + re-score; no new task row |

**Default is `fresh-collect`** for backwards compatibility, but the LLM should
choose actively based on the critique. Don't blindly default.

## Decision 3 — rationale (REQUIRED)

One paragraph explaining the overall decision + each per-dim action.
Generic "results acceptable" is rejected.

## Output shape — MUST use ReAct finalize wrapper

```json
{
  "thinking": "<reasoning>",
  "action": {
    "kind": "finalize",
    "output": {
      "phase": "assess-research",
      "decision": "accept-all" | "patch" | "redirect" | "abort",
      "rationale": "<paragraph explaining overall + per-dim>",
      "perDimension": [
        {
          "dimensionId": "<must match myPlan.dimensions[i].id>",
          "action": "accept" | "accept-degraded" | "retry-with-critique" | "replace-spec" | "abort",
          "critique": "<required when action=retry-with-critique>",
          "newAgentSpecId": "<required when action=replace-spec>",
          "strategy": "fresh-collect" | "reuse-recompute"  // required for retry/replace
        }
      ],
      "newDimensions": [/* required when decision=redirect */]
    }
  }
}
```

## Hard rules

- `perDimension[]` MUST cover every `dimensionId` in `myPlan.dimensions` —
  missing one is rejected
- `decision = "patch"` requires at least one `perDimension[i].action` ≠ `accept`
- `decision = "redirect"` requires `newDimensions.length ≥ 1`
- `decision = "abort"` requires every `perDimension[i].action = "abort"` (no half-aborted missions)
- `action = "retry-with-critique"` requires non-empty `critique`
- `action = "replace-spec"` requires non-empty `newAgentSpecId`
- `action ∈ {retry-with-critique, replace-spec}` requires `strategy` field
- `accept-degraded` decisions WILL be referenced at M7 signoff — own the choice now

## Forward link to M7

Every `accept-degraded` choice you make here will appear in your M7
`accountabilityNote` requirement. Same for every `abort` (which moves the dim
to `whatRemainsUnclear` in the foreword). Pick decisions you can defend later.

## What this skill is NOT

- Not for grading research outputs (use `dimension-quality-review`)
- Not for cross-dim fact-checking (use `cross-dim-fact-check`)
- Not for final signoff (use `leader-signoff`)

This skill produces **one mid-mission decision** with per-dim resolution and
retry strategy. Downstream pipeline branches on `decision` and per-dim `action`.
