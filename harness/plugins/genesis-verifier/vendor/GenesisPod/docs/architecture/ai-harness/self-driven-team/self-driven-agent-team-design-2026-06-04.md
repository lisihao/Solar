# 全自驱 Agent Team 设计方案

**创建日期**: 2026-06-04
**最后更新**: 2026-06-04
**版本**: v1.1（已纳入四视角审视修订）
**作者**: Claude Code
**状态**: 🟢 活跃（已通过多路审视 GO，5 条 major 已闭合）
**优先级**: P1 - High
**审视记录**: [`design-review-2026-06-04/summary.md`](design-review-2026-06-04/summary.md)

---

## 0. TL;DR

用户在 **AI 问答模型选择器**里选中伪模型 **`Self-Driven Team`**（= 完整授权），输入基本诉求后，**Harness 自驱**完成：模型选择、团队组建、工作流编排、验收标准生成、执行、交付。中间过程**流式可视化**，关键节点支持**人在环（HITL）**暂停/审批/追加，最后产出**经验收达标**的高质量交付件（v1 报告，扩展点写文档不写未用接口）。

**核心原则**：能力全部下沉 `ai-harness` / `ai-engine` 公共组件，`ai-app/ask` 只保留**薄入口**。本能力**与 `teams/business-team` 框架同源、与 Agent Playground 平级**（同为 harness mission 原语的消费方），取 `teams/orchestrator` 动态编排路径（天然支持动态 stage），不依附任何 app 产品。

> **v1.1 修订摘要**（详见 §16 变更记录）：5 条 major 全闭合——①Planner 据实改为新建（非薄包装）②token 流式改 ReActLoop 架构、P3 单列 ③engine 分解原语与 `decomposeTask` 去重决策 ④交付件组装收口 `orchestrator/IDeliveryGenerator`（移出 evaluation）⑤HITL 单列子设计、拆 P4a/P4b、复用既有审批原语。

---

## 1. 背景与目标

### 1.1 问题

现状是**半自驱**：`ReActLoop` 执行阶段由模型驱动（强），但"先做什么、谁来做、做到什么算合格"这套**编排+组队+验收**是人写死的（Playground 13 段 / teams-mode 固定角色）。换一个全新诉求，流程跳不出格子。

### 1.2 自驱的定义（强成功标准）

| 自驱环节   | 含义                                      | 现状                          |
| ---------- | ----------------------------------------- | ----------------------------- |
| 工作流编排 | prompt → 动态多步工作流（阶段+依赖）      | ❌ 缺公共组件                 |
| 团队组建   | 模型从 RoleInventory 选角色 → 实例化团队  | ❌ 只读死 TeamConfig          |
| 模型选择   | 按角色分级 election（可跨厂商）           | ✅ 已有 `ScoredRouterService` |
| 验收标准   | 模型按目标生成 rubric（带 clamp 护栏）    | ❌ 全硬编码阈值               |
| 交付件     | 按类型组装产出（收口 IDeliveryGenerator） | 🔸 现仅 report 专有           |

### 1.3 与既有形态的区别（已修正定性）

| 形态                                        | 入口                    | 工作流                         | 编排路径                      | 本方案关系                                |
| ------------------------------------------- | ----------------------- | ------------------------------ | ----------------------------- | ----------------------------------------- |
| **本能力（Self-Driven Team）**              | AI 问答模型选择器伪模型 | **模型动态生成**               | `teams/orchestrator`（动态）  | 本文                                      |
| teams-mode（旧"团队"按钮）                  | AI 问答工具栏           | 多厂商模型辩论                 | —                             | 成熟后被本能力取代                        |
| Agent Playground / Social / Radar / Writing | 各自产品页              | **固定**（business-team 框架） | `teams/business-team`（静态） | **平级消费方**，共享 harness mission 原语 |

> 命名说明：伪模型显示名用 **`Self-Driven Team`**（非 `Agent Team`），避免与既有保留概念 `AGENT_TEAM_APPS`（`__tests__/architecture/layer-3-authority/agent-team-layout.spec.ts:34`，白名单 = [playground, social, radar]）术语撞名。该 spec 是闭合硬编码白名单（`it.each(AGENT_TEAM_APPS)`），不自动扫描 ai-app/，故薄入口不会被强制登记。注：business-team **框架**消费方含 writing（`writing-business-orchestrator.service.ts`），与 `AGENT_TEAM_APPS` spec 白名单是两个集合，writing 在前者不在后者。

