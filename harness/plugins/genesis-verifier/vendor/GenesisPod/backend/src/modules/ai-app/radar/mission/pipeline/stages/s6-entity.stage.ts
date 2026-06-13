/**
 * S6 — entity extraction stage adapter
 *
 * primitive=assess, roleId=entity-extractor
 *
 * 输入：ctx.state.uniqueItems + qualityScores。
 * 仅处理 qualityScore >= RADAR_PIPELINE_DEFAULTS.acceptedQualityMin 的 item。
 * 批量 8 个 item 一批调 AiChatService，输出结构化实体列表（最多 10 个/item）。
 *
 * entity type 限定 6 枚举：person / company / product / event / location / other。
 * LLM 失败 → 整批空实体兜底，不阻断下游 stage。
 */
import { Injectable, Logger } from "@nestjs/common";
import { AIModelType, Prisma } from "@prisma/client";
import { AiChatService } from "@/modules/ai-engine/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  RADAR_PIPELINE_DEFAULTS,
  RADAR_MAX_ENTITIES_PER_ITEM,
} from "../../../runtime/radar.constants";
import type {
  RadarExtractedEntity,
  RadarExtractedEntityKind,
  RadarMissionContext,
  RadarStageHookArgs,
  RadarStageRunner,
} from "./radar-stage-types";

const BATCH_SIZE = RADAR_PIPELINE_DEFAULTS.entityBatchSize;

const VALID_ENTITY_KINDS: ReadonlySet<string> = new Set([
  "person",
  "company",
  "product",
  "event",
  "location",
  "other",
]);

interface LLMEntityItem {
  id: string;
  entities: Array<{
    type: string;
    name: string;
    normalizedName: string;
    confidence: number;
  }>;
}

@Injectable()
export class RadarS6EntityStage implements RadarStageRunner {
  private readonly log = new Logger(RadarS6EntityStage.name);

  constructor(
    private readonly chat: AiChatService,
    private readonly prisma: PrismaService,
  ) {}

  async run(args: RadarStageHookArgs, ctx: RadarMissionContext): Promise<void> {
    const newItemIds = ctx.state.newItemIds ?? [];
    const uniqueItems = ctx.state.uniqueItems ?? [];
    const qualityScores = ctx.state.qualityScores ?? new Map();

    if (newItemIds.length === 0 || uniqueItems.length === 0) {
      ctx.state.entityMap = new Map();
      return;
    }

    const systemPrompt =
      args.systemPrompt ||
      "你是 AI 雷达的实体抽取专家，按 JSON schema 输出每条内容中的命名实体。";

    // 仅处理 qualityScore >= acceptedQualityMin 的 item
    const qualityMin = RADAR_PIPELINE_DEFAULTS.acceptedQualityMin;
    const itemsForLLM = uniqueItems
      .map((raw, idx) => ({
        id: newItemIds[idx],
        title: raw.title ?? "",
        content: raw.content ?? "",
        source: raw.sourceId,
      }))
      .filter((item) => {
        const qual = qualityScores.get(item.id);
        return qual !== undefined && qual.score >= qualityMin;
      });

    const entityMap = new Map<string, RadarExtractedEntity[]>();

    for (let i = 0; i < itemsForLLM.length; i += BATCH_SIZE) {
      if (ctx.signal.aborted)
        throw new Error("aborted_during_entity_extraction");
      const batch = itemsForLLM.slice(i, i + BATCH_SIZE);
      const extracted = await this.extractBatch(
        systemPrompt,
        batch,
        ctx.userId,
      );
      for (const item of extracted) {
        entityMap.set(item.id, item.entities);
      }
    }

    ctx.state.entityMap = entityMap;

    await this.persistEntities(entityMap);

    const totalEntities = [...entityMap.values()].reduce(
      (sum, entities) => sum + entities.length,
      0,
    );

    this.log.log(
      `[${ctx.missionId}] S6 entity: items=${entityMap.size}/${itemsForLLM.length} totalEntities=${totalEntities}`,
    );

    return;
  }

  private async extractBatch(
    systemPrompt: string,
    batch: Array<{
      id: string;
      title: string;
      content: string;
      source: string;
    }>,
    userId: string,
  ): Promise<Array<{ id: string; entities: RadarExtractedEntity[] }>> {
    const userPrompt = `请从下列 ${batch.length} 个条目中提取命名实体。

候选条目（JSON Lines，每行一条）：
${batch
  .map((item, idx) =>
    JSON.stringify({
      id: item.id,
      idx,
      source: item.source,
      title: truncate(item.title, 200),
      content: truncate(item.content, 600),
    }),
  )
  .join("\n")}

entity.type 必须是 6 种之一：person / company / product / event / location / other
每个 item 最多输出 ${RADAR_MAX_ENTITIES_PER_ITEM} 个实体，confidence 为 0-1 浮点数。

请严格按以下 JSON schema 返回（无 markdown 围栏）：
{
  "items": [
    {
      "id": "<原 id>",
      "entities": [
        { "type": "person|company|product|event|location|other", "name": "原名", "normalizedName": "标准化名", "confidence": 0.9 }
      ]
    }
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
        operationName: "radar.s6-entity",
        skipGuardrails: true,
      });

      const parsed = tryParseJson<{ items: LLMEntityItem[] }>(result.content);
      if (!parsed || !Array.isArray(parsed.items)) {
        this.log.warn("Entity LLM unparseable, fallback empty");
        return batch.map((item) => ({ id: item.id, entities: [] }));
      }

      const byId = new Map(parsed.items.map((x) => [x.id, x]));
      return batch.map((item) => {
        const entry = byId.get(item.id);
        if (!entry || !Array.isArray(entry.entities)) {
          return { id: item.id, entities: [] };
        }
        const entities: RadarExtractedEntity[] = entry.entities
          .slice(0, RADAR_MAX_ENTITIES_PER_ITEM)
          .filter((e) => typeof e.name === "string" && e.name.length > 0)
          .map((e) => ({
            type: normalizeEntityKind(e.type),
            name: truncate(String(e.name), 100),
            normalizedName: truncate(String(e.normalizedName ?? e.name), 100),
            confidence: clampConfidence(e.confidence),
          }));
        return { id: item.id, entities };
      });
    } catch (err) {
      this.log.error(`S6 entity LLM err: ${(err as Error).message}`);
      return batch.map((item) => ({ id: item.id, entities: [] }));
    }
  }

  private async persistEntities(
    entityMap: Map<string, RadarExtractedEntity[]>,
  ): Promise<void> {
    if (entityMap.size === 0) return;
    await this.prisma.$transaction(
      [...entityMap.entries()].map(([id, entities]) =>
        this.prisma.radarItem.update({
          where: { id },
          data: { entities: entities as unknown as Prisma.InputJsonValue },
        }),
      ),
    );
  }
}

function normalizeEntityKind(raw: unknown): RadarExtractedEntityKind {
  if (typeof raw === "string" && VALID_ENTITY_KINDS.has(raw)) {
    return raw as RadarExtractedEntityKind;
  }
  return "other";
}

function clampConfidence(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
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
