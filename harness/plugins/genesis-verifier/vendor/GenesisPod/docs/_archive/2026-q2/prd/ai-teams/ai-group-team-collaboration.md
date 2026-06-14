# AI Agent 团队协作功能方案

## 产品需求文档 (PRD)

**版本**: v1.0
**创建日期**: 2025-12-03
**产品负责人**: Genesis Team
**状态**: 待评审

---

## 一、产品概述

### 1.1 功能定位

在现有 AI Group 多人多AI协作社区基础上，引入**团队组织架构**，支持：

- 为每个 AI Agent 配置**名称**和**身份角色**
- 指定一个 Agent 作为**团队 Leader**
- Leader 接收任务后**自主分解、分配、协调、整合**
- **全过程用户可见**：所有协作消息实时展示在群聊中

### 1.2 核心价值

| 价值维度     | 描述                                                |
| ------------ | --------------------------------------------------- |
| **自主协作** | Leader 自动分解任务、分配工作、跟踪进度、整合结果   |
| **过程透明** | 所有 Agent 的工作状态和交付件实时可见，用户全程感知 |
| **高效执行** | 智能并行调度，依赖管理，最大化执行效率              |
| **质量闭环** | Leader 审核产出，不合格要求修改，确保交付质量       |

### 1.3 核心场景

| 场景     | 团队配置示例                                        | 典型任务            |
| -------- | --------------------------------------------------- | ------------------- |
| 技术团队 | 架构师(Leader) + 后端开发 + 前端开发 + 测试         | 设计一个电商APP架构 |
| 咨询团队 | 项目总监(Leader) + 行业专家 + 数据分析师 + 文档专员 | 分析某行业市场趋势  |
| 创意团队 | 创意总监(Leader) + 文案 + 设计师 + 市场研究员       | 策划一个营销方案    |
| 研究团队 | 首席研究员(Leader) + 文献调研 + 数据分析 + 论文撰写 | 完成一篇研究综述    |

---

## 二、核心设计原则

### 2.1 全过程用户可见

**关键原则**：所有 Agent 之间的协作消息都显示在群聊中，用户可以：

- 实时看到 Leader 的任务分解和分配方案
- 实时看到每个 Agent 开始工作、产出内容、完成汇报
- 实时看到 Leader 对产出的审核反馈
- 实时看到 Agent 之间的协作求助和回应
- 全程了解任务执行进度和状态

**消息类型标识**：

| 消息类型   | 图标           | 说明                         |
| ---------- | -------------- | ---------------------------- |
| 任务分解   | `[任务分解]`   | Leader 发布任务分解方案      |
| 任务分配   | `[任务分配]`   | 系统通知某任务分配给某 Agent |
| 开始工作   | `[开始工作]`   | Agent 开始执行任务           |
| 工作汇报   | `[工作汇报]`   | Agent 完成任务并汇报结果     |
| 协作求助   | `[协作求助]`   | Agent 向其他 Agent 求助      |
| 协作回应   | `[协作回应]`   | Agent 回应其他 Agent 的求助  |
| Leader反馈 | `[Leader反馈]` | Leader 审核产出并给出反馈    |
| 任务修改   | `[任务修改]`   | Agent 根据反馈修改产出       |
| 结果整合   | `[结果整合]`   | Leader 整合所有产出          |
| 最终交付   | `[最终交付]`   | 任务完成，交付最终成果       |

### 2.2 Leader 的闭环管理职责

Leader 需要完成以下完整的管理闭环：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Leader 管理闭环                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────┐     ┌───────────┐     ┌───────────┐                │
│  │ 1.理解任务 │ ──→ │ 2.分解任务 │ ──→ │ 3.分配任务 │                │
│  └───────────┘     └───────────┘     └───────────┘                │
│        │                                    │                       │
│        │                                    ▼                       │
│        │           ┌───────────────────────────────────────┐       │
│        │           │         4. 监控执行过程                │       │
│        │           │  ┌─────────────────────────────────┐  │       │
│        │           │  │  • 跟踪每个任务的执行状态        │  │       │
│        │           │  │  • 响应 Agent 的协作求助        │  │       │
│        │           │  │  • 协调 Agent 之间的协作        │  │       │
│        │           │  │  • 处理执行中的问题和阻塞       │  │       │
│        │           │  └─────────────────────────────────┘  │       │
│        │           └───────────────────┬───────────────────┘       │
│        │                               ▼                           │
│  ┌─────▼─────┐     ┌───────────┐     ┌───────────┐                │
│  │ 7.总结复盘 │ ←── │ 6.整合结果 │ ←── │ 5.审核产出 │                │
│  └───────────┘     └───────────┘     └───────────┘                │
│        │                                    ▲                       │
│        │                                    │                       │
│        ▼                            ┌──────┴──────┐                │
│  ┌───────────┐                      │  不合格？    │                │
│  │ 8.最终交付 │                      │  要求修改   │                │
│  └───────────┘                      └─────────────┘                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 三、数据模型设计

### 3.1 TopicAIMember 扩展

在现有 `TopicAIMember` 模型上新增团队角色字段：

