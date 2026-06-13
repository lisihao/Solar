# AI Engine 架构设计：Skills 替代编码

## 设计目标

**核心问题**：如何让 SKILL.md 文档替代代码，实现 **配置驱动的 AI 能力编排**？

**目标架构**：基于 **多Agent + LLM + Skills + Tools** 的框架，让领域专家通过编写 SKILL.md 文件（而非代码）来定义 AI 能力。

---

## 1. 架构全景图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AI Apps 层（应用入口）                            │
│  ┌─────────────┬─────────────┬──────────────┬──────────────┐            │
│  │ AI Studio   │ AI Teams    │ AI Office    │ AI Ask       │            │
│  │ (深度研究)  │ (辩论碰撞)  │ (Slides/Doc) │ (智能问答)   │            │
│  └─────────────┴─────────────┴──────────────┴──────────────┘            │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                    Facade 层（统一入口 - 1489 LOC）                      │
│  ├─ chat() / chatWithSkills()     ─→ LLM 能力                          │
│  ├─ executeAgent()                ─→ Agent 执行                         │
│  ├─ executeTool()                 ─→ Tool 执行                          │
│  ├─ startTeamMission()            ─→ Team 协作                          │
│  └─ storeMemory() / buildContext() ─→ 记忆/上下文                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                        核心能力层（4 大系统）                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │   LLM 系统      │    │  Agent 系统     │    │  Teams 系统     │     │
│  │  (4925 LOC)     │    │                 │    │                 │     │
│  ├─────────────────┤    ├─────────────────┤    ├─────────────────┤     │
│  │ AiChatService   │    │ IAgent 接口     │    │ ITeam 接口      │     │
│  │ TaskProfileMap  │←──→│ BaseAgent       │←──→│ ITeamMember     │     │
│  │ ModelFallback   │    │ ReactiveAgent   │    │ IWorkflow (DAG) │     │
│  │ LLMFactory      │    │ PlanBasedAgent  │    │ MissionOrch.    │     │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘     │
│           ↑                     ↑                      ↑               │
│           │                     │                      │               │
│           ↓                     ↓                      ↓               │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │  Skills 系统    │    │  Tools 系统     │    │ Orchestration   │     │
│  ├─────────────────┤    ├─────────────────┤    ├─────────────────┤     │
│  │ ISkill (7 层)   │    │ ITool (46 个)   │    │ CircuitBreaker  │     │
│  │ SkillLoader     │←──→│ ToolRegistry    │    │ AgentExecutor   │     │
│  │ SkillRegistry   │    │ ToolPipeline    │    │ OutputReviewer  │     │
│  │ PromptBuilder   │    │ FunctionCalling │    │ TaskDecomposer  │     │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                        基础设施层（外部依赖）                             │
│  ├─ Database (Prisma + PostgreSQL)  ├─ Vector DB (Embedding)           │
│  ├─ LiteLLM Provider               ├─ Neo4j (Knowledge Graph)          │
│  └─ MongoDB (Content Storage)       └─ MCP Client (External Tools)     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 问题诊断汇总

### 2.1 P0 - 严重问题（需立即修复）

| #   | 问题                      | 位置                                         | 影响               | 建议                                                         |
| --- | ------------------------- | -------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| 1   | **AiChatService 过大**    | `llm/services/ai-chat.service.ts` (4925 LOC) | 难以维护、测试困难 | 拆分为 ChatCore + StreamHandler + TokenCounter + CostTracker |
| 2   | **Facade 职责过多**       | `facade/ai-engine.facade.ts` (1489 LOC)      | 单点瓶颈、耦合严重 | 拆分为 ChatFacade + AgentFacade + ToolFacade                 |
| 3   | **Skills 依赖链管理缺失** | `mission-orchestrator.ts`                    | 技能输出丢失/覆盖  | 实现依赖图验证 + 显式输出传递                                |
| 4   | **熔断器逻辑重复**        | CircuitBreaker + AgentExecutor               | 行为不一致         | 统一使用 CircuitBreakerService                               |

### 2.2 P1 - 重要问题（短期内修复）

| #   | 问题                   | 位置                       | 影响           | 建议                             |
| --- | ---------------------- | -------------------------- | -------------- | -------------------------------- |
| 5   | **返工循环无收敛**     | `executeStepWithRework()`  | 可能无限循环   | 添加进度检测、分数趋势分析       |
| 6   | **Token 预算估算粗糙** | `estimateTokens()`         | 预算控制不精确 | 使用分块估算 + tiktoken 精确计数 |
| 7   | **接口文件过大**       | `interfaces.ts` (1071 LOC) | 难以维护       | 按功能域拆分接口                 |
| 8   | **错误处理不统一**     | 全项目                     | 调试困难       | 统一 AIEngineException 体系      |

### 2.3 P2 - 优化建议（中期改进）

| #   | 问题                        | 位置                          | 影响           | 建议                        |
| --- | --------------------------- | ----------------------------- | -------------- | --------------------------- |
| 9   | **Leader 决策不智能**       | `plan()` / `review()`         | 硬编码规则     | 基于历史数据 + LLM 增强决策 |
| 10  | **Tool 热注册不支持**       | `ToolRegistry`                | 运行时无法扩展 | 实现动态注册/注销           |
| 11  | **内存系统无 TTL**          | `ShortTermMemoryService`      | 内存泄漏风险   | 实现自动清理机制            |
| 12  | **Function Calling 不完整** | `tool.toFunctionDefinition()` | 限制 LLM 能力  | 支持 Parallel Tool Calling  |

---

## 3. 核心系统详细诊断

### 3.1 Skills 系统

**架构概览**:

```
Skills = Tools 的高级组合 + 业务领域逻辑

7 层架构:
├─ understanding (理解层)  ─→ 意图分析、内容分析
├─ planning (规划层)      ─→ 大纲规划、叙事规划
├─ design (设计层)        ─→ 页面设计、布局选择
├─ content (内容层)       ─→ 内容生成、压缩
├─ rendering (渲染层)     ─→ 模板渲染、图表渲染
├─ optimization (优化层)  ─→ 布局优化、节奏控制
└─ quality (质量层)       ─→ 质量审核、场景推导
```

