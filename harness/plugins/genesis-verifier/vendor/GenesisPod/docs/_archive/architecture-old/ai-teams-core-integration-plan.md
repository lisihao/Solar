# AI Teams 核心能力构建业务系统分析方案

> **文档版本**: v1.1
> **创建日期**: 2026-01-01
> **最后更新**: 2026-01-01
> **用户体验模式确认**: 保持三个模块独立入口，共享AI Teams团队能力

---

## 执行摘要

**结论**: 以AI Teams为核心能力构建AI Studio、AI Office、AI Reports是**完全可行且强烈推荐的**。

**核心价值**:

- **能力复用**: AI Teams的7个预定义角色可直接赋能其他模块
- **协作升级**: 单Agent模式升级为多Agent协作
- **透明可控**: 统一的prompt透明化和任务追踪
- **开发效率**: 减少重复代码，新业务快速接入

**推荐方案**: 渐进式整合（方案一）

---

## 一、现状分析

### 1.1 AI Teams 核心能力概览

**位置**: `backend/src/modules/ai/ai-teams/`

AI Teams 是一个企业级多AI协作平台，具备以下核心能力：

| 能力            | 描述                     | 技术实现                               |
| --------------- | ------------------------ | -------------------------------------- |
| **多Agent协作** | 支持异构AI模型共存协作   | TeamMemberAgent + 7预定义角色          |
| **实时通信**    | WebSocket毫秒级消息分发  | Socket.io Gateway                      |
| **智能上下文**  | 意图感知的动态上下文管理 | ContextRouterService                   |
| **任务编排**    | 工作流系统               | TeamMissionService                     |
| **红蓝辩论**    | AI对抗式讨论             | DebateService (会话隔离)               |
| **工具调用**    | Function Calling         | ToolRegistry + FunctionCallingExecutor |
| **任务委派**    | Handoff机制              | TeamCollaborationService               |
| **共识投票**    | 多AI决策机制             | VoteRequest系统                        |

### 1.2 现有业务模块现状

#### AI Studio (深度研究工作室) - 已存在

- **位置**: `backend/src/modules/ai/ai-studio/`
- **功能**: 研究项目管理、多源资料采集、AI驱动研究规划
- **核心服务**: DeepResearchAgentService, ResearchPlannerService, IterativeSearchService
- **问题**: 单Agent模式，缺乏多AI协作能力

#### AI Office (办公套件) - 已存在

- **位置**: `backend/src/modules/ai/ai-office/`
- **功能**: 文档/幻灯片/表格生成
- **核心服务**: SlidesOrchestratorService (已有5角色团队)
- **优势**: Slides模块已有多Agent团队协作雏形
- **问题**: 团队协作能力与AI Teams重复建设

#### AI Reports (报告系统) - 已存在

- **位置**: `backend/src/modules/content/reports/`
- **功能**: 多模板报告生成
- **依赖**: AiOfficeModule (循环依赖处理)
- **问题**: 功能相对简单，缺乏深度协作能力

---

## 二、可行性分析

### 2.1 以 AI Teams 为核心的架构优势

```
                    ┌─────────────────────────────────────┐
                    │         AI Teams Core               │
                    │   (多Agent协作、实时通信、任务编排)   │
                    └─────────────────────────────────────┘
                                    │
           ┌────────────────────────┼────────────────────────┐
           ▼                        ▼                        ▼
    ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
    │  AI Studio  │          │  AI Office  │          │ AI Reports  │
    │  研究团队   │          │  创作团队   │          │  分析团队   │
    │  Researcher │          │  Architect  │          │  Analyst    │
    │  Analyst    │          │  Writer     │          │  Writer     │
    │  Writer     │          │  Designer   │          │  Reviewer   │
    └─────────────┘          └─────────────┘          └─────────────┘
```

### 2.2 核心价值

1. **能力复用**: AI Teams的角色系统(7个预定义角色)可直接复用
2. **协作增强**: 现有模块升级为多Agent协作模式
3. **统一体验**: 用户可在同一Topic中切换研究/创作/分析任务
4. **透明可控**: AI Teams的prompt透明化机制可扩展到所有模块

### 2.3 技术可行性评估

| 维度       | 评估  | 说明                                  |
| ---------- | ----- | ------------------------------------- |
| 架构兼容性 | ✅ 高 | 模块化设计，依赖注入便于整合          |
| 数据模型   | ✅ 高 | Topic/TopicAIMember可扩展支持业务场景 |
| 实时通信   | ✅ 高 | WebSocket Gateway可复用               |
| 工具系统   | ✅ 高 | ToolRegistry可按业务扩展              |
| 迁移成本   | ⚠️ 中 | 需重构现有服务调用逻辑                |

---

## 三、整改方案

### 3.1 方案一：渐进式整合（推荐）

**原则**: 保留现有模块，通过AI Teams提供协作增强层

#### 阶段1: 定义业务场景团队模板

```typescript
// 新增：业务场景团队模板
enum TeamScenario {
  RESEARCH = "research", // 研究场景
  DOCUMENT = "document", // 文档创作
  PRESENTATION = "presentation", // 演示制作
  REPORT = "report", // 报告分析
  CUSTOM = "custom", // 自定义
}

// 预定义团队配置
const SCENARIO_TEAMS = {
  research: {
    name: "研究团队",
    members: [
      { role: "researcher", displayName: "首席研究员", isLeader: true },
      { role: "analyst", displayName: "数据分析师" },
      { role: "writer", displayName: "研究撰稿人" },
    ],
  },
  document: {
    name: "创作团队",
    members: [
      { role: "leader", displayName: "项目经理", isLeader: true },
      { role: "writer", displayName: "内容作家" },
      { role: "moderator", displayName: "质量审核" },
    ],
  },
  // ...更多场景
};
```

#### 阶段2: 扩展Topic类型支持业务绑定