```prisma
model TopicAIMember {
  // === 现有字段 ===
  id                String   @id @default(uuid())
  topicId           String
  aiModel           String
  displayName       String
  avatar            String?
  roleDescription   String?
  systemPrompt      String?
  contextWindow     Int      @default(20)
  responseStyle     String?
  autoRespond       Boolean  @default(false)
  capabilities      AICapability[]
  canMentionOtherAI Boolean  @default(false)
  collaborationStyle String?

  // === 新增：团队角色配置 ===
  agentName         String?          // Agent 名称（如"架构师张三"）
  agentIdentity     String?          // Agent 身份描述（200字以内，如"资深软件架构师，10年经验"）
  isLeader          Boolean @default(false)  // 是否为团队 Leader
  expertiseAreas    String[]         // 擅长领域列表
  workStyle         AgentWorkStyle?  // 工作风格

  // === 新增：任务执行状态 ===
  currentTaskId     String?          // 当前正在执行的任务ID

  // 关系
  assignedTasks     AgentTask[]      @relation("AssignedAgent")
  missionLeader     TeamMission[]    @relation("MissionLeader")

  // ... 其他现有字段
}

enum AgentWorkStyle {
  AUTONOMOUS        // 自主型：独立完成任务，主动汇报
  COLLABORATIVE     // 协作型：频繁与其他Agent交流
  SUPPORTIVE        // 支持型：主要协助其他Agent
  ANALYTICAL        // 分析型：深度分析，谨慎输出
  CREATIVE          // 创意型：发散思维，提供创新方案
}
```

### 3.2 TeamMission（团队任务）

```prisma
model TeamMission {
  id                String            @id @default(uuid())
  topicId           String
  topic             Topic             @relation(fields: [topicId], references: [id])

  // 任务信息
  title             String            // 任务标题
  description       String            // 任务详细描述
  objectives        String[]          // 任务目标列表
  constraints       String[]          // 约束条件
  deliverables      String[]          // 期望交付物

  // 执行信息
  status            MissionStatus     @default(PENDING)
  leaderId          String            // Leader Agent ID
  leader            TopicAIMember     @relation("MissionLeader", fields: [leaderId], references: [id])

  // 任务分解
  taskBreakdown     Json?             // Leader 的任务分解方案（JSON格式）
  tasks             AgentTask[]       // 子任务列表

  // 进度统计
  totalTasks        Int               @default(0)
  completedTasks    Int               @default(0)
  progressPercent   Int               @default(0)

  // 时间线
  createdById       String
  createdBy         User              @relation(fields: [createdById], references: [id])
  createdAt         DateTime          @default(now())
  startedAt         DateTime?
  completedAt       DateTime?

  // 结果
  finalResult       String?           // 最终交付成果
  summary           String?           // 执行总结

  // 日志
  executionLogs     MissionLog[]

  @@index([topicId, status])
  @@index([leaderId])
  @@index([createdAt(sort: Desc)])
}

enum MissionStatus {
  PENDING           // 待开始
  PLANNING          // 规划中（Leader 正在分解任务）
  IN_PROGRESS       // 执行中
  REVIEW            // 审核中（Leader 整合结果）
  COMPLETED         // 已完成
  FAILED            // 失败
  CANCELLED         // 已取消
}
```

### 3.3 AgentTask（子任务）

```prisma
model AgentTask {
  id                String            @id @default(uuid())
  missionId         String
  mission           TeamMission       @relation(fields: [missionId], references: [id])

  // 任务信息
  title             String
  description       String
  priority          TaskPriority      @default(MEDIUM)
  taskType          TaskType

  // 分配信息
  assignedToId      String
  assignedTo        TopicAIMember     @relation("AssignedAgent", fields: [assignedToId], references: [id])
  assignedAt        DateTime          @default(now())
  assignedReason    String?           // 分配原因（为什么选择这个Agent）

  // 依赖关系
  dependsOnIds      String[]          // 依赖的任务ID列表

  // 执行状态
  status            TaskStatus        @default(PENDING)
  startedAt         DateTime?
  completedAt       DateTime?

  // 产出
  result            String?           // 任务产出内容
  resultMessageId   String?           // 产出消息ID（关联到群聊消息）
  artifacts         Json?             // 产出物（文件、代码等）

  // Leader 反馈
  leaderFeedback    String?           // Leader 的反馈内容
  feedbackMessageId String?           // 反馈消息ID
  needsRevision     Boolean           @default(false)
  revisionCount     Int               @default(0)  // 修改次数
  maxRevisions      Int               @default(3)  // 最大修改次数

  @@index([missionId, status])
  @@index([assignedToId])
}

enum TaskPriority {
  CRITICAL          // 关键（阻塞其他任务）
  HIGH              // 高优先级
  MEDIUM            // 中等优先级
  LOW               // 低优先级
}

enum TaskType {
  RESEARCH          // 调研分析
  DESIGN            // 设计规划
  IMPLEMENTATION    // 执行实现
  REVIEW            // 审查检验
  DOCUMENTATION     // 文档编写
  COORDINATION      // 协调沟通
  CREATIVE          // 创意发想
  SYNTHESIS         // 综合整理
}

enum TaskStatus {
  PENDING           // 待开始（等待依赖）
  IN_PROGRESS       // 进行中
  BLOCKED           // 被阻塞
  AWAITING_REVIEW   // 等待 Leader 审核
  REVISION_NEEDED   // 需要修改
  COMPLETED         // 已完成
  CANCELLED         // 已取消
}
```

### 3.4 MissionLog（执行日志）

