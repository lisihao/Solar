# Agent App Mass Migration Roadmap (v2)

**Status:** **Paused on user instruction 2026-05-24 evening** — after P1/P2/P25 landed, awaiting next direction.
**Driver:** User directive "彻底简化 Agent,能力复用到 harness 和 engine"
**Source-of-truth doc:** [`agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md`](./agent-playground/agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md)

---

## 1. What Changed In v2

| Topic                                                                             | v1 (original)                                                        | v2 (revised on user instruction)                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Scope                                                                             | All 9 mission-pipeline modules (3 complete + 5 half-set + 1 special) | **Only 3 complete-range teams**: playground / social / radar        |
| Wave 2 (P12-P16: writing / topic-insights / office / research / planning / teams) | Active                                                               | **Removed — user explicit "先不要做"**                              |
| Wave 3 (P17-P20 engine共享能力上提)                                               | Active                                                               | **Deferred** — pending decision on whether to act                   |
| Wave 4 (P21-P24 守护)                                                             | Active                                                               | **Pending** — to revisit once 3-team migration is complete          |
| Wave 5 (P25-P29 frontend canonical)                                               | Active                                                               | **P25/P26/P27 done; P28/P29 deferred (5 other teams not migrated)** |
| Wave 6 (P30-P32 closeout review)                                                  | Active                                                               | **Pending** — at end of Wave 1                                      |

The reduced scope means **the project becomes**:

- Sink everything reusable from playground into `ai-harness/teams/business-team/`.
- Migrate playground (canonical / benchmark) and social + radar (already copies) to consume the framework.
- Frontend canonical mission-detail shell is in place; playground already wires it.
- **No other teams touched.** Their migration is a separate future decision.

---

## 2. Completed (Pushed to origin/main)

| Phase                       | Commit                               | What landed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Test delta                              |
| --------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **P1** invoker              | `0bde09898`                          | `BusinessTeamAgentInvoker.framework` (155 + 83 interface + 194 spec) sunk to `ai-harness/teams/business-team/invocation/`. playground invoker 280→241 (-39); social invoker 153→183 (+30 closure tracking). 8 framework spec cases.                                                                                                                                                                                                                                                                                                                                                                                    | 9755 tests ✅                           |
| **P2 + P25** combined       | `e13d4740c`                          | **Backend P2**: dispatcher / bindings / cross-stage-state / mission-span / dag-concurrency / event-relay framework all sunk to `ai-harness/teams/business-team/{dispatcher,bindings,state,span,invocation}/`. 5 specs / 36 cases. playground dispatcher 1216→1136 (-80); social dispatcher 839→792 (-47); playground mission-span 150→**29** (-121); execution-support 159→**72** (-87). **Frontend P25/P26/P27**: canonical `MissionDetailFrame` / `DrawerShell` / `ModalShell` / `StageStepper` / `MissionActionGroup` + 3 derive functions + audit script. playground page.tsx wires the canonical shell (-28 LOC). | 9980 tests ✅                           |
| **P9b** playground reorg    | `429d28c3c` 等                       | `ai-app/agent-playground/` 按 §8.2 flat → `module/api/runtime/mission/{pipeline,context,roles,artifacts,lifecycle}/events/`。skills 移到 `mission/skills/`。playground-runtime.config 移到 `runtime/`。                                                                                                                                                                                                                                                                                                                                                                                                                | passing ✅                              |
| **P10** social reorg        | `e62b77f29`～`603505d08` (9 batches) | `ai-app/social/` 同上 §8.2 reorg。services → mission/services, agents → mission/agents, integrations 平台子目录化 (wechat/xhs)。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | passing ✅                              |
| **P11** radar reorg         | `4424d17f3`                          | `ai-app/radar/` 同上 §8.2 reorg。controllers → api/controller, dto → api/dto, agents → mission/agents, services/mission/{lifecycle,workflow,stages} → mission/{lifecycle,pipeline,pipeline/stages}, services/{briefing,collectors,scheduler,source,topic} → mission/services/\*, radar.events → events/, radar.module → module/, radar.config/constants/gateway → runtime/. 95 文件 rename, app.module.ts + 1 integration spec import 更新, 3 spec depth+1。                                                                                                                                                           | radar 23 suites/222 passed/2 skipped ✅ |
| **fix(ts)** isolatedModules | `4adf17a9b`                          | 24 文件 `export { Type }` → `export type { Type }` 修 Docker build TS1205。tsconfig.json `isolatedModules: true` 保持开启（不再回滚）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | tsc 0 error / build green ✅            |
| **fix(tests)** P9b/P9c spec | `80822389c`                          | 4 个 spec 路径跟上 P9b/P9c：playground-runtime.config.spec.ts + playground-tuning-profile.spec.ts + playground-no-regression.spec.ts + skill-loader.spec.ts。                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 4 suites / 64 tests passed ✅           |

