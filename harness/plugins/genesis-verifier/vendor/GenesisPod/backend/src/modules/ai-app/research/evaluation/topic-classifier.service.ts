import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { extractJson } from "./extract-json";

export type TopicType =
  | "product"
  | "market"
  | "technology"
  | "strategy"
  | "audience"
  | "trend";

interface ClassificationResult {
  type: TopicType;
  confidence: number;
  reasoning: string;
}

const VALID_TOPIC_TYPES: readonly TopicType[] = [
  "product",
  "market",
  "technology",
  "strategy",
  "audience",
  "trend",
] as const;

const FALLBACK_TYPE: TopicType = "market";

@Injectable()
export class TopicClassifierService {
  private readonly logger = new Logger(TopicClassifierService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  async classify(query: string, reportSummary: string): Promise<TopicType> {
    if (!query?.trim() && !reportSummary?.trim()) {
      this.logger.warn(
        "[TopicClassifier] Both query and reportSummary are empty, using fallback",
      );
      return FALLBACK_TYPE;
    }

    const systemPrompt = `You are a research topic classifier. Classify the given research topic into exactly one of these types:
- product: analysis of a specific product, feature, or product category
- market: market sizing, competitive landscape, industry analysis
- technology: technical deep-dives, technology comparisons, infrastructure
- strategy: business strategy, go-to-market, organizational decisions
- audience: user research, customer segments, personas, behavior analysis
- trend: emerging trends, future forecasting, macro shifts

Respond with ONLY valid JSON in this exact format:
{"type":"<one of the 6 types>","confidence":<0.0 to 1.0>,"reasoning":"<brief explanation>"}`;

    const userMessage = `Research query: ${query}

Report summary:
${reportSummary.slice(0, 1500)}

Classify this research topic.`;

    try {
      const response = await this.chatFacade.chat({
        messages: [{ role: "user", content: userMessage }],
        systemPrompt,
        modelType: AIModelType.CHAT_FAST,
        taskProfile: { creativity: "deterministic", outputLength: "minimal" },
        responseFormat: "json",
        skipGuardrails: true, // 内部系统调用，研究内容可能触发误报
      });

      if (response.isError) {
        this.logger.warn(
          `[TopicClassifier] LLM returned error, using fallback. query="${query.slice(0, 60)}"`,
        );
        return FALLBACK_TYPE;
      }

      const parsed = this.parseClassificationResult(response.content);
      if (!parsed) {
        this.logger.warn(
          `[TopicClassifier] Failed to parse LLM response, using fallback. raw="${response.content.slice(0, 200)}"`,
        );
        return FALLBACK_TYPE;
      }

      this.logger.debug(
        `[TopicClassifier] classified="${parsed.type}", confidence=${parsed.confidence}, query="${query.slice(0, 60)}"`,
      );

      return parsed.type;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[TopicClassifier] Unexpected error, using fallback: ${errorMsg}`,
      );
      return FALLBACK_TYPE;
    }
  }

  private parseClassificationResult(raw: string): ClassificationResult | null {
    try {
      const cleaned = extractJson(raw);
      const parsed = JSON.parse(cleaned) as Partial<ClassificationResult>;

      if (!parsed.type || !VALID_TOPIC_TYPES.includes(parsed.type)) {
        return null;
      }

      return {
        type: parsed.type,
        confidence:
          typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      };
    } catch {
      return null;
    }
  }
}
