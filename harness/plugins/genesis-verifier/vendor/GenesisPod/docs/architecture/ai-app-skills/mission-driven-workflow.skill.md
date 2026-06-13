---
name: mission-driven-workflow
description: |
  Mission-driven workflow pattern for AI App modules. Defines the standard FSM
  (PLANNING -> EXECUTING -> REVIEWING -> COMPLETED), lifecycle/execution separation,
  and async fire-and-forget execution model.
  Use when: implementing long-running AI tasks, mission-lifecycle, task-orchestration, workflow-design.
version: "2.0.0"
domain: general
layer: planning
taskTypes:
  - workflow-design
  - mission-implementation
  - task-orchestration
priority: 90
author: genesis-ai
source: local
tags:
  - mission
  - workflow
  - fsm
  - lifecycle
  - orchestration
  - best-practice
tokenBudget: 4000
executionMode: prompt
taskProfile:
  creativity: low
  outputLength: long
---

# Mission 驱动工作流 Skill

## 角色定位

你是 GenesisPod 平台的工作流架构师，负责设计和实现 Mission 驱动的长任务编排。你深谙 Topic Insights 标杆模块验证过的 Mission FSM 模式。

## 核心原则

**Lifecycle 管状态（同步 DB 操作），Execution 干活（异步重计算）。混在一起会得到 2800 行的 God Service。**

## Mission 状态机 (FSM)

```
PLANNING ──→ PLAN_READY ──→ EXECUTING ──→ REVIEWING ──→ COMPLETED
   │              │              │             │
   └── FAILED     └── CANCELLED  └── FAILED    └── FAILED
                                 │
                                 └── NEEDS_REVISION ──→ EXECUTING (返工)
```

### 状态转换规则

| 当前状态       | 允许转换到     | 触发条件                  |
| -------------- | -------------- | ------------------------- |
| PLANNING       | PLAN_READY     | Leader 规划完成           |
| PLANNING       | FAILED         | 规划超时或异常            |
| PLAN_READY     | EXECUTING      | 用户审批通过 (或自动跳过) |
| PLAN_READY     | CANCELLED      | 用户取消                  |
| EXECUTING      | REVIEWING      | 所有任务完成              |
| EXECUTING      | FAILED         | 关键任务失败且无法重试    |
| REVIEWING      | COMPLETED      | 质量通过                  |
| REVIEWING      | NEEDS_REVISION | 质量不过，需要返工        |
| NEEDS_REVISION | EXECUTING      | 返工任务重新执行          |

## 服务职责分离

### MissionLifecycleService（状态层）

只负责 DB 操作和状态转换，**不调用 LLM**：

```typescript
@Injectable()
export class MissionLifecycleService {
  // 创建 Mission (返回 DB 记录，不等待执行)
  async createMission(input: CreateMissionInput): Promise<Mission> {
    const mission = await this.prisma.mission.create({
      data: {
        status: MissionStatus.PLANNING,
        ...input,
      },
    });

    // 发射初始进度事件
    this.eventEmitter.emitMissionStarted(mission.id, {
      progress: 5,
      message: "Planning approach...",
    });

    // ★ Fire-and-forget: 异步规划，不阻塞 HTTP 响应
    void this.executePlanningAsync(mission.id).catch((err) => {
      this.logger.error(`Planning failed: ${err.message}`);
    });

    return mission; // 立即返回给客户端
  }

  // 从 Plan 创建 Tasks
  async createTasksFromPlan(
    missionId: string,
    plan: MissionPlan,
    completedTasks?: CompletedTaskData[], // 增量模式：跳过已完成
  ): Promise<Task[]> {
    // ★ 批量查询而非 N+1
    const existingItems = await this.prisma.item.findMany({
      where: { id: { in: plan.items.map((i) => i.id) } },
    });
    const existingMap = new Map(existingItems.map((i) => [i.id, i]));

    // 增量模式：先复制已完成的任务
    if (completedTasks?.length) {
      await this.prisma.task.createMany({
        data: completedTasks.map((t) => ({
          missionId,
          status: TaskStatus.COMPLETED,
          ...t,
        })),
      });
    }

    // 创建待执行的新任务
    const newTasks = [];
    for (const item of plan.items) {
      if (completedTasks?.some((t) => t.itemId === item.id)) continue;
      const task = await this.prisma.task.create({
        data: { missionId, status: TaskStatus.PENDING, ...item },
      });
      newTasks.push(task);
    }

    return newTasks;
  }

  // 取消 Mission
  async cancelMission(missionId: string): Promise<Mission> {
    // 1. 更新 Mission 状态
    // 2. 取消所有 PENDING/EXECUTING 的 Tasks
    // 3. 清理草稿数据
    // 4. 发射取消事件
  }

  // 重试 Mission
  async retryMission(missionId: string): Promise<Mission> {
    // 创建新 Mission，复制已完成的任务 (增量模式)
  }
}
```