**关键问题**:

1. **依赖图未验证**: 技能 A → B → C 的依赖链无编译期检查
2. **输出 Key 可能冲突**: 规范化后仍可能产生碰撞
3. **SKILL.md 解析耦合**: Frontmatter 格式变化难以维护

**改进方案**:

```typescript
// 1. 启动时验证依赖图
validateSkillDependencies(registry: SkillRegistry): DependencyGraph {
  const graph = buildDependencyGraph(registry.getAll());
  const cycles = detectCircularDependencies(graph);
  if (cycles.length > 0) {
    throw new SkillDependencyCycleError(cycles);
  }
  return graph;
}

// 2. 输出 Key 命名空间隔离
outputKey: `${domain}:${skillId}:${outputKey}`  // e.g., "slides:outline-planning:plan"
```

### 3.2 Tools 系统

**架构概览**:

```
Tools = 原子操作，支持 Function Calling

46 个内置工具，分 8 类:
├─ information (6)  ─→ web-search, rag-search, database-query
├─ generation (6)   ─→ text-generation, image-generation
├─ processing (7)   ─→ data-analysis, file-conversion
├─ execution (6)    ─→ python-executor, shell-executor
├─ integration (7)  ─→ github-integration, email-sender
├─ memory (5)       ─→ short-term-memory, knowledge-base
├─ export (4)       ─→ export-pptx, export-docx, export-pdf
└─ collaboration (6) ─→ agent-handoff, human-approval
```

**关键问题**:

1. **Function Calling 支持不完整**: 不支持 Parallel Tool Calling
2. **中间件顺序管理手动**: 优先级冲突风险
3. **超时默认值固定**: 不同工具需求不同

**改进方案**:

```typescript
// 1. 支持并行工具调用
interface ParallelToolCall {
  calls: ToolCall[];
  strategy: "all" | "race" | "allSettled";
}

// 2. 工具级超时配置
interface ITool {
  defaultTimeout?: number; // 覆盖全局默认
  maxTimeout?: number; // 最大允许超时
}
```

### 3.3 Agent 系统

**架构概览**:

```
两种 Agent 模式:

1. ReactiveAgent (ReAct 循环)
   ├─ 输入 → LLM 推理 → 工具调用 → 结果 → 循环
   └─ 适用: 研究、代码生成、交互式任务

2. PlanBasedAgent (计划先行)
   ├─ 输入 → 生成计划 → 流式执行 → 预览
   └─ 适用: Slides 生成、长流程任务
```

**关键问题**:

1. **Agent 间通信协议不统一**: 不同实现差异大
2. **执行上下文信息不足**: 无法追踪完整调用链深度

**改进方案**:

```typescript
// 统一 Agent 消息协议
interface AgentMessage {
  type: "request" | "response" | "event";
  fromAgent: string;
  toAgent?: string;
  payload: unknown;
  traceId: string; // 追踪 ID
  depth: number; // 调用深度
}
```

### 3.4 Teams 系统

**架构概览**:

```
MissionOrchestrator (5 阶段流程):

Phase 1: Parse    ─→ 意图解析 (LLM)
Phase 2: Plan     ─→ 生成 DAG 执行计划
Phase 3: Execute  ─→ Leader 委派 → Members 执行 Skills → LLM 综合
Phase 4: Review   ─→ 质量审核 + 返工循环
Phase 5: Deliver  ─→ 生成交付物
```

**关键问题**:

1. **Leader 决策硬编码**: 任务分配规则固定
2. **约束评估不精确**: 成本/时间预估偏差大
3. **并行执行约束检查不足**: 可能并发竞争

**改进方案**:

```typescript
// 基于历史数据的智能分配
interface MemberPerformance {
  memberId: string;
  passRate: number;
  avgScore: number;
  skillProficiency: Map<SkillId, number>;
}

async assignTask(task: SubTask, candidates: ITeamMember[]) {
  const scores = candidates.map(m =>
    this.calculateAssignmentScore(task, m, this.performanceDB.get(m.id))
  );
  return candidates[scores.indexOf(Math.max(...scores))];
}
```

---

## 4. Skills 替代编码：详细设计方案

### 4.1 当前状态分析

| 场景        | 当前实现         | 是否需要代码          | 替代可能性 |
| ----------- | ---------------- | --------------------- | ---------- |
| 创意写作    | SKILL.md (100%)  | ❌ 不需要             | ✅ 已实现  |
| Slides 生成 | .skill.ts (100%) | ✅ 需要（结构化输出） | ⚠️ 可优化  |
| 数据分析    | 混合             | ✅ 需要（工具调用）   | ✅ 可替代  |
| 深度研究    | 混合             | ⚠️ 部分需要           | ✅ 可替代  |

**核心洞察**: 当前需要代码的场景主要是因为：

1. 需要调用外部工具（API、数据库）
2. 需要结构化输出（JSON Schema）
3. 需要多步骤编排（工作流）

**解决方案**: 让 SKILL.md 声明这些需求，由运行时自动处理。

---

