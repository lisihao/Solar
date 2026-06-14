# MECE 与边界合规审计报告

**审计日期**: 2026-06-04
**审计视角**: mece-boundary（MECE 与边界合规）
**审计对象**: `docs/architecture/ai-harness/self-driven-team/self-driven-agent-team-design-2026-06-04.md`
**参照规范**: `CLAUDE.md` MECE 强制原则、Facade 边界、反向洞察 10 条、文档组织规范
**审计员**: Arch Auditor Agent v2.0 (mece-boundary lens)
**状态**: approve-with-changes

> **对抗式复核校准**：mece-01（engine/planning LLM 冲突）经复核 **holdsUp=false，降为 nit**——其依据的"engine 层禁 LLM"规则不存在（CLAUDE.md 仅 engine/evaluation 标注无 LLM，engine/llm 本就是 LLM 聚合，engine 多个聚合合法调 AiChatService）；mece-02 降为 minor；mece-03 降为 minor。详见各条复核结论。

---

## 元信息：核实范围

以下文件已 Read / Grep 核实（未读文件不出现在结论中）：

| 文件路径                                                                              | 用途                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------ |
| `ai-engine/routing/scored-router.service.ts`                                          | 验证 ScoredRouterService 存在        |
| `ai-engine/planning/context/context-compression.service.ts`                           | 验证 engine/planning 层 LLM 调用存量 |
| `ai-harness/teams/orchestrator/orchestrator.interface.ts`                             | 验证 MissionExecutionPlan 已定义     |
| `ai-harness/teams/factory/team-factory.ts`                                            | 验证 createFromConfig 存在           |
| `ai-harness/teams/orchestrator/dynamic-planning.ts`                                   | 验证 tryDynamicDecomposition 现状    |
| `ai-harness/evaluation/thresholds.constants.ts`                                       | 验证阈值常量                         |
| `ai-harness/evaluation/critique/report-artifact/report-artifact-assembler.service.ts` | 验证现有组装服务位置                 |
| `ai-harness/evaluation/verify/judge.service.ts`                                       | 验证 harness/evaluation 调 LLM       |
| `ai-engine/evaluation/checkers/coherence.checker.ts`                                  | 验证 engine/evaluation 无 LLM        |
| `__tests__/architecture/layer-4-vocabulary/ai-engine-structure.spec.ts`               | 验证 verify:arch 覆盖                |
| `__tests__/architecture/layer-4-vocabulary/capability-singleton.spec.ts`              | 验证单例清单                         |
| `backend/.eslintrc.js`                                                                | 验证 no-restricted-imports 覆盖      |

---

## 执行摘要（对抗复核后）

| #       | 发现                                               | 原severity | 复核后    | 结论                                                                                 |
| ------- | -------------------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------ |
| mece-01 | engine/planning 新分解原语归 engine 自相矛盾       | major      | **nit**   | 论点依据的规则不存在；真问题仅是设计稿 §4 自拟判据「用 LLM → harness」措辞内部不一致 |
| mece-02 | engine/evaluation 禁 LLM 的 spec 断言尚未存在      | major      | **minor** | 断言确不存在，但设计稿明标为「新增断言/P1 待交付」；须补 planning-LLM 例外白名单策略 |
| mece-03 | DeliverableComposer 归 harness/evaluation 概念越位 | major      | **minor** | MECE 越位真实，但属目录归属决策，且设计有「就地泛化 assembler」合理依据              |
| mece-04 | MissionPlan 与 MissionExecutionPlan 同语义平行     | minor      | minor     | 建议合并扩展                                                                         |
| mece-05 | 新组件 abstractions/ 落点模糊                      | minor      | minor     | 需明确落点                                                                           |
| mece-06 | design-review 命名与 wave-4-review 先例不同型      | minor      | minor     | 建议调整命名                                                                         |
| mece-07 | singleton spec 未锁定三个新名称                    | nit        | nit       | 实现时同步                                                                           |

---

## D1：ScoredRouterService（✅ 成立）

`ai-engine/routing/scored-router.service.ts:32` — `export class ScoredRouterService implements IScoredRouter`，已在 engine/routing 聚合且经 facade 导出。设计稿描述正确。

---

## D2：engine/planning 分解原语归位（复核 nit）【mece-01】

**原发现**：把"目标→子步骤分解原语（纯 LLM 拆解）"归 engine/planning 与 MECE 判据「engine 层无 LLM」矛盾，且 `context-compression.service.ts:21/:42/:260` 已有 LLM 存量。

**对抗复核结论（holdsUp=false，降 nit）**：代码引用属实，但核心论点基于**不存在的规则**。CLAUDE.md line 65 明确 `engine/llm/` 是 LLM 聚合，AiChatService 本体即在 engine；仅 engine/evaluation 标注「无 LLM」。engine 的真正 MECE 判据是「不知 agent/mission（无 agent 状态）」，与是否调 LLM 无关。实证：engine 层 knowledge/rerank、rag/pipeline、safety、tools、planning/context 等 13+ 文件合法调 AiChatService。故新增"纯 LLM 拆解原语"归 engine/planning 与既有模式一致、**合规**。

