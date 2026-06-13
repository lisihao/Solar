import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

export interface SearchStats {
  totalSources: number;
  uniqueDomains: number;
  /** e.g. { "zh": 0.7, "en": 0.3 } */
  languageDistribution: Record<string, number>;
  avgRelevanceScore: number;
}

export interface QualityMetrics {
  coverageRate: number;
  sourcesDiversity: number;
  informationGain: number;
  finalDemoScore: number;
}

export interface StrategyRule {
  ruleId: string;
  description: string;
}

export interface StrategyEffect {
  ruleId: string;
  effect: "positive" | "negative" | "neutral";
}

export interface SessionLesson {
  pattern: string;
  recommendation: string;
  confidence: number;
}

/**
 * ResearchMemoryService — Phase 1 implementation.
 *
 * Responsibilities:
 * - Persist post-session metadata (Phase 1: logged only; Phase 2: dedicated DB table)
 * - Query historical sessions to inform current research
 * - Extract generalizable lessons from completed sessions via LLM
 */
@Injectable()
export class ResearchMemoryService {
  private readonly logger = new Logger(ResearchMemoryService.name);

  constructor(
    // Injected for future use when a ResearchSessionMeta table or a metadata
    // JSONB column is added to DeepResearchSession.
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * Save session meta after research completes.
   *
   * Phase 1: Logs the metadata only — DeepResearchSession has no generic
   * metadata column yet. Phase 2 will persist this to a dedicated table.
   */
  async saveSessionMeta(params: {
    sessionId: string;
    userId: string;
    topicType: string;
    topicKeywords: string[];
    searchStats: SearchStats;
    qualityMetrics: QualityMetrics;
    strategyUsed: StrategyRule[];
    strategyEffect: StrategyEffect[];
    iterationCount: number;
    exitReason?: string;
  }): Promise<void> {
    // Confirm the session exists before logging — surfaces typos in sessionId early.
    try {
      const exists = await this.prisma.deepResearchSession.findUnique({
        where: { id: params.sessionId },
        select: { id: true },
      });
      if (!exists) {
        this.logger.warn(
          `saveSessionMeta: session ${params.sessionId} not found, skipping`,
        );
        return;
      }
    } catch (error) {
      this.logger.warn(
        `saveSessionMeta: lookup failed for ${params.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    this.logger.log(
      `Session meta [Phase 1 — in-memory only] ` +
        `sessionId=${params.sessionId} topicType=${params.topicType} ` +
        `iterations=${params.iterationCount} exitReason=${params.exitReason ?? "none"} ` +
        `qualityMetrics=${JSON.stringify(params.qualityMetrics)}`,
    );
  }

  /**
   * Query historical sessions of the same topic type to inform current research.
   *
   * Phase 1: Returns empty — populated as sessions accumulate and the
   * ResearchSessionMeta table is introduced in Phase 2.
   */
  async getHistoricalInsights(
    userId: string,
    topicType: string,
    limit = 10,
  ): Promise<
    Array<{
      sessionId: string;
      qualityMetrics: QualityMetrics;
      lessons: SessionLesson[];
    }>
  > {
    this.logger.debug(
      `getHistoricalInsights: userId=${userId} topicType=${topicType} limit=${limit} (Phase 1 — returns empty)`,
    );
    return [];
  }

  /**
   * Use LLM to extract generalizable lessons from a completed research session.
   * Returns at most 3 rules to keep the strategy file concise.
   */
  async extractLessons(params: {
    query: string;
    topicType: string;
    iterationCount: number;
    scores: number[];
    exitReason: string;
    gaps: Array<{ dataGaps: string[]; ideaGaps: string[] }>;
  }): Promise<SessionLesson[]> {
    try {
      const result = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `你是研究方法论专家。分析本次研究的迭代过程，提炼可复用的经验教训。

输出 JSON 数组，每个元素包含:
- pattern: 什么情况下适用 (如 "人群类研究")
- recommendation: 具体建议 (如 "至少包含3个细分画像")
- confidence: 置信度 0-1

只提炼有普遍意义的规律，不要过于具体到本次研究主题。最多3条。`,
          },
          {
            role: "user",
            content: `研究主题: "${params.query}"
话题类型: ${params.topicType}
迭代次数: ${params.iterationCount}
分数变化: ${params.scores.join(" → ")}
退出原因: ${params.exitReason}
各轮 gaps: ${JSON.stringify(params.gaps)}`,
          },
        ],
        modelType: AIModelType.CHAT_FAST,
        taskProfile: { creativity: "low", outputLength: "short" },
        skipGuardrails: true, // 内部系统调用，研究内容可能触发误报
      });

      const jsonMatch =
        result.content.match(/```json\s*([\s\S]*?)\s*```/) ||
        result.content.match(/(\[[\s\S]*\])/);

      if (!jsonMatch) {
        this.logger.debug(
          "extractLessons: no JSON array found in LLM response",
        );
        return [];
      }

      const raw = jsonMatch[1] ?? jsonMatch[0];
      const parsed = JSON.parse(raw) as SessionLesson[];
      return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
    } catch (error) {
      this.logger.warn(
        `extractLessons failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }
}
