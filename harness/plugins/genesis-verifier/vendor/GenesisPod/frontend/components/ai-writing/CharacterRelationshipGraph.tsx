'use client';

import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { confirm } from '@/stores';
import {
  RelationshipGraph,
  RelationshipNode,
  RelationshipEdge,
  getRelationshipGraph,
  addCharacterRelationship,
  deleteCharacterRelationship,
} from '@/services/ai-writing/api';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui';
import { Users, RotateCcw, Lightbulb } from 'lucide-react';

interface Props {
  projectId: string;
}

// 角色类型对应的颜色
const ROLE_COLORS: Record<string, string> = {
  PROTAGONIST: '#10B981', // 绿色 - 主角
  ANTAGONIST: '#EF4444', // 红色 - 反派
  SUPPORTING: '#3B82F6', // 蓝色 - 配角
  MINOR: '#9CA3AF', // 灰色 - 龙套
};

// 关系类型对应的颜色
const RELATION_COLORS: Record<string, string> = {
  父子: '#F59E0B',
  母子: '#F59E0B',
  夫妻: '#EC4899',
  恋人: '#EC4899',
  师徒: '#8B5CF6',
  朋友: '#10B981',
  仇敌: '#EF4444',
  同门: '#3B82F6',
  主仆: '#6B7280',
  兄弟: '#F97316',
  姐妹: '#F97316',
  同事: '#06B6D4',
};

