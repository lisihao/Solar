/**
 * SocialGateway — Socket.IO 入口
 *
 * 让前端订阅 social.* mission 事件流：
 *   - afterInit: 注册 SocketBroadcastAdapter 到 EventBus（io 此时已绑定）
 *   - @SubscribeMessage('join'): JWT 鉴权 + ownership 校验 + socket.join(room)
 *
 * Mirror of playground/playground.gateway.ts，区别：
 *   - namespace="social"，roomPrefix="social"
 *   - ownership 走 SocialMissionStore.getOwner（in-memory record）
 *   - 暂不接 MissionOwnershipRegistry（社交 mission record 本身就承载 ownership）
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
import { SocialMissionStore } from "../mission/lifecycle/social-mission-store.service";
import { wsCorsOrigin } from "@/common/config/ws-cors";

interface JwtPayload {
  sub?: string;
  id?: string;
  userId?: string;
}

@WebSocketGateway({
  namespace: "social",
  cors: { origin: wsCorsOrigin, credentials: true },
})
export class SocialGateway implements OnGatewayInit {
  @WebSocketServer() io!: Server;
  private readonly log = new Logger(SocialGateway.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly store: SocialMissionStore,
    private readonly jwt: JwtService,
  ) {}

  afterInit(): void {
    this.eventBus.registerAdapter(
      new SocketBroadcastAdapter(this.io, {
        id: "social.socket",
        eventTypePrefix: "social.",
        roomPrefix: "social",
      }),
    );
    this.log.log("SocialGateway initialized (namespace=social)");
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
    const owner = await this.store.getOwner(payload.missionId);
    if (!owner) {
      return {
        ok: false,
        error: "mission not found",
        errorCode: "MISSION_NOT_FOUND",
      };
    }
    if (owner !== userId) {
      this.log.warn(
        `client ${client.id} (user=${userId}) tried to join mission=${payload.missionId} owned by ${owner}`,
      );
      return { ok: false, error: "forbidden" };
    }
    await client.join(`social:${payload.missionId}`);
    this.log.debug(`client ${client.id} joined social:${payload.missionId}`);
    return { ok: true };
  }

  @SubscribeMessage("leave")
  async handleLeave(
    client: Socket,
    payload: { missionId: string },
  ): Promise<{ ok: boolean }> {
    if (!payload?.missionId) return { ok: false };
    await client.leave(`social:${payload.missionId}`);
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
