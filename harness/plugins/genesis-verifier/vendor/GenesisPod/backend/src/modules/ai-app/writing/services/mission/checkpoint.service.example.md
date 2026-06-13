# CheckpointService 使用示例

## 概述

CheckpointService 提供了 AI Writing Mission 的断点续传功能，允许在任务执行过程中保存进度，并在中断后恢复。

## 核心功能

### 1. 保存检查点

在写作任务的关键步骤保存进度：

```typescript
import { CheckpointService } from "./services/mission";

@Injectable()
export class WritingMissionService {
  constructor(private readonly checkpointService: CheckpointService) {}

  async executeChapterWriting(missionId: string, chapters: Chapter[]) {
    // 初始化检查点
    await this.checkpointService.saveCheckpoint(missionId, {
      projectId: this.projectId,
      completedSteps: [],
      completedChapters: [],
      currentStep: "initializing",
      context: {
        totalCount: chapters.length,
        startTime: new Date().toISOString(),
      },
    });

    // 执行章节写作
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];

      // 更新当前步骤
      await this.checkpointService.saveCheckpoint(missionId, {
        currentStep: `writing_chapter_${i + 1}`,
        currentChapterId: chapter.id,
      });

      // 执行写作
      await this.writeChapter(chapter);

      // 标记完成
      await this.checkpointService.saveCheckpoint(missionId, {
        completedChapters: [
          ...(await this.getCompletedChapters(missionId)),
          chapter.id,
        ],
        completedSteps: [
          ...(await this.getCompletedSteps(missionId)),
          `chapter_${chapter.id}`,
        ],
      });
    }

    // 清理检查点
    await this.checkpointService.deleteCheckpoint(missionId);
  }

  private async getCompletedChapters(missionId: string): Promise<string[]> {
    const checkpoint = await this.checkpointService.loadCheckpoint(missionId);
    return checkpoint?.completedChapters ?? [];
  }

  private async getCompletedSteps(missionId: string): Promise<string[]> {
    const checkpoint = await this.checkpointService.loadCheckpoint(missionId);
    return checkpoint?.completedSteps ?? [];
  }
}
```

### 2. 加载检查点并恢复

检查是否可以恢复任务，并从中断点继续：

```typescript
@Injectable()
export class WritingMissionService {
  async resumeMission(missionId: string) {
    // 检查是否可以恢复
    const canResume = await this.checkpointService.canResume(missionId);

    if (!canResume) {
      throw new Error("Mission cannot be resumed - no valid checkpoint found");
    }

    // 加载检查点
    const checkpoint = await this.checkpointService.loadCheckpoint(missionId);

    if (!checkpoint) {
      throw new Error("Failed to load checkpoint");
    }

    // 获取可恢复信息
    const resumeInfo = await this.checkpointService.getResumableInfo(missionId);
    this.logger.log(
      `Resuming mission ${missionId}: ${resumeInfo.completedCount}/${resumeInfo.totalCount} completed (${resumeInfo.progress}%)`,
    );

    // 过滤出未完成的章节
    const allChapters = await this.getChapters(checkpoint.projectId);
    const remainingChapters = allChapters.filter(
      (ch) => !checkpoint.completedChapters.includes(ch.id),
    );

    // 继续执行剩余章节
    for (const chapter of remainingChapters) {
      await this.checkpointService.saveCheckpoint(missionId, {
        currentStep: `writing_chapter_${chapter.id}`,
        currentChapterId: chapter.id,
      });

      await this.writeChapter(chapter);

      await this.checkpointService.saveCheckpoint(missionId, {
        completedChapters: [...checkpoint.completedChapters, chapter.id],
        completedSteps: [...checkpoint.completedSteps, `chapter_${chapter.id}`],
      });
    }

    // 任务完成，删除检查点
    await this.checkpointService.deleteCheckpoint(missionId);
  }
}
```

### 3. 显示恢复信息

在 UI 中显示任务进度和恢复选项：

```typescript
@Controller("ai-writing/missions")
export class WritingMissionController {
  constructor(private readonly checkpointService: CheckpointService) {}

  @Get(":id/resume-info")
  async getResumeInfo(@Param("id") missionId: string) {
    const info = await this.checkpointService.getResumableInfo(missionId);

    return {
      success: true,
      data: {
        canResume: info.canResume,
        progress: {
          completed: info.completedCount,
          total: info.totalCount,
          percentage: info.progress,
        },
        lastSaved: info.lastSavedAt,
        currentStep: info.currentStep,
        currentChapter: info.currentChapterId,
      },
    };
  }

  @Post(":id/resume")
  async resumeMission(@Param("id") missionId: string) {
    const canResume = await this.checkpointService.canResume(missionId);

    if (!canResume) {
      throw new BadRequestException("Mission cannot be resumed");
    }

    // 触发恢复
    await this.missionService.resumeMission(missionId);

    return {
      success: true,
      message: "Mission resumed successfully",
    };
  }
}
```

