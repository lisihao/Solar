/**
 * AgentPlaygroundGateway —— Socket.IO 入口
 *
 * 必修 #4/#7:
 *   - SocketBroadcastAdapter 注册移到 afterInit（onModuleInit 时 io 还没绑定）
 *   - join 加 ownership 鉴权（防越权偷看他人 mission 流）
 *   - JWT 在 handshake.auth 解析；缺失/不匹配 → 拒绝
 */

import { Logger, UnauthorizedException } from "@nestjs/common";
import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayInit,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { JwtService } from "@nestjs/jwt";
// 必修 #8: 走 facade
import {
  EventBus,
  SocketBroadcastAdapter,
} from "@/modules/ai-harness/facade";
import { MissionOwnershipRegistry } from "@/modules/ai-harness/facade";
import { MissionStore } from "../../mission/lifecycle/mission-store.service";
import { wsCorsOrigin } from "@/common/config/ws-cors";
import { CacheService } from "@/common/cache/cache.service";
import { BLOCKLIST_PREFIX } from "@/modules/platform/auth/strategies/jwt.strategy";

interface JwtPayload {
  sub?: string;
  id?: string;
  userId?: string;
}

@WebSocketGateway({
  namespace: "playground",
  cors: { origin: wsCorsOrigin, credentials: true },
})
export class AgentPlaygroundGateway implements OnGatewayInit {
  @WebSocketServer() io!: Server;
  private readonly log = new Logger(AgentPlaygroundGateway.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly ownership: MissionOwnershipRegistry,
    private readonly jwt: JwtService,
    private readonly store: MissionStore,
    private readonly cache: CacheService,
  ) {}

  afterInit(): void {
    // 必修 #7: 必须在 afterInit 注册（io 此时已绑定）；onModuleInit 时 io 是 undefined
    this.eventBus.registerAdapter(
      new SocketBroadcastAdapter(this.io, {
        id: "playground.socket",
        eventTypePrefix: "playground.",
        roomPrefix: "playground",
      }),
    );
    this.log.log(
      "AgentPlaygroundGateway initialized (namespace=playground)",
    );
  }

  @SubscribeMessage("join")
  async handleJoin(
    client: Socket,
    payload: { missionId: string },
  ): Promise<{
    ok: boolean;
    error?: string;
    errorCode?: string;
    retryAfterMs?: number;
  }> {
    if (!payload?.missionId) return { ok: false, error: "missionId required" };
    let userId: string;
    try {
      userId = await this.extractUserId(client);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "auth failed",
      };
    }
    // ★ P1-O (2026-04-29): ownership cache miss 时 fallback 到 DB
    // ★ P1-NEW-G (round 2): DB 异常区分对待 —— 故障 vs 真不存在
    // ★ 全覆盖审计修 (2026-05-06): 增加 errorCode 字段，让前端按 code 而非字符串匹配：
    //   "SERVICE_UNAVAILABLE" → DB 连接故障，可重试
    //   "MISSION_NOT_FOUND"   → mission 真不存在，不应重试
    let owner = this.ownership.getOwner(payload.missionId);
    if (!owner) {
      let persisted: { id: string } | null = null;
      let dbErrored = false;
      try {
        persisted = await this.store.getById(payload.missionId, userId);
      } catch (err) {
        dbErrored = true;
        this.log.warn(
          `gateway DB fallback failed for mission=${payload.missionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (dbErrored) {
        return {
          ok: false,
          error: "service temporarily unavailable",
          errorCode: "SERVICE_UNAVAILABLE",
          retryAfterMs: 5000,
        };
      }
      if (!persisted) {
        return {
          ok: false,
          error: "mission not found",
          errorCode: "MISSION_NOT_FOUND",
        };
      }
      // DB 命中 → 重新登记 in-memory（hot path）
      this.ownership.assign(payload.missionId, userId);
      owner = userId;
    }
    if (owner !== userId) {
      this.log.warn(
        `client ${client.id} (user=${userId}) tried to join mission=${payload.missionId} owned by ${owner}`,
      );
      return { ok: false, error: "forbidden" };
    }
    // ★ P0-4: socket.join 是异步必须 await —— 否则后续 emit 时 room 还没生效会丢事件
    await client.join(`playground:${payload.missionId}`);
    this.log.debug(
      `client ${client.id} joined playground:${payload.missionId}`,
    );
    return { ok: true };
  }

  @SubscribeMessage("leave")
  async handleLeave(
    client: Socket,
    payload: { missionId: string },
  ): Promise<{ ok: boolean }> {
    if (!payload?.missionId) return { ok: false };
    // ★ P0-4: socket.leave 同样是异步
    await client.leave(`playground:${payload.missionId}`);
    return { ok: true };
  }

  private async extractUserId(client: Socket): Promise<string> {
    const auth = client.handshake.auth as {
      token?: string;
      Authorization?: string;
    };
    const authToken =
      auth?.token ?? auth?.Authorization?.replace(/^Bearer\s+/i, "");
    if (!authToken) throw new UnauthorizedException("no auth token");
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(authToken);
    } catch {
      throw new UnauthorizedException("invalid token");
    }
    const userId = payload.sub ?? payload.id ?? payload.userId;
    if (!userId) throw new UnauthorizedException("no user in token");
    // ★ P32 安全修 (e2e P0-#6): WS 鉴权除验签外必须查 Redis blocklist —— 否则被
    //   禁用/删除的用户旧 socket 仍能 join + 收 mission 流，直到 token 自然过期。
    //   与 HTTP JwtStrategy.validate 同源（同一 blocklist:user: key）。
    //
    // ★ 2026-05-27 Screenshot_49 致命修复 (fail-open on cache error):
    //   原实现 `await cache.get(...)` 在 Redis 不可达 / 超时 / 异常时直接 throw →
    //   WS handshake 失败 → 用户新创建 mission 页面收不到任何事件 → 14 stage 永远
    //   "待启动"。改成：cache 查询失败时 log warn 并放行（fail-open）。运行时仍
    //   生效（Redis 正常 → 被禁用账号仍会被拦截）；运行时降级仍可工作。
    let isBlocked: string | undefined | null = null;
    try {
      isBlocked = await this.cache.get<string>(`${BLOCKLIST_PREFIX}${userId}`);
    } catch (err) {
      this.log.warn(
        `[ws-auth] blocklist check failed for user=${userId} — fail-open (allowing connection): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (isBlocked) throw new UnauthorizedException("User account is disabled");
    return userId;
  }
}
