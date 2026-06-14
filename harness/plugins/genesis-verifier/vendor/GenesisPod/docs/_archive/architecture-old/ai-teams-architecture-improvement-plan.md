# AI Teams 架构系统性完善方案

> **目标**: 补齐关键能力，确保架构简洁有效、符合最佳实践、高性能、可扩展、DFx满足
> **创建时间**: 2026-01-01
> **状态**: 待实施

---

## 目标架构图

### 整体系统架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (Next.js)                              │
├──────────────────┬──────────────────┬──────────────────┬───────────────────┤
│   AI Studio      │    AI Office     │   AI Reports     │    AI Teams       │
│   /ai-studio     │    /ai-office    │   (workspace)    │    /ai-teams      │
│   研究工作室      │    办公套件       │   报告系统        │    团队协作        │
└────────┬─────────┴────────┬─────────┴────────┬─────────┴─────────┬─────────┘
         │                  │                  │                   │
         └──────────────────┴──────────────────┴───────────────────┘
                                    │
                     ┌──────────────▼──────────────┐
                     │     API Gateway Layer       │
                     │  (Rate Limit + Auth + Audit)│
                     └──────────────┬──────────────┘
                                    │
┌───────────────────────────────────▼───────────────────────────────────────┐
│                         AI Teams Core Engine                               │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                    Orchestration Layer (新增)                       │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐   │   │
│  │  │ MessageOrchestrator│  │ MissionOrchestrator│  │ DebateOrchestrator│ │   │
│  │  │ (消息编排)         │  │ (任务编排)          │  │ (辩论编排)       │   │   │
│  │  └──────────────────┘  └──────────────────┘  └─────────────────┘   │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                    │                                       │
│  ┌─────────────────────────────────▼──────────────────────────────────┐   │
│  │                      Service Layer (核心服务)                        │   │
│  │                                                                     │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │   │
│  │  │    Topic     │  │      AI      │  │      Collaboration       │  │   │
│  │  │   Services   │  │   Services   │  │        Services          │  │   │
│  │  ├──────────────┤  ├──────────────┤  ├──────────────────────────┤  │   │
│  │  │ TopicCRUD    │  │ AIResponse   │  │ TeamCollaboration        │  │   │
│  │  │ Membership   │  │ ContextRouter│  │ TeamMission              │  │   │
│  │  │ Messages     │  └──────────────┘  │ Debate                   │  │   │
│  │  │ Resources    │                    └──────────────────────────┘  │   │
│  │  │ Summaries    │                                                  │   │
│  │  └──────────────┘                                                  │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                    │                                       │
│  ┌─────────────────────────────────▼──────────────────────────────────┐   │
│  │                      Agent Layer (AI Agent)                         │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐   │   │
│  │  │ TeamMember   │  │ TeamsLLM     │  │     Tool Registry       │   │   │
│  │  │   Agent      │  │   Adapter    │  │   (48 Registered Tools) │   │   │
│  │  └──────────────┘  └──────────────┘  └─────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│   PostgreSQL    │        │  Memory Cache   │        │   LLM Providers │
│   (Prisma ORM)  │        │  (In-Process)   │        │ OpenAI/Claude/  │
│                 │        │                 │        │ Grok/Gemini     │
└─────────────────┘        └─────────────────┘        └─────────────────┘
```

### 通信架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Communication Layer                             │
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                    REST API (Controller)                         │    │
│   │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │    │
│   │  │ Topics  │ │Messages │ │  AI     │ │Missions │ │ Users   │   │    │
│   │  │  CRUD   │ │  Send   │ │Generate │ │ Control │ │ Manage  │   │    │
│   │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                WebSocket Gateway (Real-time)                     │    │
│   │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │    │
│   │  │ message:new │ │ ai:typing   │ │ ai:response │ │vote:cast  │ │    │
│   │  │ message:edit│ │ ai:complete │ │ debate:turn │ │mission:*  │ │    │
│   │  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                   SSE Stream (新增)                              │    │
│   │  ┌─────────────────────────────────────────────────────────┐    │    │
│   │  │ /ai/generate/stream - AI响应流式输出                      │    │    │
│   │  └─────────────────────────────────────────────────────────┘    │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                   Webhook (新增)                                 │    │
│   │  ┌─────────────────────────────────────────────────────────┐    │    │
│   │  │ message.created | mission.completed | debate.finished   │    │    │
│   │  └─────────────────────────────────────────────────────────┘    │    │
│   └─────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

### 可观测性架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Observability Stack (新增)                        │
│                                                                           │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│   │ Structured      │  │   Metrics       │  │   Distributed Tracing   │  │
│   │ Logger          │  │   Service       │  │   (@Trace decorator)    │  │
│   ├─────────────────┤  ├─────────────────┤  ├─────────────────────────┤  │
│   │ JSON Format     │  │ Prometheus      │  │ OpenTelemetry           │  │
│   │ Trace ID        │  │ ai_response_*   │  │ Span Context            │  │
│   │ Context Aware   │  │ mission_*       │  │ Error Recording         │  │
│   │ Request Scoped  │  │ ws_connections  │  │ Attribute Tagging       │  │
│   └─────────────────┘  └─────────────────┘  └─────────────────────────┘  │
│           │                    │                       │                  │
│           ▼                    ▼                       ▼                  │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                     Centralized Logging / APM                    │    │
│   │             (ELK Stack / Grafana / Jaeger / etc.)                │    │
│   └─────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

### 安全架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Security Layer (新增/增强)                       │
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                      Request Pipeline                            │    │
│   │                                                                   │    │
│   │   Request → Auth → RateLimit → Validation → Controller → Audit   │    │
│   │              │         │           │                        │     │    │
│   │              ▼         ▼           ▼                        ▼     │    │
│   │         JWT/API   Memory-based class-validator         AuditLog   │    │
│   │         Guard     Limiter      + Sanitize              Service    │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                                                                           │
│   Rate Limit Rules:                                                       │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │ Endpoint              │ Limit           │ Window                │    │
│   ├───────────────────────┼─────────────────┼───────────────────────┤    │
│   │ POST /messages        │ 60 requests     │ 60 seconds            │    │
│   │ POST /ai/generate     │ 10 requests     │ 60 seconds            │    │
│   │ POST /missions        │ 20 requests     │ 60 seconds            │    │
│   │ POST /topics          │ 30 requests     │ 60 seconds            │    │
│   └─────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

### 服务层详细结构

```
services/
├── index.ts                              # 统一导出
├── topic-event-emitter.service.ts        # 事件解耦
│
├── orchestration/                        # 【新增】编排层
│   ├── index.ts
│   ├── message-orchestrator.service.ts   # 消息编排
│   │   ├── orchestrateAfterMessage()     # 消息后处理入口
│   │   ├── detectDebateMode()            # 辩论检测
│   │   ├── triggerAIResponseAsync()      # 异步AI响应
│   │   └── collectAIMembersToRespond()   # 收集响应成员
│   └── __tests__/
│       └── message-orchestrator.service.spec.ts
│
├── topic/                                # Topic相关 (保持)
│   ├── index.ts
│   ├── topic-crud.service.ts
│   ├── topic-membership.service.ts
│   ├── topic-messages.service.ts
│   ├── topic-resources.service.ts
│   ├── topic-summaries.service.ts
│   ├── topic-forward-bookmark.service.ts
│   ├── topic-public.service.ts
│   └── __tests__/                        # 【新增】测试
│       ├── topic-crud.service.spec.ts
│       └── topic-membership.service.spec.ts
│
├── ai/                                   # AI相关
│   ├── index.ts
│   ├── ai-response.service.ts            # 【增强】+指标+追踪
│   │   ├── generateAIResponse()
│   │   ├── @Trace('ai.generate')         # 追踪装饰器
│   │   └── metrics.record*()             # 指标记录
│   ├── context-router.service.ts
│   └── __tests__/                        # 【新增】测试
│       ├── ai-response.service.spec.ts
│       └── context-router.service.spec.ts
│
├── collaboration/                        # 协作相关
│   ├── index.ts
│   ├── team-collaboration.service.ts     # 【修改】数据库持久化
│   │   ├── createVoteProposal()          # 持久化到DB
│   │   ├── castMemberVote()              # 持久化到DB
│   │   └── getProposalStatus()           # 从DB查询
│   ├── team-mission.service.ts
│   ├── debate.service.ts
│   └── __tests__/
│       └── team-collaboration.service.spec.ts
│
└── utils/                                # 工具服务
    ├── index.ts
    ├── url-parser.service.ts
    └── content-extraction.service.ts
