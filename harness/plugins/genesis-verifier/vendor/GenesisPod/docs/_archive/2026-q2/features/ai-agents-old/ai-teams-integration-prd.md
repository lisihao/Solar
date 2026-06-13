# AI Teams 模块整合 PRD

## 文档信息

| 属性     | 内容                                                 |
| -------- | ---------------------------------------------------- |
| 版本     | 1.0                                                  |
| 作者     | PM Agent                                             |
| 创建日期 | 2025-12-19                                           |
| 状态     | 草稿                                                 |
| 前置文档 | [AI 模块整合指南](./ai-modules-integration-guide.md) |
| 优先级   | P0                                                   |
| 整合评分 | 88/100                                               |

---

## 1. 概述

### 1.1 背景

ai-teams 模块是 GenesisPod 中的多 AI 协作团队系统，支持用户创建讨论组并邀请多个 AI 成员参与协作。当前模块存在以下核心问题：

1. **AI 成员无工具能力**：AI 成员仅能进行文本对话，无法执行搜索、分析、代码执行等操作
2. **角色定义简单**：虽然有 roleDescription 字段，但缺乏与专业能力的绑定
3. **成员间协作受限**：无法进行任务委派、共识机制等高级协作
4. **团队任务执行效率低**：Leader 分配任务后，成员执行能力有限

### 1.2 现状分析

**已有能力**：

- `AiTeamsModule` 已导入 `AiAgentsModule`
- `TeamMemberAgent` 类已创建，包含角色到工具的映射
- 支持辩论模式（DebateService）
- 支持团队任务（TeamMissionService）
- 支持 AI 成员间 @ 提及

**待完善**：

- `TeamMemberAgent` 未集成到 `AiResponseService`
- 工具执行未与消息生成流程结合
- 协作工具（AGENT_HANDOFF, CONSENSUS_MECHANISM）未实际使用
- Function Calling 执行器未集成

### 1.3 目标

将 ai-teams 模块的 AI 成员升级为具备工具调用能力的 Agent，实现：

1. **工具增强**：AI 成员根据角色获得对应工具能力
2. **智能协作**：成员间可委派任务、发起投票
3. **专业能力**：researcher 能搜索、analyst 能分析数据、developer 能生成代码
4. **流式体验**：工具调用过程实时反馈给用户

### 1.4 非目标

- 本次不改动前端 UI（仅后端整合）
- 不修改数据库 Schema（复用现有字段）
- 不改变现有 API 接口签名（保持向后兼容）

### 1.5 代码结构

```
backend/src/modules/ai/ai-teams/
│
├── 📁 核心模块
│   ├── ai-teams.module.ts                 # 模块定义（DI 容器）
│   ├── ai-teams.controller.ts             # REST API 控制器
│   ├── ai-teams.gateway.ts                # WebSocket 网关（tool:* 事件）
│   └── ai-teams.service.ts                # 门面服务
│
├── 📁 agents/                             # Agent 层（AI 能力封装）
│   ├── index.ts                           # 统一导出
│   ├── team-member.agent.ts               # 团队成员 Agent（角色-工具映射）
│   ├── teams-llm-adapter.ts               # LLM 适配器（Function Calling）
│   └── __tests__/
│       └── team-member.agent.spec.ts      # 单元测试（42个用例）
│
├── 📁 services/                           # 业务服务层（按功能分组）
│   ├── index.ts                           # 统一导出所有子模块
│   │
│   ├── topic/                             # Topic 相关服务（7个）
│   │   ├── index.ts
│   │   ├── topic-crud.service.ts          # 讨论组 CRUD
│   │   ├── topic-membership.service.ts    # 成员管理
│   │   ├── topic-messages.service.ts      # 消息管理
│   │   ├── topic-resources.service.ts     # 资源管理
│   │   ├── topic-summaries.service.ts     # 摘要生成
│   │   ├── topic-forward-bookmark.service.ts  # 转发与收藏
│   │   └── topic-public.service.ts        # 公开讨论组
│   │
│   ├── ai/                                # AI 相关服务（2个）
│   │   ├── index.ts
│   │   ├── ai-response.service.ts         # AI 响应生成（含工具调用）
│   │   └── context-router.service.ts      # 上下文路由
│   │
│   ├── collaboration/                     # 协作服务（3个）
│   │   ├── index.ts
│   │   ├── team-collaboration.service.ts  # 成员委派 + 共识投票
│   │   ├── team-mission.service.ts        # 团队任务编排
│   │   ├── debate.service.ts              # 辩论模式
│   │   └── __tests__/
│   │       └── team-collaboration.service.spec.ts
│   │
│   └── utils/                             # 工具服务（2个）
│       ├── index.ts
│       ├── url-parser.service.ts          # URL 解析
│       └── content-extraction.service.ts  # 内容提取
│
├── 📁 dto/                                # 数据传输对象（14个）
│   ├── index.ts
│   └── *.dto.ts
│
└── 📁 __tests__/                          # 集成测试
    ├── url-parser.service.spec.ts
    ├── ai-teams-integration.spec.ts
    └── ai-teams-tool-integration.spec.ts
```

