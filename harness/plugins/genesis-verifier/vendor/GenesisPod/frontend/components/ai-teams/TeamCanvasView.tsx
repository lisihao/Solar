'use client';

import { useMemo, useState, useCallback } from 'react';
import {
  TeamMission,
  AgentTask,
  TopicAIMember,
  MissionStatus,
  AgentTaskStatus,
} from '@/lib/types/ai-teams';

interface TeamCanvasViewProps {
  mission: TeamMission | null;
  aiMembers: TopicAIMember[];
  typingAIs: Set<string>;
  onAgentClick?: (agent: TopicAIMember) => void;
  onTaskClick?: (task: AgentTask) => void;
}

// Agent node colors based on status
const getAgentStatusColor = (
  isLeader: boolean,
  isWorking: boolean,
  hasCompletedTasks: boolean,
  hasActiveTasks: boolean
): { bg: string; border: string; glow: string } => {
  if (isWorking) {
    return {
      bg: 'fill-blue-500',
      border: 'stroke-blue-600',
      glow: 'drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]',
    };
  }
  if (isLeader) {
    return {
      bg: 'fill-purple-500',
      border: 'stroke-purple-600',
      glow: 'drop-shadow-[0_0_6px_rgba(168,85,247,0.4)]',
    };
  }
  if (hasCompletedTasks) {
    return {
      bg: 'fill-green-500',
      border: 'stroke-green-600',
      glow: '',
    };
  }
  if (hasActiveTasks) {
    return {
      bg: 'fill-yellow-500',
      border: 'stroke-yellow-600',
      glow: '',
    };
  }
  return {
    bg: 'fill-gray-400',
    border: 'stroke-gray-500',
    glow: '',
  };
};

// Task connection colors
const getTaskConnectionColor = (status: AgentTaskStatus): string => {
  switch (status) {
    case 'IN_PROGRESS':
      return 'stroke-blue-400';
    case 'COMPLETED':
      return 'stroke-green-400';
    case 'AWAITING_REVIEW':
      return 'stroke-purple-400';
    case 'REVISION_NEEDED':
      return 'stroke-orange-400';
    case 'BLOCKED':
      return 'stroke-red-400';
    default:
      return 'stroke-gray-300';
  }
};

// Professional hierarchical layout for embedded view
function calculateNodePositions(
  leaderId: string | null,
  agents: TopicAIMember[],
  width: number,
  height: number,
  tasksByAgent?: Map<string, AgentTask[]>
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const centerX = width / 2;

  // Find leader and workers
  const leader = agents.find((a) => a.id === leaderId);
  const workers = agents.filter((a) => a.id !== leaderId);

  // Position leader at top-center
  const leaderY = 55;
  if (leader) {
    positions.set(leader.id, { x: centerX, y: leaderY });
  }

  // Smart layout for workers
  const workerCount = workers.length;
  if (workerCount > 0) {
    // Sort by activity level
    const sortedWorkers = [...workers].sort((a, b) => {
      const aTasks = tasksByAgent?.get(a.id) || [];
      const bTasks = tasksByAgent?.get(b.id) || [];
      const aActive = aTasks.some((t) => t.status === 'IN_PROGRESS')
        ? 2
        : aTasks.length > 0
          ? 1
          : 0;
      const bActive = bTasks.some((t) => t.status === 'IN_PROGRESS')
        ? 2
        : bTasks.length > 0
          ? 1
          : 0;
      return bActive - aActive;
    });

    const minSpacing = 90;
    const maxNodesPerRow = Math.max(
      2,
      Math.min(4, Math.floor((width - 60) / minSpacing))
    );
    const nodesPerRow = Math.min(workerCount, maxNodesPerRow);
    const totalRows = Math.ceil(workerCount / nodesPerRow);
    const verticalSpacing = 100;
    const startY = leaderY + 100;

    sortedWorkers.forEach((worker, index) => {
      const row = Math.floor(index / nodesPerRow);
      const col = index % nodesPerRow;
      const nodesInThisRow =
        row === totalRows - 1
          ? workerCount - (totalRows - 1) * nodesPerRow
          : nodesPerRow;

      const actualSpacing = Math.min(
        minSpacing,
        (width - 60) / (nodesInThisRow + 1)
      );
      const rowWidth = (nodesInThisRow - 1) * actualSpacing;
      const rowStartX = centerX - rowWidth / 2;

      const x = rowStartX + col * actualSpacing;
      const y = startY + row * verticalSpacing;
      positions.set(worker.id, { x, y });
    });
  }

  return positions;
}

