/**
 * Mission Notification Service
 *
 * 通知 + 设置访问
 * 从 ResearchMissionService 拆分，降低 God Service 复杂度
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  MissionCompletionPreset,
  SettingsService,
} from "@/modules/platform/facade";

@Injectable()
export class MissionNotificationService {
  private readonly logger = new Logger(MissionNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    // PR-DR1b F3 整改：mission 完成通知走 dispatcher（用户可关 email + 同时落 site）
    @Optional()
    private readonly missionCompletionPreset?: MissionCompletionPreset,
    @Optional() private readonly settingsService?: SettingsService,
  ) {}

  /**
   * 任务完成邮件通知（fire-and-forget）
   */
  notifyCompletion(params: {
    missionId: string;
    topicId: string;
    completedTasks: number;
    totalTasks: number;
  }): void {
    const { missionId, topicId, completedTasks, totalTasks } = params;
    const preset = this.missionCompletionPreset;
    if (!preset) {
      this.logger.debug(
        "[Degraded] NotificationDispatcher unavailable, skipping completion notification",
      );
      return;
    }
    void (async () => {
      try {
        const topic = await this.prisma.researchTopic.findUnique({
          where: { id: topicId },
          select: { userId: true, name: true },
        });
        if (topic?.userId) {
          await preset.notify({
            userId: topic.userId,
            missionId,
            missionTitle: topic.name,
            reportUrl: `/topics/${topicId}/reports`,
            summary: `${completedTasks}/${totalTasks} dimensions completed`,
            completedAt: new Date(),
          });
        }
      } catch (e) {
        this.logger.debug(`Mission completion dispatch failed: ${e}`);
      }
    })();
  }

  /**
   * 获取 AI 配置（用于并发计算）
   * 返回 rate limit hint 或 undefined（当 SettingsService 不可用时）
   */
  async getAiSettings(): Promise<{ rateLimitHint?: number }> {
    if (!this.settingsService) {
      this.logger.debug(
        "[Degraded] SettingsService unavailable, skipping AI settings lookup",
      );
      return {};
    }
    try {
      const aiSettings = await this.settingsService.getAiSettings();
      if (aiSettings.rateLimitPerMinute > 0) {
        const hint = Math.floor(aiSettings.rateLimitPerMinute / 3);
        this.logger.debug(
          `[getAiSettings] rateLimitPerMinute=${aiSettings.rateLimitPerMinute} → hint=${hint}`,
        );
        return { rateLimitHint: hint };
      }
    } catch (e) {
      this.logger.debug(`SettingsService failed: ${e}`);
    }
    return {};
  }
}
