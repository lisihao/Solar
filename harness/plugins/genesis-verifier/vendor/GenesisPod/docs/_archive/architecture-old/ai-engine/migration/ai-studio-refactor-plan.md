# AI Studio 基于 AI Engine 重构方案

> 版本: 1.0
> 日期: 2025-01-06
> 状态: 规划中

---

## 一、重构目标

### 1.1 当前问题

| 问题              | 描述                                   | 影响                     |
| ----------------- | -------------------------------------- | ------------------------ |
| **架构不一致**    | AI Studio 独立实现，没有复用 AI Engine | 代码重复，维护成本高     |
| **单 Agent 模式** | 使用单一 Deep Research Agent           | 研究深度受限，缺乏多视角 |
| **一次性输出**    | 不支持持续迭代                         | 用户需要重新生成整个报告 |
| **过程不透明**    | 用户只看到进度条                       | 信任度低，难以干预       |

### 1.2 重构目标

```
┌─────────────────────────────────────────────────────────────────────┐
│  AI Studio 2.0 目标                                                 │
│                                                                     │
│  1. 基于 AI Engine 实现                                             │
│     - 复用任务分解、Agent 执行、输出审核能力                        │
│     - 统一的架构，便于维护                                          │
│                                                                     │
│  2. 多专家协作模式                                                  │
│     - 预定义研究团队（Leader + Members）                            │
│     - 专家分工，多视角研究                                          │
│                                                                     │
│  3. 支持持续迭代                                                    │
│     - 结构化输出（章节 ID）                                         │
│     - 选中更新、版本管理                                            │
│                                                                     │
│  4. 研究过程可见                                                    │
│     - 实时展示专家讨论                                              │
│     - 任务进度透明                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、架构设计

### 2.1 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AI Studio 2.0                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     前端 (Next.js)                           │   │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │   │
│  │  │ 项目列表  │ │ 研究配置  │ │ 报告视图  │ │ 版本历史  │   │   │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘   │   │
│  │                      │                                       │   │
│  │              ┌───────┴───────┐                              │   │
│  │              │  选中迭代组件  │                              │   │
│  │              └───────────────┘                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                     WebSocket / REST API                           │
│                              ↓                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  后端应用层 (NestJS)                         │   │
│  │                                                              │   │
│  │  ┌───────────────────────────────────────────────────────┐  │   │
│  │  │  AI Studio Module                                      │  │   │
│  │  │  ├── ai-studio.service.ts      # 项目 CRUD            │  │   │
│  │  │  ├── ai-studio-research.service.ts  # 研究编排        │  │   │
│  │  │  ├── ai-studio-iteration.service.ts # 迭代处理        │  │   │
│  │  │  └── ai-studio.gateway.ts      # WebSocket            │  │   │
│  │  └───────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                    调用 AI Engine API                              │
│                              ↓                                      │
├─────────────────────────────────────────────────────────────────────┤
│                        AI Engine                                    │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  下沉能力                                                      │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐     │ │
│  │  │ 任务分解  │ │ Agent执行 │ │ 输出审核  │ │ 迭代管理  │     │ │
│  │  │TaskDecomp │ │AgentExec  │ │OutputRev  │ │IterMgr    │     │ │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘     │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  预定义研究团队                                                │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │  快速调研团队 │ 深度研究团队 │ 综合研究团队 │ 技术研究团队│  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 研究团队模板

```typescript
// ============================================================
// 文件: ai-engine/teams/templates/research-teams.ts
// ============================================================

/**
 * 预定义研究团队模板
 */
