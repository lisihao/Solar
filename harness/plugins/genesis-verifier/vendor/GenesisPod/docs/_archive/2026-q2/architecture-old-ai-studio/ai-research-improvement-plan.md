# AI Research 模块改进计划

> 基于系统架构评估、代码质量审查和安全审计的综合改进方案
>
> **核心原则：既有功能不能有任何破坏**

---

## 执行摘要

| 指标           | 现状        | 目标     |
| -------------- | ----------- | -------- |
| 架构评分       | 4/5         | 4.5/5    |
| 代码质量       | 7/10        | 8.5/10   |
| 安全评分       | B+ (85%)    | A (95%)  |
| 技术债务       | 90-150 小时 | 减少 60% |
| 单文件最大行数 | 3011 行     | < 500 行 |
| 测试覆盖率     | ~35%        | > 70%    |

---

## 第一阶段：安全加固（优先级：紧急）

### 1.1 前端 XSS 防护增强

**问题**：ReactMarkdown 未配置 DOMPurify，存在 XSS 风险

**影响范围**：

- `frontend/components/ai-research/reports/ReportEditor.tsx`
- `frontend/components/ai-research/topics/TopicReportView.tsx`
- 所有使用 ReactMarkdown 渲染用户内容的组件

**实施方案**：

```typescript
// frontend/lib/utils/sanitize.ts (新建)
import DOMPurify from "dompurify";

export const sanitizeHtml = (dirty: string): string => {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "u",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "a",
      "img",
      "blockquote",
      "code",
      "pre",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "span",
      "div",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "class", "id", "target", "rel"],
    ALLOW_DATA_ATTR: false,
  });
};

export const sanitizeMarkdown = (markdown: string): string => {
  // 移除危险的 HTML 标签和属性
  return markdown
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "");
};
```

**修改文件**：

1. `frontend/lib/utils/sanitize.ts` - 新建
2. `frontend/components/ai-research/reports/ReportEditor.tsx` - 集成 sanitize

**验证方式**：

```typescript
// 测试用例
const xssPayloads = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '<a href="javascript:alert(1)">link</a>',
];
// 确保所有 payload 被过滤
```

**预估工时**：4 小时
**风险等级**：低（只增加过滤，不改变渲染逻辑）

---

### 1.2 后端 Prompt Injection 增强

**问题**：现有 sanitizer 覆盖不完整

**修改文件**：`backend/src/modules/ai-app/research/topic-research/utils/prompt-sanitizer.ts`

**增强方案**：

```typescript
// 新增检测模式
const INJECTION_PATTERNS = [
  // 现有模式...
  /ignore\s+(all\s+)?previous/i,
  /disregard\s+(all\s+)?instructions/i,
  /system\s*:\s*you\s+are/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  /\[\/INST\]/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
];

// 新增上下文隔离
export function wrapUserInput(input: string): string {
  const sanitized = sanitizePrompt(input);
  return `<user_input>${sanitized}</user_input>`;
}
```

**验证方式**：运行现有单元测试 + 新增 Prompt Injection 测试用例

**预估工时**：2 小时
**风险等级**：低（只增加过滤规则）

---

## 第二阶段：服务拆分（优先级：高）

### 2.1 TopicResearchService 拆分

**现状**：2841 行，职责过重

**目标结构**：

```
topic-research/
├── services/
│   ├── topic-crud.service.ts        # CRUD 操作 (~300 行)
│   ├── topic-query.service.ts       # 查询和过滤 (~200 行)
│   ├── topic-export.service.ts      # 导出功能 (~250 行)
│   ├── topic-sharing.service.ts     # 分享功能 (~150 行)
│   └── topic-template.service.ts    # 模板管理 (~200 行)
└── topic-research.service.ts        # 门面层，委托调用 (~300 行)
```

**实施步骤**：

#### Step 1: 创建子服务（不修改原服务）

```typescript
// services/topic-crud.service.ts
@Injectable()
export class TopicCrudService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: ResearchEventEmitterService,
  ) {}

  async create(dto: CreateTopicDto, userId: string): Promise<Topic> {
    // 从 TopicResearchService 迁移
  }

  async update(id: string, dto: UpdateTopicDto): Promise<Topic> {
    // 从 TopicResearchService 迁移
  }

  async delete(id: string): Promise<void> {
    // 从 TopicResearchService 迁移
  }
}
```

#### Step 2: 在原服务中注入子服务，委托调用

```typescript
// topic-research.service.ts
@Injectable()
export class TopicResearchService {
  constructor(
    // 新增子服务注入
    private topicCrudService: TopicCrudService,
    private topicQueryService: TopicQueryService,
    private topicExportService: TopicExportService,
    // ... 保留现有依赖
  ) {}

  // 委托给子服务（保持原有方法签名不变）
  async createTopic(dto: CreateTopicDto, userId: string): Promise<Topic> {
    return this.topicCrudService.create(dto, userId);
  }
}
```

