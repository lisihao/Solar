# Agent Team Thinning Plan 2026-05-26

**Date**: 2026-05-26  
**Status**: v4.0  
**Owner**: Claude Code

**Related**

- [agent-team-thinning-review-baseline-2026-05-26.md](./agent-team-thinning-review-baseline-2026-05-26.md)
- [agent-team-thinning-principles-2026-05-26.html](./agent-team-thinning-principles-2026-05-26.html)
- [playground-read-model-and-frontend-thinning-plan-2026-05-25.md](./playground-read-model-and-frontend-thinning-plan-2026-05-25.md)
- [agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md](./agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md)
- [agent-team-boundary-audit-2026-05-08.md](./agent-team-boundary-audit-2026-05-08.md)
- [../../../../.claude/standards/23-business-team-framework-usage.md](../../../../.claude/standards/23-business-team-framework-usage.md)

`playground-read-model-and-frontend-thinning-plan-2026-05-25.md` is superseded by this document.

`agent-team-thinning-principles-2026-05-26.html` describes a longer-horizon vision. This plan is the conservative thinning track within the current architecture contract.

---

## 0. Executive Summary

This plan defines a thinning strategy for `agent-playground`, `social`, and `radar`.

The key decisions are:

1. **Mission truth is single-track.**
   Backend becomes the only authority for mission, stage, agent, artifact, and todo state.

2. **Framework migration is also single-track in production.**
   No runtime dual-run, no production feature flag that switches truth sources, no fallback to old frontend derive logic.

3. **Current app topology remains in force.**
   This plan does not override the existing `module / api / runtime / mission / events` blueprint or the current architecture tests.

4. **Physical directory collapse is not part of this plan.**
   We thin code and responsibility first. Any future top-level directory rewrite requires a separate blueprint/ADR and matching architecture-spec updates.

5. **Prisma models stay as they are today.**
   `AgentPlaygroundMission`, `SocialMission`, and `TeamMission` remain distinct models unless a separate schema program is approved.

### 0.1 Cost of not doing this

If this program is not executed, the expected ongoing costs are:

1. frontend truth logic remains split across page code and helper files
2. mission truth regressions continue to be diagnosable only by reading frontend derive code
3. every mission-app UI change keeps paying duplicated state-reconstruction cost
4. framework lift stalls because backend truth is not yet centralized
5. new mission app onboarding continues to inherit unclear truth ownership

### 0.2 User-facing success metrics

Track at minimum:

1. mission detail first meaningful render latency
2. mission-status mismatch defects reported by users
3. stale artifact or stale todo rendering defects
4. days to enable a new mission app on canonical detail architecture
5. maintenance effort spent on frontend truth logic after cutover

### 0.3 Decision revisit triggers

Revisit key decisions only when these triggers happen:

1. a fourth mission app requires fundamentally different truth semantics
2. current blueprint changes through approved architecture-spec updates
3. Prisma schema unification becomes an approved platform program
4. canonical view endpoint cannot meet performance gates even after cache support
5. multi-user or pause semantics become committed scope rather than deferred hooks

---

## 1. Non-Goals

This plan does **not** do the following:

1. Merge `AgentPlaygroundMission`, `SocialMission`, and `TeamMission` into one table.
2. Delete `mission/` or `events/` top-level directories from app layout.
3. Replace current app layout guards with a new 4-item top-level shape.
4. Keep old frontend derive logic as a production rollback path.
5. Introduce production dual-run between old and new framework implementations.

---

## 2. Current-State Facts

These facts are treated as baseline and must not be contradicted by implementation planning.

### 2.1 Data model facts

Current Prisma schema contains separate mission models:

1. `TeamMission`
2. `SocialMission`
3. `AgentPlaygroundMission`

This means the plan must target a **shared framework over multiple mission stores**, not a forced single persistence model.

### 2.2 Layout facts

Current architecture guards require agent-team apps to keep the approved top-level layout:

1. `module/`
2. `api/`
3. `runtime/`
4. `mission/`
5. `events/`
6. optional `integrations/`
7. optional `__tests__/`

This plan may thin internals aggressively, but it does not rewrite this contract.

### 2.3 Frontend facts

Current frontend still contains heavy business-derived logic in:

1. `derive.ts`
2. `todo-ledger.ts`
3. `synthesize-artifact.ts`
4. `drawer-derive.ts`

These are the primary targets for authority removal.

---

## 3. Core Principles

### 3.1 Single-track mission truth

After cutover:

1. Frontend pages do not derive mission truth from events.
2. Frontend pages do not synthesize canonical artifacts.
3. Frontend pages do not infer rerunability or resumability.
4. Backend read model is the only authority.

Scope clarification:

1. "single-track" means a single rendering path for the same mission-detail truth, not a single endpoint count.
2. The 23 existing endpoints in section `6.9` may remain as sibling specialty routes (export, replay, dag, leader-chat, report-version) without violating this principle, provided that no sibling route redefines a field that the canonical view already owns.
3. If a sibling route exposes a field that the canonical view also exposes, the canonical view value wins; the sibling route is supplementary, not authoritative.

### 3.2 Shared mechanism, retained business semantics

Move to `ai-harness` or `ai-engine` only when logic is:

1. business-agnostic
2. parameterizable
3. expected to benefit at least two mission apps

Keep in app when logic is:

1. research-specific
2. chapter-specific
3. dimension-specific
4. app-specific artifact semantics
5. app-specific policy or event meaning

### 3.3 Blueprint-respecting thinning

This plan optimizes **within** the current topology:

1. `module/` stays
2. `api/` stays
3. `runtime/` stays
4. `mission/` stays
5. `events/` stays

The target is thinner contents, not speculative directory collapse.

### 3.4 No production dual-run

Allowed:

1. offline equivalence tests
2. fixture replay tests
3. staging-only verification windows

Not allowed:

1. serving old and new truth in production simultaneously
2. choosing truth source at runtime via feature flag
3. falling back to old frontend derive for production rendering

---

## 4. Target Architecture

## 4.1 Backend target

Within each mission app, backend should converge toward:

```text
module/
api/
runtime/
mission/
  query/
  projectors/
  pipeline/
  lifecycle/
  rerun/
  roles/
  artifacts/
  context/
  chat/
  skills/
events/
integrations/   (if needed)
```

This is not a requirement to add every subdirectory immediately. It is a responsibility map.

### 4.2 Frontend target

Frontend should converge toward:

1. page layer
2. canonical mission-detail rendering components
3. app-specific business panels
4. light formatting helpers

Frontend should stop owning:

1. mission truth derivation
2. artifact compatibility logic
3. todo state synthesis
4. rerunability inference
5. terminal refetch scheduling semantics

---

## 5. Persistence Strategy

### 5.1 Shared framework, separate mission stores

The framework must support multiple mission-store implementations:

1. `AgentPlaygroundMission` store
2. `SocialMission` store
3. `TeamMission` store or existing teams stack where applicable

The correct abstraction is:

```ts
interface IMissionPersistencePort<TMissionRow, TDomainView> {
  getMissionRow(id: string, userId?: string): Promise<TMissionRow | null>;
  buildViewSeed(row: TMissionRow): TDomainView;
  listResumable(
    userId: string,
  ): Promise<Array<{ missionId: string; savedAt: Date }>>;
}
```

The framework must not assume a single Prisma model or shared table shape.

### 5.2 Business fields remain app-owned

Examples that remain app-owned:

1. `dimensions`
2. `leaderJournal`
3. `reportFull`
4. chapter or evidence-specific business fields
5. app-specific artifact metadata

Framework may carry these fields opaquely, but must not define their semantics.

### 5.3 `configSnapshot` is the canonical input source

For `agent-playground`, `configSnapshot` is the canonical rerun and hydrate input source.

Implementation anchors:

1. Prisma schema comment and row fields:
   `backend/prisma/schema/models.prisma`
2. rerun source:
   `backend/src/modules/ai-app/agent-playground/mission/rerun/mission-rerun-orchestrator.service.ts`
3. hydrate source:
   `backend/src/modules/ai-app/agent-playground/mission/rerun/ctx-hydrator.service.ts`
4. store projection:
   `backend/src/modules/ai-app/agent-playground/mission/lifecycle/mission-store.service.ts`

Rules:

1. `ResumeRerunPolicyService` and rerun or hydrate flows must read `configSnapshot`, not `userProfile`
2. historical rows with `configSnapshot = null` are legacy rows
3. legacy rows with `configSnapshot = null` are not resumable or rerunnable through the new canonical path
4. the canonical reason for denial should explicitly mention legacy snapshot absence rather than generic denial text

---

## 6. Canonical Read Model

### 6.0 Semantic Freeze Requirement

Before backend implementation or frontend cutover, the following semantics must be frozen in this document and then encoded into tests.

Required frozen domains:

1. `mission.status`
2. `stage.status`
3. `agent.phase`
4. `resumable`
5. `rerunnableStages`
6. `reportArtifact`
7. `refreshHints`

### 6.1 Contract goal

Each mission app should expose a canonical detail view from backend, with app-specific extensions layered on top.

### 6.2 Base contract

Shared base:

```ts
type MissionViewBase = {
  mission: {
    id: string;
    title?: string;
    status:
      | "starting"
      | "running"
      | "completed"
      | "failed"
      | "cancelled"
      | "quality-failed";
    startedAt?: string;
    finishedAt?: string;
    finalScore?: number;
    failureMessage?: string;
    resumable: boolean;
    canCancel: boolean;
    rerunnableStages: Array<{ id: string; allowed: boolean; reason?: string }>;
  };
  stages: Array<{
    id: string;
    label: string;
    status: "pending" | "running" | "done" | "failed" | "skipped";
    startedAt?: string;
    endedAt?: string;
    detail?: string;
    attempts?: number;
  }>;
  agents: Array<{
    id: string;
    role: string;
    phase: "pending" | "running" | "completed" | "failed";
    modelId?: string;
    retryCount?: number;
    failureMessage?: string;
  }>;
  reportArtifact: ReportArtifact | null;
  todoBoard: TodoBoardState | null;
  cost: MissionCostView | null;
  memory: MissionMemoryView | null;
  timelineVersion: number;
  snapshotVersion: number;
  refreshHints?: Array<{
    family:
      | "mission"
      | "stages"
      | "agents"
      | "artifact"
      | "todo"
      | "cost"
      | "memory";
    mode: "refetch" | "patch";
    id?: string;
  }>;
};
```

### 6.2.1 Contract-complete starter shapes

The following starter shapes are mandatory for `B1-1`. Implementers must not leave these as `unknown`.

These are the approved source anchors for the first implementation:

1. `ReportArtifact`
   Source anchor:
   `frontend/lib/features/agent-playground/report-artifact.types.ts`
   Mirror target:
   `backend/src/modules/ai-app/agent-playground/api/contracts/artifact.contract.ts`

2. `MissionReferenceView`
   Source anchor:
   `frontend/components/common/mission-detail/tabs/MissionReferencesTab.tsx`

3. step-to-stage mapping
   Source anchor:
   `backend/src/modules/ai-app/agent-playground/api/contracts/step-id-mapping.contract.ts`

4. legacy UI-side truth shapes to mine, then simplify
   Source anchors:
   `frontend/lib/features/agent-playground/derive.ts`
   `frontend/lib/features/agent-playground/todo-ledger.ts`

Use these starter definitions:

