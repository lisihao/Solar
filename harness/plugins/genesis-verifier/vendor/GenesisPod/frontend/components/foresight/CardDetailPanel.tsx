'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import {
  fetchLedger,
  type ForesightCard,
  type ForesightConfLog,
  type ForesightEdge,
  type ForesightLayerDef,
} from '@/services/foresight/api';
import { formatDateSafe } from '@/lib/utils/date';
import { SENS_META, SOURCE_TYPE_META } from './foresight-meta';

interface CardDetailPanelProps {
  card: ForesightCard;
  cards: ForesightCard[];
  edges: ForesightEdge[];
  layers: ForesightLayerDef[];
  onSelect: (id: string) => void;
}

function SectionTitle({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'red' | 'violet';
}) {
  return (
    <div
      className={cn(
        'font-mono mb-2 mt-4 flex items-center gap-2 text-xs uppercase tracking-widest',
        tone === 'red' && 'text-red-500',
        tone === 'violet' && 'text-violet-600',
        tone === 'default' && 'text-gray-400'
      )}
    >
      {children}
      <span className="h-px flex-1 bg-gray-200" />
    </div>
  );
}

/** 假设卡详情：断言 / 证据 / 信源 / 证伪信号 / 情景 / 置信度账本 / 上下游血缘 */
export function CardDetailPanel({
  card,
  cards,
  edges,
  layers,
  onSelect,
}: CardDetailPanelProps) {
  const [ledger, setLedger] = useState<ForesightConfLog[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLedger([]);
    fetchLedger(card.id)
      .then((logs) => {
        if (!cancelled) setLedger(logs);
      })
      .catch(() => {
        if (!cancelled) setLedger([]);
      });
    return () => {
      cancelled = true;
    };
  }, [card.id]);

  const byId = new Map(cards.map((c) => [c.id, c]));
  const ups = edges.filter((e) => e.toCardId === card.id);
  const downs = edges.filter((e) => e.fromCardId === card.id);
  const layer = layers.find((l) => l.id === card.layer);

  return (
    <div className="text-sm">
      <div className="font-mono mb-1 flex justify-between text-xs text-amber-700">
        <span>{card.cardKey}</span>
        <span>
          {layer?.name} / {card.layer}
        </span>
      </div>
      <h2 className="mb-2 text-lg font-bold leading-snug text-gray-900">
        {card.title}
      </h2>
      <p className="mb-3 border-l-2 border-amber-500 bg-gray-50 p-2.5 text-xs leading-relaxed text-gray-600">
        {card.claim}
      </p>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="border border-gray-200 bg-gray-50 px-2 py-1.5">
          <div className="text-base font-bold">{card.conf.toFixed(2)}</div>
          <div className="font-mono text-xs text-gray-400">置信度</div>
        </div>
        <div className="border border-gray-200 bg-gray-50 px-2 py-1.5">
          <div className="text-base font-bold">
            {SENS_META[card.sens]?.label}
          </div>
          <div className="font-mono text-xs text-gray-400">敏感度</div>
        </div>
        <div className="border border-gray-200 bg-gray-50 px-2 py-1.5">
          <div className="text-base font-bold">{card.horizon}</div>
          <div className="font-mono text-xs text-gray-400">Horizon</div>
        </div>
      </div>

      <SectionTitle>证据 Evidence</SectionTitle>
      <ul className="space-y-1.5">
        {card.evidence.map((x, i) => (
          <li
            key={i}
            className="border-b border-dashed border-gray-100 pb-1.5 text-xs leading-relaxed text-gray-600"
          >
            {x}
          </li>
        ))}
      </ul>

      <SectionTitle>信源 Sources</SectionTitle>
      <div className="space-y-1.5">
        {card.sources.map((s, i) => (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 border border-gray-200 bg-gray-50 px-2.5 py-1.5 transition-colors hover:border-sky-400 hover:bg-sky-50"
          >
            <span
              className={cn(
                'font-mono border px-1.5 text-xs',
                SOURCE_TYPE_META[s.type]?.cls ?? 'border-gray-300 text-gray-500'
              )}
            >
              {SOURCE_TYPE_META[s.type]?.label ?? s.type}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-mono block text-xs text-gray-400">
                {s.org}
              </span>
              <span className="block truncate text-xs text-gray-700">
                {s.title}
              </span>
            </span>
            <ExternalLink className="h-3 w-3 shrink-0 text-gray-400" />
          </a>
        ))}
      </div>

      <SectionTitle tone="red">证伪信号 Falsifiers</SectionTitle>
      <ul className="space-y-1.5">
        {card.falsifiers.map((x, i) => (
          <li
            key={i}
            className="flex items-start gap-2 border-b border-dashed border-gray-100 pb-1.5 text-xs leading-relaxed text-gray-600"
          >
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full border border-red-500" />
            {x}
          </li>
        ))}
      </ul>

      {card.scenarios && card.scenarios.length > 0 && (
        <>
          <SectionTitle tone="violet">情景条件置信度 Scenario</SectionTitle>
          <div className="space-y-1.5">
            {card.scenarios.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-36 shrink-0 text-gray-700">
                  {s.scenario}
                </span>
                <span className="h-1.5 flex-1 bg-gray-100">
                  <span
                    className="block h-full bg-violet-500"
                    style={{ width: `${s.conf * 100}%` }}
                  />
                </span>
                <span className="font-mono w-9 text-right text-violet-700">
                  {s.conf.toFixed(2)}
                </span>
              </div>
            ))}
            <p className="pt-1 text-xs leading-relaxed text-gray-500">
              卡面置信度为情景加权综合 —
              分叉收敛前，高敏决策须看条件置信度，避免对单一情景押满注。
            </p>
          </div>
        </>
      )}

      {ledger.length > 0 && (
        <>
          <SectionTitle>置信度账本 Ledger</SectionTitle>
          <div className="space-y-1.5">
            {ledger.map((l) => (
              <div
                key={l.id}
                className="flex items-baseline gap-2 border-b border-dashed border-gray-100 pb-1.5 text-xs"
              >
                <span className="font-mono w-20 shrink-0 text-gray-400">
                  {formatDateSafe(l.createdAt, 'date')}
                </span>
                <span className="font-mono shrink-0 text-gray-700">
                  {l.fromConf.toFixed(2)} →{' '}
                  <b className="text-amber-700">{l.toConf.toFixed(2)}</b>
                </span>
                <span className="text-gray-500">
                  {l.actor} · {l.reason}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {ups.length > 0 && (
        <>
          <SectionTitle>上游依赖 Upstream</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {ups.map((e) => {
              const c = byId.get(e.fromCardId);
              if (!c) return null;
              return (
                <button
                  key={e.id}
                  onClick={() => onSelect(c.id)}
                  className="font-mono border border-sky-300 bg-white px-2 py-1 text-xs text-sky-700 transition-colors hover:border-sky-500"
                >
                  {c.cardKey} · {c.title}
                </button>
              );
            })}
          </div>
        </>
      )}
      {downs.length > 0 && (
        <>
          <SectionTitle>下游影响 Downstream</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {downs.map((e) => {
              const c = byId.get(e.toCardId);
              if (!c) return null;
              return (
                <button
                  key={e.id}
                  onClick={() => onSelect(c.id)}
                  className="font-mono border border-amber-300 bg-white px-2 py-1 text-xs text-amber-700 transition-colors hover:border-amber-500"
                >
                  {c.cardKey} · {c.title}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
