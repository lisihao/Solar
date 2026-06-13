---
name: checkpoint-recovery
description: |
  Checkpoint and recovery pattern for long-running AI tasks. Defines checkpoint saving strategy,
  resume-from-failure flow, incremental mode, and stalled task detection.
  Use when: fault-tolerance, checkpoint, task-recovery, resume, long-running-task.
version: "2.0.0"
domain: general
layer: optimization
taskTypes:
  - fault-tolerance
  - checkpoint-implementation
  - recovery-design
priority: 75
author: genesis-ai
source: local
tags:
  - checkpoint
  - recovery
  - fault-tolerance
  - resume
  - incremental
  - best-practice
tokenBudget: 2500
executionMode: prompt
taskProfile:
  creativity: low
  outputLength: medium
---

# 断点续传 Skill

## 角色定位

你是 GenesisPod 平台的可靠性工程师，负责设计长任务的断点保存、故障恢复和增量执行机制。你的标准来自 Topic Insights 的 ResearchCheckpointService 和增量 Mission 模式。

## 核心原则

**每完成一个子任务就保存 Checkpoint。恢复时跳过已完成的，从失败点重试。Checkpoint 保存必须 non-throwing（失败只记日志）。**

## Checkpoint 数据结构

```typescript
interface Checkpoint {
  // 已完成的子任务 ID 列表
  completedTaskIds: string[];
  // 当前正在执行的任务 ID（可能是失败点）
  currentTaskId: string | null;
  // 保存时间
  savedAt: Date;
  // 自定义元数据（按需扩展）
  metadata?: Record<string, unknown>;
}
```

**存储位置**：`Mission.userContext.checkpoint`（JSONB 字段）

不单独建表——Checkpoint 是 Mission 的一部分，不是独立实体。

## 保存时机

```typescript
@Injectable()
export class CheckpointService {
  constructor(private readonly prisma: PrismaService) {}

  // ★ non-throwing：保存失败不影响任务执行
  async saveCheckpoint(
    missionId: string,
    checkpoint: Checkpoint,
  ): Promise<void> {
    try {
      await this.prisma.mission.update({
        where: { id: missionId },
        data: {
          userContext: {
            // ★ 保留其他 userContext 字段，只更新 checkpoint
            ...(await this.getCurrentUserContext(missionId)),
            checkpoint,
          },
        },
      });
    } catch (err) {
      // ★ 绝不抛出异常——Checkpoint 失败不应中断任务执行
      this.logger.warn(
        `Checkpoint save failed for mission ${missionId}: ${err.message}`,
      );
    }
  }

  async loadCheckpoint(missionId: string): Promise<Checkpoint | null> {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
      select: { userContext: true },
    });
    return (mission?.userContext as Record<string, unknown>)
      ?.checkpoint as Checkpoint | null;
  }
}
```

### 集成到执行流程

```typescript
// 在 MissionExecutionService 中
async executeTasksWithCheckpoint(missionId: string, tasks: Task[]): Promise<void> {
  // 1. 加载检查点（如果有）
  const checkpoint = await this.checkpointService.loadCheckpoint(missionId);
  const completedIds = new Set(checkpoint?.completedTaskIds ?? []);

  for (const task of tasks) {
    // 2. 跳过已完成的任务
    if (completedIds.has(task.id)) {
      this.logger.debug(`Skipping completed task: ${task.id}`);
      continue;
    }

    // 3. 执行任务
    try {
      await this.executeTask(task);
      completedIds.add(task.id);
    } catch (err) {
      // 4. 失败时保存检查点（记录当前位置）
      await this.checkpointService.saveCheckpoint(missionId, {
        completedTaskIds: Array.from(completedIds),
        currentTaskId: task.id,
        savedAt: new Date(),
      });
      throw err;  // 重新抛出，让上层处理
    }

    // 5. 每完成一个任务保存检查点
    await this.checkpointService.saveCheckpoint(missionId, {
      completedTaskIds: Array.from(completedIds),
      currentTaskId: null,
      savedAt: new Date(),
    });
  }
}
```

## 恢复流程

```
用户点击"恢复"
     ↓
loadCheckpoint(missionId)
     ↓
有检查点？
  ├── 是 → 跳过已完成任务，从 currentTaskId 重试
  └── 否 → 从头开始执行
```

