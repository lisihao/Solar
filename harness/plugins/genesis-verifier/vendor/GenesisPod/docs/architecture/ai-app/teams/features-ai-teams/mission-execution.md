# AI Teams 任务执行系统

## Mission Execution System Design

**版本**: v1.0
**创建日期**: 2025-12-17

---

## 一、概述

Mission Execution 是 AI Teams 的核心协作机制，采用 Leader-Member 架构实现复杂任务的自动分解、分配、执行和审核。

---

## 二、状态机

### 2.1 Mission 状态流转

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
                    ▼                                              │
┌─────────┐    ┌──────────┐    ┌─────────────┐    ┌───────────┐   │
│ PENDING │───▶│ PLANNING │───▶│ IN_PROGRESS │───▶│ COMPLETED │   │
└─────────┘    └──────────┘    └─────────────┘    └───────────┘   │
     │              │                │                             │
     │              │                │                             │
     ▼              ▼                ▼                             │
┌──────────┐   ┌─────────┐    ┌──────────┐                        │
│CANCELLED │   │ FAILED  │    │  PAUSED  │────────────────────────┘
└──────────┘   └─────────┘    └──────────┘
                                   │
                                   │ resume
                                   ▼
                            ┌─────────────┐
                            │ IN_PROGRESS │
                            └─────────────┘
```

### 2.2 Task 状态流转

```
┌─────────┐    ┌─────────────┐    ┌──────────────────┐
│ PENDING │───▶│ IN_PROGRESS │───▶│ AWAITING_REVIEW  │
└─────────┘    └─────────────┘    └──────────────────┘
     │                                     │
     │                                     │
     │                        ┌────────────┼────────────┐
     │                        │            │            │
     │                        ▼            ▼            ▼
     │               ┌───────────┐  ┌───────────────┐  │
     │               │ COMPLETED │  │REVISION_NEEDED│──┘
     │               └───────────┘  └───────────────┘
     │                                     │
     │                                     │ 重新执行
     │                                     ▼
     │                            ┌─────────────┐
     │                            │ IN_PROGRESS │
     │                            └─────────────┘
     │
     ▼
