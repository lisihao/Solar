/**
 * Story Architect Agent - 故事架构师
 *
 * Leader 角色，负责：
 * - 整体规划：制定故事大纲、卷章结构、核心剧情线
 * - 任务分配：将写作任务分解并分配给合适的 Agent
 * - 质量把控：审核各 Agent 产出，确保符合项目目标
 * - 一致性监督：确保 Story Bible 被正确使用和更新
 */

import { Injectable } from "@nestjs/common";
import { BaseAgent } from "@/modules/ai-harness/facade";
import { type TaskProfile } from "@/modules/ai-harness/facade";
import {
  type ExecutionMode,
  BUILTIN_TOOLS,
  type AgentContext,
  type AgentCapability,
} from "@/modules/ai-harness/facade";
import { WritingContextPackage } from "../interfaces/writing-context.interface";
// 增强：注入质量门禁服务用于审核
import { WritingQualityGateService } from "../services/quality/quality-gate.service";

// ==================== 输入输出类型 ====================

export interface StoryArchitectInput {
  /** 任务类型 */
  taskType:
    | "plan_story" // 规划整体故事
    | "plan_volume" // 规划单卷
    | "decompose_chapters" // 分解章节任务
    | "review_chapter" // 审核章节
    | "resolve_conflict"; // 解决一致性冲突

  /** 项目ID */
  projectId: string;

  /** 写作上下文包 */
  contextPackage: WritingContextPackage;

  /** 任务特定输入 */
  payload: {
    /** 故事规划：用户需求 */
    userRequirements?: string;
    /** 卷规划：卷号和概要 */
    volumeInfo?: {
      volumeNumber: number;
      synopsis?: string;
      targetChapters?: number;
    };
    /** 章节审核：章节内容和一致性报告 */
    reviewData?: {
      chapterId: string;
      content: string;
      consistencyReport?: {
        issues: Array<{
          type: string;
          description: string;
          severity: string;
        }>;
      };
    };
    /** 冲突解决：冲突列表 */
    conflicts?: Array<{
      type: string;
      description: string;
      options: string[];
    }>;
  };
}

export interface StoryArchitectOutput {
  /** 任务类型 */
  taskType: string;
  /** 是否成功 */
  success: boolean;
  /** 结果 */
  result: {
    /** 故事大纲 */
    storyOutline?: {
      premise: string;
      theme: string;
      structure: Array<{
        volumeNumber: number;
        title: string;
        synopsis: string;
        keyEvents: string[];
      }>;
    };
    /** 章节分解 */
    chapterBreakdown?: Array<{
      chapterNumber: number;
      title: string;
      outline: string;
      involvedCharacters: string[];
      keyEvents: string[];
      dependsOn: string[];
      canParallel: boolean;
    }>;
    /** 审核结果 */
    reviewResult?: {
      approved: boolean;
      feedback: string;
      requiredChanges?: string[];
      newEstablishedFacts?: Array<{
        statement: string;
        category: string;
        relatedEntities: string[];
      }>;
    };
    /** 冲突解决方案 */
    conflictResolution?: Array<{
      conflictId: string;
      chosenOption: string;
      reasoning: string;
    }>;
  };
  /** 建议的下一步 */
  nextSteps?: string[];
}

// ==================== Agent 实现 ====================

@Injectable()
export class StoryArchitectAgent extends BaseAgent<
  StoryArchitectInput,
  StoryArchitectOutput
