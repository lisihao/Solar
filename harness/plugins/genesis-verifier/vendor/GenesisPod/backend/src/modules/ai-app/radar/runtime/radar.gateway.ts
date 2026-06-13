/**
 * RadarGateway —— Socket.IO 入口
 *
 * 与 playground.gateway 同形：
 *   - afterInit 注册 SocketBroadcastAdapter（eventTypePrefix='ai-radar.', roomPrefix='radar'）
 *   - join/leave handler 鉴权 + ownership 校验
 *   - JWT 在 handshake.auth 解析；缺失 / 不匹配 → 拒绝
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
import {
  EventBus,
  SocketBroadcastAdapter,
} from "@/modules/ai-harness/facade";
import { RadarMissionStore } from "../mission/lifecycle/radar-mission-store.service";
import { RadarMissionEventBuffer } from "../mission/lifecycle/radar-mission-event-buffer.service";

interface JwtPayload {
  sub?: string;
  id?: string;
  userId?: string;
}

/**
 * CORS origin 来源（按优先级）：
 *   1. env FRONTEND_ORIGIN（prod 显式指定）
 *   2. env CORS_ORIGINS（多域逗号分隔）
 *   3. dev fallback：localhost/127.0.0.1（任意端口）+ railway preview 子域
 *
 * 避免 `origin: "*"` + `credentials: true` 的反模式（浏览器拒绝 + 非浏览器
 * 客户端可伪造 Origin 通过握手枚举 missionId）。
 */
const RADAR_WS_CORS_ORIGIN = (() => {
  const explicit =
    process.env.FRONTEND_ORIGIN ?? process.env.CORS_ORIGINS ?? "";
  if (explicit) {
    const list = explicit
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length > 0) return list;
  }
  return [
    /^https?:\/\/localhost(:\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    /^https:\/\/.*\.up\.railway\.app$/,
  ];
})();

@WebSocketGateway({
  namespace: "ai-radar",
  cors: { origin: RADAR_WS_CORS_ORIGIN, credentials: true },
})
export class RadarGateway implements OnGatewayInit {
  @WebSocketServer() io!: Server;
  private readonly log = new Logger(RadarGateway.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly jwt: JwtService,
    private readonly store: RadarMissionStore,
    private readonly eventBuffer: RadarMissionEventBuffer,
  ) {}

  afterInit(): void {
    this.eventBus.registerAdapter(
      new SocketBroadcastAdapter(this.io, {
        id: "ai-radar.socket",
        eventTypePrefix: "ai-radar.",
        roomPrefix: "radar",
      }),
    );
    // 内存事件缓冲 adapter —— 给 GET /radar/replay/:runId 回放（对齐 playground
    // MissionEventBuffer：socket 断线/刷新/掉包时前端用 /replay hydrate + polling）
    this.eventBus.registerAdapter(this.eventBuffer);
    this.log.log("RadarGateway initialized (namespace=ai-radar)");
  }

  @SubscribeMessage("join")
  async handleJoin(
    client: Socket,
    payload: { missionId: string },
  ): Promise<{ ok: boolean; error?: string; errorCode?: string }> {
    if (!payload?.missionId) return { ok: false, error: "missionId required" };
    let userId: string;
    try {
      userId = this.extractUserId(client);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "auth failed",
      };
    }
    // ownership 校验：mission 必须属于本 user
    const row = await this.store.getById(payload.missionId, userId);
    if (!row) {
      return {
        ok: false,
        error: "mission not found or forbidden",
        errorCode: "MISSION_NOT_FOUND",
      };
    }
    await client.join(`radar:${payload.missionId}`);
    this.log.debug(`client ${client.id} joined radar:${payload.missionId}`);
    return { ok: true };
  }

  @SubscribeMessage("leave")
  async handleLeave(
    client: Socket,
    payload: { missionId: string },
  ): Promise<{ ok: boolean }> {
    if (!payload?.missionId) return { ok: false };
    await client.leave(`radar:${payload.missionId}`);
    return { ok: true };
  }

  private extractUserId(client: Socket): string {
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
    return userId;
  }
}