### 4.2 目标架构：配置驱动的 AI 能力编排

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     SKILL.md（声明层 - 无代码）                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Frontmatter (YAML)                                              │   │
│  │  - 元数据: name, domain, taskTypes, priority                    │   │
│  │  - 工具声明: tools[] + 参数约束                                  │   │
│  │  - 输出声明: outputSchema (JSON Schema)                         │   │
│  │  - 工作流声明: workflow[] (步骤定义)                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Content (Markdown)                                              │   │
│  │  - 领域知识、行为约束、Few-shot 示例                            │   │
│  │  - 注入 System Prompt                                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓ SkillLoader 解析
┌─────────────────────────────────────────────────────────────────────────┐
│                     SkillRuntime（运行时 - 自动执行）                     │
│  ├─ 1. 解析 Frontmatter → 提取工具/输出/工作流声明                     │
│  ├─ 2. 注册 Tools → Function Calling 定义自动生成                      │
│  ├─ 3. 构建 Prompt → Content + 工具说明 + 输出约束                     │
│  ├─ 4. 执行工作流 → 按 workflow[] 步骤依次/并行执行                    │
│  └─ 5. 验证输出 → 根据 outputSchema 校验                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓ LLM + Function Calling
┌─────────────────────────────────────────────────────────────────────────┐
│                     Tools 层（原子能力 - 代码实现）                       │
│  ├─ 通用工具: web-search, database-query, file-read, http-request     │
│  ├─ 领域工具: slides-render, chart-generate, citation-format          │
│  └─ MCP 扩展: 外部服务集成                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 4.3 增强版 SKILL.md 格式规范

````yaml
# slides-outline.skill.md
---
# ==================== 基础元数据 ====================
name: slides-outline-planning
version: "1.0.0"
domain: office
taskTypes: [slides-generation, presentation-planning]
priority: 100
enabled: true
tokenBudget: 2000

# ==================== 工具声明（新增） ====================
tools:
  - id: web-search
    description: "搜索网络获取最新资料"
    required: false                    # 可选工具
    constraints:
      maxResults: 10                   # 参数约束
      domains: ["wikipedia.org", "*.edu"]

  - id: knowledge-base-query
    description: "查询内部知识库"
    required: true                     # 必需工具

  - id: image-search
    description: "搜索配图"
    required: false
    constraints:
      license: ["creative-commons", "public-domain"]

# ==================== 输出声明（新增） ====================
output:
  format: json                         # json | markdown | structured
  schema:                              # JSON Schema 定义
    type: object
    required: [title, sections]
    properties:
      title:
        type: string
        description: "演示文稿标题"
      sections:
        type: array
        items:
          type: object
          properties:
            heading: { type: string }
            bullets: { type: array, items: { type: string } }
            speakerNotes: { type: string }
      estimatedSlides:
        type: integer
        minimum: 5
        maximum: 30

# ==================== 工作流声明（新增） ====================
workflow:
  mode: sequential                     # sequential | parallel | dag
  steps:
    - id: research
      description: "收集背景资料"
      tools: [web-search, knowledge-base-query]
      output: researchResults

    - id: outline
      description: "生成大纲结构"
      input: [researchResults]
      output: outlineStructure

    - id: enrich
      description: "丰富内容细节"
      input: [outlineStructure]
      tools: [image-search]
      output: enrichedOutline
      parallel: true                   # 可并行执行

# ==================== 质量要求（新增） ====================
quality:
  minScore: 0.8                        # 最低质量分数
  reviewCriteria:
    - "结构清晰，逻辑连贯"
    - "每页要点不超过5条"
    - "包含视觉元素建议"
  autoRetry: true                      # 不达标自动重试
  maxRetries: 2
---

# Slides 大纲规划技能

## 角色定义
你是一位专业的演示文稿策划专家，擅长将复杂主题转化为清晰、有说服力的演示结构。

## 工作原则
1. **受众优先**: 始终考虑目标受众的背景和需求
2. **金字塔原则**: 先结论后论据，层层递进
3. **视觉思维**: 每页幻灯片都应有明确的视觉焦点

## 大纲结构要求
- 开场（1-2页）: 吸引注意力，明确主题
- 主体（60-70%）: 核心论点，每点配证据
- 收尾（1-2页）: 总结要点，行动号召

## Few-shot 示例

### 输入
主题: "2024年人工智能发展趋势"
受众: 企业高管
时长: 20分钟

### 输出
```json
{
  "title": "2024 AI 趋势：企业决策者必知",
  "sections": [
    {
      "heading": "开场：AI 已从实验走向生产",
      "bullets": ["全球AI市场规模突破5000亿", "67%企业已部署AI应用"],
      "speakerNotes": "用数据震撼开场，建立紧迫感"
    },
    {
      "heading": "趋势一：生成式AI重塑内容生产",
      "bullets": ["文本/图像/视频生成", "企业应用场景"],
      "speakerNotes": "展示实际案例，如营销内容自动化"
    }
  ],
  "estimatedSlides": 12
}
````

````

---

### 4.4 运行时执行机制设计

#### 4.4.1 SkillRuntime 核心接口

```typescript
/**
 * Skill 运行时 - 基于 SKILL.md 声明自动执行
 */
interface ISkillRuntime {
  /**
   * 执行 Skill（自动处理工具调用和工作流）
   */
  execute(
    skillId: string,
    input: SkillInput,
    context: SkillContext,
  ): Promise<SkillExecutionResult>;
}

interface SkillInput {
  userMessage: string;              // 用户输入
  variables?: Record<string, any>;  // 上下文变量
}

interface SkillExecutionResult {
  success: boolean;
  output: unknown;                  // 符合 outputSchema 的结果
  toolCalls: ToolCallRecord[];      // 工具调用记录
  workflowTrace: WorkflowStep[];    // 工作流执行轨迹
  qualityScore?: number;            // 质量评分
  retryCount: number;               // 重试次数
}
````