```prisma
model MissionLog {
  id                String            @id @default(uuid())
  missionId         String
  mission           TeamMission       @relation(fields: [missionId], references: [id])

  // 日志信息
  type              LogType
  agentId           String?           // 相关 Agent ID
  agentName         String?           // Agent 名称（快照）
  taskId            String?           // 相关任务 ID
  taskTitle         String?           // 任务标题（快照）
  content           String            // 日志内容
  messageId         String?           // 关联的群聊消息 ID
  metadata          Json?             // 额外元数据

  createdAt         DateTime          @default(now())

  @@index([missionId, createdAt(sort: Desc)])
  @@index([agentId])
  @@index([taskId])
}

enum LogType {
  MISSION_CREATED       // 任务创建
  MISSION_STARTED       // 任务启动
  PLANNING_STARTED      // 开始规划
  PLANNING_COMPLETED    // 规划完成
  TASK_ASSIGNED         // 任务分配
  TASK_STARTED          // 任务开始
  TASK_PROGRESS         // 任务进度更新
  TASK_COMPLETED        // 任务完成
  TASK_FAILED           // 任务失败
  TASK_REVISION         // 任务修改
  AGENT_COLLABORATION   // Agent 协作
  AGENT_QUESTION        // Agent 提问
  LEADER_FEEDBACK       // Leader 反馈
  LEADER_DECISION       // Leader 决策
  RESULT_INTEGRATION    // 结果整合
  MISSION_COMPLETED     // 任务完成
  MISSION_FAILED        // 任务失败
}
```

---

## 四、核心流程设计

