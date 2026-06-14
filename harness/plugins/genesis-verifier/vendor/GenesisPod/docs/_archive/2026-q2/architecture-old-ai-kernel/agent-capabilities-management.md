# AI Agent 能力管理系统设计方案

> **版本**: v1.0
> **日期**: 2026-01-12
> **状态**: 待评审
> **作者**: Claude Code

---

## 1. 背景与目标

### 1.1 核心诉求

1. **AI Agent Teams 是项目核心** - 多智能体协作系统
2. **每个 Agent 成员应具备 Tools 能力和 Skills 能力**
3. **需要集中管理的地方（管理员配置）**
4. **实际使用时，Agent 能获取相应的能力**

### 1.2 设计目标

| 目标         | 描述                                   |
| ------------ | -------------------------------------- |
| **统一管理** | 管理员可在一处配置所有 Tools 和 Skills |
| **动态获取** | Agent 运行时能动态获取可用能力         |
| **灵活配置** | 支持启用/禁用、权限控制、参数配置      |
| **可扩展**   | 支持内置能力、MCP 工具、自定义能力     |

---

## 2. 现状分析

### 2.1 AI Engine 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Applications Layer                     │
│   AI Studio, AI Teams, AI Office, AI Writing, Topic Research │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                AI Engine (底座能力层)                         │
│                                                              │
│  ┌──────────────┬──────────────┬──────────────┬──────────┐  │
│  │ ToolRegistry │ SkillRegistry│ AgentRegistry│ MCPManager│  │
│  │  (内存注册)   │  (内存注册)   │  (内存注册)   │  (连接管理)│  │
│  └──────────────┴──────────────┴──────────────┴──────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Orchestration | Collaboration | Constraint | LLM      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Tools 系统现状

| 方面         | 现状                          | 问题        |
| ------------ | ----------------------------- | ----------- |
| **工具定义** | 46 个内置工具 (BUILTIN_TOOLS) | ✅ 完整     |
| **接口设计** | ITool 接口完整                | ✅ 完整     |
| **工具实现** | 大部分只有定义，未实现        | ⚠️ 需补充   |
| **注册机制** | ToolRegistry 内存注册         | ⚠️ 无持久化 |
| **配置管理** | 无                            | ❌ 缺失     |
| **Admin UI** | 硬编码列表                    | ❌ 需重构   |

**现有工具分类（46 个）**：

```
信息获取 (8): web-search, web-scraper, data-fetch, rag-search, database-query, knowledge-graph...
内容生成 (6): text-generation, image-generation, code-generation, audio-generation...
数据处理 (7): data-analysis, file-conversion, file-parser, data-validation...
代码执行 (6): python-executor, javascript-executor, sql-executor, shell-executor...
外部集成 (6): message-push, cloud-storage, github-integration, email-sender...
记忆管理 (5): short-term-memory, long-term-memory, entity-memory...
导出 (4): export-pptx, export-docx, export-pdf, export-image
协作 (6): agent-handoff, human-approval, task-delegation...
```

### 2.3 Skills 系统现状

| 方面         | 现状                               | 问题        |
| ------------ | ---------------------------------- | ----------- |
| **技能层次** | 7 层定义 (understanding → quality) | ✅ 完整     |
| **接口设计** | ISkill 接口完整                    | ✅ 完整     |
| **技能实现** | 17 个 Slides 领域 Skills           | ⚠️ 领域局限 |
| **注册机制** | SkillRegistry 内存注册             | ⚠️ 无持久化 |
| **配置管理** | 无                                 | ❌ 缺失     |
| **Admin UI** | 硬编码列表                         | ❌ 需重构   |

**Skill 层次架构**：

```
1. understanding - 理解层（意图分析、内容分析）
2. planning     - 规划层（大纲规划、叙事规划）
3. design       - 设计层（页面设计、布局选择）
4. content      - 内容层（内容生成、内容压缩）
5. rendering    - 渲染层（模板渲染、图表渲染）
6. optimization - 优化层（布局优化、节奏控制）
7. quality      - 质量层（质量审核、场景推导）
```