---

## 2. 范围

### 2.1 v1 范围

- 入口：AI 问答模型选择器新增 `Self-Driven Team` 伪模型
- 5 阶段业务流：澄清 → 规划（方案卡，用户确认/微调）→ 自驱执行 → 中途交互 → 交付
- 交付件：报告（Markdown / 富文本），交付侧收口 `IDeliveryGenerator`，report 为其一个 projector
- HITL：**阶段边界**暂停/审批/追加（P4a 复用既有 DB-poll 审批原语；P4b 跨 pod）
- 流式可视化：团队/思考/进度/成本/rubric 达标度（token 逐字流式列 P3 单独立项）

### 2.2 非目标（v1 不做，YAGNI）

- token 级硬杀（生成到一半立即掐断）→ v1.5
- 方案卡工作流图编辑（改阶段顺序/依赖）→ 后续（v1 仅增删角色 + 调 rubric 数值）
- 报告以外的交付件渲染（PPT/code projector）→ 后续接 projector，**v1 不预留未用接口/全字段 schema 抽象**
- 跨 mission 协调

---

## 3. 端到端业务流

```
①澄清 Clarify → ②规划 Plan(方案卡·用户确认) → ③执行 Execute → ④交互 Interact → ⑤交付 Deliver
```

| 阶段   | 行为                                                                                                    | 用户可见                                                       |
| ------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| ① 澄清 | 模型读诉求；信息不足则弹 2-3 选择题；足则跳过                                                           | 对话流澄清卡片，可点选                                         |
| ② 规划 | `SelfDrivenMissionPlanner` 产出 `MissionExecutionPlan`（扩展版）；用户一键确认或轻量微调                | 可编辑方案卡（角色/rubric 数值带 clamp/成本预览）+「确认开跑」 |
| ③ 执行 | `DynamicTeamBuilder` 实例化团队 → `teams/orchestrator` 动态 pipeline 逐阶段跑 → 阶段内 `ReActLoop` 自驱 | 团队成员卡 + 思考流 + 进度/成本                                |
| ④ 交互 | 阶段边界 gate：暂停/审批/追加指令；consensus 分歧大自动转人工                                           | 暂停/审批/追加指令栏                                           |
| ⑤ 交付 | `IDeliveryGenerator` 按 rubric 验收达标后组装落库                                                       | 最终报告 + 导出                                                |

### 方案卡 = 扩展既有 `MissionExecutionPlan`（不引入平行接口）

`teams/orchestrator/orchestrator.interface.ts:24` 已有 `MissionExecutionPlan{steps[],estimatedCost,estimatedDuration,…}`。本方案**扩展它**（追加字段），并在 `capability-singleton.spec.ts` 锁定唯一权威，**不新建平行 `MissionPlan`**（修 mece-04）：

```ts
// 扩展 MissionExecutionPlan（草案，最终以实现为准；v1 仅落用得到的字段）
interface MissionExecutionPlan {
  steps: ExecutionStep[]; // 既有；其 type 为 task/review/integration/delivery —— loopKind(react/plan-act/leader-worker) 为本方案**新增**字段
  estimatedCost: number; // 既有
  estimatedDuration: number; // 既有
  // —— 本方案新增 ——
  roleAssignments: Array<{ roleId: string; modelId: string }>; // modelId 由 election 填
  rubric: Array<{ dimension: string; weight: number; passLine: number }>; // passLine 经 clamp
  deliverableType: "report"; // v1 仅 report；扩展点写文档不写枚举占位
}
```

---

## 4. 分层架构与能力归位（MECE）

**唯一判据（已修正 mece-01）**：**以 agent/mission 状态为唯一分层依据** —— 涉及 agent/mission 状态 → harness；不知 agent/mission 的无状态原语 → engine。**与"是否调 LLM"无关**（`engine/llm` 本就是 LLM 聚合，engine 多聚合合法调 `AiChatService`：knowledge/rerank、rag/pipeline、safety、planning/context 等）。

