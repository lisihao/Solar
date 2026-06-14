# AI Coding 团队协同重构 - 技术架构设计

**版本**: 1.0
**日期**: 2025-12-21
**关联PRD**: ai-coding-refactor-prd-v1.0.md

---

## 1. 整体架构

### 1.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              前端 (Next.js 14)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐            │
│  │  ProjectDetail  │  │  TeamChatPanel  │  │   TaskBoard     │            │
│  │     Page        │  │    [NEW]        │  │   (Enhanced)    │            │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘            │
│           │                    │                    │                      │
│           └────────────────────┼────────────────────┘                      │
│                                │                                           │
│                    ┌───────────┴───────────┐                               │
│                    │  useAiCodingSocket    │                               │
│                    │      (Enhanced)       │                               │
│                    └───────────┬───────────┘                               │
│                                │                                           │
└────────────────────────────────┼───────────────────────────────────────────┘
                                 │ WebSocket
                                 ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                            后端 (NestJS)                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  WebSocket Gateway                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  AiCodingGateway                                                     │   │
│  │  Events: team:message, agent:typing, task:update, progress:update   │   │
│  │  Rooms: project:{id}                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Service Layer                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐            │
│  │ AiCodingService │  │CodingTeamService│  │CodingMissionSvc │            │
│  │   (项目管理)    │  │   (团队协同)    │  │   (任务编排)    │            │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘            │
│           │                    │                    │                      │
│           └────────────────────┼────────────────────┘                      │
│                                │                                           │
│                    ┌───────────┴───────────┐                               │
│                    │  CodingAgentService   │                               │
│                    │     (Agent执行)       │                               │
│                    └───────────┬───────────┘                               │
│                                │                                           │
│  AI Core Layer                 ↓                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  AiChatService                                                       │   │
│  │  - validateApiKey()      [NEW]                                       │   │
│  │  - generateWithRetry()   [ENHANCED]                                  │   │
│  │  - validateOutput()      [NEW]                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                          数据层 (Prisma + PostgreSQL)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                  │
│  │AiCodingProject│  │CodingTeamMember│ │ CodingMission │                  │
│  └───────────────┘  └───────────────┘  └───────────────┘                  │
│                                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                  │
│  │CodingAgentTask│  │CodingTeamMsg  │  │CodingMissionLog│                 │
│  └───────────────┘  └───────────────┘  └───────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 核心模块依赖关系

```
AiCodingController
     │
     ├──> AiCodingService (项目CRUD)
     │         │
     │         └──> CodingTeamService (团队管理)
     │                   │
     │                   ├──> CodingMissionService (任务编排)
     │                   │         │
     │                   │         ├──> CodingAgentService (执行任务)
     │                   │         │         │
     │                   │         │         └──> AiChatService (AI调用)
     │                   │         │
     │                   │         └──> DocumentService (文档生成)
     │                   │
     │                   └──> EventEmitterService (事件发布)
     │
     └──> AiCodingGateway (WebSocket)
               │
               └──> EventEmitterService (事件订阅)
```

---

## 2. 数据库设计

### 2.1 完整Schema定义