#### Step 3: 渐进式迁移

每次迁移一个方法组：

1. 在子服务中实现
2. 原服务委托调用
3. 运行测试验证
4. 重复

**预估工时**：16 小时
**风险等级**：低（保持 API 不变，只重构内部实现）

---

### 2.2 ResearchMissionService 拆分

**现状**：3011 行，职责混杂

**目标结构**：

```
services/
├── mission/
│   ├── mission-lifecycle.service.ts  # 生命周期管理 (~400 行)
│   ├── mission-state.service.ts      # 状态机管理 (~300 行)
│   ├── mission-progress.service.ts   # 进度追踪 (~250 行)
│   ├── mission-recovery.service.ts   # 故障恢复 (~200 行)
│   └── mission-metrics.service.ts    # 指标收集 (~150 行)
└── research-mission.service.ts       # 门面层 (~400 行)
```

**状态机抽取**：

```typescript
// services/mission/mission-state.service.ts
import { Injectable } from "@nestjs/common";

export enum MissionState {
  PENDING = "pending",
  PLANNING = "planning",
  RESEARCHING = "researching",
  SYNTHESIZING = "synthesizing",
  REVIEWING = "reviewing",
  COMPLETED = "completed",
  FAILED = "failed",
  PAUSED = "paused",
}

export interface StateTransition {
  from: MissionState;
  to: MissionState;
  condition?: () => boolean;
  onTransition?: () => Promise<void>;
}

@Injectable()
export class MissionStateService {
  private readonly transitions: StateTransition[] = [
    { from: MissionState.PENDING, to: MissionState.PLANNING },
    { from: MissionState.PLANNING, to: MissionState.RESEARCHING },
    { from: MissionState.RESEARCHING, to: MissionState.SYNTHESIZING },
    { from: MissionState.SYNTHESIZING, to: MissionState.REVIEWING },
    { from: MissionState.REVIEWING, to: MissionState.COMPLETED },
    // 允许任意状态转为 FAILED 或 PAUSED
    { from: MissionState.PLANNING, to: MissionState.FAILED },
    { from: MissionState.RESEARCHING, to: MissionState.FAILED },
    // ...
  ];

  canTransition(from: MissionState, to: MissionState): boolean {
    return this.transitions.some((t) => t.from === from && t.to === to);
  }

  async transition(missionId: string, to: MissionState): Promise<void> {
    // 验证转换合法性
    // 执行转换
    // 触发事件
  }
}
```

**预估工时**：20 小时
**风险等级**：中（需要仔细测试状态转换）

---

### 2.3 ResearchLeaderService 拆分

**现状**：2913 行

**目标结构**：

```
services/
├── leader/
│   ├── leader-planning.service.ts    # 研究规划 (~400 行)
│   ├── leader-coordination.service.ts # Agent 协调 (~350 行)
│   ├── leader-decision.service.ts    # 决策逻辑 (~300 行)
│   └── leader-reporting.service.ts   # 汇报处理 (~250 行)
└── research-leader.service.ts        # 门面层 (~300 行)
```

**预估工时**：16 小时
**风险等级**：中

---

## 第三阶段：架构优化（优先级：中）

### 3.1 引入 Redis 状态管理

**问题**：内存状态在多实例部署时不同步

**实施方案**：

#### Step 1: 创建状态存储抽象

```typescript
// backend/src/common/state/state-store.interface.ts
export interface StateStore<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

// backend/src/common/state/memory-state-store.ts
@Injectable()
export class MemoryStateStore<T> implements StateStore<T> {
  private store = new Map<string, { value: T; expiry?: number }>();
  // 实现接口方法
}

// backend/src/common/state/redis-state-store.ts
@Injectable()
export class RedisStateStore<T> implements StateStore<T> {
  constructor(private redis: Redis) {}
  // 实现接口方法
}
```

#### Step 2: 修改现有服务使用抽象

```typescript
// services/research-mission.service.ts
@Injectable()
export class ResearchMissionService {
  constructor(
    @Inject("MISSION_STATE_STORE")
    private stateStore: StateStore<MissionState>,
  ) {}

  async getMissionState(missionId: string): Promise<MissionState> {
    return this.stateStore.get(`mission:${missionId}:state`);
  }
}
```

#### Step 3: 配置切换

```typescript
// 根据环境变量选择实现
{
  provide: 'MISSION_STATE_STORE',
  useFactory: (config: ConfigService) => {
    if (config.get('REDIS_URL')) {
      return new RedisStateStore();
    }
    return new MemoryStateStore();
  },
}
```

**预估工时**：12 小时
**风险等级**：低（保持向后兼容）

---

### 3.2 解决循环依赖

