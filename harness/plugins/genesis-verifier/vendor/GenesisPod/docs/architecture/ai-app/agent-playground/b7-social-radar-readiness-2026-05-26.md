# B7 Social + Radar Readiness Assessment

**Date**: 2026-05-26
**Owner**: Claude Code
**Status**: required by thinning plan §23.8 "Readiness requirement" before Batch 7 starts

This document satisfies the §23.8 readiness requirement: a short readiness assessment for both `social` and `radar` covering persistence model differences, event-shape differences, artifact-shape differences, rerun/resume policy differences, and frontend detail-page readiness.

---

## 1. Persistence model differences

| Field family | `AgentPlaygroundMission` | `SocialMission` | `RadarRun` |
|---|---|---|---|
| Identity | `id` / `userId` / `workspaceId?` | `id` / `userId` / `workspaceId?` | `id` / `userId` / `workspaceId?` / `topicId` |
| Input | `topic / depth / language / maxCredits / dimensions` | `contentId / platforms[] / connectionIds / depth / budgetProfile / language / maxCredits` | `topicId / trigger / payload / maxCredits / wallTimeCapMs` |
| Lifecycle | `status / startedAt / completedAt / elapsedWallTimeMs` | `status / startedAt / completedAt / elapsedWallTimeMs` | `status / startedAt / completedAt / durationMs / wallTimeCapMs` |
| Cost | `tokensUsed / costUsd / trajectoryStored` | `tokensUsed / costUsd` | inside `metrics` JSON |
| Terminal | `failureCode / errorMessage` | `failureCode / errorMessage` | `failureCode / error` |
| Artifact | `reportFull / reportFullUri / reportFullSize / reportArtifactVersion` | `trajectory / trajectoryUri / trajectorySize` | `metrics + RadarDailyBriefing` (separate model) |
| Config snapshot | `configSnapshot` ✅ | `configSnapshot` ✅ | `configSnapshot` ✅ |
| Pod-aware | `lastCompletedStage / heartbeatAt / podId` ✅ | `lastCompletedStage / heartbeatAt / podId` ✅ | `lastCompletedStage / heartbeatAt / podId` ✅ |

**Shared abstractions (already aligned)**: `configSnapshot`, `lastCompletedStage`, `heartbeatAt`, `podId`, `failureCode`. These three apps already share the §5.3 configSnapshot canonical input source pattern.

**Per-app projection cost**: each app needs its own `MissionQueryService` + projector set; the canonical `MissionViewBase` (per `view-state.contract.ts`) is reusable but each app must contribute its own `XxxDomainView` extension.

## 2. Status enum differences (critical: §6.4.1 mapping)

| App | Persisted status values (from schema comments) | Maps to `MissionStatus` |
|---|---|---|
| playground | `running / completed / failed / rejected` | `rejected -> quality-failed`（§6.4.1.a rule 4）|
| social | `running / completed / failed / aborted` | `aborted -> cancelled`（new B7 mapping rule needed） |
| radar | `running / completed / failed / cancelled / rejected` | `rejected -> quality-failed`（或 social-style 各自 app projector 决定） |

**Required B7 action**: Add per-app "Persistence-to-view mapping" subsection to plan §6.4.1.a documenting social's `aborted -> cancelled` and radar's full mapping. **Not** a generic framework rule; each app's projector owns it.

## 3. Event-shape differences

| App | Event prefix | Event buffer | Replay endpoint |
|---|---|---|---|
| playground | `agent-playground.*` | `MissionEventBuffer` | `GET /agent-playground/replay/:missionId` |
| social | `social.*` (assumed) | per-app `SocialEventBuffer`（同 framework 基类） | path TBD（B7 inventory needed） |
| radar | `radar.*` (assumed) | per-app `RadarEventBuffer` | path TBD |

**Required B7 action**: each app's `events.json` fixture schema must mirror its own replay endpoint, per §6.8 admission rule 3.

## 4. Artifact-shape differences

