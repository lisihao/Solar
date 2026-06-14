'use client';

/**
 * TeamRosterPanel — SVG team-topology visualization
 *
 * 完全照搬 Topic Insights 的 TopicTeamPanel 视觉：
 *  - Section header (uppercase tracking-wide)
 *  - SVG TeamTopologyCanvas with avatar nodes + bezier connections
 *  - Per-role detail card (live thoughts, tasks, latency)
 *  - Bottom progress bar + consensus quality
 */

import { useEffect, useMemo, useState } from 'react';
import { Brain, Search, GitBranch, PenLine, Gavel } from 'lucide-react';
import {
  TeamTopologyCanvas,
  type TeamTopologyNode,
  type TeamTopologyConnection,
  type TeamNodeStatus,
} from '@/components/common/team-topology';
import {
  AgentInspector,
  type AgentInspectorAgent,
} from '@/components/common/agent-inspector';
import {
  MissionActionGroup,
  MissionControlCard,
  type MissionActionButtonSpec,
} from '@/components/common/mission-detail';
import { useBudgetTiers, pickTier } from '@/hooks/features/useBudgetTiers';
import type { BudgetTier } from '@/services/agent-playground/api';
import { cn } from '@/lib/utils/common';
import type {
  AgentLiveState,
  AgentRole,
  StageState,
  StageId,
} from '@/lib/features/agent-playground/mission-presentation.types';

const ROLE_ROW: {
  role: AgentRole;
  stage: StageId;
  label: string;
  rowIdx: number;
}[] = [
  // 完全照搬 TI 拓扑：Leader → N Researchers → [Reviewer, Writer]
  // analyst 仍在 pipeline 执行，只是不在网络图绘出（避免 fan-in 乱线）
  { role: 'leader', stage: 'leader', label: 'Leader', rowIdx: 0 },
  {
    role: 'researcher',
    stage: 'researchers',
    label: 'Research Team',
    rowIdx: 1,
  },
  { role: 'reviewer', stage: 'reviewer', label: 'Reviewer', rowIdx: 2 },
  { role: 'writer', stage: 'writer', label: 'Writer', rowIdx: 2 },
];

const ROLE_COLOR_KEY: Record<AgentRole, string> = {
  leader: 'purple',
  researcher: 'blue',
  analyst: 'amber',
  writer: 'rose',
  reviewer: 'emerald',
};

const ROLE_AVATAR: Record<AgentRole, string> = {
  leader: 'leader',
  researcher: 'researcher',
  analyst: 'analyst',
  writer: 'writer',
  reviewer: 'reviewer',
};

const ROLE_ICON: Record<AgentRole, typeof Brain> = {
  leader: Brain,
  researcher: Search,
  analyst: GitBranch,
  writer: PenLine,
  reviewer: Gavel,
};

function stageStatusToNodeStatus(s: StageState['status']): TeamNodeStatus {
  if (s === 'running') return 'working';
  if (s === 'done') return 'completed';
  if (s === 'failed') return 'failed';
  return 'idle';
}

const CollapseIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 9V5m0 0H5m4 0L4 10m11-1V5m0 0h4m-4 0l5 5M9 15v4m0 0H5m4 0l-5-5m11 5l5-5m-5 5v-4m0 4h4"
    />
  </svg>
);

