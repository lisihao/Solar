# GenesisPod 改进方案设计

> **基于**: project-assessment-2026-01.md
> **制定日期**: 2026-01-15
> **预计周期**: 3 个月

---

## 一、改进目标

### 1.1 量化目标

| 指标                | 当前值  | 目标值  | 周期   |
| ------------------- | ------- | ------- | ------ |
| 测试覆盖率          | ~20%    | 70%     | 2 个月 |
| 最大文件行数        | 6004 行 | ≤500 行 | 1 个月 |
| 前端 Store 最大行数 | 1200 行 | ≤400 行 | 2 周   |
| Schema 文件数       | 1 个    | 5-8 个  | 1 个月 |
| P0 技术债务         | 4 项    | 0 项    | 1 周   |

### 1.2 质量目标

- 消除所有内存泄漏风险
- 关键组件 100% 测试覆盖
- 代码文件单一职责
- 循环依赖清零
- 文档与代码保持同步

---

## 二、Phase 1: 紧急修复 (Week 1)

### 2.1 内存泄漏修复

**问题**: `executingTasks`/`revisingTasks` Set 无 TTL，长期运行后内存增长

**修复方案**:

```typescript
// 文件: backend/src/modules/ai-app/teams/services/collaboration/team-mission.service.ts

// Before: 无 TTL 的 Set
private readonly executingTasks = new Set<string>();
private readonly executingMissions = new Set<string>();
private readonly revisingTasks = new Set<string>();

// After: 带 TTL 的 Map
interface TaskLock {
  timestamp: number;
  ttlMs: number;
}

private readonly executingTasks = new Map<string, TaskLock>();
private readonly executingMissions = new Map<string, TaskLock>();
private readonly revisingTasks = new Map<string, TaskLock>();

// 默认 TTL: 30 分钟
private readonly DEFAULT_LOCK_TTL = 30 * 60 * 1000;

// 添加定期清理 (每 5 分钟)
@Cron('0 */5 * * * *')
private cleanupStaleLocks(): void {
  const now = Date.now();

  for (const [taskId, lock] of this.executingTasks) {
    if (now - lock.timestamp > lock.ttlMs) {
      this.executingTasks.delete(taskId);
      this.logger.warn(`[cleanupStaleLocks] Removed stale task lock: ${taskId}`);
    }
  }

  // 同样清理 executingMissions 和 revisingTasks
}

// 修改 isExecuting 方法
private isExecuting(taskId: string): boolean {
  const lock = this.executingTasks.get(taskId);
  if (!lock) return false;

  // 检查是否过期
  if (Date.now() - lock.timestamp > lock.ttlMs) {
    this.executingTasks.delete(taskId);
    return false;
  }

  return true;
}

// 修改 markAsExecuting 方法
private markAsExecuting(taskId: string, ttlMs = this.DEFAULT_LOCK_TTL): void {
  this.executingTasks.set(taskId, {
    timestamp: Date.now(),
    ttlMs,
  });
}
```

**涉及文件**:

- `backend/src/modules/ai-app/teams/services/collaboration/team-mission.service.ts`

**验证方式**:

```bash
# 1. 启动后端服务
npm run dev:backend

# 2. 创建多个任务后检查内存
# 3. 等待 30+ 分钟后确认内存释放
```

---

### 2.2 CircuitBreaker TTL 修复

**问题**: `AgentCircuitBreakerService` 状态永不过期

**修复方案**:

```typescript
// 文件: backend/src/modules/ai-app/teams/services/collaboration/agent-circuit-breaker.service.ts

interface AgentCircuitBreaker {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  lastFailure: number;
  lastAccess: number;  // 新增: 最后访问时间
}

// 过期时间: 24 小时未访问则清除
private readonly BREAKER_TTL = 24 * 60 * 60 * 1000;

@Cron('0 0 * * * *')  // 每小时执行
private cleanupStaleBreakers(): void {
  const now = Date.now();

  for (const [agentId, breaker] of this.breakers) {
    if (now - breaker.lastAccess > this.BREAKER_TTL) {
      this.breakers.delete(agentId);
      this.responseTimes.delete(agentId);
      this.currentLoad.delete(agentId);
      this.logger.log(`[cleanupStaleBreakers] Removed stale breaker: ${agentId}`);
    }
  }
}

// 每次访问时更新 lastAccess
getBreaker(agentId: string): AgentCircuitBreaker {
  const breaker = this.breakers.get(agentId);
  if (breaker) {
    breaker.lastAccess = Date.now();
  }
  return breaker;
}
```

