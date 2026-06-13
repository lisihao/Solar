/**
 * RadarDailyBriefing repo（B5）
 *
 * 来源：docs/architecture/ai-app/radar/daily-briefing-redesign-2026-05-18.md
 *   §6.1 数据模型 + §11.2 PR-DR2 范围
 *
 * 职责：
 * - upsert daily briefing（同日重新精选覆盖）
 * - 查单条（详情页）/ 最近 N 条（历史 timeline）/ 时间窗（weekly 聚合）
 * - 不含业务逻辑（评分 / LLM / 推送），纯 DB IO
 */
import { Injectable } from "@nestjs/common";
import { Prisma, RadarDailyBriefing } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

export type BriefingStatus = "generating" | "completed" | "no_signals";

/** DailySignal schema（嵌入 RadarDailyBriefing.signals JSONB） */
export interface DailySignal {
  /** 由 service 层 zod parse 后的 signal；id 由 service 层分配 UUID */
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  oneLineTakeaway: string;
  whyItMatters: string;
  whatsNext: string;
  signalTags: Array<
    | "turning_point"
    | "trend_acceleration"
    | "new_entity"
    | "anomaly"
    | "key_event"
  >;
  entities: string[];
  evidenceItemIds: string[];
  narrativeId?: string;
  /** Stage A composite score（observability 用，不展示用户） */
  score?: number;
}

export interface UpsertBriefingInput {
  topicId: string;
  userId: string;
  /** 用户本地日期 'YYYY-MM-DD'；Prisma @db.Date 字段 */
  briefingDate: Date;
  signals: DailySignal[];
  status: BriefingStatus;
  generationRunId?: string;
}

@Injectable()
export class RadarDailyBriefingRepo {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * upsert：同日同 topic 已有 → 覆盖 signals + status；否则 create。
   * 唯一约束 (topicId, briefingDate) 保证幂等。
   */
  async upsert(input: UpsertBriefingInput): Promise<RadarDailyBriefing> {
    const signalsJson = input.signals as unknown as Prisma.InputJsonValue;
    return this.prisma.radarDailyBriefing.upsert({
      where: {
        topicId_briefingDate: {
          topicId: input.topicId,
          briefingDate: input.briefingDate,
        },
      },
      create: {
        topicId: input.topicId,
        userId: input.userId,
        briefingDate: input.briefingDate,
        signals: signalsJson,
        status: input.status,
        generationRunId: input.generationRunId,
      },
      update: {
        signals: signalsJson,
        status: input.status,
        generationRunId: input.generationRunId,
        generatedAt: new Date(),
      },
    });
  }

  async findByTopicAndDate(
    topicId: string,
    briefingDate: Date,
  ): Promise<RadarDailyBriefing | null> {
    return this.prisma.radarDailyBriefing.findUnique({
      where: { topicId_briefingDate: { topicId, briefingDate } },
    });
  }

  /** 主页卡片 + 详情页 header 用：拿最新 1 条 completed */
  async findLatestForTopic(
    topicId: string,
  ): Promise<RadarDailyBriefing | null> {
    return this.prisma.radarDailyBriefing.findFirst({
      where: { topicId, status: { in: ["completed", "no_signals"] } },
      orderBy: { briefingDate: "desc" },
    });
  }

  /** 历史 timeline 用：最近 N 条（含 no_signals 透明展示） */
  async findRecentByTopic(
    topicId: string,
    limit = 30,
  ): Promise<RadarDailyBriefing[]> {
    return this.prisma.radarDailyBriefing.findMany({
      where: { topicId },
      orderBy: { briefingDate: "desc" },
      take: limit,
    });
  }

  /** weekly 聚合用：[start, end] 闭区间内所有 briefing */
  async findInRange(
    topicId: string,
    start: Date,
    end: Date,
  ): Promise<RadarDailyBriefing[]> {
    return this.prisma.radarDailyBriefing.findMany({
      where: {
        topicId,
        briefingDate: { gte: start, lte: end },
        status: "completed",
      },
      orderBy: { briefingDate: "asc" },
    });
  }

  /**
   * PR-DR2 收尾：把 signal.evidenceItemIds join 回 RadarItem，拿原文
   * 标题/url/发布时间，让前端能追溯到原始链接。返回 id → 来源详情 的映射，
   * controller 按 signal 组装 evidenceSources（多源全量）。
   *
   * name 优先用文章标题（最利于辨认具体原文），回退源标签 / 源标识。
   * url 可能为 null（X/YouTube 等部分源无规范文章 URL），前端按无链接降级。
   */
  async findEvidenceSources(
    ids: string[],
  ): Promise<
    Map<string, { name: string; url: string | null; publishedAt: string }>
  > {
    const map = new Map<
      string,
      { name: string; url: string | null; publishedAt: string }
    >();
    if (ids.length === 0) return map;
    const items = await this.prisma.radarItem.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        url: true,
        publishedAt: true,
        source: { select: { label: true, identifier: true } },
      },
    });
    for (const it of items) {
      const name =
        it.title?.trim() ||
        it.source?.label?.trim() ||
        it.source?.identifier ||
        "(原文)";
      map.set(it.id, {
        name,
        url: it.url,
        publishedAt: it.publishedAt.toISOString().slice(0, 10),
      });
    }
    return map;
  }

  /**
   * 跨日延续 boost 用（B3）：拉昨天的 entity 集合
   * 返回扁平化去重 entity 名（保留大小写，由 LLM 自行 normalize）
   */
  async getYesterdayEntities(topicId: string, today: Date): Promise<string[]> {
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const prior = await this.findByTopicAndDate(topicId, yesterday);
    if (!prior || prior.status !== "completed") return [];
    const signals = (prior.signals as unknown as DailySignal[]) ?? [];
    const set = new Set<string>();
    for (const s of signals) {
      for (const e of s.entities ?? []) {
        if (typeof e === "string" && e.length) set.add(e);
      }
    }
    return Array.from(set);
  }

  /** 90 天清理 cron（B18）：删超期行；返回删除条数 */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.prisma.radarDailyBriefing.deleteMany({
      where: { briefingDate: { lt: cutoff } },
    });
    return result.count;
  }

  /** 用户 daily quota 校验用（K3）：今日已 generate 条数 */
  async countByUserForDate(userId: string, date: Date): Promise<number> {
    return this.prisma.radarDailyBriefing.count({
      where: { userId, briefingDate: date },
    });
  }
}
