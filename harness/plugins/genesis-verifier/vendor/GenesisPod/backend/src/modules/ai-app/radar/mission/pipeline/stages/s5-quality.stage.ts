/**
 * S5 — quality scoring stage adapter
 *
 * primitive=assess, roleId=quality-rater
 *
 * 输入：ctx.state.uniqueItems + relevanceScores。
 * 仅处理 relevanceScore >= RADAR_PIPELINE_DEFAULTS.relevanceThreshold 的 item。
 * 批量 10 个 item 一批调 AiChatService，LLM 同时输出 qualityScore (0-100) + aiSummary (≤80 字)。
 *
 * LLM 解析失败 / 调用失败 → 整批兜底 score=30 summary="LLM 失败兜底"，
 * 不阻断下游 stage。
 */
import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { AiChatService } from "@/modules/ai-engine/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RADAR_PIPELINE_DEFAULTS } from "../../../runtime/radar.constants";
import type {
  RadarMissionContext,
  RadarStageHookArgs,
  RadarStageRunner,
} from "./radar-stage-types";

const BATCH_SIZE = RADAR_PIPELINE_DEFAULTS.qualityBatchSize;

interface QualityScored {
  id: string;
  qualityScore: number;
  aiSummary: string;
}

@Injectable()
export class RadarS5QualityStage implements RadarStageRunner {
  private readonly log = new Logger(RadarS5QualityStage.name);

  constructor(
    private readonly chat: AiChatService,
    private readonly prisma: PrismaService,
  ) {}

  async run(args: RadarStageHookArgs, ctx: RadarMissionContext): Promise<void> {
    const newItemIds = ctx.state.newItemIds ?? [];
    const uniqueItems = ctx.state.uniqueItems ?? [];
    const relevanceScores = ctx.state.relevanceScores ?? new Map();

    if (newItemIds.length === 0 || uniqueItems.length === 0) {
      ctx.state.qualityScores = new Map();
      return;
    }

    const systemPrompt =
      args.systemPrompt ||
      "你是 AI 雷达的质量评分员，按 JSON schema 输出每条 0-100 质量分和摘要。";

    // 按 relevanceScore 过滤，只评分通过阈值的 item
    const threshold = RADAR_PIPELINE_DEFAULTS.relevanceThreshold;
    const itemsForLLM = uniqueItems
      .map((raw, idx) => ({
        id: newItemIds[idx],
        title: raw.title ?? "",
        content: raw.content ?? "",
        url: raw.url ?? "",
        source: raw.sourceId,
      }))
      .filter((item) => {
        const rel = relevanceScores.get(item.id);
        return rel !== undefined && rel.score >= threshold;
      });

    const qualityScores = new Map<string, { score: number; summary: string }>();

    for (let i = 0; i < itemsForLLM.length; i += BATCH_SIZE) {
      if (ctx.signal.aborted) throw new Error("aborted_during_quality_scoring");
      const batch = itemsForLLM.slice(i, i + BATCH_SIZE);
      const scored = await this.scoreBatch(systemPrompt, batch, ctx.userId);
      for (const s of scored) {
        qualityScores.set(s.id, {
          score: s.qualityScore,
          summary: s.aiSummary,
        });
      }
    }

    ctx.state.qualityScores = qualityScores;

    await this.persistScores(qualityScores);

    this.log.log(
      `[${ctx.missionId}] S5 quality: scored=${qualityScores.size}/${itemsForLLM.length}`,
    );

    return;
  }

  private async scoreBatch(
    systemPrompt: string,
    batch: Array<{
      id: string;
      title: string;
      content: string;
      url: string;
      source: string;
    }>,
    userId: string,
  ): Promise<QualityScored[]> {
    const userPrompt = `请为下列 ${batch.length} 个条目逐一评估信息质量。

候选条目（JSON Lines，每行一条）：
${batch
  .map((item, idx) =>
    JSON.stringify({
      id: item.id,
      idx,
      source: item.source,
      title: truncate(item.title, 200),
      content: truncate(item.content, 600),
      url: item.url,
    }),
  )
  .join("\n")}

评分维度：原创性、内容深度、来源可信度、信息密度。

请严格按以下 JSON schema 返回（无 markdown 围栏）：
{
  "items": [
    { "id": "<原 id>", "qualityScore": 0-100, "aiSummary": "≤80 字中文摘要" }
  ]
}`;

    try {
      const result = await this.chat.chat({
        systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        modelType: AIModelType.CHAT_FAST,
        taskProfile: {
          creativity: "deterministic",
          outputLength: "short",
        },
        userId,
        operationName: "radar.s5-quality",
        skipGuardrails: true,
      });

      const parsed = tryParseJson<{ items: QualityScored[] }>(result.content);
      if (!parsed || !Array.isArray(parsed.items)) {
        this.log.warn("Quality LLM unparseable, fallback 30");
        return batch.map((item) => ({
          id: item.id,
          qualityScore: 30,
          aiSummary: "LLM 失败兜底",
        }));
      }

      const byId = new Map(parsed.items.map((x) => [x.id, x]));
      return batch.map((item) => {
        const entry = byId.get(item.id);
        if (!entry) {
          return { id: item.id, qualityScore: 30, aiSummary: "LLM 漏评分兜底" };
        }
        return {
          id: item.id,
          qualityScore: clampScore(entry.qualityScore, 30),
          aiSummary:
            typeof entry.aiSummary === "string"
              ? truncate(entry.aiSummary, 80)
              : "LLM 失败兜底",
        };
      });
    } catch (err) {
      this.log.error(`S5 quality LLM err: ${(err as Error).message}`);
      return batch.map((item) => ({
        id: item.id,
        qualityScore: 30,
        aiSummary: "LLM 失败兜底",
      }));
    }
  }

  private async persistScores(
    qualityScores: Map<string, { score: number; summary: string }>,
  ): Promise<void> {
    if (qualityScores.size === 0) return;
    await this.prisma.$transaction(
      [...qualityScores.entries()].map(([id, v]) =>
        this.prisma.radarItem.update({
          where: { id },
          data: {
            qualityScore: v.score,
            aiSummary: v.summary,
          },
        }),
      ),
    );
  }
}

function tryParseJson<T>(raw: string): T | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  const firstBrace = stripped.search(/[{[]/);
  const candidate = firstBrace >= 0 ? stripped.slice(firstBrace) : stripped;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

function clampScore(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + "...";
}