**唯一真问题（nit）**：设计稿 §4 自拟判据写「engine 不知 agent/mission 且无 LLM → engine；用 LLM → harness」，与同节把"纯 LLM 拆解"归 engine 自相矛盾，且该"用 LLM → harness"措辞是全 docs/architecture 唯一出处（非项目级规则）。**修正建议**：删去 §4 判据中"且无 LLM / 用 LLM → harness"，改为以 agent/mission 状态为唯一分层判据。

---

## D3：engine/evaluation 禁 LLM 的 spec 覆盖（复核 minor）【mece-02】

设计稿 §10/§12 P1 把「engine/evaluation 不得出现 LLM 调用」列为 verify:arch 断言与 P1 验收，但现有 arch spec 套件无任何此类断言（`ai-engine-structure.spec.ts` 律1-6 不含 LLM 调用检查；全 architecture 目录 grep 无命中）。engine/evaluation 现状确为零 LLM。

**复核**：成立但设计稿明标为「新增断言」非谎称已存在，降 minor。**真正缺口**：engine/planning 在调 LLM（`context-compression.service.ts:260`、`reflection.service.ts:156`），任何"engine 层禁 LLM"断言若不带 planning 例外白名单会立即误报，而设计稿对此只字未提。**建议**：补「律7：engine/evaluation 禁 import AiChatService/LLMFactory」+ 明确 engine/planning 的 LLM 例外白名单（合法例外 vs 技术债）。

---

## D4：DeliverableComposer 归属（复核 minor）【mece-03】

设计稿把 DeliverableComposer 归 harness/evaluation，但 evaluation 官方语义是「质量评判（critique/verify/figure）」（CLAUDE.md:58 / evaluation README）。"按 type 选 projector 组装交付件"是输出装配，非质量评判；项目已有同义 `IDeliveryGenerator`（`orchestrator.interface.ts:341`，含 `generate(outputs, deliverableTypes)`），触及 MECE「同名概念全项目唯一」。

**复核校准**：(a) 发现首选迁移目标 `business-team/projectors/` 概念错配——该目录实为 todo-board 视图投影，与交付投影无关；**只有次选目标 orchestrator/IDeliveryGenerator 正确**。(b) evaluation/critique 当前已合法承载两个纯代码组装件（report-artifact-assembler、structural-report-assembler），削弱"严重越位"表述；设计「就地泛化现有 assembler」属可辩护工程权衡。综合降 minor：值得在 ADR 阶段澄清归属（**倾向收口到 orchestrator/IDeliveryGenerator**），但不阻断。

---

## D5：MissionPlan 命名（minor）【mece-04】

`orchestrator.interface.ts:24` 已有 `MissionExecutionPlan{steps[],estimatedCost,estimatedDuration,...}`，与新 `MissionPlan{team,workflow,rubric,deliverable,estimate}` 语义均为"mission 执行蓝图"，字段重叠。**建议**：扩展 MissionExecutionPlan（追加 rubric[]/deliverableType/roleAssignments），不引入平行接口；在 capability-singleton.spec.ts 锁定唯一权威。

---

## D6：新组件 abstractions/ 落点（minor）【mece-05】

`harness/teams/orchestrator/` 与 `harness/evaluation/` 顶层均无 abstractions/。**建议**：MissionPlanner 接口 → 新建 `teams/orchestrator/abstractions/`；RubricGenerator → 新建 `evaluation/abstractions/`；DynamicTeamBuilder/RoleInventory → 复用现有 `teams/abstractions/`。

---

## D7：新组件名称唯一性（✅ 无冲突）

`DeliverableComposer`/`RoleInventory`/`RubricGenerator`/`MissionPlanner` 在 `backend/src/modules` 下均无现有声明。设计稿在此点正确。

---

## D8：design-review 目录命名（minor）【mece-06】

先例 `wave-4-review-2026-05-24/` 含语义波次前缀，`design-review-2026-06-04/` 无。**建议**：用 `self-driven-design-review-2026-06-04/` 或 `v1-design-review-2026-06-04/`，或在 README 说明为标准化新格式。

---

## D9：capability-singleton 新条目（nit）【mece-07】

`capability-singleton.spec.ts:40-95` SINGLETONS 不含三个新名称。P2/P5 实现时同步补充。

---

## 建议行动项

### 设计稿修订前

- [ ] **[nit]** 修正 §4 分层判据措辞，去掉"且无 LLM / 用 LLM → harness"，改以 agent/mission 状态为唯一判据
- [ ] **[major→minor]** DeliverableComposer 改归 orchestrator（收口 IDeliveryGenerator），保 evaluation 单一职责
- [ ] **[minor]** MissionPlan 改为扩展 MissionExecutionPlan

### P1 阶段实现时

- [ ] 补「律7：engine/evaluation 禁 import AiChatService」断言 + 明确 engine/planning LLM 例外白名单
- [ ] 为 orchestrator/abstractions/ 与 evaluation/abstractions/ 建目录放接口

### P2/P5 阶段

- [ ] capability-singleton.spec.ts 新增 DeliverableComposer/RoleInventory/RubricGenerator 三条目

---

_评审视角: mece-boundary_
_参照版本: CLAUDE.md v2.3 / 审计工具: Arch Auditor Agent v2.0_
