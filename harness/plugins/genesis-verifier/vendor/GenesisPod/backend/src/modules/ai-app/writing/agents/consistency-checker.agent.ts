/**
 * Consistency Checker Agent - 一致性检查 Agent
 *
 * 负责确保写作内容与 Story Bible 保持一致：
 * - 角色一致性：外貌、性格、能力、说话方式
 * - 时间线一致性：事件顺序、时间跨度
 * - 世界观一致性：规则、地理、势力关系
 * - 术语一致性：专有名词使用
 * - 剧情逻辑：因果关系、动机合理性
 *
 * 支持多实例并行，用于批量检查多个章节。
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
// 增强：集成语义一致性服务
import {
  SemanticConsistencyService,
  SemanticFact,
} from "../services/quality/semantic-consistency.service";

// ==================== 输入输出类型 ====================

export type ConsistencyCheckType =
  | "CHARACTER"
  | "TIMELINE"
  | "WORLD"
  | "TERMINOLOGY"
  | "PLOT";

export type IssueSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface ConsistencyIssue {
  /** 问题类型 */
  type: ConsistencyCheckType;
  /** 严重程度 */
  severity: IssueSeverity;
  /** 问题位置描述 */
  location: string;
  /** 问题描述 */
  description: string;
  /** 期望的内容（来自 Story Bible） */
  expected?: string;
  /** 实际的内容 */
  found?: string;
  /** 修改建议 */
  suggestion?: string;
  /** 相关实体 */
  relatedEntities?: string[];
}

export interface ConsistencyCheckerInput {
  /** 章节ID */
  chapterId: string;
  /** 章节内容 */
  content: string;
  /** 写作上下文包 */
  contextPackage: WritingContextPackage;
  /** 检查类型（可选，默认全部检查） */
  checkTypes?: ConsistencyCheckType[];
  /** 检查器实例ID（用于并行检查追踪） */
  checkerInstanceId?: number;
}

export interface ConsistencyCheckerOutput {
  /** 章节ID */
  chapterId: string;
  /** 检查状态 */
  status: "PASSED" | "ISSUES_FOUND";
  /** 发现的问题列表 */
  issues: ConsistencyIssue[];
  /** 按类型统计 */
  summary: {
    total: number;
    byType: Record<ConsistencyCheckType, number>;
    bySeverity: Record<IssueSeverity, number>;
  };
  /** 建议列表 */
  suggestions: string[];
  /** 提取的新事实（用于更新 establishedFacts） */
  extractedFacts?: Array<{
    statement: string;
    category: string;
    relatedEntities: string[];
    importance: "high" | "medium" | "low";
  }>;
}

// ==================== Agent 实现 ====================

@Injectable()
export class ConsistencyCheckerAgent extends BaseAgent<
  ConsistencyCheckerInput,
  ConsistencyCheckerOutput
