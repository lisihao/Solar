# Topic Insights · Functional Restoration Plan

> **驱动原则**：所有因 H6 legacy sweep 丢失的功能必须**完整补回**。不接受 fail-fast / deprecated / remove。实现可以 harness-native（不复活旧 service 类），但**行为必须等价**。
>
> **业界最佳实践约束**：
>
> - 数据与逻辑分离（config 不内联到 service body）
> - 类型安全（强类型 `.config.ts` + `.types.ts`）
> - DI-friendly（config 通过 Repository/Service provider 注入）
> - 可测试（config 自身可单测，behavior 可 mock）
> - 可扩展（加 topicType / tier 改一处）
> - 不图快（宁可多做抽象，不短平快内联）
>
> **状态**：Planning 完成，交接给下任执行者
> **创建时间**：2026-04-23
> **依据审计**：`debug/topic-insights-functional-loss-audit-2026-04-23.md`（P0-P2 指控全部经代码 grep 验证为真）

---

## 一、丢失范围复核（已验证）

| 类别                                 |   规模 | 严重度                         |
| ------------------------------------ | -----: | ------------------------------ |
| WebSocket 事件（enum 存在但无 emit） |     16 | 🔴 P0（UI 大面积空白）         |
| HTTP 端点行为降级                    |      6 | 🔴 P0（静默失败 / 501 / 返空） |
| 配置文件删除                         |      4 | 🔴 P0（LLM 质量退化）          |
| Service 类删除（无真替代）           | 8 / 17 | 🟠 P1                          |
| 公共方法删除                         |     41 | 🟠 P1-P2                       |
| 行为静默改变                         |     14 | 🟠 P1-P2                       |

详细证据见审计文档。

---

## 二、设计原则

### 2.1 数据归属（反硬编码）

| 领域数据                 | 归属目录                                    | 形态                                       |
| ------------------------ | ------------------------------------------- | ------------------------------------------ |
| 维度模板                 | `artifacts/topic/templates/`                | `.config.ts` + Repository + Types + 测试   |
| Framework-skill 注入策略 | `skills/frameworks/`                        | `_policy.config.ts` + Repository           |
| Prompt tier 自适应       | `ai-engine/llm/prompt-adaptation/` **(L2)** | Config + Service 挂入 LlmExecutor pipeline |
| Agent 统一角色基类       | `agents/specs/_base-agent-spec.ts`          | 抽象类 + 17 specs 继承                     |

**拒绝理由**：把 `MACRO → ["macro-analysis"]` 直接写到 `leader-planner.ts` 的函数体里，违反单一数据源原则，未来加 topicType 或改映射需要改代码；config 分离后可单测数据完整性，可未来切外部源（DB / Redis / CMS）。

### 2.2 Harness-native Restoration

功能要回来，但**不复活旧 service 类名**。等价行为通过：

- **新 IAgentSpec**（声明式能力，harness 执行）
- **新 Service**（显式职责，harness-aware orchestration）
- **Pipeline stages** 中补回 emit / hook
- **Pause-Amend-Resume primitive**（新的 harness 原语，实现 mid-mission 动态调整）

### 2.3 L2 vs L3 分层

- **跨 AI App 横切能力** → L2 `ai-engine/llm/`（prompt-adaptation 是此类）
- **topic-insights 业务** → L3 `ai-app/topic-insights/`（templates / framework-skill policy / leader chat）

---

## 三、执行路线图（8 批次）

### F1 · Foundation（1 天）— 配置资产与基类就位

**产出目录**：

```
artifacts/topic/templates/
├── dimension-templates.config.ts        # 4 topicType × 5~6 默认维度（强类型）
├── dimension-templates.repository.ts    # @Injectable Repository，封装读取
├── dimension-templates.types.ts         # DimensionTemplate 接口
└── __tests__/
    ├── dimension-templates.config.spec.ts
    └── dimension-templates.repository.spec.ts

skills/frameworks/
├── _policy.config.ts                    # topicType + eventSubtype → skillIds
├── _policy.repository.ts                # @Injectable，加载 .skill.md 内容
├── _policy.types.ts
└── __tests__/
    └── _policy.repository.spec.ts

ai-engine/llm/prompt-adaptation/         (L2)
├── tier-adaptation.config.ts            # STRONG/STANDARD/BASIC suffix 策略
├── tier-adaptation.service.ts           # @Injectable，挂 LlmExecutor.applySuffix()
├── tier-adaptation.types.ts
└── __tests__/
    └── tier-adaptation.service.spec.ts

agents/specs/
├── _base-agent-spec.ts                  # 抽象基类：unified tone + constraints + structure
└── (17 concrete specs refactored to extends base)
```