### 2.4 MCP 系统现状

| 方面           | 现状                     | 问题    |
| -------------- | ------------------------ | ------- |
| **MCPManager** | 已实现，支持多服务器管理 | ✅ 完整 |
| **客户端**     | 支持 stdio/SSE 连接      | ✅ 完整 |
| **工具调用**   | callTool, callToolAuto   | ✅ 完整 |
| **配置管理**   | 无持久化配置             | ❌ 缺失 |
| **Admin UI**   | 无                       | ❌ 缺失 |

### 2.5 数据库现状

**已有模型**：

```prisma
model AITeamTemplate {
  members AITeamMemberTemplate[]
}

model AITeamMemberTemplate {
  capabilities   AICapability[]  // 内置能力枚举
  mcpTools       Json?           // MCP 工具配置
}
```

**缺失模型**：

- ❌ Tool 配置表
- ❌ Skill 配置表
- ❌ MCP Server 配置表
- ❌ 能力权限映射表

### 2.6 Admin API 现状

**已有端点**：

```
GET /admin/ai-teams/tools   → 返回硬编码列表
GET /admin/ai-teams/skills  → 返回硬编码列表
```

**问题**：未从 Registry 获取实际注册的能力

---

## 3. 核心差距总结

| 领域           | 差距描述               | 优先级 |
| -------------- | ---------------------- | ------ |
| **工具配置**   | 无法动态启用/禁用工具  | P0     |
| **技能配置**   | 无法配置和管理 Skills  | P0     |
| **MCP 管理**   | 无 MCP 服务器配置界面  | P1     |
| **能力获取**   | Agent 获取能力是静态的 | P0     |
| **数据持久化** | 配置不持久化           | P0     |
| **Admin UI**   | 缺少完整的能力管理界面 | P1     |

---

## 4. 系统设计方案

### 4.1 整体架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                      Admin Console UI                            │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐  │
│  │ Tools 管理   │ Skills 管理   │ MCP 管理     │ 能力看板     │  │
│  └──────────────┴──────────────┴──────────────┴──────────────┘  │
└───────────────────────────────┬─────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Admin API Layer                               │
│  GET/PATCH /admin/capabilities/tools                            │
│  GET/PATCH /admin/capabilities/skills                           │
│  GET/POST/DELETE /admin/capabilities/mcp-servers                │
└───────────────────────────────┬─────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                Capability Management Service                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ CapabilityConfigService                                   │   │
│  │ - getToolConfig()      - updateToolConfig()               │   │
│  │ - getSkillConfig()     - updateSkillConfig()              │   │
│  │ - getMCPServerConfig() - updateMCPServerConfig()          │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                     Database Layer                               │
│  ┌──────────────┬──────────────┬──────────────────────────┐     │
│  │ ToolConfig   │ SkillConfig  │ MCPServerConfig          │     │
│  └──────────────┴──────────────┴──────────────────────────┘     │
└───────────────────────────────┬─────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                    AI Engine (Enhanced)                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Enhanced ToolRegistry                                     │   │
│  │ - 启动时从 DB 加载配置                                     │   │
│  │ - 支持运行时 enable/disable                               │   │
│  │ - 提供 getAvailableTools(context) 方法                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Enhanced SkillRegistry                                    │   │
│  │ - 启动时从 DB 加载配置                                     │   │
│  │ - 支持运行时 enable/disable                               │   │
│  │ - 提供 getAvailableSkills(context) 方法                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Enhanced MCPManager                                       │   │
│  │ - 启动时从 DB 加载服务器配置                               │   │
│  │ - 自动连接/重连                                           │   │
│  │ - 提供 getMCPTools() 方法                                 │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                   Agent Runtime                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ CapabilityResolver                                        │   │
│  │ - resolveToolsForAgent(agentId, teamId, userId)           │   │
│  │ - resolveSkillsForAgent(agentId, teamId, userId)          │   │
│  │ - resolveMCPToolsForAgent(agentId, teamId)                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│  Agent 执行时获取：                                              │
│  - 全局启用的 Tools/Skills                                       │
│  - 团队配置的 Tools/Skills                                       │
│  - 成员配置的 MCP Tools                                          │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 数据库模型设计

