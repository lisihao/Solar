# Topic Research（专题研究）

> **版本**: v1.0
> **最后更新**: 2026-01-15
> **状态**: Active

---

## 概述

Topic Research 是基于 AI Teams 框架的深度研究应用，实现了多维度协作研究和报告生成的完整流程。它是 AI Teams 机制在实际产品中的典型应用案例。

**核心价值**:

- 多 Agent 协作研究，每个 Agent 负责不同维度
- Leader 动态规划和调度研究任务
- 自动质量审核和迭代优化
- 生成结构化的研究报告

**实现位置**: `backend/src/modules/ai-app/research/topic-research/`

---

## 架构设计

### 分层架构

```
┌─────────────────────────────────────────────────────────┐
│  Topic Research Service (业务逻辑层)                     │
│  ├── ResearchMissionService (Mission 生命周期管理)      │
│  ├── ResearchLeaderService (Leader 规划和决策)          │
│  ├── DimensionMissionService (维度研究任务执行)         │
│  └── ReportSynthesisService (报告合成)                  │
└─────────────────────────────────────────────────────────┘
                      ↓ 调用
┌─────────────────────────────────────────────────────────┐
│  AI Teams Core (AI Engine)                              │
│  ├── MissionOrchestrator (任务编排)                     │
│  ├── TeamFactory (团队工厂)                             │
│  ├── SkillRegistry (技能注册)                           │
│  └── ConstraintEngine (约束引擎)                        │
└─────────────────────────────────────────────────────────┘
                      ↓ 使用
┌─────────────────────────────────────────────────────────┐
│  Foundation Services                                     │
│  ├── AiChatService (LLM 调用)                           │
│  ├── PrismaService (数据持久化)                         │
│  └── EventEmitter (事件系统)                            │
└─────────────────────────────────────────────────────────┘
```

---

## 核心概念

### 1. Research Topic（研究专题）

**定义**: 用户创建的研究主题，是所有研究活动的容器。

**数据模型**:

```prisma
model ResearchTopic {
  id          String   @id @default(uuid())
  userId      String
  name        String                    // 专题名称
  description String?                   // 专题描述
  status      ResearchTopicStatus       // created | researching | completed | archived
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  missions    ResearchMission[]         // 关联的 Missions
  references  TopicReference[]          // 参考资料
  report      TopicReport?              // 研究报告
}
```

---

### 2. Research Mission（研究任务）

**定义**: 针对 Topic 的一次完整研究执行，由 Leader 规划并协调多个 Task。

**数据模型**:

```prisma
model ResearchMission {
  id              String                @id @default(uuid())
  topicId         String
  topic           ResearchTopic         @relation(...)
  status          ResearchMissionStatus // PLANNING | EXECUTING | REVIEWING | COMPLETED | FAILED
  leaderModelId   String?               // Leader 使用的模型 ID
  leaderModelName String?               // Leader 使用的模型名称
  userPrompt      String?               // 用户额外要求
  userContext     Json?                 // 用户上下文
  planSummary     String?               // 规划摘要
  leaderPlan      Json?                 // Leader 的完整规划（LeaderPlan）
  createdAt       DateTime              @default(now())
  startedAt       DateTime?
  completedAt     DateTime?

  tasks           ResearchTask[]        // 关联的 Tasks
}
```

**状态转换**:

```
PLANNING → EXECUTING → REVIEWING → COMPLETED/FAILED
```

---

### 3. Research Task（研究子任务）

**定义**: Mission 中的单个研究子任务，由特定 Agent 执行。

**数据模型**:

```prisma
model ResearchTask {
  id             String              @id @default(uuid())
  missionId      String
  mission        ResearchMission     @relation(...)
  taskType       String              // DIMENSION_RESEARCH | QUALITY_REVIEW | REPORT_SYNTHESIS
  title          String              // 任务标题
  description    String?             // 任务描述
  dimensionName  String?             // 维度名称（如果是 DIMENSION_RESEARCH）
  assignedAgent  String              // 分配的 Agent ID
  status         ResearchTaskStatus  // PENDING | EXECUTING | COMPLETED | FAILED
  priority       Int                 // 优先级（数字越小优先级越高）
  dependencies   String[]            // 依赖的任务 ID
  result         Json?               // 任务结果
  resultSummary  String?             // 结果摘要
  reviewStatus   String?             // 审核状态
  createdAt      DateTime            @default(now())
  startedAt      DateTime?
  completedAt    DateTime?
}
```

**任务类型**:

| 类型                 | 说明     | 执行者           | 优先级 |
| -------------------- | -------- | ---------------- | ------ |
| `DIMENSION_RESEARCH` | 维度研究 | Researcher Agent | 50     |
| `QUALITY_REVIEW`     | 质量审核 | Leader           | 100    |
| `REPORT_SYNTHESIS`   | 报告合成 | Writer Agent     | 200    |

---

## 工作流程

### 完整流程图

```
User: Create Topic + Start Mission
    ↓
[ResearchMissionService.createMission]
    ├── 1. 创建 Mission 记录（status: PLANNING）
    ├── 2. 异步调用 Leader 规划
    └── 3. 立即返回 Mission（避免超时）

Async Planning:
[executePlanningAsync]
    ↓
[ResearchLeaderService.planResearchStrategy]
    ├── 调用 Reasoning Model（如 gpt-5-preview）
    ├── 输入：Topic 名称、用户要求、参考资料
    └── 输出：LeaderPlan
        ├── dimensions: 研究维度列表
        ├── strategy: 执行策略
        ├── estimatedDuration: 预估时长
        └── qualityGuidelines: 质量要求

[ResearchMissionService.createTasksFromLeaderPlan]
    ├── 为每个维度创建 DIMENSION_RESEARCH 任务
    ├── 创建 QUALITY_REVIEW 任务（依赖所有维度任务）
    ├── 创建 REPORT_SYNTHESIS 任务（依赖 QUALITY_REVIEW）
    └── 更新 Mission 状态为 EXECUTING

[执行任务循环]
    ├── 找出可执行的任务（依赖已完成）
    ├── 调用 DimensionMissionService.executeDimensionMission
    │   ├── 调用 Data Router（决定数据源）
    │   ├── 调用 Research Agents（执行研究）
    │   └── 保存结果到 Task.result
    ├── 发送进度事件（通过 WebSocket）
    └── 更新 Mission 进度

[完成后]
    ├── Leader 审核所有维度结果
    ├── 合成最终报告（ReportSynthesisService）
    └── 更新 Mission 状态为 COMPLETED
```

---

## 关键服务

### 1. ResearchMissionService

**职责**: 管理 Mission 和 Task 的生命周期。

**核心方法**:

#### `createMission(input: CreateMissionInput): Promise<ResearchMission>`

创建新的研究 Mission，异步触发规划。

**实现要点**:

- ★ 关键设计：立即返回 Mission，避免 30 秒超时
- Leader 规划（AI 推理）在后台异步执行
- 前端通过轮询和 WebSocket 获取规划进度

```typescript
async createMission(input: CreateMissionInput): Promise<ResearchMission> {
  // 1. 创建 Mission 记录（status: PLANNING）
  const mission = await this.prisma.researchMission.create({
    data: {
      topicId,
      status: ResearchMissionStatus.PLANNING,
      leaderModelId: leaderModel?.modelId,
      userPrompt,
      userContext
    }
  })

  // 2. 发送进度事件
  this.emitProgress({
    missionId: mission.id,
    status: ResearchMissionStatus.PLANNING,
    message: "Leader 正在规划研究方案..."
  })

  // ★ 3. 异步执行规划（不等待）
  this.executePlanningAsync(mission.id, topicId, topic.name, userPrompt)
    .catch(err => this.logger.error(`Async planning failed: ${err.message}`))

  // 4. 立即返回 Mission
  return mission
}
```

#### `executePlanningAsync()`

异步执行 Leader 规划和任务创建。

```typescript
private async executePlanningAsync(
  missionId: string,
  topicId: string,
  topicName: string,
  userPrompt?: string
) {
  try {
    // 1. 调用 Leader 规划
    const leaderPlan = await this.leaderService.planResearchStrategy({
      topicId,
      topicName,
      userRequirements: userPrompt
    })

    // 2. 创建任务列表
    await this.createTasksFromLeaderPlan(missionId, topicId, leaderPlan)

    // 3. 更新 Mission 状态为 EXECUTING
    await this.prisma.researchMission.update({
      where: { id: missionId },
      data: {
        status: ResearchMissionStatus.EXECUTING,
        leaderPlan,
        planSummary: leaderPlan.summary
      }
    })

    // 4. 发送规划完成事件
    this.emitProgress({
      missionId,
      status: ResearchMissionStatus.EXECUTING,
      message: "规划完成，开始执行研究任务"
    })
  } catch (error) {
    // 标记 Mission 为失败
    await this.prisma.researchMission.update({
      where: { id: missionId },
      data: { status: ResearchMissionStatus.FAILED }
    })
  }
}
```