// ★★★ 改进的分区布局算法 ★★★
// 参考专业人物关系图，按阵营分区布局
function calculateLayout(
  nodes: RelationshipNode[],
  edges: RelationshipEdge[],
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const centerX = width / 2;
  const centerY = height / 2;

  // 按角色类型分组
  const protagonists = nodes.filter((n) => n.role === 'PROTAGONIST');
  const antagonists = nodes.filter((n) => n.role === 'ANTAGONIST');
  const supporting = nodes.filter((n) => n.role === 'SUPPORTING');
  const minor = nodes.filter((n) => n.role === 'MINOR');

  // 构建关系图用于分组
  const connections = new Map<string, Set<string>>();
  nodes.forEach((n) => connections.set(n.id, new Set()));
  edges.forEach((e) => {
    connections.get(e.source)?.add(e.target);
    connections.get(e.target)?.add(e.source);
  });

  // ★ 定义5个区域（上、左、中、右、下）
  // 中心区：主角
  // 上方区：反派/敌对势力
  // 左侧区：家族/亲密关系
  // 右侧区：朋友/盟友
  // 下方区：下属/龙套

  const zones = {
    center: { x: centerX, y: centerY, radius: 60 },
    top: {
      x: centerX,
      y: height * 0.15,
      width: width * 0.6,
      height: height * 0.2,
    },
    left: {
      x: width * 0.15,
      y: centerY,
      width: width * 0.25,
      height: height * 0.5,
    },
    right: {
      x: width * 0.85,
      y: centerY,
      width: width * 0.25,
      height: height * 0.5,
    },
    bottom: {
      x: centerX,
      y: height * 0.85,
      width: width * 0.7,
      height: height * 0.2,
    },
  };

  // ★ 主角放中心（如果多个主角，围绕中心点）
  if (protagonists.length === 1) {
    positions.set(protagonists[0].id, { x: centerX, y: centerY });
  } else {
    protagonists.forEach((node, i) => {
      const angle = (i * 2 * Math.PI) / protagonists.length - Math.PI / 2;
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * zones.center.radius,
        y: centerY + Math.sin(angle) * zones.center.radius,
      });
    });
  }

  // ★ 反派放上方区域（敌对势力）
  if (antagonists.length > 0) {
    const spacing = zones.top.width / (antagonists.length + 1);
    antagonists.forEach((node, i) => {
      positions.set(node.id, {
        x: zones.top.x - zones.top.width / 2 + spacing * (i + 1),
        y: zones.top.y + (i % 2) * 40, // 错落排列
      });
    });
  }

  // ★ 将配角按与主角的关系分类
  const protagonistIds = new Set(protagonists.map((p) => p.id));
  const supportingWithRelations: { node: RelationshipNode; zone: string }[] =
    [];

  supporting.forEach((node) => {
    // 检查这个配角与主角的关系类型
    const relatedEdges = edges.filter(
      (e) =>
        (e.source === node.id && protagonistIds.has(e.target)) ||
        (e.target === node.id && protagonistIds.has(e.source))
    );

    let zone = 'right'; // 默认右侧（朋友/盟友）

    for (const edge of relatedEdges) {
      const relType = edge.type || edge.label || '';
      // 家族关系放左侧
      if (
        /父|母|子|女|兄|弟|姐|妹|夫|妻|亲/.test(relType) ||
        /家族|血缘/.test(relType)
      ) {
        zone = 'left';
        break;
      }
      // 敌对关系放上方
      if (/敌|仇|对立|竞争/.test(relType)) {
        zone = 'top';
        break;
      }
      // 下属关系放下方
      if (/仆|从|下属|手下|监管/.test(relType)) {
        zone = 'bottom';
        break;
      }
    }

    supportingWithRelations.push({ node, zone });
  });

  // 按区域分组配角
  const leftSupporting = supportingWithRelations.filter(
    (s) => s.zone === 'left'
  );
  const rightSupporting = supportingWithRelations.filter(
    (s) => s.zone === 'right'
  );
  const topSupporting = supportingWithRelations.filter((s) => s.zone === 'top');
  const bottomSupporting = supportingWithRelations.filter(
    (s) => s.zone === 'bottom'
  );

  // 布局左侧配角（家族）
  if (leftSupporting.length > 0) {
    const rows = Math.ceil(leftSupporting.length / 2);
    const colSpacing = zones.left.width / 3;
    const rowSpacing = zones.left.height / (rows + 1);
    leftSupporting.forEach((item, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      positions.set(item.node.id, {
        x: zones.left.x - zones.left.width / 2 + colSpacing * (col + 1),
        y: zones.left.y - zones.left.height / 2 + rowSpacing * (row + 1),
      });
    });
  }

  // 布局右侧配角（盟友）
  if (rightSupporting.length > 0) {
    const rows = Math.ceil(rightSupporting.length / 2);
    const colSpacing = zones.right.width / 3;
    const rowSpacing = zones.right.height / (rows + 1);
    rightSupporting.forEach((item, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      positions.set(item.node.id, {
        x: zones.right.x - zones.right.width / 2 + colSpacing * (col + 1),
        y: zones.right.y - zones.right.height / 2 + rowSpacing * (row + 1),
      });
    });
  }

  // 布局上方配角（与反派同区）
  if (topSupporting.length > 0) {
    const totalTop = antagonists.length + topSupporting.length;
    const spacing = zones.top.width / (totalTop + 1);
    topSupporting.forEach((item, i) => {
      positions.set(item.node.id, {
        x:
          zones.top.x -
          zones.top.width / 2 +
          spacing * (antagonists.length + i + 1),
        y: zones.top.y + ((antagonists.length + i) % 2) * 40,
      });
    });
  }

  // 布局下方配角
  if (bottomSupporting.length > 0) {
    const spacing = zones.bottom.width / (bottomSupporting.length + 1);
    bottomSupporting.forEach((item, i) => {
      positions.set(item.node.id, {
        x: zones.bottom.x - zones.bottom.width / 2 + spacing * (i + 1),
        y: zones.bottom.y + (i % 2) * 30,
      });
    });
  }

  // ★ 龙套放在外围/下方区域
  if (minor.length > 0) {
    // 先统计下方区域还有多少空间
    const bottomUsed = bottomSupporting.length;
    const remainingBottom = Math.max(0, 6 - bottomUsed);

    // 部分龙套放下方
    const minorForBottom = minor.slice(0, remainingBottom);
    const minorForEdges = minor.slice(remainingBottom);

    // 下方龙套
    if (minorForBottom.length > 0) {
      const totalBottom = bottomSupporting.length + minorForBottom.length;
      const spacing = zones.bottom.width / (totalBottom + 1);
      minorForBottom.forEach((node, i) => {
        positions.set(node.id, {
          x:
            zones.bottom.x -
            zones.bottom.width / 2 +
            spacing * (bottomSupporting.length + i + 1),
          y: zones.bottom.y + 50 + (i % 2) * 25,
        });
      });
    }

    // 剩余龙套放边缘
    if (minorForEdges.length > 0) {
      // 在四个角落分布
      const corners = [
        { x: width * 0.1, y: height * 0.1 },
        { x: width * 0.9, y: height * 0.1 },
        { x: width * 0.1, y: height * 0.9 },
        { x: width * 0.9, y: height * 0.9 },
      ];
      minorForEdges.forEach((node, i) => {
        const corner = corners[i % 4];
        const offset = Math.floor(i / 4) * 50;
        positions.set(node.id, {
          x: corner.x + (i % 2 === 0 ? offset : -offset),
          y: corner.y + (Math.floor(i / 2) % 2 === 0 ? offset : -offset),
        });
      });
    }
  }

  // ★ 确保所有节点都有位置（fallback）
  nodes.forEach((node) => {
    if (!positions.has(node.id)) {
      // 没有位置的节点放在随机位置
      positions.set(node.id, {
        x: width * 0.2 + Math.random() * width * 0.6,
        y: height * 0.2 + Math.random() * height * 0.6,
      });
    }
  });

  return positions;
}

