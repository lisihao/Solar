/**
 * MissionKit 注册表（前端能力发现层）。
 *
 * 规范：docs/architecture/frontend/mission-ui-capability-architecture.md §4。
 *
 * 像后端 MissionPipelineRegistry 一样可注册、可发现、可解析：任何页面拿到
 * mission-type（如 workflow SKU 的 missionType）即可 resolveMissionKit(type)
 * 取出 L4 成品组件渲染，不依赖 playground。新增能力 = 加一行登记。
 *
 * DetailComponent 收 `{ data: unknown }`：注册表对契约形状保持开放，各 kit 的
 * L4 入口在内部把 data 收窄成自己的 view（deep-insight 即 DeepInsightMissionView）。
 */

import type { FC } from 'react';
import { DeepInsightMissionDetail } from './deep-insight/DeepInsightMissionDetail';
import type { DeepInsightMissionView } from './deep-insight/contract';

export interface MissionKit {
  /** 能力类型键（= workflow SKU 的 missionType，如 'deep-insight'）。 */
  type: string;
  /** 展示名。 */
  label: string;
  /** L4 成品组件，唯一对外入口。 */
  DetailComponent: FC<{ data: unknown }>;
}

/**
 * deep-insight kit 的 DetailComponent 适配：注册表暴露 `{ data: unknown }`，
 * 这里把 unknown 直通给吃 DeepInsightMissionView 的 L4（调用方负责喂归一契约）。
 */
const DeepInsightDetail: FC<{ data: unknown }> = ({ data }) => (
  <DeepInsightMissionDetail data={data as DeepInsightMissionView} />
);

const MISSION_KITS: Record<string, MissionKit> = {
  'deep-insight': {
    type: 'deep-insight',
    label: '深度洞察',
    DetailComponent: DeepInsightDetail,
  },
};

/** 按 mission-type 解析 MissionKit；未注册返回 undefined。 */
export function resolveMissionKit(type: string): MissionKit | undefined {
  return MISSION_KITS[type];
}

/** 列出所有已注册 kit（市场 / 调试用）。 */
export function listMissionKits(): MissionKit[] {
  return Object.values(MISSION_KITS);
}
