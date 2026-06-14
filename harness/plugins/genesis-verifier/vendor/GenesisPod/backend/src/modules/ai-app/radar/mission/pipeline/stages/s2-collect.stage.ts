/**
 * S2 — collect stage adapter (multi-source fan-out)
 *
 * Stage primitive 是 "research" + mode "multi-source-fanout"。本 stage hook
 * 内部并发调既有 4 个 collector helper（RssCollector / YoutubeCollector /
 * XCollector / CustomCollector）—— 它们仅作为 stage 的实现细节存在，不是绕过
 * 框架的"独立编排"。
 *
 * 失败处理：
 *   - 单 source 失败 → 标记 SourceHealthService（指数 cooldown），不阻断其他 source
 *   - 全部 source 失败 → stage 仍返回（rawItems 为空），下游 S3-S7 自然短路
 *   - SourceHealthService 状态变化通过 EventBus emit radar.source.health-changed
 */
import { Injectable, Logger } from "@nestjs/common";
import {
  RADAR_EVENTS,
  RADAR_PIPELINE_DEFAULTS,
} from "../../../runtime/radar.constants";
import { CollectorRouter } from "../../services/collectors/collector-router.service";
import { SourceHealthService } from "../../services/source/source-health.service";
import type {
  RadarMissionContext,
  RadarRawItem,
  RadarStageHookArgs,
  RadarStageRunner,
} from "./radar-stage-types";

@Injectable()
export class RadarS2CollectStage implements RadarStageRunner {
  private readonly log = new Logger(RadarS2CollectStage.name);

  constructor(
    private readonly router: CollectorRouter,
    private readonly health: SourceHealthService,
  ) {}

  async run(
    _args: RadarStageHookArgs,
    ctx: RadarMissionContext,
  ): Promise<void> {
    const sources = ctx.state.sources;
    const since = ctx.state.since;
    if (!sources || !since) {
      throw new Error("S2 collect: missing ctx.state.sources/since (S1 缺失?)");
    }
    if (sources.length === 0) {
      ctx.state.rawItems = [];
      ctx.state.metrics.sourcesAttempted = 0;
      return;
    }

    // sourceId → 人类可读标签（同 S8：label 优先，回退 identifier）
    const sourceLabels = new Map(
      sources.map((s) => [s.id, s.label?.trim() || s.identifier]),
    );

    const results = await this.router.fanOut(
      sources,
      {
        since,
        perSourceLimit: RADAR_PIPELINE_DEFAULTS.perSourceItemLimit,
        userId: ctx.userId,
      },
      // 每个源一完成就 emit 实时进度（对齐 playground 细粒度事件流）
      (r) => {
        ctx.emit?.(RADAR_EVENTS.RUN_SOURCE_PROGRESS, {
          runId: ctx.missionId,
          topicId: ctx.input.topicId,
          sourceId: r.sourceId,
          sourceLabel: sourceLabels.get(r.sourceId) ?? r.sourceId,
          sourceType: r.type,
          items: r.items.length,
          durationMs: r.durationMs,
          error: r.error,
          // 抓到的条目样本（top 10），让 Drawer 显示"具体采集了什么文章"
          sample: r.items.slice(0, 10).map((it) => ({
            title: it.title,
            url: it.url,
          })),
        });
      },
    );

    const rawItems: RadarRawItem[] = [];
    const sourceErrors: Array<{ sourceId: string; error: string }> = [];
    let sourcesFailed = 0;

    for (const r of results) {
      if (ctx.signal.aborted) {
        this.log.warn(`[${ctx.missionId}] S2 abort signal received, halting`);
        throw new Error("aborted_during_collect");
      }
      if (r.error) {
        sourcesFailed++;
        sourceErrors.push({ sourceId: r.sourceId, error: r.error });
        await this.health.markFailure(r.sourceId, r.error);
        continue;
      }
      await this.health.markSuccess(r.sourceId);
      for (const item of r.items) {
        rawItems.push({
          ...item,
          sourceId: r.sourceId,
        });
      }
    }

    ctx.state.rawItems = rawItems;
    ctx.state.metrics.sourcesAttempted = sources.length;
    ctx.state.metrics.sourcesFailed = sourcesFailed;
    ctx.state.metrics.itemsFetched = rawItems.length;
    ctx.state.metrics.sourceErrors = sourceErrors;

    this.log.log(
      `[${ctx.missionId}] S2 collect: sources=${sources.length} failed=${sourcesFailed} items=${rawItems.length}`,
    );
  }
}
