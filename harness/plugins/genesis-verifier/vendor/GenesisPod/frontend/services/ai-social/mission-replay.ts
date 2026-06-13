import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import type { MissionEvent } from '@/hooks/features/useMissionStream';

/**
 * replaySocialMission — 拉取 social mission 累积事件（hydrate + polling 兜底）。
 * 镜像 agent-playground 的 replayMission；端点 = GET /ai-social/tasks/mission/:id/replay。
 */
const API_BASE = `${config.apiBaseUrl}/api/v1/ai-social/tasks`;

export async function replaySocialMission(
  missionId: string,
  sinceTs?: number
): Promise<{ events: MissionEvent[] }> {
  // 字符串拼接，不用 new URL —— 本地 apiBaseUrl 为空走 Next rewrites
  const qs =
    sinceTs != null ? `?since=${encodeURIComponent(String(sinceTs))}` : '';
  const res = await fetch(
    `${API_BASE}/mission/${encodeURIComponent(missionId)}/replay${qs}`,
    { headers: { ...getAuthHeader() } }
  );
  if (!res.ok) {
    throw new Error(`Failed to replay social mission: ${res.status}`);
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new Error('Failed to replay social mission: invalid JSON response');
  }
  // 兼容标准包裹（{ data: {...} }）与裸 { events, serverNow }
  const body = (
    raw && typeof raw === 'object' && 'data' in raw
      ? (raw as { data: unknown }).data
      : raw
  ) as { events?: unknown } | null;
  const events = body && Array.isArray(body.events) ? body.events : [];
  return { events: events as MissionEvent[] };
}
