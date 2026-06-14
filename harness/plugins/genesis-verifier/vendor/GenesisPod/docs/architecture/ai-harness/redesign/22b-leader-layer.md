# Leader 层行为契约文档

**基线 Commit**: 38347e2a71d96266ccf3c52069c03dd15bf16af5
**生成日期**: 2026-04-24
**源**: agent `ac14e9e8e0445009f` 本地 Read 基线源码产出

---

## 5.1 · leader-planning.service.ts（1394 行，4 个 public methods）

### method: getReasoningModel()

- **行号**: L145-L177
- **调用者**: planResearch / planDimensionOutline / planGlobalOutline
- **业务用途**: 查询当前推理模型元数据
- **返回**: `{ modelId, modelName, provider, isReasoning } | null`
- **业务不变量**:
  - 若无可用 reasoning model 返回 null（调用方需 fallback 到普通 chat model）

### method: planResearch(topicId, userPrompt) · **核心规划入口**

- **行号**: L182-L556
- **调用者**: MissionLifecycleService.executePlanningAsync
- **业务用途**: 为 topic 产出 LeaderPlan（dimensions + agentAssignments + executionStrategy）
- **控制流伪码**:
  - STEP 1: `prisma.researchTopic.findUnique({ include: { dimensions: true } })`
  - STEP 2: `getReasoningModel()` — 拿推理模型
  - STEP 3: `chatFacade.getAvailableModelsExtended()` 过滤 `isAvailable !== false`，剔除 reasoning
  - STEP 4: 构造 `modelNameToIdMap`（处理同名模型，支持 displayName → id 反解）
  - STEP 5: Prompt 替换 `LEADER_PLAN_PROMPT`：{topic, topicType, availableModels, existingDimensions, currentDate, currentYear, recommendedDepth, anchorArticleContent, languageInstruction}
  - STEP 6: LLM 调用（`model=leaderModel.modelId`, `taskProfile={creativity:medium, outputLength:extended, reasoningDepth:deep}`, `responseFormat:json`）
  - STEP 7: `extractJsonFromResponse(requiredKey="dimensions")` 解析
  - STEP 8: **后处理 agentAssignments FOR EACH**:
    - a. modelId 反解：查 `modelNameToIdMap`，模糊匹配支持最长前缀
    - b. skill 过滤：`VALID_SKILLS` 白名单，过滤 LLM 幻觉的非法 skill
    - c. 自动模型分配（若 modelId 缺失）：轮询 `availableModels[modelIndex % length]`
    - d. **研究员专属**：框架技能前置（`resolveFrameworkSkills(topic.type)`）+ `selectDefaultSkillsForDimension()` + 默认 `["web-search"]` + `assignmentReason`（agentReason + modelReason）
    - e. **质量审核员**：`DEBATE_SKILLS_BY_TOPIC_TYPE` 注入 + 默认 `["critical-thinking", "synthesis"]`
    - f. **报告撰写员**：默认 `["synthesis"]`
- **Prisma 读写**:
  - READ: researchTopic.findUnique(include:{dimensions})
- **LLM Prompt**: `LEADER_PLAN_PROMPT` from prompts/research-leader.prompt
- **业务不变量**:
  - LLM 返回的 modelId（可能是 displayName）**必须反解**为真实 id
  - `invalidSkills`（白名单外）**必须过滤**后才存 `assignment.skills`
  - 无 modelId 的 agent **必须**轮询分配到 availableModels
  - 研究员 assignment **必须**包含 `skills + tools + assignmentReason`（agentReason + modelReason）

### method: planDimensionOutline(topic, dimension, evidenceSummary, figuresSummary?, otherDimensions?)

