# 安全/成本/性能审计报告

## 元信息

| 字段     | 内容                                                                                        |
| -------- | ------------------------------------------------------------------------------------------- |
| 审计视角 | safety-cost-dx（安全/成本/性能）                                                            |
| 审计对象 | `docs/architecture/ai-harness/self-driven-team/self-driven-agent-team-design-2026-06-04.md` |
| 审计日期 | 2026-06-04                                                                                  |
| 状态     | approve-with-changes                                                                        |
| 审计人   | Security Auditor Agent                                                                      |

> **对抗式复核校准**：本视角 11 条发现经对抗验证后**全面降级**——2 条 blocker 均降 minor，6 条 major 降 minor，1 条 major（#07）推翻。无一条维持原 blocker/major。核心原因：审计对象是 v1.0-draft 设计稿且 §9 已 flag 多数风险；既有代码已有 maxRevisions/iteration hard cap/budget pool 兜住失控烧钱；部分修复建议本身技术错误（#02 无限迭代因果链与 reflexion-loop 矛盾、#07 stripReasoningBlocks 用错对象、#08 误称 HITL 设施不存在）。

---

## 审计范围

聚焦：自驱循环烧钱护栏、HITL prompt 注入、动态团队工具 ACL、反向洞察 10 条适用性、流式/并行性能。实际 Read/Grep 文件见报告末。

---

## 发现汇总（对抗复核后）

| ID  | 维度                       | 原severity | 复核后          | 一句话                                                                            |
| --- | -------------------------- | ---------- | --------------- | --------------------------------------------------------------------------------- |
| 01  | Prompt 注入                | blocker    | **minor**       | HITL append 路径未点名 sanitize 工具；但输入来自 mission 所有者本人，威胁偏弱     |
| 02  | rubric passLine 无上界     | blocker    | **minor**       | 缺上界 cap 属实；但 maxRevisions/iteration cap/budget pool 已防"无限迭代"，非失控 |
| 03  | 反向洞察 #3/#7 遗漏        | major      | **minor**       | §8 已正确引用，仅 §10 看护表漏列，属文档完整性                                    |
| 04  | 用户可调 rubric 无 clamp   | major      | **minor**       | passLine→0 使质量门失效（非成本失控）；缺用户编辑路径 re-clamp                    |
| 05  | 动态工具 ACL 生成缺失      | major      | **minor**       | 佐证把 ToolInvoker 语义错配到 teams 路径；role.coreTools 已提供作用域             |
| 06  | 流式透传路径未设计         | major      | **minor**       | 佐证成立但属 draft 文档细节补充，设计已排期 P3                                    |
| 07  | 反向洞察 #6 failover strip | major      | **推翻(minor)** | 建议的 stripReasoningBlocks 用错对象（文本正则 ≠ 结构化 signature）；风险理论性   |
| 08  | HITL Redis pub/sub 缺失    | major      | **minor**       | 误称 HITL 设施不存在（human-approval-admin 已存在）；价值仅 P4 跨 pod verify      |
| 09  | iteration cap 角色专用     | minor      | minor           | 缺通用 SELF_DRIVEN_AGENT_MAX_ITERATIONS                                           |
| 10  | DynamicTeamBuilder 归位    | minor      | minor           | 已知新建组件，论断准确                                                            |
| 11  | MissionPlanner 命名        | nit        | nit             | 与 Playground mece-mission-planning SKILL 名近                                    |

---

## 关键发现详述

### [01] minor（原 blocker）HITL append 路径无具体 sanitize 机制

设计稿 §9 第 4 条仅写「HITL 注入的用户内容需 sanitize」，未点名工具，而同 §9 其它项都点名了具体机制。现有 `prompt-sanitizer.ts`（含 sanitizePromptInput/sanitize/sanitizeExternalContent）与 `prompt-injection-detector.ts`（check() 返回 block 级 severity）均存在但未引用；`CrossStageState.set()` 是裸 Map setter 无过滤层。

**降级理由**：v1.0-draft 且 §9 已 flag 该要求；威胁模型偏弱（HITL append 来自 mission 所有者本人，主要是自伤，无跨租户提权）；原建议的 `sanitizeUserInput()` 函数名不存在（真名 sanitizePromptInput）。**建议**：§5.5 HITL Gate 契约把 sanitize 管道列为必选依赖（用 PromptInjectionDetector.check() + sanitizePromptInput），写入 P4 verify。