**目录统计**：

| 分类       | 文件数 | 说明                              |
| ---------- | ------ | --------------------------------- |
| 核心模块   | 4      | Module/Controller/Gateway/Service |
| Agent 层   | 3      | 工具映射、LLM 适配                |
| Topic 服务 | 7      | 讨论组各功能                      |
| AI 服务    | 2      | 响应生成、上下文                  |
| 协作服务   | 3      | 委派、任务、辩论                  |
| 工具服务   | 2      | URL、内容提取                     |
| DTO        | 14     | 请求/响应结构                     |
| 测试       | 5      | 单元+集成测试                     |
| **总计**   | **40** |                                   |

**关键文件说明**：

| 文件                                                   | 职责                 | 状态 |
| ------------------------------------------------------ | -------------------- | ---- |
| `services/ai/ai-response.service.ts`                   | AI 响应 + 工具调用   | ✅   |
| `agents/team-member.agent.ts`                          | 角色-工具映射        | ✅   |
| `agents/teams-llm-adapter.ts`                          | LLM Function Calling | ✅   |
| `services/collaboration/team-collaboration.service.ts` | 委派 + 投票          | ✅   |
| `services/collaboration/team-mission.service.ts`       | 团队任务             | ✅   |
| `ai-teams.gateway.ts`                                  | WebSocket 推送       | ✅   |

**测试覆盖**：

| 测试文件                             | 用例数 | 状态         |
| ------------------------------------ | ------ | ------------ |
| `team-member.agent.spec.ts`          | 42     | ✅ 通过      |
| `team-collaboration.service.spec.ts` | 30     | ✅ 通过      |
| `ai-teams-tool-integration.spec.ts`  | 15     | ⚠️ 7/15 通过 |

---

## 2. 用户故事

### 角色定义

- **普通用户**：创建讨论组、添加 AI 成员、发送消息
- **AI 成员**：响应用户消息、执行工具、协作其他成员
- **Leader AI**：规划任务、分配工作、整合结果

### 用户故事

| ID     | 角色      | 故事                                                     | 优先级 |
| ------ | --------- | -------------------------------------------------------- | ------ |
| US-001 | 普通用户  | 作为用户，我希望 AI 研究员能自动搜索网络信息回答我的问题 | P0     |
| US-002 | 普通用户  | 作为用户，我希望 AI 分析师能执行 Python 代码分析数据     | P0     |
| US-003 | 普通用户  | 作为用户，我希望 AI 开发者能生成代码并解释执行结果       | P0     |
| US-004 | 普通用户  | 作为用户，我希望看到 AI 成员使用工具的实时进度           | P1     |
| US-005 | AI 成员   | 作为 AI 成员，我可以将复杂任务委派给更专业的成员处理     | P1     |
| US-006 | AI 成员   | 作为 AI 成员，我可以发起投票让团队做出决策               | P2     |
| US-007 | Leader AI | 作为 Leader，我可以将任务分解并分配给合适的成员          | P0     |
| US-008 | Leader AI | 作为 Leader，我可以跟踪每个成员的任务执行进度            | P1     |

