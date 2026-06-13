'use client';

/**
 * MissionDagView —— 完整 Mission DAG 可视化(可拖可缩 canvas)。
 *
 * 设计原则(2026-05-26 v3):
 *   - 后端是真源:nodes/edges/status/rerunable/cascade/react 全部从 /dag 接口拿。
 *   - canvas 用 d3-zoom 提供"鼠标拖动 + 滚轮缩放 + 触屏 pinch",底层仍是 SVG +
 *     绝对定位 div(hover 按钮 / 状态 chip 等都保留),外层 transform 整体缩放。
 *   - layout 用固定 canvasW=1500(不再随容器宽变化),用户用 zoom 自适应观看;
 *     底部右侧浮 +/- /fit/reset 控件做兜底。
 *   - 每节点 hover 出 2 个按钮:↻ 重跑级联预览 / ○ 内部循环(ReAct ring)。
 *   - 点 ↻ → /dag/cascade 染色 + 顶部 bar 给"将级联 N / 保留 M",确认 → localRerunTodo。
 *   - 点 ○ → /dag/react/:nodeId 拉 ReAct 快照 → 独立 Modal 叠在外层 DAG Modal 上。
 *   - liveSignal prop 变化 → 节流 1s 重拉 /dag(让 WS 事件触发增量刷新)。
 */

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import * as d3 from 'd3';
import {
  fetchMissionDag,
  fetchMissionDagCascade,
  fetchMissionDagReact,
  localRerunTodo,
  type MissionDagGraph,
  type MissionDagNode,
  type MissionDagCascadePreview,
  type MissionDagReactSnapshot,
} from '@/services/agent-playground/api';
import {
  Loader2,
  AlertCircle,
  Plus,
  Minus,
  Maximize2,
  Locate,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { Modal } from '@/components/ui/dialogs/Modal';

interface Props {
  missionId: string;
  /** 点节点(非按钮区域)的回调 → 父级抽屉显示该 agent 详情 */
  onAgentClick?: (nodeId: string) => void;
  /**
   * 父级事件流变化的信号(可传 events.length 之类);本组件检测到变化时节流
   * 1s 重拉 /dag,实现"WS 事件触发增量刷新"而不需要直接订阅 WS。
   */
  liveSignal?: number;
}

interface PositionedNode extends MissionDagNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 把后端 nodes 排进固定 canvasW=CANVAS_W 的画布。v3 不再随容器宽变化,因为引入
 * d3-zoom 后用户自己缩放即可——layout 反而需要"稳定不抖"。
 *   - canvas 永远 CANVAS_W 宽,fan 行数按 dim 数量决定(≤7 一行,≤14 两行,>14 三行)
 *   - 节点 / 间距用自然像素,缩放靠 transform CSS
 */
const CANVAS_W = 1500;
const FAN_TARGET_W = 160;
const FAN_MIN_W = 120;
function layoutGraph(
  graph: MissionDagGraph,
  canvasW: number
): { nodes: PositionedNode[]; canvasH: number; canvasW: number } {
  const stepOrder = [
    's1-budget',
    's2-leader-plan',
    's3-researcher-collect',
    's4-leader-assess',
    's5-reconciler',
    's6-analyst',
    's7-writer-outline',
    's8-writer',
    's8b-quality-enhancement',
    's9-critic',
    's9b-objective-eval',
    's10-leader-foreword-signoff',
    's11-persist',
  ];
  const macroH = 44;
  const macroGap = 22;
  const fanH = 52;
  const fanGap = 14;
  const fanRowGap = 18;

  const dimNodes = graph.nodes.filter((n) => n.kind === 'research-dim');
  // 固定 canvasW 下:按目标节点宽度算 maxPerRow,再 ceil 出 rows;rows 决定行数,perRowCount 是每行容量
  let fanRows = 1;
  let perRowCount = dimNodes.length;
  if (dimNodes.length > 0) {
    const usable = Math.max(200, canvasW - 60);
    const maxPerRow = Math.max(
      1,
      Math.floor((usable + fanGap) / (FAN_TARGET_W + fanGap))
    );
    fanRows = Math.max(1, Math.ceil(dimNodes.length / maxPerRow));
    perRowCount = Math.ceil(dimNodes.length / fanRows);
  }
  const fanReservedH = fanRows * fanH + (fanRows - 1) * fanRowGap + 18;

  const macroSpineY: Record<string, number> = {};
  let cursorY = 18;
  for (const sid of stepOrder) {
    macroSpineY[sid] = cursorY;
    cursorY +=
      sid === 's3-researcher-collect'
        ? macroH + macroGap + fanReservedH
        : macroH + macroGap;
  }
  const canvasH = cursorY + 18;
  const cx = canvasW / 2;
  const positioned: PositionedNode[] = [];

  for (const n of graph.nodes) {
    if (n.kind === 'research-dim') continue;
    const y = macroSpineY[n.id] ?? cursorY;
    let w = 240;
    const h = macroH;
    let x = cx - w / 2;
    if (n.kind === 'writer') {
      w = 220;
      x = cx - w - 36;
    }
    if (
      n.id === 's9-critic' ||
      n.id === 's9b-objective-eval' ||
      n.id === 's8b-quality-enhancement'
    ) {
      w = 220;
      x = cx - w / 2;
    }
    positioned.push({ ...n, x, y, w, h });
  }

  // research-dim 节点:多行 fan,每行匀称居中
  const s3Y = macroSpineY['s3-researcher-collect'] ?? 200;
  const fanStartY = s3Y + macroH + 14;
  const fanW =
    perRowCount === 0
      ? 0
      : Math.max(
          FAN_MIN_W,
          Math.floor((canvasW - 60 - (perRowCount - 1) * fanGap) / perRowCount)
        );
  for (let i = 0; i < dimNodes.length; i++) {
    const row = Math.floor(i / perRowCount);
    const col = i % perRowCount;
    const thisRowCount =
      row === fanRows - 1 ? dimNodes.length - row * perRowCount : perRowCount;
    const thisRowW = thisRowCount * fanW + (thisRowCount - 1) * fanGap;
    const rowStartX = cx - thisRowW / 2;
    const x = rowStartX + col * (fanW + fanGap);
    const y = fanStartY + row * (fanH + fanRowGap);
    positioned.push({ ...dimNodes[i], x, y, w: fanW, h: fanH });
  }

  return { nodes: positioned, canvasH, canvasW };
}

function statusToCls(status: string): string {
  switch (status) {
    case 'done':
      return 'border-emerald-500 bg-white';
    case 'running':
      return 'border-blue-500 bg-blue-50 shadow-[0_0_0_3px_rgb(239_246_255)]';
    case 'failed':
      return 'border-red-500 bg-red-50';
    case 'degraded':
      return 'border-amber-500 bg-amber-50';
    case 'cancelled':
      return 'border-gray-400 bg-gray-50';
    default:
      return 'border-slate-300 bg-white';
  }
}
function dotCls(status: string): string {
  switch (status) {
    case 'done':
      return 'bg-emerald-500';
    case 'running':
      return 'bg-blue-500 animate-pulse';
    case 'failed':
      return 'bg-red-500';
    case 'degraded':
      return 'bg-amber-500';
    case 'cancelled':
      return 'bg-gray-400';
    default:
      return 'bg-slate-300';
  }
}

function bezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  loop: boolean = false
): string {
  if (loop) {
    // self-loop:小弧
    return `M${x1},${y1} C${x1 + 60},${y1 - 10} ${x2 + 60},${y2 + 10} ${x2},${y2}`;
  }
  const dy = y2 - y1;
  const dx = x2 - x1;
  // 主要是垂直,加一点水平偏移
  const c1x = x1 + dx * 0.1;
  const c1y = y1 + dy * 0.5;
  const c2x = x2 - dx * 0.1;
  const c2y = y2 - dy * 0.5;
  return `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
}

export function MissionDagView({ missionId, onAgentClick, liveSignal }: Props) {
  const [graph, setGraph] = useState<MissionDagGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFor, setSelectedFor] = useState<{
    node: MissionDagNode;
    preview: MissionDagCascadePreview;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // Phase 2: ReAct ring 面板
  const [reactSnap, setReactSnap] = useState<{
    node: MissionDagNode;
    snap: MissionDagReactSnapshot | null; // null = loading
  } | null>(null);
  // WS 触发 /dag 重拉的节流 timer
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加载图
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchMissionDag(missionId)
      .then((g) => {
        if (alive) {
          setGraph(g);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          setError(e instanceof Error ? e.message : 'load failed');
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [missionId]);

  // v3:固定 canvasW(layout 稳定),d3-zoom 给 transform = translate(x,y) scale(k)
  // 关键 bug 修(2026-05-26):loading early-return 阶段 canvas div 不在 DOM,
  // 用 useEffect+`[]` deps 会在 mount 时跑(那时 ref=null),后续 graph 拉到也不会
  // 重跑 → zoom 永远没装上(拖不动)。改用 ref-callback,在 div 真正进 DOM 时即时装。
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<
    HTMLDivElement,
    unknown
  > | null>(null);
  const [zoomT, setZoomT] = useState<{ x: number; y: number; k: number }>({
    x: 0,
    y: 0,
    k: 1,
  });
  // ★ 2026-05-27 (Screenshot_23) 节点级拖拽支持：保存每个节点的用户拖拽 offset。
  //   渲染时 effective pos = layout 算的 (x, y) + 用户 offset。zoom k 用于将
  //   屏幕像素 delta 还原为 canvas 坐标 delta。
  const [nodeOffsets, setNodeOffsets] = useState<
    Record<string, { dx: number; dy: number }>
  >({});
  const dragStateRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    startDx: number;
    startDy: number;
    moved: boolean;
  } | null>(null);

  const { nodes, canvasH, canvasW } = useMemo(() => {
    if (!graph)
      return {
        nodes: [] as PositionedNode[],
        canvasH: 600,
        canvasW: CANVAS_W,
      };
    return layoutGraph(graph, CANVAS_W);
  }, [graph]);

  const attachZoom = useCallback((el: HTMLDivElement | null) => {
    // 卸载
    if (!el) {
      if (canvasContainerRef.current) {
        d3.select(canvasContainerRef.current).on('.zoom', null);
      }
      canvasContainerRef.current = null;
      zoomBehaviorRef.current = null;
      return;
    }
    // 已装在同一 el 上则跳过
    if (canvasContainerRef.current === el && zoomBehaviorRef.current) return;
    canvasContainerRef.current = el;

    const sel = d3.select<HTMLDivElement, unknown>(el);
    const zb = d3
      .zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.3, 2.5])
      .filter((event: Event) => {
        if (event.type === 'wheel') return true;
        const target = event.target as HTMLElement | null;
        if (!target) return true;
        if (target.closest('[data-dag-interactive]')) return false;
        return true;
      })
      .on('zoom', (event: d3.D3ZoomEvent<HTMLDivElement, unknown>) => {
        const { x, y, k } = event.transform;
        setZoomT({ x, y, k });
      });
    sel.call(zb);
    zoomBehaviorRef.current = zb;
  }, []);

  // 控件:+/-/fit/reset。d3 selection.call(fn,...) 会把 fn 当 unbound method
  // 触发 lint;直接把 selection 传给 zoom 方法等价、且保留 zb 的 this。
  const zoomBy = useCallback((factor: number) => {
    const el = canvasContainerRef.current;
    const zb = zoomBehaviorRef.current;
    if (!el || !zb) return;
    zb.scaleBy(d3.select(el).transition().duration(180), factor);
  }, []);
  const zoomReset = useCallback(() => {
    const el = canvasContainerRef.current;
    const zb = zoomBehaviorRef.current;
    if (!el || !zb) return;
    zb.transform(d3.select(el).transition().duration(220), d3.zoomIdentity);
  }, []);
  const zoomFit = useCallback(() => {
    const el = canvasContainerRef.current;
    const zb = zoomBehaviorRef.current;
    if (!el || !zb) return;
    const rect = el.getBoundingClientRect();
    const pad = 24;
    const sx = (rect.width - pad * 2) / canvasW;
    const sy = (rect.height - pad * 2) / canvasH;
    const k = Math.min(sx, sy, 1);
    const tx = (rect.width - canvasW * k) / 2;
    const ty = pad;
    zb.transform(
      d3.select(el).transition().duration(240),
      d3.zoomIdentity.translate(tx, ty).scale(k)
    );
  }, [canvasW, canvasH]);

  // 首次加载完图后自动 fit 一次,避免初始 transform=(0,0,1) 节点跑出可视区域
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (didInitialFit.current || !graph || !zoomBehaviorRef.current) return;
    // 微延后让容器 ResizeObserver / layout 稳定
    const t = setTimeout(() => {
      zoomFit();
      didInitialFit.current = true;
    }, 50);
    return () => clearTimeout(t);
  }, [graph, zoomFit]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const onRetry = useCallback(
    async (node: MissionDagNode) => {
      if (!node.rerunable) return;
      try {
        const preview = await fetchMissionDagCascade(missionId, node.id);
        setSelectedFor({ node, preview });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'cascade failed');
      }
    },
    [missionId]
  );

  const clearSel = useCallback(() => setSelectedFor(null), []);

  // Phase 2: 点 ○ → 拉 ReAct 快照 → 弹面板
  const onLoop = useCallback(
    async (node: MissionDagNode) => {
      setReactSnap({ node, snap: null });
      try {
        const snap = await fetchMissionDagReact(missionId, node.id);
        setReactSnap({ node, snap });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'react snapshot failed');
        setReactSnap(null);
      }
    },
    [missionId]
  );
  const closeReact = useCallback(() => setReactSnap(null), []);

  // WS 增量:liveSignal 变化 → 节流 1s 重拉 /dag
  useEffect(() => {
    if (liveSignal === undefined || !graph) return;
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      fetchMissionDag(missionId)
        .then((g) => setGraph(g))
        .catch(() => {
          /* 静默失败 —— 增量刷新不打扰主流程 */
        });
    }, 1000);
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
    // graph 故意不进 deps:防止 setGraph 触发自激
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSignal, missionId]);

  const onConfirmRerun = useCallback(async () => {
    if (!selectedFor) return;
    const { node } = selectedFor;
    const stepId = node.kind === 'research-dim' ? node.parentStepId : node.id;
    if (!stepId) return;
    setBusy(true);
    try {
      await localRerunTodo(missionId, '__mission-dag__', {
        origin: 'mission-dag',
        scope: node.kind === 'research-dim' ? 'dimension' : 'system',
        dimensionRef: node.dimensionRef,
        stepId,
        reasonText: '通过 Mission DAG 触发的级联重跑',
      });
      clearSel();
      // 重新加载图
      const g = await fetchMissionDag(missionId);
      setGraph(g);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'rerun failed');
    } finally {
      setBusy(false);
    }
  }, [missionId, selectedFor, clearSel]);

  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载 Mission DAG…
      </div>
    );
  }
  // ★ 2026-05-27 Screenshot_59 修复：error 是 initial graph 加载失败时显示全屏失败；
  //   一旦图已加载（graph 存在），任何 button 点击 API 失败（onRetry/onLoop）只应弹
  //   inline banner（见下方 floating error toast），不能整个替换 canvas — 否则用户
  //   感觉"按钮直接关闭弹层"。
  if (error && !graph) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <div className="font-semibold">加载失败</div>
          <div className="font-mono mt-1 text-xs">{error}</div>
        </div>
      </div>
    );
  }
  if (!graph || graph.nodes.length === 0) {
    return <EmptyState title="尚无 DAG 数据" />;
  }

  // 计算 cascade 集合
  const sel = selectedFor;
  const willSet = sel ? new Set(sel.preview.willRerun) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* 顶部 action bar：选中节点时显示 cascade summary */}
      {sel && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm">
          <span className="font-bold text-amber-700">↻</span>
          <span>
            重跑 <b>{sel.node.label}</b>
            {sel.node.sub ? ` · ${sel.node.sub}` : ''}
          </span>
          <span className="text-gray-500">→</span>
          {sel.preview.rerunable ? (
            <span>
              <b className="text-amber-700">
                级联 {sel.preview.willRerun.length} 个下游
              </b>
              <span className="text-gray-500">
                ，其余 {sel.preview.kept.length} 个保留
              </span>
            </span>
          ) : (
            <span className="text-red-600">
              {sel.preview.reason ?? '不允许重跑'}
            </span>
          )}
          <span className="ml-auto flex gap-2">
            {sel.preview.rerunable && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onConfirmRerun()}
                className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {busy ? '触发中…' : '确认重跑'}
              </button>
            )}
            <button
              type="button"
              onClick={clearSel}
              className="rounded-lg bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-200"
            >
              取消
            </button>
          </span>
        </div>
      )}

      {/* v3 Canvas:d3-zoom 提供"鼠标拖动 + 滚轮缩放",overflow-hidden + transform CSS。
          空白区域 cursor-grab,节点上有 data-dag-interactive 让 d3 不接管(保留 hover/click)。 */}
      <div
        ref={attachZoom}
        className="relative cursor-grab overflow-hidden rounded-xl border border-gray-200 bg-gray-50/30 active:cursor-grabbing"
        style={{ height: 'calc(85vh - 130px)' }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: canvasW,
            height: canvasH,
            transform: `translate(${zoomT.x}px, ${zoomT.y}px) scale(${zoomT.k})`,
            transformOrigin: '0 0',
          }}
        >
          <svg
            width={canvasW}
            height={canvasH}
            className="block"
            style={{ overflow: 'visible' }}
          >
            <defs>
              <marker
                id="dag-arrow"
                markerWidth="12"
                markerHeight="12"
                refX="10"
                refY="5"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 Z" fill="#64748b" />
              </marker>
              <marker
                id="dag-arrow-amber"
                markerWidth="12"
                markerHeight="12"
                refX="10"
                refY="5"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 Z" fill="#f59e0b" />
              </marker>
            </defs>
            {graph.edges.map((e, i) => {
              const a = nodeMap.get(e.from);
              const b = nodeMap.get(e.to);
              if (!a || !b) return null;
              // ★ 2026-05-27 边端点跟随节点拖拽 offset
              const aOff = nodeOffsets[a.id];
              const bOff = nodeOffsets[b.id];
              const ax = a.x + (aOff?.dx ?? 0);
              const ay = a.y + (aOff?.dy ?? 0);
              const bx = b.x + (bOff?.dx ?? 0);
              const by = b.y + (bOff?.dy ?? 0);
              const x1 = ax + a.w / 2;
              const y1 = ay + a.h;
              const x2 = bx + b.w / 2;
              const y2 = by;
              const isImpact =
                !!sel &&
                (sel.node.id === e.from || willSet?.has(e.from)) &&
                willSet?.has(e.to);
              const dim = !!sel && !isImpact;
              const isLoop = e.kind === 'rewrite-loop';
              const isSelf = e.kind === 'self-loop';
              return (
                <path
                  key={i}
                  d={bezierPath(x1, y1, x2, y2, isSelf)}
                  fill="none"
                  stroke={isImpact ? '#f59e0b' : isLoop ? '#f59e0b' : '#64748b'}
                  strokeWidth={isImpact ? 3 : 2.2}
                  strokeDasharray={
                    isLoop || isSelf ? '6 5' : isImpact ? '7 6' : undefined
                  }
                  opacity={dim ? 0.15 : 1}
                  markerEnd={
                    isImpact ? 'url(#dag-arrow-amber)' : 'url(#dag-arrow)'
                  }
                />
              );
            })}
          </svg>
          {/* 节点用 div 叠在 svg 上(更好做 hover/按钮) */}
          {nodes.map((n) => {
            const isSel = sel?.node.id === n.id;
            const isWill = willSet?.has(n.id);
            const isKept = !!sel && !isSel && !isWill;
            const cls = isSel
              ? 'border-amber-500 ring-4 ring-amber-100 shadow-md'
              : isWill
                ? 'border-amber-400 border-dashed bg-amber-50'
                : statusToCls(n.status);
            // ★ 2026-05-27 节点拖拽位置
            const off = nodeOffsets[n.id];
            const left = n.x + (off?.dx ?? 0);
            const top = n.y + (off?.dy ?? 0);
            return (
              <div
                key={n.id}
                data-dag-interactive
                className={`group absolute cursor-move select-none rounded-xl border-2 bg-white px-2.5 py-1 transition-shadow ${cls} ${
                  isKept ? 'opacity-40 grayscale' : ''
                }`}
                style={{ left, top, width: n.w, height: n.h }}
                onPointerDown={(e) => {
                  // 仅左键拖
                  if (e.button !== 0) return;
                  // ★ Screenshot_70/#103 真根因 (2026-05-27):
                  //   下方 hover ↻/○ 两个按钮 (line 734/750) 在 node div 内部,
                  //   pointer-down 冒泡到 node div 时 setPointerCapture 抢走所有
                  //   后续 pointer 事件 → click 永远不到达按钮 onClick → 用户点
                  //   按钮"没反应"误判为弹层关闭/hydration 错误。
                  //   修复: 判断 target 在 button (或其他交互元素) 内时, 跳过 drag
                  //   捕获让原生 click 正常分发到按钮。
                  const target = e.target as HTMLElement | null;
                  if (
                    target &&
                    (target.closest('button') || target.closest('a'))
                  ) {
                    return;
                  }
                  (e.currentTarget as HTMLElement).setPointerCapture(
                    e.pointerId
                  );
                  const cur = nodeOffsets[n.id];
                  dragStateRef.current = {
                    id: n.id,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    startDx: cur?.dx ?? 0,
                    startDy: cur?.dy ?? 0,
                    moved: false,
                  };
                }}
                onPointerMove={(e) => {
                  const s = dragStateRef.current;
                  if (!s || s.id !== n.id) return;
                  // 屏幕 delta 还原为 canvas delta：除 zoom k
                  const k = zoomT.k || 1;
                  const dx = s.startDx + (e.clientX - s.startClientX) / k;
                  const dy = s.startDy + (e.clientY - s.startClientY) / k;
                  if (!s.moved) {
                    if (
                      Math.abs(e.clientX - s.startClientX) > 3 ||
                      Math.abs(e.clientY - s.startClientY) > 3
                    ) {
                      s.moved = true;
                    }
                  }
                  if (s.moved) {
                    setNodeOffsets((prev) => ({
                      ...prev,
                      [n.id]: { dx, dy },
                    }));
                  }
                }}
                onPointerUp={(e) => {
                  const s = dragStateRef.current;
                  dragStateRef.current = null;
                  try {
                    (e.currentTarget as HTMLElement).releasePointerCapture(
                      e.pointerId
                    );
                  } catch {
                    // pointer 已释放，无影响
                  }
                  // 真正拖动了 → 不触发 click
                  if (s?.moved) return;
                  // ★ Screenshot_79 真根因 (2026-05-27):
                  //   pointer-up 从 hover ↻/○ 按钮冒泡上来时, 不能触发 onAgentClick
                  //   (会关 DAG modal + 弹 todo drawer, 错误地"吃掉"了 button click)。
                  //   前一次 4e8b3f13a 只修了 pointerDown 跳过 drag 捕获, 但没拦截
                  //   pointerUp → onAgentClick 路径, 用户点 button 还是跳到 drawer。
                  const target = e.target as HTMLElement | null;
                  if (
                    target &&
                    (target.closest('button') || target.closest('a'))
                  ) {
                    return;
                  }
                  onAgentClick?.(n.id);
                }}
                onDoubleClick={() => {
                  // 双击复位单个节点
                  setNodeOffsets((prev) => {
                    if (!prev[n.id]) return prev;
                    const { [n.id]: _, ...rest } = prev;
                    return rest;
                  });
                }}
              >
                {/* 左上 status dot */}
                <span
                  className={`absolute left-1.5 top-1.5 h-2 w-2 rounded-full ${dotCls(n.status)}`}
                />
                {/* 右上 iter badge(running 才显示) */}
                {n.iter != null && (
                  <span className="font-mono absolute right-7 top-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                    ↻{n.iter}
                  </span>
                )}
                {/* Phase 3.2: 右下 score chip(reviewer/签收 类节点) */}
                {n.score != null && (
                  <span
                    className={`font-mono absolute -bottom-2 right-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                      n.score >= 80
                        ? 'bg-emerald-500 text-white'
                        : n.score >= 65
                          ? 'bg-amber-500 text-white'
                          : 'bg-red-500 text-white'
                    }`}
                  >
                    {n.score}
                  </span>
                )}
                {/* 节点 label */}
                <div className="text-center text-[13px] font-bold leading-tight">
                  {n.label}
                </div>
                {n.sub && (
                  <div className="truncate text-center text-[10.5px] leading-tight text-gray-500">
                    {n.sub}
                  </div>
                )}

                {/* hover 2 按钮：↻ 重跑预览 + ○ 内部循环(P2) */}
                <div className="pointer-events-none absolute -right-3 -top-3 z-10 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                  <button
                    type="button"
                    disabled={!n.rerunable || busy}
                    title={
                      n.rerunable
                        ? '预览重跑影响链路'
                        : (n.rerunableReason ?? '不可重跑')
                    }
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void onRetry(n);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-amber-500 bg-white text-[13px] font-bold text-amber-600 shadow-md hover:scale-110 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    title="展开 ReAct 内部循环"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void onLoop(n);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-blue-500 bg-white text-[13px] font-bold text-blue-600 shadow-md hover:scale-110"
                  >
                    ○
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* zoom 控件 + 提示 —— 浮在 canvas 右下;按钮带 data-dag-interactive 避免被 pan 拦截 */}
        <div
          className="absolute bottom-3 right-3 flex flex-col gap-1.5"
          data-dag-interactive
        >
          <div className="flex flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-md">
            <button
              type="button"
              onClick={() => zoomBy(1.25)}
              title="放大"
              className="flex h-8 w-8 items-center justify-center text-gray-600 hover:bg-gray-50"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => zoomBy(0.8)}
              title="缩小"
              className="flex h-8 w-8 items-center justify-center border-t border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={zoomFit}
              title="适配画布"
              className="flex h-8 w-8 items-center justify-center border-t border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={zoomReset}
              title="还原 100%"
              className="flex h-8 w-8 items-center justify-center border-t border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              <Locate className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="font-mono rounded-md bg-white/90 px-1.5 py-0.5 text-center text-[10px] text-gray-500 shadow-sm">
            {Math.round(zoomT.k * 100)}%
          </div>
        </div>

        {/* 操作提示 */}
        <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-white/85 px-2 py-1 text-[10.5px] text-gray-500 shadow-sm backdrop-blur-sm">
          拖动平移 · 滚轮缩放 · hover 节点出按钮
        </div>
      </div>

      {/* Phase 4 v3:ReAct 面板改为独立 Modal 叠在 DAG Modal 上方,canvas 永远全宽,
          不再因展开 panel 而被压扁(Screenshot_44 收口)。 */}
      {reactSnap && (
        <Modal
          open
          onClose={closeReact}
          title="节点内部 · ReAct 循环"
          subtitle={`${reactSnap.node.label}${reactSnap.snap?.dimension ? ` · ${reactSnap.snap.dimension}` : reactSnap.node.sub ? ` · ${reactSnap.node.sub}` : ''} · ${reactSnap.snap?.role ?? reactSnap.node.kind}`}
          size="md"
        >
          <ReactRingPanel
            missionId={missionId}
            node={reactSnap.node}
            snap={reactSnap.snap}
            liveSignal={liveSignal}
            onSnap={(s) =>
              setReactSnap((prev) =>
                prev && prev.node.id === reactSnap.node.id
                  ? { node: prev.node, snap: s }
                  : prev
              )
            }
          />
        </Modal>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// ReAct ring 面板(简化版,展示 think/tool/observe 循环 + finalize)
// ──────────────────────────────────────────────────────────────

function ReactRingPanel({
  missionId,
  node,
  snap,
  liveSignal,
  onSnap,
}: {
  missionId: string;
  node: MissionDagNode;
  snap: MissionDagReactSnapshot | null;
  liveSignal?: number;
  /** 内部静默 refetch 成功时把最新快照交回父级,父级用同 nodeId 替换 state */
  onSnap?: (s: MissionDagReactSnapshot) => void;
}) {
  // Phase 3.3: liveSignal 变化 → 节流 800ms 重拉同节点 react 快照(面板期间)
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (liveSignal === undefined || !snap) return;
    // 已结束/失败的节点不再刷(免无谓请求)
    if (snap.phase === 'completed' || snap.phase === 'failed') return;
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      fetchMissionDagReact(missionId, node.id)
        .then((s) => onSnap?.(s))
        .catch(() => {
          /* 静默 */
        });
    }, 800);
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
    // 故意省 snap/onSnap 依赖防止自激刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSignal, missionId, node.id]);

  const cur = snap?.currentStep ?? 'idle';
  const ringNodes = [
    { key: 'thinking', label: '思考', x: 145, y: 28 },
    { key: 'tool', label: '工具', x: 246, y: 168 },
    { key: 'observing', label: '观察', x: 44, y: 168 },
  ] as const;
  const isCur = (k: string) =>
    cur === k || (k === 'tool' && cur === 'finalizing'); // finalize 也显在工具点

  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[10.5px] text-gray-400">
        iter {snap?.iter ?? '—'}
        {snap?.maxIter ? `/${snap.maxIter}` : ''}
      </div>

      {snap?.note && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {snap.note}
        </div>
      )}

      {!snap && (
        <div className="mt-6 flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 拉取 ReAct 状态…
        </div>
      )}

      {snap && !snap.note && (
        <>
          {/* 环可视化 */}
          <div className="relative mx-auto mt-3 h-[200px] w-[290px]">
            <svg width="290" height="200" className="overflow-visible">
              {/* 三段曲线弧形成环 */}
              {[
                [ringNodes[0], ringNodes[1]],
                [ringNodes[1], ringNodes[2]],
                [ringNodes[2], ringNodes[0]],
              ].map(([a, b], i) => {
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                // bow 向中心外凸
                const cx = 145;
                const cy = 110;
                const ox = mx + (mx - cx) * 0.3;
                const oy = my + (my - cy) * 0.3;
                return (
                  <path
                    key={i}
                    d={`M${a.x + 32},${a.y + 16} Q${ox},${oy} ${b.x},${b.y + 8}`}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="1.6"
                    strokeDasharray="5 5"
                  />
                );
              })}
            </svg>
            {ringNodes.map((rn) => {
              const active = isCur(rn.key);
              return (
                <div
                  key={rn.key}
                  className={`absolute flex h-10 w-[78px] items-center justify-center rounded-full border-2 text-[12px] font-semibold ${
                    active
                      ? 'border-blue-500 bg-blue-100 text-blue-700 shadow-md'
                      : 'border-blue-300 bg-blue-50 text-blue-600'
                  }`}
                  style={{ left: rn.x, top: rn.y }}
                >
                  {rn.label}
                </div>
              );
            })}
            {/* 中心 spinner */}
            <div
              className={`absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-slate-300 ${
                cur !== 'idle' && cur !== 'completed' && cur !== 'failed'
                  ? 'animate-spin'
                  : ''
              }`}
              style={{ animationDuration: '3s' }}
            />
          </div>

          {/* finalize 状态 */}
          <div className="mx-auto mt-1 inline-flex w-fit items-center gap-2 self-center rounded-lg border-2 border-emerald-300 bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-700">
            finalize{' '}
            {snap.finalizeAttempts > 0 && (
              <span className="text-amber-600">
                · 被拒 {snap.finalizeAttempts}/3 ↻
              </span>
            )}
          </div>

          {/* 详情字段 */}
          <div className="mt-4 space-y-2 text-[12px] leading-relaxed">
            {snap.lastThought && (
              <div>
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
                  最近思考
                </span>
                <div className="mt-0.5 text-gray-700">{snap.lastThought}</div>
              </div>
            )}
            {snap.lastAction && (
              <div>
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
                  最近动作
                </span>
                <div className="font-mono mt-0.5 text-gray-700">
                  {snap.lastAction.kind}
                  {snap.lastAction.toolName
                    ? ` · ${snap.lastAction.toolName}`
                    : ''}
                </div>
              </div>
            )}
            {snap.lastObservation && (
              <div>
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
                  最近观察
                </span>
                <div className="font-mono mt-0.5 text-gray-700">
                  {snap.lastObservation.kind}
                </div>
              </div>
            )}
            {snap.lastError && (
              <div className="font-mono rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">
                ⚠ {snap.lastError}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default MissionDagView;