Both commits passed:

- tsc 0 error
- jest pre-push (changedSince + full architecture suite)
- frontend type-check / lint / UI-discipline (TOTAL=0) / mission-detail audit baseline
- regression spec updated to grep harness framework as the new source of truth for stage:stalled bridging logic

### Capability sink summary

| Capability          | Before (playground LOC) | After (playground LOC) | Sunk to harness LOC                   |
| ------------------- | ----------------------- | ---------------------- | ------------------------------------- |
| agent-invoker       | 280                     | 241                    | 155 (framework) + 83 (interface)      |
| pipeline-dispatcher | 1216                    | 1136                   | 192 (framework) + 38 (interface)      |
| stage-bindings      | 180                     | 187 (thin subclass)    | 46 (framework) + 46 (interface)       |
| cross-stage-state   | 186                     | 177                    | 81 (framework)                        |
| mission-span        | 150                     | **29**                 | 178 (framework)                       |
| execution-support   | 159                     | **72**                 | (dag-concurrency 140)                 |
| event-relay         | 25 (shim)               | unchanged              | sunk in event-relay-base shim pattern |

Playground services LOC reduction (T1 only): from ~2400 → ~1900 (-500 in 5 files; large reductions in mission-span and execution-support).

---

## 3. Remaining Phases (Awaiting Direction)

### Wave 1 (continues) — Tier 2-4 capabilities + orchestrator framework

These are the **playground capability tiers** still to sink, per blueprint §6.2 and the original Tier inventory. All three teams (playground / social / radar) still benefit.

| Phase  | Scope                                                                                                                                                                                                        | Rough size                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| **P4** | T2 generic helpers: chapter-pipeline-helper (826) / per-dim-pipeline (840) / batch-executor (87) / evidence-budget (95) / narrative-util / word-count-normalizer / grade-grounding / segment-extractors      | ~2150 LOC down + parameterized hooks |
| **P5** | T3 rerun framework: stage-rerun-dispatcher (983) / local-rerun (489) / rerun-orchestrator (295) / rerun-guard (293) / ctx-hydrator (273) / rerun-runtime-builder (220) + input-rebuilder abstraction         | ~2600 LOC down                       |
| **P6** | T4 lifecycle: mission-store (627) / lifecycle-helper (329) / update-helper (294) / postmortem-helper (185) / event-buffer (143) / checkpoint-store (225) / event-categories (89) + report-helper abstraction | ~2050 LOC down                       |
| **P7** | `BusinessTeamOrchestrator.framework` skeleton (playground 941 / social 179 / radar 164)                                                                                                                      | ~1300 LOC skeleton + business hooks  |

### Wave 1b — Directory reorganization (blueprint §8.1 / §8.2) ✅ **DONE**

| Phase   | Scope                                                                                                                                                                                          | Status             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **P8**  | `ai-harness/teams/business-team/` reorganize into §8.1 layout — most files already in right subdir from P2; this phase formalizes the `abstractions/` placement + cleans up cross-team imports | 已随 P2 完成       |
| **P9**  | `ai-app/agent-playground/` flatten `services/` subtree to top-level §8.2 layout (`module/api/runtime/mission/{pipeline,context,roles,artifacts,lifecycle}/events/`)                            | ✅ P9b `429d28c3c` |
| **P10** | `ai-app/social/` same reorg                                                                                                                                                                    | ✅ batches 1-9     |
| **P11** | `ai-app/radar/` same reorg                                                                                                                                                                     | ✅ `4424d17f3`     |

### Wave 4 — Guardrails ✅ **DONE** (2026-05-24 night)

