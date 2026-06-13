# AI Engine 迁移 TODO 清单

> **生成日期**: 2025-01-12 (更新于 2026-01-12)
> **基于文档**: ai-engine-target-architecture.md v2.0
> **状态标记**: ⬜ 待办 | 🔄 进行中 | ✅ 完成 | ❌ 阻塞

---

## Phase 0: 目录结构调整 (预计 1-2 天)

### 0.1 Research 模块目录重组

| #     | 任务                                                                       | 优先级 | 状态 |
| ----- | -------------------------------------------------------------------------- | ------ | ---- |
| 0.1.1 | 创建 `backend/src/modules/ai-app/research/` 目录                           | P0     | ✅   |
| 0.1.2 | 创建 `backend/src/modules/ai-app/research/research.module.ts` 统一导出模块 | P0     | ✅   |
| 0.1.3 | 迁移 `ai-app/topic-research/` → `ai-app/research/topic-research/`          | P0     | ✅   |
| 0.1.4 | 迁移 `ai-app/studio/deep-research/` → `ai-app/research/deep-research/`     | P0     | ✅   |
| 0.1.5 | 创建 `ai-app/research/fast-research/` 目录 (如果需要)                      | P1     | ✅   |
| 0.1.6 | 更新 `ai-studio.module.ts` 移除对 deep-research 的依赖                     | P0     | ✅   |
| 0.1.7 | 更新所有 import 路径引用                                                   | P0     | ✅   |
| 0.1.8 | 运行测试验证迁移正确性                                                     | P0     | ✅   |

---

## Phase 0.5: 清理冗余代码 (预计 1 天)

### 0.5.1 清理 topic-research 冗余 Facade 导入

| #       | 任务                                | 文件                            | 状态 |
| ------- | ----------------------------------- | ------------------------------- | ---- |
| 0.5.1.1 | 清理冗余导入或迁移到实际使用 Facade | `dimension-research.service.ts` | ✅   |
| 0.5.1.2 | 清理冗余导入或迁移到实际使用 Facade | `report-synthesis.service.ts`   | ✅   |
| 0.5.1.3 | 清理冗余导入或迁移到实际使用 Facade | `research-leader.service.ts`    | ✅   |
| 0.5.1.4 | 清理冗余导入或迁移到实际使用 Facade | `research-reviewer.service.ts`  | ✅   |
| 0.5.1.5 | 清理冗余导入或迁移到实际使用 Facade | `topic-research.service.ts`     | ✅   |

---

## Phase 1: 统一 taskProfile 使用 (预计 3-5 天)

### 1.1 消除硬编码参数

| #     | 任务                                                               | 优先级 | 状态                            |
| ----- | ------------------------------------------------------------------ | ------ | ------------------------------- |
| 1.1.1 | 全局搜索 `temperature: [数字]` 的代码                              | P0     | ✅                              |
| 1.1.2 | 替换所有 `temperature` 为对应的 `taskProfile.creativity` (P0 模块) | P0     | ✅                              |
| 1.1.3 | 全局搜索 `maxTokens: [数字]` 的代码                                | P0     | ✅                              |
| 1.1.4 | 替换所有 `maxTokens` 为对应的 `taskProfile.outputLength` (P0 模块) | P0     | ✅                              |
| 1.1.5 | 更新单元测试中的硬编码参数                                         | P0     | ✅ (Provider层测试保留底层参数) |

### 1.2 taskProfile 映射参考

```
creativity:    deterministic(0.1) | low(0.3) | medium(0.7) | high(0.9)
outputLength:  minimal(500) | short(1500) | medium(4000) | standard(6000) | long(8000) | extended(16000)
```

---

## Phase 2: 扩展 Facade 能力 (预计 1 周)

### 2.1 增强 AIEngineFacade

