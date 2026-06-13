/**
 * PredictionCalibrationService —— 前瞻预测校准闭环（Foresight L3）
 *
 * 上游：docs/architecture/playground-foresight-plan.md L3 §5
 *
 * 内聚一个特性的全部逻辑（不污染 god-class MissionStore）：
 *   - recordPredictions：s11 持久化后把 signed mission 的 foresight.baseCase 落库
 *   - getDuePredictions：scheduler 扫到期未裁决的预测
 *   - judgeOutcome：全自动裁决——web 检索（SearchService）+ LLM 判定（AiChatService）
 *   - resolvePrediction：回填 actualOutcome + Brier 分
 *   - getTopicCalibration：聚合该 topic 历史 Brier，反哺下次预测保守度
 *
 * 全自动裁决说明（用户决策 2026-05-29）：默认 web 检索 + LLM 判定并强制记录证据 URL；
 * 低置信裁决标 needsReview（不阻塞 Brier，仅在已裁决样本上算）。
 */

import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AiChatService, SearchService } from "@/modules/ai-engine/facade";

/** foresight.baseCase 单条判断（与 analyst.foresight.baseCase 对齐） */
export interface ForesightBaseCaseInput {
  judgment: string;
  probability: number;
  confidence: "low" | "moderate" | "high";
  horizon: "0-6m" | "6-18m" | "18m-3y" | "3y+";
  resolutionCriteria: string;
}

/** horizon → 到期日偏移（用区间中点，避免太早/太晚裁决）。返回毫秒。 */
const HORIZON_OFFSET_MS: Record<string, number> = {
  "0-6m": 3 * 30 * 24 * 60 * 60 * 1000, // ~3 个月
  "6-18m": 12 * 30 * 24 * 60 * 60 * 1000, // ~12 个月
  "18m-3y": 27 * 30 * 24 * 60 * 60 * 1000, // ~27 个月
  "3y+": 42 * 30 * 24 * 60 * 60 * 1000, // ~42 个月
};

interface OutcomeJudgment {
  outcome: boolean | null; // true=应验 / false=证伪 / null=无法判定
  evidenceUrl: string | null;
  confidence: number; // 0-1
  needsReview: boolean;
}

@Injectable()
export class PredictionCalibrationService {
  private readonly log = new Logger(PredictionCalibrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: AiChatService,
    private readonly search: SearchService,
  ) {}

  /**
   * 留痕：把 signed mission 的 baseCase 判断写入预测记录表（actualOutcome=null）。
   * 已存在同 mission 的记录则跳过（幂等：rerun 不重复落库）。
   */
  async recordPredictions(args: {
    missionId: string;
    userId: string;
    topic: string;
    baseCase: ForesightBaseCaseInput[];
  }): Promise<number> {
    const { missionId, userId, topic, baseCase } = args;
    if (!baseCase.length) return 0;

    const existing = await this.prisma.agentPlaygroundPredictionRecord.count({
      where: { missionId },
    });
    if (existing > 0) return 0; // 幂等

    const now = Date.now();
    const rows = baseCase.map((b) => ({
      missionId,
      userId,
      topic: topic.slice(0, 500),
      predictionText: b.judgment,
      probability: clamp01(b.probability),
      confidence: b.confidence,
      horizon: b.horizon,
      targetDate: new Date(
        now + (HORIZON_OFFSET_MS[b.horizon] ?? HORIZON_OFFSET_MS["6-18m"]),
      ),
      resolutionCriteria: b.resolutionCriteria,
    }));
    await this.prisma.agentPlaygroundPredictionRecord.createMany({
      data: rows,
    });
    this.log.log(
      `[calibration] recorded ${rows.length} prediction(s) for mission=${missionId}`,
    );
    return rows.length;
  }

  /** scheduler 用：到期且未裁决的预测（actualOutcome IS NULL AND target_date <= now）。 */
  async getDuePredictions(limit: number): Promise<
    {
      id: string;
      predictionText: string;
      resolutionCriteria: string;
      topic: string;
      probability: number;
    }[]
  > {
    return this.prisma.agentPlaygroundPredictionRecord.findMany({
      where: { actualOutcome: null, targetDate: { lte: new Date() } },
      orderBy: { targetDate: "asc" },
      take: limit,
      select: {
        id: true,
        predictionText: true,
        resolutionCriteria: true,
        topic: true,
        probability: true,
      },
    });
  }