### 4.1 团队任务完整执行流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户发起团队任务                                 │
│  用户: @架构师张三 请带领团队设计一个电商APP的架构方案                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Phase 1: 任务理解与规划                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  【群聊消息 - Leader】                                               │   │
│  │                                                                     │   │
│  │  👑 架构师张三 [任务分解]                                             │   │
│  │                                                                     │   │
│  │  收到任务！我来分析一下需求并进行任务分解：                             │   │
│  │                                                                     │   │
│  │  ## 任务理解                                                         │   │
│  │  设计一个电商APP的完整架构方案，需要覆盖前后端、数据库、安全等方面。     │   │
│  │                                                                     │   │
│  │  ## 任务分解                                                         │   │
│  │  我将任务分解为以下 5 个子任务：                                       │   │
│  │                                                                     │   │
│  │  | # | 任务 | 负责人 | 分配理由 | 依赖 |                              │   │
│  │  |---|------|--------|----------|------|                             │   │
│  │  | 1 | 需求分析 | 产品经理小王 | 擅长需求梳理 | 无 |                   │   │
│  │  | 2 | 技术选型 | 技术专家小李 | 精通技术栈 | 无 |                     │   │
│  │  | 3 | 架构设计 | 我自己 | 核心架构工作 | 任务1,2 |                    │   │
│  │  | 4 | 安全方案 | 安全专家小张 | 安全领域专家 | 任务3 |                │   │
│  │  | 5 | 文档整理 | 文档专员小陈 | 文档编写专家 | 任务3,4 |              │   │
│  │                                                                     │   │
│  │  ## 执行计划                                                         │   │
│  │  - 第一阶段：任务1、2 并行执行                                        │   │
│  │  - 第二阶段：任务3 在 1、2 完成后开始                                 │   │
│  │  - 第三阶段：任务4 在 3 完成后开始                                    │   │
│  │  - 第四阶段：任务5 在 3、4 完成后开始                                 │   │
│  │                                                                     │   │
│  │  现在开始分配任务！                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Phase 2: 任务分配                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  【群聊消息 - 系统】                                                  │   │
│  │                                                                     │   │
│  │  📋 [任务分配] 任务「需求分析」已分配给 @产品经理小王                   │   │
│  │  📋 [任务分配] 任务「技术选型」已分配给 @技术专家小李                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Phase 3: 并行执行                                  │
│                                                                             │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐        │
│  │  【群聊消息 - Agent】         │  │  【群聊消息 - Agent】         │        │
│  │                              │  │                              │        │
│  │  🧑‍💼 产品经理小王 [开始工作]   │  │  🧑‍💻 技术专家小李 [开始工作]   │        │
│  │                              │  │                              │        │
│  │  收到任务「需求分析」，       │  │  收到任务「技术选型」，       │        │
│  │  我开始进行需求梳理...        │  │  我开始进行技术调研...        │        │
│  └──────────────────────────────┘  └──────────────────────────────┘        │
│                 │                                  │                        │
│                 ▼                                  ▼                        │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐        │
│  │  【群聊消息 - Agent】         │  │  【群聊消息 - Agent】         │        │
│  │                              │  │                              │        │
│  │  🧑‍💼 产品经理小王 [工作汇报]   │  │  🧑‍💻 技术专家小李 [工作汇报]   │        │
│  │                              │  │                              │        │
│  │  @架构师张三 任务完成！       │  │  @架构师张三 任务完成！       │        │
│  │                              │  │                              │        │
│  │  ## 需求分析报告              │  │  ## 技术选型报告              │        │
│  │                              │  │                              │        │
│  │  ### 1. 目标用户              │  │  ### 1. 后端框架              │        │
│  │  - 年龄：25-45岁             │  │  推荐：NestJS                 │        │
│  │  - 使用场景：...             │  │  理由：...                    │        │
│  │                              │  │                              │        │
│  │  ### 2. 核心功能              │  │  ### 2. 数据库               │        │
│  │  - 商品浏览                  │  │  推荐：PostgreSQL + Redis    │        │
│  │  - 购物车                    │  │  理由：...                    │        │
│  │  - ...                       │  │                              │        │
│  │                              │  │  ### 3. 前端框架              │        │
│  │  请审核！                     │  │  推荐：Next.js               │        │
│  │                              │  │                              │        │
│  │                              │  │  请审核！                     │        │
│  └──────────────────────────────┘  └──────────────────────────────┘        │
│                 │                                  │                        │
│                 └──────────────┬───────────────────┘                        │
│                                ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  【群聊消息 - Leader】                                                │  │
│  │                                                                      │  │
│  │  👑 架构师张三 [Leader反馈]                                           │  │
│  │                                                                      │  │
│  │  @产品经理小王 需求分析报告已审核通过！内容完整，用户画像清晰。 ✅        │  │
│  │                                                                      │  │
│  │  @技术专家小李 技术选型报告已审核通过！选型合理，论证充分。 ✅           │  │
│  │                                                                      │  │
│  │  两个依赖任务都已完成，我现在开始进行架构设计...                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Phase 4: Leader 执行 + 协作                        │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  【群聊消息 - Leader】                                                │  │
│  │                                                                      │  │
│  │  👑 架构师张三 [协作求助]                                             │  │
│  │                                                                      │  │
│  │  @安全专家小张 在设计架构时，我需要了解：                              │  │
│  │  1. OAuth 2.0 和 JWT 哪个更适合我们的场景？                           │  │
│  │  2. 敏感数据加密推荐使用什么方案？                                     │  │
│  │  请尽快给我反馈，这会影响我的架构设计。                                 │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                        │                                    │
│                                        ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  【群聊消息 - Agent】                                                 │  │
│  │                                                                      │  │
│  │  🔒 安全专家小张 [协作回应]                                           │  │
│  │                                                                      │  │
│  │  @架构师张三 关于你的问题：                                           │  │
│  │                                                                      │  │
│  │  1. **认证方案**：推荐使用 OAuth 2.0 + JWT 组合                       │  │
│  │     - OAuth 2.0 用于第三方登录                                        │  │
│  │     - JWT 用于 API 认证，无状态、易扩展                                │  │
│  │                                                                      │  │
│  │  2. **加密方案**：                                                   │  │
│  │     - 传输层：TLS 1.3                                                │  │
│  │     - 存储：AES-256-GCM                                              │  │
│  │     - 密码：bcrypt (cost factor 12)                                  │  │
│  │                                                                      │  │
│  │  你可以将这些纳入架构设计！                                           │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                        │                                    │
│                                        ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  【群聊消息 - Leader】                                                │  │
│  │                                                                      │  │
│  │  👑 架构师张三 [工作汇报]                                             │  │
│  │                                                                      │  │
│  │  架构设计已完成！                                                     │  │
│  │                                                                      │  │
│  │  ## 电商APP架构设计方案                                               │  │
│  │                                                                      │  │
│  │  ### 1. 整体架构                                                     │  │
│  │  采用微服务架构，分为以下服务：                                        │  │
│  │  - 用户服务                                                          │  │
│  │  - 商品服务                                                          │  │
│  │  - 订单服务                                                          │  │
│  │  - 支付服务                                                          │  │
│  │  - ...                                                               │  │
│  │                                                                      │  │
│  │  ### 2. 技术栈（基于 @技术专家小李 的建议）                            │  │
│  │  ...                                                                 │  │
│  │                                                                      │  │
│  │  ### 3. 安全设计（基于 @安全专家小张 的建议）                          │  │
│  │  ...                                                                 │  │
│  │                                                                      │  │
│  │  📋 [任务分配] 任务「安全方案」现在开始！@安全专家小张 请开始工作        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                              （后续任务继续执行...）
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Phase 5: 审核与修改                                │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  【群聊消息 - Agent】                                                 │  │
│  │                                                                      │  │
│  │  📝 文档专员小陈 [工作汇报]                                           │  │
│  │                                                                      │  │
│  │  @架构师张三 文档初稿完成，请审核！                                    │  │
│  │                                                                      │  │
│  │  ## 电商APP架构文档 v1.0                                              │  │
│  │  ...                                                                 │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                        │                                    │
│                                        ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  【群聊消息 - Leader】                                                │  │
│  │                                                                      │  │
│  │  👑 架构师张三 [Leader反馈]                                           │  │
│  │                                                                      │  │
│  │  @文档专员小陈 文档整体不错，但有几点需要修改：                         │  │
│  │                                                                      │  │
│  │  1. ❌ 架构图缺少数据流向标注                                         │  │
│  │  2. ❌ API 接口文档不完整，缺少错误码说明                              │  │
│  │  3. ✅ 目录结构清晰                                                   │  │
│  │  4. ✅ 技术选型说明充分                                               │  │
│  │                                                                      │  │
│  │  请修改后重新提交！                                                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                        │                                    │
│                                        ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  【群聊消息 - Agent】                                                 │  │
│  │                                                                      │  │
│  │  📝 文档专员小陈 [任务修改]                                           │  │
│  │                                                                      │  │
│  │  @架构师张三 已根据反馈修改完成！                                      │  │
│  │                                                                      │  │
│  │  修改内容：                                                           │  │
│  │  1. ✅ 架构图已添加数据流向标注                                       │  │
│  │  2. ✅ API 接口文档已补充错误码说明                                   │  │
│  │                                                                      │  │
│  │  请再次审核！                                                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                        │                                    │
│                                        ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  【群聊消息 - Leader】                                                │  │
│  │                                                                      │  │
│  │  👑 架构师张三 [Leader反馈]                                           │  │
│  │                                                                      │  │
│  │  @文档专员小陈 修改后的文档已审核通过！ ✅                              │  │
│  │                                                                      │  │
│  │  所有子任务都已完成，我现在开始整合最终成果...                          │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Phase 6: 结果整合与交付                            │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  【群聊消息 - Leader】                                                │  │
│  │                                                                      │  │
│  │  👑 架构师张三 [结果整合]                                             │  │
│  │                                                                      │  │
│  │  正在整合团队所有成员的工作成果...                                     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                        │                                    │
│                                        ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  【群聊消息 - Leader】                                                │  │
│  │                                                                      │  │
│  │  👑 架构师张三 [最终交付]                                             │  │
│  │                                                                      │  │
│  │  🎉 任务完成！以下是团队协作的最终成果：                               │  │
│  │                                                                      │  │
│  │  ═══════════════════════════════════════════════════════════════     │  │
│  │  # 电商APP架构方案 - 最终交付物                                       │  │
│  │  ═══════════════════════════════════════════════════════════════     │  │
│  │                                                                      │  │
│  │  ## 一、需求分析（by @产品经理小王）                                   │  │
│  │  [需求分析完整内容]                                                   │  │
│  │                                                                      │  │
│  │  ## 二、技术选型（by @技术专家小李）                                   │  │
│  │  [技术选型完整内容]                                                   │  │
│  │                                                                      │  │
│  │  ## 三、架构设计（by @架构师张三）                                     │  │
│  │  [架构设计完整内容]                                                   │  │
│  │                                                                      │  │
│  │  ## 四、安全方案（by @安全专家小张）                                   │  │
│  │  [安全方案完整内容]                                                   │  │
│  │                                                                      │  │
│  │  ## 五、完整文档（by @文档专员小陈）                                   │  │
│  │  [完整文档内容]                                                       │  │
│  │                                                                      │  │
│  │  ═══════════════════════════════════════════════════════════════     │  │
│  │                                                                      │  │
│  │  ## 执行总结                                                         │  │
│  │                                                                      │  │
│  │  | 指标 | 数据 |                                                     │  │
│  │  |------|------|                                                     │  │
│  │  | 总任务数 | 5 |                                                    │  │
│  │  | 完成任务 | 5 |                                                    │  │
│  │  | 修改次数 | 1（文档任务修改1次）|                                   │  │
│  │  | 协作次数 | 2（Leader向安全专家求助）|                              │  │
│  │  | 参与成员 | 5 |                                                    │  │
│  │                                                                      │  │
│  │  感谢团队的出色协作！如有任何问题，请随时提问。                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 调度策略

