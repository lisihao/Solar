import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  SearchRound,
  SearchSource,
  Reflection,
  ReflectionDecision,
  ResearchPlan,
  ResearchPlanStep,
  AIReflectionResponse,
} from "./types";
import {
  ResearchLanguage,
  resolveLanguage,
  REFLECTION_PROMPTS,
} from "./prompt-locale";

/**
 * 自我反思服务
 * 评估搜索结果质量，决定是否继续搜索
 *
 * ✅ 已迁移：使用 AIFacade 统一入口
 */
@Injectable()
export class SelfReflectionService {
  private readonly logger = new Logger(SelfReflectionService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 对当前搜索结果进行反思评估
   */
  async reflect(
    query: string,
    plan: ResearchPlan,
    searchRounds: SearchRound[],
    currentRound: number,
    maxRounds: number,
    language?: string,
  ): Promise<Reflection> {
    const lang = resolveLanguage(language);
    this.logger.debug(`Reflecting on round ${currentRound}/${maxRounds}`);

    // 准备搜索结果摘要
    const resultsSummary = this.summarizeResults(searchRounds, lang);

    const systemPrompt = this.buildReflectionPrompt(lang);
    const userPrompt = this.buildUserPrompt(
      query,
      plan,
      resultsSummary,
      currentRound,
      maxRounds,
      lang,
    );

    try {
      // ★ 使用 AIFacade 统一入口，使用 CHAT_FAST 模型进行快速反思
      const result = await this.chatFacade.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        modelType: AIModelType.CHAT_FAST,
        taskProfile: {
          creativity: "low", // 反思需要较低创造性，保持客观
          outputLength: "minimal", // 反思输出较短
        },
        skipGuardrails: true, // 内部系统调用，研究内容可能触发误报
      });

      const reflection = this.parseReflectionResponse(
        result.content,
        currentRound,
      );
      this.logger.debug(`Reflection decision: ${reflection.decision}`);

      return reflection;
    } catch (error) {
      this.logger.error(`Reflection failed: ${error}`);
      // 默认继续搜索
      return this.getDefaultReflection(currentRound, searchRounds, lang);
    }
  }

  /**
   * 快速评估是否需要继续搜索
   */
  shouldContinue(
    reflection: Reflection,
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
   * 生成调整后的搜索步骤
   */
  generatePivotSteps(
    reflection: Reflection,
    _originalPlan: ResearchPlan,
    completedRounds: number,
  ): ResearchPlanStep[] {
    if (reflection.decision !== "pivot" || !reflection.nextSteps) {
      return [];
    }

    // 基于反思建议生成新的搜索步骤
    return reflection.nextSteps.map((query, index) => ({
      id: `pivot_${completedRounds + 1}_${index + 1}`,
      type: "deep_dive" as const,
      query,
      rationale: `基于反思调整: ${reflection.reasoning}`,
      estimatedSources: 10,
    }));
  }

  /**
   * 汇总搜索结果
   */
  private summarizeResults(
    searchRounds: SearchRound[],
    language: ResearchLanguage,
  ): string {
    const allSources: SearchSource[] = [];
    for (const round of searchRounds) {
      allSources.push(...round.sources);
    }

    // 去重
    const uniqueUrls = new Set<string>();
    const uniqueSources = allSources.filter((s) => {
      if (uniqueUrls.has(s.url)) return false;
      uniqueUrls.add(s.url);
      return true;
    });

    // 提取关键信息
    const domains = [...new Set(uniqueSources.map((s) => s.domain))].slice(
      0,
      10,
    );
    const topSnippets = uniqueSources
      .slice(0, 5)
      .map((s) => `- ${s.title}: ${s.snippet.slice(0, 150)}...`);

    return REFLECTION_PROMPTS[language].resultsSummaryTemplate(
      uniqueSources.length,
      searchRounds.length,
      domains.join(", "),
      topSnippets.join("\n"),
    );
  }

  /**
   * 构建反思提示词
   */
  private buildReflectionPrompt(language: ResearchLanguage): string {
    return REFLECTION_PROMPTS[language].systemPrompt;
  }

  /**
   * 构建用户提示词
   */
  private buildUserPrompt(
    query: string,
    plan: ResearchPlan,
    resultsSummary: string,
    currentRound: number,
    maxRounds: number,
    language: ResearchLanguage,
  ): string {
    const lang = language;
    const rp = REFLECTION_PROMPTS[lang];
    const remainingSteps = plan.steps
      .slice(currentRound)
      .map((s) => `- ${s.type}: ${s.query}`)
      .join("\n");

    return rp.userPromptTemplate(
      query,
      plan.objective,
      currentRound,
      maxRounds,
      remainingSteps,
      resultsSummary,
    );
  }

  /**
   * 解析 AI 反思响应
   */
  private parseReflectionResponse(response: string, round: number): Reflection {
    try {
      const jsonMatch =
        response.match(/```json\s*([\s\S]*?)\s*```/) ||
        response.match(/\{[\s\S]*"decision"[\s\S]*\}/);

      if (!jsonMatch) {
        return this.getDefaultReflection(round, [], "zh-CN");
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed: AIReflectionResponse = JSON.parse(jsonStr);

      return {
        round,
        assessment: parsed.information_coverage,
        gaps: parsed.gaps_identified || [],
        decision: this.validateDecision(parsed.decision),
        reasoning: parsed.reasoning,
        nextSteps: parsed.suggested_queries,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`Failed to parse reflection response: ${error}`);
      return this.getDefaultReflection(round, [], "zh-CN");
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
    ];
    if (validDecisions.includes(decision as ReflectionDecision)) {
      return decision as ReflectionDecision;
    }
    return "continue";
  }

  /**
   * 获取默认反思结果
   */
  private getDefaultReflection(
    round: number,
    searchRounds: SearchRound[],
    language: ResearchLanguage,
  ): Reflection {
    const totalSources = searchRounds.reduce(
      (sum, r) => sum + r.sources.length,
      0,
    );

    // 如果已经收集了足够的来源，建议完成
    if (totalSources >= 20) {
      return {
        round,
        assessment: REFLECTION_PROMPTS[language].defaultAssessmentSufficient,
        gaps: [],
        decision: "complete",
        reasoning: REFLECTION_PROMPTS[language].defaultReasoningSufficient,
        timestamp: new Date(),
      };
    }

    return {
      round,
      assessment: REFLECTION_PROMPTS[language].defaultAssessmentInsufficient,
      gaps: [REFLECTION_PROMPTS[language].defaultGapInsufficient],
      decision: "continue",
      reasoning: REFLECTION_PROMPTS[language].defaultReasoningInsufficient,
      timestamp: new Date(),
    };
  }
}