```prisma
// schema.prisma 扩展
model Topic {
  // 现有字段...

  // 新增：业务绑定
  scenario          TeamScenario?     @default(CUSTOM)
  linkedResourceId  String?           // 关联业务资源ID
  linkedResourceType String?          // research_project | office_document | report

  // 关联
  researchProject   ResearchProject?  @relation(fields: [linkedResourceId], references: [id])
  officeDocument    OfficeDocument?   @relation(fields: [linkedResourceId], references: [id])
  report            Report?           @relation(fields: [linkedResourceId], references: [id])
}
```

#### 阶段3: 创建业务适配服务

```
backend/src/modules/ai/ai-teams/
├── adapters/
│   ├── research-adapter.service.ts   # AI Studio适配
│   ├── office-adapter.service.ts     # AI Office适配
│   └── reports-adapter.service.ts    # AI Reports适配
```

### 3.2 方案二：深度重构

**原则**: 将AI Teams作为唯一协作引擎，其他模块重构为场景插件

**优势**: 架构更清晰，减少重复代码
**劣势**: 重构工作量大，风险较高

---

## 四、具体改进点

### 4.1 AI Studio 改进

**当前问题**:

- DeepResearchAgentService 是单Agent设计
- 缺乏多视角研究协作

**改进方案**:

1. 引入研究团队模板（Researcher + Analyst + Writer）
2. 研究任务通过Topic进行团队协作
3. 利用辩论系统进行研究观点验证

**关键文件改动**:

- `ai-studio/ai-studio.service.ts`: 添加团队创建逻辑
- `ai-studio/services/deep-research-agent.service.ts`: 改为团队协调者

### 4.2 AI Office 改进

**当前问题**:

- Slides模块有5角色团队，但与AI Teams独立
- 文档生成缺乏协作审核

**改进方案**:

1. 统一使用AI Teams的角色系统
2. 文档生成流程：Writer起草 → Reviewer审核 → 用户确认
3. 复用AI Teams的任务编排能力

**关键文件改动**:

- `ai-office/slides/slides-team-orchestrator.service.ts`: 对接AI Teams
- `ai-office/docs/docs-orchestrator.service.ts`: 添加协作流程

### 4.3 AI Reports 改进

**当前问题**:

- 报告生成相对简单
- 缺乏数据分析协作

**改进方案**:

1. 报告生成前进行多AI分析讨论
2. 利用辩论系统验证报告结论
3. 支持分析团队协作

**关键文件改动**:

- `content/reports/reports.service.ts`: 集成AI Teams协作
- 新增: `content/reports/services/analysis-team.service.ts`

---

## 五、实施路线图

### Phase 1: 基础设施

- [ ] 扩展Topic数据模型支持业务绑定
- [ ] 定义TeamScenario枚举和预置团队配置
- [ ] 创建适配器服务基础架构

### Phase 2: AI Studio整合

- [ ] 创建研究团队模板
- [ ] 重构DeepResearchAgentService支持团队模式
- [ ] 添加研究辩论功能

### Phase 3: AI Office整合

- [ ] 统一Slides团队到AI Teams角色系统
- [ ] 文档生成添加协作审核流程
- [ ] 表格生成支持分析协作

### Phase 4: AI Reports整合

- [ ] 报告生成前置分析讨论
- [ ] 结论验证辩论机制
- [ ] 分析团队模板

### Phase 5: 优化与测试

- [ ] 性能优化
- [ ] 端到端测试
- [ ] 文档更新

---

## 六、待澄清问题

在开始实施前，需要确认以下问题：

1. **整合深度**:
   - 选择渐进式整合（方案一）还是深度重构（方案二）？

2. **优先级**:
   - 三个业务模块的整合优先级？
   - 是否有特定场景需要优先支持？

3. **用户体验**:
   - 用户是否希望在同一Topic中完成研究→创作→报告全流程？
   - 还是保持独立入口但共享团队能力？

4. **兼容性**:
   - 现有数据是否需要迁移？
   - 是否需要保持向后兼容？

---

## 七、预期收益

| 收益         | 描述                                     |
| ------------ | ---------------------------------------- |
| **能力统一** | 7个预定义角色+自定义角色覆盖所有业务场景 |
| **体验一致** | 统一的协作界面和交互模式                 |
| **开发效率** | 复用AI Teams核心代码，减少重复开发       |
| **可扩展性** | 新业务只需定义场景模板即可快速接入       |
| **透明可控** | 所有AI交互可追溯、可干预                 |

---

## 八、详细技术方案

### 8.1 核心架构设计

```
┌────────────────────────────────────────────────────────────────────┐
│                      前端应用层 (Next.js)                          │
├──────────────┬──────────────┬──────────────┬──────────────────────┤
│  AI Studio   │  AI Office   │  AI Reports  │    AI Teams          │
│  /ai-studio  │  /ai-office  │  (workspace) │    /ai-teams         │
│  研究工作室  │  办公套件    │  报告系统    │    团队协作          │
└──────┬───────┴──────┬───────┴──────┬───────┴──────────┬───────────┘
       │              │              │                   │
       └──────────────┴──────────────┴───────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  统一协作API层     │
                    │  /api/teams/*      │
                    └─────────┬─────────┘
                              │
┌─────────────────────────────▼─────────────────────────────────────┐
│                     AI Teams Core Engine                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │
│  │ Topic系统   │ │ Agent系统   │ │ 任务编排    │ │ 实时通信    │ │
│  │ - 业务绑定  │ │ - 7预定义   │ │ - Mission   │ │ - WebSocket │ │
│  │ - 场景模板  │ │ - 工具注册  │ │ - Handoff   │ │ - 事件广播  │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │
│  │ 辩论系统   │ │ 上下文路由  │ │ 投票共识    │ │ 输出适配    │ │
│  │ - RED/BLUE │ │ - 意图检测  │ │ - 多策略    │ │ - 格式转换  │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ │
└───────────────────────────────────────────────────────────────────┘
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
┌──────▼──────┐     ┌─────────▼────────┐    ┌───────▼───────┐
│ AI Studio   │     │   AI Office      │    │  AI Reports   │
│ Module      │     │   Module         │    │  Module       │
│ (现有服务)   │     │   (现有服务)      │    │  (现有服务)    │
└─────────────┘     └──────────────────┘    └───────────────┘
```

