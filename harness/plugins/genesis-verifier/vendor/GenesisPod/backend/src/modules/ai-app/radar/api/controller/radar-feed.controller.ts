import {
  Controller,
  Get,
  Param,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { Prisma, RadarSourceType } from "@prisma/client";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import { RadarFeedQueryDto } from "../dto";
import { RadarTopicService } from "../../mission/services/topic/radar-topic.service";

@Controller("radar")
@UseGuards(JwtAuthGuard)
export class RadarFeedController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly topics: RadarTopicService,
  ) {}

  @Get("topics/:topicId/feed")
  async feed(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Query() q: RadarFeedQueryDto,
  ) {
    await this.topics.getOwnedById(req.user.id, topicId);
    const limit = Math.min(Math.max(q.limit ?? 30, 1), 200);
    const where: Prisma.RadarItemWhereInput = { topicId };
    if (q.type) where.source = { type: q.type as unknown as RadarSourceType };
    if (q.since) where.publishedAt = { gte: new Date(q.since) };
    if (q.minRelevance != null) {
      where.relevanceScore = { gte: q.minRelevance };
    }
    if (q.acceptedOnly === "true") where.accepted = true;

    const items = await this.prisma.radarItem.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      // 不 select raw（含原始 RSS payload，可能含 author 邮件等个人信息）
      select: {
        id: true,
        topicId: true,
        sourceId: true,
        externalId: true,
        contentHash: true,
        title: true,
        content: true,
        author: true,
        authorAvatar: true,
        url: true,
        publishedAt: true,
        fetchedAt: true,
        relevanceScore: true,
        qualityScore: true,
        aiSummary: true,
        entities: true,
        metrics: true,
        accepted: true,
        source: {
          select: { id: true, type: true, label: true, identifier: true },
        },
      },
    });

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    return {
      items: sliced,
      nextCursor: hasMore ? (sliced[sliced.length - 1]?.id ?? null) : null,
    };
  }

  @Get("topics/:topicId/items/:itemId")
  async detail(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("itemId") itemId: string,
  ) {
    await this.topics.getOwnedById(req.user.id, topicId);
    // 单条详情同样不返回 raw（前端用 url 跳原页面更合适，raw 仅服务端 reprocess 用）
    const item = await this.prisma.radarItem.findFirst({
      where: { id: itemId, topicId },
      select: {
        id: true,
        topicId: true,
        sourceId: true,
        externalId: true,
        title: true,
        content: true,
        author: true,
        authorAvatar: true,
        url: true,
        publishedAt: true,
        fetchedAt: true,
        relevanceScore: true,
        qualityScore: true,
        aiSummary: true,
        entities: true,
        metrics: true,
        accepted: true,
        source: {
          select: { id: true, type: true, label: true, identifier: true },
        },
      },
    });
    if (!item) {
      return { item: null };
    }
    return { item };
  }
}
