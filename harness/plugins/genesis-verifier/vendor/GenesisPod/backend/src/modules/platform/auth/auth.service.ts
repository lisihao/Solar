import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { CacheService, CachePrefix } from "../../../common/cache/cache.service";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";

/**
 * 登录请求信息（用于记录登录历史）
 */
export interface LoginRequestInfo {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * 授权码存储结构
 */
interface AuthCodeData {
  accessToken: string;
  refreshToken: string;
  userId: string;
  expiresAt: Date;
}

/**
 * 解析 User-Agent 获取设备信息
 */
function parseUserAgent(userAgent?: string): {
  device: string;
  browser: string;
  os: string;
} {
  if (!userAgent) {
    return { device: "unknown", browser: "unknown", os: "unknown" };
  }

  // 解析设备类型
  let device = "desktop";
  if (/mobile/i.test(userAgent)) {
    device = "mobile";
  } else if (/tablet|ipad/i.test(userAgent)) {
    device = "tablet";
  }

  // 解析浏览器
  let browser = "unknown";
  if (/edg/i.test(userAgent)) {
    browser = "Edge";
  } else if (/chrome/i.test(userAgent)) {
    browser = "Chrome";
  } else if (/firefox/i.test(userAgent)) {
    browser = "Firefox";
  } else if (/safari/i.test(userAgent)) {
    browser = "Safari";
  } else if (/opera|opr/i.test(userAgent)) {
    browser = "Opera";
  }

  // 解析操作系统
  let os = "unknown";
  if (/windows/i.test(userAgent)) {
    os = "Windows";
  } else if (/macintosh|mac os/i.test(userAgent)) {
    os = "macOS";
  } else if (/linux/i.test(userAgent)) {
    os = "Linux";
  } else if (/android/i.test(userAgent)) {
    os = "Android";
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    os = "iOS";
  }

  return { device, browser, os };
}

/**
 * 认证服务
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** Auth code TTL: 5 minutes (in seconds) */
  private static readonly AUTH_CODE_TTL = 300;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private cacheService: CacheService,
    private configService: ConfigService,
  ) {}

  /**
   * 生成短期授权码（存储在 Redis 中，支持多实例）
   */
  async generateAuthCode(
    accessToken: string,
    refreshToken: string,
    userId: string,
  ): Promise<string> {
    const authCode = crypto.randomBytes(32).toString("hex");
    const cacheKey = this.cacheService.buildKey(
      CachePrefix.AUTH_CODE,
      authCode,
    );

    await this.cacheService.set<AuthCodeData>(
      cacheKey,
      { accessToken, refreshToken, userId, expiresAt: new Date() },
      AuthService.AUTH_CODE_TTL,
    );

    this.logger.debug(
      `Auth code generated for user: ${userId}, TTL: ${AuthService.AUTH_CODE_TTL}s`,
    );
    return authCode;
  }

  /**
   * 用授权码换取 token
   */
  async exchangeAuthCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const cacheKey = this.cacheService.buildKey(CachePrefix.AUTH_CODE, code);
    const data = await this.cacheService.get<AuthCodeData>(cacheKey);

    if (!data) {
      throw new UnauthorizedException("Invalid or expired authorization code");
    }

    // 删除已使用的授权码（一次性使用）
    await this.cacheService.del(cacheKey);

    this.logger.log(`Auth code exchanged for user: ${data.userId}`);

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    };
  }

  /**
   * 记录登录历史
   */
  private async recordLoginHistory(
    userId: string,
    requestInfo?: LoginRequestInfo,
  ): Promise<void> {
    try {
      const { device, browser, os } = parseUserAgent(requestInfo?.userAgent);

      await this.prisma.loginHistory.create({
        data: {
          userId,
          ipAddress: requestInfo?.ipAddress || null,
          userAgent: requestInfo?.userAgent || null,
          device,
          browser,
          os,
        },
      });

      this.logger.debug(`Login history recorded for user: ${userId}`);
    } catch (error) {
      // 登录历史记录失败不应阻止登录
      this.logger.warn(`Failed to record login history: ${error}`);
    }
  }

  /**
   * 用户注册
   */
  async register(email: string, username: string, password: string) {
    // 检查用户是否已存在
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (existingUser) {
      throw new ConflictException("Email or username already exists");
    }

    // 密码加密
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建用户
    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        passwordHash: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        username: true,
        createdAt: true,
      },
    });

    // 创建积分账户（初始 10000 积分）
    try {
      await this.prisma.creditAccount.create({
        data: {
          userId: user.id,
          balance: 10000,
          totalEarned: 10000,
        },
      });
      this.logger.log(`Credit account created for user: ${user.username}`);
    } catch (creditError) {
      this.logger.warn(
        `Failed to create credit account for user ${user.id}: ${creditError}`,
      );
      // 积分账户创建失败不应阻止用户注册
    }

    // 生成 tokens
    const tokens = this.generateTokens(user.id, user.email, user.username);

    this.logger.log(`New user registered: ${user.username}`);

    return {
      user,
      ...tokens,
    };
  }

  /**
   * 用户登录
   */
  async login(email: string, password: string, requestInfo?: LoginRequestInfo) {
    // 查找用户
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    // 验证密码
    const isPasswordValid = await bcrypt.compare(
      password,
      user.passwordHash ?? "",
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    // 生成 tokens
    const tokens = this.generateTokens(user.id, user.email, user.username);

    // 更新最后登录时间
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        isActive: true,
      },
    });

    // 记录登录历史
    await this.recordLoginHistory(user.id, requestInfo);

    this.logger.log(`User logged in: ${user.username}`);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt,
        // ★ 2026-05-27 修复 (用户实证: ADMIN 登录后 Sidebar 不显 Admin 入口):
        //   原 response 缺 role 字段, frontend isUserAdmin(user) 拿 user.role
        //   undefined → false → AuthContext.isAdmin=false → 管理员被当普通用户。
        //   把 role 加进 login + register response 让 frontend 即刻识别管理员。
        role: user.role,
      },
      ...tokens,
    };
  }

  /**
   * 刷新 token
   */
  async refreshToken(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    if (!user.email) {
      throw new UnauthorizedException("User email is required");
    }

    return this.generateTokens(user.id, user.email, user.username);
  }

  /**
   * 生成 access token 和 refresh token
   *
   * @note JWT payload 包含 sub(userId), email, username
   *       JwtStrategy.validate() 直接返回这些信息，不查数据库
   * @security Refresh token 使用独立密钥（REFRESH_TOKEN_SECRET），与 access
   *           token 密钥隔离，防止 refresh token 被当作 access token 使用
   */
  private generateTokens(
    userId: string,
    email: string,
    username: string | null,
  ) {
    const payload = {
      sub: userId,
      email,
      username: username || email.split("@")[0],
    };

    const jwtSecret = this.configService.get<string>("JWT_SECRET") ?? "";
    const refreshSecret =
      this.configService.get<string>("REFRESH_TOKEN_SECRET") ||
      jwtSecret + "-refresh";

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: "30d",
      secret: refreshSecret,
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * 验证用户
   */
  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        createdAt: true,
      },
    });

    return user;
  }

  /**
   * 获取完整用户信息（用于 /auth/me）
   * 从数据库获取最新信息，包括 fullName、avatarUrl 等
   */
  async getFullProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        avatarUrl: true,
        bio: true,
        role: true,
        createdAt: true,
        interests: {
          select: { tag: true },
        },
      },
    });

    if (!user) {
      return null;
    }

    return {
      ...user,
      interests: user.interests.map((i) => i.tag),
    };
  }

  /**
   * Google OAuth - 查找或创建用户
   */
  async findOrCreateGoogleUser(
    profile: {
      id: string;
      email: string;
      displayName: string;
      picture?: string;
    },
    requestInfo?: LoginRequestInfo,
  ) {
    // 先尝试通过email查找用户
    let user = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });

    if (!user) {
      // 用户不存在，创建新用户
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          username: profile.displayName || profile.email.split("@")[0],
          fullName: profile.displayName || null, // 保存用户全名用于显示
          oauthProvider: "google",
          oauthId: profile.id,
          avatarUrl: profile.picture,
          // Google OAuth用户不需要密码
          passwordHash: null,
          isVerified: true, // Google账户已验证
        },
      });

      // 创建积分账户（初始 10000 积分）
      try {
        await this.prisma.creditAccount.create({
          data: {
            userId: user.id,
            balance: 10000,
            totalEarned: 10000,
          },
        });
        this.logger.log(
          `Credit account created for Google user: ${user.username}`,
        );
      } catch (creditError) {
        this.logger.warn(
          `Failed to create credit account for Google user ${user.id}: ${creditError}`,
        );
        // 积分账户创建失败不应阻止用户注册
      }

      this.logger.log(`New Google user created: ${user.username}`);
    } else if (!user.oauthId || user.oauthProvider !== "google") {
      // 用户存在但没有关联Google ID，更新用户
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          oauthProvider: "google",
          oauthId: profile.id,
          avatarUrl: profile.picture || user.avatarUrl,
          isVerified: true,
        },
      });

      this.logger.log(`Existing user linked with Google: ${user.username}`);
    }

    // 更新最后登录时间
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        isActive: true,
      },
    });

    // 记录登录历史
    await this.recordLoginHistory(user.id, requestInfo);

    // 生成tokens
    if (!user.email) {
      throw new UnauthorizedException("User email is required");
    }

    const tokens = this.generateTokens(user.id, user.email, user.username);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
      ...tokens,
    };
  }

  /**
   * 更新用户个人信息
   */
  async updateProfile(
    userId: string,
    updateData: {
      username?: string;
      fullName?: string;
      bio?: string;
      avatarUrl?: string;
      interests?: string[];
      preferences?: {
        language?: string;
        timezone?: string;
        theme?: "light" | "dark" | "system";
      };
    },
  ) {
    // 如果要更新username，检查是否已存在
    if (updateData.username) {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          username: updateData.username,
          NOT: { id: userId },
        },
      });

      if (existingUser) {
        throw new ConflictException("Username already exists");
      }
    }

    // 处理interests更新
    if (updateData.interests !== undefined) {
      // 删除旧的interests
      await this.prisma.userInterest.deleteMany({
        where: { userId },
      });

      // 创建新的interests
      if (updateData.interests.length > 0) {
        await this.prisma.userInterest.createMany({
          data: updateData.interests.map((tag) => ({
            userId,
            tag,
            source: "manual",
          })),
        });
      }
    }

    // 处理preferences更新（合并现有偏好）
    let preferencesUpdate = undefined;
    if (updateData.preferences) {
      const currentUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { preferences: true },
      });
      const currentPrefs =
        (currentUser?.preferences as Record<string, unknown>) || {};
      preferencesUpdate = {
        ...currentPrefs,
        ...updateData.preferences,
      };
    }

    // 更新用户基本信息（不包括interests，因为已单独处理）
    const { interests: _, preferences: __, ...basicFields } = updateData;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...basicFields,
        ...(preferencesUpdate && { preferences: preferencesUpdate }),
      },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        bio: true,
        avatarUrl: true,
        preferences: true,
        interests: {
          select: {
            tag: true,
          },
        },
        createdAt: true,
      },
    });

    this.logger.log(`User profile updated: ${user.username}`);

    // 转换interests为string数组
    return {
      ...user,
      interests: user.interests.map((i) => i.tag),
    };
  }

  /**
   * Get user statistics
   */
  async getUserStats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    // Count bookmarked/saved resources (user_activities with type SAVE)
    const bookmarkedCount = await this.prisma.userActivity.count({
      where: {
        userId,
        activityType: "SAVE",
      },
    });

    // Count viewed/read resources
    const viewedCount = await this.prisma.userActivity.count({
      where: {
        userId,
        activityType: "VIEW",
      },
    });

    // Count comments made by user
    const commentsCount = await this.prisma.comment.count({
      where: { userId },
    });

    // Count notes made by user
    const notesCount = await this.prisma.note.count({
      where: { userId },
    });

    // Count reports created
    const reportsCount = await this.prisma.report.count({
      where: { userId },
    });

    // Count AI chat sessions
    const chatSessionsCount = await this.prisma.askSession.count({
      where: { userId },
    });

    // Count AI Group topics participated (as creator or member)
    const topicsCreatedCount = await this.prisma.topic.count({
      where: { createdById: userId },
    });

    // Count generated images
    const imagesCount = await this.prisma.generatedImage.count({
      where: { userId },
    });

    // Get activity breakdown by type
    const activityBreakdown = await this.prisma.userActivity.groupBy({
      by: ["activityType"],
      where: { userId },
      _count: true,
    });

    // Get recent activity (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentActivityCount = await this.prisma.userActivity.count({
      where: {
        userId,
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    return {
      userId: user.id,
      memberSince: user.createdAt,
      stats: {
        bookmarked: bookmarkedCount,
        viewed: viewedCount,
        comments: commentsCount,
        notes: notesCount,
        reports: reportsCount,
        chatSessions: chatSessionsCount,
        topicsCreated: topicsCreatedCount,
        imagesGenerated: imagesCount,
      },
      activity: {
        recentActivityCount,
        breakdown: activityBreakdown.map((a) => ({
          type: a.activityType,
          count: a._count,
        })),
      },
    };
  }
}