export const RESEARCH_TEAM_TEMPLATES = {
  /**
   * 快速调研团队（15分钟）
   */
  QUICK_RESEARCH: {
    id: "quick-research",
    name: "快速调研团队",
    description: "快速了解某个主题的概况",
    estimatedDuration: 15, // 分钟
    leader: {
      role: "research-coordinator",
      displayName: "调研主管",
      model: "gpt-4o-mini",
      identity: "你是一个高效的调研主管，擅长快速把握主题要点。",
      expertiseAreas: ["信息整合", "快速分析"],
    },
    members: [
      {
        role: "information-gatherer",
        displayName: "信息收集员",
        model: "gpt-4o-mini",
        identity:
          "你是一个高效的信息收集专家，擅长从多个来源快速获取关键信息。",
        expertiseAreas: ["信息检索", "来源筛选"],
        workStyle: "AUTONOMOUS",
      },
      {
        role: "summarizer",
        displayName: "摘要专家",
        model: "gpt-4o-mini",
        identity: "你是一个专业的摘要专家，擅长将复杂信息提炼为简洁要点。",
        expertiseAreas: ["内容提炼", "结构化输出"],
        workStyle: "ANALYTICAL",
      },
    ],
    workflow: {
      maxSearchRounds: 2,
      requireReview: false,
      outputFormat: "BRIEF",
    },
  },

  /**
   * 深度研究团队（30-60分钟）
   */
  DEEP_RESEARCH: {
    id: "deep-research",
    name: "深度研究团队",
    description: "对主题进行深入研究，产出详细报告",
    estimatedDuration: 45,
    leader: {
      role: "research-director",
      displayName: "研究总监",
      model: "gpt-4o",
      identity: `你是一个资深的研究总监，具备以下能力：
- 理解复杂的研究目标
- 制定系统的研究计划
- 审核团队成员的产出质量
- 整合多方观点形成结论`,
      expertiseAreas: ["研究规划", "质量把控", "报告整合"],
    },
    members: [
      {
        role: "industry-analyst",
        displayName: "行业分析师",
        model: "gpt-4o",
        identity:
          "你是一个专业的行业分析师，擅长市场趋势分析、竞品研究和行业洞察。",
        expertiseAreas: ["市场分析", "竞品研究", "趋势预测"],
        workStyle: "ANALYTICAL",
      },
      {
        role: "tech-researcher",
        displayName: "技术研究员",
        model: "gpt-4o",
        identity:
          "你是一个深度的技术研究员，擅长技术原理分析、方案评估和技术趋势研判。",
        expertiseAreas: ["技术分析", "方案评估", "技术趋势"],
        workStyle: "ANALYTICAL",
      },
      {
        role: "data-analyst",
        displayName: "数据分析师",
        model: "gpt-4o",
        identity:
          "你是一个专业的数据分析师，擅长数据收集、统计分析和可视化呈现。",
        expertiseAreas: ["数据分析", "统计建模", "可视化"],
        workStyle: "ANALYTICAL",
      },
      {
        role: "report-writer",
        displayName: "报告撰写专家",
        model: "gpt-4o",
        identity:
          "你是一个专业的报告撰写专家，擅长将研究成果整理成结构清晰、逻辑严密的报告。",
        expertiseAreas: ["报告撰写", "结构设计", "文风统一"],
        workStyle: "CREATIVE",
      },
    ],
    workflow: {
      maxSearchRounds: 5,
      requireReview: true,
      maxRevisions: 2,
      outputFormat: "DETAILED",
    },
  },

  /**
   * 综合研究团队（60-120分钟）
   */
  COMPREHENSIVE_RESEARCH: {
    id: "comprehensive-research",
    name: "综合研究团队",
    description: "全方位深入研究，产出专业级研究报告",
    estimatedDuration: 90,
    leader: {
      role: "chief-researcher",
      displayName: "首席研究员",
      model: "claude-3-5-sonnet-20241022",
      identity: `你是一个首席研究员，负责：
- 制定全面的研究策略
- 协调多个专家的研究工作
- 确保研究的深度和广度
- 把控最终报告的质量`,
      expertiseAreas: ["研究战略", "团队协调", "质量把控"],
    },
    members: [
      // ... 更多专家配置
    ],
    workflow: {
      maxSearchRounds: 8,
      requireReview: true,
      maxRevisions: 3,
      enablePeerReview: true, // 专家互审
      outputFormat: "COMPREHENSIVE",
    },
  },

  /**
   * 技术研究团队
   */
  TECH_RESEARCH: {
    id: "tech-research",
    name: "技术研究团队",
    description: "专注于技术领域的深度研究",
    estimatedDuration: 60,
    leader: {
      role: "tech-lead",
      displayName: "技术总监",
      model: "gpt-4o",
      identity: "你是一个技术总监，擅长技术战略规划、架构评估和技术决策。",
      expertiseAreas: ["技术战略", "架构设计", "技术决策"],
    },
    members: [
      {
        role: "architect",
        displayName: "架构师",
        model: "gpt-4o",
        identity: "你是一个资深架构师，擅长系统架构设计和技术方案评估。",
        expertiseAreas: ["系统架构", "方案设计", "技术选型"],
        workStyle: "ANALYTICAL",
      },
      {
        role: "algorithm-expert",
        displayName: "算法专家",
        model: "gpt-4o",
        identity: "你是一个算法专家，擅长算法原理分析和性能优化。",
        expertiseAreas: ["算法设计", "性能优化", "复杂度分析"],
        workStyle: "ANALYTICAL",
      },
      {
        role: "implementation-engineer",
        displayName: "实现工程师",
        model: "gpt-4o",
        identity: "你是一个实现工程师，擅长将技术方案转化为可执行的实现路径。",
        expertiseAreas: ["代码实现", "工程实践", "最佳实践"],
        workStyle: "AUTONOMOUS",
      },
    ],
    workflow: {
      maxSearchRounds: 5,
      requireReview: true,
      maxRevisions: 2,
      outputFormat: "TECHNICAL",
    },
  },
};
```

---

## 三、核心服务设计

### 3.1 AIStudioResearchService

```typescript
// ============================================================
// 文件: ai-app/studio/ai-studio-research.service.ts
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { TaskDecomposerService } from "@/modules/ai-engine/decomposition";
import { AgentExecutorService } from "@/modules/ai-engine/orchestration/agent-executor";
import { OutputReviewerService } from "@/modules/ai-engine/review";
import { IterationManagerService } from "@/modules/ai-engine/iteration";
import { RESEARCH_TEAM_TEMPLATES } from "@/modules/ai-engine/teams/templates/research-teams";

