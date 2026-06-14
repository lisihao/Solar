'use client';

/**
 * TeamTopologyCanvas - Unified SVG team visualization
 *
 * Reference: TopicTeamPanel (AI Insights) TeamCanvasView
 * Features:
 *  - Line grid background (M 20 0 L 0 0 0 20, stroke #f5f5f5)
 *  - Row-based adaptive layout
 *  - 6-layer SVG nodes: glow → white ring → colored circle → icon → name → status
 *  - Bezier curve connections (Q), status-aware styles
 *  - Hover tooltip with auto-flip
 *  - Click detail card (centered, 280px)
 *  - Bottom legend bar
 *  - Task progress badge (top-right corner)
 */

import { type ComponentType, useMemo, useState } from 'react';
import { cn } from '@/lib/utils/common';
import type { TeamTopologyCanvasProps, TeamTopologyNode } from './types';
import {
  TEAM_NODE_FILL_COLORS,
  TEAM_NODE_TEXT_COLORS,
  TEAM_STATUS_FILL,
  TEAM_STATUS_TEXT,
  NODE_RADIUS,
  AVATAR_SIZE,
  DEFAULT_VIEWBOX,
  DEFAULT_ROW_Y,
  DEFAULT_LEGEND_ITEMS,
} from './constants';
import { ROLE_AVATAR_MAP } from './avatars';