### 4. 批量保存检查点

并行任务时批量保存检查点：

```typescript
@Injectable()
export class ParallelWritingService {
  constructor(private readonly checkpointService: CheckpointService) {}

  async executeParallelWriting(missions: Mission[]) {
    // 批量保存初始检查点
    await this.checkpointService.batchSaveCheckpoints(
      missions.map((m) => ({
        missionId: m.id,
        data: {
          projectId: m.projectId,
          completedSteps: [],
          completedChapters: [],
          currentStep: "pending",
          context: { parallelGroup: m.parallelGroupId },
        },
      })),
    );

    // 执行并行任务
    await Promise.all(missions.map((m) => this.executeWriting(m)));
  }
}
```

### 5. 清理过期检查点

定期清理过期的检查点数据：

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CheckpointService } from "./checkpoint.service";

@Injectable()
export class CheckpointCleanupService {
  private readonly logger = new Logger(CheckpointCleanupService.name);

  constructor(private readonly checkpointService: CheckpointService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredCheckpoints() {
    this.logger.log("Starting checkpoint cleanup...");

    try {
      // 清理 30 天前的检查点
      const count = await this.checkpointService.cleanupExpiredCheckpoints(30);

      this.logger.log(`Cleaned up ${count} expired checkpoints`);
    } catch (error) {
      this.logger.error("Failed to cleanup checkpoints:", error);
    }
  }
}
```

## 数据结构

### MissionCheckpoint

```typescript
interface MissionCheckpoint {
  missionId: string; // Mission ID
  projectId: string; // Project ID
  completedSteps: string[]; // 已完成的步骤列表
  completedChapters: string[]; // 已完成的章节 ID 列表
  currentStep: string; // 当前步骤描述
  currentChapterId?: string; // 当前正在处理的章节 ID
  context: Record<string, unknown>; // 上下文快照（自定义数据）
  savedAt: Date; // 保存时间
}
```

### ResumableInfo

```typescript
interface ResumableInfo {
  canResume: boolean; // 是否可以恢复
  missionId: string;
  projectId: string;
  completedCount: number; // 已完成数量
  totalCount: number; // 总数量
  progress: number; // 进度百分比 (0-100)
  lastSavedAt: Date | null; // 最后保存时间
  currentStep: string | null; // 当前步骤
  currentChapterId: string | null; // 当前章节 ID
}
```

## 最佳实践

### 1. 检查点粒度

- **太频繁**：每个小操作都保存 → 性能问题
- **太稀疏**：只在大步骤保存 → 恢复时丢失过多进度
- **推荐**：在有意义的检查点保存（如每完成一个章节）

### 2. 上下文信息

在 `context` 字段中保存恢复所需的关键信息：

```typescript
await checkpointService.saveCheckpoint(missionId, {
  context: {
    totalCount: chapters.length,
    startTime: new Date().toISOString(),
    writerInstance: 1,
    parallelGroupId: "group-123",
    customConfig: { temperature: 0.7 },
  },
});
```

### 3. 错误处理

检查点保存失败不应中断主流程：

```typescript
try {
  await this.checkpointService.saveCheckpoint(missionId, data);
} catch (error) {
  this.logger.error(`Failed to save checkpoint: ${error.message}`);
  // 继续执行，不抛出错误
}
```

### 4. 清理策略

- 任务完成后立即删除检查点
- 定期清理过期检查点（已完成/失败的任务）
- 保留最近的检查点便于问题排查

## 注意事项

1. **存储位置**：检查点存储在 `WritingMission.result` JSON 字段中，与任务结果共存
2. **并发安全**：多个进程同时更新检查点可能导致数据冲突，需要适当的锁机制
3. **数据大小**：避免在 `context` 中存储大量数据，保持轻量级
4. **向后兼容**：检查点结构变更时要考虑旧数据的兼容性

## 故障恢复流程

```
1. 用户启动任务
2. 定期保存检查点
3. 任务中断（网络/服务重启/错误）
4. 用户请求恢复
5. 加载检查点
6. 验证检查点有效性
7. 从中断点继续执行
8. 完成后清理检查点
```

## 监控和调试

```typescript
// 获取检查点详情用于调试
const checkpoint = await checkpointService.loadCheckpoint(missionId);
console.log("Checkpoint details:", {
  completed: checkpoint?.completedSteps.length,
  current: checkpoint?.currentStep,
  context: checkpoint?.context,
  savedAt: checkpoint?.savedAt,
});

// 获取可读的恢复信息
const info = await checkpointService.getResumableInfo(missionId);
console.log(
  `Progress: ${info.progress}% (${info.completedCount}/${info.totalCount})`,
);
```
