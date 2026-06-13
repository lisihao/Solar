/**
 * Source Subscription Service
 *
 * 监听来源模块的刷新事件，将订阅了该来源的 PPT Mission 标记为 stale（内容已过期）。
 * 当用户回到 AI Slides 页面时，UI 可展示"来源已更新，点击刷新"的提示。
 */

import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

interface TopicReportRefreshedEvent {
  topicId: string;
  reportId: string;
  refreshedAt: Date;
}

@Injectable()
export class SourceSubscriptionService {
  private readonly logger = new Logger(SourceSubscriptionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 处理 AI Topic Insights 报告刷新事件
   *
   * 将订阅了该专题的所有 SlidesMission 标记为 isStale=true，
   * 提示用户 PPT 来源内容已更新。
   */
  @OnEvent("topic-insights.report.refreshed")
  async handleTopicReportRefreshed(
    event: TopicReportRefreshedEvent,
  ): Promise<void> {
    this.logger.log(
      `[handleTopicReportRefreshed] topicId: ${event.topicId}, reportId: ${event.reportId}`,
    );

    try {
      // 使用原生 SQL 更新 JSON 字段中的 isStale 标志
      // 只更新订阅了该专题且 sourceSubscription 不为 null 的 missions
      const result = await this.prisma.$executeRaw`
        UPDATE "slides_missions"
        SET "source_subscription" = jsonb_set(
          "source_subscription"::jsonb,
          '{isStale}',
          'true'::jsonb
        )
        WHERE "source_subscription" IS NOT NULL
          AND "source_subscription"->>'type' = 'topic-insights'
          AND "source_subscription"->>'sourceId' = ${event.topicId}::text
      `;

      this.logger.log(
        `[handleTopicReportRefreshed] Marked ${result} missions as stale for topic ${event.topicId}`,
      );
    } catch (error) {
      this.logger.error(
        `[handleTopicReportRefreshed] Failed to mark missions as stale: ${error}`,
      );
    }
  }
}
