import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  NotificationService,
  NotificationTypeDto,
} from "../../../../platform/facade";
import { SocialBrowserService } from "./social-browser.service";
import { XhsMcpAdapter } from "../../integrations/xiaohongshu/xiaohongshu.adapter";
import { SocialPlatformType } from "../types";
import { decryptSession } from "../services/session-crypto";
import { SessionData } from "../types/platform.types";

/**
 * 会话健康检查调度器
 * 定期检查所有平台连接的会话有效性，在会话过期时发送通知
 */
@Injectable()
export class SessionHealthCheckScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SessionHealthCheckScheduler.name);
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  // 默认检查间隔：4小时 (毫秒)
  private readonly CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly playwright: SocialBrowserService,
    private readonly xhsMcpAdapter: XhsMcpAdapter,
  ) {}

  onModuleInit() {
    const enabled = this.configService.get<boolean>(
      "SESSION_HEALTH_CHECK_ENABLED",
      false,
    );

    if (enabled) {
      this.logger.log("Session health check scheduler initialized");
      this.startScheduler();
    } else {
      this.logger.log(
        "Session health check scheduler is disabled. Set SESSION_HEALTH_CHECK_ENABLED=true to enable.",
      );
    }
  }

  onModuleDestroy() {
    this.stopScheduler();
  }

  /**
   * 启动调度器
   */
  private startScheduler() {
    // 启动后延迟5分钟进行第一次检查（避免启动时立即执行）
    const initialDelay = 5 * 60 * 1000;

    setTimeout(() => {
      void this.checkAllSessions();
    }, initialDelay).unref();

    // 设置定期检查
    this.intervalId = setInterval(() => {
      void this.checkAllSessions();
    }, this.CHECK_INTERVAL_MS).unref();

    this.logger.log(
      `Scheduler started: first check in 5 minutes, then every 4 hours`,
    );
  }

  /**
   * 停止调度器
   */
  private stopScheduler() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.log("Scheduler stopped");
    }
  }

  /**
   * 检查所有活跃连接的会话状态
   */
  async checkAllSessions(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Session check already in progress, skipping...");
      return;
    }

    this.isRunning = true;
    this.logger.log("Starting scheduled session health check...");

    try {
      // 获取所有活跃的连接
      const connections = await this.prisma.socialPlatformConnection.findMany({
        where: { isActive: true },
        select: {
          id: true,
          userId: true,
          platformType: true,
          accountName: true,
          sessionData: true,
          lastCheckAt: true,
        },
      });

      this.logger.log(
        `Found ${connections.length} active connections to check`,
      );

      let checkedCount = 0;
      let expiredCount = 0;

      for (const connection of connections) {
        try {
          const isValid = await this.validateConnection(connection);

          if (!isValid) {
            expiredCount++;
            // 标记连接为非活跃状态
            await this.prisma.socialPlatformConnection.update({
              where: { id: connection.id },
              data: { isActive: false, lastCheckAt: new Date() },
            });

            // 发送通知给用户
            await this.notifySessionExpired(
              connection.userId,
              connection.platformType,
              connection.accountName || connection.platformType,
            );

            this.logger.warn(
              `Session expired for ${connection.platformType} (user: ${connection.userId})`,
            );
          } else {
            // 更新最后检查时间
            await this.prisma.socialPlatformConnection.update({
              where: { id: connection.id },
              data: { lastCheckAt: new Date() },
            });
          }

          checkedCount++;
        } catch (error) {
          // session 被撤销 / 网络抖动属预期业务事件，不是系统级错误
          this.logger.warn(
            `Failed to check connection ${connection.id}: ${(error as Error).message}`,
          );
        }

        // 添加间隔避免过快请求
        await this.sleep(2000);
      }

      this.logger.log(
        `Session health check completed: ${checkedCount} checked, ${expiredCount} expired`,
      );
    } catch (error) {
      this.logger.error(
        `Session health check failed: ${(error as Error).message}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 验证单个连接的会话有效性
   */
  private async validateConnection(connection: {
    id: string;
    platformType: string;
    sessionData: unknown;
  }): Promise<boolean> {
    if (!connection.sessionData) {
      return false;
    }

    // 小红书 MCP-managed 连接：通过 MCP 检查
    if (
      connection.platformType === SocialPlatformType.XIAOHONGSHU &&
      connection.sessionData === "mcp-managed"
    ) {
      try {
        const loginStatus = await this.xhsMcpAdapter.checkLoginStatus();
        return loginStatus.loggedIn;
      } catch (error) {
        this.logger.warn(
          `XHS MCP validation error for ${connection.id}: ${(error as Error).message}`,
        );
        return false;
      }
    }

    const contextId = `health-check-${connection.id}-${Date.now()}`;

    try {
      const sessionDataStr =
        typeof connection.sessionData === "string"
          ? connection.sessionData
          : JSON.stringify(connection.sessionData);

      const sessionData = decryptSession<SessionData>(sessionDataStr);

      await this.playwright.restoreSession(contextId, sessionData);
      const page = await this.playwright.createPage(contextId);

      let isValid = false;

      if (connection.platformType === SocialPlatformType.WECHAT_MP) {
        isValid = await this.validateWechatSession(page);
      }

      return isValid;
    } catch (error) {
      this.logger.warn(
        `Validation error for connection ${connection.id}: ${(error as Error).message}`,
      );
      return false;
    } finally {
      await this.playwright.closeContext(contextId);
    }
  }

  /**
   * 验证微信公众号会话
   */
  private async validateWechatSession(page: unknown): Promise<boolean> {
    try {
      const p = page as {
        goto: (url: string, options?: { timeout?: number }) => Promise<void>;
        waitForNetworkIdle: (options?: {
          idleTime?: number;
          timeout?: number;
        }) => Promise<void>;
        url: () => string;
        $: (selector: string) => Promise<unknown>;
      };

      await p.goto("https://mp.weixin.qq.com/cgi-bin/home", {
        timeout: 30000,
      });
      await p
        .waitForNetworkIdle({ idleTime: 500, timeout: 15000 })
        .catch((err: Error) => {
          this.logger.debug(
            `waitForNetworkIdle timed out (non-critical, URL check follows): ${err.message}`,
          );
        });

      const url = p.url();

      // 如果重定向到登录页，说明未登录
      if (url.includes("/cgi-bin/bizlogin") || url.includes("action=login")) {
        return false;
      }

      // 检查是否在后台
      if (url.includes("/cgi-bin/home") || url.includes("/cgi-bin/frame")) {
        return true;
      }

      // 检查页面元素
      const selectors = [
        ".weui-desktop-account__nickname",
        "#menuBar",
        ".main_bd",
      ];

      for (const selector of selectors) {
        const element = await p.$(selector);
        if (element) {
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.warn(
        `WeChat session validation error: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * 发送会话过期通知
   */
  private async notifySessionExpired(
    userId: string,
    platformType: string,
    accountName: string,
  ): Promise<void> {
    const platformNames: Record<string, string> = {
      WECHAT_MP: "微信公众号",
      XIAOHONGSHU: "小红书",
    };

    const platformName = platformNames[platformType] || platformType;

    await this.notificationService.createNotification({
      userId,
      type: NotificationTypeDto.SESSION_EXPIRED,
      title: "平台连接已过期",
      message: `您的${platformName}账号「${accountName}」连接已过期，请重新授权以继续使用自动发布功能`,
      actionUrl: "/ai-social/connections",
      actionLabel: "重新连接",
      relatedType: "social_connection",
      relatedId: platformType,
      metadata: {
        platformType,
        accountName,
        expiredAt: new Date().toISOString(),
      },
    });
  }

  /**
   * 辅助函数：延时
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