export function TeamTopologyCanvas({
  nodes,
  rows,
  connections,
  heightClass = 'h-[200px]',
  viewBoxHeight = DEFAULT_VIEWBOX.height,
  rowYPositions = [...DEFAULT_ROW_Y],
  patternId = 'team',
  legendItems = [...DEFAULT_LEGEND_ITEMS],
  renderDetail,
  renderTooltip,
}: TeamTopologyCanvasProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const viewBoxWidth = DEFAULT_VIEWBOX.width;

  // Build node positions from row layout
  const nodePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const centerX = viewBoxWidth / 2;

    rows.forEach((rowIds, rowIndex) => {
      const y = rowYPositions[rowIndex] ?? 40 + rowIndex * 60;
      const count = rowIds.length;

      if (count === 1) {
        positions.set(rowIds[0], { x: centerX, y });
      } else {
        const maxSpacing = 70;
        const spacing = Math.min(maxSpacing, (viewBoxWidth - 80) / (count + 1));
        const totalWidth = (count - 1) * spacing;
        const startX = centerX - totalWidth / 2;
        rowIds.forEach((id, i) => {
          positions.set(id, { x: startX + i * spacing, y });
        });
      }
    });

    return positions;
  }, [rows, rowYPositions, viewBoxWidth]);

  // Build node lookup
  const nodeMap = useMemo(() => {
    const map = new Map<string, TeamTopologyNode>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  // Render Bezier connections
  const renderConnections = () => {
    return connections.map((conn, idx) => {
      const fromPos = nodePositions.get(conn.from);
      const toPos = nodePositions.get(conn.to);
      if (!fromPos || !toPos) return null;

      const fromNode = nodeMap.get(conn.from);
      const toNode = nodeMap.get(conn.to);

      const isWorking =
        fromNode?.status === 'working' || toNode?.status === 'working';
      const isCompleted =
        fromNode?.status === 'completed' || toNode?.status === 'completed';
      const isIdle = !isWorking && !isCompleted;

      // Bezier control point
      const midX = (fromPos.x + toPos.x) / 2;
      const midY = (fromPos.y + toPos.y) / 2 - 10;

      // Offset: use avatar half-height for avatar nodes, radius for circle nodes
      const fromR =
        fromNode?.avatarRole && ROLE_AVATAR_MAP[fromNode.avatarRole]
          ? (fromNode.isLeader ? AVATAR_SIZE.leader : AVATAR_SIZE.member) / 2
          : fromNode?.isLeader
            ? NODE_RADIUS.leader
            : NODE_RADIUS.member;
      const toR =
        toNode?.avatarRole && ROLE_AVATAR_MAP[toNode.avatarRole]
          ? (toNode.isLeader ? AVATAR_SIZE.leader : AVATAR_SIZE.member) / 2
          : toNode?.isLeader
            ? NODE_RADIUS.leader
            : NODE_RADIUS.member;

      return (
        <path
          key={`conn-${idx}-${conn.from}-${conn.to}`}
          d={`M ${fromPos.x} ${fromPos.y + fromR} Q ${midX} ${midY} ${toPos.x} ${toPos.y - toR}`}
          className={cn(
            'fill-none transition-all duration-300',
            isWorking
              ? 'animate-pulse stroke-blue-400 stroke-[2]'
              : isCompleted
                ? 'stroke-green-400 stroke-[1.5]'
                : 'stroke-gray-200 stroke-[1]'
          )}
          strokeDasharray={isIdle ? '3 3' : 'none'}
        />
      );
    });
  };

  // Get fill color for a node
  const getNodeFillColor = (node: TeamTopologyNode): string => {
    if (node.status === 'working') return TEAM_STATUS_FILL.working;
    if (node.status === 'completed') return TEAM_STATUS_FILL.completed;
    if (node.status === 'error' || node.status === 'failed')
      return TEAM_STATUS_FILL.error;
    return TEAM_NODE_FILL_COLORS[node.colorKey] || 'fill-gray-400';
  };

  // Get text accent color class for avatar mode (currentColor driver)
  const getAccentTextClass = (node: TeamTopologyNode): string => {
    if (node.status === 'working') return TEAM_STATUS_TEXT.working;
    if (node.status === 'completed') return TEAM_STATUS_TEXT.completed;
    if (node.status === 'error' || node.status === 'failed')
      return TEAM_STATUS_TEXT.error;
    return TEAM_NODE_TEXT_COLORS[node.colorKey] || 'text-gray-400';
  };

  // Render nodes (6-layer rendering + avatar branch)
  const renderNodes = () => {
    return nodes.map((node) => {
      const pos = nodePositions.get(node.id);
      if (!pos) return null;

      const isHovered = hoveredNodeId === node.id;
      const isWorking = node.status === 'working';
      const isCompleted = node.status === 'completed';
      const isError = node.status === 'error' || node.status === 'failed';

      // Avatar path: resolve avatarRole → component
      const AvatarComponent = node.avatarRole
        ? ROLE_AVATAR_MAP[node.avatarRole]
        : undefined;

      if (AvatarComponent) {
        // ── Avatar rendering branch ──
        const avatarH = node.isLeader ? AVATAR_SIZE.leader : AVATAR_SIZE.member;
        const avatarW = avatarH * 0.6;
        const textClass = getAccentTextClass(node);

        return (
          <g
            key={node.id}
            transform={`translate(${pos.x}, ${pos.y})`}
            onMouseEnter={() => setHoveredNodeId(node.id)}
            onMouseLeave={() => setHoveredNodeId(null)}
            onClick={() => setSelectedNodeId(node.id)}
            style={{ cursor: 'pointer' }}
          >
            {/* Working glow (ellipse under feet) */}
            {isWorking && (
              <ellipse
                cx={0}
                cy={avatarH / 2 + 2}
                rx={avatarW / 2 + 4}
                ry={3}
                className="animate-ping fill-blue-400 opacity-25"
              />
            )}

            {/* Avatar via foreignObject (carries currentColor) */}
            <foreignObject
              x={-avatarW / 2}
              y={-avatarH / 2}
              width={avatarW}
              height={avatarH}
            >
              <div
                className={cn(
                  'flex h-full w-full items-center justify-center transition-transform duration-200',
                  textClass,
                  isHovered && 'scale-110'
                )}
                style={{ transformOrigin: 'center bottom' }}
              >
                <AvatarComponent
                  size={avatarH}
                  status={node.status}
                  isLeader={node.isLeader}
                />
              </div>
            </foreignObject>

            {/* Status badge (top-right): completed ✓ or error ✗ — skip when taskProgress is present to avoid overlap */}
            {(isCompleted || isError) &&
              !(node.taskProgress && node.taskProgress.total > 0) && (
                <>
                  <circle
                    cx={avatarW / 2 - 2}
                    cy={-avatarH / 2 + 4}
                    r="5"
                    className={isCompleted ? 'fill-green-500' : 'fill-red-500'}
                  />
                  {isCompleted && (
                    <path
                      d={`M ${avatarW / 2 - 5} ${-avatarH / 2 + 4} l 2 2 l 3 -3`}
                      stroke="#FFF"
                      strokeWidth="1.2"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {isError && (
                    <g
                      transform={`translate(${avatarW / 2 - 2}, ${-avatarH / 2 + 4})`}
                    >
                      <line
                        x1="-2"
                        y1="-2"
                        x2="2"
                        y2="2"
                        stroke="#FFF"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                      <line
                        x1="2"
                        y1="-2"
                        x2="-2"
                        y2="2"
                        stroke="#FFF"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </g>
                  )}
                </>
              )}

            {/* Name label (below avatar) */}
            <text
              textAnchor="middle"
              y={avatarH / 2 + 12}
              className="fill-gray-700 font-medium"
              style={{ fontSize: '9px' }}
            >
              {node.name.length > 6 ? node.name.slice(0, 6) : node.name}
            </text>

            {/* Working status label */}
            {node.statusLabel && (
              <text
                textAnchor="middle"
                y={avatarH / 2 + 22}
                className="animate-pulse fill-blue-600 font-medium"
                style={{ fontSize: '8px' }}
              >
                {node.statusLabel}
              </text>
            )}

            {/* Task progress badge */}
            {node.taskProgress && node.taskProgress.total > 0 && (
              <g
                transform={`translate(${avatarW / 2 + 2}, ${-avatarH / 2 + 2})`}
              >
                <circle
                  r="8"
                  className="fill-white"
                  style={{
                    stroke:
                      node.taskProgress.completed === node.taskProgress.total
                        ? '#22c55e'
                        : isWorking
                          ? '#3b82f6'
                          : '#d1d5db',
                    strokeWidth: 1.5,
                  }}
                />
                <text
                  textAnchor="middle"
                  dy="0.35em"
                  className={`font-bold ${
                    node.taskProgress.completed === node.taskProgress.total
                      ? 'fill-green-600'
                      : isWorking
                        ? 'fill-blue-600'
                        : 'fill-gray-500'
                  }`}
                  style={{ fontSize: '7px' }}
                >
                  {node.taskProgress.completed}/{node.taskProgress.total}
                </text>
              </g>
            )}
          </g>
        );
      }

      // ── Circle rendering (original) ──
      const nodeRadius = node.isLeader
        ? NODE_RADIUS.leader
        : NODE_RADIUS.member;
      const fillColor = getNodeFillColor(node);
      const isEmoji = typeof node.icon === 'string';

      return (
        <g
          key={node.id}
          transform={`translate(${pos.x}, ${pos.y})`}
          onMouseEnter={() => setHoveredNodeId(node.id)}
          onMouseLeave={() => setHoveredNodeId(null)}
          onClick={() => setSelectedNodeId(node.id)}
          style={{ cursor: 'pointer' }}
        >
          {/* Layer 1: Working glow */}
          {isWorking && (
            <circle
              r={nodeRadius + 6}
              className="animate-ping fill-blue-400 opacity-30"
            />
          )}

          {/* Layer 2: White outer ring with shadow */}
          <circle
            r={nodeRadius + 3}
            className={`fill-white ${isHovered ? 'opacity-100' : 'opacity-90'}`}
            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.1))' }}
          />

          {/* Layer 3: Main colored circle */}
          <circle
            r={nodeRadius}
            className={cn(
              fillColor,
              'stroke-white stroke-2 transition-all duration-200',
              isHovered && 'scale-110'
            )}
            style={{
              transformBox: 'fill-box',
              transformOrigin: 'center',
              filter: isWorking
                ? 'drop-shadow(0 0 6px rgba(59,130,246,0.5))'
                : node.isLeader
                  ? 'drop-shadow(0 0 4px rgba(168,85,247,0.4))'
                  : '',
            }}
          />

          {/* Layer 4: Icon (emoji text or Lucide via foreignObject) */}
          {isEmoji ? (
            <text
              textAnchor="middle"
              dy="0.35em"
              style={{ fontSize: node.isLeader ? '14px' : '12px' }}
            >
              {node.icon as string}
            </text>
          ) : (
            <foreignObject
              x={-(node.isLeader ? 8 : 7)}
              y={-(node.isLeader ? 8 : 7)}
              width={node.isLeader ? 16 : 14}
              height={node.isLeader ? 16 : 14}
            >
              <div className="flex h-full w-full items-center justify-center text-white">
                {(() => {
                  const LucideIcon = node.icon as ComponentType<{
                    className?: string;
                    strokeWidth?: number;
                  }>;
                  return (
                    <LucideIcon
                      className={node.isLeader ? 'h-4 w-4' : 'h-3.5 w-3.5'}
                      strokeWidth={2.5}
                    />
                  );
                })()}
              </div>
            </foreignObject>
          )}

          {/* Layer 5: Name label */}
          <text
            textAnchor="middle"
            y={nodeRadius + 12}
            className="fill-gray-700 font-medium"
            style={{ fontSize: '9px' }}
          >
            {node.name.length > 6 ? node.name.slice(0, 6) : node.name}
          </text>

          {/* Layer 6: Working status label */}
          {node.statusLabel && (
            <text
              textAnchor="middle"
              y={nodeRadius + 22}
              className="animate-pulse fill-blue-600 font-medium"
              style={{ fontSize: '8px' }}
            >
              {node.statusLabel}
            </text>
          )}

          {/* Task progress badge (top-right) */}
          {node.taskProgress && node.taskProgress.total > 0 && (
            <g transform={`translate(${nodeRadius - 2}, ${-nodeRadius + 2})`}>
              <circle
                r="8"
                className="fill-white"
                style={{
                  stroke:
                    node.taskProgress.completed === node.taskProgress.total
                      ? '#22c55e'
                      : node.status === 'working'
                        ? '#3b82f6'
                        : '#d1d5db',
                  strokeWidth: 1.5,
                }}
              />
              <text
                textAnchor="middle"
                dy="0.35em"
                className={`font-bold ${
                  node.taskProgress.completed === node.taskProgress.total
                    ? 'fill-green-600'
                    : node.status === 'working'
                      ? 'fill-blue-600'
                      : 'fill-gray-500'
                }`}
                style={{ fontSize: '7px' }}
              >
                {node.taskProgress.completed}/{node.taskProgress.total}
              </text>
            </g>
          )}
        </g>
      );
    });
  };

  // Hovered node for tooltip
  const hoveredNode = hoveredNodeId ? nodeMap.get(hoveredNodeId) : null;
  const hoveredPos = hoveredNodeId ? nodePositions.get(hoveredNodeId) : null;

  // Selected node for detail card
  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        className={`${heightClass} w-full`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Background line grid */}
        <defs>
          <pattern
            id={`${patternId}-grid`}
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="#f5f5f5"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId}-grid)`} />

        {/* Connections */}
        {renderConnections()}

        {/* Nodes */}
        {renderNodes()}
      </svg>

      {/* Legend */}
      {legendItems.length > 0 && (
        <div className="flex items-center justify-center gap-4 border-t border-gray-50 px-3 py-1.5 text-[10px] text-gray-500">
          {legendItems.map((item, i) => (
            <div key={i} className="flex items-center gap-1">
              <div
                className={cn(
                  'h-2 w-2 rounded-full',
                  item.color,
                  item.animated && 'animate-pulse'
                )}
              />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Hover tooltip */}
      {hoveredNode &&
        !selectedNodeId &&
        hoveredPos &&
        (() => {
          const tooltipX = (hoveredPos.x / viewBoxWidth) * 100;
          const tooltipY = (hoveredPos.y / viewBoxHeight) * 100;
          const showAbove = tooltipY > 50;

          return (
            <div
              className="pointer-events-none absolute z-10 rounded-lg bg-white/95 px-3 py-2 shadow-lg backdrop-blur"
              style={{
                left: `${Math.min(Math.max(tooltipX, 20), 80)}%`,
                top: showAbove ? `${tooltipY - 20}%` : `${tooltipY + 25}%`,
                transform: 'translateX(-50%)',
              }}
            >
              {renderTooltip ? (
                renderTooltip(hoveredNode)
              ) : (
                <div className="text-xs">
                  <div className="font-semibold text-gray-800">
                    {typeof hoveredNode.icon === 'string'
                      ? hoveredNode.icon
                      : ''}{' '}
                    {hoveredNode.name}
                  </div>
                  <div className="mt-0.5 text-gray-500">{hoveredNode.role}</div>
                </div>
              )}
            </div>
          );
        })()}

      {/* Selected node detail card */}
      {selectedNode &&
        (() => {
          if (renderDetail) {
            return renderDetail(selectedNode, () => setSelectedNodeId(null));
          }

          // Default detail card (matching TopicTeamPanel style)
          return (
            <>
              {/* Click outside to close */}
              <div
                className="absolute inset-0 z-20"
                onClick={() => setSelectedNodeId(null)}
              />
              <div className="absolute left-1/2 top-1/2 z-30 w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
                      {typeof selectedNode.icon === 'string' ? (
                        <span className="text-xl">{selectedNode.icon}</span>
                      ) : (
                        (() => {
                          const Icon = selectedNode.icon as ComponentType<{
                            className?: string;
                          }>;
                          return <Icon className="h-5 w-5 text-blue-600" />;
                        })()
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-800">
                        {selectedNode.name}
                      </div>
                      <span className="text-xs text-gray-500">
                        {selectedNode.role}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedNodeId(null)}
                    className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
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
            </>
          );
        })()}
    </div>
  );
}
