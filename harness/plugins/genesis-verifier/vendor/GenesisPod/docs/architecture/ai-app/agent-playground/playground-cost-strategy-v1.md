# Playground Cost Strategy v1

> Status: Draft
> Scope: `backend/src/modules/ai-app/agent-playground` + `ai-harness` + `ai-engine`
> Date: 2026-05-24

---

## 1. Goal

This document defines the cost strategy for `agent-playground`.

The intent is not to shave a few tokens. The intent is to turn the current
`deep` mission from a high-cost report factory into a cost-governed insight
system with predictable unit economics.

Target outcomes:

1. Reduce normal `deep` mission cost from about `$15` toward `$5` first.
2. Make `$3` a realistic second-stage target.
3. Ensure the system decides when additional spend is worth it, instead of
   blindly consuming the remaining pool.

Non-goal:

- This document does not preserve the current "deep = full long-form report"
  product shape at any cost.

---

## 2. Current State

### 2.1 What the code currently means by `deep`

The default `deep` tier currently resolves to:

- `maxCredits = 20_000`
- `budgetMultiplier = 4.0`
- proxy cost cap about `$40`
- code comment says typical real spend about `$15`

Source:

- [run-mission.dto.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/api/dto/run-mission.dto.ts:145)
- [resolved-budget-caps.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-harness/guardrails/budget/resolved-budget-caps.ts:3)

### 2.2 Why `deep` is expensive

The main cost drivers are structural:

1. `S3 researcher` fans out across about `10-12` dimensions.
2. `S7/S8 writer` expands those dimensions into multi-chapter report content.
3. `deep` currently targets about `150,000` words.
4. Review and rewrite loops add more cost on top.

Key evidence:

- `deep = 10-12` dimensions:
  [leader.agent.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/mission/agents/leader/leader.agent.ts:332)
- researcher target already compressed to about `25K` tokens per dimension:
  [researcher.agent.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/mission/agents/researcher/researcher.agent.ts:4)
- total deep word budget:
  [word-budget.contract.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/api/contracts/word-budget.contract.ts:25)
- deep ideal/min chapter counts:
  [per-dim-pipeline.util.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/mission/pipeline/helpers/per-dim-pipeline.util.ts:147)

### 2.3 Current diagnosis

The system already has budget guardrails.

It does not yet have a full cost strategy.

Today the system is good at:

- preventing runaway spend
- capping pool budget
- warning when budget is under pressure

It is not yet good at:

- deciding whether additional spend is worth the marginal quality gain
- separating insight depth from report volume
- allocating spend according to value density by stage and by dimension

---

## 3. Strategic Principle

The cost strategy must optimize for user value, not output mass.

For `agent-playground`, "quality" should mean:

- the key insights are correct
- the evidence is strong
- the report is readable
- the recommendations are actionable

Quality should not be implicitly defined as:

- every dimension gets full long-form treatment
- every chapter gets LLM review
- every mission produces a very large report body

The system should preserve insight value first, and only then decide how much
prose production is justified.

---

## 4. Product Policy

### 4.1 Split `deep` from `report`

The current product semantics mix two different things:

- deep reasoning
- full report production

They should be split into four execution shapes:

1. `brief`
   - fast answer
   - low cost
   - short output
2. `insight`
   - balanced insight and cost
   - structured output with limited prose
3. `deep`
   - broad research across dimensions
   - deep write-up only for the highest-value dimensions
4. `report`
   - explicit high-cost mode
   - full chapter pipeline and long-form report generation

### 4.2 Product rule

`deep` must no longer mean "run the full report factory by default".

`report` becomes the explicit premium/high-cost mode.

This change is necessary if we want meaningful cost reduction without
destroying insight quality.

---

## 5. Runtime Planning Policy

### 5.1 Add a `Cost Plan` to `S2 leader-plan`

Today the leader emits dimensions, goals, and risks.

The leader should also emit a cost plan:

- `executionMode`
- `priorityDimensions`
- `coverageDimensions`
- `writingMode`
- `reviewMode`
- `contingencyPolicy`

Suggested fields:

```ts
type CostPlan = {
  executionMode: "brief" | "insight" | "deep" | "report";
  priorityDimensions: string[];
  coverageDimensions: string[];
  writingMode: "summary_only" | "selective_chapters" | "full_report";
  reviewMode: "sampled" | "final_only" | "full";
  reserveRatio: number;
};
```

### 5.2 Policy intent

The system should not spend because the user selected `deep`.

The system should spend because the leader judged that certain dimensions and
certain deliverables are worth the extra cost.

---

## 6. Stage Strategy

### 6.1 `S3 researcher`

Keep full dimension coverage, but split research into two phases.

#### Phase A: `scout`

Purpose:

- determine whether a dimension deserves deeper research
- collect enough evidence to support triage

Properties:

- lower-cost model tier
- small iteration budget
- limited scrape depth

Outputs:

- finding count
- source quality signal
- novelty signal
- confidence
- `shouldDeepen` recommendation

#### Phase B: `deepen`

Run only for:

- high-value dimensions
- high-uncertainty but high-impact dimensions
- dimensions with strong evidence yield

Do not run for:

- background-only dimensions
- redundant dimensions
- low-yield dimensions after scout