```prisma
// ============ 能力配置 ============

// 工具配置
model ToolConfig {
  id          String   @id @default(uuid())

  // 工具标识
  toolId      String   @unique @map("tool_id")  // e.g., "web-search"

  // 配置
  enabled     Boolean  @default(true)
  displayName String?  @map("display_name")
  description String?

  // 参数配置（覆盖默认值）
  config      Json?    // { timeout: 30000, retry: { maxRetries: 3 } }

  // 访问控制
  requiresAuth Boolean @default(false) @map("requires_auth")
  allowedRoles String[] @default([]) @map("allowed_roles")  // 空=所有角色

  // 元数据
  category    String?
  tags        String[] @default([])

  // 时间戳
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([enabled])
  @@index([category])
  @@map("tool_configs")
}

// 技能配置
model SkillConfig {
  id          String   @id @default(uuid())

  // 技能标识
  skillId     String   @unique @map("skill_id")  // e.g., "slides-outline-planning"

  // 配置
  enabled     Boolean  @default(true)
  displayName String?  @map("display_name")
  description String?

  // 参数配置
  config      Json?    // { llm: { temperature: 0.7 }, enableFallback: true }

  // 访问控制
  allowedDomains String[] @default([]) @map("allowed_domains")  // 空=所有领域

  // 元数据
  layer       String?
  domain      String?
  tags        String[] @default([])

  // 时间戳
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([enabled])
  @@index([domain])
  @@map("skill_configs")
}

// MCP 服务器配置
model MCPServerConfig {
  id          String   @id @default(uuid())

  // 服务器标识
  serverId    String   @unique @map("server_id")  // e.g., "duckduckgo"

  // 基本信息
  name        String
  description String?

  // 连接配置
  transport   String   // "stdio" | "sse"
  command     String?  // stdio: 启动命令
  args        String[] @default([])  // stdio: 命令参数
  url         String?  // sse: 服务器 URL

  // 状态
  enabled     Boolean  @default(true)
  autoConnect Boolean  @default(true) @map("auto_connect")

  // 认证（如需要）
  apiKey      String?  @map("api_key")  // 加密存储

  // 元数据
  metadata    Json?

  // 时间戳
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([enabled])
  @@map("mcp_server_configs")
}

// 能力使用统计（可选，用于分析）
model CapabilityUsage {
  id           String   @id @default(uuid())

  // 能力标识
  capabilityType String @map("capability_type")  // "tool" | "skill" | "mcp"
  capabilityId   String @map("capability_id")

  // 调用信息
  userId       String?  @map("user_id")
  teamId       String?  @map("team_id")
  agentId      String?  @map("agent_id")

  // 执行结果
  success      Boolean
  duration     Int?     // ms
  tokensUsed   Int?     @map("tokens_used")
  errorCode    String?  @map("error_code")

  // 时间戳
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([capabilityType, capabilityId])
  @@index([createdAt])
  @@map("capability_usages")
}
```

### 4.3 API 设计

#### 4.3.1 Tools 管理 API

```typescript
// GET /admin/capabilities/tools
// 获取所有工具配置
interface GetToolsResponse {
  tools: Array<{
    id: string;
    toolId: string;
    name: string;
    description: string;
    category: string;
    enabled: boolean;
    config: ToolConfig | null;
    // 来自 Registry
    implemented: boolean; // 是否已实现
    tags: string[];
  }>;
  stats: {
    total: number;
    enabled: number;
    implemented: number;
    byCategory: Record<string, number>;
  };
}

// PATCH /admin/capabilities/tools/:toolId
// 更新工具配置
interface UpdateToolRequest {
  enabled?: boolean;
  displayName?: string;
  description?: string;
  config?: {
    timeout?: number;
    retry?: { maxRetries: number; delay: number };
    [key: string]: unknown;
  };
  allowedRoles?: string[];
}

// POST /admin/capabilities/tools/:toolId/test
// 测试工具
interface TestToolRequest {
  input: Record<string, unknown>;
}
interface TestToolResponse {
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
}
```

