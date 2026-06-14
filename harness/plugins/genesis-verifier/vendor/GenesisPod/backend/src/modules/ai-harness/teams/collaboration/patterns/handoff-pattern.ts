/**
 * AI Engine - Handoff Pattern
 * 交接模式实现
 */

import { v4 as uuid } from "uuid";
import { Logger } from "@nestjs/common";
import { JsonObject } from "@/modules/ai-engine/facade/index";
import {
  HandoffRequest,
  HandoffResponse,
  CollaborationMessage,
} from "../abstractions/collaborator.interface";

/**
 * 交接配置
 */
export interface HandoffConfig {
  /**
   * 超时时间 (ms)
   */
  timeout?: number;

  /**
   * 是否需要确认
   */
  requireConfirmation?: boolean;

  /**
   * 重试次数
   */
  maxRetries?: number;

  /**
   * 自动选择备选 Agent
   */
  autoFallback?: boolean;
}

/**
 * 交接状态
 */
export interface HandoffState {
  id: string;
  request: HandoffRequest;
  status: "pending" | "accepted" | "rejected" | "timeout";
  response?: HandoffResponse;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * 交接协调器
 */
export class HandoffCoordinator {
  private readonly logger = new Logger(HandoffCoordinator.name);
  private readonly config: Required<HandoffConfig>;
  private readonly pendingHandoffs = new Map<string, HandoffState>();

  private static readonly DEFAULT_CONFIG: Required<HandoffConfig> = {
    timeout: 30000,
    requireConfirmation: true,
    maxRetries: 2,
    autoFallback: true,
  };

  constructor(config?: HandoffConfig) {
    this.config = { ...HandoffCoordinator.DEFAULT_CONFIG, ...config };
  }

  /**
   * 发起交接（公开入口，depth=0）
   */
  async initiateHandoff(
    request: HandoffRequest,
    onMessage: (msg: CollaborationMessage) => Promise<void>,
    waitForResponse: (
      fromAgentId: string,
      timeout: number,
    ) => Promise<HandoffResponse | null>,
  ): Promise<HandoffResponse> {
    return this.initiateHandoffInternal(request, onMessage, waitForResponse, 0);
  }

  /**
   * 发起交接（内部实现，带深度限制防止无限递归）
   */
  private async initiateHandoffInternal(
    request: HandoffRequest,
    onMessage: (msg: CollaborationMessage) => Promise<void>,
    waitForResponse: (
      fromAgentId: string,
      timeout: number,
    ) => Promise<HandoffResponse | null>,
    depth: number,
  ): Promise<HandoffResponse> {
    if (depth >= 5) {
      this.logger.warn(
        `Handoff max depth exceeded (${depth}), aborting fallback chain`,
      );
      return { accepted: false, message: "Max handoff depth exceeded" };
    }

    const handoffId = uuid();
    const state: HandoffState = {
      id: handoffId,
      request,
      status: "pending",
      createdAt: new Date(),
    };

    this.pendingHandoffs.set(handoffId, state);

    this.logger.log(
      `Initiating handoff ${handoffId}: ${request.fromAgentId} -> ${request.toAgentId}`,
    );

    // 发送交接请求消息
    await onMessage({
      id: uuid(),
      senderId: request.fromAgentId,
      receiverId: request.toAgentId,
      type: "handoff",
      content: {
        handoffId,
        request,
      },
      timestamp: new Date(),
    });

    // 等待响应
    let retries = 0;
    while (retries <= this.config.maxRetries) {
      const response = await waitForResponse(
        request.toAgentId,
        this.config.timeout,
      );

      if (response) {
        state.status = response.accepted ? "accepted" : "rejected";
        state.response = response;
        state.completedAt = new Date();
        this.pendingHandoffs.delete(handoffId);

        if (response.accepted) {
          this.logger.log(`Handoff ${handoffId} accepted`);
          return response;
        }

        if (response.suggestedAgent && this.config.autoFallback) {
          // 尝试备选 Agent（递归，增加深度计数）
          this.logger.log(
            `Handoff ${handoffId} rejected, trying suggested agent: ${response.suggestedAgent}`,
          );
          return this.initiateHandoffInternal(
            { ...request, toAgentId: response.suggestedAgent },
            onMessage,
            waitForResponse,
            depth + 1,
          );
        }

        return response;
      }

      retries++;
      this.logger.warn(
        `Handoff ${handoffId} timeout, retry ${retries}/${this.config.maxRetries}`,
      );
    }

    // 超时
    state.status = "timeout";
    state.completedAt = new Date();
    this.pendingHandoffs.delete(handoffId);

    return {
      accepted: false,
      message: "Handoff request timed out",
    };
  }

  /**
   * 处理交接请求
   */
  async handleHandoffRequest(
    request: HandoffRequest,
    canAccept: (request: HandoffRequest) => Promise<boolean>,
    getSuggestedAgent?: (request: HandoffRequest) => Promise<string | null>,
  ): Promise<HandoffResponse> {
    const accepted = await canAccept(request);

    if (accepted) {
      return {
        accepted: true,
        message: "Handoff accepted",
      };
    }

    // 尝试获取建议的替代 Agent
    let suggestedAgent: string | undefined;
    if (getSuggestedAgent) {
      const suggested = await getSuggestedAgent(request);
      if (suggested) {
        suggestedAgent = suggested;
      }
    }

    return {
      accepted: false,
      message: "Unable to accept handoff at this time",
      suggestedAgent,
    };
  }

  /**
   * 获取待处理的交接
   */
  getPendingHandoffs(): HandoffState[] {
    return Array.from(this.pendingHandoffs.values());
  }

  /**
   * 取消交接
   */
  cancelHandoff(handoffId: string): boolean {
    const state = this.pendingHandoffs.get(handoffId);
    if (!state || state.status !== "pending") {
      return false;
    }

    state.status = "rejected";
    state.completedAt = new Date();
    this.pendingHandoffs.delete(handoffId);

    return true;
  }
}

/**
 * 交接上下文构建器
 */
export class HandoffContextBuilder {
  private context: JsonObject = {};

  /**
   * 添加任务信息
   */
  withTask(task: { id: string; description: string; progress?: number }): this {
    this.context["task"] = task;
    return this;
  }

  /**
   * 添加对话历史
   */
  withConversation(messages: Array<{ role: string; content: string }>): this {
    this.context["conversation"] = messages;
    return this;
  }

  /**
   * 添加工作记忆
   */
  withWorkingMemory(memory: JsonObject): this {
    this.context["workingMemory"] = memory;
    return this;
  }

  /**
   * 添加中间结果
   */
  withIntermediateResults(results: JsonObject[]): this {
    this.context["intermediateResults"] = results;
    return this;
  }

  /**
   * 添加约束条件
   */
  withConstraints(constraints: string[]): this {
    this.context["constraints"] = constraints;
    return this;
  }

  /**
   * 添加自定义数据
   */
  withCustomData(key: string, value: unknown): this {
    this.context[key] = value as JsonObject[string];
    return this;
  }

  /**
   * 构建上下文
   */
  build(): JsonObject {
    return { ...this.context };
  }
}
