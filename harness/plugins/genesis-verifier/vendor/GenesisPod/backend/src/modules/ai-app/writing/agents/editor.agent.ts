/**
 * Editor Agent - 编辑 Agent
 *
 * 负责修订和润色章节内容：
 * - 问题修复：根据 Consistency Checker 的报告修正问题
 * - 文字润色：提升文字质量和可读性
 * - 风格统一：确保全篇风格一致
 * - 最终审核：提交前的最后检查
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
import { ConsistencyIssue } from "./consistency-checker.agent";
// 增强：注入质量服务
import {
  WritingQualityGateService,
  QualityGateResult,
} from "../services/quality/quality-gate.service";
import { ChapterQualityEvaluatorService } from "../services/quality/chapter-quality-evaluator.service";

// ==================== 输入输出类型 ====================

export interface EditorInput {
  /** 操作类型 */
  operation:
    | "fix_issues" // 修复一致性问题
    | "polish" // 润色文字
    | "unify_style" // 统一风格
    | "final_review"; // 最终审核

  /** 章节ID */
  chapterId: string;

  /** 原始内容 */
  content: string;

  /** 写作上下文包 */
  contextPackage: WritingContextPackage;

  /** 操作特定参数 */
  params: {
    /** 需要修复的问题 */
    issues?: ConsistencyIssue[];
    /** Leader 反馈 */
    leaderFeedback?: string;
    /** 目标风格 */
    targetStyle?: {
      tone?: string;
      vocabulary?: string;
      sentenceLength?: string;
    };
    /** 润色级别 */
    polishLevel?: "light" | "moderate" | "heavy";
  };
}

export interface EditorOutput {
  /** 章节ID */
  chapterId: string;
  /** 操作类型 */
  operation: string;
  /** 是否成功 */
  success: boolean;
  /** 修订后的内容 */
  revisedContent: string;
  /** 修改摘要 */
  changes: Array<{
    type: string;
    description: string;
    before?: string;
    after?: string;
  }>;
  /** 修改统计 */
  stats: {
    totalChanges: number;
    fixedIssues: number;
    wordCountBefore: number;
    wordCountAfter: number;
  };
  /** 编辑备注 */
  notes?: string[];
}

// ==================== Agent 实现 ====================

@Injectable()
export class EditorAgent extends BaseAgent<EditorInput, EditorOutput> {
  readonly id = "editor-agent";
  readonly name = "Editor Agent";
  readonly description = "编辑 Agent - 修复问题、润色文字、统一风格、最终审核";

  readonly supportedModes: ExecutionMode[] = ["reactive", "hybrid"];

  readonly capabilities: AgentCapability[] = [
    {
      id: "issue-fixing",
      name: "Issue Fixing",
      description: "根据 Consistency Checker 的报告修正问题",
      category: "editing",
    },
    {
      id: "text-polishing",
      name: "Text Polishing",
      description: "提升文字质量和可读性",
      category: "editing",
    },
    {
      id: "style-unification",
      name: "Style Unification",
      description: "确保全篇风格一致",
      category: "editing",
    },
    {
      id: "final-review",
      name: "Final Review",
      description: "提交前的最后检查（含质量门禁）",
      category: "validation",
    },
  ];

  readonly requiredTools = [
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.EXPORT_DOCX,
  ];

  constructor(
    private readonly qualityGate: WritingQualityGateService,
    private readonly chapterQualityEvaluator: ChapterQualityEvaluatorService,
  ) {
    super();
  }

  /**
   * 核心执行逻辑
   */
  protected async doExecute(
    input: EditorInput,
    context: AgentContext,
  ): Promise<EditorOutput> {
    this.logger.log(
      `[Editor] Executing ${input.operation} for chapter ${input.chapterId}`,
    );

    switch (input.operation) {
      case "fix_issues":
        return this.fixIssues(input, context);
      case "polish":
        return this.polishContent(input, context);
      case "unify_style":
        return this.unifyStyle(input, context);
      case "final_review":
        return this.finalReview(input, context);
      default:
        throw new Error(`Unknown operation: ${input.operation}`);
    }
  }