- **行号**: L557-L959
- **调用者**: dimension-mission.service / dimension-writing.service
- **业务用途**: 为单个 dimension 产出 outline（sections + agentRoles + executionPlan + figures 分配）
- **控制流伪码**:
  - STEP 1: 信号量 `max 3 concurrent`
  - STEP 2: **重试机制** `MAX_RETRIES=3`：
    - attempt 1-2: 推理模型
    - attempt 3: fallback 非推理模型
    - **指数退避** 2s → 8s → 32s（`BASE_DELAY_MS * 4^(attempt-1)`）— rate limit
    - **线性延迟** 2s → 4s → 6s（`BASE_DELAY_MS * attempt`）— 其它错误
    - `failedModelIds` 追踪（配额/欠费错误模型不重选）
  - STEP 3: **错误检测**：
    - "insufficient credits" → `InsufficientCreditsException`（不重试）
    - "context_too_long" → `ContextTooLongException`（不重试）
    - "429 / 402 / quota / rate limit / payment / billing" → 标记 `failedModelIds`，重试
    - HTML 错误页面 → log warn，重试
  - STEP 4: **响应后处理**：
    - 剥离 `<think>...</think>` 和 `<reasoning>...</reasoning>`
    - `extractJsonFromResponse(requiredKey="sections")`
    - 补全 `executionPlan`（parallelGroups + estimatedTotalWords）
    - **targetWords 均匀化**：median ± 100%（防极度不均）
    - `stripLLMMetaNotes` 清理 `section.description`
    - 记录 `allocatedFigures` 分配情况
- **LLM Prompt**: `DIMENSION_OUTLINE_PROMPT`
- **业务不变量**:
  - **图表分配规则**（prompt 硬性约束）：
    - 每 section 0-2 个**内容直接相关**的图表
    - 图表 title/desc 的**核心主题词**必须与 section.title 或 keyPoints 直接相关
    - **宁缺勿滥**：不确定相关性时不分配
    - `relevanceReason` 必须具体说明

### method: planGlobalOutline(topic, dimensionSearchResults[])

- **行号**: L960-L1100+
- **调用者**: report-synthesis 阶段前
- **业务用途**: 跨维度协调大纲（多维度 outline 整合）
- **控制流伪码**:
  - STEP 1: 维度结果聚合：`evidenceSummary ≤ 1200 chars`, `figuresSummary ≤ 300 chars`
  - STEP 2: 重试 `MAX_RETRIES=3`，`RETRY_DELAY_MS=2000`（线性 2s \* attempt）
  - STEP 3: `failedModelIdsGlobal` 追踪
  - STEP 4: 不重试：积分不足、上下文过长
- **LLM Prompt**: `GLOBAL_OUTLINE_PROMPT` (reasoning model)

---

## 5.2 · leader-agent-selection.service.ts（419 行，1 个 public method）

### method: selectAgentForTask(topicId, missionId, taskTitle, taskDescription?)

- **行号**: L39-L271
- **调用者**: ResearchTodoService（用户新增 task 时）
- **业务用途**: 为用户请求的任务选择合适的 Agent（复用或新建）
- **控制流伪码**:
  - STEP 1: `prisma.researchMission.findUnique(include:{tasks where:{assignedAgentType:"dimension_researcher"}})`
  - STEP 2: 统计工作负载 `agentWorkload[agentId] = taskCount`
  - STEP 3: **决策**：
    - IF `agentWorkload.size > 0`: 选 **minLoad agent**（复用策略）
    - ELSE: 创建新 agent `researcher_user_${timestamp}`
  - STEP 4: 模型选择：`chatFacade.getAvailableModelsExtended()` 过滤 `isAvailable !== false` + 剔除 reasoning
  - STEP 5: 调用 `selectSkillsAndToolsForTask(taskTitle, taskDescription)`:
    - 关键词分类：**政策法规** / **市场分析** / **技术研究** / **数据分析** / **战略综合** / **评估审核**
    - 映射到 `skills[]` 和 `tools[]`
    - 去重，**skills ≤ 5, tools ≤ 3**
    - **默认**：`skills=[deep-dive, synthesis, data-interpretation]`, `tools=[web-search]`
  - STEP 6: `recordDecision(missionId, LeaderDecisionType.ADJUST, ...)`
