# 架构规则例外登记

> **目的**：架构规则的合法例外集中登记，不允许"永久临时"。
>
> **强制**：任何架构规则的偏离必须列在本文档。未登记的偏离 = CI fail（参见 `architecture-exceptions.spec.ts`）。
>
> **维护**：每条例外必须有 5 字段 — 位置 / 为什么允许 / 负责人 / 移除截止 / 不移除的风险。

---

## 例外清单

### E001 — `useMissionLegacyView` hook

| 字段             | 内容                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **位置**         | `frontend/hooks/features/useMissionLegacyView.ts` (624 LOC)                                                                                                                                                                                                                                                                                                                                         |
| **违反规则**     | 第 5 层 §5.1（mission truth 唯一入口 `useMissionDetailView`）                                                                                                                                                                                                                                                                                                                                       |
| **为什么允许**   | hook 实际做两件事：(A) canonical 透传 — 这部分确实多余；(B) events 派生 — `agent.trace` / `cost.byStage` / verdict fallback 等数据 backend canonical view **不暴露**（trace 数据量大、per-stage cost 是 events-only aggregation），必须前端从 raw events 派生。简单删 hook 会再次干掉 Drawer 工具调用 / Tokens / ReAct 过程 / 工具延迟矩阵。本会话已多次撞此坑（Screenshot_13/15/16/17/19/20/21）。 |
| **负责人**       | 架构组                                                                                                                                                                                                                                                                                                                                                                                              |
| **移除截止**     | 暂未定（拆分计划：A 部分清掉，B 部分改名 `useEventDerivations` 缩到 ~150 LOC）                                                                                                                                                                                                                                                                                                                      |
| **不移除的风险** | shim 越长越混乱；新功能可能继续往里塞                                                                                                                                                                                                                                                                                                                                                               |

---

### E002 — `mission-presentation.types.ts` 中的 `DerivedView` shape

| 字段             | 内容                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| **位置**         | `frontend/lib/features/agent-playground/mission-presentation.types.ts`            |
| **违反规则**     | 第 5 层 §5.4（前端只剩 presentation helpers）                                     |
| **为什么允许**   | `DerivedView` 是 legacy shape，组件 prop 类型还在用。E001 退休后才能跟着 retire。 |
| **负责人**       | 架构组                                                                            |
| **移除截止**     | 跟随 E001 退休                                                                    |
| **不移除的风险** | type 漂移到不一致                                                                 |

---

### E003 — `drawer-derive.ts` UI-only 派生

| 字段             | 内容                                                      |
| ---------------- | --------------------------------------------------------- |
| **位置**         | `frontend/lib/features/agent-playground/drawer-derive.ts` |
| **违反规则**     | §7.2 "presentation-only fallbacks" 例外（合法）           |
| **为什么允许**   | `*-shapes` 代理保留，仅 UI-only 派生（不构造 truth）      |
| **负责人**       | 架构组                                                    |
| **移除截止**     | 不计划移除（合法 presentation-only）                      |
| **不移除的风险** | 无（已限定为 UI-only）                                    |

---

### E004 — Terminal sweep（agent / chapter / todo phase 强制收尾）

| 字段             | 内容                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **位置**         | `backend/src/modules/ai-app/playground/mission/projectors/mission-view.projector.ts` (agent sweep) + `todo-board.projector.ts` (chapter / todo sweep)                                                                                                                                                                                                                              |
| **违反规则**     | 第 3 层 §3.1（agent.phase truth 应纯由事件派生）                                                                                                                                                                                                                                                                                                                                   |
| **为什么允许**   | playground sub-agent（chapter-writer / quality-judge / chapter-reviewer 等）从来不走 `emitLifecycle('completed')` —— 它们的"完成"由 chapter:writing:\* / dimension:graded 等业务事件间接表达。当 mission 已盖章 terminal 但子 agent 缺显式 completion 事件时，下游 UI 会显示"23 个 Agent 正在工作"假象（Screenshot_17/22）。Sweep 强制收尾保证一致性，事件完整性让位于真相一致性。 |
| **负责人**       | 架构组                                                                                                                                                                                                                                                                                                                                                                             |
| **移除截止**     | 修源（chapter-pipeline.helper.ts 等 sub-agent 路径补 emitLifecycle）后可移除。建议至少 sub-agent 5 个类型补完                                                                                                                                                                                                                                                                      |
| **不移除的风险** | 失去 "agent X 还在跑" 这一信息，但 mission terminal 时此信息无意义                                                                                                                                                                                                                                                                                                                 |

