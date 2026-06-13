/**
 * Topic Research WebSocket Gateway
 *
 * 参考 AI Writing Gateway 设计
 * 提供实时推送能力，支持：
 * - Leader 思考过程实时推送
 * - 任务状态实时推送
 * - Agent 工作状态广播
 * - 研究进度更新
 *
 * ★ Security: JWT 认证已启用
 * - 连接时验证 JWT token
 * - 加入房间时验证 topic 访问权限
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Logger, Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { ResearchMissionStatus } from "@prisma/client";
import { ResearchEventEmitterService } from "./services";
import { RESEARCH_INTERNAL_EVENTS } from "./services/core/research/research-event-emitter.service";
import type { LatencySessionSummary } from "@/modules/ai-harness/facade";
import { PrismaService } from "../../../common/prisma/prisma.service";
import {
  createSecurityLogger,
  SecurityEventType,
} from "./utils/security-audit-logger";

// ==================== Rate Limiting ====================

/**
 * ★ Security: Per-user event rate limiter for WebSocket messages
 *
 * HTTP 层有全局 ThrottlerGuard，但 WebSocket 事件不受其保护。
 * 此限制器为每个用户维护滑动窗口计数器，防止事件刷屏。
 */
class WsRateLimiter {
  /** userId -> { timestamps[] } */
  private readonly windows = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 30, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if the user is allowed to proceed. Returns true if allowed.
   */
  allow(userId: string): boolean {
    const now = Date.now();
    let timestamps = this.windows.get(userId);

    if (!timestamps) {
      timestamps = [];
      this.windows.set(userId, timestamps);
    }

    // Evict expired entries
    const cutoff = now - this.windowMs;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxRequests) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /**
   * Clean up data for disconnected users
   */
  cleanup(userId: string): void {
    this.windows.delete(userId);
  }
}

// ==================== Types ====================

/**
 * ★ Security: Authenticated user data stored in socket
 */
interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
}

/**
 * ★ Security: Extended Socket with user data
 */
interface AuthenticatedSocket extends Socket {
  data: {
    user?: AuthenticatedUser;
    authenticatedAt?: Date;
  };
}

/**
 * Phase 5: Sync request payload from client
 */
interface SyncRequestPayload {
  topicId: string;
  lastKnownPhase?: string;
  lastKnownProgress?: number;
}

/**
 * Phase 5: Sync response to client
 */
interface SyncResponse {
  success: boolean;
  needsRecovery: boolean;
  currentState: {
    phase: ResearchPhase;
    progress: number;
    message: string;
    missionId?: string;
    lastActivityAt?: string;
  } | null;
  error?: string;
}

/**
 * Research phase for client display
 */
type ResearchPhase =
  | "idle"
  | "planning"
  | "plan_ready"
  | "researching"
  | "analyzing"
  | "synthesizing"
  | "completed"
  | "failed"
  | "recovering";

/**
 * ★ Security: CORS 白名单构建
 * 生产环境使用 CORS_ORIGINS + RAILWAY_FRONTEND_URL 精确域名匹配
 * 开发环境额外允许 localhost
 */
const buildWsCorsAllowedOrigins = (): Set<string> => {
  const origins = new Set<string>();
  const corsEnv = process.env.CORS_ORIGINS;
  if (corsEnv) {
    corsEnv
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
      .forEach((o) => origins.add(o));
  }
  const railwayFrontend = process.env.RAILWAY_FRONTEND_URL;
  if (railwayFrontend) {
    origins.add(railwayFrontend);
  }
  return origins;
};

const wsAllowedOrigins = buildWsCorsAllowedOrigins();
const wsIsDev = process.env.NODE_ENV !== "production";

