/**
 * Mission Input Service
 *
 * 输入结构化处理服务
 * - 解析用户输入，拆分为结构化组件
 * - 提取约束、实体、示例
 * - 生成长内容摘要
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConstraintEnforcementService } from "@/modules/ai-harness/guardrails/constraints/constraint-enforcement.service";
import { ContextBudgetCalculator as TokenBudgetCalculatorService } from "@/modules/ai-engine/planning/budget/token-budget.service";
import type { ExtractedConstraint } from "@/modules/ai-harness/runner/executor/constraint-enforcement.types";

/**
 * 结构化实体
 */
export interface StructuredEntity {
  name: string;
  type:
    | "character"
    | "location"
    | "concept"
    | "organization"
    | "item"
    | "other";
  definition: string;
  attributes: Record<string, string>;
  relations: Array<{ target: string; relation: string }>;
}

/**
 * 示例
 */
export interface Example {
  title: string;
  content: string;
  source?: string;
}

/**
 * 结构化输入
 */
export interface StructuredMissionInput {
  // 原始信息
  originalDescription: string;
  originalLength: number;

  // 结构化提取
  background: string; // 背景描述（可能被压缩）
  constraints: ExtractedConstraint[]; // 约束列表
  entities: StructuredEntity[]; // 实体定义
  examples: Example[]; // 示例

  // 处理状态
  isLongContent: boolean; // > 10K 字符
  compressionApplied: boolean; // 是否压缩过
  extractionConfidence: number; // 提取置信度
}

/**
 * 输入摘要
 */
export interface InputSummary {
  summary: string;
  keyPoints: string[];
  constraintCount: number;
  entityCount: number;
  originalLength: number;
}

// 长内容阈值
const LONG_CONTENT_THRESHOLD = 10000; // 10K 字符
const BACKGROUND_MAX_LENGTH = 8000; // 背景最大长度

@Injectable()
export class MissionInputService {
  private readonly logger = new Logger(MissionInputService.name);

  constructor(
    private readonly tokenBudgetService: TokenBudgetCalculatorService,
    private readonly constraintService: ConstraintEnforcementService,
  ) {}

  /**
   * 解析结构化输入
   */
  async parseStructuredInput(
    description: string,
  ): Promise<StructuredMissionInput> {
    const originalLength = description.length;
    const isLongContent = originalLength > LONG_CONTENT_THRESHOLD;

    this.logger.log(
      `[parseStructuredInput] Processing input: ${originalLength} chars, isLongContent: ${isLongContent}`,
    );

    // 1. 提取约束
    const constraints = this.constraintService.extractConstraints(description);
    this.logger.debug(
      `[parseStructuredInput] Extracted ${constraints.length} constraints`,
    );

    // 2. 提取实体
    const entities = this.extractEntities(description);
    this.logger.debug(
      `[parseStructuredInput] Extracted ${entities.length} entities`,
    );

    // 3. 提取示例
    const examples = this.extractExamples(description);
    this.logger.debug(
      `[parseStructuredInput] Extracted ${examples.length} examples`,
    );

    // 4. 生成背景（移除已提取内容后）
    let background = this.removeExtractedContent(
      description,
      constraints,
      entities,
      examples,
    );

    // 5. 如果背景仍太长，压缩
    let compressionApplied = false;
    if (background.length > BACKGROUND_MAX_LENGTH) {
      background = this.tokenBudgetService.smartTruncate(
        background,
        Math.floor(BACKGROUND_MAX_LENGTH * 1.5), // token 估算
      );
      compressionApplied = true;
      this.logger.log(
        `[parseStructuredInput] Background compressed to ${background.length} chars`,
      );
    }

    // 6. 计算提取置信度
    const extractionConfidence = this.calculateConfidence(
      constraints,
      entities,
      originalLength,
    );

    return {
      originalDescription: description,
      originalLength,
      background,
      constraints,
      entities,
      examples,
      isLongContent,
      compressionApplied,
      extractionConfidence,
    };
  }

  /**
   * 提取实体（人物、地点、概念等）
   */
  private extractEntities(description: string): StructuredEntity[] {
    const entities: StructuredEntity[] = [];

    // 人物提取模式
    const characterPatterns = [
      // "人物：张三，性别：男，年龄：30"
      /(?:人物|角色)[：:]\s*(\S+)[，,]\s*(?:性别[：:]\s*(\S+)[，,]?\s*)?(?:年龄[：:]\s*(\S+))?/g,
      // "张三是一个..."
      /(\S{2,4})[是为]一[个位名](.{10,50}?)(?=[。\n])/g,
    ];

    for (const pattern of characterPatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const name = match[1]?.trim();
        if (name && name.length >= 2 && name.length <= 6) {
          // 检查是否已存在
          if (!entities.some((e) => e.name === name)) {
            entities.push({
              name,
              type: "character",
              definition: match[0],
              attributes: {
                ...(match[2] && { gender: match[2] }),
                ...(match[3] && { age: match[3] }),
              },
              relations: [],
            });
          }
        }
      }
    }

    // 地点提取模式
    const locationPatterns = [
      /(?:地点|场景|背景)[：:]\s*(\S+)/g,
      /(?:在|位于)(\S{2,10}(?:山|观|城|镇|村|庙|寺|殿|堂|楼|阁))/g,
    ];

