'use client';

/**
 * Research Team Panel - SVG Star Topology
 *
 * 星型拓扑团队可视化:
 * - Leader (👑) 在中心
 * - 维度研究员 (🔍) 围绕 Leader
 * - 质量审核 (✅) 和 报告撰写 (📊) 在底部
 *
 * 功能:
 * - 点击 Agent 弹出详情
 * - 悬停显示 Tooltip
 * - 每个 Agent 有唯一名称
 */

import { useMemo } from 'react';
import { Award } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import {
  TeamTopologyCanvas,
  AVATAR_ROW_Y,
  type TeamTopologyNode,
  type TeamTopologyConnection,
  type TeamTopologyLegendItem,
} from '@/components/common/team-topology';
import type {
  AgentInfo,
  TeamInfo,
  MissionStatus,
} from '@/services/topic-insights/api';

/**
 * ★ 类型守卫：验证是否为非空字符串数组
 * 防止后端返回无效数据导致渲染错误
 */
function isValidStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (item) => typeof item === 'string' && item.trim().length > 0
  );
}

interface ResearchTeamPanelProps {
  teamInfo: TeamInfo | null;
  missionStatus: MissionStatus | null;
  isRefreshing: boolean;
}

// Agent 节点完整信息（用于弹窗显示）
interface AgentNodeInfo {
  id: string;
  type: string;
  name: string;
  role: string;
  status: AgentInfo['status'];
  x: number;
  y: number;
  icon: string;
  color: typeof agentColors.leader;
  description?: string;
  capabilities?: string[];
  note?: string;
  currentTask?: string;
  completedTasks?: number;
  totalTasks?: number;
  /** ★ Agent 使用的 AI 模型名称 */
  model?: string;
  /** ★ v8.0: Leader 分配给此 Agent 的技能 */
  skills?: string[];
  /** ★ v8.0: Leader 分配给此 Agent 的工具 */
  tools?: string[];
}

// Agent 颜色配置
const agentColors = {
  leader: { bg: '#8B5CF6', text: '#FFFFFF', glow: '#C4B5FD' }, // 紫色
  dimension_researcher: { bg: '#3B82F6', text: '#FFFFFF', glow: '#93C5FD' }, // 蓝色
  quality_reviewer: { bg: '#10B981', text: '#FFFFFF', glow: '#6EE7B7' }, // 绿色
  report_writer: { bg: '#F59E0B', text: '#FFFFFF', glow: '#FCD34D' }, // 橙色
};

// Agent 图标
const agentIcons = {
  leader: '👑',
  dimension_researcher: '🔍',
  quality_reviewer: '✅',
  report_writer: '📊',
};

