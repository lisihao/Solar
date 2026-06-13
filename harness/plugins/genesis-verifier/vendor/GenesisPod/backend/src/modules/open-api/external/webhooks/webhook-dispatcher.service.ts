/**
 * WebhookDispatcherService - Webhook 事件分发服务
 *
 * 负责将系统事件推送到已订阅的 Webhook 端点
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { APP_CONFIG } from "../../../../common/config/app.config";
import {
  Prisma,
  WebhookEventType,
  WebhookDeliveryStatus,
  WebhookSubscription,
} from "@prisma/client";
import { WebhookPayload } from "./dto";
import { createHmac, randomUUID } from "crypto";
import { OnEvent } from "@nestjs/event-emitter";
// SSRF 防护：经 ai-engine facade 复用统一出站闸门（DNS 解析复核，堵 rebinding）。
import { assertUrlSafe } from "../../../ai-engine/facade";

interface WebhookEvent {
  type: WebhookEventType;
  topicId?: string;
  data: Record<string, unknown>;
}

interface DeliveryResult {
  success: boolean;
  status?: number;
  responseBody?: string;
  responseTimeMs?: number;
  error?: string;
}

@Injectable()
export class WebhookDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(WebhookDispatcherService.name);
  private processingQueue = false;
  private tableAvailable = true; // Will be set to false if table doesn't exist

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    // 检查表是否存在
    await this.checkTableExists();
    // 启动重试队列处理
    this.startRetryProcessor();
  }

  /**
   * 检查 webhook 表是否存在
   */
  private async checkTableExists(): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1 FROM webhook_deliveries LIMIT 1`;
      this.tableAvailable = true;
    } catch {
      this.tableAvailable = false;
      this.logger.warn(
        "Webhook tables not found. Webhook features disabled until migration is run.",
      );
    }
  }

  /**
   * 分发 Webhook 事件
   */
  async dispatch(event: WebhookEvent): Promise<void> {
    if (!this.tableAvailable) {
      return; // Skip if tables don't exist
    }

    const { type, topicId, data } = event;

    // 查找匹配的活跃订阅
    const subscriptions = await this.findMatchingSubscriptions(type, topicId);

    if (subscriptions.length === 0) {
      return;
    }

    this.logger.log(
      `Dispatching ${type} event to ${subscriptions.length} subscriptions`,
    );

    // 并行投递到所有订阅
    await Promise.allSettled(
      subscriptions.map((sub) => this.deliverToSubscription(sub, type, data)),
    );
  }

  /**
   * 查找匹配的订阅
   */
  private async findMatchingSubscriptions(
    eventType: WebhookEventType,
    topicId?: string,
  ): Promise<WebhookSubscription[]> {
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: {
        isActive: true,
        events: { has: eventType },
      },
    });

    // 过滤 topicId 匹配的订阅
    return subscriptions.filter((sub) => {
      // 如果订阅没有指定 topicIds，则匹配所有
      if (sub.topicIds.length === 0) {
        return true;
      }
      // 如果事件没有 topicId，但订阅指定了 topicIds，则不匹配
      if (!topicId) {
        return false;
      }
      // 检查 topicId 是否在订阅的列表中
      return sub.topicIds.includes(topicId);
    });
  }

  /**
   * 投递到单个订阅
   */
  private async deliverToSubscription(
    subscription: WebhookSubscription,
    eventType: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    const eventId = randomUUID();
    const payload: WebhookPayload = {
      eventId,
      eventType,
      timestamp: new Date().toISOString(),
      data,
    };

    // 创建投递记录
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        subscriptionId: subscription.id,
        eventType,
        eventId,
        payload: payload as unknown as Prisma.InputJsonValue,
        status: WebhookDeliveryStatus.PENDING,
        attemptCount: 0,
      },
    });

    // 执行投递
    await this.attemptDelivery(subscription, delivery.id, payload);
  }

  /**
   * 尝试投递
   */
  private async attemptDelivery(
    subscription: WebhookSubscription,
    deliveryId: string,
    payload: WebhookPayload,
  ): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      return;
    }

    const attemptCount = delivery.attemptCount + 1;

    // 更新尝试次数
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { attemptCount },
    });

    // 执行 HTTP 请求
    const result = await this.sendWebhook(subscription, payload);

    if (result.success) {
      // 成功
      await this.markDeliverySuccess(deliveryId, result);
      await this.resetSubscriptionFailures(subscription.id);
    } else {
      // 失败
      if (attemptCount < subscription.retryCount) {
        // 安排重试
        const nextRetryAt = this.calculateNextRetry(attemptCount);
        await this.scheduleRetry(deliveryId, nextRetryAt, result);
      } else {
        // 最终失败
        await this.markDeliveryFailed(deliveryId, result);
        await this.incrementSubscriptionFailures(subscription.id);
      }
    }
  }

  /**
   * 发送 Webhook HTTP 请求
   */
  private async sendWebhook(
    subscription: WebhookSubscription,
    payload: WebhookPayload,
  ): Promise<DeliveryResult> {
    const signature = this.signPayload(payload, subscription.secret);

    try {
      // ★ SSRF 防护（dispatch 时校验，防注册后 DNS rebinding）：解析后按真实 IP 复核。
      //   被拒抛 BadRequestException → 走下方 catch 记为投递失败（fail-closed）。
      await assertUrlSafe(subscription.url);

      const startTime = Date.now();
      const response = await fetch(subscription.url, {
        method: "POST",
        // ★ 不跟随重定向：webhook 目标不应把我们重定向到内网（重定向 rebinding）。
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Event": payload.eventType,
          "X-Webhook-Delivery": payload.eventId,
          "User-Agent": APP_CONFIG.brand.webhookUserAgent,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(subscription.timeoutMs),
      });

      const responseTimeMs = Date.now() - startTime;
      const responseBody = await response.text();

      if (response.ok) {
        return {
          success: true,
          status: response.status,
          responseBody: responseBody.slice(0, 1000),
          responseTimeMs,
        };
      } else {
        return {
          success: false,
          status: response.status,
          responseBody: responseBody.slice(0, 1000),
          responseTimeMs,
          error: `HTTP ${response.status}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 签名载荷
   */
  private signPayload(payload: WebhookPayload, secret: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const payloadString = JSON.stringify(payload);
    const signatureBase = `${timestamp}.${payloadString}`;
    const signature = createHmac("sha256", secret)
      .update(signatureBase)
      .digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }

  /**
   * 计算下次重试时间（指数退避）
   */
  private calculateNextRetry(attemptCount: number): Date {
    // 指数退避: 1分钟, 5分钟, 30分钟, 2小时, 6小时...
    const delays = [60, 300, 1800, 7200, 21600];
    const delaySeconds = delays[Math.min(attemptCount - 1, delays.length - 1)];
    return new Date(Date.now() + delaySeconds * 1000);
  }

  /**
   * 标记投递成功
   */
  private async markDeliverySuccess(
    deliveryId: string,
    result: DeliveryResult,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.SUCCESS,
        responseStatus: result.status,
        responseBody: result.responseBody,
        responseTimeMs: result.responseTimeMs,
        deliveredAt: new Date(),
      },
    });
  }

  /**
   * 安排重试
   */
  private async scheduleRetry(
    deliveryId: string,
    nextRetryAt: Date,
    result: DeliveryResult,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.RETRYING,
        nextRetryAt,
        responseStatus: result.status,
        responseBody: result.responseBody,
        responseTimeMs: result.responseTimeMs,
        errorMessage: result.error,
      },
    });
  }

  /**
   * 标记投递失败
   */
  private async markDeliveryFailed(
    deliveryId: string,
    result: DeliveryResult,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.FAILED,
        responseStatus: result.status,
        responseBody: result.responseBody,
        responseTimeMs: result.responseTimeMs,
        errorMessage: result.error,
      },
    });
  }

  /**
   * 重置订阅失败计数
   */
  private async resetSubscriptionFailures(
    subscriptionId: string,
  ): Promise<void> {
    await this.prisma.webhookSubscription.update({
      where: { id: subscriptionId },
      data: {
        failureCount: 0,
        lastFailureAt: null,
      },
    });
  }

  /**
   * 增加订阅失败计数
   */
  private async incrementSubscriptionFailures(
    subscriptionId: string,
  ): Promise<void> {
    const subscription = await this.prisma.webhookSubscription.update({
      where: { id: subscriptionId },
      data: {
        failureCount: { increment: 1 },
        lastFailureAt: new Date(),
      },
    });

    // 连续失败 10 次自动禁用
    if (subscription.failureCount >= 10) {
      await this.prisma.webhookSubscription.update({
        where: { id: subscriptionId },
        data: {
          isActive: false,
          disabledReason: "Too many consecutive failures",
        },
      });

      this.logger.warn(
        `Webhook subscription ${subscriptionId} disabled due to failures`,
      );
    }
  }

  /**
   * 启动重试处理器
   */
  private startRetryProcessor(): void {
    // 每分钟检查需要重试的投递
    setInterval(() => this.processRetryQueue(), 60000).unref();
  }

  /**
   * 处理重试队列
   */
  private async processRetryQueue(): Promise<void> {
    // Skip if table doesn't exist
    if (!this.tableAvailable) {
      return;
    }

    if (this.processingQueue) {
      return;
    }

    this.processingQueue = true;

    try {
      const pendingRetries = await this.prisma.webhookDelivery.findMany({
        where: {
          status: WebhookDeliveryStatus.RETRYING,
          nextRetryAt: { lte: new Date() },
        },
        include: { subscription: true },
        take: 100,
      });

      for (const delivery of pendingRetries) {
        if (!delivery.subscription.isActive) {
          // 订阅已禁用，标记为失败
          await this.markDeliveryFailed(delivery.id, {
            success: false,
            error: "Subscription disabled",
          });
          continue;
        }

        await this.attemptDelivery(
          delivery.subscription,
          delivery.id,
          delivery.payload as unknown as WebhookPayload,
        );
      }
    } catch (error) {
      this.logger.error("Error processing retry queue", error);
    } finally {
      this.processingQueue = false;
    }
  }

  // =========================================================================
  // Event Handlers - 监听系统事件并分发 Webhook
  // =========================================================================

  @OnEvent("topic.created")
  async handleTopicCreated(payload: {
    topicId: string;
    userId: string;
    name: string;
  }) {
    await this.dispatch({
      type: WebhookEventType.TOPIC_CREATED,
      topicId: payload.topicId,
      data: payload,
    });
  }

  @OnEvent("topic.updated")
  async handleTopicUpdated(payload: {
    topicId: string;
    changes: Record<string, unknown>;
  }) {
    await this.dispatch({
      type: WebhookEventType.TOPIC_UPDATED,
      topicId: payload.topicId,
      data: payload,
    });
  }

  @OnEvent("topic.deleted")
  async handleTopicDeleted(payload: { topicId: string }) {
    await this.dispatch({
      type: WebhookEventType.TOPIC_DELETED,
      topicId: payload.topicId,
      data: payload,
    });
  }

  @OnEvent("message.created")
  async handleMessageCreated(payload: {
    topicId: string;
    messageId: string;
    senderId: string;
    content: string;
  }) {
    await this.dispatch({
      type: WebhookEventType.MESSAGE_CREATED,
      topicId: payload.topicId,
      data: payload,
    });
  }

  @OnEvent("ai.response.created")
  async handleAIResponseCreated(payload: {
    topicId: string;
    messageId: string;
    aiMemberId: string;
    model: string;
  }) {
    await this.dispatch({
      type: WebhookEventType.AI_RESPONSE_CREATED,
      topicId: payload.topicId,
      data: payload,
    });
  }

  @OnEvent("ai.response.error")
  async handleAIResponseError(payload: {
    topicId: string;
    aiMemberId: string;
    error: string;
  }) {
    await this.dispatch({
      type: WebhookEventType.AI_RESPONSE_ERROR,
      topicId: payload.topicId,
      data: payload,
    });
  }

  @OnEvent("mission.created")
  async handleMissionCreated(payload: {
    topicId: string;
    missionId: string;
    title: string;
  }) {
    await this.dispatch({
      type: WebhookEventType.MISSION_CREATED,
      topicId: payload.topicId,
      data: payload,
    });
  }

  @OnEvent("mission.completed")
  async handleMissionCompleted(payload: {
    topicId: string;
    missionId: string;
    result: string;
  }) {
    await this.dispatch({
      type: WebhookEventType.MISSION_COMPLETED,
      topicId: payload.topicId,
      data: payload,
    });
  }

  @OnEvent("mission.failed")
  async handleMissionFailed(payload: {
    topicId: string;
    missionId: string;
    error: string;
  }) {
    await this.dispatch({
      type: WebhookEventType.MISSION_FAILED,
      topicId: payload.topicId,
      data: payload,
    });
  }

  @OnEvent("debate.started")
  async handleDebateStarted(payload: {
    topicId: string;
    debateTopic: string;
    participants: string[];
  }) {
    await this.dispatch({
      type: WebhookEventType.DEBATE_STARTED,
      topicId: payload.topicId,
      data: payload,
    });
  }

  @OnEvent("debate.completed")
  async handleDebateCompleted(payload: {
    topicId: string;
    summary: string;
    rounds: number;
  }) {
    await this.dispatch({
      type: WebhookEventType.DEBATE_COMPLETED,
      topicId: payload.topicId,
      data: payload,
    });
  }
}