#### 4.3.2 Skills 管理 API

```typescript
// GET /admin/capabilities/skills
// 获取所有技能配置
interface GetSkillsResponse {
  skills: Array<{
    id: string;
    skillId: string;
    name: string;
    description: string;
    layer: string;
    domain: string;
    enabled: boolean;
    config: SkillConfig | null;
    requiredTools: string[];
    requiredSkills: string[];
  }>;
  stats: {
    total: number;
    enabled: number;
    byLayer: Record<string, number>;
    byDomain: Record<string, number>;
  };
}

// PATCH /admin/capabilities/skills/:skillId
// 更新技能配置
interface UpdateSkillRequest {
  enabled?: boolean;
  displayName?: string;
  description?: string;
  config?: {
    timeout?: number;
    llm?: { temperature?: number; maxTokens?: number };
    enableFallback?: boolean;
    [key: string]: unknown;
  };
}
```

#### 4.3.3 MCP 管理 API

```typescript
// GET /admin/capabilities/mcp-servers
// 获取所有 MCP 服务器配置
interface GetMCPServersResponse {
  servers: Array<{
    id: string;
    serverId: string;
    name: string;
    description: string;
    transport: "stdio" | "sse";
    enabled: boolean;
    autoConnect: boolean;
    // 运行时状态
    connected: boolean;
    tools: Array<{
      name: string;
      description: string;
      inputSchema: JSONSchema;
    }>;
  }>;
}

// POST /admin/capabilities/mcp-servers
// 添加 MCP 服务器
interface CreateMCPServerRequest {
  serverId: string;
  name: string;
  description?: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  enabled?: boolean;
  autoConnect?: boolean;
  apiKey?: string;
}

// PATCH /admin/capabilities/mcp-servers/:serverId
// 更新 MCP 服务器配置
interface UpdateMCPServerRequest {
  name?: string;
  description?: string;
  enabled?: boolean;
  autoConnect?: boolean;
  command?: string;
  args?: string[];
  url?: string;
  apiKey?: string;
}

// POST /admin/capabilities/mcp-servers/:serverId/connect
// 连接 MCP 服务器

// POST /admin/capabilities/mcp-servers/:serverId/disconnect
// 断开 MCP 服务器

// DELETE /admin/capabilities/mcp-servers/:serverId
// 删除 MCP 服务器配置
```

### 4.4 核心服务设计

#### 4.4.1 CapabilityConfigService

```typescript
@Injectable()
export class CapabilityConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry,
    private readonly mcpManager: MCPManager,
  ) {}

  // ==================== Tools ====================

  async getToolConfigs(): Promise<ToolConfigWithRegistry[]> {
    // 1. 获取所有注册的工具
    const registeredTools = this.toolRegistry.getAll();

    // 2. 获取数据库中的配置
    const dbConfigs = await this.prisma.toolConfig.findMany();
    const configMap = new Map(dbConfigs.map((c) => [c.toolId, c]));

    // 3. 合并
    return registeredTools.map((tool) => ({
      ...tool,
      config: configMap.get(tool.id) || null,
      enabled: configMap.get(tool.id)?.enabled ?? true,
      implemented: this.isToolImplemented(tool),
    }));
  }

  async updateToolConfig(toolId: string, update: UpdateToolDto) {
    return this.prisma.toolConfig.upsert({
      where: { toolId },
      create: { toolId, ...update },
      update,
    });
  }

  // ==================== Skills ====================

  async getSkillConfigs(): Promise<SkillConfigWithRegistry[]> {
    const registeredSkills = this.skillRegistry.getAll();
    const dbConfigs = await this.prisma.skillConfig.findMany();
    const configMap = new Map(dbConfigs.map((c) => [c.skillId, c]));

    return registeredSkills.map((skill) => ({
      ...skill,
      config: configMap.get(skill.id) || null,
      enabled: configMap.get(skill.id)?.enabled ?? true,
    }));
  }

  // ==================== MCP ====================

  async getMCPServerConfigs(): Promise<MCPServerConfigWithStatus[]> {
    const dbConfigs = await this.prisma.mCPServerConfig.findMany({
      where: { enabled: true },
    });

    const results = await Promise.all(
      dbConfigs.map(async (config) => {
        const client = this.mcpManager.getClient(config.serverId);
        const tools = client?.connected ? await client.listTools() : [];

        return {
          ...config,
          connected: client?.connected ?? false,
          tools,
        };
      }),
    );

    return results;
  }

  async createMCPServer(dto: CreateMCPServerDto) {
    // 1. 保存到数据库
    const config = await this.prisma.mCPServerConfig.create({
      data: dto,
    });

    // 2. 注册到 MCPManager
    this.mcpManager.registerServer({
      id: config.serverId,
      name: config.name,
      transport: config.transport as "stdio" | "sse",
      command: config.command,
      args: config.args,
      url: config.url,
    });

    // 3. 如果启用自动连接，则连接
    if (config.autoConnect) {
      await this.mcpManager.connect(config.serverId);
    }

    return config;
  }
}
```

