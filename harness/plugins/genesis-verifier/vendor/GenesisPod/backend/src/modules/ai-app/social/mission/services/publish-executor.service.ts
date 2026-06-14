import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { SocialBrowserService } from "./social-browser.service";
import { ContentVersionService } from "./content-version.service";
import { WechatAdapter } from "../../integrations/wechat/wechat.adapter";
import { XhsMcpAdapter } from "../../integrations/xiaohongshu/xiaohongshu.adapter";
import {
  SocialContentStatus,
  SocialPlatformType,
  SocialContent,
  SocialPlatformConnection,
} from "../types";
import { decryptSession } from "../services/session-crypto";
import { SessionData } from "../types/platform.types";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  USER_EVENT_NAME,
  MODULE,
  ACTION,
  type UserEventPayload,
} from "@/common/observability/user-event.types";

export interface PublishResult {
  success: boolean;
  externalUrl?: string;
  externalId?: string;
  errorMessage?: string;
}

@Injectable()
export class PublishExecutorService {
  private readonly logger = new Logger(PublishExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly playwrightService: SocialBrowserService,
    private readonly contentVersionService: ContentVersionService,
    private readonly wechatAdapter: WechatAdapter,
    private readonly xhsMcpAdapter: XhsMcpAdapter,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  // Expose playwright for adapters that may need direct access
  getPlaywright(): SocialBrowserService {
    return this.playwrightService;
  }

  async execute(contentId: string): Promise<PublishResult> {
    const content = await this.prisma.socialContent.findUnique({
      where: { id: contentId },
      include: { connection: true },
    });

    if (!content) {
      return { success: false, errorMessage: "内容不存在" };
    }

    // 获取要使用的连接
    let connection = content.connection;

    // 如果没有关联连接，或者连接的会话数据无效，尝试找用户的活跃连接
    const needsFallback =
      !connection?.sessionData || !this.hasValidSession(connection);

    if (needsFallback) {
      this.logger.warn(
        `Content ${contentId} has invalid connection, looking for active connection...`,
      );

      // 根据内容类型确定平台
      const platformType =
        content.contentType === "WECHAT_ARTICLE"
          ? SocialPlatformType.WECHAT_MP
          : SocialPlatformType.XIAOHONGSHU;

      // 查找用户的活跃连接
      const activeConnection =
        await this.prisma.socialPlatformConnection.findFirst({
          where: {
            userId: content.userId,
            platformType,
            isActive: true,
          },
          orderBy: { lastCheckAt: "desc" },
        });

      if (activeConnection && this.hasValidSession(activeConnection)) {
        this.logger.log(
          `Found active connection ${activeConnection.id} with valid session`,
        );
        connection = activeConnection;

        // 更新内容的连接关联
        await this.prisma.socialContent.update({
          where: { id: contentId },
          data: { connectionId: activeConnection.id },
        });
      } else if (!connection) {
        return { success: false, errorMessage: "未关联发布账号" };
      } else {
        // 有连接但会话无效，且找不到有效的活跃连接
        this.logger.error(
          `Content ${contentId} has invalid connection and no valid fallback found`,
        );
        return {
          success: false,
          errorMessage:
            "微信公众号会话已失效（无有效Cookie），请在连接管理中断开后重新扫码登录",
        };
      }
    }

    // At this point connection is guaranteed non-null:
    // - if needsFallback was true, all null paths returned early above
    // - if needsFallback was false, connection had a valid sessionData
    const activeConn = connection!;

    try {
      // 更新状态为发布中
      await this.prisma.socialContent.update({
        where: { id: contentId },
        data: { status: SocialContentStatus.PUBLISHING },
      });

      // 获取平台适配版本内容
      this.logger.log(
        `Fetching version for content ${contentId}, platform: ${activeConn.platformType}`,
      );
      const versionData = await this.contentVersionService.getVersionForPublish(
        contentId,
        activeConn.platformType,
      );

      // 使用版本内容覆盖原始内容（如果存在）
      const publishContent = versionData
        ? {
            ...content,
            title: versionData.title,
            content: versionData.content,
            digest: versionData.digest ?? content.digest,
          }
        : content;

      // 详细日志：版本内容 vs 原始内容
      this.logger.log(
        `Publishing content ${contentId} to ${activeConn.platformType}: ` +
          `version=${versionData ? "YES" : "NO"}, ` +
          `title=${publishContent.title.length}字, ` +
          `content=${publishContent.content.length}字`,
      );

      let result: PublishResult;

      switch (activeConn.platformType) {
        case SocialPlatformType.WECHAT_MP:
          result = await this.wechatAdapter.publish(
            publishContent as SocialContent,
            activeConn as SocialPlatformConnection,
          );
          break;
        case SocialPlatformType.XIAOHONGSHU: {
          const xhsResult = await this.xhsMcpAdapter.publishContent({
            title: publishContent.title,
            content: publishContent.content,
            images: publishContent.images || [],
          });
          result = {
            success: xhsResult.success,
            externalId: xhsResult.noteId,
            errorMessage: xhsResult.error,
          };
          break;
        }
        default:
          result = {
            success: false,
            errorMessage: `不支持的平台类型: ${activeConn.platformType}`,
          };
      }

      // 更新发布结果
      await this.prisma.socialContent.update({
        where: { id: contentId },
        data: {
          status: result.success
            ? SocialContentStatus.PUBLISHED
            : SocialContentStatus.FAILED,
          publishedAt: result.success ? new Date() : null,
          externalUrl: result.externalUrl,
          externalId: result.externalId,
          errorMessage: result.errorMessage,
        },
      });

      // 记录发布日志
      await this.prisma.socialPublishLog.create({
        data: {
          contentId,
          action: "PUBLISH",
          status: result.success ? "SUCCESS" : "FAILED",
          details: {
            externalUrl: result.externalUrl,
            externalId: result.externalId,
          },
          errorMessage: result.errorMessage,
        },
      });

      if (this.eventEmitter) {
        this.eventEmitter.emit(USER_EVENT_NAME, {
          userId: content.userId,
          module: MODULE.AI_SOCIAL,
          action: result.success ? ACTION.PUBLISHED : ACTION.FAILED,
          resourceType: "SocialContent",
          resourceId: contentId,
        } satisfies UserEventPayload);
      }

      return result;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`发布失败: ${err.message}`, err.stack);

      // Ensure status always updates to FAILED, even if DB write fails
      try {
        await this.prisma.socialContent.update({
          where: { id: contentId },
          data: {
            status: SocialContentStatus.FAILED,
            errorMessage: err.message,
          },
        });

        await this.prisma.socialPublishLog.create({
          data: {
            contentId,
            action: "PUBLISH",
            status: "FAILED",
            errorMessage: err.message,
          },
        });
      } catch (dbError) {
        this.logger.error(
          `Failed to update content status to FAILED: ${(dbError as Error).message}`,
        );
      }

      return { success: false, errorMessage: err.message };
    }
  }

  /**
   * 检查连接是否有有效的会话数据
   */
  private hasValidSession(connection: { sessionData?: unknown }): boolean {
    if (!connection?.sessionData) {
      return false;
    }

    // MCP-managed sessions are always valid (validated via MCP)
    if (connection.sessionData === "mcp-managed") {
      return true;
    }

    try {
      const sessionDataStr =
        typeof connection.sessionData === "string"
          ? connection.sessionData
          : JSON.stringify(connection.sessionData);

      const sessionData = decryptSession<SessionData>(sessionDataStr);

      if (!sessionData?.cookies?.length) {
        this.logger.warn("Session has no valid cookies");
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to decrypt session data: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
