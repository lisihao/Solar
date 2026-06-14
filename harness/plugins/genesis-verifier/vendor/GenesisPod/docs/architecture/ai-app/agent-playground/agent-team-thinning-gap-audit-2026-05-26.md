# Agent Team Thinning Gap Audit

> Scope: `agent-playground`
> Audit date: `2026-05-26`
> Baseline plan: [agent-team-thinning-plan-2026-05-26.md](./agent-team-thinning-plan-2026-05-26.md)

This document records the current gap between the thinning plan target state and
the local codebase state as audited on `2026-05-26`.

It is intentionally implementation-facing:

1. it compares design intent against code
2. it separates structure from implementation completeness
3. it identifies what is done, partially done, and not done

---

## Summary

The current state is:

1. backend canonical read-model work is largely in place
2. frontend cutover is still in a bridge state
3. old frontend truth infrastructure still exists
4. test and fixture coverage is materially better than early-plan state, but not fully closed

High-level conclusion:

- backend architecture and directory goals are mostly achieved
- frontend architecture and authority-removal goals are not yet fully achieved
- the overall program is **partially complete, not fully complete**

---

## Status Scale

- `Met`: materially aligned with the plan
- `Partial`: the primary path exists, but the target state is not fully achieved
- `Not Met`: the target state is still missing in a way that matters architecturally

---

## Gap Table

