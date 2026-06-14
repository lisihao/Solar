import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { NotificationType, Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

/**
 * UnsubscribeTokenService —— 三级退订 JWT 签发 + 校验 + 应用
 *
 * 来源：daily-briefing-redesign-2026-05-18.md K5 + §7.3.3 邮件 footer 三级退订
 *
 * 三级 scope:
 * - topic: 单 topic 退订（payload 含 topicId；RADAR_DAILY/WEEKLY 该 topic 不再发）
 * - weekly: 退所有周报（RADAR_WEEKLY 全关）
 * - radar_all: 退所有 AI 雷达通知（RADAR_* 全关）
 * - global: 退全部通知（dispatcher 不再发任何 channel）
 *
 * 安全：
 * - JWT 7d 有效，HMAC 签名（JWT_SECRET）
 * - token-only auth（无需登录）方便邮件转发用户
 * - token 含 sub=userId + scope + 可选 ext(topicId for topic scope)
 * - DB 比对 + 消费置 null：防止泄露的旧 token 重放退订
 *   trade-off：每次签发覆盖 DB，旧邮件里的 token 立即失效（防重放 > 旧邮件链接持久）
 */
@Injectable()
export class UnsubscribeTokenService {
  private readonly log = new Logger(UnsubscribeTokenService.name);
  private static readonly TTL_SECONDS = 7 * 24 * 60 * 60;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 签发 token 并持久化到 NotificationPreference.unsubscribeToken
   * @returns the issued token string (caller put into email footer URL)
   */
  async issue(
    userId: string,
    scope: UnsubscribeScope,
    ext?: { topicId?: string },
  ): Promise<string> {
    const payload: UnsubscribeTokenPayload = { sub: userId, scope };
    if (scope === "topic" && ext?.topicId) {
      payload.topicId = ext.topicId;
    }
    const token = await this.jwt.signAsync(payload, {
      expiresIn: UnsubscribeTokenService.TTL_SECONDS,
    });
    // 持久化最新 token；verifyAndApply 用 DB 比对防重放（旧 token 立即失效）
    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, unsubscribeToken: token },
      update: { unsubscribeToken: token },
    });
    return token;
  }

  /**
   * FU2-A: 多 scope 退订 token（一封邮件 3 个链接共用 1 token）
   *
   * 解决 K5 三级退订设计与"DB 只存 1 token"的冲突：
   *   - 编码 scopes[] 数组 + 主 scope（fallback）
   *   - verifyAndApply 接受 URL scope 覆盖，必须在 scopes[] 内才允许
   *   - DB 仍只 1 token（防重放），点任一链接都消费同一 token
   *
   * 安全分析：
   *   - 攻击者拿到 token 仍只能在 scopes[] 集合内操作（降级 unsub）
   *   - 较单 scope token "降级" 弱化未实质性减损（用户已能选 global）
   *
   * @param userId 用户 ID
   * @param scopes 可选 scope 集合（典型：['topic','radar_all','global'] for daily / ['weekly','radar_all','global'] for weekly）
   * @param topicId topic scope 必需
   */
  async issueMultiScope(
    userId: string,
    scopes: UnsubscribeScope[],
    topicId?: string,
  ): Promise<string> {
    if (scopes.length === 0) {
      throw new Error("issueMultiScope: scopes empty");
    }
    if (scopes.includes("topic") && !topicId) {
      throw new Error("issueMultiScope: topic scope requires topicId");
    }
    const payload: UnsubscribeTokenPayload = {
      sub: userId,
      scope: scopes[0],
      scopes,
    };
    if (topicId) payload.topicId = topicId;
    const token = await this.jwt.signAsync(payload, {
      expiresIn: UnsubscribeTokenService.TTL_SECONDS,
    });
    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, unsubscribeToken: token },
      update: { unsubscribeToken: token },
    });
    return token;
  }

  /**
   * 校验 token + 应用退订（更新 NotificationPreference.channelSubscriptions）
   *
   * 错误语义：
   * - 签名失败 / 过期 → UnauthorizedException（endpoint 返 401 + 友好提示页）
   * - scope=topic 但缺 topicId → BadRequest 等价（这里也走 401 以暴露伪造）
   * - DB token 不一致（已轮换/已撤销）→ UnauthorizedException
   *
   * 安全：apply 成功后立即将 DB unsubscribeToken 置 null，
   * 使同一 token 无法二次重放，即使仍在 JWT TTL 内。
   */
  async verifyAndApply(
    token: string,
    requestedScope?: UnsubscribeScope,
  ): Promise<UnsubscribeResult> {
    let payload: UnsubscribeTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<UnsubscribeTokenPayload>(token);
    } catch (err) {
      this.log.warn(
        `unsubscribe token verify failed: ${(err as Error).message}`,
      );
      throw new UnauthorizedException("invalid or expired unsubscribe token");
    }

    if (!payload.sub || !payload.scope) {
      throw new UnauthorizedException("malformed unsubscribe payload");
    }

    // DB 比对：防旧 token 重放（token 已轮换或已消费后置 null）
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId: payload.sub },
      select: { unsubscribeToken: true },
    });
    if (!pref || pref.unsubscribeToken !== token) {
      this.log.warn(
        `unsubscribe token revoked or rotated for user=${payload.sub}`,
      );
      throw new UnauthorizedException("unsubscribe token revoked or rotated");
    }

    // FU2-A: requestedScope 来自 URL 参数 — 必须在 token.scopes 允许集内
    let effectivePayload: UnsubscribeTokenPayload = payload;
    if (requestedScope) {
      const allowed = payload.scopes ?? [payload.scope];
      if (!allowed.includes(requestedScope)) {
        this.log.warn(
          `unsubscribe scope override rejected user=${payload.sub} requested=${requestedScope} allowed=${allowed.join(",")}`,
        );
        throw new UnauthorizedException(
          "requested scope not authorized by token",
        );
      }
      effectivePayload = { ...payload, scope: requestedScope };
    }

    await this.applyScope(effectivePayload);

    // 消费后置 null，同一 token 不可二次重放
    await this.prisma.notificationPreference.update({
      where: { userId: payload.sub },
      data: { unsubscribeToken: null },
    });

    return {
      userId: effectivePayload.sub,
      scope: effectivePayload.scope,
      ext: { topicId: effectivePayload.topicId },
    };
  }

  private async applyScope(payload: UnsubscribeTokenPayload): Promise<void> {
    const { sub: userId, scope, topicId } = payload;

    if (scope === "global") {
      // 关全部 channel 全部 type — 用 channelSubscriptions 表达"all-off"
      // 业界惯例：set wildcard `*` 全关；这里我们设全已知 type 全 channel false
      await this.prisma.notificationPreference.upsert({
        where: { userId },
        create: {
          userId,
          emailEnabled: false,
          pushEnabled: false,
          channelSubscriptions: UnsubscribeTokenService.buildGlobalOff(),
        },
        update: {
          emailEnabled: false,
          pushEnabled: false,
          channelSubscriptions: UnsubscribeTokenService.buildGlobalOff(),
        },
      });
      return;
    }

    if (scope === "radar_all") {
      await this.mergeChannelSubscriptions(userId, {
        RADAR_DAILY: { email: false, site: false, wechat: false },
        RADAR_WEEKLY: { email: false, site: false, wechat: false },
        RADAR_TIER3_INSTANT: { email: false, site: false, wechat: false },
        RADAR_SOURCE_AUTO_DISABLED: {
          email: false,
          site: false,
          wechat: false,
        },
        RADAR_MISSION_COMPLETE: { email: false, site: false, wechat: false },
      });
      return;
    }

    if (scope === "weekly") {
      await this.mergeChannelSubscriptions(userId, {
        RADAR_WEEKLY: { email: false, site: false, wechat: false },
      });
      return;
    }

    if (scope === "topic") {
      if (!topicId) {
        throw new UnauthorizedException("topic scope requires topicId");
      }
      // PR-DR2 B17: 真正 per-topic 退订，upsert RadarTopicSubscription status='unsubscribed'
      await this.prisma.radarTopicSubscription.upsert({
        where: { userId_topicId: { userId, topicId } },
        create: {
          userId,
          topicId,
          status: "unsubscribed",
          unsubscribedAt: new Date(),
        },
        update: {
          status: "unsubscribed",
          unsubscribedAt: new Date(),
        },
      });
      this.log.log(
        `unsubscribe topic=${topicId} user=${userId} per-topic applied`,
      );
      return;
    }
  }

  private async mergeChannelSubscriptions(
    userId: string,
    updates: Partial<
      Record<NotificationType, Partial<Record<string, boolean>>>
    >,
  ): Promise<void> {
    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    const current = (existing?.channelSubscriptions ?? {}) as Record<
      string,
      Record<string, boolean>
    >;
    const next: Record<string, Record<string, boolean>> = { ...current };
    for (const [type, channels] of Object.entries(updates)) {
      const merged: Record<string, boolean> = { ...(current[type] ?? {}) };
      for (const [ch, v] of Object.entries(channels ?? {})) {
        if (typeof v === "boolean") merged[ch] = v;
      }
      next[type] = merged;
    }
    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        channelSubscriptions: next as Prisma.InputJsonValue,
      },
      update: {
        channelSubscriptions: next as Prisma.InputJsonValue,
      },
    });
  }

  private static buildGlobalOff(): Record<string, Record<string, boolean>> {
    const off = { email: false, site: false, wechat: false, webpush: false };
    return {
      RADAR_DAILY: off,
      RADAR_WEEKLY: off,
      RADAR_TIER3_INSTANT: off,
      RADAR_SOURCE_AUTO_DISABLED: off,
      RADAR_MISSION_COMPLETE: off,
      // 其他业务类型 caller 切到 dispatcher 后会自动尊重（resolver 矩阵）
    };
  }
}

export type UnsubscribeScope = "topic" | "weekly" | "radar_all" | "global";

export interface UnsubscribeTokenPayload {
  sub: string; // userId
  scope: UnsubscribeScope;
  topicId?: string;
  /** FU2-A: 允许的 scope 集合（多 scope token 用，单 scope token 留空） */
  scopes?: UnsubscribeScope[];
}

export interface UnsubscribeResult {
  userId: string;
  scope: UnsubscribeScope;
  ext?: { topicId?: string };
}