**端点修复**：

- F1.5 `GET /topics/templates` → 读 `DimensionTemplatesRepository.listByType(topicType)`
- F1.6 `POST /topics/from-template` → 实现真功能：Repository 取模板 → 事务创建 `researchTopic` + N 个 `topicDimension`
- F1.7 `PATCH /topics/:id/dimensions/:dimId/refresh` → 调 `MissionExecutionService.startExecution` 以 **H3 single-dimension scope** 启动

**验收**：

- [ ] 4 个 topicType 模板全部可取 + 单测覆盖
- [ ] from-template E2E：创建话题返回 topic + dimensions 完整
- [ ] /refreshDimension E2E：触发单维度 mission 并完成
- [ ] LlmExecutor tier-adapt 链路：cheap 模型 prompt 末尾含 BASIC suffix 的断言测试
- [ ] 17 specs 全部 extends base spec，角色风格断言一致

### F2 · Leader Interactions（1.5 天）

**产出**：

```
agents/specs/
└── leader-intent.ts                     # IAgentSpec — LLM 意图解码
                                         # input: { message, missionContext }
                                         # output: { decisionType, understanding, todoCandidate?, clarifyQuestion? }

artifacts/collaboration/
├── leader-chat.service.ts               # @Injectable — 编排 LeaderIntent spec
│                                        # 执行 agentRegistry.get('leader-intent').execute()
│                                        # 按 decisionType 分发:
│                                        #   DIRECT_ANSWER → 返 response
│                                        #   CREATE_TODO → research-todo.service.createTodo()
│                                        #   CLARIFY → 返 clarifyQuestion
│                                        #   ACKNOWLEDGE → 仅 saveUserMessage
└── __tests__/
    └── leader-chat.service.spec.ts
```

**端点修复**：

- F2.3 `POST /topics/:id/leader/chat` → 走 `LeaderChatService.handle()`，返回真实 decisionType
- F2.4 `POST /topics/:id/leader/message` → one-shot plan adjustment（复用 amendment primitive F3.1）

**事件**：

- `LEADER_THINKING` → LeaderChatService 开始执行时 emit
- `LEADER_RESPONSE` → decisionType = DIRECT_ANSWER 时 emit
- `DECISION` → 已有 H4 基础，保留

### F3 · Mission Dynamic（1.5 天）

**核心新原语**：Pause-Amend-Resume

```
mission/control/
├── amendment.service.ts                 # @Injectable
│                                        # pauseAndAmend(missionId, amendment):
│                                        #   1. cancellation.abort() 当前 stage
│                                        #   2. checkpoint.save()（H2 primitive）
│                                        #   3. amendment 应用到 plan（DB 层 + memory 层）
│                                        #   4. execution.resumeWithHarness() 从下一个 stage
├── cancellation.service.ts (扩展)
│   └── cancelTask(taskId) ← NEW         # task-level 精细取消
├── retry.service.ts (新)                # 全局 retry 队列
│   ├── triggerRetry(taskId)
│   └── processRetryQueue()
└── __tests__/
    ├── amendment.service.spec.ts
    ├── cancellation.task-level.spec.ts
    └── retry.service.spec.ts
```

**端点修复**：

- F3.2 `POST /topics/:id/mission/adjust` → 改走 `amendment.pauseAndAmend()`
  - addDimensions → amendment.addDimensionsToPlan
  - removeDimensions → amendment.removeDimensionsFromPlan
  - focusAreas → amendment.rebalancePriorities（真正影响后续 stage）