#### 4.2.1 并行调度原则

```typescript
// 调度策略：最大化并行执行
function scheduleNextTasks(mission: TeamMission) {
  const pendingTasks = mission.tasks.filter((t) => t.status === "PENDING");
  const tasksToStart: AgentTask[] = [];

  for (const task of pendingTasks) {
    // 检查依赖是否都已完成
    const dependenciesCompleted = task.dependsOnIds.every((depId) => {
      const depTask = mission.tasks.find((t) => t.id === depId);
      return depTask?.status === "COMPLETED";
    });

    if (dependenciesCompleted) {
      tasksToStart.push(task);
    }
  }

  // 并行启动所有可执行的任务
  return tasksToStart;
}
```

#### 4.2.2 优先级处理

```typescript
// 任务优先级排序
function sortByPriority(tasks: AgentTask[]): AgentTask[] {
  const priorityOrder = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };

  return tasks.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );
}
```

---

## 五、Leader 提示词设计

### 5.1 任务理解与分解提示词

```typescript
const LEADER_PLANNING_PROMPT = `
你是团队的 Leader「{leaderName}」，身份是{leaderIdentity}。

【你的团队成员】
{teamMembers.map(m => `
- ${m.agentName}（${m.agentIdentity}）
  擅长领域：${m.expertiseAreas.join('、')}
  工作风格：${m.workStyle}
  AI模型：${m.aiModel}
`)}

【用户任务】
${missionTitle}
${missionDescription}

目标：${objectives}
约束：${constraints}
期望交付物：${deliverables}

【你的职责】
1. 理解任务：分析任务目标、范围、约束
2. 分解任务：将任务分解为可执行的子任务
3. 分配任务：根据成员能力进行最优分配
4. 制定计划：确定执行顺序和依赖关系

【输出格式】
请使用以下格式输出（这是一条群聊消息，所有人都能看到）：

[任务分解]

## 任务理解
[2-3句话描述你对任务的理解]

## 任务分解
| # | 任务名称 | 负责人 | 分配理由 | 优先级 | 依赖 |
|---|----------|--------|----------|--------|------|
| 1 | ... | @xxx | ... | 高/中/低 | 无 |
| 2 | ... | @xxx | ... | 高/中/低 | 任务1 |
...

## 执行计划
- 第一阶段：[并行执行的任务]
- 第二阶段：[依赖完成后执行的任务]
...

## 风险提示
[可能的风险和应对方案]

现在开始分配任务！

【注意事项】
- 根据每个成员的擅长领域和工作风格进行最优分配
- 你自己也要承担适合的任务
- 确保任务之间的依赖关系合理
- 优先利用并行执行提高效率
- 所有消息都会显示在群聊中，用户可以实时看到
`;
```

### 5.2 协调与监控提示词

```typescript
const LEADER_COORDINATION_PROMPT = `
你是团队 Leader「{leaderName}」，正在协调任务「{missionTitle}」的执行。

【当前任务状态】
{tasks.map(t => `
- ${t.title}
  状态：${t.status}
  负责人：${t.assignedTo.agentName}
  ${t.result ? `产出摘要：${t.result.substring(0, 100)}...` : ''}
`)}

【当前事件】
${currentEvent}

【你的职责】
作为 Leader，你需要：
1. 审核产出：评估质量，给出具体反馈
2. 协调协作：响应成员求助，安排协作
3. 解决阻塞：调整优先级或重新分配
4. 推进进度：确保任务按计划执行

