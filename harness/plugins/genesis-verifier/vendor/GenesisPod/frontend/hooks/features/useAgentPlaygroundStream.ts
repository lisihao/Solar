'use client';

/**
 * useAgentPlaygroundStream — agent-playground 的 mission 事件流。
 *
 * 自标准 21 P1（2026-05-21）起改为 `useMissionStream` 的薄封装：playground 默认
 * （namespace='/playground'、replayMission、join/leave、含 '.' 前缀过滤），
 * 行为与旧实现一致；通用逻辑（双通道 / replay / dedup / polling 兜底）下沉到
 * useMissionStream，供 ai-teams 等复用。
 */

import { replayMission } from '@/services/agent-playground/api';
import { useMissionStream, type MissionEvent } from './useMissionStream';

/** 向后兼容别名：consumers 仍 import PlaygroundEvent */
export type PlaygroundEvent = MissionEvent;

export function useAgentPlaygroundStream(missionId: string | null) {
  return useMissionStream(missionId, {
    namespace: '/playground',
    replay: replayMission,
    // 默认 joinEvent='join' / leaveEvent='leave' / idKey='missionId' /
    // acceptEvent=(t)=>t.includes('.') —— 与旧实现完全一致
  });
}