export default function CharacterRelationshipGraph({ projectId }: Props) {
  const [graph, setGraph] = useState<RelationshipGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<RelationshipNode | null>(
    null
  );
  const [hoveredEdge, setHoveredEdge] = useState<RelationshipEdge | null>(null);

  // 拖动状态
  const [nodePositions, setNodePositions] = useState<
    Map<string, { x: number; y: number }>
  >(new Map());
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  // 添加关系的状态
  const [isAddingRelation, setIsAddingRelation] = useState(false);
  const [sourceNode, setSourceNode] = useState<RelationshipNode | null>(null);
  const [relationType, setRelationType] = useState('');
  const [relationDesc, setRelationDesc] = useState('');

  // ★ 缩放和平移状态
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const fetchGraph = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getRelationshipGraph(projectId);
      setGraph(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // 计算初始布局
  const initialPositions = useMemo(() => {
    if (!graph) return new Map();
    return calculateLayout(graph.nodes, graph.edges, 800, 600);
  }, [graph]);

  // 当 graph 变化时重置位置
  useEffect(() => {
    if (graph) {
      setNodePositions(calculateLayout(graph.nodes, graph.edges, 800, 600));
    }
  }, [graph]);

  // 获取当前位置（拖动后的位置或初始位置）
  const getNodePosition = useCallback(
    (nodeId: string) => {
      return nodePositions.get(nodeId) || initialPositions.get(nodeId);
    },
    [nodePositions, initialPositions]
  );

  // 重置布局
  const resetLayout = useCallback(() => {
    if (graph) {
      setNodePositions(calculateLayout(graph.nodes, graph.edges, 800, 600));
    }
  }, [graph]);

  // ★ 缩放处理
  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((prev) => Math.min(3, Math.max(0.3, prev * delta)));
  }, []);

  // ★ 缩放控制
  const zoomIn = useCallback(() => {
    setScale((prev) => Math.min(3, prev * 1.2));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((prev) => Math.max(0.3, prev * 0.8));
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // ★ 平移处理
  const handlePanStart = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      // 只有在空白区域点击时才开始平移（不是在拖动节点时）
      if (draggingNode || isAddingRelation) return;
      if (
        (e.target as SVGElement).tagName === 'svg' ||
        (e.target as SVGElement).tagName === 'rect'
      ) {
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    },
    [draggingNode, isAddingRelation, pan]
  );

  const handlePanMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (isPanning) {
        setPan({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      }
    },
    [isPanning, panStart]
  );

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  // 处理拖动开始
  const handleDragStart = useCallback(
    (nodeId: string, e: React.MouseEvent<SVGGElement>) => {
      if (isAddingRelation) return; // 添加关系模式下不允许拖动

      e.stopPropagation();
      const svg = svgRef.current;
      if (!svg) return;

      const point = svg.createSVGPoint();
      point.x = e.clientX;
      point.y = e.clientY;
      const svgPoint = point.matrixTransform(svg.getScreenCTM()?.inverse());

      const pos = getNodePosition(nodeId);
      if (pos) {
        setDragOffset({
          x: svgPoint.x - pos.x,
          y: svgPoint.y - pos.y,
        });
      }
      setDraggingNode(nodeId);
    },
    [isAddingRelation, getNodePosition]
  );

  // 处理拖动移动
  const handleDragMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!draggingNode) return;

      const svg = svgRef.current;
      if (!svg) return;

      const point = svg.createSVGPoint();
      point.x = e.clientX;
      point.y = e.clientY;
      const svgPoint = point.matrixTransform(svg.getScreenCTM()?.inverse());

      const newX = Math.max(40, Math.min(760, svgPoint.x - dragOffset.x));
      const newY = Math.max(40, Math.min(560, svgPoint.y - dragOffset.y));

      setNodePositions((prev) => {
        const newPositions = new Map(prev);
        newPositions.set(draggingNode, { x: newX, y: newY });
        return newPositions;
      });
    },
    [draggingNode, dragOffset]
  );

  // 处理拖动结束
  const handleDragEnd = useCallback(() => {
    setDraggingNode(null);
  }, []);

  // 添加关系
  const handleAddRelation = async (targetNode: RelationshipNode) => {
    if (!sourceNode || !relationType) return;

    try {
      await addCharacterRelationship(projectId, sourceNode.id, {
        targetCharacterId: targetNode.id,
        relationshipType: relationType,
        description: relationDesc || undefined,
      });
      setIsAddingRelation(false);
      setSourceNode(null);
      setRelationType('');
      setRelationDesc('');
      fetchGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加关系失败');
    }
  };

  // 删除关系
  const handleDeleteRelation = async (edge: RelationshipEdge) => {
    if (
      !(await confirm({
        title: `确定要删除关系"${edge.label}"吗？`,
        type: 'danger',
      }))
    )
      return;

    try {
      await deleteCharacterRelationship(projectId, edge.id);
      fetchGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除关系失败');
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingState size="lg" text="加载角色关系图谱..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-96 flex-col items-center justify-center">
        <p className="mb-4 text-red-500">{error}</p>
        <button
          onClick={fetchGraph}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          重试
        </button>
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-12 w-12" />}
        title="暂无角色数据"
        description="请先在故事圣经中添加角色"
        size="md"
      />
    );
  }

  return (
    <div className="relative">
      {/* 工具栏 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span className="flex items-center gap-1">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: ROLE_COLORS.PROTAGONIST }}
              />
              主角
            </span>
            <span className="flex items-center gap-1">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: ROLE_COLORS.ANTAGONIST }}
              />
              反派
            </span>
            <span className="flex items-center gap-1">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: ROLE_COLORS.SUPPORTING }}
              />
              配角
            </span>
            <span className="flex items-center gap-1">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: ROLE_COLORS.MINOR }}
              />
              龙套
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAddingRelation ? (
            <>
              <input
                type="text"
                value={relationType}
                onChange={(e) => setRelationType(e.target.value)}
                placeholder="关系类型（如：师徒、朋友）"
                className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700"
              />
              <button
                onClick={() => {
                  setIsAddingRelation(false);
                  setSourceNode(null);
                }}
                className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-300"
              >
                取消
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsAddingRelation(true)}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
            >
              + 添加关系
            </button>
          )}
          <button
            onClick={resetLayout}
            className="flex items-center gap-1 rounded bg-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-300"
            title="重置布局"
          >
            <RotateCcw className="h-3.5 w-3.5" /> 重置布局
          </button>
          <button
            onClick={fetchGraph}
            className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-300"
          >
            刷新
          </button>
          {/* ★ 缩放控制按钮 */}
          <div className="ml-2 flex items-center gap-1 border-l border-gray-300 pl-2">
            <button
              onClick={zoomOut}
              className="rounded bg-gray-200 px-2 py-1 text-sm text-gray-700 hover:bg-gray-300"
              title="缩小"
            >
              −
            </button>
            <span className="min-w-[40px] text-center text-xs text-gray-500">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={zoomIn}
              className="rounded bg-gray-200 px-2 py-1 text-sm text-gray-700 hover:bg-gray-300"
              title="放大"
            >
              +
            </button>
            <button
              onClick={resetZoom}
              className="ml-1 flex items-center justify-center rounded bg-gray-200 px-2 py-1 text-sm text-gray-700 hover:bg-gray-300"
              title="重置缩放"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 添加关系提示 */}
      {isAddingRelation && (
        <div className="mb-4 rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-700">
          {!sourceNode
            ? '请点击源角色节点'
            : `已选择 ${sourceNode.name}，请点击目标角色节点建立关系`}
        </div>
      )}

      {/* 拖动提示 */}
      {!isAddingRelation && (
        <div className="mb-2 flex items-center gap-1 text-xs text-gray-400">
          <Lightbulb className="h-3 w-3" /> 提示：可以拖动角色节点调整位置
        </div>
      )}

      {/* 图谱 SVG */}
      <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <svg
          ref={svgRef}
          width="100%"
          height="600"
          viewBox="0 0 800 600"
          onMouseMove={(e) => {
            handleDragMove(e);
            handlePanMove(e);
          }}
          onMouseUp={() => {
            handleDragEnd();
            handlePanEnd();
          }}
          onMouseLeave={() => {
            handleDragEnd();
            handlePanEnd();
          }}
          onMouseDown={handlePanStart}
          onWheel={handleWheel}
          style={{
            cursor: isPanning
              ? 'grabbing'
              : draggingNode
                ? 'grabbing'
                : 'default',
          }}
        >
          <defs>
            {/* 箭头标记 */}
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#9CA3AF" />
            </marker>
          </defs>

          {/* ★ 白色背景 */}
          <rect width="100%" height="100%" fill="#ffffff" />

          {/* ★ 内容容器 - 支持缩放和平移 */}
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
            {/* 绘制边（关系线） */}
            {graph.edges.map((edge) => {
              const sourcePos = getNodePosition(edge.source);
              const targetPos = getNodePosition(edge.target);
              if (!sourcePos || !targetPos) return null;

              const color =
                RELATION_COLORS[edge.type] ||
                RELATION_COLORS[edge.label] ||
                '#9CA3AF';
              const isHovered = hoveredEdge?.id === edge.id;

              // 计算线的中点用于放置标签
              const midX = (sourcePos.x + targetPos.x) / 2;
              const midY = (sourcePos.y + targetPos.y) / 2;

              // 计算缩短的线（避免覆盖节点）
              const dx = targetPos.x - sourcePos.x;
              const dy = targetPos.y - sourcePos.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              if (len === 0) return null;

              const nodeRadius = 30;
              const startX = sourcePos.x + (dx / len) * nodeRadius;
              const startY = sourcePos.y + (dy / len) * nodeRadius;
              const endX = targetPos.x - (dx / len) * (nodeRadius + 5);
              const endY = targetPos.y - (dy / len) * (nodeRadius + 5);

              return (
                <g
                  key={edge.id}
                  onMouseEnter={() => setHoveredEdge(edge)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  onClick={() => handleDeleteRelation(edge)}
                  style={{ cursor: 'pointer' }}
                >
                  <line
                    x1={startX}
                    y1={startY}
                    x2={endX}
                    y2={endY}
                    stroke={color}
                    strokeWidth={isHovered ? 3 : 2}
                    strokeOpacity={isHovered ? 1 : 0.7}
                    markerEnd="url(#arrowhead)"
                  />
                  {/* 关系标签背景 */}
                  <rect
                    x={midX - 20}
                    y={midY - 18}
                    width="40"
                    height="16"
                    rx="4"
                    fill="white"
                    fillOpacity="0.9"
                  />
                  <text
                    x={midX}
                    y={midY - 6}
                    textAnchor="middle"
                    fill={color}
                    fontSize="11"
                    fontWeight={isHovered ? 'bold' : 'normal'}
                  >
                    {edge.label}
                  </text>
                </g>
              );
            })}

            {/* 绘制节点 */}
            {graph.nodes.map((node) => {
              const pos = getNodePosition(node.id);
              if (!pos) return null;

              const color = ROLE_COLORS[node.role] || ROLE_COLORS.MINOR;
              const isSelected = selectedNode?.id === node.id;
              const isSource = sourceNode?.id === node.id;
              const isDragging = draggingNode === node.id;

              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onMouseDown={(e) => handleDragStart(node.id, e)}
                  onClick={(e) => {
                    if (isDragging) return;
                    e.stopPropagation();
                    if (isAddingRelation) {
                      if (!sourceNode) {
                        setSourceNode(node);
                      } else if (sourceNode.id !== node.id) {
                        handleAddRelation(node);
                      }
                    } else {
                      setSelectedNode(isSelected ? null : node);
                    }
                  }}
                  style={{
                    cursor: isAddingRelation
                      ? 'pointer'
                      : isDragging
                        ? 'grabbing'
                        : 'grab',
                  }}
                >
                  {/* 节点阴影 */}
                  <circle
                    r={32}
                    fill="rgba(0,0,0,0.1)"
                    cx={2}
                    cy={2}
                    style={{ display: isDragging ? 'block' : 'none' }}
                  />
                  {/* 节点圆圈背景 */}
                  <circle
                    r={isSelected || isSource ? 35 : 30}
                    fill="white"
                    stroke={color}
                    strokeWidth={isSelected || isSource ? 3 : 2}
                  />
                  {/* 节点圆圈内部填充 */}
                  <circle
                    r={isSelected || isSource ? 33 : 28}
                    fill={color}
                    fillOpacity={0.15}
                  />
                  {/* 头像首字母 */}
                  <text
                    textAnchor="middle"
                    dy="0.35em"
                    fill={color}
                    fontSize="18"
                    fontWeight="bold"
                    style={{ pointerEvents: 'none' }}
                  >
                    {node.name.charAt(0)}
                  </text>
                  {/* 名字标签背景 */}
                  <rect
                    x={-40}
                    y={38}
                    width="80"
                    height="18"
                    rx="4"
                    fill="white"
                    fillOpacity="0.9"
                  />
                  {/* 名字标签 */}
                  <text
                    y={50}
                    textAnchor="middle"
                    fill="#374151"
                    fontSize="12"
                    fontWeight="medium"
                    style={{ pointerEvents: 'none' }}
                  >
                    {node.name.length > 8
                      ? node.name.substring(0, 8) + '...'
                      : node.name}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* 选中节点的详情面板 */}
      {selectedNode && (
        <div className="absolute right-4 top-16 w-64 rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="font-medium text-gray-900">{selectedNode.name}</h4>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-gray-400 hover:text-gray-600"
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
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">角色类型:</span>
              <span
                className="rounded px-2 py-0.5 text-xs"
                style={{
                  backgroundColor: ROLE_COLORS[selectedNode.role] + '20',
                  color: ROLE_COLORS[selectedNode.role],
                }}
              >
                {selectedNode.role === 'PROTAGONIST'
                  ? '主角'
                  : selectedNode.role === 'ANTAGONIST'
                    ? '反派'
                    : selectedNode.role === 'SUPPORTING'
                      ? '配角'
                      : '龙套'}
              </span>
            </div>
            {selectedNode.aliases.length > 0 && (
              <div>
                <span className="text-gray-500">别名:</span>
                <span className="ml-2 text-gray-700">
                  {selectedNode.aliases.join(', ')}
                </span>
              </div>
            )}
            {selectedNode.traits.length > 0 && (
              <div>
                <span className="text-gray-500">性格特征:</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {selectedNode.traits.map((trait, i) => (
                    <span
                      key={i}
                      className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                    >
                      {trait}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* 关系列表 */}
            <div className="mt-3 border-t border-gray-200 pt-3">
              <span className="text-gray-500">关系:</span>
              <div className="mt-1 space-y-1">
                {graph.edges
                  .filter(
                    (e) =>
                      e.source === selectedNode.id ||
                      e.target === selectedNode.id
                  )
                  .map((edge) => {
                    const isSource = edge.source === selectedNode.id;
                    const otherNode = graph.nodes.find(
                      (n) => n.id === (isSource ? edge.target : edge.source)
                    );
                    return (
                      <div
                        key={edge.id}
                        className="flex items-center gap-1 text-xs text-gray-600"
                      >
                        <span>{isSource ? '→' : '←'}</span>
                        <span
                          style={{
                            color: RELATION_COLORS[edge.label] || '#6B7280',
                          }}
                        >
                          {edge.label}
                        </span>
                        <span>{otherNode?.name}</span>
                      </div>
                    );
                  })}
                {graph.edges.filter(
                  (e) =>
                    e.source === selectedNode.id || e.target === selectedNode.id
                ).length === 0 && (
                  <p className="text-xs text-gray-400">暂无关系</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 悬浮边的详情 */}
      {hoveredEdge && hoveredEdge.description && (
        <div className="absolute bottom-4 left-4 max-w-xs rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 shadow">
          <span className="font-medium">{hoveredEdge.label}:</span>{' '}
          {hoveredEdge.description}
        </div>
      )}
    </div>
  );
}