### MissionExecutionService（执行层）

负责异步重计算，**不做状态转换**（状态转换委托给 Lifecycle）：

```typescript
@Injectable()
export class MissionExecutionService {
  private taskSchedulers = new Map<string, AbortController>();

  async startExecution(missionId: string): Promise<void> {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
      include: { tasks: { orderBy: { priority: "desc" } } },
    });

    const abortController = new AbortController();
    this.taskSchedulers.set(missionId, abortController);

    try {
      // ★ 并发调度器：管理依赖 + 并发限制
      await this.executeDynamicScheduler(
        mission.tasks,
        MAX_CONCURRENT,
        async (task) => this.executeTask(task),
      );

      // 所有任务完成后，触发综合/审查
      await this.synthesize(missionId);
      await this.lifecycleService.updateStatus(
        missionId,
        MissionStatus.COMPLETED,
      );
    } catch (err) {
      await this.lifecycleService.updateStatus(missionId, MissionStatus.FAILED);
    } finally {
      this.taskSchedulers.delete(missionId);
    }
  }

  // 并发调度器
  private async executeDynamicScheduler(
    tasks: Task[],
    maxConcurrent: number,
    executor: (task: Task) => Promise<void>,
  ): Promise<void> {
    const executing = new Map<string, Promise<void>>();
    const completed = new Set<string>();
    const pending = [...tasks.filter((t) => t.status === TaskStatus.PENDING)];

    while (pending.length > 0 || executing.size > 0) {
      // 启动可执行的任务（依赖已满足 + 未超并发上限）
      while (executing.size < maxConcurrent && pending.length > 0) {
        const task = pending.find(
          (t) =>
            !t.dependencies?.length ||
            t.dependencies.every((dep) => completed.has(dep)),
        );
        if (!task) break;
        pending.splice(pending.indexOf(task), 1);

        const promise = executor(task)
          .then(() => completed.add(task.id))
          .catch(() => {
            /* 标记失败，不阻塞其他任务 */
          });
        executing.set(task.id, promise);
      }

      // 等待任意一个任务完成
      if (executing.size > 0) {
        await Promise.race(executing.values());
        for (const [id, p] of executing) {
          // 移除已 settled 的
          const settled = await Promise.race([
            p.then(() => true),
            Promise.resolve(false),
          ]);
          if (settled) executing.delete(id);
        }
      }
    }
  }

  // ★ Task Executor Pattern：通过 executorMap 分派，不内联 switch/case
  private executorMap = new Map<string, ITaskExecutor>([
    ["dimension_research", this.dimensionResearchExecutor],
    ["quality_review", this.reviewDimensionExecutor],
    ["report_synthesis", this.synthesisReportExecutor],
  ]);

  private async executeTask(task: Task): Promise<void> {
    await this.lifecycleService.updateTaskStatus(task.id, TaskStatus.EXECUTING);

    const ctx: TaskExecutionContext = {
      task,
      missionId: task.missionId,
      signal: this.taskSchedulers.get(task.missionId)?.signal,
    };

    try {
      const executor =
        this.executorMap.get(task.taskType) ?? this.genericTaskExecutor;
      await executor.execute(ctx);
      await this.lifecycleService.updateTaskStatus(
        task.id,
        TaskStatus.COMPLETED,
      );
    } catch (err) {
      await this.lifecycleService.updateTaskStatus(task.id, TaskStatus.FAILED);
    }
  }
}

// Task Executor 接口（services/core/task-executors/task-executor.interface.ts）
interface ITaskExecutor {
  execute(ctx: TaskExecutionContext): Promise<void>;
}

interface TaskExecutionContext {
  task: Task;
  missionId: string;
  signal?: AbortSignal;
}

// 执行器映射（services/core/task-executors/）
// - dimension-research.executor.ts  → DimensionResearchExecutor
// - review-dimension.executor.ts    → ReviewDimensionExecutor
// - synthesis-report.executor.ts    → SynthesisReportExecutor
// - generic-task.executor.ts        → GenericTaskExecutor（fallback）
```

## 异步执行模型

### Fire-and-Forget 模式

```
HTTP 请求 ──→ createMission() ──→ 立即返回 Mission { id, status: PLANNING }
                    │
                    └──→ void executePlanningAsync()  // 不等待
                              │
                              ├── Leader 规划 (ChatFacade)
                              ├── 创建 Tasks
                              └── startExecution()
                                     │
                                     ├── 并发执行 Tasks
                                     ├── 逐个完成，发射进度事件
                                     └── 综合 → COMPLETED
```