**涉及文件**:

- `backend/src/modules/ai-app/teams/services/collaboration/agent-circuit-breaker.service.ts`

---

### 2.3 服务重启状态恢复

**问题**: 服务重启后，IN_PROGRESS 状态的任务永远卡住

**修复方案**:

```typescript
// 文件: backend/src/modules/ai-app/teams/services/collaboration/team-mission.service.ts

@Injectable()
export class TeamMissionService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await this.recoverStuckTasks();
  }

  /**
   * 恢复卡住的任务
   * - 将 IN_PROGRESS 超过 30 分钟的任务标记为 PENDING
   * - 触发重新执行
   */
  private async recoverStuckTasks(): Promise<void> {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    // 1. 查找卡住的任务
    const stuckTasks = await this.prisma.agentTask.findMany({
      where: {
        status: AgentTaskStatus.IN_PROGRESS,
        updatedAt: { lt: thirtyMinutesAgo },
      },
      include: { mission: true },
    });

    this.logger.log(
      `[recoverStuckTasks] Found ${stuckTasks.length} stuck tasks`,
    );

    // 2. 重置状态
    for (const task of stuckTasks) {
      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: AgentTaskStatus.PENDING,
          retryCount: { increment: 1 },
        },
      });

      this.logger.warn(`[recoverStuckTasks] Reset task ${task.id} to PENDING`);
    }

    // 3. 查找卡住的 Mission
    const stuckMissions = await this.prisma.teamMission.findMany({
      where: {
        status: TeamMissionStatus.IN_PROGRESS,
        updatedAt: { lt: thirtyMinutesAgo },
      },
    });

    for (const mission of stuckMissions) {
      // 触发重新执行
      this.aiTeamsGateway.server.emit("mission:recovered", {
        missionId: mission.id,
        topicId: mission.topicId,
      });
    }
  }
}
```

**涉及文件**:

- `backend/src/modules/ai-app/teams/services/collaboration/team-mission.service.ts`
- `backend/src/modules/ai-app/teams/ai-teams.gateway.ts`

---

## 三、Phase 2: 测试覆盖 (Week 2)

### 3.1 前端关键组件测试

**目标文件**:

1. `frontend/components/ai-research/ResearchTimeline.tsx`
2. `frontend/components/ai-research/TopicContentPanel.tsx`
3. `frontend/components/ai-research/AgentThinkingTimeline.tsx`

**测试策略**:

```typescript
// frontend/components/ai-research/__tests__/ResearchTimeline.test.tsx

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ResearchTimeline } from '../ResearchTimeline';

// Mock 数据
const mockHistories = [
  {
    id: 'h1',
    topicId: 'topic-1',
    missionId: 'm1',
    researchNumber: 1,
    startedAt: '2026-01-15T10:00:00Z',
    completedAt: '2026-01-15T11:00:00Z',
    status: 'COMPLETED',
    dimensionsUpdated: ['技术分析', '市场研究'],
    dimensionsKept: [],
    wordsAdded: 1500,
    wordsRemoved: 200,
    newSourcesCount: 5,
  },
];

describe('ResearchTimeline', () => {
  // P0: 空数据处理
  describe('Empty State', () => {
    it('should render empty state when histories is empty array', () => {
      render(<ResearchTimeline histories={[]} />);
      expect(screen.getByText(/暂无研究历史/)).toBeInTheDocument();
    });

    it('should handle undefined histories gracefully', () => {
      render(<ResearchTimeline histories={undefined as any} />);
      // 不应崩溃
      expect(screen.queryByText('Error')).not.toBeInTheDocument();
    });

    it('should handle null histories gracefully', () => {
      render(<ResearchTimeline histories={null as any} />);
      expect(screen.queryByText('Error')).not.toBeInTheDocument();
    });
  });

  // P0: 边界情况
  describe('Edge Cases', () => {
    it('should handle dimensionsUpdated as non-array', () => {
      const malformedHistory = {
        ...mockHistories[0],
        dimensionsUpdated: null as any,
      };
      render(<ResearchTimeline histories={[malformedHistory]} />);
      // 不应崩溃
      expect(screen.getByText(/第 1 次研究/)).toBeInTheDocument();
    });

    it('should handle activities with missing metadata', () => {
      const historyWithBadActivity = {
        ...mockHistories[0],
        activities: [
          {
            id: 'a1',
            metadata: undefined, // 缺失 metadata
          },
        ],
      };
      render(<ResearchTimeline histories={[historyWithBadActivity]} />);
      expect(screen.getByText(/第 1 次研究/)).toBeInTheDocument();
    });
  });

  // P1: 数据渲染
  describe('Data Rendering', () => {
    it('should render all history items', () => {
      render(<ResearchTimeline histories={mockHistories} />);
      expect(screen.getByText(/第 1 次研究/)).toBeInTheDocument();
    });

    it('should display dimension names', () => {
      render(<ResearchTimeline histories={mockHistories} />);
      expect(screen.getByText('技术分析')).toBeInTheDocument();
      expect(screen.getByText('市场研究')).toBeInTheDocument();
    });

    it('should show word count changes', () => {
      render(<ResearchTimeline histories={mockHistories} />);
      expect(screen.getByText(/\+1500/)).toBeInTheDocument();
    });
  });

  // P1: 筛选功能
  describe('Filtering', () => {
    it('should filter by dimension', async () => {
      render(<ResearchTimeline histories={mockHistories} />);
      // 选择维度筛选
      // ... 断言筛选结果
    });
  });
});
```

**测试矩阵**:

| 组件                  | 测试用例数 | 覆盖场景                       |
| --------------------- | ---------- | ------------------------------ |
| ResearchTimeline      | 15         | 空数据、边界、渲染、交互       |
| TopicContentPanel     | 20         | undefined 处理、Tab 切换、导出 |
| AgentThinkingTimeline | 12         | 活动展示、状态更新             |

---

### 3.2 后端核心服务测试

**目标文件**:

1. `backend/src/modules/ai-engine/llm/services/task-profile.types-mapper.service.ts`
2. `backend/src/modules/ai-app/teams/services/collaboration/team-mission.service.ts` (部分)

**测试模板**:

```typescript
// backend/src/modules/ai-engine/llm/services/__tests__/task-profile.types-mapper.service.spec.ts

import { Test, TestingModule } from "@nestjs/testing";
import { TaskProfileMapperService } from "../task-profile.types-mapper.service";

describe("TaskProfileMapperService", () => {
  let service: TaskProfileMapperService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TaskProfileMapperService],
    }).compile();

    service = module.get<TaskProfileMapperService>(TaskProfileMapperService);
  });

  describe("mapToParameters", () => {
    // P0: 基础映射
    describe("Basic Mapping", () => {
      it("should return defaults when profile is undefined", () => {
        const result = service.mapToParameters(undefined, null);
        expect(result.temperature).toBe(0.7);
        expect(result.maxTokens).toBe(4096);
      });

      it("should map creativity to temperature", () => {
        const testCases = [
          { input: "deterministic", expected: 0.1 },
          { input: "low", expected: 0.3 },
          { input: "medium", expected: 0.7 },
          { input: "high", expected: 0.9 },
        ];

        testCases.forEach(({ input, expected }) => {
          const result = service.mapToParameters(
            { creativity: input as any },
            null,
          );
          expect(result.temperature).toBe(expected);
        });
      });

      it("should map outputLength to maxTokens", () => {
        const testCases = [
          { input: "minimal", expected: 500 },
          { input: "short", expected: 1500 },
          { input: "medium", expected: 4000 },
          { input: "standard", expected: 6000 },
          { input: "long", expected: 8000 },
          { input: "extended", expected: 16000 },
        ];

        testCases.forEach(({ input, expected }) => {
          const result = service.mapToParameters(
            { outputLength: input as any },
            null,
          );
          expect(result.maxTokens).toBe(expected);
        });
      });
    });

    // P0: 推理模型特殊逻辑
    describe("Reasoning Model Logic", () => {
      it("should boost tokens to 25000 minimum for reasoning models", () => {
        const result = service.mapToParameters(
          { outputLength: "short" },
          { isReasoning: true },
        );
        expect(result.maxTokens).toBeGreaterThanOrEqual(25000);
      });

      it("should boost to 32000+ for extended reasoning output", () => {
        const result = service.mapToParameters(
          { outputLength: "extended" },
          { isReasoning: true },
        );
        expect(result.maxTokens).toBeGreaterThanOrEqual(32000);
      });

      it("should warn but not cap when model config is too low", () => {
        const logSpy = jest.spyOn(service["logger"], "warn");

        const result = service.mapToParameters(
          { outputLength: "extended" },
          { isReasoning: true, maxTokens: 20000 },
        );

        expect(result.maxTokens).toBe(32000);
        expect(logSpy).toHaveBeenCalled();
      });

      it("should cap tokens for non-reasoning models", () => {
        const result = service.mapToParameters(
          { outputLength: "extended" },
          { isReasoning: false, maxTokens: 8000 },
        );
        expect(result.maxTokens).toBe(8000);
      });
    });

    // P1: JSON 输出格式
    describe("JSON Output Format", () => {
      it("should limit temperature to 0.3 for JSON output", () => {
        const result = service.mapToParameters(
          { creativity: "high", outputFormat: "json" },
          null,
        );
        expect(result.temperature).toBeLessThanOrEqual(0.3);
      });
    });
  });
});
```