| 能力                                                            | 归属                                       | MECE 判据                           | 复用/新建                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 按角色模型 election                                             | **engine/routing**                         | 无 agent/mission 状态               | 复用 `ScoredRouterService`；candidates 由 `LLMFactory.getAvailableModels(modelType)` 提供                         |
| **role-agnostic 步骤分解原语**                                  | **engine/planning**                        | 无 agent/mission 状态（角色无关）   | 新建；见 §4.1 去重决策                                                                                            |
| 无 LLM 启发式质检                                               | **engine/evaluation**                      | 无 LLM、无状态                      | 复用（**禁 import AiChatService/LLMFactory**）                                                                    |
| **SelfDrivenMissionPlanner**（产出扩展版 MissionExecutionPlan） | **harness/teams/orchestrator**             | 产出 mission+team                   | **新建**（非薄包装，见 §5.1）；`dynamic-planning.ts` 仅作分解参考                                                 |
| **RubricGenerator**（LLM 生成验收标准）                         | **harness/evaluation**                     | 用 LLM，与 judge 同聚合内聚         | 新建；产出喂现有 verify/judge                                                                                     |
| **DynamicTeamBuilder + RoleInventory**                          | **harness/teams**                          | team/role 是 agent 概念             | 新建；动态建 TeamConfig → 复用 `TeamFactory.createFromConfig`                                                     |
| **交付件组装（report projector）**                              | **harness/teams/orchestrator**             | 输出装配，收口 `IDeliveryGenerator` | **扩展既有 `IDeliveryGenerator`**（`orchestrator.interface.ts:341`），report 降为 projector（修 arch-03/mece-03） |
| **HITL Gate**                                                   | **harness/lifecycle + teams/orchestrator** | mission 生命周期                    | 复用 `human-approval.tool.ts` 阻塞原语（P4a）+ 跨 pod（P4b）                                                      |
| 流式事件/进度/成本                                              | **harness/protocols + tracing**            | 已在位                              | 补 plan/team/stage 事件；token 流式见 P3                                                                          |
| **薄入口**（伪模型注册/dispatch/事件投影/UI）                   | **app/ask**                                | 产品入口                            | 新建薄壳，见 §4.2                                                                                                 |

**依赖方向**（严格单向）：`ai-app/ask → ai-harness → ai-engine → platform`。

**合法复用（与 business-team 同源）**：harness 层 mission 基础设施（`lifecycle/mission-runtime-contract`、mission-checkpoint、`protocols` event bus、`guardrails/MissionBudgetPool`、`teams/business-team` 的 `CrossStageState` / rerun typed 视图）。本能力作平行消费方直接消费。

### 4.0 为何取动态编排路径而非 business-team 静态框架（补 arch-01）

- `business-team` 框架（消费方 4 家：playground/social/radar/writing）是**静态 stage→runner 表**，适合固定流程；本能力需**模型动态生成 stage**，故取 `teams/orchestrator` + `dynamic-planning` 动态路径。
- **仍复用** business-team 的原语层：`CrossStageState`（HITL append 存储 / 阶段间传值）、rerun/checkpoint（reject 回退）、event-relay（流式）。即"取动态编排骨架，复用其状态/回退/事件原语"，不重复造轮。

### 4.1 engine 分解原语 vs 既有 `decomposeTask` 去重决策（修 arch-04）

- 现状：harness `Leader.decomposeTask`（`teams/base/leader-llm-adapter.ts:83`）是 **role-aware** LLM 分解（被 `dynamic-planning` 消费）；engine/planning 现**无**分解原语（旧 `TaskDecomposerService` 因 **0 注入** 于 2026-04-30 被删——死代码教训）。
- 决策：**role-agnostic 拆解核心下沉 engine/planning**（输入 goal → 输出步骤骨架，不含角色）；`decomposeTask` 改为**薄封装**，注入 `availableRoles` 后调 engine 核心。一份分解 prompt，避免双轨漂移。
- **为何不重蹈 0 注入死代码**：新原语有**确定的注入方**——`SelfDrivenMissionPlanner` 与改造后的 `decomposeTask` 都消费它（≥2 注入点），非投机性预留。

### 4.2 app/ask "薄"的可验证标准（修 arch-05）

"薄"= 入口层**零业务逻辑**，仅：① 伪模型注册（mode 注册表加一项）；② dispatch（生成 missionId + 调 harness facade）；③ 事件投影（harness 事件 → 前端 DTO，纯映射）；④ UI 组件。**可验证断言**（P0）：ask 新增文件中 0 处 import harness/engine 内部路径（仅 facade）；dispatch handler 圈复杂度 ≤ 5；无 LLM 调用、无 rubric/team/plan 逻辑。是否复用既有 ask mode-adapter 抽象在 P0 探明后定（默认复用，不新造 adapter 体系）。