---

## 3. 功能需求

### 3.1 功能列表

| ID    | 功能名称       | 描述                                     | 优先级 | 依赖  |
| ----- | -------------- | ---------------------------------------- | ------ | ----- |
| F-001 | 工具能力注入   | 根据成员角色自动注入对应工具             | P0     | -     |
| F-002 | 响应时工具调用 | AI 响应生成时支持 Function Calling       | P0     | F-001 |
| F-003 | 工具执行事件流 | 工具调用过程通过 WebSocket 推送          | P1     | F-002 |
| F-004 | 任务委派       | 成员间使用 AGENT_HANDOFF 工具委派任务    | P1     | F-002 |
| F-005 | 共识机制       | 使用 CONSENSUS_MECHANISM 工具发起投票    | P2     | F-002 |
| F-006 | Leader 增强    | Leader 使用 TASK_DELEGATION 工具分配任务 | P0     | F-002 |
| F-007 | 工作流编排     | 使用 WORKFLOW_ORCHESTRATION 编排复杂任务 | P2     | F-006 |
| F-008 | 人类审批       | 敏感操作使用 HUMAN_APPROVAL 工具请求确认 | P2     | F-002 |

### 3.2 详细说明

#### F-001: 工具能力注入

**描述**
根据 AI 成员的角色、能力（capabilities）、专业领域（expertiseAreas）自动解析并注入对应的工具。

**前置条件**

- AI 成员已添加到讨论组
- `TeamMemberAgent` 服务可用

**主流程**

1. 用户 @ 某 AI 成员
2. 系统获取该成员的配置信息
3. 调用 `TeamMemberAgent.resolveTools()` 解析工具列表
4. 将工具列表传递给响应生成流程

**验收标准**

- [ ] researcher 角色自动获得 WEB_SEARCH, RAG_SEARCH 等工具
- [ ] analyst 角色自动获得 DATA_ANALYSIS, PYTHON_EXECUTOR 等工具
- [ ] developer 角色自动获得 CODE_GENERATION, PYTHON_EXECUTOR 等工具
- [ ] Leader 角色额外获得 TASK_DELEGATION, WORKFLOW_ORCHESTRATION 工具
- [ ] 工具解析日志可追踪

---

#### F-002: 响应时工具调用

**描述**
在 `AiResponseService.generateAIResponse()` 中集成 `FunctionCallingExecutor`，使 AI 成员能够在回复时调用工具。

**前置条件**

- F-001 完成
- LLM 支持 Function Calling（GPT-4, Claude, Gemini 等）

**主流程**

1. 用户发送消息
2. 系统构建上下文和系统提示
3. 获取成员可用工具列表
4. 使用 `FunctionCallingExecutor` 执行 LLM + 工具调用循环
5. 收集工具调用结果，生成最终回复
6. 保存消息到数据库

**异常流程**

- 如果工具调用失败，记录错误并继续生成文本回复
- 如果超过最大迭代次数，返回中间结果

**验收标准**

- [ ] AI 成员能够自主选择并调用工具
- [ ] 工具调用结果正确反馈到 LLM
- [ ] 最大迭代次数限制生效（默认 10 次）
- [ ] 工具调用超时控制生效（默认 30 秒/工具）
- [ ] 错误处理优雅，不影响用户体验

---

#### F-003: 工具执行事件流

**描述**
工具调用过程通过 WebSocket 实时推送给客户端，让用户看到 AI 的"思考过程"。

**前置条件**

- F-002 完成
- `AiTeamsGateway` 可用

**事件类型**
| 事件 | 数据 |
| -------------- | ------------------------------ |
| `tool:calling` | { toolType, input } |
| `tool:result` | { toolType, output, duration } |
| `tool:error` | { toolType, error } |
| `thinking` | { step, description } |