```

### 数据模型扩展

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Database Schema (新增)                            │
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                      VoteProposal                                │    │
│   ├─────────────────────────────────────────────────────────────────┤    │
│   │ id          : String (cuid)       PK                            │    │
│   │ topicId     : String              FK -> Topic                   │    │
│   │ title       : String                                            │    │
│   │ description : Text                                              │    │
│   │ initiatorId : String              FK -> TopicAIMember           │    │
│   │ strategy    : VoteStrategy        MAJORITY|SUPERMAJORITY|UNAN.  │    │
│   │ options     : String[]                                          │    │
│   │ status      : ProposalStatus      OPEN|CLOSED                   │    │
│   │ createdAt   : DateTime                                          │    │
│   │ closedAt    : DateTime?                                         │    │
│   │                                                                  │    │
│   │ Index: (topicId, status)                                        │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                              │ 1:N                                        │
│                              ▼                                            │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                       VoteRecord                                 │    │
│   ├─────────────────────────────────────────────────────────────────┤    │
│   │ id          : String (cuid)       PK                            │    │
│   │ proposalId  : String              FK -> VoteProposal            │    │
│   │ voterId     : String              FK -> TopicAIMember           │    │
│   │ value       : VoteValue           APPROVE|REJECT|ABSTAIN        │    │
│   │ reason      : String?                                           │    │
│   │ createdAt   : DateTime                                          │    │
│   │                                                                  │    │
│   │ Unique: (proposalId, voterId)                                   │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                        Webhook                                   │    │
│   ├─────────────────────────────────────────────────────────────────┤    │
│   │ id          : String (cuid)       PK                            │    │
│   │ url         : String              Webhook target URL            │    │
│   │ events      : String[]            Subscribed events             │    │
│   │ secret      : String              HMAC signing secret           │    │
│   │ isActive    : Boolean                                           │    │
│   │ createdAt   : DateTime                                          │    │
│   │ lastTriggered: DateTime?                                        │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                       AuditLog                                   │    │
│   ├─────────────────────────────────────────────────────────────────┤    │
│   │ id          : String (cuid)       PK                            │    │
│   │ action      : String              CREATE|UPDATE|DELETE|...      │    │
│   │ resourceType: String              topic|message|mission|...     │    │
│   │ resourceId  : String                                            │    │
│   │ userId      : String              FK -> User                    │    │
│   │ ipAddress   : String?                                           │    │
│   │ userAgent   : String?                                           │    │
│   │ metadata    : Json?                                             │    │
│   │ timestamp   : DateTime                                          │    │
│   │                                                                  │    │
│   │ Index: (resourceType, resourceId)                               │    │
│   │ Index: (userId, timestamp)                                      │    │
│   └─────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 执行摘要

**当前成熟度**: 54% → **目标成熟度**: 90%

**核心改进点**:

- 测试覆盖率: 5% → 80%
- Controller瘦身: 1200行 → 300行
- 提案存储: 内存Map → 数据库持久化
- 可观测性: Logger → 结构化日志+指标+追踪
- 安全性: 基础验证 → 速率限制+审计日志

---

## 一、现状分析

### 1.1 架构概况

| 维度         | 现状                              | 评估       |
| ------------ | --------------------------------- | ---------- |
| **代码规模** | Controller 1224行，Service 1233行 | 中等复杂度 |
| **模块化**   | 已完成目录重构，按功能分组        | 良好       |
| **测试覆盖** | 3个测试文件，覆盖率~5%            | 不足       |
| **并发控制** | 使用 concurrency.utils.ts         | 良好       |
| **事件解耦** | TopicEventEmitterService          | 良好       |

### 1.2 关键问题

1. **测试覆盖不足**: 仅3个测试文件
2. **提案内存存储**: 非持久化，重启丢失
3. **Controller臃肿**: 包含大量业务逻辑
4. **缺乏可观测性**: 仅有Logger，无指标和追踪
5. **安全性不足**: 缺乏速率限制、审计日志

---

## 二、改进优先级矩阵

### P0 - 立即执行（高影响、低工作量）

| 改进项                     | 价值         | 工作量 |
| -------------------------- | ------------ | ------ |
| 添加核心服务单元测试       | 提高可维护性 | 2-3天  |
| 提案持久化到数据库         | 数据可靠性   | 1天    |
| Controller逻辑抽取到服务层 | 代码质量     | 2天    |

### P1 - 规划执行（高影响、高工作量）

| 改进项          | 价值     | 工作量 |
| --------------- | -------- | ------ |
| 速率限制中间件  | 安全性   | 3天    |
| 结构化日志+指标 | 可观测性 | 2天    |
| OpenAPI规范导出 | 对外开放 | 2天    |

### P2 - 后续迭代

| 改进项          | 价值     | 工作量 |
| --------------- | -------- | ------ |
| Webhook事件推送 | 对外开放 | 5天    |
| SSE流式响应     | 用户体验 | 3天    |
| 分布式追踪      | 可观测性 | 5天    |

---

## 三、分阶段实施计划

### Phase 1: 基础加固（8-10人天）

#### 1.1 测试覆盖提升

```
新增测试文件:
├── services/ai/__tests__/
│   ├── ai-response.service.spec.ts
│   └── context-router.service.spec.ts
├── services/topic/__tests__/
│   ├── topic-crud.service.spec.ts
│   ├── topic-membership.service.spec.ts
│   └── topic-messages.service.spec.ts
├── __tests__/
│   ├── ai-teams.service.spec.ts
│   └── ai-teams.gateway.spec.ts
```

#### 1.2 Controller瘦身

新增编排服务，抽取业务逻辑：

```typescript
// 新增: services/orchestration/message-orchestrator.service.ts
@Injectable()
export class MessageOrchestratorService {
  // 消息发送后的编排逻辑
  async orchestrateAfterMessage(
    topicId: string,
    userId: string,
    message: TopicMessage,
    mentions: MentionDto[],
  ): Promise<void>;

