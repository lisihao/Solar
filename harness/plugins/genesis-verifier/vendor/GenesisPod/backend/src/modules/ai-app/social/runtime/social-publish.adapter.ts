/**
 * SocialPublishAdapter — engine SOCIAL_PUBLISH_PORT 的实现侧
 *
 * 反转方向：ai-engine 在 abstractions 里定 token 和接口，本类在 ai-app/social 实现并
 * 通过 @Global() bridge module 绑定到 token。engine 的 wechat-mp-publish /
 * xhs-publish / social-publish-status 三个 tool 通过 @Optional() @Inject() 拿到本实例。
 *
 * 实现策略（与用户决策"复用 social 现有队列 + 立即返回 jobId"对齐）：
 *   1. 收到 publishXxx 请求 → 创建 SocialContent 行（status: PENDING）
 *   2. void this.executor.execute(content.id) —— fire-and-forget 入队
 *   3. 立即返回 { jobId: content.id, status: "queued" }
 *   4. getPublishStatus(jobId) 查 SocialContent 当前状态 → 映射为 PublishJobStatus
 *
 * jobId 归属校验：getPublishStatus 必须按 userId 过滤，避免跨用户读取。
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  SOCIAL_PUBLISH_PORT,
  type SocialPublishPort,
  type SocialPublishContext,
  type PublishJobReceipt,
  type PublishStatusSnapshot,
  type PublishJobStatus,
  type SocialPlatform,
  type WechatMpPublishInput,
  type XhsPublishInput,
} from "@/modules/ai-engine/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import { PublishExecutorService } from "../mission/services/publish-executor.service";
import {
  SocialContentStatus,
  SocialContentType,
  SocialContentSourceType,
  SocialPlatformType,
} from "@prisma/client";

// Token 重导出，便于 module providers 引用（避免 import 路径太深）
export { SOCIAL_PUBLISH_PORT };

@Injectable()
export class SocialPublishAdapter implements SocialPublishPort {
  private readonly logger = new Logger(SocialPublishAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: PublishExecutorService,
  ) {}

  async publishWechatMp(
    input: WechatMpPublishInput,
    ctx: SocialPublishContext,
  ): Promise<PublishJobReceipt> {
    const connectionId = await this.resolveConnectionId(
      ctx.userId,
      SocialPlatformType.WECHAT_MP,
      input.accountId,
    );

    const content = await this.prisma.socialContent.create({
      data: {
        userId: ctx.userId,
        connectionId,
        contentType: SocialContentType.WECHAT_ARTICLE,
        sourceType: SocialContentSourceType.AI_RESEARCH,
        status: SocialContentStatus.PENDING,
        title: input.title,
        content: input.content,
        digest: input.digest,
        coverImageUrl: input.coverImageUrl,
        author: input.author,
        aiProcessLog: input.metadata
          ? { caller: ctx.callerId, metadata: input.metadata }
          : { caller: ctx.callerId },
      },
      select: { id: true },
    });

    this.logger.log(
      `[wechat-mp] enqueue publish: jobId=${content.id} caller=${ctx.callerId ?? "unknown"} user=${ctx.userId}`,
    );

    void this.executor.execute(content.id).catch((err) => {
      this.logger.error(
        `[wechat-mp] background publish failed for ${content.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    return {
      jobId: content.id,
      status: "queued",
      platform: "wechat-mp",
    };
  }

  async publishXhs(
    input: XhsPublishInput,
    ctx: SocialPublishContext,
  ): Promise<PublishJobReceipt> {
    const connectionId = await this.resolveConnectionId(
      ctx.userId,
      SocialPlatformType.XIAOHONGSHU,
      input.accountId,
    );

    const content = await this.prisma.socialContent.create({
      data: {
        userId: ctx.userId,
        connectionId,
        contentType: SocialContentType.XIAOHONGSHU_NOTE,
        sourceType: SocialContentSourceType.AI_RESEARCH,
        status: SocialContentStatus.PENDING,
        title: input.title,
        content: input.content,
        images: input.images,
        tags: input.tags ?? [],
        location: input.location,
        aiProcessLog: input.metadata
          ? {
              caller: ctx.callerId,
              metadata: input.metadata,
              atUsers: input.atUsers,
            }
          : { caller: ctx.callerId, atUsers: input.atUsers },
      },
      select: { id: true },
    });

    this.logger.log(
      `[xhs] enqueue publish: jobId=${content.id} caller=${ctx.callerId ?? "unknown"} user=${ctx.userId} images=${input.images.length}`,
    );

    void this.executor.execute(content.id).catch((err) => {
      this.logger.error(
        `[xhs] background publish failed for ${content.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    return {
      jobId: content.id,
      status: "queued",
      platform: "xhs",
    };
  }

  async getPublishStatus(
    jobId: string,
    ctx: SocialPublishContext,
  ): Promise<PublishStatusSnapshot | null> {
    const row = await this.prisma.socialContent.findFirst({
      where: { id: jobId, userId: ctx.userId },
      select: {
        id: true,
        contentType: true,
        status: true,
        externalId: true,
        externalUrl: true,
        errorMessage: true,
        publishedAt: true,
        updatedAt: true,
      },
    });

    if (!row) return null;

    const platform = this.contentTypeToPlatform(row.contentType);
    const status = this.mapStatus(row.status);
    const finishedAt =
      status === "published"
        ? (row.publishedAt ?? row.updatedAt)
        : status === "failed"
          ? row.updatedAt
          : undefined;

    return {
      jobId: row.id,
      status,
      platform,
      externalUrl: row.externalUrl ?? undefined,
      externalId: row.externalId ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      finishedAt,
    };
  }

  /**
   * 解析 connectionId：
   *   - 显式给了 accountId：必须归属当前 userId 才接受
   *   - 没给：找该平台第一个 isActive 的连接；都没有则返回 null
   *     （留给 PublishExecutor 兜底报错，避免在端口层重复 fallback 链）
   */
  private async resolveConnectionId(
    userId: string,
    platform: SocialPlatformType,
    accountId?: string,
  ): Promise<string | null> {
    if (accountId) {
      const owned = await this.prisma.socialPlatformConnection.findFirst({
        where: { id: accountId, userId, platformType: platform },
        select: { id: true },
      });
      if (owned) return owned.id;
      this.logger.warn(
        `accountId=${accountId} 不属于 user=${userId} 或平台不匹配，fallback 到活跃连接`,
      );
    }

    const active = await this.prisma.socialPlatformConnection.findFirst({
      where: { userId, platformType: platform, isActive: true },
      orderBy: { lastCheckAt: "desc" },
      select: { id: true },
    });
    return active?.id ?? null;
  }

  private contentTypeToPlatform(
    contentType: SocialContentType,
  ): SocialPlatform {
    return contentType === SocialContentType.WECHAT_ARTICLE
      ? "wechat-mp"
      : "xhs";
  }

  private mapStatus(status: SocialContentStatus): PublishJobStatus {
    switch (status) {
      case SocialContentStatus.PUBLISHING:
        return "publishing";
      case SocialContentStatus.PUBLISHED:
        return "published";
      case SocialContentStatus.FAILED:
        return "failed";
      // DRAFT / PENDING / SCHEDULED 都视为 queued —— 对 LLM agent 来说"等待中"
      default:
        return "queued";
    }
  }
}