  /**
   * 全自动裁决：web 检索证据 → LLM 判定 outcome。
   * 失败/无证据 → outcome=null + needsReview=true（不污染 Brier）。
   */
  async judgeOutcome(prediction: {
    predictionText: string;
    resolutionCriteria: string;
    topic: string;
  }): Promise<OutcomeJudgment> {
    const query =
      `${prediction.topic} ${prediction.predictionText} ${prediction.resolutionCriteria}`.slice(
        0,
        380,
      );
    let evidenceBlock = "（无搜索结果）";
    let topUrl: string | null = null;
    try {
      const res = await this.search.search(query, 5);
      if (res.success && res.results.length > 0) {
        topUrl = res.results[0]?.url ?? null;
        evidenceBlock = res.results
          .slice(0, 5)
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}\n${r.url}\n${(r.content ?? "").slice(0, 400)}`,
          )
          .join("\n\n");
      }
    } catch (err) {
      this.log.warn(
        `[calibration] search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const prompt = [
      `你是一个预测裁决员。根据下面的搜索证据，判断这条预测到期后是否"应验"。`,
      ``,
      `预测：${prediction.predictionText}`,
      `裁决标准：${prediction.resolutionCriteria}`,
      ``,
      `搜索证据：`,
      evidenceBlock,
      ``,
      `严格输出 JSON：{ "outcome": "true" | "false" | "unknown", "evidenceUrl": "<最相关证据 URL，无则空串>", "confidence": 0~1 }`,
      `- outcome=true 表示预测应验；false 表示证伪；unknown 表示证据不足以判定。`,
      `- 证据不足 / 模糊 / 搜索无结果 → 必须 unknown，不要硬猜。`,
      `- confidence 是你对本次裁决的信心（不是预测概率）。`,
    ].join("\n");

    try {
      const response = await this.chat.chat({
        messages: [{ role: "system", content: prompt }],
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "deterministic", outputLength: "short" },
      });
      const parsed = parseJudgment(response.content);
      if (!parsed || parsed.outcome === "unknown") {
        return {
          outcome: null,
          evidenceUrl: parsed?.evidenceUrl || topUrl,
          confidence: parsed?.confidence ?? 0,
          needsReview: true,
        };
      }
      const conf = clamp01(parsed.confidence ?? 0);
      return {
        outcome: parsed.outcome === "true",
        evidenceUrl: parsed.evidenceUrl || topUrl,
        confidence: conf,
        needsReview: conf < 0.6, // 低置信进人工队列
      };
    } catch (err) {
      this.log.warn(
        `[calibration] judge LLM failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        outcome: null,
        evidenceUrl: topUrl,
        confidence: 0,
        needsReview: true,
      };
    }
  }

  /** 回填裁决结果 + Brier 分。outcome=null（未判定）只标 needsReview，不算 Brier。 */
  async resolvePrediction(
    id: string,
    judgment: OutcomeJudgment,
    probability: number,
  ): Promise<void> {
    const brierScore =
      judgment.outcome === null
        ? null
        : Math.pow(clamp01(probability) - (judgment.outcome ? 1 : 0), 2);
    await this.prisma.agentPlaygroundPredictionRecord.update({
      where: { id },
      data: {
        actualOutcome: judgment.outcome,
        outcomeEvidenceUrl: judgment.evidenceUrl ?? undefined,
        needsReview: judgment.needsReview,
        brierScore,
        judgmentAt: new Date(),
      },
    });
  }

  /**
   * 反哺：该 user+topic 历史已裁决预测的平均 Brier（越低越准）。
   * 返回 null = 无历史样本。Leader 规划时用它调下次 foresight 概率保守度。
   */
  async getTopicCalibration(
    userId: string,
    topic: string,
  ): Promise<{ avgBrier: number; sampleSize: number } | null> {
    const resolved = await this.prisma.agentPlaygroundPredictionRecord.findMany(
      {
        where: {
          userId,
          topic: topic.slice(0, 500),
          brierScore: { not: null },
        },
        select: { brierScore: true },
        take: 200,
      },
    );
    if (resolved.length === 0) return null;
    const sum = resolved.reduce((acc, r) => acc + (r.brierScore ?? 0), 0);
    return { avgBrier: sum / resolved.length, sampleSize: resolved.length };
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function parseJudgment(
  raw: string,
): {
  outcome: "true" | "false" | "unknown";
  evidenceUrl?: string;
  confidence?: number;
} | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]) as {
      outcome?: string;
      evidenceUrl?: string;
      confidence?: number;
    };
    const outcome =
      obj.outcome === "true" || obj.outcome === "false"
        ? obj.outcome
        : "unknown";
    return {
      outcome,
      evidenceUrl:
        typeof obj.evidenceUrl === "string" ? obj.evidenceUrl : undefined,
      confidence:
        typeof obj.confidence === "number" ? obj.confidence : undefined,
    };
  } catch {
    return null;
  }
}
