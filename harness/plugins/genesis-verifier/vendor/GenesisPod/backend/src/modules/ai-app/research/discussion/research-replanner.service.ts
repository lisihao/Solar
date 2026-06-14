import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { SearchRound, ResearchPlanStep, ResearchStepType } from "./types";
import { ResearchLanguage, resolveLanguage } from "./prompt-locale";

export interface ReplanRecord {
  triggerStep: number;
  reason: string;
  addedQueries: string[];
  timestamp: Date;
}

interface AIReplanResponse {
  needsReplan: boolean;
  reason: string;
  additionalQueries: Array<{
    query: string;
    type: ResearchStepType;
    rationale: string;
  }>;
}

/**
 * 动态重规划服务
 *
 * 在执行阶段完成后，评估已有搜索结果，识别信息缺口，
 * 动态补充新的搜索步骤以提升研究覆盖度。
 */
@Injectable()
export class ResearchReplannerService {
  private readonly logger = new Logger(ResearchReplannerService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 评估已完成的搜索轮次，决定是否需要补充搜索。
   * 返回需要追加的搜索步骤（最多 3 个）。
   */
  async evaluateAndReplan(
    originalQuery: string,
    completedRounds: SearchRound[],
    language?: string,
  ): Promise<{
    needsReplan: boolean;
    additionalSteps: ResearchPlanStep[];
    record?: ReplanRecord;
  }> {
    if (completedRounds.length === 0) {
      return { needsReplan: false, additionalSteps: [] };
    }

    const lang = resolveLanguage(language);

    try {
      const summary = this.buildSearchSummary(completedRounds, lang);
      const response = await this.callReplannerAI(originalQuery, summary, lang);

      if (!response.needsReplan || response.additionalQueries.length === 0) {
        this.logger.debug(
          `[Replanner] No replan needed for query: ${originalQuery.slice(0, 60)}`,
        );
        return { needsReplan: false, additionalSteps: [] };
      }

      const additionalSteps: ResearchPlanStep[] = response.additionalQueries
        .slice(0, 3)
        .map((q) => ({
          id: `replan_${randomUUID()}`,
          type: q.type,
          query: q.query,
          rationale: q.rationale,
          estimatedSources: 10,
        }));

      const record: ReplanRecord = {
        triggerStep: completedRounds.length,
        reason: response.reason,
        addedQueries: additionalSteps.map((s) => s.query),
        timestamp: new Date(),
      };

      this.logger.log(
        `[Replanner] Replan triggered: ${response.reason.slice(0, 100)}. Added ${additionalSteps.length} steps.`,
      );

      return { needsReplan: true, additionalSteps, record };
    } catch (error) {
      this.logger.warn(
        `[Replanner] Replan evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { needsReplan: false, additionalSteps: [] };
    }
  }

  private buildSearchSummary(
    rounds: SearchRound[],
    lang: ResearchLanguage,
  ): string {
    return rounds
      .map((r) => {
        const topSources = r.sources
          .slice(0, 3)
          .map((s) => `  - ${s.title}: ${s.snippet.slice(0, 120)}`)
          .join("\n");
        if (lang === "en-US") {
          return `Round ${r.round} | Query: "${r.query}" | Found ${r.resultsCount} sources\n${topSources}`;
        }
        return `第${r.round}轮 | 查询: "${r.query}" | 找到 ${r.resultsCount} 个来源\n${topSources}`;
      })
      .join("\n\n");
  }

  private async callReplannerAI(
    originalQuery: string,
    searchSummary: string,
    lang: ResearchLanguage,
  ): Promise<AIReplanResponse> {
    const systemPrompt =
      lang === "en-US"
        ? `You are a research strategist. Analyze the completed search results and identify critical gaps.
Determine if additional searches are needed to achieve comprehensive coverage of the research topic.

Return ONLY a JSON object in this format:
{
  "needsReplan": boolean,
  "reason": "brief reason for the decision",
  "additionalQueries": [
    {
      "query": "specific search query",
      "type": "initial_search|deep_dive|academic|comparison|verification",
      "rationale": "why this search is needed"
    }
  ]
}

Rules:
- Only suggest additional queries if there are clear, important gaps
- Maximum 3 additional queries
- Each query must address a distinct gap not covered by existing results
- If coverage is adequate, set needsReplan to false and additionalQueries to []`
        : `你是一名研究策略师。分析已完成的搜索结果，识别关键信息缺口。
判断是否需要补充搜索以实现对研究主题的全面覆盖。

仅返回以下格式的 JSON 对象：
{
  "needsReplan": boolean,
  "reason": "简短说明决策原因",
  "additionalQueries": [
    {
      "query": "具体的搜索查询",
      "type": "initial_search|deep_dive|academic|comparison|verification",
      "rationale": "为什么需要这个搜索"
    }
  ]
}

规则：
- 只有存在明显重要的信息缺口时才建议补充查询
- 最多 3 个补充查询
- 每个查询必须针对现有结果中未涵盖的独特缺口
- 如果覆盖已经充分，将 needsReplan 设为 false，additionalQueries 设为 []`;

    const userPrompt =
      lang === "en-US"
        ? `Research Topic: "${originalQuery}"\n\nCompleted Searches:\n${searchSummary}\n\nAre there critical gaps that require additional searches?`
        : `研究主题: "${originalQuery}"\n\n已完成的搜索:\n${searchSummary}\n\n是否存在需要补充搜索的关键信息缺口？`;

    const result = await this.chatFacade.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      modelType: AIModelType.CHAT,
      taskProfile: {
        creativity: "deterministic",
        outputLength: "short",
      },
      skipGuardrails: true, // 内部系统调用，研究内容可能触发误报
    });

    try {
      const jsonMatch =
        result.content.match(/```json\s*([\s\S]*?)\s*```/) ||
        result.content.match(/\{[\s\S]*"needsReplan"[\s\S]*\}/);

      const jsonStr = jsonMatch
        ? jsonMatch[1] || jsonMatch[0]
        : result.content.trim();
      const parsed = JSON.parse(jsonStr) as AIReplanResponse;

      if (typeof parsed.needsReplan !== "boolean") {
        return {
          needsReplan: false,
          reason: "Invalid response",
          additionalQueries: [],
        };
      }

      return {
        needsReplan: parsed.needsReplan,
        reason: parsed.reason || "",
        additionalQueries: Array.isArray(parsed.additionalQueries)
          ? parsed.additionalQueries
          : [],
      };
    } catch {
      this.logger.warn(
        "[Replanner] Failed to parse AI response, skipping replan",
      );
      return {
        needsReplan: false,
        reason: "Parse error",
        additionalQueries: [],
      };
    }
  }
}