---

## 5. 公共组件契约（草案）

> 每个组件自带 `abstractions/`（修 mece-05）：`SelfDrivenMissionPlanner` 接口 → 新建 `teams/orchestrator/abstractions/`；`RubricGenerator` → 新建 `evaluation/abstractions/`；`DynamicTeamBuilder`/`RoleInventory` → 复用 `teams/abstractions/`。对外经各自 facade 暴露。

### 5.1 SelfDrivenMissionPlanner（harness/teams/orchestrator）—— 新建，非薄包装

- 输入：澄清后诉求 + `RoleInventory` 调色板 + 可用工具/技能清单 + 预算上限 + 候选模型（`getAvailableModels`）
- 输出：扩展版 `MissionExecutionPlan`（§3）
- 内部链路（**全新建**）：调 engine role-agnostic 分解原语得步骤骨架 → 选 loopKind → 调 `RubricGenerator` 得 rubric → 调 election 填 modelId → 估算成本
- **据实声明**：`dynamic-planning.ts:tryDynamicDecomposition()` 输入已有 `ITeam`、仅产 `ExecutionStep[]`，**产不出** roleAssignments/rubric/loopKind/estimate，故仅作分解逻辑**参考**，不是"复用替换"。
- **system envelope 禁嵌时间戳/随机 id**（保 prompt cache 前缀稳定，反向洞察 #3/#7），动态内容仅走 user-role message。

### 5.2 RubricGenerator（harness/evaluation）

- 输入：诉求 + deliverableType；输出：`rubric[]`
- **clamp 护栏**（修 safety-02/04）：`passLine` 经 `clamp(passLine, REVIEW_PASS_THRESHOLD=60, RUBRIC_PASS_LINE_CAP=90)`；用户在方案卡微调时前端 slider 限 [60,90] + 后端二次 clamp。防 passLine→0 使质量门变空门 / →99 触发无谓多轮。

### 5.3 DynamicTeamBuilder + RoleInventory（harness/teams）

- `RoleInventory`：角色原型调色板（researcher/analyst/writer/critic/domain-expert…），**每角色声明默认工具白名单 coreTools**（修 safety-05）+ 默认/上限 iteration cap
- `DynamicTeamBuilder.build(plan.roleAssignments)` → 动态 `TeamConfig` → `TeamFactory.createFromConfig()`（不改 factory）
- **约束**（修 safety-10）：角色必来自 RoleInventory 白名单，**禁** LLM 自由定义角色 id 直接实例化；`member.tools = role.coreTools`，越界返回 `AgentAccessDeniedError`

### 5.4 交付件组装：扩展 `IDeliveryGenerator`（harness/teams/orchestrator）—— 修 arch-03/mece-03

- **不**新建 evaluation 下的 DeliverableComposer（质量评判聚合不承载输出装配）；扩展既有 `IDeliveryGenerator.generate(outputs, deliverableTypes)`（`orchestrator.interface.ts:341`）
- v1 只接 **report projector**；`report-artifact-assembler` 的 report 专有字段（sections/citations/figures/quickView）保持，report 作为一个 projector 实现，**不强行泛化成 type 分发的大接口**（YAGNI）
- **前置**（修 feasibility-09）：`report-artifact-assembler.service.ts:42-52` 有 **5 处**直接 import ai-engine 内部路径（含 line 52 `normalizeMarkdownSlug` from `ai-engine/content/markdown/slug-normalize.util`），下沉/接线前先补 facade export、违规清零

### 5.5 HITL Gate（harness/lifecycle + teams/orchestrator）—— 单列子设计

- **P4a（单 pod，先做）**：复用既有 `ai-engine/tools/categories/collaboration/human-approval.tool.ts:495` 的 `waitForHumanResponse()`（DB 持久 + 真阻塞轮询 + 超时兜底）+ `harness/lifecycle/human-approval-admin.service.ts`（应答侧）。`MissionPipelineOrchestrator.run()` 是纯顺序 for 循环（`:140`），在阶段间插 gate `await`。
- **P4b（跨 pod）**：加 Redis pub/sub 控制信道（现 EventBus 是进程内 EventEmitter2，无跨 pod）+ DB 持久。
- 信令：pause / resume / approve / reject（回退重跑该阶段，复用 business-team checkpoint/rerun）/ append（注入 `CrossStageState`）
- **超时降级策略**（修 feasibility-10）：gate 默认超时 **10min** → 配置决定 auto-reject 或挂 `PAUSED`，写入 P4 verify
- **注入内容 sanitize**（修 safety-01）：append 必经 `PromptInjectionDetector.check()` + `sanitizePromptInput()`（真实函数名），P4 verify 覆盖