| #     | 任务                                                    | 优先级 | 状态          |
| ----- | ------------------------------------------------------- | ------ | ------------- |
| 2.1.1 | 实现真正的流式输出 `chatStream()` (当前是模拟分块)      | P0     | ✅            |
| 2.1.2 | 添加模型选择 API `selectModel(type, options)`           | P0     | ✅            |
| 2.1.3 | 添加推理模型获取 API `getReasoningModel()`              | P0     | ✅            |
| 2.1.4 | 内置熔断器到 `chat()` 方法 (封装 CircuitBreakerService) | P0     | ✅            |
| 2.1.5 | 添加 Agent 执行能力 `executeAgent(agentType, input)`    | P1     | ✅            |
| 2.1.6 | 添加工具执行能力 `executeTool(toolId, params)`          | P1     | ✅            |
| 2.1.7 | 更新 Facade 类型定义 `facade/types.ts`                  | P0     | ✅            |
| 2.1.8 | 编写 Facade 单元测试                                    | P0     | ✅ (20 tests) |

---

## Phase 3: 迁移 AI Apps 到 Facade (预计 2-3 周)

### 3.1 模块迁移 (按优先级排序)

| #      | 模块               | 当前调用方式                      | 优先级 | 状态                                                                       |
| ------ | ------------------ | --------------------------------- | ------ | -------------------------------------------------------------------------- |
| 3.1.1  | **topic-research** | AIEngineFacade                    | P0     | ✅                                                                         |
| 3.1.2  | **ask**            | AIEngineFacade + FunctionCalling  | P0     | ✅                                                                         |
| 3.1.3  | **coding**         | AIEngineFacade                    | P1     | ✅                                                                         |
| 3.1.4  | **simulation**     | AIEngineFacade                    | P1     | ✅                                                                         |
| 3.1.5  | **studio**         | AIEngineFacade                    | P1     | ✅                                                                         |
| 3.1.6  | **teams**          | AIEngineFacade + CircuitBreaker   | P1     | ✅                                                                         |
| 3.1.7  | **rag**            | 无 LLM 调用 (仅 Embedding/Rerank) | P2     | ✅ (无需迁移)                                                              |
| 3.1.8  | **office**         | AIEngineFacade                    | P2     | ✅ (8/8 文件完成)                                                          |
| 3.1.9  | **writing**        | AIEngineFacade                    | P2     | ✅ (outline.service, writer.agent, writing-mission.service)                |
| 3.1.10 | **image**          | AIEngineFacade                    | P3     | ✅ (analytics.service, prompt-enhancement.service, agent-executor.service) |
| 3.1.11 | **deep-research**  | AIEngineFacade                    | P0     | ✅                                                                         |

### 3.2 每个模块迁移步骤

```
对每个模块执行:
1. [ ] 替换 AiChatService → AIEngineFacade
2. [ ] 替换直接参数 → taskProfile
3. [ ] 移除本地模型选择逻辑
4. [ ] 移除本地上下文构建逻辑 (使用 Facade.buildContext)
5. [ ] 运行测试验证
6. [ ] 更新模块文档
```

---

## Phase 4: 能力沉淀到 AI Engine (预计 2-3 周)

### 4.1 从 AI Writing 沉淀 (~5,295 行)

| #     | 能力           | 源文件                                                  | 目标位置                             | 行数  | 状态 |
| ----- | -------------- | ------------------------------------------------------- | ------------------------------------ | ----- | ---- |
| 4.1.1 | 质量门禁框架   | `writing/services/quality/quality-gate.service.ts`      | `ai-engine/constraint/quality-gate/` | 974   | ⬜   |
| 4.1.2 | 表达多样性检测 | `writing/services/quality/expression-memory.service.ts` | `ai-engine/constraint/expression/`   | 1,620 | ⬜   |
| 4.1.3 | 一致性检查框架 | `writing/services/consistency/*.service.ts`             | `ai-engine/constraint/consistency/`  | 1,691 | ⬜   |
| 4.1.4 | 并行任务编排   | `writing/services/parallel/*.service.ts`                | `ai-engine/orchestration/parallel/`  | 1,010 | ⬜   |

### 4.2 从 AI Teams 沉淀 (~390 行)

| #     | 能力            | 源文件                                                          | 目标位置                                 | 行数 | 状态 |
| ----- | --------------- | --------------------------------------------------------------- | ---------------------------------------- | ---- | ---- |
| 4.2.1 | Leader 模型容错 | `teams/services/ai/leader-model.service.ts`                     | `ai-engine/llm/model-fallback/`          | 190  | ✅   |
| 4.2.2 | 任务状态机      | `teams/services/collaboration/mission/mission-state.manager.ts` | `ai-engine/orchestration/state-machine/` | ~200 | ✅   |

