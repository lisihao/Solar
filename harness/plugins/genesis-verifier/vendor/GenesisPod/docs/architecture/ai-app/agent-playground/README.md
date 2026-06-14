# Agent Playground Architecture Docs

> Location: `docs/architecture/ai-app/agent-playground/`
> Baseline date: 2026-04-26

This directory contains the architecture baseline, audits, boundary design,
runtime contract material, rerun design, and cost strategy for
`agent-playground`.

---

## Core docs

| Document                                                                                                                                           | Purpose                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [mission-pipeline-baseline.md](./mission-pipeline-baseline.md)                                                                                     | Main baseline for mission pipeline architecture, contracts, and locked decisions                                                                                                         |
| [mission-pipeline-sota-audit-2026-04-29.md](./mission-pipeline-sota-audit-2026-04-29.md)                                                           | System-level audit against SOTA patterns                                                                                                                                                 |
| [contract-single-source-audit-2026-05-22.md](./contract-single-source-audit-2026-05-22.md)                                                         | Single-source and runtime contract audit                                                                                                                                                 |
| [agent-team-boundary-audit-2026-05-08.md](./agent-team-boundary-audit-2026-05-08.md)                                                               | Boundary review for app vs harness responsibilities                                                                                                                                      |
| [agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md](./agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md) | Target boundary and directory blueprint for app, harness, and frontend shells                                                                                                            |
| [playground-read-model-and-frontend-thinning-plan-2026-05-25.md](./playground-read-model-and-frontend-thinning-plan-2026-05-25.md)                 | Optimization plan for canonical read model, backend query projection, and frontend thinning                                                                                              |
| [agent-team-thinning-plan-2026-05-26.md](./agent-team-thinning-plan-2026-05-26.md)                                                                 | Main single-track thinning plan with batches, contracts, and execution rules                                                                                                             |
| [agent-team-thinning-gap-audit-2026-05-26.md](./agent-team-thinning-gap-audit-2026-05-26.md)                                                       | Gap audit comparing the thinning plan target state against the current local implementation                                                                                              |
| [playground-dfx-assessment-2026-05-26.md](./playground-dfx-assessment-2026-05-26.md)                                                               | 9-dimension DFX assessment (Reliability / Testability / Maintainability / Performance / Security / Observability / Deployability / Cost / UX) + frontend thinning 100% landed conclusion |
| [playground-multi-review-coverage-2026-05-26.md](./playground-multi-review-coverage-2026-05-26.md)                                                 | Multi-perspective review (5 paths: backend / frontend / architecture / QA / SRE) with 10 ASCII flow diagrams + 33-branch exception matrix + 100% inference coverage trace                |
| [playground-cost-strategy-v1.md](./playground-cost-strategy-v1.md)                                                                                 | Cost strategy for `deep` and `report` execution shapes, runtime spend control, and target economics                                                                                      |

---

## Pipeline design docs

| Document                                                                               | Purpose                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------- |
| [mission-pipeline-reconciler.md](./mission-pipeline-reconciler.md)                     | Reconciler stage design                     |
| [mission-pipeline-writer-artifact.md](./mission-pipeline-writer-artifact.md)           | Writer output and artifact contract         |
| [mission-pipeline-runresult-schema.md](./mission-pipeline-runresult-schema.md)         | Run result schema                           |
| [mission-pipeline-exit-policy.md](./mission-pipeline-exit-policy.md)                   | Exit policy and terminal conditions         |
| [mission-pipeline-finalize-gate.md](./mission-pipeline-finalize-gate.md)               | Finalize gate and completion rules          |
| [mission-pipeline-failure-learning.md](./mission-pipeline-failure-learning.md)         | Failure learning and pattern reuse          |
| [mission-pipeline-tool-recall.md](./mission-pipeline-tool-recall.md)                   | Tool recall policy                          |
| [mission-pipeline-tool-acl.md](./mission-pipeline-tool-acl.md)                         | Tool ACL and entitlements                   |
| [mission-pipeline-tool-failure-circuit.md](./mission-pipeline-tool-failure-circuit.md) | Tool failure circuit policy                 |
| [mission-pipeline-user-profiles.md](./mission-pipeline-user-profiles.md)               | User profile and default execution settings |
| [mission-pipeline-replay-api.md](./mission-pipeline-replay-api.md)                     | Replay API design                           |
| [mission-pipeline-audit-layers.md](./mission-pipeline-audit-layers.md)                 | Audit layer model                           |

---

## Rerun and maturity docs

| Document                                                                               | Purpose                               |
| -------------------------------------------------------------------------------------- | ------------------------------------- |
| [rerun-overhaul-design-v1.md](./rerun-overhaul-design-v1.md)                           | Rerun redesign                        |
| [stage-rerun-dispatcher-classification.md](./stage-rerun-dispatcher-classification.md) | Stage rerun dispatcher classification |
| [maturity-overhaul-plan-2026-05.md](./maturity-overhaul-plan-2026-05.md)               | Maturity improvement plan             |
| [benchmark-app-plan.md](./benchmark-app-plan.md)                                       | Benchmark application planning        |
| [r3-orchestration-remaining-spec.md](./r3-orchestration-remaining-spec.md)             | Remaining orchestration work          |

---

## Suggested reading order

