/**
 * S7 — signal insight synthesis stage adapter
 *
 * primitive=synthesize, roleId=signal-analyst, stateful=true
 *
 * 输入：ctx.state（含 topic / uniqueItems / relevanceScores / qualityScores / entityMap）
 * + 上期 RadarInsight（按 topicId 查最近 1 条，用于对照分析）。
 *
 * 只用 accepted 条件（relevance>=60 && quality>=50）的 item 喂 LLM。
 * 单次 LLM 调用，生成：
 *   - summary ≤200 字中文
 *   - highlights 3-5 条
 *   - signals 0-5 条
 *   - topEntities top 8
 *
 * 结果写入 ctx.state.insightPayload（不写 DB，由 s8 写库）。
 */
import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { AiChatService } from "@/modules/ai-engine/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RADAR_PIPELINE_DEFAULTS } from "../../../runtime/radar.constants";
import type {
  RadarInsightPayload,
  RadarMissionContext,
  RadarStageHookArgs,
  RadarStageRunner,
} from "./radar-stage-types";

@Injectable()
export class RadarS7InsightStage implements RadarStageRunner {
  private readonly log = new Logger(RadarS7InsightStage.name);

  constructor(
    private readonly chat: AiChatService,
    private readonly prisma: PrismaService,
  ) {}

  async run(args: RadarStageHookArgs, ctx: RadarMissionContext): Promise<void> {
    if (ctx.signal.aborted) throw new Error("aborted_during_insight_synthesis");

    const topic = ctx.state.topic;
    if (!topic) throw new Error("S7 insight: ctx.state.topic 缺失");

    const newItemIds = ctx.state.newItemIds ?? [];
    const uniqueItems = ctx.state.uniqueItems ?? [];
    const relevanceScores = ctx.state.relevanceScores ?? new Map();
    const qualityScores = ctx.state.qualityScores ?? new Map();
    const entityMap = ctx.state.entityMap ?? new Map();

    // 筛选 accepted 条目（relevance>=60 && quality>=50）
    const relMin = RADAR_PIPELINE_DEFAULTS.acceptedRelevanceMin;
    const qualMin = RADAR_PIPELINE_DEFAULTS.acceptedQualityMin;

    const acceptedItems = uniqueItems
      .map((raw, idx) => ({
        id: newItemIds[idx],
        title: raw.title ?? "",
        content: raw.content ?? "",
        url: raw.url ?? "",
        publishedAt: raw.publishedAt,
        source: raw.sourceId,
      }))
      .filter((item) => {
        const rel = relevanceScores.get(item.id);
        const qual = qualityScores.get(item.id);
        return (
          rel !== undefined &&
          rel.score >= relMin &&
          qual !== undefined &&
          qual.score >= qualMin
        );
      });

    if (acceptedItems.length === 0) {
      this.log.log(`[${ctx.missionId}] S7 insight: 无 accepted item，跳过`);
      return;
    }

    // 查上期 insight（对照分析用）
    const prevInsight = await this.prisma.radarInsight.findFirst({
      where: { topicId: topic.id },
      orderBy: { periodTo: "desc" },
    });

    const systemPrompt =
      args.systemPrompt ||
      "你是 AI 雷达的信号分析师，结合本期新动态与历史基线，生成结构化洞察报告。";

    // 构建实体频率统计（从 entityMap 统计各实体出现次数）
    const entityFreq = buildEntityFreq(
      entityMap,
      acceptedItems.map((i) => i.id),
    );

    if (ctx.signal.aborted) throw new Error("aborted_during_insight_synthesis");

    const insightPayload = await this.synthesize(
      systemPrompt,
      topic,
      acceptedItems,
      qualityScores,
      entityFreq,
      prevInsight,
      ctx.userId,
    );

    ctx.state.insightPayload = insightPayload;

    this.log.log(
      `[${ctx.missionId}] S7 insight: acceptedItems=${acceptedItems.length} signals=${insightPayload.signals.length}`,
    );

    return;
  }

