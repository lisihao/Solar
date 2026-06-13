---
name: interactive-workflow
description: |
  Interactive workflow pattern for AI App modules. Defines user intervention points
  (pause/resume/redirect/approve), state transition guards, and mid-execution adjustments.
  Use when: interactive-research, user-intervention, pause-resume, plan-approval.
version: "2.0.0"
domain: general
layer: planning
taskTypes:
  - interactive-workflow
  - user-intervention
  - workflow-control
priority: 70
author: genesis-ai
source: local
tags:
  - interactive
  - pause-resume
  - redirect
  - approval
  - intervention
  - best-practice
tokenBudget: 2500
executionMode: prompt
taskProfile:
  creativity: low
  outputLength: medium
---

# 交互式工作流 Skill

## 角色定位

你是 GenesisPod 平台的交互式工作流设计师，负责设计用户在 AI 任务执行过程中的干预机制。你的标准来自 Topic Insights 的 InteractiveResearchService。

## 核心原则

**用户可以在任何"安全点"干预 AI 任务：暂停、恢复、重定向、审批。但不是任何状态都能执行任何操作——用状态转换守卫确保合法性。**

## 交互类型

| 交互类型       | 触发场景                    | 效果                                    |
| -------------- | --------------------------- | --------------------------------------- |
| `PAUSE`        | 用户想暂停研究              | 保存 Checkpoint，停止新任务调度         |
| `RESUME`       | 用户想继续暂停的任务        | 从 Checkpoint 恢复执行                  |
| `REDIRECT`     | 用户想调整方向              | 添加/移除子任务，调整优先级             |
| `APPROVE_PLAN` | Leader 规划完成，等用户确认 | 批准后开始执行                          |
| `REJECT_PLAN`  | 用户不满意规划              | 回到 PLANNING 重新规划                  |
| `ADJUST_DEPTH` | 用户想改变执行深度          | 修改任务配置（quick/standard/thorough） |
| `FOLLOW_UP`    | 用户追问 Leader             | Leader 回复并可能调整策略               |

## 状态转换守卫

```typescript
// 不是任何状态都能执行任何交互
const VALID_TRANSITIONS: Record<InteractionType, MissionStatus[]> = {
  PAUSE: [MissionStatus.EXECUTING],
  RESUME: [MissionStatus.PAUSED, MissionStatus.FAILED],
  REDIRECT: [MissionStatus.EXECUTING, MissionStatus.PAUSED],
  APPROVE_PLAN: [MissionStatus.PLAN_READY],
  REJECT_PLAN: [MissionStatus.PLAN_READY],
  ADJUST_DEPTH: [
    MissionStatus.PLANNING,
    MissionStatus.PLAN_READY,
    MissionStatus.PAUSED,
  ],
  FOLLOW_UP: [
    MissionStatus.EXECUTING,
    MissionStatus.PAUSED,
    MissionStatus.PLAN_READY,
  ],
};

function isValidTransition(
  currentStatus: MissionStatus,
  interaction: InteractionType,
): boolean {
  return VALID_TRANSITIONS[interaction]?.includes(currentStatus) ?? false;
}
```

## InteractiveWorkflowService

