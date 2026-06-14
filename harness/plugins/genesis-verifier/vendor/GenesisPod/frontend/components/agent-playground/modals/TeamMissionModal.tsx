'use client';

/**
 * TeamMissionModal —— "研究团队" / Mission DAG 弹窗。
 *
 * 2026-05-26 重构(用户拍板"自上而下完整 mission DAG"):
 *   - 旧版"每维度一行 6-stage 卡片列表"被彻底替换为基于后端 GET /dag 的
 *     完整 Mission DAG SVG 可视化(MissionDagView)。
 *   - 后端 MissionDagService 给出节点/边/状态/rerunable;前端只负责 layout + SVG。
 *   - 互动:hover 节点 → ↻ 级联重跑预览 + ○ ReAct 内部循环(P2);点节点本体 →
 *     原 onAgentClick(详情抽屉)继续可用。
 *   - dimensions / agents / pipelines props 保留为可选(给来调用方做 fallback /
 *     WS 增量覆盖,Phase 2 可能用到),但本组件不再消费它们。
 */

import { Modal } from '@/components/ui/dialogs/Modal';
import { MissionDagView } from '../dag/MissionDagView';
import type {
  AgentLiveState,
  DimensionPipelineState,
} from '@/lib/features/agent-playground/mission-presentation.types';

interface Props {
  open: boolean;
  onClose: () => void;
  missionId: string;
  /** 点节点 → 详情抽屉(沿用旧 callback) */
  onAgentClick?: (taskKey: string) => void;
  /** 父级事件流变化信号(传 events.length),驱动 MissionDagView 节流 1s 重拉 /dag */
  liveSignal?: number;
  /** 旧 props 保留兼容(Phase 1+2 不使用) */
  dimensions?: { id?: string; name: string; rationale?: string }[];
  agents?: AgentLiveState[];
  pipelines?: Map<string, DimensionPipelineState>;
}

export function TeamMissionModal({
  open,
  onClose,
  missionId,
  onAgentClick,
  liveSignal,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mission DAG"
      subtitle="完整执行图 · 节点 hover 出 ↻ 重跑预览 / ○ 内部循环 双按钮"
      size="full"
    >
      <MissionDagView
        missionId={missionId}
        onAgentClick={onAgentClick}
        liveSignal={liveSignal}
      />
    </Modal>
  );
}