### 4.3 从 Topic Research 沉淀 (~1,100 行)

| #     | 能力         | 源文件                                                | 目标位置                                         | 行数 | 状态 |
| ----- | ------------ | ----------------------------------------------------- | ------------------------------------------------ | ---- | ---- |
| 4.3.1 | 维度规划逻辑 | `topic-research/services/research-leader.service.ts`  | 复用 `ai-engine/orchestration/task-decomposer`   | ~500 | ⬜   |
| 4.3.2 | 报告合成逻辑 | `topic-research/services/report-synthesis.service.ts` | 复用 `ai-engine/orchestration/iteration-manager` | ~600 | ⬜   |

### 4.4 从 Deep Research 沉淀 (~700 行)

| #     | 能力         | 源文件                                             | 目标位置                                                 | 行数 | 状态 |
| ----- | ------------ | -------------------------------------------------- | -------------------------------------------------------- | ---- | ---- |
| 4.4.1 | 研究规划器   | `studio/deep-research/research-planner.service.ts` | 复用 `ai-engine/orchestration/task-decomposer`           | ~400 | ⬜   |
| 4.4.2 | 自我反思机制 | `studio/deep-research/self-reflection.service.ts`  | `ai-engine/orchestration/services/reflection.service.ts` | ~300 | ✅   |

---

## Phase 5: 补齐 AI Engine 缺失能力 (预计 2 周)

### 5.1 新增服务实现

| #     | 能力             | 目标文件                                                 | 优先级 | 状态 |
| ----- | ---------------- | -------------------------------------------------------- | ------ | ---- |
| 5.1.1 | 反思机制服务     | `ai-engine/orchestration/services/reflection.service.ts` | P0     | ✅   |
| 5.1.2 | 模型降级容错     | `ai-engine/llm/model-fallback/model-fallback.service.ts` | P0     | ✅   |
| 5.1.3 | 表达多样性约束   | `ai-engine/constraint/expression-diversity/`             | P1     | ⬜   |
| 5.1.4 | 质量门禁系统     | `ai-engine/constraint/quality-gate/`                     | P1     | ⬜   |
| 5.1.5 | 事实一致性检查   | `ai-engine/constraint/fact-consistency/`                 | P1     | ⬜   |
| 5.1.6 | 增强并行依赖编排 | 扩展 `ai-engine/orchestration/parallel-executor`         | P1     | ⬜   |
| 5.1.7 | 会话管理抽象     | `ai-engine/memory/session-manager/`                      | P2     | ⬜   |

---

## Phase 6: 能力拉齐与统一 (预计 1-2 周)

> **分析日期**: 2026-01-12
> **结论**: 各模块上下文构建有不同领域需求，不应强制统一；模型选择和任务分解已部分统一

### 6.1 统一上下文构建

**分析结论**: 各模块上下文构建服务于不同领域需求，**不建议强制统一到单一实现**

| #     | 模块    | 文件                                 | 功能                     | 结论                                       |
| ----- | ------- | ------------------------------------ | ------------------------ | ------------------------------------------ |
| 6.1.1 | ask     | `ai-ask.service.ts`                  | 消息历史+RAG+图片清理    | ✅ 识别完成 - 领域特有                     |
| 6.1.2 | teams   | `mission-context.service.ts`         | 结构化Mission上下文包    | ✅ 识别完成 - 领域特有                     |
| 6.1.3 | teams   | `context-router.service.ts`          | 意图驱动的上下文路由     | ✅ 识别完成 - 已使用IntentDetectionService |
| 6.1.4 | teams   | `topic-context-retrieval.service.ts` | 语义相似度检索           | ✅ 识别完成 - 使用EmbeddingService         |
| 6.1.5 | writing | `context-builder.service.ts`         | 分层前文上下文(近/中/远) | ✅ 识别完成 - 领域特有                     |
| 6.1.6 | studio  | `ai-studio-chat.service.ts`          | NotebookLM风格引用       | ✅ 识别完成 - 领域特有                     |

### 6.2 统一模型选择