#### `getMissionStatus(missionId: string): Promise<MissionStatus>`

获取 Mission 当前状态和进度。

```typescript
interface MissionStatus {
  id: string;
  status: ResearchMissionStatus;
  progress: number; // 0-100
  totalTasks: number;
  completedTasks: number;
  currentPhase: string;
  tasks: TaskStatus[];
  leaderPlan?: LeaderPlan;
}
```

---

### 2. ResearchLeaderService

**职责**: Leader 的规划和决策逻辑。

**核心方法**:

#### `planResearchStrategy(input: PlanningInput): Promise<LeaderPlan>`

调用 Reasoning Model（如 `gpt-5-preview`）规划研究策略。

**输入**:

```typescript
interface PlanningInput {
  topicId: string;
  topicName: string;
  userRequirements?: string;
  existingReferences?: Reference[];
}
```

**输出**:

```typescript
interface LeaderPlan {
  summary: string; // 规划摘要
  dimensions: ResearchDimension[]; // 研究维度列表
  strategy: {
    priority: string[]; // 优先级顺序
    parallelism: boolean; // 是否并行执行
    dependencies: Record<string, string[]>; // 维度依赖关系
  };
  estimatedDuration: number; // 预估时长（分钟）
  qualityGuidelines: string[]; // 质量要求
}

interface ResearchDimension {
  name: string; // 维度名称（如"市场规模"）
  description: string; // 维度描述
  keyQuestions: string[]; // 关键问题
  expectedOutputType: string; // 期望输出类型
  priority: number; // 优先级
}
```

**Prompt 示例**:

```typescript
const systemPrompt = `你是一个专业的研究规划专家。
根据研究主题，分解为多个研究维度，制定执行策略。

输出 JSON 格式的研究规划，包含：
1. dimensions: 研究维度列表（3-6 个维度）
2. strategy: 执行策略（优先级、并行性、依赖关系）
3. estimatedDuration: 预估耗时（分钟）
4. qualityGuidelines: 质量要求`;

const userMessage = `
研究主题：${topicName}
用户要求：${userRequirements}
参考资料：${references.map((r) => r.title).join(", ")}

请规划研究方案。
`;
```

**实现**:

```typescript
async planResearchStrategy(input: PlanningInput): Promise<LeaderPlan> {
  const model = await this.getReasoningModel()  // gpt-5-preview

  const response = await this.aiChatService.chat({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    modelType: AIModelType.REASONING,
    taskProfile: {
      creativity: 'medium',
      outputLength: 'long'
    }
  })

  // 解析 LLM 响应
  const plan = this.parsePlanFromResponse(response.content)

  return plan
}
```

---

### 3. DimensionMissionService

**职责**: 执行单个维度的研究任务。

**核心方法**:

#### `executeDimensionMission(task: ResearchTask): Promise<DimensionResult>`

执行维度研究。

**流程**:

```
1. 数据源路由（DataSourceRouterService）
    ├── 检查现有参考资料
    ├── 决定是否需要搜索
    └── 返回数据源列表

2. 调用 Research Agents
    ├── 从 SkillRegistry 获取 research-* 技能
    ├── 构建研究上下文
    ├── 执行研究（调用 LLM + Tools）
    └── 返回研究结果

3. 证据管理（EvidenceManagementService）
    ├── 提取引用来源
    ├── 标注可信度
    └── 保存到 Evidence 表

4. 返回维度结果
    ├── content: 研究内容（Markdown）
    ├── evidence: 证据列表
    ├── confidence: 可信度（0-1）
    └── sources: 来源列表
```

**实现示例**:

```typescript
async executeDimensionMission(task: ResearchTask): Promise<DimensionResult> {
  // 1. 数据源路由
  const dataSources = await this.dataSourceRouter.route({
    dimension: task.dimensionName,
    query: task.description,
    existingReferences: await this.getExistingReferences(task.missionId)
  })

  // 2. 构建研究上下文
  const researchContext = {
    dimension: task.dimensionName,
    keyQuestions: task.metadata?.keyQuestions || [],
    dataSources,
    constraints: {
      maxSources: 10,
      requireEvidence: true
    }
  }

  // 3. 调用 Research Agent（通过 Teams 机制）
  const researchAgent = this.skillRegistry.get('dimension-research')
  const result = await researchAgent.execute({
    task: task.description,
    context: researchContext
  }, {
    executionId: uuidv4(),
    skillId: 'dimension-research',
    sessionId: task.missionId
  })

  // 4. 提取证据
  const evidence = await this.evidenceManagement.extractEvidence(result.data)

  return {
    dimensionName: task.dimensionName,
    content: result.data.content,
    evidence,
    confidence: result.data.confidence,
    sources: result.data.sources
  }
}
```

