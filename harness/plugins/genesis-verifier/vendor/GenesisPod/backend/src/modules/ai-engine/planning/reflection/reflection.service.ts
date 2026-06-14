/**
 * Reflection Service
 *
 * 通用的自我反思服务，用于迭代式工作流中的质量评估和决策：
 * - 评估当前进度和质量
 * - 识别信息缺口或问题
 * - 决定下一步行动（继续/调整/完成）
 * - 生成调整建议
 *
 * 使用场景：
 * - Deep Research: 评估搜索结果质量，决定是否继续搜索
 * - Topic Research: 评估维度研究完整性
 * - Agent Iteration: 评估任务执行质量
 * - Report Generation: 评估报告完整性
 *
 * ★ P0 能力沉淀：从 Deep Research SelfReflectionService 提取
 */

import {
  Injectable,
  Logger,
  Inject,
  InternalServerErrorException,
} from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { CHAT_PROVIDER_PORT } from "../../facade/abstractions/runtime-deps.tokens";
import type { IChatProvider } from "../../facade";

// ==================== 类型定义 ====================

/**
 * 反思决策类型
 */
export type ReflectionDecision =
  | "continue" // 继续执行当前计划
  | "pivot" // 调整方向
  | "complete" // 已完成，可以进入下一阶段
  | "retry" // 需要重试当前步骤
  | "escalate"; // 需要人工介入

/**
 * 反思输入
 */
export interface ReflectionInput {
  /** 当前任务/目标描述 */
  objective: string;
  /** 当前进度描述 */
  progressSummary: string;
  /** 当前轮次 */
  currentRound: number;
  /** 最大轮次 */
  maxRounds: number;
  /** 已完成的工作摘要 */
  completedWork?: string;
  /** 剩余计划 */
  remainingPlan?: string;
  /** 评估维度（可选，用于自定义评估标准） */
  evaluationDimensions?: string[];
  /** 上下文信息 */
  context?: Record<string, unknown>;
}

/**
 * 反思结果
 */
export interface ReflectionResult {
  /** 轮次 */
  round: number;
  /** 质量评分 (0-100) */
  qualityScore: number;
  /** 当前状态评估 */
  assessment: string;
  /** 识别的缺口/问题 */
  gaps: string[];
  /** 决策 */
  decision: ReflectionDecision;
  /** 决策理由 */
  reasoning: string;
  /** 下一步建议（如果 decision 是 pivot） */
  suggestions?: string[];
  /** 时间戳 */
  timestamp: Date;
}

/**
 * 反思配置
 */
export interface ReflectionConfig {
  /** 使用的模型类型 */
  modelType?: AIModelType;
  /** 完成阈值（质量评分达到此值认为完成） */
  completionThreshold?: number;
  /** 最小信息量（收集到此数量后才考虑完成） */
  minItems?: number;
  /** 自定义系统提示词 */
  customSystemPrompt?: string;
  /** 自定义评估维度 */
  evaluationDimensions?: string[];
}

/**
 * AI 反思响应格式
 */
interface AIReflectionResponse {
  quality_score: number;
  assessment: string;
  gaps_identified: string[];
  decision: string;
  reasoning: string;
  suggested_actions?: string[];
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: Required<ReflectionConfig> = {
  modelType: AIModelType.CHAT_FAST,
  completionThreshold: 75,
  minItems: 10,
  customSystemPrompt: "",
  evaluationDimensions: [
    "信息覆盖度：是否涵盖了主题的主要方面？",
    "信息深度：是否有足够深入的分析和数据？",
    "来源质量：来源是否权威可信？",
    "一致性：信息之间是否一致，无矛盾？",
  ],
};

// ==================== 服务实现 ====================

@Injectable()
export class ReflectionService {
  private readonly logger = new Logger(ReflectionService.name);

  constructor(
    @Inject(CHAT_PROVIDER_PORT)
    private readonly aiFacade: IChatProvider,
  ) {}

  /**
   * 执行反思评估
   */
  async reflect(
    input: ReflectionInput,
    config: ReflectionConfig = {},
  ): Promise<ReflectionResult> {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    this.logger.debug(
      `[reflect] Round ${input.currentRound}/${input.maxRounds} for: ${input.objective.slice(0, 50)}...`,
    );

    const systemPrompt = this.buildSystemPrompt(mergedConfig);
    const userPrompt = this.buildUserPrompt(input, mergedConfig);

    try {
      const result = await this.aiFacade.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        modelType: mergedConfig.modelType,
        taskProfile: {
          creativity: "low", // 反思需要客观评估
          outputLength: "short", // 反思输出较短
        },
      });

      const reflection = this.parseResponse(result.content, input.currentRound);

      this.logger.debug(
        `[reflect] Decision: ${reflection.decision}, Score: ${reflection.qualityScore}`,
      );

