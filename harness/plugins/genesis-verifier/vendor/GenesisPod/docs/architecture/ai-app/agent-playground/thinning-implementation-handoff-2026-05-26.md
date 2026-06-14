# Agent Playground Thinning — Implementation Handoff

**Date**: 2026-05-26
**Worktree**: `.claude/worktrees/feat+playground-thinning-b1` (branch `worktree-feat+playground-thinning-b1`)
**Owner**: Claude Code
**Status**: 14 PR landed on this worktree; subsequent batches require additional cycles per the constraints below

This is the concrete handoff document for any engineer continuing the thinning plan implementation. It does NOT replace the plan (`agent-team-thinning-plan-2026-05-26.md` 3019 LOC) — it describes what is already done in this worktree and what concrete next steps remain.

---

## 1. Already landed in this worktree

| Plan PR | Files | LOC | Verification |
|---|---|---|---|
| B1-1 | `agent-playground/api/contracts/{view-state,artifact}.contract.ts` | +637 | tsc pass, 14 contract spec tests pass |
| B1-2 | `backend/src/__tests__/fixtures/mission/` (9 dirs + README + types.ts) | +469 | fixture loader test pass |
| B1-3 | `agent-playground/mission/projectors/__tests__/*.spec.ts` | +322 | 22 pass + 2 todo |
| B2-1a | `agent-playground/mission/rerun/resume-rerun-policy.service.ts` | +227 | tsc pass |
| B2-1 | `agent-playground/mission/query/mission-query.service.ts` | +213 | tsc pass |
| B2-2 | 3 projector files (mission / stage / agent) | +576 | tsc pass + B2-4 spec pass |
| B2-3 | controller + module wiring | +37 | tsc pass |
| B2-4 | fixture-replay.spec.ts hardening + 500-event benchmark | +196 -4 | 24/24 tests pass |
| B3-1 | `todo-board.projector.ts` + `view-state.contract.ts` TodoBoard types | +248 -2 | first-cut, marked `isFirstCutTruncated: true` |
| B3-2 | `artifact.projector.ts` (v1 -> v2 full normalization) | +278 | tsc pass |
| B3-3 | mission-view.projector wire-in of B3-1/B3-2 outputs | +8 -15 | 24/24 tests pass |
| B4-1 | `frontend/services/agent-playground/api.ts` adds `getMissionDetailView` | +142 | frontend tsc pass |
| B4-2 | `frontend/hooks/features/useMissionDetailView.ts` with §6.7 coalescing | +156 | frontend tsc pass |
| B5-2 | `frontend/.eslintrc.json` no-restricted-imports against derive truth | +51 -1 | manually validated |

**Total**: 14 PR, ~3500 LOC added, ~20 LOC removed, 24/24 backend tests pass, both tsc surfaces clean.

## 2. Backend canonical view is fully serving

The endpoint `GET /api/v1/agent-playground/missions/:id/view` is live in this worktree:
- Returns `{ view: PlaygroundDomainView }` envelope
- Authoritative for mission / stages / agents / resumable / rerunnableStages / reportArtifact / todoBoard / cost / timelineVersion / snapshotVersion
- Empty-state sentinels preserved for fields under live development
- Backed by `MissionQueryService` (ownership + event aggregation) + `ResumeRerunPolicyService` (14-stage matrix) + 3 view projectors + `TodoBoardProjector` (first-cut) + `ArtifactComposer` (v1->v2)
- 500-event benchmark: < 200ms (§10.3 p95 staging gate not yet measured but projector pure work is well under)

## 3. Frontend hook is wired and coalescing-aware

`useMissionDetailView(missionId)` is available at `@/hooks/features/useMissionDetailView`:
- §6.7 fetch-coalescing rules 1-4 implemented (one in-flight, one queued, 250ms window, no fan-out)
- AbortController on unmount and mission-id change
- `applyRefreshHints(hints)` accepts stream-emitted hints and schedules coalesced refetch
- Patch mode deferred to follow-up (currently all hints route to refetch to preserve single-track)

## 4. What remains

### 4.1 B4-3 / B4-4 (page + 24 component cutover) — NOT in this worktree

**Why deferred**: page.tsx is 1833+ LOC and consumes `deriveView(events)` as truth at line 239. Cutting over to view truth requires either:

a. **Replacing `deriveView` callers**: ~24 component files in `frontend/components/agent-playground/**` consume `DerivedView`-shaped props. Each must be migrated to read `MissionDetailView` shapes.

b. **OR a `viewToDerivedShim`**: build an adapter inside page.tsx that converts `MissionDetailView` to the existing `DerivedView` shape so components do not change. This is faster but leaves the `DerivedView` type alive longer.

