# GenesisPod 2026 演进路线图：从 AI Feature 平台到 AI Agent OS

**Date**: 2026-02-22
**Version**: v1.0
**Status**: Active
**Author**: Claude Code

---

## 执行摘要

GenesisPod 当前以"功能型 AI 平台"形态运营：用户需要主动在 Research、Teams、Writing、Office 等模块间切换，每次切换意味着上下文清零和记忆断裂。这是 2024 年前 AI 产品的标准范式，但随着 Agent 技术成熟，这一范式正在被快速淘汰。

2026 年的战略转型目标是：将 Genesis 从"AI Feature 集合"重新定位为 **AI Agent OS**——一个以意图理解为核心、跨模块自主编排、支持协议互操作的 AI 操作系统。用户描述目标，系统自动选择工具、规划路径、调用能力、汇报结果。

本路线图基于现有架构的实际实现（`AIEngineFacade`、`ToolRegistry`、`DagExecutorService`、`TraceCollectorService` 等）制定，遵循"扩展而非替换"原则，分四个季度将六大支柱落地。核心目标：Agent 自主完成率 >60%、跨模块任务无缝衔接、AI 调用成本降低 60-70%。

---

## 一、定位与标杆

### 1.1 当前定位

Genesis 目前处于"AI Feature Platform"阶段：

- 用户主动选择功能入口（Research / Ask / Writing / Teams）
- 各模块独立运行，记忆不互通
- UI 以功能导航为核心，而非意图为核心
- 对外是封闭系统，无协议互操作
- 所有任务走同一模型，无成本路由

目标阶段是"AI Agent OS"：Agent 感知用户意图，自主跨模块编排，对外通过 MCP/A2A 开放，对内通过统一记忆层共享知识。

### 1.2 标杆对比

| 维度             | Genesis (当前)     | Genesis (目标)        | Perplexity         | Cursor                | Devin              | NotebookLM     |
| ---------------- | ------------------ | --------------------- | ------------------ | --------------------- | ------------------ | -------------- |
| **核心范式**     | 功能切换           | 意图编排              | 问答搜索           | 代码辅助              | 自主软件工程       | 知识伴侣       |
| **Agent 自主度** | 低（需手动选模块） | 高（跨模块自动规划）  | 中（Copilot 模式） | 高（SWE-bench 80.9%） | 极高（端到端编码） | 低（被动问答） |
| **协议互操作**   | 无                 | MCP Server + A2A      | 无公开 MCP         | MCP Client            | 专有 API           | 无             |
| **跨模块记忆**   | 无（各模块孤岛）   | 四层统一记忆架构      | 线程记忆           | 工作区记忆            | 项目级持久记忆     | 笔记本范围     |
| **实时多模态**   | 文本为主           | 图片/PDF/音频统一处理 | 图片搜索           | 图片/代码             | 截图/终端          | PDF 上传       |
| **工具生态**     | 内部 30+ 工具      | MCP 市场 + A2A 生态   | 有限插件           | 扩展市场              | 专有工具链         | Google 生态    |
| **UX 范式**      | 功能型导航         | 意图驱动对话          | 搜索框中心         | IDE 集成              | 任务面板           | Notebook       |
| **定价参照**     | —                  | —                     | Pro $20/月         | Pro $20/月            | $500/月起          | 免费（Google） |

> Cursor SWE-bench 数据来源：Cursor 官方博客 2025-Q4 报告；LangSmith 评估平台定价 $49/月起（Developer 计划，2026-01）。

### 1.3 战略转型目标

```
现在：用户 → 选模块 → 手动操作 → 得到结果
2026Q4：用户 → 描述意图 → GenesisAgent 自动规划执行 → 可解释结果
```

三个核心转变：

1. **输入范式**：从"导航到功能"到"描述意图"
2. **执行范式**：从"单模块执行"到"跨模块 Agent 编排"
3. **生态范式**：从"封闭平台"到"协议互操作节点"

---

## 二、架构演进全景

### 2.1 三层架构升级

**当前架构（As-Is）：**