### 8.2 数据模型扩展

#### 8.2.1 Topic扩展（支持业务绑定）

```prisma
// prisma/schema.prisma 扩展

enum TeamScenario {
  RESEARCH       // 研究场景 - 绑定 ResearchProject
  DOCUMENT       // 文档创作 - 绑定 OfficeDocument (type: ARTICLE/REPORT)
  PRESENTATION   // 演示制作 - 绑定 OfficeDocument (type: PPT)
  SPREADSHEET    // 表格分析 - 绑定 OfficeDocument (type: SPREADSHEET)
  REPORT         // 报告分析 - 绑定 Report
  GENERAL        // 通用讨论
  CUSTOM         // 自定义场景
}

model Topic {
  // === 现有字段保持不变 ===
  id          String      @id @default(uuid())
  name        String      @db.VarChar(200)
  description String?     @db.Text
  type        TopicType   @default(PRIVATE)
  avatar      String?     @db.Text
  createdById String
  createdBy   User        @relation("TopicCreator", fields: [createdById])
  members     TopicMember[]
  aiMembers   TopicAIMember[]
  messages    TopicMessage[]
  // ... 其他现有字段

  // === 新增：业务绑定字段 ===
  scenario          TeamScenario  @default(GENERAL)

  // 业务资源关联（多态关联）
  linkedResourceType  String?     // 'research_project' | 'office_document' | 'report'
  linkedResourceId    String?     // 关联资源的ID

  // 场景配置（JSONB存储灵活配置）
  scenarioConfig      Json?       // { autoCreateTeam: true, defaultRoles: [...] }

  // 输出目标配置
  outputTargets       Json?       // [{ type: 'docx', path: '...' }, ...]

  // 索引优化
  @@index([scenario])
  @@index([linkedResourceType, linkedResourceId])
}
```

#### 8.2.2 新增场景团队模板表

```prisma
model TeamScenarioTemplate {
  id          String        @id @default(uuid())
  scenario    TeamScenario  @unique
  name        String        @db.VarChar(100)
  description String?       @db.Text

  // 默认团队成员配置
  defaultMembers  Json      // TeamMemberConfig[]

  // 可用工具配置
  availableTools  String[]  @default([])

  // 输出格式配置
  outputFormats   String[]  @default([])

  // 是否启用
  isActive        Boolean   @default(true)

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}

// TeamMemberConfig 类型定义
// {
//   role: 'researcher' | 'analyst' | 'writer' | ...
//   displayName: string
//   isLeader: boolean
//   aiModel: string
//   systemPrompt?: string
//   capabilities: string[]
// }
```

### 8.3 核心服务实现

#### 8.3.1 场景团队服务

**文件**: `backend/src/modules/ai/ai-teams/services/scenario-team.service.ts`

```typescript
import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { TeamScenario } from "@prisma/client";

@Injectable()
export class ScenarioTeamService {
  constructor(private prisma: PrismaService) {}

  // 预定义场景团队配置
  private readonly SCENARIO_TEMPLATES: Record<
    TeamScenario,
    TeamTemplateConfig
  > = {
    RESEARCH: {
      name: "研究团队",
      members: [
        {
          role: "researcher",
          displayName: "首席研究员",
          isLeader: true,
          aiModel: "grok",
          capabilities: ["WEB_SEARCH", "RAG_SEARCH", "PAPER_SEARCH"],
          systemPrompt: "你是一位资深研究员，擅长文献调研和信息收集...",
        },
        {
          role: "analyst",
          displayName: "数据分析师",
          aiModel: "gpt-4",
          capabilities: ["DATA_ANALYSIS", "PYTHON_EXECUTOR"],
          systemPrompt: "你是一位数据分析专家，擅长从数据中提取洞察...",
        },
        {
          role: "writer",
          displayName: "研究撰稿人",
          aiModel: "claude",
          capabilities: ["TEXT_GENERATION", "EXPORT_DOCX"],
          systemPrompt:
            "你是一位学术写作专家，擅长将研究成果转化为清晰的文档...",
        },
      ],
      availableTools: [
        "WEB_SEARCH",
        "RAG_SEARCH",
        "PAPER_SEARCH",
        "DATA_ANALYSIS",
        "TEXT_GENERATION",
      ],
      outputFormats: ["docx", "pdf", "markdown"],
    },

    DOCUMENT: {
      name: "创作团队",
      members: [
        {
          role: "leader",
          displayName: "内容策划",
          isLeader: true,
          aiModel: "gpt-4",
        },
        { role: "writer", displayName: "文案撰写", aiModel: "claude" },
        { role: "moderator", displayName: "质量审核", aiModel: "grok" },
      ],
      availableTools: ["TEXT_GENERATION", "EXPORT_DOCX", "EXPORT_PDF"],
      outputFormats: ["docx", "pdf"],
    },

    PRESENTATION: {
      name: "演示团队",
      members: [
        {
          role: "leader",
          displayName: "演示架构师",
          isLeader: true,
          aiModel: "gpt-4",
        },
        { role: "writer", displayName: "内容撰写", aiModel: "claude" },
        { role: "designer", displayName: "视觉设计", aiModel: "grok" },
        { role: "moderator", displayName: "演示审核", aiModel: "gpt-4" },
      ],
      availableTools: ["TEXT_GENERATION", "IMAGE_GENERATION", "EXPORT_PPTX"],
      outputFormats: ["pptx"],
    },

    REPORT: {
      name: "分析团队",
      members: [
        {
          role: "analyst",
          displayName: "首席分析师",
          isLeader: true,
          aiModel: "gpt-4",
        },
        { role: "researcher", displayName: "数据调研", aiModel: "grok" },
        { role: "writer", displayName: "报告撰写", aiModel: "claude" },
      ],
      availableTools: [
        "DATA_ANALYSIS",
        "WEB_SEARCH",
        "TEXT_GENERATION",
        "EXPORT_PDF",
      ],
      outputFormats: ["pdf", "docx"],
    },

    // ... 其他场景
  };

  /**
   * 为业务资源创建关联的Topic和团队
   */
  async createScenarioTeam(params: {
    userId: string;
    scenario: TeamScenario;
    resourceType: string;
    resourceId: string;
    customName?: string;
  }) {
    const template = this.SCENARIO_TEMPLATES[params.scenario];

    return this.prisma.$transaction(async (tx) => {
      // 1. 创建Topic
      const topic = await tx.topic.create({
        data: {
          name: params.customName || template.name,
          description: `${template.name} - 自动创建`,
          scenario: params.scenario,
          linkedResourceType: params.resourceType,
          linkedResourceId: params.resourceId,
          createdById: params.userId,
          members: {
            create: { userId: params.userId, role: "OWNER" },
          },
        },
      });

      // 2. 创建AI团队成员
      const aiMembers = await Promise.all(
        template.members.map((member) =>
          tx.topicAIMember.create({
            data: {
              topicId: topic.id,
              aiModel: member.aiModel,
              displayName: member.displayName,
              isLeader: member.isLeader || false,
              roleDescription: member.role,
              systemPrompt: member.systemPrompt,
              capabilities: member.capabilities || [],
              expertiseAreas: [member.role],
            },
          }),
        ),
      );

      return { topic, aiMembers };
    });
  }

  /**
   * 获取业务资源关联的Topic
   */
  async getLinkedTopic(resourceType: string, resourceId: string) {
    return this.prisma.topic.findFirst({
      where: {
        linkedResourceType: resourceType,
        linkedResourceId: resourceId,
      },
      include: {
        aiMembers: true,
        members: { include: { user: true } },
      },
    });
  }
}
```