---

### 4. ReportSynthesisService

**职责**: 合成最终研究报告。

**核心方法**:

#### `synthesizeReport(mission: ResearchMission): Promise<TopicReport>`

整合所有维度结果，生成结构化报告。

**输入**:

- Mission 的所有 DIMENSION_RESEARCH 任务结果
- Leader 的质量审核结果
- 用户的原始要求

**输出**:

```typescript
interface TopicReport {
  id: string;
  topicId: string;
  title: string;
  summary: string; // 执行摘要
  sections: ReportSection[]; // 报告章节
  references: Reference[]; // 参考文献
  metadata: {
    totalSources: number;
    averageConfidence: number;
    generatedAt: Date;
  };
}

interface ReportSection {
  title: string;
  content: string; // Markdown 格式
  evidence: Evidence[];
  subSections?: ReportSection[];
}
```

**实现**:

```typescript
async synthesizeReport(mission: ResearchMission): Promise<TopicReport> {
  // 1. 获取所有维度结果
  const dimensionResults = await this.getDimensionResults(mission.id)

  // 2. 调用 Writer Agent 合成报告
  const writerAgent = this.skillRegistry.get('report-synthesis')
  const reportDraft = await writerAgent.execute({
    task: '合成研究报告',
    context: {
      topic: mission.topic.name,
      dimensions: dimensionResults,
      leaderPlan: mission.leaderPlan,
      userRequirements: mission.userPrompt
    }
  }, {
    executionId: uuidv4(),
    skillId: 'report-synthesis',
    sessionId: mission.id
  })

  // 3. 结构化处理（章节划分、引用整理）
  const sections = this.structureReport(reportDraft.data)

  // 4. 生成参考文献
  const references = this.generateReferences(dimensionResults)

  // 5. 保存报告
  const report = await this.prisma.topicReport.create({
    data: {
      topicId: mission.topicId,
      title: `${mission.topic.name} 研究报告`,
      summary: reportDraft.data.summary,
      content: sections,
      references,
      metadata: {
        totalSources: references.length,
        averageConfidence: this.calculateAverageConfidence(dimensionResults),
        generatedAt: new Date()
      }
    }
  })

  return report
}
```

---

## 与 AI Teams 的集成

### 数据流映射

| Topic Research 概念       | AI Teams 概念            | 说明                 |
| ------------------------- | ------------------------ | -------------------- |
| `ResearchMission`         | `Mission`                | 一次完整的研究执行   |
| `ResearchTask`            | `ExecutionStep`          | Mission 中的单个步骤 |
| `LeaderPlan.dimensions`   | `SubTask[]`              | Leader 分解的子任务  |
| `DimensionMissionService` | `Member.execute()`       | 成员执行子任务       |
| `ResearchLeaderService`   | `Leader.decomposeTask()` | Leader 任务分解      |

### 复用的 AI Teams 机制

#### 1. SkillRegistry

Topic Research 使用的技能：

| SkillId               | 说明           | 实现位置                                         |
| --------------------- | -------------- | ------------------------------------------------ |
| `dimension-research`  | 维度研究执行   | `backend/src/modules/ai-engine/skills/research/` |
| `evidence-extraction` | 证据提取和标注 | `backend/src/modules/ai-engine/skills/research/` |
| `report-synthesis`    | 报告合成       | `backend/src/modules/ai-engine/skills/content/`  |

#### 2. ConstraintEngine

Topic Research 的约束配置：

```typescript
const researchConstraints = createConstraintProfile("thorough", {
  quality: {
    depth: "comprehensive",
    accuracy: "require_evidence",
    reviewRequired: true,
    minReviewScore: 8,
    maxReworks: 2,
  },
  cost: {
    maxCost: 5000, // 高成本预算（深度研究）
    modelPreference: "premium",
  },
  efficiency: {
    maxDuration: 4 * 60 * 60 * 1000, // 4 小时
    parallelism: 3, // 允许 3 个维度并行研究
  },
});
```

#### 3. EventEmitter

Topic Research 发送的事件：

