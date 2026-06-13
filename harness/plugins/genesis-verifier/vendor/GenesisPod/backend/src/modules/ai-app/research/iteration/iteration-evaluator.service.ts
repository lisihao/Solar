import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ResearchIdeaService } from "../idea/research-idea.service";
import { ResearchDemoService } from "../demo/research-demo.service";
import { TopicClassifierService, DemoEvaluatorService } from "../evaluation";
import type { TopicType, DemoScore } from "../evaluation";
import type { DeepResearchReport } from "../discussion/types";
import type { StartIterativeResearchDto } from "./types";
import { DEMO_CONFIG } from "../config/research.config";

const DEMO_POLL_INTERVAL_MS = DEMO_CONFIG.POLL_INTERVAL_MS;
const DEMO_POLL_TIMEOUT_MS = DEMO_CONFIG.POLL_TIMEOUT_MS;

export interface IdeaItem {
  id: string;
  title: string;
  type: string;
  description: string;
  metadata: unknown;
}

// ---------------------------------------------------------------------------
// Context window constants — kept here alongside buildPreviousContext()
// ---------------------------------------------------------------------------
const CONTEXT_SECTION_MAX = 500;
const CONTEXT_SUMMARY_MAX = 1000;
const CONTEXT_CONCLUSION_MAX = 500;

/** Max total length for the assembled iteration history injected into context */
const ITERATION_HISTORY_MAX_LENGTH = 2000;
/** Max feedback entries to keep (most recent) */
const MAX_FEEDBACK_ENTRIES = 3;
/** Max chars per feedback entry */
const MAX_FEEDBACK_ENTRY_LENGTH = 200;
/** Max chars per iteration record */
const MAX_RECORD_LENGTH = 500;
/** Max recent records to include */
const MAX_RECENT_RECORDS = 2;

/**
 * Handles LLM-backed evaluation steps within the iterative research loop:
 * topic classification, idea extraction, demo creation + polling, and demo
 * scoring. Also owns the pure context-building helpers used by the coordinator.
 */
@Injectable()
export class IterationEvaluatorService {
  private readonly logger = new Logger(IterationEvaluatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly topicClassifier?: TopicClassifierService,
    @Optional() private readonly demoEvaluator?: DemoEvaluatorService,
    @Optional() private readonly ideaService?: ResearchIdeaService,
    @Optional() private readonly demoService?: ResearchDemoService,
  ) {}

  async classifyTopic(
    query: string,
    reportSummary: string,
  ): Promise<TopicType> {
    if (!this.topicClassifier) return "market";
    try {
      return await this.topicClassifier.classify(query, reportSummary);
    } catch (err) {
      this.logger.warn(
        `Topic classification failed, defaulting to 'market': ${err instanceof Error ? err.message : String(err)}`,
      );
      return "market";
    }
  }