**问题**：`TopicResearchService ↔ ResearchMissionService` 循环依赖

**解决方案**：事件驱动解耦

```typescript
// 定义事件接口
// types/events.types.ts
export interface TopicCreatedEvent {
  topicId: string;
  userId: string;
  config: ResearchConfig;
}

export interface MissionCompletedEvent {
  missionId: string;
  topicId: string;
  result: ResearchResult;
}

// TopicResearchService 发布事件而非直接调用
@Injectable()
export class TopicResearchService {
  async createTopic(dto: CreateTopicDto, userId: string): Promise<Topic> {
    const topic = await this.prisma.topic.create({ ... });

    // 发布事件而非直接调用 missionService
    this.eventEmitter.emit('topic.created', {
      topicId: topic.id,
      userId,
      config: dto.config,
    } as TopicCreatedEvent);

    return topic;
  }
}

// ResearchMissionService 订阅事件
@Injectable()
export class ResearchMissionService {
  @OnEvent('topic.created')
  async handleTopicCreated(event: TopicCreatedEvent): Promise<void> {
    await this.createMission(event.topicId, event.config);
  }
}
```

**预估工时**：8 小时
**风险等级**：中（需要测试事件流程）

---

## 第四阶段：代码质量提升（优先级：中）

### 4.1 统一错误处理

**创建领域异常**：

```typescript
// exceptions/research.exceptions.ts
export class ResearchException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
  ) {
    super({ code, message }, status);
  }
}

export class TopicNotFoundException extends ResearchException {
  constructor(topicId: string) {
    super(
      "TOPIC_NOT_FOUND",
      `Topic ${topicId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}

export class MissionInProgressException extends ResearchException {
  constructor(topicId: string) {
    super(
      "MISSION_IN_PROGRESS",
      `Topic ${topicId} already has an active mission`,
      HttpStatus.CONFLICT,
    );
  }
}