export default function TeamCanvasView({
  mission,
  aiMembers,
  typingAIs,
  onAgentClick,
  onTaskClick,
}: TeamCanvasViewProps) {
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const [hoveredTask, setHoveredTask] = useState<string | null>(null);
  const [canvasSize] = useState({ width: 400, height: 350 });

  // Get tasks grouped by agent (moved up for use in layout)
  const tasksByAgent = useMemo(() => {
    const map = new Map<string, AgentTask[]>();
    if (mission?.tasks) {
      mission.tasks.forEach((task) => {
        const existing = map.get(task.assignedToId) || [];
        existing.push(task);
        map.set(task.assignedToId, existing);
      });
    }
    return map;
  }, [mission?.tasks]);

  // Calculate agent positions with task awareness
  const nodePositions = useMemo(() => {
    return calculateNodePositions(
      mission?.leaderId || null,
      aiMembers,
      canvasSize.width,
      canvasSize.height,
      tasksByAgent
    );
  }, [mission?.leaderId, aiMembers, canvasSize, tasksByAgent]);

  // Get agent stats
  const getAgentStats = useCallback(
    (agentId: string) => {
      const tasks = tasksByAgent.get(agentId) || [];
      const completed = tasks.filter((t) => t.status === 'COMPLETED').length;
      const inProgress = tasks.filter((t) => t.status === 'IN_PROGRESS').length;
      const total = tasks.length;
      return { completed, inProgress, total };
    },
    [tasksByAgent]
  );

  // Render connections (task flows)
  const renderConnections = () => {
    if (!mission?.tasks || !mission.leaderId) return null;

    const leaderPos = nodePositions.get(mission.leaderId);
    if (!leaderPos) return null;

    return mission.tasks.map((task) => {
      const agentPos = nodePositions.get(task.assignedToId);
      if (!agentPos) return null;

      const isHovered =
        hoveredTask === task.id || hoveredAgent === task.assignedToId;
      const connectionColor = getTaskConnectionColor(task.status);

      // Calculate control point for curved line
      const midX = (leaderPos.x + agentPos.x) / 2;
      const midY = (leaderPos.y + agentPos.y) / 2 - 20;

      return (
        <g key={task.id}>
          {/* Connection line */}
          <path
            d={`M ${leaderPos.x} ${leaderPos.y + 20} Q ${midX} ${midY} ${agentPos.x} ${agentPos.y - 20}`}
            className={`${connectionColor} fill-none transition-all duration-300 ${
              isHovered ? 'stroke-[3]' : 'stroke-[1.5]'
            } ${task.status === 'IN_PROGRESS' ? 'animate-pulse' : ''}`}
            strokeDasharray={task.status === 'PENDING' ? '4 4' : 'none'}
            onMouseEnter={() => setHoveredTask(task.id)}
            onMouseLeave={() => setHoveredTask(null)}
            onClick={() => onTaskClick?.(task)}
            style={{ cursor: 'pointer' }}
          />
          {/* Arrow head */}
          <circle
            cx={agentPos.x}
            cy={agentPos.y - 20}
            r="3"
            className={`${connectionColor.replace('stroke-', 'fill-')}`}
          />
        </g>
      );
    });
  };

  // Render agent nodes with improved name display
  const renderAgentNodes = () => {
    return aiMembers.map((agent) => {
      const pos = nodePositions.get(agent.id);
      if (!pos) return null;

      const isLeader = agent.id === mission?.leaderId;
      const isWorking = typingAIs.has(agent.id);
      const stats = getAgentStats(agent.id);
      const statusColors = getAgentStatusColor(
        isLeader,
        isWorking,
        stats.completed > 0,
        stats.inProgress > 0
      );
      const isHovered = hoveredAgent === agent.id;
      // Increased node sizes
      const nodeRadius = isLeader ? 32 : 28;

      // Smart name parsing for better display
      const fullName = agent.displayName || 'Agent';
      const cleanName = fullName.replace(/^AI-/i, '');
      const nameParts = cleanName.split(/[\s-_]+/);
      const primaryName =
        nameParts[0].length > 8 ? nameParts[0].slice(0, 8) : nameParts[0];
      const secondaryName =
        nameParts.length > 1 ? nameParts.slice(1).join(' ').slice(0, 8) : null;

      return (
        <g
          key={agent.id}
          transform={`translate(${pos.x}, ${pos.y})`}
          onMouseEnter={() => setHoveredAgent(agent.id)}
          onMouseLeave={() => setHoveredAgent(null)}
          onClick={() => onAgentClick?.(agent)}
          style={{ cursor: 'pointer' }}
        >
          {/* Glow effect for active agents */}
          {(isWorking || isLeader) && (
            <circle
              r={nodeRadius + 8}
              className={`${statusColors.bg} opacity-20 ${
                isWorking ? 'animate-ping' : ''
              }`}
            />
          )}

          {/* Outer ring */}
          <circle
            r={nodeRadius + 4}
            className={`fill-white opacity-90 ${isHovered ? 'opacity-100' : ''}`}
            style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }}
          />

          {/* Main circle */}
          <circle
            r={nodeRadius}
            className={`${statusColors.bg} ${statusColors.border} stroke-2 transition-all duration-300 ${
              statusColors.glow
            } ${isHovered ? 'scale-105' : ''}`}
            style={{
              transformOrigin: 'center',
              transform: isHovered ? 'scale(1.05)' : 'scale(1)',
            }}
          />

          {/* Agent initial - larger */}
          <text
            textAnchor="middle"
            dy="0.35em"
            className="fill-white font-bold"
            style={{ fontSize: isLeader ? '16px' : '14px' }}
          >
            {cleanName.charAt(0).toUpperCase()}
          </text>

          {/* Leader crown */}
          {isLeader && (
            <text
              textAnchor="middle"
              y={-nodeRadius - 10}
              style={{ fontSize: '14px' }}
            >
              👑
            </text>
          )}

          {/* Agent name - Two-line display */}
          <g transform={`translate(0, ${nodeRadius + 12})`}>
            <text
              textAnchor="middle"
              className="fill-gray-800 font-semibold"
              style={{ fontSize: '11px' }}
            >
              {primaryName}
            </text>
            {secondaryName && (
              <text
                textAnchor="middle"
                y="12"
                className="fill-gray-500"
                style={{ fontSize: '9px' }}
              >
                {secondaryName}
              </text>
            )}
          </g>

          {/* Task count badge - larger */}
          {stats.total > 0 && (
            <g transform={`translate(${nodeRadius - 4}, ${-nodeRadius + 4})`}>
              <circle
                r="12"
                className="fill-white"
                style={{
                  stroke:
                    stats.completed === stats.total
                      ? '#22c55e'
                      : stats.inProgress > 0
                        ? '#3b82f6'
                        : '#d1d5db',
                  strokeWidth: 2,
                }}
              />
              <text
                textAnchor="middle"
                dy="0.35em"
                className={`font-bold ${
                  stats.completed === stats.total
                    ? 'fill-green-600'
                    : stats.inProgress > 0
                      ? 'fill-blue-600'
                      : 'fill-gray-600'
                }`}
                style={{ fontSize: '10px' }}
              >
                {stats.completed}/{stats.total}
              </text>
            </g>
          )}

          {/* Working indicator with ripple */}
          {isWorking && (
            <g transform={`translate(${-nodeRadius + 4}, ${-nodeRadius + 4})`}>
              <circle r="8" className="animate-pulse fill-blue-500" />
              <circle r="3" className="fill-white" />
            </g>
          )}
        </g>
      );
    });
  };

  // No mission state
  if (!mission) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <div className="mb-3 text-4xl">🎨</div>
        <p className="text-sm text-gray-500">
          创建一个任务后，这里将展示 AI 团队的协作视图
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-100 px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600">
            {mission.title}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              mission.status === 'IN_PROGRESS'
                ? 'bg-blue-100 text-blue-700'
                : mission.status === 'COMPLETED'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-600'
            }`}
          >
            {mission.status === 'IN_PROGRESS'
              ? '执行中'
              : mission.status === 'COMPLETED'
                ? '已完成'
                : mission.status === 'PLANNING'
                  ? '规划中'
                  : mission.status}
          </span>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-hidden">
        <svg
          viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
          className="h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Background grid */}
          <defs>
            <pattern
              id="grid"
              width="20"
              height="20"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 20 0 L 0 0 0 20"
                fill="none"
                stroke="#f0f0f0"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Connections */}
          {renderConnections()}

          {/* Agent nodes */}
          {renderAgentNodes()}
        </svg>
      </div>

      {/* Legend */}
      <div className="border-t border-gray-100 px-3 py-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-purple-500"></div>
            <span>Leader</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500"></div>
            <span>工作中</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-green-500"></div>
            <span>已完成</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-gray-400"></div>
            <span>空闲</span>
          </div>
        </div>
      </div>

      {/* Hovered agent/task info - positioned near the node */}
      {hoveredAgent &&
        (() => {
          const agent = aiMembers.find((a) => a.id === hoveredAgent);
          const stats = getAgentStats(hoveredAgent);
          const nodePos = nodePositions.get(hoveredAgent);
          if (!agent || !nodePos) return null;

          // Calculate tooltip position based on node position
          // Convert SVG coordinates to percentage for positioning
          const tooltipX = (nodePos.x / canvasSize.width) * 100;
          const tooltipY = (nodePos.y / canvasSize.height) * 100;

          // Determine if tooltip should show above or below the node
          const showAbove = tooltipY > 40;

          return (
            <div
              className="pointer-events-none absolute z-10 max-w-[180px] rounded-lg bg-white/95 p-2 shadow-lg backdrop-blur"
              style={{
                left: `${Math.min(Math.max(tooltipX, 25), 75)}%`,
                top: showAbove ? `${tooltipY - 15}%` : `${tooltipY + 20}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <div className="text-xs">
                <div className="font-medium text-gray-900">
                  {agent.displayName}
                  {agent.id === mission.leaderId && (
                    <span className="ml-1 text-purple-600">👑 Leader</span>
                  )}
                </div>
                {stats.total > 0 && (
                  <div className="mt-1 text-gray-500">
                    任务: {stats.completed}/{stats.total} 完成
                    {stats.inProgress > 0 && `, ${stats.inProgress} 执行中`}
                  </div>
                )}
                {agent.expertiseAreas && agent.expertiseAreas.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {agent.expertiseAreas.slice(0, 3).map((area) => (
                      <span
                        key={area}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600"
                      >
                        {area}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
    </div>
  );
}
