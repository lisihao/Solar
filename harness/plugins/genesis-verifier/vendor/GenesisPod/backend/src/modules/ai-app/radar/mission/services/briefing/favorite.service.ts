/**
 * Favorite service（B16 — Phase 1 简单 boolean 收藏）
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §4.2 §15 B3 决策
 *
 * 设计：
 * - 用 UserFavorite 表存（userId, signalId）唯一对（去重）
 * - signalId 是 DailySignal.id（briefing.signals[].id UUID，JSONB 内嵌，无强 FK）
 * - 反查 topicId 用于详情页跨日期访问"我收藏的信号"
 * - 不存 signal 内容副本（briefing 90 天保留窗口内 join 取，过期收藏 → 失效但不破坏）
 */
import { Injectable, Logger } from "@nestjs/common";
import { UserFavorite } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  RadarDailyBriefingRepo,
  type DailySignal,
} from "./radar-daily-briefing.repo";

/** 自动创建的 "AI 雷达收藏" Collection 名称（用户多语言考虑用 zh-CN 默认） */
const RADAR_FAVORITES_COLLECTION_NAME = "AI 雷达收藏";
/** 收藏 signal 的 Resource sourceUrl 模式（用作 dedupe key） */
const RADAR_SIGNAL_URL_PREFIX = "radar://signal/";

export interface FavoriteWithSignal {
  signalId: string;
  topicId: string;
  topicName: string;
  favoritedAt: string;
  /** signal 内容；找不到（briefing 已 90 天清理 / signal id 不匹配）则 null */
  signal: DailySignal | null;
  briefingDate: string | null;
}

@Injectable()
export class FavoriteService {
  private readonly log = new Logger(FavoriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyRepo: RadarDailyBriefingRepo,
  ) {}

  /**
   * Toggle 收藏：已收藏 → 取消；否则创建
   *
   * 副作用（UX #3 整改 2026-05-18）：收藏的 signal 同步落到用户"我的知识库"作为
   * 数据源。upsert 一个 Resource（type=NEWS，sourceUrl 用 radar://signal/{id}
   * 作 dedupe key）+ 自动 ensure "AI 雷达收藏" Collection + upsert CollectionItem。
   * 取消收藏时同步移除 CollectionItem，Resource 保留（其他用户可能也收藏过同信号）。
   *
   * 失败 fail-open：Library 写入失败不影响 favorite 主流程（log warn）。
   *
   * @returns 收藏后状态（true=favorited）
   */
  async toggle(input: {
    userId: string;
    signalId: string;
    topicId: string;
  }): Promise<{ favorited: boolean }> {
    const existing = await this.prisma.userFavorite.findUnique({
      where: {
        userId_signalId: { userId: input.userId, signalId: input.signalId },
      },
    });
    if (existing) {
      await this.prisma.userFavorite.delete({ where: { id: existing.id } });
      void this.removeFromLibrary(input.userId, input.signalId).catch(
        (err: Error) =>
          this.log.warn(
            `removeFromLibrary failed user=${input.userId} signal=${input.signalId}: ${err.message}`,
          ),
      );
      return { favorited: false };
    }
    await this.prisma.userFavorite.create({
      data: {
        userId: input.userId,
        signalId: input.signalId,
        topicId: input.topicId,
      },
    });
    void this.syncToLibrary(input.userId, input.signalId, input.topicId).catch(
      (err: Error) =>
        this.log.warn(
          `syncToLibrary failed user=${input.userId} signal=${input.signalId}: ${err.message}`,
        ),
    );
    return { favorited: true };
  }