```
┌─────────────────────────────────────────────────────┐
│                   用户界面层                          │
│  [Research] [Ask] [Writing] [Teams] [Office] [...]   │
│   各模块独立入口，功能型导航，手动切换                   │
└────────────────────┬────────────────────────────────┘
                     │ 点击进入
┌────────────────────▼────────────────────────────────┐
│                 AI App 应用层                         │
│  Research(40+服务) | Writing | Office | Teams | Ask  │
│  各自调用 AIEngineFacade，记忆互不相通                  │
└────────────────────┬────────────────────────────────┘
                     │ AIEngineFacade (统一入口)
┌────────────────────▼────────────────────────────────┐
│                AI Engine 核心层                       │
│  LLM | ToolRegistry(30+) | SkillRegistry | Teams    │
│  TraceCollector | ModelFallback | MCP Client        │
└─────────────────────────────────────────────────────┘
```

**目标架构（To-Be）：**

```
┌─────────────────────────────────────────────────────┐
│                意图驱动界面层                          │
│  [Global AI Bar - Cmd+K 任意唤起]                    │
│  [Agent 执行 Timeline] [知识图谱 OS] [Eval Dashboard] │
│   能力搜索 + AI 推荐，多模态输入，Human-in-the-Loop     │
└────────────────────┬────────────────────────────────┘
                     │ 意图输入
┌────────────────────▼────────────────────────────────┐
│             GenesisAgent 编排层 (NEW)                 │
│  IntentRouter → TaskPlanner → DagExecutorService    │
│  MemoryCoordinator (四层记忆) | EvalPipeline         │
│  IntelligentModelRouter (Cost-Aware)                │
└────────────────────┬────────────────────────────────┘
                     │ 能力调用
┌────────────────────▼────────────────────────────────┐
│           AI Engine 核心层 (扩展)                     │
│  AIEngineFacade | ToolRegistry | SkillRegistry      │
│  TeamRegistry + DagExecutorService                  │
│  TraceCollector + EvalPipeline (NEW)                │
│  MCP Server (NEW) | A2A Gateway (NEW)               │
└────────────────────┬────────────────────────────────┘
                     │ 对外协议
┌────────────────────▼────────────────────────────────┐
│              协议互操作层 (NEW)                        │
│  MCP Server: genesis/research, genesis/write 等     │
│  A2A: /.well-known/agent.json + ITeamMember 适配    │
│  REST API: 现有端点，增加 streaming 支持               │
└─────────────────────────────────────────────────────┘
```

### 2.2 现有优势杠杆点

| 现有能力                                        | 杠杆化方向                                              |
| ----------------------------------------------- | ------------------------------------------------------- |
| `AIEngineFacade`（50+ 方法统一入口）            | GenesisAgent 编排层的直接调用目标，无需改造             |
| `ToolRegistry.getToolFunctionDefinitions()`     | 直接映射 MCP Tool Schema，MCP Server 零成本构建工具列表 |
| `DagExecutorService`（DAG 编排引擎）            | IntentRouter 拆解意图后的执行后端，支持并行任务分支     |
| `TraceCollectorService`（AgentTrace/AgentSpan） | EvalPipeline 的数据源，已有执行链路数据，只差质量判断层 |
| `MCPServerConfig` Prisma model                  | MCP 服务注册表，Admin 管理界面基础已存在                |
| `ModelFallbackService`（智能降级链）            | IntelligentModelRouter 的执行后端，扩展复杂度感知维度   |
| `TeamRegistry` + `ITeamMember` 接口             | `A2ATeamMemberAdapter` 无缝接入，外部 Agent 即团队成员  |
| Knowledge Graph 前后端框架                      | 统一记忆架构的图谱层，扩展为可对话的 Memory OS          |
| `SkillRegistry` + SkillsMP Client               | 技能发现层，辅助 IntentRouter 能力匹配                  |

### 2.3 不做什么（防止范围蔓延）

- 不替换现有 AI App 模块入口（Research/Writing 等页面保留，作为 Agent 的执行后端）
- 不重写 `DagExecutorService`（在其之上加编排层，不动核心）
- 不自建向量数据库（继续使用现有 pgvector + RAG 基础设施）
- 不做实时语音交互（当前阶段专注文本 + 图片/PDF）
- 不替换 LiteLLM 路由层（`IntelligentModelRouter` 在其之上做任务级决策）

---

## 三、六大改进支柱

