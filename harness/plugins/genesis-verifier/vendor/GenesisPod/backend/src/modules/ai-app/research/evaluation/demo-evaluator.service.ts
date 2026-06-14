import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { analyzeDemo, DemoAutoMetrics } from "./demo-auto-analyzer";
import type { TopicType } from "./topic-classifier.service";
import { extractJson } from "./extract-json";

export interface DemoLLMEvaluation {
  /** 0-1: how well the demo reflects ideas/insights from the idea pool */
  ideaAlignment: number;
  /** 0-1: density and quality of insights presented */
  insightDensity: number;
  /** 0-1: completeness of data shown relative to research findings */
  dataCompleteness: number;
  /** 0-1: quality and meaningfulness of interactive elements */
  interactionQuality: number;
  gaps: {
    dataGaps: string[];
    ideaGaps: string[];
  };
  /** Whether the demo content matches the expected topic type */
  topicTypeMatch: boolean;
}

export interface DemoScore {
  auto: DemoAutoMetrics;
  llm: DemoLLMEvaluation;
  /** 0-1 weighted composite score */
  composite: number;
  gaps: {
    dataGaps: string[];
    ideaGaps: string[];
  };
}

export interface IdeaPool {
  insights: string[];
  creativeIdeas: string[];
}

const DEMO_HTML_TRUNCATE_CHARS = 15000;

/** Clamps value/target to [0, 1] */
function normalize(value: number, target: number): number {
  return Math.min(value / target, 1.0);
}

const FALLBACK_LLM_EVALUATION: DemoLLMEvaluation = {
  ideaAlignment: 0.5,
  insightDensity: 0.5,
  dataCompleteness: 0.5,
  interactionQuality: 0.5,
  gaps: { dataGaps: [], ideaGaps: [] },
  topicTypeMatch: true,
};