  /**
   * 把 radar signal 同步成 Library Resource + CollectionItem
   * （UX #3：用户收藏 → 自动入知识库，无需手动整理）
   */
  private async syncToLibrary(
    userId: string,
    signalId: string,
    topicId: string,
  ): Promise<void> {
    // 反查 signal 元信息（topic name + signal title/takeaway）
    const briefings = await this.dailyRepo.findRecentByTopic(topicId, 30);
    let signal: DailySignal | null = null;
    let briefingDate: Date | null = null;
    for (const b of briefings) {
      const arr = (b.signals as unknown as DailySignal[]) ?? [];
      const hit = arr.find((s) => s.id === signalId);
      if (hit) {
        signal = hit;
        briefingDate = b.briefingDate;
        break;
      }
    }
    if (!signal) {
      this.log.warn(
        `syncToLibrary skipped — signal not found in briefings user=${userId} signal=${signalId}`,
      );
      return;
    }

    const topic = await this.prisma.radarTopic.findUnique({
      where: { id: topicId },
      select: { name: true },
    });

    // 1. 找/建 Resource（sourceUrl 非 unique 字段，用 findFirst + create 模拟 upsert）
    const sourceUrl = `${RADAR_SIGNAL_URL_PREFIX}${signalId}`;
    let resource = await this.prisma.resource.findFirst({
      where: { sourceUrl },
      select: { id: true },
    });
    if (!resource) {
      resource = await this.prisma.resource.create({
        data: {
          type: "NEWS",
          title: signal.title,
          abstract: signal.oneLineTakeaway,
          content: signal.whyItMatters,
          sourceUrl,
          aiSummary: signal.whyItMatters,
          tags: signal.signalTags as unknown as object,
          metadata: {
            source: "ai-radar",
            signalId,
            topicId,
            topicName: topic?.name ?? "",
            tier: signal.tier,
            briefingDate: briefingDate?.toISOString().slice(0, 10),
            entities: signal.entities,
          },
        },
        select: { id: true },
      });
    } else {
      // 已存在 resource — bumping saveCount（其他用户也收藏过同 signal）
      await this.prisma.resource.update({
        where: { id: resource.id },
        data: { saveCount: { increment: 1 } },
      });
    }

    // 2. ensure "AI 雷达收藏" Collection 存在（用户首次收藏时自动建）
    let collection = await this.prisma.collection.findFirst({
      where: { userId, name: RADAR_FAVORITES_COLLECTION_NAME },
      select: { id: true },
    });
    if (!collection) {
      collection = await this.prisma.collection.create({
        data: {
          userId,
          name: RADAR_FAVORITES_COLLECTION_NAME,
          description: "来自 AI 雷达的精选信号收藏（自动同步）",
          icon: "📡",
          color: "#7c3aed",
          sortOrder: 0,
        },
        select: { id: true },
      });
    }

    // 3. upsert CollectionItem（uniq by collectionId+resourceId）
    await this.prisma.collectionItem.upsert({
      where: {
        collectionId_resourceId: {
          collectionId: collection.id,
          resourceId: resource.id,
        },
      },
      create: {
        collectionId: collection.id,
        resourceId: resource.id,
      },
      update: {}, // 已存在 noop
    });
  }

  /**
   * 用户取消收藏 → 从 Library Collection 中移除（保留 Resource 供其他用户）
   */
  private async removeFromLibrary(
    userId: string,
    signalId: string,
  ): Promise<void> {
    const sourceUrl = `${RADAR_SIGNAL_URL_PREFIX}${signalId}`;
    const resource = await this.prisma.resource.findFirst({
      where: { sourceUrl },
      select: { id: true },
    });
    if (!resource) return;
    const collection = await this.prisma.collection.findFirst({
      where: { userId, name: RADAR_FAVORITES_COLLECTION_NAME },
      select: { id: true },
    });
    if (!collection) return;
    await this.prisma.collectionItem.deleteMany({
      where: { collectionId: collection.id, resourceId: resource.id },
    });
  }

  async isFavorited(userId: string, signalId: string): Promise<boolean> {
    const row = await this.prisma.userFavorite.findUnique({
      where: { userId_signalId: { userId, signalId } },
      select: { id: true },
    });
    return row !== null;
  }

  /** 用户收藏列表（详情页跨日期访问用 — 仅 UserFavorite 原始行） */
  async listForUser(userId: string, limit = 50): Promise<UserFavorite[]> {
    return this.prisma.userFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  /**
   * FC-6: 收藏列表 + 联表取出每条收藏对应的 signal 内容
   *
   * 实现：从 UserFavorite 拿 (signalId, topicId)，按 topicId 拉最近 N 条
   *      RadarDailyBriefing，遍历 signals 数组查 signalId 命中。
   *      过期（briefing 已被 90 天清理）则 signal=null（前端展示"内容已过期"）
   */
  async listForUserWithSignals(
    userId: string,
    limit = 50,
  ): Promise<FavoriteWithSignal[]> {
    const favs = await this.prisma.userFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    if (favs.length === 0) return [];

    // 拿涉及的 topic 名（一次查询）
    const topicIds = Array.from(new Set(favs.map((f) => f.topicId)));
    const topics = await this.prisma.radarTopic.findMany({
      where: { id: { in: topicIds }, userId },
      select: { id: true, name: true },
    });
    const topicNameById = new Map(topics.map((t) => [t.id, t.name]));

    // 按 topic 拉最近 30 条 briefing（90 天窗口够用）；遍历找 signal
    const briefingsByTopic = new Map<
      string,
      Awaited<ReturnType<typeof this.dailyRepo.findRecentByTopic>>
    >();
    for (const tid of topicIds) {
      briefingsByTopic.set(
        tid,
        await this.dailyRepo.findRecentByTopic(tid, 30),
      );
    }

    return favs.map((f) => {
      let foundSignal: DailySignal | null = null;
      let foundDate: Date | null = null;
      const briefings = briefingsByTopic.get(f.topicId) ?? [];
      for (const b of briefings) {
        const arr = (b.signals as unknown as DailySignal[]) ?? [];
        const hit = arr.find((s) => s.id === f.signalId);
        if (hit) {
          foundSignal = hit;
          foundDate = b.briefingDate;
          break;
        }
      }
      return {
        signalId: f.signalId,
        topicId: f.topicId,
        topicName: topicNameById.get(f.topicId) ?? "(已删除)",
        favoritedAt: f.createdAt.toISOString(),
        signal: foundSignal,
        briefingDate: foundDate ? foundDate.toISOString().slice(0, 10) : null,
      };
    });
  }
}