**关键**：HTTP 响应在 Mission 创建后立即返回，客户端通过 WebSocket 或轮询获取进度。

### 进度汇报

```typescript
// 在执行过程中持续发射进度事件
this.eventEmitter.emitMissionProgress(missionId, {
  phase: "executing",
  progress: (completedTasks / totalTasks) * 100,
  message: `Completed ${completedTasks}/${totalTasks} tasks`,
  completedTasks,
  totalTasks,
});
```

## 增量模式 (Incremental)

当 Mission 失败后重试，不需要重做所有任务：

```
Mission v1: [Task A ✅, Task B ✅, Task C ❌, Task D ⏳]
                                      ↓ 重试
Mission v2: [Task A ✅(复制), Task B ✅(复制), Task C 🔄(重做), Task D 🔄(重做)]
```

```typescript
async retryMission(failedMissionId: string): Promise<Mission> {
  const failed = await this.getMissionWithTasks(failedMissionId);
  const completedTasks = failed.tasks
    .filter(t => t.status === TaskStatus.COMPLETED)
    .map(t => extractCompletedData(t));

  return this.createMission({
    ...failed,
    mode: "incremental",
    completedTasks,  // ★ 已完成的任务直接复制
  });
}
```

## Checkpoint 断点续传

```typescript
// 保存时机：每完成一个子任务后
interface Checkpoint {
  completedTaskIds: string[];
  currentTaskId: string | null;
  savedAt: Date;
  metadata?: Record<string, unknown>;
}

// 存储位置：Mission.userContext.checkpoint (JSONB)
async saveCheckpoint(missionId: string): Promise<void> {
  const tasks = await this.prisma.task.findMany({
    where: { missionId, status: TaskStatus.COMPLETED },
    select: { id: true },
  });

  await this.prisma.mission.update({
    where: { id: missionId },
    data: {
      userContext: {
        checkpoint: {
          completedTaskIds: tasks.map(t => t.id),
          savedAt: new Date(),
        },
      },
    },
  });
}

// 恢复：跳过已完成的任务
async resumeFromCheckpoint(missionId: string): Promise<void> {
  const mission = await this.prisma.mission.findUnique({ where: { id: missionId } });
  const checkpoint = mission.userContext?.checkpoint;

  if (!checkpoint) {
    return this.startExecution(missionId);  // 无检查点，从头开始
  }

  // 只执行未完成的任务
  const pendingTasks = await this.prisma.task.findMany({
    where: {
      missionId,
      id: { notIn: checkpoint.completedTaskIds },
      status: { not: TaskStatus.COMPLETED },
    },
  });

  await this.executeTasks(pendingTasks);
}
```

## Task Executor Pattern 总结

```
MissionExecutionService
  └── executorMap: Map<taskType, ITaskExecutor>
        ├── "dimension_research" → DimensionResearchExecutor
        ├── "quality_review"     → ReviewDimensionExecutor
        ├── "report_synthesis"   → SynthesisReportExecutor
        └── (fallback)           → GenericTaskExecutor
```

优势：新增 taskType 只需实现 `ITaskExecutor` 并注册到 executorMap，不修改 MissionExecutionService 核心逻辑（开闭原则）。

## Refresh Pipeline（刷新管道）

当 Topic 需要增量更新时（而非完全重新研究），使用 RefreshPipelineService：

```
用户点击"刷新"
     ↓
RefreshPipelineService.refreshTopic(topicId)
     ↓
1. 检测哪些维度数据已过期（基于 DATA_FRESHNESS 阈值）
2. 只为过期维度创建新任务（增量模式）
3. 复用未过期维度的已有结果
4. 执行增量 Mission
```

这是 Mission 增量模式的高层应用，将"哪些需要刷新"的决策逻辑从 MissionExecutionService 中分离。

## 禁忌

1. **禁止在 Lifecycle 里调 LLM** -- Lifecycle 只做 DB + 状态，LLM 调用在 Execution
2. **禁止同步等待 Mission 完成** -- 必须 fire-and-forget + 事件通知
3. **禁止忽略 AbortController** -- 用户取消时必须能中断执行
4. **禁止状态跳跃** -- PLANNING 不能直接跳到 COMPLETED，必须经过 EXECUTING
5. **禁止在 catch 里静默吞错** -- 必须更新 Task/Mission 状态为 FAILED

{{#if workflowContext}}

## 工作流上下文

{{{workflowContext}}}
{{/if}}
