/**
 * RadarWeeklyBriefing service（B6 — 纯模板拼装，no LLM）
 *
 * 来源：docs/architecture/ai-app/radar/daily-briefing-redesign-2026-05-18.md
 *   §8.4 数据模型 + §7.3.6 模板 + §11.2 范围
 *
 * 工作流：
 *   sweepWeeklyBriefing cron → 按 user.timezone+周日 18:00 触发 →
 *   本 service 拉本周 7 天 daily briefing → 按 tier 排序取 top10 ⭐⭐⭐ →
 *   合并 narrativeMap → 写 radar_weekly_briefings 表 → 调 dispatcher 推送
 *
 * **不调 LLM**：决策 E5——周报是日报延伸，纯模板可达；省 LLM 成本
 */
import { Injectable } from "@nestjs/common";
import { Prisma, RadarWeeklyBriefing } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  DailySignal,
  RadarDailyBriefingRepo,
} from "./radar-daily-briefing.repo";

/** 周报 payload schema（嵌入 RadarWeeklyBriefing.payload JSONB） */
export interface WeeklyPayload {
  /** 本周所有 daily briefing candidates 总数（observability） */
  candidatesTotal: number;
  tier3Count: number;
  tier2Count: number;
  /** 同 narrativeId 跨日聚合（按 episode 数从高到低排） */
  narrativeMap: Array<{
    narrativeId: string;
    label: string;
    episodes: Array<{ date: string; signalId: string; title: string }>;
    latestTitle: string;
  }>;
  /** 全周 ⭐⭐⭐ 信号 top10（按 score desc，含原 briefingDate） */
  topSignals: Array<DailySignal & { sourceBriefingDate: string }>;
  /** 本周新出现 entity（vs 上周；可空） */
  newEntities: string[];
}

@Injectable()
export class RadarWeeklyBriefingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyRepo: RadarDailyBriefingRepo,
  ) {}

  /**
   * 拼装并持久化周报；幂等（unique topic+weekStart）。
   *
   * 入参 week 边界由 caller（scheduler）按 user.timezone 转换好的 UTC Date
   * （周一 00:00 ~ 周日 23:59）传入。
   *
   * @returns 写入的 RadarWeeklyBriefing；无任何 daily briefing 时 status 隐式：
   *   payload.topSignals 为空数组，caller 决定是否发邮件（不发：避免 spam）
   */
  async generateAndPersist(input: {
    topicId: string;
    userId: string;
    weekStart: Date; // 周一 00:00 UTC
    weekEnd: Date; // 周日 23:59 UTC
  }): Promise<RadarWeeklyBriefing> {
    const dailies = await this.dailyRepo.findInRange(
      input.topicId,
      input.weekStart,
      input.weekEnd,
    );

    const payload = this.assemblePayload(dailies, input);

    return this.prisma.radarWeeklyBriefing.upsert({
      where: {
        radar_weekly_briefings_topic_week_uniq: {
          topicId: input.topicId,
          weekStartDate: input.weekStart,
        },
      },
      create: {
        topicId: input.topicId,
        userId: input.userId,
        weekStartDate: input.weekStart,
        weekEndDate: input.weekEnd,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      update: {
        weekEndDate: input.weekEnd,
        payload: payload as unknown as Prisma.InputJsonValue,
        generatedAt: new Date(),
      },
    });
  }

  /** 历史回看用 */
  async findInRange(
    topicId: string,
    startWeek: Date,
    endWeek: Date,
  ): Promise<RadarWeeklyBriefing[]> {
    return this.prisma.radarWeeklyBriefing.findMany({
      where: {
        topicId,
        weekStartDate: { gte: startWeek, lte: endWeek },
      },
      orderBy: { weekStartDate: "desc" },
    });
  }

  /** FC-5: 详情页用，按 topicId + 周一 00:00 UTC 查单条 */
  async findByTopicAndWeek(
    topicId: string,
    weekStart: Date,
  ): Promise<RadarWeeklyBriefing | null> {
    return this.prisma.radarWeeklyBriefing.findUnique({
      where: {
        radar_weekly_briefings_topic_week_uniq: {
          topicId,
          weekStartDate: weekStart,
        },
      },
    });
  }

  /** FC-5: 列表 / 默认页用 */
  async findLatestForTopic(
    topicId: string,
  ): Promise<RadarWeeklyBriefing | null> {
    return this.prisma.radarWeeklyBriefing.findFirst({
      where: { topicId },
      orderBy: { weekStartDate: "desc" },
    });
  }

  /**
   * 模板拼装核心（公开为 method 便于单测，不依赖 prisma）
   */
  assemblePayload(
    dailies: Array<
      Pick<RadarWeeklyBriefing, never> & {
        briefingDate: Date;
        signals: unknown;
      }
    >,
    _ctx: { topicId: string; weekStart: Date; weekEnd: Date },
  ): WeeklyPayload {
    let candidatesTotal = 0;
    let tier3Count = 0;
    let tier2Count = 0;
    const allSignals: Array<DailySignal & { sourceBriefingDate: string }> = [];

    for (const d of dailies) {
      const sigs = (d.signals as DailySignal[]) ?? [];
      candidatesTotal += sigs.length;
      for (const s of sigs) {
        if (s.tier === 3) tier3Count++;
        if (s.tier === 2) tier2Count++;
        allSignals.push({
          ...s,
          sourceBriefingDate: toYmd(d.briefingDate),
        });
      }
    }

    // narrativeMap: 同 narrativeId 聚合（仅 episodes>=2 才纳入；单条不算 thread）
    const narrativeBuckets = new Map<
      string,
      Array<DailySignal & { sourceBriefingDate: string }>
    >();
    for (const s of allSignals) {
      if (!s.narrativeId) continue;
      const arr = narrativeBuckets.get(s.narrativeId) ?? [];
      arr.push(s);
      narrativeBuckets.set(s.narrativeId, arr);
    }
    const narrativeMap = Array.from(narrativeBuckets.entries())
      .filter(([, eps]) => eps.length >= 2)
      .map(([narrativeId, eps]) => {
        eps.sort((a, b) =>
          a.sourceBriefingDate.localeCompare(b.sourceBriefingDate),
        );
        const latest = eps[eps.length - 1];
        return {
          narrativeId,
          label: latest.title, // label 用最新 title（无独立 label 字段时降级）
          episodes: eps.map((e) => ({
            date: e.sourceBriefingDate,
            signalId: e.id,
            title: e.title,
          })),
          latestTitle: latest.title,
        };
      })
      .sort((a, b) => b.episodes.length - a.episodes.length);

    // top10 ⭐⭐⭐（按 score desc；score 缺失视为 0）
    const topSignals = allSignals
      .filter((s) => s.tier === 3)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 10);

    // newEntities: 本周 entity 集合（caller 可后续与上周比较；这里保守只输出本周）
    const entitySet = new Set<string>();
    for (const s of allSignals) {
      for (const e of s.entities ?? []) entitySet.add(e);
    }

    return {
      candidatesTotal,
      tier3Count,
      tier2Count,
      narrativeMap,
      topSignals,
      newEntities: Array.from(entitySet),
    };
  }
}

function toYmd(d: Date): string {
  // 直接走 UTC，避免不同 worker 本地时区分歧
  return d.toISOString().slice(0, 10);
}