### 支柱一：协议互操作（MCP Server + A2A）

**现状与差距**

Genesis 当前是封闭生态：用户只能通过 Web UI 使用能力，外部 AI 工具（Claude Code、Cursor）无法调用 Genesis 的深度研究能力。同时，外部专业 Agent（如代码执行 Agent）无法加入 Genesis Teams 协作。

**目标**

Genesis 成为 AI 生态的能力节点：

_MCP Tool Schema 示例（基于 `ToolRegistry.getToolFunctionDefinitions()`）：_

```typescript
// ToolRegistry 已有此方法，MCP Server 直接调用
const mcpToolList = toolRegistry.getToolFunctionDefinitions();
// 输出格式自动符合 MCP Tool Schema：
// {
//   name: "genesis/research",
//   description: "Execute deep multi-step research on any topic",
//   inputSchema: {
//     type: "object",
//     properties: {
//       topic: { type: "string", description: "Research topic" },
//       depth: { type: "string", enum: ["quick", "standard", "deep"] }
//     }
//   }
// }
```

_A2A Agent Card 示例（`/.well-known/agent.json`）：_

```json
{
  "name": "Genesis Research Agent",
  "description": "Deep research and multi-agent analysis platform",
  "version": "2.0",
  "capabilities": ["streaming", "pushNotifications"],
  "skills": [
    {
      "id": "deep-research",
      "name": "Deep Research",
      "description": "Multi-step research with RAG-Fusion and source synthesis",
      "inputModes": ["text", "file"],
      "outputModes": ["text", "file"]
    },
    {
      "id": "team-debate",
      "name": "Multi-Agent Debate",
      "description": "Structured debate between specialized agents"
    }
  ],
  "defaultInputMode": "text",
  "defaultOutputMode": "text"
}
```

**实现路径**

1. `GenesisMCPServerModule` 包装现有服务，`ToolRegistry.getToolFunctionDefinitions()` 直接生成工具列表
2. 认证复用现有 BYOK API Key 基础设施
3. `A2ATeamMemberAdapter implements ITeamMember`，外部 Agent 通过 `TeamBuilder.addMember()` 接入（详见 `architecture-design.md`）
4. `/.well-known/agent.json` 端点由 `A2AController` 提供

**相关决策文档**

- [ADR-002: Genesis as MCP Server](../../decisions/002-raven-as-mcp-server.md) — 协议选择和工具列表决策
- [ADR-003: A2A Protocol Adoption](../../decisions/003-a2a-protocol-adoption.md) — Adapter 模式接入决策

**行业参照**

Claude Code 和 Cursor 均支持 MCP Client，Google A2A 协议已有 150+ 组织采纳（v0.3，2025-Q4）。

**预期效果**

- Genesis 能力可被 Claude Code、Cursor 等工具直接调用
- 外部专业 Agent 可作为 Teams 成员参与协作
- 开发者生态入口打开

---

### 支柱二：Agentic Orchestration（GenesisAgent 自主编排层）

**现状与差距**

当前用户必须手动选择 Research 或 Teams 或 Writing，三个模块之间的任务链接完全依赖用户手动操作。`DagExecutorService` 有完整的 DAG 执行能力，但缺少意图解析和跨模块规划层。

**目标**

用户输入：`"分析 OpenAI o3 发布对 AI 研究格局的影响，写一份给投资人的简报"`

GenesisAgent 自动执行：

```
意图解析 → [深度研究任务] + [写作任务]
     ↓ 并行
[Research Agent]          [Context 收集]
  - arxiv_search(o3)        - 用户历史偏好
  - web_search(市场反应)     - 已有相关笔记
  - rag_search(内部知识库)
     ↓ 汇总
[Writing Agent]
  - 调用 Writing 模块
  - 风格：投资人简报
  - 注入研究结果
     ↓
[Eval Check] → 质量达标 → 输出
             → 不达标 → 重规划
```

_IntentRouter 伪代码：_

