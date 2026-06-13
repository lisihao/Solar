/**
 * @genesis/lib/missions/derive — Mission 详情视图共享派生层（蓝图 §9.6）
 *
 * 各 feature（playground / social / radar / writing / topic-insights / office）的
 * mission 详情页都需要"事件流 → mission/stage/agent 视图"的派生。本目录提供
 * canonical 投影函数，让所有 feature 共享同一份归一化语义，方便 canonical
 * MissionDetailFrame / StageStepper / RoleCard 跨 feature 复用。
 *
 * 设计：
 *   - 纯函数、无 React 依赖
 *   - 不重做事件 reducer（feature 自己内部已有成熟版本）
 *   - 接受 feature 已派生的 mission/stage/agent 列表 → 归一化字符串状态 → canonical view
 *   - P28 各 feature 接入：1) 内部 derive 不动，2) page 渲染前 map 到 canonical
 */

export {
  deriveMissionView,
  isMissionTerminal,
  isMissionRunning,
} from './deriveMissionView';
export type {
  MissionView,
  MissionDeriveInput,
  CanonicalMissionStatus,
} from './deriveMissionView';

export { deriveStageView, stageProgress } from './deriveStageView';
export type {
  StageView,
  StageDeriveInput,
  CanonicalStageStatus,
} from './deriveStageView';

export { deriveAgentView, groupAgentsByRole } from './deriveAgentView';
export type {
  AgentView,
  AgentDeriveInput,
  CanonicalAgentPhase,
} from './deriveAgentView';