| 事件类型            | 说明         | 数据                        |
| ------------------- | ------------ | --------------------------- |
| `mission:planning`  | 规划开始     | `{ missionId, topicId }`    |
| `mission:executing` | 开始执行     | `{ missionId, totalTasks }` |
| `task:started`      | 任务开始     | `{ taskId, dimensionName }` |
| `task:completed`    | 任务完成     | `{ taskId, result }`        |
| `mission:completed` | Mission 完成 | `{ missionId, reportId }`   |

---

## 前端集成

### API 端点

```typescript
// 1. 创建 Mission
POST /api/research/topics/:topicId/missions
Body: {
  userPrompt?: string,
  userContext?: Record<string, any>
}
Response: ResearchMission

// 2. 获取 Mission 状态
GET /api/research/missions/:missionId/status
Response: MissionStatus

// 3. 获取报告
GET /api/research/missions/:missionId/report
Response: TopicReport
```

### WebSocket 事件订阅

```typescript
// 前端订阅 Mission 进度
useEffect(() => {
  const socket = io("/research");

  socket.on("mission:progress", (event: MissionProgressEvent) => {
    console.log(`[${event.missionId}] ${event.message}`, event.progress);
    // 更新进度条
    setProgress(event.progress);
  });

  socket.on("task:completed", (event) => {
    console.log(`Task ${event.taskId} completed`);
    // 刷新任务列表
    refreshTasks();
  });

  return () => socket.disconnect();
}, [missionId]);
```

---

## 扩展点

### 1. 自定义研究维度

用户可以在 Leader 规划后，手动添加额外的研究维度：

```typescript
// API: POST /api/research/missions/:missionId/tasks
await createAdditionalTask({
  missionId,
  taskType: "DIMENSION_RESEARCH",
  dimensionName: "竞争对手分析",
  description: "分析主要竞争对手的优劣势",
  priority: 50,
});
```

### 2. 自定义 Agent 配置

用户可以选择特定的 LLM 模型作为 Leader 或 Researcher：

```typescript
const mission = await createMission({
  topicId,
  leaderModel: "gpt-5-preview", // 指定 Leader 模型
  researcherModel: "claude-3.5-sonnet", // 指定 Researcher 模型
});
```

### 3. 自定义质量标准

用户可以调整审核标准：

```typescript
const mission = await createMission({
  topicId,
  qualityProfile: {
    minReviewScore: 9, // 提高审核标准
    requireMultipleSources: true, // 要求多来源验证
    minConfidence: 0.8, // 最低可信度
  },
});
```

---

## 性能优化

### 1. 并行维度研究

- 无依赖关系的维度可并行执行
- 受 `constraints.efficiency.parallelism` 限制
- 典型场景：3-5 个维度并行研究

### 2. 异步规划

- Leader 规划（2-5 分钟）在后台执行
- 避免 Next.js rewrite 代理的 30 秒超时
- 前端通过轮询和 WebSocket 获取进度

### 3. 结果缓存

- 维度研究结果缓存到 `ResearchTask.result`
- 报告缓存到 `TopicReport`
- 避免重复研究

---

## 故障排查

### 问题：规划超时

**症状**: 前端显示"规划中"超过 5 分钟

**原因**: Reasoning Model 响应慢或失败

**解决**:

1. 检查 Leader Model 可用性（`gpt-5-preview` 是否在线）
2. 检查后端日志：`[ResearchLeaderService] Planning failed`
3. 降级到 `gpt-4o` 或 `claude-3.5-sonnet`

### 问题：任务执行失败

**症状**: 某个维度研究任务状态为 `FAILED`

**原因**: 数据源不可用、LLM 调用失败、约束超出

**解决**:

1. 检查 `ResearchTask.result.error` 字段
2. 重试失败的任务：`POST /api/research/tasks/:taskId/retry`
3. 调整约束配置（增加 Token 限额、延长超时）

### 问题：报告质量不佳

**症状**: 生成的报告内容浅显、缺乏深度

**原因**: Leader 规划不合理、维度设计不佳、质量审核标准过低

**解决**:

1. 提供更详细的用户要求（`userPrompt`）
2. 增加参考资料（`TopicReference`）
3. 提高质量标准（`minReviewScore: 9`）
4. 启用多轮返工（`maxReworks: 3`）

---

## 相关文档

- [AI Teams 核心概念](../core-concepts.md)
- [Mission 生命周期](../mission-lifecycle.md)
- [Skills 开发指南](../../guides/skills-development.md)

---

**维护者**: Topic Research Team
**反馈渠道**: GitHub Issues