#### 8.3.2 业务适配器基类

**文件**: `backend/src/modules/ai/ai-teams/adapters/base-adapter.service.ts`

```typescript
import { Injectable } from "@nestjs/common";
import { ScenarioTeamService } from "../services/scenario-team.service";
import { AiTeamsService } from "../ai-teams.service";
import { TeamScenario } from "@prisma/client";

export interface BusinessContext {
  resourceType: string;
  resourceId: string;
  userId: string;
  scenario: TeamScenario;
}

export interface CollaborationRequest {
  taskDescription: string;
  context?: Record<string, unknown>;
  targetRoles?: string[];
  expectOutput?: string;
}

export interface CollaborationResult {
  topicId: string;
  messages: any[];
  output?: {
    type: string;
    content: string;
    metadata?: Record<string, unknown>;
  };
}

@Injectable()
export abstract class BaseBusinessAdapter {
  constructor(
    protected scenarioTeamService: ScenarioTeamService,
    protected aiTeamsService: AiTeamsService,
  ) {}

  /**
   * 确保业务资源有关联的协作团队
   */
  async ensureTeam(context: BusinessContext) {
    let topic = await this.scenarioTeamService.getLinkedTopic(
      context.resourceType,
      context.resourceId,
    );

    if (!topic) {
      const result = await this.scenarioTeamService.createScenarioTeam({
        userId: context.userId,
        scenario: context.scenario,
        resourceType: context.resourceType,
        resourceId: context.resourceId,
      });
      topic = result.topic;
    }

    return topic;
  }

  /**
   * 发起协作请求
   */
  async requestCollaboration(
    context: BusinessContext,
    request: CollaborationRequest,
  ): Promise<CollaborationResult> {
    const topic = await this.ensureTeam(context);

    // 1. 发送任务消息到团队
    const message = await this.aiTeamsService.sendMessage({
      topicId: topic.id,
      userId: context.userId,
      content: this.buildTaskPrompt(request),
      mentions: this.selectTargetMembers(topic, request.targetRoles),
    });

    // 2. 等待AI响应（或异步处理）
    const responses = await this.waitForResponses(topic.id, message.id);

    // 3. 处理输出
    const output = await this.processOutput(responses, request.expectOutput);

    return {
      topicId: topic.id,
      messages: responses,
      output,
    };
  }

  /**
   * 构建任务提示词（子类可重写）
   */
  protected abstract buildTaskPrompt(request: CollaborationRequest): string;

  /**
   * 选择目标成员
   */
  protected selectTargetMembers(topic: any, targetRoles?: string[]) {
    if (!targetRoles || targetRoles.length === 0) {
      // 默认@leader
      const leader = topic.aiMembers.find((m) => m.isLeader);
      return leader ? [{ aiMemberId: leader.id, mentionType: "AI" }] : [];
    }

    return topic.aiMembers
      .filter((m) => targetRoles.includes(m.roleDescription))
      .map((m) => ({ aiMemberId: m.id, mentionType: "AI" }));
  }

  /**
   * 等待响应（可配置超时）
   */
  protected async waitForResponses(topicId: string, afterMessageId: string) {
    // 实现轮询或WebSocket等待逻辑
    // ...
  }

  /**
   * 处理输出（子类可重写）
   */
  protected abstract processOutput(
    responses: any[],
    expectOutput?: string,
  ): Promise<any>;
}
```

#### 8.3.3 AI Studio适配器

**文件**: `backend/src/modules/ai/ai-teams/adapters/research-adapter.service.ts`

```typescript
import { Injectable } from "@nestjs/common";
import {
  BaseBusinessAdapter,
  CollaborationRequest,
} from "./base-adapter.service";
import { TeamScenario } from "@prisma/client";

@Injectable()
export class ResearchAdapterService extends BaseBusinessAdapter {
  /**
   * 发起研究协作
   */
  async startResearchCollaboration(
    projectId: string,
    userId: string,
    researchQuestion: string,
  ) {
    return this.requestCollaboration(
      {
        resourceType: "research_project",
        resourceId: projectId,
        userId,
        scenario: TeamScenario.RESEARCH,
      },
      {
        taskDescription: researchQuestion,
        targetRoles: ["researcher", "analyst"],
        expectOutput: "research_plan",
      },
    );
  }

  /**
   * 发起研究辩论（验证观点）
   */
  async startResearchDebate(
    projectId: string,
    userId: string,
    hypothesis: string,
  ) {
    const context = {
      resourceType: "research_project",
      resourceId: projectId,
      userId,
      scenario: TeamScenario.RESEARCH,
    };

    const topic = await this.ensureTeam(context);

    // 使用AI Teams的辩论系统
    return this.aiTeamsService.startDebate({
      topicId: topic.id,
      userId,
      debateTopic: hypothesis,
      // 选择两个AI进行红蓝辩论
      participants: topic.aiMembers.slice(0, 2).map((m) => m.id),
    });
  }

  protected buildTaskPrompt(request: CollaborationRequest): string {
    return `