```typescript
// backend/src/modules/ai-engine/orchestration/intent-router.service.ts
@Injectable()
export class IntentRouterService {
  async route(userIntent: string, context: AgentContext): Promise<TaskPlan> {
    // 1. 用 AiChatService 解析意图（deterministic 模式）
    const intentAnalysis = await this.aiChatService.chat({
      messages: [{ role: "system", content: INTENT_ANALYSIS_PROMPT }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "deterministic", outputLength: "short" },
    });

    // 2. 匹配能力（通过 SkillRegistry + ToolRegistry）
    const requiredCapabilities = this.matchCapabilities(intentAnalysis);

    // 3. 生成 DAG 任务计划
    return this.taskPlanner.buildDag(requiredCapabilities, context);
  }
}

// DagExecutorService 执行计划（现有服务，无需修改）
const result = await this.dagExecutorService.execute(taskPlan);
```

**行业参照**

Devin 的 Planning → Execution → Reflection 循环；OpenAI Operator 的跨应用任务编排。

**预期效果**

- 用户不再需要手动选择模块，意图识别准确率目标 >85%
- 跨模块任务自动衔接，无上下文断裂
- Agent 自主完成率（无需人工干预）目标 >60%

---

### 支柱三：统一记忆架构（Memory OS）

**现状与差距**

当前三套独立记忆系统互不相通：

```
Research 记忆    ──  各自 DB 表，互相不可见
Long-Term Memory ──  (tools/memory/long-term-memory.tool.ts)
Knowledge Graph  ──  独立图谱，无跨模块索引
```

用户在 Research 中深度研究过的领域，切换到 Ask 后系统完全不知道。

**目标（四层记忆架构）：**

```
┌─────────────────────────────────────────────────┐
│  Layer 4: 知识图谱层 (Knowledge Graph OS)         │
│  实体关系持久化，跨 session 可检索，可对话更新       │
├─────────────────────────────────────────────────┤
│  Layer 3: 长期记忆层 (Long-Term Memory)           │
│  用户偏好、领域知识、历史摘要                        │
│  (现有 long-term-memory.tool.ts 扩展)             │
├─────────────────────────────────────────────────┤
│  Layer 2: 工作记忆层 (Working Memory)             │
│  当前 Agent 任务的活跃上下文，TTL 24h              │
│  (现有 entity-memory.tool.ts 扩展)               │
├─────────────────────────────────────────────────┤
│  Layer 1: 对话记忆层 (Conversation Memory)        │
│  当前 session 消息历史，窗口管理                    │
└─────────────────────────────────────────────────┘
```

**实现路径**

```typescript
// NEW: MemoryCoordinator 统一读写接口
@Injectable()
export class MemoryCoordinatorService {
  async recall(query: MemoryQuery, userId: string): Promise<MemoryContext> {
    const [conversation, working, longTerm, graphEntities] = await Promise.all([
      this.conversationMemory.search(query, userId),
      this.workingMemory.get(query.sessionId), // entity-memory.tool
      this.longTermMemory.recall(query, userId), // long-term-memory.tool
      this.knowledgeGraphTool.query(query.entities), // knowledge-graph.tool
    ]);
    return this.mergeAndRank({
      conversation,
      working,
      longTerm,
      graphEntities,
    });
  }

  async store(event: MemoryEvent, userId: string): Promise<void> {
    // 根据事件类型写入对应层
    await this.routeToLayer(event, userId);
    // 异步更新知识图谱关系
    this.knowledgeGraphTool
      .updateRelations(event.entities)
      .catch(this.logger.error);
  }
}
```

**行业参照**

MemGPT/Letta 的层次化记忆架构；NotebookLM 的 Notebook 级知识边界。

**预期效果**

- 跨模块记忆共享：Research 积累的知识在 Ask 中可用
- 用户偏好持久化：写作风格、研究领域偏好跨 session 保持
- 知识图谱从静态展示演进为动态 Memory OS

---

### 支柱四：智能模型路由（Cost-Aware Orchestration）

**现状与差距**

当前所有任务都走相同模型选择逻辑，无论是简单分类（应该用 GPT-4o-mini）还是复杂研究报告（需要 Claude Opus）。`ModelFallbackService` 有完整的降级链逻辑，但缺少任务复杂度感知的路由前置层。

**目标（任务复杂度 → 模型选择矩阵）：**

