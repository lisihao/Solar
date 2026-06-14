'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart2,
  GitBranch,
  Layers,
  Maximize2,
  Minimize2,
  Network,
  Share2,
  Users,
} from 'lucide-react';
import KnowledgeGraphView from '@/components/common/views/KnowledgeGraphView';
import { SideDrawer } from '@/components/common/drawers/SideDrawer';
import { SectionPanelCard, StatCard } from '@/components/ui/cards';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { ErrorState } from '@/components/ui/states/ErrorState';
import { LoadingState } from '@/components/ui/states/LoadingState';
import { Button } from '@/components/ui/primitives/button';
import {
  getMissionGraph,
  buildMissionGraph,
  enrichGraphNode,
} from '@/services/agent-playground/api';
import type {
  MissionGraphArtifact,
  Analyses,
  MissionGraph,
  NodeEnrichment,
} from '@/services/agent-playground/graph-types';

interface MissionGraphTabProps {
  missionId: string;
  /**
   * 可选：跨模块消费方（components/missions/deep-insight 详情页）传入的 API 基路径。
   * playground 自身不使用（走默认 playground 路由）；此处仅接住 prop 以保持
   * 与 missions 详情页调用的类型兼容（playground 回退 6f59 后该模块仍共用本组件）。
   */
  basePath?: string;
}