【研究任务】
${request.taskDescription}

请团队协作完成以下工作：
1. 首席研究员：制定研究计划，收集相关资料
2. 数据分析师：分析收集的数据，提取关键洞察
3. 研究撰稿人：整理研究成果，形成研究报告

期望输出：${request.expectOutput || "研究报告"}
    `.trim();
  }

  protected async processOutput(responses: any[], expectOutput?: string) {
    // 提取研究成果
    const writerResponse = responses.find(
      (r) => r.aiMember?.roleDescription === "writer",
    );

    return {
      type: expectOutput || "research_report",
      content: writerResponse?.content || "",
      metadata: {
        contributorCount: responses.length,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
```

#### 8.3.4 AI Office适配器

**文件**: `backend/src/modules/ai/ai-teams/adapters/office-adapter.service.ts`

```typescript
import { Injectable } from "@nestjs/common";
import { BaseBusinessAdapter } from "./base-adapter.service";
import { TeamScenario, OfficeDocumentType } from "@prisma/client";

@Injectable()
export class OfficeAdapterService extends BaseBusinessAdapter {
  /**
   * 文档协作创作
   */
  async collaborateOnDocument(
    documentId: string,
    userId: string,
    requirement: string,
    documentType: OfficeDocumentType,
  ) {
    const scenario = this.mapDocumentTypeToScenario(documentType);

    return this.requestCollaboration(
      {
        resourceType: "office_document",
        resourceId: documentId,
        userId,
        scenario,
      },
      {
        taskDescription: requirement,
        expectOutput: documentType.toLowerCase(),
      },
    );
  }

  /**
   * 幻灯片团队协作（替代现有SlidesTeamOrchestrator）
   */
  async collaborateOnSlides(
    documentId: string,
    userId: string,
    requirement: string,
  ) {
    return this.requestCollaboration(
      {
        resourceType: "office_document",
        resourceId: documentId,
        userId,
        scenario: TeamScenario.PRESENTATION,
      },
      {
        taskDescription: requirement,
        targetRoles: ["leader", "writer", "designer"],
        expectOutput: "pptx",
      },
    );
  }

  private mapDocumentTypeToScenario(type: OfficeDocumentType): TeamScenario {
    switch (type) {
      case "PPT":
        return TeamScenario.PRESENTATION;
      case "SPREADSHEET":
        return TeamScenario.SPREADSHEET;
      default:
        return TeamScenario.DOCUMENT;
    }
  }

  protected buildTaskPrompt(request: CollaborationRequest): string {
    return `
【创作任务】
${request.taskDescription}

请团队协作完成：
1. 内容策划：确定文档结构和要点
2. 文案撰写：撰写具体内容
3. 质量审核：检查内容质量，提出修改建议

期望输出格式：${request.expectOutput}
    `.trim();
  }

  protected async processOutput(responses: any[], expectOutput?: string) {
    // 整合团队输出
    const finalContent = responses
      .filter((r) => r.aiMember?.roleDescription === "writer")
      .map((r) => r.content)
      .join("\n\n");

    return {
      type: expectOutput || "document",
      content: finalContent,
      metadata: {
        reviewed: responses.some(
          (r) => r.aiMember?.roleDescription === "moderator",
        ),
        timestamp: new Date().toISOString(),
      },
    };
  }
}
```

### 8.4 前端集成方案

#### 8.4.1 统一协作Hook

**文件**: `frontend/hooks/domain/useTeamCollaboration.ts`

```typescript
import { useState, useCallback } from "react";
import { useApi } from "@/hooks/core/useApi";

export interface TeamCollaborationOptions {
  resourceType: "research_project" | "office_document" | "report";
  resourceId: string;
  scenario: string;
}

export function useTeamCollaboration(options: TeamCollaborationOptions) {
  const api = useApi();
  const [topicId, setTopicId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 确保团队存在
  const ensureTeam = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await api.post("/api/teams/ensure", {
        resourceType: options.resourceType,
        resourceId: options.resourceId,
        scenario: options.scenario,
      });
      setTopicId(response.data.topicId);
      return response.data;
    } finally {
      setIsLoading(false);
    }
  }, [options]);

  // 发起协作请求
  const requestCollaboration = useCallback(
    async (taskDescription: string, targetRoles?: string[]) => {
      if (!topicId) {
        await ensureTeam();
      }

      return api.post(`/api/teams/topics/${topicId}/collaborate`, {
        taskDescription,
        targetRoles,
      });
    },
    [topicId, ensureTeam],
  );

  // 打开协作面板
  const openCollaborationPanel = useCallback(() => {
    if (topicId) {
      // 打开AI Teams侧边栏或弹窗
      window.dispatchEvent(
        new CustomEvent("openTeamPanel", {
          detail: { topicId },
        }),
      );
    }
  }, [topicId]);

  return {
    topicId,
    isLoading,
    ensureTeam,
    requestCollaboration,
    openCollaborationPanel,
  };
}
```

#### 8.4.2 AI Studio集成示例

**文件**: `frontend/app/ai-studio/[projectId]/page.tsx` (局部修改)

```tsx
import { useTeamCollaboration } from "@/hooks/domain/useTeamCollaboration";

export default function ResearchProjectPage({ params }) {
  const { projectId } = params;

  // 新增：团队协作能力
  const teamCollab = useTeamCollaboration({
    resourceType: "research_project",
    resourceId: projectId,
    scenario: "RESEARCH",
  });

  // 发起团队研究
  const handleTeamResearch = async () => {
    await teamCollab.requestCollaboration(
      `请对以下研究主题进行深度分析：${researchTopic}`,
      ["researcher", "analyst"],
    );
  };

  return (
    <div>
      {/* 现有研究界面 */}

      {/* 新增：团队协作按钮 */}
      <Button onClick={handleTeamResearch} loading={teamCollab.isLoading}>
        团队协作研究
      </Button>

      {/* 团队面板入口 */}
      {teamCollab.topicId && (
        <Button onClick={teamCollab.openCollaborationPanel}>
          查看团队讨论
        </Button>
      )}
    </div>
  );
}
```