@Injectable()
export class AIStudioResearchService {
  private readonly logger = new Logger(AIStudioResearchService.name);

  constructor(
    private readonly taskDecomposer: TaskDecomposerService,
    private readonly agentExecutor: AgentExecutorService,
    private readonly outputReviewer: OutputReviewerService,
    private readonly iterationManager: IterationManagerService,
    private readonly prisma: PrismaService,
    private readonly gateway: AIStudioGateway,
  ) {}

  /**
   * 开始研究
   */
  async startResearch(
    projectId: string,
    query: string,
    teamTemplateId: string,
    options: ResearchOptions = {},
  ): Promise<void> {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error(`项目不存在: ${projectId}`);
    }

    // 获取团队模板
    const teamTemplate = RESEARCH_TEAM_TEMPLATES[teamTemplateId];
    if (!teamTemplate) {
      throw new Error(`团队模板不存在: ${teamTemplateId}`);
    }

    // 创建研究上下文
    const context = await this.createResearchContext(project, query, options);

    // 构建团队
    const team = this.buildTeam(teamTemplate);

    // 发送开始事件
    this.gateway.emit(projectId, {
      type: "RESEARCH_STARTED",
      teamName: teamTemplate.name,
      estimatedDuration: teamTemplate.estimatedDuration,
    });