```ts
type MissionReferenceView = {
  id?: string;
  title: string;
  url?: string;
  description?: string;
  domain?: string;
  sourceType?: string;
  publishedAt?: string;
};

type ReportVersionView = {
  version: number;
  versionLabel: string | null;
  reportTitle: string | null;
  reportSummary: string | null;
  finalScore: number | null;
  leaderSigned: boolean | null;
  triggerType: string;
  generatedAt: string;
};

type MissionCostView = {
  tokensUsed: number;
  costUsd: number;
  byStage: Array<{ stage: string; tokensUsed: number; costUsd: number }>;
};

type MissionMemoryView = {
  chunks: number;
  namespace?: string;
  tags?: string[];
};

type LeaderJournalView = {
  summary?: string;
  decisions?: Array<{
    step?: string;
    action?: string;
    rationale?: string;
    ts?: string | number;
  }>;
  checkpoints?: Array<{
    key: string;
    savedAt?: string;
    note?: string;
  }>;
  raw?: Record<string, unknown>;
};

type TodoBoardState = {
  items: MissionTodoView[];
  summary: {
    pending: number;
    inProgress: number;
    blocked: number;
    done: number;
    failed: number;
    cancelled: number;
  };
};

type MissionTodoView = {
  id: string;
  parentId?: string;
  origin: string;
  createdBy: "leader" | "reviewer" | "critic" | "reconciler" | "system";
  createdAt: number;
  reasonText: string;
  scope: "mission" | "dimension" | "chapter" | "review" | "system";
  title: string;
  status:
    | "pending"
    | "in_progress"
    | "blocked"
    | "done"
    | "failed"
    | "cancelled";
  startedAt?: number;
  endedAt?: number;
  dimensionRef?: string;
  systemStageId?: string;
  pipelineKey?: string;
  retryStrategy?: "fresh-collect" | "reuse-recompute";
  failedStage?: string;
  assignee: {
    role: string;
    agentId?: string;
    dimensionName?: string;
  };
  artifacts: Array<{
    kind: string;
    label: string;
    value?: string | number;
  }>;
  narrativeLog: Array<{
    ts: number;
    text: string;
    tone?: "info" | "success" | "warn" | "error";
  }>;
};
```

### 6.2.2 First-cut `PlaygroundDomainView`

`PlaygroundDomainView` for `B1/B2` is:

```ts
type PlaygroundDomainView = MissionViewBase & {
  mission: MissionViewBase["mission"] & {
    title?: string;
    topic?: string;
    depth?: string;
    language?: string;
    maxCredits?: number;
    wallTimeMs?: number;
    themeSummary?: string;
    dimensions?: Array<{ id: string; name: string; rationale?: string }>;
    leaderJournal?: LeaderJournalView | null;
    leaderOverallScore?: number | null;
    leaderSigned?: boolean | null;
    leaderVerdict?: string | null;
    terminalOutcome?: string | null;
    failureCode?: string | null;
    reportArtifactVersion?: number | null;
  };
  references: MissionReferenceView[];
  reportVersions: ReportVersionView[];
};
```

For this program's first cut, the following previously mentioned fields are explicitly out of `B1/B2` canonical contract scope unless a consuming UI proves they are required:

1. `verifyConsensus`
2. `capabilityMeters`
3. `budgetTimeLimit`

If later reintroduced, they must arrive with concrete consuming components and concrete TS shapes in the same PR.

### 6.4 Canonical mission semantics

#### 6.4.1 `mission.status`

Allowed values:

1. `starting`
2. `running`
3. `completed`
4. `failed`
5. `cancelled`
6. `quality-failed`

Resolution rules:

1. `completed`
   Use when the mission reached a terminal success path and its final artifact is accepted as a successful deliverable.

2. `quality-failed`
   Use when the mission has a terminal artifact/result but failed final quality acceptance or signoff.
   It is terminal, readable, and not equivalent to `running`.

3. `failed`
   Use when the mission terminated without a valid successful deliverable, including runtime failure, abort-to-failure, unrecoverable stage failure, or explicit failed terminalization.

4. `cancelled`
   Use only for explicit user/system cancellation semantics, not generic failure.

5. `running`
   Use when the mission has started execution and has not yet reached any terminal state.

6. `starting`
   Use only for the short bootstrap window where ownership or session exists but the stable mission row/view is not fully materialized yet.

Additional rules:

1. Terminal statuses are:
   `completed`, `failed`, `cancelled`, `quality-failed`

2. `reopened` is not a public status.
   A reopened mission that is re-entered into execution surfaces as `running`, while reopen history is expressed elsewhere.

3. The frontend must not infer terminality from event names.
   Terminality is defined only by the backend view.

#### 6.4.1.a Persistence-to-view mapping

For current `agent-playground`, projector implementers must use an explicit mapping from persistence and lifecycle sources to public view status.

Use this precedence:

1. If there is no durable mission row yet but ownership/session bootstrap exists, surface `starting`.
2. If the canonical lifecycle source marks the mission cancelled, surface `cancelled`.
3. If persisted mission row status is `completed`, surface `completed`.
4. If persisted mission row status is `rejected`, surface `quality-failed` for `agent-playground`.
5. If persisted mission row status is `failed`, surface `failed`.
6. If persisted mission row status is `running`, surface `running`.

Notes:

1. The projector must not guess this mapping ad hoc.
2. `rejected -> quality-failed` is a deliberate public-view mapping for `agent-playground`, not a generic framework rule.
3. Apps without a quality-failed concept may map their persisted quality-like terminal states differently in their own app projector.
4. controller-level `starting` placeholder already exists today in `mission-read.controller.ts`; during cutover, canonical projector logic replaces that responsibility rather than duplicating it in two production paths forever.
5. ownership storage for the `starting` window is two-tier: `MissionOwnershipRegistry` (in-memory fast path) plus DB fallback via `MissionStore.getById(id, userId)`, both already wired through `BaseMissionController.assertOwnership` in `backend/src/modules/ai-app/agent-playground/api/controller/base-mission.controller.ts`. Pod restart and Railway recycle are covered by the DB fallback re-registering ownership in memory.
6. cross-pod cold start within the first few seconds after `POST /team/run` (before the durable row materializes) still depends on the originating pod's in-memory registry; first cut accepts this as a known small-window edge case; cross-pod ownership broadcast for that exact bootstrap window is deferred to a separate infrastructure follow-up and is not blocked by this plan.

#### 6.4.2 `stage.status`

Allowed values:

1. `pending`
2. `running`
3. `done`
4. `failed`
5. `skipped`

Resolution rules:

1. `failed`
   Any stage with a terminal failure outcome takes `failed`.

2. `done`
   Use only when the backend has determined the stage completed successfully under that app's aggregation rule.

3. `running`
   Use when at least one active execution path for the stage is in progress and the stage is not terminal.

4. `pending`
   Use when the stage has not yet started and is not skipped.

5. `skipped`
   Use only when the system explicitly determines the stage is intentionally omitted, not merely absent from events.

Additional rules:

1. The frontend must not compute stage status from `stepId`.
2. App-specific step-to-stage aggregation remains backend-owned.
3. `attempts` is metadata, not status authority.

#### 6.4.2.a Playground first-cut stage sequence

Fixture authors and projector implementers must use this first-cut playground stage sequence.

Canonical ordered stages:

1. `s1-budget`
2. `s2-leader-plan`
3. `s3-researchers`
4. `s4-leader-assess`
5. `s5-reconciler`
6. `s6-analyst`
7. `s7-writer-outline`
8. `s8-writer-draft`
9. `s8b-quality-enhancement`
10. `s9-critic-l4`
11. `s9b-objective-evaluation`
12. `s10-leader-signoff`
13. `s11-persist`
14. `s12-self-evolution`

Source anchors:

1. backend step mapping:
   `backend/src/modules/ai-app/agent-playground/api/contracts/step-id-mapping.contract.ts`
2. legacy frontend aggregation source:
   `frontend/lib/features/agent-playground/derive.ts`
3. representative stage files proving heterogeneous flow:
   `backend/src/modules/ai-app/agent-playground/mission/pipeline/stages/s8-writer-draft-report.stage.ts`
   `backend/src/modules/ai-app/agent-playground/mission/pipeline/stages/s8b-section-quality-enhancement.stage.ts`
   `backend/src/modules/ai-app/agent-playground/mission/pipeline/stages/s11-mission-persist.stage.ts`

For `expected-view.json`, `stages[i].id` and `stages[i].label` must be authored from this table, not guessed ad hoc.

#### 6.4.3 `agent.phase`

Allowed values:

1. `pending`
2. `running`
3. `completed`
4. `failed`

Resolution rules:

1. `running`
   The agent has an active execution lifecycle in flight.

2. `completed`
   The agent finished its assigned work successfully for the current mission view.

3. `failed`
   The agent ended in failure for the current mission view and is not currently active.

4. `pending`
   The agent is known to the mission topology but has not yet begun visible execution.

Additional rules:

1. `retryCount` is auxiliary metadata and does not change the phase enum.
2. The frontend must not infer phase from trace item shapes or event names.

### 6.5 Resumable and rerunnable semantics

#### 6.5.1 `mission.resumable`

`resumable = true` only when all of the following are true:

1. a checkpoint or equivalent resumable state exists
2. the mission is in a state that the backend allows resume from
3. ownership and access checks pass
4. no stricter business guard rejects resume

`resumable = false` when any of the above fail.

Important:

1. The existence of a checkpoint alone is not sufficient.
2. The frontend must not derive resumability from raw checkpoint presence.
3. Ownership validation happens in `MissionQueryService` during owned mission lookup before projector execution.
4. The projector consumes owned, already-authorized query inputs and does not repeat authorization logic.

#### 6.5.1.a First-cut resume policy inputs

`ResumeRerunPolicyService` must compute `resumable` from these concrete anchors:

1. owned mission row from
   `backend/src/modules/ai-app/agent-playground/mission/lifecycle/mission-store.service.ts`
2. resumable checkpoint listing from
   `MissionCheckpointService.listResumable(userId)`
3. ownership guard path from
   `backend/src/modules/ai-app/agent-playground/api/controller/base-mission.controller.ts`

First-cut policy for `agent-playground`:

1. mission must be owned by the requesting user
2. mission id must appear in the checkpoint service resumable list for that user
3. mission must not already be surfaced as `completed`
4. no explicit business denylist reason may apply

The initial explicit denylist is:

1. completed mission with accepted artifact
2. missing checkpoint snapshot
3. ownership mismatch

#### 6.5.1.b First-cut resume matrix by failure locus

For `agent-playground`, first-cut resume support is stage-sensitive.

| Failure or interruption locus          | Resume allowed in first cut | Notes                                            |
| -------------------------------------- | --------------------------- | ------------------------------------------------ |
| before durable row creation            | no                          | falls back to restart, not resume                |
| bootstrap row exists but no checkpoint | no                          | canonical reason = missing checkpoint            |
| `s1-budget`                            | no                          | cheap to restart, no meaningful checkpoint value |
| `s2-leader-plan`                       | yes, if checkpoint exists   | plan snapshot is reusable                        |
| `s3-researcher-collect`                | yes, if checkpoint exists   | existing crash-resume path already exists        |
| `s4-leader-assess`                     | yes, if checkpoint exists   | review decision state may resume                 |
| `s5-reconciler`                        | yes, if checkpoint exists   | reconciliation report is resumable input         |
| `s6-analyst`                           | yes, if checkpoint exists   | downstream synthesis may resume                  |
| `s7-writer-outline`                    | yes, if checkpoint exists   | outline state may resume                         |
| `s8-writer-draft`                      | yes, if checkpoint exists   | writer path may resume                           |
| `s8b-quality-enhancement`              | yes, if checkpoint exists   | section loop may resume                          |
| `s9-critic-l4`                         | yes, if checkpoint exists   | critique loop may resume                         |
| `s9b-objective-evaluation`             | yes, if checkpoint exists   | evaluator loop may resume                        |
| `s10-leader-signoff`                   | yes, if checkpoint exists   | signoff state may resume                         |
| `s11-persist`                          | no                          | treat as rerun or restart boundary               |
| `s12-self-evolution`                   | no                          | postlude, non-blocking in public contract        |