- **playground**: `ReportArtifactV2`（sections / citations / figures / quickView / factTable / quality）— first cut B3-2 normalization table established
- **social**: trajectory JSON contains `probeResults / platformVersions / covers / composed / published / verified / leaderSignOff` — **shape entirely different**; cannot share v1→v2 normalization rules
- **radar**: no per-run artifact; the user-facing artifact is `RadarDailyBriefing` (separate model). View endpoint needs separate composition for briefing-level artifacts.

**Decision matrix**:
- social view's `reportArtifact` field is **not** `ReportArtifactV2`; it must declare its own canonical shape (e.g. `SocialPublishedArtifact`) as a separate union under `MissionViewBase.reportArtifact?: unknown`.
- radar view's `reportArtifact` might better surface as `briefingRef` (foreign key) and let the briefing detail endpoint own its own artifact contract.

## 5. Rerun / resume policy differences

| App | Has 14-stage matrix? | Rerun controllers | Resume policy notes |
|---|---|---|---|
| playground | yes (§6.5.1.b) | `POST /missions/:id/rerun` + todo-level rerun | configSnapshot-gated, 14 stages |
| social | **unknown**; pipeline stages likely 8-12 (probe → compose → cover → publish → verify) | TBD per controller inventory | configSnapshot-gated assumed |
| radar | trigger-based (cron / manual); rerun semantics different | TBD per controller inventory | likely no stage-level rerun |

**Required B7 action**: each app's projector must encode its own resume matrix; copying playground's 14-stage table to social or radar is wrong.

## 6. Frontend detail-page readiness

| App | Current detail page | Owns derive code? | Cutover blocker |
|---|---|---|---|
| playground | `frontend/app/agent-playground/team/[missionId]/page.tsx` (1833+ LOC) | yes (derive.ts 1030 LOC + todo-ledger.ts 2229 LOC + synthesize-artifact.ts 236 LOC + drawer-derive.ts 329 LOC = 3824 LOC) | B5 hard gate + 24 component cutover |
| social | not yet inventoried | unknown | needs detail page audit |
| radar | not yet inventoried | unknown | needs detail page audit |

**Required B7 action**: dedicated frontend inventory PR for social and radar before B7-1/B7-2 backend contract land.

---

## Recommended B7 sequencing

Within plan §24 PR Sequencing Rule 10 ("Batch 7 must start only after Batch 4 is stable for playground and the readiness assessment in section 23.8 exists"), this assessment unblocks the **next** steps:

1. **B7-0** (added by this assessment): per-app pipeline + event + frontend inventory
2. **B7-1a**: extract `MissionViewBase` from `agent-playground/api/contracts/view-state.contract.ts` to a harness-side shared base (requires §16.4 standards update for `business-team/abstractions/`)
3. **B7-1b**: social `SocialDomainView` + projectors + `GET /social/missions/:id/view`
4. **B7-2b**: radar `RadarDomainView` + projectors + `GET /radar/runs/:id/view`
5. **B7-3**: frontend convergence per app (optional; not all apps need same page shape)

**Blocking constraints**:
- B7 will trigger expansion of `MissionViewBase.mission.status` mapping rules (social `aborted`, radar full set) — these are app-projector-owned, not framework-owned.
- harness shared base extraction (B7-1a) needs `business-team/abstractions/` accepted by `agent-team-layout.spec.ts`. Currently `abstractions/` is one of the 12 allowed business-team subdirs, so adding files there does not require white-list expansion. ✅

**Estimated effort**: per-app B7 batches are L (mirror to playground B1+B2+B3 sequence). Cross-team coordination required: social PM/eng owner + radar PM/eng owner each sign off per plan §26 Milestone E.

---

## Decision: this assessment alone does NOT execute B7

This document satisfies §23.8 readiness requirement. It does not write code. Per the recommended sequencing above, the next concrete coding step is B7-0 (pipeline / event / frontend inventory for social and radar), then B7-1a (shared base lift to harness), then per-app B7 batches.