  // 辩论模式检测
  detectDebateMode(
    content: string,
    aiMembers: AIMember[],
  ): DebateDetectionResult;

  // 后台AI响应触发
  triggerAIResponseAsync(params: AIResponseParams): void;
}
```

#### 1.3 提案持久化

```prisma
model VoteProposal {
  id          String         @id @default(cuid())
  topicId     String
  title       String
  description String         @db.Text
  initiatorId String
  strategy    VoteStrategy   // MAJORITY, SUPERMAJORITY, UNANIMOUS
  options     String[]
  status      ProposalStatus @default(OPEN)
  createdAt   DateTime       @default(now())
  closedAt    DateTime?

  votes       VoteRecord[]
  topic       Topic          @relation(...)

  @@index([topicId, status])
}

model VoteRecord {
  id          String    @id @default(cuid())
  proposalId  String
  voterId     String
  value       VoteValue // APPROVE, REJECT, ABSTAIN
  reason      String?
  createdAt   DateTime  @default(now())

  proposal    VoteProposal @relation(...)

  @@unique([proposalId, voterId])
}
```

### Phase 2: 可观测性增强（6-8人天）

#### 2.1 结构化指标

```typescript
// 新增: common/observability/metrics.service.ts
@Injectable()
export class MetricsService {
  recordAIResponseLatency(model: string, duration: number): void;
  recordAIResponseTokens(model: string, tokens: number): void;
  recordAIResponseError(model: string, errorType: string): void;
  recordMissionCompleted(topicId: string, duration: number): void;
}
```

#### 2.2 链路追踪装饰器

```typescript
// 新增: common/observability/tracing.decorator.ts
export function Trace(operationName?: string) {
  return function (target, propertyKey, descriptor) {
    // OpenTelemetry span 包装
  };
}
```

### Phase 3: 安全加固（5-7人天）

#### 3.1 速率限制

```typescript
// 新增: common/guards/rate-limit.guard.ts
@Injectable()
export class RateLimitGuard implements CanActivate {
  // Memory-based rate limiting (使用Map + 滑动窗口算法)
  // 单进程适用，如需分布式可扩展为Redis实现
}