This matrix is the first implementation target for `ResumeRerunPolicyService`. Any deviation requires updating this table in the same PR.

Resumable-state source for `agent-playground`:

1. `agent-playground` does not have a dedicated `MissionCheckpoint` Prisma table. Prisma `*Checkpoint` models (`PipelineRunCheckpoint`, `HarnessCheckpoint`, `TaskCheckpoint`, `SlidesCheckpoint`) belong to other modules and are not the resume source for this app.
2. the canonical resumable-state inputs for `agent-playground` are:
   - `mission.configSnapshot` JSON column on `AgentPlaygroundMission`, frozen at openSession, anchored in section `5.3`
   - hydration entry point: `backend/src/modules/ai-app/agent-playground/mission/rerun/ctx-hydrator.service.ts`
   - per-dim partial results table: `AgentPlaygroundResearchResult` (used by incremental rerun)
3. "checkpoint exists" in the matrix above means: `configSnapshot` is non-null AND the hydrator can reconstruct enough stage state for the targeted stage. The service that owns this decision is `ResumeRerunPolicyService`.
4. legacy rows with `configSnapshot = null` are denied with explicit canonical reason text per section `5.3` rule 3.

Interpretation note for first-cut implementation:

1. `s5-reconciler` and `s8-writer-draft` are both resumable when a valid checkpoint exists, but they are not equivalent internally:
   - `s5-reconciler` resumes from reconciliation state
   - `s8-writer-draft` resumes from writer artifact assembly state
2. first-cut public contract does not expose these internal checkpoint payload differences; it only exposes the allowed-or-denied resume outcome plus reason
3. if future UX needs stage-specific resume affordances, that is a contract extension and must not be inferred ad hoc in the frontend

#### 6.5.2 `mission.rerunnableStages`

Each entry:

```ts
{ id: string; allowed: boolean; reason?: string }
```

Semantics:

1. `allowed = true`
   The backend permits a rerun of that stage under current mission state and business constraints.

2. `allowed = false`
   The backend denies rerun and should provide a machine-usable or human-readable reason where possible.

Rules:

1. The frontend must not compute rerunability from mission status or local event history.
2. Cascade effects remain backend-owned.
3. `rerunnableStages` is authoritative even if the UI appears to have enough local context to guess otherwise.

#### 6.5.2.a First-cut rerun policy rules

`ResumeRerunPolicyService` must not invent a new rerun model. First cut must align with existing server capabilities:

1. full mission rerun capability source:
   `backend/src/modules/ai-app/agent-playground/api/controller/mission-rerun.controller.ts`
   `POST /missions/:id/rerun`
2. todo-to-new-mission rerun capability source:
   `POST /missions/:id/todos/:todoId/rerun`
3. local stage rerun capability source:
   `POST /missions/:id/todos/:todoId/local-rerun`

Initial rules:

1. `rerunnableStages.allowed = true` only for stages that existing backend rerun services can actually execute
2. todo origins explicitly disallowed by current controller comments remain disallowed:
   - `leader-assess-abort`
   - terminal persist-only paths such as `s11-persist`
3. cascade semantics stay inside rerun services and are surfaced as `reason` text or structured metadata, not recomputed in projector

No implementation may ship with placeholder `allowed=true` for all stages.

#### 6.5.2.b Step-to-stage aggregation source

For `agent-playground`, backend aggregation must start from these two source anchors:

1. canonical backend step mapping:
   `backend/src/modules/ai-app/agent-playground/api/contracts/step-id-mapping.contract.ts`
2. legacy frontend aggregation source to port and simplify:
   `frontend/lib/features/agent-playground/derive.ts`
   specifically `STAGE_STEPS`, `aggregateStageStatus`, and `mapStepIdToStageId`

The backend projector must port these rules into app-owned backend code before deleting the frontend authority.

### 6.6 Artifact semantics

#### 6.6.1 `reportArtifact`

`reportArtifact` must be returned in canonical renderable shape from backend.

Rules:

1. The backend is responsible for normalizing legacy structures.
2. The backend is responsible for filling compatibility gaps required by canonical renderers.
3. The frontend must not synthesize canonical artifacts from partial mission state for production rendering.

Allowed frontend behavior:

1. rendering
2. formatting
3. local presentation-only fallbacks such as empty-state chrome

Forbidden frontend behavior:

1. schema upgrade logic
2. semantic artifact reconstruction
3. cross-version artifact compatibility resolution

#### 6.6.2 First-cut artifact version map

The initial canonicalization table is:

1. `v2 ReportArtifact`
   Canonical shape, source anchor:
   `frontend/lib/features/agent-playground/report-artifact.types.ts`
2. `v1 ResearchReport`
   Legacy shape handled today by
   `frontend/lib/features/agent-playground/synthesize-artifact.ts`
   Fields:
   `title`, `summary`, `sections`, `conclusion`, `citations`
3. `null` or `undefined`
   Must become a canonical empty-state artifact payload, not a missing field

First-cut normalization rules to port from
`frontend/lib/features/agent-playground/synthesize-artifact.ts`:

1. `v1.title -> metadata.topic` and top-level display title
2. `v1.summary -> quickView.executiveSummary.markdown`
3. `v1.sections[] -> sections[] + content.fullMarkdown`
4. `v1.conclusion -> conclusion section when present`
5. `v1.citations[] -> citations[]` with hostname-derived fallback titles
6. absent `figures`, `factTable`, `quality`, `quickView` fields must be filled with schema-complete empty collections or zeroed structures, not left missing

`reportArtifactVersion` is metadata, not the mapping itself. The projector or composer must still implement the concrete v1-to-v2 field transformation.

No additional historical artifact versions may be introduced during implementation without extending this table in the same PR.

#### 6.6.4 Large-artifact and off-load policy

The contract must reserve space for storage off-load realities even if canonical read model v1 does not implement custom fetch yet.

Relevant schema and hydration anchors:

1. `reportFullUri`
2. `reportFullSize`
3. `reportArtifactVersion`
4. Prisma JSON hydration path in:
   `backend/src/common/prisma/prisma.service.ts`

Rules:

1. projectors must assume `reportFull` may be off-loaded and hydrated through existing Prisma JSON hydration mechanisms
2. no canonical contract may assume report payloads are always inline and cheap to select forever
3. if artifact payload size or off-load behavior threatens `p95 < 200ms`, a separate large-artifact fetch policy must be added rather than silently regressing the canonical endpoint

#### 6.6.3 Todo-ledger truth versus UI split

For `B3-1`, the current source file
`frontend/lib/features/agent-playground/todo-ledger.ts`
must be split conceptually as follows:

Truth logic to port:

1. `deriveTodoLedger(...)`
2. todo status transitions
3. retry child-task creation and closure
4. system-stage placeholder creation
5. dimension and chapter task lifecycle updates
6. mission terminal cleanup and cancellation handling

UI-only helpers that may remain frontend-side or be simplified:

1. `deriveStageArtifacts(...)`
2. `deriveLayerBreadcrumb(...)`
3. presentation-only ordering or breadcrumb formatting that does not alter canonical todo truth

### 6.7 Refresh semantics

`refreshHints` expresses backend guidance for partial or full UI refresh.

Rules:

1. `family` is the stable refresh domain.
2. `id` is optional and, when present, narrows refresh to a specific entity within the family.
3. `mode=refetch` means the frontend should re-read canonical backend data for that family.
4. `mode=patch` means the frontend may apply a local non-authoritative patch only if it does not reintroduce truth derivation.
5. The frontend may use `timelineVersion` and `snapshotVersion` to avoid unnecessary work.
6. The frontend must not maintain its own terminal-event-to-refetch rule table.

Recommended hint families:

1. `mission`
2. `stages`
3. `agents`
4. `artifact`
5. `todo`
6. `cost`
7. `memory`

Frontend fetch-coalescing rules:

1. one active canonical view fetch maximum at a time
2. at most one queued follow-up fetch while one is in flight
3. refresh hints inside the same 250ms window must be coalesced
4. one user interaction round must not trigger unbounded canonical view fetch fan-out

### 6.7.2 Real-time UI behavior contract

Canonical view and realtime stream are deliberately split.

Rules:

1. canonical mission truth comes from the backend view endpoint
2. WebSocket stream remains enabled for fine-grained live UX and debugging
3. the stream is not allowed to redefine mission, stage, agent, artifact, or todo truth after cutover
4. refresh hints only tell the frontend when to re-read canonical truth

After cutover:

1. token-by-token or narrative-like live text remains stream-driven where currently present
2. stage-transition animations may remain stream-triggered for responsiveness
3. agent retry flashes may remain stream-triggered for responsiveness
4. canonical panels must settle back to backend view truth on refetch

Concrete first-cut split:

1. `GET /agent-playground/missions/:id` or its sibling canonical-view route returns durable truth only and must not embed token-stream payloads
2. `useMissionStream` remains the only live source for token-by-token text, ReAct narration, retry flicker, and optimistic stage-transition animation
3. a `refreshHint` only schedules canonical refetch; it must not carry enough business payload to reconstruct mission truth in the frontend
4. if a socket event and canonical refetch disagree, the canonical view wins within the same interaction round
5. QA and support debugging must keep access to raw replay plus live stream inspection after cutover; the canonical cutover must not delete those tools

Do not collapse these into one mechanism. The goal is:

1. stream for immediacy
2. canonical view for truth

### 6.7.3 Multi-pod refresh-hint emission path

For production, refresh-hint style signals must ride the existing domain-event and socket fan-out path rather than a pod-local side channel.

Implementation anchors:

1. event bus fan-out:
   `DomainEventBus`
2. socket adapter registration:
   `backend/src/modules/ai-app/agent-playground/api/controller/agent-playground.gateway.ts`
3. persisted mission-event path:
   `MissionEventBuffer.broadcast(...)`
4. frontend dual-channel consumption:
   `frontend/hooks/features/useMissionStream.ts`

Rules:

1. the pod handling the business event emits the domain event
2. socket broadcast adapters receive that event through the shared event-bus path
3. replay and polling remain the cross-pod recovery path when a client misses live socket delivery
4. no separate undocumented pod-local refresh-hint bus may be introduced
5. this plan assumes the existing `DomainEventBus` transport contract is the cross-pod baseline; app code in this program must not invent an app-local Redis or cache protocol for refresh hints
6. if infrastructure later exposes an explicit Redis pub-sub topic for refresh hints, the protocol name, payload shape, and retry semantics must be added to this document in the same change sequence

If a future explicit Redis pub-sub layer is added for refresh-hint optimization, it must be documented as an optimization over this baseline path, not as an implicit replacement.

### 6.7.1 `timelineVersion` and `snapshotVersion`

These two numbers must be stable across restart and multi-pod execution.

#### `timelineVersion`

Rules:

1. `timelineVersion` must be derived from persisted mission-event state, never from in-memory buffer length.
2. It must be monotonically non-decreasing per mission.
3. It must increase whenever a newly persisted event becomes visible to canonical timeline consumers.
4. It must be identical across pods reading the same persisted mission state.

Approved implementation choices:

1. persisted event count for the mission
2. explicit persisted event revision counter
3. another persisted monotonic source approved in code review

Forbidden implementation:

1. local process sequence
2. websocket message count
3. in-memory event-buffer array length

#### `snapshotVersion`

Rules:

1. `snapshotVersion` must be derived from persisted view-relevant state, not local cache state.
2. It must be monotonically non-decreasing per mission.
3. It must change when canonical mission detail truth changes in a way requiring a snapshot refresh.
4. It must be stable across restart and multi-pod reads.

Approved implementation choices:

1. explicit persisted revision counter
2. stable reducer over persisted checkpoint/report/business update revisions

Forbidden implementation:

1. current wall-clock at request time
2. local-memory mutation count
3. per-pod ephemeral version counters

### 6.3 Playground extension

