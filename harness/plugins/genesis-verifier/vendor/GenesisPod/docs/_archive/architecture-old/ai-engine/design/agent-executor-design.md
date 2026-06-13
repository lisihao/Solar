# Agent 执行器详细设计

> 版本: 1.0
> 日期: 2025-01-06
> 状态: 规划中

---

## 一、概述

### 1.1 能力定义

**Agent 执行器 (Agent Executor)** 负责调度和执行分配给 Agent 的任务，包括：

- 任务执行调度
- 并发控制
- 重试和故障转移
- 执行状态追踪

### 1.2 当前实现位置

```
backend/src/modules/ai-app/teams/services/collaboration/mission/mission-execution.service.ts
```

### 1.3 下沉目标位置

```
backend/src/modules/ai-engine/orchestration/
├── agent-executor/
│   ├── index.ts
│   ├── agent-executor.service.ts      # 核心执行器
│   ├── execution-context.ts           # 执行上下文
│   └── strategies/
│       ├── sequential-strategy.ts     # 顺序执行策略
│       ├── parallel-strategy.ts       # 并行执行策略
│       └── priority-strategy.ts       # 优先级执行策略
└── scheduler/
    ├── task-scheduler.service.ts      # 任务调度器
    └── queue-manager.ts               # 队列管理
```

---

## 二、接口设计

### 2.1 核心接口

```typescript
// ============================================================
// 文件: ai-engine/core/interfaces/executor.interface.ts
// ============================================================

import { TaskDefinition } from "./decomposition.interface";

/**
 * Agent 定义（执行时需要的信息）
 */
export interface AgentDefinition {
  /** Agent ID */
  id: string;

  /** 显示名称 */
  displayName: string;

  /** 使用的模型 */
  model: string;

  /** 系统提示词 */
  systemPrompt?: string;

  /** 角色身份描述 */
  identity?: string;

  /** 是否为 Leader */
  isLeader: boolean;

  /** 温度参数 */
  temperature?: number;

  /** 最大 Token */
  maxTokens?: number;
}

/**
 * 执行上下文
 */
export interface ExecutionContext {
  /** Mission ID */
  missionId: string;

  /** Mission 标题 */
  missionTitle: string;

  /** 原始目标 */
  objectives: string[];

  /** 约束条件 */
  constraints: string[];

  /** 硬约束（提取后的） */
  hardConstraints?: HardConstraint[];

  /** 已完成任务的结果 */
  completedResults: Map<string, TaskResult>;

  /** 背景信息 */
  background?: string;

  /** 实体定义（长内容场景） */
  entities?: Record<string, unknown>;

  /** 全局上下文（跨任务共享） */
  globalContext?: string;
}

/**
 * 任务执行配置
 */
export interface ExecutionConfig {
  /** 最大并行数 */
  maxParallelism: number;

  /** 单任务超时（毫秒） */
  taskTimeout: number;

  /** 最大重试次数 */
  maxRetries: number;

  /** 重试延迟（毫秒） */
  retryDelay: number;

  /** 是否启用故障转移 */
  enableFailover: boolean;

  /** 执行策略 */
  strategy: "SEQUENTIAL" | "PARALLEL" | "PRIORITY";

  /** 是否启用 Web 搜索 */
  enableWebSearch?: boolean;

  /** Token 预算 */
  tokenBudget?: number;
}

/**
 * 任务结果
 */
export interface TaskResult {
  /** 任务 ID */
  taskId: string;

  /** 执行状态 */
  status: "SUCCESS" | "FAILED" | "TIMEOUT" | "CANCELLED";

  /** 输出内容 */
  output?: string;

  /** 错误信息 */
  error?: string;

  /** 消耗的 Token */
  tokensUsed: number;

  /** 执行时长（毫秒） */
  duration: number;

  /** 执行的 Agent ID */
  executedBy: string;

  /** 是否使用了 Web 搜索 */
  usedWebSearch?: boolean;

  /** 搜索结果（如果有） */
  searchResults?: SearchResult[];

  /** 重试次数 */
  retryCount: number;
}

/**
 * 执行事件
 */
export type ExecutionEvent =
  | { type: "TASK_STARTED"; taskId: string; agentId: string }
  | {
      type: "TASK_PROGRESS";
      taskId: string;
      progress: number;
      message?: string;
    }
  | { type: "TASK_COMPLETED"; taskId: string; result: TaskResult }
  | { type: "TASK_FAILED"; taskId: string; error: string; willRetry: boolean }
  | {
      type: "TASK_RETRYING";
      taskId: string;
      attempt: number;
      maxAttempts: number;
    }
  | { type: "BATCH_STARTED"; taskIds: string[] }
  | { type: "BATCH_COMPLETED"; results: TaskResult[] }
  | { type: "ALL_COMPLETED"; summary: ExecutionSummary };

/**
 * 执行摘要
 */
export interface ExecutionSummary {
  totalTasks: number;
  successCount: number;
  failedCount: number;
  totalTokensUsed: number;
  totalDuration: number;
  results: TaskResult[];
}

/**
 * Agent 执行器接口
 */
export interface IAgentExecutor {
  /**
   * 执行单个任务
   */
  executeTask(
    task: TaskDefinition,
    agent: AgentDefinition,
    context: ExecutionContext,
    config?: Partial<ExecutionConfig>,
  ): Promise<TaskResult>;

  /**
   * 执行多个任务（根据配置的策略）
   */
  executeTasks(
    tasks: TaskDefinition[],
    agents: Map<string, AgentDefinition>,
    context: ExecutionContext,
    config?: Partial<ExecutionConfig>,
  ): AsyncGenerator<ExecutionEvent>;

  /**
   * 执行下一批可执行的任务
   */
  executeNextBatch(
    pendingTasks: TaskDefinition[],
    completedTaskIds: Set<string>,
    agents: Map<string, AgentDefinition>,
    context: ExecutionContext,
    config?: Partial<ExecutionConfig>,
  ): AsyncGenerator<ExecutionEvent>;

  /**
   * 取消执行
   */
  cancel(missionId: string): Promise<void>;
}

/**
 * 搜索结果
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}
```