#### 4.4.2 CapabilityResolver

```typescript
@Injectable()
export class CapabilityResolver {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry,
    private readonly mcpManager: MCPManager,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 解析 Agent 可用的 Tools
   */
  async resolveToolsForAgent(context: {
    agentId?: string;
    teamId?: string;
    userId?: string;
    roleId?: string;
  }): Promise<string[]> {
    // 1. 获取全局启用的工具
    const enabledTools = await this.getGlobalEnabledTools();

    // 2. 如果有团队，获取团队配置的工具
    let teamTools: string[] = [];
    if (context.teamId) {
      teamTools = await this.getTeamConfiguredTools(context.teamId);
    }

    // 3. 如果有角色，获取角色关联的工具
    let roleTools: string[] = [];
    if (context.roleId) {
      roleTools = await this.getRoleTools(context.roleId);
    }

    // 4. 合并并去重
    const allTools = new Set([...enabledTools, ...teamTools, ...roleTools]);

    return Array.from(allTools);
  }

  /**
   * 解析 Agent 可用的 Skills
   */
  async resolveSkillsForAgent(context: {
    agentId?: string;
    teamId?: string;
    domain?: string;
  }): Promise<string[]> {
    // 1. 获取全局启用的技能
    const enabledSkills = await this.getGlobalEnabledSkills();

    // 2. 如果有领域限制，过滤
    if (context.domain) {
      return enabledSkills.filter((skillId) => {
        const skill = this.skillRegistry.tryGet(skillId);
        return skill?.domain === context.domain || skill?.domain === "common";
      });
    }

    return enabledSkills;
  }

  /**
   * 解析 Agent 可用的 MCP Tools
   */
  async resolveMCPToolsForAgent(context: {
    teamId?: string;
    memberId?: string;
  }): Promise<Array<{ serverId: string; toolName: string }>> {
    // 1. 获取全局启用的 MCP 服务器
    const enabledServers = await this.prisma.mCPServerConfig.findMany({
      where: { enabled: true },
    });

    // 2. 获取已连接服务器的工具
    const mcpTools: Array<{ serverId: string; toolName: string }> = [];

    for (const server of enabledServers) {
      const client = this.mcpManager.getClient(server.serverId);
      if (client?.connected) {
        const tools = await client.listTools();
        for (const tool of tools) {
          mcpTools.push({
            serverId: server.serverId,
            toolName: tool.name,
          });
        }
      }
    }

    // 3. 如果有成员级别配置，合并
    if (context.memberId) {
      const memberMCPTools = await this.getMemberMCPTools(context.memberId);
      mcpTools.push(...memberMCPTools);
    }

    return mcpTools;
  }

  private async getGlobalEnabledTools(): Promise<string[]> {
    const configs = await this.prisma.toolConfig.findMany({
      where: { enabled: true },
      select: { toolId: true },
    });

    // 如果没有配置，返回所有注册的工具
    if (configs.length === 0) {
      return this.toolRegistry.getEnabled().map((t) => t.id);
    }

    return configs.map((c) => c.toolId);
  }

  private async getGlobalEnabledSkills(): Promise<string[]> {
    const configs = await this.prisma.skillConfig.findMany({
      where: { enabled: true },
      select: { skillId: true },
    });

    // 如果没有配置，返回所有注册的技能
    if (configs.length === 0) {
      return this.skillRegistry.getAll().map((s) => s.id);
    }

    return configs.map((c) => c.skillId);
  }
}
```

