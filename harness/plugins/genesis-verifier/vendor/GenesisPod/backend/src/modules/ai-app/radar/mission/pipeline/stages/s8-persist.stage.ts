/**
 * S8 — persist stage adapter
 *
 * primitive=persist（不调用 LLM）
 *
 * 执行顺序：
 *   1. updateMany radar_items SET accepted = (relevance>=60 && quality>=50) WHERE id IN newItemIds
 *   2. 如果 insightPayload 存在 + 有 accepted item → 创建 RadarInsight 行
 *   3. radar_topics SET lastRunAt=now, nextDueAt=computeNextCronTick(topic.refreshCron, now)
 *   4. 更新 ctx.state.metrics.itemsAccepted + insightCreated
 *
 * 通知由 dispatcher 在 mission 完成后统一发出，本 stage 不发。
 */
import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  RADAR_LITERAL_MISS_REASON,
  RADAR_PIPELINE_DEFAULTS,
} from "../../../runtime/radar.constants";
import { computeNextCronTick } from "../../services/scheduler/cron-util";
import type {
  RadarDroppedItem,
  RadarMissionContext,
  RadarStageHookArgs,
  RadarStageRunner,
} from "./radar-stage-types";

@Injectable()
export class RadarS8PersistStage implements RadarStageRunner {
  private readonly log = new Logger(RadarS8PersistStage.name);