### 2.2 任务调度器接口

```typescript
// ============================================================
// 文件: ai-engine/orchestration/scheduler/scheduler.interface.ts
// ============================================================

/**
 * 调度任务项
 */
export interface ScheduledTask {
  task: TaskDefinition;
  priority: number;
  scheduledAt: Date;
  deadline?: Date;
}

/**
 * 任务调度器接口
 */
export interface ITaskScheduler {
  /**
   * 获取下一批可执行的任务
   */
  getNextBatch(
    tasks: TaskDefinition[],
    completedTaskIds: Set<string>,
    maxBatchSize: number,
  ): TaskDefinition[];

  /**
   * 按优先级排序任务
   */
  sortByPriority(tasks: TaskDefinition[]): TaskDefinition[];

  /**
   * 检查任务是否可执行（依赖已满足）
   */
  canExecute(task: TaskDefinition, completedTaskIds: Set<string>): boolean;

  /**
   * 计算任务优先级分数
   */
  calculatePriorityScore(
    task: TaskDefinition,
    context: ExecutionContext,
  ): number;
}
```

---

## 三、服务实现

### 3.1 AgentExecutorService

```typescript
// ============================================================
// 文件: ai-engine/orchestration/agent-executor/agent-executor.service.ts
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { AIOrchestrationService } from "../../../common/ai-orchestration/ai-orchestration.service";
import { TaskSchedulerService } from "../scheduler/task-scheduler.service";
import { WebSearchService } from "../../tools/implementations/web-search.service";
import {
  IAgentExecutor,
  TaskDefinition,
  AgentDefinition,
  ExecutionContext,
  ExecutionConfig,
  TaskResult,
  ExecutionEvent,
  ExecutionSummary,
} from "../../core/interfaces/executor.interface";

const DEFAULT_CONFIG: ExecutionConfig = {
  maxParallelism: 3,
  taskTimeout: 120000, // 2 分钟
  maxRetries: 2,
  retryDelay: 3000,
  enableFailover: true,
  strategy: "PARALLEL",
  enableWebSearch: true,
};

@Injectable()
export class AgentExecutorService implements IAgentExecutor {
  private readonly logger = new Logger(AgentExecutorService.name);
  private readonly cancelledMissions = new Set<string>();

  constructor(
    private readonly aiService: AIOrchestrationService,
    private readonly scheduler: TaskSchedulerService,
    private readonly webSearch: WebSearchService,
  ) {}

  /**
   * 执行单个任务
   */
  async executeTask(
    task: TaskDefinition,
    agent: AgentDefinition,
    context: ExecutionContext,
    config: Partial<ExecutionConfig> = {},
  ): Promise<TaskResult> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();

    this.logger.log(
      `开始执行任务: ${task.title} (Agent: ${agent.displayName})`,
    );

    let lastError: Error | null = null;
    let retryCount = 0;

    while (retryCount <= finalConfig.maxRetries) {
      try {
        // 检查是否已取消
        if (this.cancelledMissions.has(context.missionId)) {
          return this.createCancelledResult(task, agent, startTime, retryCount);
        }

        // 构建执行提示词
        const prompt = this.buildExecutionPrompt(task, context);

        // 可选：执行 Web 搜索
        let searchResults: SearchResult[] | undefined;
        if (finalConfig.enableWebSearch && this.needsWebSearch(task)) {
          searchResults = await this.performWebSearch(task, context);
        }

        // 调用 Agent 执行
        const response = await this.callAgent(
          agent,
          prompt,
          searchResults,
          finalConfig,
        );

        const duration = Date.now() - startTime;

        return {
          taskId: task.tempId,
          status: "SUCCESS",
          output: response.content,
          tokensUsed: response.usage?.total_tokens || 0,
          duration,
          executedBy: agent.id,
          usedWebSearch: !!searchResults,
          searchResults,
          retryCount,
        };
      } catch (error) {
        lastError = error as Error;
        retryCount++;

        if (retryCount <= finalConfig.maxRetries) {
          this.logger.warn(
            `任务 ${task.title} 执行失败，将重试 (${retryCount}/${finalConfig.maxRetries}): ${lastError.message}`,
          );
          await this.delay(finalConfig.retryDelay);
        }
      }
    }

    // 所有重试都失败
    return {
      taskId: task.tempId,
      status: "FAILED",
      error: lastError?.message || "Unknown error",
      tokensUsed: 0,
      duration: Date.now() - startTime,
      executedBy: agent.id,
      retryCount,
    };
  }

  /**
   * 执行多个任务
   */
  async *executeTasks(
    tasks: TaskDefinition[],
    agents: Map<string, AgentDefinition>,
    context: ExecutionContext,
    config: Partial<ExecutionConfig> = {},
  ): AsyncGenerator<ExecutionEvent> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const completedTaskIds = new Set<string>();
    const allResults: TaskResult[] = [];

    // 根据策略执行
    if (finalConfig.strategy === "SEQUENTIAL") {
      yield* this.executeSequentially(
        tasks,
        agents,
        context,
        finalConfig,
        completedTaskIds,
        allResults,
      );
    } else {
      yield* this.executeInBatches(
        tasks,
        agents,
        context,
        finalConfig,
        completedTaskIds,
        allResults,
      );
    }

    // 返回完成摘要
    yield {
      type: "ALL_COMPLETED",
      summary: this.createSummary(allResults),
    };
  }

  /**
   * 执行下一批可执行的任务
   */
  async *executeNextBatch(
    pendingTasks: TaskDefinition[],
    completedTaskIds: Set<string>,
    agents: Map<string, AgentDefinition>,
    context: ExecutionContext,
    config: Partial<ExecutionConfig> = {},
  ): AsyncGenerator<ExecutionEvent> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };

    // 获取可执行的任务
    const executableTasks = this.scheduler.getNextBatch(
      pendingTasks,
      completedTaskIds,
      finalConfig.maxParallelism,
    );

    if (executableTasks.length === 0) {
      return;
    }

    yield {
      type: "BATCH_STARTED",
      taskIds: executableTasks.map((t) => t.tempId),
    };

    // 并行执行
    const results = await this.executeParallel(
      executableTasks,
      agents,
      context,
      finalConfig,
    );

    yield { type: "BATCH_COMPLETED", results };
  }

  /**
   * 取消执行
   */
  async cancel(missionId: string): Promise<void> {
    this.cancelledMissions.add(missionId);
    this.logger.log(`已取消 Mission: ${missionId}`);

    // 清理（延迟移除，防止竞态条件）
    setTimeout(() => {
      this.cancelledMissions.delete(missionId);
    }, 60000);
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private async *executeSequentially(
    tasks: TaskDefinition[],
    agents: Map<string, AgentDefinition>,
    context: ExecutionContext,
    config: ExecutionConfig,
    completedTaskIds: Set<string>,
    allResults: TaskResult[],
  ): AsyncGenerator<ExecutionEvent> {
    const sortedTasks = this.scheduler.sortByPriority(tasks);

    for (const task of sortedTasks) {
      // 等待依赖完成
      while (!this.scheduler.canExecute(task, completedTaskIds)) {
        await this.delay(100);
      }

      const agent = agents.get(task.assignedToId);
      if (!agent) {
        this.logger.error(`找不到 Agent: ${task.assignedToId}`);
        continue;
      }

      yield { type: "TASK_STARTED", taskId: task.tempId, agentId: agent.id };

      const result = await this.executeTask(task, agent, context, config);

      if (result.status === "SUCCESS") {
        completedTaskIds.add(task.tempId);
        context.completedResults.set(task.tempId, result);
      }

      allResults.push(result);
      yield { type: "TASK_COMPLETED", taskId: task.tempId, result };
    }
  }

  private async *executeInBatches(
    tasks: TaskDefinition[],
    agents: Map<string, AgentDefinition>,
    context: ExecutionContext,
    config: ExecutionConfig,
    completedTaskIds: Set<string>,
    allResults: TaskResult[],
  ): AsyncGenerator<ExecutionEvent> {
    const pendingTasks = [...tasks];

    while (pendingTasks.length > 0) {
      const batch = this.scheduler.getNextBatch(
        pendingTasks,
        completedTaskIds,
        config.maxParallelism,
      );

      if (batch.length === 0) {
        // 没有可执行的任务，可能存在未满足的依赖
        this.logger.warn("没有可执行的任务，检查依赖关系");
        break;
      }

      yield { type: "BATCH_STARTED", taskIds: batch.map((t) => t.tempId) };

      const results = await this.executeParallel(
        batch,
        agents,
        context,
        config,
      );

      for (const result of results) {
        if (result.status === "SUCCESS") {
          completedTaskIds.add(result.taskId);
          context.completedResults.set(result.taskId, result);
        }
        allResults.push(result);

        // 从待执行列表移除
        const index = pendingTasks.findIndex((t) => t.tempId === result.taskId);
        if (index !== -1) {
          pendingTasks.splice(index, 1);
        }
      }

      yield { type: "BATCH_COMPLETED", results };
    }
  }

  private async executeParallel(
    tasks: TaskDefinition[],
    agents: Map<string, AgentDefinition>,
    context: ExecutionContext,
    config: ExecutionConfig,
  ): Promise<TaskResult[]> {
    const promises = tasks.map(async (task) => {
      const agent = agents.get(task.assignedToId);
      if (!agent) {
        return {
          taskId: task.tempId,
          status: "FAILED" as const,
          error: `Agent not found: ${task.assignedToId}`,
          tokensUsed: 0,
          duration: 0,
          executedBy: task.assignedToId,
          retryCount: 0,
        };
      }

      return this.executeTask(task, agent, context, config);
    });

    return Promise.all(promises);
  }

  private buildExecutionPrompt(
    task: TaskDefinition,
    context: ExecutionContext,
  ): string {
    const parts: string[] = [];

    // Mission 背景
    parts.push(`## 任务背景`);
    parts.push(`你正在参与一个团队任务: ${context.missionTitle}`);
    parts.push(`目标: ${context.objectives.join("; ")}`);

    if (context.constraints.length > 0) {
      parts.push(`约束: ${context.constraints.join("; ")}`);
    }

    // 硬约束（重要）
    if (context.hardConstraints && context.hardConstraints.length > 0) {
      parts.push(`\n## 硬性要求（必须遵守）`);
      for (const constraint of context.hardConstraints) {
        parts.push(`- [${constraint.type}] ${constraint.content}`);
      }
    }

    // 当前任务
    parts.push(`\n## 你的任务`);
    parts.push(`标题: ${task.title}`);
    parts.push(`描述: ${task.description}`);

    // 依赖任务的结果
    if (task.dependsOn.length > 0) {
      parts.push(`\n## 前置任务结果（供参考）`);
      for (const depId of task.dependsOn) {
        const depResult = context.completedResults.get(depId);
        if (depResult && depResult.output) {
          parts.push(`\n### ${depId}`);
          // 截取前 2000 字符，避免上下文过长
          const truncated =
            depResult.output.length > 2000
              ? depResult.output.substring(0, 2000) + "...(已截断)"
              : depResult.output;
          parts.push(truncated);
        }
      }
    }

    // 输出要求
    parts.push(`\n## 输出要求`);
    parts.push(`请直接输出任务结果，不需要额外的解释或前缀。`);

    return parts.join("\n");
  }

  private async callAgent(
    agent: AgentDefinition,
    prompt: string,
    searchResults?: SearchResult[],
    config?: ExecutionConfig,
  ): Promise<{ content: string; usage?: { total_tokens: number } }> {
    // 构建系统提示词
    let systemPrompt = agent.systemPrompt || "";
    if (agent.identity) {
      systemPrompt = `${agent.identity}\n\n${systemPrompt}`;
    }

    // 如果有搜索结果，添加到提示词
    let userPrompt = prompt;
    if (searchResults && searchResults.length > 0) {
      userPrompt += `\n\n## 相关搜索结果\n`;
      for (const result of searchResults) {
        userPrompt += `\n### ${result.title}\n来源: ${result.url}\n${result.snippet}\n`;
      }
    }

    const response = await this.aiService.chat({
      model: agent.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: agent.temperature || 0.7,
      max_tokens: agent.maxTokens || 4096,
    });

    return {
      content: response.content,
      usage: response.usage,
    };
  }

  private needsWebSearch(task: TaskDefinition): boolean {
    // 某些任务类型需要搜索
    const searchableTypes = ["RESEARCH", "ANALYSIS"];
    return searchableTypes.includes(task.taskType);
  }

  private async performWebSearch(
    task: TaskDefinition,
    context: ExecutionContext,
  ): Promise<SearchResult[]> {
    try {
      // 构建搜索查询
      const query = `${task.title} ${context.missionTitle}`;
      const results = await this.webSearch.search(query, { maxResults: 5 });
      return results;
    } catch (error) {
      this.logger.warn(`Web 搜索失败: ${error.message}`);
      return [];
    }
  }

  private createCancelledResult(
    task: TaskDefinition,
    agent: AgentDefinition,
    startTime: number,
    retryCount: number,
  ): TaskResult {
    return {
      taskId: task.tempId,
      status: "CANCELLED",
      error: "Mission was cancelled",
      tokensUsed: 0,
      duration: Date.now() - startTime,
      executedBy: agent.id,
      retryCount,
    };
  }

  private createSummary(results: TaskResult[]): ExecutionSummary {
    return {
      totalTasks: results.length,
      successCount: results.filter((r) => r.status === "SUCCESS").length,
      failedCount: results.filter((r) => r.status === "FAILED").length,
      totalTokensUsed: results.reduce((sum, r) => sum + r.tokensUsed, 0),
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
      results,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

### 3.2 TaskSchedulerService

```typescript
// ============================================================
// 文件: ai-engine/orchestration/scheduler/task-scheduler.service.ts
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import {
  ITaskScheduler,
  TaskDefinition,
  ExecutionContext,
} from "../../core/interfaces/executor.interface";

@Injectable()
export class TaskSchedulerService implements ITaskScheduler {
  private readonly logger = new Logger(TaskSchedulerService.name);

  /**
   * 获取下一批可执行的任务
   */
  getNextBatch(
    tasks: TaskDefinition[],
    completedTaskIds: Set<string>,
    maxBatchSize: number,
  ): TaskDefinition[] {
    // 筛选可执行的任务
    const executable = tasks.filter((task) =>
      this.canExecute(task, completedTaskIds),
    );

    // 按优先级排序
    const sorted = this.sortByPriority(executable);

    // 返回指定数量
    return sorted.slice(0, maxBatchSize);
  }

  /**
   * 按优先级排序任务
   */
  sortByPriority(tasks: TaskDefinition[]): TaskDefinition[] {
    const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

    return [...tasks].sort((a, b) => {
      // 首先按优先级
      const priorityDiff =
        priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // 其次按依赖数量（依赖少的先执行）
      return a.dependsOn.length - b.dependsOn.length;
    });
  }

  /**
   * 检查任务是否可执行
   */
  canExecute(task: TaskDefinition, completedTaskIds: Set<string>): boolean {
    // 所有依赖都已完成
    return task.dependsOn.every((dep) => completedTaskIds.has(dep));
  }

  /**
   * 计算任务优先级分数
   */
  calculatePriorityScore(
    task: TaskDefinition,
    context: ExecutionContext,
  ): number {
    let score = 0;

    // 基础优先级分数
    const priorityScores = { CRITICAL: 100, HIGH: 75, MEDIUM: 50, LOW: 25 };
    score += priorityScores[task.priority] || 50;

    // 依赖数量越少，分数越高（更容易执行）
    score += Math.max(0, 20 - task.dependsOn.length * 5);

    // 任务类型权重
    const typeWeights: Record<string, number> = {
      RESEARCH: 10, // 研究类优先（产生其他任务的输入）
      ANALYSIS: 8,
      DESIGN: 6,
      IMPLEMENTATION: 5,
      DOCUMENTATION: 3,
      REVIEW: 2, // 审核类最后
      SYNTHESIS: 1,
    };
    score += typeWeights[task.taskType] || 5;

    return score;
  }
}
```

---

## 四、使用示例

### 4.1 基本使用

```typescript
// 在 AI Teams 中使用
import { AgentExecutorService } from "@/modules/ai-engine/orchestration/agent-executor";

@Injectable()
export class MissionExecutionService {
  constructor(private readonly agentExecutor: AgentExecutorService) {}

  async executeMission(mission: TeamMission): Promise<void> {
    const context: ExecutionContext = {
      missionId: mission.id,
      missionTitle: mission.title,
      objectives: mission.objectives,
      constraints: mission.constraints,
      hardConstraints: mission.mustConstraints,
      completedResults: new Map(),
    };

    const agents = await this.buildAgentMap(mission.topicId);

    for await (const event of this.agentExecutor.executeTasks(
      mission.tasks,
      agents,
      context,
      { strategy: "PARALLEL", maxParallelism: 3 },
    )) {
      // 处理事件
      await this.handleEvent(event, mission);
    }
  }

  private async handleEvent(event: ExecutionEvent, mission: TeamMission) {
    switch (event.type) {
      case "TASK_COMPLETED":
        // 更新任务状态
        await this.updateTaskStatus(event.taskId, event.result);
        // 发送 WebSocket 事件
        this.gateway.emitTaskCompleted(mission.id, event.result);
        break;

      case "ALL_COMPLETED":
        // Mission 完成
        await this.completeMission(mission, event.summary);
        break;
    }
  }
}
```

### 4.2 增量执行

```typescript
// 执行下一批任务（用于分步执行）
async executeNextBatch(missionId: string): Promise<ExecutionEvent[]> {
  const mission = await this.getMission(missionId);
  const pendingTasks = mission.tasks.filter(t => t.status === 'PENDING');
  const completedIds = new Set(
    mission.tasks.filter(t => t.status === 'COMPLETED').map(t => t.id)
  );

  const events: ExecutionEvent[] = [];

  for await (const event of this.agentExecutor.executeNextBatch(
    pendingTasks,
    completedIds,
    await this.buildAgentMap(mission.topicId),
    this.buildContext(mission),
    { maxParallelism: 2 },
  )) {
    events.push(event);
  }

  return events;
}
```

---

## 五、故障转移机制

### 5.1 Agent 替换

当分配的 Agent 执行失败时，可以自动切换到备选 Agent：

```typescript
private async findAlternativeAgent(
  task: TaskDefinition,
  failedAgentId: string,
  agents: Map<string, AgentDefinition>,
): Promise<AgentDefinition | null> {
  // 获取相同专业领域的其他 Agent
  const failedAgent = agents.get(failedAgentId);
  if (!failedAgent) return null;

  for (const [id, agent] of agents) {
    if (id === failedAgentId) continue;
    if (agent.isLeader) continue; // 不使用 Leader 替代

    // 检查能力匹配
    // ... 匹配逻辑
  }

  return null;
}
```

### 5.2 熔断机制

```typescript
// 使用现有的 AgentCircuitBreakerService
private circuitBreaker: Map<string, CircuitState> = new Map();

private shouldSkipAgent(agentId: string): boolean {
  const state = this.circuitBreaker.get(agentId);
  if (!state) return false;

  if (state.status === 'OPEN') {
    // 检查是否可以尝试恢复
    if (Date.now() - state.lastFailure > 60000) {
      state.status = 'HALF_OPEN';
      return false;
    }
    return true;
  }

  return false;
}
```

---

## 六、迁移计划

### 6.1 迁移步骤

1. **Phase 1: 创建新服务**
   - 实现 `AgentExecutorService`
   - 实现 `TaskSchedulerService`
   - 单元测试

2. **Phase 2: 适配层**
   - 在 AI Teams 中创建适配器
   - 保持原有接口不变

3. **Phase 3: 切换**
   - 逐步将调用切换到新服务
   - 监控和对比

4. **Phase 4: 清理**
   - 移除旧代码
   - 更新文档

### 6.2 兼容性

- 保持与现有 `AgentTask` 模型的兼容
- 保持 WebSocket 事件格式不变
- 保持错误处理行为一致

---

## 七、性能考量

### 7.1 并发控制

- 默认最大并行度: 3
- 可根据 Token 预算动态调整
- 避免对同一模型的过度并发

### 7.2 超时处理

- 单任务默认超时: 2 分钟
- 支持任务级别的超时配置
- 超时后自动重试或标记失败

### 7.3 内存管理

- 及时清理已完成任务的大型结果
- 使用流式处理避免内存峰值