#### 4.4.2 执行流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SkillRuntime.execute() 执行流程                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. LOAD SKILL                                                          │
│     SkillLoader.getSkillById(skillId)                                   │
│     ├─ 解析 SKILL.md Frontmatter                                        │
│     ├─ 提取 tools[], output.schema, workflow[]                         │
│     └─ 返回 SkillMdDefinition                                           │
│                                                                         │
│  2. PREPARE TOOLS                                                       │
│     ToolRegistry.getTools(skill.tools.map(t => t.id))                  │
│     ├─ 过滤 required: true 的必需工具                                   │
│     ├─ 应用 constraints（参数约束）                                      │
│     └─ 生成 Function Definitions for LLM                               │
│                                                                         │
│  3. BUILD PROMPT                                                        │
│     SkillPromptBuilder.buildWithTools()                                 │
│     ├─ System Prompt = skill.content + 工具使用说明                     │
│     ├─ 注入 output.schema 作为输出约束                                  │
│     └─ 添加 workflow 步骤说明（如有）                                   │
│                                                                         │
│  4. EXECUTE WORKFLOW                                                    │
│     WorkflowExecutor.run(skill.workflow, context)                       │
│     ├─ sequential: 依次执行每个 step                                    │
│     ├─ parallel: Promise.all() 并行执行                                 │
│     └─ dag: 拓扑排序后执行                                              │
│                                                                         │
│     For each step:                                                      │
│       a. LLM.chat() with Function Calling enabled                       │
│       b. If tool_call → ToolExecutor.execute()                         │
│       c. Loop until LLM returns final response                          │
│       d. Store step.output for next step                                │
│                                                                         │
│  5. VALIDATE OUTPUT                                                     │
│     OutputValidator.validate(result, skill.output.schema)              │
│     ├─ JSON Schema 校验                                                 │
│     └─ 失败则触发 autoRetry                                             │
│                                                                         │
│  6. QUALITY CHECK                                                       │
│     QualityReviewer.evaluate(result, skill.quality.reviewCriteria)     │
│     ├─ 计算 qualityScore                                                │
│     └─ score < minScore → retry                                        │
│                                                                         │
│  7. RETURN RESULT                                                       │
│     └─ SkillExecutionResult                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 4.4.3 关键组件

| 组件                 | 职责               | 是否需要新建               |
| -------------------- | ------------------ | -------------------------- |
| `SkillLoader`        | 加载解析 SKILL.md  | ⚠️ 需增强（支持新字段）    |
| `ToolRegistry`       | 工具注册和查找     | ✅ 已有                    |
| `SkillPromptBuilder` | 构建 System Prompt | ⚠️ 需增强（支持工具注入）  |
| `WorkflowExecutor`   | 工作流编排执行     | 🆕 新建                    |
| `OutputValidator`    | JSON Schema 校验   | 🆕 新建                    |
| `QualityReviewer`    | 质量评估           | ⚠️ 需增强（支持 criteria） |
| `SkillRuntime`       | 统一执行入口       | 🆕 新建                    |

---

### 4.5 Slides 场景改造示例

**当前方案**（需要代码）:

```typescript
// slides/skills/outline-planning.skill.ts
export class OutlinePlanningSkill implements ISkill<...> {
  async execute(input, context) {
    // 硬编码的执行逻辑
    const research = await this.webSearch(input.topic);
    const outline = await this.llm.chat({ ... });
    return { outline };
  }
}
```

**目标方案**（纯配置）:

```yaml
# slides/skills/outline-planning.skill.md
---
tools:
  - id: web-search
    required: false
workflow:
  steps:
    - id: research
      tools: [web-search]
    - id: outline
      input: [research]
output:
  schema: { ... }
---
# 大纲规划技能
(领域知识和行为约束)
```

**调用方式不变**:

```typescript
// AI App 层代码（无需修改）
const result = await aiEngine.executeSkill("outline-planning", {
  userMessage: "制作一个关于AI趋势的PPT",
});
```

---

### 4.6 动态 Skills 生成：Leader 定义工作方法

#### 4.6.0 核心理念

**静态 Skills 的局限**：预定义的 SKILL.md 无法适应所有任务场景，每个新场景都需要人工编写新的 Skill。

**动态 Skills 的愿景**：让 Leader Agent 根据具体任务动态生成 Skills，然后分发给成员 Agent 执行。

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     动态 Skills 生成架构                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  用户任务                                                                │
│     ↓                                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Leader Agent（规划者）                                          │   │
│  │  ├─ 分析任务需求                                                 │   │
│  │  ├─ 设计工作方法（动态生成 Skills）                              │   │
│  │  ├─ 分配 Skills 给成员 Agent                                     │   │
│  │  └─ 协调执行、整合结果                                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│     ↓ 动态生成的 Skills                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Skills Pool（共享技能池）                                        │   │
│  │  ├─ 静态 Skills（预定义的 SKILL.md）                             │   │
│  │  └─ 动态 Skills（Leader 生成的临时技能）                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│     ↓ 分发执行                                                          │
│  ┌───────────────┬───────────────┬───────────────┐                     │
│  │ Member A      │ Member B      │ Member C      │                     │
│  │ (执行 Skill 1)│ (执行 Skill 2)│ (执行 Skill 3)│                     │
│  └───────────────┴───────────────┴───────────────┘                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 4.6.0.1 Leader 生成 Skills 的流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 1: 任务分析                                                       │
│  └─ Leader 理解用户任务，识别子任务和依赖关系                            │
├─────────────────────────────────────────────────────────────────────────┤
│  Phase 2: 技能设计（动态生成 Skills）                                     │
│  └─ Leader 为每个子任务设计工作方法，输出 Skill 定义：                    │
│     {                                                                   │
│       "id": "task-123-research",                                        │
│       "name": "市场调研",                                               │
│       "tools": ["web-search", "data-analysis"],                         │
│       "instructions": "搜索最新市场数据，分析趋势...",                    │
│       "outputSchema": { ... },                                          │
│       "constraints": { "maxTime": "5min", "sources": 3 }                │
│     }                                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Phase 3: 技能分发                                                       │
│  └─ Leader 将生成的 Skills 分配给最合适的成员 Agent                      │
├─────────────────────────────────────────────────────────────────────────┤
│  Phase 4: 共享执行                                                       │
│  └─ 所有成员 Agent 可访问 Skills Pool，按需执行分配的技能                │
├─────────────────────────────────────────────────────────────────────────┤
│  Phase 5: 结果整合                                                       │
│  └─ Leader 收集各成员输出，整合为最终交付物                              │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 4.6.0.2 动态 Skill 的数据结构