---

## 四、Phase 3: 代码拆分 (Week 3-4)

### 4.1 team-mission.service.ts 拆分方案

**当前**: 6004 行，职责混杂

**目标**: 拆分为 5-7 个服务，每个 ≤500 行

**拆分设计**:

```
services/collaboration/
├── mission/
│   ├── mission-lifecycle.service.ts     # 任务生命周期
│   │   └── createMission, cancelMission, completeMission, getStatus
│   │
│   ├── mission-execution.service.ts     # 任务执行引擎
│   │   └── executeTask, executeAllTasks, callAIWithRetry
│   │
│   ├── mission-review.service.ts        # Leader 审核
│   │   └── reviewTask, parseReviewResult, handleRejection
│   │
│   ├── mission-revision.service.ts      # 任务修订
│   │   └── executeRevision, buildRevisionPrompt
│   │
│   └── mission-notification.service.ts  # 通知服务
│       └── sendMessageToTopic, sendEmail, emitWebSocketEvent
│
├── agent/
│   ├── agent-selector.service.ts        # Agent 选择
│   │   └── selectBestAgent, matchAgentToTask
│   │
│   └── agent-switch.service.ts          # Agent 切换
│       └── switchToNextAgent, handleAgentFailure
│
└── utils/
    ├── prompt-builder.utils.ts          # Prompt 构建
    └── result-parser.utils.ts           # 结果解析
```

**依赖关系**:

```
MissionLifecycleService
    ↓ 使用
MissionExecutionService
    ↓ 使用
AgentSelectorService + AgentSwitchService
    ↓ 使用
MissionReviewService
    ↓ 使用
MissionRevisionService + MissionNotificationService
```

**重构步骤**:

1. **创建新服务文件** (不修改原文件)
2. **提取公共接口和类型**
3. **逐个迁移方法到对应服务**
4. **更新依赖注入**
5. **添加单元测试**
6. **删除原文件中已迁移的代码**
7. **集成测试验证**

---

### 4.2 前端 Store 拆分方案

**当前**: aiTeamsStore.ts 1200+ 行

**目标**: 拆分为 3-4 个 Store，使用 Zustand slice 模式

**拆分设计**:

```typescript
// stores/ai-teams/index.ts
export * from "./topic.store";
export * from "./message.store";
export * from "./mission.store";
export * from "./websocket.store";

// stores/ai-teams/topic.store.ts (~300 行)
interface TopicSlice {
  topics: Topic[];
  currentTopic: Topic | null;
  isLoadingTopics: boolean;

  // Actions
  fetchTopics: () => Promise<void>;
  createTopic: (data: CreateTopicDto) => Promise<Topic>;
  updateTopic: (id: string, data: UpdateTopicDto) => Promise<void>;
  deleteTopic: (id: string) => Promise<void>;
  setCurrentTopic: (topic: Topic | null) => void;
}

// stores/ai-teams/message.store.ts (~250 行)
interface MessageSlice {
  messages: TopicMessage[];
  isLoadingMessages: boolean;

  // Actions
  fetchMessages: (topicId: string) => Promise<void>;
  sendMessage: (topicId: string, content: string) => Promise<void>;
  clearMessages: () => void;
}

// stores/ai-teams/mission.store.ts (~400 行)
interface MissionSlice {
  missions: TeamMission[];
  currentMission: TeamMission | null;
  isExecuting: boolean;

  // Actions
  startMission: (topicId: string, config: MissionConfig) => Promise<void>;
  cancelMission: (missionId: string) => Promise<void>;
  retryMission: (missionId: string) => Promise<void>;
  getMissionStatus: (missionId: string) => Promise<MissionStatus>;
}

// stores/ai-teams/websocket.store.ts (~200 行)
interface WebSocketSlice {
  socket: Socket | null;
  isConnected: boolean;
  wsEvents: WsEvent[];

  // Actions
  connect: (topicId: string) => void;
  disconnect: () => void;
  clearEvents: () => void;
}

// 组合 Store
// stores/ai-teams/combined.store.ts
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { createTopicSlice } from "./topic.store";
import { createMessageSlice } from "./message.store";
import { createMissionSlice } from "./mission.store";
import { createWebSocketSlice } from "./websocket.store";

export const useAiTeamsStore = create<
  TopicSlice & MessageSlice & MissionSlice & WebSocketSlice
>()(
  devtools(
    (...args) => ({
      ...createTopicSlice(...args),
      ...createMessageSlice(...args),
      ...createMissionSlice(...args),
      ...createWebSocketSlice(...args),
    }),
    { name: "ai-teams-store" },
  ),
);
```

---

## 五、Phase 4: Schema 拆分 (Month 2)

### 5.1 Prisma 多文件 Schema

**前提**: Prisma 5.15+ 支持多文件 schema

**目录结构**:

```
backend/prisma/
├── schema.prisma           # 基础配置
├── models/
│   ├── user.prisma         # 用户相关 (~200 行)
│   ├── content.prisma      # 内容管理 (~500 行)
│   ├── ai-teams.prisma     # AI Teams (~800 行)
│   ├── ai-apps.prisma      # AI Apps (~600 行)
│   ├── ingestion.prisma    # 数据采集 (~300 行)
│   └── integrations.prisma # 第三方集成 (~400 行)
└── enums/
    └── enums.prisma        # 所有枚举 (~200 行)
```

**基础配置 schema.prisma**:

```prisma
// backend/prisma/schema.prisma

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["prismaSchemaFolder"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**模型文件示例 models/user.prisma**:

```prisma
// backend/prisma/models/user.prisma

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  image     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // 关联 (引用其他文件中的模型)
  collections Collection[]
  notes       Note[]

  @@index([email])
}