| 任务类型             | 复杂度 | 推荐模型                   | 估算成本/千次 |
| -------------------- | ------ | -------------------------- | ------------- |
| 意图分类、标签提取   | 极简   | GPT-4o-mini / Claude Haiku | $0.15         |
| 摘要、关键点提取     | 简单   | GPT-4o-mini / Gemini Flash | $0.15-0.30    |
| 对话问答、Ask        | 中等   | GPT-4o / Claude Sonnet     | $2.50         |
| 深度研究分析、写作   | 复杂   | Claude Opus / GPT-4o       | $15.00        |
| 多 Agent 协调 Leader | 极复杂 | Claude Opus / Gemini Ultra | $15.00+       |

_ComplexityAnalyzer 伪代码：_

```typescript
@Injectable()
export class ComplexityAnalyzerService {
  analyze(task: TaskDescriptor): TaskComplexity {
    const signals = {
      tokenEstimate: this.estimateTokens(task.input), // 输入长度
      toolCount: task.requiredTools.length, // 工具数量
      agentCount: task.teamSize ?? 1, // Agent 数量
      domainDepth: task.requiresExpertDomain ? 1 : 0, // 领域专业度
      outputStructure: task.outputSchema ? "structured" : "free", // 输出格式
    };
    return this.scoreToComplexity(signals);
  }
}

// IntelligentModelRouter：在 ModelFallbackService 之前决策
const complexity = complexityAnalyzer.analyze(task);
const modelConfig = modelRouter.select(complexity, costBudget);
// 执行时仍走 ModelFallbackService 的降级链
const result = await modelFallback.executeWithFallback(modelConfig, fn);
```

**行业参照**

LiteLLM Router 的基于 RPM/TPM 的负载均衡；AWS Bedrock 的模型路由策略。

**预期效果**

- 预计降低 AI 调用成本 60-70%（简单任务从 Opus 级别降到 mini 级别）
- 复杂任务仍保证模型质量
- `CostController` 提供每用户/每组织的月度预算上限

---

### 支柱五：Eval 系统（AI 质量自动化评估）

**现状与差距**

`TraceCollectorService` 已完整记录执行链路（AgentTrace / AgentSpan，有内存 LRU + Prisma 持久化），但没有质量判断层。我们知道 Agent 执行了什么，但不知道执行得好不好。

**目标（EvalPipeline 三层架构）：**

```
TraceData（现有数据源）
  ↓
┌─────────────────────────────────────────┐
│  Layer 1: 结构化检查（同步，低成本）       │
│  - 输出格式验证（JSON Schema）            │
│  - 完整性检查（引用数量、字数范围）         │
│  - 工具调用成功率                         │
└──────────────────┬──────────────────────┘
                   ↓ 通过 → 进入 Layer 2
┌─────────────────────────────────────────┐
│  Layer 2: AI Judge（异步，中等成本）      │
│  - 用小模型（GPT-4o-mini）评分            │
│  - 维度：准确性、相关性、可读性、完整性     │
│  - 输出：1-5 分 + 改进建议               │
└──────────────────┬──────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│  Layer 3: 用户信号（被动收集）            │
│  - 点赞/踩、复制行为、编辑率              │
│  - 与 AI Judge 分数形成交叉验证           │
└─────────────────────────────────────────┘
```

_EvalPipeline 接口：_

```typescript
@Injectable()
export class EvalPipelineService {
  async evaluate(traceId: string): Promise<EvalResult> {
    const trace = await this.traceCollector.getTrace(traceId); // 现有服务

    // Layer 1: 同步结构检查
    const structuralScore = this.runStructuralChecks(trace);
    if (structuralScore.failed)
      return { score: 0, reason: structuralScore.reason };

    // Layer 2: AI Judge（异步）
    const judgeScore = await this.aiChatService.chat({
      messages: [{ role: "system", content: EVAL_JUDGE_PROMPT(trace) }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "deterministic", outputLength: "short" },
    });

    return this.mergeScores(structuralScore, judgeScore);
  }
}
```

**行业参照**

LangSmith（$49/月 Developer 计划）提供 LLM-as-Judge 评估；Braintrust 的在线 Eval 追踪。Genesis 的优势是 Eval 数据与执行 Trace 天然打通。

**预期效果**

