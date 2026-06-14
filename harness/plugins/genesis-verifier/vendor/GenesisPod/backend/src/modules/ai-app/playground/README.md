# playground

> Agent Mission Platform 当前生产形态的**标杆 ai-app**。31K LOC 后端 + 19K LOC 前端的核心模块（在 ai-app 里规模第 4），不是 demo / sandbox。
>
> **2026-06 改名**：模块/路由/WS namespace/billing moduleType 由 `agent-playground` 统一改为 `playground`（去冗余 `agent-` 前缀）。
> 仍保留 `agent-playground` 命名的是：① 前端功能目录 `components/agent-playground/`（前端组织，与后端解耦）；② 历史架构文档目录 `docs/architecture/ai-app/agent-playground/`（按日期归档，不追溯改名）。下方链接因此仍指向 `agent-playground/`。

## 这是什么

7 个协作 agent（leader / researcher / analyst / writer / reviewer / reconciler / steward）执行多维度深度研究 mission：

```
s1-budget → s2-leader-plan → s3-researchers ⇄ s4-leader-assess →
s5-reconciler → s6-analyst → s7-writer-outline → s8-writer-draft →
s8b-quality-enhancement → s9-critic-l4 → s9b-objective-evaluation →
s10-leader-signoff → s11-persist → s12-self-evolution
```

12-stage 线性 pipeline + per-dim fanout + chapter pipeline 状态机 + multi-judge verification（critic + verifier + reviewer）+ stage-level rerun。

## 文档入口

| 用途                                      | 文档                                                                                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **新 agent app 接入**（你大概率要看这个） | [docs/architecture/ai-app/agent-playground/playground-as-template.md](../../../../../docs/architecture/ai-app/agent-playground/playground-as-template.md)                                                 |
| 目录蓝图 + framework 完整清单             | [agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md](../../../../../docs/architecture/ai-app/agent-playground/agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md) |
| 9 维 DFX 评估（综合 A-）                  | [playground-dfx-assessment-2026-05-26.md](../../../../../docs/architecture/ai-app/agent-playground/playground-dfx-assessment-2026-05-26.md)                                                               |
| 成本治理                                  | [playground-cost-strategy-v1.md](../../../../../docs/architecture/ai-app/agent-playground/playground-cost-strategy-v1.md)                                                                                 |
| 完整 doc 索引                             | `docs/architecture/ai-app/agent-playground/*.md`（9 份）                                                                                                                                                  |

## 这**不是**什么的标杆

避免新 app 误抄。详细判定见 [playground-as-template.md §1](../../../../../docs/architecture/ai-app/agent-playground/playground-as-template.md#1-playground-是什么的标杆不是什么的标杆)。

| 不是                                              | 想做这个的话看                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| dynamic replan / Leader spawn-merge-cancel task   | insight（ai-app/insight，前端 ai-insights）+ [30-sota-task-centric-architecture.md](../../../../../docs/architecture/ai-harness/redesign/30-sota-task-centric-architecture.md) |
| HITL editable state（pause → edit task → resume） | 同上，30-sota #9 尚未在 playground 落地                                                                                                                                        |
| "minimal viable agent app" 形态参考               | `ask/` (7K LOC) 或 `simulation/` (4K LOC)                                                                                                                                      |
| todo-board projector 复杂度参考                   | radar 84 LOC 是 Level 1 模板，playground 1,739 LOC 是 Level 2 特例                                                                                                             |
| 通用 UI 原语来源                                  | playground 的 `components/agent-playground/ui/` 是业务专用（RoleChip / StatusPill / ToneCard 等），不该当 common 抄。`frontend/components/common/` 才是通用 UI 源头            |

## 看护机制

| 机制                                 | 文件                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 顶层目录布局看护                     | `backend/src/__tests__/architecture/layer-3-authority/agent-team-layout.spec.ts`                           |
| canonical view 6 不变量              | `backend/src/__tests__/architecture/layer-3-authority/canonical-view-pattern.spec.ts`                      |
| todo-board projector framework 合规  | `backend/src/__tests__/architecture/layer-6-durability/todo-board-projector-framework-conformance.spec.ts` |
| playground-as-template 跨 app 不变量 | `backend/src/__tests__/architecture/layer-6-durability/playground-as-template.spec.ts`                     |
| Facade 边界穿透                      | ESLint `no-restricted-imports`（`backend/.eslintrc.js`）                                                   |
| pre-push 防回潮                      | `.husky/pre-push` 跑 `npm run verify:arch`                                                                 |

## 进入开发前必读

`docs/CLAUDE.md`（项目根）+ `playground-as-template.md`（本目录起步指引）+ `agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md`（蓝图深读）。