```prisma
// prisma/schema.prisma 新增部分

// ============= Enums =============

enum CodingAgentType {
  PM          // 产品经理
  ARCHITECT   // 架构师
  PM_LEAD     // 项目经理
  ENGINEER    // 工程师
  QA          // QA测试
}

enum AgentStatus {
  IDLE        // 空闲
  WORKING     // 工作中
  WAITING     // 等待审查
  COMPLETED   // 已完成
  FAILED      // 失败
}

enum MissionStatus {
  PENDING     // 待开始
  PLANNING    // 规划中
  EXECUTING   // 执行中
  REVIEWING   // 审查中
  COMPLETED   // 已完成
  FAILED      // 失败
}

enum TaskStatus {
  PENDING     // 待开始
  ASSIGNED    // 已分配
  IN_PROGRESS // 执行中
  REVIEW      // 待审查
  APPROVED    // 已通过
  REJECTED    // 已拒绝
  COMPLETED   // 已完成
  FAILED      // 失败
}

enum TaskType {
  PRD             // PRD编写
  ARCHITECTURE    // 架构设计
  TASK_BREAKDOWN  // 任务拆分
  CODE            // 代码编写
  TEST            // 测试用例
  REVIEW          // 代码审查
}

enum MessageType {
  CHAT            // 普通对话
  TASK_UPDATE     // 任务更新
  SYSTEM          // 系统消息
  REVIEW_REQUEST  // 审查请求
  REVIEW_RESULT   // 审查结果
  ERROR           // 错误消息
}

// ============= Models =============

model CodingTeamMember {
  id            String          @id @default(uuid())
  projectId     String
  project       AiCodingProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  agentType     CodingAgentType
  displayName   String
  avatar        String?         // 头像URL
  aiModel       String          @default("grok")
  systemPrompt  String          @db.Text

  isLeader      Boolean         @default(false)
  status        AgentStatus     @default(IDLE)

  // 统计信息
  tasksCompleted Int            @default(0)
  tokensUsed     Int            @default(0)

  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  // Relations
  sentMessages    CodingTeamMessage[]  @relation("MessageSender")
  assignedTasks   CodingAgentTask[]    @relation("TaskAssignee")
  reviewedTasks   CodingAgentTask[]    @relation("TaskReviewer")
  ledMissions     CodingMission[]      @relation("MissionLeader")

  @@unique([projectId, agentType])
  @@index([projectId])
  @@index([status])
}

model CodingMission {
  id            String          @id @default(uuid())
  projectId     String
  project       AiCodingProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  leaderId      String
  leader        CodingTeamMember @relation("MissionLeader", fields: [leaderId], references: [id])

  title         String
  description   String          @db.Text
  objectives    String[]        // 目标列表

  status        MissionStatus   @default(PENDING)

  // AI生成的任务分解
  taskBreakdown Json?

  // 最终产出
  finalResult   Json?

  // 错误信息
  errorMessage  String?
  errorDetails  Json?

  // 修改轮次控制
  currentRound  Int             @default(1)
  maxRounds     Int             @default(3)

  // 时间戳
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  // Relations
  tasks         CodingAgentTask[]
  logs          CodingMissionLog[]

  @@index([projectId])
  @@index([status])
}

model CodingAgentTask {
  id            String          @id @default(uuid())
  missionId     String
  mission       CodingMission   @relation(fields: [missionId], references: [id], onDelete: Cascade)

  title         String
  description   String          @db.Text
  taskType      TaskType
  priority      Int             @default(0)  // 0=normal, 1=high, 2=urgent

  // 分配
  assignedToId  String
  assignedTo    CodingTeamMember @relation("TaskAssignee", fields: [assignedToId], references: [id])

  // 审查
  reviewerId    String?
  reviewer      CodingTeamMember? @relation("TaskReviewer", fields: [reviewerId], references: [id])

  status        TaskStatus      @default(PENDING)

  // 依赖关系
  dependencies  String[]        // 依赖的任务ID列表

  // 输出
  output        Json?           // AI生成的输出
  outputHash    String?         // 输出内容的hash，用于去重

  // 审查反馈
  feedback      String?
  feedbackHistory Json?         // 历史反馈记录

  // 重试控制
  retryCount    Int             @default(0)
  maxRetries    Int             @default(3)
  lastError     String?

  // Token统计
  tokensUsed    Int             @default(0)

  // 时间戳
  assignedAt    DateTime?
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  @@index([missionId])
  @@index([assignedToId])
  @@index([status])
}

model CodingTeamMessage {
  id            String          @id @default(uuid())
  projectId     String
  project       AiCodingProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  // 发送者（AI Agent）
  senderId      String?
  sender        CodingTeamMember? @relation("MessageSender", fields: [senderId], references: [id])

  content       String          @db.Text
  messageType   MessageType     @default(CHAT)

  // AI调用信息
  aiModel       String?
  tokensUsed    Int?
  latencyMs     Int?            // 响应延迟（毫秒）

  // 提及和回复
  mentions      String[]        // 提及的Agent ID列表
  replyToId     String?         // 回复的消息ID

  // 关联任务（如果是任务相关消息）
  taskId        String?

  // 元数据
  metadata      Json?

  createdAt     DateTime        @default(now())

  @@index([projectId])
  @@index([senderId])
  @@index([messageType])
  @@index([createdAt])
}

model CodingMissionLog {
  id            String          @id @default(uuid())
  missionId     String
  mission       CodingMission   @relation(fields: [missionId], references: [id], onDelete: Cascade)

  phase         String          // planning, executing, reviewing, completed, failed
  action        String          // 具体动作描述
  agentId       String?         // 相关Agent
  taskId        String?         // 相关任务

  details       Json?           // 详细信息

  // 错误信息（如果是错误日志）
  errorType     String?
  errorMessage  String?
  errorStack    String?         @db.Text

  createdAt     DateTime        @default(now())

  @@index([missionId])
  @@index([phase])
  @@index([createdAt])
}

// 更新现有 AiCodingProject 模型
model AiCodingProject {
  // ... 现有字段 ...

  // 新增关联
  teamMembers     CodingTeamMember[]
  missions        CodingMission[]
  teamMessages    CodingTeamMessage[]

  // 新增字段
  teamInitialized Boolean       @default(false)
  currentMissionId String?      // 当前执行的Mission
}
```

### 2.2 数据库迁移

```bash
# 生成迁移
npx prisma migrate dev --name add_coding_team_collaboration

# 生成类型
npx prisma generate
```

---

## 3. 后端服务实现

### 3.1 CodingTeamService

```typescript
// backend/src/modules/ai/ai-coding/services/coding-team.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/prisma/prisma.service";
import { CodingAgentType, AgentStatus, Prisma } from "@prisma/client";
import { EventEmitterService } from "./event-emitter.service";
import { AGENT_CONFIGS } from "../constants/agent-configs";

@Injectable()
export class CodingTeamService {
  private readonly logger = new Logger(CodingTeamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitterService,
  ) {}

  /**
   * 初始化开发团队
   * 为项目创建5个AI Agent成员
   */
  async initializeTeam(projectId: string): Promise<void> {
    this.logger.log(`Initializing team for project: ${projectId}`);

    // 检查团队是否已初始化
    const project = await this.prisma.aiCodingProject.findUnique({
      where: { id: projectId },
      include: { teamMembers: true },
    });

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    if (project.teamInitialized && project.teamMembers.length > 0) {
      this.logger.log(`Team already initialized for project: ${projectId}`);
      return;
    }

    // 创建团队成员
    const agentTypes = [
      CodingAgentType.PM,
      CodingAgentType.ARCHITECT,
      CodingAgentType.PM_LEAD,
      CodingAgentType.ENGINEER,
      CodingAgentType.QA,
    ];

    const members = await Promise.all(
      agentTypes.map(async (type) => {
        const config = AGENT_CONFIGS[type];
        return this.prisma.codingTeamMember.create({
          data: {
            projectId,
            agentType: type,
            displayName: config.displayName,
            avatar: config.avatar,
            aiModel: config.defaultModel,
            systemPrompt: config.systemPrompt,
            isLeader: type === CodingAgentType.PM,
            status: AgentStatus.IDLE,
          },
        });
      }),
    );

    // 更新项目状态
    await this.prisma.aiCodingProject.update({
      where: { id: projectId },
      data: { teamInitialized: true },
    });

    // 发送WebSocket事件
    await this.eventEmitter.emit(projectId, "team:initialized", {
      projectId,
      members: members.map((m) => ({
        id: m.id,
        agentType: m.agentType,
        displayName: m.displayName,
        status: m.status,
      })),
    });

    this.logger.log(`Team initialized with ${members.length} members`);
  }

  /**
   * 获取团队成员列表
   */
  async getTeamMembers(projectId: string) {
    return this.prisma.codingTeamMember.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * 获取Leader成员
   */
  async getLeader(projectId: string) {
    return this.prisma.codingTeamMember.findFirst({
      where: { projectId, isLeader: true },
    });
  }

  /**
   * 更新Agent状态
   */
  async updateAgentStatus(
    agentId: string,
    status: AgentStatus,
    currentTask?: string,
  ): Promise<void> {
    const member = await this.prisma.codingTeamMember.update({
      where: { id: agentId },
      data: { status },
      include: { project: true },
    });

    // 发送WebSocket事件
    await this.eventEmitter.emit(member.projectId, "agent:status", {
      agentId,
      agentType: member.agentType,
      status,
      currentTask,
    });
  }

  /**
   * 发送团队消息
   */
  async sendMessage(params: {
    projectId: string;
    senderId: string;
    content: string;
    messageType: MessageType;
    mentions?: string[];
    taskId?: string;
    aiModel?: string;
    tokensUsed?: number;
  }): Promise<CodingTeamMessage> {
    const message = await this.prisma.codingTeamMessage.create({
      data: {
        projectId: params.projectId,
        senderId: params.senderId,
        content: params.content,
        messageType: params.messageType,
        mentions: params.mentions || [],
        taskId: params.taskId,
        aiModel: params.aiModel,
        tokensUsed: params.tokensUsed,
      },
      include: {
        sender: true,
      },
    });

    // 发送WebSocket事件
    await this.eventEmitter.emit(params.projectId, "team:message", {
      id: message.id,
      senderId: message.senderId,
      senderName: message.sender?.displayName,
      senderType: message.sender?.agentType,
      content: message.content,
      messageType: message.messageType,
      createdAt: message.createdAt,
    });

    return message;
  }

  /**
   * 广播系统消息
   */
  async broadcastSystemMessage(
    projectId: string,
    content: string,
    messageType: MessageType = MessageType.SYSTEM,
  ): Promise<void> {
    await this.sendMessage({
      projectId,
      senderId: null, // 系统消息没有发送者
      content,
      messageType,
    });
  }
}
```