### [02] minor（原 blocker）rubric passLine 无上界

`thresholds.constants.ts:31` REVIEW_PASS_THRESHOLD=60 仅下界，§3/§5.2/§9 均只约束下界，LLM 可生成 passLine=99。**降级理由**：reflexion-loop.ts:135 `while(revision<=maxRevisions)`（默认 2）结构性封顶，passThreshold 仅决定是否进 CRITIQUE，不决定循环上界；超高 passLine 后果是多一轮 revision + 产出标 degraded 放行，**非无限迭代**；§9 的 iteration 硬 cap + budget pool 已是真正失控护栏。**建议**：仍值得加 `RUBRIC_PASS_LINE_CAP=90` + clamp(passLine, 60, 90) + spec，作为 P1 防呆。

### [03] minor 反向洞察 #3/#7 未入看护表

§8 已正确引用 #3/#7（"system envelope 字节级稳定"），但 §10 看护表只列 #1/#4/#5/#6。`CacheControlPlanner`（`runner/context/cache-control-planner.ts:43`）正是 prefix 稳定性实现，新增 MissionPlanner envelope 是同类风险面。**建议**：#3/#7 补入 §10；§5.1 约束 system envelope 禁嵌时间戳/随机 id，动态内容仅走 user-role message。

### [04] minor 用户可调 rubric 无 clamp

§2.1/§13 允许用户"调 rubric 数值"，但 §5.1/§5.2 无用户编辑值 clamp。passLine→0 使质量验收门变空门（质量门失效，非成本失控）。**建议**：前端 slider 区间 [60, 90] + 后端 MissionPlanner 接收时二次 clamp + §5.1 显式声明可编辑区间 + P1 verify。

### [05] minor 动态工具 ACL 生成路径

§9「动态团队工具权限仍走 ToolInvoker 栅栏」。**复核校准**：佐证把 ToolInvoker 的"空=无限制"语义错配到 teams 执行路径——实际 teams-mission-orchestrator 不经 ToolInvoker，工具作用域来自 `member.tools = role.coreTools`（`member.ts:52`，已知角色非空），空 tools = 不向 LLM 提供工具（过度受限）而非无限制；且 HarnessedAgent 路径 ACL 本就源自 AgentSpec 静态声明（`harnessed-agent.ts:340`）。**仍成立**：§9 表述对 teams 路径不准（该路径绕过 ToolInvoker 硬白名单门），§5.3 未说明"临时角色"如何生成 coreTools。**建议**：§5.3 增"工具 ACL 生成"环节，RoleInventory 每角色声明默认白名单；P2 verify 越界返回 AgentAccessDeniedError。

### [06] minor 流式透传实现路径未设计

QueryLoopService 非流式（`query-loop.service.ts:133 await chatFn`），AiStreamHandlerService 已有 SSE 能力但仅 ask 消费，ReActLoop reason() 走非流式 chat。**复核**：佐证全成立但属 draft 文档细节，设计已识别并排期 P3；且 reason() 输出是要 parse 的结构化 JSON decision，token 流式与该协议有张力，比"接 StreamHandler 发 chunk"复杂。**建议**：P3 明确 ReActLoop reason() 接入流式 + EventBus，verify "TTFT < 2s 可观测"。

### [07] minor（原 major，holdsUp=false）反向洞察 #6 failover strip thinking

**推翻**：原建议"调 stripReasoningBlocks() 清理 thinking"技术错误——该函数（`json-extraction.utils.ts:430`）是对**字符串**做 `<think>` 正则剥离（针对 Nemotron/DeepSeek 文本标签），与 Anthropic 结构化 thinking block + signature 是两回事，照此修复是 no-op 还制造"已防护"假象。且 `anthropic-caller.ts` 通篇不回传结构化 thinking block，signature 从不进多轮历史 → 跨 provider failover 不携带 signature，"确定性 400"在现有架构不触发。**残留 nit**：设计稿可注明，若未来引入 thinking-block 多轮回传，signature 剥离应落在 anthropic-caller/adapter 层。

### [08] minor（原 major，holdsUp=false 按原措辞）HITL Redis pub/sub 基础设施

