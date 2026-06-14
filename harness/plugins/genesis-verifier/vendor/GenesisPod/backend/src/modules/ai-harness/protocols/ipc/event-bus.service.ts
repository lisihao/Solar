/**
 * Event Bus Service
 * 事件总线服务
 */

import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Server } from "socket.io";
import type {
  IEngineEventEmitter,
  EngineEvent,
  ProgressEvent,
  RoomConfig,
} from "../realtime/abstractions/event-emitter.interface";

/**
 * 事件订阅
 */
interface Subscription {
  id: string;
  eventType: string;
  handler: (event: EngineEvent) => void | Promise<void>;
  createdAt: Date; // ★ 添加创建时间用于清理
}

/**
 * 事件总线服务
 */
@Injectable()
export class EventBusService implements IEngineEventEmitter {
  private readonly logger = new Logger(EventBusService.name);
  private readonly subscriptions = new Map<string, Subscription>();
  private server?: Server;
  private subscriptionCounter = 0;
  private readonly MAX_SUBSCRIPTIONS = 10000; // ★ 订阅数量上限

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * 设置 WebSocket 服务器（由 Gateway 调用）
   */
  setServer(server: Server): void {
    this.server = server;
    this.logger.log("WebSocket server initialized");
  }

  /**
   * 发射事件（全局）
   */
  emit<T>(event: EngineEvent<T>): void {
    // 发射到 NestJS EventEmitter
    this.eventEmitter.emit(event.type, event);

    // 发射到所有 WebSocket 客户端
    if (this.server) {
      this.server.emit(event.type, event);
    }

    this.logger.debug(`Emitted event: ${event.type}`);
  }

  /**
   * 发射到指定房间
   */
  emitToRoom<T>(roomConfig: RoomConfig, event: EngineEvent<T>): void {
    const roomId = this.getRoomId(roomConfig);

    // 发射到 NestJS EventEmitter（带房间信息）
    this.eventEmitter.emit(event.type, {
      ...event,
      metadata: {
        ...event.metadata,
        roomId,
        roomType: roomConfig.roomType,
        entityId: roomConfig.entityId,
      },
    });

    // 发射到 WebSocket 房间
    if (this.server) {
      this.server.to(roomId).emit(event.type, event);
    }

    this.logger.debug(`Emitted event to room ${roomId}: ${event.type}`);
  }

  /**
   * 发射进度事件
   */
  emitProgress(roomConfig: RoomConfig, progress: ProgressEvent): void {
    const event: EngineEvent<ProgressEvent> = {
      type: "task:progress",
      payload: progress,
      metadata: {
        timestamp: new Date(),
        source: "engine",
        correlationId: progress.taskId,
      },
    };

    this.emitToRoom(roomConfig, event);
  }

  /**
   * 订阅事件
   * ★ 添加订阅数量限制和过期清理
   */
  subscribe<T>(
    eventType: string,
    handler: (event: EngineEvent<T>) => void,
  ): () => void {
    // ★ 检查订阅数量上限
    if (this.subscriptions.size >= this.MAX_SUBSCRIPTIONS) {
      this.logger.warn(
        `Subscription limit reached (${this.MAX_SUBSCRIPTIONS}), cleaning up old subscriptions`,
      );
      this.cleanupOldSubscriptions();
    }

    const id = `sub_${++this.subscriptionCounter}`;

    const subscription: Subscription = {
      id,
      eventType,
      handler: handler as (event: EngineEvent) => void,
      createdAt: new Date(), // ★ 记录创建时间
    };

    this.subscriptions.set(id, subscription);

    // 注册到 NestJS EventEmitter
    this.eventEmitter.on(eventType, handler);

    this.logger.debug(`Subscribed to event: ${eventType} (${id})`);

    // 返回取消订阅函数
    return () => this.unsubscribe(id);
  }

  /**
   * 清理过期订阅
   * 删除超过 1 小时的订阅
   */
  private cleanupOldSubscriptions(): void {
    const threshold = new Date(Date.now() - 60 * 60 * 1000); // 1 小时前
    let cleaned = 0;

    for (const [id, subscription] of this.subscriptions) {
      if (subscription.createdAt < threshold) {
        this.unsubscribe(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} old subscriptions`);
    }
  }

  /**
   * 订阅一次性事件
   */
  once<T>(
    eventType: string,
    handler: (event: EngineEvent<T>) => void,
  ): () => void {
    const id = `once_${++this.subscriptionCounter}`;

    const wrappedHandler = (event: EngineEvent<T>) => {
      handler(event);
      this.unsubscribe(id);
    };

    const subscription: Subscription = {
      id,
      eventType,
      handler: wrappedHandler as (event: EngineEvent) => void,
      createdAt: new Date(), // ★ 添加创建时间
    };

    this.subscriptions.set(id, subscription);
    this.eventEmitter.once(eventType, wrappedHandler);

    return () => this.unsubscribe(id);
  }

  /**
   * 取消订阅
   */
  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      this.eventEmitter.off(subscription.eventType, subscription.handler);
      this.subscriptions.delete(subscriptionId);
      this.logger.debug(`Unsubscribed: ${subscriptionId}`);
    }
  }

  /**
   * 加入房间
   */
  joinRoom(socketId: string, roomConfig: RoomConfig): void {
    if (!this.server) {
      this.logger.warn("Server not initialized, cannot join room");
      return;
    }

    const roomId = this.getRoomId(roomConfig);
    const socket = this.server.sockets.sockets.get(socketId);

    if (socket) {
      void socket.join(roomId);
      this.logger.debug(`Socket ${socketId} joined room ${roomId}`);
    }
  }

  /**
   * 离开房间
   */
  leaveRoom(socketId: string, roomConfig: RoomConfig): void {
    if (!this.server) {
      return;
    }

    const roomId = this.getRoomId(roomConfig);
    const socket = this.server.sockets.sockets.get(socketId);

    if (socket) {
      void socket.leave(roomId);
      this.logger.debug(`Socket ${socketId} left room ${roomId}`);
    }
  }

  /**
   * 获取房间成员
   */
  getRoomMembers(roomConfig: RoomConfig): string[] {
    if (!this.server) {
      return [];
    }

    const roomId = this.getRoomId(roomConfig);
    const room = this.server.sockets.adapter.rooms.get(roomId);

    return room ? Array.from(room) : [];
  }

  /**
   * 广播到所有连接
   * ★ 统一边界检查日志
   */
  broadcast<T>(event: EngineEvent<T>): void {
    if (!this.server) {
      this.logger.warn("Server not initialized, cannot broadcast");
      return;
    }
    this.server.emit(event.type, event);
    this.logger.debug(`Broadcast event: ${event.type}`);
  }

  /**
   * 获取房间 ID
   */
  private getRoomId(roomConfig: RoomConfig): string {
    return roomConfig.roomId || `${roomConfig.roomType}:${roomConfig.entityId}`;
  }

  /**
   * 获取活跃订阅数量
   */
  getActiveSubscriptionCount(): number {
    return this.subscriptions.size;
  }
}