| Area                                    | Plan target                                                                                         | Current local state                                                                                                                              | Status  | Evidence                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend top-level app layout            | Keep approved blueprint: `module/api/runtime/mission/events` and optional `integrations/__tests__`  | Current app top-level is `api/events/integrations/mission/module/runtime/__tests__`                                                              | Met     | [agent-playground](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground)                                                                                                                                                                                                                                                     |
| Backend mission internal structure      | Add `mission/query/`, `mission/projectors/`, `mission/services/` without rewriting top-level layout | `mission/` now contains `query/`, `projectors/`, `services/` plus pre-existing business directories                                              | Met     | [mission](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/mission)                                                                                                                                                                                                                                                      |
| Frontend feature-layer target structure | Thin frontend feature area so only light helpers remain authoritative                               | `derive.ts`, `todo-ledger.ts`, `drawer-derive.ts`, `synthesize-artifact.ts`, `view-to-derived.shim.ts` all still exist                           | Not Met | [frontend feature dir](/D:/projects/codes/genesis-agent-teams/frontend/lib/features/agent-playground)                                                                                                                                                                                                                                                      |
| Canonical backend contract              | Backend owns the canonical mission detail contract                                                  | Contract files exist and are wired into backend code                                                                                             | Met     | [view-state.contract.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/api/contracts/view-state.contract.ts), [artifact.contract.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/api/contracts/artifact.contract.ts)                                                           |
| Canonical query aggregation             | `MissionQueryService` owns row/events/checkpoint/report versions/artifact aggregation               | Query service loads row, events, checkpoint availability, report versions, and composed artifact                                                 | Met     | [mission-query.service.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/mission/query/mission-query.service.ts)                                                                                                                                                                                                      |
| Resume/rerun policy ownership           | Backend policy service owns resumable/rerunnable decisions                                          | `ResumeRerunPolicyService` exists and is used by query service                                                                                   | Met     | [resume-rerun-policy.service.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/mission/rerun/resume-rerun-policy.service.ts)                                                                                                                                                                                          |
| Artifact canonicalization               | Backend service owns artifact normalization and off-load retrieval                                  | `ArtifactComposerService` exists and query service awaits it                                                                                     | Met     | [artifact-composer.service.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/mission/services/artifact-composer.service.ts), [mission-query.service.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/mission/query/mission-query.service.ts)                                    |
| Canonical detail endpoint               | Canonical truth route must exist and be wired                                                       | `GET /missions/:id/view` exists and returns projected canonical view                                                                             | Met     | [mission-read.controller.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/api/controller/mission-read.controller.ts:83)                                                                                                                                                                                              |
| Canonical view field completeness       | Canonical view should expose core detail fields rather than placeholder empties                     | Current projector now injects `references`, `reportVersions`, `verdicts`, `memoryIndex`, `dimensionPipelines`; still not proven fully exhaustive | Partial | [mission-view.projector.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/mission/projectors/mission-view.projector.ts)                                                                                                                                                                                               |
| Starting placeholder ownership          | Canonical route should own startup placeholder semantics                                            | Canonical query/projector path supports starting placeholder, but legacy `GET /missions/:id` still carries its own starting fallback             | Partial | [mission-query.service.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/mission/query/mission-query.service.ts), [mission-read.controller.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/api/controller/mission-read.controller.ts:111)                                      |
| Todo truth downshift to backend         | Backend should own todo truth instead of frontend `todo-ledger.ts`                                  | Backend projector ports a substantial share of todo truth, but the file still declares follow-up cases                                           | Partial | [todo-board.projector.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/mission/projectors/todo-board.projector.ts)                                                                                                                                                                                                   |
| Frontend truth source                   | Frontend should consume canonical truth without relying on legacy detail route for business truth   | Page still calls `getMissionDetail()` and `listResumableMissions()` and uses persisted fallback logic                                            | Not Met | [page.tsx:231](/D:/projects/codes/genesis-agent-teams/frontend/app/agent-playground/team/[missionId]/page.tsx:231), [page.tsx:258](/D:/projects/codes/genesis-agent-teams/frontend/app/agent-playground/team/[missionId]/page.tsx:258), [page.tsx:306](/D:/projects/codes/genesis-agent-teams/frontend/app/agent-playground/team/[missionId]/page.tsx:306) |
| Frontend component contract             | Components should eventually consume canonical view directly                                        | Page still routes data through `viewToDerivedShim()` to satisfy old `DerivedView` surfaces                                                       | Not Met | [page.tsx:349](/D:/projects/codes/genesis-agent-teams/frontend/app/agent-playground/team/[missionId]/page.tsx:349), [view-to-derived.shim.ts](/D:/projects/codes/genesis-agent-teams/frontend/lib/features/agent-playground/view-to-derived.shim.ts)                                                                                                       |
| Old frontend authority removal          | Old derive/todo/artifact truth files should no longer define production authority                   | Old files remain in repo and continue to support the bridge layer                                                                                | Not Met | [derive.ts](/D:/projects/codes/genesis-agent-teams/frontend/lib/features/agent-playground/derive.ts), [todo-ledger.ts](/D:/projects/codes/genesis-agent-teams/frontend/lib/features/agent-playground/todo-ledger.ts), [synthesize-artifact.ts](/D:/projects/codes/genesis-agent-teams/frontend/lib/features/agent-playground/synthesize-artifact.ts)       |
| Stream vs truth split                   | Stream for immediacy, canonical view for truth                                                      | Split exists in principle, but page still performs persisted row fallback and compatibility synthesis                                            | Partial | [useMissionDetailView.ts](/D:/projects/codes/genesis-agent-teams/frontend/hooks/features/useMissionDetailView.ts), [page.tsx](/D:/projects/codes/genesis-agent-teams/frontend/app/agent-playground/team/[missionId]/page.tsx)                                                                                                                              |
| Fixture catalog                         | 9 fixture classes should exist in the repo                                                          | All 9 fixture directories exist with the expected files                                                                                          | Met     | [fixtures/mission](/D:/projects/codes/genesis-agent-teams/backend/src/__tests__/fixtures/mission)                                                                                                                                                                                                                                                          |
| Fixture replay coverage                 | Replay tests should use the fixture catalog as executable semantic assets                           | Replay spec exists and all fixtures are present, but comments still describe an older partial-materialization state                              | Partial | [fixture-replay.spec.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/mission/projectors/__tests__/fixture-replay.spec.ts)                                                                                                                                                                                           |
| Anonymizer / extractor closure          | Fixture extraction and anonymization should be closed-loop and tool-backed                          | README defines the rules, but the extractor/anonymizer workflow still reads like follow-up guidance rather than a hardened enforced path         | Partial | [fixtures README](/D:/projects/codes/genesis-agent-teams/backend/src/__tests__/fixtures/mission/README.md)                                                                                                                                                                                                                                                 |
| Module wiring                           | New services should be part of the Nest module graph                                                | Module wiring exists for query and rerun policy services                                                                                         | Met     | [agent-playground.module.ts](/D:/projects/codes/genesis-agent-teams/backend/src/modules/ai-app/agent-playground/module/agent-playground.module.ts:176)                                                                                                                                                                                                     |