---

## 6. HITL 中途交互（v1 = 阶段边界）

| 能力      | v1 实现                                                 | 说明                                            |
| --------- | ------------------------------------------------------- | ----------------------------------------------- |
| 暂停/打断 | 阶段间 gate `await` 控制信号                            | 真阻塞，非伪等待                                |
| 审批      | 关键阶段（方案卡、报告定稿）产出后阻塞等 approve/reject | reject 复用 business-team checkpoint/rerun 回退 |
| 追加指令  | 用户输入经 sanitize 后注入 `CrossStageState`            | 下阶段即时生效                                  |

**v1 边界**：粒度=stage（秒级 gate）+ 10min 超时降级。**token 级硬杀**留 v1.5（要动 `ReActLoop` 内层 token 循环，撞反向洞察 #1/#2，回归风险高）。

---

## 7. 流式可视化

- **已在位**：`EventBus`（per-mission 房间）、`ProgressTracker`（0-100%）、`cost-attribution`（实时 USD）、`session-latency`（TTFT/TTLT）、`journal` replay。
- **要补（轻）**：① 方案卡事件；② 团队组建/每角色发言事件；③ stage 进度事件。
- **token 逐字流式（重，P3 单独立项，修 feasibility-04/safety-06）**：`ReActLoop` 当前**无任何流式路径**（`reason()` 走 `await chatService.chat()` 读完整 response 对象）。流式能力在 engine（`ai-chat.service.ts` chatStream）+ ask adapter 已存在，**缺口在 harness runner 层**。改造需让 `reason()` 从 chunk 增量重建，且 `reason()` 输出是要 parse 的**结构化 JSON decision**，与逐字 token 协议有张力，并撞 `stop_reason`/tool-call 解析边界（反向洞察 #1/#2）。**不是简单 wiring**。
- **前端主视图**：左=团队成员卡（角色+模型+状态）；中=时间线/思考流；右=进度+实时成本+rubric 达标度；底=暂停/审批/追加栏。

---

## 8. 成本 / 速度 / 体验（做到最佳）

### 成本

- **按角色分级模型**：election 给并发 researcher 配廉价模型，只给 leader/critic 配强模型
- **预算池 + 自动降档**：`MissionBudgetPool` 父子共享；`budget-accountant` 70% 降档/85% 预警/100% 停止
- **prompt cache 不破坏**：方案卡 system envelope 字节级稳定（反向洞察 #3/#7，`CacheControlPlanner` 同类风险面）
- **上下文压缩**：`planning/context` 控 token 膨胀
- **rubric 达标即停**：`exit-decision`（converged/saturated）防过度迭代——**需下沉为 harness 通用原语，接受外部阈值**（现 `ai-app/research/evaluation/exit-decision.service.ts` 私有、强绑 research.config）

### 速度

- **DAG 并行**：`dag-executor` 让多 researcher 并发
- **并行工具调用**：`ReActLoop` `parallel_tool_call`
- **checkpoint resume**：崩溃不重跑
- election 多信号含 latency；token 流式（P3）优化 TTFT 感知

### 体验

- 方案卡确认（控制权 + 成本预期）
- 流式可视化 + 断线 replay
- stage-gate HITL（不重启干预）
- consensus 分歧大 `escalate_to_human` 接 HITL

---

## 9. 护栏与安全（机制化，非文字声明）

| 护栏                   | 机制                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| rubric passLine 上下界 | `clamp(_, 60, RUBRIC_PASS_LINE_CAP=90)` 常量 + spec（§5.2）                                       |
| 自驱循环烧钱           | `MissionBudgetPool` 耗尽即停 + iteration 硬 cap                                                   |
| 通用 iteration cap     | 新增 `SELF_DRIVEN_AGENT_MAX_ITERATIONS=8`，RoleInventory 可声明 custom 但不得超此（修 safety-09） |
| HITL 注入              | `PromptInjectionDetector.check()` + `sanitizePromptInput()`（§5.5）                               |
| 动态团队工具 ACL       | `member.tools = role.coreTools`，越界 `AgentAccessDeniedError`（§5.3）                            |
| 角色来源               | 必来自 RoleInventory 白名单，禁 LLM 自由 id（§5.3）                                               |
| prompt cache           | system envelope 禁时间戳/随机 id（反向洞察 #3/#7）                                                |