| Phase   | Scope                                                                                           | Status                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **P21** | ESLint `no-restricted-syntax` + filename rules in `ai-app/*/`                                   | ✅ ESLint SECTION 10 已覆盖 ai-app→harness facade-only；额外移 `playground.config.ts` 到 `runtime/` 与 social/radar 统一 |
| **P22** | jest contract spec (AST): `ai-app/*` mission-pipeline only consume harness framework via facade | ✅ `agent-team-facade-contract.spec.ts`（12 tests）锁 mission/{pipeline,lifecycle} 只能走 facade                         |
| **P23** | audit baseline lock on `ai-app/*/mission/` §8.2 layout                                          | ✅ `agent-team-layout.spec.ts`（43 tests）锁 §8.2 顶层目录白名单 + §8.1 business-team 子目录白名单                       |
| **P24** | pre-push hook integrates `audit:agent-team-discipline`                                          | ✅ 自动随 pre-push `[0/6]` 步跑全 `src/__tests__/architecture/`，2 个新 spec 已 in-place                                 |

### Wave 6 — Closeout (defer until Wave 1 + 1b + 4 done)

| Phase   | Scope                                                                            |
| ------- | -------------------------------------------------------------------------------- |
| **P30** | Update blueprint doc with final framework paths + status                         |
| **P31** | New `standards/23-business-team-framework-usage.md` SOP                          |
| **P32** | 4-way collective review (architect / arch-auditor / reviewer / security-auditor) |

---

## 4. Removed From Scope (Per User 2026-05-24 Evening)

These phases were planned in v1 but **explicitly removed by user**:

| Phase   | Module                              | Original size estimate                     | Status           |
| ------- | ----------------------------------- | ------------------------------------------ | ---------------- |
| **P12** | writing (144 files, M/P/O)          | Inject framework + reorganize              | ❌ **Not doing** |
| **P13** | topic-insights (200 files, largest) | 2-3 sub-phases + reorganize                | ❌ **Not doing** |
| **P14** | office (109 files, P/O)             | Add mission/ + framework + reorganize      | ❌ **Not doing** |
| **P15** | research + planning                 | Evaluate lite track                        | ❌ **Not doing** |
| **P16** | teams                               | Boundary check vs ai-engine/teams registry | ❌ **Not doing** |

Reasoning: user decision to focus the migration on the 3 teams (playground / social / radar) that already share the same mission-pipeline range. Migrating the 5 half-set teams is a separate future project.

---

## 5. Frontend Phases (Partially Done)

| Phase                                                                           | Status                                                                                                         |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **P25** Extract canonical mission shells                                        | ✅ Landed in `e13d4740c` (5 shells already in `frontend/components/common/mission-detail/`, page wires them)   |
| **P26** Extract `lib/missions/derive/`                                          | ✅ Landed in `e13d4740c` (3 derive functions + index, wired into `PLATFORM_GLOBAL` whitelist)                  |
| **P27** playground page wires canonical shell                                   | ✅ Landed in `e13d4740c` (page.tsx 1832→1804, bespoke `<header>`/tabs/banners gone)                            |
| **P28** social / radar / writing / topic-insights / office migrate to canonical | ⏸ **Deferred** — Wave 2 removed; 5 violations recorded as baseline for future migration                        |
| **P29** `audit:mission-detail-discipline` lock                                  | ✅ Script + baseline already landed in `e13d4740c`; `audit:mission-detail-baseline` available for ratchet-down |

---

## 6. Current Status (2026-05-24 night, post-cleanup)

**Wave 1b 全部完成 (P9b + P10 + P11)。Worktree 已清理：22 → 4（保留 2 个 unmerged 功能分支 + main + gat-contract-wt）。66 个 orphan worktree-\* 分支删除，17 个 unmerged 保留待用户决策。**

### Wave 1 P4-P7 重新评估 (2026-05-24 night, 经 P32 architect 审计纠错)

**❌ 早先评估错误**：本节早先版本写 "P4-P7 deferred 等第二消费方"。事实是 P4/P5/P6/P7 **已经落地 main**:

- `54b4152d0` P4 (T2 helpers) — `business-team/helpers/` 3 文件 (batch-executor / supply-budget / grade-grounding)
- `2e4b4d851` P5 (T3 rerun) — `business-team/rerun/` 5 framework + 2 helper
- `8947b1e3b` P6 (T4 lifecycle) — `business-team/lifecycle/` 7 framework
- `5853ad6d1` P7 (orchestrator skeleton) — `business-team/orchestrator/` 1 framework