**推翻佐证**：(a) `controlChannel` 全库 0 命中（纯设计稿 token），佐证误把 ai-ask 注释里的"Redis pub-sub"子串当命中；(b) 误称"harness 无 HITL 文件"——实存 `harness/lifecycle/human-approval-admin.service.ts`（+ spec），HumanInLoopPause 被 `task-execution-orchestrator.ts:148` 消费；(c) 设计稿 §5.5/§11/P4 已明标 HITL 为"新建/需 SQL 迁移/真阻塞"。**仍成立**：项目确无可复用跨 pod Redis pub/sub 原语（EventBus 是进程内）。**建议**：P4 verify 增"双 pod pause 信令传播测试"。

### [09] minor iteration cap 角色专用

`thresholds.constants.ts` 仅 RESEARCHER_MAX_ITERATIONS_HARD_CAP=10，动态角色（analyst/critic/domain-expert）cap 不明。**建议**：补 `SELF_DRIVEN_AGENT_MAX_ITERATIONS=8` 默认 cap，RoleInventory 可声明 custom 但不得超此值。

### [10] minor DynamicTeamBuilder 归位

DynamicTeamBuilder/RoleInventory 全库无命中（已知新建），§1.2「团队组建 ❌ 只读死 TeamConfig」论断成立。**建议**：P2 spec 约束角色必来自 RoleInventory 白名单，禁 LLM 自由定义角色 id 直接实例化。

### [11] nit MissionPlanner 命名

仅与 `ai-app/playground/mission/skills/mece-mission-planning/SKILL.md`（文档非服务）名近。**建议**：命名 SelfDrivenMissionPlanner 避免 grep 混淆。

---

## 优点总结

1. MissionBudgetPool 父子共享池 isExhausted() 用 >= 比较且有 spec 覆盖
2. BudgetAccountant 三挡梯度（70% 降档/85% 预警/100% 停止）与成本策略对应
3. ToolInvoker access matrix 白/黑名单双栅栏已实现
4. engine/evaluation Checker 全纯启发式无 LLM，MECE 合规
5. ScoredRouterService 已验证存在
6. ReActLoop 已实现反向洞察 #1（hasUnexecutedToolUse）/#4（stopCausedByApiError）/#5（MAX_RECOVERABLE_RETRIES=3）
7. CrossStageState 接口已存在，HITL append 存储层有支撑
8. RESEARCHER_MAX_ITERATIONS_HARD_CAP=10 是真正全局硬上界
9. 既有 `human-approval.tool.ts` DB-poll 阻塞原语可复用于 HITL P4a

---

## 建议行动（复核后无 blocker，按阶段）

**P1 防呆**：[02] rubric passLine 上界 clamp；[04] 用户编辑值双重 clamp
**P2**：[05] DynamicTeamBuilder 工具 ACL 生成
**P3**：[06] 流式透传路径 + TTFT verify
**P4**：[01] HITL append sanitize 管道；[08] 跨 pod 信令 verify（可复用既有审批原语降风险）
**持续**：[03] §10 补 #3/#7；[09] 通用 iteration cap；[11] 命名区分

---

## 实际 Read/Grep 文件

`guardrails/budget/mission-budget-pool.ts`、`budget-accountant.ts`、`evaluation/thresholds.constants.ts`、`teams/orchestrator/dynamic-planning.ts`、`runner/tool-invoker/tool-invoker.ts`、`runner/loop/react-loop.ts`、`runner/executor/query-loop.service.ts`、`llm-executor.ts`、`runner/dag/dag-executor.ts`、`teams/factory/team-factory.ts`、`mission-pipeline-orchestrator.service.ts`、`cross-stage-state.ts`、`ai-engine/routing/scored-router.service.ts`、`ai-engine/evaluation/checkers/coherence.checker.ts`、`ai-engine/safety/guardrails/input/prompt-injection-detector.ts`、`ai-engine/safety/security/llm-injection/prompt-sanitizer.ts`、`model-capability.types.ts`、`ai-stream-handler.service.ts`、`ai-engine/tools/categories/collaboration/human-approval.tool.ts`、`harness/lifecycle/human-approval-admin.service.ts`、`reflexion-loop.ts`、`json-extraction.utils.ts`、`anthropic-caller.ts`
