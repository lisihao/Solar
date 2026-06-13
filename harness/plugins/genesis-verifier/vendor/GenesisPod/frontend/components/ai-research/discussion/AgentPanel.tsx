'use client';

/**
 * AgentPanel - Research team SVG hexagon visualization
 *
 * Left panel showing:
 * 1. Header: team title + legend
 * 2. SVG Canvas: hexagon layout with 6 agent nodes, Bezier connections
 * 3. Agent status list (idle/speaking/searching/writing)
 * 4. Research directions (after ideation phase)
 *
 * Follows PlanTeamPanel pattern but uses Lucide icons via foreignObject
 */

import { useMemo, useState } from 'react';
import {
  Crown,
  Search,
  BarChart3,
  PenLine,
  ShieldCheck,
  Info,
  ChevronDown,
  ChevronUp,
  X,
  Play,
  RotateCw,
  Square,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import {
  TeamTopologyCanvas,
  type TeamTopologyNode,
  type TeamTopologyConnection,
  type TeamTopologyLegendItem,
} from '@/components/common/team-topology';
import type {
  DiscussionMessage,
  DiscussionPhase,
  DiscussionRole,
} from '@/hooks';

// ---- Props ----

interface AgentPanelProps {
  messages: DiscussionMessage[];
  typingAgent: { role: string; name: string } | null;
  directions: string[];
  currentPhase: DiscussionPhase;
  /** Whether research is currently running */
  isActive?: boolean;
  /** Whether a previous session exists (enables Continue) */
  hasSession?: boolean;
  /** Start new research */
  onStart?: () => void;
  /** Continue / re-run last research */
  onContinue?: () => void;
  /** Stop current research */
  onStop?: () => void;
}

// ---- Constants ----

const ROLE_ICONS: Record<string, LucideIcon> = {
  director: Crown,
  researcher: Search,
  analyst: BarChart3,
  writer: PenLine,
  reviewer: ShieldCheck,
};

const ICON_MAP: Record<string, LucideIcon> = {
  crown: Crown,
  search: Search,
  'bar-chart-3': BarChart3,
  'pen-line': PenLine,
  'shield-check': ShieldCheck,
  info: Info,
};

const ROLE_TAILWIND_BG: Record<DiscussionRole, string> = {
  director: 'bg-purple-500',
  researcher: 'bg-blue-500',
  analyst: 'bg-emerald-500',
  writer: 'bg-amber-500',
  reviewer: 'bg-rose-500',
  user: 'bg-indigo-500',
};

const ROLE_TAILWIND_TEXT: Record<DiscussionRole, string> = {
  director: 'text-purple-600',
  researcher: 'text-blue-600',
  analyst: 'text-emerald-600',
  writer: 'text-amber-600',
  reviewer: 'text-rose-600',
  user: 'text-indigo-600',
};

const ROLE_DESCRIPTIONS: Record<DiscussionRole, string> = {
  director: '统筹规划研究方向，协调团队讨论',
  researcher: '深度搜索和信息收集',
  analyst: '数据分析和交叉验证',
  writer: '撰写研究报告和摘要',
  reviewer: '质量审核和建议改进',
  user: '用户反馈和指导',
};

type AgentStatus = 'idle' | 'speaking' | 'searching' | 'writing';

interface AgentNode {
  role: DiscussionRole;
  name: string;
  icon: string;
  status: AgentStatus;
  posIndex: number;
}

// ---- Helpers ----

function getAgentStatus(
  role: DiscussionRole,
  typingAgent: { role: string; name: string } | null
): AgentStatus {
  if (!typingAgent) return 'idle';
  if (typingAgent.role === role) {
    if (role === 'researcher') return 'searching';
    if (role === 'writer') return 'writing';
    return 'speaking';
  }
  return 'idle';
}

function extractAgentNodes(
  messages: DiscussionMessage[],
  typingAgent: { role: string; name: string } | null
): AgentNode[] {
  const seen = new Map<string, AgentNode>();

  // Default layout order: director center, then ring
  const roleOrder: DiscussionRole[] = [
    'director',
    'researcher',
    'researcher',
    'researcher',
    'analyst',
    'writer',
    'reviewer',
  ];

  // Extract director first, then others, to ensure center positioning
  const directorMsgs: DiscussionMessage[] = [];
  const otherMsgs: DiscussionMessage[] = [];
  messages
    .filter((msg) => msg.messageType !== 'system')
    .forEach((msg) => {
      if (msg.agentRole === 'director') directorMsgs.push(msg);
      else otherMsgs.push(msg);
    });

  // Director always at index 0 (center)
  [...directorMsgs, ...otherMsgs].forEach((msg) => {
    const key = `${msg.agentRole}_${msg.agentName}`;
    if (!seen.has(key)) {
      seen.set(key, {
        role: msg.agentRole,
        name: msg.agentName,
        icon: msg.agentIcon,
        status: getAgentStatus(msg.agentRole, typingAgent),
        posIndex: seen.size,
      });
    }
  });

  // If we have agents, use them; otherwise use defaults
  if (seen.size > 0) {
    const nodes = Array.from(seen.values());
    return nodes.slice(0, 7).map((n, i) => ({ ...n, posIndex: i }));
  }

  return roleOrder.map((role, i) => ({
    role,
    name:
      role === 'researcher' ? `研究员 ${String.fromCharCode(65 + i - 1)}` : '',
    icon: '',
    status: 'idle' as AgentStatus,
    posIndex: i,
  }));
}

function getStatusLabel(status: AgentStatus): string {
  switch (status) {
    case 'speaking':
      return '发言中';
    case 'searching':
      return '搜索中';
    case 'writing':
      return '撰写中';
    default:
      return '待命';
  }
}

function getRoleCapabilities(role: DiscussionRole): string[] {
  const caps: Record<DiscussionRole, string[]> = {
    director: ['研究规划', '方向引导', '共识构建', '质量把控'],
    researcher: ['信息检索', '深度搜索', '来源分析', '数据收集'],
    analyst: ['数据分析', '交叉验证', '逻辑推理', '趋势识别'],
    writer: ['内容整合', '报告撰写', '结构组织', '文字润色'],
    reviewer: ['质量审核', '准确性验证', '一致性检查', '改进建议'],
    user: ['反馈指导', '方向调整'],
  };
  return caps[role] || [];
}

// ---- Main Component ----

export function AgentPanel({
  messages,
  typingAgent,
  directions,
  currentPhase: _currentPhase,
  isActive = false,
  hasSession = false,
  onStart,
  onContinue,
  onStop,
}: AgentPanelProps) {
  const [directionsExpanded, setDirectionsExpanded] = useState(true);

  const agents = extractAgentNodes(messages, typingAgent);
  const hasAgents = messages.length > 0;

  return (
    <div className="flex h-full flex-col bg-white">
      {/* SVG Canvas */}
      <div className="relative flex-shrink-0 border-b border-gray-100">
        {hasAgents ? (
          <AgentTeamCanvasView agents={agents} />
        ) : (
          <div className="flex h-[200px] flex-col items-center justify-center text-gray-400">
            <Crown className="mb-2 h-8 w-8 text-purple-300" />
            <p className="text-sm">等待研究开始</p>
            <p className="mt-1 text-xs">团队将在研究启动后显示</p>
          </div>
        )}
      </div>

      {/* Active Tasks List */}
      {hasAgents && (
        <div className="flex-shrink-0 border-b border-gray-100 px-4 py-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            实时状态
          </h4>
          <div className="space-y-1.5">
            {agents.map((agent) => {
              const Icon =
                ICON_MAP[agent.icon] || ROLE_ICONS[agent.role] || Info;
              const isActive = agent.status !== 'idle';
              return (
                <div
                  key={`${agent.role}_${agent.name}`}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                    isActive ? 'bg-blue-50/60' : 'bg-transparent'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full text-white',
                      ROLE_TAILWIND_BG[agent.role]
                    )}
                  >
                    <Icon className="h-3 w-3" />
                  </div>
                  <span className="flex-1 truncate font-medium text-gray-700">
                    {agent.name}
                  </span>
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      isActive ? 'animate-pulse bg-blue-500' : 'bg-gray-300'
                    )}
                  />
                  <span
                    className={cn(
                      'text-[10px]',
                      isActive ? 'font-medium text-blue-600' : 'text-gray-400'
                    )}
                  >
                    {getStatusLabel(agent.status)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Research Directions */}
      {directions.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <button
            onClick={() => setDirectionsExpanded(!directionsExpanded)}
            className="flex w-full items-center justify-between px-4 py-2 text-left"
          >
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              研究方向
            </h4>
            {directionsExpanded ? (
              <ChevronUp className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            )}
          </button>
          {directionsExpanded && (
            <div className="space-y-1.5 px-4 pb-4">
              {directions.map((direction, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50/50 p-2.5"
                >
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-purple-500 text-[10px] font-bold text-white">
                    {index + 1}
                  </span>
                  <span className="flex-1 text-xs leading-snug text-gray-700">
                    {direction}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Control Buttons */}
      {(onStart || onContinue || onStop) && (
        <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            {/* Start: new research */}
            <button
              onClick={onStart}
              disabled={isActive || !onStart}
              className={cn(
                'flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                isActive || !onStart
                  ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                  : 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
              )}
            >
              <Play className="h-3.5 w-3.5" />
              开始
            </button>

            {/* Continue: re-run last research */}
            <button
              onClick={onContinue}
              disabled={isActive || !hasSession || !onContinue}
              className={cn(
                'flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                isActive || !hasSession || !onContinue
                  ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                  : 'bg-green-600 text-white shadow-sm hover:bg-green-700'
              )}
            >
              <RotateCw className="h-3.5 w-3.5" />
              继续
            </button>

            {/* Stop: cancel current research */}
            <button
              onClick={onStop}
              disabled={!isActive || !onStop}
              className={cn(
                'flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                !isActive || !onStop
                  ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                  : 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
              )}
            >
              <Square className="h-3.5 w-3.5" />
              停止
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- SVG Team Canvas - Uses shared TeamTopologyCanvas ----

/** Map role → colorKey for the shared component */
const ROLE_COLOR_KEYS: Record<DiscussionRole, string> = {
  director: 'purple',
  researcher: 'blue',
  analyst: 'emerald',
  writer: 'amber',
  reviewer: 'rose',
  user: 'indigo',
};

function AgentTeamCanvasView({ agents }: { agents: AgentNode[] }) {
  const { nodes, rows, connections, legendItems } = useMemo(() => {
    const topoNodes: TeamTopologyNode[] = agents.map((agent, index) => {
      const Icon = ICON_MAP[agent.icon] || ROLE_ICONS[agent.role] || Info;
      const isActive = agent.status !== 'idle';
      return {
        id: `${agent.role}_${agent.name}_${index}`,
        name: agent.name.length > 6 ? agent.name.slice(0, 6) : agent.name,
        role: agent.role,
        icon: Icon, // Lucide component → will use foreignObject
        status: isActive ? ('working' as const) : ('idle' as const),
        statusLabel: isActive ? getStatusLabel(agent.status) : undefined,
        colorKey: ROLE_COLOR_KEYS[agent.role] || 'gray',
        isLeader: agent.role === 'director',
      };
    });

    // Build rows: director → researchers → [analyst, writer, reviewer]
    const director = topoNodes.find((n) => n.role === 'director');
    const researchers = topoNodes.filter((n) => n.role === 'researcher');
    const others = topoNodes.filter(
      (n) => n.role !== 'director' && n.role !== 'researcher'
    );

    const rowIds: string[][] = [];
    if (director) rowIds.push([director.id]);
    if (researchers.length > 0) rowIds.push(researchers.map((n) => n.id));
    if (others.length > 0) rowIds.push(others.map((n) => n.id));

    // Connect director → all others
    const conns: TeamTopologyConnection[] = [];
    if (director) {
      [...researchers, ...others].forEach((n) =>
        conns.push({ from: director.id, to: n.id })
      );
    }

    const legend: TeamTopologyLegendItem[] = [
      { color: 'bg-purple-500', label: '总监' },
      { color: 'bg-blue-500', label: '工作中', animated: true },
      { color: 'bg-gray-400', label: '待命' },
    ];

    return {
      nodes: topoNodes,
      rows: rowIds,
      connections: conns,
      legendItems: legend,
    };
  }, [agents]);

  return (
    <TeamTopologyCanvas
      nodes={nodes}
      rows={rows}
      connections={connections}
      patternId="discussion"
      legendItems={legendItems}
      renderTooltip={(node) => {
        const agent = agents.find((a) =>
          node.id.startsWith(`${a.role}_${a.name}`)
        );
        if (!agent) return null;
        const Icon = ICON_MAP[agent.icon] || ROLE_ICONS[agent.role] || Info;
        return (
          <div className="text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-gray-800">
              <Icon className={cn('h-3 w-3', ROLE_TAILWIND_TEXT[agent.role])} />
              {agent.name}
            </div>
            <div className="mt-0.5 text-gray-500">
              {ROLE_DESCRIPTIONS[agent.role]}
            </div>
          </div>
        );
      }}
      renderDetail={(node, onClose) => {
        const agent = agents.find((a) =>
          node.id.startsWith(`${a.role}_${a.name}`)
        );
        if (!agent) return null;

        const Icon = ICON_MAP[agent.icon] || ROLE_ICONS[agent.role] || Info;
        const statusLabel = getStatusLabel(agent.status);
        const isActive = agent.status !== 'idle';

        const bgColorMap: Record<DiscussionRole, string> = {
          director: 'bg-purple-50',
          researcher: 'bg-blue-50',
          analyst: 'bg-emerald-50',
          writer: 'bg-amber-50',
          reviewer: 'bg-rose-50',
          user: 'bg-indigo-50',
        };

        return (
          <>
            <div
              className="absolute inset-0 z-20 bg-black/10 backdrop-blur-sm"
              onClick={onClose}
            />
            <div className="absolute left-1/2 top-1/2 z-30 w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-full',
                      bgColorMap[agent.role]
                    )}
                  >
                    <Icon
                      className={cn('h-5 w-5', ROLE_TAILWIND_TEXT[agent.role])}
                    />
                  </div>
                  <div>
                    <div className="font-semibold text-gray-800">
                      {agent.name}
                    </div>
                    <span className="text-xs text-gray-500">
                      {ROLE_DESCRIPTIONS[agent.role]}
                    </span>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs text-gray-500">当前状态</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs',
                    isActive
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600'
                  )}
                >
                  {statusLabel}
                </span>
              </div>

              <div className="mb-3">
                <div className="mb-1 text-xs font-medium text-gray-500">
                  角色职责
                </div>
                <p className="text-sm text-gray-700">
                  {ROLE_DESCRIPTIONS[agent.role]}
                </p>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-medium text-gray-500">
                  能力标签
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {getRoleCapabilities(agent.role).map((cap) => (
                    <span
                      key={cap}
                      className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </>
        );
      }}
    />
  );
}