interface Props {
  agents: AgentLiveState[];
  stages: StageState[];
  finalScore?: number;
  topic?: string;
  /** mission 维度（从 leader stage 输出，用于左下任务列表） */
  dimensions?: { id?: string; name: string; rationale?: string }[];
  /**
   * 「任务进度」真实任务计数（来自 todo ledger，与「任务列表 共 N 项」同源）。
   * 提供时进度按"已完成任务 / 总任务"显示；缺省回退到流水线阶段计数（向后兼容）。
   */
  taskProgress?: { completed: number; total: number };
  /** mission 当前状态 — 决定按钮显示 */
  missionStatus?: 'running' | 'completed' | 'failed' | 'cancelled' | 'idle';
  depth?: 'quick' | 'standard' | 'deep' | string;
  language?: string;
  maxCredits?: number;
  onCollapse?: () => void;
  /** 点击 Leader 节点时触发（详情页用来打开 LeaderChatModal） */
  onLeaderClick?: () => void;
  /** 点击 Research Team 节点时触发（展开 group 内部 micro-pipeline） */
  onResearchTeamClick?: () => void;
  /** 重新运行（用相同配置开新 mission） */
  onRerun?: () => void;
  /** 用相同 topic 进入新建表单（编辑配置后再跑） */
  onUpdate?: () => void;
  /** 取消运行中的 mission（暂未实现 → undefined） */
  onCancel?: () => void;
  /**
   * 用户在面板里切换研究深度时上抛 —— 父层把它存起来，下次点「开始」时
   * 用此 depth + 对应 tier 预设（maxCredits / wallTimeMinutes / budgetMultiplier
   * 等）通过 runTeam 起新 mission（而不是 rerunMission 沿用原 depth）。
   * 不传 = 卡片仍可点切高亮，但只是本地预览，"开始/更新"按钮维持原行为。
   */
  onDepthChange?: (depth: 'quick' | 'standard' | 'deep') => void;
  /**
   * 2026-05-13 #67: 当前 mission 是否有 checkpoint 可续跑（后台重启 / 早爆 /
   * 用户取消保留断点 → 都会进入 resumable）。true 时「更新」按钮 label 变
   * "继续上次" + tooltip 提示 + 上方加 hint banner。
   */
  isResumable?: boolean;
}