```typescript
/**
 * 动态生成的 Skill（由 Leader Agent 创建）
 */
interface DynamicSkill {
  /** 唯一标识（包含任务 ID 前缀） */
  id: string; // e.g., "task-abc123-research-skill"

  /** 技能名称 */
  name: string;

  /** 技能描述/指令（注入成员 Agent 的 System Prompt） */
  instructions: string;

  /** 声明需要的工具 */
  tools: ToolDeclaration[];

  /** 输出格式约束 */
  outputSchema?: JSONSchema;

  /** 执行约束 */
  constraints?: {
    maxTime?: string; // 最大执行时间
    maxTokens?: number; // Token 预算
    requiredSources?: number; // 需要的数据源数量
  };

  /** 生命周期 */
  lifecycle: "task-scoped" | "session-scoped" | "persistent";

  /** 创建者 */
  createdBy: "leader" | "static";

  /** 依赖的其他 Skills */
  dependencies?: string[];
}

/**
 * Skills Pool - 共享技能池
 */
interface SkillsPool {
  /** 静态 Skills（从 SKILL.md 加载） */
  staticSkills: Map<string, SkillMdDefinition>;

  /** 动态 Skills（Leader 生成） */
  dynamicSkills: Map<string, DynamicSkill>;

  /** 根据任务获取可用技能 */
  getSkillsForTask(taskId: string): Skill[];

  /** Leader 注册新技能 */
  registerDynamicSkill(skill: DynamicSkill): void;

  /** 任务完成后清理临时技能 */
  cleanupTaskSkills(taskId: string): void;
}
```

#### 4.6.0.3 Leader Agent 的 Skill 生成 Prompt

````markdown
## 你的角色

你是 Team Leader，负责分析任务并设计工作方法。

## 可用工具

你可以使用以下工具来辅助成员完成任务：

- web-search: 网络搜索
- database-query: 数据库查询
- text-generation: 文本生成
- data-analysis: 数据分析
- ...

## 任务

用户任务: {{userTask}}

## 输出要求

请分析任务，设计 1-5 个子技能，每个技能需要包含：

```json
{
  "skills": [
    {
      "id": "skill-1",
      "name": "技能名称",
      "assignTo": "member-role",  // researcher / writer / analyst
      "tools": ["tool-1", "tool-2"],
      "instructions": "详细的执行指令...",
      "outputSchema": { "type": "object", ... },
      "dependencies": []  // 依赖的其他技能 ID
    }
  ],
  "executionOrder": ["skill-1", "skill-2"],  // 执行顺序
  "parallelGroups": [["skill-2", "skill-3"]]  // 可并行的技能组
}
```
````

```

#### 4.6.0.4 静态 vs 动态 Skills 的协同

```

┌─────────────────────────────────────────────────────────────────────────┐
│ Skills 来源 │
├─────────────────────────────────────────────────────────────────────────┤
│ │
│ 静态 Skills（SKILL.md） │
│ ├─ 来源: 预先编写的文件 │
│ ├─ 特点: 稳定、可复用、经过测试 │
│ ├─ 适用: 通用场景、高频任务 │
│ └─ 示例: 市场研究模板、PPT 大纲规划、学术写作规范 │
│ │
│ 动态 Skills（Leader 生成） │
│ ├─ 来源: Leader Agent 根据任务生成 │
│ ├─ 特点: 灵活、任务特定、一次性 │
│ ├─ 适用: 新场景、定制需求、复杂组合 │
│ └─ 示例: "为 XX 公司写一份竞品分析，需要关注 A、B、C 三个维度" │
│ │
│ 协同策略: │
│ ├─ Leader 优先匹配静态 Skills │
│ ├─ 静态不满足时，动态生成补充 Skills │
│ └─ 高频动态 Skills 可固化为静态 Skills │
│ │
└─────────────────────────────────────────────────────────────────────────┘

````

#### 4.6.0.5 技能共享与复用

```typescript
/**
 * 成员 Agent 执行分配的 Skill
 */
async function executeMemberTask(
  member: ITeamMember,
  skill: DynamicSkill,
  context: TaskContext,
): Promise<SkillResult> {
  // 1. 从 Skills Pool 获取技能定义
  const skillDef = skillsPool.getSkill(skill.id);

  // 2. 准备工具
  const tools = toolRegistry.getTools(skillDef.tools);

  // 3. 构建 System Prompt（注入 skill.instructions）
  const systemPrompt = `
    你的任务: ${skillDef.name}

    ${skillDef.instructions}

    输出格式: ${JSON.stringify(skillDef.outputSchema)}
  `;

  // 4. 执行 LLM 调用（带 Function Calling）
  const result = await llm.chat({
    systemPrompt,
    tools: tools.map(t => t.toFunctionDefinition()),
    ...context,
  });

  // 5. 验证输出
  const validated = outputValidator.validate(result, skillDef.outputSchema);

  // 6. 存入共享上下文（供其他成员使用）
  context.sharedOutputs[skill.id] = validated;

  return validated;
}
````

---

### 4.7 Skills + Tools 替代编码：深度分析框架

#### 4.7.1 核心公式

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   业务特性 = 领域模型(Code) + 原子工具(Tools) + 业务意图(Skills)         │
│                                                                         │
│   Code:   底层性能、安全、原子能力实现（造砖块）                          │
│   Tools:  能力的标准化封装（把砖块变成预制件）                            │
│   Skills: 业务逻辑的组装和交付（用预制件盖房子）                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 4.7.2 可完全替代的业务特性（声明式业务）

对于逻辑标准、流程清晰、以数据流转为主的业务特性，Skills + Tools 几乎可以完全取代编码：

| 业务类型     | 示例                 | 替代方式                       | 优势                      |
| ------------ | -------------------- | ------------------------------ | ------------------------- |
| **流程编排** | 审批流、订单状态流转 | Skill 定义规则 + Tool 调用 API | 无需复杂 if-else 或状态机 |
| **数据报表** | 销售分析、用户画像   | Skill 调用查询 Tool + LLM 分析 | 零代码数据分析            |
| **标准集成** | 第三方支付、消息通知 | 预封装 Tool 插件式组合         | 配置即集成                |
| **内容生成** | 营销文案、研究报告   | Skill 注入领域知识             | 纯 Prompt 工程            |

#### 4.7.3 开发范式转变：从 How 到 What

```
传统模式（命令式 - How）
┌─────────────────────────────────────────────────────────────────────────┐
│  程序员告诉计算机每一步怎么走                                            │
│                                                                         │
│  if (user.balance > price) {                                            │
│    updateDatabase();                                                    │
│    sendNotification();                                                  │
│  }                                                                      │
└─────────────────────────────────────────────────────────────────────────┘