**验收标准**

- [ ] 工具调用开始时推送 `tool:calling` 事件
- [ ] 工具调用完成时推送 `tool:result` 事件
- [ ] 工具调用失败时推送 `tool:error` 事件
- [ ] 客户端能实时显示工具调用状态

---

#### F-004: 任务委派

**描述**
AI 成员可以使用 `AGENT_HANDOFF` 工具将子任务委派给其他更专业的成员。

**场景示例**
用户问 researcher："帮我分析这组数据的趋势"

1. researcher 发现这是数据分析任务
2. researcher 调用 `AGENT_HANDOFF` 工具，委派给 analyst
3. analyst 接收任务，执行分析
4. analyst 返回结果给 researcher
5. researcher 整合结果回复用户

**验收标准**

- [ ] AI 成员能识别何时需要委派
- [ ] 委派请求包含完整上下文
- [ ] 目标成员能正确接收和执行任务
- [ ] 结果能正确返回给发起者

---

#### F-006: Leader 增强

**描述**
增强 Leader AI 的任务分配能力，使用 `TASK_DELEGATION` 工具进行智能任务分配。

**前置条件**

- 成员已设置 `isLeader: true`

**主流程**

1. Leader 接收团队任务
2. Leader 分析任务，拆分为子任务
3. Leader 调用 `TASK_DELEGATION` 工具分配任务
4. 系统创建 `AgentTask` 记录
5. 各成员执行分配的任务
6. Leader 收集结果，整合输出

**验收标准**

- [ ] Leader 能使用 TASK_DELEGATION 工具
- [ ] 任务分配记录到 AgentTask 表
- [ ] 成员能查看自己的待办任务
- [ ] 任务状态能正确更新

---

## 4. 技术方案

### 4.1 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        AiTeamsModule                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │ AiResponseService│──▶ │ TeamMemberAgent │                     │
│  │  (改造)          │    │  (增强)         │                     │
│  └────────┬────────┘    └────────┬────────┘                     │
│           │                      │                               │
│           ▼                      ▼                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      AiAgentsModule                          ││
│  │  ┌──────────────────┐  ┌──────────────┐  ┌───────────────┐  ││
│  │  │FunctionCalling   │  │  ToolRegistry │  │ 协作工具       │  ││
│  │  │Executor          │  │  (48 tools)   │  │ (6 tools)     │  ││
│  │  └──────────────────┘  └──────────────┘  └───────────────┘  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │ TeamMission     │    │ DebateService   │                     │
│  │ Service (改造)  │    │  (保持不变)     │                     │
│  └─────────────────┘    └─────────────────┘                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 核心改造点

#### 4.2.1 AiResponseService 改造