- **Prisma 读写**:
  - READ: researchMission.findUnique(include:{tasks})
  - CREATE: leaderDecision
- **LLM**: **无**（纯规则驱动）
- **业务不变量**:
  - 有现成 agent 时**必须复用最低负载**的
  - skills ≤ 5, tools ≤ 3（硬上限）

---

## 5.3 · leader-review.service.ts（368 行，3 个 public methods）

### method: reviewTaskResult(missionId, taskId, result, dimensionName?)

- **行号**: L38-L140
- **调用者**: ReviewDimensionExecutor
- **业务用途**: Leader 审核任务结果
- **期望输出**: `{ status: "approved"|"needs_revision"|"rejected", feedback, suggestions, revisionInstructions }`
- **LLM Prompt**: `LEADER_REVIEW_PROMPT` (reasoning model, `taskProfile={creativity:low}`)
- **业务不变量**:
  - 解析失败 → 默认 `approved`（**保守策略**：不阻塞流水线）

### method: extractClaims(sectionId, sectionContent)

- **行号**: L142-L229
- **调用者**: V5 L3 深度研究分支
- **业务用途**: 从 section 内容提取断言（claim）
- **输入截断**: sectionContent → 4000 chars
- **LLM Prompt**: `CLAIM_EXTRACTION_PROMPT` (CHAT_FAST)
- **输出 schema**: `[{ id, statement, sectionId, sourceEvidenceIndices, importance }]`
- **业务不变量**:
  - 异常 → 返回 `[]`（不阻塞）

### method: verifyHypotheses(hypotheses[], evidenceSummary)

- **行号**: L231-L367
- **调用者**: V5 L3 深度研究分支
- **业务用途**: 假设验证
- **输入截断**: evidenceSummary → 6000 chars
- **LLM Prompt**: `HYPOTHESIS_VERIFICATION_PROMPT` (CHAT_FAST)
- **输出 schema**: `{ status: "supported"|"refuted"|"partially_supported"|"inconclusive", supportingEvidence, contradictingEvidence, confidence, refinedStatement }`
- **业务不变量**:
  - 异常 → 返回 `[]`

---

## 5.4 · leader-intent.service.ts（1102 行，2 个 public methods）

### method: handleUserMessage(topicId, missionId, userMessage) · **最复杂**

- **行号**: L77-L575
- **调用者**: WebSocket gateway / LeaderChatService
- **业务用途**: 响应用户实时消息（可能触发 mission 动态调整）
- **控制流伪码**:
  - STEP 1: `sanitize(userMessage)`
  - STEP 2: `eventEmitter.saveUserMessage(...)` 持久化对话
  - STEP 3: `agentFacade.intentDetector.detectIntent(message)` → `{ intent, confidence }`
  - STEP 4: 获取 mission 状态（含 dimensions + tasks）
  - STEP 5: **高置信度快速路径** (`confidence ≥ 0.75`):
    - `handleQuickIntent(...)` 纯规则响应（**不调用推理模型**）
    - `recordDecision(..., action:"quick_response")`
    - `emitLeaderResponse(...)`
    - return
  - STEP 6: **复杂意图**：调推理模型
  - STEP 7: Prompt 替换 `LEADER_INTERVENE_PROMPT`: {topic, progress, stage, completedDimensions, inProgressDimensions, dimensionList, userMessage}
  - STEP 8: LLM (`taskProfile={creativity:medium, outputLength:medium, reasoningDepth:moderate}`)
  - STEP 9: 响应解析: `{ understanding, actions[], response, planAdjustments }`
  - STEP 10: **Action 执行**:
    - case `CREATE_DIMENSION`:
      - `leaderToolService.createDimension({topicId, name, description})`
      - if 成功 && dimensionId:
        - CREATE `ResearchTask(type:"dimension_research", status:PENDING)`
        - `Mission.totalTasks++`
        - UPDATE `quality_review.dependencies` 追加新 task.id
        - UPDATE `quality_review + report_synthesis` → PENDING（重置）
        - UPDATE `Mission` `status=EXECUTING, progressPercent=0, completedAt=null`
        - emit `emitResumeMissionExecution(missionId, topicId)`
  - STEP 11: `emitLeaderResponse(topicId, missionId, response)`
  - STEP 12: return `{ response, actionResults }`
