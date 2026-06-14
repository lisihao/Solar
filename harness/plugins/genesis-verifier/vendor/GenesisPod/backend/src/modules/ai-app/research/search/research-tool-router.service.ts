import { Injectable, Logger } from "@nestjs/common";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import {
  ACADEMIC_STEP_OVERRIDE,
  DEFAULT_TOOL_RESOLUTIONS,
  FALLBACK_TOOL_ID,
  INITIAL_SEARCH_STEP_OVERRIDE,
  MIXED_CLASSIFICATION_THRESHOLD,
  TOPIC_CLASSIFICATION_RULES,
  VERIFICATION_STEP_OVERRIDE,
} from "../config/tool-strategy.config";
import type {
  ResearchToolStrategy,
  ResearchTopicType,
  ToolAssignment,
  ToolResolution,
} from "./research-tool-router.types";

/**
 * 研究工具路由服务
 * 根据研究主题类型选择最合适的搜索工具组合
 * 使用关键词匹配分类，不调用 LLM，保持轻量
 */
@Injectable()
export class ResearchToolRouterService {
  private readonly logger = new Logger(ResearchToolRouterService.name);

  constructor(private readonly toolRegistry: ToolRegistry) {}

  /**
   * 根据用户查询分类研究主题
   * 使用关键词匹配（不调用 LLM，保持轻量）
   */
  classifyTopic(query: string): {
    type: ResearchTopicType;
    confidence: number;
  } {
    if (!query) {
      return { type: "general", confidence: 1.0 };
    }

    // 计算每个分类的匹配分数
    const scores: Record<
      Exclude<ResearchTopicType, "general" | "mixed">,
      number
    > = {
      academic: 0,
      policy: 0,
      technical: 0,
      financial: 0,
    };

    const categories = Object.keys(TOPIC_CLASSIFICATION_RULES) as Array<
      keyof typeof TOPIC_CLASSIFICATION_RULES
    >;

    for (const category of categories) {
      const regex = TOPIC_CLASSIFICATION_RULES[category];
      const matches = query.match(new RegExp(regex.source, "gi"));
      scores[category] = matches ? matches.length : 0;
    }

    const totalScore = Object.values(scores).reduce((sum, s) => sum + s, 0);

    // 无关键词匹配 → 通用类
    if (totalScore === 0) {
      return { type: "general", confidence: 1.0 };
    }

    // 找出最高分和次高分
    const sorted = (
      Object.entries(scores) as Array<[ResearchTopicType, number]>
    ).sort(([, a], [, b]) => b - a);

    const [topCategory, topScore] = sorted[0];
    const [, secondScore] = sorted[1];

    // 如果最高分和次高分接近（差距 < MIXED_CLASSIFICATION_THRESHOLD），归类为 mixed
    if (
      secondScore > 0 &&
      (topScore - secondScore) / topScore < MIXED_CLASSIFICATION_THRESHOLD
    ) {
      const confidence = Math.min(0.9, totalScore / 5);
      this.logger.debug(
        `[classifyTopic] query classified as mixed (top=${topCategory}:${topScore}, second=${secondScore})`,
      );
      return { type: "mixed", confidence };
    }

    const confidence = Math.min(0.95, topScore / (topScore + secondScore + 1));
    this.logger.debug(
      `[classifyTopic] query classified as ${topCategory} (score=${topScore}, confidence=${confidence.toFixed(2)})`,
    );

    return { type: topCategory, confidence };
  }

  /**
   * 构建完整的工具策略
   */
  buildToolStrategy(query: string): ResearchToolStrategy {
    const { type, confidence } = this.classifyTopic(query);

    const defaultResolution = this.getDefaultResolution(type);
    const stepOverrides = this.getStepOverrides(type);

    this.logger.debug(
      `[buildToolStrategy] topicType=${type}, confidence=${confidence.toFixed(2)}, tools=${defaultResolution.tools.map((t) => t.toolId).join(",")}`,
    );

    return { topicType: type, confidence, defaultResolution, stepOverrides };
  }

  /**
   * 为单个搜索步骤解析工具
   */
  resolveToolsForStep(
    step: { type: string; query: string },
    topicType: ResearchTopicType,
    stepOverrides?: Partial<Record<string, ToolResolution>>,
  ): ToolResolution {
    // 1. 检查 stepOverrides 是否有针对此 step.type 的覆盖
    const override = stepOverrides?.[step.type];
    const baseResolution = override ?? this.getDefaultResolution(topicType);

    // 2. 过滤掉 ToolRegistry 中不存在的工具
    const availableTools = baseResolution.tools.filter((t) =>
      this.isToolAvailable(t.toolId),
    );

    // 3. 如果过滤后没有可用工具，fallback 到 web-search
    if (availableTools.length === 0) {
      this.logger.warn(
        `[resolveToolsForStep] No available tools for step type="${step.type}", topicType="${topicType}". Falling back to ${FALLBACK_TOOL_ID}`,
      );
      return this.buildFallbackResolution();
    }

    return {
      ...baseResolution,
      tools: availableTools,
    };
  }

  /**
   * 默认工具解析策略
   */
  private getDefaultResolution(type: ResearchTopicType): ToolResolution {
    return DEFAULT_TOOL_RESOLUTIONS[type];
  }

  /**
   * Step 类型覆盖
   * - academic step: 总是包含 arxiv-search 或 semantic-scholar
   * - verification step: 总是包含 web-search
   * - initial_search step: 用 web-search 做广度搜索
   * - deep_dive step: 使用主题对应的专业工具（走 defaultResolution，无覆盖）
   */
  private getStepOverrides(
    _type: ResearchTopicType,
  ): Partial<Record<string, ToolResolution>> {
    return {
      academic: ACADEMIC_STEP_OVERRIDE,
      verification: VERIFICATION_STEP_OVERRIDE,
      initial_search: INITIAL_SEARCH_STEP_OVERRIDE,
    };
  }

  /**
   * 检查工具是否在 Registry 中可用
   */
  private isToolAvailable(toolId: string): boolean {
    return this.toolRegistry.tryGet(toolId) !== undefined;
  }

  /**
   * 构建 fallback 工具解析（仅含 web-search）
   */
  private buildFallbackResolution(): ToolResolution {
    const fallbackAssignment: ToolAssignment = {
      toolId: FALLBACK_TOOL_ID,
      maxResults: 15,
      priority: 1,
      required: true,
      queryTransform: "none",
    };
    return {
      tools: [fallbackAssignment],
      mode: "primary-with-fallback",
      maxTotalResults: 15,
    };
  }

  /**
   * 对查询应用工具特定的变换
   */
  transformQueryForTool(
    query: string,
    transform: ToolAssignment["queryTransform"],
  ): string {
    if (!query) return query;

    switch (transform) {
      case "academic":
        // 如果查询没有学术关键词，追加 "research paper study"
        if (!/research|paper|study|论文|研究/i.test(query)) {
          return `${query} research paper study`;
        }
        return query;

      case "policy":
        // 如果查询没有政策关键词，追加 "regulation policy official"
        if (!/policy|regulation|政策|法规/i.test(query)) {
          return `${query} policy regulation official ${new Date().getFullYear()}`;
        }
        return query;

      case "technical":
        // technical 查询通常已经足够具体，直接返回
        return query;

      case "none":
      default:
        return query;
    }
  }
}