export function TeamRosterPanel({
  agents,
  stages,
  finalScore,
  dimensions,
  taskProgress,
  missionStatus = 'idle',
  depth,
  language,
  maxCredits,
  onCollapse,
  onLeaderClick,
  onResearchTeamClick,
  onRerun,
  onUpdate,
  onCancel,
  onDepthChange,
  isResumable = false,
}: Props) {
  const stageMap = useMemo(
    () => new Map(stages.map((s) => [s.id, s])),
    [stages]
  );
  const [selectedRole, setSelectedRole] = useState<AgentRole | null>(null);
  // 默认展开 Research Team group → 让用户能看到每个 Researcher#N 节点
  const [groupExpanded, setGroupExpanded] = useState(true);
  // 研究深度选择 — 本地 UI state。点 3 张卡片：
  //  1) 立刻把"预算 / 维度提示 / 时长上限"等显示项联动到该 tier 的预设值
  //  2) 通过 onDepthChange 上抛父层，"开始"按钮可用新 tier 起新 mission
  // depth prop 变化（切换到不同 mission）时同步本地选择。
  const [selectedDepth, setSelectedDepth] = useState<
    BudgetTier['depth'] | undefined
  >(depth as BudgetTier['depth'] | undefined);
  useEffect(
    () => setSelectedDepth(depth as BudgetTier['depth'] | undefined),
    [depth]
  );
  // 拉后端单一源的 tier 表（quick/standard/deep 三档）；模块级缓存只请求一次
  const { data: tierData } = useBudgetTiers();
  const currentTier = pickTier(tierData, selectedDepth ?? 'standard');
  // 与原 mission depth 不一致时，提示"开始"会以新 tier 重新跑
  const depthChanged = !!selectedDepth && !!depth && selectedDepth !== depth;

  const { nodes, connections, rows, viewBoxHeight, rowYPositions } =
    useMemo(() => {
      const nodes: TeamTopologyNode[] = [];
      const rowMap: Record<number, string[]> = {
        0: [], // Leader
        1: [], // Research Team (group OR expanded researchers)
        2: [], // Analyst / Writer / Reviewer 横排
      };
      // researcher 实例节点 ids（展开时 fan-out / fan-in 用）
      const researcherInstanceIds: string[] = [];
      const researcherAgentsAll = agents.filter((a) => a.role === 'researcher');
      const dimCount =
        dimensions && dimensions.length > 0
          ? dimensions.length
          : researcherAgentsAll.length;

      // ★ Screenshot_77 修复 (2026-05-27): 拓扑里每个 Agent 状态不一致
      //   ("一个待启动一个完成") — mission terminal 后, 某些 stage.status 还 'pending'
      //   或没有 agent 数据 → status='idle' → label "待启动", 与 mission "已完成"
      //   矛盾。在循环开头根据 missionStatus 决定 idle 该 promote 到 completed/failed。
      const isMissionTerminal =
        missionStatus === 'completed' ||
        missionStatus === 'failed' ||
        missionStatus === 'cancelled';
      const idleFallback: TeamNodeStatus =
        missionStatus === 'completed'
          ? 'completed'
          : missionStatus === 'failed'
            ? 'failed'
            : 'idle';
      for (const r of ROLE_ROW) {
        const stage = stageMap.get(r.stage);
        const roleAgents = agents.filter((a) => a.role === r.role);
        const rawStatus = stageStatusToNodeStatus(stage?.status ?? 'pending');
        // ★ Screenshot_80 修复 (2026-05-27): mission 终态时不只 idle 要 sweep,
        //   working 也要 — Leader 节点常在 mission 已完成但某 leader 子 stage 残留
        //   running 状态时显"运行中", 与"已完成"矛盾。
        const status =
          isMissionTerminal && (rawStatus === 'idle' || rawStatus === 'working')
            ? idleFallback
            : rawStatus;

        // ── Researcher：展开为 N 个独立节点 OR 折叠为 group ──
        if (r.role === 'researcher') {
          const completedAgents = roleAgents.filter(
            (a) => a.phase === 'completed'
          ).length;
          const failedAgents = roleAgents.filter(
            (a) => a.phase === 'failed'
          ).length;
          const runningAgents = roleAgents.filter(
            (a) => a.phase === 'running'
          ).length;
          const groupStatus: TeamNodeStatus =
            failedAgents > 0
              ? 'failed'
              : runningAgents > 0
                ? 'working'
                : roleAgents.length > 0 && completedAgents === roleAgents.length
                  ? 'completed'
                  : stageStatusToNodeStatus(stage?.status ?? 'pending');

          if (groupExpanded && (dimCount > 0 || roleAgents.length > 0)) {
            // 展开：每个维度 / 实例一个节点
            // 优先按 dimensions 顺序生成，没有 dimensions 时用 agents
            const list =
              dimensions && dimensions.length > 0
                ? dimensions.map((d, idx) => ({
                    id: `researcher#${idx}`,
                    name: d.name,
                    agent: roleAgents.find(
                      (a) =>
                        a.dimension === d.name ||
                        a.agentId === `researcher#${idx}`
                    ),
                  }))
                : roleAgents.map((a, idx) => ({
                    id: a.agentId ?? `researcher#${idx}`,
                    name: a.dimension ?? `维度 ${idx + 1}`,
                    agent: a,
                  }));
            for (const item of list) {
              const phase = item.agent?.phase ?? 'pending';
              const rawItemStatus: TeamNodeStatus =
                phase === 'completed'
                  ? 'completed'
                  : phase === 'failed'
                    ? 'failed'
                    : phase === 'running'
                      ? 'working'
                      : 'idle';
              // ★ Screenshot_77/80 修复: mission 终态时 idle + working 都需要 sweep, 让
              //   topology agent 状态与"已完成" mission 一致。
              const itemStatus: TeamNodeStatus =
                isMissionTerminal &&
                (rawItemStatus === 'idle' || rawItemStatus === 'working')
                  ? idleFallback
                  : rawItemStatus;
              const shortName =
                item.name.length > 8 ? item.name.slice(0, 7) + '…' : item.name;
              nodes.push({
                id: item.id,
                name: shortName,
                role: 'researcher',
                icon: ROLE_ICON.researcher,
                status: itemStatus,
                statusLabel:
                  itemStatus === 'working'
                    ? '调研中'
                    : itemStatus === 'completed'
                      ? // ★ 2026-05-06 (P1-E): dim agent.phase=completed 只表示研究阶段完成，
                        //   后续还有 chapter writing / grade / signoff，避免用户误以为整个
                        //   mission 完成。改成"研究完成"更精确。
                        '研究完成'
                      : itemStatus === 'failed'
                        ? '失败'
                        : '待启动',
                colorKey: ROLE_COLOR_KEY.researcher,
                avatarRole: ROLE_AVATAR.researcher,
              });
              researcherInstanceIds.push(item.id);
              rowMap[r.rowIdx].push(item.id);
            }
          } else {
            // 折叠：单一 group 节点
            nodes.push({
              id: 'research-team',
              name: '研究团队',
              role: 'researcher',
              icon: ROLE_ICON.researcher,
              status: groupStatus,
              statusLabel:
                groupStatus === 'working'
                  ? `${runningAgents} 调研中`
                  : groupStatus === 'completed'
                    ? // ★ 2026-05-06 (P1-E): 同上，"研究阶段完成"语义更精确
                      `${completedAgents}/${dimCount} 研究完成`
                    : groupStatus === 'failed'
                      ? `${failedAgents} 失败`
                      : dimCount > 0
                        ? `${dimCount} 维度`
                        : '待启动',
              colorKey: ROLE_COLOR_KEY.researcher,
              avatarRole: ROLE_AVATAR.researcher,
              taskProgress:
                dimCount > 0
                  ? { completed: completedAgents, total: dimCount }
                  : undefined,
            });
            researcherInstanceIds.push('research-team');
            rowMap[r.rowIdx].push('research-team');
          }
          continue;
        }

        // ── 其他角色：单节点 ──
        const completed = roleAgents.filter(
          (a) => a.phase === 'completed'
        ).length;
        nodes.push({
          id: r.role,
          name: r.label,
          role: r.role,
          icon: ROLE_ICON[r.role],
          status,
          statusLabel:
            status === 'working'
              ? '运行中'
              : status === 'completed'
                ? '完成'
                : undefined,
          colorKey: ROLE_COLOR_KEY[r.role],
          isLeader: r.role === 'leader',
          avatarRole: ROLE_AVATAR[r.role],
          taskProgress:
            roleAgents.length > 0
              ? { completed, total: roleAgents.length }
              : undefined,
        });
        rowMap[r.rowIdx].push(r.role);
      }

      // 完全照搬 TI 拓扑：Leader → 每个 Researcher (fan-out)，
      //                    Leader → Reviewer / Writer (直连)
      // analyst 仍在 pipeline 执行，但不在网络图绘出（避免乱线）
      const connections: TeamTopologyConnection[] = [];
      if (groupExpanded && researcherInstanceIds.length > 1) {
        for (const rid of researcherInstanceIds) {
          connections.push({ from: 'leader', to: rid });
        }
      } else {
        const groupId = researcherInstanceIds[0] ?? 'research-team';
        connections.push({ from: 'leader', to: groupId });
      }
      connections.push({ from: 'leader', to: 'reviewer' });
      connections.push({ from: 'leader', to: 'writer' });

      // 展开时拉高画布让 fan-out/fan-in 不挤
      const expanded = groupExpanded && researcherInstanceIds.length > 1;
      const vbh = expanded ? 240 : 200;
      const ryp = expanded ? [40, 130, 215] : [40, 110, 175];

      return {
        nodes,
        connections,
        rows: [rowMap[0], rowMap[1], rowMap[2]],
        viewBoxHeight: vbh,
        rowYPositions: ryp,
      };
    }, [agents, stageMap, dimensions, groupExpanded]);

  // 「任务进度」优先用真实任务计数（todo ledger，与「任务列表 共 N 项」同源），
  // 缺省回退流水线阶段计数。避免恒显"5/5"误导（5 是固定阶段数，非任务总数）。
  const completedStages = stages.filter((s) => s.status === 'done').length;
  const totalStages = stages.length;
  const progressCompleted = taskProgress?.completed ?? completedStages;
  const progressTotal = taskProgress?.total ?? totalStages;
  const overallPct =
    progressTotal > 0
      ? Math.round((progressCompleted / progressTotal) * 100)
      : 0;

  void selectedRole; // selection-driven detail rendered inside TeamTopologyCanvas

  // 底部 sticky 操作按钮 — 状态语义沿用原先：
  //  - "开始"(primary) / "更新|继续上次"(secondary, isResumable 时高亮 violet)
  //  - "取消"(danger, 只在 running 时启用)
  // 运行中 → 开始/更新 禁用，取消可用；终态 → 反之。
  const actionButtons: MissionActionButtonSpec[] = [];
  if (onRerun) {
    actionButtons.push({
      variant: 'primary',
      emoji: '▶',
      label: '开始',
      disabled: missionStatus === 'running',
      title: isResumable
        ? '重新从头开始（清 checkpoint）'
        : '用相同配置启动一个新 mission',
      onClick: onRerun,
    });
  }
  if (onUpdate) {
    actionButtons.push({
      variant: 'secondary',
      emoji: isResumable ? '↻' : '🔄',
      label: isResumable ? '继续上次' : '更新',
      disabled: missionStatus === 'running',
      emphasized: isResumable,
      title: isResumable
        ? '从上次 checkpoint 继续（跳过已完成 stage）'
        : '增量更新：保留已完成任务，只跑未完成维度',
      onClick: onUpdate,
    });
  }
  if (onCancel) {
    actionButtons.push({
      variant: 'danger',
      emoji: '⏹',
      label: '取消',
      disabled: missionStatus !== 'running',
      title:
        missionStatus === 'running'
          ? '取消运行中的 mission'
          : '只有运行中的 mission 可以取消',
      onClick: onCancel,
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Section header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          研究团队
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {agents.length} 个 Agent
          </span>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              title="Collapse panel"
            >
              <CollapseIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ★ 2026-05-25：团队阵型图常驻中段（flex-1 吸收余高，不滚动）。
          原"角色列表"与阵型图信息重复，已移除；header(顶) 与
          progress/操作按钮(底) 仍 shrink-0 常驻。 */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* SVG team topology canvas */}
        <div className="shrink-0 border-b border-gray-100 px-3 py-3">
          {/* 展开 / 折叠 切换 + Micro-pipeline 入口 */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setGroupExpanded((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
              title={
                groupExpanded
                  ? '折叠为单一 Research Team Group 节点'
                  : '展开 Research Team，查看每个 Researcher 实例'
              }
            >
              {groupExpanded ? '⊟ 折叠' : '⊞ 展开'} Research
            </button>
            {onResearchTeamClick && (
              <button
                type="button"
                onClick={onResearchTeamClick}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                title="打开 Micro Pipeline（章节流水线 + 5-axis 评分）"
              >
                Micro Pipeline →
              </button>
            )}
          </div>
          <TeamTopologyCanvas
            nodes={nodes}
            rows={rows}
            connections={connections}
            heightClass={viewBoxHeight === 240 ? 'h-[240px]' : 'h-[200px]'}
            viewBoxHeight={viewBoxHeight}
            rowYPositions={rowYPositions}
            patternId="agent-playground"
            renderDetail={(node, onClose) => {
              const close = () => {
                onClose();
                setSelectedRole(null);
              };
              // 折叠态：点 group → 打开 micro-pipeline modal
              if (node.id === 'research-team' && onResearchTeamClick) {
                close();
                onResearchTeamClick();
                return null;
              }
              // 展开态：点单个 researcher#N 节点 → 打开该实例的 inspector
              if (node.id.startsWith('researcher#')) {
                const researcher = agents.find((a) => a.agentId === node.id);
                if (researcher) {
                  const agentData = buildAgentInspectorPayload(
                    'researcher',
                    [researcher],
                    stageMap.get('researchers')
                  );
                  // 覆盖 displayName 显示具体维度
                  const enriched = {
                    ...agentData,
                    name: `${agentData.name} · ${researcher.dimension ?? node.name}`,
                  };
                  return (
                    <AgentInspector
                      open
                      onClose={close}
                      mode="modal"
                      agent={enriched}
                    />
                  );
                }
              }
              const role = node.role as AgentRole;
              const agentData = buildAgentInspectorPayload(
                role,
                agents.filter((a) => a.role === role),
                stageMap.get(
                  ROLE_ROW.find((r) => r.role === role)?.stage ?? 'leader'
                )
              );
              return (
                <AgentInspector
                  open
                  onClose={close}
                  mode="modal"
                  agent={agentData}
                  onChat={
                    role === 'leader' && onLeaderClick
                      ? () => {
                          close();
                          onLeaderClick();
                        }
                      : undefined
                  }
                  chatLabel="与 Leader 对话"
                />
              );
            }}
            renderTooltip={(node) => {
              const isResearcherInst = node.id.startsWith('researcher#');
              const inst = isResearcherInst
                ? agents.find((a) => a.agentId === node.id)
                : undefined;
              return (
                <div className="text-xs">
                  <div className="font-semibold text-gray-800">{node.name}</div>
                  <div className="mt-0.5 text-gray-500">
                    {inst?.dimension
                      ? inst.dimension
                      : node.taskProgress
                        ? `${node.taskProgress.completed} / ${node.taskProgress.total} done`
                        : (node.statusLabel ?? 'Idle')}
                  </div>
                  {inst?.modelId && (
                    <div className="font-mono mt-0.5 text-[10px] text-gray-400">
                      {inst.modelId}
                    </div>
                  )}
                </div>
              );
            }}
          />
        </div>
      </div>
      {/* /阵型图中段 */}

      {/* Progress + 运行配置 — shrink-0 固定，不随角色列表滚动；与下面
          MissionActionGroup 一起组成 aside 底部"操作区" */}
      <div className="shrink-0 border-t border-gray-100 bg-gray-50/50 px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="font-medium text-gray-700">任务进度</span>
          <span className="flex items-center gap-1.5">
            {missionStatus === 'cancelled' && (
              <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
                已取消
              </span>
            )}
            {missionStatus === 'failed' && (
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                已失败
              </span>
            )}
            {missionStatus === 'completed' && (
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                已完成
              </span>
            )}
            {missionStatus === 'running' && (
              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                进行中
              </span>
            )}
            <span className="font-mono text-gray-500">
              {progressCompleted} / {progressTotal}
            </span>
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all"
            style={{ width: `${overallPct}%` }}
          />
        </div>
        {finalScore != null && (
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="font-medium text-gray-700">共识质量</span>
            <span
              className={`font-mono font-semibold ${
                finalScore >= 80
                  ? 'text-emerald-600'
                  : finalScore >= 60
                    ? 'text-amber-600'
                    : 'text-red-600'
              }`}
            >
              {finalScore} / 100
            </span>
          </div>
        )}

        {/* 显示当前 mission 关联的 dimensions 数 */}
        {dimensions && dimensions.length > 0 && (
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="font-medium text-gray-700">研究维度</span>
            <span className="font-mono text-gray-500">
              {dimensions.length} 个
            </span>
          </div>
        )}

        {/* 2026-05-13 #67: 可续跑提示 —— 替代 homepage banner，让"继续上次"入口
            出现在用户真正按按钮的地方 */}
        {isResumable && missionStatus !== 'running' && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] text-violet-900">
            <span className="mt-0.5 text-violet-600">↻</span>
            <span>
              <span className="font-medium">上次运行中断</span>
              ，点「
              <span className="font-medium">继续上次</span>
              」从 checkpoint 续跑（跳过已完成 stage）；点「开始」会重新从头跑。
            </span>
          </div>
        )}

        {/* 操作按钮：开始 / 更新 / 取消 —— 完全照搬 TI TopicTeamPanel 尺寸 + 样式 */}
        {(depth || language || maxCredits != null) && (
          <MissionControlCard
            title="运行配置"
            statusLabel={
              missionStatus === 'running'
                ? '进行中'
                : missionStatus === 'completed'
                  ? '已完成'
                  : missionStatus === 'failed'
                    ? '已失败'
                    : missionStatus === 'cancelled'
                      ? '已取消'
                      : '待启动'
            }
            statusTone={
              missionStatus === 'running'
                ? 'blue'
                : missionStatus === 'completed'
                  ? 'green'
                  : missionStatus === 'failed'
                    ? 'red'
                    : 'gray'
            }
          >
            {depth && (
              <div className="mb-3">
                <div className="mb-1 text-xs font-medium text-gray-500">
                  研究深度
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      { key: 'quick', label: '快速', desc: '基础搜索' },
                      { key: 'standard', label: '标准', desc: '平衡覆盖' },
                      { key: 'deep', label: '深度', desc: '完整链路' },
                    ] as const
                  ).map((option) => {
                    const selected = selectedDepth === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => {
                          setSelectedDepth(option.key);
                          onDepthChange?.(option.key);
                        }}
                        className={cn(
                          'rounded-md px-2 py-1.5 text-center text-xs transition-colors',
                          selected
                            ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                            : 'cursor-pointer bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-700 hover:ring-1 hover:ring-blue-200'
                        )}
                      >
                        <div className="font-medium">{option.label}</div>
                        <div className="mt-0.5 whitespace-nowrap text-[10px] opacity-70">
                          {option.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {(language || maxCredits != null || currentTier) && (
              <div className="space-y-1 text-[11px] text-gray-600">
                {language && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">语言</span>
                    <span className="font-mono text-gray-500">{language}</span>
                  </div>
                )}
                {/* 维度提示 — 来自该 tier 的 dimensionsHint（如"3-4 维度"） */}
                {currentTier?.dimensionsHint && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">研究维度</span>
                    <span
                      className={cn(
                        'font-mono',
                        depthChanged ? 'text-blue-600' : 'text-gray-500'
                      )}
                    >
                      {currentTier.dimensionsHint}
                    </span>
                  </div>
                )}
                {/* 预算 — 改 depth 时跟随 tier.maxCredits；未改时仍读 mission 的实际预算 */}
                {(currentTier?.maxCredits != null || maxCredits != null) && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">预算</span>
                    <span
                      className={cn(
                        'font-mono',
                        depthChanged ? 'text-blue-600' : 'text-gray-500'
                      )}
                    >
                      {(depthChanged
                        ? currentTier?.maxCredits
                        : (maxCredits ?? currentTier?.maxCredits)
                      )?.toLocaleString()}{' '}
                      credits
                    </span>
                  </div>
                )}
                {/* 时长上限 — 一并展示 tier 预设，方便用户判断 */}
                {currentTier?.wallTimeMinutes != null && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">时长上限</span>
                    <span
                      className={cn(
                        'font-mono',
                        depthChanged ? 'text-blue-600' : 'text-gray-500'
                      )}
                    >
                      {currentTier.wallTimeMinutes} 分钟
                    </span>
                  </div>
                )}
                {depthChanged && (
                  <p className="mt-1 rounded-md bg-blue-50 px-2 py-1 text-[10px] leading-snug text-blue-700">
                    已选「{currentTier?.label ?? selectedDepth}
                    」档位 — 点「开始」会以新档位的预算 / 维度 / 时长起一个新
                    mission。
                  </p>
                )}
              </div>
            )}
          </MissionControlCard>
        )}
      </div>

      {/* 底部操作按钮 — 与 SocialMissionPage 一致，使用 canonical
          MissionActionGroup；shrink-0 + 独立 border-t，与上方 progress
          区一起常驻 aside 底部。 */}
      {actionButtons.length > 0 && (
        <div className="shrink-0 border-t border-gray-200 bg-white px-3 py-3">
          {/* 2026-06-12：失联/失败且无断点时，在按钮区就地说明恢复路径——
              此前 liveness 文案指向不存在的"顶部重新运行按钮"造成用户找不到入口 */}
          {missionStatus === 'failed' && !isResumable && (
            <p className="mb-2 rounded-md bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-700">
              本次运行已失败且未找到可续跑断点 —
              点「开始」用相同配置从头重跑；「更新」保留已完成任务做增量重跑。
            </p>
          )}
          <MissionActionGroup buttons={actionButtons} />
        </div>
      )}
    </div>
  );
}