> {
  readonly id = "story-architect";
  readonly name = "Story Architect";
  readonly description =
    "故事架构师 - 负责整体规划、任务分配、质量把控和一致性监督";

  readonly supportedModes: ExecutionMode[] = ["plan-based", "hybrid"];

  readonly capabilities: AgentCapability[] = [
    {
      id: "story-planning",
      name: "Story Planning",
      description: "制定故事大纲、卷章结构、核心剧情线",
      category: "planning",
    },
    {
      id: "task-decomposition",
      name: "Task Decomposition",
      description: "将写作任务分解并分配给合适的 Agent",
      category: "orchestration",
    },
    {
      id: "quality-review",
      name: "Quality Review",
      description: "审核各 Agent 产出，确保符合项目目标",
      category: "analysis",
    },
    {
      id: "consistency-supervision",
      name: "Consistency Supervision",
      description: "确保 Story Bible 被正确使用和更新",
      category: "validation",
    },
  ];

  readonly requiredTools = [
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.TASK_DELEGATION,
    BUILTIN_TOOLS.WORKFLOW_ORCHESTRATION,
  ];

  constructor(private readonly qualityGate: WritingQualityGateService) {
    super();
  }

  /**
   * 核心执行逻辑
   */
  protected async doExecute(
    input: StoryArchitectInput,
    context: AgentContext,
  ): Promise<StoryArchitectOutput> {
    this.logger.log(
      `[StoryArchitect] Executing task: ${input.taskType} for project ${input.projectId}`,
    );

    switch (input.taskType) {
      case "plan_story":
        return this.planStory(input, context);
      case "plan_volume":
        return this.planVolume(input, context);
      case "decompose_chapters":
        return this.decomposeChapters(input, context);
      case "review_chapter":
        return this.reviewChapter(input, context);
      case "resolve_conflict":
        return this.resolveConflict(input, context);
      default:
        throw new Error(`Unknown task type: ${input.taskType}`);
    }
  }

  /**
   * 规划整体故事
   */
  private async planStory(
    input: StoryArchitectInput,
    _context: AgentContext,
  ): Promise<StoryArchitectOutput> {
    const { contextPackage, payload } = input;
    const storyBible = contextPackage.extensions.storyBible;

    const _systemPrompt = this.buildPlanningSystemPrompt();
    void _systemPrompt; // Suppress unused warning
    const userPrompt = this.buildStoryPlanningPrompt(
      payload.userRequirements || "",
      storyBible,
    );

    // 使用 TaskProfile 语义化描述任务特征
    const taskProfile: TaskProfile = {
      creativity: "medium", // 故事规划需要平衡创造性和结构性 (原 temperature: 0.7)
      outputLength: "standard", // 规划结果需要标准长度 (原 maxTokens: 4096)
    };

    const response = await this.callLLM(
      this.buildMessages(userPrompt, { ..._context, memory: undefined }),
      {
        taskProfile,
      },
    );

    const outline = this.parseJsonResponse<
      StoryArchitectOutput["result"]["storyOutline"]
    >(response.content || "", {
      premise: storyBible.premise || "",
      theme: storyBible.theme || "",
      structure: [],
    });

    return {
      taskType: "plan_story",
      success: true,
      result: { storyOutline: outline },
      nextSteps: ["创建各卷详细规划", "完善 Story Bible"],
    };
  }

  /**
   * 规划单卷
   */
  private async planVolume(
    input: StoryArchitectInput,
    _context: AgentContext,
  ): Promise<StoryArchitectOutput> {
    const { contextPackage, payload } = input;
    const volumeInfo = payload.volumeInfo;

    if (!volumeInfo) {
      throw new Error("Volume info is required for plan_volume task");
    }

    const _systemPrompt = this.buildPlanningSystemPrompt();
    const userPrompt = `
## 任务：规划第${volumeInfo.volumeNumber}卷章节

### 卷概要
${volumeInfo.synopsis || "无"}

### 目标章节数
${volumeInfo.targetChapters || 20}章

### Story Bible 角色
${this.formatCharactersForPrompt(contextPackage.extensions.storyBible.characters)}

### 要求
1. 为每个章节创建标题和大纲
2. 标注涉及的主要角色
3. 标注关键事件
4. 分析章节依赖关系，标注可以并行写作的章节
5. **重要：如果故事已有明确结局标记（如"全书完"、"大结局"、"（完）"等），不要继续规划新章节**

请以 JSON 格式输出章节分解结果。
`;

    const response = await this.callLLM([
      { role: "system", content: _systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    const breakdown = this.parseJsonResponse<
      StoryArchitectOutput["result"]["chapterBreakdown"]
    >(response.content || "", []);

    return {
      taskType: "plan_volume",
      success: true,
      result: { chapterBreakdown: breakdown },
      nextSteps: ["开始章节写作", "分配并行任务"],
    };
  }

  /**
   * 分解章节任务
   */
  private async decomposeChapters(
    input: StoryArchitectInput,
    _context: AgentContext,
  ): Promise<StoryArchitectOutput> {
    const { contextPackage } = input;
    const storyBible = contextPackage.extensions.storyBible;

    // 分析章节依赖关系
    const systemPrompt = `你是一位故事架构师，负责分析章节之间的依赖关系。

## 依赖关系判断标准
- 如果章节B需要知道章节A中发生的事件结果，则B依赖A
- 如果章节B的角色状态依赖于章节A的变化，则B依赖A
- 如果两个章节发生在不同地点、涉及不同角色且时间上可以并行，则可以并行写作

## 输出格式
请输出 JSON 格式的章节分解，包含依赖关系和并行标记。`;

    const userPrompt = `
请分析以下章节的依赖关系：

### 角色列表
${storyBible.characters.map((c) => `- ${c.name} (${c.role})`).join("\n")}

### 已规划章节
${contextPackage.extensions.chapterContext ? JSON.stringify(contextPackage.extensions.chapterContext.chapter) : "无"}

请输出章节分解结果。
`;

    const response = await this.callLLM([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    const breakdown = this.parseJsonResponse<
      StoryArchitectOutput["result"]["chapterBreakdown"]
    >(response.content || "", []);

    return {
      taskType: "decompose_chapters",
      success: true,
      result: { chapterBreakdown: breakdown },
    };
  }

  /**
   * 审核章节（增强版：集成质量门禁）
   */
  private async reviewChapter(
    input: StoryArchitectInput,
    _context: AgentContext,
  ): Promise<StoryArchitectOutput> {
    const { contextPackage, payload, projectId } = input;
    const reviewData = payload.reviewData;

    if (!reviewData) {
      throw new Error("Review data is required for review_chapter task");
    }

    // ★ 增强：先执行质量门禁检查
    let qualityGateInfo = "";
    try {
      const chapterNumber =
        contextPackage.extensions.chapterContext?.chapter?.chapterNumber || 1;
      const qualityResult = await this.qualityGate.checkQualityGate(
        projectId,
        reviewData.chapterId,
        chapterNumber,
        reviewData.content,
        0,
      );

      this.logger.log(
        `[StoryArchitect] Quality gate for chapter ${reviewData.chapterId}: passed=${qualityResult.passed}, issues=${qualityResult.issues.length}`,
      );

      qualityGateInfo = `
### 质量门禁检查结果
- 通过状态: ${qualityResult.passed ? "✓ 通过" : "✗ 未通过"}
- 综合评分: ${qualityResult.scores.overallScore.toFixed(1)}/100
- 多样性: ${qualityResult.scores.diversityScore.toFixed(2)}
- 角色一致性: ${qualityResult.scores.characterConsistency.toFixed(2)}
- 发现问题数: ${qualityResult.issues.length}
${
  qualityResult.issues.length > 0
    ? "\n问题列表:\n" +
      qualityResult.issues
        .slice(0, 5)
        .map((i) => `- [${i.severity}] ${i.description}`)
        .join("\n")
    : ""
}
`;
    } catch (error) {
      this.logger.warn(`[StoryArchitect] Quality gate check failed: ${error}`);
      qualityGateInfo = "\n### 质量门禁检查\n检查失败，跳过质量评估\n";
    }

    const systemPrompt = this.buildReviewSystemPrompt();
    const userPrompt = `
## 审核章节内容

### 章节ID
${reviewData.chapterId}

### 章节内容
${reviewData.content.slice(0, 3000)}${reviewData.content.length > 3000 ? "...(已截断)" : ""}

### 一致性检查报告
${reviewData.consistencyReport ? JSON.stringify(reviewData.consistencyReport.issues, null, 2) : "无问题"}
${qualityGateInfo}
### Story Bible 约束
${contextPackage.hardConstraints.map((c) => `- [${c.severity}] ${c.rule}`).join("\n")}

### 已确立事实
${(contextPackage.establishedFacts || [])
  .slice(-10)
  .map((f) => `- ${f.statement}`)
  .join("\n")}

请综合质量门禁结果和一致性检查报告，审核章节内容，判断是否符合要求，并提取需要记录的新事实。

输出 JSON 格式：
{
  "approved": true/false,
  "feedback": "审核意见",
  "requiredChanges": ["需要修改的地方"],
  "newEstablishedFacts": [
    { "statement": "新确立的事实", "category": "entity_state|sequence_point|decision", "relatedEntities": ["角色名"] }
  ]
}
`;

    const response = await this.callLLM([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    const reviewResult = this.parseJsonResponse<
      StoryArchitectOutput["result"]["reviewResult"]
    >(response.content || "", {
      approved: false,
      feedback: "无法解析审核结果",
    });

    return {
      taskType: "review_chapter",
      success: true,
      result: { reviewResult },
      nextSteps: reviewResult?.approved
        ? ["章节已通过，继续下一章"]
        : ["需要修订后重新提交"],
    };
  }

  /**
   * 解决一致性冲突
   */
  private async resolveConflict(
    input: StoryArchitectInput,
    _context: AgentContext,
  ): Promise<StoryArchitectOutput> {
    const { contextPackage, payload } = input;
    const conflicts = payload.conflicts;

    if (!conflicts || conflicts.length === 0) {
      return {
        taskType: "resolve_conflict",
        success: true,
        result: { conflictResolution: [] },
      };
    }

    const systemPrompt = `你是故事架构师，负责解决写作中的一致性冲突。

## 解决原则
1. 优先保持与 Story Bible 的一致性
2. 优先保持与已确立事实的一致性
3. 选择对故事发展更有利的选项
4. 如果都可以，选择更简单的修改方案`;

    const userPrompt = `
## 需要解决的冲突

${conflicts
  .map(
    (c, i) => `
### 冲突 ${i + 1}
类型：${c.type}
描述：${c.description}
选项：
${c.options.map((o, j) => `  ${j + 1}. ${o}`).join("\n")}
`,
  )
  .join("\n")}

### Story Bible 约束
${contextPackage.hardConstraints.map((c) => `- ${c.rule}`).join("\n")}

请为每个冲突选择解决方案，输出 JSON 格式。
`;

    const response = await this.callLLM([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    const resolution = this.parseJsonResponse<
      StoryArchitectOutput["result"]["conflictResolution"]
    >(response.content || "", []);

    return {
      taskType: "resolve_conflict",
      success: true,
      result: { conflictResolution: resolution },
    };
  }

  // ==================== 辅助方法 ====================

  private buildPlanningSystemPrompt(): string {
    return `你是一位专业的故事架构师，负责整体规划和协调 AI 写作团队。

## 核心职责
1. 项目规划：制定故事大纲、卷章结构、核心剧情线
2. 任务分配：将写作任务分解并分配给合适的 Agent
3. 质量把控：审核各 Agent 产出，确保符合项目目标
4. 一致性监督：确保 Story Bible 被正确使用和更新

## 工作原则
- 每个决策都要考虑对整体故事的影响
- 重大剧情变化必须更新 Story Bible
- 发现一致性问题时优先解决而非忽略
- 尽可能让章节可以并行写作以提高效率

## 输出要求
- 始终输出结构化的 JSON 格式
- 确保输出内容完整、可执行`;
  }

  private buildReviewSystemPrompt(): string {
    return `你是故事架构师，正在审核 Writer Agent 提交的章节内容。

## 审核维度
1. 角色一致性：外貌、性格、能力、说话方式是否与 Story Bible 一致
2. 时间线一致性：事件顺序、时间跨度是否合理
3. 世界观一致性：规则、地理、势力关系是否正确
4. 术语一致性：专有名词使用是否统一
5. 剧情逻辑：因果关系、动机是否合理

## 审核原则
- CRITICAL 问题必须修改后才能通过
- WARNING 问题建议修改
- 如果内容符合所有约束，应该批准通过
- 提取章节中确立的新事实，用于后续章节的一致性检查`;
  }

  private buildStoryPlanningPrompt(
    userRequirements: string,
    storyBible: WritingContextPackage["extensions"]["storyBible"],
  ): string {
    return `
## 任务：规划故事整体结构

### 用户需求
${userRequirements}

### 当前设定
- 前提：${storyBible.premise || "未设定"}
- 主题：${storyBible.theme || "未设定"}
- 基调：${storyBible.tone || "未设定"}
- 世界类型：${storyBible.worldType || "未设定"}

### 主要角色
${this.formatCharactersForPrompt(storyBible.characters)}

### 要求
请规划故事的整体结构，包括：
1. 核心前提（一句话概括）
2. 主题思想
3. 卷章结构（每卷的标题、概要、关键事件）

请以 JSON 格式输出。
`;
  }

  private formatCharactersForPrompt(
    characters: WritingContextPackage["extensions"]["storyBible"]["characters"],
  ): string {
    return characters
      .map((c) => `- ${c.name} (${c.role}): ${c.definition}`)
      .join("\n");
  }
}