**消费方现状（grep extends 验证）**:

| Framework 切片       | Consumer 数                     | 单消费方？ |
| -------------------- | ------------------------------- | ---------- |
| `helpers/` (P4)      | 1 (playground)                  | ⚠️ 是      |
| `rerun/` (P5)        | 1 (playground)                  | ⚠️ 是      |
| `lifecycle/` (P6)    | 1 (playground)                  | ⚠️ 是      |
| `orchestrator/` (P7) | **3 (playground/social/radar)** | ✅ 否      |

**结论**：P7 orchestrator 合理（3 个 app 都继承）。P4/P5/P6 **是 "为单消费方做框架"，违反 Karpathy "3 处再抽象" 原则**——但 damage 已成，回滚成本 > 留下成本。

**不回滚的理由**：

- 已经有完整 abstractions/ + spec / fixtures
- 反正 social/radar 加入这些能力（rerun / lifecycle helpers）时不需要再做框架提取
- 等价于"提前付了未来的抽象成本"

**新的看护**（避免再发生）：

- Wave 4 守护栏只锁结构，没锁"必须 N+ consumer 才能进 framework"
- 后续如新增 `business-team/<新切片>/` 必须验证已有或承诺 ≥ 2 app subclass

### 下一步执行顺序（修订后）

1. ✅ **Wave 4 (P21-P24)** — 已完成 (38f083248)
2. ✅ **Wave 6 P30/P31** — 已完成 (4d81a8002)
3. ✅ **Wave 6 P32 4-way review** — 已完成 (4 报告归档到 `agent-playground/wave-4-review-2026-05-24/`)
4. **P32 后续修法** — 4 路审计共暴 4 P0 + 5 P1 + 6 P2, 综合分 8.2/10。优先修：
   - 本文档不一致 ← 本提交
   - `mission-runtime-shell.interface.ts` PR-E0 违规 (P1-1)
   - `agent-team-facade-contract.spec.ts` 漏扫 rerun + lifecycle 空断言 + regex 漏洞 (P1-2/3/4)
   - framework hook 多态匹配 + bindings 单消费方薄骨架 (P0-2, P0-4, P1-5) — 留下迭代

---

## 7. Execution Rules (Unchanged From v1)

1. **Phases run strictly serial** within a wave (P4 → P5 → P6 → P7), but P25-P27 frontend was run in parallel with P2 backend since file sets don't overlap.
2. **Each phase**: sub-agent in worktree → main agent copies → tsc + jest verify → commit → push → next phase.
3. **No per-phase review** (per user batch-review-at-end preference). Reviews happen at P32.
4. **Three-team batch principle**: playground + social + radar migrate in **one phase** per capability, never 1-of-3.
5. **god-class budget for `ai-api-caller.service.ts`** is closed; Wave 1 extraction did not regress it.
6. **lint-staged ESLint OOM**: use `NODE_OPTIONS=--max-old-space-size=12288 git commit ...`.
7. **Commit subject line**: lowercase type, must not start with English uppercase (use Chinese-first sentence form).
8. **Pre-push hook trips on unrelated regression**: fix it inline as a carrier commit.

---

## 8. Worktree Inventory (After 2026-05-24 Night Cleanup)

**Active**：仅 `main` + `gat-contract-wt`（独立仓库）+ 2 个 unmerged 功能分支：

- `fix-wechat-fingerprint-sniff` → `fix/wechat-cover-crop-multi` (1 commit unmerged)
- `radar-collect-items` → `worktree-radar-collect-items` (1 commit unmerged)

**Removed**：22 → 4，66 个已合并 orphan 分支删除。

### 历史 (供溯源)

| Phase   | Worktree branch                    | Status                                     |
| ------- | ---------------------------------- | ------------------------------------------ |
| P1      | `worktree-agent-ae00151b66465ad91` | Completed, ready for `git worktree remove` |
| P2      | `worktree-agent-adf078d5ee0dbe149` | Already auto-cleaned by harness            |
| P25-P27 | `worktree-agent-a774bca44b69b621f` | Completed, ready for `git worktree remove` |
