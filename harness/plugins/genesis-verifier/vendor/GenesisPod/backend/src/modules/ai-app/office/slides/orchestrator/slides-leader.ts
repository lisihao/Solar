/**
 * Slides Leader - 幻灯片架构师
 *
 * 负责：
 * - 任务规划：分析源文本，动态分解任务
 * - 任务审核：检查任务输出质量，决定通过/修订/失败
 * - 结果综合：整合所有页面输出，生成最终 PPT 结构
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import {
  TaskBreakdown,
  TaskBreakdownItem,
  SlidesTask,
  SlidesTeamMemberRole,
  ReviewResult,
  ReviewDecision,
  SlidesMission,
  SLIDES_TEAM_MEMBERS,
} from "./types";

/**
 * ✅ 已迁移：使用 ChatFacade 统一入口
 */
@Injectable()
export class SlidesLeader {
  private readonly logger = new Logger(SlidesLeader.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  // ============================================
  // AI 调用辅助方法
  // ============================================

  /**
   * 使用 ChatFacade 统一入口
   * 模型选择由 Facade 内部处理
   */
  private async callAI(
    systemPrompt: string,
    userMessage: string,
    options?: {
      outputLength?: "minimal" | "short" | "medium" | "standard" | "long";
    },
  ): Promise<string> {
    const result = await this.chatFacade.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      modelType: AIModelType.CHAT,
      taskProfile: {
        creativity: "low", // Leader 规划需要低创造性，保持一致性
        outputLength: options?.outputLength ?? "standard",
      },
    });

