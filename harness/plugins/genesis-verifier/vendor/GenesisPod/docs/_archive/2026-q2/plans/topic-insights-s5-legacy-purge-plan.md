# S5 · Topic Insights Legacy Purge Plan

> **Status:** planning complete, execution deferred
> **Owner:** —
> **Prerequisites:** `b98eae241` (SOTA layout), `11f2da568` (Tier A/B naming), `4ddeb3d07` (Tier C/D) — all landed

## Why this is a plan, not a PR

The obvious view — "after the harness is wired, delete `TopicInsightsService`, all `leader/*`, `dimension/*`, `task-executors/*` and 4 legacy configs" — is wrong. A mid-session audit (2026-04-23) discovered:

1. **`TopicInsightsService` is not a god service to remove.** It is the active CRUD backend for all 5 controllers (topic, mission, report, report-review, collaboration). Deleting it deletes the whole HTTP surface.
2. **`execution.service.ts` has ~1500 lines after the `runWithHarness` early-return.** They look dead, but they are the bodies of public methods (`resumeExecution`, `continueExecution`, `executeDynamicScheduler`, `executeGenericDimensionResearch`, `addAgentToLeaderPlan`, `handleResumeMissionExecution`, `handleRecoveryNeeded`, `finalizeMission`) that are reachable from:
   - `mission.controller.ts` — `leaderChat` endpoint calls `addAgentToLeaderPlan` + `resumeExecutionForNewTask` + `resumeExecution`
   - `research-todo.service.ts` — emits `RESUME_MISSION_EXECUTION` event from todo execute / resume flows
   - `health/mission.service.ts` — emits `RECOVERY_NEEDED` event from health checks
   - `leader-intent.service.ts` — emits `RESUME_MISSION_EXECUTION` from leader chat intent routing
3. **The 4 legacy configs each back a live service:**
   - `agent-roles.config.ts` → `topic-insights.service.ts`
   - `dimension-templates.config.ts` → `topic-dimension.service.ts`
   - `framework-skills.config.ts` → `leader-planning.service.ts`
   - `prompt-adaptation.config.ts` → `section-writer.service.ts`

Removing any of these without replacement is a feature-deletion, not a refactor.

## Product-scope decisions required

Each of the following legacy endpoints / behaviors must be decided **keep / harness-native rewrite / remove** before any code deletion.

### Mission lifecycle

| Endpoint / event                                      | Legacy method                              | Decision needed                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `POST /topics/:id/leader/plan`                        | `LeaderPlanningService.planForMission`     | Harness's `ST-01-PLAN` already produces a plan. Does the user still need a separate "pre-plan-without-execution" endpoint?      |
| `POST /topics/:id/mission/approve-plan`               | `approvePlanAndExecute` → `startExecution` | Harness auto-runs the full pipeline. Is the approval gate still a product requirement?                                          |
| `POST /topics/:id/mission/retry`                      | `retryMission`                             | Harness has no retry primitive — a retry would call `runWithHarness` again. Trivial to rewire.                                  |
| `POST /topics/:topicId/missions/:missionId/resume`    | `resumeExecution`                          | Harness stages are atomic; "resume" means "restart from the stage that failed". Needs harness-side checkpoint / resume support. |
| `GET /topics/:topicId/missions/:missionId/can-resume` | Legacy state check                         | Once harness resume is defined, this can be recomputed.                                                                         |
| `POST /topics/:id/mission/cancel`                     | `cancelMission`                            | Harness orchestrator needs cancellation signal. Partial support exists via `AbortSignal`.                                       |
| `POST /topics/:id/mission/adjust`                     | `adjustMission` → `addAgentToLeaderPlan`   | Mid-flight plan mutation is incompatible with harness's atomic stage model. Strong candidate for **removal**.                   |

### Leader chat (dynamic orchestration)

