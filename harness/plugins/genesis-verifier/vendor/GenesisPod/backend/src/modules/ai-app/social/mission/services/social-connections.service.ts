/**
 * SocialConnectionsService — 社交平台账号连接管理
 *
 * 拆自 AiSocialService（god class 减重 phase 2.A.1，2026-05-27）。
 * 负责：
 *   - 列出 / 初始化 / 验证 / 删除 / 测试 / 刷新平台连接
 *   - 微信公众号 走 Playwright 浏览器会话
 *   - 小红书 走 MCP 外部登录
 *   - 会话有效性验证（cookies / mcp checkLoginStatus）
 *
 * 与 SocialBrowserService（playwright 包装）+ XhsMcpAdapter（MCP 适配）协作。
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  CacheService,
  CachePrefix,
  CacheTTL,
} from "../../../../../common/cache/cache.service";
import { SocialBrowserService } from "./social-browser.service";
import { XhsMcpAdapter } from "../../integrations/xiaohongshu/xiaohongshu.adapter";
import { SocialPlatformType } from "../types";
import { encryptSession, decryptSession } from "./session-crypto";
import { SessionData } from "../types/platform.types";

interface BrowserPage {
  goto(url: string, options?: { timeout?: number }): Promise<unknown>;
  waitForNetworkIdle(options?: {
    idleTime?: number;
    timeout?: number;
  }): Promise<void>;
  url(): string;
  $(selector: string): Promise<unknown>;
}

@Injectable()
export class SocialConnectionsService {
  private readonly logger = new Logger(SocialConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly playwright: SocialBrowserService,
    private readonly xhsMcpAdapter: XhsMcpAdapter,
  ) {}

  // ==================== 平台连接 ====================

  async getConnections(userId: string) {
    return this.prisma.socialPlatformConnection.findMany({
      where: { userId },
    });
  }

  private buildLoginSessionKey(
    userId: string,
    platformType: SocialPlatformType,
  ): string {
    return this.cache.buildKey(CachePrefix.SOCIAL_LOGIN, userId, platformType);
  }

  private buildVerifyingLockKey(
    userId: string,
    platformType: SocialPlatformType,
  ): string {
    return this.cache.buildKey(
      CachePrefix.SOCIAL_VERIFYING,
      userId,
      platformType,
    );
  }

  async initConnection(userId: string, type: string) {
    const platformType = type.toUpperCase() as SocialPlatformType;

    const existing = await this.prisma.socialPlatformConnection.findUnique({
      where: {
        userId_platformType: {
          userId,
          platformType,
        },
      },
    });

    if (existing) {
      return {
        status: "existing",
        connection: existing,
        message: "平台已连接，如需重新连接请先断开",
      };
    }

    if (platformType === SocialPlatformType.XIAOHONGSHU) {
      return this.initXhsMcpConnection(userId, platformType);
    }

    try {
      const { sessionKey, screenshot } =
        await this.playwright.startLoginSession(userId, platformType);

      const cacheKey = this.buildLoginSessionKey(userId, platformType);
      await this.cache.set(
        cacheKey,
        {
          sessionKey,
          platformType,
        },
        CacheTTL.LOGIN_SESSION,
      );

      this.logger.log(
        `Login session created for ${platformType}, sessionKey: ${sessionKey}, cached at ${cacheKey}`,
      );

      return {
        status: "pending",
        sessionKey,
        screenshot,
        message: "请扫码登录",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to init connection for ${platformType}: ${errorMsg}`,
      );
      return {
        status: "error",
        message: `启动登录失败: ${errorMsg}`,
      };
    }
  }

  async verifyConnection(userId: string, type: string) {
    const platformType = type.toUpperCase() as SocialPlatformType;

    if (platformType === SocialPlatformType.XIAOHONGSHU) {
      return this.verifyXhsMcpConnection(userId, platformType);
    }

    const loginCacheKey = this.buildLoginSessionKey(userId, platformType);
    const lockCacheKey = this.buildVerifyingLockKey(userId, platformType);

    const isVerifying = await this.cache.get<boolean>(lockCacheKey);
    if (isVerifying) {
      this.logger.debug(
        `Verification already in progress for ${userId}-${platformType}`,
      );
      return {
        status: "pending",
        message: "验证中，请稍候...",
      };
    }

    this.logger.log(`Verifying connection ${platformType} for user ${userId}`);

    const pending = await this.cache.get<{
      sessionKey: string;
      platformType: SocialPlatformType;
    }>(loginCacheKey);

    if (!pending) {
      this.logger.warn(
        `No pending session found for ${userId}-${platformType}. User may need to restart login.`,
      );
      return {
        status: "error",
        message: "没有待验证的登录会话，请重新开始连接流程",
      };
    }

    await this.cache.set(lockCacheKey, true, CacheTTL.SHORT);

    try {
      const result = await this.playwright.checkLoginStatus(pending.sessionKey);

      if (result.loggedIn) {
        const hasValidCookies =
          result.sessionData?.cookies && result.sessionData.cookies.length > 0;
        if (!hasValidCookies) {
          this.logger.warn(
            `Login detected but no valid cookies in sessionData, returning pending`,
          );
          return {
            status: "pending",
            screenshot: result.screenshot,
            message: "登录检测中，请稍候...",
          };
        }

        const encryptedSessionData = encryptSession(result.sessionData);

        const connection = await this.prisma.socialPlatformConnection.upsert({
          where: {
            userId_platformType: {
              userId,
              platformType,
            },
          },
          update: {
            accountName: result.accountName || platformType,
            sessionData: encryptedSessionData,
            isActive: true,
            lastCheckAt: new Date(),
          },
          create: {
            userId,
            platformType,
            accountName: result.accountName || platformType,
            sessionData: encryptedSessionData,
            isActive: true,
            lastCheckAt: new Date(),
          },
        });

        await this.playwright.endLoginSession(pending.sessionKey);
        await this.cache.del(loginCacheKey);
        await this.cache.del(lockCacheKey);

        return {
          status: "success",
          connection,
          message: "连接成功",
        };
      }

      this.logger.debug(`Login not detected yet, returning screenshot`);
      return {
        status: "pending",
        screenshot: result.screenshot,
        message: "等待扫码确认",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to verify connection for ${platformType}: ${errorMsg}`,
      );
      return {
        status: "error",
        message: `验证失败: ${errorMsg}`,
      };
    } finally {
      await this.cache.del(lockCacheKey);
    }
  }

  async deleteConnection(userId: string, type: string) {
    const platformType = type.toUpperCase() as SocialPlatformType;

    await this.prisma.socialPlatformConnection.delete({
      where: {
        userId_platformType: {
          userId,
          platformType,
        },
      },
    });

    return { success: true };
  }

  async testConnection(userId: string, connectionId: string) {
    const connection = await this.prisma.socialPlatformConnection.findFirst({
      where: { id: connectionId, userId },
    });

    if (!connection) {
      throw new NotFoundException("连接不存在");
    }

    const validationResult = await this.validateSession(connection);

    await this.prisma.socialPlatformConnection.update({
      where: { id: connectionId },
      data: {
        lastCheckAt: new Date(),
        isActive: validationResult.isValid,
      },
    });

    return {
      success: validationResult.isValid,
      message: validationResult.isValid
        ? "连接正常"
        : validationResult.message || "连接已失效，请重新授权",
    };
  }

  async refreshConnection(userId: string, connectionId: string) {
    const connection = await this.prisma.socialPlatformConnection.findFirst({
      where: { id: connectionId, userId },
    });

    if (!connection) {
      throw new NotFoundException("连接不存在");
    }

    const validationResult = await this.validateSession(connection);

    const updated = await this.prisma.socialPlatformConnection.update({
      where: { id: connectionId },
      data: {
        lastCheckAt: new Date(),
        isActive: validationResult.isValid,
        updatedAt: new Date(),
      },
    });

    return {
      ...updated,
      validationResult: {
        isValid: validationResult.isValid,
        message: validationResult.isValid
          ? "会话有效，连接正常"
          : validationResult.message || "会话已过期，请重新连接",
      },
    };
  }

  // ==================== 会话有效性验证 ====================

  private async validateSession(connection: {
    id: string;
    platformType: string;
    sessionData: unknown;
  }): Promise<{
    isValid: boolean;
    message?: string;
  }> {
    if (!connection.sessionData) {
      return { isValid: false, message: "无会话数据" };
    }

    if (
      connection.platformType === SocialPlatformType.XIAOHONGSHU &&
      connection.sessionData === "mcp-managed"
    ) {
      try {
        const loginStatus = await this.xhsMcpAdapter.checkLoginStatus();
        return {
          isValid: loginStatus.loggedIn,
          message: loginStatus.loggedIn ? "" : "小红书登录已过期",
        };
      } catch (error) {
        this.logger.error(
          `XHS MCP validation failed: ${(error as Error).message}`,
        );
        return { isValid: false, message: "MCP 服务不可用" };
      }
    }

    const contextId = `validate-${connection.id}-${Date.now()}`;

    try {
      const sessionDataStr =
        typeof connection.sessionData === "string"
          ? connection.sessionData
          : JSON.stringify(connection.sessionData);

      const sessionData = decryptSession<SessionData>(sessionDataStr);

      await this.playwright.restoreSession(contextId, sessionData);
      const page = await this.playwright.createPage(contextId);

      let isValid = false;
      let message = "";

      if (connection.platformType === SocialPlatformType.WECHAT_MP) {
        isValid = await this.validateWechatSession(page);
        if (!isValid) message = "微信公众号登录已过期";
      } else {
        return { isValid: false, message: "不支持的平台类型" };
      }

      return { isValid, message };
    } catch (error) {
      this.logger.error(
        `Session validation failed: ${(error as Error).message}`,
      );
      return { isValid: false, message: "验证失败，请重新连接" };
    } finally {
      await this.playwright.closeContext(contextId);
    }
  }

  private async validateWechatSession(page: BrowserPage): Promise<boolean> {
    try {
      await page.goto("https://mp.weixin.qq.com/cgi-bin/home", {
        timeout: 30000,
      });
      await page
        .waitForNetworkIdle({ idleTime: 500, timeout: 15000 })
        .catch((err: Error) => {
          this.logger.debug(
            `waitForNetworkIdle timed out (non-critical): ${err.message}`,
          );
        });

      const url = page.url();

      if (url.includes("/cgi-bin/bizlogin") || url.includes("action=login")) {
        this.logger.debug("WeChat validation: redirected to login page");
        return false;
      }

      if (url.includes("/cgi-bin/home") || url.includes("/cgi-bin/frame")) {
        this.logger.debug("WeChat validation: in backend, session valid");
        return true;
      }

      const selectors = [
        ".weui-desktop-account__nickname",
        "#menuBar",
        ".main_bd",
      ];
      for (const selector of selectors) {
        const element = await page.$(selector);
        if (element) {
          this.logger.debug(
            `WeChat validation: found indicator ${selector}, session valid`,
          );
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.error(
        `WeChat session validation error: ${(error as Error).message}`,
      );
      return false;
    }
  }

  // ==================== 小红书 MCP 连接管理 ====================

  private async initXhsMcpConnection(
    userId: string,
    platformType: SocialPlatformType,
  ) {
    try {
      if (!this.xhsMcpAdapter.isAvailable()) {
        return {
          status: "pending",
          loginMethod: "external-mcp",
          instructions: [
            "1. 确保 xiaohongshu-mcp 服务已启动 (默认端口 18060)",
            "2. 在终端运行 xiaohongshu-login 工具登录",
            "3. 浏览器会自动打开，使用小红书 App 扫码登录",
            "4. 登录成功后回到此页面点击「确认登录」",
          ],
          message: "MCP 服务未连接，请先启动 xiaohongshu-mcp 服务",
        };
      }

      const loginStatus = await this.xhsMcpAdapter.checkLoginStatus();

      if (loginStatus.loggedIn) {
        const connection = await this.prisma.socialPlatformConnection.create({
          data: {
            userId,
            platformType,
            accountName: loginStatus.nickname || "小红书用户",
            sessionData: "mcp-managed",
            isActive: true,
            lastCheckAt: new Date(),
          },
        });

        return {
          status: "success",
          connection,
          message: "小红书已连接",
        };
      }

      return {
        status: "pending",
        loginMethod: "external-mcp",
        instructions: [
          "1. 在终端运行 xiaohongshu-login 工具",
          "2. 浏览器会自动打开小红书登录页面",
          "3. 使用小红书 App 扫码登录",
          "4. 登录成功后回到此页面点击「确认登录」",
        ],
        message: "请按照指引完成小红书登录",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to init XHS MCP connection: ${errorMsg}`);
      return {
        status: "error",
        message: `小红书连接失败: ${errorMsg}`,
      };
    }
  }

  private async verifyXhsMcpConnection(
    userId: string,
    platformType: SocialPlatformType,
  ) {
    try {
      const loginStatus = await this.xhsMcpAdapter.checkLoginStatus();

      if (loginStatus.loggedIn) {
        const connection = await this.prisma.socialPlatformConnection.upsert({
          where: {
            userId_platformType: { userId, platformType },
          },
          update: {
            accountName: loginStatus.nickname || "小红书用户",
            sessionData: "mcp-managed",
            isActive: true,
            lastCheckAt: new Date(),
          },
          create: {
            userId,
            platformType,
            accountName: loginStatus.nickname || "小红书用户",
            sessionData: "mcp-managed",
            isActive: true,
            lastCheckAt: new Date(),
          },
        });

        return {
          status: "success",
          connection,
          message: "小红书连接成功",
        };
      }

      return {
        status: "pending",
        message: "等待小红书登录确认...",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`XHS MCP verify failed: ${errorMsg}`);
      return {
        status: "error",
        message: `验证失败: ${errorMsg}`,
      };
    }
  }
}