### 4.5 Admin UI 设计

#### 4.5.1 页面结构

```
/admin/capabilities
├── /tools          # 工具管理
│   ├── 工具列表（分类、状态过滤）
│   ├── 工具详情/配置
│   └── 工具测试
├── /skills         # 技能管理
│   ├── 技能列表（层次、领域过滤）
│   ├── 技能详情/配置
│   └── 技能依赖图
├── /mcp            # MCP 服务器管理
│   ├── 服务器列表
│   ├── 添加服务器
│   ├── 服务器工具预览
│   └── 连接状态监控
└── /dashboard      # 能力看板
    ├── 能力概览
    ├── 使用统计
    └── 健康状态
```

#### 4.5.2 工具管理 UI

```tsx
// frontend/components/admin/CapabilityTools.tsx

export default function CapabilityTools() {
  return (
    <div className="space-y-6">
      {/* 工具统计卡片 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="总工具数" value={stats.total} />
        <StatCard title="已启用" value={stats.enabled} color="green" />
        <StatCard title="已实现" value={stats.implemented} color="blue" />
        <StatCard title="MCP 工具" value={stats.mcp} color="purple" />
      </div>

      {/* 过滤器 */}
      <div className="flex gap-4">
        <CategoryFilter categories={categories} />
        <StatusFilter />
        <SearchInput placeholder="搜索工具..." />
      </div>

      {/* 工具列表 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            onToggle={handleToggle}
            onConfigure={handleConfigure}
            onTest={handleTest}
          />
        ))}
      </div>
    </div>
  );
}

// 工具卡片
function ToolCard({ tool, onToggle, onConfigure, onTest }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between">
          <div>
            <CardTitle>{tool.name}</CardTitle>
            <Badge variant={tool.category}>{tool.category}</Badge>
          </div>
          <Switch checked={tool.enabled} onCheckedChange={onToggle} />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted">{tool.description}</p>
        <div className="flex gap-2 mt-4">
          {tool.implemented ? (
            <Badge variant="success">已实现</Badge>
          ) : (
            <Badge variant="warning">仅定义</Badge>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" onClick={() => onConfigure(tool)}>
          配置
        </Button>
        <Button variant="outline" onClick={() => onTest(tool)}>
          测试
        </Button>
      </CardFooter>
    </Card>
  );
}
```

#### 4.5.3 MCP 管理 UI

```tsx
// frontend/components/admin/CapabilityMCP.tsx

export default function CapabilityMCP() {
  return (
    <div className="space-y-6">
      {/* 添加服务器 */}
      <Card>
        <CardHeader>
          <CardTitle>添加 MCP 服务器</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="preset">
            <TabsList>
              <TabsTrigger value="preset">预设服务器</TabsTrigger>
              <TabsTrigger value="custom">自定义</TabsTrigger>
            </TabsList>

            <TabsContent value="preset">
              <div className="grid gap-4 md:grid-cols-3">
                {PRESET_MCP_SERVERS.map((preset) => (
                  <PresetServerCard
                    key={preset.id}
                    preset={preset}
                    onAdd={handleAddPreset}
                  />
                ))}
              </div>
            </TabsContent>

            <TabsContent value="custom">
              <MCPServerForm onSubmit={handleAddCustom} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* 已配置服务器 */}
      <div className="space-y-4">
        {servers.map((server) => (
          <MCPServerCard
            key={server.id}
            server={server}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}

// 预设 MCP 服务器（可直接添加）
const PRESET_MCP_SERVERS = [
  {
    id: "duckduckgo",
    name: "DuckDuckGo Search",
    description: "隐私搜索引擎",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-ddg-search"],
    icon: "🦆",
  },
  {
    id: "filesystem",
    name: "File System",
    description: "文件系统访问",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    icon: "📁",
  },
  {
    id: "github",
    name: "GitHub",
    description: "GitHub API 访问",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    requiresApiKey: true,
    icon: "🐙",
  },
];
```