    return result.content || "";
  }

  // ============================================
  // 任务规划
  // ============================================

  async planTasks(mission: SlidesMission): Promise<TaskBreakdown> {
    this.logger.log(`[planTasks] Planning tasks for mission ${mission.id}`);

    const systemPrompt = this.getLeaderPlanningSystemPrompt();
    const userPrompt = this.buildPlanningPrompt(mission);

    const response = await this.callAI(systemPrompt, userPrompt, {
      outputLength: "long", // 任务规划需要长输出
    });

    const breakdown = this.parseTaskBreakdown(response);

    this.logger.log(
      `[planTasks] Planned ${breakdown.tasks.length} tasks for mission ${mission.id}`,
    );

    return breakdown;
  }

  private getLeaderPlanningSystemPrompt(): string {
    const teamMembersInfo = Object.values(SLIDES_TEAM_MEMBERS)
      .map(
        (m) =>
          `- **${m.name}** (${m.role}): ${m.description}\n  Skills: ${m.skills.join(", ")}`,
      )
      .join("\n");

    return `你是 Slides Architect，一位资深的幻灯片设计架构师。

## 你的职责
分析用户提供的源文本，规划 PPT 生成任务，并将任务分配给团队成员。

## 团队成员
${teamMembersInfo}

## 可用技能列表（每个任务只能使用一个技能）
### Analyst 技能
- task-decomposition: 任务分解，分析源文本结构
- outline-planning: 大纲规划，生成 PPT 大纲（必须在 task-decomposition 之后）

### Writer 技能（页面生成）
- page-pipeline: 页面生成流水线，批量生成所有页面的 HTML（★ 推荐用于页面生成）

## 重要约束
1. 每个任务只能指定一个技能 ID，不要用逗号分隔多个技能
2. 必须包含以下核心任务流程：
   - task-decomposition → outline-planning → page-pipeline
3. 使用 page-pipeline 生成页面，不要使用 four-step-design
4. 不需要添加 quality-audit 任务（质量审计由系统自动执行）

## 输出格式
请使用以下 Markdown 表格格式输出任务分解：

### 任务理解
[简要描述你对任务的理解]

### 任务列表
| 序号 | 任务标题 | 描述 | 负责人 | 技能ID | 优先级 | 依赖 |
|------|----------|------|--------|--------|--------|------|
| 1 | xxx | xxx | analyst/designer/reviewer | skill-id | high/medium/low | - |

### 执行计划
[描述任务执行顺序和并行策略]

### 风险提示
[列出可能的风险和缓解措施]
`;
  }

  private buildPlanningPrompt(mission: SlidesMission): string {
    return `## PPT 生成任务

**用户需求**: ${mission.userRequirement || "生成专业的 PPT"}
**目标页数**: ${mission.targetPages || "自动推断"}
**风格偏好**: ${mission.stylePreference || "dark"}
**主题**: ${mission.themeId || "genspark-dark"}

## 源文本内容
\`\`\`
${mission.sourceText.substring(0, 8000)}${mission.sourceText.length > 8000 ? "\n...[内容已截断]" : ""}
\`\`\`

请分析源文本，规划 PPT 生成任务。

## 必须遵循的任务流程
1. 第一步：task-decomposition - 分析源文本，分解任务
2. 第二步：outline-planning - 生成 PPT 大纲（依赖第1步）
3. 第三步：page-pipeline - 批量生成所有页面 HTML（依赖第2步）

## 关键约束
- 每行只能填写一个技能 ID
- 必须使用 page-pipeline 生成页面
- 只需要以上 3 个任务，不要添加额外的任务
`;
  }

  private parseTaskBreakdown(response: string): TaskBreakdown {
    const breakdown: TaskBreakdown = {
      understanding: "",
      tasks: [],
      executionPlan: "",
      risks: "",
    };

    // 提取任务理解
    const understandingMatch = response.match(
      /### 任务理解\s*\n([\s\S]*?)(?=###|$)/,
    );
    if (understandingMatch) {
      breakdown.understanding = understandingMatch[1].trim();
    }

    // 提取执行计划
    const planMatch = response.match(/### 执行计划\s*\n([\s\S]*?)(?=###|$)/);
    if (planMatch) {
      breakdown.executionPlan = planMatch[1].trim();
    }

    // 提取风险提示
    const risksMatch = response.match(/### 风险提示\s*\n([\s\S]*?)(?=###|$)/);
    if (risksMatch) {
      breakdown.risks = risksMatch[1].trim();
    }

    // 解析任务表格
    const tableMatch = response.match(
      /\| 序号 \| 任务标题 \| 描述 \| 负责人 \| 技能ID \| 优先级 \| 依赖 \|\s*\n\|[-|\s]+\|\s*\n([\s\S]*?)(?=\n\n|\n###|$)/,
    );

    if (tableMatch) {
      const tableRows = tableMatch[1].trim().split("\n");

      for (const row of tableRows) {
        const cells = row
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c);

        if (cells.length >= 7) {
          const [
            _index,
            title,
            description,
            assignee,
            skillId,
            priority,
            dependsOnStr,
          ] = cells;

          const dependsOn =
            dependsOnStr === "-" || dependsOnStr === ""
              ? []
              : dependsOnStr
                  .split(",")
                  .map((d) => parseInt(d.trim()) - 1)
                  .filter((n) => !isNaN(n));

          // ★ 修复：AI 可能返回逗号分隔的多个技能，只取第一个
          const normalizedSkillId = this.normalizeSkillId(skillId);

          // 如果技能无效，跳过此任务
          if (!normalizedSkillId) {
            this.logger.warn(
              `[parseTaskBreakdown] Skipping task "${title}" with invalid skillId: "${skillId}"`,
            );
            continue;
          }

          const task: TaskBreakdownItem = {
            title,
            description,
            assignee: this.normalizeAssignee(assignee),
            skillId: normalizedSkillId,
            priority: this.normalizePriority(priority),
            dependsOn,
            inputSpec: {},
          };

          breakdown.tasks.push(task);
        }
      }
    }

    // 如果没有解析到任务，创建默认任务
    if (breakdown.tasks.length === 0) {
      this.logger.warn(
        "[parseTaskBreakdown] No tasks parsed, creating default tasks",
      );
      breakdown.tasks = this.createDefaultTasks();
    }

    return breakdown;
  }

  private normalizeAssignee(assignee: string): SlidesTeamMemberRole {
    const normalized = assignee.toLowerCase().trim();
    if (normalized.includes("analyst") || normalized.includes("分析")) {
      return "analyst";
    }
    if (normalized.includes("strategist") || normalized.includes("策略")) {
      return "strategist";
    }
    if (
      normalized.includes("writer") ||
      normalized.includes("撰写") ||
      normalized.includes("内容")
    ) {
      return "writer";
    }
    if (normalized.includes("reviewer") || normalized.includes("审核")) {
      return "reviewer";
    }
    // Default to writer for design/generation tasks
    if (normalized.includes("designer") || normalized.includes("设计")) {
      return "writer";
    }
    return "writer";
  }

  private normalizePriority(
    priority: string,
  ): "critical" | "high" | "medium" | "low" {
    const normalized = priority.toLowerCase().trim();
    if (normalized.includes("critical") || normalized.includes("紧急"))
      return "critical";
    if (normalized.includes("high") || normalized.includes("高")) return "high";
    if (normalized.includes("low") || normalized.includes("低")) return "low";
    return "medium";
  }

  /**
   * 规范化技能 ID
   * - 处理 AI 返回的逗号分隔多技能情况（只取第一个）
   * - 映射到已注册的技能 ID
   */
  private normalizeSkillId(skillId: string): string | null {
    // 1. 如果包含逗号，只取第一个
    let normalized = skillId
      .split(",")[0]
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");

    // 2. 移除可能的前缀/后缀杂质
    normalized = normalized.replace(/^[-]+|[-]+$/g, "");

    // 3. 映射常见的技能名称到实际注册的技能 ID
    const skillMapping: Record<string, string> = {
      // 分析类
      "task-decomposition": "slides-task-decomposition",
      "content-analyzer": "slides-content-analyzer",
      "content-analysis": "slides-task-decomposition",
      // 规划类
      "outline-planning": "slides-outline-planning",
      outline: "slides-outline-planning",
      // 设计/渲染类
      "four-step-design": "slides-four-step-design",
      "page-pipeline": "slides-page-pipeline",
      "template-rendering": "slides-template-rendering",
      "template-matcher": "slides-template-matcher",
      "layout-optimizer": "slides-layout-optimizer",
      "chart-renderer": "slides-chart-renderer",
      "image-fetcher": "slides-image-fetcher",
      "content-compression": "slides-content-compression",
      "data-supplement": "slides-data-supplement",
      "page-type-selection": "slides-page-type-selection",
      // 审核类
      "terminology-unifier": "slides-terminology-unifier",
      "transition-checker": "slides-transition-checker",
      "quality-audit": "slides-quality-audit",
      // 已带前缀的
      "slides-task-decomposition": "slides-task-decomposition",
      "slides-outline-planning": "slides-outline-planning",
      "slides-four-step-design": "slides-four-step-design",
      "slides-page-pipeline": "slides-page-pipeline",
      "slides-quality-audit": "slides-quality-audit",
    };

    // 4. 尝试映射
    if (skillMapping[normalized]) {
      return skillMapping[normalized];
    }

    // 5. 如果没有映射，尝试添加 slides- 前缀
    if (!normalized.startsWith("slides-")) {
      const withPrefix = `slides-${normalized}`;
      if (skillMapping[withPrefix]) {
        return skillMapping[withPrefix];
      }
      // 返回带前缀的版本，让 SkillRegistry 去验证
      return withPrefix;
    }

    return normalized;
  }

  createDefaultTasks(): TaskBreakdownItem[] {
    return [
      {
        title: "任务分解",
        description: "分析源文本，分解为章节和页面任务",
        assignee: "analyst",
        skillId: "slides-task-decomposition",
        priority: "high",
        dependsOn: [],
        inputSpec: {},
      },
      {
        title: "生成大纲",
        description: "基于任务分解生成详细的页面大纲",
        assignee: "analyst",
        skillId: "slides-outline-planning",
        priority: "high",
        dependsOn: [0], // 依赖 task-decomposition
        inputSpec: {},
      },
      {
        title: "生成页面内容",
        description: "根据大纲逐页生成 HTML 内容",
        assignee: "writer",
        skillId: "slides-page-pipeline",
        priority: "high",
        dependsOn: [1], // 依赖 outline-planning
        inputSpec: {},
      },
    ];
  }

  createTasksFromBreakdown(breakdown: TaskBreakdown): SlidesTask[] {
    const tasks: SlidesTask[] = [];

    for (let i = 0; i < breakdown.tasks.length; i++) {
      const item = breakdown.tasks[i];

      const task: SlidesTask = {
        id: uuidv4(),
        title: item.title,
        description: item.description,
        assignee: item.assignee,
        skillId: item.skillId,
        input: item.inputSpec,
        dependencies: item.dependsOn
          .map((idx) => tasks[idx]?.id)
          .filter(Boolean),
        status: "pending",
        priority: item.priority,
        revisionCount: 0,
        maxRevisions: 3,
        createdAt: new Date(),
      };

      tasks.push(task);
    }

    return tasks;
  }

  // ============================================
  // 任务审核
  // ============================================

  async reviewTask(
    mission: SlidesMission,
    task: SlidesTask,
    result: unknown,
  ): Promise<ReviewResult> {
    this.logger.log(`[reviewTask] Reviewing task ${task.id}: ${task.title}`);

    const systemPrompt = this.getLeaderReviewSystemPrompt();
    const userPrompt = this.buildReviewPrompt(mission, task, result);

    const response = await this.callAI(systemPrompt, userPrompt, {
      outputLength: "short", // 审核输出较短
    });

    const reviewResult = this.parseReviewResult(response);

    this.logger.log(
      `[reviewTask] Review decision for task ${task.id}: ${reviewResult.decision}`,
    );

    return reviewResult;
  }

  private getLeaderReviewSystemPrompt(): string {
    return `你是 Slides Architect，正在审核团队成员提交的任务结果。

## 审核标准
1. **完整性**: 是否完成了任务要求
2. **质量**: 输出质量是否达标
3. **一致性**: 是否与整体风格一致
4. **准确性**: 内容是否准确无误

## 输出格式
请使用以下格式输出审核结果：

### 决定
approved / revision_needed / failed

### 评分
[0-100 分数]

### 反馈
[详细反馈]

### 建议
- [建议1]
- [建议2]
`;
  }

  private buildReviewPrompt(
    mission: SlidesMission,
    task: SlidesTask,
    result: unknown,
  ): string {
    return `## 审核任务

**任务标题**: ${task.title}
**任务描述**: ${task.description}
**负责人**: ${task.assignee}
**技能**: ${task.skillId}
**修订次数**: ${task.revisionCount}/${task.maxRevisions}

## 任务结果
\`\`\`json
${JSON.stringify(result, null, 2).substring(0, 4000)}
\`\`\`

## Mission 上下文
**用户需求**: ${mission.userRequirement || "生成专业的 PPT"}
**风格偏好**: ${mission.stylePreference || "dark"}

请审核此任务结果，并给出审核决定。
`;
  }

  private parseReviewResult(response: string): ReviewResult {
    const result: ReviewResult = {
      decision: "approved",
      feedback: "",
      suggestions: [],
    };

    // 提取决定
    const decisionMatch = response.match(
      /### 决定\s*\n(approved|revision_needed|failed)/i,
    );
    if (decisionMatch) {
      result.decision = decisionMatch[1].toLowerCase() as ReviewDecision;
    }

    // 提取评分
    const scoreMatch = response.match(/### 评分\s*\n(\d+)/);
    if (scoreMatch) {
      result.score = parseInt(scoreMatch[1]);
    }

    // 提取反馈
    const feedbackMatch = response.match(/### 反馈\s*\n([\s\S]*?)(?=###|$)/);
    if (feedbackMatch) {
      result.feedback = feedbackMatch[1].trim();
    }

    // 提取建议
    const suggestionsMatch = response.match(/### 建议\s*\n([\s\S]*?)(?=###|$)/);
    if (suggestionsMatch) {
      const suggestions = suggestionsMatch[1]
        .split("\n")
        .filter((line) => line.trim().startsWith("-"))
        .map((line) => line.replace(/^-\s*/, "").trim());
      result.suggestions = suggestions;
    }

    return result;
  }

  // ============================================
  // 结果综合
  // ============================================

  async synthesizeResults(
    mission: SlidesMission,
  ): Promise<{ success: boolean; summary: string }> {
    this.logger.log(
      `[synthesizeResults] Synthesizing results for mission ${mission.id}`,
    );

    const completedTasks = mission.tasks.filter(
      (t) => t.status === "completed",
    );
    const totalPages = mission.pages.length;

    const systemPrompt = `你是 Slides Architect，正在综合 PPT 生成的所有结果。

请简要总结生成结果，包括：
1. 完成情况
2. 亮点
3. 待优化点
`;

    const userPrompt = `## Mission 综合

**任务数**: ${completedTasks.length}/${mission.tasks.length} 已完成
**页面数**: ${totalPages}
**用户需求**: ${mission.userRequirement || "生成专业的 PPT"}

请综合生成结果，输出简短的总结。
`;

    const response = await this.callAI(systemPrompt, userPrompt, {
      outputLength: "short", // 总结输出较短
    });

    return {
      success: true,
      summary: response,
    };
  }
}