```typescript
// ai-response.service.ts
import { FunctionCallingExecutor } from "../../ai-agents/core";
import { TeamMemberAgent } from "./agents";

@Injectable()
export class AiResponseService {
  constructor(
    // ... 现有依赖
    private readonly teamMemberAgent: TeamMemberAgent,
    private readonly llmAdapter: LLMAdapter,
  ) {}

  async generateAIResponse(
    topicId: string,
    userId: string,
    aiMemberId: string,
    contextMessageIds: string[],
    debateRole?: DebateRoleInfo | null,
  ) {
    // 1. 获取 AI 成员配置
    const aiMember = await this.getAIMember(aiMemberId);

    // 2. 解析可用工具
    const memberConfig = this.buildMemberConfig(aiMember);
    const toolTypes = this.teamMemberAgent.resolveTools(memberConfig);

    // 3. 判断是否使用工具模式
    const useTools = toolTypes.length > 0 && this.shouldUseTools(aiMember);

    if (useTools) {
      // 4a. 工具模式：使用 FunctionCallingExecutor
      return this.generateWithTools(
        topicId,
        aiMember,
        contextMessages,
        toolTypes,
      );
    } else {
      // 4b. 纯文本模式：保持现有逻辑
      return this.generateTextOnly(topicId, aiMember, contextMessages);
    }
  }

  private async generateWithTools(
    topicId: string,
    aiMember: TopicAIMember,
    messages: ChatMessage[],
    toolTypes: ToolType[],
  ): Promise<TopicMessage> {
    const executor = new FunctionCallingExecutor(
      this.llmAdapter,
      this.toolRegistry,
      {
        maxIterations: 10,
        maxToolCalls: 20,
        availableTools: toolTypes,
      },
    );

    let finalContent = "";
    const toolCalls: ToolCallRecord[] = [];

    for await (const event of executor.run({
      systemPrompt: this.buildSystemPrompt(aiMember),
      messages,
    })) {
      switch (event.type) {
        case "tool_call":
          // 推送工具调用事件
          this.gateway.emitToTopic(topicId, "tool:calling", {
            aiMemberId: aiMember.id,
            toolType: event.toolType,
          });
          break;
        case "tool_result":
          toolCalls.push(event);
          this.gateway.emitToTopic(topicId, "tool:result", event);
          break;
        case "complete":
          finalContent = event.output;
          break;
      }
    }

    // 保存消息
    return this.saveMessage(topicId, aiMember.id, finalContent, toolCalls);
  }
}
```

#### 4.2.2 TeamMemberAgent 增强

当前 `TeamMemberAgent` 已实现工具解析逻辑，需要增加以下方法：

```typescript
// team-member.agent.ts

/**
 * 构建 Function Calling Schema
 * 用于传递给 LLM
 */
generateFunctionSchemas(toolTypes: ToolType[]): FunctionDefinition[] {
  return toolTypes
    .map(type => {
      const tool = this.toolRegistry.getOptional(type);
      return tool?.toFunctionDefinition();
    })
    .filter(Boolean);
}

/**
 * 判断是否应该使用工具
 */
shouldUseTools(aiMember: TopicAIMember): boolean {
  // 如果成员有明确的能力配置，使用工具
  if (aiMember.capabilities?.length > 0) return true;

  // 如果是 Leader，使用工具
  if (aiMember.isLeader) return true;

  // 如果角色描述包含专业关键词，使用工具
  const role = this.inferRoleFromDescription(aiMember.roleDescription);
  return role !== 'general';
}
```

### 4.3 数据模型

**复用现有字段，无需修改 Schema**：

| 表/字段                      | 用途                       |
| ---------------------------- | -------------------------- |
| TopicAIMember.capabilities   | 存储 AICapability 枚举数组 |
| TopicAIMember.expertiseAreas | 存储专业领域字符串数组     |
| TopicAIMember.isLeader       | 标识是否为 Leader          |
| TopicAIMember.workStyle      | 存储工作风格               |
| TopicMessage.modelUsed       | 记录使用的模型             |
| TopicMessage.tokensUsed      | 记录 Token 消耗            |
| AgentTask                    | 记录任务分配（已存在）     |

---

## 5. 任务拆分

### 5.1 Epic 结构

```
Epic: AI Teams 模块整合
├── Story 1: 工具能力注入 (F-001)
├── Story 2: 响应时工具调用 (F-002)
├── Story 3: 工具执行事件流 (F-003)
├── Story 4: 任务委派 (F-004)
└── Story 5: Leader 增强 (F-006)
```

### 5.2 详细任务列表