- 低分 case 自动进入人工复查队列（Eval Dashboard）
- 为 IntelligentModelRouter 提供历史质量数据（反馈质量 → 路由决策）
- 发现系统性质量问题（特定 Agent 配置持续低分）

---

### 支柱六：多模态与 UI 原生化

**现状与差距**

当前 UI 是功能型导航：顶部/侧边栏列出模块，用户必须先选功能再描述任务。文本是唯一主要输入方式。Agent 执行过程是黑盒（用户看不到进度）。

**目标（意图驱动 UX，多模态输入）**

#### 6a. 导航从"模块选择"→"能力搜索 + AI 推荐"

```
当前侧边栏：              目标侧边栏：
┌──────────────┐          ┌──────────────────────────┐
│ Research     │          │ [搜索能力或描述任务...]     │
│ Ask          │    →     ├──────────────────────────┤
│ Writing      │          │ 最近任务                   │
│ Teams        │          │  ∙ OpenAI o3 研究报告      │
│ Office       │          │  ∙ 竞品分析 - Perplexity   │
│ ...          │          ├──────────────────────────┤
└──────────────┘          │ 推荐能力                   │
                          │  ∙ 深度研究 (基于浏览历史)   │
                          │  ∙ 报告生成                │
                          └──────────────────────────┘
```

#### 6b. Global AI Bar（统一对话入口）

```
任意页面 Cmd+K 唤起：

┌─────────────────────────────────────────────────────┐
│  [📎] 描述你的任务，或拖入文件...             [发送]   │
│                                                     │
│  快速操作：[深度研究] [写报告] [团队分析] [问答]        │
└─────────────────────────────────────────────────────┘

支持：
- 图片拖拽（截图、图表分析）
- PDF 拖拽（文档分析）
- @ 提及（@某个知识库、@某个历史报告）
- / 命令（/research、/write、/teams）
```

#### 6c. Agent 执行可视化（Human-in-the-Loop）

```
执行中（基于 TraceCollectorService 的 Span 数据实时展示）：

任务：分析 OpenAI o3 影响
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ 意图解析              ✓ 0.3s
▶ 任务规划              ✓ 0.8s
  ├─ ▶ Arxiv 搜索       ✓ 2.1s    [查看来源 ↗]
  ├─ ▶ Web 搜索         ✓ 1.9s    [查看来源 ↗]
  └─ ▶ RAG 检索         ✓ 0.7s
▶ 报告合成              ⟳ 进行中...

[暂停并修改方向]  [查看当前草稿]    预计还需 45s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### 6d. 多模态输入组件

```typescript
// 统一的多模态输入处理（前端 → 后端）
interface MultimodalInput {
  text?: string;
  files?: {
    type: "image" | "pdf" | "audio" | "document";
    url: string;
    extractedText?: string; // 后端预处理
    metadata?: Record<string, unknown>;
  }[];
  mentions?: { type: "knowledge-base" | "report" | "note"; id: string }[];
}
```

#### 6e. 知识图谱 UI：从静态展示→可对话的知识 OS

```
当前：静态图谱可视化（只读）

目标：
┌────────────────────────────────────────────────────┐
│  知识图谱                    [+ 添加实体] [对话模式]  │
├────────────────────────────────────────────────────┤
│                                                    │
│   [OpenAI] ──竞争──→ [Anthropic]                  │
│       │                    │                       │
│      发布               发布                       │
│       ↓                    ↓                       │
│    [o3 模型]          [Claude 3.5]                 │
│                                                    │
│  [对话框]: 这两个模型在代码任务上有什么差异？           │
│  [AI 回答基于图谱关系 + 长期记忆...]                  │
└────────────────────────────────────────────────────┘
```

#### 6f. Eval Dashboard（Admin）

```
/admin/ai/eval

质量趋势（7d）          低分 Case 队列
━━━━━━━━━━━━━━━━━━━━   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Research: 4.2/5 ↑      ∙ Research "量子计算" → 2.8分
Writing:  3.8/5 →        [查看 Trace] [标记问题] [重试]
Teams:    4.5/5 ↑      ∙ Writing "财报分析" → 3.1分
                         [查看 Trace] [标记问题] [重试]