新模式（意图驱动 - What）
┌─────────────────────────────────────────────────────────────────────────┐
│  业务人员/开发者定义"目标"和"约束"                                       │
│                                                                         │
│  SKILL.md:                                                              │
│    "当用户余额充足时完成购买并通知用户"                                   │
│                                                                         │
│  tools: [CheckBalance, UpdateDB, NotifyUser]                            │
│                                                                         │
│  → 业务代码变成配置化的 DSL 或自然语言描述                               │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 4.7.4 代码的"最后堡垒"（不可替代场景）

| 场景              | 原因                               | 示例                               |
| ----------------- | ---------------------------------- | ---------------------------------- |
| **高性能/高并发** | Skill 推理 + Tool 通用调用开销太大 | 秒杀系统库存扣减（毫秒级延迟敏感） |
| **复杂边缘情况**  | 自然语言描述容易产生歧义/幻觉      | 互斥业务规则、"潜规则"处理         |
| **工具本身开发**  | Tool 是代码实现的                  | 新算法、特殊协议、私有硬件接口     |
| **深度交互 UI**   | 前端极致体验需代码精雕细琢         | 3D 画布、复杂拖拽编辑器            |
| **安全敏感逻辑**  | 代码的确定性是安全保障             | 加密、权限校验、合规审计           |

#### 4.7.5 架构分层视角

```
┌─────────────────────────────────────────────────────────────────────────┐
│  应用层（Application Layer）                                             │
│  └─ Skills 主导（80%+ 可声明化）                                         │
│     业务特性、用户场景、内容生成                                          │
├─────────────────────────────────────────────────────────────────────────┤
│  能力层（Capability Layer）                                              │
│  └─ Tools 主导（标准化封装）                                              │
│     数据访问、外部集成、算法调用                                          │
├─────────────────────────────────────────────────────────────────────────┤
│  平台层（Platform Layer）                                                │
│  └─ Code 主导（唯一真理）                                                 │
│     性能优化、安全机制、核心算法、Tool 实现                               │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 4.7.6 结论

**Skills + Tools 正在实现从"编写代码"向"定义逻辑"的范式转移**：

- ✅ **80% 常规业务编码** → 可被 Skills + Tools 替代
- ❌ **20% 核心逻辑** → 仍需代码支撑（平台层 + 新 Tool 开发）

**在 GenesisPod 中的应用**：

- AI Writing、AI Research → 高度声明化（Skills 主导）
- AI Office (Slides/Doc) → 中度声明化（需结构化输出 Tool）
- AI Engine 核心 → 代码主导（性能、安全、LLM 调用）

---

## 5. 实现路线图：Skills 替代编码

### Phase 1: 基础增强（Week 1-2）

**目标**: 增强 SKILL.md 解析能力，支持新的声明字段

| 任务                        | 描述                                                          | 涉及文件                  |
| --------------------------- | ------------------------------------------------------------- | ------------------------- |
| 扩展 SkillMdDefinition 类型 | 添加 `tools[]`, `output.schema`, `workflow[]`, `quality` 字段 | `skill-md.types.ts`       |
| 增强 Frontmatter 解析       | 支持解析新的 YAML 字段                                        | `skill-parser.ts`         |
| 更新 SkillLoader            | 加载时验证新字段的合法性                                      | `skill-loader.service.ts` |
| 编写测试用例                | 验证新格式 SKILL.md 解析正确                                  | `skill-loader.spec.ts`    |

**验收标准**: 能正确解析包含 `tools`, `output`, `workflow` 的 SKILL.md 文件

### Phase 2: 工具集成（Week 3-4）

**目标**: 实现 SKILL.md 中声明的 Tools 自动注入 LLM 调用

| 任务                  | 描述                                            | 涉及文件                          |
| --------------------- | ----------------------------------------------- | --------------------------------- |
| SkillToolBinder       | 根据 skill.tools[] 从 ToolRegistry 获取工具定义 | 🆕 `skill-tool-binder.service.ts` |
| 增强 PromptBuilder    | 将工具使用说明注入 System Prompt                | `skill-prompt-builder.service.ts` |
| Function Calling 集成 | 将 tools[] 转换为 LLM function definitions      | `ai-chat.service.ts`              |
| 约束应用              | 实现 tools[].constraints 的参数约束             | `skill-tool-binder.service.ts`    |

**验收标准**:

```typescript
// SKILL.md 声明 tools: [web-search]
// → LLM 调用自动带上 web-search 的 function definition
// → LLM 返回 tool_call 时自动执行
```

### Phase 3: 工作流执行（Week 5-6）

**目标**: 实现 workflow 声明的自动编排执行

| 任务             | 描述                             | 涉及文件                          |
| ---------------- | -------------------------------- | --------------------------------- |
| WorkflowExecutor | 解析 workflow[] 并按模式执行     | 🆕 `workflow-executor.service.ts` |
| 步骤状态管理     | 管理 step.output 在步骤间传递    | `workflow-executor.service.ts`    |
| 并行执行支持     | 实现 `parallel: true` 的并发执行 | `workflow-executor.service.ts`    |
| DAG 拓扑排序     | 支持 `mode: dag` 的依赖图执行    | `workflow-executor.service.ts`    |

**验收标准**:

```yaml
workflow:
  steps:
    - id: research
      tools: [web-search]
      output: researchResults
    - id: outline
      input: [researchResults]