---

## 10. 规范看护（机制化）

| 看护                           | 对本方案约束                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint `no-restricted-imports` | app 只走 facade；engine 不得 import harness                                                                                                                                                                                                                                                                                                                      |
| 架构 spec `verify:arch`        | **新增**：① 律7「engine/evaluation 禁 import AiChatService/LLMFactory」+ engine/planning LLM **例外白名单**（planning 合法调 LLM，修 mece-02）；② `capability-singleton.spec.ts` 锁 `SelfDrivenMissionPlanner`/`RubricGenerator`/`DynamicTeamBuilder`/`RoleInventory` 唯一（修 mece-07/arch-07）；③ P5「harness/teams/orchestrator 交付侧不 import ai-app/\*\*」 |
| pre-push + CI `arch-boundary`  | 违规拒推/拒合                                                                                                                                                                                                                                                                                                                                                    |
| 每聚合自带 `abstractions/`     | 接口源头放对应聚合（§5 抬头），禁大杂烩 re-export                                                                                                                                                                                                                                                                                                                |
| 反向洞察（honor）              | runner/llm 改动守 #1/#2（流式撞 stop_reason）、#3/#7（cache 前缀）、#4/#5（已落地）                                                                                                                                                                                                                                                                              |
| 无硬编码模型名                 | fallback 用 `""` + TaskProfile/election                                                                                                                                                                                                                                                                                                                          |

---

## 11. 数据模型

HITL 控制信令 / 方案卡持久化若需新表，按规范**手写 SQL 迁移**（`prisma/migrations/YYYYMMDD_*/migration.sql`），不用 `prisma migrate dev`；`ALTER TYPE ADD VALUE IF NOT EXISTS` 不包 `DO $$ EXCEPTION`。P4a 优先复用 `human-approval` 既有持久层，能少建表则少建。

---

## 12. 分阶段交付（每步带强成功标准 / 量化 verify）

| 阶段               | 内容                                                                                                         | verify                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**             | 伪模型 `Self-Driven Team` + dispatch 到 harness；app 薄壳骨架                                                | 选中进自驱流、落 missionId、能订阅事件；ask 新增文件 0 处 facade 穿透 + dispatch handler 圈复杂度≤5；`verify:arch` 绿                                                              |
| **P1**             | engine role-agnostic 分解原语 + `SelfDrivenMissionPlanner` + `RubricGenerator`（带 clamp）+ 方案卡 UI + 确认 | 诉求→扩展版 MissionExecutionPlan（roleAssignments/rubric/deliverableType 齐）→编辑确认→落库；rubric passLine ∈[60,90]（spec）；新增律7 + planning 例外白名单（spec 绿）            |
| **P2**             | `DynamicTeamBuilder` + `RoleInventory`（带 coreTools/cap）+ 按角色 election                                  | 给定 3 角色 plan，`build()` 产 `members.length===3` 且每 `member.modelId` 非空；越界 `AgentAccessDeniedError`（spec）；E2E 出 Markdown 报告 >500 字且 rubric 各维度 score>passLine |
| **P3**（单独立项） | token 逐字流式：`ReActLoop.reason()` 接流式 + EventBus                                                       | 前端收逐字 token event 且 `stop_reason` 判断正确（spec，守反向洞察 #1/#2）；TTFT<2s 可观测；journal replay 与实时事件在 id/type 一致；进度单调递增                                 |
| **P4a**            | HITL 单 pod（复用 `waitForHumanResponse` DB-poll + 阶段 gate）                                               | 暂停真阻塞；reject 回退重跑（复用 business-team rerun）；追加经 sanitize 注入下阶段生效；gate 10min 超时降级（spec）                                                               |
| **P4b**            | HITL 跨 pod（Redis pub/sub + DB 持久）                                                                       | 双 pod pause 信令传播测试绿                                                                                                                                                        |
| **P5**             | 交付侧扩展 `IDeliveryGenerator` + report projector + assembler facade 清零                                   | `report-artifact-assembler` facade 穿透清零；harness/teams/orchestrator 交付侧不 import ai-app/\*\*（spec）；rubric 验收达标落库可导出                                             |