export function ResearchTeamPanel({
  teamInfo,
  missionStatus,
  isRefreshing,
}: ResearchTeamPanelProps) {
  const { t } = useI18n();

  // Agent 角色信息映射
  const agentRoleInfo = useMemo(
    () => ({
      leader: {
        name: t(
          'topicResearch.researchControl.teamPanel.agentRoles.leader.name'
        ),
        description: t(
          'topicResearch.researchControl.teamPanel.agentRoles.leader.description'
        ),
        capabilities: ['智能规划', '任务协调', '质量把控', '结果整合'],
        note: t(
          'topicResearch.researchControl.teamPanel.agentRoles.leader.note'
        ),
      },
      dimension_researcher: {
        name: t(
          'topicResearch.researchControl.teamPanel.agentRoles.dimensionResearcher.name'
        ),
        description: t(
          'topicResearch.researchControl.teamPanel.agentRoles.dimensionResearcher.description'
        ),
        capabilities: ['信息检索', '内容分析', '报告撰写'],
        note: t(
          'topicResearch.researchControl.teamPanel.agentRoles.dimensionResearcher.note'
        ),
      },
      quality_reviewer: {
        name: t(
          'topicResearch.researchControl.teamPanel.agentRoles.qualityReviewer.name'
        ),
        description: t(
          'topicResearch.researchControl.teamPanel.agentRoles.qualityReviewer.description'
        ),
        capabilities: ['质量审核', '一致性检查', '准确性验证'],
        note: t(
          'topicResearch.researchControl.teamPanel.agentRoles.qualityReviewer.note'
        ),
      },
      report_writer: {
        name: t(
          'topicResearch.researchControl.teamPanel.agentRoles.reportWriter.name'
        ),
        description: t(
          'topicResearch.researchControl.teamPanel.agentRoles.reportWriter.description'
        ),
        capabilities: ['内容整合', '报告生成', '格式优化'],
        note: t(
          'topicResearch.researchControl.teamPanel.agentRoles.reportWriter.note'
        ),
      },
    }),
    [t]
  );

  // Build topology data
  const { topoNodes, rows, connections, legendItems, agentNodeInfoMap } =
    useMemo(() => {
      const agents = teamInfo?.agents || [];
      const researchers = agents.filter(
        (a) => a.type === 'dimension_researcher'
      );
      const reviewers = agents.filter((a) => a.type === 'quality_reviewer');
      const writers = agents.filter((a) => a.type === 'report_writer');

      const infoMap = new Map<string, AgentNodeInfo>();
      const nodeList: TeamTopologyNode[] = [];

      // Leader
      const leaderInfo = agentRoleInfo.leader;
      const leaderId = 'leader';
      nodeList.push({
        id: leaderId,
        name: 'Leader',
        role: leaderInfo.name,
        icon: agentIcons.leader,
        status: isRefreshing ? 'working' : 'idle',
        colorKey: 'purple',
        isLeader: true,
        avatarRole: 'leader',
      });
      infoMap.set(leaderId, {
        id: leaderId,
        type: 'leader',
        name: 'Leader',
        role: leaderInfo.name,
        status: isRefreshing ? 'working' : 'idle',
        x: 0,
        y: 0,
        icon: agentIcons.leader,
        color: agentColors.leader,
        description: leaderInfo.description,
        capabilities: leaderInfo.capabilities,
        note: leaderInfo.note,
        model:
          teamInfo?.leaderModel ||
          missionStatus?.leaderModelId ||
          missionStatus?.leaderModelName ||
          undefined,
      });

      // Researchers
      const researcherCount = Math.max(researchers.length, 4);
      const researcherInfo = agentRoleInfo.dimension_researcher;
      const researcherIds: string[] = [];
      for (let i = 0; i < researcherCount; i++) {
        const researcher = researchers[i];
        const id = researcher?.id || `researcher_${i}`;
        const dimensionName = researcher?.assignedDimensions?.[0];
        researcherIds.push(id);

        nodeList.push({
          id,
          name: `研究员${i + 1}`,
          role: dimensionName || researcherInfo.name,
          icon: agentIcons.dimension_researcher,
          status: researcher?.status || 'idle',
          colorKey: 'blue',
          avatarRole: 'dimension_researcher',
        });
        infoMap.set(id, {
          id,
          type: 'dimension_researcher',
          name: `研究员${i + 1}`,
          role: dimensionName || researcherInfo.name,
          status: researcher?.status || 'idle',
          x: 0,
          y: 0,
          icon: agentIcons.dimension_researcher,
          color: agentColors.dimension_researcher,
          description: dimensionName
            ? t(
                'topicResearch.researchControl.teamPanel.agentRoles.dimensionResearcher.assignedTo',
                { dimension: dimensionName }
              )
            : researcherInfo.description,
          capabilities: researcherInfo.capabilities,
          note: researcherInfo.note,
          currentTask: dimensionName,
          model: researcher?.model,
          skills: researcher?.skills,
          tools: researcher?.tools,
        });
      }

      // Quality reviewer
      const reviewer = reviewers[0];
      const reviewerInfo = agentRoleInfo.quality_reviewer;
      const reviewerId = reviewer?.id || 'reviewer';
      nodeList.push({
        id: reviewerId,
        name: '审核',
        role: reviewerInfo.name,
        icon: agentIcons.quality_reviewer,
        status: reviewer?.status || 'idle',
        colorKey: 'green',
        avatarRole: 'quality_reviewer',
      });
      infoMap.set(reviewerId, {
        id: reviewerId,
        type: 'quality_reviewer',
        name: '审核',
        role: reviewerInfo.name,
        status: reviewer?.status || 'idle',
        x: 0,
        y: 0,
        icon: agentIcons.quality_reviewer,
        color: agentColors.quality_reviewer,
        description: reviewerInfo.description,
        capabilities: reviewerInfo.capabilities,
        note: reviewerInfo.note,
        model: reviewer?.model,
        skills: reviewer?.skills,
        tools: reviewer?.tools,
      });

      // Report writer
      const writer = writers[0];
      const writerInfo = agentRoleInfo.report_writer;
      const writerId = writer?.id || 'writer';
      nodeList.push({
        id: writerId,
        name: '撰写',
        role: writerInfo.name,
        icon: agentIcons.report_writer,
        status: writer?.status || 'idle',
        colorKey: 'orange',
        avatarRole: 'report_writer',
      });
      infoMap.set(writerId, {
        id: writerId,
        type: 'report_writer',
        name: '撰写',
        role: writerInfo.name,
        status: writer?.status || 'idle',
        x: 0,
        y: 0,
        icon: agentIcons.report_writer,
        color: agentColors.report_writer,
        description: writerInfo.description,
        capabilities: writerInfo.capabilities,
        note: writerInfo.note,
        model: writer?.model,
        skills: writer?.skills,
        tools: writer?.tools,
      });

      // Rows: [leader] → [researchers] → [reviewer, writer]
      const rowList: string[][] = [
        [leaderId],
        researcherIds,
        [reviewerId, writerId],
      ];

      // Connections: leader → researchers, leader → reviewer/writer
      const connList: TeamTopologyConnection[] = [];
      researcherIds.forEach((rid) =>
        connList.push({ from: leaderId, to: rid })
      );
      connList.push({ from: leaderId, to: reviewerId });
      connList.push({ from: leaderId, to: writerId });

      const legend: TeamTopologyLegendItem[] = [
        {
          color: 'bg-blue-500',
          label: t('topicResearch.researchControl.teamPanel.legend.inProgress'),
          animated: true,
        },
        {
          color: 'bg-green-500',
          label: t('topicResearch.researchControl.teamPanel.legend.completed'),
        },
        {
          color: 'bg-gray-400',
          label: t('topicResearch.researchControl.teamPanel.legend.idle'),
        },
      ];

      return {
        topoNodes: nodeList,
        rows: rowList,
        connections: connList,
        legendItems: legend,
        agentNodeInfoMap: infoMap,
      };
    }, [teamInfo, missionStatus, isRefreshing, agentRoleInfo, t]);

  return (
    <div className="flex h-full flex-col">
      {/* Team Title */}
      <div className="border-b border-gray-100 px-3 py-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t('topicResearch.researchControl.teamPanel.title')}
        </h4>
        {teamInfo?.leaderModel && (
          <p className="mt-0.5 text-xs text-gray-400">
            {t('topicResearch.researchControl.teamPanel.leaderModel', {
              model: teamInfo.leaderModel,
            })}
          </p>
        )}
      </div>

      {/* SVG Canvas */}
      <div className="flex-1 overflow-hidden">
        <TeamTopologyCanvas
          nodes={topoNodes}
          rows={rows}
          connections={connections}
          heightClass="h-[280px]"
          viewBoxHeight={280}
          rowYPositions={[...AVATAR_ROW_Y]}
          patternId="research-star"
          legendItems={legendItems}
          renderTooltip={(node) => {
            const info = agentNodeInfoMap.get(node.id);
            if (!info) return null;
            return (
              <div className="text-xs">
                <div className="flex items-center gap-1 font-medium text-gray-900">
                  {info.icon} {info.name}
                  {info.type === 'leader' && (
                    <Award className="ml-1 h-3 w-3 text-purple-600" />
                  )}
                </div>
                <div className="mt-0.5 text-gray-500">{info.role}</div>
                {info.currentTask && (
                  <div className="mt-1 truncate text-blue-600">
                    {t(
                      'topicResearch.researchControl.teamPanel.agentDetail.currentTask'
                    )}{' '}
                    {info.currentTask}
                  </div>
                )}
                <div className="mt-1 text-gray-400">
                  {t(
                    'topicResearch.researchControl.teamPanel.agentDetail.clickToView'
                  )}
                </div>
              </div>
            );
          }}
          renderDetail={(node, onClose) => {
            const info = agentNodeInfoMap.get(node.id);
            if (!info) return null;
            return <ResearchAgentDetailModal agent={info} onClose={onClose} />;
          }}
        />
      </div>
    </div>
  );
}