---

## 5. 实施计划

### Phase 1: 数据库与基础服务（Week 1）

| 任务 | 描述                                                        | 优先级 |
| ---- | ----------------------------------------------------------- | ------ |
| 1.1  | 创建 Prisma 模型 (ToolConfig, SkillConfig, MCPServerConfig) | P0     |
| 1.2  | 实现 CapabilityConfigService                                | P0     |
| 1.3  | 实现 CapabilityResolver                                     | P0     |
| 1.4  | 增强 ToolRegistry 和 SkillRegistry                          | P0     |

### Phase 2: Admin API（Week 1-2）

| 任务 | 描述                      | 优先级 |
| ---- | ------------------------- | ------ |
| 2.1  | 实现 Tools 管理 API       | P0     |
| 2.2  | 实现 Skills 管理 API      | P0     |
| 2.3  | 实现 MCP 管理 API         | P1     |
| 2.4  | 更新现有 AITeamsAdmin API | P1     |

### Phase 3: Admin UI（Week 2-3）

| 任务 | 描述                 | 优先级 |
| ---- | -------------------- | ------ |
| 3.1  | 创建 Tools 管理页面  | P0     |
| 3.2  | 创建 Skills 管理页面 | P0     |
| 3.3  | 创建 MCP 管理页面    | P1     |
| 3.4  | 创建能力看板         | P2     |

### Phase 4: Agent 集成（Week 3-4）

| 任务 | 描述                          | 优先级 |
| ---- | ----------------------------- | ------ |
| 4.1  | 更新 Agent 运行时获取能力逻辑 | P0     |
| 4.2  | 更新 Teams Orchestrator 集成  | P0     |
| 4.3  | 添加能力使用统计              | P2     |
| 4.4  | 测试和文档                    | P1     |

---

## 6. 关键决策记录

### 6.1 配置存储位置

**决策**: 使用数据库存储配置，内存 Registry 作为运行时缓存

**理由**:

- 配置需要持久化
- 支持运行时修改
- 便于多实例部署

### 6.2 能力解析策略

**决策**: 多层级解析（全局 → 团队 → 成员）

**理由**:

- 灵活的权限控制
- 支持团队级别定制
- 向后兼容现有配置

### 6.3 MCP 集成方式

**决策**: MCP 作为一等公民，与内置 Tools 同等地位

**理由**:

- MCP 是标准协议
- 便于扩展外部能力
- 支持社区生态

---

## 7. 风险与缓解

| 风险           | 影响 | 缓解措施                   |
| -------------- | ---- | -------------------------- |
| 配置迁移复杂   | 中   | 提供迁移脚本，默认全部启用 |
| 性能影响       | 低   | 使用缓存，懒加载           |
| MCP 服务不稳定 | 中   | 重连机制，降级策略         |
| 向后兼容       | 高   | 渐进式改造，保留旧接口     |

---

## 8. 附录

### 8.1 相关文件

| 文件                                    | 说明        |
| --------------------------------------- | ----------- |
| `backend/src/modules/ai-engine/tools/`  | Tools 系统  |
| `backend/src/modules/ai-engine/skills/` | Skills 系统 |
| `backend/src/modules/ai-engine/mcp/`    | MCP 系统    |
| `backend/src/modules/ai-infra/admin/`   | Admin 服务  |
| `frontend/components/admin/`            | Admin UI    |

### 8.2 参考资源

- [MCP 协议规范](https://modelcontextprotocol.io/)
- [AI Engine 架构文档](../ai-engine/README.md)
- [AI Teams 设计文档](../ai-teams/README.md)