| Endpoint                           | Behavior                                                             | Decision                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /topics/:id/leader/message`  | One-shot message to leader                                           | Can be a `SpecAgentRegistry.get("AG-01-LD").executeSpec(...)` call. Rewire.                                                                              |
| `POST /topics/:id/leader/chat`     | Multi-turn leader chat with side effects (add agent, resume mission) | Side effects incompatible with harness. Either **remove** dynamic mutations (keep chat read-only) or define a new harness "chat intervention" primitive. |
| `GET /topics/:id/leader/decisions` | Read decisions                                                       | Harness emits stage events; decisions can be derived. Rewire.                                                                                            |

### Health / recovery

| Source                                            | Emits                                     | Decision                                                                                                                                                                                   |
| ------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `services/health/mission.service.ts`              | `RECOVERY_NEEDED`                         | Harness failures should be terminal in the new model — a failed mission is re-run, not recovered. **Remove recovery path**, simplify health to read-only.                                  |
| `services/collaboration/research-todo.service.ts` | `RESUME_MISSION_EXECUTION` on todo resume | Todos are tied to legacy dynamic scheduler. In harness world there are no per-todo tasks to resume. Either **rewire todos as read-only UI** or re-design the todo primitive around stages. |

### Dimension CRUD (serves UI)

| Endpoint                                                | Service method                 | Decision                                                                                                                          |
| ------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /topics/:id/dimensions`                            | `TopicDimensionService.list`   | Pure CRUD, keep — but move off `dimension-templates.config.ts` by inlining the templates into `agents-spec/dimension-planner.ts`. |
| `POST /topics/:id/dimensions`                           | `TopicDimensionService.create` | Keep, template source-of-truth moves to the spec.                                                                                 |
| `Patch/Delete /dimensions/:id`                          | standard CRUD                  | Keep.                                                                                                                             |
| `POST /topics/:topicId/dimensions/:dimensionId/refresh` | Triggers per-dimension mission | Needs harness single-dimension mode (scoped pipeline run).                                                                        |

## Execution order (proposed)

1. **Phase 1 — lock the scope.** Product owner marks each row above with keep / rewrite / remove.
2. **Phase 2 — harness primitives.** Add to harness what the "rewrite" rows require: cancel signal, stage-level checkpoint/resume, single-dimension scope, decision emission. Do not touch legacy code yet.
3. **Phase 3 — rewire kept endpoints.** Switch each controller method from legacy services to harness primitives. Keep legacy methods as unused but compiling.
4. **Phase 4 — delete removed endpoints.** For the "remove" rows, delete the controller method + swagger doc + frontend call site in the same PR.
5. **Phase 5 — orphan sweep.** With controllers clean, legacy services that no longer have callers can be deleted. Config files and `specialized-agents.types.ts` follow.
6. **Phase 6 — execution.service.ts rewrite.** Collapse to just `startExecution → runWithHarness`. Delete `executorMap`, `task-executors/`, and the 1500-line tail.

## Scope estimate

- Phase 1 (product decisions): **0.5 day** with product owner present.
- Phase 2 (harness primitives): depends on how many rewrite rows survive. **2–4 days** for full cancel + resume + single-dimension support.
- Phases 3–6 (execution): **2 days** end-to-end once primitives exist.

## What this session did _not_ do and why

- Did not delete `execution.service.ts` tail → it has live callers via controllers and events, pending Phase 1 decisions.
- Did not delete 4 legacy configs → each backs a live service.
- Did not delete legacy `leader/*`, `dimension/*`, `research/{leader,strategy,template}.service.ts` → all have live callers or are transitively reachable from controllers.
- Did not touch stage-ID constants in code (`ST-06-COGLOOP` etc.) even though filenames changed → event strings are a wire-protocol decision; changing them is observable by subscribers.

Tier A / B / C / D naming and SOTA directory layout _did_ land safely (see commits `b98eae241`, `11f2da568`, `4ddeb3d07`). The directory is now standard-bearer-shaped; the legacy code inside is the open work.