---

### E005 — `chapter-pipeline.helper.ts` sub-agent 不发 `emitLifecycle`

| 字段             | 内容                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **位置**         | `backend/src/modules/ai-app/playground/mission/pipeline/helpers/chapter-pipeline.helper.ts` 及类似 sub-agent 调用路径                                    |
| **违反规则**     | 第 6 层 §6.1 mission timeline 必须覆盖 stage / agent / lifecycle                                                                                         |
| **为什么允许**   | sub-agent 数量大（每个 chapter × attempt 一个 writer + reviewer），全部走 emitLifecycle 会显著放大事件流。当前用业务事件（chapter:writing:\*）变相表达。 |
| **负责人**       | 架构组                                                                                                                                                   |
| **移除截止**     | 与 E004 联动                                                                                                                                             |
| **不移除的风险** | sub-agent observability 弱（必须通过 chapter event 间接看）                                                                                              |

---

### E006 — `MissionViewBaseAgent` 扩展字段（attempt / dimension / iterations / wallTimeMs / startedAt / endedAt）

| 字段             | 内容                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **位置**         | `backend/src/modules/ai-harness/teams/business-team/abstractions/mission-view-base.contract.ts`                                                                                                                       |
| **违反规则**     | 第 3 层 §3.4（events-only data 不进 canonical view）                                                                                                                                                                  |
| **为什么允许**   | `ComputeUsagePanel` 跨 app 通用组件，要的就是 per-agent timing。从 events 派生在 frontend 多 app 重复实现成本高；放在 canonical contract 上由 backend projector 派生一次，3 个 mission app 共享（Screenshot_19/20）。 |
| **负责人**       | 架构组                                                                                                                                                                                                                |
| **移除截止**     | 不计划移除（合法 cross-app primitive）                                                                                                                                                                                |
| **不移除的风险** | 无（已限定为 optional 字段）                                                                                                                                                                                          |

---

### E007 — ESLint `no-restricted-imports` file-level override

| 字段             | 内容                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| **位置**         | `backend/.eslintrc.js` 多个 `overrides[].files`                           |
| **违反规则**     | 第 2 层 §2.3（override 必须文档化）                                       |
| **为什么允许**   | 不同层（ai-app / ai-engine / ai-harness）的禁忌不同，需要 file-level 区分 |
| **负责人**       | 架构组                                                                    |
| **移除截止**     | 不计划移除（合法 file-level lint discipline）                             |
| **不移除的风险** | 无                                                                        |

---

### E008 — `handoffs/` 模块 zero consumer

| 字段             | 内容                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| **位置**         | `backend/src/modules/ai-harness/handoffs/` (254 LOC + 465 LOC test)                                    |
| **违反规则**     | 第 7 条硬规则（新共享逻辑 < 2 app 复用不准上提）                                                       |
| **为什么允许**   | OpenAI 标准 handoff pattern，未来 business-team multi-agent 协作落地后会接入。已有测试覆盖，模块自洽。 |
| **负责人**       | 架构组                                                                                                 |
| **移除截止**     | 与 business-team multi-agent 接入联动；若 2026 Q4 仍无 consumer，删除                                  |
| **不移除的风险** | 254 LOC 死代码 + 465 LOC 测试维护成本                                                                  |

---

### E009 — 4 个 god 文件（>2500 LOC）暂未拆分

| 字段             | 内容                                                                                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **位置**         | `ai-engine/content/report-template/pipeline/report-formatting.utils.ts` (4345)<br/>`ai-harness/facade/ai.facade.ts` (3002)<br/>`ai-engine/llm/services/ai-chat.service.ts` (2794)<br/>`ai-harness/teams/orchestrator/teams-mission-orchestrator.ts` (2649) |
| **违反规则**     | §16 §六 500 行硬上限                                                                                                                                                                                                                                       |
| **为什么允许**   | 跨层依赖广，拆分需配套 re-export 兼容层。已落 god-class size guard（增量 > 50 LOC 拒推）冻结存量。                                                                                                                                                         |
| **负责人**       | 架构组                                                                                                                                                                                                                                                     |
| **移除截止**     | 优先拆 `ai.facade.ts`（纯 facade，拆完零迁移成本）                                                                                                                                                                                                         |
| **不移除的风险** | god 文件单文件锁 (修一个字段动全身)                                                                                                                                                                                                                        |

---

### E010 — `social/mission/services/ai-social.service.ts` 1608 LOC god class (P0 残留)