    try {
      // 执行研究流程
      await this.executeResearch(
        projectId,
        query,
        team,
        context,
        teamTemplate.workflow,
      );
    } catch (error) {
      this.logger.error(`研究失败: ${error.message}`);
      this.gateway.emit(projectId, {
        type: "RESEARCH_FAILED",
        error: error.message,
      });
    }
  }

  /**
   * 执行研究流程
   */
  private async executeResearch(
    projectId: string,
    query: string,
    team: TeamMemberDefinition[],
    context: ResearchContext,
    workflow: WorkflowConfig,
  ): Promise<void> {
    // 1. 任务分解
    this.gateway.emit(projectId, { type: "PHASE_STARTED", phase: "PLANNING" });

    const decompositionResult = await this.taskDecomposer.decompose(
      {
        title: `研究: ${query}`,
        description: query,
        objectives: [`全面研究主题: ${query}`],
        constraints: workflow.constraints || [],
      },
      team,
      {
        strategy: "DAG",
        extractConstraints: true,
      },
    );

    this.gateway.emit(projectId, {
      type: "PLANNING_COMPLETED",
      tasks: decompositionResult.tasks.map((t) => ({
        id: t.tempId,
        title: t.title,
        assignedTo: team.find((m) => m.id === t.assignedToId)?.displayName,
      })),
    });

    // 2. 执行任务
    this.gateway.emit(projectId, { type: "PHASE_STARTED", phase: "EXECUTING" });

    const executionContext: ExecutionContext = {
      missionId: projectId,
      missionTitle: query,
      objectives: context.boundaries.scope,
      constraints: [],
      hardConstraints: decompositionResult.hardConstraints,
      completedResults: new Map(),
    };

    const agents = this.buildAgentMap(team);

    for await (const event of this.agentExecutor.executeTasks(
      decompositionResult.tasks,
      agents,
      executionContext,
      {
        strategy: "PARALLEL",
        maxParallelism: 2,
        enableWebSearch: true,
      },
    )) {
      // 转发执行事件
      this.forwardExecutionEvent(projectId, event, team);
    }

    // 3. 审核（如果启用）
    if (workflow.requireReview) {
      this.gateway.emit(projectId, {
        type: "PHASE_STARTED",
        phase: "REVIEWING",
      });

      const leader = team.find((m) => m.isLeader)!;
      const leaderAgent = agents.get(leader.id)!;

      for (const task of decompositionResult.tasks) {
        const result = executionContext.completedResults.get(task.tempId);
        if (!result || result.status !== "SUCCESS") continue;

        const reviewResult = await this.outputReviewer.review(
          {
            taskId: task.tempId,
            taskTitle: task.title,
            taskDescription: task.description,
            output: result.output!,
            authorAgent: {
              id: task.assignedToId,
              displayName:
                team.find((m) => m.id === task.assignedToId)?.displayName || "",
            },
            taskType: task.taskType,
            context: {
              objectives: context.boundaries.scope,
              constraints: [],
            },
          },
          {
            minPassScore: 70,
            checkConstraints: true,
            checkConsistency: false,
            checkFormat: true,
            strictMode: false,
          },
          leaderAgent,
        );

        this.gateway.emit(projectId, {
          type: "TASK_REVIEWED",
          taskId: task.tempId,
          passed: reviewResult.passed,
          score: reviewResult.score,
          feedback: reviewResult.feedback,
        });

        // 如果需要修改且未达到上限
        if (!reviewResult.passed && workflow.maxRevisions > 0) {
          // 执行修订...
        }
      }
    }

    // 4. 整合报告
    this.gateway.emit(projectId, {
      type: "PHASE_STARTED",
      phase: "SYNTHESIZING",
    });

    const structuredOutput = await this.synthesizeReport(
      decompositionResult.tasks,
      executionContext.completedResults,
      team,
      context,
    );

    // 5. 保存结果
    await this.saveOutput(projectId, structuredOutput, context);

    this.gateway.emit(projectId, {
      type: "RESEARCH_COMPLETED",
      output: structuredOutput,
    });
  }

  /**
   * 整合报告
   */
  private async synthesizeReport(
    tasks: TaskDefinition[],
    results: Map<string, TaskResult>,
    team: TeamMemberDefinition[],
    context: ResearchContext,
  ): Promise<StructuredOutput> {
    const sections: OutputSection[] = [];

    // 执行摘要
    sections.push({
      id: this.generateSectionId(),
      type: "EXECUTIVE_SUMMARY",
      title: "执行摘要",
      content: await this.generateExecutiveSummary(tasks, results, context),
      level: 1,
      childIds: [],
      author: {
        agentId: "system",
        agentName: "研究总监",
      },
      citations: [],
      metadata: this.createSectionMetadata(),
    });

    // 各任务产出作为章节
    let chapterIndex = 1;
    for (const task of tasks) {
      const result = results.get(task.tempId);
      if (!result || result.status !== "SUCCESS") continue;

      const author = team.find((m) => m.id === task.assignedToId);

      sections.push({
        id: this.generateSectionId(),
        type: "CHAPTER",
        title: task.title,
        content: result.output!,
        level: 1,
        childIds: [],
        author: {
          agentId: author?.id || "unknown",
          agentName: author?.displayName || "未知",
        },
        citations: this.extractCitations(result.output!, result.searchResults),
        metadata: this.createSectionMetadata(),
      });

      chapterIndex++;
    }

    // 结论
    sections.push({
      id: this.generateSectionId(),
      type: "CONCLUSION",
      title: "结论",
      content: await this.generateConclusion(tasks, results, context),
      level: 1,
      childIds: [],
      author: {
        agentId: "system",
        agentName: "研究总监",
      },
      citations: [],
      metadata: this.createSectionMetadata(),
    });

    return {
      id: this.generateOutputId(),
      type: "RESEARCH_REPORT",
      sections,
      metadata: {
        totalWords: this.countTotalWords(sections),
        totalTokens: 0,
        sourceCount: this.countSources(sections),
        contributors: this.extractContributors(sections, team),
        tags: [],
      },
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // ... 其他辅助方法
}
```

### 3.2 AIStudioIterationService

```typescript
// ============================================================
// 文件: ai-app/studio/ai-studio-iteration.service.ts
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { IterationManagerService } from "@/modules/ai-engine/iteration";

@Injectable()
export class AIStudioIterationService {
  private readonly logger = new Logger(AIStudioIterationService.name);

  constructor(
    private readonly iterationManager: IterationManagerService,
    private readonly prisma: PrismaService,
    private readonly gateway: AIStudioGateway,
  ) {}

  /**
   * 处理迭代请求
   */
  async handleIteration(
    projectId: string,
    request: IterationRequest,
  ): Promise<void> {
    // 获取当前输出
    const output = await this.prisma.researchOutput.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
    });

    if (!output) {
      throw new Error("未找到研究输出");
    }

    // 获取研究上下文
    const context = await this.prisma.researchContext.findUnique({
      where: { projectId },
    });

    // 执行迭代
    for await (const event of this.iterationManager.iterate(
      request,
      output.content as StructuredOutput,
      context?.content as ResearchContext,
    )) {
      // 转发事件到前端
      this.gateway.emit(projectId, event);

      // 处理完成事件
      if (event.type === "ITERATION_COMPLETED") {
        // 保存新版本
        await this.saveIterationResult(projectId, event.result);
      }
    }
  }

  /**
   * 获取版本历史
   */
  async getVersionHistory(projectId: string): Promise<OutputVersion[]> {
    const outputs = await this.prisma.researchOutput.findMany({
      where: { projectId },
      orderBy: { version: "desc" },
      select: {
        version: true,
        createdAt: true,
        trigger: true,
        changeSummary: true,
      },
    });

    return outputs.map((o) => ({
      version: o.version,
      createdAt: o.createdAt,
      trigger: o.trigger as VersionTrigger,
      changes: [],
      summary: o.changeSummary || "",
    }));
  }

  /**
   * 回滚版本
   */
  async rollbackVersion(
    projectId: string,
    targetVersion: number,
  ): Promise<StructuredOutput> {
    const output = await this.prisma.researchOutput.findFirst({
      where: { projectId, version: targetVersion },
    });

    if (!output) {
      throw new Error(`版本不存在: ${targetVersion}`);
    }

    // 创建新版本（基于回滚）
    const newVersion = await this.prisma.researchOutput.create({
      data: {
        projectId,
        content: output.content,
        version: await this.getNextVersion(projectId),
        trigger: "ROLLBACK",
        changeSummary: `回滚到版本 ${targetVersion}`,
      },
    });

    return newVersion.content as StructuredOutput;
  }

  private async saveIterationResult(
    projectId: string,
    result: IterationResult,
  ): Promise<void> {
    await this.prisma.researchOutput.create({
      data: {
        projectId,
        content: result.updatedOutput as any,
        version: result.newVersion,
        trigger: result.changes[0]?.reason?.split(":")[0] || "UPDATE",
        changeSummary: this.summarizeChanges(result.changes),
      },
    });

    // 更新研究上下文
    await this.prisma.researchContext.update({
      where: { projectId },
      data: {
        content: result.updatedContext as any,
      },
    });
  }

  private summarizeChanges(changes: VersionChange[]): string {
    if (changes.length === 0) return "无变更";
    if (changes.length === 1) {
      return `更新章节: ${changes[0].sectionTitle}`;
    }
    return `更新 ${changes.length} 个章节`;
  }

  private async getNextVersion(projectId: string): Promise<number> {
    const latest = await this.prisma.researchOutput.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return (latest?.version || 0) + 1;
  }
}
```

---

## 四、数据模型变更

### 4.1 Prisma Schema 更新

```prisma
// ============================================================
// 文件: prisma/schema.prisma (新增/修改)
// ============================================================