```

**行业参照**

Cursor 的 Chat + Agent 双模式（意图明确时走 Agent，对话时走 Chat）；NotebookLM 的知识伴侣模式（知识边界内的深度问答）。

**预期效果**

- 新用户激活率提升：不需要学习模块功能，描述任务即可
- 多模态输入扩展使用场景（图表分析、PDF 研究）
- Agent 可视化提升用户信任度，降低"黑盒感"
- Eval Dashboard 让 Admin 可以主动发现和修复质量问题

---

## 四、实施路线图

### Q1 2026（立即启动，低风险高价值）

**目标**：协议互操作基础 + 模型路由 MVP

| 交付物                   | 涉及模块                                      | 成功指标                              |
| ------------------------ | --------------------------------------------- | ------------------------------------- |
| MCP Server 5 个核心工具  | `ai-engine/mcp/`，复用 `ToolRegistry`         | Claude Code 可调用 `genesis/research` |
| A2A Agent Card + 端点    | `ai-engine/a2a/`（现有 `a2a.module.ts` 扩展） | `/.well-known/agent.json` 可访问      |
| StreamableHttpMCPClient  | `mcp/client/mcp-client-factory.ts`            | 填补现有 `not yet implemented`        |
| ComplexityAnalyzer MVP   | `ai-engine/orchestration/`                    | 简单任务路由到 mini 模型              |
| Global AI Bar（UI 框架） | `frontend/components/ai-bar/`                 | Cmd+K 可唤起，基础对话可用            |

**关键文件**：`docs/decisions/002-raven-as-mcp-server.md`、`docs/decisions/003-a2a-protocol-adoption.md`、`docs/architecture/platform-evolution/architecture-design.md`

---

### Q2 2026（核心 Agentic 能力）

**目标**：GenesisAgent 编排层 + 统一记忆基础

| 交付物                         | 涉及模块                                           | 成功指标                          |
| ------------------------------ | -------------------------------------------------- | --------------------------------- |
| IntentRouter + TaskPlanner     | `ai-engine/orchestration/intent-router.service.ts` | 意图识别准确率 >80%（人工标注集） |
| MemoryCoordinator（Layer 2+3） | `ai-engine/memory/` 整合现有工具                   | 跨 session 用户偏好可持续         |
| EvalPipeline Layer 1+2         | `ai-engine/eval/` 基于 TraceCollector              | Research 输出自动评分上线         |
| Agent 执行 Timeline（UI）      | `frontend/components/agent-timeline/`              | 用户可实时看到 Span 进度          |
| 多模态输入组件                 | `frontend/components/multimodal-input/`            | 图片和 PDF 拖拽可用               |

---

### Q3 2026（生态与差异化）

**目标**：知识图谱 Memory OS + Eval 全覆盖

| 交付物                        | 涉及模块                                 | 成功指标                        |
| ----------------------------- | ---------------------------------------- | ------------------------------- |
| Knowledge Graph Memory OS     | 现有图谱框架 + MemoryCoordinator Layer 4 | 实体关系跨模块可查询            |
| A2ATeamMemberAdapter 完整实现 | `ai-engine/a2a/`                         | 第一个外部 A2A Agent 加入 Teams |
| Eval Dashboard（Admin）       | `/admin/ai/eval` 页面                    | 低分 Case 复查流程可用          |
| IntelligentModelRouter 完整版 | 接入 Eval 历史数据                       | 调用成本下降 >40%               |
| Human-in-the-Loop 干预        | 基于 `human-approval.tool.ts`            | Agent 执行中可暂停修改          |

---

### Q4 2026（规模化与可靠性）

**目标**：生产级 Agent OS，成本优化目标达成

| 交付物                       | 涉及模块                      | 成功指标                   |
| ---------------------------- | ----------------------------- | -------------------------- |
| CostController（预算上限）   | `ai-engine/cost/`             | 组织级月度预算超限自动降级 |
| Agent 自主完成率优化         | 基于 Q2-Q3 数据迭代           | 自主完成率 >60%            |
| MCP 工具生态扩展（10+ 工具） | 基于用户反馈扩展              | 第三方集成 >3 个           |
| 知识图谱对话模式             | 图谱 UI 可对话更新            | DAU 图谱交互次数 >100      |
| 调用成本优化达标             | ComplexityAnalyzer + 路由数据 | 成本下降 60-70% vs Q1 基线 |

---

## 五、风险与缓解

| 风险                                     | 概率 | 影响 | 缓解措施                                                                  |
| ---------------------------------------- | ---- | ---- | ------------------------------------------------------------------------- |
| MCP Server 被外部大量调用，成本失控      | 中   | 高   | API Key 级别的 Rate Limiting + CostController 预算上限，超限自动 429      |
| IntentRouter 意图误判，错误跨模块调用    | 高   | 中   | 低置信度时回退到模块选择 UI，用户确认后执行；Eval 数据驱动迭代            |
| A2A 外部 Agent 响应超时影响 Teams 执行   | 中   | 中   | A2ATeamMemberAdapter 设置 30s 超时，超时视为成员失联，Leader 重新分配任务 |
| MemoryCoordinator 增加每次请求延迟       | 中   | 中   | 记忆检索异步并行（`Promise.all`），Layer 1-2 有 TTL 缓存，目标 <200ms     |
| Eval AI Judge 成本过高（每次调用都评估） | 中   | 低   | 采样评估（默认 20% 抽样），低分触发全量评估，用小模型（mini）做 Judge     |
| 多模态输入增加数据存储和处理成本         | 低   | 中   | 文件处理后只存文本（extracted text），原始文件 24h 后删除                 |

---

## 六、成功指标（OKR 风格）

### 用户体验

| 指标                           | 当前基线 | Q2 目标  | Q4 目标 |
| ------------------------------ | -------- | -------- | ------- |
| 新用户首次成功任务完成率       | 估算 40% | 55%      | 70%     |
| 跨模块任务用户满意度（NPS）    | 无数据   | 建立基线 | NPS >40 |
| Agent 自主完成率（无人工干预） | ~0%      | 30%      | 60%     |
| 意图识别准确率                 | N/A      | >80%     | >90%    |

### 技术质量

| 指标                    | 当前基线   | Q2 目标          | Q4 目标  |
| ----------------------- | ---------- | ---------------- | -------- |
| Research 输出 Eval 均分 | 无         | 建立基线         | >4.0/5.0 |
| Agent Trace 覆盖率      | 部分       | 80%              | 95%      |
| 低分 Case（<3分）占比   | 无数据     | <20%             | <10%     |
| 平均 Agent 任务延迟     | 无统一指标 | <30s（标准任务） | <20s     |

### 生态影响

| 指标                       | 当前基线 | Q2 目标 | Q4 目标 |
| -------------------------- | -------- | ------- | ------- |
| MCP Server 外部调用次数/月 | 0        | 1,000   | 10,000  |
| A2A 外部 Agent 接入数      | 0        | 1       | 5       |
| 开发者 API Key 注册数      | 0        | 50      | 500     |

### 成本效率

| 指标                       | 当前基线    | Q2 目标       | Q4 目标                   |
| -------------------------- | ----------- | ------------- | ------------------------- |
| AI 调用成本/任务（均值）   | 基线 T      | 0.8T          | 0.3-0.4T                  |
| 简单任务使用 mini 模型比例 | ~0%         | 40%           | 70%                       |
| 月度 AI 成本增长率         | 随 MAU 线性 | 低于 MAU 增长 | MAU 增长 2x，成本增长 <1x |

---

## 七、相关文档索引

| 文档                              | 路径                                                          | 状态     |
| --------------------------------- | ------------------------------------------------------------- | -------- |
| Genesis as MCP Server 决策        | `docs/decisions/002-raven-as-mcp-server.md`                   | Proposed |
| A2A 协议采纳决策                  | `docs/decisions/003-a2a-protocol-adoption.md`                 | Proposed |
| 平台演进技术架构（As-Is / To-Be） | `docs/architecture/platform-evolution/architecture-design.md` | Draft    |
| AI 调用规范                       | `docs/guides/ai-calling-standards.md`                         | Active   |
| 开发规范总览                      | `standards/00-overview.md`                                    | Active   |
| AI 架构分层 Skill                 | `skills/ai/ai-architecture-layering/SKILL.md`                 | Active   |

---

**最后更新**: 2026-02-22
**下次评审**: 2026-03-31（Q1 结束时）
**维护者**: Claude Code
