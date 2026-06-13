/**
 * AskSelfDrivenGateway — WebSocket `self-driven` namespace.
 *
 * Live channel for the durable self-driven mission stream. Mirrors the
 * playground gateway: JWT handshake, ownership-checked room join
 * (`self-driven:{missionId}`), and a SocketBroadcastAdapter registered in
 * afterInit (NOT onModuleInit — `io` is unbound there) that fans every
 * `self-driven.*` EventBus event to the mission room.
 *
 * Consistency: same JWT/CORS shape as the in-module AskRoomGateway.
 */

import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { APP_CONFIG } from "@/common/config/app.config";
import {
  EventBus,
  MissionOwnershipRegistry,
  SocketBroadcastAdapter,
} from "@/modules/ai-harness/facade";
import { AskSelfDrivenMissionStore } from "./ask-self-driven-mission.store";

export const SELF_DRIVEN_NAMESPACE = "self-driven";

interface JwtPayload {
  sub?: string;
  id?: string;
  userId?: string;
}

interface AuthenticatedSocket extends Socket {
  data: { userId?: string };
}

const selfDrivenWsAllowedOrigins = (() => {
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
})();
const selfDrivenWsIsDev = process.env.NODE_ENV !== "production";

const selfDrivenWsCorsOrigin = (
  origin: string,
  callback: (err: Error | null, allow?: boolean) => void,
): void => {
  if (!origin) return callback(null, true);
  const isLocalhost =
    selfDrivenWsIsDev &&
    (/^http:\/\/localhost:\d+$/.test(origin) ||
      /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
  callback(null, isLocalhost || selfDrivenWsAllowedOrigins.has(origin));
};

@Injectable()
@WebSocketGateway({
  namespace: SELF_DRIVEN_NAMESPACE,
  cors: { origin: selfDrivenWsCorsOrigin, credentials: true },
  transports: ["websocket", "polling"],
})
export class AskSelfDrivenGateway
  implements OnGatewayInit, OnGatewayConnection
{
  private readonly logger = new Logger(AskSelfDrivenGateway.name);

  @WebSocketServer()
  private readonly io!: Server;

  constructor(
    private readonly eventBus: EventBus,
    private readonly ownership: MissionOwnershipRegistry,
    private readonly jwt: JwtService,
    private readonly store: AskSelfDrivenMissionStore,
  ) {}

  afterInit(): void {
    // io is bound here (not in onModuleInit). Fan self-driven.* events to rooms.
    this.eventBus.registerAdapter(
      new SocketBroadcastAdapter(this.io, {
        id: "self-driven.socket",
        eventTypePrefix: "self-driven.",
        roomPrefix: SELF_DRIVEN_NAMESPACE,
      }),
    );
    this.logger.log(
      `AskSelfDrivenGateway initialized (namespace=${SELF_DRIVEN_NAMESPACE})`,
    );
  }

  handleConnection(client: AuthenticatedSocket): void {
    const userId = this.extractUserId(client);
    if (userId) client.data.userId = userId;
  }

  @SubscribeMessage("join")
  async handleJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { missionId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const userId = client.data.userId ?? this.extractUserId(client);
    if (!userId) return { ok: false, error: "unauthenticated" };
    if (!payload?.missionId) return { ok: false, error: "missionId required" };

    // Ownership: in-memory hot path, DB fallback after pod recycle.
    let owner = this.ownership.getOwner(payload.missionId);
    if (!owner) {
      owner = (await this.store.getOwnerById(payload.missionId)) ?? undefined;
      if (owner) this.ownership.assign(payload.missionId, owner);
    }
    if (!owner) return { ok: false, error: "mission not found" };
    if (owner !== userId) return { ok: false, error: "forbidden" };

    await client.join(`${SELF_DRIVEN_NAMESPACE}:${payload.missionId}`);
    return { ok: true };
  }

  private extractUserId(client: Socket): string | undefined {
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
    if (!token) return undefined;
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      return payload.sub ?? payload.id ?? payload.userId ?? undefined;
    } catch {
      throw new UnauthorizedException("invalid token");
    }
  }
}