export class InsufficientCreditsException extends ResearchException {
  constructor(required: number, available: number) {
    super(
      "INSUFFICIENT_CREDITS",
      `Insufficient credits: ${available}/${required}`,
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
```

**创建全局异常过滤器**：

```typescript
// filters/research-exception.filter.ts
@Catch(ResearchException)
export class ResearchExceptionFilter implements ExceptionFilter {
  catch(exception: ResearchException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    response.status(exception.getStatus()).json({
      success: false,
      error: {
        code: exception.code,
        message: exception.message,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
```

**预估工时**：6 小时
**风险等级**：低

---

### 4.2 增加单元测试

**测试覆盖目标**：

| 服务                   | 当前覆盖率 | 目标覆盖率 |
| ---------------------- | ---------- | ---------- |
| TopicResearchService   | ~30%       | 70%        |
| ResearchMissionService | ~25%       | 70%        |
| ResearchLeaderService  | ~20%       | 60%        |
| ReportSynthesisService | ~15%       | 70%        |

**测试模板**：

```typescript
// __tests__/unit/topic-crud.service.spec.ts
describe("TopicCrudService", () => {
  let service: TopicCrudService;
  let prisma: MockPrismaService;
  let eventEmitter: MockEventEmitter;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TopicCrudService,
        { provide: PrismaService, useValue: createMockPrisma() },
        {
          provide: ResearchEventEmitterService,
          useValue: createMockEventEmitter(),
        },
      ],
    }).compile();

    service = module.get(TopicCrudService);
    prisma = module.get(PrismaService);
    eventEmitter = module.get(ResearchEventEmitterService);
  });

  describe("create", () => {
    it("should create topic with valid data", async () => {
      // Arrange
      const dto = { title: "Test Topic", description: "Test" };
      const userId = "user-123";
      prisma.topic.create.mockResolvedValue({ id: "topic-123", ...dto });

      // Act
      const result = await service.create(dto, userId);

      // Assert
      expect(result.id).toBe("topic-123");
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        "topic.created",
        expect.any(Object),
      );
    });

    it("should throw when title is empty", async () => {
      await expect(
        service.create({ title: "", description: "" }, "user-123"),
      ).rejects.toThrow(ValidationException);
    });
  });
});
```

**预估工时**：24 小时
**风险等级**：无风险（只增加测试）

---

## 第五阶段：性能优化（优先级：低）

### 5.1 数据库查询优化

**问题**：N+1 查询问题

**解决方案**：

```typescript
// 优化前
async getTopicsWithMissions(userId: string) {
  const topics = await this.prisma.topic.findMany({ where: { userId } });
  for (const topic of topics) {
    topic.mission = await this.prisma.mission.findFirst({ where: { topicId: topic.id } });
  }
  return topics;
}

// 优化后
async getTopicsWithMissions(userId: string) {
  return this.prisma.topic.findMany({
    where: { userId },
    include: {
      mission: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
}
```

**预估工时**：8 小时
**风险等级**：低

---

### 5.2 WebSocket 连接优化

**问题**：每次研究创建大量事件监听器

**解决方案**：

```typescript
// 使用房间机制减少监听器
@WebSocketGateway()
export class TopicResearchGateway {
  @SubscribeMessage("join-topic")
  async handleJoinTopic(client: Socket, topicId: string) {
    await client.join(`topic:${topicId}`);
  }

  @SubscribeMessage("leave-topic")
  async handleLeaveTopic(client: Socket, topicId: string) {
    await client.leave(`topic:${topicId}`);
  }

  // 向特定房间广播
  broadcastToTopic(topicId: string, event: string, data: unknown) {
    this.server.to(`topic:${topicId}`).emit(event, data);
  }
}
```

**预估工时**：6 小时
**风险等级**：低

---

## 实施时间表

```
Week 1-2:  第一阶段 - 安全加固 (6 小时)
           ├─ XSS 防护增强 (4h)
           └─ Prompt Injection 增强 (2h)

Week 3-6:  第二阶段 - 服务拆分 (52 小时)
           ├─ TopicResearchService 拆分 (16h)
           ├─ ResearchMissionService 拆分 (20h)
           └─ ResearchLeaderService 拆分 (16h)

Week 7-8:  第三阶段 - 架构优化 (20 小时)
           ├─ Redis 状态管理 (12h)
           └─ 循环依赖解决 (8h)

Week 9-10: 第四阶段 - 代码质量 (30 小时)
           ├─ 统一错误处理 (6h)
           └─ 单元测试增加 (24h)

Week 11-12: 第五阶段 - 性能优化 (14 小时)
           ├─ 数据库查询优化 (8h)
           └─ WebSocket 优化 (6h)
```

**总预估工时**：122 小时（约 15 个工作日）

---

## 风险控制措施

### 1. 功能回归测试

每个阶段完成后必须执行：

```bash
# 1. 类型检查
npm run type-check

# 2. 单元测试
npm run test:quick

# 3. 端到端测试（手动）
- 创建新 Topic
- 启动研究任务
- 查看研究进度
- 生成报告
- 导出 PDF
- AI 编辑功能
```

### 2. 灰度发布策略

```typescript
// 使用 Feature Flag 控制新代码路径
const USE_NEW_MISSION_SERVICE = process.env.FEATURE_NEW_MISSION_SERVICE === 'true';

async createMission(topicId: string, config: ResearchConfig) {
  if (USE_NEW_MISSION_SERVICE) {
    return this.newMissionService.create(topicId, config);
  }
  return this.legacyCreateMission(topicId, config);
}
```

### 3. 回滚计划

每个改动必须能在 5 分钟内回滚：

- Git revert commit
- 或 Feature Flag 关闭

---

## 验收标准

### 第一阶段验收

- [ ] XSS Payload 测试全部通过
- [ ] Prompt Injection 测试全部通过
- [ ] 安全扫描无高危漏洞

### 第二阶段验收

- [ ] 所有子服务独立可测试
- [ ] 原有 API 签名不变
- [ ] 单文件不超过 500 行

### 第三阶段验收

- [ ] Redis 模式下多实例状态同步
- [ ] 无循环依赖警告

### 第四阶段验收

- [ ] 测试覆盖率 > 70%
- [ ] 所有异常有明确错误码

### 第五阶段验收

- [ ] 无 N+1 查询
- [ ] WebSocket 连接数减少 50%

---

## 附录

### A. 现有服务依赖图

```
TopicResearchService
├── PrismaService
├── ResearchMissionService ←┐
├── ResearchLeaderService   │ 循环
├── ReportSynthesisService  │
└── TopicCollaboratorService│
                            │
ResearchMissionService ─────┘
├── PrismaService
├── ResearchLeaderService
├── DimensionMissionService
└── ResearchEventEmitterService
```

### B. 重构后目标依赖图

```
TopicResearchService (门面)
├── TopicCrudService
├── TopicQueryService
├── TopicExportService
└── EventEmitter (事件驱动，解耦)

ResearchMissionService (门面)
├── MissionLifecycleService
├── MissionStateService
├── MissionProgressService
└── StateStore (抽象)

ResearchLeaderService (门面)
├── LeaderPlanningService
├── LeaderCoordinationService
└── LeaderDecisionService
```

### C. 文件修改清单

| 阶段 | 新建文件 | 修改文件 | 删除文件 |
| ---- | -------- | -------- | -------- |
| 1    | 1        | 2        | 0        |
| 2    | 15       | 3        | 0        |
| 3    | 3        | 5        | 0        |
| 4    | 2        | 10       | 0        |
| 5    | 0        | 5        | 0        |

---

**文档版本**：1.0
**创建日期**：2025-01-26
**负责人**：Claude Code
**审核状态**：待审核