┌───────────┐
│ CANCELLED │
└───────────┘
```

---

## 三、执行流程详解

### 3.1 创建任务

```typescript
// team-mission.service.ts
async createMission(
  topicId: string,
  userId: string,
  dto: CreateMissionDto
): Promise<TeamMission> {
  // 1. 验证 Leader 存在
  const leader = await this.prisma.topicAIMember.findUnique({
    where: { id: dto.leaderId }
  });
  if (!leader || !leader.isLeader) {
    throw new BadRequestException('指定的 Leader 不存在或未设为 Leader');
  }

  // 2. 创建 Mission 记录
  const mission = await this.prisma.teamMission.create({
    data: {
      topicId,
      title: dto.title,
      description: dto.description,
      objectives: dto.objectives || [],
      constraints: dto.constraints || [],
      deliverables: dto.deliverables || [],
      leaderId: dto.leaderId,
      status: MissionStatus.PENDING,
      createdById: userId,
    }
  });

  // 3. 记录日志
  await this.createLog(mission.id, {
    type: MissionLogType.MISSION_CREATED,
    agentId: leader.id,
    agentName: leader.displayName,
    content: `任务创建：${dto.title}`,
  });

  // 4. 自动启动（默认行为）
  if (dto.autoStart !== false) {
    this.startMission(mission.id, userId).catch(err => {
      this.logger.error(`Failed to start mission: ${err}`);
    });
  }

  return mission;
}
```

### 3.2 Leader 规划阶段

```typescript
// 状态: PLANNING
private async executeLeaderPlanning(mission: Mission) {
  const { leader, topic } = mission;
  const teamMembers = topic.aiMembers;

  // 1. 构建规划提示词
  const planningPrompt = this.buildLeaderPlanningPrompt(
    mission, leader, teamMembers
  );

  // 2. 调用 Leader AI
  const aiResponse = await this.callAIWithConfig(
    leader.aiModel,
    [{ role: 'user', content: planningPrompt }],
    this.getLeaderSystemPrompt(leader),
    { maxTokens: 8000, temperature: 0.7 }
  );

  // 3. 解析任务分解 JSON
  const breakdown = this.parseTaskBreakdown(
    aiResponse.content, teamMembers
  );

  // 4. 创建 AgentTask 记录
  await this.createTasksFromBreakdown(mission.id, breakdown, teamMembers);

  // 5. 状态更新为 IN_PROGRESS
  await this.prisma.teamMission.update({
    where: { id: mission.id },
    data: {
      status: MissionStatus.IN_PROGRESS,
      totalTasks: breakdown.tasks.length,
    }
  });

  // 6. 开始执行任务
  await this.executeNextTasks(mission.id);
}
```

### 3.3 Leader 规划提示词

```typescript
private buildLeaderPlanningPrompt(
  mission: Mission,
  leader: TopicAIMember,
  teamMembers: TopicAIMember[]
): string {
  const memberList = teamMembers
    .filter(m => m.id !== leader.id)
    .map(m => `- ${m.displayName} (${m.aiModel}): ${m.expertiseAreas?.join(', ') || '通用'}`);

  return `
你是团队 Leader，需要分析以下任务并分解为可执行的子任务：

## 任务信息
- **标题**: ${mission.title}
- **描述**: ${mission.description}
- **目标**: ${mission.objectives?.join('\n- ') || '无'}
- **约束**: ${mission.constraints?.join('\n- ') || '无'}
- **交付物**: ${mission.deliverables?.join('\n- ') || '无'}

## 团队成员
${memberList.join('\n')}

## 任务要求
请将任务分解为多个子任务，每个子任务需要：
1. 明确的标题和描述
2. 指定执行者（从团队成员中选择）
3. 设置优先级 (CRITICAL/HIGH/MEDIUM/LOW)
4. 指定任务类型 (RESEARCH/DESIGN/IMPLEMENTATION/REVIEW/...)
5. 如有依赖，指明依赖的任务

## 输出格式 (JSON)
\`\`\`json
{
  "tasks": [
    {
      "title": "任务标题",
      "description": "任务描述",
      "assigneeId": "成员ID",
      "assigneeName": "成员名称",
      "priority": "HIGH",
      "taskType": "RESEARCH",
      "dependsOn": []  // 依赖的任务索引
    }
  ],
  "executionPlan": "整体执行计划说明"
}
\`\`\`
`;
}
```

### 3.4 任务执行

```typescript
private async executeNextTasks(missionId: string) {
  const mission = await this.prisma.teamMission.findUnique({
    where: { id: missionId },
    include: { tasks: { include: { assignedTo: true } }, leader: true }
  });

  if (!mission || mission.status !== MissionStatus.IN_PROGRESS) {
    return;
  }

  // 1. 找出依赖已满足的 PENDING 任务
  const pendingTasks = mission.tasks.filter(
    t => t.status === AgentTaskStatus.PENDING
  );

  const tasksToStart: AgentTask[] = [];
  for (const task of pendingTasks) {
    const dependsOnIds = task.dependsOnIds || [];
    const allDependenciesCompleted = dependsOnIds.every(depId => {
      const depTask = mission.tasks.find(t => t.id === depId);
      return depTask?.status === AgentTaskStatus.COMPLETED;
    });

    if (allDependenciesCompleted) {
      tasksToStart.push(task);
    }
  }

  // 2. 检查是否所有任务完成
  if (tasksToStart.length === 0) {
    const allCompleted = mission.tasks.every(
      t => t.status === AgentTaskStatus.COMPLETED
    );
    if (allCompleted) {
      await this.completeMission(missionId);
      return;
    }
    return;
  }

  // 3. 并行执行任务（限制并发）
  await mapWithConcurrency(
    tasksToStart,
    (task) => this.executeTask(mission, task),
    3  // 最大并发数
  );
}
```

### 3.5 单任务执行

```typescript
private async executeTask(mission: Mission, task: AgentTask) {
  const { assignedTo } = task;

  try {
    // 1. 更新状态为执行中
    await this.prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: new Date(),
      }
    });

    // 2. 广播状态
    this.aiTeamsGateway.emitToTopic(mission.topicId, 'agent:working', {
      missionId: mission.id,
      taskId: task.id,
      agentId: assignedTo.id,
      status: 'started',
    });

    // 3. 构建任务执行提示词
    const taskPrompt = this.buildTaskExecutionPrompt(mission, task);

    // 4. 调用 AI 执行
    const aiResponse = await this.callAIWithConfig(
      assignedTo.aiModel,
      [{ role: 'user', content: taskPrompt }],
      this.getAgentSystemPrompt(assignedTo, task),
      { maxTokens: 8000, temperature: 0.7 }
    );

    // 5. 保存结果
    const resultMessage = await this.sendMessageToTopic(
      mission.topicId,
      assignedTo.id,
      `[工作汇报]\n\n**任务**: ${task.title}\n\n${aiResponse.content}`,
      MessageContentType.TEXT
    );

    // 6. 更新任务状态
    await this.prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: AgentTaskStatus.AWAITING_REVIEW,
        result: aiResponse.content,
        resultMessageId: resultMessage?.id,
        completedAt: new Date(),
      }
    });

    // 7. 触发 Leader 审核
    await this.leaderReviewTask(mission.id, task.id);

  } catch (error) {
    // 错误处理
    await this.handleTaskError(task, error);
  }
}
```

### 3.6 Leader 审核

```typescript
private async leaderReviewTask(missionId: string, taskId: string) {
  const mission = await this.prisma.teamMission.findUnique({
    where: { id: missionId },
    include: { leader: true, tasks: true }
  });

  const task = mission.tasks.find(t => t.id === taskId);
  if (!task) return;

  // 1. 构建审核提示词
  const reviewPrompt = this.buildLeaderReviewPrompt(mission, task);

  // 2. 调用 Leader AI 审核
  const aiResponse = await this.callAIWithConfig(
    mission.leader.aiModel,
    [{ role: 'user', content: reviewPrompt }],
    this.getLeaderReviewSystemPrompt(mission.leader),
    { maxTokens: 2000, temperature: 0.5 }
  );

  // 3. 解析审核结果
  const review = this.parseReviewResult(aiResponse.content);

  // 4. 发送审核消息
  await this.sendMessageToTopic(
    mission.topicId,
    mission.leader.id,
    `[Leader 审核]\n\n**任务**: ${task.title}\n**结果**: ${review.approved ? '✅ 通过' : '❌ 需要修改'}\n\n${review.feedback}`,
    MessageContentType.TEXT
  );

  // 5. 更新任务状态
  if (review.approved) {
    await this.prisma.agentTask.update({
      where: { id: taskId },
      data: {
        status: AgentTaskStatus.COMPLETED,
        leaderFeedback: review.feedback,
      }
    });

    // 更新 Mission 进度
    await this.updateMissionProgress(missionId);

    // 执行下一批任务
    await this.executeNextTasks(missionId);

  } else {
    // 检查修改次数
    if (task.revisionCount >= task.maxRevisions) {
      // 超过最大修改次数，强制通过
      await this.forcePassTask(taskId, review.feedback);
    } else {
      // 需要修改
      await this.prisma.agentTask.update({
        where: { id: taskId },
        data: {
          status: AgentTaskStatus.REVISION_NEEDED,
          needsRevision: true,
          leaderFeedback: review.feedback,
          revisionCount: { increment: 1 },
        }
      });

      // 重新执行任务
      await this.retryTask(missionId, taskId);
    }
  }
}
```

---

## 四、卡住任务恢复

### 4.1 @Leader 触发恢复

当用户 @Leader 并包含组织/继续关键词时：

```typescript
async handleLeaderMentionCommand(
  topicId: string,
  userId: string,
  content: string
): Promise<{ handled: boolean; action?: string }> {
  // 检测关键词
  const organizeKeywords = [
    "组织", "完成任务", "继续组织", "系统组织",
    "分配任务", "委派", "delegate", "organize"
  ];

  const hasOrganizeKeyword = organizeKeywords.some(
    kw => content.toLowerCase().includes(kw.toLowerCase())
  );

  // 查找 IN_PROGRESS 任务
  const inProgressMission = await this.prisma.teamMission.findFirst({
    where: { topicId, status: MissionStatus.IN_PROGRESS },
    include: { leader: true, tasks: true }
  });

  if (inProgressMission && hasOrganizeKeyword) {
    // 检查卡住的任务（超过 5 分钟）
    const stuckThreshold = 5 * 60 * 1000;
    const now = Date.now();
    const stuckTasks = inProgressMission.tasks.filter(
      t => t.status === AgentTaskStatus.IN_PROGRESS &&
           t.startedAt &&
           now - new Date(t.startedAt).getTime() > stuckThreshold
    );

    // 重置卡住的任务
    for (const task of stuckTasks) {
      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: { status: AgentTaskStatus.PENDING, startedAt: null }
      });
    }

    // 继续执行
    this.executeNextTasks(inProgressMission.id);

    return { handled: true, action: 'continue_organizing' };
  }

  return { handled: false };
}
```

### 4.2 PLANNING 卡住恢复

```typescript
// 检查 PLANNING 状态的任务
const planningMission = await this.prisma.teamMission.findFirst({
  where: { topicId, status: MissionStatus.PLANNING },
  include: { leader: true },
});