// 研究输出（支持版本化）
model ResearchOutput {
  id            String   @id @default(cuid())
  projectId     String
  project       ResearchProject @relation(fields: [projectId], references: [id])

  // 结构化内容（JSON）
  content       Json     // StructuredOutput

  // 版本信息
  version       Int
  trigger       String   // INITIAL | PARTIAL_UPDATE | SECTION_EXPAND | ...
  changeSummary String?

  // 元信息
  createdAt     DateTime @default(now())

  @@unique([projectId, version])
  @@index([projectId])
}

// 研究上下文（持久化，支持持续研究）
model ResearchContext {
  id            String   @id @default(cuid())
  projectId     String   @unique
  project       ResearchProject @relation(fields: [projectId], references: [id])

  // 上下文内容（JSON）
  content       Json     // ResearchContext interface

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

// 更新 ResearchProject
model ResearchProject {
  id            String   @id @default(cuid())
  userId        String
  name          String
  description   String?

  // 研究配置
  teamTemplateId String?  // 使用的团队模板

  // 状态
  status        ProjectStatus @default(ACTIVE)

  // 关系
  outputs       ResearchOutput[]
  context       ResearchContext?

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

enum ProjectStatus {
  ACTIVE
  RESEARCHING
  COMPLETED
  ARCHIVED
}
```

---

## 五、前端改造

### 5.1 研究配置页面

```tsx
// ============================================================
// 文件: frontend/components/ai-studio/ResearchConfig.tsx
// ============================================================

interface ResearchConfigProps {
  projectId: string;
  onStart: (config: ResearchConfig) => void;
}

export const ResearchConfig: React.FC<ResearchConfigProps> = ({
  projectId,
  onStart,
}) => {
  const [query, setQuery] = useState("");
  const [teamTemplate, setTeamTemplate] = useState("deep-research");

  const teamOptions = [
    {
      id: "quick-research",
      name: "快速调研",
      description: "15分钟快速了解主题概况",
      icon: "⚡",
    },
    {
      id: "deep-research",
      name: "深度研究",
      description: "30-60分钟深入研究，产出详细报告",
      icon: "🔬",
    },
    {
      id: "comprehensive-research",
      name: "综合研究",
      description: "60-120分钟全方位研究，专业级报告",
      icon: "📊",
    },
    {
      id: "tech-research",
      name: "技术研究",
      description: "专注技术领域的深度研究",
      icon: "💻",
    },
  ];

  return (
    <div className="research-config">
      <h2>开始研究</h2>

      <div className="query-input">
        <label>研究主题</label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="请输入您想研究的主题..."
        />
      </div>

      <div className="team-selection">
        <label>选择研究团队</label>
        <div className="team-options">
          {teamOptions.map((team) => (
            <div
              key={team.id}
              className={`team-option ${teamTemplate === team.id ? "selected" : ""}`}
              onClick={() => setTeamTemplate(team.id)}
            >
              <span className="icon">{team.icon}</span>
              <div className="info">
                <h3>{team.name}</h3>
                <p>{team.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => onStart({ query, teamTemplate })}
        disabled={!query.trim()}
      >
        开始研究
      </button>
    </div>
  );
};
```

### 5.2 研究过程页面

```tsx
// ============================================================
// 文件: frontend/components/ai-studio/ResearchProgress.tsx
// ============================================================

export const ResearchProgress: React.FC<{ projectId: string }> = ({
  projectId,
}) => {
  const { events, phase, tasks, discussions } = useResearchProgress(projectId);

  return (
    <div className="research-progress">
      {/* 阶段指示器 */}
      <PhaseIndicator currentPhase={phase} />

      {/* 任务列表 */}
      <div className="task-list">
        <h3>任务进度</h3>
        {tasks.map((task) => (
          <TaskItem key={task.id} task={task} />
        ))}
      </div>

      {/* 专家讨论 */}
      <div className="discussions">
        <h3>专家讨论</h3>
        {discussions.map((msg, i) => (
          <DiscussionMessage key={i} message={msg} />
        ))}
      </div>
    </div>
  );
};

const PhaseIndicator: React.FC<{ currentPhase: string }> = ({
  currentPhase,
}) => {
  const phases = ["PLANNING", "EXECUTING", "REVIEWING", "SYNTHESIZING"];

  return (
    <div className="phase-indicator">
      {phases.map((phase, i) => (
        <div
          key={phase}
          className={`phase ${
            phases.indexOf(currentPhase) >= i ? "active" : ""
          }`}
        >
          <span className="number">{i + 1}</span>
          <span className="name">{phaseNames[phase]}</span>
        </div>
      ))}
    </div>
  );
};
```

### 5.3 报告视图（支持选中迭代）

```tsx
// ============================================================
// 文件: frontend/components/ai-studio/ReportView.tsx
// ============================================================

export const ReportView: React.FC<{
  output: StructuredOutput;
  onIterate: (request: IterationRequest) => void;
}> = ({ output, onIterate }) => {
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(
    null,
  );

  return (
    <div className="report-view">
      {/* 版本指示器 */}
      <div className="version-indicator">
        版本 {output.version} · 最后更新: {formatDate(output.updatedAt)}
        <button onClick={() => openVersionHistory()}>查看历史</button>
      </div>

      {/* 章节列表 */}
      <div className="sections">
        {output.sections.map((section) => (
          <SectionView
            key={section.id}
            section={section}
            isSelected={selectedSection === section.id}
            onSelect={() => setSelectedSection(section.id)}
            onTextSelect={(range) => setSelectionRange(range)}
          />
        ))}
      </div>

      {/* 选中操作工具栏 */}
      {selectedSection && (
        <SelectionToolbar
          sectionId={selectedSection}
          selectionRange={selectionRange}
          onUpdate={(instruction) =>
            onIterate({
              type: "PARTIAL_UPDATE",
              outputId: output.id,
              contextId: "",
              sectionId: selectedSection,
              selectionRange,
              instruction,
            })
          }
          onExpand={(direction) =>
            onIterate({
              type: "SECTION_EXPAND",
              outputId: output.id,
              contextId: "",
              sectionId: selectedSection,
              expandDirection: direction,
            })
          }
          onRewrite={(requirements) =>
            onIterate({
              type: "SECTION_REWRITE",
              outputId: output.id,
              contextId: "",
              sectionId: selectedSection,
              newRequirements: requirements,
              keepCitations: true,
            })
          }
        />
      )}
    </div>
  );
};

const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  sectionId,
  selectionRange,
  onUpdate,
  onExpand,
  onRewrite,
}) => {
  const [instruction, setInstruction] = useState("");

  return (
    <div className="selection-toolbar">
      <div className="actions">
        <button onClick={() => onUpdate(instruction || "更新内容")}>
          🔄 更新
        </button>
        <button onClick={() => onExpand("DEEPER")}>📊 深化</button>
        <button onClick={() => onExpand("EXAMPLES")}>📝 添加案例</button>
        <button onClick={() => onRewrite("")}>✏️ 重写</button>
      </div>

      <div className="instruction-input">
        <input
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="输入更新指令..."
        />
      </div>
    </div>
  );
};
```

---

## 六、迁移计划

### Phase 1: 基础设施 (1周)

- [ ] AI Engine 能力下沉完成
- [ ] 研究团队模板定义
- [ ] 数据模型迁移（Prisma Schema）

### Phase 2: 后端重构 (2周)

- [ ] AIStudioResearchService 实现
- [ ] AIStudioIterationService 实现
- [ ] WebSocket 事件定义
- [ ] API 接口实现

### Phase 3: 前端重构 (2周)

- [ ] 研究配置页面
- [ ] 研究过程页面
- [ ] 报告视图（支持选中）
- [ ] 版本历史页面

### Phase 4: 测试和优化 (1周)

- [ ] 端到端测试
- [ ] 性能优化
- [ ] 用户体验优化

---

## 七、兼容性处理

### 7.1 旧数据迁移

```typescript
// 将旧的研究输出迁移为新格式
async function migrateOldOutput(oldOutput: any): Promise<StructuredOutput> {
  return {
    id: oldOutput.id,
    type: "RESEARCH_REPORT",
    sections: [
      {
        id: generateId(),
        type: "CHAPTER",
        title: "研究报告",
        content: oldOutput.content,
        // ...
      },
    ],
    metadata: {
      totalWords: countWords(oldOutput.content),
      // ...
    },
    version: 1,
    createdAt: oldOutput.createdAt,
    updatedAt: oldOutput.updatedAt,
  };
}
```

### 7.2 API 兼容

- 保留旧的 Deep Research API 作为兼容层
- 新 API 使用 `/api/v2/ai-studio/` 前缀
- 渐进式迁移前端调用

---

## 八、成功指标

| 指标           | 目标                     |
| -------------- | ------------------------ |
| 代码复用率     | AI Engine 能力复用 > 80% |
| 研究报告质量   | 用户满意度提升 20%       |
| 迭代功能使用率 | > 30% 的用户使用迭代功能 |
| 研究过程透明度 | 用户能看到完整的研究过程 |
