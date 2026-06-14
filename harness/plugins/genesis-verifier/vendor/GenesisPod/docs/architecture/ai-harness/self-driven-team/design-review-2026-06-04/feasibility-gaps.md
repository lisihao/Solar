# 可行性评审报告：全自驱 Agent Team 设计方案

**评审日期**: 2026-06-04
**视角**: feasibility-gaps（可行性与缺口）
**评审对象**: `docs/architecture/ai-harness/self-driven-team/self-driven-agent-team-design-2026-06-04.md`
**状态**: approve-with-changes（有条件通过）
**审查人**: Reviewer Agent

> **对抗式复核校准**：5 条 major 经复核后 **2 条维持、3 条推翻**——
>
> - **维持 major**：feasibility-01（MissionPlanner 非薄包装）、feasibility-04（token 流式需改 ReActLoop 架构）。
> - **推翻**：feasibility-02（降 nit，设计稿本就标"新建"，发现误引 §7 且属稻草人）、feasibility-03（降 minor，已有 `human-approval.tool.ts` 阻塞原语，"什么都没有"前提被证伪）、feasibility-05（降 minor，发现误称 §4 做了归位标注，实际在 §8 非权威叙述）。

---

## 元信息

| 项目           | 内容                                      |
| -------------- | ----------------------------------------- |
| 设计稿版本     | v1.0-draft                                |
| 实际读取文件数 | 29 个源文件                               |
| 核实方式       | Glob + Grep + Read 逐一核实，不凭记忆评分 |

---

## 一、已核实成立的论断（Strengths）

1. **ScoredRouterService 真实存在**，语义打分路由、topK 裁剪、多信号聚合均完整。`scored-router.service.ts:32`
2. **MissionBudgetPool 真实存在**，父子共享、耗尽传染、allocate/attach/recordSpend 可用。`mission-budget-pool.ts:60`
3. **DAG 并行执行有实代码**，dag-executor + S4||S5 并行块已落地。`mission-pipeline-orchestrator.service.ts:172`
4. **CrossStageState 完整实现**，set/get/append/incr/toJSON/fromJSON 齐备。`cross-stage-state.ts:20`
5. **流式基础设施全部确认存在**：EventBus、ProgressTracker、CostAttributionService、SessionLatencyTrackerService、JournalModule。
6. **thresholds.constants.ts 真实存在**，硬地板概念有真实对应物。`thresholds.constants.ts:31`
7. **BusinessAgentTeam framework 已完整**，lifecycle/rerun/dispatcher/event-relay 可复用。
8. **ReActLoop 已有并行 tool call** parallel_tool_call。`react-loop.ts`

---

## 二、Findings（按对抗复核后严重度）

### [feasibility-01] major（holdsUp ✅）MissionPlanner 对 dynamic-planning.ts 的复用论断失实

`tryDynamicDecomposition()` 输入是已有 `ITeam`（leader+members），不能动态组队；输出仅 `ExecutionStep[]`（`dynamic-planning.ts:40`），无 loopKind/rubric/model-election；且依赖 concrete `setAvailableRoles()`（不在 ILeader 接口，仅 `member.ts:190`）。MissionPlan schema（§3）要求 team[]/workflow[](含 loopKind)/rubric[]/estimate 四字段，现有函数均产不出。设计稿 §5.1「复用并替换…去掉 env-gate」措辞会误导 P1 工作量估算。

**建议**：改为「新建 MissionPlanner，tryDynamicDecomposition 仅作分解原语复用参考」，并在 P1 验收明确 MissionPlan 完整 schema 生成路径。

### [feasibility-04] major（holdsUp ✅）token 流式透传是 ReActLoop 架构改造，非"补 AsyncGenerator"

ReActLoop 无任何流式路径（`react-loop.ts` 对 chatStream 零匹配；LLM 唯一路径 `:1779 await chatService.chat()`，且全程围绕完整 response 对象读 usage/content/toolCalls）。chatStream 真能力在 engine（`ai-chat.service.ts:2327`）+ ask adapters 已存在，缺口正是 harness runner 层。改流式需从 chunk 增量重建并撞 stop_reason/tool-call 解析边界（反向洞察 #1/#2）。设计稿 §7/P3 把它当简单 wiring 低估了工作量。

**建议**：P3 单独立项 + 1 套 spec（"前端收到逐字 token event 且 stop_reason 判断正确"）。注：§6 已诚实声明 token 级中断要"动 ReActLoop 内层循环、回归风险高"留 v1.5，但 §7 显示透传仍被当简单 wiring。