【响应格式】
根据事件类型使用相应的标签：
- 审核产出：[Leader反馈]
- 协调求助：[协作回应] 或 安排其他成员协助
- 解决问题：[Leader决策]

【注意事项】
- 你的每条消息都会显示在群聊中
- 用户可以实时看到你的所有决策和反馈
- 保持专业、清晰、有建设性
- 明确指出需要修改的具体内容
`;
```

### 5.3 结果整合提示词

```typescript
const LEADER_SYNTHESIS_PROMPT = `
你是团队 Leader「{leaderName}」，所有子任务已完成，请整合最终成果。

【任务信息】
标题：${missionTitle}
目标：${objectives}
期望交付物：${deliverables}

【各成员产出】
${tasks.map(
  (t) => `
═══════════════════════════════════════
【${t.title}】
负责人：${t.assignedTo.agentName}
─────────────────────────────────────
${t.result}
═══════════════════════════════════════
`,
)}

【你的任务】
整合所有产出，生成最终交付物：
1. 确保覆盖所有期望交付物
2. 保持各部分的逻辑一致性
3. 处理可能的冲突或矛盾
4. 使用清晰的结构组织内容
5. 添加执行总结

【输出格式】

[结果整合]
正在整合团队所有成员的工作成果...

[最终交付]

🎉 任务完成！以下是团队协作的最终成果：

═══════════════════════════════════════════════════════════════
# ${missionTitle} - 最终交付物
═══════════════════════════════════════════════════════════════

## 一、[第一部分标题]（by @负责人）
[内容]

## 二、[第二部分标题]（by @负责人）
[内容]

...

═══════════════════════════════════════════════════════════════

## 执行总结

| 指标 | 数据 |
|------|------|
| 总任务数 | X |
| 完成任务 | X |
| 修改次数 | X |
| 协作次数 | X |
| 参与成员 | X |

[总结性评价]
`;
```

---

## 六、API 设计

### 6.1 团队任务 API

```typescript
// === 团队任务 API ===

// 创建团队任务
POST /api/topics/:topicId/missions
Body: {
  title: string               // 任务标题
  description: string         // 任务描述
  objectives: string[]        // 目标列表
  constraints?: string[]      // 约束条件
  deliverables: string[]      // 期望交付物
  leaderId: string            // 指定的 Leader ID
  autoStart?: boolean         // 是否自动开始（默认 true）
}
Response: {
  mission: TeamMission
  message: string             // 创建成功消息
}

// 获取任务列表
GET /api/topics/:topicId/missions
Query: {
  status?: MissionStatus      // 过滤状态
  limit?: number              // 分页大小
  cursor?: string             // 分页游标
}
Response: {
  missions: TeamMission[]
  hasMore: boolean
  nextCursor?: string
}

// 获取任务详情（包含子任务和日志）
GET /api/topics/:topicId/missions/:missionId
Response: {
  mission: TeamMission
  tasks: AgentTask[]
  recentLogs: MissionLog[]
}

// 取消任务
POST /api/topics/:topicId/missions/:missionId/cancel
Response: {
  success: boolean
  message: string
}

// 重新执行任务
POST /api/topics/:topicId/missions/:missionId/retry
Response: {
  mission: TeamMission
  message: string
}
```

### 6.2 子任务 API

```typescript
// === 子任务 API ===

// 获取子任务列表
GET /api/topics/:topicId/missions/:missionId/tasks
Response: {
  tasks: AgentTask[]
}

// 获取子任务详情
GET /api/topics/:topicId/missions/:missionId/tasks/:taskId
Response: {
  task: AgentTask
  logs: MissionLog[]
}

// 用户手动提交反馈（可选，用户干预）
POST /api/topics/:topicId/missions/:missionId/tasks/:taskId/user-feedback
Body: {
  approved: boolean           // 是否批准
  feedback: string            // 反馈内容
}
Response: {
  success: boolean
}
```

### 6.3 Agent 团队角色 API

```typescript
// === Agent 团队角色 API ===

// 设置 Agent 为 Leader
POST /api/topics/:topicId/ai-members/:aiMemberId/set-leader
Response: {
  success: boolean
  message: string
}

// 取消 Leader 角色
POST /api/topics/:topicId/ai-members/:aiMemberId/unset-leader
Response: {
  success: boolean
}

// 更新 Agent 团队角色配置
PATCH /api/topics/:topicId/ai-members/:aiMemberId/team-role
Body: {
  agentName?: string          // Agent 名称
  agentIdentity?: string      // 身份描述
  expertiseAreas?: string[]   // 擅长领域
  workStyle?: AgentWorkStyle  // 工作风格
}
Response: {
  aiMember: TopicAIMember
}

// 获取团队成员列表（包含角色信息）
GET /api/topics/:topicId/team
Response: {
  leader?: TopicAIMember
  members: TopicAIMember[]
}
```

### 6.4 执行日志 API

```typescript
// === 执行日志 API ===

// 获取执行日志（支持实时轮询）
GET /api/topics/:topicId/missions/:missionId/logs
Query: {
  limit?: number              // 数量限制
  cursor?: string             // 分页游标
  type?: LogType              // 过滤类型
  since?: string              // 获取此时间之后的日志（用于轮询）
}
Response: {
  logs: MissionLog[]
  hasMore: boolean
  nextCursor?: string
}
```

### 6.5 WebSocket 事件