### 3.2 CodingMissionService

```typescript
// backend/src/modules/ai/ai-coding/services/coding-mission.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/prisma/prisma.service";
import {
  MissionStatus,
  TaskStatus,
  TaskType,
  CodingAgentType,
} from "@prisma/client";
import { CodingTeamService } from "./coding-team.service";
import { CodingAgentService } from "./coding-agent.service";
import { EventEmitterService } from "./event-emitter.service";

interface TaskBreakdown {
  understanding: string;
  tasks: {
    title: string;
    description: string;
    taskType: TaskType;
    assigneeType: CodingAgentType;
    priority: number;
    dependencies: string[]; // 依赖任务的临时ID
  }[];
  executionPlan: string;
  risks: string[];
}

@Injectable()
export class CodingMissionService {
  private readonly logger = new Logger(CodingMissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly teamService: CodingTeamService,
    private readonly agentService: CodingAgentService,
    private readonly eventEmitter: EventEmitterService,
  ) {}

  /**
   * 创建开发任务
   */
  async createMission(
    projectId: string,
    requirement: string,
  ): Promise<CodingMission> {
    // 获取Leader（PM）
    const leader = await this.teamService.getLeader(projectId);
    if (!leader) {
      throw new Error("Team not initialized");
    }

    const mission = await this.prisma.codingMission.create({
      data: {
        projectId,
        leaderId: leader.id,
        title: `开发任务: ${requirement.slice(0, 50)}...`,
        description: requirement,
        objectives: [],
        status: MissionStatus.PENDING,
      },
    });

    // 更新项目当前Mission
    await this.prisma.aiCodingProject.update({
      where: { id: projectId },
      data: { currentMissionId: mission.id },
    });

    // 记录日志
    await this.logMissionEvent(mission.id, "planning", "Mission created");

    return mission;
  }

  /**
   * 启动任务执行
   */
  async startMission(missionId: string): Promise<void> {
    const mission = await this.getMissionWithRelations(missionId);

    // 更新状态为PLANNING
    await this.updateMissionStatus(missionId, MissionStatus.PLANNING);

    try {
      // Step 1: Leader规划任务分解
      await this.teamService.broadcastSystemMessage(
        mission.projectId,
        "开始规划任务分解...",
      );

      const breakdown = await this.planMission(mission);

      // Step 2: 创建子任务
      await this.createTasksFromBreakdown(missionId, breakdown);

      // Step 3: 开始执行
      await this.updateMissionStatus(missionId, MissionStatus.EXECUTING);
      await this.executeTasks(missionId);

      // Step 4: 审查阶段
      await this.updateMissionStatus(missionId, MissionStatus.REVIEWING);
      await this.reviewAllOutputs(missionId);

      // Step 5: 完成
      await this.completeMission(missionId);
    } catch (error) {
      this.logger.error(`Mission failed: ${error.message}`, error.stack);
      await this.failMission(missionId, error.message);
    }
  }

  /**
   * PM规划任务分解
   */
  private async planMission(mission: CodingMission): Promise<TaskBreakdown> {
    const leader = await this.prisma.codingTeamMember.findUnique({
      where: { id: mission.leaderId },
    });

    // 更新Leader状态
    await this.teamService.updateAgentStatus(
      leader.id,
      AgentStatus.WORKING,
      "分析需求",
    );

    // 调用AI进行任务分解
    const result = await this.agentService.generateTaskBreakdown(
      leader,
      mission.description,
    );

    // 验证输出
    if (!result.success || !result.data) {
      throw new Error(`任务规划失败: ${result.error}`);
    }

    // 保存任务分解
    await this.prisma.codingMission.update({
      where: { id: mission.id },
      data: { taskBreakdown: result.data as Prisma.JsonValue },
    });

    // 发送团队消息
    await this.teamService.sendMessage({
      projectId: mission.projectId,
      senderId: leader.id,
      content: this.formatTaskBreakdownMessage(result.data),
      messageType: MessageType.TASK_UPDATE,
      aiModel: result.aiModel,
      tokensUsed: result.tokensUsed,
    });

    await this.teamService.updateAgentStatus(leader.id, AgentStatus.IDLE);

    return result.data;
  }

  /**
   * 从任务分解创建子任务
   */
  private async createTasksFromBreakdown(
    missionId: string,
    breakdown: TaskBreakdown,
  ): Promise<void> {
    const mission = await this.getMissionWithRelations(missionId);
    const teamMembers = await this.teamService.getTeamMembers(
      mission.projectId,
    );

    // 创建临时ID到真实ID的映射
    const taskIdMap = new Map<string, string>();

    for (let i = 0; i < breakdown.tasks.length; i++) {
      const taskDef = breakdown.tasks[i];
      const tempId = `task_${i}`;

      // 找到对应类型的Agent
      const assignee = teamMembers.find(
        (m) => m.agentType === taskDef.assigneeType,
      );
      if (!assignee) {
        throw new Error(`No agent found for type: ${taskDef.assigneeType}`);
      }

      // 找到Leader作为审查者
      const reviewer = teamMembers.find((m) => m.isLeader);

      // 转换依赖关系
      const dependencies = taskDef.dependencies
        .map((dep) => taskIdMap.get(dep))
        .filter(Boolean) as string[];

      // 创建任务
      const task = await this.prisma.codingAgentTask.create({
        data: {
          missionId,
          title: taskDef.title,
          description: taskDef.description,
          taskType: taskDef.taskType,
          priority: taskDef.priority,
          assignedToId: assignee.id,
          reviewerId: reviewer?.id,
          status: TaskStatus.PENDING,
          dependencies,
        },
      });

      taskIdMap.set(tempId, task.id);
    }

    this.logger.log(
      `Created ${breakdown.tasks.length} tasks for mission ${missionId}`,
    );
  }

  /**
   * 执行任务（支持依赖和并行）
   */
  private async executeTasks(missionId: string): Promise<void> {
    const tasks = await this.prisma.codingAgentTask.findMany({
      where: { missionId },
      include: { assignedTo: true },
      orderBy: { priority: "desc" },
    });

    // 构建依赖图
    const completedTaskIds = new Set<string>();
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    while (completedTaskIds.size < tasks.length) {
      // 找出可执行的任务（依赖都已完成）
      const executableTasks = tasks.filter(
        (t) =>
          !completedTaskIds.has(t.id) &&
          t.dependencies.every((dep) => completedTaskIds.has(dep)),
      );

      if (executableTasks.length === 0) {
        // 检查是否有任务失败导致无法继续
        const failedTasks = tasks.filter((t) => t.status === TaskStatus.FAILED);
        if (failedTasks.length > 0) {
          throw new Error(
            `Tasks failed: ${failedTasks.map((t) => t.title).join(", ")}`,
          );
        }
        break; // 没有可执行的任务
      }

      // 并行执行可执行的任务
      await Promise.all(
        executableTasks.map(async (task) => {
          try {
            await this.executeTask(task);
            completedTaskIds.add(task.id);
          } catch (error) {
            this.logger.error(`Task ${task.id} failed: ${error.message}`);
            // 标记任务失败但继续执行其他任务
            await this.prisma.codingAgentTask.update({
              where: { id: task.id },
              data: {
                status: TaskStatus.FAILED,
                lastError: error.message,
              },
            });
          }
        }),
      );

      // 更新进度
      await this.updateProgress(missionId);
    }
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: CodingAgentTask): Promise<void> {
    // 更新任务状态
    await this.prisma.codingAgentTask.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.IN_PROGRESS,
        startedAt: new Date(),
      },
    });

    // 更新Agent状态
    await this.teamService.updateAgentStatus(
      task.assignedToId,
      AgentStatus.WORKING,
      task.title,
    );

    const mission = await this.prisma.codingMission.findUnique({
      where: { id: task.missionId },
    });

    // 获取上下文（前置任务的输出）
    const context = await this.buildTaskContext(task);

    // 执行任务（调用AI）
    const result = await this.agentService.executeTask(
      task.assignedTo,
      task,
      context,
    );

    if (!result.success) {
      throw new Error(result.error);
    }

    // 保存输出
    await this.prisma.codingAgentTask.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.REVIEW,
        output: result.data as Prisma.JsonValue,
        tokensUsed: result.tokensUsed,
        completedAt: new Date(),
      },
    });

    // 发送团队消息
    await this.teamService.sendMessage({
      projectId: mission.projectId,
      senderId: task.assignedToId,
      content: `任务完成: ${task.title}\n\n${this.formatTaskOutput(task.taskType, result.data)}`,
      messageType: MessageType.TASK_UPDATE,
      taskId: task.id,
      aiModel: result.aiModel,
      tokensUsed: result.tokensUsed,
    });

    // 更新Agent状态
    await this.teamService.updateAgentStatus(
      task.assignedToId,
      AgentStatus.WAITING,
    );
  }

  /**
   * 构建任务上下文
   */
  private async buildTaskContext(task: CodingAgentTask): Promise<TaskContext> {
    // 获取依赖任务的输出
    const dependencyOutputs: Record<string, unknown> = {};

    for (const depId of task.dependencies) {
      const depTask = await this.prisma.codingAgentTask.findUnique({
        where: { id: depId },
      });
      if (depTask?.output) {
        dependencyOutputs[depTask.taskType] = depTask.output;
      }
    }

    // 获取Mission信息
    const mission = await this.prisma.codingMission.findUnique({
      where: { id: task.missionId },
    });

    return {
      requirement: mission.description,
      taskBreakdown: mission.taskBreakdown,
      dependencyOutputs,
    };
  }

  /**
   * 审查所有输出
   */
  private async reviewAllOutputs(missionId: string): Promise<void> {
    const mission = await this.getMissionWithRelations(missionId);
    const tasks = await this.prisma.codingAgentTask.findMany({
      where: { missionId, status: TaskStatus.REVIEW },
      include: { assignedTo: true },
    });

    // Leader审查
    const leader = await this.prisma.codingTeamMember.findUnique({
      where: { id: mission.leaderId },
    });

    await this.teamService.updateAgentStatus(
      leader.id,
      AgentStatus.WORKING,
      "审查产出",
    );

    for (const task of tasks) {
      const reviewResult = await this.agentService.reviewTaskOutput(
        leader,
        task,
      );

      if (reviewResult.approved) {
        await this.prisma.codingAgentTask.update({
          where: { id: task.id },
          data: {
            status: TaskStatus.APPROVED,
            feedback: reviewResult.feedback,
          },
        });
      } else {
        // 需要修改
        if (mission.currentRound < mission.maxRounds) {
          await this.prisma.codingAgentTask.update({
            where: { id: task.id },
            data: {
              status: TaskStatus.REJECTED,
              feedback: reviewResult.feedback,
              retryCount: { increment: 1 },
            },
          });

          // 发送反馈消息
          await this.teamService.sendMessage({
            projectId: mission.projectId,
            senderId: leader.id,
            content: `@${task.assignedTo.displayName} 任务需要修改:\n${reviewResult.feedback}`,
            messageType: MessageType.REVIEW_RESULT,
            taskId: task.id,
            mentions: [task.assignedToId],
          });
        } else {
          // 超过最大修改次数，强制通过
          await this.prisma.codingAgentTask.update({
            where: { id: task.id },
            data: {
              status: TaskStatus.APPROVED,
              feedback: `已达最大修改次数，强制通过。原反馈: ${reviewResult.feedback}`,
            },
          });
        }
      }
    }

    await this.teamService.updateAgentStatus(leader.id, AgentStatus.IDLE);

    // 检查是否有需要重新执行的任务
    const rejectedTasks = await this.prisma.codingAgentTask.findMany({
      where: { missionId, status: TaskStatus.REJECTED },
    });

    if (rejectedTasks.length > 0 && mission.currentRound < mission.maxRounds) {
      // 增加轮次
      await this.prisma.codingMission.update({
        where: { id: missionId },
        data: { currentRound: { increment: 1 } },
      });

      // 重新执行被拒绝的任务
      for (const task of rejectedTasks) {
        await this.prisma.codingAgentTask.update({
          where: { id: task.id },
          data: { status: TaskStatus.PENDING },
        });
      }

      await this.updateMissionStatus(missionId, MissionStatus.EXECUTING);
      await this.executeTasks(missionId);

      // 再次审查
      await this.updateMissionStatus(missionId, MissionStatus.REVIEWING);
      await this.reviewAllOutputs(missionId);
    }
  }

  /**
   * 完成任务
   */
  private async completeMission(missionId: string): Promise<void> {
    const tasks = await this.prisma.codingAgentTask.findMany({
      where: { missionId },
    });

    // 整合所有产出
    const finalResult = {
      prd: tasks.find((t) => t.taskType === TaskType.PRD)?.output,
      architecture: tasks.find((t) => t.taskType === TaskType.ARCHITECTURE)
        ?.output,
      taskBreakdown: tasks.find((t) => t.taskType === TaskType.TASK_BREAKDOWN)
        ?.output,
      code: tasks.find((t) => t.taskType === TaskType.CODE)?.output,
      tests: tasks.find((t) => t.taskType === TaskType.TEST)?.output,
    };

    await this.prisma.codingMission.update({
      where: { id: missionId },
      data: {
        status: MissionStatus.COMPLETED,
        finalResult: finalResult as Prisma.JsonValue,
        completedAt: new Date(),
      },
    });

    const mission = await this.getMissionWithRelations(missionId);

    // 更新项目状态
    await this.prisma.aiCodingProject.update({
      where: { id: mission.projectId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        outputs: finalResult as Prisma.JsonValue,
      },
    });

    // 发送完成消息
    await this.teamService.broadcastSystemMessage(
      mission.projectId,
      "项目开发完成！所有产出已生成。",
    );

    await this.eventEmitter.emit(mission.projectId, "mission:completed", {
      missionId,
      finalResult,
    });
  }

  /**
   * 任务失败处理
   */
  private async failMission(
    missionId: string,
    errorMessage: string,
  ): Promise<void> {
    await this.prisma.codingMission.update({
      where: { id: missionId },
      data: {
        status: MissionStatus.FAILED,
        errorMessage,
      },
    });

    const mission = await this.getMissionWithRelations(missionId);

    // 更新项目状态
    await this.prisma.aiCodingProject.update({
      where: { id: mission.projectId },
      data: {
        status: "FAILED",
        errorMessage,
      },
    });

    // 发送错误消息
    await this.teamService.broadcastSystemMessage(
      mission.projectId,
      `任务执行失败: ${errorMessage}`,
      MessageType.ERROR,
    );

    await this.eventEmitter.emit(mission.projectId, "mission:failed", {
      missionId,
      error: errorMessage,
    });
  }

  /**
   * 更新Mission状态
   */
  private async updateMissionStatus(
    missionId: string,
    status: MissionStatus,
  ): Promise<void> {
    await this.prisma.codingMission.update({
      where: { id: missionId },
      data: {
        status,
        startedAt: status === MissionStatus.PLANNING ? new Date() : undefined,
      },
    });

    await this.logMissionEvent(
      missionId,
      status.toLowerCase(),
      `Status changed to ${status}`,
    );
  }

  /**
   * 更新进度
   */
  private async updateProgress(missionId: string): Promise<void> {
    const mission = await this.getMissionWithRelations(missionId);
    const tasks = await this.prisma.codingAgentTask.findMany({
      where: { missionId },
    });

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(
      (t) =>
        t.status === TaskStatus.APPROVED || t.status === TaskStatus.COMPLETED,
    ).length;
    const inProgressTasks = tasks.filter(
      (t) =>
        t.status === TaskStatus.IN_PROGRESS || t.status === TaskStatus.REVIEW,
    ).length;

    const baseProgress = (completedTasks / totalTasks) * 100;
    const inProgressBonus = (inProgressTasks / totalTasks) * 10;
    const realProgress = Math.min(baseProgress + inProgressBonus, 99);

    await this.prisma.aiCodingProject.update({
      where: { id: mission.projectId },
      data: { progress: Math.round(realProgress) },
    });

    await this.eventEmitter.emit(mission.projectId, "progress:update", {
      progress: Math.round(realProgress),
      completedTasks,
      totalTasks,
      status: mission.status,
    });
  }

  /**
   * 记录日志
   */
  private async logMissionEvent(
    missionId: string,
    phase: string,
    action: string,
    details?: unknown,
  ): Promise<void> {
    await this.prisma.codingMissionLog.create({
      data: {
        missionId,
        phase,
        action,
        details: details as Prisma.JsonValue,
      },
    });
  }

  // Helper methods...
  private async getMissionWithRelations(missionId: string) {
    return this.prisma.codingMission.findUnique({
      where: { id: missionId },
      include: {
        leader: true,
        tasks: true,
      },
    });
  }

  private formatTaskBreakdownMessage(breakdown: TaskBreakdown): string {
    let message = `## 任务分解完成\n\n`;
    message += `### 需求理解\n${breakdown.understanding}\n\n`;
    message += `### 子任务列表\n`;
    breakdown.tasks.forEach((task, i) => {
      message += `${i + 1}. **${task.title}** (${task.assigneeType})\n`;
      message += `   ${task.description}\n`;
    });
    message += `\n### 执行计划\n${breakdown.executionPlan}`;
    return message;
  }

  private formatTaskOutput(taskType: TaskType, output: unknown): string {
    // 根据任务类型格式化输出
    return JSON.stringify(output, null, 2).slice(0, 500) + "...";
  }
}
```

### 3.3 CodingAgentService

```typescript
// backend/src/modules/ai/ai-coding/services/coding-agent.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { AiChatService } from "../../ai-core/ai-chat.service";
import { CodingTeamMember, CodingAgentTask, TaskType } from "@prisma/client";
import { TASK_PROMPTS } from "../constants/task-prompts";

