import { Logger, OnModuleDestroy } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
} from "@nestjs/websockets";
import { OnEvent } from "@nestjs/event-emitter";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { Server, Socket } from "socket.io";
import { JwtService } from "@nestjs/jwt";
import { wsCorsOrigin } from "@/common/config/ws-cors";

interface JwtPayload {
  sub?: string;
  id?: string;
  userId?: string;
}

interface NotificationCreatedEvent {
  notificationId?: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  /** quiet hours 窗口内为 true — 前端应只更新 badge，不弹 toast */
  silent?: boolean;
  /** 内部重试计数（0-based），外部调用者不需要设置 */
  _retryCount?: number;
}

interface NotificationBroadcastEvent {
  type: string;
  title: string;
  message: string;
  sentCount?: number;
}

/**
 * NotificationGateway —— 通知系统 Socket.IO 入口
 *
 * 职责：
 *   - 监听 NotificationService 发出的 `notification.created` (单用户) /
 *     `notification.broadcast` (admin 广播) EventEmitter2 事件
 *   - 把单用户事件推到 `user:${userId}` 房间；广播事件用 io.emit 全频道
 *
 * 房间模型：
 *   - 每个连接握手时 join 自己的 user 房间，名字 `user:${userId}`
 *   - 不需 ownership registry —— 用户只看自己
 *
 * 失败模式：
 *   - JWT 校验失败 → disconnect
 *   - emit 失败 → logger.warn，不抛错（拉模式兜底，下次刷新仍能拿到通知）
 *
 * 与 ai-harness EventBus 的关系：
 *   - 不复用 SocketBroadcastAdapter（它走 mission/topic scope 房间）
 *   - 通知是 user-scope，独立 namespace + 独立房间策略
 */
@WebSocketGateway({
  namespace: "notifications",
  cors: { origin: wsCorsOrigin, credentials: true },
})
export class NotificationGateway
  implements OnGatewayConnection, OnModuleDestroy
{
  @WebSocketServer() io!: Server;
  private readonly log = new Logger(NotificationGateway.name);

  private static readonly MAX_EMIT_RETRIES = 3;
  private static readonly RETRY_DELAY_MS = 2000;

  /** 追踪所有 in-flight retry timers，模块销毁时统一清理 */
  private readonly retryTimers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly jwt: JwtService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleDestroy(): void {
    for (const timer of this.retryTimers) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
  }

  async handleConnection(client: Socket): Promise<void> {
    let userId: string;
    try {
      userId = this.extractUserId(client);
    } catch (err) {
      this.log.debug(
        `Rejecting notification socket: ${err instanceof Error ? err.message : "auth failed"}`,
      );
      client.disconnect(true);
      return;
    }

    await client.join(`user:${userId}`);
    // 缓存到 socket 数据，便于断连诊断
    client.data.userId = userId;
  }

  @OnEvent("notification.created")
  handleNotificationCreated(event: NotificationCreatedEvent): void {
    if (!this.io || !event?.userId) return;
    const retryCount = event._retryCount ?? 0;
    try {
      this.io.to(`user:${event.userId}`).emit("notification:new", {
        notificationId: event.notificationId,
        userId: event.userId,
        type: event.type,
        title: event.title,
        message: event.message,
        silent: event.silent === true,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (retryCount < NotificationGateway.MAX_EMIT_RETRIES) {
        this.log.warn(
          `Failed to push notification:new for user=${event.userId} (attempt ${retryCount + 1}/${NotificationGateway.MAX_EMIT_RETRIES}): ${errMsg} — scheduling retry`,
        );
        const timer = setTimeout(() => {
          this.retryTimers.delete(timer);
          this.eventEmitter.emit("notification.created", {
            ...event,
            _retryCount: retryCount + 1,
          });
        }, NotificationGateway.RETRY_DELAY_MS);
        this.retryTimers.add(timer);
      } else {
        this.log.warn(
          `Gave up pushing notification:new for user=${event.userId} after ${NotificationGateway.MAX_EMIT_RETRIES} attempts: ${errMsg}. Notification persisted in DB; client will receive on next poll/reconnect.`,
        );
      }
    }
  }

  @OnEvent("notification.broadcast")
  handleBroadcast(event: NotificationBroadcastEvent): void {
    if (!this.io) return;
    try {
      this.io.emit("notification:broadcast", {
        type: event.type,
        title: event.title,
        message: event.message,
        sentCount: event.sentCount,
      });
    } catch (err) {
      this.log.warn(
        `Failed to broadcast notification: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private extractUserId(client: Socket): string {
    const auth = client.handshake.auth as {
      token?: string;
      Authorization?: string;
    };
    const authToken =
      auth?.token ?? auth?.Authorization?.replace(/^Bearer\s+/i, "");
    if (!authToken) throw new Error("no auth token");
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(authToken);
    } catch {
      throw new Error("invalid token");
    }
    const userId = payload.sub ?? payload.id ?? payload.userId;
    if (!userId) throw new Error("no user in token");
    return userId;
  }
}