- **Prisma 读写**:
  - READ: researchMission
  - CREATE / UPDATE: researchTask
  - UPDATE: researchMission
- **事件**: saveUserMessage, emitLeaderResponse, emitResumeMissionExecution
- **LLM Prompt**: `LEADER_INTERVENE_PROMPT`
- **业务不变量**:
  - **快速路径不变量**: `confidence ≥ 0.75` 不调推理模型
  - **新维度依赖不变量**: `CREATE_DIMENSION` 后新 task 必须追加到 `quality_review.dependencies`
  - **下游重置不变量**: 新维度创建后 `quality_review + report_synthesis` 必须重置 PENDING

### method: decodeUserInput(topicId, userMessage, missionId?)

- **行号**: L576-L1102
- **业务用途**: 投影 4 种决策类型
- **决策枚举**: `DIRECT_ANSWER` / `CREATE_TODO` / `CLARIFY` / `ACKNOWLEDGE`
- **控制流**: 快速检测（跳过项目配置问题）→ `buildProjectContext(topicId, missionId)` 注入 skills/tools/team/knowledge bases → 复杂情况调推理模型
- **LLM Prompt**: `LEADER_DECODE_PROMPT`

---

## 5.5 · research-leader.service.ts（488 行，11 methods · 薄门面）

### 委托方法（10 个）—— pass-through 到 specialist service:

| method                   | 委托到                      |
| ------------------------ | --------------------------- |
| `getReasoningModel()`    | LeaderPlanningService       |
| `planResearch()`         | LeaderPlanningService       |
| `planDimensionOutline()` | LeaderPlanningService       |
| `planGlobalOutline()`    | LeaderPlanningService       |
| `handleUserMessage()`    | LeaderIntentService         |
| `decodeUserInput()`      | LeaderIntentService         |
| `selectAgentForTask()`   | LeaderAgentSelectionService |
| `reviewTaskResult()`     | LeaderReviewService         |
| `extractClaims()`        | LeaderReviewService         |
| `verifyHypotheses()`     | LeaderReviewService         |

### 本地实现（2 个）:

### method: getDecisionHistory(missionId)

- **行号**: L252-L268
- **业务用途**: 查询 leaderDecision 历史
- **Prisma**: READ `leaderDecision.findMany({ where:{missionId}, orderBy:{createdAt:desc} })`

### method: integrateDimensionResults(dimensionSectionResults[], topic, dimensionName)

- **行号**: L269-L401
- **调用者**: DimensionResearchExecutor
- **业务用途**: 整合 dimension 的多个 section 为最终内容（维度级报告片段）
- **控制流伪码**:
  - **单章节快速路径**: `sanitizeSectionOutput()` + `extractKeyFindingsFromContent()`
  - **多章节整合**:
    - Markdown 格式化：第一节若以 `> **核心判断**：` 开头，**提升到 ### 标题之前**
    - `fullContent = sanitizeSectionOutput(sectionsContent)`
    - AI 提取摘要 + keyFindings（对 8000 字 fullContent）
    - 仅用于**元数据提取**，不重写正文
    - 失败 → fallback `extractKeyFindingsFromContent()`
- **返回**: `{ content, metadata: { summary, keyFindings, confidenceLevel }, evidenceUsed, totalWords }`
- **LLM**: 动态构造（研究元分析），仅提取摘要 + 关键发现
- **业务不变量**:
  - **核心判断提升不变量**: 维度第一节的核心判断必须提升到 ### 标题之前（"开篇即结论"）
  - 不重写正文，只元数据提取