interface ExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  aiModel?: string;
  tokensUsed?: number;
  attempt?: number;
}

@Injectable()
export class CodingAgentService {
  private readonly logger = new Logger(CodingAgentService.name);

  constructor(private readonly aiChatService: AiChatService) {}

  /**
   * 验证AI服务可用性
   */
  async validateAIServiceAvailability(): Promise<void> {
    const defaultModel = process.env.DEFAULT_AI_MODEL || "gemini";
    const requiredEnvKey = this.getRequiredApiKey(defaultModel);

    if (!process.env[requiredEnvKey]) {
      throw new Error(`AI服务不可用: 缺少必需的环境变量 ${requiredEnvKey}`);
    }

    // 测试API连通性
    try {
      const testResult = await this.aiChatService.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: defaultModel,
        maxTokens: 10,
      });

      if (
        testResult.content.includes("API Key 未配置") ||
        testResult.content.includes("无法生成回复")
      ) {
        throw new Error(`AI服务响应异常: ${testResult.content}`);
      }
    } catch (error) {
      throw new Error(`AI服务连接测试失败: ${error.message}`);
    }
  }

  /**
   * 生成任务分解
   */
  async generateTaskBreakdown(
    leader: CodingTeamMember,
    requirement: string,
  ): Promise<ExecutionResult> {
    const systemPrompt = `${leader.systemPrompt}

你是开发团队的Leader，负责分析需求并分解为具体的开发任务。

请分析以下需求，并输出JSON格式的任务分解：
{
  "understanding": "对需求的理解",
  "tasks": [
    {
      "title": "任务标题",
      "description": "详细描述",
      "taskType": "PRD|ARCHITECTURE|TASK_BREAKDOWN|CODE|TEST",
      "assigneeType": "PM|ARCHITECT|PM_LEAD|ENGINEER|QA",
      "priority": 0-2,
      "dependencies": ["task_0", "task_1"]
    }
  ],
  "executionPlan": "执行计划说明",
  "risks": ["风险1", "风险2"]
}

任务类型说明：
- PRD: 产品需求文档，由PM完成
- ARCHITECTURE: 系统架构设计，由ARCHITECT完成
- TASK_BREAKDOWN: 详细任务拆分，由PM_LEAD完成
- CODE: 代码实现，由ENGINEER完成
- TEST: 测试用例，由QA完成

依赖关系使用临时ID格式 task_N，N从0开始。`;

    return this.executeWithRetry(
      leader.aiModel,
      systemPrompt,
      requirement,
      "TaskBreakdown",
    );
  }

  /**
   * 执行Agent任务
   */
  async executeTask(
    agent: CodingTeamMember,
    task: CodingAgentTask,
    context: TaskContext,
  ): Promise<ExecutionResult> {
    const taskPrompt = TASK_PROMPTS[task.taskType];

    const systemPrompt = `${agent.systemPrompt}

${taskPrompt.systemPromptAddition}

输出格式要求：
${taskPrompt.outputFormat}

重要：你必须输出有效的JSON格式，不要有其他内容。`;

    const userMessage = this.buildUserMessage(task, context);

    return this.executeWithRetry(
      agent.aiModel,
      systemPrompt,
      userMessage,
      task.taskType,
      task.maxRetries,
    );
  }

  /**
   * 审查任务输出
   */
  async reviewTaskOutput(
    reviewer: CodingTeamMember,
    task: CodingAgentTask,
  ): Promise<{ approved: boolean; feedback: string }> {
    const systemPrompt = `${reviewer.systemPrompt}

你正在审查团队成员提交的任务产出。请评估以下内容：
1. 是否完整满足任务要求
2. 是否有明显的错误或遗漏
3. 质量是否达到标准

请输出JSON格式：
{
  "approved": true/false,
  "feedback": "反馈意见",
  "issues": ["问题1", "问题2"]
}`;

    const userMessage = `
任务标题: ${task.title}
任务描述: ${task.description}
任务类型: ${task.taskType}

提交的产出:
${JSON.stringify(task.output, null, 2)}
`;

    const result = await this.executeWithRetry(
      reviewer.aiModel,
      systemPrompt,
      userMessage,
      "Review",
    );

    if (!result.success) {
      // 默认通过
      return { approved: true, feedback: "审查失败，默认通过" };
    }

    const reviewData = result.data as { approved: boolean; feedback: string };
    return {
      approved: reviewData.approved,
      feedback: reviewData.feedback || "",
    };
  }

  /**
   * 带重试的执行
   */
  private async executeWithRetry(
    model: string,
    systemPrompt: string,
    userMessage: string,
    taskName: string,
    maxRetries = 3,
  ): Promise<ExecutionResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.aiChatService.chat({
          messages: [{ role: "user", content: userMessage }],
          systemPrompt,
          model,
          maxTokens: 4096,
          temperature: 0.7,
        });

        // 检查响应是否包含错误信息
        if (
          response.content.includes("API Key 未配置") ||
          response.content.includes("无法生成回复")
        ) {
          throw new Error("AI响应包含错误信息");
        }

        // 解析JSON输出
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error("无法从响应中提取JSON");
        }

        let output: unknown;
        try {
          output = JSON.parse(jsonMatch[0]);
        } catch {
          throw new Error("JSON解析失败");
        }

        // 验证输出
        const validation = this.validateOutput(taskName, output);
        if (!validation.valid) {
          throw new Error(validation.error);
        }

        return {
          success: true,
          data: output,
          aiModel: model,
          tokensUsed: response.tokensUsed,
          attempt,
        };
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `${taskName} 执行失败 (尝试 ${attempt}/${maxRetries}): ${error.message}`,
        );

        // 指数退避
        if (attempt < maxRetries) {
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }

    return {
      success: false,
      error: `执行失败，已重试${maxRetries}次: ${lastError?.message}`,
    };
  }

  /**
   * 验证输出有效性
   */
  private validateOutput(
    taskType: string,
    output: unknown,
  ): { valid: boolean; error?: string } {
    if (typeof output !== "object" || output === null) {
      return { valid: false, error: "输出必须是对象" };
    }

    // 根据任务类型进行不同的验证
    switch (taskType) {
      case "TaskBreakdown":
        return this.validateTaskBreakdown(output);
      case "PRD":
        return this.validatePRD(output);
      case "ARCHITECTURE":
        return this.validateArchitecture(output);
      case "CODE":
        return this.validateCode(output);
      case "TEST":
        return this.validateTest(output);
      case "Review":
        return this.validateReview(output);
      default:
        return { valid: true };
    }
  }

  private validateTaskBreakdown(output: unknown): {
    valid: boolean;
    error?: string;
  } {
    const data = output as Record<string, unknown>;
    if (!data.understanding || typeof data.understanding !== "string") {
      return { valid: false, error: "缺少需求理解" };
    }
    if (!Array.isArray(data.tasks) || data.tasks.length === 0) {
      return { valid: false, error: "缺少任务列表" };
    }
    return { valid: true };
  }

  private validatePRD(output: unknown): { valid: boolean; error?: string } {
    const data = output as Record<string, unknown>;
    if (!data.overview || (data.overview as string).includes("API Key")) {
      return { valid: false, error: "PRD概述无效" };
    }
    if (
      !Array.isArray(data.functionalRequirements) ||
      data.functionalRequirements.length === 0
    ) {
      return { valid: false, error: "缺少功能需求" };
    }
    return { valid: true };
  }

  private validateArchitecture(output: unknown): {
    valid: boolean;
    error?: string;
  } {
    const data = output as Record<string, unknown>;
    if (!data.architecture || typeof data.architecture !== "string") {
      return { valid: false, error: "缺少架构描述" };
    }
    return { valid: true };
  }

  private validateCode(output: unknown): { valid: boolean; error?: string } {
    const data = output as Record<string, unknown>;
    if (!Array.isArray(data.files) || data.files.length === 0) {
      return { valid: false, error: "缺少代码文件" };
    }
    return { valid: true };
  }

  private validateTest(output: unknown): { valid: boolean; error?: string } {
    const data = output as Record<string, unknown>;
    if (!Array.isArray(data.testCases) || data.testCases.length === 0) {
      return { valid: false, error: "缺少测试用例" };
    }
    return { valid: true };
  }

  private validateReview(output: unknown): { valid: boolean; error?: string } {
    const data = output as Record<string, unknown>;
    if (typeof data.approved !== "boolean") {
      return { valid: false, error: "缺少审查结果" };
    }
    return { valid: true };
  }

  private buildUserMessage(
    task: CodingAgentTask,
    context: TaskContext,
  ): string {
    let message = `## 任务信息\n`;
    message += `- 标题: ${task.title}\n`;
    message += `- 描述: ${task.description}\n\n`;

    message += `## 原始需求\n${context.requirement}\n\n`;

    if (context.taskBreakdown) {
      message += `## 任务规划\n${JSON.stringify(context.taskBreakdown, null, 2)}\n\n`;
    }

    if (Object.keys(context.dependencyOutputs).length > 0) {
      message += `## 前置任务产出\n`;
      for (const [type, output] of Object.entries(context.dependencyOutputs)) {
        message += `### ${type}\n${JSON.stringify(output, null, 2)}\n\n`;
      }
    }

    return message;
  }

  private getRequiredApiKey(model: string): string {
    const keyMap: Record<string, string> = {
      grok: "XAI_API_KEY",
      "gpt-4": "OPENAI_API_KEY",
      "gpt-4o": "OPENAI_API_KEY",
      claude: "ANTHROPIC_API_KEY",
      gemini: "GOOGLE_AI_API_KEY",
    };
    return keyMap[model] || "GOOGLE_AI_API_KEY";
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

interface TaskContext {
  requirement: string;
  taskBreakdown: unknown;
  dependencyOutputs: Record<string, unknown>;
}
```

---

## 4. WebSocket事件设计

### 4.1 事件列表

| 事件名              | 方向          | 数据结构                          | 说明           |
| ------------------- | ------------- | --------------------------------- | -------------- |
| `team:initialized`  | Server→Client | `{members: Agent[]}`              | 团队初始化完成 |
| `team:message`      | Server→Client | `{id, senderId, content, ...}`    | 团队消息       |
| `agent:status`      | Server→Client | `{agentId, status, currentTask}`  | Agent状态变更  |
| `agent:typing`      | Server→Client | `{agentId, isTyping}`             | Agent正在输入  |
| `task:update`       | Server→Client | `{taskId, status, progress}`      | 任务状态更新   |
| `progress:update`   | Server→Client | `{progress, completedTasks, ...}` | 整体进度更新   |
| `mission:completed` | Server→Client | `{missionId, finalResult}`        | 任务完成       |
| `mission:failed`    | Server→Client | `{missionId, error}`              | 任务失败       |

### 4.2 Gateway实现

```typescript
// backend/src/modules/ai/ai-coding/ai-coding.gateway.ts

@WebSocketGateway({
  namespace: "/ai-coding",
  cors: { origin: "*" },
})
export class AiCodingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AiCodingGateway.name);

  afterInit() {
    this.logger.log("AI Coding WebSocket Gateway initialized");
  }

  async handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage("project:join")
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    const roomName = `project:${data.projectId}`;
    await client.join(roomName);
    this.logger.log(`Client ${client.id} joined room ${roomName}`);
    return { success: true };
  }

  @SubscribeMessage("project:leave")
  async handleLeaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ) {
    const roomName = `project:${data.projectId}`;
    await client.leave(roomName);
    this.logger.log(`Client ${client.id} left room ${roomName}`);
    return { success: true };
  }

  /**
   * 向项目房间广播事件
   */
  emitToProject(projectId: string, event: string, data: unknown): void {
    const roomName = `project:${projectId}`;
    this.server.to(roomName).emit(event, data);
  }
}
```

---

## 5. 前端实现

### 5.1 Hook改进

```typescript
// frontend/hooks/useAiCodingSocket.ts