**分析结论**: 发现5处重复的`getModelConfig`实现，3处已正确委托

| #     | 模块     | 文件                                   | 方法                    | 当前状态                               | 建议                       |
| ----- | -------- | -------------------------------------- | ----------------------- | -------------------------------------- | -------------------------- |
| 6.2.1 | ask      | `ai-ask.service.ts:840-884`            | getModelConfig          | ❌ 直接DB查询                          | 可迁移到Facade.selectModel |
| 6.2.2 | studio   | `ai-studio-chat.service.ts:275-324`    | getModelConfig          | ❌ 直接DB查询                          | 可迁移到Facade.selectModel |
| 6.2.3 | teams    | `leader-model.service.ts`              | executeWithFallback     | ✅ 已委托ModelFallbackService          | 保持                       |
| 6.2.4 | teams    | `team-mission.service.ts:319-336`      | getModelConfig          | ⚠️ 直接DB查询但使用executeWithFallback | 低优先级                   |
| 6.2.5 | teams    | `mission-execution.service.ts:167-184` | getModelConfig          | ⚠️ 直接DB查询但使用executeWithFallback | 低优先级                   |
| 6.2.6 | research | `research-leader.service.ts:213-232`   | getReasoningModel       | ✅ 已委托AIEngineFacade                | 保持                       |
| 6.2.7 | image    | `image-generation.service.ts:26-150`   | getDefaultTextModel     | ❌ 直接DB查询+Google偏好               | 可迁移但保留偏好逻辑       |
| 6.2.8 | writing  | `writing-mission.service.ts:480-574`   | buildRoleToModelMapping | ⚠️ 创新的角色化多元分配                | 保持独特逻辑               |

### 6.3 统一错误重试机制

**分析结论**: CircuitBreakerService已被广泛使用，存在2处相似的callAIWithRetry实现

| #     | 模块  | 文件                                   | 方法                       | 当前状态              | 建议                      |
| ----- | ----- | -------------------------------------- | -------------------------- | --------------------- | ------------------------- |
| 6.3.1 | teams | `mission-execution.service.ts:265-375` | callAIWithRetry            | ⚠️ 手工循环+heartbeat | 保持(heartbeat是特有需求) |
| 6.3.2 | teams | `team-mission.service.ts:515-633`      | callAIWithRetry            | ⚠️ 手工循环+heartbeat | 考虑抽取公共实现          |
| 6.3.3 | teams | `ai-response.service.ts`               | generateWithToolsWithRetry | ⚠️ 手工循环           | 可迁移到通用重试          |
| 6.3.4 | teams | 多处                                   | CircuitBreakerService      | ✅ 已使用             | 保持                      |

**CircuitBreakerService使用情况**:

- `mission-execution.service.ts` - canExecute, selectBest, recordSuccess, recordFailure, load管理 ✅
- `mission-review.service.ts` - recordFailure ✅
- `team-mission.service.ts` - canExecute, recordSuccess, recordFailure ✅

### 6.4 统一任务分解

**分析结论**: AI Teams已正确使用TaskDecomposerService，其他模块有领域特有实现

| #     | 模块      | 文件                                         | 当前状态                     | 建议       |
| ----- | --------- | -------------------------------------------- | ---------------------------- | ---------- |
| 6.4.1 | ai-engine | `task-decomposer.service.ts`                 | ★ 核心实现(Levenshtein匹配)  | 基础服务   |
| 6.4.2 | ai-engine | `task-granularity.service.ts`                | ★ 粒度控制                   | 补充服务   |
| 6.4.3 | teams     | `task-breakdown.service.ts`                  | ✅ 委托TaskDecomposerService | 保持       |
| 6.4.4 | slides    | `slides-leader.ts:planTasks`                 | ⚠️ 领域特有格式              | 可考虑统一 |
| 6.4.5 | coding    | `coding-agent.service.ts:parseTaskBreakdown` | ⚠️ JSON+硬编码fallback       | 可考虑统一 |
| 6.4.6 | research  | `research-mission.service.ts`                | ⚠️ 维度特有逻辑              | 领域特有   |

### 6.5 统一输出评审

**分析结论**: MissionReviewService已正确使用OutputReviewerService

