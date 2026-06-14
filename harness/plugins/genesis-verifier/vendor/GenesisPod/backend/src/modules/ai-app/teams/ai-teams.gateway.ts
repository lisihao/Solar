import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Logger, Inject, forwardRef } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AiTeamsService } from "./ai-teams.service";
import { SendMessageDto } from "./dto";
import { TopicEventEmitterService } from "./services/events";
import { APP_CONFIG } from "../../../common/config/app.config";

interface AuthenticatedSocket extends Socket {
  userId?: string;
  currentTopicId?: string;
}

interface JwtPayload {
  sub?: string;
  id?: string;
  userId?: string;
}

@WebSocketGateway({
  namespace: "/ai-teams",
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      APP_CONFIG.railway.frontendUrl,
      APP_CONFIG.railway.backendUrl,
      ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
    ].filter(Boolean),
    credentials: true,
  },
  // 增加最大消息大小限制，支持大型图片数据 (默认1MB，增加到10MB)
  maxHttpBufferSize: 10 * 1024 * 1024,
  // 代理环境兼容性配置
  transports: ["websocket", "polling"], // 支持 websocket 和 polling
  allowEIO3: true, // 兼容 Engine.IO v3 客户端
  pingTimeout: 60000, // 增加 ping 超时时间（代理环境下可能需要更长）
  pingInterval: 25000, // ping 间隔
})
export class AiTeamsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server!: Server;

  private logger = new Logger("AiTeamsGateway");
  private userSockets = new Map<string, Set<string>>(); // userId -> Set<socketId>
  private socketUsers = new Map<string, string>(); // socketId -> userId

  constructor(
    @Inject(forwardRef(() => AiTeamsService))
    private readonly aiGroupService: AiTeamsService,
    private readonly topicEventEmitter: TopicEventEmitterService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * BLK-7：从握手 JWT 解出 userId（不信任客户端传的 auth.userId / query.userId，
   * 否则任意客户端可伪造 userId 加入他人 topic）。
   */
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
        `JWT verify failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  afterInit() {
    // Register the emit handler with TopicEventEmitterService
    // This breaks the circular dependency by deferring the registration
    this.topicEventEmitter.registerEmitHandler(
      async (topicId: string, event: string, data: unknown) => {
        await this.emitToTopic(topicId, event, data);
      },
    );
    this.logger.log("AiTeamsGateway initialized and emit handler registered");
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      // BLK-7：从握手 JWT 解出 userId，不信任客户端传的 auth.userId / query.userId
      const userId = this.extractUserId(client);

      if (!userId) {
        this.logger.warn(`Connection rejected: missing/invalid JWT`);
        client.disconnect();
        return;
      }

      client.userId = userId;
      this.socketUsers.set(client.id, userId);

      // 记录用户的socket连接
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)?.add(client.id);

      this.logger.debug(`Client connected: ${client.id}, userId: ${userId}`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Connection error: ${errorMessage}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const userId = this.socketUsers.get(client.id);
    if (userId) {
      this.userSockets.get(userId)?.delete(client.id);
      if (this.userSockets.get(userId)?.size === 0) {
        this.userSockets.delete(userId);
      }
    }
    this.socketUsers.delete(client.id);
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  // 加入Topic房间
  @SubscribeMessage("topic:join")
  async handleJoinTopic(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { topicId: string },
  ) {
    const { topicId } = data;
    const userId = client.userId;

    if (!userId) {
      return { error: "Not authenticated" };
    }

    try {
      // 验证用户是否有权限访问该Topic
      await this.aiGroupService.getTopicById(topicId, userId);

      // 离开之前的Topic房间
      if (client.currentTopicId) {
        await client.leave(`topic:${client.currentTopicId}`);
        // 通知之前房间的成员该用户离开
        this.server
          .to(`topic:${client.currentTopicId}`)
          .emit("member:offline", { userId });
      }

      // 加入新的Topic房间
      const roomName = `topic:${topicId}`;
      await client.join(roomName);
      client.currentTopicId = topicId;

      // 获取当前房间内的在线用户列表
      const onlineUsers = await this.getOnlineUsersInTopic(topicId);

      // 通知其他成员有人加入（使用 server.to 而不是 client.to，确保广播）
      this.server.to(roomName).emit("member:online", { userId });

      this.logger.debug(`User ${userId} joined topic ${topicId}`);

      // 返回成功状态和在线用户列表
      return { success: true, onlineUsers };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Join topic error: ${errorMessage}`);
      return { error: errorMessage };
    }
  }

  // 离开Topic房间
  @SubscribeMessage("topic:leave")
  async handleLeaveTopic(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { topicId: string },
  ) {
    const { topicId } = data;
    const userId = client.userId;

    if (client.currentTopicId === topicId) {
      await client.leave(`topic:${topicId}`);
      client.currentTopicId = undefined;

      // 通知其他成员有人离开
      client.to(`topic:${topicId}`).emit("member:offline", { userId });

      this.logger.debug(`User ${userId} left topic ${topicId}`);
    }

    return { success: true };
  }

  // 发送消息
  @SubscribeMessage("message:send")
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { topicId: string } & SendMessageDto,
  ) {
    const { topicId, ...messageDto } = data;
    const userId = client.userId;

    if (!userId) {
      return { error: "Not authenticated" };
    }

    try {
      const message = await this.aiGroupService.sendMessage(
        topicId,
        userId,
        messageDto,
      );

      // 广播消息给Topic内所有成员
      this.server.to(`topic:${topicId}`).emit("message:new", message);

      // 处理 mentions
      if (messageDto.mentions && messageDto.mentions.length > 0) {
        for (const mention of messageDto.mentions) {
          if (mention.mentionType === "AI" && mention.aiMemberId) {
            // @AI：通知正在输入并生成响应
            this.server.to(`topic:${topicId}`).emit("ai:typing", {
              topicId,
              aiMemberId: mention.aiMemberId,
            });

            // 生成AI响应（异步）
            void this.generateAndBroadcastAIResponse(
              topicId,
              userId,
              mention.aiMemberId,
            );
          } else if (mention.mentionType === "ALL_AI") {
            // @All AIs：通知所有AI正在输入并生成响应
            const topic = await this.aiGroupService.getTopicById(
              topicId,
              userId,
            );
            this.logger.log(
              `User ${userId} mentioned ALL AIs in topic ${topicId}, triggering ${topic.aiMembers.length} AI responses`,
            );

            // 遍历所有AI成员，为每个AI生成响应
            for (const aiMember of topic.aiMembers) {
              this.server.to(`topic:${topicId}`).emit("ai:typing", {
                topicId,
                aiMemberId: aiMember.id,
              });

              // 生成AI响应（异步）
              void this.generateAndBroadcastAIResponse(
                topicId,
                userId,
                aiMember.id,
              );
            }
          } else if (
            mention.mentionType === "USER" &&
            mention.userId &&
            message
          ) {
            // @真人用户：向被@用户发送通知（即使他们不在房间内）
            this.logger.log(
              `User ${userId} mentioned user ${mention.userId} in topic ${topicId}`,
            );
            this.emitToUser(mention.userId, "mention:new", {
              topicId,
              messageId: message.id,
              fromUserId: userId,
              content:
                message.content.length > 100
                  ? message.content.substring(0, 100) + "..."
                  : message.content,
              timestamp: message.createdAt,
            });
          }
        }
      }

      return { success: true, message };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Send message error: ${errorMessage}`);
      return { error: errorMessage };
    }
  }

  // 正在输入提示
  @SubscribeMessage("message:typing")
  async handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { topicId: string },
  ) {
    const { topicId } = data;
    const userId = client.userId;

    if (!userId) return;

    client.to(`topic:${topicId}`).emit("member:typing", { userId });
  }

  // 标记消息已读
  @SubscribeMessage("message:read")
  async handleReadMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { topicId: string; messageId: string },
  ) {
    const { topicId, messageId } = data;
    const userId = client.userId;

    if (!userId) {
      return { error: "Not authenticated" };
    }

    try {
      await this.aiGroupService.markAsRead(topicId, userId, messageId);
      return { success: true };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return { error: errorMessage };
    }
  }

  // 添加表情反应
  @SubscribeMessage("reaction:add")
  async handleAddReaction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { topicId: string; messageId: string; emoji: string },
  ) {
    const { topicId, messageId, emoji } = data;
    const userId = client.userId;

    if (!userId) {
      return { error: "Not authenticated" };
    }

    try {
      await this.aiGroupService.addReaction(topicId, userId, messageId, emoji);

      // 广播反应事件
      this.server.to(`topic:${topicId}`).emit("reaction:add", {
        messageId,
        userId,
        emoji,
      });

      return { success: true };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return { error: errorMessage };
    }
  }

  // 移除表情反应
  @SubscribeMessage("reaction:remove")
  async handleRemoveReaction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { topicId: string; messageId: string; emoji: string },
  ) {
    const { topicId, messageId, emoji } = data;
    const userId = client.userId;

    if (!userId) {
      return { error: "Not authenticated" };
    }

    try {
      await this.aiGroupService.removeReaction(
        topicId,
        userId,
        messageId,
        emoji,
      );

      // 广播反应移除事件
      this.server.to(`topic:${topicId}`).emit("reaction:remove", {
        messageId,
        userId,
        emoji,
      });

      return { success: true };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return { error: errorMessage };
    }
  }

  // ==================== Helper Methods ====================

  // 生成并广播AI响应
  private async generateAndBroadcastAIResponse(
    topicId: string,
    userId: string,
    aiMemberId: string,
  ) {
    try {
      const aiMessage = await this.aiGroupService.generateAIResponse(
        topicId,
        userId,
        aiMemberId,
        [],
      );

      // 广播AI响应完成（用于清除typing状态）
      this.server.to(`topic:${topicId}`).emit("ai:response", {
        aiMemberId,
        messageId: aiMessage.id,
      });

      // 广播新消息（用于显示消息）
      this.server.to(`topic:${topicId}`).emit("message:new", aiMessage);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`AI response error: ${errorMessage}`);
      this.server.to(`topic:${topicId}`).emit("ai:error", {
        aiMemberId,
        error: errorMessage,
      });
    }
  }

  // 广播消息给指定用户（跨房间）
  emitToUser(userId: string, event: string, data: unknown) {
    const socketIds = this.userSockets.get(userId);
    if (socketIds) {
      socketIds.forEach((socketId) => {
        this.server.to(socketId).emit(event, data);
      });
    }
  }

  // 广播消息给Topic内所有成员
  async emitToTopic(topicId: string, event: string, data: unknown) {
    const roomName = `topic:${topicId}`;
    // 心跳事件不输出日志（太频繁）
    const isHeartbeat = event === "mission:agent_working";
    if (!isHeartbeat) {
      // 只在非心跳事件时获取 socket 详情（避免性能开销）
      const sockets = await this.server.in(roomName).fetchSockets();
      if (sockets.length > 0) {
        this.logger.debug(
          `emitToTopic: room=${roomName}, event=${event}, sockets=${sockets.length}`,
        );
      }
    }
    this.server.to(roomName).emit(event, data);
  }

  // 获取Topic内在线用户
  async getOnlineUsersInTopic(topicId: string): Promise<string[]> {
    const sockets = await this.server.in(`topic:${topicId}`).fetchSockets();
    const onlineUserIds: string[] = [];

    for (const socket of sockets) {
      const userId = this.socketUsers.get(socket.id);
      if (userId && !onlineUserIds.includes(userId)) {
        onlineUserIds.push(userId);
      }
    }

    return onlineUserIds;
  }
}