if (planningMission && hasOrganizeKeyword) {
  // 重置为 PENDING 并重新启动
  await this.prisma.teamMission.update({
    where: { id: planningMission.id },
    data: { status: MissionStatus.PENDING },
  });

  this.startMission(planningMission.id, userId);

  return { handled: true, action: "restart_planning" };
}
```

---

## 五、日志系统

### 5.1 日志类型

```typescript
enum MissionLogType {
  MISSION_CREATED      // 任务创建
  PLANNING_STARTED     // 规划开始
  PLANNING_COMPLETED   // 规划完成
  TASK_ASSIGNED        // 任务分配
  TASK_STARTED         // 任务开始
  TASK_COMPLETED       // 任务完成
  TASK_FAILED          // 任务失败
  TASK_RETRY           // 任务重试
  LEADER_FEEDBACK      // Leader 反馈
  REVISION_REQUESTED   // 请求修改
  MISSION_COMPLETED    // 任务完成
  MISSION_FAILED       // 任务失败
  MISSION_CANCELLED    // 任务取消
  MISSION_PAUSED       // 任务暂停
  MISSION_RESUMED      // 任务恢复
}
```

### 5.2 日志记录

```typescript
await this.createLog(missionId, {
  type: MissionLogType.TASK_COMPLETED,
  agentId: task.assignedTo.id,
  agentName: task.assignedTo.displayName,
  taskId: task.id,
  taskTitle: task.title,
  content: `任务「${task.title}」已完成`,
  messageId: resultMessage?.id,
  metadata: {
    executionTime: Date.now() - task.startedAt.getTime(),
    tokensUsed: aiResponse.tokensUsed,
  },
});
```

---

## 六、WebSocket 事件

| 事件                       | 数据                                                 | 触发时机            |
| -------------------------- | ---------------------------------------------------- | ------------------- |
| `mission:status_changed`   | `{ missionId, status, previousStatus }`              | 任务状态变更        |
| `mission:progress_updated` | `{ missionId, completedTasks, totalTasks, percent }` | 进度更新            |
| `agent:working`            | `{ missionId, taskId, agentId, status }`             | Agent 开始/完成工作 |
| `task:status_changed`      | `{ missionId, taskId, status }`                      | 子任务状态变更      |

---

## 七、错误处理

### 7.1 AI 调用失败

```typescript
private async handleTaskError(task: AgentTask, error: Error) {
  this.logger.error(`Task ${task.id} failed: ${error.message}`);

  await this.prisma.agentTask.update({
    where: { id: task.id },
    data: {
      status: AgentTaskStatus.PENDING,  // 重置为 PENDING
      startedAt: null,
    }
  });

  await this.createLog(task.missionId, {
    type: MissionLogType.TASK_FAILED,
    taskId: task.id,
    content: `任务执行失败: ${error.message}`,
  });
}
```

### 7.2 规划失败

```typescript
// 在 executeLeaderPlanning 的 catch 块中
await this.prisma.teamMission.update({
  where: { id: mission.id },
  data: { status: MissionStatus.FAILED },
});

await this.sendMessageToTopic(
  mission.topicId,
  leader.id,
  `❌ 任务规划失败：${error.message}`,
  MessageContentType.TEXT,
);
```

---

## 八、配置参数

| 参数                 | 默认值 | 说明               |
| -------------------- | ------ | ------------------ |
| `maxConcurrentTasks` | 3      | 最大并行任务数     |
| `maxRevisions`       | 2      | 单任务最大修改次数 |
| `stuckTaskThreshold` | 5 min  | 任务卡住判定阈值   |
| `planningMaxTokens`  | 8000   | 规划阶段最大 token |
| `taskMaxTokens`      | 8000   | 任务执行最大 token |
| `reviewMaxTokens`    | 2000   | 审核阶段最大 token |
