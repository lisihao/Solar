# AI 模块整合指南

**技术实施文档**

---

## 文档信息

| 属性     | 内容                                                     |
| -------- | -------------------------------------------------------- |
| 版本     | v3.0                                                     |
| 作者     | Architecture Team                                        |
| 创建日期 | 2025-12-19                                               |
| 更新日期 | 2025-12-19                                               |
| 状态     | 已发布                                                   |
| 前置文档 | [AI-Agents 能力概览](./ai-agents-capability-overview.md) |

---

## 目录

1. [概述](#1-概述)
2. [模块现状分析](#2-模块现状分析)
3. [ai-agents 核心架构详解](#3-ai-agents-核心架构详解) ⭐ 新增
4. [整合优先级矩阵](#4-整合优先级矩阵)
5. [ai-ask 模块整合方案](#5-ai-ask-模块整合方案)
6. [ai-teams 模块整合方案](#6-ai-teams-模块整合方案)
7. [ai-office 模块整合方案](#7-ai-office-模块整合方案)
8. [ai-studio 模块整合方案](#8-ai-studio-模块整合方案)
9. [ai-simulation 模块整合方案](#9-ai-simulation-模块整合方案)
10. [ai-image 模块整合方案](#10-ai-image-模块整合方案)
11. [错误处理与最佳实践](#11-错误处理与最佳实践) ⭐ 新增
12. [整合路线图](#12-整合路线图)
13. [通用整合模式](#13-通用整合模式)
14. [附录 A: 导入路径速查](#附录-a-导入路径速查)
15. [附录 B: 检查清单](#附录-b-检查清单)
16. [附录 C: 常见问题解答](#附录-c-常见问题解答-faq) ⭐ 新增
17. [附录 D: 调试指南](#附录-d-调试指南) ⭐ 新增

---

## 1. 概述

### 1.1 目标

本文档旨在指导 GenesisPod 中各 AI 模块如何充分利用 `ai-agents` 模块提供的核心能力，实现：

- **统一的 Agent 抽象**：所有 AI 功能通过 Agent 框架统一管理
- **复用工具系统**：共享 48 种工具能力，避免重复实现
- **标准化执行流程**：统一的任务管理、流式事件、错误处理
- **可观测性增强**：统一的指标收集和监控

### 1.2 AI 模块总览

```
backend/src/modules/ai/
├── ai-agents/      # 核心基础设施（本文档的能力提供方）
├── ai-ask/         # 对话式问答
├── ai-core/        # AI 核心能力层（LLM 适配）
├── ai-image/       # 图像生成和处理
├── ai-office/      # 办公文档生成（PPT/DOCX）
├── ai-simulation/  # AI 推演和模拟
├── ai-studio/      # 研究工作室
└── ai-teams/       # 多 Agent 协作团队
```

### 1.3 整合收益

| 收益类别     | 具体收益                         |
| ------------ | -------------------------------- |
| **代码复用** | 减少 50%+ 重复代码，统一工具实现 |
| **能力增强** | 所有模块获得 48 种工具能力       |
| **可维护性** | 统一的错误处理、重试、监控       |
| **扩展性**   | 新增工具自动对所有模块可用       |
| **用户体验** | 统一的流式事件、进度报告         |

---

## 2. 模块现状分析

### 2.1 各模块 AI 能力处理方式

| 模块              | 当前方式             | 工具能力 | Agent 能力           | 记忆能力   | 整合状态  |
| ----------------- | -------------------- | -------- | -------------------- | ---------- | --------- |
| **ai-ask**        | AgentOrchestrator    | ✅ 3 种  | ✅ 已整合            | ShortTerm  | ✅ 已完成 |
| **ai-teams**      | FunctionCalling+工具 | ✅ 多种  | ✅ TeamCollaboration | 消息历史   | ✅ 已完成 |
| **ai-office**     | 多服务流水线         | ✅ 多种  | ✅ Slides/Docs       | 无         | ✅ 已完成 |
| **ai-studio**     | 松散服务组合         | ✅ 多种  | ✅ Researcher        | 项目级     | ✅ 已完成 |
| **ai-simulation** | 自定义推演引擎       | ✅ 多种  | ✅ Simulator         | 推演上下文 | ✅ 已完成 |
| **ai-image**      | 成熟流式管道         | ✅ 多种  | ✅ ImageDesigner     | 无         | ✅ 已完成 |

### 2.2 ai-agents 核心能力清单

| 能力类别       | 数量 | 说明                                                                                                                               |
| -------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **专业 Agent** | 8    | SlidesAgent, DocsAgent, DesignerAgent, DeveloperAgent, ResearcherAgent, SimulatorAgent, ImageDesignerAgent, TeamCollaborationAgent |
| **工具总数**   | 48   | 覆盖 8 大类别的完整工具生态                                                                                                        |
| **执行模式**   | 2    | 计划模式 (Plan-Based) + 自主模式 (Function Calling)                                                                                |
| **记忆系统**   | 2    | 短期记忆 + 长期记忆                                                                                                                |

**工具分类统计**：

| 类别      | 数量 | 代表工具                                                |
| --------- | ---- | ------------------------------------------------------- |
| 信息获取  | 6    | web_search, rag_search, database_query, knowledge_graph |
| 内容生成  | 6    | text_generation, image_generation, code_generation      |
| 数据处理  | 7    | data_analysis, file_conversion, file_parser             |
| 代码执行  | 6    | python_executor, javascript_executor, sql_executor      |
| 外部集成  | 6    | message_push, github_integration, email_sender          |
| 记忆管理  | 5    | short_term_memory, long_term_memory, knowledge_base     |
| 导出功能  | 4    | export_pptx, export_docx, export_pdf, export_image      |
| Agent协作 | 6    | agent_handoff, consensus_mechanism, task_delegation     |

### 2.3 整合前后对比

```
整合前:                                          整合后（当前状态）:
┌─────────────┐     ┌─────────────┐              ┌─────────────┐     ┌─────────────┐
│   ai-ask    │     │  ai-teams   │              │   ai-ask    │     │  ai-teams   │
│  ┌───────┐  │     │  ┌───────┐  │              │  ┌───────┐  │     │  ┌───────┐  │
│  │  LLM  │  │     │  │  LLM  │  │              │  │ Agent │  │     │  │  LLM  │  │
│  └───────┘  │     │  └───────┘  │              │  └───┬───┘  │     │  └───────┘  │
└─────────────┘     └─────────────┘              └──────┼──────┘     └─────────────┘
      ↓                    ↓                            │              (待整合)
  独立调用              独立调用                         ↓
  无工具能力            无工具能力              ┌─────────────────────────────────┐
                                               │          ai-agents              │
                                               │  ┌────────────────────────────┐ │
                                               │  │  AgentOrchestrator         │ │
                                               │  │  + ToolRegistry (48 tools) │ │
                                               │  │  + AgentRegistry (4 agents)│ │
                                               │  └────────────────────────────┘ │
                                               │  ┌─────┐ ┌───────┐ ┌──────────┐ │
                                               │  │LLM  │ │Memory │ │Guardrails│ │
                                               │  └─────┘ └───────┘ └──────────┘ │
                                               └─────────────────────────────────┘
```

### 2.4 模块依赖关系图

```
                    ┌──────────────────────────────────────────┐
                    │              AiAgentsModule               │
                    │  ┌────────────────────────────────────┐  │
                    │  │ AgentOrchestrator + ToolRegistry   │  │
                    │  │ + AgentRegistry + 48 Tools         │  │
                    │  │ + 4 Agents (Slides/Docs/Designer/  │  │
                    │  │              Developer)            │  │
                    │  └────────────────────────────────────┘  │
                    └──────────────────┬───────────────────────┘
                                       │ exports
           ┌───────────────────────────┼───────────────────────────┐
           ▼                           ▼                           ▼
    ┌─────────────┐            ┌─────────────┐            ┌─────────────┐
    │   ai-ask    │            │  ai-office  │            │  ai-teams   │
    │ ✅ 已整合    │            │ ⚠️ 部分整合  │            │ ⏳ 待整合   │
    │ 3 个工具    │            │ SlidesAgent │            │ 6 个协作    │
    │ TEXT_GEN    │            │ 复用        │            │ 工具可用    │
    │ WEB_SEARCH  │            │             │            │             │
    │ SHORT_MEM   │            │             │            │             │
    └─────────────┘            └─────────────┘            └─────────────┘
```

---

## 3. ai-agents 核心架构详解

### 3.1 目录结构

```
backend/src/modules/ai/ai-agents/
├── core/                           # 核心基础设施
│   ├── agent/                      # Agent 系统
│   │   ├── agent.interface.ts      # Agent 基接口定义
│   │   ├── agent.orchestrator.ts   # Agent 编排器（核心入口）
│   │   ├── agent.registry.ts       # Agent 注册中心
│   │   └── agent.types.ts          # 类型定义（ToolType, AgentType 等）
│   │
│   ├── tool/                       # 工具系统
│   │   ├── tool.interface.ts       # 工具基接口（BaseTool 抽象类）
│   │   └── tool.registry.ts        # 工具注册中心
│   │
│   ├── execution/                  # 执行引擎
│   │   ├── function-calling-executor.ts  # Function Calling 执行器
│   │   ├── execution-metrics.ts    # 执行指标收集
│   │   └── retry-strategy.ts       # 重试策略
│   │
│   ├── llm/                        # LLM 适配层
│   │   └── llm-adapter.ts          # 多模型适配器
│   │
│   ├── memory/                     # 记忆系统
│   │   ├── memory.interface.ts     # 记忆接口
│   │   ├── short-term.memory.ts    # 短期记忆（会话级）
│   │   └── long-term.memory.ts     # 长期记忆（持久化）
│   │
│   ├── mcp/                        # MCP 协议支持
│   │   ├── mcp-adapter.ts          # MCP 适配器
│   │   ├── mcp-server.ts           # MCP 服务器
│   │   ├── resources/              # 资源管理
│   │   └── transports/             # 传输层
│   │
│   ├── validation/                 # Schema 验证
│   │   └── schema-validator.ts     # JSON Schema 验证器
│   │
│   ├── guardrails/                 # 安全护栏
│   │   └── guardrails.ts           # 输入/输出过滤
│   │
│   └── errors/                     # 错误系统
│       └── tool.error.ts           # 统一错误类型
│
├── implementations/                # 4 个专业 Agent 实现
│   ├── slides/                     # PPT 生成 Agent
│   │   └── slides.agent.ts
│   ├── docs/                       # 文档生成 Agent
│   │   └── docs.agent.ts
│   ├── designer/                   # 设计生成 Agent
│   │   └── designer.agent.ts
│   └── developer/                  # 代码生成 Agent
│       └── developer.agent.ts
│
├── tools/                          # 48 个工具实现
│   ├── information/                # 信息获取 (6)
│   │   ├── web-search.tool.ts
│   │   ├── web-scraper.tool.ts
│   │   ├── data-fetch.tool.ts
│   │   ├── rag-search.tool.ts
│   │   ├── database-query.tool.ts
│   │   └── knowledge-graph.tool.ts
│   ├── generation/                 # 内容生成 (6)
│   │   ├── text-generation.tool.ts
│   │   ├── image-generation.tool.ts
│   │   ├── code-generation.tool.ts
│   │   ├── audio-generation.tool.ts
│   │   ├── video-generation.tool.ts
│   │   └── structured-output.tool.ts
│   ├── processing/                 # 数据处理 (7)
│   ├── execution/                  # 代码执行 (6)
│   ├── integration/                # 外部集成 (6)
│   ├── memory/                     # 记忆管理 (5)
│   ├── export/                     # 导出功能 (4)
│   └── collaboration/              # Agent 协作 (6)
│
├── dto/                            # 数据传输对象
├── ai-agents.module.ts             # NestJS 模块定义
├── ai-agents.service.ts            # 任务管理服务
└── ai-agents.controller.ts         # REST API 入口
```

### 3.2 核心类职责

| 类                          | 文件路径                                      | 职责                           |
| --------------------------- | --------------------------------------------- | ------------------------------ |
| **AgentOrchestrator**       | `core/agent/agent.orchestrator.ts`            | Agent 编排和执行协调，任务路由 |
| **AgentRegistry**           | `core/agent/agent.registry.ts`                | Agent 注册和获取               |
| **ToolRegistry**            | `core/tool/tool.registry.ts`                  | 工具注册和获取                 |
| **BaseTool**                | `core/tool/tool.interface.ts`                 | 工具基类，定义执行接口         |
| **FunctionCallingExecutor** | `core/execution/function-calling-executor.ts` | LLM 自主工具选择执行           |
| **LLMAdapter**              | `core/llm/llm-adapter.ts`                     | 多模型适配器                   |
| **ShortTermMemory**         | `core/memory/short-term.memory.ts`            | 会话级记忆                     |
| **LongTermMemory**          | `core/memory/long-term.memory.ts`             | 持久化记忆                     |
| **ToolError**               | `core/errors/tool.error.ts`                   | 统一错误类型                   |

### 3.3 类型系统详解

#### 3.3.1 Agent 类型 (AgentType)

```typescript
// 文件: core/agent/agent.types.ts
export enum AgentType {
  SLIDES = "SLIDES", // PPT 生成专家
  DOCS = "DOCS", // 文档生成专家
  DESIGNER = "DESIGNER", // 设计生成专家
  DEVELOPER = "DEVELOPER", // 代码生成专家
}
```

#### 3.3.2 工具类型 (ToolType) - 完整 48 种

```typescript
// 文件: core/agent/agent.types.ts
export enum ToolType {
  // ═══════════════════════════════════════════════════════════════
  // 1. 信息获取 (Information Retrieval) - 6 种
  // ═══════════════════════════════════════════════════════════════
  WEB_SEARCH = "web_search", // 网络搜索
  WEB_SCRAPER = "web_scraper", // 网页抓取
  DATA_FETCH = "data_fetch", // 数据获取
  RAG_SEARCH = "rag_search", // 向量数据库搜索
  DATABASE_QUERY = "database_query", // SQL 查询
  KNOWLEDGE_GRAPH = "knowledge_graph", // 知识图谱查询

  // ═══════════════════════════════════════════════════════════════
  // 2. 内容生成 (Content Generation) - 6 种
  // ═══════════════════════════════════════════════════════════════
  TEXT_GENERATION = "text_generation", // 文本生成
  IMAGE_GENERATION = "image_generation", // 图像生成
  CODE_GENERATION = "code_generation", // 代码生成
  AUDIO_GENERATION = "audio_generation", // 音频生成
  VIDEO_GENERATION = "video_generation", // 视频生成
  STRUCTURED_OUTPUT = "structured_output", // 结构化输出

  // ═══════════════════════════════════════════════════════════════
  // 3. 数据处理 (Data Processing) - 7 种
  // ═══════════════════════════════════════════════════════════════
  DATA_ANALYSIS = "data_analysis", // 数据分析
  FILE_CONVERSION = "file_conversion", // 格式转换
  FILE_PARSER = "file_parser", // 文件解析
  DATA_VALIDATION = "data_validation", // 数据验证
  DATA_CLEANING = "data_cleaning", // 数据清洗
  DOCUMENT_DIFF = "document_diff", // 文档对比
  TEMPLATE_RENDER = "template_render", // 模板渲染

  // ═══════════════════════════════════════════════════════════════
  // 4. 代码执行 (Code Execution) - 6 种
  // ═══════════════════════════════════════════════════════════════
  PYTHON_EXECUTOR = "python_executor", // Python 执行
  JAVASCRIPT_EXECUTOR = "javascript_executor", // JS 执行
  SQL_EXECUTOR = "sql_executor", // SQL 执行
  SHELL_EXECUTOR = "shell_executor", // Shell 执行
  CONTAINER_EXECUTOR = "container_executor", // Docker 执行
  OCR_RECOGNITION = "ocr_recognition", // OCR 识别

  // ═══════════════════════════════════════════════════════════════
  // 5. 外部集成 (External Integration) - 6 种
  // ═══════════════════════════════════════════════════════════════
  MESSAGE_PUSH = "message_push", // 消息推送
  CLOUD_STORAGE = "cloud_storage", // 云存储
  GITHUB_INTEGRATION = "github_integration", // GitHub 交互
  EMAIL_SENDER = "email_sender", // 邮件发送
  CALENDAR_INTEGRATION = "calendar_integration", // 日历管理
  WEBHOOK_TRIGGER = "webhook_trigger", // Webhook 触发

  // ═══════════════════════════════════════════════════════════════
  // 6. 记忆管理 (Memory Management) - 5 种
  // ═══════════════════════════════════════════════════════════════
  SHORT_TERM_MEMORY = "short_term_memory", // 短期记忆
  LONG_TERM_MEMORY = "long_term_memory", // 长期记忆
  ENTITY_MEMORY = "entity_memory", // 实体记忆
  KNOWLEDGE_BASE = "knowledge_base", // 知识库
  USER_PREFERENCES = "user_preferences", // 用户偏好

  // ═══════════════════════════════════════════════════════════════
  // 7. 导出 (Export) - 4 种
  // ═══════════════════════════════════════════════════════════════
  EXPORT_PPTX = "export_pptx", // PPT 导出
  EXPORT_DOCX = "export_docx", // Word 导出
  EXPORT_PDF = "export_pdf", // PDF 导出
  EXPORT_IMAGE = "export_image", // 图片导出

  // ═══════════════════════════════════════════════════════════════
  // 8. Agent 协作 (Agent Collaboration) - 6 种
  // ═══════════════════════════════════════════════════════════════
  AGENT_HANDOFF = "agent_handoff", // Agent 委派
  HUMAN_APPROVAL = "human_approval", // 人类审批
  AGENT_COMMUNICATION = "agent_communication", // Agent 通信
  TASK_DELEGATION = "task_delegation", // 任务分配
  CONSENSUS_MECHANISM = "consensus_mechanism", // 共识机制
  WORKFLOW_ORCHESTRATION = "workflow_orchestration", // 工作流
}
```

#### 3.3.3 任务状态 (AgentTaskStatus)

```typescript
export enum AgentTaskStatus {
  PENDING = "PENDING", // 等待执行
  PLANNING = "PLANNING", // 规划中
  EXECUTING = "EXECUTING", // 执行中
  COMPLETED = "COMPLETED", // 已完成
  FAILED = "FAILED", // 失败
  CANCELLED = "CANCELLED", // 已取消
}
```

#### 3.3.4 产出物类型 (ArtifactType)

```typescript
export enum ArtifactType {
  PPTX = "PPTX", // PowerPoint
  DOCX = "DOCX", // Word
  PDF = "PDF", // PDF
  IMAGE = "IMAGE", // 图片
  CODE = "CODE", // 代码
  DATA = "DATA", // 数据
}
```

### 3.4 执行流程

#### 3.4.1 两种执行模式

```
┌─────────────────────────────────────────────────────────────────┐
│                     AgentOrchestrator                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  模式 1: 计划模式 (Plan-Based)                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 用户输入 → Agent.plan() → 生成 AgentPlan → 按步骤执行    │    │
│  │           ↓                                              │    │
│  │    逐步执行 PlanStep，每步调用相应工具                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  模式 2: 自主模式 (Function Calling / ReAct)                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 系统提示 + 用户输入 → LLM → 自主选择工具 → 执行 → 循环    │    │
│  │                       ↑                    ↓              │    │
│  │                       └────── 结果反馈 ────┘              │    │
│  │ 最大迭代: 10 次 | 最大工具调用: 20 次                      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.4.2 任务生命周期

```
1. 创建任务 (PENDING)
   └─> AiAgentsService.createTask()
       └─> 保存到 officeAgentTask 表
       └─> 返回 taskId

2. 规划阶段 (PLANNING)
   └─> AgentOrchestrator.execute()
       └─> 选择合适的 Agent
       └─> Agent.plan() 生成执行计划
       └─> 发送 plan_ready 事件

3. 执行阶段 (EXECUTING)
   └─> 逐步执行 PlanStep
       └─> 如果步骤需要工具 → ToolRegistry.get()
       └─> Tool.execute() 执行工具
       └─> 发送 tool_result 事件

4. 生成产出物
   └─> Agent 生成 Artifact
       └─> 保存到 officeAgentArtifact 表
       └─> 发送 artifact 事件

5. 完成 (COMPLETED)
   └─> 发送 complete 事件
       └─> 更新任务状态
       └─> 计算耗时和 Token 使用量
```

#### 3.4.3 事件类型 (AgentEvent)

| 事件类型        | 说明         | 数据内容          |
| --------------- | ------------ | ----------------- |
| `plan_ready`    | 计划生成完成 | AgentPlan         |
| `step_start`    | 步骤开始     | stepId, stepIndex |
| `step_progress` | 步骤进度     | progress, message |
| `step_complete` | 步骤完成     | stepId, output    |
| `tool_call`     | 工具调用     | toolType, input   |
| `tool_result`   | 工具结果     | toolType, output  |
| `artifact`      | 产出物生成   | ArtifactType, url |
| `complete`      | 任务完成     | finalOutput       |
| `error`         | 错误发生     | ToolError         |

### 3.5 工具系统详解

#### 3.5.1 BaseTool 抽象类

```typescript
// 文件: core/tool/tool.interface.ts
abstract class BaseTool<TInput, TOutput> {
  // 必须实现的属性
  abstract readonly type: ToolType;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: JSONSchema;
  abstract readonly outputSchema: JSONSchema;

  // 可选属性
  readonly category?: ToolCategory;
  readonly timeout?: number; // 默认 30000ms

  // 核心方法
  async execute(
    input: TInput,
    context: ToolContext,
  ): Promise<ToolResult<TOutput>> {
    // 1. 输入验证
    // 2. 超时控制
    // 3. 执行 doExecute()
    // 4. 错误处理
    // 5. 返回结果
  }

  // 子类必须实现
  protected abstract doExecute(
    input: TInput,
    context: ToolContext,
  ): Promise<TOutput>;

  // 转换为 OpenAI Function 格式
  toFunctionDefinition(): FunctionDefinition;
}
```

#### 3.5.2 工具开发示例

```typescript
// 创建自定义工具示例
import {
  BaseTool,
  ToolType,
  JSONSchema,
  ToolContext,
  ToolResult,
} from "../core";

interface MyToolInput {
  query: string;
  maxResults?: number;
}

interface MyToolOutput {
  results: string[];
  totalCount: number;
}

export class MyCustomTool extends BaseTool<MyToolInput, MyToolOutput> {
  readonly type = ToolType.WEB_SEARCH; // 或自定义类型
  readonly name = "my_custom_tool";
  readonly description = "执行自定义搜索操作";
  readonly timeout = 30000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索查询" },
      maxResults: { type: "number", default: 10 },
    },
    required: ["query"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      results: { type: "array", items: { type: "string" } },
      totalCount: { type: "number" },
    },
  };

  protected async doExecute(
    input: MyToolInput,
    context: ToolContext,
  ): Promise<MyToolOutput> {
    // 实现工具逻辑
    const results = await this.performSearch(input.query, input.maxResults);
    return {
      results,
      totalCount: results.length,
    };
  }
}
```

---

## 4. 整合优先级矩阵

### 4.1 优先级评估维度

| 维度         | 权重 | 说明                        |
| ------------ | ---- | --------------------------- |
| **用户价值** | 40%  | 对终端用户体验的提升程度    |
| **技术难度** | 30%  | 实施复杂度和风险            |
| **复用程度** | 20%  | 可复用 ai-agents 能力的比例 |
| **依赖关系** | 10%  | 与其他模块的依赖和影响      |

### 4.2 优先级排序

| 优先级 | 模块          | 评分 | 状态      | 理由                              |
| ------ | ------------- | ---- | --------- | --------------------------------- |
| **P0** | ai-ask        | 92   | ✅ 已完成 | 高频使用、工具需求强、整合难度低  |
| **P0** | ai-teams      | 88   | ✅ 已完成 | TeamCollaborationAgent 已实现     |
| **P1** | ai-office     | 75   | ✅ 已完成 | AiOfficeIntegrationService 已实现 |
| **P2** | ai-studio     | 68   | ✅ 已完成 | ResearcherAgent 已实现            |
| **P2** | ai-simulation | 65   | ✅ 已完成 | SimulatorAgent 已实现             |
| **P3** | ai-image      | 45   | ✅ 已完成 | ImageDesignerAgent 已实现         |

---

## 5. ai-ask 模块整合方案

> **状态**: ✅ 已完成整合

### 5.1 现状分析（整合后）

**当前架构**（已整合 ai-agents）：

```typescript
// ai-ask.service.ts - 实际生产代码
@Injectable()
export class AiAskService {
  // 已集成的工具列表
  private readonly AI_ASK_TOOLS = [
    ToolType.TEXT_GENERATION,
    ToolType.WEB_SEARCH,
    ToolType.SHORT_TERM_MEMORY,
  ];

  constructor(
    private readonly agentOrchestrator: AgentOrchestrator,
    private readonly toolRegistry: ToolRegistry,
    private readonly askLLMAdapter: AskLLMAdapter,
    // ...other dependencies
  ) {}
}
```

**已实现能力**：

- ✅ 支持 3 种工具调用（文本生成、网络搜索、短期记忆）
- ✅ 动态工具能力检测
- ✅ 工具调用结果反馈到对话

### 5.2 已实现架构

**文件位置**: `backend/src/modules/ai/ai-ask/`

#### 模块配置（已完成）

```typescript
// ai-ask.module.ts
import { AiAgentsModule } from "../ai-agents/ai-agents.module";

@Module({
  imports: [
    AiAgentsModule, // ✅ 已导入
    AiCoreModule,
    PrismaModule,
  ],
  providers: [
    AiAskService,
    AskLLMAdapter,
    // ...
  ],
})
export class AiAskModule {}
```

#### 服务注入（已完成）

```typescript
// ai-ask.service.ts
import { AgentOrchestrator } from "../ai-agents/core/agent/agent.orchestrator";
import { ToolRegistry } from "../ai-agents/core/tool/tool.registry";
import { ToolType } from "../ai-agents/core/agent/agent.types";

@Injectable()
export class AiAskService {
  // 启用的工具列表
  private readonly AI_ASK_TOOLS = [
    ToolType.TEXT_GENERATION,
    ToolType.WEB_SEARCH,
    ToolType.SHORT_TERM_MEMORY,
  ];

  constructor(
    private readonly agentOrchestrator: AgentOrchestrator,
    private readonly toolRegistry: ToolRegistry,
    private readonly askLLMAdapter: AskLLMAdapter,
    private readonly aiChatService: AiChatService,
    private readonly prisma: PrismaService,
  ) {}

  // 获取工具能力信息
  getToolCapabilities(): ToolCapabilityInfo[] {
    return this.AI_ASK_TOOLS.map((toolType) => {
      const tool = this.toolRegistry.get(toolType);
      return {
        type: toolType,
        name: tool?.name ?? toolType,
        description: tool?.description ?? "",
        available: !!tool,
      };
    });
  }
}
```

### 5.3 扩展建议

**可添加的工具**（当前仅启用 3 个，可扩展至更多）：

```typescript
// 建议扩展的工具列表
private readonly EXTENDED_AI_ASK_TOOLS = [
  // 当前已启用
  ToolType.TEXT_GENERATION,
  ToolType.WEB_SEARCH,
  ToolType.SHORT_TERM_MEMORY,

  // 建议添加
  ToolType.RAG_SEARCH,        // 知识库搜索
  ToolType.DATA_ANALYSIS,     // 数据分析
  ToolType.PYTHON_EXECUTOR,   // Python 代码执行
  ToolType.KNOWLEDGE_GRAPH,   // 知识图谱查询
];
```

### 5.4 API 支持

| 端点                                | 状态 | 说明             |
| ----------------------------------- | ---- | ---------------- |
| `POST /ask/sessions/:id/chat`       | ✅   | 支持工具调用     |
| `SSE /ask/sessions/:id/chat-stream` | ✅   | 流式事件返回     |
| `GET /ask/tools/capabilities`       | ✅   | 获取工具能力信息 |

### 5.5 整合成果

| 指标         | 整合前     | 整合后                 |
| ------------ | ---------- | ---------------------- |
| **工具能力** | 0 种       | 3 种（可扩展至 48 种） |
| **复杂问题** | 无法处理   | 支持工具辅助回答       |
| **实时搜索** | 不支持     | ✅ WEB_SEARCH 工具     |
| **记忆能力** | 简单上下文 | ✅ SHORT_TERM_MEMORY   |
| **扩展性**   | 无         | 可按需启用更多工具     |

---

## 6. ai-teams 模块整合方案

> **状态**: ⏳ 待实施（优先级 P0）

### 6.1 现状分析

**当前架构**：

```typescript
// AI 成员定义
interface AIMember {
  id: string;
  name: string;
  avatar: string;
  role: string;
  systemPrompt: string;
  model: string;
}

// AI 响应生成 - 直接 LLM 调用，无工具能力
async generateAIResponse(member: AIMember, context: MessageContext) {
  return this.aiChatService.generateChatCompletion({
    messages: this.buildPrompt(member.systemPrompt, context),
    model: member.model,
  });
}
```

**问题**：

- ❌ AI 成员无工具能力（无法搜索、分析、执行代码）
- ❌ 角色定义简单，缺乏专业能力
- ❌ 成员间无法协作委派任务
- ❌ 无共识机制和决策支持

### 6.2 可用的 Agent 协作工具

ai-agents 提供了 6 个专门的协作工具，可直接用于 ai-teams：

| 工具                     | 类型                   | 功能             |
| ------------------------ | ---------------------- | ---------------- |
| `agent_handoff`          | AGENT_HANDOFF          | Agent 间任务委派 |
| `human_approval`         | HUMAN_APPROVAL         | 人类审批流程     |
| `agent_communication`    | AGENT_COMMUNICATION    | Agent 间消息通信 |
| `task_delegation`        | TASK_DELEGATION        | 任务分配和跟踪   |
| `consensus_mechanism`    | CONSENSUS_MECHANISM    | 多成员投票决策   |
| `workflow_orchestration` | WORKFLOW_ORCHESTRATION | 工作流编排       |

### 6.3 目标架构

```typescript
// AI 成员升级为 Agent
class TeamMemberAgent extends BaseAgent {
  type: AgentType;
  config: AgentConfig;

  constructor(member: AIMember, toolRegistry: ToolRegistry) {
    super();
    this.type = this.resolveAgentType(member.role);
    this.config = this.buildAgentConfig(member);
  }

  // 根据角色分配工具
  getRequiredTools(): ToolType[] {
    return this.roleToolMapping[this.member.role] ?? [];
  }
}
```

### 6.4 实施步骤

#### 步骤 1: 创建 TeamMemberAgent

```typescript
// team-member.agent.ts
import { BaseAgent } from "../ai-agents/core/agent/base.agent";
import {
  AgentType,
  AgentConfig,
  ToolType,
} from "../ai-agents/core/agent/agent.types";

export class TeamMemberAgent extends BaseAgent {
  // 角色到工具的映射
  private static readonly roleToolMapping: Record<string, ToolType[]> = {
    researcher: [
      ToolType.WEB_SEARCH,
      ToolType.RAG_SEARCH,
      ToolType.KNOWLEDGE_GRAPH,
    ],
    analyst: [
      ToolType.DATA_ANALYSIS,
      ToolType.PYTHON_EXECUTOR,
      ToolType.DATA_FETCH,
    ],
    writer: [
      ToolType.TEXT_GENERATION,
      ToolType.EXPORT_DOCX,
      ToolType.TEMPLATE_RENDER,
    ],
    developer: [
      ToolType.CODE_GENERATION,
      ToolType.PYTHON_EXECUTOR,
      ToolType.JAVASCRIPT_EXECUTOR,
    ],
    designer: [ToolType.IMAGE_GENERATION, ToolType.EXPORT_IMAGE],
    moderator: [
      ToolType.TEXT_GENERATION,
      ToolType.AGENT_HANDOFF,
      ToolType.CONSENSUS_MECHANISM,
    ],
  };

  constructor(
    private readonly member: AIMember,
    private readonly toolRegistry: ToolRegistry,
  ) {
    super();
    this.type = AgentType.TEAM_MEMBER;
    this.config = this.buildConfig();
  }

  private buildConfig(): AgentConfig {
    return {
      name: this.member.name,
      description: `${this.member.role} - ${this.member.name}`,
      systemPrompt: this.member.systemPrompt,
      capabilities: this.resolveCapabilities(this.member.role),
      requiredTools: TeamMemberAgent.roleToolMapping[this.member.role] ?? [],
      supportedModels: [this.member.model],
      maxSteps: 10,
      timeout: 120000,
    };
  }

  async plan(input: AgentInput): Promise<AgentPlan> {
    // 根据角色生成计划
    return this.generatePlan(input);
  }

  async *execute(plan: AgentPlan): AsyncGenerator<AgentEvent> {
    // 使用 FunctionCallingExecutor 执行
    const executor = new FunctionCallingExecutor(
      this.llmAdapter,
      this.toolRegistry,
      { maxIterations: plan.steps.length },
    );

    for await (const event of executor.run(plan)) {
      yield event;
    }
  }
}
```

#### 步骤 2: 改造 AI 响应服务

```typescript
// ai-response.service.ts
import { AgentOrchestrator } from "../ai-agents/core/execution/agent.orchestrator";
import { TeamMemberAgent } from "./team-member.agent";

@Injectable()
export class AIResponseService {
  // 成员 Agent 缓存
  private memberAgents = new Map<string, TeamMemberAgent>();

  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async generateAIResponse(
    member: AIMember,
    context: MessageContext,
    options?: { useTools?: boolean },
  ): Promise<AsyncGenerator<TeamMessageEvent>> {
    // 获取或创建成员 Agent
    const agent = this.getOrCreateAgent(member);

    // 使用 Orchestrator 执行
    const events = this.orchestrator.execute(
      {
        prompt: context.latestMessage,
        context: this.buildAgentContext(context),
      },
      agent.type,
    );

    // 转换为团队消息事件
    for await (const event of events) {
      yield this.convertToTeamEvent(event, member);
    }
  }

  private getOrCreateAgent(member: AIMember): TeamMemberAgent {
    if (!this.memberAgents.has(member.id)) {
      this.memberAgents.set(
        member.id,
        new TeamMemberAgent(member, this.toolRegistry),
      );
    }
    return this.memberAgents.get(member.id)!;
  }
}
```

#### 步骤 3: 支持成员间协作

```typescript
// topic-collaboration.service.ts

@Injectable()
export class TopicCollaborationService {
  constructor(private readonly toolRegistry: ToolRegistry) {}

  // 任务委派给其他成员
  async delegateTask(
    fromMember: AIMember,
    toMember: AIMember,
    task: string,
    context: MessageContext,
  ): Promise<DelegationResult> {
    const handoffTool = this.toolRegistry.get(ToolType.AGENT_HANDOFF);

    return handoffTool.execute({
      targetAgent: toMember.id,
      task,
      context: {
        topicId: context.topicId,
        previousMessages: context.messages.slice(-10),
      },
    });
  }

  // 多成员投票决策
  async collectVotes(
    members: AIMember[],
    proposal: string,
    context: MessageContext,
  ): Promise<ConsensusResult> {
    const consensusTool = this.toolRegistry.get(ToolType.CONSENSUS_MECHANISM);

    return consensusTool.execute({
      proposal,
      voters: members.map((m) => m.id),
      rules: {
        quorum: 0.5,
        threshold: 0.6,
        timeout: 60000,
      },
    });
  }
}
```

### 6.5 数据模型扩展

```typescript
// 扩展 AIMember 模型
interface AIMember {
  id: string;
  name: string;
  avatar: string;
  role: string;
  systemPrompt: string;
  model: string;

  // 新增字段
  capabilities?: string[]; // 能力列表
  tools?: ToolType[]; // 可用工具
  agentConfig?: Partial<AgentConfig>; // Agent 配置
}
```

### 6.6 收益预估

| 指标         | 整合前     | 整合后                   |
| ------------ | ---------- | ------------------------ |
| **工具能力** | 0 种       | 按角色分配（最多 48 种） |
| **成员协作** | 无         | AGENT_HANDOFF 工具       |
| **决策机制** | 无         | CONSENSUS_MECHANISM      |
| **专业能力** | 仅文本回复 | 搜索、分析、代码执行     |
| **任务分配** | 无         | TASK_DELEGATION 工具     |

---

## 7. ai-office 模块整合方案

> **状态**: ⚠️ 部分整合（SlidesAgent 已复用）

### 7.1 现状分析

**当前架构**（PPT 3.0）：

```
PPTOrchestratorService
├── SlidePlanningService
├── SlideContentService
├── SlideImageService
└── SlideRendererService
```

**已整合部分**：

- ✅ SlidesAgent 定义在 ai-agents 中
- ✅ 可使用 TEXT_GENERATION、IMAGE_GENERATION、WEB_SEARCH、EXPORT_PPTX 工具

**待整合部分**：

- ⏳ 统一事件流到 AgentEvent 标准
- ⏳ 复用 AgentOrchestrator 作为入口
- ⏳ 整合执行指标收集

### 7.2 目标架构

```
AgentOrchestrator
├── SlidesAgent (复用 ai-agents 实现)
│   ├── TEXT_GENERATION 工具
│   ├── IMAGE_GENERATION 工具
│   └── EXPORT_PPTX 工具
└── DocsAgent (复用 ai-agents 实现)
    ├── WEB_SEARCH 工具
    ├── TEXT_GENERATION 工具
    └── EXPORT_DOCX 工具
```

### 7.3 实施步骤

#### 步骤 1: 统一入口

```typescript
// ai-office.service.ts
import { AgentOrchestrator } from "../ai-agents/core/execution/agent.orchestrator";
import { AgentType } from "../ai-agents/core/agent/agent.types";

@Injectable()
export class AiOfficeService {
  constructor(private readonly orchestrator: AgentOrchestrator) {}

  // PPT 生成统一入口
  async generatePPT(input: PPTInput): Promise<AsyncGenerator<OfficeEvent>> {
    const events = this.orchestrator.execute(
      {
        prompt: input.prompt,
        options: {
          template: input.template,
          pageCount: input.pageCount,
          style: input.style,
        },
      },
      AgentType.SLIDES,
    );

    for await (const event of events) {
      yield this.convertToOfficeEvent(event);
    }
  }

  // 文档生成统一入口
  async generateDocument(
    input: DocInput,
  ): Promise<AsyncGenerator<OfficeEvent>> {
    const events = this.orchestrator.execute(
      {
        prompt: input.prompt,
        options: {
          template: input.template,
          format: input.format,
        },
      },
      AgentType.DOCS,
    );

    for await (const event of events) {
      yield this.convertToOfficeEvent(event);
    }
  }
}
```

#### 步骤 2: 保留现有服务作为工具实现

```typescript
// 将现有服务封装为工具
// tools/export/pptx-export.tool.ts
import { SlideRendererService } from "../../ai-office/ppt/slide-renderer.service";

export class PPTXExportTool extends BaseTool<PPTXInput, PPTXOutput> {
  type = ToolType.EXPORT_PPTX;
  category = ToolCategory.EXPORT;

  constructor(private readonly renderer: SlideRendererService) {
    super();
  }

  protected async doExecute(input: PPTXInput): Promise<PPTXOutput> {
    // 复用现有渲染逻辑
    const html = await this.renderer.renderSlides(input.slides);
    const pptxBuffer = await this.renderer.exportToPPTX(html);

    return {
      buffer: pptxBuffer,
      filename: `${input.title}.pptx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
  }
}
```

### 7.4 收益

| 指标         | 整合前     | 整合后                |
| ------------ | ---------- | --------------------- |
| **编排统一** | 独立编排器 | AgentOrchestrator     |
| **事件标准** | 自定义     | AgentEvent 标准       |
| **指标收集** | 无         | ExecutionMetrics      |
| **工具复用** | 内嵌实现   | ToolRegistry 统一管理 |

---

## 8. ai-studio 模块整合方案

> **状态**: ⏳ 待实施（优先级 P2）

### 8.1 现状分析

**当前架构**：

```
AiStudioService (项目管理)
├── AiStudioChatService (对话)
├── AiStudioSourceService (资料管理)
├── AiStudioOutputService (输出管理)
└── AiStudioTtsService (语音合成)
```

**问题**：

- ❌ 缺乏 Agent 编排能力
- ❌ 服务间协作松散
- ❌ 无智能研究辅助
- ❌ 无知识图谱构建能力

### 8.2 目标架构：创建 ResearcherAgent

```typescript
// researcher.agent.ts
export class ResearcherAgent extends BaseAgent {
  type = AgentType.RESEARCHER;

  capabilities = [
    "自动调研资料",
    "知识图谱构建",
    "内容摘要生成",
    "研究报告撰写",
  ];

  requiredTools = [
    ToolType.WEB_SEARCH,
    ToolType.RAG_SEARCH,
    ToolType.KNOWLEDGE_GRAPH,
    ToolType.DATA_ANALYSIS,
    ToolType.TEXT_GENERATION,
    ToolType.LONG_TERM_MEMORY,
  ];
}
```

### 8.3 实施步骤

#### 步骤 1: 创建研究助手 Agent

```typescript
// researcher.agent.ts
import { BaseAgent } from "../ai-agents/core/agent/base.agent";

export class ResearcherAgent extends BaseAgent {
  type = AgentType.RESEARCHER;

  config: AgentConfig = {
    name: "Research Assistant",
    description: "智能研究助手，帮助用户进行资料调研和知识整理",
    systemPrompt: `你是一个专业的研究助手。你的职责是：
1. 根据用户需求搜索和整理资料
2. 分析和总结关键信息
3. 构建知识关联图谱
4. 生成结构化的研究报告

在执行任务时，请：
- 优先使用 RAG_SEARCH 查询已有知识库
- 使用 WEB_SEARCH 补充最新信息
- 使用 KNOWLEDGE_GRAPH 建立知识关联
- 使用 LONG_TERM_MEMORY 保存研究成果`,
    capabilities: this.capabilities,
    requiredTools: this.requiredTools,
    supportedModels: ["gpt-4", "claude-3-opus"],
    maxSteps: 15,
    timeout: 300000,
  };

  async plan(input: AgentInput): Promise<AgentPlan> {
    // 根据研究任务生成计划
    const taskType = this.classifyTask(input.prompt);

    switch (taskType) {
      case "literature_review":
        return this.planLiteratureReview(input);
      case "data_analysis":
        return this.planDataAnalysis(input);
      case "report_generation":
        return this.planReportGeneration(input);
      default:
        return this.planGeneralResearch(input);
    }
  }
}
```

#### 步骤 2: 整合到 Studio 服务

```typescript
// ai-studio.service.ts
import { AgentOrchestrator } from "../ai-agents/core/execution/agent.orchestrator";
import { LongTermMemory } from "../ai-agents/core/memory/long-term.memory";

@Injectable()
export class AiStudioService {
  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly longTermMemory: LongTermMemory,
  ) {}

  // 智能研究助手
  async conductResearch(
    projectId: string,
    query: string,
    options?: ResearchOptions,
  ): Promise<AsyncGenerator<ResearchEvent>> {
    // 加载项目上下文
    const projectContext = await this.loadProjectContext(projectId);

    const events = this.orchestrator.execute(
      {
        prompt: query,
        context: projectContext,
        options: {
          saveToProject: true,
          buildKnowledgeGraph: options?.buildGraph,
        },
      },
      AgentType.RESEARCHER,
    );

    for await (const event of events) {
      // 保存研究成果到项目
      if (event.type === "artifact") {
        await this.saveToProject(projectId, event.artifact);
      }
      yield this.convertToResearchEvent(event);
    }
  }

  // 知识图谱查询
  async queryKnowledgeGraph(
    projectId: string,
    query: string,
  ): Promise<KnowledgeGraphResult> {
    const tool = this.toolRegistry.get(ToolType.KNOWLEDGE_GRAPH);
    return tool.execute({
      query,
      projectId,
      depth: 2,
    });
  }
}
```

### 8.4 收益

| 指标           | 整合前     | 整合后              |
| -------------- | ---------- | ------------------- |
| **研究辅助**   | 无         | ResearcherAgent     |
| **知识管理**   | 简单存储   | 知识图谱 + 语义搜索 |
| **自动调研**   | 手动       | WEB_SEARCH + RAG    |
| **记忆持久化** | 项目级文件 | LongTermMemory      |

---

## 9. ai-simulation 模块整合方案

> **状态**: ⏳ 待实施（优先级 P2）

### 9.1 现状分析

**当前架构**：

```
AiSimulationService (场景管理)
└── AiSimulationEngine (推演引擎)
    ├── runTurn() - 执行单轮
    ├── applyRules() - 应用规则
    └── collectActions() - 收集行动
```

**可复用的工具**：

- `AGENT_COMMUNICATION` - Agent 间通信
- `TEXT_GENERATION` - 行动生成
- `DATA_ANALYSIS` - 数据分析
- `PYTHON_EXECUTOR` - 规则执行

### 9.2 整合方案

```typescript
// simulation-agent.ts
export class SimulationAgent extends BaseAgent {
  constructor(
    private readonly agentConfig: SimulationAgentConfig,
    private readonly scenario: SimulationScenario,
  ) {
    super();
  }

  // 使用 Agent 框架管理推演 Agent
  async plan(input: AgentInput): Promise<AgentPlan> {
    return {
      id: generateId(),
      agentType: AgentType.SIMULATION,
      objective: `在场景 "${this.scenario.name}" 中执行角色 "${this.agentConfig.role}"`,
      steps: this.generateTurnSteps(input),
    };
  }

  // 使用工具系统进行 Agent 间通信
  async *execute(plan: AgentPlan): AsyncGenerator<AgentEvent> {
    for (const step of plan.steps) {
      // 使用 AGENT_COMMUNICATION 工具与其他 Agent 通信
      if (step.requiresCommunication) {
        const commTool = this.toolRegistry.get(ToolType.AGENT_COMMUNICATION);
        const result = await commTool.execute({
          targetAgent: step.targetAgentId,
          message: step.message,
        });
        yield { type: "tool_result", result };
      }

      // 使用 TEXT_GENERATION 生成行动
      const actionTool = this.toolRegistry.get(ToolType.TEXT_GENERATION);
      const action = await actionTool.execute({
        prompt: this.buildActionPrompt(step),
      });
      yield { type: "step_complete", output: action };
    }
  }
}
```

### 9.3 收益

| 指标           | 整合前 | 整合后              |
| -------------- | ------ | ------------------- |
| **Agent 管理** | 自定义 | AgentRegistry       |
| **通信机制**   | 自定义 | AGENT_COMMUNICATION |
| **执行追踪**   | 日志   | ExecutionMetrics    |

---

## 10. ai-image 模块整合方案

> **状态**: ⏳ 待实施（优先级 P3）

### 10.1 现状分析

ai-image 模块已有成熟的流式管道，主要整合方向是将关键能力封装为工具。

**现有能力**：

- 图像生成（Stable Diffusion / DALL-E）
- Prompt 增强
- 信息图表生成
- 图片导出

**可封装为工具**：

- `IMAGE_GENERATION` - 已在 ai-agents 中实现
- `OCR_RECOGNITION` - OCR 文字识别
- `EXPORT_IMAGE` - 图片导出

### 10.2 工具化封装

```typescript
// 将 ai-image 能力封装为工具

// 1. Prompt 增强工具
export class PromptEnhancementTool extends BaseTool {
  type = ToolType.PROMPT_ENHANCEMENT;

  constructor(private readonly promptService: PromptEnhancementService) {
    super();
  }

  protected async doExecute(input: { prompt: string; style?: string }) {
    return this.promptService.enhance(input.prompt, input.style);
  }
}

// 2. 信息图表生成工具
export class InfographicTool extends BaseTool {
  type = ToolType.INFOGRAPHIC_GENERATION;

  constructor(private readonly infographicService: InfographicTemplateService) {
    super();
  }

  protected async doExecute(input: InfographicInput) {
    return this.infographicService.generate(input);
  }
}

// 3. 注册到 ToolRegistry
toolRegistry.registerMany([
  new PromptEnhancementTool(promptService),
  new InfographicTool(infographicService),
]);
```

### 10.3 收益

| 指标         | 整合前   | 整合后          |
| ------------ | -------- | --------------- |
| **能力复用** | 模块内部 | 全局可用工具    |
| **编排支持** | 独立管道 | 可被 Agent 调用 |

---

## 11. 错误处理与最佳实践

### 11.1 错误码体系

ai-agents 使用统一的 `ToolError` 类进行错误处理，错误码按类别分层：

```typescript
// 文件: core/errors/tool.error.ts
export enum ToolErrorCode {
  // ═══════════════════════════════════════════════════════════════
  // 验证错误 (1xxx) - 不可重试
  // ═══════════════════════════════════════════════════════════════
  VALIDATION_ERROR = "VALIDATION_ERROR", // 1000
  VALIDATION_SCHEMA_INVALID = "VALIDATION_SCHEMA_INVALID", // 1001
  VALIDATION_REQUIRED_MISSING = "VALIDATION_REQUIRED_MISSING", // 1002
  VALIDATION_TYPE_MISMATCH = "VALIDATION_TYPE_MISMATCH", // 1003
  VALIDATION_FORMAT_INVALID = "VALIDATION_FORMAT_INVALID", // 1004
  VALIDATION_RANGE_EXCEEDED = "VALIDATION_RANGE_EXCEEDED", // 1005

  // ═══════════════════════════════════════════════════════════════
  // 执行错误 (2xxx) - 部分可重试
  // ═══════════════════════════════════════════════════════════════
  EXECUTION_ERROR = "EXECUTION_ERROR", // 2000 可重试
  EXECUTION_TIMEOUT = "EXECUTION_TIMEOUT", // 2001 可重试
  EXECUTION_CANCELLED = "EXECUTION_CANCELLED", // 2002 不可重试
  EXECUTION_FAILED = "EXECUTION_FAILED", // 2003 可重试

  // ═══════════════════════════════════════════════════════════════
  // 权限错误 (3xxx) - 不可重试
  // ═══════════════════════════════════════════════════════════════
  PERMISSION_DENIED = "PERMISSION_DENIED", // 3000
  PERMISSION_INSUFFICIENT_SCOPE = "PERMISSION_INSUFFICIENT_SCOPE", // 3001
  PERMISSION_AUTHENTICATION_REQUIRED = "PERMISSION_AUTHENTICATION_REQUIRED", // 3002

  // ═══════════════════════════════════════════════════════════════
  // 资源错误 (4xxx) - 部分可重试
  // ═══════════════════════════════════════════════════════════════
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND", // 4000 不可重试
  RESOURCE_ALREADY_EXISTS = "RESOURCE_ALREADY_EXISTS", // 4001 不可重试
  RESOURCE_UNAVAILABLE = "RESOURCE_UNAVAILABLE", // 4002 可重试
  RESOURCE_EXHAUSTED = "RESOURCE_EXHAUSTED", // 4003 可重试

  // ═══════════════════════════════════════════════════════════════
  // 限流错误 (5xxx) - 可重试
  // ═══════════════════════════════════════════════════════════════
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED", // 5000 可重试
  RATE_LIMIT_QUOTA_EXCEEDED = "RATE_LIMIT_QUOTA_EXCEEDED", // 5001 不可重试
  RATE_LIMIT_CONCURRENT_EXCEEDED = "RATE_LIMIT_CONCURRENT_EXCEEDED", // 5002 可重试

  // ═══════════════════════════════════════════════════════════════
  // 外部服务错误 (6xxx) - 可重试
  // ═══════════════════════════════════════════════════════════════
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR", // 6000
  EXTERNAL_SERVICE_TIMEOUT = "EXTERNAL_SERVICE_TIMEOUT", // 6001
  EXTERNAL_SERVICE_UNAVAILABLE = "EXTERNAL_SERVICE_UNAVAILABLE", // 6002
  EXTERNAL_SERVICE_RATE_LIMITED = "EXTERNAL_SERVICE_RATE_LIMITED", // 6003
  EXTERNAL_SERVICE_AUTHENTICATION_FAILED = "EXTERNAL_SERVICE_AUTHENTICATION_FAILED", // 6004

  // ═══════════════════════════════════════════════════════════════
  // 内部错误 (9xxx) - 不可重试
  // ═══════════════════════════════════════════════════════════════
  INTERNAL_ERROR = "INTERNAL_ERROR", // 9000
  INTERNAL_CONFIGURATION_ERROR = "INTERNAL_CONFIGURATION_ERROR", // 9001
  INTERNAL_DEPENDENCY_ERROR = "INTERNAL_DEPENDENCY_ERROR", // 9002 可重试
  INTERNAL_UNEXPECTED_ERROR = "INTERNAL_UNEXPECTED_ERROR", // 9003
}
```

### 11.2 错误处理模式

#### 11.2.1 在工具中抛出错误

```typescript
import { ToolError, ToolErrorCode } from "../core/errors";

class MyTool extends BaseTool {
  protected async doExecute(
    input: Input,
    context: ToolContext,
  ): Promise<Output> {
    // 验证错误
    if (!input.query) {
      throw ToolError.validation("Query is required", {
        field: "query",
        received: input.query,
      });
    }

    // 资源未找到
    const result = await this.findResource(input.resourceId);
    if (!result) {
      throw ToolError.notFound(input.resourceId, this.name);
    }

    // 外部服务错误
    try {
      return await this.callExternalApi(input);
    } catch (error) {
      throw ToolError.externalService(
        "ExternalAPI",
        error.message,
        ToolErrorCode.EXTERNAL_SERVICE_TIMEOUT,
      );
    }
  }
}
```

#### 11.2.2 在服务中捕获错误

```typescript
import {
  ToolError,
  isRetryableError,
  shouldRetry,
  getRetryDelay,
} from "../core/errors";

async function executeWithRetry(tool: ITool, input: unknown, maxRetries = 3) {
  let attempt = 0;

  while (true) {
    try {
      return await tool.execute(input, context);
    } catch (error) {
      attempt++;

      if (error instanceof ToolError) {
        // 检查是否可重试
        if (!shouldRetry(error, attempt)) {
          throw error;
        }

        // 计算重试延迟（指数退避）
        const delay = getRetryDelay(error, attempt);
        await sleep(delay);
        continue;
      }

      // 非 ToolError，转换并抛出
      throw ToolError.fromError(error as Error);
    }
  }
}
```

### 11.3 重试策略

```typescript
// 文件: core/execution/retry-strategy.ts

// 错误码对应的重试配置
const RETRY_CONFIG = {
  EXECUTION_ERROR: { retryable: true, delay: 1000, maxRetries: 3 },
  EXECUTION_TIMEOUT: { retryable: true, delay: 2000, maxRetries: 2 },
  RESOURCE_UNAVAILABLE: { retryable: true, delay: 5000, maxRetries: 3 },
  RATE_LIMIT_EXCEEDED: { retryable: true, delay: 60000, maxRetries: 3 },
  EXTERNAL_SERVICE_ERROR: { retryable: true, delay: 2000, maxRetries: 3 },
};

// 重试延迟使用指数退避 + 抖动
function calculateDelay(baseDelay: number, attempt: number): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.1 * exponentialDelay;
  return exponentialDelay + jitter;
}
```

### 11.4 最佳实践

#### 11.4.1 工具开发最佳实践

```typescript
// ✅ 正确：使用统一的错误类型
throw new ToolError(ToolErrorCode.VALIDATION_ERROR, "Invalid input", {
  details: { field: "query", expected: "string" },
  source: this.name,
});

// ❌ 错误：抛出普通 Error
throw new Error("Invalid input");

// ✅ 正确：设置合理的超时时间
readonly timeout = 30000; // 30 秒

// ❌ 错误：没有超时控制
// readonly timeout = undefined;

// ✅ 正确：详细的输入 Schema
readonly inputSchema: JSONSchema = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1, description: "搜索查询" },
    maxResults: { type: "number", minimum: 1, maximum: 100, default: 10 },
  },
  required: ["query"],
};

// ❌ 错误：缺少验证约束
readonly inputSchema = { type: "object" };
```

#### 11.4.2 服务集成最佳实践

```typescript
// ✅ 正确：使用 for await 处理流式事件
for await (const event of orchestrator.execute(input, agentType)) {
  switch (event.type) {
    case "tool_call":
      this.logger.log(`Calling tool: ${event.toolType}`);
      break;
    case "error":
      this.handleError(event.error);
      break;
    case "complete":
      return event.output;
  }
}

// ✅ 正确：在上下文中传递必要信息
const context: ToolContext = {
  taskId: generateId(),
  userId: currentUser.id,
  workspaceId: currentWorkspace.id,
  timeout: 60000,
};

// ✅ 正确：限制工具列表，只启用需要的工具
const enabledTools = [
  ToolType.WEB_SEARCH,
  ToolType.TEXT_GENERATION,
  // 不要启用不需要的工具
];
```

### 11.5 性能优化建议

| 场景         | 建议               | 说明                                      |
| ------------ | ------------------ | ----------------------------------------- |
| **工具超时** | 设置合理的 timeout | 默认 30s，复杂操作可增加到 60-120s        |
| **并发控制** | 限制并发工具调用数 | FunctionCallingExecutor 默认最多 3 个并发 |
| **迭代限制** | 设置 maxIterations | 防止无限循环，默认 10 次                  |
| **缓存**     | 对频繁查询使用缓存 | 如 WEB_SEARCH 结果可缓存 5-15 分钟        |
| **批量操作** | 合并多次小操作     | 如批量图像生成优于多次单独调用            |

---

## 12. 整合路线图

### 12.1 当前进度

```
Phase 1: 基础整合 ✅ 已完成
├── ✅ ai-ask 接入 AgentOrchestrator + ToolRegistry
├── ⏳ ai-teams AI成员升级为 Agent（待实施）
└── ✅ 共享 ToolRegistry 和 Memory

Phase 2: 办公整合 ✅ 已完成
├── ✅ SlidesAgent 完成整合，复用 PPTOrchestratorService
├── ✅ DocsAgent 完成整合，复用 DocumentGenerationService
└── ✅ AiOfficeIntegrationService 统一入口服务

Phase 3: 专项整合 ✅ 已完成
├── ✅ ResearcherAgent 创建完成 (ai-studio)
├── ✅ SimulatorAgent 创建完成 (ai-simulation)
└── ✅ ImageDesignerAgent 创建完成 (ai-image)

Phase 4: 工具扩展 ✅ 已完成
├── ✅ ai-image 能力已工具化 (ImageDesignerAgent)
└── ✅ 48 种工具全部注册
```

### 12.2 里程碑

| 里程碑 | 目标               | 状态      | 验收标准                       |
| ------ | ------------------ | --------- | ------------------------------ |
| **M1** | ai-ask 完成整合    | ✅ 已完成 | 工具调用正常，流式事件正确     |
| **M2** | ai-teams 完成整合  | ⏳ 待实施 | AI成员具备工具能力，协作正常   |
| **M3** | ai-office 迁移完成 | ✅ 已完成 | PPT/DOCX 生成通过标准流程      |
| **M4** | 专项模块整合       | ✅ 已完成 | studio/simulation/image 已整合 |
| **M5** | 监控体系建立       | ⏳ 待开始 | 统一指标面板上线               |

### 12.3 下一步行动

**优先级 P0（建议立即实施）**：

1. **ai-teams 整合**
   - 创建 TeamMemberAgent 类
   - 实现角色到工具的映射
   - 添加协作工具支持（AGENT_HANDOFF, CONSENSUS_MECHANISM）

2. **端到端测试**
   - 验证 ResearcherAgent 研究流程
   - 验证 SimulatorAgent 推演流程
   - 验证 ImageDesignerAgent 图像生成流程

3. **监控体系建立**
   - 建立 Agent 执行指标收集
   - 创建统一监控面板

---

## 13. 通用整合模式

### 13.1 模式 1: 直接使用 AgentOrchestrator

适用于：需要完整 Agent 能力的场景

```typescript
import { AgentOrchestrator } from "../ai-agents/core/execution/agent.orchestrator";

@Injectable()
export class YourService {
  constructor(private readonly orchestrator: AgentOrchestrator) {}

  async executeTask(input: TaskInput) {
    const events = this.orchestrator.execute(
      { prompt: input.prompt },
      AgentType.YOUR_AGENT,
    );

    for await (const event of events) {
      // 处理事件
    }
  }
}
```

### 13.2 模式 2: 使用 FunctionCallingExecutor

适用于：LLM 自主工具选择场景

```typescript
import { FunctionCallingExecutor } from "../ai-agents/core/execution/function-calling-executor";

@Injectable()
export class YourService {
  constructor(
    private readonly llmAdapter: ILLMAdapter,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async executeWithTools(prompt: string, tools: ToolType[]) {
    const executor = new FunctionCallingExecutor(
      this.llmAdapter,
      this.toolRegistry,
      { maxIterations: 10 },
    );

    for await (const event of executor.run({ prompt, availableTools: tools })) {
      yield event;
    }
  }
}
```

### 13.3 模式 3: 直接使用工具

适用于：明确知道需要哪个工具的场景

```typescript
import { ToolRegistry } from "../ai-agents/core/tool/tool.registry";

@Injectable()
export class YourService {
  constructor(private readonly toolRegistry: ToolRegistry) {}

  async search(query: string) {
    const searchTool = this.toolRegistry.get(ToolType.WEB_SEARCH);
    return searchTool.execute({ query, maxResults: 10 });
  }
}
```

### 13.4 模式 4: 创建自定义 Agent

适用于：需要定制化 Agent 行为的场景

```typescript
import { BaseAgent } from "../ai-agents/core/agent/base.agent";

export class CustomAgent extends BaseAgent {
  type = AgentType.CUSTOM;

  config: AgentConfig = {
    name: "Custom Agent",
    requiredTools: [ToolType.X, ToolType.Y],
    // ...
  };

  async plan(input: AgentInput): Promise<AgentPlan> {
    // 自定义规划逻辑
  }

  async *execute(plan: AgentPlan): AsyncGenerator<AgentEvent> {
    // 自定义执行逻辑
  }
}

// 注册到 AgentRegistry
agentRegistry.register(new CustomAgent());
```

---

## 附录 A: 导入路径速查

```typescript
// ════════════════════════════════════════════════════════════════════════════
// Agent 核心 (core/agent/)
// ════════════════════════════════════════════════════════════════════════════
import { AgentOrchestrator } from "@/modules/ai/ai-agents/core/agent/agent.orchestrator";
import { AgentRegistry } from "@/modules/ai/ai-agents/core/agent/agent.registry";
import {
  AgentType,
  AgentTaskStatus,
  ToolType,
  ArtifactType,
} from "@/modules/ai/ai-agents/core/agent/agent.types";

// ════════════════════════════════════════════════════════════════════════════
// 工具系统 (core/tool/)
// ════════════════════════════════════════════════════════════════════════════
import { ToolRegistry } from "@/modules/ai/ai-agents/core/tool/tool.registry";
import {
  BaseTool,
  ITool,
  ToolContext,
  ToolResult,
  JSONSchema,
  FunctionDefinition,
} from "@/modules/ai/ai-agents/core/tool/tool.interface";

// ════════════════════════════════════════════════════════════════════════════
// 执行引擎 (core/execution/)
// ════════════════════════════════════════════════════════════════════════════
import { FunctionCallingExecutor } from "@/modules/ai/ai-agents/core/execution/function-calling-executor";
import { ExecutionMetricsCollector } from "@/modules/ai/ai-agents/core/execution/execution-metrics";
import { RetryStrategy } from "@/modules/ai/ai-agents/core/execution/retry-strategy";

// ════════════════════════════════════════════════════════════════════════════
// LLM 适配 (core/llm/)
// ════════════════════════════════════════════════════════════════════════════
import {
  LLMAdapter,
  ILLMAdapter,
} from "@/modules/ai/ai-agents/core/llm/llm-adapter";

// ════════════════════════════════════════════════════════════════════════════
// 记忆系统 (core/memory/)
// ════════════════════════════════════════════════════════════════════════════
import { ShortTermMemory } from "@/modules/ai/ai-agents/core/memory/short-term.memory";
import { LongTermMemory } from "@/modules/ai/ai-agents/core/memory/long-term.memory";
import { IMemory } from "@/modules/ai/ai-agents/core/memory/memory.interface";

// ════════════════════════════════════════════════════════════════════════════
// 错误系统 (core/errors/)
// ════════════════════════════════════════════════════════════════════════════
import {
  ToolError,
  ToolErrorCode,
  ToolErrorDetails,
  TOOL_ERROR_CODES,
  isRetryableError,
  shouldRetry,
  getRetryDelay,
} from "@/modules/ai/ai-agents/core/errors/tool.error";

// ════════════════════════════════════════════════════════════════════════════
// 验证系统 (core/validation/)
// ════════════════════════════════════════════════════════════════════════════
import {
  SchemaValidator,
  ValidationResult,
} from "@/modules/ai/ai-agents/core/validation/schema-validator";

// ════════════════════════════════════════════════════════════════════════════
// 安全护栏 (core/guardrails/)
// ════════════════════════════════════════════════════════════════════════════
import { Guardrails } from "@/modules/ai/ai-agents/core/guardrails/guardrails";

// ════════════════════════════════════════════════════════════════════════════
// MCP 协议 (core/mcp/)
// ════════════════════════════════════════════════════════════════════════════
import { MCPAdapter } from "@/modules/ai/ai-agents/core/mcp/mcp-adapter";
import { MCPServer } from "@/modules/ai/ai-agents/core/mcp/mcp-server";

// ════════════════════════════════════════════════════════════════════════════
// 便捷导入 (从 core/index.ts 统一导出)
// ════════════════════════════════════════════════════════════════════════════
import {
  AgentOrchestrator,
  ToolRegistry,
  AgentRegistry,
  ToolType,
  AgentType,
  ToolError,
  // ...
} from "@/modules/ai/ai-agents/core";
```

---

## 附录 B: 检查清单

### 整合前检查

- [ ] 确认模块已导入 `AiAgentsModule`
- [ ] 确认需要的工具已在 `ToolRegistry` 注册
- [ ] 确认 LLM 适配器配置正确

### 整合后验证

- [ ] 工具调用正常执行
- [ ] 流式事件正确推送
- [ ] 错误被正确捕获和处理
- [ ] 指标被正确收集
- [ ] 安全护栏生效

---

## 附录 C: 常见问题解答 (FAQ)

### Q1: 如何选择使用哪种整合模式？

| 场景                | 推荐模式                        | 说明                 |
| ------------------- | ------------------------------- | -------------------- |
| 需要完整 Agent 能力 | 模式 1: AgentOrchestrator       | 自动规划、多步骤执行 |
| LLM 自主选择工具    | 模式 2: FunctionCallingExecutor | ReAct 模式           |
| 明确知道用哪个工具  | 模式 3: 直接使用工具            | 最简单，性能最好     |
| 需要定制 Agent      | 模式 4: 自定义 Agent            | 灵活度最高           |

### Q2: 工具执行超时怎么处理？

```typescript
// 方法 1: 在工具定义中设置超时
class MyTool extends BaseTool {
  readonly timeout = 60000; // 60 秒
}

// 方法 2: 在上下文中设置超时
const context: ToolContext = {
  taskId: id,
  timeout: 120000, // 120 秒，覆盖默认值
};
```

### Q3: 如何调试工具执行问题？

```typescript
// 1. 启用详细日志
const executor = new FunctionCallingExecutor(llmAdapter, toolRegistry, {
  debug: true,
  logLevel: "verbose",
});

// 2. 监听事件
for await (const event of executor.run(input)) {
  console.log(`[${event.type}]`, JSON.stringify(event, null, 2));
}

// 3. 检查错误详情
if (error instanceof ToolError) {
  console.log("Error Code:", error.code);
  console.log("Retryable:", error.retryable);
  console.log("Details:", error.details);
}
```

### Q4: 如何限制工具调用次数？

```typescript
const executor = new FunctionCallingExecutor(llmAdapter, toolRegistry, {
  maxIterations: 5, // 最大迭代次数
  maxToolCalls: 10, // 最大工具调用次数
  maxConcurrentTools: 2, // 最大并发工具数
});
```

### Q5: 如何在工具间共享数据？

```typescript
// 使用短期记忆
const memoryTool = toolRegistry.get(ToolType.SHORT_TERM_MEMORY);

// 存储
await memoryTool.execute(
  {
    action: "set",
    key: "search_results",
    value: results,
  },
  context,
);

// 读取
const stored = await memoryTool.execute(
  {
    action: "get",
    key: "search_results",
  },
  context,
);
```

### Q6: 如何测试自定义工具？

```typescript
import { ToolError, ToolErrorCode } from "../core/errors";

describe("MyCustomTool", () => {
  let tool: MyCustomTool;

  beforeEach(() => {
    tool = new MyCustomTool();
  });

  it("should execute successfully", async () => {
    const result = await tool.execute({ query: "test" }, mockContext);
    expect(result.success).toBe(true);
  });

  it("should throw validation error for invalid input", async () => {
    await expect(tool.execute({ query: "" }, mockContext)).rejects.toThrow(
      ToolError,
    );
  });
});
```

---

## 附录 D: 调试指南

### 启用调试模式

```bash
# 设置环境变量
DEBUG=ai-agents:* npm run start:dev

# 或在代码中
process.env.DEBUG = 'ai-agents:*';
```

### 常见问题排查

| 问题           | 可能原因               | 解决方案                              |
| -------------- | ---------------------- | ------------------------------------- |
| 工具未找到     | 未注册到 ToolRegistry  | 检查 ai-agents.module.ts 中的注册代码 |
| 执行超时       | 操作耗时过长           | 增加 timeout 或优化工具实现           |
| 验证失败       | 输入不符合 Schema      | 检查 inputSchema 定义和输入数据       |
| LLM 未调用工具 | 系统提示不清晰         | 优化 systemPrompt，明确工具使用场景   |
| 无限循环       | maxIterations 设置过高 | 降低 maxIterations 或检查终止条件     |

---

## 版本历史

| 版本 | 日期       | 作者              | 变更说明                                                                                                                                                                                 |
| ---- | ---------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0 | 2025-12-19 | Architecture Team | 初始版本发布                                                                                                                                                                             |
| v2.0 | 2025-12-19 | Architecture Team | 更新实际整合状态：ai-ask 已完成整合；添加 ai-agents 核心能力清单和工具分类统计；更新模块依赖关系图；添加协作工具列表；更新路线图进度                                                     |
| v3.0 | 2025-12-19 | Architecture Team | 全面改进：新增第3章"核心架构详解"（目录结构、类型系统、执行流程）；新增第11章"错误处理与最佳实践"（错误码体系、重试策略、性能优化）；更新附录A导入路径；新增附录C FAQ；新增附录D调试指南 |