  /**
   * 修复一致性问题
   */
  private async fixIssues(
    input: EditorInput,
    _context: AgentContext,
  ): Promise<EditorOutput> {
    const { chapterId, content, contextPackage, params } = input;
    const issues = params.issues || [];

    if (issues.length === 0) {
      return {
        chapterId,
        operation: "fix_issues",
        success: true,
        revisedContent: content,
        changes: [],
        stats: {
          totalChanges: 0,
          fixedIssues: 0,
          wordCountBefore: this.countWords(content),
          wordCountAfter: this.countWords(content),
        },
        notes: ["无需修复的问题"],
      };
    }

    // 按严重程度排序，优先修复 CRITICAL
    const sortedIssues = [...issues].sort((a, b) => {
      const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    const systemPrompt = this.buildFixIssuesSystemPrompt(contextPackage);

    const userPrompt = `## 待修复的章节内容
${content}

## 需要修复的问题（按优先级排序）
${sortedIssues
  .map(
    (issue, i) => `
### 问题 ${i + 1} [${issue.severity}]
- 类型: ${issue.type}
- 位置: ${issue.location}
- 描述: ${issue.description}
- 期望: ${issue.expected || "无"}
- 实际: ${issue.found || "无"}
- 建议: ${issue.suggestion || "无"}
`,
  )
  .join("\n")}

${params.leaderFeedback ? `## Leader 反馈\n${params.leaderFeedback}` : ""}

请修复以上问题，保持内容流畅。直接输出修复后的完整章节内容。`;

    // 使用 TaskProfile 语义化描述任务特征
    const taskProfile: TaskProfile = {
      creativity: "medium", // 问题修复需要适度创造性 (原 temperature: 0.5)
      outputLength: "long", // 章节内容较长 (原 maxTokens: 8192)
    };

    const response = await this.callLLM(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        taskProfile,
      },
    );

    const revisedContent = response.content || content;

    // 记录修改
    const changes = sortedIssues.map((issue) => ({
      type: `fix_${issue.type.toLowerCase()}`,
      description: `修复 ${issue.severity} 级别的 ${issue.type} 问题: ${issue.description}`,
    }));

    return {
      chapterId,
      operation: "fix_issues",
      success: true,
      revisedContent,
      changes,
      stats: {
        totalChanges: changes.length,
        fixedIssues: issues.length,
        wordCountBefore: this.countWords(content),
        wordCountAfter: this.countWords(revisedContent),
      },
      notes: [`已修复 ${issues.length} 个问题`],
    };
  }

  /**
   * 润色内容
   */
  private async polishContent(
    input: EditorInput,
    _context: AgentContext,
  ): Promise<EditorOutput> {
    const { chapterId, content, contextPackage, params } = input;
    const polishLevel = params.polishLevel || "moderate";

    const systemPrompt = `你是专业的文字编辑，负责润色小说内容。

## 润色级别: ${polishLevel}
${polishLevel === "light" ? "- 只修正明显的语法错误和错别字\n- 保持原文风格不变" : ""}
${polishLevel === "moderate" ? "- 修正语法错误和错别字\n- 优化不通顺的句子\n- 适当增强描写" : ""}
${polishLevel === "heavy" ? "- 全面优化文字质量\n- 增强描写和对话\n- 提升文学性" : ""}

## 写作风格
${JSON.stringify(contextPackage.extensions.storyBible.writingStyle || {}, null, 2)}

## 润色原则
- 保持故事情节不变
- 保持角色性格一致
- 保持叙事视角一致
- 不改变关键情节和对话内容`;

    const userPrompt = `请润色以下章节内容：

${content}

直接输出润色后的完整内容。`;

    // 使用 TaskProfile 语义化描述任务特征
    const taskProfile: TaskProfile = {
      creativity: "medium", // 润色需要适度创造性 (原 temperature: 0.6)
      outputLength: "long", // 章节内容较长 (原 maxTokens: 8192)
    };

    const response = await this.callLLM(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        taskProfile,
      },
    );

    const revisedContent = response.content || content;

    return {
      chapterId,
      operation: "polish",
      success: true,
      revisedContent,
      changes: [
        {
          type: "polish",
          description: `${polishLevel} 级别润色`,
        },
      ],
      stats: {
        totalChanges: 1,
        fixedIssues: 0,
        wordCountBefore: this.countWords(content),
        wordCountAfter: this.countWords(revisedContent),
      },
    };
  }

  /**
   * 统一风格
   */
  private async unifyStyle(
    input: EditorInput,
    _context: AgentContext,
  ): Promise<EditorOutput> {
    const { chapterId, content, contextPackage, params } = input;
    const targetStyle =
      params.targetStyle || contextPackage.extensions.storyBible.writingStyle;

    const systemPrompt = `你是专业的文字编辑，负责统一小说的写作风格。

## 目标风格
- 基调: ${"自然流畅"}
- 词汇水平: ${targetStyle?.vocabulary || "intermediate"}
- 句子长度: ${targetStyle?.sentenceLength || "medium"}

## 统一原则
- 保持情节内容不变
- 调整语言风格以符合目标
- 确保全篇风格一致`;

    const userPrompt = `请将以下内容调整为统一风格：

${content}

直接输出调整后的完整内容。`;

    // 使用 TaskProfile 语义化描述任务特征
    const taskProfile: TaskProfile = {
      creativity: "medium", // 风格统一需要适度创造性 (原 temperature: 0.5)
      outputLength: "long", // 章节内容较长 (原 maxTokens: 8192)
    };

    const response = await this.callLLM(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        taskProfile,
      },
    );

    const revisedContent = response.content || content;

    return {
      chapterId,
      operation: "unify_style",
      success: true,
      revisedContent,
      changes: [
        {
          type: "style_unification",
          description: "风格统一调整",
        },
      ],
      stats: {
        totalChanges: 1,
        fixedIssues: 0,
        wordCountBefore: this.countWords(content),
        wordCountAfter: this.countWords(revisedContent),
      },
    };
  }

  /**
   * 最终审核（增强版：集成质量门禁和多维度评估）
   */
  private async finalReview(
    input: EditorInput,
    _context: AgentContext,
  ): Promise<EditorOutput> {
    const { chapterId, content, contextPackage } = input;

    // ★ 步骤1：快速质量评估（规则检测，零成本）
    const chapterNumber =
      contextPackage.extensions.chapterContext?.chapter?.chapterNumber || 1;
    const quickEvaluation = this.chapterQualityEvaluator.quickEvaluate(
      content,
      chapterNumber,
    );

    this.logger.log(
      `[Editor] Quick evaluation: score=${quickEvaluation.overallScore}, grade=${quickEvaluation.grade}`,
    );

    // ★ 步骤2：质量门禁检查（深度检测）
    const projectId = contextPackage.extensions.storyBible.projectId;
    let qualityGateResult: QualityGateResult | null = null;

    try {
      qualityGateResult = await this.qualityGate.checkQualityGate(
        projectId,
        chapterId,
        chapterNumber,
        content,
        0, // 首次检查
      );

      this.logger.log(
        `[Editor] Quality gate: passed=${qualityGateResult.passed}, issues=${qualityGateResult.issues.length}`,
      );
    } catch (error) {
      this.logger.warn(`[Editor] Quality gate check failed: ${error}`);
    }

    // ★ 步骤3：收集所有质量问题
    const allIssues: Array<{ type: string; description: string }> = [];

    // 从快速评估收集问题
    if (quickEvaluation.writingQuality) {
      for (const [, dimension] of Object.entries(
        quickEvaluation.writingQuality,
      )) {
        for (const issue of dimension.issues) {
          allIssues.push({ type: "writing_quality", description: issue });
        }
      }
    }
    if (quickEvaluation.contentQuality) {
      for (const [, dimension] of Object.entries(
        quickEvaluation.contentQuality,
      )) {
        for (const issue of dimension.issues) {
          allIssues.push({ type: "content_quality", description: issue });
        }
      }
    }

    // 从质量门禁收集问题
    if (qualityGateResult) {
      for (const issue of qualityGateResult.issues) {
        allIssues.push({
          type: issue.type,
          description: `[${issue.severity}] ${issue.description}`,
        });
      }
    }

    // ★ 步骤4：基于问题进行 LLM 修正
    const systemPrompt = `你是专业的终审编辑，负责章节提交前的最后检查。

## 检查清单
1. 语法和错别字
2. 标点符号使用
3. 段落分割是否合理
4. 对话格式是否正确
5. 叙事流畅性
6. 结尾质量（禁止总结式/预告式结尾）

## 质量评估发现的问题
${allIssues.length > 0 ? allIssues.map((i) => `- [${i.type}] ${i.description}`).join("\n") : "无明显问题"}

## 输出要求
如果发现问题，直接修正并输出完整内容。
如果没有问题，直接输出原内容。
特别注意修正质量评估发现的问题。`;

    const userPrompt = `请进行最终审核：

${content}

直接输出审核/修正后的完整内容。`;

    const taskProfile: TaskProfile = {
      creativity: "low",
      outputLength: "long",
    };

    const response = await this.callLLM(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        taskProfile,
      },
    );

    const revisedContent = response.content || content;
    const hasChanges = revisedContent !== content;

    // ★ 步骤5：构建详细的审核结果
    const changes: EditorOutput["changes"] = [];
    if (hasChanges) {
      changes.push({ type: "final_review", description: "终审微调" });
    }
    for (const issue of allIssues.slice(0, 5)) {
      changes.push({
        type: `quality_fix_${issue.type}`,
        description: `质量修复: ${issue.description}`,
      });
    }

    const notes: string[] = [];
    if (quickEvaluation.overallScore !== undefined) {
      notes.push(
        `质量评分: ${quickEvaluation.overallScore}/100 (${quickEvaluation.grade}级)`,
      );
    }
    if (qualityGateResult) {
      notes.push(
        `质量门禁: ${qualityGateResult.passed ? "通过" : "未通过"}, 问题数: ${qualityGateResult.issues.length}`,
      );
    }
    if (hasChanges) {
      notes.push("终审发现并修正了一些问题");
    } else {
      notes.push("终审通过，无需修改");
    }

    return {
      chapterId,
      operation: "final_review",
      success: true,
      revisedContent,
      changes,
      stats: {
        totalChanges: changes.length,
        fixedIssues: allIssues.length,
        wordCountBefore: this.countWords(content),
        wordCountAfter: this.countWords(revisedContent),
      },
      notes,
    };
  }

  /**
   * 构建修复问题的系统提示词
   */
  private buildFixIssuesSystemPrompt(
    contextPackage: WritingContextPackage,
  ): string {
    const storyBible = contextPackage.extensions.storyBible;

    return `你是专业的文字编辑，负责修复小说中的一致性问题。

## 修复原则
1. 优先解决 CRITICAL 问题
2. 修改时保持作者原意
3. 重大改动需要自然过渡
4. 保持章节间的连贯性

## Story Bible 设定摘要
- 主要角色: ${storyBible.characters.map((c) => c.name).join(", ")}
- 世界类型: ${storyBible.worldType || "未指定"}
- 写作风格: ${JSON.stringify(storyBible.writingStyle || {})}

## 硬性约束
${contextPackage.hardConstraints.map((c) => `- [${c.severity}] ${c.rule}`).join("\n")}

## 已确立事实（必须保持一致）
${(contextPackage.establishedFacts || [])
  .filter((f) => f.importance === "high")
  .slice(-10)
  .map((f) => `- ${f.statement}`)
  .join("\n")}`;
  }

  /**
   * 计算字数
   */
  private countWords(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = text
      .replace(/[\u4e00-\u9fa5]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
    return chineseChars + englishWords;
  }
}
