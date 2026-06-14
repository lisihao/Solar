/**
 * 会话管理服务
 *
 * 统一管理平台登录会话
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { SocialPlatformType } from "../mission/types";
import {
  SessionData,
  SessionValidationResult,
} from "../mission/types/platform.types";
import { WECHAT_REQUIRED_COOKIES } from "../runtime/platforms.config";
import {
  encryptSession,
  decryptSession,
} from "../mission/services/session-crypto";

@Injectable()
export class SessionManagerService {
  private readonly logger = new Logger(SessionManagerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取用户的平台会话
   */
  async getSession(
    userId: string,
    platformType: SocialPlatformType,
  ): Promise<{
    connectionId: string;
    sessionData: SessionData;
    accountName?: string;
  } | null> {
    const connection = await this.prisma.socialPlatformConnection.findFirst({
      where: {
        userId,
        platformType,
        isActive: true,
      },
    });

    if (!connection?.sessionData) {
      return null;
    }

    try {
      // Decrypt session data (handles legacy unencrypted data automatically)
      const sessionDataStr =
        typeof connection.sessionData === "string"
          ? connection.sessionData
          : JSON.stringify(connection.sessionData);

      const sessionData = decryptSession<SessionData>(sessionDataStr);

      return {
        connectionId: connection.id,
        sessionData,
        accountName: connection.accountName || undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to decrypt session data: ${error}`);
      return null;
    }
  }

  /**
   * 保存会话数据
   */
  async saveSession(
    userId: string,
    platformType: SocialPlatformType,
    sessionData: SessionData,
    accountInfo?: {
      accountName?: string;
      accountId?: string;
      avatarUrl?: string;
    },
  ): Promise<string> {
    // Encrypt session data before storing
    const encryptedSessionData = encryptSession(sessionData);

    const connection = await this.prisma.socialPlatformConnection.upsert({
      where: {
        userId_platformType: {
          userId,
          platformType,
        },
      },
      create: {
        userId,
        platformType,
        sessionData: encryptedSessionData,
        accountName: accountInfo?.accountName,
        accountId: accountInfo?.accountId,
        avatarUrl: accountInfo?.avatarUrl,
        isActive: true,
        lastCheckAt: new Date(),
      },
      update: {
        sessionData: encryptedSessionData,
        accountName: accountInfo?.accountName || undefined,
        accountId: accountInfo?.accountId || undefined,
        avatarUrl: accountInfo?.avatarUrl || undefined,
        isActive: true,
        lastCheckAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.logger.log(
      `Session saved for ${userId} on ${platformType}: ${connection.id}`,
    );
    return connection.id;
  }

  /**
   * 验证会话有效性
   */
  validateSessionData(
    sessionData: SessionData,
    platformType: SocialPlatformType,
  ): SessionValidationResult {
    if (!sessionData) {
      return { valid: false, reason: "会话数据为空" };
    }

    if (!sessionData.cookies || sessionData.cookies.length === 0) {
      return { valid: false, reason: "Cookie 为空" };
    }

    // 检查必要的 cookies
    // 小红书现在通过 MCP 管理会话，不再需要 cookie 验证
    const requiredCookies =
      platformType === SocialPlatformType.WECHAT_MP
        ? WECHAT_REQUIRED_COOKIES
        : [];

    const now = Date.now() / 1000;
    const existingCookies = new Set(sessionData.cookies.map((c) => c.name));
    const expiredCookies: string[] = [];
    const missingCookies: string[] = [];

    for (const required of requiredCookies) {
      if (!existingCookies.has(required)) {
        missingCookies.push(required);
      }
    }

    // 检查过期的 cookies
    for (const cookie of sessionData.cookies) {
      if (cookie.expires && cookie.expires < now) {
        expiredCookies.push(cookie.name);
      }
    }

    // 检查关键 cookies 是否过期
    const criticalExpired = expiredCookies.filter((name) =>
      requiredCookies.includes(name),
    );

    if (missingCookies.length > 0) {
      return {
        valid: false,
        reason: `缺少必要的 Cookie: ${missingCookies.join(", ")}`,
        missingCookies,
      };
    }

    if (criticalExpired.length === requiredCookies.length) {
      return {
        valid: false,
        reason: "所有认证 Cookie 已过期",
        expiredCookies: criticalExpired,
      };
    }

    if (criticalExpired.length > 0) {
      this.logger.warn(`Some cookies expired: ${criticalExpired.join(", ")}`);
    }

    return { valid: true };
  }

  /**
   * 标记会话过期
   */
  async markSessionExpired(connectionId: string): Promise<void> {
    await this.prisma.socialPlatformConnection.update({
      where: { id: connectionId },
      data: {
        isActive: false,
        lastCheckAt: new Date(),
      },
    });

    this.logger.log(`Session marked as expired: ${connectionId}`);
  }

  /**
   * 删除会话
   */
  async deleteSession(
    userId: string,
    platformType: SocialPlatformType,
  ): Promise<void> {
    await this.prisma.socialPlatformConnection.deleteMany({
      where: {
        userId,
        platformType,
      },
    });

    this.logger.log(`Session deleted for ${userId} on ${platformType}`);
  }

  /**
   * 获取所有活跃连接
   */
  async getActiveConnections(): Promise<
    Array<{
      id: string;
      userId: string;
      platformType: string;
      accountName: string | null;
      lastCheckAt: Date | null;
    }>
  > {
    return this.prisma.socialPlatformConnection.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        userId: true,
        platformType: true,
        accountName: true,
        lastCheckAt: true,
      },
    });
  }

  /**
   * 更新最后检查时间
   */
  async updateLastCheck(connectionId: string): Promise<void> {
    await this.prisma.socialPlatformConnection.update({
      where: { id: connectionId },
      data: {
        lastCheckAt: new Date(),
      },
    });
  }

  /**
   * 过滤有效的 cookies（移除过期的）
   */
  filterValidCookies(sessionData: SessionData): SessionData {
    const now = Date.now() / 1000;

    return {
      ...sessionData,
      cookies: sessionData.cookies.filter(
        (cookie) => !cookie.expires || cookie.expires > now,
      ),
    };
  }

  /**
   * 获取连接统计
   */
  async getConnectionStats(userId: string): Promise<{
    total: number;
    active: number;
    platforms: Array<{
      platformType: string;
      isActive: boolean;
      accountName: string | null;
      lastCheckAt: Date | null;
    }>;
  }> {
    const connections = await this.prisma.socialPlatformConnection.findMany({
      where: { userId },
      select: {
        platformType: true,
        isActive: true,
        accountName: true,
        lastCheckAt: true,
      },
    });

    return {
      total: connections.length,
      active: connections.filter((c) => c.isActive).length,
      platforms: connections,
    };
  }
}