### 8.5 现有模块改动清单

#### 8.5.1 AI Studio 改动

| 文件                                                | 改动类型 | 描述                       |
| --------------------------------------------------- | -------- | -------------------------- |
| `ai-studio/ai-studio.module.ts`                     | 修改     | 导入AiTeamsModule          |
| `ai-studio/ai-studio.service.ts`                    | 修改     | 注入ResearchAdapterService |
| `ai-studio/services/deep-research-agent.service.ts` | 修改     | 可选使用团队模式           |
| `ai-studio/dto/create-project.dto.ts`               | 修改     | 添加enableTeamMode字段     |

#### 8.5.2 AI Office 改动

| 文件                                                   | 改动类型 | 描述                     |
| ------------------------------------------------------ | -------- | ------------------------ |
| `ai-office/ai-office.module.ts`                        | 修改     | 导入AiTeamsModule        |
| `ai-office/slides/slides-team-orchestrator.service.ts` | 修改     | 使用OfficeAdapterService |
| `ai-office/docs/docs-orchestrator.service.ts`          | 修改     | 添加协作审核流程         |
| `ai-office/dto/*.dto.ts`                               | 修改     | 添加teamMode选项         |

#### 8.5.3 AI Reports 改动

| 文件                                                     | 改动类型 | 描述                      |
| -------------------------------------------------------- | -------- | ------------------------- |
| `content/reports/reports.module.ts`                      | 修改     | 导入AiTeamsModule         |
| `content/reports/reports.service.ts`                     | 修改     | 注入ReportsAdapterService |
| 新增 `content/reports/services/analysis-team.service.ts` | 新增     | 分析团队服务              |

### 8.6 API端点设计

#### 新增统一协作API

```
POST   /api/teams/ensure
       请求体: { resourceType, resourceId, scenario }
       响应: { topicId, team: { ... } }

POST   /api/teams/topics/:topicId/collaborate
       请求体: { taskDescription, targetRoles?, expectOutput? }
       响应: { messages: [...], output?: { ... } }

GET    /api/teams/linked/:resourceType/:resourceId
       响应: { topic: { ... }, aiMembers: [...] }

POST   /api/teams/topics/:topicId/debate
       请求体: { hypothesis, participants: string[] }
       响应: { debateSessionId, ... }
```

---

## 九、风险评估与缓解

| 风险         | 级别 | 缓解措施                                      |
| ------------ | ---- | --------------------------------------------- |
| 现有功能回归 | 中   | 保持现有API兼容，新功能通过enableTeamMode开关 |
| 性能下降     | 低   | 团队协作异步处理，不阻塞主流程                |
| 迁移复杂度   | 中   | 分阶段实施，优先核心场景                      |
| 用户学习成本 | 低   | 保持独立入口，团队能力作为增强                |

---

## 十、成功指标

| 指标           | 目标            | 衡量方式               |
| -------------- | --------------- | ---------------------- |
| 代码复用率     | 减少30%重复代码 | 删除Slides独立团队代码 |
| 协作任务完成率 | >90%            | 任务完成/任务发起      |
| 用户满意度     | >4.0/5          | 用户反馈调研           |
| 开发效率       | 新场景接入<2天  | 新业务上线时间         |

---

## 附录A：AI Teams 完整能力清单

### A.1 模块导出服务

**路径**: `backend/src/modules/ai/ai-teams/ai-teams.module.ts`

| 服务                          | 职责                     | 可复用性 |
| ----------------------------- | ------------------------ | -------- |
| `AiTeamsService`              | 核心团队服务，Topic CRUD | ✅ 高    |
| `DebateService`               | 红蓝辩论系统             | ✅ 高    |
| `ContextRouterService`        | 智能上下文路由           | ✅ 高    |
| `TeamMissionService`          | 任务编排引擎             | ✅ 高    |
| `TeamCollaborationService`    | 协作服务(Handoff/投票)   | ✅ 高    |
| `AiResponseService`           | AI响应生成               | ✅ 高    |
| `TopicMembershipService`      | 成员管理                 | ✅ 中    |
| `TopicPublicService`          | 公开团队管理             | ✅ 中    |
| `TopicForwardBookmarkService` | 转发书签                 | ✅ 中    |
| `TeamMemberAgent`             | 团队成员Agent            | ✅ 高    |
| `TeamsLLMAdapter`             | LLM多模型适配器          | ✅ 高    |
| `UrlParserService`            | URL解析工具              | ✅ 中    |
| `ContentExtractionService`    | 内容提取                 | ✅ 中    |

### A.2 REST API 端点 (50+)

#### Topic管理

```
POST   /topics                    创建团队
GET    /topics                    获取我的团队
GET    /topics/public             获取公开团队
GET    /topics/:topicId           获取团队详情
PATCH  /topics/:topicId           更新团队
POST   /topics/:topicId/archive   归档团队
DELETE /topics/:topicId           删除团队
```

#### 成员管理

```
GET    /topics/:topicId/members              获取成员列表
POST   /topics/:topicId/members              添加成员
POST   /topics/:topicId/members/invite       邮件邀请
POST   /topics/:topicId/members/batch        批量添加
PATCH  /topics/:topicId/members/:memberId    更新成员
DELETE /topics/:topicId/members/:memberId    移除成员
POST   /topics/:topicId/leave                离开团队
```

#### AI成员管理

```
GET    /topics/:topicId/ai-members                         获取AI成员
POST   /topics/:topicId/ai-members                         添加AI成员
POST   /topics/:topicId/ai-members/debate                  快速辩论配置
PATCH  /topics/:topicId/ai-members/:aiMemberId             更新AI成员
DELETE /topics/:topicId/ai-members/:aiMemberId             移除AI成员
POST   /topics/:topicId/ai-members/:aiMemberId/set-leader  设为Leader
PATCH  /topics/:topicId/ai-members/:aiMemberId/team-role   更新团队角色
```