// 使用
@Post(':topicId/messages')
@RateLimit({ maxRequests: 60, windowSeconds: 60 })
async sendMessage(...) {}

@Post(':topicId/ai/generate')
@RateLimit({ maxRequests: 10, windowSeconds: 60 })
async generateAIResponse(...) {}
```

#### 3.2 审计日志

```typescript
// 新增: common/audit/audit.service.ts
@Injectable()
export class AuditService {
  async log(entry: AuditEntry): Promise<void>;
}

// 装饰器
@Audit(AuditAction.MISSION_CREATE)
async createMission(...) {}
```

### Phase 4: 对外开放（8-10人天）

#### 4.1 OpenAPI规范

- 添加Swagger装饰器
- 导出openapi.json

#### 4.2 Webhook系统

```
新增: modules/webhooks/
├── webhooks.module.ts
├── webhooks.service.ts
├── webhook-dispatcher.service.ts
└── dto/
```

#### 4.3 SSE流式响应

```typescript
@Get(':topicId/ai/generate/stream')
@Sse()
async generateAIResponseStream(...): Observable<MessageEvent>;
```

---

## 四、关键文件清单

### 需要创建的文件

```
backend/src/modules/ai/ai-teams/
├── services/orchestration/
│   ├── index.ts
│   ├── message-orchestrator.service.ts
│   └── __tests__/message-orchestrator.service.spec.ts
├── services/ai/__tests__/
│   ├── ai-response.service.spec.ts
│   └── context-router.service.spec.ts
├── services/topic/__tests__/
│   ├── topic-crud.service.spec.ts
│   └── topic-membership.service.spec.ts
└── constants/error-codes.constants.ts