---

## Batch-by-Batch Completion View

| Plan batch  | Intended outcome                                             | Current state                                                                                 | Status  |
| ----------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------- |
| `B0 / B0.5` | semantic freeze, contract completion, implementation anchors | reflected in docs and backend contract work                                                   | Met     |
| `B1`        | contract + fixture layer                                     | contracts exist; fixture catalog exists; anonymizer closure is still softer than target       | Partial |
| `B2`        | backend canonical read model                                 | query/policy/projector/canonical endpoint are in place                                        | Met     |
| `B3`        | todo/artifact canonicalization                               | artifact path is strong; todo path is meaningfully ported but not yet obviously final         | Partial |
| `B4`        | frontend canonical data cutover                              | page-level cutover is present, but bridge logic still leans on old detail data and old shapes | Partial |
| `B5`        | old frontend authority removal                               | old truth infrastructure still exists and still matters                                       | Not Met |
| `B6`        | framework lift hardening                                     | some shared extraction exists, but this is not visibly complete from current app state        | Partial |
| `B7`        | social/radar alignment                                       | not verifiably complete from current local `agent-playground` state alone                     | Not Met |

---

## Key Remaining Gaps

### 1. Frontend is still in bridge mode

The most important remaining gap is not backend modeling anymore. It is the
frontend bridge layer.

Remaining bridge indicators:

1. old `getMissionDetail()` still participates in page logic
2. `listResumableMissions()` is still queried separately in the page
3. persisted-row fallback still synthesizes mission/stage/agent state
4. `viewToDerivedShim()` still adapts canonical view into old `DerivedView`

This means the frontend has moved onto the canonical route, but has not yet
completed authority cleanup.

### 2. Components still depend on legacy shapes

The current cutover is page-first, not component-first.

That is acceptable for a migration step, but it means the target state has not
been reached yet. The component layer still wants `DerivedView`, not the
canonical backend contract.

### 3. Old frontend truth files are not retired

Even if they are no longer the primary truth source for the page, they remain
part of the active compatibility surface.

This means:

1. migration risk remains
2. cognitive load remains
3. the authority story is cleaner than before, but not yet final

### 4. Todo truth has moved, but not obviously reached final parity

The backend todo projector is no longer trivial. It has meaningful business
coverage. But its own file-level comments still acknowledge remaining follow-up
coverage gaps.

This makes it `Partial`, not `Met`.

### 5. Fixture infrastructure is materially improved, but not fully hardened

The fixture catalog is no longer placeholder-only. That earlier diagnosis is no
longer accurate.

However, the extractor/anonymizer workflow still reads like a governed process
that needs one more hardening pass to become fully closed-loop.

---

## Corrected Interpretation

A corrected reading of the current state is:

1. backend architecture and directory goals are mostly achieved
2. backend canonical read-model implementation is largely real, not placeholder
3. frontend still carries the main remaining architectural debt
4. the program should now be judged by frontend authority cleanup, not by
   whether backend query/projector directories exist

---

## Final Assessment

The local codebase is **not fully aligned** with the target state of the
thinning plan.

But the reason is now more specific than earlier intermediate audits:

- the backend half is largely present
- the remaining meaningful gaps are concentrated in the frontend bridge layer
- therefore the program is in a **late-middle migration state**, not an early
  scaffold state

---

## Recommended Next Audit Focus

The next audit should focus on:

1. removing page-level dependence on legacy `getMissionDetail()` truth fallback
2. eliminating `viewToDerivedShim()` from the production path
3. moving components off `DerivedView` onto canonical view props
4. proving todo parity against the former frontend truth path
5. hardening fixture extraction and anonymization into a single enforced path
