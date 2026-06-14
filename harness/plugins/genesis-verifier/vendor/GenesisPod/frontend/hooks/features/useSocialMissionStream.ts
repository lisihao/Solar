'use client';

/**
 * useSocialMissionStream — SocialPublishMission 事件流（标准 21 / social 打样）。
 *
 * 自 2026-05-21 起改为通用 `useMissionStream` 的薄封装：namespace=`/social`，
 * replay 走 `replaySocialMission`（GET /ai-social/tasks/mission/:id/replay），
 * acceptEvent 只收 `social.*`。补齐了原实现缺的 replay 水合 + polling 兜底（解决
 * 刷新/加载页面事件全空）。
 */

import { replaySocialMission } from '@/services/ai-social/mission-replay';
import { useMissionStream, type MissionEvent } from './useMissionStream';

/** 向后兼容别名 */
export type SocialMissionEvent = MissionEvent;

export function useSocialMissionStream(missionId: string | null) {
  return useMissionStream(missionId, {
    namespace: '/social',
    replay: replaySocialMission,
    acceptEvent: (type) => type.startsWith('social.'),
  });
}