backend/src/common/
├── observability/
│   ├── metrics.service.ts
│   ├── structured-logger.service.ts
│   └── tracing.decorator.ts
├── guards/rate-limit.guard.ts           # 内存滑动窗口限流
├── audit/audit.service.ts
└── decorators/
    ├── rate-limit.decorator.ts
    └── audit.decorator.ts

backend/src/modules/webhooks/
├── webhooks.module.ts
├── webhooks.service.ts
└── webhook-dispatcher.service.ts
```

### 需要修改的文件

| 文件                            | 修改内容                                 |
| ------------------------------- | ---------------------------------------- |
| `ai-teams.controller.ts`        | 抽取业务逻辑到MessageOrchestratorService |
| `ai-teams.module.ts`            | 添加新服务到providers                    |
| `team-collaboration.service.ts` | 替换内存Map为数据库操作                  |
| `prisma/schema.prisma`          | 添加VoteProposal, VoteRecord模型         |
| `ai-response.service.ts`        | 添加指标记录和追踪                       |

---

## 五、DFx改进策略

### Testability（可测试性）

| 措施             | 实施方式                   |
| ---------------- | -------------------------- |
| 单元测试覆盖>80% | 为每个服务创建.spec.ts     |
| Mock规范化       | 创建`__mocks__/`目录       |
| 集成测试         | TestingModule + 内存数据库 |

### Maintainability（可维护性）

| 措施       | 实施方式                            |
| ---------- | ----------------------------------- |
| 服务分层   | Controller → Orchestrator → Service |
| 统一错误码 | 创建error-codes.constants.ts                  |
| README文档 | 每个服务目录添加README              |

### Observability（可观测性）

| 措施       | 实施方式                        |
| ---------- | ------------------------------- |
| 结构化日志 | JSON格式StructuredLogger        |
| 业务指标   | MetricsService (Prometheus格式) |
| 链路追踪   | @Trace装饰器 (OpenTelemetry)    |

### Security（安全性）

| 措施     | 实施方式                                  |
| -------- | ----------------------------------------- |
| 输入验证 | class-validator + Sanitize                |
| 速率限制 | Memory-based RateLimitGuard (可扩展Redis) |
| 审计日志 | AuditService + 装饰器                     |

---

## 六、服务层重构后结构

```
services/
├── index.ts
├── topic-event-emitter.service.ts
│
├── topic/                      # Topic相关（保持不变）
│   ├── topic-crud.service.ts
│   ├── topic-membership.service.ts
│   ├── topic-messages.service.ts
│   └── __tests__/              # 新增测试
│
├── ai/                         # AI相关
│   ├── ai-response.service.ts
│   ├── context-router.service.ts
│   └── __tests__/              # 新增测试
│
├── collaboration/              # 协作相关
│   ├── team-collaboration.service.ts  # 修改：数据库持久化
│   ├── team-mission.service.ts
│   ├── debate.service.ts
│   └── __tests__/
│
├── orchestration/              # 新增：编排层
│   ├── message-orchestrator.service.ts
│   └── __tests__/
│
└── utils/                      # 工具服务
    ├── url-parser.service.ts
    └── content-extraction.service.ts
```

---

## 七、工时估算

| 阶段     | 内容     | 工时          |
| -------- | -------- | ------------- |
| Phase 1  | 基础加固 | 8-10人天      |
| Phase 2  | 可观测性 | 6-8人天       |
| Phase 3  | 安全加固 | 5-7人天       |
| Phase 4  | 对外开放 | 8-10人天      |
| **总计** |          | **27-35人天** |

---

## 八、Critical Files

实施时需重点关注的文件：

1. **`backend/src/modules/ai/ai-teams/ai-teams.controller.ts`** - 核心控制器，需抽取业务逻辑
2. **`backend/src/modules/ai/ai-teams/services/collaboration/team-collaboration.service.ts`** - 内存Map改数据库
3. **`backend/src/modules/ai/ai-teams/services/ai/ai-response.service.ts`** - 添加指标和追踪
4. **`backend/src/modules/ai/ai-teams/ai-teams.module.ts`** - 注册新服务
5. **`backend/prisma/schema.prisma`** - 添加VoteProposal模型

---

## 相关文档

- [AI Teams 核心能力构建业务系统分析方案](./ai-teams-core-integration-plan.md)
- [AI Teams 服务 README](../../backend/src/modules/ai/ai-teams/services/__README__.md)
- [AI Teams 重构总结](../../backend/src/modules/ai/ai-teams/REFACTORING_SUMMARY.md)