@Injectable()
export class DemoEvaluatorService {
  private readonly logger = new Logger(DemoEvaluatorService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  async evaluate(
    html: string,
    ideaPool: IdeaPool,
    topicType: TopicType,
    researchQuery: string,
  ): Promise<DemoScore> {
    // Step 1: Auto-metrics from static DOM analysis
    const auto = analyzeDemo(html);

    // Step 2: LLM evaluation
    const llm = await this.runLLMEvaluation(
      html,
      ideaPool,
      topicType,
      researchQuery,
    );

    // Step 3: Composite score with specified weights
    const composite = this.computeComposite(auto, llm);

    this.logger.debug(
      `[DemoEvaluator] composite=${composite.toFixed(3)}, ` +
        `views=${auto.viewCount}, interactive=${auto.interactiveElements}, ` +
        `ideaAlignment=${llm.ideaAlignment}, insightDensity=${llm.insightDensity}, ` +
        `dataCompleteness=${llm.dataCompleteness}, interactionQuality=${llm.interactionQuality}`,
    );

    return {
      auto,
      llm,
      composite,
      gaps: llm.gaps,
    };
  }

  private async runLLMEvaluation(
    html: string,
    ideaPool: IdeaPool,
    topicType: TopicType,
    researchQuery: string,
  ): Promise<DemoLLMEvaluation> {
    const htmlPreview = html.slice(0, DEMO_HTML_TRUNCATE_CHARS);
    const insightsSummary = ideaPool.insights.slice(0, 10).join("\n- ");
    const ideasSummary = ideaPool.creativeIdeas.slice(0, 5).join("\n- ");

    const systemPrompt = `You are an expert evaluator for interactive research demo dashboards.
Evaluate the provided HTML demo against the research criteria and idea pool.
Respond with ONLY valid JSON matching this exact schema:
{
  "ideaAlignment": <0.0-1.0>,
  "insightDensity": <0.0-1.0>,
  "dataCompleteness": <0.0-1.0>,
  "interactionQuality": <0.0-1.0>,
  "dataGaps": ["<missing data point>", ...],
  "ideaGaps": ["<missing idea or insight>", ...],
  "topicTypeMatch": <true|false>
}`;

    const userMessage = `Research query: ${researchQuery}
Topic type: ${topicType}

Key insights from research:
- ${insightsSummary || "(none)"}

Creative ideas in scope:
- ${ideasSummary || "(none)"}

Demo HTML (first ${DEMO_HTML_TRUNCATE_CHARS} chars):
${htmlPreview}

Evaluate this demo on:
1. ideaAlignment (0-1): Do the data and visuals reflect the research insights and creative ideas?
2. insightDensity (0-1): How dense and meaningful are the insights presented?
3. dataCompleteness (0-1): How completely does the demo cover the key data points from the research?
4. interactionQuality (0-1): Are the interactive elements meaningful and informative for this topic type?
5. dataGaps: Specific data points mentioned in insights that are absent from the demo.
6. ideaGaps: Specific creative ideas or features that should be in the demo but are missing.
7. topicTypeMatch: Does the demo content and structure match the "${topicType}" topic type?`;

    try {
      const response = await this.chatFacade.chat({
        messages: [{ role: "user", content: userMessage }],
        systemPrompt,
        modelType: AIModelType.CHAT_FAST,
        taskProfile: { creativity: "deterministic", outputLength: "short" },
        responseFormat: "json",
        skipGuardrails: true, // 内部系统调用，研究内容可能触发误报
      });

      if (response.isError) {
        this.logger.warn(
          `[DemoEvaluator] LLM evaluation failed, using fallback scores. error="${response.content.slice(0, 100)}"`,
        );
        return FALLBACK_LLM_EVALUATION;
      }

      return this.parseLLMEvaluation(response.content);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[DemoEvaluator] Unexpected error during LLM evaluation, using fallback: ${errorMsg}`,
      );
      return FALLBACK_LLM_EVALUATION;
    }
  }

  private parseLLMEvaluation(raw: string): DemoLLMEvaluation {
    try {
      const cleaned = extractJson(raw);
      const parsed = JSON.parse(cleaned) as Partial<{
        ideaAlignment: number;
        insightDensity: number;
        dataCompleteness: number;
        interactionQuality: number;
        dataGaps: string[];
        ideaGaps: string[];
        topicTypeMatch: boolean;
      }>;

      const clamp = (v: unknown, fallback: number): number => {
        const n = Number(v);
        return isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
      };

      return {
        ideaAlignment: clamp(parsed.ideaAlignment, 0.5),
        insightDensity: clamp(parsed.insightDensity, 0.5),
        dataCompleteness: clamp(parsed.dataCompleteness, 0.5),
        interactionQuality: clamp(parsed.interactionQuality, 0.5),
        gaps: {
          dataGaps: Array.isArray(parsed.dataGaps)
            ? parsed.dataGaps.filter((g): g is string => typeof g === "string")
            : [],
          ideaGaps: Array.isArray(parsed.ideaGaps)
            ? parsed.ideaGaps.filter((g): g is string => typeof g === "string")
            : [],
        },
        topicTypeMatch:
          typeof parsed.topicTypeMatch === "boolean"
            ? parsed.topicTypeMatch
            : true,
      };
    } catch {
      this.logger.warn(
        `[DemoEvaluator] Failed to parse LLM evaluation JSON, using fallback. raw="${raw.slice(0, 200)}"`,
      );
      return FALLBACK_LLM_EVALUATION;
    }
  }

  /**
   * Composite score formula (weights must sum to 1.0):
   *   0.15 * normalize(viewCount, 3)
   *   0.15 * normalize(interactiveElements, 5)
   *   0.20 * ideaAlignment
   *   0.20 * insightDensity
   *   0.15 * dataCompleteness
   *   0.15 * interactionQuality
   */
  private computeComposite(
    auto: DemoAutoMetrics,
    llm: DemoLLMEvaluation,
  ): number {
    const score =
      0.15 * normalize(auto.viewCount, 3) +
      0.15 * normalize(auto.interactiveElements, 5) +
      0.2 * llm.ideaAlignment +
      0.2 * llm.insightDensity +
      0.15 * llm.dataCompleteness +
      0.15 * llm.interactionQuality;

    return Math.max(0, Math.min(1, score));
  }
}
