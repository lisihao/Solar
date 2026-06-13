'use client';

/**
 * KnowledgeGraph - 知识图谱可视化组件
 * 使用 D3.js 力导向图展示技术关系网络
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCw,
  Filter,
  Download,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export interface GraphNode {
  id: string;
  name: string;
  type: 'technology' | 'concept' | 'company' | 'person' | 'paper';
  size?: number;
  color?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'related' | 'uses' | 'created_by' | 'part_of' | 'competes_with';
  weight?: number;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface KnowledgeGraphProps {
  data: GraphData;
  onNodeClick?: (node: GraphNode) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
  width?: number;
  height?: number;
  highlightedNodeId?: string | null;
}

const NODE_COLORS: Record<GraphNode['type'], string> = {
  technology: '#3B82F6',
  concept: '#10B981',
  company: '#F59E0B',
  person: '#8B5CF6',
  paper: '#EC4899',
};

// NODE_TYPE_LABELS moved to component to use i18n

const EDGE_COLORS: Record<GraphEdge['type'], string> = {
  related: '#9CA3AF',
  uses: '#3B82F6',
  created_by: '#10B981',
  part_of: '#F59E0B',
  competes_with: '#EF4444',
};

interface SimulationNode extends GraphNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimulationEdge extends GraphEdge {
  sourceNode?: SimulationNode;
  targetNode?: SimulationNode;
}

export default function KnowledgeGraph({
  data,
  onNodeClick,
  onEdgeClick,
  width = 800,
  height = 600,
  highlightedNodeId,
}: KnowledgeGraphProps) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<GraphNode['type'] | 'all'>(
    'all'
  );
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [nodes, setNodes] = useState<SimulationNode[]>([]);
  const [edges, setEdges] = useState<SimulationEdge[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragNode, setDragNode] = useState<SimulationNode | null>(null);

  const NODE_TYPE_LABELS: Record<GraphNode['type'], string> = {
    technology: t(
      'topicResearch.deepResearch.knowledgeGraph.nodeTypes.technology'
    ),
    concept: t('topicResearch.deepResearch.knowledgeGraph.nodeTypes.concept'),
    company: t('topicResearch.deepResearch.knowledgeGraph.nodeTypes.company'),
    person: t('topicResearch.deepResearch.knowledgeGraph.nodeTypes.person'),
    paper: t('topicResearch.deepResearch.knowledgeGraph.nodeTypes.paper'),
  };

  // Filter nodes based on search and type
  const filteredNodes = data.nodes.filter((node) => {
    const matchesSearch =
      !searchQuery ||
      node.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = selectedType === 'all' || node.type === selectedType;
    return matchesSearch && matchesType;
  });

  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = data.edges.filter(
    (edge) =>
      filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)
  );

  // Initialize simulation
  useEffect(() => {
    const simulationNodes: SimulationNode[] = filteredNodes.map((node) => ({
      ...node,
      x: Math.random() * width,
      y: Math.random() * height,
    }));

    const nodeMap = new Map(simulationNodes.map((n) => [n.id, n]));

    const simulationEdges: SimulationEdge[] = filteredEdges.map((edge) => ({
      ...edge,
      sourceNode: nodeMap.get(edge.source),
      targetNode: nodeMap.get(edge.target),
    }));

    // Simple force simulation
    const simulate = () => {
      const iterations = 100;
      const centerX = width / 2;
      const centerY = height / 2;

      for (let i = 0; i < iterations; i++) {
        // Center force
        for (const node of simulationNodes) {
          node.vx = (node.vx || 0) + (centerX - (node.x || 0)) * 0.01;
          node.vy = (node.vy || 0) + (centerY - (node.y || 0)) * 0.01;
        }

        // Repulsion between nodes
        for (let j = 0; j < simulationNodes.length; j++) {
          for (let k = j + 1; k < simulationNodes.length; k++) {
            const a = simulationNodes[j];
            const b = simulationNodes[k];
            const dx = (b.x || 0) - (a.x || 0);
            const dy = (b.y || 0) - (a.y || 0);
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = 1000 / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.vx = (a.vx || 0) - fx;
            a.vy = (a.vy || 0) - fy;
            b.vx = (b.vx || 0) + fx;
            b.vy = (b.vy || 0) + fy;
          }
        }

        // Edge attraction
        for (const edge of simulationEdges) {
          if (edge.sourceNode && edge.targetNode) {
            const dx = (edge.targetNode.x || 0) - (edge.sourceNode.x || 0);
            const dy = (edge.targetNode.y || 0) - (edge.sourceNode.y || 0);
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = (dist - 100) * 0.01;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            edge.sourceNode.vx = (edge.sourceNode.vx || 0) + fx;
            edge.sourceNode.vy = (edge.sourceNode.vy || 0) + fy;
            edge.targetNode.vx = (edge.targetNode.vx || 0) - fx;
            edge.targetNode.vy = (edge.targetNode.vy || 0) - fy;
          }
        }

        // Apply velocities with damping
        for (const node of simulationNodes) {
          if (node.fx == null) {
            node.x = (node.x || 0) + (node.vx || 0);
            node.y = (node.y || 0) + (node.vy || 0);
          }
          node.vx = (node.vx || 0) * 0.9;
          node.vy = (node.vy || 0) * 0.9;

          // Keep within bounds
          node.x = Math.max(50, Math.min(width - 50, node.x || 0));
          node.y = Math.max(50, Math.min(height - 50, node.y || 0));
        }
      }

      setNodes([...simulationNodes]);
      setEdges([...simulationEdges]);
    };

    simulate();
  }, [filteredNodes, filteredEdges, width, height]);

  // Zoom handlers
  const handleZoomIn = () => {
    setTransform((t) => ({ ...t, scale: Math.min(3, t.scale * 1.2) }));
  };

  const handleZoomOut = () => {
    setTransform((t) => ({ ...t, scale: Math.max(0.3, t.scale / 1.2) }));
  };

  const handleReset = () => {
    setTransform({ x: 0, y: 0, scale: 1 });
  };

  // Pan handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, node?: SimulationNode) => {
      if (node) {
        setDragNode(node);
        node.fx = node.x;
        node.fy = node.y;
      } else {
        setIsDragging(true);
      }
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragNode) {
        const rect = svgRef.current?.getBoundingClientRect();
        if (rect) {
          dragNode.fx = (e.clientX - rect.left - transform.x) / transform.scale;
          dragNode.fy = (e.clientY - rect.top - transform.y) / transform.scale;
          dragNode.x = dragNode.fx;
          dragNode.y = dragNode.fy;
          setNodes([...nodes]);
        }
      } else if (isDragging) {
        setTransform((t) => ({
          ...t,
          x: t.x + e.movementX,
          y: t.y + e.movementY,
        }));
      }
    },
    [isDragging, dragNode, transform, nodes]
  );

  const handleMouseUp = useCallback(() => {
    if (dragNode) {
      dragNode.fx = null;
      dragNode.fy = null;
      setDragNode(null);
    }
    setIsDragging(false);
  }, [dragNode]);

  const getNodeRadius = (node: SimulationNode) => {
    const baseRadius = node.size || 20;
    if (highlightedNodeId === node.id || hoveredNode === node.id) {
      return baseRadius * 1.3;
    }
    return baseRadius;
  };

  const isConnectedToHighlighted = (node: SimulationNode) => {
    if (!highlightedNodeId) return true;
    if (node.id === highlightedNodeId) return true;
    return edges.some(
      (e) =>
        (e.source === highlightedNodeId && e.target === node.id) ||
        (e.target === highlightedNodeId && e.source === node.id)
    );
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white">
      {/* Toolbar */}
      <div className="absolute left-4 right-4 top-4 z-10 flex items-center justify-between gap-4">
        {/* Search */}
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t(
              'topicResearch.deepResearch.knowledgeGraph.searchNodes'
            )}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Type Filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={selectedType}
            onChange={(e) =>
              setSelectedType(e.target.value as GraphNode['type'] | 'all')
            }
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="all">
              {t('topicResearch.deepResearch.knowledgeGraph.allTypes')}
            </option>
            {Object.entries(NODE_TYPE_LABELS).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
          <button
            onClick={handleZoomIn}
            className="rounded p-1 hover:bg-gray-100"
            title={t('topicResearch.deepResearch.knowledgeGraph.zoomIn')}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={handleZoomOut}
            className="rounded p-1 hover:bg-gray-100"
            title={t('topicResearch.deepResearch.knowledgeGraph.zoomOut')}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            onClick={handleReset}
            className="rounded p-1 hover:bg-gray-100"
            title={t('topicResearch.deepResearch.knowledgeGraph.reset')}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Graph */}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => handleMouseDown(e)}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <g
          transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}
        >
          {/* Edges */}
          {edges.map((edge, i) => {
            const source = nodes.find((n) => n.id === edge.source);
            const target = nodes.find((n) => n.id === edge.target);
            if (!source || !target) return null;

            const isHighlighted =
              !highlightedNodeId ||
              edge.source === highlightedNodeId ||
              edge.target === highlightedNodeId;

            return (
              <line
                key={`edge-${i}`}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={EDGE_COLORS[edge.type]}
                strokeWidth={edge.weight || 1}
                strokeOpacity={isHighlighted ? 0.6 : 0.15}
                className="cursor-pointer transition-opacity"
                onClick={() => onEdgeClick?.(edge)}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const isHighlighted = isConnectedToHighlighted(node);
            const radius = getNodeRadius(node);

            return (
              <g
                key={node.id}
                className="cursor-pointer"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  handleMouseDown(e, node);
                }}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => onNodeClick?.(node)}
                opacity={isHighlighted ? 1 : 0.3}
              >
                {/* Node circle */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={radius}
                  fill={node.color || NODE_COLORS[node.type]}
                  stroke="white"
                  strokeWidth={2}
                  className="transition-all"
                />

                {/* Node label */}
                <text
                  x={node.x}
                  y={(node.y || 0) + radius + 14}
                  textAnchor="middle"
                  className="fill-gray-700 text-xs font-medium"
                  style={{ pointerEvents: 'none' }}
                >
                  {node.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <h4 className="mb-2 text-xs font-medium uppercase text-gray-500">
          {t('topicResearch.deepResearch.knowledgeGraph.legend')}
        </h4>
        <div className="space-y-1">
          {Object.entries(NODE_TYPE_LABELS).map(([type, label]) => (
            <div key={type} className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full"
                style={{
                  backgroundColor: NODE_COLORS[type as GraphNode['type']],
                }}
              />
              <span className="text-xs text-gray-600">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Node Info Tooltip */}
      {hoveredNode && (
        <div className="absolute bottom-4 right-4 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          {(() => {
            const node = nodes.find((n) => n.id === hoveredNode);
            if (!node) return null;
            const connectedEdges = edges.filter(
              (e) => e.source === node.id || e.target === node.id
            );
            return (
              <>
                <h4 className="font-medium text-gray-900">{node.name}</h4>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-xs text-white"
                    style={{ backgroundColor: NODE_COLORS[node.type] }}
                  >
                    {NODE_TYPE_LABELS[node.type]}
                  </span>
                  <span className="text-xs text-gray-500">
                    {t(
                      'topicResearch.deepResearch.knowledgeGraph.connections',
                      { count: connectedEdges.length }
                    )}
                  </span>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Stats */}
      <div className="absolute right-4 top-16 text-xs text-gray-500">
        {t('topicResearch.deepResearch.knowledgeGraph.stats', {
          nodes: filteredNodes.length,
          edges: filteredEdges.length,
        })}
      </div>
    </div>
  );
}