Expected effect:

- preserve breadth
- sharply reduce unnecessary research spend

### 6.2 `S7/S8 writer`

This is the second major cost center and must change shape.

#### New output layers

1. `Executive brief`
2. `Core insights`
3. `Deep-dive dimensions`
4. `Evidence appendix`

#### New writing rule for `deep`

- full chapter pipeline only for `Top 3-4` priority dimensions
- non-priority dimensions emit:
  - structured summary
  - evidence bullets
  - gaps/open questions
  - citations

#### New length rule

For `deep`, move from:

- current default: about `150,000` words

to:

- main body: about `20,000 - 35,000` words
- appendix: structured evidence and dimension cards

This preserves user value while removing the most expensive prose expansion.

### 6.3 Review stages

The system should stop paying for full LLM review at every content layer.

#### New review policy

- chapter level: sampled review only
- dimension level: full review for deep-written dimensions
- mission level: final review retained

#### Deterministic-first rule

The following checks should be non-LLM first:

- citation format
- section presence
- word-count tolerance
- duplicate content
- empty sections
- figure placeholder integrity

Only semantic issues should escalate to LLM reviewers.

---

## 7. Model Policy

The cost strategy requires explicit role-tier model assignment.

### 7.1 High-value model tier

Use stronger, more expensive models only for:

- `Leader`
- `Analyst`
- `MissionCritic`
- final writer for high-priority dimensions

### 7.2 Mid-tier models

Use mid-tier models for:

- `Researcher deepen`
- `DimensionIntegrator`
- outline planners

### 7.3 Low-cost tier

Use low-cost models for:

- `Researcher scout`
- `Reconciler`
- `ChapterReviewer`
- `MissionReviewer`
- `Verifier`

### 7.4 Rule

Expensive models must be reserved for value-dense work only.

Cheap models should own:

- coverage
- mechanics
- checks
- summarization

---

## 8. Retry and Stop-Loss Policy

### 8.1 Replace naive retry with value-aware retry

Every expensive retry should be gated by expected gain.

Suggested new signal:

```ts
type RetryDecision = {
  expectedGainIfRetry: "high" | "medium" | "low";
  retryCostTier: "low" | "medium" | "high";
  reason: string;
};
```

### 8.2 Runtime policy

- `low gain + high cost` -> do not retry
- `medium gain + high cost` -> downgrade output shape
- `high gain + low cost` -> retry allowed

### 8.3 Mission-level downgrade

When cost pressure rises, the mission should be able to downgrade:

- `report -> deep`
- `deep -> insight`
- `full_write -> selective_write`
- `full_review -> sampled_review`

This should be an explicit runtime capability, not an accidental side effect.

---

## 9. Caching Policy

The system should cache evidence, not conclusions.

### Cache candidates

- search result bundle
- scraper extract bundle
- normalized source metadata
- figure candidates
- evidence graph fragments

### Do not cache

- final insight synthesis
- final writer prose
- final review decisions

This improves economics for repeated or nearby missions without corrupting
analytical integrity.

---

## 10. Cost Targets

### 10.1 Current reference

Current typical `deep` mission:

- typical spend: about `$15`
- proxy cap: about `$40`

Source:

- [run-mission.dto.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/api/dto/run-mission.dto.ts:145)

### 10.2 Recommended targets

#### Phase 1 target

- target: about `$5`
- method:
  - split `deep` from `report`
  - add S2 cost plan
  - selective deep-write
  - sampled review

#### Phase 2 target

- target: about `$3`
- method:
  - role-tier model strategy
  - retry value gating
  - deterministic review checks
  - evidence caching

#### Below `$3`

Possible only if the product definition changes further.

At that point, the system is no longer preserving the current meaning of
`deep`; it is creating a more compressed premium briefing product.

---

## 11. Implementation Order

### P0

1. Separate `deep` from `report`
2. Add `CostPlan` to `S2`
3. Split `S3` into `scout` and `deepen`
4. Change `S8` to selective deep-write + appendix
5. Replace full chapter review with sampled review

### P1

1. Add explicit role-tier model policy
2. Add retry gain classification
3. Front-load deterministic review checks
4. Add evidence bundle caching

### P2

1. Add mission-level dynamic downgrade
2. Add richer telemetry for cost-per-stage and gain-per-retry
3. Tune pricing policy by user tier and product tier

---

## 12. Success Metrics

The strategy is successful only if all of the following improve together:

1. cost per completed mission
2. success rate
3. reviewer pass rate
4. user acceptance of deep output
5. evidence density per dollar

Recommended tracked metrics:

- cost by stage
- cost by dimension
- cost by retry
- retry acceptance rate
- downgrade rate
- number of deep-written dimensions per mission
- appendix/main-body ratio

---

## 13. Final Position

The cost problem in `agent-playground` is not a local tuning issue.

It is a product and systems strategy issue.

The right solution is not:

- lower a few budgets
- reduce a few token caps
- hope quality survives

The right solution is:

- separate insight depth from report volume
- decide spend at planning time
- allocate budget by value density
- downgrade when marginal value is low
- reserve expensive models for high-leverage work

That is the foundation required to make `playground` economically viable
without collapsing the quality promise.