    for (const pattern of locationPatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const name = match[1]?.trim();
        if (name && !entities.some((e) => e.name === name)) {
          entities.push({
            name,
            type: "location",
            definition: match[0],
            attributes: {},
            relations: [],
          });
        }
      }
    }

    // 概念提取模式（术语定义）
    const conceptPatterns = [
      /(?:术语|概念|定义)[：:]\s*(\S+)[：:，,]\s*(.+?)(?=[。\n]|$)/g,
      /所谓[\""]?(\S+)[\""]?[，,]?\s*(?:是指|即|就是)\s*(.+?)(?=[。\n])/g,
    ];

    for (const pattern of conceptPatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const name = match[1]?.trim();
        const definition = match[2]?.trim();
        if (name && definition && !entities.some((e) => e.name === name)) {
          entities.push({
            name,
            type: "concept",
            definition,
            attributes: {},
            relations: [],
          });
        }
      }
    }

    this.logger.debug(
      `[extractEntities] Found ${entities.length} entities: ${entities.map((e) => e.name).join(", ")}`,
    );

    return entities;
  }

  /**
   * 提取示例
   */
  private extractExamples(description: string): Example[] {
    const examples: Example[] = [];

    // 示例提取模式
    const examplePatterns = [
      /(?:示例|例如|参考)[：:]\s*\n?(.+?)(?=\n\n|$)/gs,
      /【示例】\s*\n?(.+?)(?=【|$)/gs,
      /```(?:example)?\n(.+?)```/gs,
    ];

    for (const pattern of examplePatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const content = match[1]?.trim();
        if (content && content.length > 20) {
          examples.push({
            title: `示例 ${examples.length + 1}`,
            content,
          });
        }
      }
    }

    return examples;
  }

  /**
   * 移除已提取的内容，生成纯背景
   */
  private removeExtractedContent(
    description: string,
    _constraints: ExtractedConstraint[],
    _entities: StructuredEntity[],
    _examples: Example[],
  ): string {
    // 简化处理：不真正移除，只是返回原文
    // 因为约束、实体等内容通常是分散在文本中的，移除会破坏上下文
    // 实际应用中可以用 AI 来做更智能的提取和分离
    return description;
  }

  /**
   * 计算提取置信度
   */
  private calculateConfidence(
    constraints: ExtractedConstraint[],
    entities: StructuredEntity[],
    originalLength: number,
  ): number {
    // 基础分数
    let score = 0.5;

    // 约束提取奖励
    if (constraints.length > 0) {
      score += Math.min(0.2, constraints.length * 0.05);
    }

    // 实体提取奖励
    if (entities.length > 0) {
      score += Math.min(0.2, entities.length * 0.03);
    }

    // 长内容惩罚（长内容更难完全提取）
    if (originalLength > LONG_CONTENT_THRESHOLD) {
      score -= 0.1;
    }

    return Math.min(1.0, Math.max(0.1, score));
  }

  /**
   * 生成输入摘要
   */
  async buildInputSummary(
    input: StructuredMissionInput,
  ): Promise<InputSummary> {
    // 提取关键点
    const keyPoints: string[] = [];

    // 从约束中提取
    const mustConstraints = input.constraints.filter((c) => c.type === "MUST");
    if (mustConstraints.length > 0) {
      keyPoints.push(
        `硬性约束 ${mustConstraints.length} 条: ${mustConstraints
          .slice(0, 3)
          .map((c) => c.rule)
          .join("; ")}`,
      );
    }

    // 从实体中提取
    if (input.entities.length > 0) {
      const characters = input.entities.filter((e) => e.type === "character");
      if (characters.length > 0) {
        keyPoints.push(`涉及人物: ${characters.map((c) => c.name).join(", ")}`);
      }
    }

    // 生成摘要
    const summaryLength = Math.min(input.background.length, 500);
    const summary = input.background.substring(0, summaryLength);

    return {
      summary: summary + (input.background.length > 500 ? "..." : ""),
      keyPoints,
      constraintCount: input.constraints.length,
      entityCount: input.entities.length,
      originalLength: input.originalLength,
    };
  }

  /**
   * 验证约束完整性
   */
  validateConstraints(input: StructuredMissionInput): {
    isValid: boolean;
    warnings: string[];
  } {
    const warnings: string[] = [];

    // 检查是否有 MUST 约束
    const mustConstraints = input.constraints.filter((c) => c.type === "MUST");
    if (mustConstraints.length === 0 && input.isLongContent) {
      warnings.push("长内容任务未检测到硬性约束，可能需要人工确认");
    }

    // 检查提取置信度
    if (input.extractionConfidence < 0.5) {
      warnings.push(
        `约束提取置信度较低 (${(input.extractionConfidence * 100).toFixed(0)}%)，建议人工审核`,
      );
    }

    // 检查实体是否有定义
    const undefinedEntities = input.entities.filter(
      (e) => !e.definition || e.definition.length < 10,
    );
    if (undefinedEntities.length > 0) {
      warnings.push(
        `${undefinedEntities.length} 个实体定义不完整: ${undefinedEntities.map((e) => e.name).join(", ")}`,
      );
    }

    return {
      isValid: warnings.length === 0,
      warnings,
    };
  }

  /**
   * 格式化输入摘要（用于日志或调试）
   */
  formatInputReport(input: StructuredMissionInput): string {
    const lines = [
      `=== Mission Input Report ===`,
      `Original Length: ${input.originalLength} chars`,
      `Is Long Content: ${input.isLongContent}`,
      `Compression Applied: ${input.compressionApplied}`,
      `Extraction Confidence: ${(input.extractionConfidence * 100).toFixed(1)}%`,
      ``,
      `Constraints (${input.constraints.length}):`,
    ];

    for (const c of input.constraints) {
      lines.push(`  [${c.type}] ${c.id}: ${c.rule}`);
    }

    lines.push(``, `Entities (${input.entities.length}):`);
    for (const e of input.entities) {
      lines.push(
        `  [${e.type}] ${e.name}: ${e.definition.substring(0, 50)}...`,
      );
    }

    lines.push(``, `Examples: ${input.examples.length}`);

    return lines.join("\n");
  }
}