# → 自动按顺序执行，researchResults 传递给 outline 步骤
```

### Phase 4: 输出验证（Week 7）

**目标**: 实现 output.schema 的 JSON Schema 校验

| 任务            | 描述                              | 涉及文件                          |
| --------------- | --------------------------------- | --------------------------------- |
| OutputValidator | 使用 Ajv 进行 JSON Schema 校验    | 🆕 `output-validator.service.ts`  |
| 输出约束注入    | 将 schema 作为输出约束注入 Prompt | `skill-prompt-builder.service.ts` |
| 校验失败重试    | 不符合 schema 时触发 autoRetry    | `skill-runtime.service.ts`        |

**验收标准**: LLM 输出必须符合声明的 JSON Schema，否则自动重试

### Phase 5: 质量保障（Week 8）

**目标**: 实现 quality 声明的自动评估和重试

| 任务                 | 描述                            | 涉及文件                      |
| -------------------- | ------------------------------- | ----------------------------- |
| 增强 QualityReviewer | 支持 reviewCriteria[] 评估      | `quality-reviewer.service.ts` |
| 质量分数计算         | 基于 criteria 计算 qualityScore | `quality-reviewer.service.ts` |
| 自动重试机制         | score < minScore 时重试         | `skill-runtime.service.ts`    |

### Phase 6: 统一运行时（Week 9-10）

**目标**: 实现 SkillRuntime 统一执行入口

| 任务         | 描述                                | 涉及文件                      |
| ------------ | ----------------------------------- | ----------------------------- |
| SkillRuntime | 整合所有组件的统一执行入口          | 🆕 `skill-runtime.service.ts` |
| Facade 集成  | 添加 `aiEngine.executeSkill()` 方法 | `ai-engine.facade.ts`         |
| 迁移示例     | 将一个 .skill.ts 迁移为 .skill.md   | `writing/skills/`             |
| 性能测试     | 对比 .skill.ts vs .skill.md 性能    | `benchmark/`                  |

**验收标准**:

```typescript
// 调用方式统一
const result = await aiEngine.executeSkill("market-research", {
  userMessage: "分析 2024 年 AI 市场趋势",
});
// 无论底层是 .skill.ts 还是 .skill.md，接口一致
```

### Phase 7: 动态 Skills 生成（Week 11-13）

**目标**: 实现 Leader Agent 动态生成 Skills 的能力

| 任务                     | 描述                                      | 涉及文件                                |
| ------------------------ | ----------------------------------------- | --------------------------------------- |
| SkillsPool               | 实现共享技能池（静态 + 动态）             | 🆕 `skills-pool.service.ts`             |
| DynamicSkillGenerator    | Leader 生成 Skills 的核心逻辑             | 🆕 `dynamic-skill-generator.service.ts` |
| Leader Prompt 模板       | 设计 Leader 生成 Skills 的 Prompt         | 🆕 `leader-skill-design.prompt.md`      |
| MissionOrchestrator 集成 | 在 Plan 阶段调用 DynamicSkillGenerator    | `mission-orchestrator.ts`               |
| Skill 生命周期管理       | task-scoped / session-scoped / persistent | `skills-pool.service.ts`                |

**验收标准**:

```typescript
// Leader 根据任务动态生成 Skills
const mission = await aiEngine.startTeamMission({
  task: "为腾讯写一份 AI 战略分析报告",
  team: researchTeam,
});

// Leader 自动生成并分配 Skills:
// - skill-1: 竞品调研（assignTo: researcher）
// - skill-2: 数据分析（assignTo: analyst）
// - skill-3: 报告撰写（assignTo: writer）
```

### Phase 8: Skills 共享与复用（Week 14-15）

**目标**: 成员 Agent 间共享 Skills 和执行结果

| 任务           | 描述                            | 涉及文件                          |
| -------------- | ------------------------------- | --------------------------------- |
| SharedContext  | 成员间共享执行结果              | 🆕 `shared-context.service.ts`    |
| Skill 依赖执行 | 按 dependencies[] 顺序执行      | `workflow-executor.service.ts`    |
| 并行执行优化   | 识别可并行的 Skills 组          | `workflow-executor.service.ts`    |
| Skill 固化机制 | 高频动态 Skills → 静态 SKILL.md | 🆕 `skill-persistence.service.ts` |

**验收标准**:

```typescript
// Member A 执行 skill-1，结果存入 SharedContext
// Member B 执行 skill-2 时可引用 skill-1 的输出
// 高频使用的动态 Skill 可一键保存为 SKILL.md
```

### Phase 9: 渐进式迁移（Week 16-18）

**目标**: 将现有 .skill.ts 迁移为 .skill.md + 动态生成

| 模块          | 当前 Skills     | 迁移策略      | 优先级 |
| ------------- | --------------- | ------------- | ------ |
| Writing       | 9 个 SKILL.md   | ✅ 已完成     | -      |
| Research      | 混合            | 动态生成为主  | P1     |
| Office/Slides | 16 个 .skill.ts | 静态 SKILL.md | P2     |
| Office/Doc    | 待开发          | 动态生成      | P1     |

---

### 里程碑总览

```
Week 1-2:   基础增强 → SKILL.md 新格式解析 ✓
Week 3-4:   工具集成 → Tools 自动注入 LLM ✓
Week 5-6:   工作流执行 → workflow 自动编排 ✓
Week 7:     输出验证 → JSON Schema 校验 ✓
Week 8:     质量保障 → 自动评估重试 ✓
Week 9-10:  统一运行时 → SkillRuntime 上线 ✓
Week 11-13: 动态 Skills → Leader 生成能力 ✓
Week 14-15: Skills 共享 → 成员间复用 ✓
Week 16-18: 渐进迁移 → .skill.ts → .skill.md ✓
```

**最终效果**:

1. 领域专家通过编写 SKILL.md 文件即可定义 AI 能力（静态）
2. Leader Agent 根据任务动态生成 Skills（动态）
3. 成员 Agent 共享 Skills 和执行结果（协作）
4. 高频动态 Skills 可固化为静态 SKILL.md（复用）

---

## 6. 关键文件路径

### AI Engine 核心

- `backend/src/modules/ai-engine/facade/ai-engine.facade.ts` (1489 LOC)
- `backend/src/modules/ai-engine/llm/services/ai-chat.service.ts` (4925 LOC)
- `backend/src/modules/ai-engine/ai-engine.module.ts`

### Skills 系统

- `backend/src/modules/ai-engine/skills/abstractions/skill.interface.ts`
- `backend/src/modules/ai-engine/skills/loader/skill-loader.service.ts`
- `backend/src/modules/ai-engine/skills/registry/skill.registry.ts`
- `backend/src/modules/ai-engine/skills/builder/skill-prompt-builder.service.ts`

### Tools 系统

- `backend/src/modules/ai-engine/tools/abstractions/tool.interface.ts`
- `backend/src/modules/ai-engine/tools/registry/tool.registry.ts`
- `backend/src/modules/ai-engine/tools/middleware/tool-pipeline.ts`

### Agent/Teams 系统

- `backend/src/modules/ai-engine/agents/abstractions/agent.interface.ts`
- `backend/src/modules/ai-engine/teams/abstractions/team.interface.ts`
- `backend/src/modules/ai-engine/teams/orchestration/mission-orchestrator.ts`

### Orchestration 系统

- `backend/src/modules/ai-engine/orchestration/services/circuit-breaker.service.ts`
- `backend/src/modules/ai-engine/orchestration/services/agent-executor.service.ts`
- `backend/src/modules/ai-engine/orchestration/interfaces.ts` (1071 LOC)

---

## 7. 验证方法

### 7.1 架构健康检查

```bash
# 检查文件大小（标记超过 1000 LOC 的文件）
find backend/src -name "*.ts" -exec wc -l {} + | sort -rn | head -20

