/**
 * MCP Streaming Bridge
 *
 * 将 AI Engine 的 RealtimeFeature（ProgressTracker + EventEmitter）
 * 桥接到 MCP SSE 端点，让外部 AI 工具能接收长任务的实时进度。
 *
 * 解决问题: Deep Research（8轮迭代）、Team Debate（多轮）等长任务
 * 目前 SSE 端点只有 keepalive，外部工具无法感知进度。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { Response } from "express";
import { MCPStreamEvent } from "../abstractions/mcp-server.interface";
import {
  EngineEventEmitterService,
  ProgressTrackerService,
} from "../../../../ai-harness/facade";

interface SSEConnection {
  sessionId: string;
  response: Response;
  subscriptions: Array<() => void>;
  connectedAt: Date;
}

@Injectable()
export class MCPStreamingBridge {
  private readonly logger = new Logger(MCPStreamingBridge.name);
  private readonly connections = new Map<string, SSEConnection>();

  constructor(
    @Optional() private readonly eventEmitter?: EngineEventEmitterService,
    @Optional() private readonly progressTracker?: ProgressTrackerService,
  ) {}

  /**
   * 注册 SSE 连接
   * 将 Session 的 SSE Response 与 Engine 事件订阅关联
   */
  registerConnection(sessionId: string, response: Response): void {
    // 清理已有连接
    this.unregisterConnection(sessionId);

    const subscriptions: Array<() => void> = [];

    // 订阅进度事件（每个 handler 内部 try-catch，防止 unhandled rejection）
    if (this.eventEmitter) {
      const safeHandler =
        (type: MCPStreamEvent["type"]) => (event: unknown) => {
          try {
            const data =
              ((event as Record<string, unknown>).data as Record<
                string,
                unknown
              >) || {};
            this.sendEvent(sessionId, {
              type,
              taskId: (data.taskId as string) || "unknown",
              data,
              timestamp: new Date(),
            });
          } catch (error) {
            this.logger.warn(
              `Event handler error [${type}] for ${sessionId}: ${(error as Error).message}`,
            );
          }
        };

      subscriptions.push(
        this.eventEmitter.subscribe("task.progress", safeHandler("progress")),
      );
      subscriptions.push(
        this.eventEmitter.subscribe("task.complete", safeHandler("result")),
      );
      subscriptions.push(
        this.eventEmitter.subscribe("task.error", safeHandler("error")),
      );
    }

    this.connections.set(sessionId, {
      sessionId,
      response,
      subscriptions,
      connectedAt: new Date(),
    });

    this.logger.log(`SSE connection registered for session: ${sessionId}`);
  }

  /**
   * 取消注册 SSE 连接
   */
  unregisterConnection(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (conn) {
      // 取消所有事件订阅
      for (const unsub of conn.subscriptions) {
        try {
          unsub();
        } catch {
          // ignore cleanup errors
        }
      }
      this.connections.delete(sessionId);
      this.logger.log(`SSE connection unregistered: ${sessionId}`);
    }
  }

  /**
   * 向指定 Session 发送 SSE 事件
   */
  sendEvent(sessionId: string, event: MCPStreamEvent): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;

    try {
      // MCP spec: 按事件语义选择正确的 method 名称
      const method =
        event.type === "error"
          ? "notifications/error"
          : event.type === "result"
            ? "notifications/message"
            : "notifications/progress";

      const data = JSON.stringify({
        jsonrpc: "2.0",
        method,
        params: {
          type: event.type,
          taskId: event.taskId,
          data: event.data,
          timestamp: event.timestamp.toISOString(),
        },
      });

      conn.response.write(`event: message\n`);
      conn.response.write(`data: ${data}\n\n`);
    } catch (error) {
      this.logger.warn(
        `Failed to send SSE event to ${sessionId}: ${(error as Error).message}`,
      );
      this.unregisterConnection(sessionId);
    }
  }

  /**
   * 向指定 Session 发送研究完成结果
   *
   * 通过 SSE 推送 notifications/message，让 MCP 客户端获得异步研究报告。
   * 当 POST tools/call 立即返回 taskId 后，结果通过此方法异步投递。
   */
  sendResearchResult(sessionId: string, taskId: string, data: unknown): void {
    const conn = this.connections.get(sessionId);
    if (!conn) {
      this.logger.warn(
        `Research result ${taskId}: no SSE connection for session ${sessionId}, result lost`,
      );
      return;
    }

    try {
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          taskId,
          type: "research_complete",
          data,
          timestamp: new Date().toISOString(),
        },
      });
      conn.response.write(`event: message\n`);
      conn.response.write(`data: ${payload}\n\n`);
      this.logger.log(
        `Research result ${taskId} delivered to session ${sessionId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to deliver research result ${taskId} to ${sessionId}: ${(error as Error).message}`,
      );
      this.unregisterConnection(sessionId);
    }
  }

  /**
   * 发送自定义通知到所有连接
   */
  broadcast(event: MCPStreamEvent): void {
    for (const sessionId of this.connections.keys()) {
      this.sendEvent(sessionId, event);
    }
  }

  /**
   * 查询指定任务的当前进度
   */
  getTaskProgress(taskId: string): Record<string, unknown> | null {
    if (!this.progressTracker) return null;

    const progress = this.progressTracker.getProgress(taskId);
    if (!progress) return null;

    return progress as unknown as Record<string, unknown>;
  }

  /**
   * 获取连接统计
   */
  getStats(): {
    activeConnections: number;
    connections: Array<{
      sessionId: string;
      connectedAt: Date;
      subscriptionCount: number;
    }>;
  } {
    const connections = Array.from(this.connections.values()).map((conn) => ({
      sessionId: conn.sessionId,
      connectedAt: conn.connectedAt,
      subscriptionCount: conn.subscriptions.length,
    }));

    return {
      activeConnections: this.connections.size,
      connections,
    };
  }
}