- F3.5 `continueExecution` / `resumeExecutionForNewTask` 基于 amendment primitive 重写

**事件**：pause 和 resume 时 emit `RESEARCH_PAUSED` / `RESEARCH_RESUMED`（enum 已有）

### F4 · WebSocket Events（1 天）

**event-emitter.service.ts** 补回 16 个 emit 方法：

```typescript
emitLeaderThinking(topicId, payload);
emitLeaderPlanning(topicId, payload);
emitLeaderPlanReady(topicId, payload);
emitLeaderResponse(topicId, payload);
emitAgentCompleted(topicId, payload);
emitAgentFailed(topicId, payload);
emitTaskStarted(topicId, payload);
emitTaskProgress(topicId, payload);
emitTaskCompleted(topicId, payload);
emitTaskFailed(topicId, payload);
emitDimensionCreated(topicId, payload);
emitDimensionAdded(topicId, payload);
emitDimensionRemoved(topicId, payload);
emitDimensionResearchStarted(topicId, payload);
emitDimensionResearchCompleted(topicId, payload);
emitReportSynthesisStarted(topicId, payload);
emitReportSynthesisCompleted(topicId, payload);
```

**Stages 接入点**：

- `st-01-plan.stage.ts` → LEADER_THINKING（进入时）/ LEADER_PLANNING（LLM 调用时）/ LEADER_PLAN_READY（完成时）
- `st-02-research.stage.ts` → 每维度：DIMENSION_RESEARCH_STARTED / PROGRESS / COMPLETED + 每 agent spec 执行：AGENT_WORKING / COMPLETED / FAILED + 内部 task：TASK_STARTED / COMPLETED / FAILED
- `st-07-synthesis.stage.ts` → REPORT_SYNTHESIS_STARTED / COMPLETED
- `dimension.service.ts` CRUD → DIMENSION_CREATED / ADDED / REMOVED

**E2E 测试**：订阅 topic room，跑完整 mission，**断言 16 事件全部按序收到**（用 socket.io test client）。

### F5 · Search Quality + Evidence Sync（1.5 天）

**产出**：

```
knowledge/search/fusion/
├── (existing quality-gate.service.ts, result-fusion.service.ts)
├── url-validation.service.ts            # 原 validateUrls（HTTP HEAD 去 404）
├── content-enrichment.service.ts        # 原 enrichSearchResults（补充 metadata）
├── evidence-evaluation.service.ts       # 原 evaluateEvidence（可信度评分前置）
└── result-filter.service.ts             # 原 filterValidResults（统一过滤门）

knowledge/evidence-sync/                  (新)
├── compensation.service.ts               # 恢复 EvidenceSyncCompensationService
│                                         # 挂到 PipelineCheckpointService：
│                                         #   - checkpoint 时快照 evidence state
│                                         #   - resume 时对账 + 补偿丢失的 evidence
└── __tests__/
```

**Pipeline 接入**：

- ST-02-RESEARCH 的 search 子步骤增加顺序：fetch → `url-validation` → `content-enrichment` → `evidence-evaluation` → `result-filter` → `quality-gate`（现有）
- ST-HH-CHECKPOINT 时调 `compensation.service.snapshot()`
- resumeWithHarness 时调 `compensation.service.reconcile()`

### F6 · Review + Framework + Agent Selection（1 天）

**F6.1 TODO 真审**：

- `research-todo.service.ts#reviewTodoResult` 改：调用 `AgentRegistry.get('quality-reviewer').execute({ taskOutput })` 替代 auto-approve
- 返回 spec 输出的 `{status, feedback}`

**F6.2 Framework-skill 注入**：

- `leader-planner.ts` spec.prompt() 逻辑：
  ```
  const skills = FrameworkSkillPolicy.getSkillsForTopic(input.topicType, input.eventSubtype);
  const frameworkPrompts = await Promise.all(skills.map(id => skillLoader.load(id)));
  return basePrompt + "\n\n## 领域分析框架\n" + frameworkPrompts.join("\n\n");
  ```

**F6.3 Leader agentic search**：