> {
  readonly id = "consistency-checker";
  readonly name = "Consistency Checker";
  readonly description =
    "一致性检查 Agent - 确保写作内容与 Story Bible 保持一致";

  readonly supportedModes: ExecutionMode[] = ["reactive", "hybrid"];

  readonly capabilities: AgentCapability[] = [
    {
      id: "character-consistency",
      name: "Character Consistency",
      description: "检查角色外貌、性格、能力、说话方式的一致性",
      category: "validation",
    },
    {
      id: "timeline-consistency",
      name: "Timeline Consistency",
      description: "检查事件顺序、时间跨度的一致性",
      category: "validation",
    },
    {
      id: "world-consistency",
      name: "World Consistency",
      description: "检查规则、地理、势力关系的一致性",
      category: "validation",
    },
    {
      id: "fact-extraction",
      name: "Fact Extraction",
      description: "从章节内容提取需要记录的新事实",
      category: "analysis",
    },
  ];

  readonly requiredTools = [
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.RAG_SEARCH,
    BUILTIN_TOOLS.DATA_ANALYSIS,
  ];

  constructor(
    private readonly semanticConsistency: SemanticConsistencyService,
  ) {
    super();
  }

  /**
   * 核心执行逻辑（增强版：集成语义一致性检查）
   */
  protected async doExecute(
    input: ConsistencyCheckerInput,
    context: AgentContext,
  ): Promise<ConsistencyCheckerOutput> {
    const { chapterId, content, contextPackage, checkTypes } = input;

    this.logger.log(`[ConsistencyChecker] Checking chapter ${chapterId}`);

    const allIssues: ConsistencyIssue[] = [];
    const typesToCheck = checkTypes || [
      "CHARACTER",
      "TIMELINE",
      "WORLD",
      "TERMINOLOGY",
      "PLOT",
    ];

    // 并行执行各类型检查
    const checkPromises = typesToCheck.map((type) =>
      this.checkByType(type, content, contextPackage, context),
    );

    const results = await Promise.all(checkPromises);
    results.forEach((issues) => allIssues.push(...issues));

    // ★ 增强：语义一致性检查
    const semanticIssues = await this.checkSemanticConsistency(
      content,
      contextPackage,
    );
    allIssues.push(...semanticIssues);

    // 提取新事实
    const extractedFacts = await this.extractFacts(
      content,
      contextPackage,
      context,
    );

    // 构建统计
    const summary = this.buildSummary(allIssues);

    return {
      chapterId,
      status: allIssues.length > 0 ? "ISSUES_FOUND" : "PASSED",
      issues: allIssues,
      summary,
      suggestions: allIssues
        .map((i) => i.suggestion)
        .filter(Boolean) as string[],
      extractedFacts,
    };
  }

  /**
   * ★ 增强：语义一致性检查
   * 使用 SemanticConsistencyService 进行深度语义分析
   */
  private async checkSemanticConsistency(
    content: string,
    contextPackage: WritingContextPackage,
  ): Promise<ConsistencyIssue[]> {
    const issues: ConsistencyIssue[] = [];

    try {
      // 从 contextPackage 构建已确立事实
      const establishedFacts: SemanticFact[] = (
        contextPackage.establishedFacts || []
      ).map((f) => ({
        statement: f.statement,
        category: this.mapFactCategory(f.category),
        relatedEntities: f.relatedEntities || [],
        importance: f.importance,
      }));

      // 从角色设定构建角色事实
      const characterFacts: SemanticFact[] = [];
      for (const char of contextPackage.extensions.storyBible.characters) {
        // 外貌事实
        if (char.appearance) {
          const app = char.appearance;
          if (app.hair) {
            characterFacts.push({
              statement: `${char.name}的发色是${app.hair}`,
              category: "character",
              relatedEntities: [char.name],
              importance: "high",
            });
          }
          if (app.eyes) {
            characterFacts.push({
              statement: `${char.name}的眼睛颜色是${app.eyes}`,
              category: "character",
              relatedEntities: [char.name],
              importance: "high",
            });
          }
        }
        // 能力事实
        if (char.abilities && char.abilities.length > 0) {
          characterFacts.push({
            statement: `${char.name}拥有的能力：${char.abilities.join("、")}`,
            category: "ability",
            relatedEntities: [char.name],
            importance: "medium",
          });
        }
      }

      // 执行语义一致性检查
      const result = await this.semanticConsistency.checkSemanticConsistency(
        content,
        establishedFacts,
        characterFacts,
      );

      this.logger.log(
        `[ConsistencyChecker] Semantic check: passed=${result.passed}, conflicts=${result.conflicts.length}`,
      );

      // 将语义冲突转换为 ConsistencyIssue
      for (const conflict of result.conflicts) {
        issues.push({
          type: this.mapSemanticConflictType(conflict.conflictType),
          severity: this.mapSemanticSeverity(conflict.severity),
          location: `语义检测`,
          description: conflict.description,
          expected: conflict.conflictingFact.statement,
          found: conflict.newStatement,
          suggestion: conflict.suggestion,
          relatedEntities: conflict.conflictingFact.relatedEntities,
        });
      }
    } catch (error) {
      this.logger.warn(
        `[ConsistencyChecker] Semantic consistency check failed: ${error}`,
      );
      // 语义检查失败不阻塞其他检查
    }

    return issues;
  }

  /**
   * 映射事实类别
   */
  private mapFactCategory(
    category: string,
  ): "character" | "timeline" | "world" | "relationship" | "ability" {
    const mapping: Record<
      string,
      "character" | "timeline" | "world" | "relationship" | "ability"
    > = {
      entity_state: "character",
      sequence_point: "timeline",
      decision: "character",
      relationship: "relationship",
    };
    return mapping[category] || "world";
  }

  /**
   * 映射语义冲突类型到一致性检查类型
   */
  private mapSemanticConflictType(conflictType: string): ConsistencyCheckType {
    const mapping: Record<string, ConsistencyCheckType> = {
      contradiction: "CHARACTER",
      inconsistency: "PLOT",
      timeline_violation: "TIMELINE",
    };
    return mapping[conflictType] || "PLOT";
  }

  /**
   * 映射语义严重程度
   */
  private mapSemanticSeverity(severity: string): IssueSeverity {
    const mapping: Record<string, IssueSeverity> = {
      critical: "CRITICAL",
      warning: "WARNING",
      info: "INFO",
    };
    return mapping[severity] || "WARNING";
  }

  /**
   * 按类型检查
   */
  private async checkByType(
    type: ConsistencyCheckType,
    content: string,
    contextPackage: WritingContextPackage,
    context: AgentContext,
  ): Promise<ConsistencyIssue[]> {
    switch (type) {
      case "CHARACTER":
        return this.checkCharacterConsistency(content, contextPackage, context);
      case "TIMELINE":
        return this.checkTimelineConsistency(content, contextPackage, context);
      case "WORLD":
        return this.checkWorldConsistency(content, contextPackage, context);
      case "TERMINOLOGY":
        return this.checkTerminologyConsistency(content, contextPackage);
      case "PLOT":
        return this.checkPlotConsistency(content, contextPackage, context);
      default:
        return [];
    }
  }

  /**
   * 检查角色一致性
   */
  private async checkCharacterConsistency(
    content: string,
    contextPackage: WritingContextPackage,
    _context: AgentContext,
  ): Promise<ConsistencyIssue[]> {
    const storyBible = contextPackage.extensions.storyBible;
    const issues: ConsistencyIssue[] = [];

    // 构建角色检查提示词
    const systemPrompt = `你是专业的一致性检查专家，负责检查小说内容中的角色描述是否与设定一致。

## 检查维度
- 外貌描述（发色、眼色、身高、特征等）
- 性格表现（行为是否符合性格设定）
- 能力使用（是否超出设定的能力范围）
- 说话方式（语气、用词是否符合角色特点）
- 关系表现（与其他角色的关系是否正确）

## 输出格式
请以 JSON 数组格式输出发现的问题：
[{
  "type": "CHARACTER",
  "severity": "CRITICAL|WARNING|INFO",
  "location": "问题所在的段落或位置描述",
  "description": "问题描述",
  "expected": "Story Bible 中的设定",
  "found": "文中实际的描述",
  "suggestion": "修改建议",
  "relatedEntities": ["相关角色名"]
}]

如果没有问题，返回空数组 []`;

    const characterSettings = storyBible.characters
      .map(
        (c) => `
### ${c.name} (${c.role})
${c.aliases?.length ? `别名: ${c.aliases.join(", ")}` : ""}
外貌: ${JSON.stringify(c.appearance || {})}
性格: ${JSON.stringify(c.personality || {})}
能力: ${c.abilities?.join(", ") || "无特殊能力"}
当前状态: ${JSON.stringify(c.currentState?.state || {})}
`,
      )
      .join("\n");

    const userPrompt = `## 角色设定
${characterSettings}

## 待检查内容
${content.slice(0, 6000)}

请检查内容中的角色描述是否与设定一致。`;

    // 使用 TaskProfile 语义化描述任务特征
    const taskProfile: TaskProfile = {
      creativity: "deterministic", // 一致性检查需要严格准确 (原 temperature: 0.2)
      outputLength: "short", // 检查结果相对简短
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

    const parsedIssues = this.parseJsonResponse<ConsistencyIssue[]>(
      response.content || "",
      [],
    );

    issues.push(...parsedIssues);
    return issues;
  }

  /**
   * 检查时间线一致性
   */
  private async checkTimelineConsistency(
    content: string,
    contextPackage: WritingContextPackage,
    _context: AgentContext,
  ): Promise<ConsistencyIssue[]> {
    const storyBible = contextPackage.extensions.storyBible;
    const establishedFacts = contextPackage.establishedFacts || [];

    // 获取时间线相关的已确立事实
    const timelineFacts = establishedFacts.filter(
      (f) => f.category === "sequence_point" || f.category === "entity_state",
    );

    if (timelineFacts.length === 0 && storyBible.timelineEvents.length === 0) {
      return [];
    }

    const systemPrompt = `你是时间线一致性检查专家。检查内容中的事件顺序是否与已确立的时间线一致。

输出格式：JSON 数组，格式同上。`;

    const userPrompt = `## 时间线事件
${storyBible.timelineEvents.map((e) => `- ${e.storyTime}: ${e.eventName} - ${e.description}`).join("\n")}

## 已确立事实
${timelineFacts.map((f) => `- ${f.statement}`).join("\n")}

## 待检查内容
${content.slice(0, 5000)}

请检查时间线一致性。`;

    // 使用 TaskProfile 语义化描述任务特征
    const taskProfile: TaskProfile = {
      creativity: "deterministic", // 时间线检查需要严格准确 (原 temperature: 0.2)
      outputLength: "short", // 检查结果相对简短
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

    return this.parseJsonResponse<ConsistencyIssue[]>(
      response.content || "",
      [],
    );
  }

  /**
   * 检查世界观一致性
   */
  private async checkWorldConsistency(
    content: string,
    contextPackage: WritingContextPackage,
    _context: AgentContext,
  ): Promise<ConsistencyIssue[]> {
    const storyBible = contextPackage.extensions.storyBible;

    if (storyBible.worldSettings.length === 0) {
      return [];
    }

    const systemPrompt = `你是世界观一致性检查专家。检查内容是否违反世界观规则。

输出格式：JSON 数组。`;

    const worldRules = storyBible.worldSettings
      .filter((s) => s.rules && s.rules.length > 0)
      .map(
        (s) =>
          `### ${s.name} (${s.category})\n规则：\n${s.rules!.map((r) => `- ${r}`).join("\n")}`,
      )
      .join("\n\n");

    const userPrompt = `## 世界观规则
${worldRules || "无特定规则"}

## 待检查内容
${content.slice(0, 5000)}

请检查是否有违反世界观规则的内容。`;

    // 使用 TaskProfile 语义化描述任务特征
    const taskProfile: TaskProfile = {
      creativity: "deterministic", // 世界观检查需要严格准确 (原 temperature: 0.2)
      outputLength: "short", // 检查结果相对简短
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

    return this.parseJsonResponse<ConsistencyIssue[]>(
      response.content || "",
      [],
    );
  }

  /**
   * 检查术语一致性（本地检查，无需 LLM）
   */
  private async checkTerminologyConsistency(
    content: string,
    contextPackage: WritingContextPackage,
  ): Promise<ConsistencyIssue[]> {
    const storyBible = contextPackage.extensions.storyBible;
    const issues: ConsistencyIssue[] = [];

    for (const term of storyBible.terminologies) {
      // 检查是否使用了变体而非标准术语
      if (term.variants?.length) {
        const usedVariants = term.variants.filter((v) => content.includes(v));
        if (usedVariants.length > 1) {
          issues.push({
            type: "TERMINOLOGY",
            severity: "WARNING",
            location: "多处",
            description: `术语 "${term.term}" 使用了多个变体`,
            expected: term.term,
            found: usedVariants.join(", "),
            suggestion: `统一使用标准术语 "${term.term}"`,
            relatedEntities: [term.term],
          });
        }

        // 如果使用了变体但没使用标准术语
        if (usedVariants.length > 0 && !content.includes(term.term)) {
          issues.push({
            type: "TERMINOLOGY",
            severity: "INFO",
            location: "多处",
            description: `使用了 "${term.term}" 的变体而非标准术语`,
            expected: term.term,
            found: usedVariants[0],
            suggestion: `考虑使用标准术语 "${term.term}"`,
            relatedEntities: [term.term],
          });
        }
      }
    }

    return issues;
  }

  /**
   * 检查剧情逻辑
   */
  private async checkPlotConsistency(
    content: string,
    contextPackage: WritingContextPackage,
    _context: AgentContext,
  ): Promise<ConsistencyIssue[]> {
    const establishedFacts = contextPackage.establishedFacts || [];

    if (establishedFacts.length === 0) {
      return [];
    }

    const systemPrompt = `你是剧情逻辑检查专家。检查内容是否与已确立的事实矛盾。

重点检查：
- 因果关系是否合理
- 角色动机是否一致
- 前后逻辑是否连贯

输出格式：JSON 数组。`;

    const highImportanceFacts = establishedFacts.filter(
      (f) => f.importance === "high",
    );

    const userPrompt = `## 已确立的重要事实
${highImportanceFacts.map((f) => `- [${f.category}] ${f.statement}`).join("\n")}

## 待检查内容
${content.slice(0, 5000)}

请检查剧情逻辑一致性。`;

    // 使用 TaskProfile 语义化描述任务特征
    const taskProfile: TaskProfile = {
      creativity: "deterministic", // 剧情逻辑检查需要严格准确 (原 temperature: 0.2)
      outputLength: "short", // 检查结果相对简短
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

    return this.parseJsonResponse<ConsistencyIssue[]>(
      response.content || "",
      [],
    );
  }

  /**
   * 从章节内容提取新事实
   */
  private async extractFacts(
    content: string,
    contextPackage: WritingContextPackage,
    _context: AgentContext,
  ): Promise<ConsistencyCheckerOutput["extractedFacts"]> {
    const storyBible = contextPackage.extensions.storyBible;

    const systemPrompt = `你是事实提取专家。从小说章节中提取需要记录的重要事实。

## 需要提取的事实类型
- entity_state: 角色状态变化（受伤、获得新能力、情感变化等）
- sequence_point: 重要时间节点（事件发生、任务完成等）
- decision: 重要决策（角色做出的选择、剧情转折）
- relationship: 关系变化（新关系建立、关系破裂）

## 输出格式
JSON 数组：
[{
  "statement": "事实陈述",
  "category": "entity_state|sequence_point|decision|relationship",
  "relatedEntities": ["相关角色/实体名"],
  "importance": "high|medium|low"
}]

只提取重要的、会影响后续剧情的事实。`;

    const characterNames = storyBible.characters.map((c) => c.name).join(", ");

    const userPrompt = `## 主要角色
${characterNames}

## 章节内容
${content.slice(0, 6000)}

请提取本章确立的重要事实。`;

    // 使用 TaskProfile 语义化描述任务特征
    const taskProfile: TaskProfile = {
      creativity: "low", // 事实提取需要准确性 (原 temperature: 0.3)
      outputLength: "short", // 提取结果相对简短
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

    return this.parseJsonResponse<ConsistencyCheckerOutput["extractedFacts"]>(
      response.content || "",
      [],
    );
  }

  /**
   * 构建统计摘要
   */
  private buildSummary(
    issues: ConsistencyIssue[],
  ): ConsistencyCheckerOutput["summary"] {
    const byType: Record<ConsistencyCheckType, number> = {
      CHARACTER: 0,
      TIMELINE: 0,
      WORLD: 0,
      TERMINOLOGY: 0,
      PLOT: 0,
    };

    const bySeverity: Record<IssueSeverity, number> = {
      CRITICAL: 0,
      WARNING: 0,
      INFO: 0,
    };

    issues.forEach((issue) => {
      byType[issue.type]++;
      bySeverity[issue.severity]++;
    });

    return {
      total: issues.length,
      byType,
      bySeverity,
    };
  }
}