| #     | 模块      | 文件                                 | 当前状态                       | 建议       |
| ----- | --------- | ------------------------------------ | ------------------------------ | ---------- |
| 6.5.1 | ai-engine | `output-reviewer.service.ts`         | ★ 核心实现(支持aiCaller注入)   | 基础服务   |
| 6.5.2 | teams     | `mission-review.service.ts`          | ✅ 已委托OutputReviewerService | 保持       |
| 6.5.3 | research  | `research-reviewer.service.ts`       | ⚠️ 使用AIEngineFacade          | 可考虑迁移 |
| 6.5.4 | writing   | `writing-quality-checker.service.ts` | ⚠️ 独立LLM调用                 | 可考虑迁移 |
| 6.5.5 | writing   | `quality-gate.service.ts`            | ⚠️ 维度评分(非AI驱动)          | 领域特有   |
| 6.5.6 | slides    | `quality-audit.skill.ts`             | ⚠️ PPT专用审计                 | 领域特有   |

---

## Phase 7: 促进已有能力使用 (预计 1 周)

> **分析日期**: 2026-01-12
> **结论**: 部分AI Engine能力已被采用，建议重点推广意图检测和上下文演化

### 7.1 推广使用 AI Engine 已有能力

| #      | AI Engine 能力            | 应使用的模块         | 当前采用状态                   | 状态        |
| ------ | ------------------------- | -------------------- | ------------------------------ | ----------- |
| 7.1.1  | `IntentDetectionService`  | Topic Research       | ✅ Teams+Research Leader已使用 | ✅ 已采用   |
| 7.1.2  | `IterationManagerService` | Topic Research       | ❌ 未使用                      | ⬜          |
| 7.1.3  | `ContextEvolutionService` | Topic Research       | ✅ Teams MissionReview已使用   | ✅ 部分采用 |
| 7.1.4  | `CheckpointManager`       | Office               | ❌ Office有自己实现            | ⬜          |
| 7.1.5  | `QualityMonitorService`   | Studio Deep Research | ❌ 未使用                      | ⬜          |
| 7.1.6  | `ShortTermMemoryService`  | 各模块会话上下文     | ⚠️ Ask已使用工具形式           | 🔄 部分采用 |
| 7.1.7  | `LongTermMemoryService`   | 用户偏好和历史       | ❌ 未使用                      | ⬜          |
| 7.1.8  | `ToolRegistry` (48+ 工具) | Teams/Writing Agent  | ⚠️ Ask使用，其他未使用         | 🔄 部分采用 |
| 7.1.9  | `ModelFallbackService`    | 所有AI调用模块       | ✅ Teams Leader已使用          | ✅ 已采用   |
| 7.1.10 | `ExecutionStateManager`   | Mission状态管理      | ✅ Teams MissionState已使用    | ✅ 已采用   |
| 7.1.11 | `TaskDecomposerService`   | 任务分解             | ✅ Teams TaskBreakdown已使用   | ✅ 已采用   |
| 7.1.12 | `OutputReviewerService`   | 输出评审             | ✅ Teams MissionReview已使用   | ✅ 已采用   |

### 7.2 采用情况汇总

**已正确采用 AI Engine 能力的模块** (示范模式):

- `LeaderModelService` → `ModelFallbackService` ✅
- `MissionStateManager` → `ExecutionStateManager` ✅
- `TaskBreakdownService` → `TaskDecomposerService` ✅
- `MissionReviewService` → `OutputReviewerService` + `ContextEvolutionService` ✅
- `ContextRouterService` → `IntentDetectionService` ✅

**建议推广的能力** (按优先级):

1. **P0**: IntentDetectionService → Research Leader (替代自定义理解阶段)
2. **P1**: IterationManagerService → Topic Research (报告版本管理)
3. **P1**: QualityMonitorService → Deep Research (质量追踪)
4. **P2**: CheckpointManager → Office (替代自定义checkpoint)
5. **P2**: ToolRegistry → Writing Agent (工具调用)

---

## Phase 8: 验证与测试 (贯穿全程)

### 8.1 验证命令