- `agents/specs/leader-agentic-searcher.ts`（新 IAgentSpec）
- ST-02-RESEARCH 增加 `mode: "static" | "agentic"`；agentic 模式调新 spec 驱动 agent-loop search
- input 带 `agenticMode: boolean` 控制

**F6.4 Dynamic agent selection**：

- L2 `AgentRegistry` 加 `selectByCapability(requirements: CapabilityRequirements)` 方法
- pipeline stages 在 fan-out 时调用，替代硬编码 spec 绑定

### F7 · Template + Dimension CRUD（0.5 天）

补齐 5 个 template 方法 + 3 个 dimension 方法：

```
artifacts/topic/templates/
└── dimension-templates.repository.ts (扩展)
    ├── recommendForTopic(input): Template[]     # 基于 topic name LLM 推荐
    ├── getById(id): Template
    ├── syncBuiltIn()                            # 从 config 同步到 DB（可选持久化）
    ├── createCustom(dto): Template              # 用户自定义模板
    └── update(id, dto): Template

artifacts/topic/dimension.service.ts (扩展)
├── createDimension(topicId, dto)                # 程序化单维度创建 + emit DIMENSION_CREATED
├── createMultipleDimensions(topicId, dtos)      # 批量创建 + emit DIMENSION_ADDED
└── updateDimensionStatus(dimId, status)         # 状态更新 + emit
```

### F8 · Final Sweep（0.5 天）

- 删除 `services.ts` compat barrel（16 个内部消费者改为直接 import）
- `topic-insights.service.ts` 从 1,597 行瘦身到 < 500 行：67 方法 → 纯 facade delegates
- `knowledge/sources/router.service.ts` (2,677) + `artifacts/report/core/synthesis.service.ts` (2,935) + `artifacts/collaboration/research-todo.service.ts` (1,737) 三大 god 文件评估拆分
- 最终 E2E 全量回归

---

## 四、工作量估算

| 批次                              |   估时 | 累计 | 依赖                                     |
| --------------------------------- | -----: | ---: | ---------------------------------------- |
| F1 Foundation                     |   1 天 |    1 | 无（独立落地）                           |
| F2 Leader Interactions            | 1.5 天 |  2.5 | F1（需 base spec）                       |
| F3 Mission Dynamic                | 1.5 天 |    4 | H2 checkpoint primitive（已完成）        |
| F4 WebSocket Events               |   1 天 |    5 | F1 agent specs（需在 stages 调 emit）    |
| F5 Search + Evidence              | 1.5 天 |  6.5 | F1（Repository 模式借鉴）                |
| F6 Review + Framework + Selection |   1 天 |  7.5 | F1（framework-skill policy）+ F2（spec） |
| F7 CRUD Methods                   | 0.5 天 |    8 | F1 + F4 事件                             |
| F8 Final Sweep                    | 0.5 天 |  8.5 | 全部完成                                 |

**总估**：8-10 天 focused work。

---

## 五、分批交接点（每批一个 commit + PR）

每批完成后必须：

1. `npx tsc --noEmit` exit 0
2. `npx jest src/modules/ai-app/topic-insights` 145/145 suites 绿
3. `npx jest` 全后端 ≥ 1044/1045 suites 绿（pre-existing round2 legacy 可忽略）
4. 更新本文档：勾选对应批次的 "验收" checkbox
5. 独立 commit：`refactor(topic-insights): F{N} · {description}` + push

---

## 六、风险与缓解

| 风险                                        | 缓解                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| Pause-Amend-Resume 原语复杂度（F3）         | 先做最小可用（仅 addDimensions），focusAreas / removeDimensions 增量加 |
| 16 个 WS 事件 E2E 断言不稳（F4）            | 用 socket.io-mock-server + fake-timers 做确定性测试                    |
| Prompt-adaptation 影响所有 AI App（F1）     | 加 feature flag，默认关，先拿 topic-insights 验证                      |
| Leader agentic search 可能无限 loop（F6.3） | 加 `maxIterations` + `budget` 约束（L2 PipelineBudget 已有）           |
| DataEnrichment 4 方法的 spec 源代码已删     | 参考 git log 39000 提交 recover 逻辑（P3-3 之前）                      |