For this program, `agent-playground` extension fields are frozen to:

1. `mission.topic`
2. `mission.depth`
3. `mission.language`
4. `mission.maxCredits`
5. `mission.wallTimeMs`
6. `mission.themeSummary`
7. `mission.dimensions`
8. `mission.leaderJournal`
9. `mission.leaderOverallScore`
10. `mission.leaderSigned`
11. `mission.leaderVerdict`
12. `mission.terminalOutcome`
13. `mission.failureCode`
14. `mission.reportArtifactVersion`
15. `references`
16. `reportVersions`

Explicitly not exposed in the first-cut canonical view:

1. `MissionElectionState`
2. `committedModelIds`
3. `reservations`

These remain internal runtime or model-selection mechanics unless a later product requirement proves they are user-facing.

Field-name compatibility rules:

1. outward canonical field name is `mission.title`
2. current persisted row field is `topic`
3. during migration, projector maps persisted `topic -> mission.title`
4. `mission.topic` may be kept only as temporary compatibility baggage while existing consumers are migrated
5. no new consumer should be introduced that depends on both `title` and `topic` as separate semantic fields

### 6.8 Semantic test matrix

The following matrix must be reflected in contract tests and fixture replay tests before frontend cutover.

#### 6.8.1 Mission-level cases

1. completed mission with accepted artifact
2. failed mission with no valid deliverable
3. quality-failed mission with readable artifact
4. cancelled mission
5. reopened mission now surfaced as `running`
6. resumable failed or interrupted mission

#### 6.8.1.b Combined-state fixtures

In addition to single-point fixtures, the suite must contain at least these combined-state cases:

1. `partial-failure-mid-run`
2. `multi-stage-rerun-in-flight`
3. `multi-agent-retry`

#### 6.8.2 Stage-level cases

1. not-started stage
2. active stage
3. successfully completed stage
4. failed stage
5. intentionally skipped stage

#### 6.8.3 Agent-level cases

1. pending agent
2. running agent
3. completed agent
4. failed agent

#### 6.8.4 Artifact cases

1. current schema artifact
2. legacy schema artifact normalized by backend
3. empty or partial artifact rendered as canonical empty-state payload from backend

#### 6.8.4.b Fixture anonymizer specification

Fixture anonymization is mandatory and must be deterministic enough to preserve structural semantics.

Must mask or rewrite:

1. `mission.topic` or any outward `title` that contains user research topic wording
2. free-text fields such as `reportFull`, `leaderJournal`, critique text, model narration, and agent messages
3. person names, organization names, emails, phone numbers, account ids, tokens, secrets, and internal URLs
4. citation URLs beyond safe host-level preservation; query strings, path identifiers, and signed URLs must be removed or rewritten
5. any embedded identifiers in `dimensions`, `references`, `todos`, or event payloads

May preserve:

1. enum-like values, status values, stage ids, and stable structural keys
2. relative counts, list lengths, retry counts, and version numbers
3. hostname-only source classes when they are not sensitive
4. timestamp ordering, but absolute timestamps may be shifted consistently per fixture

Required deliverables for `B1-2`:

1. a dedicated anonymizer or extractor script checked into the repo, building on or replacing the existing baseline `scripts/dev/dump-playground-fixtures.js`; the new extractor must live under `scripts/dev/` (preferred final path: `scripts/dev/extract-mission-fixture.ts` or `.js`) and must produce the four canonical fixture files (`mission-row.json`, `events.json`, `checkpoint.json` when relevant, `expected-view.json`)
2. fixture README rules documenting exactly which fields were rewritten
3. a validation step that fails if obvious raw URLs, emails, or bearer-like secrets remain in committed fixtures; this validation must run as part of the fixture-replay CI job, not as a manual reviewer task

Fixture limits:

1. default fixture target is `<= 50` events per fixture
2. larger fixtures are allowed only when explicitly labeled as benchmark or stress fixtures
3. every fixture must declare whether it is based on real anonymized data or synthetic data

These fields belong in app contracts, not harness contracts.

### 6.9 Existing endpoint disposition table

The following existing `agent-playground` endpoints are the migration baseline. `B4` must not proceed without preserving or explicitly replacing each of them.

| Endpoint                                                        | Current file anchor                          | Disposition in this plan                                                                                                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /agent-playground/missions`                                | `mission-read.controller.ts`                 | Keep as-is                                                                                                                                                                                                       |
| `GET /agent-playground/missions/resumable`                      | `mission-read.controller.ts`                 | Keep as resumable source input                                                                                                                                                                                   |
| `GET /agent-playground/missions/:id`                            | `mission-read.controller.ts`                 | Extend existing route into canonical detail route or keep it as a thin wrapper over `MissionQueryService`; do not create a duplicate greenfield primary detail endpoint without an explicit sibling-route reason |
| `PATCH /agent-playground/missions/:id/visibility`               | `mission-read.controller.ts`                 | Keep as-is                                                                                                                                                                                                       |
| `GET /agent-playground/missions/:id/export`                     | `mission-read.controller.ts`                 | Keep as sibling export route                                                                                                                                                                                     |
| `GET /agent-playground/missions/:id/report-versions`            | `mission-read.controller.ts`                 | Keep as sibling route; feed `reportVersions` metadata                                                                                                                                                            |
| `GET /agent-playground/missions/:id/report-versions/:version`   | `mission-read.controller.ts`                 | Keep as sibling route until artifact version switching is folded into canonical view deliberately                                                                                                                |
| `GET /agent-playground/replay/:missionId`                       | `mission-read.controller.ts`                 | Keep for debug, QA, and replay fallback; not a truth source                                                                                                                                                      |
| `GET /agent-playground/missions/:id/leader-chat`                | `mission-read.controller.ts`                 | Keep as sibling route                                                                                                                                                                                            |
| `GET /agent-playground/missions/:id/dag`                        | `mission/dag-view/mission-dag.controller.ts` | Keep as sibling expert-view route; outside canonical detail payload                                                                                                                                              |
| `GET /agent-playground/missions/:id/dag/cascade`                | `mission/dag-view/mission-dag.controller.ts` | Keep as sibling preview route used by local-rerun UX; do not fold into canonical detail payload                                                                                                                  |
| `GET /agent-playground/missions/:id/dag/react/:nodeId`          | `mission/dag-view/mission-dag.controller.ts` | Keep as sibling diagnostic route for node-level ReAct inspection                                                                                                                                                 |
| `GET /agent-playground/budget-tiers`                            | `agent-playground.controller.ts`             | Keep as sibling setup route; not part of canonical mission truth                                                                                                                                                 |
| `POST /agent-playground/missions/:id/rerun`                     | `mission-rerun.controller.ts`                | Keep as write path; projector consumes resulting state only                                                                                                                                                      |
| `POST /agent-playground/missions/:id/todos/:todoId/rerun`       | `mission-rerun.controller.ts`                | Keep as write path                                                                                                                                                                                               |
| `POST /agent-playground/missions/:id/todos/:todoId/local-rerun` | `mission-rerun.controller.ts`                | Keep as write path                                                                                                                                                                                               |
| `POST /agent-playground/missions/:id/leader-chat`               | `mission-rerun.controller.ts`                | Keep as write path                                                                                                                                                                                               |
| `POST /agent-playground/team/run`                               | `agent-playground.controller.ts`             | Keep as primary create-and-run write path; canonical view starts after this write path allocates ownership and durable state                                                                                     |
| `POST /agent-playground/missions/:id/cancel`                    | `agent-playground.controller.ts`             | Keep as write path                                                                                                                                                                                               |
| `POST /agent-playground/error-report`                           | `mission-read.controller.ts`                 | Keep as operational support route; outside canonical detail contract                                                                                                                                             |
| `POST /agent-playground/dev/trigger-mission`                    | `agent-playground.controller.ts`             | Keep only as non-production dev or internal route; exclude from canonical cutover obligations if production gating already forbids it                                                                            |
| `DELETE /agent-playground/missions/:id`                         | `agent-playground.controller.ts`             | Keep as write path                                                                                                                                                                                               |
| `PATCH /agent-playground/missions/:id`                          | `agent-playground.controller.ts`             | Keep as write path; canonical read model must reflect updates                                                                                                                                                    |

Only after playground cutover stabilizes may any of these routes be merged or retired in a separate endpoint-rationalization program.

Route-freeze consequences for `B4`:

1. every frontend call site must map to one row in this table before cutover PR merge
2. if a route is replaced by a sibling canonical route, the PR must name the replacement path and the old-route deprecation window
3. `GET /missions/:id`, replay, DAG, leader-chat, and report-version routes must remain independently testable after cutover
4. no route may silently disappear under the label "covered by canonical view" unless the folded fields are enumerated in the PR description

---

## 7. Frontend Authority Removal

### 7.1 Forbidden responsibilities

The frontend must not own:

1. mission status derivation
2. stage status aggregation
3. agent phase aggregation
4. artifact canonicalization
5. todo state ledger truth
6. rerunnable or resumable inference
7. terminal refetch semantics

### 7.2 Allowed responsibilities

The frontend may own:

1. tabs
2. drawers
3. modal state
4. local optimistic interaction
5. sorting
6. filtering
7. formatting
8. chart data reshaping
9. raw event timeline display

### 7.3 Fate of existing derive files

At cutover:

1. `derive.ts` loses all production authority **and is deleted**
2. `todo-ledger.ts` loses all production authority **and is deleted**
3. `synthesize-artifact.ts` loses all production authority **and is deleted**
4. `drawer-derive.ts` loses **mission-truth** authority but **may remain in
   production render path under §7.2 raw-event-timeline-display exemption**
   (it derives drawer UI sections — tool usage / sources / findings —
   strictly from `agent.trace`, which §7.2 explicitly allows; it does not
   derive mission / stage / agent / artifact / todo truth).

§7.2-exempt files (1-4 below) may stay in production render path **provided
they import only types and helpers**, do not call deleted truth functions,
and are guarded by ESLint `no-restricted-imports` so consumers go through
`*-shapes` proxy modules:

1. `drawer-derive.ts` + `drawer-derive-shapes.ts` (tool/source/finding
   extraction from `agent.trace`)
2. `mission-presentation.types.ts` (formerly `derive-shapes.ts`) — presentation
   shape types + pure mapping helpers (`STAGE_STEPS` / `mapStepIdToStageId` /
   `aggregateStageStatus`); no truth derivation
3. `mission-todo.types.ts` (formerly `todo-ledger-shapes.ts`) — `MissionTodo`
   type mirror of backend `TodoBoardEntry` + UI-only `deriveLayerBreadcrumb`
4. `useMissionLegacyView` hook (formerly inline `viewToDerivedShim` / before
   that `view-to-derived.shim.ts` file) — canonical-view → DerivedView shape
   adapter; consumes canonical truth, derives presentation only

Truth-deriving function bodies (`deriveView` / `deriveTodoLedger` /
`synthesizeArtifact`) are deleted; the surviving files are presentation
types / adapters under §7.2.

---

## 8. Framework Lift Plan

### 8.1 Candidate shared framework areas

Good lift candidates:

1. mission dispatcher mechanism
2. mission store framework
3. orchestrator instrumentation
4. rerun dispatcher mechanism
5. report helper framework
6. update helper framework
7. mission chat framework
8. DAG or timeline projection framework
9. export framework

### 8.2 Lift criteria

Before lifting any unit, all must be true:

1. it is not business-name aware
2. it can be parameterized by hooks or generics
3. it does not require importing app code
4. it can be tested in harness-only fixtures

### 8.3 Size rules

These are review heuristics, not hard spec locks:

1. framework class target size: prefer under 400 LOC
2. hook count target: prefer under 5 meaningful hooks
3. if a framework class exceeds these limits, require explicit review justification

---

## 9. Execution Waves

### W1: Plan and semantic freeze

Deliver:

1. this plan
2. review baseline
3. semantic freeze for mission truth

### W2: Read-model contract and projector

Deliver:

1. backend view-state contract
2. `MissionViewProjectorService`
3. `GET /missions/:id/view`
4. fixture replay for six mission classes

Mission classes:

1. completed
2. failed
3. quality-failed
4. cancelled
5. reopened
6. resumable

### W3: Framework single-track migration

Deliver:

1. store framework migration
2. dispatcher framework migration
3. orchestrator framework migration
4. rerun framework migration
5. report helper migration
6. update helper migration

Validation:

1. offline equivalence specs
2. fixture replay
3. no production dual-run

### W4: Frontend single-track cutover

Deliver:

1. page reads canonical backend view
2. refresh-hint model replaces frontend event-derived truth
3. old derive files are removed from production path

Rollback:

1. release revert only
2. not fallback-to-derive

### W5: Artifact and todo cutover

Deliver:

1. backend `TodoBoardProjector`
2. backend `ArtifactComposerService`
3. frontend consumes projected todo board
4. frontend consumes canonical artifact

### W6: Internal debt cleanup under existing topology

Deliver:

1. delete dead app wrappers no longer needed
2. shrink oversized files
3. remove old authority-bearing frontend helpers
4. tighten lints and contract tests

Note:

W6 does **not** rewrite the top-level app directory structure.

### W7: Social and radar alignment

Deliver:

1. same single-track contract shape by app
2. same shared framework usage pattern
3. app-specific business projection where needed

---

## 10. Testing Strategy

### 10.1 Required tests

Every wave touching truth must ship with:

1. contract tests
2. fixture replay tests
3. page integration tests
4. architecture spec verification

### 10.2 Equivalence policy

Equivalence testing is allowed only as:

1. PR-time validation
2. CI validation
3. staging verification

It is not allowed as:

1. production dual execution
2. production source-of-truth selection logic

### 10.3 Performance gates

For backend read model:

1. staging p95 under 200ms before frontend cutover
2. if mission event volumes force it, add cache by `missionId + snapshotVersion`

Cache introduction is evolutionary, not mandatory on day 1.

---

## 11. Rollback Policy

### 11.1 Allowed rollback

Allowed:

1. revert release
2. revert PR
3. disable newly introduced endpoint consumers by deploy rollback

### 11.2 Forbidden rollback

Forbidden:

1. re-enabling old frontend derive as render authority
2. switching between old and new truth via page-level flag
3. running old and new truth paths together in production

---

## 12. Guardrails

### 12.1 Existing guardrails to respect

Keep existing architecture guards authoritative:

1. `agent-team-layout.spec.ts`
2. `agent-team-facade-contract.spec.ts`
3. `mission-app-conformance.spec.ts`
4. `layer-boundaries.spec.ts`

This plan must fit them unless a separate approved blueprint change lands first.

### 12.2 New guardrails to add

Add:

1. contract tests for `MissionViewBase`
2. projector fixture replay tests
3. frontend tests that page/components do not consume raw business derive outputs
4. lint rules that block frontend truth derivation from new code paths

Do not rely only on filename bans. Prefer semantic checks and contract-oriented tests.

---

## 13. Success Criteria

The plan is successful when:

1. backend read model is the only truth source for mission detail pages
2. frontend no longer derives mission, stage, agent, artifact, or todo truth
3. app code is materially thinner without breaking current blueprint
4. framework usage becomes more consistent across `agent-playground`, `social`, and `radar`
5. no production dual-run exists
6. rollback relies on release management, not truth-source toggling

---

## 14. Open Follow-Ups

These are intentionally deferred:

1. pause and multi-user semantics
2. GDPR forget flow
3. audit-trail APIs
4. any Prisma physical schema unification
5. any top-level app directory rewrite

Each requires a separate focused design once this thinning program stabilizes.

The current contract assumes a single owner for mission ownership and resumability decisions. Multi-user activation requires extending `IMissionPersistencePort` and resumable semantics, not just adding a flag.

Pause is not part of the current public status contract. If pause work starts before this program finishes, it must stop and land a separate status-contract change first rather than silently overloading an existing status.

---

## 15. Final Position

This plan is a **single-track thinning plan**, not a speculative rewrite.

It keeps three boundaries clear:

1. backend owns truth
2. shared framework owns generic mechanism
3. app owns business semantics

It also keeps one governance rule clear:

**thin first inside the current architecture contract; do not redesign the contract mid-migration.**

---

## 16. Full Target Architecture

This section defines the end-state that all implementation batches are driving toward.

### 16.1 System shape

The final system is still layered as:

```text
open-api
  -> ai-app
    -> ai-harness
      -> ai-engine
        -> ai-infra