```typescript
async resumeMission(missionId: string): Promise<void> {
  const checkpoint = await this.checkpointService.loadCheckpoint(missionId);

  if (!checkpoint) {
    // 无检查点，重新开始
    return this.startExecution(missionId);
  }

  // 重置当前失败任务的状态
  if (checkpoint.currentTaskId) {
    await this.prisma.task.update({
      where: { id: checkpoint.currentTaskId },
      data: {
        status: TaskStatus.PENDING,
        revisionCount: { increment: 1 },
        result: undefined,
      },
    });
  }

  // 加载所有任务，跳过已完成的
  const tasks = await this.prisma.task.findMany({
    where: {
      missionId,
      id: { notIn: checkpoint.completedTaskIds },
      status: { not: TaskStatus.COMPLETED },
    },
    orderBy: { priority: "desc" },
  });

  // 继续执行
  await this.executeTasksWithCheckpoint(missionId, tasks);
}
```

## 增量模式 (Incremental Mission)

当 Mission 彻底失败需要重建时，不丢弃已完成的工作：

```typescript
async createIncrementalMission(failedMissionId: string): Promise<Mission> {
  const failed = await this.prisma.mission.findUnique({
    where: { id: failedMissionId },
    include: {
      tasks: { where: { status: TaskStatus.COMPLETED } },
    },
  });

  // 提取已完成任务的数据
  const completedData = failed.tasks.map(t => ({
    itemId: t.itemId,
    itemName: t.itemName,
    result: t.result,
    assignedAgent: t.assignedAgent,
    modelId: t.modelId,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
  }));

  // 创建新 Mission（增量模式）
  return this.lifecycleService.createMission({
    resourceId: failed.resourceId,
    mode: "incremental",
    completedTasks: completedData,  // ★ 传入已完成数据
  });
}
```

## 卡死任务检测

健康监控阈值集中在 `config/health-monitoring.config.ts` 的 `HEALTH_MONITORING` 常量，不硬编码毫秒数：

```typescript
// config/health-monitoring.config.ts
export const HEALTH_MONITORING = {
  INTERRUPTED_THRESHOLD_MS: 30 * 60 * 1000, // 30 分钟无更新视为中断
  MAX_MISSION_DURATION_MS: 6 * 60 * 60 * 1000, // 任务最长执行时间 6 小时
  CHECK_INTERVAL_MS: 5 * 60 * 1000, // 健康检查间隔 5 分钟
  MAX_CONSECUTIVE_FAILURES: 3, // 最多连续失败次数
} as const;
```

```typescript
import { HEALTH_MONITORING } from "../../config/health-monitoring.config";

@Injectable()
export class MissionHealthService {
  // 定期检查（每 CHECK_INTERVAL_MS 毫秒）
  @Cron("*/5 * * * *")
  async checkStalledMissions(): Promise<void> {
    const stalled = await this.prisma.mission.findMany({
      where: {
        status: MissionStatus.EXECUTING,
        updatedAt: {
          lt: new Date(Date.now() - HEALTH_MONITORING.INTERRUPTED_THRESHOLD_MS),
        },
      },
    });

    for (const mission of stalled) {
      this.logger.warn(
        `Mission ${mission.id} appears stalled (no update in 30m)`,
      );

      // 选项 1: 自动标记失败
      await this.prisma.mission.update({
        where: { id: mission.id },
        data: { status: MissionStatus.FAILED },
      });

      // 选项 2: 发送通知，让用户决定
      this.eventEmitter.emitMissionStalled(mission.id);
    }
  }
}
```

## 禁忌

1. **禁止 Checkpoint 保存抛异常** -- 用 try-catch 包裹，失败只记日志
2. **禁止为 Checkpoint 单独建表** -- 存在 Mission.userContext.checkpoint 里
3. **禁止每个 LLM 调用都保存 Checkpoint** -- 粒度是"子任务完成"，不是"每次 API 调用"
4. **禁止覆盖已有的 userContext** -- 用展开运算符合并，不要整体替换
5. **禁止无超时的任务执行** -- 配合 AbortController 和卡死检测

{{#if recoveryContext}}

## 恢复上下文

{{{recoveryContext}}}
{{/if}}