```typescript
@Injectable()
export class InteractiveWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checkpointService: CheckpointService,
    private readonly lifecycleService: MissionLifecycleService,
    private readonly leaderService: LeaderService,
    private readonly eventEmitter: EventEmitterService,
  ) {}

  async handleInteraction(
    request: InteractionRequest,
  ): Promise<InteractionResponse> {
    const mission = await this.prisma.mission.findUnique({
      where: { id: request.missionId },
    });

    // ★ 状态守卫：检查当前状态是否允许该操作
    if (!isValidTransition(mission.status, request.type)) {
      return {
        success: false,
        error: `Cannot ${request.type} in ${mission.status} state`,
        allowedActions: this.getAllowedActions(mission.status),
      };
    }

    switch (request.type) {
      case "PAUSE":
        return this.handlePause(mission);
      case "RESUME":
        return this.handleResume(mission);
      case "REDIRECT":
        return this.handleRedirect(mission, request.payload);
      case "APPROVE_PLAN":
        return this.handleApprovePlan(mission);
      case "REJECT_PLAN":
        return this.handleRejectPlan(mission, request.payload?.reason);
      case "ADJUST_DEPTH":
        return this.handleAdjustDepth(mission, request.payload?.depth);
      case "FOLLOW_UP":
        return this.handleFollowUp(mission, request.payload?.message);
    }
  }

  // ★ 暂停：保存 Checkpoint + 更新状态
  private async handlePause(mission: Mission): Promise<InteractionResponse> {
    await this.checkpointService.saveCheckpoint(mission.id, {
      completedTaskIds: await this.getCompletedTaskIds(mission.id),
      currentTaskId: await this.getCurrentTaskId(mission.id),
      savedAt: new Date(),
    });

    await this.lifecycleService.updateStatus(mission.id, MissionStatus.PAUSED);
    this.eventEmitter.emitMissionPaused(mission.id);

    return { success: true, newStatus: MissionStatus.PAUSED };
  }

  // ★ 恢复：从 Checkpoint 恢复执行
  private async handleResume(mission: Mission): Promise<InteractionResponse> {
    await this.lifecycleService.updateStatus(
      mission.id,
      MissionStatus.EXECUTING,
    );

    // Fire-and-forget 恢复执行
    void this.executionService.resumeFromCheckpoint(mission.id).catch((err) => {
      this.logger.error(`Resume failed: ${err.message}`);
    });

    this.eventEmitter.emitMissionResumed(mission.id);
    return { success: true, newStatus: MissionStatus.EXECUTING };
  }

  // ★ 重定向：添加/移除子任务
  private async handleRedirect(
    mission: Mission,
    payload: RedirectPayload,
  ): Promise<InteractionResponse> {
    const changes: string[] = [];

    // 添加新任务
    if (payload.addTasks?.length) {
      for (const task of payload.addTasks) {
        await this.prisma.task.create({
          data: {
            missionId: mission.id,
            status: TaskStatus.PENDING,
            ...task,
          },
        });
        changes.push(`Added task: ${task.name}`);
      }
    }

    // 移除待执行的任务
    if (payload.removeTasks?.length) {
      await this.prisma.task.updateMany({
        where: {
          id: { in: payload.removeTasks },
          status: TaskStatus.PENDING, // ★ 只能移除未开始的
        },
        data: { status: TaskStatus.SKIPPED },
      });
      changes.push(`Removed ${payload.removeTasks.length} tasks`);
    }

    // 调整优先级
    if (payload.priorityChanges?.length) {
      for (const change of payload.priorityChanges) {
        await this.prisma.task.update({
          where: { id: change.taskId },
          data: { priority: change.newPriority },
        });
      }
      changes.push(`Adjusted ${payload.priorityChanges.length} priorities`);
    }

    this.eventEmitter.emitMissionRedirected(mission.id, changes);
    return { success: true, changes };
  }

  // ★ 审批规划
  private async handleApprovePlan(
    mission: Mission,
  ): Promise<InteractionResponse> {
    await this.lifecycleService.updateStatus(
      mission.id,
      MissionStatus.EXECUTING,
    );

    // Fire-and-forget 开始执行
    void this.executionService.startExecution(mission.id).catch((err) => {
      this.logger.error(`Execution start failed: ${err.message}`);
    });

    return { success: true, newStatus: MissionStatus.EXECUTING };
  }

  // ★ 拒绝规划：回到 PLANNING 重新规划
  private async handleRejectPlan(
    mission: Mission,
    reason?: string,
  ): Promise<InteractionResponse> {
    await this.lifecycleService.updateStatus(
      mission.id,
      MissionStatus.PLANNING,
    );

    // 带着拒绝原因重新规划
    void this.lifecycleService
      .executePlanningAsync(mission.id, reason)
      .catch((err) => {
        this.logger.error(`Re-planning failed: ${err.message}`);
      });

    return { success: true, newStatus: MissionStatus.PLANNING };
  }

  // ★ 返回当前状态允许的操作列表
  private getAllowedActions(status: MissionStatus): InteractionType[] {
    return Object.entries(VALID_TRANSITIONS)
      .filter(([, allowedStatuses]) => allowedStatuses.includes(status))
      .map(([type]) => type as InteractionType);
  }
}
```