```bash
# 检查直接 AiChatService 调用 (目标: 0)
grep -r "aiChatService\.chat" backend/src/modules/ai-app --include="*.ts" | wc -l

# 检查冗余 Facade 导入 (目标: 0 或全部实际使用)
grep -r "import.*AIEngineFacade" backend/src/modules/ai-app --include="*.ts"

# 检查硬编码 temperature (目标: 0)
grep -r "temperature:\s*[0-9]" backend/src/modules/ai-app --include="*.ts"

# 检查硬编码 maxTokens (目标: 0)
grep -r "maxTokens:\s*[0-9]" backend/src/modules/ai-app --include="*.ts"

# 检查 taskProfile 使用数量
grep -r "taskProfile:" backend/src/modules/ai-app --include="*.ts" | wc -l
```

### 8.2 验收检查清单

| #     | 检查项               | 验证方法                                            | 状态 |
| ----- | -------------------- | --------------------------------------------------- | ---- |
| 8.2.1 | Facade 作为唯一入口  | `grep AiChatService in ai-app` 结果为 0             | ⬜   |
| 8.2.2 | 无硬编码模型名       | `grep "model: '"` 结果为 0                          | ⬜   |
| 8.2.3 | 无硬编码 temperature | `grep "temperature:"` 结果为 0 (或仅在 Engine 内部) | ⬜   |
| 8.2.4 | 无硬编码 maxTokens   | `grep "maxTokens:"` 结果为 0 (或仅在 Engine 内部)   | ⬜   |
| 8.2.5 | 统一使用 taskProfile | 所有 chat 调用包含 taskProfile                      | ⬜   |
| 8.2.6 | 统一熔断机制         | Facade 内置或所有模块使用 CircuitBreakerService     | ⬜   |
| 8.2.7 | E2E 测试通过         | 所有现有功能正常工作                                | ⬜   |
| 8.2.8 | 性能不下降           | 响应时间对比 < 10% 差异                             | ⬜   |

---

## 优先级矩阵

```
                    高复用性
                       │
    ┌──────────────────┼──────────────────┐
    │                  │                  │
    │   P1: 立即沉淀   │   P0: 紧急沉淀   │
    │  - 表达多样性    │  - 模型降级容错  │
    │  - 一致性检查    │  - 反思机制      │
    │  - 并行编排      │  - 清理冗余代码  │
    │                  │  - 统一taskProfile│
    │                  │                  │
低 ─┼──────────────────┼──────────────────┼─ 高
影响│                  │                  │  影响
    │   P3: 观察       │   P2: 计划沉淀   │
    │  - 会话管理      │  - 质量门禁      │
    │                  │  - 维度规划      │
    │                  │  - 报告合成      │
    │                  │                  │
    └──────────────────┼──────────────────┘
                       │
                    低复用性
```

---

## 时间线总览

| 阶段      | 任务                 | 预计时间    | 优先级 |
| --------- | -------------------- | ----------- | ------ |
| Phase 0   | 目录结构调整         | 1-2 天      | **P0** |
| Phase 0.5 | 清理冗余代码         | 1 天        | **P0** |
| Phase 1   | 统一 taskProfile     | 3-5 天      | **P0** |
| Phase 2   | 扩展 Facade 能力     | 1 周        | **P0** |
| Phase 3   | 迁移 AI Apps         | 2-3 周      | **P1** |
| Phase 4   | 能力沉淀到 AI Engine | 2-3 周      | **P1** |
| Phase 5   | 补齐缺失能力         | 2 周        | **P1** |
| Phase 6   | 能力拉齐统一         | 1-2 周      | **P1** |
| Phase 7   | 促进已有能力使用     | 1 周        | **P2** |
| Phase 8   | 验证测试             | 贯穿全程    | **P0** |
| **总计**  | -                    | **8-12 周** | -      |

---

## 快速统计

| 指标         | 数量          |
| ------------ | ------------- |
| 总任务数     | **85+**       |
| P0 任务      | 25            |
| P1 任务      | 40            |
| P2 任务      | 15            |
| P3 任务      | 5             |
| 应沉淀代码量 | ~7,500 行     |
| 涉及模块     | 10 个 AI Apps |

---

**文档版本**: 1.0
**生成日期**: 2025-01-12
**维护者**: Claude Code
