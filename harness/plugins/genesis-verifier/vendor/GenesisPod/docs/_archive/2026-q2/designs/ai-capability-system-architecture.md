# AI 能力系统完整架构分析

> **版本**: v1.0
> **分析日期**: 2026-01-21
> **分析基于**: 代码提交 ff5ce052 (main 分支)
> **分析范围**: AI App → AI Engine → AI Teams → 密钥管理 完整链路

---

## 目录

1. [系统概述](#1-系统概述)
2. [分层架构](#2-分层架构)
3. [AI Engine 核心层](#3-ai-engine-核心层)
4. [密钥与配置管理](#4-密钥与配置管理)
5. [工具系统](#5-工具系统)
6. [技能系统](#6-技能系统)
7. [AI Teams 协作层](#7-ai-teams-协作层)
8. [Topic Research 业务流程实例](#8-topic-research-业务流程实例)
9. [数据流图](#9-数据流图)
10. [关键断点与修复记录](#10-关键断点与修复记录)

---

## 1. 系统概述

### 1.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AI Applications Layer                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ AI Ask   │ │AI Studio │ │AI Office │ │AI Writing│ │AI Coding │          │
│  │ (问答)   │ │ (研究)   │ │ (文档)   │ │ (写作)   │ │ (编程)   │          │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘          │
│       │            │            │            │            │                  │
│  ┌────┴────────────┴────────────┴────────────┴────────────┴────┐            │
│  │                    AI Teams (协作层)                         │            │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │            │
│  │  │ Topic Team  │ │ Debate Team │ │ Review Team │ ...        │            │
│  │  │ (研究团队)  │ │ (辩论团队)  │ │ (审核团队)  │            │            │
│  │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘            │            │
│  └─────────┼───────────────┼───────────────┼───────────────────┘            │
└────────────┼───────────────┼───────────────┼────────────────────────────────┘
             │               │               │
┌────────────┼───────────────┼───────────────┼────────────────────────────────┐
│            └───────────────┴───────────────┘                                 │
│                            │                                                 │
│  ┌─────────────────────────┴─────────────────────────┐                      │
│  │                 AIEngineFacade                     │  ← 统一入口          │
│  │  chat() | chatWithSkills() | executeAgent()       │                      │
│  │  executeTool() | buildContext() | search()        │                      │
│  └───────────────────────────┬───────────────────────┘                      │
│                              │                                               │
│  ┌───────────────────────────┴───────────────────────┐                      │
│  │              AI Engine Core Layer                  │                      │
│  │  ┌─────────────────┐  ┌─────────────────┐         │                      │
│  │  │ AICapability    │  │ FunctionCalling │         │                      │
│  │  │ Resolver        │  │ Executor        │         │                      │
│  │  │ (能力解析)      │  │ (ReAct执行)     │         │                      │
│  │  └────────┬────────┘  └────────┬────────┘         │                      │
│  │           │                    │                   │                      │
│  │  ┌────────┴────────────────────┴────────┐         │                      │
│  │  │              Registries               │         │                      │
│  │  │  ToolRegistry | SkillRegistry         │         │                      │
│  │  │  (46+ tools)  | (N skills)            │         │                      │
│  │  └────────────────────┬──────────────────┘         │                      │
│  │                       │                            │                      │
│  │  ┌────────────────────┴──────────────────┐        │                      │
│  │  │           MCP Integration              │        │                      │
│  │  │  MCPManager | MCPToolAdapter           │        │                      │
│  │  │  (外部工具协议)                        │        │                      │
│  │  └────────────────────────────────────────┘        │                      │
│  └───────────────────────────────────────────────────┘                      │
│                              │                                               │
│                    AI Engine Layer                                           │
└──────────────────────────────┼──────────────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────────────────┐
│                              │         Infrastructure Layer                  │
│  ┌───────────────────────────┴───────────────────────┐                      │
│  │              Secrets Service                       │                      │
│  │  getValue() | createSecret() | rotateSecret()     │                      │
│  │  AES-256-CBC 加密 | PBKDF2 密钥派生               │                      │
│  └───────────────────────────┬───────────────────────┘                      │
│                              │                                               │
│  ┌───────────────────────────┴───────────────────────┐                      │
│  │              Database Layer                        │                      │
│  │  ┌─────────┐ ┌───────────┐ ┌──────────┐          │                      │
│  │  │ Prisma  │ │ToolConfig │ │ Secrets  │          │                      │
│  │  │ (ORM)   │ │SkillConfig│ │Table     │          │                      │
│  │  └─────────┘ └───────────┘ └──────────┘          │                      │
│  └───────────────────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 代码统计

| 层级      | 模块            | 文件数        | 主要功能       |
| --------- | --------------- | ------------- | -------------- |
| AI Apps   | `ai-app/`       | 168+ services | 应用层业务逻辑 |
| AI Engine | `ai-engine/`    | 307 files     | 核心能力提供   |
| AI Teams  | `ai-app/teams/` | 45+ files     | 多 Agent 协作  |
| Core      | `core/secrets/` | 12 files      | 密钥与配置管理 |

### 1.3 关键文件路径

```
backend/src/modules/
├── ai-engine/                    # AI 核心能力层
│   ├── facade/                   # 统一 API 入口
│   │   ├── ai-engine.facade.ts   # AIEngineFacade (25+ methods)
│   │   └── types/                # 类型定义
│   ├── capabilities/             # 能力解析
│   │   └── ai-capability-resolver.service.ts
│   ├── tools/                    # 工具系统
│   │   ├── registry/tool.registry.ts
│   │   ├── base/base-tool.ts
│   │   └── implementations/      # 46+ 内置工具
│   ├── skills/                   # 技能系统
│   │   ├── registry/skill.registry.ts
│   │   └── loader/skill-loader.service.ts
│   ├── orchestration/            # 编排执行
│   │   └── executors/function-calling-executor.ts
│   ├── mcp/                      # MCP 外部工具
│   │   ├── manager/mcp-manager.ts
│   │   └── tools/mcp-tool-adapter.ts
│   └── search/                   # 搜索服务
│       └── search.service.ts
├── ai-app/                       # AI 应用层
│   ├── ask/                      # AI Ask
│   ├── research/                 # Topic Research
│   ├── teams/                    # AI Teams
│   ├── writing/                  # AI Writing
│   ├── office/                   # AI Office
│   └── coding/                   # AI Coding
└── core/                         # 基础设施层
    ├── secrets/                  # 密钥管理
    │   ├── secrets.service.ts
    │   └── secrets.controller.ts
    └── admin/                    # 管理后台
        ├── ai-admin.service.ts
        └── ai-admin.controller.ts
```

---

## 2. 分层架构

### 2.1 架构原则

```
┌─────────────────────────────────────────────────────────────────┐
│  AI Apps (应用层)                                               │
│  - 业务逻辑聚焦                                                  │
│  - 调用 AI Engine 完成能力需求                                   │
│  - 不直接操作 LLM 或工具                                         │
└─────────────────────────────┬───────────────────────────────────┘
                              │ 通过 AIEngineFacade 调用
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  AI Engine (核心能力层)                                          │
│  - 领域无关的通用机制                                            │
│  - 工具/技能/MCP 管理                                            │
│  - 能力解析与执行编排                                            │
└─────────────────────────────┬───────────────────────────────────┘
                              │ 通过 SecretsService 获取密钥
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Infrastructure (基础设施层)                                     │
│  - 密钥管理 (AES-256-CBC 加密)                                  │
│  - 数据库配置 (Prisma ORM)                                       │
│  - 审计日志                                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 调用约束

| 调用方向                   | 允许 | 禁止     |
| -------------------------- | ---- | -------- |
| AI Apps → AI Engine        | Yes  | -        |
| AI Apps → Infrastructure   | Yes  | -        |
| AI Engine → Infrastructure | Yes  | -        |
| AI Engine → AI Apps        | No   | 循环依赖 |
| Infrastructure → AI Engine | No   | 循环依赖 |

---

## 3. AI Engine 核心层

### 3.1 AIEngineFacade - 统一入口

**位置**: `backend/src/modules/ai-engine/facade/ai-engine.facade.ts`

AIEngineFacade 是 AI Engine 的统一 API 入口，提供 25+ 公共方法：

```typescript
// 核心能力方法
chat(request: ChatRequest): Promise<ChatResponse>
chatWithSkills(request: ChatRequest): Promise<ChatResponse>  // K3 Fix: 自动注入技能
chatStream(request: ChatRequest): AsyncGenerator<StreamChunk>

// 执行能力
executeAgent(request: AgentExecutionRequest): Promise<AgentExecutionResult>
executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult>
executeTools(requests: ToolExecutionRequest[]): Promise<ToolExecutionResult[]>

// 搜索能力
search(request: SearchRequest): Promise<SearchResponse>
webSearch(query: string): Promise<SearchResultItem[]>

// 上下文构建
buildContext(request: BuildContextRequest): Promise<string>
getContextForTopic(topicId: string): Promise<string>

// 模型选择
selectModel(options: ModelSelectionOptions): ModelInfo
getAvailableModels(): ModelInfo[]

// 工具管理
getAvailableTools(): ToolInfo[]
getToolFunctionDefinitions(toolIds?: string[]): FunctionDefinition[]
getCompactToolSummaries(toolIds?: string[]): CompactToolSummary[]

// 技能管理
getSkillPrompts(context: AICapabilityContext): Promise<SkillPromptBundle>

// 记忆管理
storeMemory(request: StoreMemoryRequest): Promise<void>
retrieveMemory(request: RetrieveMemoryRequest): Promise<MemoryItem[]>

// 团队执行
executeTeamMission(teamType: TeamType, input: MissionInput, config?: TeamConfig): Promise<MissionResult>
```

### 3.2 AICapabilityResolver - 能力解析器

**位置**: `backend/src/modules/ai-engine/capabilities/ai-capability-resolver.service.ts`

负责根据上下文解析可用的工具、技能和 MCP 工具：

```typescript
interface AICapabilityContext {
  userId?: string;
  teamId?: string;
  roleId?: string;
  memberId?: string;
  agentId?: string;
  domain?: string;
}

// 核心方法
resolveToolsForAgent(context: AICapabilityContext): Promise<string[]>
resolveSkillsForAgent(context: AICapabilityContext): Promise<string[]>
resolveMCPToolsForAgent(context: AICapabilityContext): Promise<MCPToolRef[]>  // A3 Fix

// 能力映射
capabilityToToolId(capability: AICapability): string | null  // A1 Fix: 完整映射

// 工具包获取
getToolBundle(context: AICapabilityContext): Promise<ToolBundle>
getToolFunctionDefinitions(context: AICapabilityContext): Promise<FunctionDefinition[]>

// 技能提示获取
getSkillPrompts(context: AICapabilityContext): Promise<SkillPromptBundle>
```

### 3.3 FunctionCallingExecutor - 工具执行器

**位置**: `backend/src/modules/ai-engine/orchestration/executors/function-calling-executor.ts`

实现 ReAct (Reasoning + Acting) 执行循环：

```typescript
// 执行流程
async *executeWithContext(
  llmAdapter: ILLMAdapter,
  systemPrompt: string,
  userInput: string,
  context: AICapabilityContext,
  options?: ExecutionOptions
): AsyncGenerator<ExecutionEvent>

// 执行事件类型
type ExecutionEvent =
  | { type: 'thinking', content: string }
  | { type: 'tool_start', toolId: string, input: unknown }
  | { type: 'tool_result', toolId: string, result: unknown }
  | { type: 'tool_error', toolId: string, error: string }
  | { type: 'response', content: string }
  | { type: 'complete', summary: string }
```

**ReAct 循环流程**:

```
1. 接收用户输入
   ↓
2. LLM 思考 (Reasoning)
   ↓
3. LLM 选择工具 (Tool Selection)
   ↓
4. 执行工具 (Acting) ─────┐
   ↓                      │
5. 获取工具结果           │
   ↓                      │
6. 观察结果 (Observation) │
   ↓                      │
7. 判断是否完成 ──────────┘ (循环直到完成)
   ↓
8. 生成最终响应
```

---

## 4. 密钥与配置管理

### 4.1 密钥管理架构

**位置**: `backend/src/modules/ai-infra/secrets/secrets.service.ts`

```
┌─────────────────────────────────────────────────────────────────┐
│                    Secrets Service                               │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  加密层                                               │       │
│  │  - AES-256-CBC 对称加密                              │       │
│  │  - PBKDF2 密钥派生 (100,000 iterations)             │       │
│  │  - 随机 IV (每次加密生成)                            │       │
│  └──────────────────────────────────────────────────────┘       │
│                              │                                   │
│  ┌──────────────────────────┴───────────────────────────┐       │
│  │  数据模型                                             │       │
│  │  Secret                                               │       │
│  │  ├── id: string                                       │       │
│  │  ├── name: string (唯一标识)                         │       │
│  │  ├── encryptedValue: string (加密后的值)             │       │
│  │  ├── category: SecretCategory                        │       │
│  │  ├── isActive: boolean                               │       │
│  │  ├── expiresAt: DateTime?                            │       │
│  │  └── metadata: Json                                   │       │
│  └──────────────────────────────────────────────────────┘       │
│                              │                                   │
│  ┌──────────────────────────┴───────────────────────────┐       │
│  │  API 方法                                             │       │
│  │  getValue(name): Promise<string | null>              │       │
│  │  createSecret(data): Promise<Secret>                 │       │
│  │  updateSecret(name, value): Promise<Secret>          │       │
│  │  rotateSecret(name): Promise<SecretVersion>          │       │
│  │  deleteSecret(name): Promise<void>                   │       │
│  └──────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 密钥分类

```typescript
enum SecretCategory {
  AI_SERVICE = "AI_SERVICE", // AI 服务密钥 (OpenAI, Anthropic)
  SEARCH = "SEARCH", // 搜索服务密钥 (Tavily, Serper)
  SOCIAL = "SOCIAL", // 社交平台密钥 (Twitter, LinkedIn)
  STORAGE = "STORAGE", // 存储服务密钥 (S3, GCS)
  DATABASE = "DATABASE", // 数据库连接
  MCP = "MCP", // MCP 服务器密钥
  POLICY = "POLICY", // 政策研究服务
  OTHER = "OTHER", // 其他
}
```

### 4.3 工具配置与密钥关联

**数据模型**: `ToolConfig`

```prisma
model ToolConfig {
  id          String   @id @default(uuid())
  toolId      String   @unique @map("tool_id")
  enabled     Boolean  @default(true)
  secretKey   String?  @map("secret_key")  // 关联 Secret.name
  config      Json     @default("{}")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**密钥获取流程**:

```
Tool.execute(input)
    ↓
Tool.getApiKey()
    ↓
SecretsService.getValue(toolConfig.secretKey)
    ↓
解密并返回 API Key
```

### 4.4 MCP 服务器密钥配置

**数据模型**: `MCPServerConfig`

```prisma
model MCPServerConfig {
  id          String   @id @default(uuid())
  serverId    String   @unique @map("server_id")
  name        String
  type        String   // 'sse' | 'stdio' | 'ws'
  url         String?
  command     String?
  args        Json?    @default("[]")
  env         Json?    @default("{}")
  apiKey      String?  @map("api_key")      // 直接存储 (不推荐)
  secretKey   String?  @map("secret_key")   // 关联 Secret.name (推荐)
  isEnabled   Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**M2 Fix**: 当 `secretKey` 存在时优先使用，通过 SecretsService 获取实际值。

---

## 5. 工具系统

### 5.1 工具注册表

**位置**: `backend/src/modules/ai-engine/tools/registry/tool.registry.ts`

```typescript
@Injectable()
class ToolRegistry extends BaseRegistry<ITool> {
  // 索引结构
  private readonly byCategory = new Map<string, Set<string>>();
  private readonly byTag = new Map<string, Set<string>>();

  // 核心方法
  register(tool: ITool): void;
  unregister(id: string): boolean;
  getByCategory(category: ToolCategory): ITool[];
  getByTag(tag: string): ITool[];
  getEnabled(): ITool[];

  // Function Definition 获取
  getAllFunctionDefinitions(): FunctionDefinition[];
  getFunctionDefinitions(ids: string[]): FunctionDefinition[];

  // 精简摘要 (节省 Token)
  getAllCompactSummaries(): CompactToolSummary[];
  getCompactSummaries(ids: string[]): CompactToolSummary[];

  // Token 估算
  estimateTokens(ids: string[], compact?: boolean): number;
}
```

### 5.2 工具分类

```typescript
type ToolCategory =
  | "information" // 信息获取 (搜索、爬虫)
  | "generation" // 内容生成 (文本、图像)
  | "processing" // 数据处理 (分析、转换)
  | "execution" // 任务执行 (代码、命令)
  | "integration" // 外部集成 (API、服务)
  | "memory" // 记忆管理
  | "export" // 导出功能
  | "collaboration"; // 协作功能
```

### 5.3 工具接口

**位置**: `backend/src/modules/ai-engine/tools/abstractions/tool.interface.ts`

```typescript
interface ITool {
  // 标识
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategory;

  // 状态
  enabled: boolean;
  tags?: string[];

  // 执行
  execute(input: unknown, context?: ToolExecutionContext): Promise<ToolResult>;

  // 元数据
  toFunctionDefinition(): FunctionDefinition;
  toCompactSummary(): CompactToolSummary; // 精简版 (节省 Token)
}

interface ToolExecutionContext {
  userId?: string;
  sessionId?: string;
  workspaceId?: string;
  teamId?: string;
  memberId?: string;
}
```

### 5.4 内置工具清单 (46+ 工具)

| 类别        | 工具 ID          | 功能描述                 |
| ----------- | ---------------- | ------------------------ |
| information | web-search       | Web 搜索 (Tavily/Serper) |
| information | academic-search  | 学术搜索                 |
| information | news-search      | 新闻搜索                 |
| information | url-fetch        | URL 内容抓取             |
| information | pdf-extract      | PDF 内容提取             |
| generation  | text-generation  | 文本生成                 |
| generation  | image-generation | 图像生成                 |
| generation  | code-generation  | 代码生成                 |
| processing  | text-analysis    | 文本分析                 |
| processing  | data-transform   | 数据转换                 |
| processing  | json-parse       | JSON 解析                |
| execution   | code-execute     | 代码执行                 |
| integration | github-api       | GitHub API               |
| integration | notion-api       | Notion API               |
| memory      | memory-store     | 记忆存储                 |
| memory      | memory-retrieve  | 记忆检索                 |
| export      | markdown-export  | Markdown 导出            |
| export      | pdf-export       | PDF 导出                 |
| ...         | ...              | ...                      |

### 5.5 MCP 工具适配

**位置**: `backend/src/modules/ai-engine/mcp/tools/mcp-tool-adapter.ts`

```typescript
class MCPToolAdapter implements ITool {
  constructor(
    private readonly mcpManager: MCPManager,
    private readonly serverId: string,
    private readonly toolDef: MCPToolDefinition,
  ) {}

  // 将 MCP 工具适配为 ITool 接口
  async execute(
    input: unknown,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    return this.mcpManager.executeTool(this.serverId, this.toolDef.name, input);
  }

  toFunctionDefinition(): FunctionDefinition {
    return {
      name: `mcp_${this.serverId}_${this.toolDef.name}`,
      description: this.toolDef.description,
      parameters: this.toolDef.inputSchema,
    };
  }
}
```

---

## 6. 技能系统

### 6.1 技能注册表

**位置**: `backend/src/modules/ai-engine/skills/registry/skill.registry.ts`

```typescript
@Injectable()
class SkillRegistry extends BaseRegistry<ISkill> {
  // 核心方法
  register(skill: ISkill): void;
  getByDomain(domain: string): ISkill[];
  getByTaskType(taskType: string): ISkill[];
  getEnabled(): ISkill[];

  // 技能提示构建
  buildSkillPrompts(
    skillIds: string[],
    context?: Record<string, unknown>,
  ): string;
}
```

### 6.2 技能加载器

**位置**: `backend/src/modules/ai-engine/skills/loader/skill-loader.service.ts`

```typescript
@Injectable()
class SkillLoaderService {
  // 从文件系统加载 SKILL.md
  async loadSkill(skillPath: string): Promise<ISkill>;
  async scanSkillFiles(baseDir: string): Promise<ISkill[]>;

  // 技能文件格式
  // skills/{domain}/{skill-name}/SKILL.md
}
```

### 6.3 技能文件结构

```
skills/
├── research/
│   ├── outline-planning/
│   │   └── SKILL.md
│   ├── evidence-analysis/
│   │   └── SKILL.md
│   └── report-synthesis/
│       └── SKILL.md
├── writing/
│   ├── creative-writing/
│   │   └── SKILL.md
│   └── technical-writing/
│       └── SKILL.md
└── coding/
    ├── code-review/
    │   └── SKILL.md
    └── refactoring/
        └── SKILL.md
```

### 6.4 SKILL.md 格式

```markdown
# Skill Name

## Metadata

- domain: research
- taskType: analysis
- priority: 1

## Prompt

你是一个专业的研究分析师...

## Variables

- {{topic}}: 研究主题
- {{context}}: 上下文信息

## Examples

...
```

### 6.5 K3 Fix: 统一技能注入

**修复前问题**: 直接调用 `chat()` 方法不会注入技能提示。

**修复后**: 使用 `chatWithSkills()` 自动注入技能：

```typescript
// AIEngineFacade.chatWithSkills()
async chatWithSkills(request: ChatRequest): Promise<ChatResponse> {
  // 1. 构建能力上下文
  const context: AICapabilityContext = {
    domain: request.domain,
    taskType: request.taskType,
    userId: request.skillContext?.userId as string
  };

  // 2. 获取技能提示
  const skillBundle = await this.capabilityResolver.getSkillPrompts(context);

  // 3. 注入到 System Message
  const enhancedMessages = this.injectSkillPrompts(
    request.messages,
    skillBundle.content
  );

  // 4. 执行 LLM 调用
  return this.llmService.chat({
    ...request,
    messages: enhancedMessages
  });
}
```

---

## 7. AI Teams 协作层

### 7.1 团队架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Team                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Team Leader (LeaderAgent)                                │   │
│  │  - 任务解析与分解                                         │   │
│  │  - 任务分配                                               │   │
│  │  - 结果整合                                               │   │
│  │  - 质量控制                                               │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                              │ 分配任务                          │
│         ┌────────────────────┼────────────────────┐              │
│         ▼                    ▼                    ▼              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ Team Member 1│    │ Team Member 2│    │ Team Member 3│       │
│  │ (Researcher) │    │ (Analyst)    │    │ (Reviewer)   │       │
│  │              │    │              │    │              │       │
│  │ capabilities:│    │ capabilities:│    │ capabilities:│       │
│  │ - WEB_SEARCH │    │ - DATA_PROC  │    │ - REVIEW     │       │
│  │ - PDF_EXTRACT│    │ - ANALYSIS   │    │ - CRITIQUE   │       │
│  │              │    │              │    │              │       │
│  │ mcpTools:    │    │ mcpTools:    │    │ mcpTools:    │       │
│  │ - browser    │    │ - calculator │    │ - checker    │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Mission 生命周期

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ CREATED │ ──► │ QUEUED  │ ──► │ PARSING │ ──► │PLANNING │
└─────────┘     └─────────┘     └─────────┘     └─────────┘
                                                      │
     ┌────────────────────────────────────────────────┘
     ▼
┌─────────┐     ┌──────────┐     ┌───────────┐     ┌───────────┐
│EXECUTING│ ──► │ REVIEWING│ ──► │ DELIVERING│ ──► │ COMPLETED │
└─────────┘     └──────────┘     └───────────┘     └───────────┘
     │               │
     │               │
     ▼               ▼
┌─────────┐     ┌─────────┐
│ PAUSED  │     │ FAILED  │
└─────────┘     └─────────┘
```

### 7.3 AICapability 到 ToolId 映射

**位置**: `backend/src/modules/ai-engine/capabilities/ai-capability-resolver.service.ts`

```typescript
// A1 Fix: 完整的能力映射
private readonly CAPABILITY_TOOL_MAPPING: Record<AICapability, string[]> = {
  // 搜索能力
  [AICapability.WEB_SEARCH]: ['web-search', 'url-fetch'],
  [AICapability.ACADEMIC_SEARCH]: ['academic-search'],
  [AICapability.NEWS_SEARCH]: ['news-search'],

  // 生成能力
  [AICapability.TEXT_GENERATION]: ['text-generation'],
  [AICapability.IMAGE_GENERATION]: ['image-generation'],
  [AICapability.CODE_GENERATION]: ['code-generation'],

  // 处理能力
  [AICapability.DATA_PROCESSING]: ['text-analysis', 'data-transform'],
  [AICapability.PDF_EXTRACTION]: ['pdf-extract'],

  // 执行能力
  [AICapability.CODE_EXECUTION]: ['code-execute'],

  // 集成能力
  [AICapability.GITHUB_INTEGRATION]: ['github-api'],
  [AICapability.NOTION_INTEGRATION]: ['notion-api'],

  // 记忆能力
  [AICapability.MEMORY_STORE]: ['memory-store'],
  [AICapability.MEMORY_RETRIEVE]: ['memory-retrieve'],
};

// 解析成员工具
async resolveToolsForMember(memberId: string): Promise<string[]> {
  const member = await this.getMemberConfig(memberId);

  // 1. 从 capabilities 映射内置工具
  const builtinTools = member.capabilities
    .flatMap(cap => this.CAPABILITY_TOOL_MAPPING[cap] || []);

  // 2. A3 Fix: 添加 MCP 工具
  const mcpTools = await this.resolveMCPToolsForMember(memberId);

  return [...new Set([...builtinTools, ...mcpTools.map(t => t.toolId)])];
}
```

### 7.4 协作模式

```typescript
type CollaborationMode =
  | "sequential" // 顺序执行
  | "parallel" // 并行执行
  | "debate"; // 辩论模式

// 辩论模式流程
interface DebateWorkflow {
  rounds: number;
  participants: TeamMember[];
  moderator: LeaderAgent;

  // 每轮流程
  // 1. 正方陈述
  // 2. 反方陈述
  // 3. 交叉质询
  // 4. 主持人总结
}
```

---

## 8. Topic Research 业务流程实例

### 8.1 完整业务流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Topic Research 完整流程                               │
└─────────────────────────────────────────────────────────────────────────────┘

用户创建 Topic
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  1. 初始化阶段                                                               │
│  TopicResearchService.initializeResearch(topicId)                           │
│  ├── 创建 DraftReport (状态: DRAFT)                                         │
│  ├── 根据 Topic 类型选择维度模板                                             │
│  │   ├── MACRO_INSIGHT_DIMENSIONS (宏观洞察)                                │
│  │   │   └── policy, market, competition, technology,                       │
│  │   │       investment, talent, international, application                 │
│  │   └── TECH_INSIGHT_DIMENSIONS (技术洞察)                                 │
│  │       └── core_tech, ecosystem, trends, comparison,                      │
│  │           use_cases, challenges, future                                  │
│  └── 为每个维度创建 TopicDimension 记录                                      │
└──────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  2. 团队组建阶段                                                             │
│  TopicTeamOrchestratorService.createResearchTeam(topicId)                   │
│  ├── 创建 Leader Agent                                                       │
│  │   ├── systemPrompt: 研究协调员提示词                                     │
│  │   └── capabilities: TASK_DECOMPOSITION, QUALITY_CONTROL                  │
│  ├── 创建 Researcher Members (每个维度一个)                                  │
│  │   ├── systemPrompt: 维度专家提示词                                       │
│  │   └── capabilities: WEB_SEARCH, ACADEMIC_SEARCH, PDF_EXTRACTION          │
│  ├── 创建 Reviewer Member                                                    │
│  │   ├── systemPrompt: 质量审核员提示词                                     │
│  │   └── capabilities: REVIEW, CRITIQUE                                     │
│  └── 创建 Synthesizer Member                                                 │
│      ├── systemPrompt: 报告综合员提示词                                     │
│      └── capabilities: TEXT_GENERATION, REPORT_SYNTHESIS                    │
└──────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  3. 能力解析阶段                                                             │
│  AICapabilityResolver.resolveToolsForAgent(context)                         │
│  ├── 为每个成员解析可用工具                                                  │
│  │   ├── 内置工具: capabilityToToolId() 映射                                │
│  │   │   └── WEB_SEARCH → ['web-search', 'url-fetch']                      │
│  │   └── MCP 工具: resolveMCPToolsForAgent()                               │
│  │       └── playwright → ['browser_navigate', 'browser_click', ...]       │
│  ├── 为每个成员解析可用技能                                                  │
│  │   └── 根据 domain + taskType 匹配技能                                    │
│  └── 构建 FunctionDefinitions                                                │
│      └── 发送给 LLM 作为可用工具列表                                         │
└──────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  4. 并行研究阶段                                                             │
│  TopicTeamOrchestratorService.researchDimensionsInParallel()                │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  DimensionResearchService.researchDimension(dimension)                  │ │
│  │  ├── 更新状态: RESEARCHING                                              │ │
│  │  ├── 获取搜索查询 (dimension.searchQueries)                            │ │
│  │  ├── 执行数据采集                                                       │ │
│  │  │   └── DataSourceRouter.fetchData(sources, queries)                  │ │
│  │  │       ├── web-search: Tavily/Serper API                             │ │
│  │  │       │   └── SecretsService.getValue('TAVILY_API_KEY')             │ │
│  │  │       ├── academic-search: Semantic Scholar API                     │ │
│  │  │       └── news-search: News API                                     │ │
│  │  ├── 准备证据数据                                                       │ │
│  │  │   └── prepareEvidenceData(rawResults)                               │ │
│  │  ├── AI 分析                                                            │ │
│  │  │   └── AIEngineFacade.chatWithSkills({                               │ │
│  │  │         messages: analysisPrompt,                                   │ │
│  │  │         domain: 'research',                                         │ │
│  │  │         taskType: 'dimension_analysis'                              │ │
│  │  │       })                                                            │ │
│  │  │       └── 自动注入 evidence-analysis 技能                           │ │
│  │  ├── 可信度评估                                                         │ │
│  │  │   └── assessCredibility(evidence)                                   │ │
│  │  ├── 保存证据                                                           │ │
│  │  │   └── TopicEvidence.create(dimension, evidence, analysis)           │ │
│  │  └── 更新状态: COMPLETED                                                │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  并行执行 8 个维度研究 (Promise.allSettled)                                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                            │
│  │ policy  │ │ market  │ │ compet. │ │  tech   │ ...                        │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘                            │
└──────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  5. 质量审核阶段                                                             │
│  ResearchReviewerService.reviewResearchQuality(draftReport)                 │
│  ├── 遍历每个维度的研究结果                                                  │
│  ├── 评估维度                                                                │
│  │   ├── 证据充分性 (evidenceSufficiency)                                   │
│  │   ├── 来源可信度 (sourceCredibility)                                     │
│  │   ├── 分析深度 (analysisDepth)                                           │
│  │   ├── 信息时效性 (informationRecency)                                    │
│  │   └── 观点平衡性 (perspectiveBalance)                                    │
│  ├── 生成审核报告                                                            │
│  │   └── AIEngineFacade.chat({                                              │
│  │         messages: reviewPrompt,                                          │
│  │         taskProfile: { creativity: 'low', outputLength: 'medium' }       │
│  │       })                                                                  │
│  └── 返回审核结果                                                            │
│      ├── overallScore: number (0-100)                                        │
│      ├── passThreshold: boolean                                              │
│      └── suggestions: string[]                                               │
└──────────────────────────────────────────────────────────────────────────────┘
       │
       ├── 未通过 ──► 返回并行研究阶段 (补充研究)
       │
       ▼ 通过
┌──────────────────────────────────────────────────────────────────────────────┐
│  6. 报告综合阶段                                                             │
│  ReportSynthesisService.synthesizeReport(draftReport)                       │
│  ├── 收集所有维度分析结果                                                    │
│  ├── 构建综合提示词                                                          │
│  │   └── 包含 Topic 元信息 + 各维度分析 + 综合要求                          │
│  ├── 调用 AI 生成报告                                                        │
│  │   └── AIEngineFacade.chatWithSkills({                                    │
│  │         messages: synthesisPrompt,                                       │
│  │         domain: 'research',                                              │
│  │         taskType: 'report_synthesis',                                    │
│  │         taskProfile: { creativity: 'medium', outputLength: 'long' }      │
│  │       })                                                                  │
│  │       └── 自动注入 report-synthesis 技能                                 │
│  ├── 解析报告结构                                                            │
│  │   ├── executive_summary: 执行摘要                                        │
│  │   ├── key_findings: 关键发现                                             │
│  │   ├── dimension_analyses: 维度分析                                       │
│  │   ├── strategic_recommendations: 战略建议                                │
│  │   └── risk_assessment: 风险评估                                          │
│  └── 保存最终报告                                                            │
│      └── TopicReport.create(topic, reportContent)                           │
└──────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  7. 完成阶段                                                                 │
│  ├── 更新 DraftReport 状态: COMPLETED                                        │
│  ├── 更新 Topic 状态: RESEARCH_COMPLETED                                     │
│  ├── 发送完成通知                                                            │
│  └── 记录使用统计 (AIUsageLog)                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 关键服务文件

| 服务                         | 文件路径                                             | 职责               |
| ---------------------------- | ---------------------------------------------------- | ------------------ |
| TopicResearchService         | `ai-app/research/topic-research.service.ts`          | 研究入口，维度模板 |
| TopicTeamOrchestratorService | `ai-app/research/topic-team-orchestrator.service.ts` | 团队编排，流程控制 |
| DimensionResearchService     | `ai-app/research/dimension-research.service.ts`      | 单维度研究执行     |
| ResearchReviewerService      | `ai-app/research/research-reviewer.service.ts`       | 质量审核           |
| ReportSynthesisService       | `ai-app/research/report-synthesis.service.ts`        | 报告综合           |
| DataSourceRouter             | `ai-app/research/data-source-router.service.ts`      | 数据源路由         |

### 8.3 维度模板示例

```typescript
// TopicResearchService 中的维度模板
const MACRO_INSIGHT_DIMENSIONS: DimensionTemplate[] = [
  {
    key: "policy",
    name: "政策法规",
    description: "政策环境、监管动态、合规要求",
    searchQueries: [
      "{{topic}} 相关政策法规",
      "{{topic}} 监管动态",
      "{{topic}} 合规要求",
    ],
    searchSources: ["news", "web", "academic"],
    minSources: 5,
  },
  {
    key: "market",
    name: "市场分析",
    description: "市场规模、增长趋势、竞争格局",
    searchQueries: [
      "{{topic}} 市场规模",
      "{{topic}} 市场增长趋势",
      "{{topic}} 行业报告",
    ],
    searchSources: ["web", "news"],
    minSources: 8,
  },
  // ... 其他 6 个维度
];
```

### 8.4 进度事件流

```typescript
// TopicTeamOrchestratorService 发送的进度事件
type ProgressEvent =
  | { type: "starting"; phase: "initialization" }
  | { type: "team_created"; leader: string; members: string[] }
  | { type: "researching"; dimension: string; progress: number }
  | { type: "dimension_completed"; dimension: string; evidenceCount: number }
  | { type: "reviewing"; phase: "quality_check" }
  | { type: "review_completed"; score: number; passed: boolean }
  | { type: "synthesizing"; phase: "report_generation" }
  | { type: "completed"; reportId: string }
  | { type: "failed"; error: string };

// SSE 推送给前端
async function* executeRefresh(topicId: string): AsyncGenerator<ProgressEvent> {
  yield { type: "starting", phase: "initialization" };

  // 初始化
  const draftReport = await this.createDraftReport(topicId);

  // 并行研究
  const dimensions = await this.getDimensionsToResearch(topicId);
  for await (const progress of this.researchDimensionsInParallel(dimensions)) {
    yield progress;
  }

  // 审核
  yield { type: "reviewing", phase: "quality_check" };
  const reviewResult = await this.reviewResearchQuality(draftReport);
  yield {
    type: "review_completed",
    score: reviewResult.score,
    passed: reviewResult.passed,
  };

  // 综合
  yield { type: "synthesizing", phase: "report_generation" };
  const report = await this.synthesizeReport(draftReport);

  yield { type: "completed", reportId: report.id };
}
```

---

## 9. 数据流图

### 9.1 工具执行数据流

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          工具执行完整数据流                                  │
└─────────────────────────────────────────────────────────────────────────────┘

Agent/Service
     │
     │ executeTool({ toolId: 'web-search', input: { query: '...' } })
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  AIEngineFacade.executeTool()                                               │
│  ├── 验证请求参数                                                            │
│  └── 构建执行上下文                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ToolRegistry.get(toolId)                                                   │
│  ├── 查找工具实例                                                            │
│  └── 检查 enabled 状态 (T2 Fix)                                              │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Tool.execute(input, context)                                               │
│  ├── 验证输入参数                                                            │
│  ├── 获取 API Key                                                            │
│  │   └── SecretsService.getValue(toolConfig.secretKey)                      │
│  │       ├── 查询 Secret 表                                                  │
│  │       ├── 检查 isActive (S5 Fix)                                         │
│  │       ├── 检查 expiresAt                                                  │
│  │       └── 解密返回                                                        │
│  ├── 执行工具逻辑                                                            │
│  │   └── 调用外部 API (如 Tavily)                                           │
│  └── 返回执行结果                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  记录使用日志                                                                │
│  AIUsageLog.create({                                                        │
│    toolId, userId, input, output, duration, tokensUsed                     │
│  })                                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
返回 ToolExecutionResult
```

### 9.2 LLM 调用数据流 (含技能注入)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LLM 调用完整数据流 (K3 Fix 后)                            │
└─────────────────────────────────────────────────────────────────────────────┘

Service
     │
     │ chat({ messages, domain: 'research', taskType: 'analysis' })
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  AIEngineFacade.chatWithSkills()                                            │
│  ├── 构建 AICapabilityContext                                               │
│  │   └── { domain: 'research', taskType: 'analysis', userId: '...' }       │
│  └── 调用能力解析器                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  AICapabilityResolver.getSkillPrompts(context)                              │
│  ├── getGlobalEnabledSkills()                                               │
│  │   └── SELECT * FROM skill_configs WHERE enabled = true                  │
│  ├── 按 domain + taskType 过滤匹配的技能                                     │
│  ├── 加载技能内容                                                            │
│  │   └── SkillRegistry.get(skillId)                                        │
│  │       └── 读取 SKILL.md 文件                                             │
│  └── 构建 SkillPromptBundle                                                 │
│      └── { content: '...技能提示...', usedSkills: ['outline-planning'] }   │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  注入技能到 System Message                                                   │
│  messages = [                                                               │
│    {                                                                        │
│      role: 'system',                                                        │
│      content: originalSystemPrompt + '\n\n' + skillPromptBundle.content    │
│    },                                                                       │
│    ...userMessages                                                          │
│  ]                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LLMService.chat()                                                          │
│  ├── 模型选择                                                                │
│  │   └── 根据 modelType + taskProfile 选择模型                              │
│  ├── 参数映射                                                                │
│  │   └── TaskProfile → temperature, maxTokens                              │
│  ├── 获取 API Key                                                            │
│  │   └── SecretsService.getValue('OPENAI_API_KEY')                         │
│  └── 调用 LLM API                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
返回 ChatResponse
```

### 9.3 MCP 工具数据流

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MCP 工具执行数据流                                   │
└─────────────────────────────────────────────────────────────────────────────┘

FunctionCallingExecutor (LLM 选择了 MCP 工具)
     │
     │ executeToolCall('mcp_playwright_browser_navigate', { url: '...' })
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  判断工具类型                                                                │
│  ├── 内置工具: ToolRegistry.get(toolId)                                     │
│  └── MCP 工具: MCPToolAdapter.execute() (E1 Fix)                            │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     │ MCP 工具路径
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MCPToolAdapter.execute(input, context)                                     │
│  ├── 解析 serverId 和 toolName                                              │
│  │   └── 'mcp_playwright_browser_navigate' → playwright, browser_navigate  │
│  └── 调用 MCPManager                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MCPManager.executeTool(serverId, toolName, input)                          │
│  ├── 获取 MCP 服务器配置                                                     │
│  │   └── MCPServerConfig.findUnique({ where: { serverId } })               │
│  ├── 获取 API Key (M2 Fix)                                                  │
│  │   └── config.secretKey                                                   │
│  │       ? SecretsService.getValue(config.secretKey)                       │
│  │       : config.apiKey                                                    │
│  ├── 建立连接 (如果未连接)                                                   │
│  │   └── 根据 type 选择协议: SSE / stdio / WebSocket                        │
│  └── 发送工具调用请求                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MCP Server (外部进程)                                                       │
│  ├── 接收请求                                                                │
│  ├── 执行工具 (如 Playwright 浏览器操作)                                     │
│  └── 返回结果                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
返回 ToolResult → FunctionCallingExecutor → LLM 继续推理
```

---

## 10. 关键断点与修复记录

### 10.1 已修复断点

| 编号 | 断点                             | 修复内容                       | 文件                                |
| ---- | -------------------------------- | ------------------------------ | ----------------------------------- |
| M1   | SearchService 直接使用环境变量   | 改用 SecretsService.getValue() | `search.service.ts`                 |
| M2   | MCPServerConfig 不支持 secretKey | 添加 secretKey 字段，优先使用  | `mcp-manager.ts`, migration.sql     |
| T2   | enabled=false 不生效             | 统一使用 executeWithContext()  | `function-calling-executor.ts`      |
| A1   | AICapability 映射不完整          | 补充完整映射表                 | `ai-capability-resolver.service.ts` |
| A3   | mcpTools 未被使用                | 集成到 resolveToolsForAgent()  | `ai-capability-resolver.service.ts` |
| K3   | Skill Prompt 未注入              | 实现 chatWithSkills()          | `ai-engine.facade.ts`               |
| E1   | MCP 工具未实现 ITool             | 创建 MCPToolAdapter            | `mcp-tool-adapter.ts`               |

### 10.2 待优化项

| 优先级 | 项目 | 描述                                                |
| ------ | ---- | --------------------------------------------------- |
| P1     | S5   | getValue() 添加 isActive 检查                       |
| P1     | A2   | 统一 TeamMemberAgent 和 AICapabilityResolver 的映射 |
| P2     | T4   | 启动时验证 ToolConfig 与 ToolRegistry 同步          |
| P2     | K4   | Token 预算动态调整机制                              |
| P2     | D1   | Context 传递添加默认值和验证                        |

### 10.3 诊断 API

```bash
# 工具诊断
curl http://localhost:3001/api/admin/ai/tools/diagnose

# 全配置聚合
curl http://localhost:3001/api/admin/ai/all-configs

# 密钥状态检查
curl http://localhost:3001/api/admin/secrets/status
```

---

## 附录

### A. 类型定义索引

| 类型                 | 文件                                     | 描述           |
| -------------------- | ---------------------------------------- | -------------- |
| ChatRequest          | `facade/types/facade.types.ts`           | 聊天请求       |
| ChatResponse         | `facade/types/facade.types.ts`           | 聊天响应       |
| TaskProfile          | `facade/types/facade.types.ts`           | 任务画像       |
| AICapabilityContext  | `capabilities/types.ts`                  | 能力上下文     |
| ITool                | `tools/abstractions/tool.interface.ts`   | 工具接口       |
| ISkill               | `skills/abstractions/skill.interface.ts` | 技能接口       |
| ToolExecutionContext | `tools/abstractions/tool.interface.ts`   | 工具执行上下文 |
| FunctionDefinition   | `tools/abstractions/tool.interface.ts`   | 函数定义       |

### B. 配置表结构

```prisma
// 密钥配置
model Secret {
  id             String         @id @default(uuid())
  name           String         @unique
  encryptedValue String
  category       SecretCategory
  isActive       Boolean        @default(true)
  expiresAt      DateTime?
  metadata       Json           @default("{}")
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
}

// 工具配置
model ToolConfig {
  id        String   @id @default(uuid())
  toolId    String   @unique
  enabled   Boolean  @default(true)
  secretKey String?  // 关联 Secret.name
  config    Json     @default("{}")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 技能配置
model SkillConfig {
  id        String   @id @default(uuid())
  skillId   String   @unique
  enabled   Boolean  @default(true)
  priority  Int      @default(0)
  config    Json     @default("{}")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// MCP 服务器配置
model MCPServerConfig {
  id        String   @id @default(uuid())
  serverId  String   @unique
  name      String
  type      String
  url       String?
  command   String?
  args      Json?    @default("[]")
  env       Json?    @default("{}")
  apiKey    String?
  secretKey String?  // 关联 Secret.name (推荐)
  isEnabled Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

---

**文档版本**: v1.0
**创建日期**: 2026-01-21
**维护者**: Claude Code
**基于代码**: commit ff5ce052 (main)