1. Read [mission-pipeline-baseline.md](./mission-pipeline-baseline.md).
2. Read [mission-pipeline-sota-audit-2026-04-29.md](./mission-pipeline-sota-audit-2026-04-29.md).
3. Read [contract-single-source-audit-2026-05-22.md](./contract-single-source-audit-2026-05-22.md).
4. Read [agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md](./agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md).
5. Read [agent-team-thinning-plan-2026-05-26.md](./agent-team-thinning-plan-2026-05-26.md).
6. Read [playground-dfx-assessment-2026-05-26.md](./playground-dfx-assessment-2026-05-26.md) — current DFX status + thinning landed conclusion.
7. Read [playground-multi-review-coverage-2026-05-26.md](./playground-multi-review-coverage-2026-05-26.md) — 5-path review + flow diagrams + 100% branch coverage.
8. Read [playground-cost-strategy-v1.md](./playground-cost-strategy-v1.md).

---

## Guardrail mechanism — five hard-rule categories

Architecture is enforced by **executable rules**, not by review consensus. Below
each category links to the spec / lint id that enforces it.

### 1. 目录规则 (Directory placement)

| Rule                                                                                                           | Enforcement                                                            |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Backend canonical truth lives in `api/contracts` + `mission/query` + `mission/projectors` + `mission/services` | `backend/src/__tests__/architecture/canonical-view-pattern.spec.ts`    |
| `mission-presentation.types.ts` replaces deleted `derive-shapes.ts`                                            | `frontend/__tests__/protection-net/canonical-mission-truth.spec.ts` T4 |
| `mission-todo.types.ts` replaces deleted `todo-ledger-shapes.ts`                                               | same spec T5                                                           |
| Harness `business-team/abstractions/` retains business-agnostic types                                          | `backend/src/__tests__/architecture/layer-boundaries.spec.ts` R0-A5    |

### 2. 依赖方向规则 (Dependency direction)

| Rule                                                                                                 | Enforcement                                |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| L4 → L3 → L2.5 → L2 → L1 strict                                                                      | `layer-boundaries.spec.ts` 7 assertions    |
| `ai-app/**` only imports `ai-engine/**` via `facade/index.ts`                                        | same spec + ESLint `no-restricted-imports` |
| `ai-harness/**` never contains business names (`playground` / `topic-insights` / `agent-playground`) | `layer-boundaries.spec.ts` R0-A5           |
| `ai-engine/**` never imports `ai-harness/**`                                                         | same spec                                  |

### 3. Authority 单点规则 (Single-source authority)

| Concept                                           | Owning layer                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `mission.status` outward enum                     | backend canonical view (`mission-view.projector.ts`)                              |
| Todo truth                                        | backend `<app>-todo-board.projector.ts` (B7 freeze)                               |
| Artifact canonicalization (v1 → v2 + R2 off-load) | backend `ArtifactComposerService` (playground) / `composeSocialArtifact` (social) |
| Resume / rerun policy                             | `BusinessTeamResumeRerunPolicyFramework`                                          |
| Frontend mission truth                            | `useMissionDetailView` (single hook entry)                                        |
| Stream immediacy                                  | `useAgentPlaygroundStream` (no truth)                                             |
| Raw event trace parsing                           | frontend §7.2 presentation layer (`drawer-derive.ts`)                             |

Enforcement: `canonical-view-pattern.spec.ts` invariants I1-I6 + `canonical-mission-truth.spec.ts` T2/T3.

### 4. 禁止回流规则 (Anti-resurrection)

| Forbidden                                                                      | Enforcement                                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `frontend/lib/features/agent-playground/derive.ts`                             | T1 spec + ESLint pattern block                             |
| `todo-ledger.ts` / `synthesize-artifact.ts` / `view-to-derived.shim.ts`        | T1 spec + ESLint                                           |
| Old `derive-shapes.ts` / `todo-ledger-shapes.ts` filenames                     | T1 spec (the rename was the cutover)                       |
| `page.tsx` re-introducing `getMissionDetail` / `listResumableMissions` imports | T3 spec (assertion that page.tsx import map excludes them) |

### 5. 行为验证规则 (Behavior verification, post-compile semantic drift detection)

| Layer                                     | Spec                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| Contract shape                            | `fixture-replay.spec.ts` — 9 fixtures × 12 invariants = 107 assertions |
| Endpoint baseline                         | `playground-frontend-contract.spec.ts` (path / status / shape lock)    |
| Event registration ↔ frontend consumption | `playground-event-contract.spec.ts`                                    |
| §6.7.3 multi-pod refresh hint injection   | `socket-broadcast.adapter.spec.ts` (14 tests)                          |
| Cross-app pattern parity                  | `canonical-view-pattern.spec.ts` (23 tests)                            |
| Frontend single-source truth              | `canonical-mission-truth.spec.ts` (18 tests)                           |

### CI / pre-push gates

| Gate                                                              | Stage                    |
| ----------------------------------------------------------------- | ------------------------ |
| ESLint `no-restricted-imports`                                    | lint-staged (pre-commit) |
| `tsc --noEmit` backend + frontend                                 | pre-push step 1          |
| `npm run verify:arch` (layer-boundaries + canonical-view-pattern) | pre-push step 0          |
| Changed-files tests                                               | pre-push step 4          |
| god-class size guard (>2500 LOC growth wall)                      | pre-push step 0a         |
| i18n placeholder audit                                            | pre-push step 5          |
| Backend runtime deps audit                                        | pre-push step 6          |

If any gate fails, `git push` is rejected. No `--no-verify` bypass is allowed by
CLAUDE.md §"Git 安全操作" unless the failure is environmental (commitlint
missing, etc.) and explicitly granted by the user for that single push.

---

## Notes

- Historical or superseded material should go under [`_archive/`](./_archive/).
- New architecture docs for `agent-playground` should be indexed here.
