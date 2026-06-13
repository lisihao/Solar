'use client';

/**
 * Wiki Graph Modal - concentric SVG layout of pages (nodes) and `[[slug]]`
 * references (edges). Tuned for a lighter, more productized visual treatment
 * while preserving the existing pan/zoom + click-to-open interaction model.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Loader2, Maximize2, Minus, Plus, X } from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { wikiApi, type WikiPage, type WikiPageCategory } from '@/lib/api/wiki';
import { logger } from '@/lib/utils/logger';
import { useTranslation } from '@/lib/i18n';

const GRAPH_CATEGORY_COLORS: Record<WikiPageCategory, string> = {
  SUMMARY: '#a855f7',
  ENTITY: '#0ea5e9',
  CONCEPT: '#22c55e',
  SOURCE: '#f59e0b',
};

const RING_RADII: Record<WikiPageCategory, number> = {
  SUMMARY: 100,
  ENTITY: 230,
  CONCEPT: 360,
  SOURCE: 470,
};

const RING_ORDER: WikiPageCategory[] = [
  'SUMMARY',
  'ENTITY',
  'CONCEPT',
  'SOURCE',
];

const VB_HALF = 520;
const MIN_SCALE = 0.4;
const MAX_SCALE = 6;
const CATEGORY_START_ANGLE: Record<WikiPageCategory, number> = {
  SUMMARY: -Math.PI / 2,
  ENTITY: -Math.PI / 3,
  CONCEPT: Math.PI / 2,
  SOURCE: Math.PI / 6,
};

type Point = { x: number; y: number };

export default function WikiGraphModal({
  kbId,
  onClose,
  onSelectSlug,
}: {
  kbId: string;
  onClose: () => void;
  onSelectSlug: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ cx: 0, cy: 0, scale: 1 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startCx: number;
    startCy: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    wikiApi
      .listPages(kbId, undefined, 1000)
      .then((res) => {
        if (!cancelled) setPages(res.items);
      })
      .catch((err) => logger?.error?.('[wiki] graph listPages failed', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kbId]);

  const { nodes, edges } = useMemo(() => {
    const slugSet = new Set(pages.map((p) => p.slug));
    const linkRe = /\[\[([a-z0-9][a-z0-9-]*[a-z0-9])\]\]/g;
    type Edge = { source: string; target: string };
    const edgeList: Edge[] = [];
    for (const p of pages) {
      const body = p.body ?? '';
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(body)) !== null) {
        const target = m[1];
        if (target === p.slug || seen.has(target)) continue;
        if (!slugSet.has(target)) continue;
        seen.add(target);
        edgeList.push({ source: p.slug, target });
      }
    }
    return { nodes: pages, edges: edgeList };
  }, [pages]);

  const layout = useMemo(() => {
    const grouped: Record<WikiPageCategory, WikiPage[]> = {
      SUMMARY: [],
      ENTITY: [],
      CONCEPT: [],
      SOURCE: [],
    };
    for (const p of nodes) grouped[p.category].push(p);
    const positions = new Map<string, Point>();
    for (const cat of RING_ORDER) {
      const items = grouped[cat];
      const r = RING_RADII[cat];
      const n = items.length;
      items.forEach((p, i) => {
        const start = CATEGORY_START_ANGLE[cat];
        const theta = n === 1 ? start : start + (i / n) * Math.PI * 2;
        positions.set(p.slug, {
          x: r * Math.cos(theta),
          y: r * Math.sin(theta),
        });
      });
    }
    return positions;
  }, [nodes]);

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!map.has(e.source)) map.set(e.source, new Set());
      if (!map.has(e.target)) map.set(e.target, new Set());
      map.get(e.source)!.add(e.target);
      map.get(e.target)!.add(e.source);
    }
    return map;
  }, [edges]);

  const degreeBySlug = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of nodes) map.set(p.slug, 0);
    for (const e of edges) {
      map.set(e.source, (map.get(e.source) ?? 0) + 1);
      map.set(e.target, (map.get(e.target) ?? 0) + 1);
    }
    return map;
  }, [edges, nodes]);

  const screenToSvg = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const vbW = (2 * VB_HALF) / view.scale;
      const vbH = (2 * VB_HALF) / view.scale;
      const fit = Math.min(rect.width / vbW, rect.height / vbH);
      const renderedW = vbW * fit;
      const renderedH = vbH * fit;
      const padX = (rect.width - renderedW) / 2;
      const padY = (rect.height - renderedH) / 2;
      const localX = (clientX - rect.left - padX) / fit;
      const localY = (clientY - rect.top - padY) / fit;
      return { x: localX + view.cx - VB_HALF, y: localY + view.cy - VB_HALF };
    },
    [view]
  );

  const handleWheel = useCallback(
    (e: ReactWheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
      setView((prev) => {
        const nextScale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE);
        if (nextScale === prev.scale) return prev;
        const anchor = screenToSvg(e.clientX, e.clientY);
        if (!anchor) return { ...prev, scale: nextScale };
        const ratio = prev.scale / nextScale;
        const nextCx = anchor.x - (anchor.x - prev.cx) * ratio;
        const nextCy = anchor.y - (anchor.y - prev.cy) * ratio;
        return { cx: nextCx, cy: nextCy, scale: nextScale };
      });
    },
    [screenToSvg]
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      const target = e.target as SVGElement;
      if (target.closest('g[data-wiki-node="1"]')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startCx: view.cx,
        startCy: view.cy,
      };
      setDragging(true);
    },
    [view]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const vbW = (2 * VB_HALF) / view.scale;
      const vbH = (2 * VB_HALF) / view.scale;
      const fit = Math.min(rect.width / vbW, rect.height / vbH);
      const dx = (e.clientX - drag.startX) / fit;
      const dy = (e.clientY - drag.startY) / fit;
      setView((prev) => ({
        ...prev,
        cx: drag.startCx - dx,
        cy: drag.startCy - dy,
      }));
    },
    [view.scale]
  );

  const handlePointerUp = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dragRef.current = null;
      setDragging(false);
    }
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setView((prev) => ({
      ...prev,
      scale: clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE),
    }));
  }, []);

  const resetView = useCallback(() => setView({ cx: 0, cy: 0, scale: 1 }), []);

  useEffect(() => {
    setView({ cx: 0, cy: 0, scale: 1 });
  }, [kbId]);

  const viewBox = `${view.cx - VB_HALF / view.scale} ${view.cy - VB_HALF / view.scale} ${(2 * VB_HALF) / view.scale} ${(2 * VB_HALF) / view.scale}`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="flex h-[95vh] w-full max-w-[1600px] flex-col overflow-hidden rounded-3xl border border-white/60 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.24)]">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {t('library.wiki.graph.title')}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {t('library.wiki.graph.subtitle', {
                nodes: nodes.length,
                edges: edges.length,
              })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <main className="relative flex-1 overflow-hidden bg-slate-50">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
            </div>
          ) : nodes.length === 0 ? (
            <EmptyState size="sm" title={t('library.wiki.graph.empty')} />
          ) : (
            <svg
              ref={svgRef}
              viewBox={viewBox}
              className={`h-full w-full select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
              preserveAspectRatio="xMidYMid meet"
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <defs>
                <radialGradient id="wiki-graph-bg" cx="50%" cy="42%" r="75%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="68%" stopColor="#f8fafc" />
                  <stop offset="100%" stopColor="#eef2ff" />
                </radialGradient>
                {RING_ORDER.map((cat) => (
                  <radialGradient
                    key={`glow-${cat}`}
                    id={`wiki-node-glow-${cat}`}
                    cx="50%"
                    cy="50%"
                    r="50%"
                  >
                    <stop
                      offset="0%"
                      stopColor={GRAPH_CATEGORY_COLORS[cat]}
                      stopOpacity="0.24"
                    />
                    <stop
                      offset="100%"
                      stopColor={GRAPH_CATEGORY_COLORS[cat]}
                      stopOpacity="0"
                    />
                  </radialGradient>
                ))}
                <filter
                  id="wiki-soft-shadow"
                  x="-50%"
                  y="-50%"
                  width="200%"
                  height="200%"
                >
                  <feDropShadow
                    dx="0"
                    dy="8"
                    stdDeviation="12"
                    floodColor="#0f172a"
                    floodOpacity="0.12"
                  />
                </filter>
                <filter
                  id="wiki-edge-glow"
                  x="-50%"
                  y="-50%"
                  width="200%"
                  height="200%"
                >
                  <feGaussianBlur stdDeviation="2.4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <rect
                x={-VB_HALF}
                y={-VB_HALF}
                width={VB_HALF * 2}
                height={VB_HALF * 2}
                fill="url(#wiki-graph-bg)"
              />

              {RING_ORDER.map((cat) => {
                const ringR = RING_RADII[cat];
                return (
                  <g key={`ring-${cat}`} opacity={hover ? 0.38 : 1}>
                    <circle
                      cx={0}
                      cy={0}
                      r={ringR}
                      fill={GRAPH_CATEGORY_COLORS[cat]}
                      fillOpacity={0.02}
                      stroke={GRAPH_CATEGORY_COLORS[cat]}
                      strokeOpacity={0.12}
                      strokeWidth={1.2}
                      strokeDasharray="5 10"
                    />
                    <text
                      x={0}
                      y={-ringR - 14}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={700}
                      letterSpacing="0.18em"
                      fill="#94a3b8"
                    >
                      {cat}
                    </text>
                  </g>
                );
              })}

              {edges.map((e, i) => {
                const a = layout.get(e.source);
                const b = layout.get(e.target);
                if (!a || !b) return null;
                const highlighted =
                  hover != null && (e.source === hover || e.target === hover);
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                const nx = -(b.y - a.y) / dist;
                const ny = (b.x - a.x) / dist;
                const centerBias = clamp(
                  1 - Math.hypot(mx, my) / VB_HALF,
                  0.15,
                  1
                );
                const curve = clamp(dist * 0.14 + 18, 18, 56) * centerBias;
                const cx = mx + nx * curve - mx * 0.14;
                const cy = my + ny * curve - my * 0.14;
                return (
                  <path
                    key={`${e.source}-${e.target}-${i}`}
                    d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`}
                    fill="none"
                    stroke={highlighted ? '#7c3aed' : '#cbd5e1'}
                    strokeWidth={highlighted ? 2.4 : 1.15}
                    strokeLinecap="round"
                    opacity={highlighted ? 0.98 : hover ? 0.12 : 0.45}
                    filter={highlighted ? 'url(#wiki-edge-glow)' : undefined}
                  />
                );
              })}

              {nodes.map((p) => {
                const pos = layout.get(p.slug);
                if (!pos) return null;
                const degree = degreeBySlug.get(p.slug) ?? 0;
                const nodeRadius =
                  hover === p.slug ? 12 : Math.min(11, 7 + degree * 0.55);
                const highlighted =
                  hover === p.slug ||
                  (hover != null && adjacency.get(hover)?.has(p.slug));
                const dimmed = hover != null && !highlighted;
                const showLabel =
                  hover === p.slug || highlighted || nodes.length <= 24;
                const label =
                  p.title.length > 18 ? `${p.title.slice(0, 17)}…` : p.title;
                const labelWidth = Math.max(68, label.length * 6.3 + 18);
                return (
                  <g
                    key={p.slug}
                    data-wiki-node="1"
                    transform={`translate(${pos.x},${pos.y})`}
                    onMouseEnter={() => setHover(p.slug)}
                    onMouseLeave={() => setHover(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectSlug(p.slug);
                    }}
                    className="cursor-pointer"
                    opacity={dimmed ? 0.25 : 1}
                  >
                    <circle
                      r={nodeRadius + 11}
                      fill={`url(#wiki-node-glow-${p.category})`}
                      opacity={highlighted ? 1 : 0.8}
                    />
                    <circle
                      r={nodeRadius + 2}
                      fill="#ffffff"
                      fillOpacity={0.9}
                      stroke={GRAPH_CATEGORY_COLORS[p.category]}
                      strokeOpacity={0.18}
                      strokeWidth={1}
                      filter="url(#wiki-soft-shadow)"
                    />
                    <circle
                      r={nodeRadius}
                      fill={GRAPH_CATEGORY_COLORS[p.category]}
                      stroke="#fff"
                      strokeWidth={highlighted ? 3 : 2}
                    />
                    {showLabel && (
                      <g transform={`translate(0, ${-nodeRadius - 18})`}>
                        <rect
                          x={-labelWidth / 2}
                          y={-15}
                          rx={10}
                          ry={10}
                          width={labelWidth}
                          height={22}
                          fill="#ffffff"
                          fillOpacity={highlighted ? 0.96 : 0.88}
                          stroke={highlighted ? '#c4b5fd' : '#e2e8f0'}
                          strokeWidth={1}
                          filter="url(#wiki-soft-shadow)"
                        />
                        <text
                          x={0}
                          y={0}
                          textAnchor="middle"
                          fontSize={12}
                          fontWeight={
                            hover === p.slug ? 700 : highlighted ? 600 : 500
                          }
                          fill={highlighted ? '#0f172a' : '#334155'}
                          style={{ pointerEvents: 'none' }}
                        >
                          {label}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          )}

          {!loading && nodes.length > 0 && (
            <div className="bg-white/92 absolute right-4 top-4 flex flex-col gap-1 rounded-xl border border-slate-200 p-1.5 shadow-lg backdrop-blur">
              <button
                onClick={() => zoomBy(1.25)}
                className="rounded-lg p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                title={t('library.wiki.graph.zoomIn')}
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={() => zoomBy(1 / 1.25)}
                className="rounded-lg p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                title={t('library.wiki.graph.zoomOut')}
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                onClick={resetView}
                className="rounded-lg p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                title={t('library.wiki.graph.resetView')}
              >
                <Maximize2 className="h-4 w-4" />
              </button>
              <div className="border-t border-slate-200 px-1 py-1 text-center text-[10px] font-medium text-slate-500">
                {Math.round(view.scale * 100)}%
              </div>
            </div>
          )}
        </main>

        <footer className="flex items-center gap-4 border-t border-slate-200 px-6 py-3 text-xs text-slate-600">
          {RING_ORDER.map((cat) => (
            <span key={cat} className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full ring-4 ring-white"
                style={{ backgroundColor: GRAPH_CATEGORY_COLORS[cat] }}
              />
              {cat}
            </span>
          ))}
          <span className="ml-auto text-slate-400">
            {t('library.wiki.graph.hint')}
          </span>
        </footer>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