---

## 关键业务不变量总表

1. **modelId 反解不变量** · `leader-planning.service`
   LLM 返回的 displayName 必须经 `modelNameToIdMap` 还原为真实 modelId

2. **skill 过滤不变量** · `leader-planning.service`
   `invalidSkills`（`VALID_SKILLS` 白名单外）必须过滤后才存 `assignment.skills`

3. **modelId 轮询不变量** · `leader-planning.service`
   无 `modelId` 的 agent 必须轮询 `availableModels[modelIndex % length]`

4. **框架技能前置不变量** · `leader-planning.service`
   `resolveFrameworkSkills(topic.type)` 必须前置到 `assignment.skills`

5. **研究员能力不变量** · `leader-planning.service`
   研究员 assignment 必须有 `skills + tools + assignmentReason`

6. **快速路径不变量** · `leader-intent.service`
   intentDetector 高置信度（`confidence ≥ 0.75`）不调推理模型

7. **新维度依赖不变量** · `leader-intent.service`
   `CREATE_DIMENSION` 成功后，新 task 必须追加到 `quality_review.dependencies`

8. **下游重置不变量** · `leader-intent.service`
   新维度创建后 `quality_review + report_synthesis` 必须 `status=PENDING`

9. **不重试不变量** · `leader-planning.service`
   积分不足 / 上下文过长 → 直接抛 exception，**不重试**

10. **核心判断提升不变量** · `research-leader.integrateDimensionResults`
    维度第一节核心判断必须提升到 `###` 标题之前

11. **审核保守不变量** · `leader-review.reviewTaskResult`
    LLM 审核解析失败 → 默认 `approved`（不阻塞流水线）

12. **agent 复用不变量** · `leader-agent-selection.selectAgentForTask`
    有现成 agent 时必须复用**最低负载**的

---

## Prompt 常量索引

| 常量                              | 文件                                     | 用途                    |
| --------------------------------- | ---------------------------------------- | ----------------------- |
| `LEADER_PLAN_PROMPT`              | `prompts/research-leader.prompt`         | 全局规划                |
| `LEADER_INTERVENE_PROMPT`         | `prompts/research-leader.prompt`         | 用户消息干预            |
| `LEADER_DECODE_PROMPT`            | `prompts/research-leader.prompt`         | 用户输入解码            |
| `LEADER_REVIEW_PROMPT`            | `prompts/research-leader.prompt`         | 任务审核                |
| `DIMENSION_OUTLINE_PROMPT`        | `prompts/research-leader.prompt`         | 维度大纲规划            |
| `GLOBAL_OUTLINE_PROMPT`           | `prompts/research-leader.prompt`         | 全局大纲协调            |
| `CLAIM_EXTRACTION_PROMPT`         | `prompts/research-depth.prompt`          | 断言提取                |
| `HYPOTHESIS_VERIFICATION_PROMPT`  | `prompts/research-depth.prompt`          | 假设验证                |
| `VALID_SKILLS`                    | `leader-planning.service.ts` (const Set) | skill 白名单            |
| `DEBATE_SKILLS_BY_TOPIC_TYPE`     | `config/framework-skills.config`         | 质量审核员 debate skill |
| `RECOMMENDED_DEPTH_BY_TOPIC_TYPE` | `config/framework-skills.config`         | 推荐深度                |

---

## 统计

| Service                           | LOC      | public methods             |
| --------------------------------- | -------- | -------------------------- |
| leader-planning.service.ts        | 1394     | 4                          |
| leader-agent-selection.service.ts | 419      | 1                          |
| leader-review.service.ts          | 368      | 3                          |
| leader-intent.service.ts          | 1102     | 2                          |
| research-leader.service.ts        | 488      | 11 (10 delegate + 2 local) |
| **总计**                          | **3771** | **21**                     |