/** 每个角色的能力 profile（来自 backend 各 .agent.ts 的定义） */
const ROLE_PROFILE: Record<
  AgentRole,
  {
    displayName: string;
    description: string;
    loop: string;
    modelHint: string;
    skills: string[];
    tools: string[];
    verifiers?: string[];
  }
> = {
  leader: {
    displayName: 'Research Leader',
    description: '分析 topic 并拆分研究维度，规划 mission 整体执行链路',
    loop: 'ReAct',
    modelHint: 'planning · 系统配置 CHAT 模型（BYOK）',
    skills: ['topic-decomposition', 'planning'],
    tools: [],
  },
  researcher: {
    displayName: 'Dimension Researcher',
    description:
      '并行调研每个维度，搜集证据、提取 findings、产出 dimension summary',
    loop: 'ReAct',
    modelHint: 'search · 系统配置 CHAT 模型（BYOK）',
    skills: ['evidence-gathering'],
    tools: ['web-search', 'arxiv-search', 'github-search', 'web-scraper'],
  },
  analyst: {
    displayName: 'Research Analyst',
    description: '整合多维度发现，做交叉验证、矛盾消解、洞察归纳',
    loop: 'Reflexion',
    modelHint: 'reasoning · 系统配置 CHAT 模型（BYOK）',
    skills: ['critical-review'],
    tools: [],
    verifiers: ['self', 'critical'],
  },
  writer: {
    displayName: 'Report Writer',
    description:
      '把 insights 写成结构化 Markdown 报告，outputSchema 失败自动 retry',
    loop: 'ReAct',
    modelHint: 'long-form · 系统配置 CHAT 模型（BYOK）',
    skills: [],
    tools: [],
  },
  reviewer: {
    displayName: 'Quality Reviewer',
    description: '调用多个 Judge 并行评分，达成共识；< 70 分会触发 Writer 重写',
    loop: 'JudgeConsensus',
    modelHint: 'judge × 3 · 系统配置 CHAT 模型（BYOK）',
    skills: [],
    tools: [],
  },
};

