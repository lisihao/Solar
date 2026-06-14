/**
 * S1 — source-resolve stage adapter
 *
 * 加载 topic + enabled sources（cooldown 过滤）+ 计算 since。写回 ctx.state。
 * 这是个纯 persist primitive（read-only），无 LLM 调用。
 */
import { Injectable, Logger } from "@nestjs/common";
import { RadarSourceHealth } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import type {
  RadarMissionContext,
  RadarStageHookArgs,
  RadarStageRunner,
} from "./radar-stage-types";

@Injectable()
export class RadarS1SourceResolveStage implements RadarStageRunner {
  private readonly log = new Logger(RadarS1SourceResolveStage.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(
    _args: RadarStageHookArgs,
    ctx: RadarMissionContext,
  ): Promise<void> {
    const input = ctx.input;
    if (!("topicId" in input)) {
      throw new Error("S1 source-resolve: input must contain topicId");
    }
    const topic = await this.prisma.radarTopic.findUniqueOrThrow({
      where: { id: input.topicId },
    });
    const now = new Date();
    const sources = await this.prisma.radarSource.findMany({
      where: {
        topicId: input.topicId,
        enabled: true,
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }],
        NOT: { health: RadarSourceHealth.FAILING },
      },
    });
    // since 计算分三档：
    // - FIRST_RUN: 24h 回退（topic 首次跑，拉一天内的）
    // - MANUAL（用户点重新精选）: **30 天**回退（R11 2026-05-19）
    //   原 24h 太苛刻：企业 RSS（如 Cisco blogs）一天通常只发 1-3 篇，扣掉历史
    //   重复后用户反复点都是 0 抓取。30 天能拉到一个月的内容池，S3 dedup 会
    //   自动过滤已入库，剩下的就是真正"新的"。
    // - SCHEDULED（定时）: 5min 回退（保留原逻辑，避免与 cron 上次 tick 重复）
    const SCHEDULED_LOOKBACK_MS = 5 * 60 * 1000;
    const MANUAL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
    const trigger =
      "trigger" in input && typeof input.trigger === "string"
        ? input.trigger
        : "SCHEDULED";
    let since: Date;
    if (!topic.lastRunAt) {
      // 首次跑：回退 24h
      since = new Date(topic.createdAt.getTime() - 24 * 60 * 60 * 1000);
    } else if (trigger === "MANUAL") {
      since = new Date(topic.lastRunAt.getTime() - MANUAL_LOOKBACK_MS);
    } else {
      since = new Date(topic.lastRunAt.getTime() - SCHEDULED_LOOKBACK_MS);
    }

    ctx.state.topic = topic;
    ctx.state.sources = sources;
    ctx.state.since = since;

    this.log.log(
      `[${ctx.missionId}] S1 source-resolve: topic=${topic.name} sources=${sources.length} trigger=${trigger} since=${since.toISOString()}`,
    );
  }
}