```

The mission-app contract becomes:

1. `ai-app` owns business semantics
2. `ai-harness` owns generic mission runtime and generic mission read-model machinery
3. `ai-engine` owns generic AI capabilities, tools, retrieval, model routing, and prompt-skill infrastructure
4. frontend consumes backend canonical views and stops deriving mission truth

### 16.2 Agent-playground end-state

#### Backend app

```text
backend/src/modules/ai-app/agent-playground/
├─ module/
│  └─ agent-playground.module.ts
├─ api/
│  ├─ controller/
│  ├─ dto/
│  └─ contracts/
├─ runtime/
│  └─ *.config.ts
├─ mission/
│  ├─ query/
│  │  └─ mission-query.service.ts
│  ├─ projectors/
│  │  ├─ mission-view.projector.ts
│  │  ├─ todo-board.projector.ts
│  │  ├─ artifact.projector.ts
│  │  └─ cost-memory.projector.ts
│  ├─ pipeline/
│  ├─ lifecycle/
│  ├─ rerun/
│  ├─ roles/
│  ├─ artifacts/
│  ├─ context/
│  ├─ chat/
│  └─ skills/
├─ events/
└─ integrations/
```

App-local directories that already exist today and are retained by this plan unless a later dedicated cleanup program changes them:

1. `mission/agents/`
2. `mission/dag-view/`
3. `mission/export/`
4. `mission/types/`

This plan does not imply that these app-local directories move into harness or disappear during Batch 6.

#### Frontend app

```text
frontend/
├─ app/agent-playground/
│  ├─ page.tsx
│  └─ team/[missionId]/page.tsx
├─ components/common/mission-detail/
│  └─ canonical shells / drawers / stepper / common panels
├─ components/agent-playground/
│  └─ business panels only
├─ services/agent-playground/
│  └─ api.ts
└─ lib/features/agent-playground/
   ├─ formatters.ts
   ├─ friendly-error.util.ts
   └─ stage-id-mapping.ts
