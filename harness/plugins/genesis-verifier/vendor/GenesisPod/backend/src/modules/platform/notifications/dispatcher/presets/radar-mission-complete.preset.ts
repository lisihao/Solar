import { Injectable } from "@nestjs/common";
import { NotificationDispatcher } from "../notification-dispatcher.service";

/**
 * RadarMissionCompletePreset —— PR-DR1a 老 caller 迁移示范
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §11.1a
 *   "✅ 老 caller 迁移：1 个 site notification 调用切到 dispatcher 验证抽象"
 *
 * 演示模式：
 *   - 业务 caller（PR-DR2 radar mission scheduler）调本 preset 而不是
 *     直接 NotificationService.createNotification —— 解耦"通知意图"与"渠道选择"
 *   - dispatcher 内部按用户偏好 + capabilities + isAvailable 决定走哪些 channel
 *   - PR-DR1a 阶段只有 site 注册 → 退化到等价于既有调用
 *   - PR-DR1b email 注入后 → 自动多 channel（无需改本 preset）
 *
 * 与既有 NotificationPresetsService.notifyMissionCompleted 的关系：
 *   - 老 service 仍保留供既有 4 caller 不破（W4 follow-up 切完后下线）
 *   - 本 preset 是新接入业务的推荐入口（PR-DR2 radar 后续 caller 用这个）
 *   - F3 迁移决策：PR-DR1b EmailNotificationPresetsService 全切走 grep 验证
 */
@Injectable()
export class RadarMissionCompletePreset {
  constructor(private readonly dispatcher: NotificationDispatcher) {}

  /**
   * 雷达 mission（discovery / refresh / daily-briefing）完成时调用
   *
   * @param params.userId 接收者
   * @param params.topicId 雷达主题 ID
   * @param params.topicName 主题名（snippet 展示）
   * @param params.missionKind 'discovery' | 'refresh' | 'daily-briefing'
   * @param params.itemCount 本次采集到的新 item 数（0 时仍发，让用户知道"持续监控中"）
   */
  async notify(params: {
    userId: string;
    topicId: string;
    topicName: string;
    missionKind: "discovery" | "refresh" | "daily-briefing";
    itemCount: number;
  }) {
    const { userId, topicId, topicName, missionKind, itemCount } = params;

    const titleMap: Record<typeof missionKind, string> = {
      discovery: "AI 雷达数据源发现完成",
      refresh: "AI 雷达数据刷新完成",
      "daily-briefing": "今日精选已出炉",
    };

    // R1 behavior 整改：daily-briefing 零信号文案对齐 A1 决策"今日无新信号"
    // discovery/refresh 用更通用"本次无新内容"（非每日维度）
    const messageSuffix =
      itemCount > 0
        ? `本次更新 ${itemCount} 条`
        : missionKind === "daily-briefing"
          ? "今日无新信号 · 持续监控中"
          : "本次无新内容 · 持续监控中";

    return this.dispatcher.dispatch(userId, {
      type: "RADAR_MISSION_COMPLETE",
      title: titleMap[missionKind],
      message: `「${topicName}」${messageSuffix}`,
      link: `/ai-radar/topic/${topicId}`,
      metadata: { topicId, missionKind, itemCount },
    });
  }
}