### [feasibility-03] minor（复核降级）HITL stage-gate 跨 pod 阻塞机制

**降级理由**：发现承重前提"全项目零 HITL 阻塞等待实现"被证伪——`ai-engine/tools/categories/collaboration/human-approval.tool.ts:495-602` 已有 `waitForHumanResponse()`（DB 持久 + 真阻塞轮询 + 超时兜底），`harness/lifecycle/human-approval-admin.service.ts` 是应答侧，`evaluation/verify/primitives/consensus.ts:75` 有 escalate_to_human。设计可**直接复用/泛化既有 DB-poll 审批原语作 P4a**。

**仍成立的价值**：`MissionPipelineOrchestrator.run()` 是纯顺序 for 循环（`:140`），无 gate await 点需新插；harness 层确无 Redis pub/sub 控制信道（EventBus 是 in-process EventEmitter2）。**建议**：P4 拆 P4a（复用 DB-poll/内存 gate，单 pod）+ P4b（Redis pub/sub 跨 pod + DB 持久），各带独立 verify。

### [feasibility-02] nit（复核推翻）engine/planning 分解原语

**推翻理由**：发现误引"§7 声称已存在"——§7 是流式可视化，真实出处 §4/§5.1，且 §4 line 100 **明确标"新建（纯 LLM 拆解，不含团队）"**，P1 交付项也已列"engine 分解原语"。设计稿从未当成复用。代码事实（engine/planning 现仅 budget/context/intent/reflection，无分解原语）成立但无害。**唯一改进**：§5.1「调 engine 分解原语」措辞读起来像已有，可收紧为"待建"——nit 级。

### [feasibility-05] minor（复核推翻）exit-decision 归位

**推翻理由**：发现称"§4 将 exit-decision 标注为 harness 已有能力"——但 exit-decision 全文仅出现 1 次，在 §8（成本/速度叙述，非权威归位表），§4 归位表根本没列它。代码事实（`ai-app/research/evaluation/exit-decision.service.ts:1` 私有、强绑 research.config）成立。**仍有价值**：§8 该 bullet 应补一句"需下沉为 harness 通用原语，接受外部阈值"；P5 verify 加"harness/evaluation 不 import ai-app/\*\*"断言。

### [feasibility-06] minor P2 verify 弱标准

"按卡实例化团队、跑通出报告"无量化断言。**建议**：改为"给定 3 角色 MissionPlan，build() 产出 members.length===3 且每 member.modelId 非空；verify:arch 绿；E2E 产出 Markdown 报告 > 500 字且 rubric 各维度 score > passLine"。

### [feasibility-07] minor P3 verify "replay 不丢"无法自动验证

**建议**：补"TTFT < 500ms（mock）；journal replay 与实时事件在 id/type 维度一致（spec）；进度百分比单调递增（spec）"。

### [feasibility-08] nit election candidates 来源未说明

`scored-router.service.ts:39` route() 需 candidates 参数。**建议**：§5.1 补"candidates 由 LLMFactory.getAvailableModels(modelType) 提供，P2 接线确认"。

### [feasibility-09] minor DeliverableComposer 下沉前需先修 facade 穿透

`report-artifact-assembler.service.ts:42-51` 有 4 处直接 import ai-engine 内部路径（非 facade）。**建议**：P5 前先补 facade export，违规清零后再泛化。

### [feasibility-10] minor HITL gate 超时策略未定义

**建议**：§13 开放问题新增"HITL gate 超时（建议 10min）：超时后 auto-approve/auto-reject/挂起 PAUSED，写入 P4 verify"。

---

## 三、总体可行性判断

**结论：approve-with-changes**。设计方向正确，分层合规，多数基础设施论断成立。对抗复核后真正会造成显著低估的是 **2 个 major**：

| 问题                                                          | 真实工作量 vs 设计预期       |
| ------------------------------------------------------------- | ---------------------------- |
| MissionPlanner 不是 dynamic-planning 薄包装（feasibility-01） | 新建完整 LLM 规划器          |
| token 流式透传需改 ReActLoop 架构（feasibility-04）           | P3 有反向洞察 #1/#2 回归风险 |

HITL（feasibility-03）虽降 minor，但仍是 P4 实质工作——可复用既有 DB-poll 审批原语降低风险，须拆 P4a/P4b。建议用户确认上述方向后再进入 P0。