```typescript
// === 服务端发送事件 ===

// 任务事件
"mission:created"; // 任务创建
"mission:status_changed"; // 任务状态变更
"mission:progress_updated"; // 任务进度更新
"mission:completed"; // 任务完成
"mission:failed"; // 任务失败

// 子任务事件
"task:assigned"; // 子任务分配
"task:started"; // 子任务开始
"task:completed"; // 子任务完成
"task:revision_needed"; // 子任务需要修改

// Agent 事件
"agent:working"; // Agent 正在工作
"agent:report"; // Agent 汇报
"agent:collaboration"; // Agent 协作

// 日志事件
"log:new"; // 新日志条目

// 示例数据结构
interface MissionStatusChangedEvent {
  missionId: string;
  status: MissionStatus;
  previousStatus: MissionStatus;
  progressPercent: number;
  timestamp: string;
}

interface TaskAssignedEvent {
  missionId: string;
  taskId: string;
  taskTitle: string;
  assignedTo: {
    id: string;
    agentName: string;
  };
  messageId: string; // 关联的群聊消息 ID
}

interface AgentWorkingEvent {
  missionId: string;
  taskId: string;
  agentId: string;
  agentName: string;
  status: "started" | "in_progress" | "completed";
}
```

---

## 七、UI 设计

### 7.1 团队成员配置

在 AI 成员管理中增加团队角色配置：

```
┌─────────────────────────────────────────────────────────────────────┐
│  AI 成员配置                                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  基本信息                                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ AI模型        [Claude ▼]                                     │   │
│  │ 显示名称      [AI-Claude              ]                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  团队角色（可选）                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Agent 名称    [架构师张三                  ]                  │   │
│  │ 身份描述      [资深软件架构师，10年经验     ]                  │   │
│  │ 擅长领域      [系统架构] [技术选型] [+添加]                   │   │
│  │ 工作风格      [分析型 ▼]                                     │   │
│  │ 设为 Leader   [✓]                                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  AI 配置                                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 系统提示词    [你是一个资深架构师...          ]               │   │
│  │ 响应风格      [详细 ▼]                                       │   │
│  │ 上下文窗口    [20] 条消息                                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│                                        [取消]  [保存]               │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 任务执行状态面板

在讨论页右侧或底部显示任务执行状态：

```
┌─────────────────────────────────────────────────────────────────────┐
│  📋 团队任务：设计电商APP架构                        [进行中] 75%    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  进度条 ████████████████████░░░░░░ 75%                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  子任务状态                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ✅ 需求分析     @产品经理小王    已完成                       │   │
│  │ ✅ 技术选型     @技术专家小李    已完成                       │   │
│  │ ✅ 架构设计     @架构师张三      已完成                       │   │
│  │ 🔄 安全方案     @安全专家小张    进行中...                    │   │
│  │ ⏳ 文档整理     @文档专员小陈    等待依赖                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [查看详情] [取消任务]                                              │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.3 执行日志时间线