#### 消息与互动

```
GET    /topics/:topicId/messages                              获取消息
POST   /topics/:topicId/messages                              发送消息
DELETE /topics/:topicId/messages/:messageId                   删除消息
POST   /topics/:topicId/messages/:messageId/reactions         添加反应
DELETE /topics/:topicId/messages/:messageId/reactions/:emoji  移除反应
POST   /topics/:topicId/read                                  标记已读
POST   /topics/:topicId/ai/generate                           触发AI响应
```

#### 任务编排

```
POST   /topics/:topicId/missions                    创建任务
GET    /topics/:topicId/missions                    任务列表
GET    /topics/:topicId/missions/:missionId         任务详情
POST   /topics/:topicId/missions/:missionId/cancel  取消任务
POST   /topics/:topicId/missions/:missionId/pause   暂停任务
POST   /topics/:topicId/missions/:missionId/resume  恢复任务
POST   /topics/:topicId/missions/:missionId/retry   重试任务
GET    /topics/:topicId/missions/:missionId/logs    任务日志
```

#### 辩论/资源/摘要/书签

```
GET    /topics/:topicId/debates                        辩论列表
GET    /topics/:topicId/debates/:debateId              辩论详情
GET    /topics/:topicId/resources                      资源列表
POST   /topics/:topicId/resources                      添加资源
GET    /topics/:topicId/summaries                      摘要列表
POST   /topics/:topicId/summaries                      生成摘要
POST   /topics/:topicId/messages/forward               转发消息
POST   /topics/:topicId/messages/:messageId/bookmark   书签消息
GET    /bookmarks                                      我的书签
```

### A.3 WebSocket 事件

**命名空间**: `/ai-teams`

| 事件               | 方向 | 说明          |
| ------------------ | ---- | ------------- |
| `topic:join`       | C→S  | 加入Topic房间 |
| `topic:leave`      | C→S  | 离开Topic房间 |
| `message:send`     | C→S  | 发送消息      |
| `message:typing`   | C→S  | 正在输入      |
| `message:read`     | C→S  | 标记已读      |
| `reaction:add`     | C→S  | 添加反应      |
| `reaction:remove`  | C→S  | 移除反应      |
| `message:new`      | S→C  | 新消息        |
| `ai:typing`        | S→C  | AI正在思考    |
| `ai:response`      | S→C  | AI响应完成    |
| `ai:error`         | S→C  | AI错误        |
| `debate:started`   | S→C  | 辩论开始      |
| `debate:completed` | S→C  | 辩论完成      |
| `member:online`    | S→C  | 成员上线      |
| `member:offline`   | S→C  | 成员离线      |
| `mention:new`      | S→C  | 被@提及       |

### A.4 角色与工具系统

#### 7个预定义角色

| 角色           | 工具集                                                  | 典型场景       |
| -------------- | ------------------------------------------------------- | -------------- |
| **researcher** | WEB_SEARCH, RAG_SEARCH, PAPER_SEARCH, KNOWLEDGE_GRAPH   | 信息收集与调研 |
| **analyst**    | DATA_ANALYSIS, PYTHON_EXECUTOR, DATABASE_QUERY          | 数据分析与洞察 |
| **writer**     | TEXT_GENERATION, EXPORT_DOCX, EXPORT_PDF                | 内容创作与文档 |
| **developer**  | CODE_GENERATION, PYTHON_EXECUTOR, GITHUB_INTEGRATION    | 代码生成与技术 |
| **designer**   | IMAGE_GENERATION, EXPORT_PPTX, TEMPLATE_RENDER          | 视觉设计与创意 |
| **moderator**  | AGENT_HANDOFF, CONSENSUS_MECHANISM, AGENT_COMMUNICATION | 协调与组织     |
| **leader**     | TASK_DELEGATION, WORKFLOW_ORCHESTRATION, HUMAN_APPROVAL | 任务分配与决策 |

#### 48种注册工具

**信息获取 (6)**: WebSearch, WebScraper, DataFetch, RAGSearch, DatabaseQuery, KnowledgeGraph

**内容生成 (6)**: TextGen, ImageGen, CodeGen, AudioGen, VideoGen, StructuredOutput

**数据处理 (7)**: DataAnalysis, FileConversion, FileParser, DataValidation, DataCleaning, DocumentDiff, TemplateRender

**代码执行 (6)**: PythonExecutor, JavaScriptExecutor, SQLExecutor, ShellExecutor, ContainerExecutor, OCR

**外部集成 (6)**: MessagePush, CloudStorage, GitHub, Email, Calendar, Webhook

**记忆管理 (5)**: ShortTermMemory, LongTermMemory, EntityMemory, KnowledgeBase, UserPreferences

**导出 (4)**: ExportPPTX, ExportDOCX, ExportPDF, ExportImage

**协作 (6)**: AgentHandoff, HumanApproval, AgentCommunication, TaskDelegation, Consensus, WorkflowOrchestration

### A.5 协作机制

#### 任务委派 (Handoff)

```typescript
interface HandoffRequest {
  topicId: string;
  fromMemberId: string; // 发起者
  toMemberId: string; // 接收者
  task: string; // 任务描述
  context?: Record<string, unknown>;
  waitForResult?: boolean; // 是否同步等待
}
```

#### 投票共识 (Voting)

```typescript
interface VoteRequest {
  topicId: string;
  proposalId: string;
  title: string;
  initiatorId: string;
  voterIds: string[];
  strategy: "MAJORITY" | "SUPERMAJORITY" | "UNANIMOUS";
  options?: string[];
}
```

#### 红蓝辩论

- Agent独立隔离的conversationHistory
- 支持多轮对话 (可配置轮次)
- 实时WebSocket广播进展
- 与Topic消息历史完全隔离

#### 任务编排 (Mission)

- AI自动分解任务
- 动态成员分配
- 优先级和依赖管理
- 状态跟踪: PLANNING → EXECUTING → COMPLETED/FAILED