// Agent 详情弹窗组件
function ResearchAgentDetailModal({
  agent,
  onClose,
}: {
  agent: AgentNodeInfo;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const statusText = {
    idle: t('topicResearch.researchControl.teamPanel.agentDetail.statusIdle'),
    working: t(
      'topicResearch.researchControl.teamPanel.agentDetail.statusWorking'
    ),
    completed: t(
      'topicResearch.researchControl.teamPanel.agentDetail.statusCompleted'
    ),
    failed: t(
      'topicResearch.researchControl.teamPanel.agentDetail.statusFailed'
    ),
  };

  const statusColor = {
    idle: 'bg-gray-100 text-gray-700',
    working: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-xs rounded-xl border border-gray-200 bg-white shadow-xl">
        {/* 头部 */}
        <div
          className="rounded-t-xl px-4 py-3"
          style={{ backgroundColor: `${agent.color.bg}15` }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{agent.icon}</span>
              <div>
                <h3 className="font-semibold text-gray-900">
                  {agent.name}
                  {agent.type === 'leader' && (
                    <Award className="ml-1 h-4 w-4 text-purple-500" />
                  )}
                </h3>
                <p className="text-xs text-gray-500">{agent.role}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="p-4">
          {/* 状态 */}
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {t('topicResearch.researchControl.teamPanel.agentDetail.status')}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${statusColor[agent.status]}`}
            >
              {statusText[agent.status]}
            </span>
          </div>

          {/* 描述 */}
          {agent.description && (
            <div className="mb-3">
              <p className="text-xs text-gray-500">
                {t(
                  'topicResearch.researchControl.teamPanel.agentDetail.responsibilities'
                )}
              </p>
              <p className="mt-1 text-sm text-gray-700">{agent.description}</p>
            </div>
          )}

          {/* ★ v8.0: 技能 - 优先显示 Leader 分配的真实技能 */}
          {(() => {
            // ★ 使用类型守卫验证数据有效性
            const realSkills = isValidStringArray(agent.skills)
              ? agent.skills
              : undefined;
            const realTools = isValidStringArray(agent.tools)
              ? agent.tools
              : undefined;
            const hasRealData = !!realSkills || !!realTools;

            return (
              <>
                {/* 技能 */}
                <div className="mb-3">
                  <p className="text-xs text-gray-500">
                    {hasRealData
                      ? t(
                          'topicResearch.researchControl.teamPanel.agentDetail.assignedSkills'
                        )
                      : t(
                          'topicResearch.researchControl.teamPanel.agentDetail.capabilities'
                        )}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {realSkills ? (
                      realSkills.map((skill, i) => (
                        <span
                          key={i}
                          className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                        >
                          {skill}
                        </span>
                      ))
                    ) : agent.capabilities && agent.capabilities.length > 0 ? (
                      agent.capabilities.map((cap: string, i: number) => (
                        <span
                          key={i}
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                        >
                          {cap}
                        </span>
                      ))
                    ) : (
                      <span className="italic text-gray-400">
                        {t(
                          'topicResearch.researchControl.teamPanel.agentDetail.pendingAssignment'
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {/* 工具 - 仅当有真实数据时显示 */}
                {realTools && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-500">
                      {t(
                        'topicResearch.researchControl.teamPanel.agentDetail.assignedTools'
                      )}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {realTools.map((tool, i) => (
                        <span
                          key={i}
                          className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 配置说明 - 仅当没有真实数据时显示 */}
                {!hasRealData && agent.note && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-500">
                      {t(
                        'topicResearch.researchControl.teamPanel.agentDetail.configMethod'
                      )}
                    </p>
                    <p className="mt-1 text-xs italic text-gray-600">
                      {agent.note}
                    </p>
                  </div>
                )}
              </>
            );
          })()}

          {/* ★ AI 模型 - 始终显示，帮助用户了解使用哪个模型 */}
          <div className="mb-3">
            <p className="text-xs text-gray-500">
              {t('topicResearch.researchControl.teamPanel.agentDetail.aiModel')}
            </p>
            <p className="mt-1 text-sm font-medium text-purple-600">
              {agent.model ||
                t(
                  'topicResearch.researchControl.teamPanel.agentDetail.modelNotSpecified'
                )}
            </p>
          </div>

          {/* 当前任务 */}
          {agent.currentTask && (
            <div className="rounded-lg bg-blue-50 p-2">
              <p className="text-xs text-blue-600">
                {t(
                  'topicResearch.researchControl.teamPanel.agentDetail.currentTask'
                )}{' '}
                {agent.currentTask}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