@Injectable()
@WebSocketGateway({
  namespace: "/topic-insights",
  cors: {
    origin: (
      origin: string,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // 无 Origin（服务端调用、健康检查）始终放行
      if (!origin) {
        callback(null, true);
        return;
      }

      // 开发环境允许 localhost
      const isLocalhost =
        wsIsDev &&
        (/^http:\/\/localhost:\d+$/.test(origin) ||
          /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));

      // 生产环境：精确匹配 CORS_ORIGINS + RAILWAY_FRONTEND_URL
      const isAllowed = wsAllowedOrigins.has(origin);

      if (isLocalhost || isAllowed) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  },
})
export class TopicInsightsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TopicInsightsGateway.name);
  private readonly securityLogger = createSecurityLogger("WebSocketGateway");
  private readonly jwtSecret: string;

  // ★ 修复：限制每个用户的 WebSocket 连接数
  private readonly userConnections = new Map<string, Set<string>>(); // userId -> Set<socketId>
  private readonly MAX_CONNECTIONS_PER_USER = 5;

  // ★ Security: 事件级速率限制（30 请求/分钟/用户）
  private readonly rateLimiter = new WsRateLimiter(30, 60_000);

  constructor(
    private readonly eventEmitter: ResearchEventEmitterService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    // ★ Security: Get JWT secret for token verification
    const secret = configService.get<string>("JWT_SECRET");
    if (!secret) {
      throw new Error("JWT_SECRET is required for WebSocket authentication");
    }
    this.jwtSecret = secret;
  }

  afterInit() {
    this.logger.log("Topic Research WebSocket Gateway initialized");

    // ★ Security: Socket.IO 中间件认证
    // 在 connection 事件之前完成 JWT 验证和用户信息填充
    // 确保所有 @SubscribeMessage 处理器执行时 client.data.user 已可用
    this.server.use(async (socket: AuthenticatedSocket, next) => {
      const clientIp = socket.handshake.address;
      try {
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace("Bearer ", "");

        if (!token) {
          this.securityLogger.logAuthEvent({
            eventType: SecurityEventType.AUTH_FAILURE,
            clientIp,
            action: "WebSocket connection - no token",
            outcome: "FAILURE",
          });
          return next(new Error("Authentication required"));
        }

        const payload = await this.verifyToken(token);
        if (!payload) {
          this.securityLogger.logAuthEvent({
            eventType: SecurityEventType.TOKEN_INVALID,
            clientIp,
            action: "WebSocket connection - invalid token",
            outcome: "FAILURE",
          });
          return next(new Error("Invalid token"));
        }

        const dbUser = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, email: true, username: true },
        });

        if (!dbUser?.email) {
          this.securityLogger.logAuthEvent({
            eventType: SecurityEventType.AUTH_FAILURE,
            userId: payload.sub,
            clientIp,
            action: "WebSocket connection - user not found",
            outcome: "FAILURE",
          });
          return next(new Error("User not found"));
        }

        // ★ 在中间件中设置用户信息，handleConnection 无需重复验证
        socket.data.user = {
          id: dbUser.id,
          email: dbUser.email,
          username: dbUser.username || dbUser.email,
        };
        next();
      } catch (err) {
        this.logger.warn(
          `[middleware] Auth error: ${err instanceof Error ? err.message : String(err)}`,
        );
        next(new Error("Authentication failed"));
      }
    });

    // 注册事件发射处理器
    this.eventEmitter.registerEmitHandler(
      async (topicId: string, event: string, data: unknown) => {
        await this.emitToTopic(topicId, event, data);
      },
    );
  }

  /**
   * ★ 连接后处理（认证已在中间件完成）
   * 仅处理连接数限制和日志
   */
  async handleConnection(client: AuthenticatedSocket) {
    const clientIp = client.handshake.address;

    try {
      // 用户信息已在中间件中设置到 client.data.user
      const user = client.data.user;
      if (!user) {
        // 理论上不会到这里（中间件会拒绝），但作为防御性检查
        client.disconnect(true);
        return;
      }

      // 4. 存储用户信息到 socket（连接数限制逻辑）
      client.data.authenticatedAt = new Date();

      // ★ 修复：检查并限制用户连接数
      if (!this.userConnections.has(user.id)) {
        this.userConnections.set(user.id, new Set());
      }
      const userSockets = this.userConnections.get(user.id)!;

      if (userSockets.size >= this.MAX_CONNECTIONS_PER_USER) {
        // 断开最旧的连接
        const oldestSocketId = Array.from(userSockets)[0];
        const oldestSocket = this.server.sockets.sockets.get(oldestSocketId);
        if (oldestSocket) {
          this.logger.warn(
            `User ${user.id} exceeded max connections (${this.MAX_CONNECTIONS_PER_USER}), disconnecting oldest: ${oldestSocketId}`,
          );
          oldestSocket.emit("connection:replaced", {
            message: "Connection replaced by new session",
          });
          oldestSocket.disconnect(true);
        }
        userSockets.delete(oldestSocketId);
      }

      userSockets.add(client.id);

      this.logger.log(
        `Client ${client.id} authenticated as ${user.username} (${user.id}), connections: ${userSockets.size}/${this.MAX_CONNECTIONS_PER_USER}`,
      );

      // ★ Security: 记录认证成功
      this.securityLogger.logAuthEvent({
        eventType: SecurityEventType.AUTH_SUCCESS,
        userId: user.id,
        clientIp,
        action: "WebSocket connection",
        outcome: "SUCCESS",
      });
    } catch (error) {
      this.logger.error(`Connection setup error for ${client.id}:`, error);
      client.disconnect(true);
    }
  }

  /**
   * ★ Security: 验证 JWT token
   */
  private async verifyToken(
    token: string,
  ): Promise<{ sub: string; email: string } | null> {
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.jwtSecret,
      });
      return payload;
    } catch {
      return null;
    }
  }

  handleDisconnect(client: Socket) {
    // ★ 修复：清理用户连接计数 + 速率限制器
    const authClient = client as AuthenticatedSocket;
    const userId = authClient.data?.user?.id;
    if (userId) {
      const userSockets = this.userConnections.get(userId);
      if (userSockets) {
        userSockets.delete(client.id);
        if (userSockets.size === 0) {
          this.userConnections.delete(userId);
          this.rateLimiter.cleanup(userId);
        }
      }
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * 客户端加入专题房间
   *
   * ★ Security: 验证用户是否有权访问该 topic
   */
  @SubscribeMessage("join:topic")
  async handleJoinTopic(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { topicId: string },
  ): Promise<{ success: boolean; room?: string; error?: string }> {
    // ★ Security: 检查用户是否已认证
    const user = client.data.user;
    if (!user) {
      this.logger.warn(
        `Unauthenticated client ${client.id} tried to join topic`,
      );
      return { success: false, error: "Authentication required" };
    }

    // ★ Security: 事件级速率限制
    if (!this.rateLimiter.allow(user.id)) {
      this.logger.warn(`Rate limit exceeded for user ${user.id} on join:topic`);
      return { success: false, error: "Rate limit exceeded" };
    }

    // ★ Security: 验证 topic 访问权限（所有者 + 协作者 + 公开专题）
    try {
      const topic = await this.prisma.researchTopic.findUnique({
        where: { id: data.topicId },
        select: { id: true, userId: true, visibility: true },
      });

      if (!topic) {
        this.logger.warn(`Topic ${data.topicId} not found`);
        return { success: false, error: "Topic not found" };
      }

      // 检查访问权限：所有者 / 公开专题 / 活跃协作者
      if (topic.userId !== user.id) {
        const isPublic = topic.visibility === "PUBLIC";
        const isCollaborator =
          topic.visibility === "SHARED" &&
          (await this.prisma.topicCollaborator.count({
            where: {
              topicId: data.topicId,
              userId: user.id,
              isActive: true,
            },
          })) > 0;

        if (!isPublic && !isCollaborator) {
          this.logger.warn(
            `User ${user.id} tried to access topic ${data.topicId} owned by ${topic.userId}`,
          );
          return { success: false, error: "Access denied" };
        }
      }

      const roomName = `research:${data.topicId}`;
      await client.join(roomName);
      this.logger.log(
        `Client ${client.id} (${user.username}) joined room ${roomName}`,
      );
      return { success: true, room: roomName };
    } catch (error) {
      this.logger.error(
        `Failed to join topic ${data.topicId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { success: false, error: "Internal error" };
    }
  }

  /**
   * 客户端离开专题房间
   */
  @SubscribeMessage("leave:topic")
  async handleLeaveTopic(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { topicId: string },
  ) {
    // ★ Security: 事件级速率限制
    const leaveUser = client.data.user;
    if (leaveUser && !this.rateLimiter.allow(leaveUser.id)) {
      this.logger.warn(
        `Rate limit exceeded for user ${leaveUser.id} on leave:topic`,
      );
      return { success: false, error: "Rate limit exceeded" };
    }

    try {
      const roomName = `research:${data.topicId}`;
      await client.leave(roomName);
      const username = client.data.user?.username || "unknown";
      this.logger.log(
        `Client ${client.id} (${username}) left room ${roomName}`,
      );
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to handle leave:topic: ${error}`);
      client.emit("error", { message: "Operation failed" });
      return { success: false };
    }
  }

  /**
   * 向专题房间广播事件
   */
  async emitToTopic(topicId: string, event: string, data: unknown) {
    const roomName = `research:${topicId}`;
    const sockets = await this.server.in(roomName).fetchSockets();

    if (sockets.length > 0) {
      this.server.to(roomName).emit(event, data);
      this.logger.debug(
        `Emitted ${event} to room ${roomName} (${sockets.length} clients)`,
      );
    }
  }

  // ==================== Phase 5: State Sync ====================

  /**
   * ★ Phase 5: 处理客户端状态同步请求
   *
   * 场景：
   * - 页面刷新后恢复状态
   * - 网络断开重连后同步
   * - 客户端检测到状态不一致时
   */
  @SubscribeMessage("sync:request")
  async handleSyncRequest(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: SyncRequestPayload,
  ): Promise<SyncResponse> {
    const { topicId, lastKnownPhase, lastKnownProgress } = data;

    // ★ Security: 检查用户是否已认证
    const user = client.data.user;
    if (!user) {
      return {
        success: false,
        needsRecovery: false,
        currentState: null,
        error: "Authentication required",
      };
    }

    // ★ Security: 事件级速率限制
    if (!this.rateLimiter.allow(user.id)) {
      this.logger.warn(
        `Rate limit exceeded for user ${user.id} on sync:request`,
      );
      return {
        success: false,
        needsRecovery: false,
        currentState: null,
        error: "Rate limit exceeded",
      };
    }

    this.logger.log(
      `Client ${client.id} (${user.username}) requesting sync for topic ${topicId}`,
    );

    try {
      // ★ Security: 验证 topic 访问权限（所有者 + 协作者 + 公开专题）
      const topic = await this.prisma.researchTopic.findUnique({
        where: { id: topicId },
        select: { userId: true, visibility: true },
      });

      if (!topic) {
        return {
          success: false,
          needsRecovery: false,
          currentState: null,
          error: "Access denied",
        };
      }

      if (topic.userId !== user.id) {
        const isPublic = topic.visibility === "PUBLIC";
        const isCollaborator =
          topic.visibility === "SHARED" &&
          (await this.prisma.topicCollaborator.count({
            where: { topicId, userId: user.id, isActive: true },
          })) > 0;

        if (!isPublic && !isCollaborator) {
          return {
            success: false,
            needsRecovery: false,
            currentState: null,
            error: "Access denied",
          };
        }
      }

      // 1. 查询当前 Mission 状态
      const mission = await this.prisma.researchMission.findFirst({
        where: { topicId },
        orderBy: { createdAt: "desc" },
        include: {
          tasks: {
            orderBy: { updatedAt: "desc" },
            take: 5,
          },
        },
      });

      // 2. 如果没有 Mission，返回 idle 状态
      if (!mission) {
        return {
          success: true,
          needsRecovery: false,
          currentState: {
            phase: "idle",
            progress: 0,
            message: "等待开始研究",
          },
        };
      }

      // 3. 检查是否需要恢复
      const needsRecovery = this.checkIfNeedsRecovery(
        mission,
        lastKnownPhase,
        lastKnownProgress,
      );

      // 4. 构建当前状态
      const currentPhase = this.mapStatusToPhase(mission.status);
      const currentMessage = this.buildCurrentMessage(mission, currentPhase);

      const response: SyncResponse = {
        success: true,
        needsRecovery,
        currentState: {
          phase: currentPhase,
          progress: mission.progressPercent,
          message: currentMessage,
          missionId: mission.id,
          lastActivityAt: mission.updatedAt.toISOString(),
        },
      };

      this.logger.log(
        `Sync response for ${topicId}: phase=${currentPhase}, ` +
          `progress=${mission.progressPercent}%, needsRecovery=${needsRecovery}`,
      );

      return response;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Sync request failed for topic ${topicId}: ${errorMessage}`,
      );

      return {
        success: false,
        needsRecovery: false,
        currentState: null,
        error: "Internal error",
      };
    }
  }

  /**
   * 检查是否需要恢复（状态不一致检测）
   */
  private checkIfNeedsRecovery(
    mission: {
      status: ResearchMissionStatus;
      progressPercent: number;
      updatedAt: Date;
    },
    lastKnownPhase?: string,
    lastKnownProgress?: number,
  ): boolean {
    // 如果客户端没有上次状态，不需要恢复
    if (!lastKnownPhase) return false;

    const currentPhase = this.mapStatusToPhase(mission.status);

    // 阶段不一致
    if (lastKnownPhase !== currentPhase) {
      this.logger.debug(
        `Phase mismatch: client=${lastKnownPhase}, server=${currentPhase}`,
      );
      return true;
    }

    // 进度差异超过 10%（可能错过了更新）
    if (
      lastKnownProgress !== undefined &&
      Math.abs(mission.progressPercent - lastKnownProgress) > 10
    ) {
      this.logger.debug(
        `Progress mismatch: client=${lastKnownProgress}%, server=${mission.progressPercent}%`,
      );
      return true;
    }

    // 任务超过 5 分钟没有更新（可能中断了）
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (
      mission.status === ResearchMissionStatus.EXECUTING &&
      mission.updatedAt.getTime() < fiveMinutesAgo
    ) {
      this.logger.debug("Mission appears stale, may need recovery");
      return true;
    }

    return false;
  }

  /**
   * 将数据库状态映射到客户端阶段
   */
  private mapStatusToPhase(status: ResearchMissionStatus): ResearchPhase {
    switch (status) {
      case ResearchMissionStatus.PLANNING:
        return "planning";
      case ResearchMissionStatus.PLAN_READY:
        return "plan_ready";
      case ResearchMissionStatus.EXECUTING:
        return "researching";
      case ResearchMissionStatus.REVIEWING:
        return "synthesizing";
      case ResearchMissionStatus.COMPLETED:
        return "completed";
      case ResearchMissionStatus.FAILED:
        return "failed";
      case ResearchMissionStatus.CANCELLED:
        return "idle";
      default:
        return "idle";
    }
  }

  /**
   * 构建当前状态消息
   */
  private buildCurrentMessage(
    mission: {
      status: ResearchMissionStatus;
      progressPercent: number;
      tasks?: Array<{ status: string }>;
    },
    phase: ResearchPhase,
  ): string {
    switch (phase) {
      case "planning":
        return "正在规划研究方案...";
      case "researching":
        return `正在进行研究 (${mission.progressPercent}%)`;
      case "analyzing":
        return "正在分析研究结果...";
      case "synthesizing":
        return "正在生成研究报告...";
      case "completed":
        return "研究已完成";
      case "failed":
        return "研究任务失败";
      case "recovering":
        return "系统正在恢复中断的任务...";
      default:
        return "等待开始研究";
    }
  }

  // ==================== Latency Tracking Events ====================

  /**
   * ★ 监听时延跟踪会话完成事件，广播到 WebSocket 客户端
   */
  @OnEvent(RESEARCH_INTERNAL_EVENTS.LATENCY_SESSION_COMPLETED)
  async handleLatencySessionCompleted(payload: {
    topicId: string;
    reportId: string;
    summary: LatencySessionSummary;
  }): Promise<void> {
    try {
      await this.emitToTopic(
        payload.topicId,
        "latency:session:completed",
        payload,
      );
    } catch (err) {
      this.logger.warn(
        `[Latency] Failed to emit session completed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