  async extractIdeas(
    userId: string,
    projectId: string,
    sessionId: string,
  ): Promise<IdeaItem[]> {
    if (!this.ideaService) return [];
    try {
      return (await this.ideaService.extractFromSession(
        userId,
        projectId,
        sessionId,
      )) as IdeaItem[];
    } catch (err) {
      this.logger.warn(
        `Idea extraction failed for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Extracts creative ideas from all project insights.
   * Safe wrapper that never throws — returns empty array on failure.
   */
  async extractCreativeIdeasSafe(
    userId: string,
    projectId: string,
  ): Promise<IdeaItem[]> {
    if (!this.ideaService) return [];
    try {
      return (await this.ideaService.extractCreativeIdeas(
        userId,
        projectId,
      )) as IdeaItem[];
    } catch (err) {
      this.logger.warn(
        `Creative idea extraction failed for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  async evaluateDemo(
    html: string,
    ideaPool: { insights: string[]; creativeIdeas: string[] },
    topicType: TopicType,
    researchQuery: string,
  ): Promise<DemoScore> {
    const fallback: DemoScore = {
      auto: {
        structureValid: false,
        noExternalDeps: true,
        viewCount: 0,
        interactiveElements: 0,
        dataPoints: 0,
        hasStateManagement: false,
        codeSize: 0,
      },
      llm: {
        ideaAlignment: 0.5,
        insightDensity: 0.5,
        dataCompleteness: 0.5,
        interactionQuality: 0.5,
        gaps: { dataGaps: [], ideaGaps: [] },
        topicTypeMatch: true,
      },
      composite: 0.5,
      gaps: { dataGaps: [], ideaGaps: [] },
    };

    if (!this.demoEvaluator) return fallback;

    try {
      return await this.demoEvaluator.evaluate(
        html,
        ideaPool,
        topicType,
        researchQuery,
      );
    } catch (err) {
      this.logger.warn(
        `Demo evaluation failed, using fallback score: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback;
    }
  }

  /**
   * Creates a demo for an idea and polls until generation completes or times out.
   * Returns the completed demo record (with htmlContent) or null on failure.
   */
  async createAndPollDemo(
    userId: string,
    projectId: string,
    ideaId: string,
  ): Promise<{ id: string; htmlContent: string; status: string } | null> {
    if (!this.demoService) return null;

    let demoId: string;
    try {
      const created = await this.demoService.createForIdea(
        userId,
        projectId,
        ideaId,
      );
      demoId = created.id;
    } catch (err) {
      this.logger.warn(
        `createForIdea failed for idea ${ideaId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    return this.pollDemoCompletion(demoId);
  }

  /**
   * Polls the database every DEMO_POLL_INTERVAL_MS until the demo reaches
   * COMPLETED or FAILED status, or until DEMO_POLL_TIMEOUT_MS elapses.
   */
  private async pollDemoCompletion(
    demoId: string,
  ): Promise<{ id: string; htmlContent: string; status: string } | null> {
    const deadline = Date.now() + DEMO_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const demo = await this.prisma.researchDemo.findUnique({
        where: { id: demoId },
        select: { id: true, htmlContent: true, status: true },
      });

      if (!demo) {
        this.logger.warn(`Demo ${demoId} not found during poll`);
        return null;
      }

      if (demo.status === "COMPLETED") {
        return {
          id: demo.id,
          htmlContent: demo.htmlContent ?? "",
          status: demo.status,
        };
      }

      if (demo.status === "FAILED") {
        this.logger.warn(`Demo ${demoId} generation failed`);
        return null;
      }

      await sleep(DEMO_POLL_INTERVAL_MS);
    }

    this.logger.warn(
      `Demo ${demoId} did not complete within ${DEMO_POLL_TIMEOUT_MS}ms`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — no class state needed
// ---------------------------------------------------------------------------

/**
 * Fallback quality estimation when demo evaluation is unavailable.
 * Uses report structure, content depth, and idea pool as heuristics.
 * When `previousReport` is provided, applies an incremental improvement bonus
 * (up to 0.1) based on section count, reference count, and total content growth.
 */
export function estimateReportQuality(
  report: DeepResearchReport,
  insightCount: number,
  creativeIdeaCount: number,
  previousReport?: DeepResearchReport,
): { score: number; gaps: { dataGaps: string[]; ideaGaps: string[] } } {
  const sections = report.sections ?? [];
  const refs = report.references ?? [];
  const hasSummary = (report.executiveSummary?.length ?? 0) > 100;
  const hasConclusion = (report.conclusion?.length ?? 0) > 50;

  const sectionScore = Math.min(sections.length / 8, 1);
  const refScore = Math.min(refs.length / 40, 1);
  const depthScore = Math.min(
    sections.reduce((sum, s) => sum + (s.content?.length ?? 0), 0) / 20000,
    1,
  );
  const ideaScore = Math.min(insightCount / 15, 1);
  const structureScore = (hasSummary ? 0.5 : 0) + (hasConclusion ? 0.5 : 0);

  const rawScore =
    sectionScore * 0.25 +
    refScore * 0.2 +
    depthScore * 0.25 +
    ideaScore * 0.15 +
    structureScore * 0.15;
  const baseScore = Math.min(rawScore, 0.65);

  let incrementalBonus = 0;
  if (previousReport) {
    const prevSections = previousReport.sections?.length ?? 0;
    const prevRefs = previousReport.references?.length ?? 0;
    const prevDepth = (previousReport.sections ?? []).reduce(
      (sum, s) => sum + (s.content?.length ?? 0),
      0,
    );
    const currDepth = sections.reduce(
      (sum, s) => sum + (s.content?.length ?? 0),
      0,
    );

    let improvements = 0;
    if (sections.length > prevSections) improvements++;
    if (refs.length > prevRefs) improvements++;
    if (currDepth > prevDepth) improvements++;

    incrementalBonus = Math.min((improvements / 3) * 0.1, 0.1);
  }

  const score = Math.min(baseScore + incrementalBonus, 1);

  const dataGaps: string[] = [];
  const ideaGaps: string[] = [];

  if (sections.length < 4) dataGaps.push("报告章节不够全面，需要更多研究方向");
  if (refs.length < 10) dataGaps.push("参考来源不足，需要更多数据支撑");
  if (!hasSummary) dataGaps.push("缺少深入的执行摘要");
  if (depthScore < 0.5) dataGaps.push("各章节分析深度不够，需要更详细的论述");
  if (insightCount < 5) ideaGaps.push("洞察数量不足，需要更多独到见解");
  if (creativeIdeaCount === 0)
    ideaGaps.push("缺少创意方案，需要提出创新性观点");

  if (dataGaps.length === 0 && ideaGaps.length === 0 && score < 0.75) {
    dataGaps.push("需要更深入的分析和交叉验证");
  }

  return { score, gaps: { dataGaps, ideaGaps } };
}

export function buildFollowUpQuery(
  originalQuery: string,
  gaps: { dataGaps: string[]; ideaGaps: string[] },
  userFeedback?: string | null,
): string {
  const parts: string[] = [];

  if (userFeedback) {
    parts.push(`[用户指令] ${userFeedback}`);
  }

  const gapParts = [...gaps.dataGaps.slice(0, 3), ...gaps.ideaGaps.slice(0, 2)];
  if (gapParts.length > 0) {
    parts.push(`[系统识别的gap] ${gapParts.join("; ")}`);
  }

  if (parts.length === 0) {
    return `${originalQuery} — 需要更深入的分析和额外证据`;
  }

  return `${originalQuery} — ${parts.join(" | ")}`;
}

export function buildPreviousContext(
  report: DeepResearchReport,
  iterationHistory?: string,
): StartIterativeResearchDto["previousContext"] {
  return {
    executiveSummary: report.executiveSummary?.slice(0, CONTEXT_SUMMARY_MAX),
    sections: report.sections.map((s) => ({
      title: s.title,
      content: s.content?.slice(0, CONTEXT_SECTION_MAX),
    })),
    conclusion: report.conclusion?.slice(0, CONTEXT_CONCLUSION_MAX),
    references: report.references.map((r) => ({
      title: r.title,
      url: r.url,
    })),
    iterationHistory,
  };
}

export function buildIterationHistory(
  records: string[],
  scores: number[],
  userFeedbackHistory: string[],
): string {
  const parts: string[] = [];

  if (scores.length > 0) {
    const trajectory = scores
      .map((s, i) => `Round ${i}: ${(s * 100).toFixed(0)}%`)
      .join(" → ");
    parts.push(`## 分数轨迹\n${trajectory}`);
  }

  if (userFeedbackHistory.length > 0) {
    const recentFeedback = userFeedbackHistory.slice(-MAX_FEEDBACK_ENTRIES);
    const startIdx = userFeedbackHistory.length - recentFeedback.length;
    const fbLines = recentFeedback
      .map((f, i) => {
        const roundIdx = startIdx + i;
        const trimmed =
          f.length > MAX_FEEDBACK_ENTRY_LENGTH
            ? f.slice(0, MAX_FEEDBACK_ENTRY_LENGTH) + "..."
            : f;
        return `- Round ${roundIdx}: ${trimmed}`;
      })
      .join("\n");
    parts.push(`## 用户反馈历史\n${fbLines}`);
  }

  const recentRecords = records.slice(-MAX_RECENT_RECORDS);
  if (recentRecords.length > 0) {
    const condensed = recentRecords
      .map((r) =>
        r.length > MAX_RECORD_LENGTH
          ? r.slice(0, MAX_RECORD_LENGTH) + "..."
          : r,
      )
      .join("\n---\n");
    parts.push(`## 近期迭代记录\n${condensed}`);
  }

  const result = parts.join("\n\n");

  if (result.length <= ITERATION_HISTORY_MAX_LENGTH) {
    return result;
  }
  const truncated = result.slice(0, ITERATION_HISTORY_MAX_LENGTH);
  const lastNewline = truncated.lastIndexOf("\n");
  return lastNewline > ITERATION_HISTORY_MAX_LENGTH * 0.8
    ? truncated.slice(0, lastNewline) + "\n[...已截断]"
    : truncated + "\n[...已截断]";
}

export function extractKeywords(query: string): string[] {
  return query
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