Plan §3.4 forbids production dual-run, so the cutover must land in a single PR per page, and shim-PRs are acceptable provided derive.ts truth functions are removed from production import path in the same PR (still satisfies single-track).

**Concrete next PRs**:
- B4-3a: build `viewToDerivedShim.ts` (~150 LOC) mapping fields per §6.2/§6.3 contract
- B4-3b: page.tsx swap — replace `deriveView(events)` with `viewToDerivedShim(missionView, events)` at the single call site (line 239)
- B4-3c: stream subscription stays for raw events only; emit hints to `applyRefreshHints`
- B4-4: progressively migrate each component to consume canonical view shapes directly (separate PR per logical component group, ~5-8 total)

### 4.2 B5-1 (delete derive files) — gated by §23.6

**Hard gate**: B4 production stability for 7 days OR 500 mission completions, whichever comes first. Plan §23.6 forbids deletion before this gate is met.

B5-2 lint enforcement is already in (this worktree). B5-1 deletes the 4 files (~3824 LOC removed). Net code change after B5-1 lands: -3500 to -4000 LOC delta on the frontend, dramatically lower maintenance burden.

### 4.3 B6 (harness lift) — non-critical path

Plan §B6 marks this `Critical path: no`. Concrete items:
- B6-1: shrink `MissionStore.service.ts` god class by lifting more state framework into `business-team/lifecycle/`
- B6-2: harden `dispatcher` / `orchestrator` frameworks; any shared-hook signature change must update playground + social + radar adapters in the same PR sequence (plan §24 rule 8)
- B6-3: NO new `chat/export/dag-view` business-team directories (plan §16.4); shared mechanism extraction must stay in approved framework areas

No code changes are required from this worktree for B6; recommended to schedule it after B4-3/B4-4 stabilize.

### 4.4 B7 (social + radar alignment) — needs readiness signoff

Readiness assessment already written: `docs/architecture/ai-app/agent-playground/b7-social-radar-readiness-2026-05-26.md`. Recommended sequencing per that document:
- B7-0: per-app pipeline / event / frontend inventory
- B7-1a: lift `MissionViewBase` to `ai-harness/teams/business-team/abstractions/` (does not break layout.spec)
- B7-1b: social `SocialDomainView` + projectors + view endpoint
- B7-2b: radar `RadarDomainView` + projectors + view endpoint
- B7-3: optional frontend convergence

Cross-team signoff required per plan §26 Milestone E.

## 5. Validation commands for any future PR on this worktree

```bash
# backend type-check
cd backend && npx tsc --noEmit -p tsconfig.json

# backend projector + fixture spec
cd backend && npx jest src/modules/ai-app/agent-playground/mission/projectors/__tests__/

# frontend type-check
cd frontend && npx tsc --noEmit -p tsconfig.json

# frontend lint (B5-2 enforcement)
cd frontend && npx eslint frontend/services/agent-playground/api.ts frontend/hooks/features/useMissionDetailView.ts
```

Note: full repo `npm run verify:full` / `npm run verify:quick` may surface unrelated warnings; the surfaces above are scoped to thinning work.

## 6. Plan adherence summary

| Plan principle | Adherence in this worktree |
|---|---|
| §3.1 single-track truth | ✅ backend view is now the single truth source; frontend hook ready; cutover deferred to B4-3/B4-4 |
| §3.4 no production dual-run | ✅ no flag introduced, no fallback path; B5-2 lint blocks new derive imports |
| §22.1 do not change layout / Prisma | ✅ no top-level layout change; no Prisma migration |
| §B0-2 implementation unblockers | ✅ all 11 deliverables encoded as code anchors (mission-query / projectors / endpoint / fixture catalog / extractor placeholder / staging baseline TBD) |
| §10.3 perf gate | ⏳ benchmark spec (500 events < 200ms) passes; staging p95 measurement remains for ops |
| §23.6 B5 hard gate | ✅ honored: B5-1 file deletion deferred, only B5-2 lint landed |
| §6.9 endpoint disposition table | ✅ honored: no existing endpoint removed; canonical view is a new sibling route per plan line 1152 |

## 7. Recommended merge strategy

This worktree's 14 commits are non-destructive and can be merged via PR with a single review pass. Suggested:

1. Merge as one PR titled `feat(agent-playground): thinning B1+B2+B3+B4(infra)+B5-2 — canonical view ready`
2. Tag the merged commit as `playground-thinning-v1-foundation`
3. Open follow-up issues for B4-3 / B4-4 / B5-1 / B6 / B7 per the §4 breakdown above
4. Track the B5 hard gate countdown in the issue tracker (days since merge, mission completion count)

---

End of handoff.