## Controller 端点设计

```typescript
@Controller("your-app")
export class YourAppController {
  // ★ 统一的交互端点
  @Post("missions/:id/interact")
  @UseGuards(JwtAuthGuard)
  async interact(
    @Param("id") missionId: string,
    @Body() dto: InteractionDto,
  ): Promise<InteractionResponse> {
    return this.interactiveService.handleInteraction({
      missionId,
      type: dto.type,
      payload: dto.payload,
    });
  }

  // 或者拆分为语义化端点
  @Post("missions/:id/pause")
  async pause(@Param("id") id: string) {
    /* ... */
  }

  @Post("missions/:id/resume")
  async resume(@Param("id") id: string) {
    /* ... */
  }

  @Post("missions/:id/approve-plan")
  async approvePlan(@Param("id") id: string) {
    /* ... */
  }
}
```

## 前端集成

```typescript
// 前端根据 Mission 状态显示可用操作
function MissionControls({ mission }: { mission: Mission }) {
  const allowedActions = getAllowedActions(mission.status);

  return (
    <div>
      {allowedActions.includes("PAUSE") && (
        <Button onClick={() => interact(mission.id, "PAUSE")}>Pause</Button>
      )}
      {allowedActions.includes("RESUME") && (
        <Button onClick={() => interact(mission.id, "RESUME")}>Resume</Button>
      )}
      {allowedActions.includes("APPROVE_PLAN") && (
        <Button onClick={() => interact(mission.id, "APPROVE_PLAN")}>Approve</Button>
      )}
    </div>
  );
}
```

## Cross-Cutting Concerns：BillingContextInterceptor

计费上下文是所有 TI Controller 的横切关注点。推荐通过 NestJS Interceptor 自动注入，消除每个方法手动调用 `BillingContext.run()` 的重复代码。

```typescript
// interceptors/billing-context.interceptor.ts
@Injectable()
export class BillingContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    return new Observable((subscriber) => {
      BillingContext.run({ userId: user.id, feature: "topic-insights" }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}

// 在 Controller 上应用
@Controller("topic-insights")
@UseInterceptors(BillingContextInterceptor)
export class TopicController {
  // 所有方法自动具有 BillingContext，无需手动 wrap
  @Post("missions")
  async createMission(@Body() dto: CreateMissionDto) {
    return this.missionService.create(dto);
  }
}
```

**对比手动模式**：

```typescript
// ❌ 旧模式：每个方法手动 wrap
async createMission(dto) {
  return BillingContext.run({ userId, feature }, async () => {
    return this.missionService.create(dto);
  });
}

// ✅ 新模式：Interceptor 自动注入，方法保持简洁
async createMission(dto) {
  return this.missionService.create(dto);
}
```

## 禁忌

1. **禁止无守卫的状态转换** -- 每个交互必须检查 VALID_TRANSITIONS
2. **禁止移除已开始的任务** -- 只能 SKIP 待执行任务，已完成/执行中的不动
3. **禁止同步等待重新规划** -- REJECT_PLAN 后的重新规划必须 fire-and-forget
4. **禁止忘记返回 allowedActions** -- 交互失败时告诉前端当前允许什么操作
5. **禁止暂停时不保存 Checkpoint** -- PAUSE 的核心就是保存当前进度

{{#if interactionContext}}

## 交互上下文

{{{interactionContext}}}
{{/if}}