```
┌─────────────────────────────────────────────────────────────────────┐
│  执行日志                                                 [实时更新] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  14:35:22  🚀 任务启动                                              │
│            Leader @架构师张三 开始规划任务                           │
│                                                                     │
│  14:35:45  📋 任务分解完成                                          │
│            共 5 个子任务，2 个可并行执行                             │
│                                                                     │
│  14:35:48  📤 任务分配                                              │
│            「需求分析」→ @产品经理小王                               │
│            「技术选型」→ @技术专家小李                               │
│                                                                     │
│  14:35:50  ▶️ 开始执行                                              │
│            @产品经理小王 开始「需求分析」                            │
│            @技术专家小李 开始「技术选型」                            │
│                                                                     │
│  14:38:15  ✅ 任务完成                                              │
│            @产品经理小王 完成「需求分析」                            │
│            [查看产出]                                                │
│                                                                     │
│  14:38:20  👍 审核通过                                              │
│            Leader 审核「需求分析」通过                               │
│                                                                     │
│  14:39:02  ✅ 任务完成                                              │
│            @技术专家小李 完成「技术选型」                            │
│                                                                     │
│  14:39:10  🤝 协作求助                                              │
│            @架构师张三 向 @安全专家小张 求助                         │
│                                                                     │
│  14:39:30  💬 协作回应                                              │
│            @安全专家小张 回应了求助                                  │
│                                                                     │
│  ...                                                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 八、预设团队模板

### 8.1 软件开发团队

```json
{
  "templateId": "software-dev-team",
  "name": "软件开发团队",
  "description": "适用于软件架构设计、技术方案讨论等场景",
  "members": [
    {
      "agentName": "架构师",
      "agentIdentity": "资深软件架构师，负责系统设计和技术决策",
      "isLeader": true,
      "aiModel": "claude",
      "expertiseAreas": ["系统架构", "技术选型", "性能优化", "团队管理"],
      "workStyle": "ANALYTICAL",
      "systemPrompt": "你是一位资深软件架构师..."
    },
    {
      "agentName": "后端工程师",
      "agentIdentity": "全栈后端开发，精通多种后端技术栈",
      "aiModel": "gpt-4",
      "expertiseAreas": ["API设计", "数据库", "微服务", "性能优化"],
      "workStyle": "AUTONOMOUS"
    },
    {
      "agentName": "前端工程师",
      "agentIdentity": "前端技术专家，注重用户体验",
      "aiModel": "gpt-4",
      "expertiseAreas": ["UI开发", "交互设计", "前端架构", "性能优化"],
      "workStyle": "CREATIVE"
    },
    {
      "agentName": "测试工程师",
      "agentIdentity": "质量保证专家，确保软件质量",
      "aiModel": "claude",
      "expertiseAreas": ["测试策略", "自动化测试", "性能测试", "安全测试"],
      "workStyle": "ANALYTICAL"
    }
  ]
}
```

### 8.2 咨询顾问团队

```json
{
  "templateId": "consulting-team",
  "name": "咨询顾问团队",
  "description": "适用于商业分析、市场研究、战略规划等场景",
  "members": [
    {
      "agentName": "项目总监",
      "agentIdentity": "资深管理咨询顾问，擅长战略规划和项目管理",
      "isLeader": true,
      "aiModel": "claude",
      "expertiseAreas": ["战略规划", "项目管理", "客户沟通", "报告撰写"],
      "workStyle": "COLLABORATIVE"
    },
    {
      "agentName": "行业专家",
      "agentIdentity": "特定行业深度专家，提供专业洞察",
      "aiModel": "gpt-4",
      "expertiseAreas": ["行业分析", "竞争研究", "趋势预测", "最佳实践"],
      "workStyle": "ANALYTICAL"
    },
    {
      "agentName": "数据分析师",
      "agentIdentity": "数据科学专家，用数据驱动决策",
      "aiModel": "claude",
      "expertiseAreas": ["数据分析", "可视化", "统计建模", "洞察提取"],
      "workStyle": "ANALYTICAL"
    },
    {
      "agentName": "文档专员",
      "agentIdentity": "专业报告撰写，确保输出质量",
      "aiModel": "gpt-4",
      "expertiseAreas": ["报告撰写", "PPT制作", "内容编辑", "格式规范"],
      "workStyle": "SUPPORTIVE"
    }
  ]
}
```

### 8.3 创意策划团队

```json
{
  "templateId": "creative-team",
  "name": "创意策划团队",
  "description": "适用于营销策划、内容创作、品牌设计等场景",
  "members": [
    {
      "agentName": "创意总监",
      "agentIdentity": "资深创意人，擅长创意策划和团队协调",
      "isLeader": true,
      "aiModel": "claude",
      "expertiseAreas": ["创意策划", "品牌策略", "内容规划", "团队协调"],
      "workStyle": "CREATIVE"
    },
    {
      "agentName": "文案策划",
      "agentIdentity": "资深文案，擅长各类文案创作",
      "aiModel": "gpt-4",
      "expertiseAreas": ["广告文案", "品牌故事", "社交内容", "SEO优化"],
      "workStyle": "CREATIVE"
    },
    {
      "agentName": "市场研究员",
      "agentIdentity": "市场分析专家，洞察用户需求",
      "aiModel": "claude",
      "expertiseAreas": ["用户研究", "竞品分析", "市场趋势", "消费者洞察"],
      "workStyle": "ANALYTICAL"
    },
    {
      "agentName": "视觉设计师",
      "agentIdentity": "视觉设计专家，负责视觉呈现",
      "aiModel": "gemini-image",
      "expertiseAreas": ["视觉设计", "品牌视觉", "UI设计", "图像处理"],
      "workStyle": "CREATIVE"
    }
  ]
}
```

---

## 九、实现计划

### Phase 1：核心功能（MVP）

| 任务             | 描述                           | 优先级 |
| ---------------- | ------------------------------ | ------ |
| 数据模型扩展     | TopicAIMember 新增团队角色字段 | P0     |
| TeamMission 模型 | 创建团队任务数据模型           | P0     |
| AgentTask 模型   | 创建子任务数据模型             | P0     |
| Leader 规划 API  | 实现任务分解逻辑               | P0     |
| 任务执行引擎     | 实现并行调度和依赖管理         | P0     |
| 消息可见性       | 确保所有协作消息显示在群聊     | P0     |

### Phase 2：协作增强

| 任务           | 描述                        | 优先级 |
| -------------- | --------------------------- | ------ |
| Leader 反馈    | 实现产出审核和修改循环      | P1     |
| Agent 协作     | 实现 Agent 之间的求助和回应 | P1     |
| 执行日志       | 完整的日志记录和展示        | P1     |
| 状态面板       | 任务执行状态可视化          | P1     |
| WebSocket 实时 | 实时状态推送                | P1     |

### Phase 3：体验优化

| 任务     | 描述                   | 优先级 |
| -------- | ---------------------- | ------ |
| 团队模板 | 预设团队模板功能       | P2     |
| 效率分析 | 任务执行效率统计       | P2     |
| 用户干预 | 支持用户中途干预和调整 | P2     |
| 历史记录 | 任务执行历史查看       | P2     |

---

## 十、成功指标

| 指标         | 描述                     | 目标    |
| ------------ | ------------------------ | ------- |
| 任务完成率   | 成功完成的团队任务比例   | >90%    |
| 平均执行时间 | 从发起到完成的平均时间   | <10分钟 |
| 修改次数     | 平均每个子任务的修改次数 | <1.5次  |
| 用户满意度   | 对最终交付物的满意度评分 | >4.0/5  |
| 协作效率     | Agent 协作求助的响应时间 | <30秒   |

---

## 十一、风险与对策

| 风险              | 影响         | 对策                        |
| ----------------- | ------------ | --------------------------- |
| Leader 分解不合理 | 任务执行失败 | 预设分解模板，人工可干预    |
| 依赖死锁          | 任务卡住     | 依赖关系校验，超时处理      |
| 修改循环过多      | 效率低下     | 设置最大修改次数（默认3次） |
| AI 响应延迟       | 用户体验差   | 超时处理，状态实时展示      |
| Token 消耗过大    | 成本问题     | 上下文压缩，智能截断        |

---

**文档版本历史**

| 版本 | 日期       | 作者   | 变更说明 |
| ---- | ---------- | ------ | -------- |
| v1.0 | 2025-12-03 | Claude | 初版创建 |
