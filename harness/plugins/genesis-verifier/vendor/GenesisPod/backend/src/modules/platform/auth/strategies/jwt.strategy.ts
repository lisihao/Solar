import { Injectable, UnauthorizedException, Logger } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { CacheService } from "../../../../common/cache/cache.service";

/**
 * Redis key prefix for the JWT blocklist.
 * Exported so non-HTTP auth boundaries (e.g. WebSocket gateways) reuse the
 * exact same key instead of re-hardcoding it — single source of truth.
 */
export const BLOCKLIST_PREFIX = "blocklist:user:";

/** TTL for blocklist entries: 30 days in seconds */
const BLOCKLIST_TTL_SECONDS = 86400 * 30;

/**
 * JWT 认证策略
 *
 * SECURITY: JWT_SECRET environment variable is REQUIRED
 * Never use a default secret in production - it would allow token forgery
 *
 * PERFORMANCE: 不查询数据库，直接返回 JWT payload
 * - 用户信息由业务层按需获取（通过 UserService）
 * - 用户禁用/删除通过 Redis 黑名单机制处理（持久化，重启不丢失）
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger: Logger;

  constructor(
    configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {
    const jwtSecret = configService.get<string>("JWT_SECRET");

    // SECURITY: Fail fast if JWT_SECRET is not configured
    if (!jwtSecret) {
      const errorMessage =
        "CRITICAL SECURITY ERROR: JWT_SECRET environment variable is not set. " +
        "This is required for secure token generation and validation. " +
        "Set JWT_SECRET to a cryptographically secure random string (min 32 characters).";
      throw new Error(errorMessage);
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });

    // Initialize logger after super()
    this.logger = new Logger(JwtStrategy.name);

    // Warn if secret is too short (should be at least 32 characters)
    if (jwtSecret.length < 32) {
      this.logger.warn(
        "WARNING: JWT_SECRET is less than 32 characters. " +
          "For production security, use a longer secret (64+ characters recommended).",
      );
    }
  }

  /**
   * JWT 验证 - 只返回 payload，不查数据库
   *
   * @performance O(1) - 只检查 Redis 黑名单，无数据库查询
   * @security 通过 Redis 黑名单机制处理被禁用/删除的用户（重启持久化）
   */
  async validate(payload: { sub: string; email: string; username: string }) {
    const userId = payload.sub;

    // ★ 检查 Redis 黑名单（被禁用/删除的用户）
    // ★ 2026-05-27 (fail-open on cache error)：cache 查询异常时 log warn 并放行。
    //   Redis 不可达时若 throw → 所有 HTTP API 都 401，应用不可用。fail-open
    //   保留 Redis 正常工作时的安全语义（被 block 的用户仍会被拦截），同时不
    //   会因运行时 cache 故障让整个应用瘫痪。
    let isBlocked: string | null | undefined = null;
    try {
      isBlocked = await this.cacheService.get<string>(
        `${BLOCKLIST_PREFIX}${userId}`,
      );
    } catch (err) {
      this.logger.warn(
        `[jwt-validate] blocklist check failed for user=${userId} — fail-open: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (isBlocked) {
      throw new UnauthorizedException("User account is disabled");
    }

    // ★ 直接返回 JWT payload 中的信息，不查数据库
    return {
      id: userId,
      email: payload.email,
      username: payload.username,
    };
  }

  /**
   * 将用户加入黑名单（禁用/删除用户时调用）
   * 黑名单存储于 Redis，TTL 30 天，重启后不丢失
   */
  async blockUser(userId: string): Promise<void> {
    await this.cacheService.set(
      `${BLOCKLIST_PREFIX}${userId}`,
      "true",
      BLOCKLIST_TTL_SECONDS,
    );
    this.logger.log(`User ${userId} added to blocklist`);
  }

  /**
   * 将用户从黑名单移除（恢复用户时调用）
   */
  async unblockUser(userId: string): Promise<void> {
    await this.cacheService.del(`${BLOCKLIST_PREFIX}${userId}`);
    this.logger.log(`User ${userId} removed from blocklist`);
  }

  /**
   * 检查用户是否在黑名单中
   */
  async isUserBlocked(userId: string): Promise<boolean> {
    const value = await this.cacheService.get<string>(
      `${BLOCKLIST_PREFIX}${userId}`,
    );
    return value !== undefined;
  }
}