export function buildAgentInspectorPayload(
  role: AgentRole,
  agents: AgentLiveState[],
  stage?: StageState
): AgentInspectorAgent {
  const Icon = ROLE_ICON[role];
  const profile = ROLE_PROFILE[role];
  const running = agents.filter((a) => a.phase === 'running').length;
  const done = agents.filter((a) => a.phase === 'completed').length;
  const failed = agents.filter((a) => a.phase === 'failed').length;
  const totalIters = agents.reduce((s, a) => s + (a.iterations ?? 0), 0);

  let recentThought: string | undefined;
  for (let i = agents.length - 1; i >= 0 && !recentThought; i--) {
    const trace = agents[i].trace;
    for (let j = trace.length - 1; j >= 0; j--) {
      if (trace[j].kind === 'thought' && trace[j].text) {
        recentThought = trace[j].text;
        break;
      }
    }
  }

  // ★ Screenshot_81/82/83 (2026-05-27 #110 续):
  //   用户反馈"没必要同一页显示两个状态" — 删掉顶部 statusLabel/Color,
  //   只保留下方 instanceCounts row 作单一数据源 (running/completed/failed/iter)。
  //   原 stage.status 派生的 statusLabel 与 agent.phase 累计的 counts.completed
  //   race-window 期间不一致, 现在彻底消除"两个状态"。
  const statusLabel = undefined;
  const statusColorClass = undefined;

  return {
    name: profile.displayName,
    description: profile.description,
    icon: Icon,
    iconClassName: 'bg-violet-50 text-violet-600',
    statusLabel,
    statusColorClass,
    totalInstances: agents.length,
    instanceCounts: {
      running,
      completed: done,
      failed,
      iterations: totalIters,
    },
    config: [
      { label: 'Loop', value: profile.loop },
      { label: '模型', value: profile.modelHint },
      { label: '技能', chips: profile.skills },
      { label: '工具', chips: profile.tools },
      ...(profile.verifiers && profile.verifiers.length > 0
        ? [{ label: 'Verifier', chips: profile.verifiers }]
        : []),
    ],
    recentThought,
  };
}
