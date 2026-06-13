/**
 * AskRoomGateway - WebSocket /ai-ask-room namespace
 *
 * 设计：teams-mode.md §6 流式协议
 * 评审收敛 R3 / 集体共识 W2 v3：
 *   - 阻塞: 真 JWT verify（之前为 stub）
 *   - 阻塞: CORS 白名单（之前 origin: true）
 *   - 阻塞: 复用 NotificationGateway 的 JWT 模式（@nestjs/jwt + JwtService）
 *
 * 责任：
 *   - 接收客户端 join；校验 JWT + sessionId 归属当前 user
 *   - 加入 socket.io room "ask-room:${sessionId}"
 *   - 接收客户端 turn.cancel
 *   - 暴露 emitToRoom(room, event) 给 controller / runtime
 */

import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { PrismaService } from "@/common/prisma/prisma.service";
import { APP_CONFIG } from "@/common/config/app.config";
import {
  ASK_ROOM_CLIENT_EVENT_NAME,
  ASK_ROOM_EVENT_NAME,
  ASK_ROOM_JOIN_EVENT_NAME,
  ASK_ROOM_NAMESPACE,
  type AskRoomClientEvent,
  type AskRoomJoinAck,
  type AskRoomJoinPayload,
  type AskRoomServerEvent,
  askRoomKey,
} from "./gateway/ask-room-events.types";
import { AskRoomRuntimeService } from "./ai-ask-room-runtime.service";

interface JwtPayload {
  sub?: string;
  id?: string;
  userId?: string;
}

interface AuthenticatedSocket extends Socket {
  data: { userId?: string };
}

/**
 * ★ CORS 白名单（函数式 origin 校验，替代原硬编码数组）
 * 与 main.ts HTTP CORS / topic-insights WS 网关对齐：
 *   - 无 Origin（服务端调用、健康检查）放行
 *   - 开发环境放行 localhost / 127.0.0.1
 *   - 生产精确匹配 CORS_ORIGINS + FRONTEND_URL + RAILWAY_FRONTEND_URL + Railway 默认域名
 * 代理/自定义域名部署（如 gens.team）：把前端域名加入 CORS_ORIGINS 或 FRONTEND_URL 即可。
 * 原硬编码数组只含 *.up.railway.app，自定义域名握手被拒 → 前端报 xhr poll error。
 */
const buildAskRoomWsAllowedOrigins = (): Set<string> => {
  const origins = new Set<string>();
  const add = (raw?: string | null): void => {
    if (!raw) return;
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => origins.add(s));
  };
  add(process.env.CORS_ORIGINS);
  add(process.env.FRONTEND_URL);
  add(process.env.RAILWAY_FRONTEND_URL);
  add(APP_CONFIG.railway.frontendUrl);
  add(APP_CONFIG.railway.backendUrl);
  return origins;
};

const askRoomWsAllowedOrigins = buildAskRoomWsAllowedOrigins();
const askRoomWsIsDev = process.env.NODE_ENV !== "production";

const askRoomWsCorsOrigin = (
  origin: string,
  callback: (err: Error | null, allow?: boolean) => void,
): void => {
  if (!origin) {
    callback(null, true);
    return;
  }
  const isLocalhost =
    askRoomWsIsDev &&
    (/^http:\/\/localhost:\d+$/.test(origin) ||
      /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
  if (isLocalhost || askRoomWsAllowedOrigins.has(origin)) {
    callback(null, true);
  } else {
    callback(null, false);
  }
};

@Injectable()
@WebSocketGateway({
  namespace: ASK_ROOM_NAMESPACE,
  cors: {
    origin: askRoomWsCorsOrigin,
    credentials: true,
  },
  transports: ["websocket", "polling"],
})
export class AskRoomGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AskRoomGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: AskRoomRuntimeService,
    private readonly jwt: JwtService,
  ) {}

  handleConnection(client: AuthenticatedSocket): void {
    const userId = this.extractUserId(client);
    if (!userId) {
      client.disconnect(true);
      return;
    }
    client.data.userId = userId;
    this.logger.debug(
      `[AskRoom] socket connected ns=${ASK_ROOM_NAMESPACE} userId=${userId}`,
    );
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.logger.debug(
      `[AskRoom] socket disconnected userId=${client.data.userId ?? "?"}`,
    );
  }

  @SubscribeMessage(ASK_ROOM_JOIN_EVENT_NAME)
  async onJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: AskRoomJoinPayload,
  ): Promise<AskRoomJoinAck> {
    const userId = client.data.userId;
    if (!userId) {
      return { ok: false, reason: "unauthenticated" };
    }
    if (!body?.sessionId) {
      return { ok: false, reason: "missing_sessionId" };
    }

    const session = await this.prisma.askSession.findFirst({
      where: { id: body.sessionId, userId },
    });
    if (!session) {
      return { ok: false, reason: "not_found_or_forbidden" };
    }

    await client.join(askRoomKey(body.sessionId));
    this.logger.debug(
      `[AskRoom] join ok user=${userId} session=${body.sessionId}`,
    );
    return { ok: true };
  }

  @SubscribeMessage(ASK_ROOM_CLIENT_EVENT_NAME)
  async onClientEvent(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() event: AskRoomClientEvent,
  ): Promise<void> {
    const userId = client.data.userId;
    if (!userId) return;

    if (event.kind === "turn.cancel") {
      const turn = await this.prisma.askRoomTurn.findUnique({
        where: { id: event.turnId },
      });
      if (!turn) return;
      // runtime.cancelTurn 内部 findUserRoom 会校验 userId 归属
      await this.runtime.cancelTurn(turn.sessionId, event.turnId, userId);
    }
    // turn.subscribe + partial-log 增量补差留 W5（评审 v3 follow-up F6）
  }

  /**
   * 公开方法供 controller / runtime 调用，把事件推到指定房间。
   * fire-and-forget；失败仅记录日志，不抛。
   *
   * 注：socket.io 的 server.to(room).emit() 仅广播给已 join 该 room 的连接；
   * onJoin 已校验 sessionId 归属，故无跨用户嗅探风险。
   *
   * 多实例部署：当前 emit 只能到达本实例已 join 的连接；
   * 多副本生产部署需用 socket.io-redis adapter（W5 follow-up）。
   */
  emitToRoom(room: string, event: AskRoomServerEvent): void {
    try {
      this.server.to(room).emit(ASK_ROOM_EVENT_NAME, event);
    } catch (err) {
      this.logger.warn(
        `[AskRoom] emit failed room=${room} kind=${event.kind}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private extractUserId(client: Socket): string | null {
    const auth = (client.handshake.auth ?? {}) as {
      token?: string;
      Authorization?: string;
    };
    const headerAuth = client.handshake.headers?.authorization;
    const token =
      auth.token ??
      auth.Authorization?.replace(/^Bearer\s+/i, "") ??
      (typeof headerAuth === "string"
        ? headerAuth.replace(/^Bearer\s+/i, "")
        : undefined);
    if (!token) return null;
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      return payload.sub ?? payload.id ?? payload.userId ?? null;
    } catch (err) {
      this.logger.debug(
        `[AskRoom] JWT verify failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
