'use client';

/**
 * useWritingStream — AI Writing mission event stream（薄封装 useMissionStream）
 *
 * namespace = "/ai-writing-mission"，room 按 missionId（writing:${missionId}）。
 * 后端 W1 gateway 接收 join/leave 事件，payload key = "missionId"。
 *
 * replay：writing 后端 replay 端点（GET /api/v1/ai-writing/replay/:id?since=）
 * 尚未实现（W1 待补 MissionEventBuffer adapter）。当前 hydrate 改为进页面后
 * 靠 useWritingMissionView 一次性拉 canonical view，WS 断线走 shouldPoll 兜底。
 * 等 backend replay 端点就绪后在 api.ts 解注释 writingReplay，传入 replay 参数即可。
 *
 * 事件过滤：acceptEvent = type.includes('writing.')，匹配所有 writing.* 事件。
 *
 * 关键坑（design doc §6 / §7）：
 *   - 后端事件类型前缀是 "writing."（含点），socket onAny handler 收到的 type 为
 *     "writing.stage:lifecycle" / "writing.agent:thought" 等 COLON 形态。
 *   - replay 端点不存在时传入一个 no-op stub，保证 useMissionStream 签名满足
 *     （不产生 404 / error log）。
 */

import { useMissionStream, type MissionEvent } from './useMissionStream';

/** 向后兼容别名：consumers 可 import WritingEvent */
export type WritingEvent = MissionEvent;

/**
 * No-op replay stub — 在 backend replay 端点尚未就绪时使用。
 * 返回空 events 列表，不发出任何网络请求。
 * 当 writingReplay 在 api.ts 实现后，将此处替换为真实 replay 函数。
 */
async function writingReplayStub(
  _missionId: string,
  _sinceTs?: number
): Promise<{ events: MissionEvent[] }> {
  return { events: [] };
}

export function useWritingStream(missionId: string | null) {
  return useMissionStream(missionId, {
    namespace: '/ai-writing-mission',
    replay: writingReplayStub,
    // joinEvent / leaveEvent / idKey 全用默认值（'join' / 'leave' / 'missionId'）
    // 与 backend writing-mission.gateway.ts @SubscribeMessage('join') 对齐
    acceptEvent: (type: string) => type.includes('writing.'),
  });
}