| 字段             | 内容                                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **位置**         | `backend/src/modules/ai-app/social/mission/services/ai-social.service.ts`                                                                                                                    |
| **违反规则**     | §16 §六 500 行硬上限 + 单一职责原则                                                                                                                                                          |
| **为什么允许**   | 已经在 commit `27233e264` 拆出 SocialConnectionsService / XhsMcpFacadeService / SocialImportSourcesService（god 从 1608 LOC 砍到 880 LOC）。剩余的 content CRUD + publish 路径目前未继续拆。 |
| **负责人**       | 架构组                                                                                                                                                                                       |
| **移除截止**     | 与 social mission/services 万能桶治理联动                                                                                                                                                    |
| **不移除的风险** | 后续新需求继续往里塞                                                                                                                                                                         |

---

### E011 — social `services/` 平铺 21 文件（god 集合）

| 字段             | 内容                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| **位置**         | `backend/src/modules/ai-app/social/mission/services/`                |
| **违反规则**     | §16 子目录组织（应按子域拆 wechat/ xhs/ content/ session/ publish/） |
| **为什么允许**   | playground B7 模板未推广到 social                                    |
| **负责人**       | 架构组                                                               |
| **移除截止**     | 跟随 social B7 整改                                                  |
| **不移除的风险** | 越来越乱                                                             |

---

### E012 — `infer-is-reasoning-callers.contract.spec.ts` 使用 `dimension` 词汇

| 字段             | 内容                                                                                |
| ---------------- | ----------------------------------------------------------------------------------- |
| **位置**         | `backend/src/__tests__/architecture/infer-is-reasoning-callers.contract.spec.ts:47` |
| **违反规则**     | 第 4 层禁词（spec 不算 production，应允许）                                         |
| **为什么允许**   | 是 spec 文件本身，引用 ai-app 路径用于检测 caller                                   |
| **负责人**       | 架构组                                                                              |
| **移除截止**     | 不计划（spec 合法用例）                                                             |
| **不移除的风险** | 无                                                                                  |

---

### E013 — B6 uplift baseline（19 个 business-team framework single-consumer）

| 字段             | 内容                                                                                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **位置**         | `backend/src/modules/ai-harness/teams/business-team/` 下 19 个 framework / helper / decision 文件                                                                                                                                                                                 |
| **违反规则**     | 硬规则 #7（harness 新共享逻辑 ≥2 app 复用）                                                                                                                                                                                                                                       |
| **为什么允许**   | B6 把 19 个 framework 从 agent-playground 上提到 harness/business-team 完成框架，但 social / radar 实际接入还在 wave-by-wave 进行中。当前 single-consumer 是迁移期的合理过渡态，不算 regression。**新增**文件仍必须 ≥2 consumer 才能上提（spec 用 EXEMPT_PATHS 仅豁免现有 19 个） |
| **负责人**       | 架构组                                                                                                                                                                                                                                                                            |
| **移除截止**     | 跟随 social B7 + radar B7 整改完成；每个 app 接入后，从 EXEMPT_PATHS 删除对应文件                                                                                                                                                                                                 |
| **不移除的风险** | 长期不接入，新的 framework 还往里堆，最终成为只服务 playground 的 misnamed harness 包                                                                                                                                                                                             |
| **基线文件清单** | 19 项详见 `backend/src/__tests__/architecture/harness-uplift-gate.spec.ts` 中 `EXEMPT_PATHS` 数组                                                                                                                                                                                 |

---

## 例外审计 (CI)

- `backend/src/__tests__/architecture/vocab-purity.spec.ts` 检查 harness / engine production 源码不含禁词
- 但 spec / 注释 / bindings 内合法出现 → 通过白名单 / 路径过滤
- `EXCEPTIONS.md` 中登记的临时例外（E001 / E002 / E004 / E005 / E009 / E010 / E011）会作为 spec 输入豁免（必须显式列出文件路径）

---

## 增 / 删例外的流程

### 新增例外

1. PR 必须同步更新本文件 + 加新 E### 条目
2. 5 字段必填（位置 / 为什么允许 / 负责人 / 移除截止 / 风险）
3. PR description 标 `[arch-exception]` 触发 reviewer 重点 review

### 移除例外

1. 实际把例外修了 → PR 删除本文件对应条目
2. 同步删除相关 spec 豁免（如 vocab-purity 的路径白名单）
3. PR description 标 `[arch-exception-removed]`

---

**最后更新**：2026-05-27
**版本**：v1.0
**关联文档**：[ARCHITECTURE_RULES.md](./ARCHITECTURE_RULES.md)