| ID    | 任务                                         | 类型 | 预估 | 依赖        | 优先级 |
| ----- | -------------------------------------------- | ---- | ---- | ----------- | ------ |
| T-001 | 创建 LLMAdapter 适配层                       | 后端 | 3h   | -           | P0     |
| T-002 | 增强 TeamMemberAgent.generateFunctionSchemas | 后端 | 2h   | -           | P0     |
| T-003 | 增强 TeamMemberAgent.shouldUseTools          | 后端 | 1h   | -           | P0     |
| T-004 | 改造 AiResponseService 构造函数              | 后端 | 1h   | T-001       | P0     |
| T-005 | 实现 generateWithTools 方法                  | 后端 | 4h   | T-002,T-004 | P0     |
| T-006 | 集成 FunctionCallingExecutor                 | 后端 | 3h   | T-005       | P0     |
| T-007 | 添加工具调用 WebSocket 事件                  | 后端 | 2h   | T-006       | P1     |
| T-008 | 实现 AGENT_HANDOFF 工具                      | 后端 | 4h   | T-006       | P1     |
| T-009 | 实现 TASK_DELEGATION 工具                    | 后端 | 4h   | T-006       | P0     |
| T-010 | 改造 TeamMissionService 使用工具             | 后端 | 3h   | T-009       | P0     |
| T-011 | 编写单元测试                                 | 测试 | 4h   | T-006       | P0     |
| T-012 | 编写集成测试                                 | 测试 | 4h   | T-010       | P0     |
| T-013 | 编写 E2E 测试                                | 测试 | 3h   | T-012       | P1     |

**总预估工时**：38 小时（约 5 个工作日）

### 5.3 任务依赖图

```
T-001 ──────────┐
                ▼
T-002 ──┬──▶ T-004 ──▶ T-005 ──▶ T-006 ──┬──▶ T-007
        │                                 │
T-003 ──┘                                 ├──▶ T-008
                                          │
                                          └──▶ T-009 ──▶ T-010

T-006 ──▶ T-011 ──▶ T-012 ──▶ T-013
```

---

## 6. 排期计划

### 6.1 里程碑

| 里程碑 | 日期  | 内容                             |
| ------ | ----- | -------------------------------- |
| M1     | Day 2 | 完成 T-001 ~ T-004，基础设施就绪 |
| M2     | Day 3 | 完成 T-005 ~ T-006，工具调用可用 |
| M3     | Day 4 | 完成 T-007 ~ T-010，协作功能可用 |
| M4     | Day 5 | 完成测试，准备发布               |

### 6.2 迭代计划

**Sprint 1 (Day 1-2): 基础设施**

- T-001: 创建 LLMAdapter 适配层
- T-002: 增强 TeamMemberAgent
- T-003: 实现 shouldUseTools
- T-004: 改造构造函数

**Sprint 2 (Day 3): 核心功能**

- T-005: 实现 generateWithTools
- T-006: 集成 FunctionCallingExecutor

**Sprint 3 (Day 4): 协作功能**

- T-007: WebSocket 事件
- T-008: AGENT_HANDOFF 工具
- T-009: TASK_DELEGATION 工具
- T-010: 改造 TeamMissionService

**Sprint 4 (Day 5): 测试与发布**

- T-011: 单元测试
- T-012: 集成测试
- T-013: E2E 测试
- 代码审查
- 合并发布

---

## 7. 验收标准

### 7.1 功能验收

#### F-001 工具能力注入

- [ ] researcher 角色解析出 WEB_SEARCH, RAG_SEARCH, KNOWLEDGE_GRAPH
- [ ] analyst 角色解析出 DATA_ANALYSIS, PYTHON_EXECUTOR, DATA_FETCH
- [ ] developer 角色解析出 CODE_GENERATION, PYTHON_EXECUTOR, JAVASCRIPT_EXECUTOR
- [ ] writer 角色解析出 TEXT_GENERATION, EXPORT_DOCX, TEMPLATE_RENDER
- [ ] designer 角色解析出 IMAGE_GENERATION, EXPORT_IMAGE
- [ ] leader 角色解析出 TASK_DELEGATION, WORKFLOW_ORCHESTRATION, CONSENSUS_MECHANISM

#### F-002 响应时工具调用

- [ ] 当用户问"搜索最新的 AI 新闻"，researcher 自动调用 WEB_SEARCH
- [ ] 当用户提供数据并要求分析，analyst 自动调用 DATA_ANALYSIS
- [ ] 工具调用结果正确整合到最终回复
- [ ] 最大 10 次迭代限制生效
- [ ] 单个工具 30 秒超时控制生效