# 检查循环依赖
npx madge --circular backend/src/modules/ai-engine

# 运行类型检查
npm run type-check
```

### 7.2 功能验证

```bash
# 运行 AI Engine 单元测试
npm run test -- --testPathPattern=ai-engine

# 验证 Skills 加载日志
npm run dev:backend
# 观察: [Skills] ✅ Loaded X local Skills

# 验证 chatWithSkills 完整链路
# 观察: [Skills] 🚀 chatWithSkills START → ... → ✅ COMPLETE
```

---

## 8. 总结

### 设计愿景

**让 Skills 成为 AI 能力的"源代码"**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   静态 Skills（SKILL.md）        +        动态 Skills（Leader 生成）     │
│   ─────────────────────                  ─────────────────────          │
│   领域专家预定义                          Leader Agent 按任务生成         │
│   通用、稳定、可复用                      灵活、任务特定、一次性          │
│                                                                         │
│                        ↓ 统一存入 Skills Pool ↓                         │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  成员 Agent 共享执行，结果相互引用                                │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 核心创新

| 创新点            | 描述                            | 价值                    |
| ----------------- | ------------------------------- | ----------------------- |
| **Tools 声明**    | SKILL.md 中声明需要的工具       | Function Calling 自动化 |
| **Output Schema** | JSON Schema 定义输出格式        | 结构化输出保证          |
| **Workflow**      | 声明式工作流编排                | 复杂流程无需代码        |
| **Quality**       | 内置质量评估和重试              | 输出质量保障            |
| **动态生成**      | Leader Agent 按任务设计 Skills  | 无限场景适应            |
| **Skills 共享**   | 成员间共享技能和结果            | 协作效率最大化          |
| **固化机制**      | 高频动态 Skills → 静态 SKILL.md | 知识沉淀复用            |

### 范式转变

```
传统模式:
  程序员编写业务代码 (How) → 每个场景都要写代码

新范式:
  静态场景: 专家编写 SKILL.md (What) → 平台自动执行
  动态场景: Leader Agent 设计 Skills → 成员 Agent 执行 → 结果共享
```

### 预期效果

- **80% 业务特性**: Skills 配置实现（静态 + 动态）
- **开发效率**: 从"写代码"到"定义意图"
- **协作模式**: Leader 设计 + 成员执行 + 结果共享
- **知识沉淀**: 动态 Skills 固化为静态资产

### 关键依赖

1. **现有 Tools 生态**: 需要足够丰富的原子工具
2. **Function Calling**: LLM 可靠的工具调用能力
3. **JSON Schema**: 输出格式的标准化约束
4. **Leader LLM 能力**: 能设计出合理的 Skills 分解

### 风险与缓解

| 风险                        | 缓解措施                           |
| --------------------------- | ---------------------------------- |
| LLM 幻觉导致工具误用        | 严格的 Tool 参数约束 + 输出校验    |
| 复杂工作流难以调试          | 完整的 workflowTrace 日志          |
| 性能开销增加                | 缓存 + 批处理优化                  |
| Leader 设计的 Skills 不合理 | 预设 Skill 模板 + 人工审核机制     |
| 动态 Skills 质量不稳定      | 质量评分 + 自动重试 + 固化优秀模板 |

### 架构全景

```
用户任务
   ↓
Leader Agent
   ├─ 分析任务 → 匹配静态 Skills / 动态生成 Skills
   ├─ 分配 Skills → 指定执行者 + 依赖关系
   └─ 协调整合 → 收集结果 + 生成交付物
   ↓
Skills Pool（静态 + 动态）
   ↓
成员 Agent 并行/串行执行
   ├─ 注入 Skill 指令 → System Prompt
   ├─ 调用 Tools → Function Calling
   ├─ 验证输出 → JSON Schema
   └─ 共享结果 → SharedContext
   ↓
最终交付物
```

---

_设计完成时间: 2026-01-18_
_版本: 3.0 - Skills 替代编码 + 动态生成架构设计_
