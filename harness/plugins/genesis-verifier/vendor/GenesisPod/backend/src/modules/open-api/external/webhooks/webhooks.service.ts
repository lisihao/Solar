/**
 * WebhooksService - Webhook 订阅管理服务
 *
 * 提供 Webhook 订阅的 CRUD 操作
 */

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { WebhookEventType } from "@prisma/client";
import { CreateWebhookDto, UpdateWebhookDto } from "./dto";
import { randomBytes, createHmac } from "crypto";

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 创建 Webhook 订阅
   */
  async create(userId: string, dto: CreateWebhookDto) {
    // 生成签名密钥
    const secret = this.generateSecret();

    const webhook = await this.prisma.webhookSubscription.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description,
        url: dto.url,
        secret,
        events: dto.events,
        topicIds: dto.topicIds || [],
        retryCount: dto.retryCount || 3,
        timeoutMs: dto.timeoutMs || 30000,
      },
    });

    this.logger.log(`Webhook created: ${webhook.id} for user ${userId}`);

    // 返回时包含 secret（仅创建时返回一次）
    return {
      ...webhook,
      secret, // 仅此次返回，后续不可获取
    };
  }

  /**
   * 获取用户的所有 Webhook 订阅
   */
  async findAll(userId: string) {
    return this.prisma.webhookSubscription.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        description: true,
        url: true,
        events: true,
        topicIds: true,
        isActive: true,
        failureCount: true,
        lastFailureAt: true,
        disabledReason: true,
        retryCount: true,
        timeoutMs: true,
        createdAt: true,
        updatedAt: true,
        // 不返回 secret
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 获取单个 Webhook 详情
   */
  async findOne(userId: string, webhookId: string) {
    const webhook = await this.prisma.webhookSubscription.findUnique({
      where: { id: webhookId },
      include: {
        _count: {
          select: { deliveries: true },
        },
      },
    });

    if (!webhook) {
      throw new NotFoundException("Webhook not found");
    }

    if (webhook.userId !== userId) {
      throw new ForbiddenException("Not authorized to access this webhook");
    }

    // 移除 secret 后返回
    const { secret: _secret, ...safeWebhook } = webhook;
    return safeWebhook;
  }

  /**
   * 更新 Webhook 订阅
   */
  async update(userId: string, webhookId: string, dto: UpdateWebhookDto) {
    const webhook = await this.prisma.webhookSubscription.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      throw new NotFoundException("Webhook not found");
    }

    if (webhook.userId !== userId) {
      throw new ForbiddenException("Not authorized to update this webhook");
    }

    const updated = await this.prisma.webhookSubscription.update({
      where: { id: webhookId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.url && { url: dto.url }),
        ...(dto.events && { events: dto.events }),
        ...(dto.topicIds && { topicIds: dto.topicIds }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.retryCount && { retryCount: dto.retryCount }),
        ...(dto.timeoutMs && { timeoutMs: dto.timeoutMs }),
        // 重新激活时清除失败计数
        ...(dto.isActive === true && {
          failureCount: 0,
          disabledReason: null,
        }),
      },
    });

    this.logger.log(`Webhook updated: ${webhookId}`);

    const { secret: _secret, ...safeWebhook } = updated;
    return safeWebhook;
  }

  /**
   * 删除 Webhook 订阅
   */
  async delete(userId: string, webhookId: string) {
    const webhook = await this.prisma.webhookSubscription.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      throw new NotFoundException("Webhook not found");
    }

    if (webhook.userId !== userId) {
      throw new ForbiddenException("Not authorized to delete this webhook");
    }

    await this.prisma.webhookSubscription.delete({
      where: { id: webhookId },
    });

    this.logger.log(`Webhook deleted: ${webhookId}`);

    return { success: true };
  }

  /**
   * 重新生成 Webhook Secret
   */
  async regenerateSecret(userId: string, webhookId: string) {
    const webhook = await this.prisma.webhookSubscription.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      throw new NotFoundException("Webhook not found");
    }

    if (webhook.userId !== userId) {
      throw new ForbiddenException("Not authorized to update this webhook");
    }

    const newSecret = this.generateSecret();

    await this.prisma.webhookSubscription.update({
      where: { id: webhookId },
      data: { secret: newSecret },
    });

    this.logger.log(`Webhook secret regenerated: ${webhookId}`);

    return { secret: newSecret };
  }

  /**
   * 获取 Webhook 投递历史
   */
  async getDeliveries(
    userId: string,
    webhookId: string,
    options: { limit?: number; cursor?: string } = {},
  ) {
    const webhook = await this.prisma.webhookSubscription.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      throw new NotFoundException("Webhook not found");
    }

    if (webhook.userId !== userId) {
      throw new ForbiddenException("Not authorized to access this webhook");
    }

    const limit = options.limit || 50;

    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: { subscriptionId: webhookId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(options.cursor && {
        cursor: { id: options.cursor },
        skip: 1,
      }),
    });

    const hasMore = deliveries.length > limit;
    if (hasMore) {
      deliveries.pop();
    }

    return {
      deliveries,
      nextCursor: hasMore ? deliveries[deliveries.length - 1]?.id : null,
    };
  }

  /**
   * 测试 Webhook
   */
  async testWebhook(userId: string, webhookId: string) {
    const webhook = await this.prisma.webhookSubscription.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      throw new NotFoundException("Webhook not found");
    }

    if (webhook.userId !== userId) {
      throw new ForbiddenException("Not authorized to test this webhook");
    }

    // 发送测试事件
    const testPayload = {
      eventId: `test_${Date.now()}`,
      eventType: "TOPIC_CREATED" as WebhookEventType,
      timestamp: new Date().toISOString(),
      data: {
        test: true,
        message: "This is a test webhook delivery",
      },
    };

    const signature = this.signPayload(testPayload, webhook.secret);

    try {
      const startTime = Date.now();
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Event": testPayload.eventType,
          "X-Webhook-Delivery": testPayload.eventId,
        },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(webhook.timeoutMs),
      });

      const responseTime = Date.now() - startTime;
      const responseBody = await response.text();

      return {
        success: response.ok,
        status: response.status,
        responseTime,
        responseBody: responseBody.slice(0, 1000),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  /**
   * 生成签名密钥
   */
  private generateSecret(): string {
    return `whsec_${randomBytes(32).toString("hex")}`;
  }

  /**
   * 签名载荷
   */
  signPayload(payload: unknown, secret: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const payloadString = JSON.stringify(payload);
    const signatureBase = `${timestamp}.${payloadString}`;
    const signature = createHmac("sha256", secret)
      .update(signatureBase)
      .digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }
}
