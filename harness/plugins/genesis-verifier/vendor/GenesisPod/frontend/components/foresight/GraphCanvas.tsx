'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils/common';
import type {
  ForesightCard,
  ForesightEdge,
  ForesightLayerDef,
} from '@/services/foresight/api';
import {
  SENS_META,
  STAGE_BAR_CLS,
  STAGE_META,
  bfsReach,
  buildAdjacency,
  type CardPendingState,
} from './foresight-meta';

interface EdgePath {
  id: string;
  d: string;
  mid: { x: number; y: number };
}

interface GraphCanvasProps {
  cards: ForesightCard[];
  edges: ForesightEdge[];
  /** 主题自有层级本体（泳道定义） */
  layers: ForesightLayerDef[];
  pending: Map<string, CardPendingState>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * GraphCanvas —— 六层泳道假设图谱（demo v0.4 的 React 移植）。
 * 边粗细 = 传导强度；选中卡片高亮上游（蓝）/ 下游（琥珀）血缘；
 * 待复核卡片琥珀高亮、信号源红色高亮。
 */
export function GraphCanvas({
  cards,
  edges,
  layers,
  pending,
  selectedId,
  onSelect,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [paths, setPaths] = useState<EdgePath[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const layerIdx = useMemo(() => {
    const byId = new Map(cards.map((c) => [c.id, c.layer]));
    return (cardId: string) =>
      layers.findIndex((l) => l.id === byId.get(cardId));
  }, [cards, layers]);

  const adj = useMemo(() => buildAdjacency(edges), [edges]);

  const highlight = useMemo(() => {
    if (!selectedId) return null;
    const down = bfsReach(selectedId, adj.out, (e) => e.toCardId);
    const up = bfsReach(selectedId, adj.inn, (e) => e.fromCardId);
    return { down, up };
  }, [selectedId, adj]);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    setSize({ w: container.scrollWidth, h: container.scrollHeight });

    const rectOf = (id: string) => {
      const el = cardRefs.current.get(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.left - cRect.left,
        y: r.top - cRect.top,
        w: r.width,
        h: r.height,
      };
    };

    const next: EdgePath[] = [];
    for (const e of edges) {
      const a = rectOf(e.fromCardId);
      const b = rectOf(e.toCardId);
      if (!a || !b) continue;
      const la = layerIdx(e.fromCardId);
      const lb = layerIdx(e.toCardId);
      const ax = a.x + a.w / 2;
      const bx = b.x + b.w / 2;
      let d: string;
      if (lb - la <= -3) {
        // 长反压边：走泳道导轨与卡片之间的走廊
        const railX = 120;
        const ay = a.y + a.h / 2;
        const by = b.y + b.h / 2;
        d =
          `M ${a.x} ${ay} C ${railX + 30} ${ay}, ${railX} ${ay - 20}, ${railX} ${ay - 80}` +
          ` L ${railX} ${by + 80} C ${railX} ${by + 20}, ${railX + 30} ${by}, ${b.x} ${by}`;
      } else if (la === lb) {
        const ay = a.y + a.h / 2;
        const by = b.y + b.h / 2;
        const right = bx > ax;
        const x1 = right ? a.x + a.w : a.x;
        const x2 = right ? b.x : b.x + b.w;
        const dx = Math.max(26, Math.abs(x2 - x1) / 2);
        d = `M ${x1} ${ay} C ${x1 + (right ? dx : -dx)} ${ay}, ${x2 + (right ? -dx : dx)} ${by}, ${x2} ${by}`;
      } else {
        const downDir = lb > la;
        const y1 = downDir ? a.y + a.h : a.y;
        const y2 = downDir ? b.y : b.y + b.h;
        const dy = Math.max(34, Math.abs(y2 - y1) / 2);
        d = `M ${ax} ${y1} C ${ax} ${y1 + (downDir ? dy : -dy)}, ${bx} ${y2 + (downDir ? -dy : dy)}, ${bx} ${y2}`;
      }
      next.push({
        id: e.id,
        d,
        mid: { x: (ax + bx) / 2, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2 },
      });
    }
    setPaths(next);
  }, [edges, layerIdx]);

  useLayoutEffect(() => {
    measure();
  }, [measure, cards.length]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(measure, 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timer) clearTimeout(timer);
    };
  }, [measure]);

  const edgeById = useMemo(() => new Map(edges.map((e) => [e.id, e])), [edges]);

  function edgeCls(id: string): string {
    if (highlight) {
      if (highlight.down.edgeIds.has(id)) return 'text-amber-500';
      if (highlight.up.edgeIds.has(id)) return 'text-sky-500';
      return 'text-gray-200';
    }
    const e = edgeById.get(id);
    return e?.type === 'constrain' ? 'text-red-300' : 'text-gray-300';
  }

  function cardState(id: string): 'src' | 'dirty' | 'up' | 'down' | 'none' {
    const p = pending.get(id);
    if (p?.isSource) return 'src';
    if (p) return 'dirty';
    if (highlight && id !== selectedId) {
      if (highlight.down.nodes.has(id)) return 'down';
      if (highlight.up.nodes.has(id)) return 'up';
    }
    return 'none';
  }

  const showLabelEdgeIds = useMemo(() => {
    if (!highlight) return new Set<string>();
    return new Set([...highlight.down.edgeIds, ...highlight.up.edgeIds]);
  }, [highlight]);

  return (
    <div ref={containerRef} className="relative">
      <svg
        className="pointer-events-none absolute inset-0 overflow-visible"
        width={size.w}
        height={size.h}
      >
        {paths.map((p) => {
          const e = edgeById.get(p.id);
          return (
            <path
              key={p.id}
              d={p.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={0.6 + (e?.weight ?? 0.7) * 1.6}
              strokeDasharray={e?.type === 'constrain' ? '5 5' : undefined}
              className={edgeCls(p.id)}
            />
          );
        })}
      </svg>
      {/* 边参数标签：仅选中血缘上的边显示 */}
      {paths
        .filter((p) => showLabelEdgeIds.has(p.id))
        .map((p) => (
          <span
            key={`lbl-${p.id}`}
            className="font-mono pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border border-amber-300 bg-white px-1.5 py-0.5 text-xs text-amber-700 shadow-sm"
            style={{ left: p.mid.x, top: p.mid.y }}
          >
            {edgeById.get(p.id)?.metric}
            {' · w'}
            {edgeById.get(p.id)?.weight.toFixed(1)}
          </span>
        ))}

      {layers.map((layer) => {
        const layerCards = cards.filter((c) => c.layer === layer.id);
        if (layerCards.length === 0) return null;
        return (
          <div
            key={layer.id}
            className="relative flex gap-5 border-b border-dashed border-gray-200 py-6 pl-36"
          >
            <div className="absolute bottom-6 left-0 top-6 flex w-28 flex-col justify-center gap-0.5 border-r-2 border-gray-800 pr-3 text-right">
              <span className="text-lg font-bold text-amber-600">
                {layer.id}
              </span>
              <span className="text-xs font-bold text-gray-800">
                {layer.name}
              </span>
              <span className="font-mono text-xs uppercase tracking-widest text-gray-400">
                {layer.en}
              </span>
            </div>
            <div className="flex flex-1 flex-wrap gap-5">
              {layerCards.map((card) => {
                const state = cardState(card.id);
                const p = pending.get(card.id);
                return (
                  <div
                    key={card.id}
                    ref={(el) => {
                      if (el) cardRefs.current.set(card.id, el);
                      else cardRefs.current.delete(card.id);
                    }}
                    onClick={() =>
                      onSelect(selectedId === card.id ? null : card.id)
                    }
                    className={cn(
                      'relative w-60 cursor-pointer border bg-white p-3 pl-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
                      state === 'src' && 'border-red-500 bg-red-50',
                      state === 'dirty' && 'border-amber-500 bg-amber-50',
                      state === 'up' && 'border-sky-500 bg-sky-50',
                      state === 'down' && 'border-amber-400 bg-amber-50',
                      state === 'none' && 'border-gray-300',
                      selectedId === card.id &&
                        'border-gray-900 ring-1 ring-gray-900'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute bottom-0 left-0 top-0 w-1',
                        STAGE_BAR_CLS[card.stage] ?? 'bg-gray-300'
                      )}
                    />
                    {(state === 'src' || state === 'dirty') && (
                      <span
                        className={cn(
                          'font-mono absolute -top-2.5 right-2 px-2 py-0.5 text-xs font-semibold text-white',
                          state === 'src' ? 'bg-red-600' : 'bg-amber-500'
                        )}
                      >
                        {state === 'src'
                          ? '信号命中'
                          : `待复核 ${p ? p.impact.toFixed(2) : ''}`}
                      </span>
                    )}
                    <div className="mb-1.5 flex items-center justify-between gap-1">
                      <span className="font-mono text-xs text-gray-400">
                        {card.cardKey}
                      </span>
                      <span className="flex gap-1">
                        {card.scenarios && card.scenarios.length > 0 && (
                          <span className="font-mono border border-violet-500 px-1 text-xs text-violet-700">
                            分叉
                          </span>
                        )}
                        <span
                          className={cn(
                            'font-mono border bg-white px-1 text-xs',
                            STAGE_META[card.stage]?.cls
                          )}
                        >
                          {STAGE_META[card.stage]?.label}
                        </span>
                        <span
                          className={cn(
                            'font-mono border px-1 text-xs',
                            SENS_META[card.sens]?.cls
                          )}
                        >
                          {SENS_META[card.sens]?.label}
                        </span>
                      </span>
                    </div>
                    <h3 className="text-sm font-bold leading-snug text-gray-900">
                      {card.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">
                      {card.claim}
                    </p>
                    <div className="mt-2 h-1 bg-gray-100">
                      <span
                        className="block h-full bg-amber-500 transition-all"
                        style={{ width: `${card.conf * 100}%` }}
                      />
                    </div>
                    <div className="font-mono mt-1.5 flex justify-between text-xs text-gray-400">
                      <span>CONF {card.conf.toFixed(2)}</span>
                      <span>信源 ×{card.sources.length}</span>
                      <span>H·{card.horizon}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