---

## 13. 开放问题与默认决策（审视后确认）

| #   | 问题             | v1 决策                           | 审视补充条件（已纳入）                                                                                                                                     |
| --- | ---------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | HITL 粒度        | **阶段边界**（token 级 → v1.5）   | gate 10min 超时 → auto-reject/挂 PAUSED（§5.5/§6）                                                                                                         |
| 2   | 方案卡可编辑深度 | **轻**：增删角色 + 调 rubric 数值 | rubric slider [60,90] + 后端二次 clamp（§5.2）；v1 不预留多 projector 抽象                                                                                 |
| 3   | ADR              | **立 3 条**                       | ①Planner 归位 + decomposeTask 去重 + MissionExecutionPlan 合并；②HITL stage-gate + 复用审批原语 + 跨 pod + 超时；③交付件归 orchestrator/IDeliveryGenerator |

ADR：[`009`](../../../decisions/009-self-driven-mission-planner-placement.md) · [`010`](../../../decisions/010-self-driven-hitl-stage-gate.md) · [`011`](../../../decisions/011-deliverable-generation-placement.md)

---

## 14. 目录归位与 MECE 合规

- 本能力是**跨聚合能力文档簇**，与既有 `coding-agent/` 同型，**不与任何聚合名重叠** → `docs/architecture/ai-harness/self-driven-team/` 合规。
- 评审产出 `design-review-2026-06-04/`（README 已说明为标准化新格式，对标 `wave-4-review-*`）。
- 各组件**接口契约文档**随代码落到所在聚合 `docs/architecture/{layer}/{aggregate}/`，本文交叉引用。

---

## 15. 关联文档

- 审视总结：[`design-review-2026-06-04/summary.md`](design-review-2026-06-04/summary.md)
- harness 沉淀拓扑：[`../facade/sediment-topology.md`](../facade/sediment-topology.md)
- mission 运行时契约：[`../lifecycle/mission-runtime-contract.md`](../lifecycle/mission-runtime-contract.md)
- 实时通信：[`../protocols/realtime-websocket.md`](../protocols/realtime-websocket.md) · [`../protocols/realtime-sse.md`](../protocols/realtime-sse.md)
- 模型 election：[`../redesign/14-model-election.md`](../redesign/14-model-election.md)
- 同型能力先例：[`../coding-agent/coding-agent-feasibility-and-roadmap.md`](../coding-agent/coding-agent-feasibility-and-roadmap.md)
- AI 问答入口侧：[`../../ai-app/ask/teams-mode.md`](../../ai-app/ask/teams-mode.md)

---

## 16. 变更记录

| 版本       | 日期       | 变更                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0-draft | 2026-06-04 | 初稿                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| v1.1       | 2026-06-04 | 纳入四视角审视：①§5.1 Planner 据实改新建（feasibility-01）②§7/P3 token 流式改 ReActLoop 架构单列（feasibility-04）③§4.1 engine 分解原语去重决策（arch-04）④§5.4 交付件收口 IDeliveryGenerator、移出 evaluation（arch-03/mece-03）⑤§5.5 HITL 单列、拆 P4a/P4b、复用既有审批原语（arch-05/feasibility-03）⑥§4 判据去掉"用 LLM→harness"伪判据（mece-01）⑦方案卡扩展 MissionExecutionPlan（mece-04）⑧伪模型改名 Self-Driven Team（arch-02）⑨§4.0 business-team 选型理由（arch-01）⑩clamp/iteration cap/sanitize/工具 ACL 机制化（safety 系列）⑪§12 verify 量化 |
| v1.1.1     | 2026-06-04 | 闭合验证 GO-with-notes 后修文档级瑕疵：①§3 loopKind 据实标"新增字段"（ExecutionStep 现仅 task/review/integration/delivery）②§5.4 facade 穿透 42-51/4 处 → 42-52/5 处（补 line 52 normalizeMarkdownSlug）③§1.3 AGENT_TEAM_APPS 行号 :33→:34 + 澄清 writing 属 business-team 框架消费方但不在 AGENT_TEAM_APPS 白名单                                                                                                                                                                                                                                         |