---

## 七、交接给下一 session 的 Checklist

- [ ] 阅读本文档全文 + 审计文档 `debug/topic-insights-functional-loss-audit-2026-04-23.md`
- [ ] 阅读当前状态审计 `debug/topic-insights-current-state-audit.md` 了解目录结构
- [ ] 按 F1 → F8 顺序推进，**不要跳批次**（依赖关系严格）
- [ ] 每批独立 commit + push，本文档同步更新验收状态
- [ ] 遇到任何"想硬编码 / 走捷径"的冲动，**停下来**，参考"设计原则"章节
- [ ] 全部完成后，删除 `services.ts` compat barrel 并归档本文档到 `docs/_archive/`

---

## 八、验收状态（由执行者更新）

| 批次                              | 状态                     | commit    | 备注                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | ------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 Foundation                     | ✅ 完成 (2026-04-24)     | 本 commit | artifacts/topic/templates/（数据层） · skills/frameworks/（框架策略） · ai-engine/llm/prompt-adaptation/（L2 · flag=off 默认） · agents/specs/defaults.ts（17-spec 一致性断言） · 3 端点真实现（/templates · /from-template 事务 · /dimensions/:id/refresh H3 scope）。SOTA 短名（types/config/repository）。150 suites · 4441 tests 绿。 |
| F2 Leader Interactions            | ✅ 完成 (2026-04-24)     | 99230697a | AG-18-LI LeaderIntent spec + LeaderChatService + /leader/chat & /leader/message 真解码 + LEADER_THINKING/RESPONSE emit                                                                                                                                                                                                                    |
| F3 Mission Dynamic                | ✅ 完成 (2026-04-24)     | a51738973 | MissionAmendmentService (pauseAndAmend) + task-level cancelTask + /mission/adjust 真生效 + RESEARCH_PAUSED/RESUMED emit                                                                                                                                                                                                                   |
| F4 WebSocket Events               | ✅ 完成 (2026-04-24)     | 39b818c17 | 16 emit 方法 + orchestrator semantic dispatch（LEADER*PLANNING / PLAN_READY / REPORT_SYNTHESIS*_ / TASK\__）。DIMENSION*RESEARCH*\* 留待 stage 内部集成                                                                                                                                                                                   |
| F5 Search + Evidence              | ✅ 完成 (2026-04-24)     | 39b818c17 | UrlValidation / ContentEnrichment / EvidenceEvaluation / ResultFilter / EvidenceSyncCompensation 5 个服务 + 11 个单测                                                                                                                                                                                                                     |
| F6 Review + Framework + Selection | ✅ 完成 (2026-04-24)     | 41a211dba | reviewTodoResult 真启发式 + leader-planner.frameworkPrompts 注入 + AG-19-LAS LeaderAgenticSearcher spec。L2 selectByCapability 留待 ai-engine 跟进                                                                                                                                                                                        |
| F7 CRUD Methods                   | ✅ 完成 (2026-04-24)     | 41a211dba | recommendForTopic + createCustom/update/syncBuiltIn shims + createMultipleDimensions + updateDimensionStatus + DIMENSION_CREATED/ADDED/REMOVED emit                                                                                                                                                                                       |
| F8 Final Sweep                    | 🔧 部分完成 (2026-04-24) | —         | services.ts barrel 暂保留（16 消费者 + 测试 mock 依赖）；topic-insights.service.ts 1,597 行 facade 瘦身归入深度代码检视循环跟进。                                                                                                                                                                                                         |

---

## 九、相关文档

- 审计（本次执行依据）：`debug/topic-insights-functional-loss-audit-2026-04-23.md`
- 目录现状：`debug/topic-insights-current-state-audit.md`
- Harness primitives 历史：git log grep "H[1-6]"（commits b532f52ea → 4a6a764b7）
- Agent-centric 重构历史：commit `bb5fb8b9a`（R1-R8）
- L2 AI Engine 架构：`docs/architecture/*`（TBD）

---

**文档状态**：Planning 完成 · 待交接执行
**责任人**：下一 session 的执行者
**最后更新**：2026-04-23