      return reflection;
    } catch (error) {
      this.logger.error(`[reflect] Failed: ${error}`);
      return this.getDefaultReflection(input, mergedConfig);
    }
  }

  /**
   * 判断是否应该继续
   */
  shouldContinue(
    reflection: ReflectionResult,
    currentRound: number,
    maxRounds: number,
  ): boolean {
    // 已达到最大轮次
    if (currentRound >= maxRounds) {
      return false;
    }

    // 根据决策判断
    return reflection.decision !== "complete";
  }

  /**
   * 批量评估多个项目
   */
  async batchReflect(
    items: Array<{ id: string; content: string }>,
    objective: string,
    config: ReflectionConfig = {},
  ): Promise<Map<string, ReflectionResult>> {
    const results = new Map<string, ReflectionResult>();

    // 并行处理（限制并发数）
    const batchSize = 3;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const promises = batch.map(async (item) => {
        const result = await this.reflect(
          {
            objective,
            progressSummary: item.content,
            currentRound: 1,
            maxRounds: 1,
          },
          config,
        );
        return { id: item.id, result };
      });

      const batchResults = await Promise.all(promises);
      for (const { id, result } of batchResults) {
        results.set(id, result);
      }
    }

    return results;
  }

  /**
   * 简单的质量检查（不调用 AI，基于规则）
   */
  quickCheck(
    itemCount: number,
    config: ReflectionConfig = {},
  ): ReflectionDecision {
    const minItems = config.minItems ?? DEFAULT_CONFIG.minItems;

    if (itemCount >= minItems * 2) {
      return "complete";
    } else if (itemCount >= minItems) {
      return "continue";
    } else {
      return "pivot";
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(config: Required<ReflectionConfig>): string {
    if (config.customSystemPrompt) {
      return config.customSystemPrompt;
    }

    const dimensions = config.evaluationDimensions
      .map((d, i) => `${i + 1}. ${d}`)
      .join("\n");

    return `你是一个质量评估助手。你的任务是评估当前工作进度和质量，并决定下一步行动。

## 评估维度
${dimensions}

## 决策选项
- continue: 继续执行当前计划的下一步
- pivot: 调整方向，需要提供新的建议
- complete: 质量已足够，可以进入下一阶段
- retry: 当前步骤有问题，需要重试
- escalate: 遇到无法自动解决的问题，需要人工介入

## 输出格式
请以 JSON 格式输出：
\`\`\`json
{
  "quality_score": 75,
  "assessment": "当前状态的简要评估",
  "gaps_identified": ["缺口1", "缺口2"],
  "decision": "continue|pivot|complete|retry|escalate",
  "reasoning": "决策理由",
  "suggested_actions": ["如果需要调整，建议的行动"]
}
\`\`\``;
  }

  /**
   * 构建用户提示词
   */
  private buildUserPrompt(
    input: ReflectionInput,
    _config: Required<ReflectionConfig>,
  ): string {
    const parts = [
      `## 目标\n${input.objective}`,
      `## 当前进度\n第 ${input.currentRound} 轮 / 最多 ${input.maxRounds} 轮`,
      `## 进度摘要\n${input.progressSummary}`,
    ];

    if (input.completedWork) {
      parts.push(`## 已完成的工作\n${input.completedWork}`);
    }

    if (input.remainingPlan) {
      parts.push(`## 剩余计划\n${input.remainingPlan}`);
    }

    parts.push("\n请评估当前质量，并决定下一步行动。");

    return parts.join("\n\n");
  }

  /**
   * 解析 AI 响应
   */
  private parseResponse(response: string, round: number): ReflectionResult {
    try {
      const jsonMatch =
        response.match(/```json\s*([\s\S]*?)\s*```/) ||
        response.match(/\{[\s\S]*"decision"[\s\S]*\}/);

      if (!jsonMatch) {
        throw new InternalServerErrorException("No JSON found in response");
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed: AIReflectionResponse = JSON.parse(jsonStr);

      return {
        round,
        qualityScore: this.clampScore(parsed.quality_score),
        assessment: parsed.assessment || "评估完成",
        gaps: parsed.gaps_identified || [],
        decision: this.validateDecision(parsed.decision),
        reasoning: parsed.reasoning || "",
        suggestions: parsed.suggested_actions,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`[parseResponse] Failed: ${error}`);
      return {
        round,
        qualityScore: 50,
        assessment: "解析失败，使用默认评估",
        gaps: [],
        decision: "continue",
        reasoning: "无法解析 AI 响应，默认继续",
        timestamp: new Date(),
      };
    }
  }

  /**
   * 验证决策类型
   */
  private validateDecision(decision: string): ReflectionDecision {
    const validDecisions: ReflectionDecision[] = [
      "continue",
      "pivot",
      "complete",
      "retry",
      "escalate",
    ];
    if (validDecisions.includes(decision as ReflectionDecision)) {
      return decision as ReflectionDecision;
    }
    return "continue";
  }

  /**
   * 限制分数范围
   */
  private clampScore(score: number): number {
    if (typeof score !== "number" || isNaN(score)) {
      return 50;
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * 获取默认反思结果
   */
  private getDefaultReflection(
    input: ReflectionInput,
    config: Required<ReflectionConfig>,
  ): ReflectionResult {
    // 如果已经接近最大轮次，建议完成
    if (input.currentRound >= input.maxRounds - 1) {
      return {
        round: input.currentRound,
        qualityScore: config.completionThreshold,
        assessment: "接近最大轮次，建议完成",
        gaps: [],
        decision: "complete",
        reasoning: "已接近最大迭代次数",
        timestamp: new Date(),
      };
    }

    return {
      round: input.currentRound,
      qualityScore: 50,
      assessment: "使用默认评估",
      gaps: ["无法进行 AI 评估"],
      decision: "continue",
      reasoning: "默认继续执行计划",
      timestamp: new Date(),
    };
  }
}