  async run(
    _args: RadarStageHookArgs,
    ctx: RadarMissionContext,
  ): Promise<void> {
    if (ctx.signal.aborted) throw new Error("aborted_during_persist");

    const topic = ctx.state.topic;
    if (!topic) throw new Error("S8 persist: ctx.state.topic 缺失");

    const newItemIds = ctx.state.newItemIds ?? [];
    const uniqueItems = ctx.state.uniqueItems ?? [];
    const sources = ctx.state.sources ?? [];
    const relevanceScores = ctx.state.relevanceScores ?? new Map();
    const qualityScores = ctx.state.qualityScores ?? new Map();
    const insightPayload = ctx.state.insightPayload;

    const relGate = RADAR_PIPELINE_DEFAULTS.relevanceThreshold;
    const relMin = RADAR_PIPELINE_DEFAULTS.acceptedRelevanceMin;
    const qualMin = RADAR_PIPELINE_DEFAULTS.acceptedQualityMin;

    const now = new Date();

    // 1. 标记 accepted / not-accepted + 计算 per-item 流失归因
    //
    // 2026-05-19 R10：用户反馈"数据 1 → 0 丢了但没有任何原因记录"。
    // S4 / S5 持久化了 relevanceScore / qualityScore 到 RadarItem，但 UI 拉
    // RadarRun.metrics 时没有汇总信息。这里在落 accepted 标记的同时，把每条
    // 被淘汰 item 的诊断详情写到 metrics.droppedItems[]，drawer 直接可读。
    const acceptedIds = new Set<string>();
    const sourceLabelMap = new Map<string, string>();
    for (const s of sources) {
      sourceLabelMap.set(s.id, s.label?.trim() || s.identifier);
    }
    const dropped: RadarDroppedItem[] = [];
    let droppedAtRelevance = 0;
    let droppedAtQuality = 0;
    const itemUpdates = newItemIds.map((id, idx) => {
      const rel = relevanceScores.get(id);
      const qual = qualityScores.get(id);
      const accepted =
        rel !== undefined &&
        rel.score >= relMin &&
        qual !== undefined &&
        qual.score >= qualMin;
      if (accepted) {
        acceptedIds.add(id);
      } else {
        // 流失归因：先看 relevance 门槛，再看 quality 门槛
        const raw = uniqueItems[idx];
        const relScore = rel?.score ?? null;
        const qualScore = qual?.score ?? null;
        let reason: string;
        let stage: RadarDroppedItem["stage"];
        if (rel?.reason === RADAR_LITERAL_MISS_REASON) {
          // literal 模式被字面过滤淘汰：保留专属原因，不回落到通用「相关性 0 < 40」
          reason = RADAR_LITERAL_MISS_REASON;
          stage = "relevance";
          droppedAtRelevance++;
        } else if (relScore === null) {
          // S4 LLM 全部失败兜底回 30，理论上 rel 应该有值。none 是真异常
          reason = "未获得相关性分（评分阶段异常）";
          stage = "unknown";
          droppedAtRelevance++;
        } else if (relScore < relGate) {
          // 连 S5 都没进
          reason = `相关性 ${relScore} < ${relGate}（未进入质量评分）`;
          stage = "relevance";
          droppedAtRelevance++;
        } else if (relScore < relMin) {
          // 进了 S5 但 rel 仍未达入选门槛
          reason = `相关性 ${relScore} < ${relMin}`;
          stage = "relevance";
          droppedAtRelevance++;
        } else if (qualScore === null) {
          reason = "未获得质量分（评分阶段异常）";
          stage = "unknown";
          droppedAtQuality++;
        } else {
          reason = `质量分 ${qualScore} < ${qualMin}`;
          stage = "quality";
          droppedAtQuality++;
        }
        dropped.push({
          id,
          title: truncate(raw?.title ?? "(无标题)", 120),
          url: raw?.url ?? null,
          sourceLabel: sourceLabelMap.get(raw?.sourceId ?? "") ?? "(未知源)",
          relevanceScore: relScore,
          qualityScore: qualScore,
          reason,
          stage,
        });
      }
      return { id, accepted };
    });

    if (itemUpdates.length > 0) {
      await this.prisma.$transaction(
        itemUpdates.map(({ id, accepted }) =>
          this.prisma.radarItem.update({
            where: { id },
            data: { accepted },
          }),
        ),
      );
    }

    ctx.state.metrics.itemsAccepted = acceptedIds.size;
    ctx.state.metrics.thresholds = {
      relevanceGate: relGate,
      relevanceMin: relMin,
      qualityMin: qualMin,
    };
    ctx.state.metrics.droppedAtRelevance = droppedAtRelevance;
    ctx.state.metrics.droppedAtQuality = droppedAtQuality;
    // top 20 按 relevance 降序（"差一点入选"的最有诊断价值，全 0 分的看不出问题）
    // 同分时 quality 高的排前面
    const sortedDropped = [...dropped].sort((a, b) => {
      const rDiff = (b.relevanceScore ?? -1) - (a.relevanceScore ?? -1);
      if (rDiff !== 0) return rDiff;
      return (b.qualityScore ?? -1) - (a.qualityScore ?? -1);
    });
    ctx.state.metrics.droppedItems = sortedDropped.slice(0, 20);

    // 2. 创建 RadarInsight（需要有 payload 且有 accepted item）
    let insightCreated = false;
    if (insightPayload && acceptedIds.size > 0) {
      const periodFrom = topic.lastRunAt ?? ctx.state.since ?? now;
      await this.prisma.radarInsight.create({
        data: {
          topicId: topic.id,
          periodFrom,
          periodTo: now,
          summary: insightPayload.summary,
          highlights:
            insightPayload.highlights as unknown as Prisma.InputJsonValue,
          signals: insightPayload.signals as unknown as Prisma.InputJsonValue,
          topEntities:
            insightPayload.topEntities as unknown as Prisma.InputJsonValue,
        },
      });
      insightCreated = true;
      ctx.state.metrics.insightCreated = true;
    }

    // 3. 更新 topic lastRunAt + nextDueAt
    //
    // 2026-05-17 R3 评审 P1：computeNextCronTick 返回 null 时旧逻辑用 undefined
    // 让 Prisma 跳过该字段，nextDueAt 维持不变 = 上一轮 due 时间。scheduler
    // 每分钟扫到 nextDueAt<=now 又会立即重发，dedup 部分救但仍然在分钟级烧
    // budget。新策略：cron 解析失败一律延后 1h，并打 warn 让运维感知。
    const NEXT_DUE_FALLBACK_MS = 60 * 60 * 1000;
    let nextDueAt = computeNextCronTick(topic.refreshCron, now);
    if (!nextDueAt) {
      this.log.warn(
        `[${ctx.missionId}] S8: cron "${topic.refreshCron}" 解析失败，nextDueAt fallback +1h 防 scheduler 风暴`,
      );
      nextDueAt = new Date(now.getTime() + NEXT_DUE_FALLBACK_MS);
    }
    await this.prisma.radarTopic.update({
      where: { id: topic.id },
      data: {
        lastRunAt: now,
        nextDueAt,
      },
    });

    this.log.log(
      `[${ctx.missionId}] S8 persist: accepted=${acceptedIds.size}/${newItemIds.length}` +
        ` insightCreated=${insightCreated} nextDueAt=${nextDueAt.toISOString()}`,
    );

    return;
  }

  // constructor 注入 PrismaService（NestJS DI 标准）
  constructor(private readonly prisma: PrismaService) {}
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + "...";
}