export function MissionGraphTab({ missionId }: MissionGraphTabProps) {
  const [artifact, setArtifact] = useState<MissionGraphArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getMissionGraph(missionId);
      setArtifact(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [missionId]);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  const handleBuild = useCallback(async () => {
    setBuilding(true);
    setError(null);
    try {
      const result = await buildMissionGraph(missionId);
      setArtifact(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBuilding(false);
    }
  }, [missionId]);

  if (loading) {
    return <LoadingState text="加载图谱数据..." />;
  }

  if (error && !artifact) {
    return (
      <ErrorState
        error={error}
        title="图谱加载失败"
        onRetry={() => void fetchGraph()}
      />
    );
  }

  // Not yet built or status is NONE/FAILED
  const status = artifact?.status;
  if (!artifact || status === 'NONE' || status === 'FAILED') {
    return (
      <EmptyState
        type="noData"
        title={status === 'FAILED' ? '图谱生成失败' : '尚未生成图谱分析'}
        description={
          status === 'FAILED'
            ? '上次生成遇到问题，可尝试重新生成'
            : '对 Mission 报告进行实体抽取与关系图谱分析'
        }
        action={
          building ? (
            <LoadingState text="图谱生成中，请稍候..." size="sm" />
          ) : (
            <Button onClick={() => void handleBuild()}>
              <Network className="mr-2 h-4 w-4" />
              生成图谱分析
            </Button>
          )
        }
      />
    );
  }

  if (status === 'BUILDING') {
    return <LoadingState text="图谱构建中，请稍候..." />;
  }

  // READY — render full graph + analyses panels
  const graph = artifact.graph as MissionGraph;
  const analyses = artifact.analyses as Analyses;

  return <ReadyGraph graph={graph} analyses={analyses} missionId={missionId} />;
}

// ─── READY 态：拆成独立组件，让 useMemo / useState（全屏）等 hooks 合法且稳定 ───
function ReadyGraph({
  graph,
  analyses,
  missionId,
}: {
  graph: MissionGraph;
  analyses: Analyses;
  missionId: string;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<{
    id: string;
    label: string;
    type: string;
  } | null>(null);
  const [enrich, setEnrich] = useState<NodeEnrichment | null>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [enrichError, setEnrichError] = useState(false);
  const enrichCache = useRef<Map<string, NodeEnrichment>>(new Map());

  // 点击节点 → 打开抽屉 + 按需用 engine 工具抓取实体画像（按 session 缓存）。
  const handleNodeSelect = useCallback(
    (node: { id: string; label: string; type: string } | null) => {
      setSelectedNode(node);
      if (!node) {
        setEnrich(null);
        return;
      }
      const cached = enrichCache.current.get(node.id);
      if (cached) {
        setEnrich(cached);
        setEnrichLoading(false);
        setEnrichError(false);
        return;
      }
      setEnrich(null);
      setEnrichLoading(true);
      setEnrichError(false);
      enrichGraphNode(missionId, node.id)
        .then((r) => {
          enrichCache.current.set(node.id, r);
          setEnrich(r);
        })
        .catch(() => setEnrichError(true))
        .finally(() => setEnrichLoading(false));
    },
    [missionId]
  );
  const graphCardRef = useRef<HTMLDivElement>(null);

  // ★ 关键修复（flicker）：viewNodes/viewEdges 必须 useMemo 稳定引用。否则
  //   continuous(轮询)模式下父组件每次重渲染都 new array → KnowledgeGraphView 的
  //   useEffect([nodes,edges]) 反复重跑 → 力导向从 alpha=1 重启 → 持续闪烁、无法选中。
  const viewNodes = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        type: n.type,
        properties: {},
      })),
    [graph.nodes]
  );
  const viewEdges = useMemo(
    () =>
      graph.edges.map((e) => ({
        source: e.source,
        target: e.target,
        type: e.type,
        ...(e.weight != null ? { weight: e.weight } : {}),
      })),
    [graph.edges]
  );

  // 全屏：用浏览器 Fullscreen API 包裹图谱卡片；失败回退到 fixed inset-0 覆盖层。
  const toggleFullscreen = useCallback(() => {
    const el = graphCardRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => setFullscreen(true));
      setFullscreen(true);
    } else {
      void document.exitFullscreen?.();
      setFullscreen(false);
    }
  }, []);
  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  return (
    <div className="space-y-6">
      {/* Graph stats summary row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="节点总数"
          value={graph.stats.totalNodes}
          icon={<Network className="h-5 w-5" />}
          tone="blue"
        />
        <StatCard
          label="关系总数"
          value={graph.stats.totalEdges}
          icon={<Share2 className="h-5 w-5" />}
          tone="violet"
        />
        <StatCard
          label="关键节点"
          value={analyses.keyNodes.items.length}
          icon={<BarChart2 className="h-5 w-5" />}
          tone="emerald"
        />
        <StatCard
          label="社区数量"
          value={analyses.community.communities.length}
          icon={<Users className="h-5 w-5" />}
          tone="amber"
        />
      </div>

      {/* Knowledge graph visualization */}
      <div
        ref={graphCardRef}
        className={
          fullscreen
            ? 'fixed inset-0 z-50 flex flex-col bg-white p-4'
            : 'relative'
        }
      >
        <SectionPanelCard
          title="知识图谱"
          icon={<Network className="h-4 w-4" />}
          accent="blue"
          className={fullscreen ? 'flex flex-1 flex-col' : undefined}
        >
          <button
            type="button"
            onClick={toggleFullscreen}
            title={fullscreen ? '退出全屏' : '全屏展示'}
            className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white/90 px-2 py-1 text-xs text-gray-600 shadow-sm backdrop-blur-sm hover:bg-gray-50"
          >
            {fullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
            {fullscreen ? '退出全屏' : '全屏'}
          </button>
          <div
            className={
              fullscreen ? 'h-full min-h-0 w-full flex-1' : 'h-[480px] w-full'
            }
          >
            <KnowledgeGraphView
              nodes={viewNodes}
              edges={viewEdges}
              defaultLayout="force"
              onNodeSelect={handleNodeSelect}
            />
          </div>
        </SectionPanelCard>
      </div>

      {/* Five analysis panels */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 关键节点 */}
        <SectionPanelCard
          title="关键节点"
          icon={<BarChart2 className="h-4 w-4" />}
          accent="blue"
        >
          <div className="space-y-3 p-4">
            <p className="text-sm text-gray-600">{analyses.keyNodes.summary}</p>
            {analyses.keyNodes.items.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {analyses.keyNodes.items.slice(0, 8).map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between py-1.5 text-sm"
                  >
                    <span className="mr-2 flex-1 truncate font-medium text-gray-800">
                      {item.label}
                    </span>
                    <span className="flex-shrink-0 text-xs text-gray-500">
                      度: {item.degree} · 得分: {item.score.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SectionPanelCard>

        {/* 关联性 */}
        <SectionPanelCard
          title="关联性"
          icon={<Share2 className="h-4 w-4" />}
          accent="violet"
        >
          <div className="space-y-3 p-4">
            <p className="text-sm text-gray-600">
              {analyses.relatedness.summary}
            </p>
            {analyses.relatedness.pairs.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {analyses.relatedness.pairs.slice(0, 6).map((pair, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between py-1.5 text-sm"
                  >
                    <span className="mr-2 flex-1 truncate text-gray-800">
                      {pair.a} <span className="text-gray-400">—</span> {pair.b}
                    </span>
                    <span className="flex-shrink-0 text-xs text-gray-500">
                      强度: {pair.strength.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SectionPanelCard>

        {/* 竞争格局 */}
        <SectionPanelCard
          title="竞争格局"
          icon={<GitBranch className="h-4 w-4" />}
          accent="orange"
        >
          <div className="space-y-3 p-4">
            <p className="text-sm text-gray-600">
              {analyses.competitive.summary}
            </p>
            {analyses.competitive.clusters.length > 0 && (
              <ul className="space-y-2">
                {analyses.competitive.clusters.map((cluster, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-gray-700">
                      阵营 {i + 1}：
                    </span>
                    <span className="text-gray-600">
                      {cluster.members.join('、')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SectionPanelCard>

        {/* 集群社区 */}
        <SectionPanelCard
          title="集群社区"
          icon={<Users className="h-4 w-4" />}
          accent="emerald"
        >
          <div className="space-y-3 p-4">
            <p className="text-sm text-gray-600">
              {analyses.community.summary}
            </p>
            {analyses.community.communities.length > 0 && (
              <ul className="space-y-2">
                {analyses.community.communities.slice(0, 5).map((c) => (
                  <li key={c.id} className="text-sm">
                    <span className="font-medium text-gray-700">
                      社区 {c.id}：
                    </span>
                    <span className="text-gray-600">
                      {c.members.join('、')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SectionPanelCard>

        {/* 产业链 */}
        <SectionPanelCard
          title="产业链"
          icon={<Layers className="h-4 w-4" />}
          accent="amber"
          className="lg:col-span-2"
        >
          <div className="space-y-3 p-4">
            <p className="text-sm leading-relaxed text-gray-600">
              {analyses.supplyChain.summary}
            </p>
            {analyses.supplyChain.layers.length > 0 &&
              (() => {
                const layers = analyses.supplyChain.layers
                  .slice()
                  .sort((a, b) => a.order - b.order);
                const total = layers.length;
                // 按层位置生成"上游→下游"段落说明（后端暂无 per-layer 文本字段；
                // 这里据 order/总层数客户端生成定位说明，每层一段）。
                const roleOf = (idx: number): string => {
                  if (total === 1) return '全链路';
                  const r = idx / (total - 1);
                  if (r <= 0.33) return '上游';
                  if (r <= 0.66) return '中游';
                  return '下游';
                };
                return (
                  <ol className="space-y-2">
                    {layers.map((layer, idx) => (
                      <li key={layer.order}>
                        <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-500 px-2 text-xs font-bold text-white">
                              L{layer.order}
                            </span>
                            <span className="text-sm font-semibold text-amber-800">
                              {roleOf(idx)}环节
                            </span>
                            <span className="text-xs text-amber-600">
                              · {layer.members.length} 个实体
                            </span>
                          </div>
                          <p className="mb-2 text-xs leading-relaxed text-amber-700">
                            {layer.description
                              ? layer.description
                              : `本层为产业链${roleOf(idx)}环节，包含 ${layer.members.length} 个关键实体${idx < total - 1 ? '，向下游输出能力/产品' : '，为终端环节'}。`}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {layer.members.map((m, i) => (
                              <span
                                key={i}
                                className="rounded-md bg-white px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>
                        {idx < total - 1 && (
                          <div className="flex justify-center py-0.5 text-amber-400">
                            ↓
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                );
              })()}
          </div>
        </SectionPanelCard>
      </div>

      {/* 节点实体画像抽屉（点击节点 → 按需用 engine 工具抓取并展示） */}
      <SideDrawer
        open={!!selectedNode}
        onClose={() => handleNodeSelect(null)}
        widthPx={420}
      >
        {selectedNode && (
          <div className="space-y-4 p-5">
            <div>
              <span className="text-xs font-medium text-gray-500">
                {ENTITY_TYPE_LABEL[selectedNode.type] ?? selectedNode.type}
              </span>
              <h2 className="mt-0.5 text-lg font-bold text-gray-900">
                {selectedNode.label}
              </h2>
            </div>

            {enrichLoading && (
              <LoadingState text="正在用搜索/工具抓取实体画像…" size="sm" />
            )}
            {enrichError && (
              <p className="text-sm text-red-500">
                画像抓取失败，可关闭后重试。
              </p>
            )}

            {enrich && (
              <>
                {enrich.description && (
                  <p className="text-sm leading-relaxed text-gray-700">
                    {enrich.description}
                  </p>
                )}
                {enrich.facts.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      关键信息
                    </h3>
                    <dl className="space-y-1 text-sm">
                      {enrich.facts.map((f, i) => (
                        <div key={i} className="flex gap-2">
                          <dt className="w-20 flex-shrink-0 text-gray-500">
                            {f.label}
                          </dt>
                          <dd className="flex-1 text-gray-800">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
                {enrich.sources.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      来源
                    </h3>
                    <ul className="space-y-1">
                      {enrich.sources.map((s, i) => (
                        <li key={i}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate text-xs text-blue-600 hover:underline"
                          >
                            {s.title || s.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!enrich.description &&
                  enrich.facts.length === 0 &&
                  enrich.sources.length === 0 && (
                    <p className="text-sm text-gray-400">
                      未能抓取到该实体的更多信息。
                    </p>
                  )}
              </>
            )}
          </div>
        )}
      </SideDrawer>
    </div>
  );
}

const ENTITY_TYPE_LABEL: Record<string, string> = {
  ORGANIZATION: '组织/机构',
  PERSON: '人物',
  TECHNOLOGY: '技术',
  PRODUCT: '产品',
  CONCEPT: '概念',
  EVENT: '事件',
  LOCATION: '地点',
  TREND: '趋势',
  METRIC: '指标',
  OTHER: '其他',
};
