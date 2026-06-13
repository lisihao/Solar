/**
 * WritingMissionGateway — mission-scoped Socket.IO gateway for writing.* events
 *
 * Bridges EventBus writing.* events → socket room writing:${missionId}.
 *
 * Mirrors AgentPlaygroundGateway pattern exactly:
 *   - afterInit() registers SocketBroadcastAdapter (io available at this point)
 *   - join / leave operate on missionId dimension (not projectId)
 *   - JWT auth via handshake.auth + Redis blocklist fail-open
 *   - ownership: in-memory cache miss → DB fallback (NotFoundException → null)
 *   - errorCode field distinguishes SERVICE_UNAVAILABLE vs MISSION_NOT_FOUND
 *
 * Namespace: /ai-writing-mission (distinct from legacy /ai-writing to allow parallel coexistence)
 * Room key:  writing:${missionId}
 * Adapter:   eventTypePrefix "writing.", roomPrefix "writing"
 *
 * Old gateway (ai-writing.gateway.ts, namespace /ai-writing, project-room) is
 * untouched — legacy pipeline remains fully functional.
 */

import {
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
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
  MissionOwnershipRegistry,
} from "@/modules/ai-harness/facade";
import { wsCorsOrigin } from "@/common/config/ws-cors";
import { CacheService } from "@/common/cache/cache.service";
import { BLOCKLIST_PREFIX } from "@/modules/platform/auth/strategies/jwt.strategy";
import { WritingMissionQueryService } from "../services/mission/writing-mission-query.service";

interface JwtPayload {
  sub?: string;
  id?: string;
  userId?: string;
}

@WebSocketGateway({
  namespace: "ai-writing-mission",
  cors: { origin: wsCorsOrigin, credentials: true },
})
export class WritingMissionGateway implements OnGatewayInit {
  @WebSocketServer() io!: Server;
  private readonly log = new Logger(WritingMissionGateway.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly ownership: MissionOwnershipRegistry,
    private readonly jwt: JwtService,
    private readonly missionQuery: WritingMissionQueryService,
    private readonly cache: CacheService,
  ) {}

  afterInit(): void {
    // Must register in afterInit — io is undefined in onModuleInit
    this.eventBus.registerAdapter(
      new SocketBroadcastAdapter(this.io, {
        id: "writing.socket",
        eventTypePrefix: "writing.",
        roomPrefix: "writing",
      }),
    );
    this.log.log(
      "WritingMissionGateway initialized (namespace=ai-writing-mission)",
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

    // Ownership check: in-memory cache → DB fallback
    let owner = this.ownership.getOwner(payload.missionId);
    if (!owner) {
      let found = false;
      let dbErrored = false;
      try {
        // getMissionStatus throws NotFoundException when not found or wrong owner
        await this.missionQuery.getMissionStatus(payload.missionId, userId);
        found = true;
      } catch (err) {
        if (err instanceof NotFoundException) {
          found = false;
        } else {
          dbErrored = true;
          this.log.warn(
            `gateway DB fallback failed for mission=${payload.missionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (dbErrored) {
        return {
          ok: false,
          error: "service temporarily unavailable",
          errorCode: "SERVICE_UNAVAILABLE",
          retryAfterMs: 5000,
        };
      }
      if (!found) {
        return {
          ok: false,
          error: "mission not found",
          errorCode: "MISSION_NOT_FOUND",
        };
      }
      // DB confirmed ownership — register in-memory for subsequent hot-path lookups
      this.ownership.assign(payload.missionId, userId);
      owner = userId;
    }

    if (owner !== userId) {
      this.log.warn(
        `client ${client.id} (user=${userId}) tried to join mission=${payload.missionId} owned by ${owner}`,
      );
      return { ok: false, error: "forbidden" };
    }

    // socket.join is async — must await so room membership is effective immediately
    await client.join(`writing:${payload.missionId}`);
    this.log.debug(`client ${client.id} joined writing:${payload.missionId}`);
    return { ok: true };
  }

  @SubscribeMessage("leave")
  async handleLeave(
    client: Socket,
    payload: { missionId: string },
  ): Promise<{ ok: boolean }> {
    if (!payload?.missionId) return { ok: false };
    await client.leave(`writing:${payload.missionId}`);
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

    let jwtPayload: JwtPayload;
    try {
      jwtPayload = this.jwt.verify<JwtPayload>(authToken);
    } catch {
      throw new UnauthorizedException("invalid token");
    }

    const userId = jwtPayload.sub ?? jwtPayload.id ?? jwtPayload.userId;
    if (!userId) throw new UnauthorizedException("no user in token");

    // Redis blocklist check — fail-open on cache error (mirrors playground pattern)
    let isBlocked: string | undefined | null = null;
    try {
      isBlocked = await this.cache.get<string>(`${BLOCKLIST_PREFIX}${userId}`);
    } catch (err) {
      this.log.warn(
        `[ws-auth] blocklist check failed for user=${userId} — fail-open: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (isBlocked) throw new UnauthorizedException("User account is disabled");
    return userId;
  }
}
