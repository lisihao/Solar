'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowDown, Minus, Plus } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils/common';
import type {
  DiagramConfig,
  LayerData,
  ArrowData,
  DepCardData,
  LegendItem,
} from '@/lib/features/admin/dependency-diagrams';

// --- Scale levels ---

type ScaleLevel = 0 | 1 | 2;

const SCALE_LABELS: Record<ScaleLevel, string> = {
  0: 'S',
  1: 'M',
  2: 'L',
};

/**
 * Tailwind classes indexed by scale level.
 * [0] = small (compact), [1] = medium (default), [2] = large
 */
const S = {
  // Layer module
  layerRound: ['rounded-lg', 'rounded-xl', 'rounded-xl'],
  layerPx: ['px-4', 'px-5', 'px-6'],
  layerPy: ['py-3', 'py-4', 'py-5'],
  badgeSize: ['h-9 w-9 text-xs', 'h-11 w-11 text-sm', 'h-12 w-12 text-base'],
  moduleName: ['text-sm', 'text-base', 'text-lg'],
  modulePath: ['text-xs', 'text-sm', 'text-sm'],
  moduleStats: ['text-xs', 'text-sm', 'text-sm'],
  levelBadge: [
    'text-xs px-2 py-0.5',
    'text-sm px-2.5 py-1',
    'text-sm px-3 py-1',
  ],
  // Grid items
  gridCols: [
    'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
    'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
    'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  ],
  gridGap: ['gap-2', 'gap-2.5', 'gap-3'],
  gridItemPx: ['px-2.5 py-1.5', 'px-3 py-2', 'px-3.5 py-2.5'],
  gridItemName: ['text-xs', 'text-sm', 'text-sm'],
  gridItemDetail: ['text-[10px]', 'text-xs', 'text-xs'],
  // Registrations
  regLabel: ['text-[10px]', 'text-xs', 'text-xs'],
  regTag: ['text-[10px] px-1.5', 'text-xs px-2', 'text-xs px-2.5'],
  // Facade
  facadeTitle: ['text-[10px]', 'text-xs', 'text-sm'],
  facadeTag: ['text-[10px] px-1.5', 'text-xs px-2', 'text-xs px-2.5'],
  facadeDot: ['h-1.5 w-1.5', 'h-2 w-2', 'h-2 w-2'],
  // Footer
  footerText: ['text-[10px]', 'text-xs', 'text-sm'],
  // Arrow
  arrowPill: ['px-2.5 py-1 gap-1.5', 'px-3 py-1.5 gap-2', 'px-4 py-2 gap-2'],
  arrowCount: ['text-xs', 'text-sm', 'text-sm'],
  arrowVia: ['text-[10px]', 'text-xs', 'text-xs'],
  arrowCode: ['text-[10px]', 'text-xs', 'text-sm'],
  arrowIcon: ['h-3 w-3', 'h-4 w-4', 'h-4 w-4'],
  arrowGap: ['gap-6', 'gap-8', 'gap-10'],
  // Dep card
  depCardTitle: ['text-sm', 'text-base', 'text-lg'],
  depRowLabel: ['text-xs', 'text-sm', 'text-sm'],
  depRowCount: ['text-[10px] px-1.5', 'text-xs px-2', 'text-xs px-2.5'],
  depTotal: ['text-xs', 'text-sm', 'text-sm'],
  depTotalCount: ['text-[10px] px-1.5', 'text-xs px-2', 'text-xs px-2.5'],
  depNote: ['text-[10px]', 'text-xs', 'text-xs'],
  depRowPy: ['py-1.5', 'py-2', 'py-2.5'],
  // Legend
  legendDot: ['h-2.5 w-2.5', 'h-3 w-3', 'h-3.5 w-3.5'],
  legendText: ['text-[10px]', 'text-xs', 'text-sm'],
  // Page
  headerTitle: ['text-lg', 'text-xl', 'text-2xl'],
  headerSubtitle: ['text-xs', 'text-sm', 'text-sm'],
  mainPx: ['px-4', 'px-5', 'px-6'],
  maxW: ['max-w-5xl', 'max-w-6xl', 'max-w-7xl'],
  footerNote: ['text-xs', 'text-sm', 'text-sm'],
} as const;

function s(key: keyof typeof S, level: ScaleLevel): string {
  return S[key][level];
}

// --- Sub-components ---

function LayerModule({ data, scale }: { data: LayerData; scale: ScaleLevel }) {
  const c = LEVEL_COLORS[data.level] ?? LEVEL_COLORS[1];
  return (
    <div className={cn(s('layerRound', scale), 'border', c.border, c.bg)}>
      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-4',
          s('layerPx', scale),
          s('layerPy', scale)
        )}
      >
        <span
          className={cn(
            'flex items-center justify-center rounded-lg font-bold',
            s('badgeSize', scale),
            c.badge
          )}
        >
          {data.tag}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'font-semibold text-gray-900',
                s('moduleName', scale)
              )}
            >
              {data.name}
            </span>
            <span
              className={cn(
                'font-mono hidden text-gray-400 sm:inline',
                s('modulePath', scale)
              )}
            >
              {data.path}
            </span>
          </div>
          <span className={cn('text-gray-500', s('moduleStats', scale))}>
            {data.stats}
          </span>
        </div>
        <span
          className={cn(
            'rounded-md font-semibold',
            s('levelBadge', scale),
            c.badge
          )}
        >
          L{data.level}
        </span>
      </div>

      {/* Internal grid */}
      {data.items.length > 0 && (
        <div
          className={cn(
            'grid pb-4',
            s('gridCols', scale),
            s('gridGap', scale),
            s('layerPx', scale)
          )}
        >
          {data.items.map((item) => (
            <div
              key={item.name}
              className={cn(
                'rounded-md border border-gray-200/60 bg-white/70',
                s('gridItemPx', scale)
              )}
            >
              <div
                className={cn(
                  'font-semibold text-gray-700',
                  s('gridItemName', scale)
                )}
              >
                {item.name}
              </div>
              <div
                className={cn(
                  'leading-snug text-gray-400',
                  s('gridItemDetail', scale)
                )}
              >
                {item.detail}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Registrations */}
      {data.registrations && data.registrations.length > 0 && (
        <div className={cn('pb-4', s('layerPx', scale))}>
          <div
            className={cn(
              'mb-2 font-semibold uppercase tracking-wider text-gray-400',
              s('regLabel', scale)
            )}
          >
            onModuleInit Registrations
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.registrations.map((r) => (
              <span
                key={r}
                className={cn(
                  'rounded border border-amber-100 bg-amber-50 py-0.5 text-amber-600',
                  s('regTag', scale)
                )}
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Facade */}
      {data.facade && (
        <div
          className={cn(
            'mb-4 rounded-lg border border-dashed border-blue-200/60 bg-blue-50/30 px-4 py-3',
            `mx-5`
          )}
        >
          <div
            className={cn(
              'mb-2 flex items-center gap-2 font-bold text-blue-600',
              s('facadeTitle', scale)
            )}
          >
            <div
              className={cn('rounded-sm bg-blue-500', s('facadeDot', scale))}
            />
            {data.facade.title}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.facade.exports.map((e) => (
              <span
                key={e.label}
                className={cn(
                  'rounded border py-0.5',
                  s('facadeTag', scale),
                  TAG_STYLES[e.kind]
                )}
              >
                {e.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      {data.footer && (
        <div
          className={cn(
            'pb-4 text-center text-gray-400',
            s('layerPx', scale),
            s('footerText', scale)
          )}
        >
          {data.footer}
        </div>
      )}
    </div>
  );
}

function ArrowConnector({
  data,
  scale,
}: {
  data: ArrowData;
  scale: ScaleLevel;
}) {
  if (data.segments.length === 0) {
    return (
      <div className="flex justify-center py-1.5">
        <div className="flex flex-col items-center">
          <div className="h-5 w-px bg-gray-200" />
          <ArrowDown className={cn('text-gray-300', s('arrowIcon', scale))} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center py-2.5',
        s('arrowGap', scale)
      )}
    >
      {data.segments.map((seg) => (
        <div key={seg.label} className="flex flex-col items-center gap-0.5">
          <div
            className={cn(
              'flex items-center rounded-full border border-gray-200 bg-white shadow-sm',
              s('arrowPill', scale)
            )}
          >
            <span
              className={cn(
                'font-bold',
                s('arrowCount', scale),
                ARROW_COLORS[seg.color] ?? 'text-gray-500'
              )}
            >
              {seg.count}
            </span>
            <span className={cn('text-gray-400', s('arrowVia', scale))}>
              via
            </span>
            <code
              className={cn(
                'font-medium',
                s('arrowCode', scale),
                ARROW_COLORS[seg.color] ?? 'text-gray-500'
              )}
            >
              {seg.label}
            </code>
          </div>
          <ArrowDown className={cn('text-gray-300', s('arrowIcon', scale))} />
        </div>
      ))}
    </div>
  );
}

function DepCard({ card, scale }: { card: DepCardData; scale: ScaleLevel }) {
  return (
    <div
      className={cn(
        s('layerRound', scale),
        'border border-gray-200 bg-white shadow-sm'
      )}
    >
      <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3">
        <span
          className={cn(
            'font-semibold',
            s('depCardTitle', scale),
            card.fromColor
          )}
        >
          {card.from}
        </span>
        <span className="text-gray-300">&rarr;</span>
        <span
          className={cn(
            'font-semibold',
            s('depCardTitle', scale),
            card.toColor
          )}
        >
          {card.to}
        </span>
      </div>
      <div className="px-5 py-3">
        {card.rows.map((row) => (
          <div
            key={row.label}
            className={cn(
              'flex items-center justify-between border-b border-gray-50 last:border-b-0',
              s('depRowPy', scale)
            )}
          >
            <span className={cn('text-gray-600', s('depRowLabel', scale))}>
              {row.label}
            </span>
            <span
              className={cn(
                'rounded py-0.5 font-semibold',
                s('depRowCount', scale),
                COUNT_STYLES[row.level]
              )}
            >
              {row.count}
            </span>
          </div>
        ))}
        <div className="mt-1.5 flex items-center justify-between border-t border-gray-200 pt-2.5">
          <span
            className={cn('font-semibold text-gray-700', s('depTotal', scale))}
          >
            Total
          </span>
          <span
            className={cn(
              'rounded bg-blue-50 py-0.5 font-bold text-blue-700',
              s('depTotalCount', scale)
            )}
          >
            {card.total}
          </span>
        </div>
        {card.note && (
          <p className={cn('mt-2 text-gray-400', s('depNote', scale))}>
            {card.note}
          </p>
        )}
      </div>
    </div>
  );
}

function LegendBar({
  items,
  scale,
}: {
  items: LegendItem[];
  scale: ScaleLevel;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-5 pb-4">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <div
            className={cn(
              'rounded-sm',
              s('legendDot', scale),
              item.dashed ? 'border border-dashed' : '',
              item.color
            )}
          />
          <span className={cn('text-gray-500', s('legendText', scale))}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// --- Styling constants (flat) ---

const LEVEL_COLORS: Record<
  number,
  { bg: string; border: string; badge: string }
> = {
  4: {
    bg: 'bg-blue-50/60',
    border: 'border-blue-200',
    badge: 'bg-blue-100 text-blue-700',
  },
  3: {
    bg: 'bg-teal-50/60',
    border: 'border-teal-200',
    badge: 'bg-teal-100 text-teal-700',
  },
  2: {
    bg: 'bg-purple-50/60',
    border: 'border-purple-200',
    badge: 'bg-purple-100 text-purple-700',
  },
  1: {
    bg: 'bg-amber-50/60',
    border: 'border-amber-200',
    badge: 'bg-amber-100 text-amber-700',
  },
};

const TAG_STYLES: Record<string, string> = {
  service: 'bg-teal-50 text-teal-600 border-teal-100',
  registry: 'bg-amber-50 text-amber-600 border-amber-100',
  type: 'bg-purple-50 text-purple-600 border-purple-100',
  util: 'bg-rose-50 text-rose-600 border-rose-100',
  muted: 'bg-gray-50 text-gray-400 border-gray-100',
};

const COUNT_STYLES: Record<string, string> = {
  high: 'bg-blue-50 text-blue-700',
  mid: 'bg-teal-50 text-teal-700',
  low: 'bg-gray-100 text-gray-600',
};

const ARROW_COLORS: Record<string, string> = {
  blue: 'text-blue-500',
  teal: 'text-teal-500',
  purple: 'text-purple-500',
  amber: 'text-amber-500',
};

// --- Main renderer ---

interface DependencyDiagramProps {
  config: DiagramConfig;
}

export default function DependencyDiagram({ config }: DependencyDiagramProps) {
  const { t } = useTranslation();
  const [scale, setScale] = useState<ScaleLevel>(1);

  return (
    <div className="flex min-h-full flex-col bg-gray-50/50">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 px-6 py-5 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/overview"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-600"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1
                className={cn(
                  'font-semibold text-gray-900',
                  s('headerTitle', scale)
                )}
              >
                {t(config.titleKey)}
              </h1>
              <p className={cn('text-gray-500', s('headerSubtitle', scale))}>
                {t(config.subtitleKey)}
              </p>
            </div>
          </div>

          {/* Scale control */}
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() =>
                setScale((prev) => Math.max(0, prev - 1) as ScaleLevel)
              }
              disabled={scale === 0}
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-6 text-center text-xs font-medium text-gray-500">
              {SCALE_LABELS[scale]}
            </span>
            <button
              type="button"
              onClick={() =>
                setScale((prev) => Math.min(2, prev + 1) as ScaleLevel)
              }
              disabled={scale === 2}
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <main className={cn('flex-1 overflow-auto py-5', s('mainPx', scale))}>
        <div className={cn('mx-auto space-y-0', s('maxW', scale))}>
          {/* Layer diagram */}
          {config.layers.map((layer, i) => (
            <div key={layer.tag}>
              <LayerModule data={layer} scale={scale} />
              {i < config.layers.length - 1 && (
                <ArrowConnector data={config.arrows[i]} scale={scale} />
              )}
            </div>
          ))}

          {/* Dependency summary */}
          {config.depCards.length > 0 && (
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {config.depCards.map((card) => (
                <DepCard
                  key={`${card.from}-${card.to}`}
                  card={card}
                  scale={scale}
                />
              ))}
            </div>
          )}

          {/* Key invariant */}
          {config.footerNote && (
            <div
              className={cn(
                'mt-5 rounded-xl border border-gray-200 bg-white px-5 py-4 text-center text-gray-500',
                s('footerNote', scale)
              )}
            >
              <span className="font-semibold text-gray-700">
                Key invariant:
              </span>{' '}
              {config.footerNote}
            </div>
          )}

          {/* Legend */}
          {config.legend.length > 0 && (
            <LegendBar items={config.legend} scale={scale} />
          )}
        </div>
      </main>
    </div>
  );
}