  private async synthesize(
    systemPrompt: string,
    topic: NonNullable<RadarMissionContext["state"]["topic"]>,
    acceptedItems: Array<{
      id: string;
      title: string;
      content: string;
      url: string;
      publishedAt: Date;
      source: string;
    }>,
    qualityScores: Map<string, { score: number; summary: string }>,
    entityFreq: Array<{ type: string; name: string; mentions: number }>,
    prevInsight: { summary: string; periodFrom: Date; periodTo: Date } | null,
    userId: string,
  ): Promise<RadarInsightPayload> {
    // 构建 item 摘要列表（用 aiSummary 减少 token 消耗）
    const itemDigests = acceptedItems.slice(0, 30).map((item) => ({
      id: item.id,
      title: truncate(item.title, 120),
      summary: truncate(
        qualityScores.get(item.id)?.summary ?? item.content,
        200,
      ),
      url: item.url,
      publishedAt: item.publishedAt.toISOString().slice(0, 10),
      source: item.source,
    }));

    const userPrompt = `主题：${JSON.stringify({
      name: topic.name,
      description: truncate(topic.description ?? "", 300),
      entityType: topic.entityType ?? null,
    })}

本期新内容（${itemDigests.length} 条，已通过 relevance+quality 双重过滤）：
${itemDigests.map((d) => JSON.stringify(d)).join("\n")}

本期高频实体 Top 15：
${entityFreq
  .slice(0, 15)
  .map((e) => `${e.type}:${e.name}(${e.mentions}次)`)
  .join(" / ")}

${
  prevInsight
    ? `上期摘要（${prevInsight.periodFrom.toISOString().slice(0, 10)} ~ ${prevInsight.periodTo.toISOString().slice(0, 10)}）：
${truncate(prevInsight.summary, 300)}`
    : "无历史基线（首次运行）"
}

请生成结构化洞察报告，严格按以下 JSON schema 返回（无 markdown 围栏）：
{
  "summary": "≤200 字中文总结",
  "highlights": [
    { "title": "高亮标题", "itemIds": ["<id1>", "<id2>"], "type": "trend|new-entity|anomaly|key-event" }
  ],
  "signals": [
    { "kind": "信号类型", "magnitude": 0-10, "evidence": "≤100 字佐证" }
  ],
  "topEntities": [
    { "type": "person|company|...", "name": "实体名", "mentions": 5, "delta": 2 }
  ]
}

要求：highlights 3-5 条；signals 0-5 条；topEntities 最多 8 个（按 mentions 降序）。`;

    try {
      const result = await this.chat.chat({
        systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
        userId,
        operationName: "radar.s7-insight",
        skipGuardrails: true,
      });

      const parsed = tryParseJson<RadarInsightPayload>(result.content);
      if (!parsed || typeof parsed.summary !== "string") {
        this.log.warn("Insight LLM unparseable, building minimal fallback");
        return buildFallbackInsight(itemDigests.length);
      }

      return {
        summary: truncate(parsed.summary ?? "", 200),
        highlights: normalizeHighlights(parsed.highlights),
        signals: normalizeSignals(parsed.signals),
        topEntities: normalizeTopEntities(parsed.topEntities, entityFreq),
      };
    } catch (err) {
      this.log.error(`S7 insight LLM err: ${(err as Error).message}`);
      return buildFallbackInsight(itemDigests.length);
    }
  }
}

// ---- 辅助函数 ----

function buildEntityFreq(
  entityMap: Map<
    string,
    { type: string; name: string; normalizedName: string; confidence: number }[]
  >,
  acceptedIds: string[],
): Array<{ type: string; name: string; mentions: number }> {
  const freq = new Map<
    string,
    { type: string; name: string; mentions: number }
  >();
  const idSet = new Set(acceptedIds);
  for (const [itemId, entities] of entityMap) {
    if (!idSet.has(itemId)) continue;
    for (const entity of entities) {
      const key = `${entity.type}:${entity.normalizedName}`;
      const existing = freq.get(key);
      if (existing) {
        existing.mentions += 1;
      } else {
        freq.set(key, { type: entity.type, name: entity.name, mentions: 1 });
      }
    }
  }
  return [...freq.values()].sort((a, b) => b.mentions - a.mentions);
}

function normalizeHighlights(raw: unknown): RadarInsightPayload["highlights"] {
  if (!Array.isArray(raw)) return [];
  const VALID_TYPES = new Set(["trend", "new-entity", "anomaly", "key-event"]);
  return raw
    .slice(0, 5)
    .filter(
      (h): h is Record<string, unknown> => h !== null && typeof h === "object",
    )
    .map((h) => ({
      title: truncate(String(h["title"] ?? ""), 100),
      itemIds: Array.isArray(h["itemIds"])
        ? (h["itemIds"] as unknown[])
            .filter((v): v is string => typeof v === "string")
            .slice(0, 10)
        : [],
      type: (VALID_TYPES.has(String(h["type"])) ? h["type"] : "trend") as
        | "trend"
        | "new-entity"
        | "anomaly"
        | "key-event",
    }));
}

function normalizeSignals(raw: unknown): RadarInsightPayload["signals"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 5)
    .filter(
      (s): s is Record<string, unknown> => s !== null && typeof s === "object",
    )
    .map((s) => ({
      kind: truncate(String(s["kind"] ?? "unknown"), 60),
      magnitude: clampMagnitude(s["magnitude"]),
      evidence: truncate(String(s["evidence"] ?? ""), 100),
    }));
}

function normalizeTopEntities(
  raw: unknown,
  entityFreq: Array<{ type: string; name: string; mentions: number }>,
): RadarInsightPayload["topEntities"] {
  if (!Array.isArray(raw) || raw.length === 0) {
    // LLM 没返回 → 从 entityFreq 构建兜底
    return entityFreq.slice(0, 8).map((e) => ({
      type: e.type,
      name: e.name,
      mentions: e.mentions,
      delta: 0,
    }));
  }
  return raw
    .slice(0, 8)
    .filter(
      (e): e is Record<string, unknown> => e !== null && typeof e === "object",
    )
    .map((e) => ({
      type: truncate(String(e["type"] ?? "other"), 30),
      name: truncate(String(e["name"] ?? ""), 100),
      mentions:
        typeof e["mentions"] === "number" && Number.isFinite(e["mentions"])
          ? Math.max(0, Math.round(e["mentions"]))
          : 0,
      delta:
        typeof e["delta"] === "number" && Number.isFinite(e["delta"])
          ? Math.round(e["delta"])
          : 0,
    }));
}

function buildFallbackInsight(itemCount: number): RadarInsightPayload {
  return {
    summary: `本期共处理 ${itemCount} 条内容，LLM 洞察生成失败，请稍后重新运行。`,
    highlights: [],
    signals: [],
    topEntities: [],
  };
}

function clampMagnitude(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 5;
  return Math.max(0, Math.min(10, Math.round(v)));
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

function truncate(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + "...";
}