---

## 附录B：对外开放能力分析

### B.1 开放能力现状评分

| 维度           | 现状             | 目标                | 评分 |
| -------------- | ---------------- | ------------------- | ---- |
| **API完整性**  | REST API完善     | 需增加OAuth/Webhook | 70%  |
| **SDK支持**    | 无官方SDK        | 需JS/TS SDK         | 0%   |
| **文档完善**   | Swagger部分存在  | 需完整OpenAPI       | 60%  |
| **扩展性**     | Tool可继承扩展   | 需插件动态加载      | 50%  |
| **事件驱动**   | 内部EventEmitter | 需Webhook/SSE       | 40%  |
| **开发者体验** | 无官方工具       | 需示例+文档站       | 30%  |
| **企业级特性** | 权限控制完善     | 需速率限制+配额     | 40%  |

**总体成熟度: 54%** → **目标: 90%**

### B.2 已有开放能力

✅ **REST API**

- 完整的CRUD操作
- RESTful规范设计
- JWT Token认证
- 细粒度权限控制 (OWNER/ADMIN/MEMBER)

✅ **WebSocket实时通信**

- Socket.IO支持
- 房间隔离
- 在线状态管理
- 最大10MB消息体

✅ **工具扩展机制**

- ITool接口可继承
- 完整的TypeScript类型
- Function Calling支持
- 多LLM Provider适配

✅ **角色自定义**

- systemPrompt自定义
- expertiseAreas专业领域
- workStyle工作风格
- capabilities能力配置

### B.3 缺失的开放能力

#### 🔴 高优先级 (应立即补充)

**1. 第三方应用集成**

```typescript
// 需要实现的API
POST /oauth/applications      # 创建应用
POST /oauth/authorize         # OAuth授权
POST /oauth/token             # 获取Token
POST /api-keys                # API Key管理
```

**2. Webhook事件推送**

```typescript
// 需要实现的API
POST /webhooks                # 创建Webhook订阅
DELETE /webhooks/:id          # 删除订阅

// 事件类型
webhook:message:created
webhook:ai:response
webhook:mission:completed
webhook:team:member:joined
webhook:team:member:mentioned
```

**3. 前端SDK包**

```typescript
// @deepdive/ai-teams-sdk
import { AITeamsClient, useAITeams } from "@deepdive/ai-teams-sdk";

const client = new AITeamsClient({ apiKey: "..." });
const { teams, messages, sendMessage } = useAITeams(topicId);
```

**4. 插件动态加载**

```typescript
interface IAITeamsPlugin {
  name: string;
  version: string;
  getTools?(): ITool[];
  beforeToolExecution?(tool, input): Promise<void>;
  afterToolExecution?(tool, result): Promise<void>;
}
```

#### 🟡 中优先级 (应完善)

**1. OpenAPI规范导出**

- 完整Swagger注解
- 自动客户端生成
- API版本管理

**2. 速率限制与配额**

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
```

**3. Server-Sent Events**

```
GET /topics/:topicId/events/stream
```

**4. GraphQL API** (可选)

```graphql
query {
  topics(filter: { type: PRIVATE }) {
    messages(limit: 10) {
      content
    }
  }
}
```

### B.4 与业界平台对比

| 功能      | AutoGen    | CrewAI   | LangGraph | **AI Teams** |
| --------- | ---------- | -------- | --------- | ------------ |
| Agent定义 | 完整类系统 | 灵活Role | 状态节点  | 7角色+自定义 |
| 工具系统  | 动态注册   | 48+工具  | 支持      | 48种工具     |
| API服务   | ❌         | ❌       | ❌        | ✅ REST+WS   |
| 实时通信  | ❌         | ❌       | ❌        | ✅ Socket.IO |
| 辩论机制  | GroupChat  | ❌       | ❌        | ✅ Red-Blue  |
| 任务编排  | ❌         | Process  | 状态机    | ✅ Mission   |
| 企业就绪  | ❌         | ❌       | ❌        | ✅ 权限+审计 |

**AI Teams独特优势**:

- 唯一提供REST API + WebSocket的Multi-Agent平台
- 唯一具备企业级权限控制的开源方案
- 红蓝辩论系统为独创设计

### B.5 开放能力改进路线

#### Phase 1 (1-2周)

- [ ] 完善Swagger文档与OpenAPI spec
- [ ] 实现API Key管理
- [ ] 添加速率限制
- [ ] 标准化错误响应格式

#### Phase 2 (2-4周)

- [ ] 实现Webhook事件推送
- [ ] 开放EventEmitter订阅
- [ ] 创建 `@deepdive/ai-teams-sdk`
- [ ] 发布TypeScript类型包

#### Phase 3 (4-8周)

- [ ] 实现OAuth2.0流程
- [ ] 建立插件市场
- [ ] 支持Plugin动态加载
- [ ] 创建开发者文档网站

#### Phase 4 (长期)

- [ ] GraphQL API支持
- [ ] 多语言SDK (Python, Java, Go)
- [ ] 开发者社区建设

---

## 附录C：关键文件路径

| 功能       | 文件路径                                                        |
| ---------- | --------------------------------------------------------------- |
| 模块定义   | `ai-teams/ai-teams.module.ts`                                   |
| REST API   | `ai-teams/ai-teams.controller.ts`                               |
| WebSocket  | `ai-teams/ai-teams.gateway.ts`                                  |
| 核心服务   | `ai-teams/ai-teams.service.ts`                                  |
| AI响应     | `ai-teams/services/ai/ai-response.service.ts`                   |
| 上下文路由 | `ai-teams/services/ai/context-router.service.ts`                |
| 辩论系统   | `ai-teams/services/collaboration/debate.service.ts`             |
| 任务编排   | `ai-teams/services/collaboration/team-mission.service.ts`       |
| 协作服务   | `ai-teams/services/collaboration/team-collaboration.service.ts` |
| Team Agent | `ai-teams/agents/team-member.agent.ts`                          |
| LLM适配器  | `ai-teams/agents/teams-llm-adapter.ts`                          |
