import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  ResearchPlan,
  ResearchPlanStep,
  ResearchStepType,
  AIResearchPlanResponse,
  PreviousReportContext,
} from "./types";
import {
  ResearchLanguage,
  resolveLanguage,
  PLANNER_PROMPTS,
  SEARCH_ENHANCE,
  STEP_COUNT_GUIDE,
} from "./prompt-locale";

/**
 * 研究规划服务
 * 使用 AI 生成智能研究计划
 *
 * ✅ 已迁移：使用 AIFacade 统一入口
 */
@Injectable()
export class ResearchPlannerService {
  private readonly logger = new Logger(ResearchPlannerService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 生成研究计划
   */
  async generatePlan(
    query: string,
    options?: {
      depth?: "quick" | "standard" | "thorough";
      includeAcademic?: boolean;
      isFollowUp?: boolean;
      previousContext?: PreviousReportContext;
      language?: string;
    },
  ): Promise<ResearchPlan> {
    this.logger.debug(
      `Generating research plan for query: ${query.slice(0, 100)}... (follow-up: ${options?.isFollowUp})`,
    );

    const depth = options?.depth || "standard";
    const includeAcademic = options?.includeAcademic ?? true;
    const isFollowUp = options?.isFollowUp ?? false;
    const previousContext = options?.previousContext;
    const lang = resolveLanguage(options?.language);

    const systemPrompt = this.buildPlanningPrompt(
      depth,
      includeAcademic,
      isFollowUp,
      previousContext,
      lang,
    );
    const userPrompt =
      isFollowUp && previousContext
        ? PLANNER_PROMPTS[lang].followUpUserPrompt(query)
        : PLANNER_PROMPTS[lang].userPrompt(query);

    try {
      // ★ 使用 AIFacade 统一入口
      const result = await this.chatFacade.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "medium",
          outputLength: "short",
        },
        skipGuardrails: true, // 内部系统调用，研究内容可能触发误报
      });

      const plan = this.parsePlanResponse(result.content, query, lang);
      this.logger.debug(`Generated plan with ${plan.steps.length} steps`);

      return plan;
    } catch (error) {
      this.logger.error(`Failed to generate research plan: ${error}`);
      // 返回默认计划
      return this.getDefaultPlan(query, depth, includeAcademic, lang);
    }
  }

  /**
   * 构建规划提示词
   */
  private buildPlanningPrompt(
    depth: "quick" | "standard" | "thorough",
    includeAcademic: boolean,
    isFollowUp: boolean = false,
    previousContext?: PreviousReportContext,
    language: ResearchLanguage = "zh-CN",
  ): string {
    const stepCountGuide = STEP_COUNT_GUIDE[language][depth];

    // 追问模式的特殊提示
    if (isFollowUp && previousContext) {
      const previousSummary = this.formatPreviousContext(previousContext);
      return PLANNER_PROMPTS[language].followUpSystemPrompt(
        stepCountGuide,
        includeAcademic,
        previousSummary,
      );
    }

    // 常规研究模式
    return PLANNER_PROMPTS[language].systemPrompt(
      stepCountGuide,
      includeAcademic,
    );
  }

  /**
   * 格式化之前的研究上下文
   */
  private formatPreviousContext(context: PreviousReportContext): string {
    let summary = `### 执行摘要\n${context.executiveSummary}\n\n`;

    if (context.sections && context.sections.length > 0) {
      summary += `### 主要章节\n`;
      for (const section of context.sections) {
        summary += `- **${section.title}**: ${section.content.slice(0, 200)}...\n`;
      }
      summary += "\n";
    }

    summary += `### 结论\n${context.conclusion}\n\n`;

    if (context.references && context.references.length > 0) {
      summary += `### 已引用来源（${context.references.length}个）\n`;
      for (const ref of context.references.slice(0, 5)) {
        summary += `- ${ref.title}\n`;
      }
    }

    return summary;
  }

  /**
   * 解析 AI 响应
   */
  private parsePlanResponse(
    response: string,
    query: string,
    language: ResearchLanguage,
  ): ResearchPlan {
    try {
      // 提取 JSON
      const jsonMatch =
        response.match(/```json\s*([\s\S]*?)\s*```/) ||
        response.match(/\{[\s\S]*"steps"[\s\S]*\}/);

      if (!jsonMatch) {
        this.logger.warn("No JSON found in AI response, using default plan");
        return this.getDefaultPlan(query, "standard", true, language);
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed: AIResearchPlanResponse = JSON.parse(jsonStr);

      // 转换为 ResearchPlan 格式
      const steps: ResearchPlanStep[] = parsed.steps.map((step, index) => ({
        id: `step_${index + 1}`,
        type: this.validateStepType(step.type),
        query: step.query,
        rationale: step.rationale,
        estimatedSources: step.estimatedSources || 10,
      }));

      // 估算总时间（每个步骤约 15-30 秒）
      const estimatedTime = steps.length * 20;

      return {
        objective: parsed.objective,
        approach: parsed.approach,
        steps,
        estimatedTime,
      };
    } catch (error) {
      this.logger.error(`Failed to parse plan response: ${error}`);
      return this.getDefaultPlan(query, "standard", true, language);
    }
  }

  /**
   * 验证步骤类型
   */
  private validateStepType(type: string): ResearchStepType {
    const validTypes: ResearchStepType[] = [
      "initial_search",
      "deep_dive",
      "academic",
      "comparison",
      "verification",
    ];

    if (validTypes.includes(type as ResearchStepType)) {
      return type as ResearchStepType;
    }

    return "deep_dive";
  }

  /**
   * 获取默认研究计划（当 AI 生成失败时）
   */
  private getDefaultPlan(
    query: string,
    depth: "quick" | "standard" | "thorough",
    includeAcademic: boolean,
    language: ResearchLanguage,
  ): ResearchPlan {
    const steps: ResearchPlanStep[] = [
      {
        id: "step_1",
        type: "initial_search",
        query: query,
        rationale: PLANNER_PROMPTS[language].defaultRationale.initial,
        estimatedSources: 10,
      },
    ];

    if (depth !== "quick") {
      steps.push({
        id: "step_2",
        type: "deep_dive",
        query: `${query} ${SEARCH_ENHANCE[language].detailedAnalysis}`,
        rationale: PLANNER_PROMPTS[language].defaultRationale.deepDive,
        estimatedSources: 10,
      });
    }

    if (includeAcademic && (depth === "standard" || depth === "thorough")) {
      steps.push({
        id: "step_3",
        type: "academic",
        query: `${query} research paper study`,
        rationale: PLANNER_PROMPTS[language].defaultRationale.academic,
        estimatedSources: 5,
      });
    }

    if (depth === "thorough") {
      steps.push(
        {
          id: "step_4",
          type: "comparison",
          query: `${query} ${SEARCH_ENHANCE[language].comparison}`,
          rationale: PLANNER_PROMPTS[language].defaultRationale.comparison,
          estimatedSources: 5,
        },
        {
          id: "step_5",
          type: "verification",
          query: `${query} ${SEARCH_ENHANCE[language].latest(new Date().getFullYear())}`,
          rationale: PLANNER_PROMPTS[language].defaultRationale.verification,
          estimatedSources: 5,
        },
      );
    }

    return {
      objective: PLANNER_PROMPTS[language].defaultObjective(query),
      approach: PLANNER_PROMPTS[language].defaultApproach,
      steps,
      estimatedTime: steps.length * 20,
    };
  }
}