model UserInterest {
  id        String   @id @default(cuid())
  userId    String
  interest  String
  weight    Float    @default(1.0)
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

**迁移步骤**:

1. 升级 Prisma 到 5.15+
2. 创建目录结构
3. 按模块拆分模型到对应文件
4. 运行 `npx prisma format` 验证语法
5. 运行 `npx prisma generate` 重新生成客户端
6. 运行测试确保功能正常

---

## 六、Phase 5: 架构优化 (Month 3)

### 6.1 循环依赖解决方案

**问题定位**:

- `ai-teams/agents/index.ts`: TeamCollaborationService 导出顺序
- `ai-teams/gateway.ts`: 延迟注册避免循环
- `ai-teams/services/events`: TopicEventEmitter 解耦

**解决方案**: 引入事件总线

```typescript
// backend/src/common/events/event-bus.service.ts

import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";

@Injectable()
export class EventBusService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  emit(event: string, payload: any): void {
    this.eventEmitter.emit(event, payload);
  }

  on(event: string, handler: (...args: any[]) => void): void {
    this.eventEmitter.on(event, handler);
  }
}

// 事件定义
export const EVENTS = {
  MISSION_STARTED: "mission.started",
  MISSION_COMPLETED: "mission.completed",
  TASK_EXECUTED: "task.executed",
  AGENT_SWITCHED: "agent.switched",
};
```

**使用示例**:

```typescript
// 发送事件 (不直接依赖 Gateway)
@Injectable()
export class TeamMissionService {
  constructor(private eventBus: EventBusService) {}

  async completeMission(missionId: string): Promise<void> {
    // ... 业务逻辑

    // 通过事件总线通知
    this.eventBus.emit(EVENTS.MISSION_COMPLETED, {
      missionId,
      topicId: mission.topicId,
    });
  }
}

// 监听事件 (Gateway)
@WebSocketGateway()
export class AiTeamsGateway implements OnModuleInit {
  constructor(private eventBus: EventBusService) {}

  onModuleInit() {
    this.eventBus.on(EVENTS.MISSION_COMPLETED, (payload) => {
      this.server.emit("mission:completed", payload);
    });
  }
}
```

---

### 6.2 AI Engine 子模块化

**当前**: `ai-engine.module.ts` 530 行，导出 100+ 服务

**目标**: 拆分为独立子模块

```typescript
// backend/src/modules/ai-engine/ai-engine.module.ts

@Module({
  imports: [
    LLMModule, // LLM 相关
    ToolsModule, // 工具系统
    AgentsModule, // Agent 框架
    OrchestrationModule, // 编排引擎
    TeamsModule, // 团队系统
    MemoryModule, // 记忆系统
    SearchModule, // 搜索服务
    RAGModule, // RAG 系统
    ImageModule, // 图像生成
    MCPModule, // MCP 协议
  ],
  providers: [AIEngineFacade],
  exports: [
    AIEngineFacade,
    // 子模块自动导出其服务
    LLMModule,
    ToolsModule,
    AgentsModule,
    // ...
  ],
})
export class AIEngineModule {}
```

**子模块示例**:

```typescript
// backend/src/modules/ai-engine/llm/llm.module.ts

@Module({
  providers: [
    AiChatService,
    TaskProfileMapperService,
    ModelFallbackService,
    UniversalLLMAdapter,
    FunctionCallingLLMAdapter,
  ],
  exports: [AiChatService, TaskProfileMapperService, ModelFallbackService],
})
export class LLMModule {}
```

---

## 七、验证与回滚计划

### 7.1 每阶段验证清单

| 阶段    | 验证项          | 命令                     |
| ------- | --------------- | ------------------------ |
| Phase 1 | 类型检查通过    | `npm run type-check`     |
| Phase 1 | 单元测试通过    | `npm run test:quick`     |
| Phase 2 | 覆盖率达标      | `npm run test:coverage`  |
| Phase 3 | 集成测试通过    | `npm run test`           |
| Phase 4 | Schema 迁移成功 | `npx prisma migrate dev` |
| Phase 5 | 全量测试通过    | `npm run verify:full`    |

### 7.2 回滚策略

| 问题类型        | 回滚方式                             |
| --------------- | ------------------------------------ |
| 代码改动        | `git revert`                         |
| Schema 迁移失败 | `npx prisma migrate reset`           |
| 依赖问题        | `rm -rf node_modules && npm install` |
| 数据损坏        | 恢复数据库备份                       |

### 7.3 监控指标

```yaml
# 改进后需监控的指标
metrics:
  - name: executing_tasks_count
    type: gauge
    alert: "> 50 持续 5 分钟"

  - name: circuit_breaker_open_total
    type: counter
    alert: "rate > 0.1"

  - name: memory_heap_used_mb
    type: gauge
    alert: "> 1024 MB"

  - name: test_coverage_percent
    type: gauge
    alert: "< 70%"
```

---

## 八、时间线汇总

```
Week 1:  Phase 1 - 紧急修复 (内存泄漏、状态恢复)
Week 2:  Phase 2 - 测试覆盖 (关键组件测试)
Week 3:  Phase 3a - 代码拆分 (team-mission.service.ts)
Week 4:  Phase 3b - 代码拆分 (前端 Store)
Month 2: Phase 4 - Schema 拆分
Month 3: Phase 5 - 架构优化 (循环依赖、子模块化)
```

---

**方案制定**: 2026-01-15
**预计完成**: 2026-04-15
**责任人**: 开发团队
**审批人**: 技术负责人