import { useEffect, useState, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";

interface TeamMessage {
  id: string;
  senderId: string | null;
  senderName: string;
  senderType: string;
  content: string;
  messageType: string;
  createdAt: Date;
}

interface AgentStatus {
  agentId: string;
  agentType: string;
  status: "IDLE" | "WORKING" | "WAITING" | "COMPLETED" | "FAILED";
  currentTask?: string;
}

interface ProgressUpdate {
  progress: number;
  completedTasks: number;
  totalTasks: number;
  status: string;
}

export function useAiCodingSocket(projectId: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<
    Record<string, AgentStatus>
  >({});
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [typingAgents, setTypingAgents] = useState<Set<string>>(new Set());

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(`${process.env.NEXT_PUBLIC_API_URL}/ai-coding`, {
      transports: ["websocket"],
      withCredentials: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      socket.emit("project:join", { projectId });
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    // 团队消息
    socket.on("team:message", (message: TeamMessage) => {
      setMessages((prev) => [...prev, message]);
    });

    // Agent状态
    socket.on("agent:status", (status: AgentStatus) => {
      setAgentStatuses((prev) => ({
        ...prev,
        [status.agentId]: status,
      }));
    });

    // Agent输入状态
    socket.on(
      "agent:typing",
      ({ agentId, isTyping }: { agentId: string; isTyping: boolean }) => {
        setTypingAgents((prev) => {
          const next = new Set(prev);
          if (isTyping) {
            next.add(agentId);
          } else {
            next.delete(agentId);
          }
          return next;
        });
      },
    );

    // 进度更新
    socket.on("progress:update", (update: ProgressUpdate) => {
      setProgress(update);
    });

    // 任务完成
    socket.on("mission:completed", ({ finalResult }) => {
      console.log("Mission completed:", finalResult);
    });

    // 任务失败
    socket.on("mission:failed", ({ error }) => {
      console.error("Mission failed:", error);
    });

    return () => {
      socket.emit("project:leave", { projectId });
      socket.disconnect();
    };
  }, [projectId]);

  return {
    isConnected,
    messages,
    agentStatuses,
    progress,
    typingAgents: Array.from(typingAgents),
  };
}
```

---

## 6. 实现优先级

### Phase 1: 紧急修复（1-2天）

1. **修改 ai-chat.service.ts**
   - API密钥缺失时抛出异常而非返回错误文本
   - 添加输出有效性基本检查

2. **修改 ai-coding.service.ts**
   - 启动前验证API可用性
   - 添加异常处理和失败状态

### Phase 2: 数据库和基础服务（2-3天）

1. 添加新的Prisma模型
2. 实现 CodingTeamService
3. 实现 CodingMissionService
4. 实现 CodingAgentService

### Phase 3: 任务执行（2-3天）

1. 实现任务分解逻辑
2. 实现依赖调度
3. 实现审查和反馈循环

### Phase 4: 前端集成（2天）

1. 改进 useAiCodingSocket
2. 添加团队对话面板
3. 改进Agent状态显示

---

## 7. 测试计划

### 7.1 单元测试

- CodingAgentService.validateOutput()
- CodingAgentService.executeWithRetry()
- CodingMissionService.createTasksFromBreakdown()

### 7.2 集成测试

- 完整的Mission执行流程
- WebSocket事件广播
- 错误恢复和重试

### 7.3 端到端测试

- 创建项目并启动执行
- 验证所有Agent都真正调用AI
- 验证产出文件内容有效

---

**文档版本历史**

| 版本 | 日期       | 作者         | 变更说明 |
| ---- | ---------- | ------------ | -------- |
| 1.0  | 2025-12-21 | AI Architect | 初始版本 |