```

### 16.3 Canonical runtime ownership

#### Backend owns

1. mission truth
2. stage truth
3. agent truth
4. todo truth
5. artifact canonicalization
6. resumable and rerunnable semantics
7. refresh semantics
8. cost and memory aggregation semantics

#### Frontend owns

1. visual rendering
2. interaction state
3. local optimistic state
4. formatting and presentation helpers
5. raw event inspection UI

### 16.4 Harness end-state

Within this program, harness lift means shared mechanism extraction into already-approved framework areas or separately-approved follow-up locations.

Harness may own:

1. dispatcher frameworks
2. orchestrator frameworks
3. mission-store frameworks
4. rerun frameworks
5. shared read-model framework primitives

Only if there is a separate approved standards or architecture update may harness also grow new dedicated chat, export, or DAG-oriented homes.

Until then:

1. this program must not assume new top-level harness directories such as `chat/`, `export/`, or `dag-view/`
2. if DAG-related shared mechanism is extracted later, prefer `dag/` naming, not `dag-view/`
3. any extraction that needs new framework directories must ship with the corresponding standards and architecture-spec update in the same change sequence

But not:

1. app-specific status semantics
2. app-specific artifact meaning
3. app-specific stage aggregation policy where business meaning differs
4. app-specific business field interpretation

### 16.5 Data-model end-state

The end-state is **shared runtime abstractions over separate persistence models**, not forced table unification.

That means:

1. `AgentPlaygroundMission` stays a distinct persistence model
2. `SocialMission` stays a distinct persistence model
3. `TeamMission` or other legacy mission models stay distinct until a separate schema program says otherwise
4. framework code uses mission-store ports and projector ports instead of assuming one database row shape

---

## 17. Implementation Strategy

This section defines the complete path from current state to target state.

### 17.1 Strategy summary

The implementation path is:

1. freeze semantics
2. define canonical contracts
3. build backend read model
4. shift frontend to canonical data
5. remove old frontend truth logic
6. continue backend framework thinning
7. align social and radar on the same contract style

This is intentionally ordered so that:

1. semantics stabilize before code motion
2. truth centralizes before UI thinning
3. shared framework lift happens without changing production truth source twice

### 17.2 Design constraints

Every batch must respect:

1. no production dual-run
2. no production derive fallback
3. no top-level app layout rewrite in this program
4. no silent schema assumption drift
5. no framework lift that imports app code

### 17.3 Primary implementation objects

The path depends on delivering these core units:

#### Backend

1. `MissionViewBase` contract
2. `PlaygroundDomainView` contract
3. `MissionViewProjectorService`
4. `TodoBoardProjectorService`
5. `ArtifactComposerService`
6. `ResumeRerunPolicyService`
7. `MissionQueryService`
8. `GET /missions/:id/view`

#### Frontend

1. `useMissionDetailView`
2. canonical mission-detail data flow
3. removal of authority from derive helpers

#### Framework

1. mission-store framework hardening
2. dispatcher framework hardening
3. orchestrator framework hardening
4. rerun framework hardening
5. shared-framework extraction only where existing framework topology allows it or a separate standards update lands first

---

## 18. Batch Execution Plan

This is the execution plan to use for implementation. Each batch is intended to be independently reviewable and shippable.

### Batch 0: Semantic Freeze

**Goal**

Freeze truth semantics before code migration.

**Scope**

1. lock `mission.status`
2. lock `stage.status`
3. lock `agent.phase`
4. lock `resumable`
5. lock `rerunnableStages`
6. lock `reportArtifact`
7. lock `refreshHints`

**Deliverables**

1. this document updated and approved
2. contract enums and TS types
3. fixture categories defined
4. owner, size, and critical-path annotations for all later batches

**Exit criteria**

1. no unresolved semantic ambiguity in mission detail truth
2. test authors can write fixtures without guessing business meaning

**Execution metadata**

- Owner: architecture + playground backend
- Size: `S`
- Critical path: yes

### Batch 0.5: Implementation Unblockers

**Goal**

Remove all known day-one coding blockers before `B1-1`.

**Scope**

1. complete contract shapes that are still missing
2. freeze rerun and resume first-cut rules
3. identify exact implementation anchors
4. freeze endpoint disposition
5. define fixture extraction inputs and baseline measurements

**Deliverables**

1. `PlaygroundDomainView` first-cut TS shapes frozen in this document
2. exact source anchors for `MissionStore`, `MissionEventBuffer`, ownership path, step mapping, and artifact types
3. endpoint disposition table completed
4. fixture extraction plan recorded
5. current staging latency baseline recorded before projector work starts

**Exit criteria**

1. an implementer can open `view-state.contract.ts` without guessing field types
2. an implementer can open `mission-query.service.ts` without guessing source service paths
3. `B2-3` does not require route rediscovery during coding

**Execution metadata**

- Owner: playground backend
- Size: `M`
- Critical path: yes

### Batch 1: Contract and Fixture Layer

**Goal**

Create the contract and replay foundation that all later batches depend on.

**Scope**

1. add `MissionViewBase`
2. add `PlaygroundDomainView`
3. define fixture format for mission replay
4. collect six canonical fixture classes

**Deliverables**

1. backend contracts in `api/contracts/`
2. fixtures under `backend/src/__tests__/fixtures/mission/`
3. contract test skeletons

**Code areas**

1. `backend/src/modules/ai-app/agent-playground/api/contracts/`
2. `backend/src/__tests__/fixtures/mission/`
3. `backend/src/__tests__/architecture/` only if new contract guards are added

**Exit criteria**

1. six fixture classes exist
2. contract tests compile

**Execution metadata**

- Owner: playground backend
- Size: `L`
- Critical path: yes

### Batch 2: Backend Read Model Foundation

**Goal**

Make backend able to produce canonical mission detail view.

**Scope**

1. implement `MissionQueryService`
2. implement `MissionViewProjectorService`
3. implement `GET /missions/:id/view`
4. project mission, stages, agents, refresh hints

**Deliverables**

1. first canonical backend detail view
2. fixture replay tests for view shape
3. performance baseline for the view endpoint

**Code areas**

1. `mission/query/`
2. `mission/projectors/`
3. `api/controller/`

**Exit criteria**

1. all six fixture classes produce correct mission/stage/agent truth
2. staging p95 is acceptable before frontend cutover begins

**Execution metadata**

- Owner: playground backend
- Size: `L`
- Critical path: yes

### Batch 3: Todo and Artifact Canonicalization

**Goal**

Pull todo truth and artifact truth out of frontend.

**Scope**

1. implement `TodoBoardProjectorService`
2. implement `ArtifactComposerService`
3. normalize legacy artifact forms in backend
4. expose canonical todo board and artifact in the detail view

**Deliverables**

1. `todoBoard` in backend canonical view
2. canonical `reportArtifact`
3. artifact compatibility moved to backend

**Exit criteria**

1. frontend no longer needs `todo-ledger.ts` for truth
2. frontend no longer needs `synthesize-artifact.ts` for production rendering

**Execution metadata**

- Owner: playground backend
- Size: `M`
- Critical path: yes

### Batch 4: Frontend Canonical Data Cutover

**Goal**

Move frontend from event-derived truth to backend-provided truth.

**Scope**

1. create `useMissionDetailView`
2. make page and major panels read canonical view
3. keep stream only for refresh signaling and raw event display

**Deliverables**

1. detail page consumes backend view
2. major panels consume canonical props
3. old derive files lose production authority

**Code areas**

1. `frontend/app/agent-playground/team/[missionId]/page.tsx`
2. `frontend/services/agent-playground/api.ts`
3. `frontend/components/common/mission-detail/`
4. `frontend/components/agent-playground/`

**Exit criteria**

1. no production path computes mission/stage/agent truth in frontend
2. no production path computes todo truth in frontend
3. no production path canonicalizes artifacts in frontend

**Execution metadata**

- Owner: playground frontend
- Size: `L`
- Critical path: yes

### Batch 5: Frontend Authority Deletion

**Goal**

Delete or demote old frontend truth code after cutover is stable.

**Scope**

1. remove authority from `derive.ts`
2. remove authority from `todo-ledger.ts`
3. remove authority from `synthesize-artifact.ts`
4. keep only debug/raw-event helpers if still justified

**Deliverables**

1. dead truth logic removed
2. frontend feature area reduced to presentation helpers

**Exit criteria**

1. frontend truth derivation files are either deleted or debug-only
2. tests prove no component depends on them for production truth

**Execution metadata**

- Owner: playground frontend
- Size: `M`
- Critical path: yes

### Batch 6: Framework Lift Hardening

**Goal**

Continue pushing generic mechanism into harness without moving business semantics.

**Scope**

1. harden store framework
2. harden dispatcher framework
3. harden orchestrator framework
4. harden rerun framework
5. add or refine chat/export/dag shared framework units

**Deliverables**

1. thinner app services
2. better framework reuse across three apps
3. harness-level equivalence tests and harness-only unit tests

**Exit criteria**

1. framework implementations no longer leak app-specific semantics
2. app services are mostly hook/adapter shells

**Execution metadata**

- Owner: harness backend
- Size: `L`
- Critical path: no

### Batch 7: Social and Radar Alignment

**Goal**

Apply the same contract shape and framework usage model to the other mission apps.

**Scope**

1. adapt social backend to canonical mission detail contract style
2. adapt radar backend to canonical mission detail contract style
3. align frontend consumption patterns where applicable

**Deliverables**

1. shared mental model across apps
2. per-app mission store and projector implementations
3. explicit readiness assessment for `social` and `radar`

**Execution metadata**

- Owner: social and radar engineering owners
- Size: `L`
- Critical path: no

3. less duplicated frontend truth logic in other apps

**Exit criteria**

1. all three apps use shared framework patterns
2. all three apps expose backend-owned mission detail truth

---

## 19. Support Plan

This section defines the work needed to make the execution path safe and sustainable.

### 19.1 Test support

Required:

1. semantic contract tests
2. fixture replay tests
3. page integration tests
4. harness-only unit tests for lifted framework units
5. architecture guard verification in CI

### 19.2 Observability support

Required for cutover safety:

1. endpoint latency for `GET /missions/:id/view`
2. projector failure metrics
3. artifact normalization failure metrics
4. refresh-hint and snapshot-version debugging visibility
5. projector schema-drift alerting when canonical payload shape changes unexpectedly
6. canonical-view anomaly diff alerting against sampled expected invariants
7. client telemetry for refresh-hint-triggered fetch frequency and coalescing behavior
8. production sampled-regression checks that replay sanitized real missions against current projector output

Implementation anchors:

1. request or controller logging:
   Nest `Logger` in the relevant controller or service
2. mission or stage tracing:
   `backend/src/modules/ai-app/agent-playground/mission/pipeline/playground-mission-span.service.ts`
3. sanitizer or scrub observability:
   `SanitizerMetricsService` from `@/modules/ai-engine/facade`
4. if a new projector-specific metric sink is needed, wrap it behind app-local service code first; do not deep-import ad hoc internals from unrelated modules

### 19.3 Documentation support

Maintain during rollout:

1. this plan
2. wave signoff notes
3. rollback notes
4. fixture catalog notes

### 19.4 Release support

Required:

1. PR sequencing discipline by batch
2. release notes for frontend truth cutover
3. explicit rollback playbooks based on revert, not alternate truth paths

---

## 20. Decision Matrix

Use this matrix when deciding where a concern should move.

| Concern                                  | Final home                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| mission runtime mechanics                | `ai-harness`                                                              |
| lifecycle and finalize mechanics         | `ai-harness` + app mission-store port                                     |
| mission detail truth projection skeleton | `ai-harness` or app-local projector framework layer depending on maturity |
| app-specific field interpretation        | app mission projector                                                     |
| app-specific artifact semantics          | app mission projector / app artifacts                                     |
| generic export mechanism                 | `ai-harness`                                                              |
| generic chat mechanism                   | `ai-harness`                                                              |
| generic DAG/timeline mechanism           | `ai-harness`                                                              |
| frontend business truth derivation       | nowhere in final state                                                    |
| frontend rendering and interaction       | frontend                                                                  |

---

## 21. Immediate Next Actions

If implementation starts now, the next concrete actions are:

1. finalize and approve the semantic freeze and implementation unblockers in this document
2. create `backend/src/modules/ai-app/agent-playground/api/contracts/view-state.contract.ts`
3. mirror `ReportArtifact` into `backend/src/modules/ai-app/agent-playground/api/contracts/artifact.contract.ts`
4. create fixture directories and extraction README under `backend/src/__tests__/fixtures/mission/`
5. create `mission/query/mission-query.service.ts`
6. create `mission/rerun/resume-rerun-policy.service.ts`
7. create `mission/projectors/mission-view.projector.ts`
8. extend the existing detail route or add the sibling canonical-view route
9. cut frontend to `useMissionDetailView`

That is the correct order. Frontend refactor is not step 1; backend truth centralization is step 1.

---

## 22. Implementation Playbook

This section is the execution-grade playbook. It is intended to remove ambiguity during implementation.

### 22.1 Global execution rules

These rules apply to every batch and PR.

1. Do not change top-level app layout in this program.
2. Do not change Prisma physical schema in this program unless a separate schema PR is explicitly approved.
3. Do not introduce production dual-run.
4. Do not introduce production fallback to old frontend derive logic.
5. Do not merge a batch that leaves the system with two active truth authorities.
6. Every PR must state:
   - which batch it belongs to
   - which files it changes
   - which truth authority it removes or introduces
   - which tests prove the change

### 22.2 Global file ownership map

Use this map to avoid implementation drift.

#### Backend

| Responsibility                            | Primary files or directories                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| mission detail query                      | `backend/src/modules/ai-app/agent-playground/mission/query/`                                         |
| mission view projection                   | `backend/src/modules/ai-app/agent-playground/mission/projectors/`                                    |
| resumable and rerunnable policy decisions | `backend/src/modules/ai-app/agent-playground/mission/rerun/` or `mission/query/` if kept query-local |
| mission detail endpoint                   | `backend/src/modules/ai-app/agent-playground/api/controller/`                                        |
| app contracts                             | `backend/src/modules/ai-app/agent-playground/api/contracts/`                                         |
| mission store adapter logic               | `backend/src/modules/ai-app/agent-playground/mission/lifecycle/`                                     |
| business pipeline                         | `backend/src/modules/ai-app/agent-playground/mission/pipeline/`                                      |
| business artifact rules                   | `backend/src/modules/ai-app/agent-playground/mission/artifacts/`                                     |

#### Frontend

| Responsibility          | Primary files or directories                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| detail page composition | `frontend/app/agent-playground/team/[missionId]/page.tsx`                                          |
| API calls               | `frontend/services/agent-playground/api.ts`                                                        |
| canonical shells        | `frontend/components/common/mission-detail/`                                                       |
| business panels         | `frontend/components/agent-playground/`                                                            |
| lightweight helpers     | `frontend/lib/features/agent-playground/{formatters,friendly-error.util,stage-id-mapping}.ts`      |
| deprecated truth logic  | `frontend/lib/features/agent-playground/{derive,todo-ledger,synthesize-artifact,drawer-derive}.ts` |

#### Harness

| Responsibility                  | Primary files or directories                                       |
| ------------------------------- | ------------------------------------------------------------------ |
| generic mission-store framework | `backend/src/modules/ai-harness/teams/business-team/lifecycle/`    |
| generic dispatcher framework    | `backend/src/modules/ai-harness/teams/business-team/dispatcher/`   |
| generic orchestrator framework  | `backend/src/modules/ai-harness/teams/business-team/orchestrator/` |
| generic rerun framework         | `backend/src/modules/ai-harness/teams/business-team/rerun/`        |
| generic framework contracts     | `backend/src/modules/ai-harness/teams/business-team/abstractions/` |

If new harness directories are required beyond these areas, they are out of scope for this program unless the matching standards and architecture guards are updated first.

### 22.3 First-day file sequence

If an implementer opens Cursor and starts coding, the first file sequence is:

1. `backend/src/modules/ai-app/agent-playground/api/contracts/artifact.contract.ts`
   Source from:
   `frontend/lib/features/agent-playground/report-artifact.types.ts`
2. `backend/src/modules/ai-app/agent-playground/api/contracts/view-state.contract.ts`
   Source from:
   this document section `6.2` through `6.3`
3. `backend/src/modules/ai-app/agent-playground/mission/rerun/resume-rerun-policy.service.ts`
   Inputs from:
   `MissionCheckpointService.listResumable`
   `MissionStore.getById`
   `BaseMissionController.assertOwnership`
4. `backend/src/modules/ai-app/agent-playground/mission/query/mission-query.service.ts`
   Inputs from:
   `MissionStore`
   `MissionEventBuffer`
   `ResumeRerunPolicyService`
5. `backend/src/modules/ai-app/agent-playground/mission/projectors/mission-view.projector.ts`
   Aggregation source from:
   `backend/src/modules/ai-app/agent-playground/api/contracts/step-id-mapping.contract.ts`
   legacy rules to port from:
   `frontend/lib/features/agent-playground/derive.ts`

---

## 23. Batch-by-Batch Detailed Execution

### 23.1 Batch 0: Semantic Freeze

#### Objective

Freeze business truth before implementation starts.

#### Required PRs

##### PR B0-1: Semantic freeze completion

**Files**

1. `docs/architecture/ai-app/agent-playground/agent-team-thinning-plan-2026-05-26.md`

**Actions**

1. finish semantic sections for:
   - `mission.status`
   - `stage.status`
   - `agent.phase`
   - `resumable`
   - `rerunnableStages`
   - `reportArtifact`
   - `refreshHints`
2. add any missing app-specific semantic notes for `quality-failed`, reopened flow, and todo truth
3. explicitly mark unresolved items as out-of-scope instead of leaving them implicit

**Do not**

1. change code
2. change layout specs
3. introduce any new target structure not backed by this plan

**Done when**

1. implementers can answer every mission detail truth question without reading frontend derive code

##### PR B0-2: Implementation unblocker freeze

**Files**

1. `docs/architecture/ai-app/agent-playground/agent-team-thinning-plan-2026-05-26.md`

**Actions**

1. freeze `PlaygroundDomainView` first-cut shapes
2. freeze first-cut rerun and resume rules
3. freeze endpoint disposition table
4. freeze `configSnapshot` as canonical rerun and hydrate input source and record legacy-null handling
5. freeze playground first-cut stage sequence and labels for fixtures
6. record exact implementation anchors:
   - `MissionStore`:
     `backend/src/modules/ai-app/agent-playground/mission/lifecycle/mission-store.service.ts`
   - `MissionEventBuffer`:
     `backend/src/modules/ai-app/agent-playground/mission/lifecycle/mission-event-buffer.service.ts`
   - ownership path:
     `backend/src/modules/ai-app/agent-playground/api/controller/base-mission.controller.ts`
   - step mapping:
     `backend/src/modules/ai-app/agent-playground/api/contracts/step-id-mapping.contract.ts`
   - report artifact source shape:
     `frontend/lib/features/agent-playground/report-artifact.types.ts`
7. freeze the first-cut artifact normalization table including v1-to-v2 mapping anchors
8. explicitly record that `MissionElectionState` stays internal in first-cut canonical view
9. define fixture source plan:
   - source missions must come from owned historical playground missions
   - fixture export must produce `mission-row.json`, `events.json`, `checkpoint.json`, and `expected-view.json`
   - `events.json` schema must mirror the replay payload shape returned by `GET /agent-playground/replay/:missionId` and the persisted rows read by `MissionEventBuffer.fetchPersisted`
   - anonymization must happen before commit
   - anonymization rules must explicitly cover `topic/title`, `reportFull`, `leaderJournal`, free-text event payloads, and URLs
   - add a dedicated extractor or anonymizer script in batch 1 if none exists yet
10. record current staging latency baseline for the existing mission detail route before projector coding starts
11. record R2 off-load constraints and large-artifact policy placeholder before setting `p95` gates
12. freeze the realtime cutover split:

- canonical truth from detail view
- live token or narrative UX from socket stream
- refresh-hint as refetch trigger only

13. freeze the cross-pod refresh-hint transport assumption:

- use existing `DomainEventBus` plus socket adapter path
- no new app-local transport protocol in this program

**Done when**

1. first-line coding no longer requires grep-driven rediscovery

---

### 23.2 Batch 1: Contract and Fixture Layer

#### Objective

Create the exact contracts and fixture assets needed for backend read-model implementation.

#### Required PRs

##### PR B1-1: Introduce canonical contracts

**Files to create or update**

1. `backend/src/modules/ai-app/agent-playground/api/contracts/view-state.contract.ts`
2. `backend/src/modules/ai-app/agent-playground/api/contracts/artifact.contract.ts`
3. optional shared contract file under `ai-harness` only if genuinely generic and app-neutral

**Actions**

1. define `MissionViewBase`
2. define `PlaygroundDomainView`
3. define exact enum values as string literal unions
4. define `refreshHints` allowed families
5. define `TodoBoardState` contract shape if included in the main view
6. if repository standards are too narrow, update the relevant standards guidance in the same batch so `query/` and `projectors/` are explicitly legal app-internal targets
7. explicitly resolve current field-name drift such as `topic` versus `title` and document one canonical outward field name plus any compatibility rule

**Do not**

1. import frontend types
2. leak playground-only business fields into harness contracts
3. assume a shared Prisma row type across apps

**Done when**

1. the contracts compile
2. no contract field still says “TBD”

##### PR B1-2: Fixture scaffolding

**Files to create**

1. `backend/src/__tests__/fixtures/mission/README.md`
2. `backend/src/__tests__/fixtures/mission/playground-completed/`
3. `backend/src/__tests__/fixtures/mission/playground-failed/`
4. `backend/src/__tests__/fixtures/mission/playground-quality-failed/`
5. `backend/src/__tests__/fixtures/mission/playground-cancelled/`
6. `backend/src/__tests__/fixtures/mission/playground-reopened/`
7. `backend/src/__tests__/fixtures/mission/playground-resumable/`

**Each fixture directory must contain**

1. `mission-row.json`
2. `events.json`
3. `checkpoint.json` if relevant
4. `expected-view.json`

**Actions**

1. capture or synthesize representative data for all six classes
2. scrub or anonymize identifiers, URLs, names, free text, and other sensitive content before fixture admission; this is mandatory, not optional
3. document fixture meaning in fixture README
4. add at least these combined-state fixtures:
   - `partial-failure-mid-run`
   - `multi-stage-rerun-in-flight`
   - `multi-agent-retry`
5. keep normal fixtures at `<= 50` events unless benchmark or stress-only
6. mark every fixture as `real-anonymized` or `synthetic`
7. ensure fixture directories and `expected-view.json` are treated as code-owner protected semantic assets
8. implement and document the anonymizer according to section `6.8.4.b`

**Do not**

1. use only hand-written idealized examples if real structure is available
2. leave fixtures without expected output
3. commit unsanitized production text, user research data, or secrets into fixtures

**Done when**

1. every fixture has a corresponding expected canonical view

##### PR B1-3: Contract test scaffold

**Files to create**

1. `backend/src/modules/ai-app/agent-playground/mission/projectors/__tests__/mission-view.contract.spec.ts`
2. `backend/src/modules/ai-app/agent-playground/mission/projectors/__tests__/fixture-replay.spec.ts`

**Actions**

1. load fixtures
2. assert that projector output matches expected shape and semantics
3. fail on missing required fields
4. treat `expected-view.json` as the equivalence oracle rather than old frontend derive output

**Done when**

1. tests run, even if projector is still stubbed or partially implemented

---

### 23.3 Batch 2: Backend Read Model Foundation

#### Objective

Implement the first complete canonical mission detail view.

#### Required PRs

##### PR B2-1: Mission query service

**Files to create**

1. `backend/src/modules/ai-app/agent-playground/mission/query/mission-query.service.ts`
2. optional `index.ts` barrel in the same directory

**Actions**

1. load mission row from `MissionStore`
2. load checkpoint data if relevant
3. load replay events from `MissionEventBuffer`
4. invoke `ResumeRerunPolicyService` for resumable and rerunnable decisions
5. perform owned-mission authorization before projection
6. expose one internal method that returns all raw inputs needed by projectors

**Inputs it must aggregate**

1. mission row
2. event stream snapshot
3. checkpoint snapshot
4. report-version information if needed
5. rerun eligibility inputs

**Do not**

1. put projection logic directly into controller
2. mix formatting and transport details into query service
3. make projector decide write-policy questions such as whether a mission may resume

##### PR B2-1a: Resume and rerun policy service

**Files to create**

1. `backend/src/modules/ai-app/agent-playground/mission/rerun/resume-rerun-policy.service.ts`

**Actions**

1. compute backend-authoritative `resumable`
2. compute backend-authoritative `rerunnableStages`
3. keep policy decisions separate from projector rendering
4. expose only pure decision inputs and outputs to `MissionQueryService`
5. read rerun or resume eligibility from `configSnapshot` as canonical input source
6. deny legacy rows with `configSnapshot = null` explicitly rather than silently falling back to `userProfile`

##### PR B2-2: Mission view projector

**Files to create**

1. `backend/src/modules/ai-app/agent-playground/mission/projectors/mission-view.projector.ts`
2. `backend/src/modules/ai-app/agent-playground/mission/projectors/stage-view.projector.ts`
3. `backend/src/modules/ai-app/agent-playground/mission/projectors/agent-view.projector.ts`

**Actions**

1. convert query inputs into `mission`, `stages`, and `agents`
2. encode the semantic rules from section 6
3. output `timelineVersion` and `snapshotVersion`
4. output `refreshHints`
5. return stable empty-state sentinels for optional sections not implemented until batch 3, including `reportArtifact` and `todoBoard`

**Do not**

1. re-implement persistence
2. read from frontend-specific assumptions
3. depend on UI-only labels not rooted in backend contract

##### PR B2-3: View endpoint

**Files to update**

1. `backend/src/modules/ai-app/agent-playground/api/controller/mission-read.controller.ts`
2. `backend/src/modules/ai-app/agent-playground/module/agent-playground.module.ts`

**Actions**

1. extend the existing `GET /missions/:id` detail route or add a sibling canonical-view endpoint; this is an evolution of the current detail API, not a greenfield route
2. inject `MissionQueryService`
3. return the canonical detail view
4. preserve stable empty-state payloads rather than `undefined` for `reportArtifact` and `todoBoard` before batch 3 completes
5. consolidate `starting` placeholder responsibility into the canonical view path during cutover; do not keep two divergent long-lived implementations of `starting`

**Do not**

1. remove existing endpoints yet
2. change auth semantics

##### PR B2-4: Projector tests hardening

**Actions**

1. wire fixture replay tests to real projector
2. assert exact mission status results for all six fixture types
3. assert stage and agent outputs are canonical
4. add a benchmark-style fixture path that exercises a `500` event replay case

**Done when batch 2 completes**

1. backend can produce one canonical view endpoint
2. six fixtures all pass
3. frontend could switch without inventing truth

---

### 23.4 Batch 3: Todo and Artifact Canonicalization

#### Objective

Move todo truth and artifact truth to backend.

#### Required PRs

##### PR B3-1: Todo board projector

**Files to create**

1. `backend/src/modules/ai-app/agent-playground/mission/projectors/todo-board.projector.ts`

**Actions**

1. port all production-needed todo-state logic out of frontend `todo-ledger.ts`
2. define backend-owned `TodoBoardState`
3. include business artifacts and labels only where they are canonical for backend output
4. plan this work as `L`, not `M`, because the current frontend source is large and highly shared

**Reference source**

1. current `frontend/lib/features/agent-playground/todo-ledger.ts`

**Do not**

1. blindly copy frontend implementation line-for-line
2. preserve UI-only fields if they are not contract-worthy

##### PR B3-2: Artifact composer

**Files to create**

1. `backend/src/modules/ai-app/agent-playground/mission/projectors/artifact.projector.ts`
2. or `ArtifactComposerService` in the projectors area if composition is larger than projection

**Actions**

1. port canonical artifact normalization logic from frontend
2. normalize legacy shapes to canonical renderable shape
3. ensure backend returns empty-state payload when artifact is missing but render contract must stay stable
4. call engine or harness capabilities only through approved facades or app-local adapters over facades
5. route any PII or secret scrubbing through the approved `ai-engine` safety or sanitization facade before artifact output is persisted into fixtures or exposed through canonical view paths

**Reference source**

1. current `frontend/lib/features/agent-playground/synthesize-artifact.ts`

**Do not**

1. import engine internals directly from app projector code
2. import harness evaluation or critique internals directly from app projector code

##### PR B3-3: Extend canonical endpoint

**Files to update**

1. `mission-query.service.ts`
2. `mission-view.projector.ts`
3. `view-state.contract.ts`

**Actions**

1. add `todoBoard`
2. add canonical `reportArtifact`
3. add any minimal supporting metadata such as report versions if required by current page
4. attach a behavior-difference list covering artifact and todo changes, split into bug fixes versus expected user-visible deltas

**Done when batch 3 completes**

1. frontend no longer needs todo-ledger for truth
2. frontend no longer needs synthesize-artifact for production rendering

---

### 23.5 Batch 4: Frontend Canonical Data Cutover

#### Objective

Move the page to backend truth.

#### Required PRs

##### PR B4-1: API client support

**Files to update**

1. `frontend/services/agent-playground/api.ts`

**Actions**

1. add `getMissionDetailView(missionId)`
2. add typings aligned with backend contracts
3. support refresh-hint driven refetch coalescing with one in-flight fetch and one queued follow-up max

##### PR B4-2: New hook

**Files to create**

1. `frontend/hooks/features/useMissionDetailView.ts`

**Actions**

1. fetch canonical backend view
2. expose loading/error/data states
3. support refresh on demand
4. implement refresh-hint coalescing and de-duplication rules from section 6.7

**Do not**

1. derive mission truth in the hook
2. reintroduce event-based aggregation

##### PR B4-3: Detail page cutover

**Files to update**

1. `frontend/app/agent-playground/team/[missionId]/page.tsx`

**Actions**

1. replace authoritative data source with `useMissionDetailView`
2. leave stream only for refresh hints and raw event visualization
3. remove status/stage/agent truth derivation from page logic
4. produce before/after screenshots for all required fixture classes
5. keep event-stream replay and inspection readable for QA, support, and truth-bug diagnosis after cutover

**Do not**

1. keep old derive result in production render branching
2. use a page-level feature flag to select old or new truth source

##### PR B4-4: Component prop cutover

**Files to update**

1. canonical mission-detail components in `frontend/components/common/mission-detail/`
2. business panels in `frontend/components/agent-playground/`

**Actions**

1. make them read canonical props
2. remove dependency on raw event-derived structures where they encoded truth
3. attach a behavior-difference list covering bug fixes versus expected user-visible changes

**Done when batch 4 completes**

1. page renders from backend truth only
2. stream is no longer a truth engine
3. refresh-hint roundtrip test passes end to end
4. six fixture classes have before and after screenshot evidence

---

### 23.6 Batch 5: Frontend Authority Deletion

#### Objective

Delete obsolete frontend truth logic.

#### Hard gate before Batch 5 may start

At least one of the following must be true after Batch 4 deploy:

1. production stability window of at least `7` consecutive days with no P0 or P1 truth regressions
2. at least `500` completed mission detail render cycles on canonical view with no confirmed truth-source regression

Release revert remains the rollback tool during this window. Old derive code must not be re-enabled as an alternate production truth source.

#### Required PRs

##### PR B5-1: Remove production derive dependencies

**Files to update or delete**

1. `frontend/lib/features/agent-playground/derive.ts`
2. `frontend/lib/features/agent-playground/todo-ledger.ts`
3. `frontend/lib/features/agent-playground/synthesize-artifact.ts`
4. `frontend/lib/features/agent-playground/drawer-derive.ts`

**Actions**

1. delete if no remaining debug need exists
2. otherwise isolate into debug-only usage and remove production imports
3. record a behavior-difference summary for any intentional UI deltas that remain after derive removal
4. split into multiple PRs if consumer surface demands it; do not force all dependents through a single unsafe deletion change

##### PR B5-2: Add enforcement

**Files to update**

1. relevant frontend lint config or tests

**Actions**

1. ensure no production page imports deprecated truth modules
2. add page integration tests that fail if backend data is absent and frontend tries to self-heal with old derive logic
3. ensure frontend release revert does not require backend endpoint revert, but also cannot re-enable derive-based truth

**Done when batch 5 completes**

1. old frontend truth code is either gone or debug-only

---

### 23.7 Batch 6: Framework Lift Hardening

#### Objective

Make generic mechanism thinner in app and stronger in harness.

#### Required PRs

##### PR B6-1: Store framework hardening

**Files likely touched**

1. `backend/src/modules/ai-harness/teams/business-team/lifecycle/`
2. `backend/src/modules/ai-app/agent-playground/mission/lifecycle/mission-store.service.ts`

**Actions**

1. move only generic store mechanism
2. keep app-specific field mapping in app

##### PR B6-2: Dispatcher/orchestrator hardening

**Files likely touched**

1. `backend/src/modules/ai-harness/teams/business-team/dispatcher/`
2. `backend/src/modules/ai-harness/teams/business-team/orchestrator/`
3. app dispatcher/orchestrator shims

**Actions**

1. move generic event bridging and instrumentation
2. keep app-specific stage semantics and business hooks in app
3. if any shared hook signature changes, update all three app adapters in the same PR sequence before merge

##### PR B6-3: Shared mechanism extraction under existing framework constraints

**Files likely touched**

1. existing approved harness framework areas
2. app-local adapters that consume those framework areas
3. standards or architecture guard files only if a separate approved framework-location update is part of the same sequence

**Actions**

1. extract generic mechanism
2. define narrow ports
3. keep app-specific interpretation in app adapters
4. do not introduce new framework directories such as `chat/`, `export/`, or `dag-view/` as part of this program unless the matching standards and guards are updated first
5. if DAG naming is needed in future follow-up work, use `dag/`, not `dag-view/`

**Done when batch 6 completes**

1. app glue is thinner
2. harness remains business-agnostic
3. cross-app equivalence tests prove framework lift did not change canonical view semantics

---

### 23.8 Batch 7: Social and Radar Alignment

#### Objective

Apply the same pattern to the other mission apps without forcing persistence unification.

#### Readiness requirement

Before Batch 7 starts, produce a short readiness assessment for both `social` and `radar` covering:

1. persistence model differences
2. event-shape differences
3. artifact-shape differences
4. rerun or resume policy differences
5. frontend detail-page readiness and owner

#### Required PRs

##### PR B7-1: Social contract alignment

**Files likely touched**

1. `backend/src/modules/ai-app/social/api/`
2. `backend/src/modules/ai-app/social/mission/query/`
3. `backend/src/modules/ai-app/social/mission/projectors/`

**Actions**

1. define social canonical detail view shape based on shared base
2. keep `SocialMission`-specific semantics in social app

##### PR B7-2: Radar contract alignment

**Files likely touched**

1. `backend/src/modules/ai-app/radar/api/`
2. `backend/src/modules/ai-app/radar/mission/query/`
3. `backend/src/modules/ai-app/radar/mission/projectors/`

**Actions**

1. define radar canonical detail view shape based on shared base
2. keep radar business semantics in radar app

##### PR B7-3: Optional frontend convergence

**Files likely touched**

1. per-app detail pages
2. common mission-detail shells

**Actions**

1. reuse canonical rendering pattern where shape matches
2. do not force UI parity where business display is materially different

---

## 24. PR Sequencing Rules

These rules remove ambiguity about execution order.

1. Batch 0 must finish before Batch 1 starts.
2. Batch 0.5 must finish before Batch 1 starts.
3. Batch 1 must finish before Batch 2 starts.
4. Batch 2 must finish before Batch 4 starts.
5. Batch 3 may overlap late Batch 2 only if contracts are already stable.
6. Batch 4 must finish before Batch 5 starts.
7. Batch 5 must not start until the hard gate in section 23.6 is satisfied.
8. Batch 6 may begin after Batch 2, but any lifted framework must not invalidate Batch 4 cutover semantics.
9. Any Batch 6 shared-hook signature change must update all three app adapters in the same PR sequence before merge.
10. Batch 6 framework merge requires cross-app equivalence coverage before merge.
11. Batch 7 must start only after Batch 4 is stable for playground and the readiness assessment in section 23.8 exists.

Recommended order:

1. B0-1
2. B0-2
3. B1-1
4. B1-2
5. B1-3
6. B2-1
7. B2-1a
8. B2-2
9. B2-3
10. B2-4
11. B3-1
12. B3-2
13. B3-3
14. B4-1
15. B4-2
16. B4-3
17. B4-4
18. B5-1
19. B5-2
20. B6-x
21. B7-x

---

## 25. Validation Commands and Checks

Every implementation PR must include exact validation evidence.

### 25.1 Backend minimum checks

Run:

```bash
cd backend
npm run type-check
npm run test -- mission-view.contract.spec.ts
npm run test -- fixture-replay.spec.ts
npm run test -- refresh-hint-roundtrip.spec.ts
npm run test -- projector-benchmark.spec.ts
```

And repo-level architecture checks as applicable.

### 25.2 Frontend minimum checks

Run:

```bash
cd frontend
npm run type-check
npm run test
```

For cutover PRs, also run relevant page integration tests.

For Batch 4, include screenshot evidence for the required fixture classes.

### 25.3 Full-repo checks before cutover batches

Run:

```bash
npm run type-check
npm run test
npm run verify:quick
```

Use stronger verification if the repository already requires it for mission-app changes.

### 25.4 PR evidence template

Every PR description should include:

1. batch and PR id
2. files changed
3. truth authority added or removed
4. tests run
5. fixture classes covered
6. known non-goals
7. behavior differences introduced, split into:
   - intentional bug fixes
   - expected user-visible deltas

---

## 26. Definition of Done by Milestone

### Milestone A

Done when B0 + B1 complete.

Signoff required from:

1. architecture owner
2. playground backend owner

### Milestone B

Done when B2 + B3 complete.

At this point backend can fully serve canonical mission detail truth.

Signoff required from:

1. playground backend owner
2. harness owner
3. QA

### Milestone C

Done when B4 + B5 complete.

At this point frontend is thin and no longer owns mission truth.

Signoff required from:

1. playground frontend owner
2. QA
3. design

### Milestone D

Done when B6 completes.

At this point generic runtime mechanism is materially more framework-owned.

Signoff required from:

1. harness owner
2. architecture owner
3. QA

### Milestone E

Done when B7 completes.

At this point all three mission apps share the same architectural pattern.

Signoff required from:

1. social PM or engineering owner
2. radar PM or engineering owner
3. harness owner
4. QA

---

## 27. Forbidden Shortcuts

These are explicitly forbidden even if they appear faster.

1. “We can cut over first and define semantics later.”
2. “We can keep old derive as hidden production backup.”
3. “We can temporarily let page choose old or new truth based on flag.”
4. “We can move business semantics into harness first and clean them later.”
5. “We can rewrite top-level directories while doing truth cutover.”
6. “We can skip fixtures and rely on manual testing.”

---

## 28. Final Execution Interpretation

If there is implementation disagreement, interpret this plan in the following priority order:

1. single-track truth beats convenience
2. semantic correctness beats file-count reduction
3. current blueprint compliance beats speculative layout cleanup
4. business-semantics ownership in app beats over-lifting to framework
5. explicit tests beat human confidence

---

## 29. Risk Register

Track at minimum these risks through the full program:

1. `p95` or `p99` detail-view latency regresses after projector consolidation
2. framework hook changes in Batch 6 break one app while another still passes local tests
3. derive removal exposes a legacy edge case that fixtures did not encode
4. long-leave or owner unavailability creates a bus-factor gap during cutover windows
5. cross-team disagreement on status or rerun semantics blocks milestone signoff
6. backend canonical empty-state contracts drift and frontend starts special-casing missing fields again
7. social or radar readiness is lower than assumed and Batch 7 slips behind playground completion

Fixture directories and `expected-view.json` assets should be protected with code ownership review at the repository level because they function as semantic contract inputs, not disposable test data.