#### F-003 工具执行事件流

- [ ] 工具调用时客户端收到 `tool:calling` 事件
- [ ] 工具完成时客户端收到 `tool:result` 事件
- [ ] 事件包含正确的 aiMemberId 和 toolType

### 7.2 性能验收

- [ ] 工具增强后，响应延迟增加不超过 50%
- [ ] 单次对话工具调用次数不超过 20 次
- [ ] WebSocket 事件延迟 < 100ms

### 7.3 兼容性验收

- [ ] 现有 API 接口签名不变
- [ ] 不使用工具的 AI 成员行为不变
- [ ] 辩论模式正常工作
- [ ] 团队任务模式正常工作

---

## 8. 风险和依赖

### 8.1 风险

| 风险                        | 影响 | 概率 | 缓解措施                         |
| --------------------------- | ---- | ---- | -------------------------------- |
| LLM 不支持 Function Calling | 高   | 低   | 使用 Gemini/Claude 等支持的模型  |
| 工具调用死循环              | 高   | 中   | 严格限制迭代次数和工具调用次数   |
| 工具执行超时                | 中   | 中   | 设置合理的超时时间，失败优雅降级 |
| 性能下降明显                | 中   | 中   | 异步执行工具，并行调用无依赖工具 |

### 8.2 依赖

| 依赖项                  | 状态   | 负责人         |
| ----------------------- | ------ | -------------- |
| ai-agents 模块          | 已就绪 | Architecture   |
| FunctionCallingExecutor | 已实现 | ai-agents 团队 |
| ToolRegistry            | 已实现 | ai-agents 团队 |
| 协作工具 (6 种)         | 待确认 | ai-agents 团队 |

---

## 9. 附录

### A. 角色-工具映射表

| 角色       | 工具                                                                |
| ---------- | ------------------------------------------------------------------- |
| researcher | WEB_SEARCH, WEB_SCRAPER, RAG_SEARCH, KNOWLEDGE_GRAPH, DATA_FETCH    |
| analyst    | DATA_ANALYSIS, PYTHON_EXECUTOR, DATA_FETCH, DATABASE_QUERY          |
| writer     | TEXT_GENERATION, EXPORT_DOCX, EXPORT_PDF, TEMPLATE_RENDER           |
| developer  | CODE_GENERATION, PYTHON_EXECUTOR, JAVASCRIPT_EXECUTOR, SQL_EXECUTOR |
| designer   | IMAGE_GENERATION, EXPORT_IMAGE, EXPORT_PPTX, TEMPLATE_RENDER        |
| moderator  | TEXT_GENERATION, AGENT_HANDOFF, CONSENSUS_MECHANISM                 |
| leader     | TASK_DELEGATION, WORKFLOW_ORCHESTRATION, CONSENSUS_MECHANISM        |
| general    | TEXT_GENERATION, WEB_SEARCH, SHORT_TERM_MEMORY                      |

### B. 协作工具说明

| 工具                   | 功能                     | 使用场景        |
| ---------------------- | ------------------------ | --------------- |
| AGENT_HANDOFF          | 将任务委派给其他 AI 成员 | 跨专业协作      |
| HUMAN_APPROVAL         | 请求人类审批             | 敏感操作确认    |
| AGENT_COMMUNICATION    | Agent 间发送消息         | 信息共享        |
| TASK_DELEGATION        | 分配任务并跟踪状态       | Leader 分配工作 |
| CONSENSUS_MECHANISM    | 发起投票，收集意见       | 团队决策        |
| WORKFLOW_ORCHESTRATION | 编排多步骤工作流         | 复杂任务执行    |

### C. 变更记录

| 版本 | 日期       | 变更内容 | 作者     |
| ---- | ---------- | -------- | -------- |
| 1.0  | 2025-12-19 | 初始版本 | PM Agent |

---

**审批**

- [ ] 技术负责人审批
- [ ] 产品负责人审批
- [ ] 进入开发队列
