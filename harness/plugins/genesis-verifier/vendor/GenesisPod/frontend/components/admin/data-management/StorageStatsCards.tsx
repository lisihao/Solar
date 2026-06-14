'use client';

import {
  ArrowDownRight,
  ArrowUpRight,
  Cloud,
  Database,
  HardDrive,
  Layers,
  Minus,
} from 'lucide-react';

type StatColor = 'emerald' | 'blue' | 'amber' | 'violet' | 'slate';

interface StorageStatsCardsProps {
  dbSizeFormatted: string;
  dbTableCount: number;
  r2SizeFormatted: string;
  r2ObjectCount: number;
  r2Configured: boolean;
  r2Bucket: string | null;
  managedTargets: number;
  managedPrefixes: number;
  observedPrefixes: number;
  observedOnlyPrefixes: number;
  /** 30-day delta in MB; null when trend data unavailable */
  dbDeltaMb?: number | null;
  r2DeltaMb?: number | null;
  r2ObjectsDelta?: number | null;
  loading?: boolean;
}

function formatMbDelta(deltaMb: number | null | undefined): {
  text: string;
  tone: 'up' | 'down' | 'flat';
} | null {
  if (deltaMb == null || !Number.isFinite(deltaMb)) return null;
  const abs = Math.abs(deltaMb);
  // < 1 MB 视为平稳，避免噪点
  if (abs < 1) return { text: '30 天平稳', tone: 'flat' };
  const display =
    abs >= 1024 ? `${(abs / 1024).toFixed(1)} GB` : `${abs.toFixed(1)} MB`;
  return {
    text: `${deltaMb > 0 ? '+' : '-'}${display} · 30 天`,
    tone: deltaMb > 0 ? 'up' : 'down',
  };
}

function formatCountDelta(delta: number | null | undefined): {
  text: string;
  tone: 'up' | 'down' | 'flat';
} | null {
  if (delta == null || !Number.isFinite(delta)) return null;
  if (delta === 0) return { text: '30 天平稳', tone: 'flat' };
  return {
    text: `${delta > 0 ? '+' : ''}${delta.toLocaleString()} 对象 · 30 天`,
    tone: delta > 0 ? 'up' : 'down',
  };
}

export default function StorageStatsCards({
  dbSizeFormatted,
  dbTableCount,
  r2SizeFormatted,
  r2ObjectCount,
  r2Configured,
  r2Bucket,
  managedTargets,
  managedPrefixes,
  observedPrefixes,
  observedOnlyPrefixes,
  dbDeltaMb,
  r2DeltaMb,
  r2ObjectsDelta,
  loading,
}: StorageStatsCardsProps) {
  const dbDelta = formatMbDelta(dbDeltaMb);
  const r2Delta = formatMbDelta(r2DeltaMb);
  const objectsDelta = formatCountDelta(r2ObjectsDelta);
  const cards: Array<{
    id: string;
    label: string;
    value: string;
    hint: string;
    icon: typeof Database;
    color: StatColor;
    delta?: { text: string; tone: 'up' | 'down' | 'flat' } | null;
  }> = [
    {
      id: 'db',
      label: '数据库占用',
      value: dbSizeFormatted,
      hint: `${dbTableCount} 张表纳入统计`,
      icon: Database,
      color: 'emerald',
      delta: dbDelta,
    },
    {
      id: 'r2',
      label: 'R2 对象存储',
      value: r2SizeFormatted,
      hint: r2Configured
        ? `${r2ObjectCount.toLocaleString()} 个对象 · ${r2Bucket ?? 'bucket'}`
        : 'R2 未配置',
      icon: Cloud,
      color: r2Configured ? 'blue' : 'amber',
      delta: r2Delta,
    },
    {
      id: 'targets',
      label: '受管 Offload 目标',
      value: String(managedTargets),
      hint: `${managedPrefixes} 个注册前缀`,
      icon: HardDrive,
      color: 'violet',
    },
    {
      id: 'prefixes',
      label: 'R2 前缀总览',
      value: String(observedPrefixes),
      hint: `${observedOnlyPrefixes} 个仅观测前缀`,
      icon: Layers,
      color: 'slate',
      delta: objectsDelta,
    },
  ];

  const colorClasses: Record<StatColor, { icon: string; text: string }> = {
    emerald: {
      icon: 'bg-emerald-100 text-emerald-600',
      text: 'text-emerald-700',
    },
    blue: { icon: 'bg-blue-100 text-blue-600', text: 'text-blue-700' },
    amber: { icon: 'bg-amber-100 text-amber-600', text: 'text-amber-700' },
    violet: { icon: 'bg-violet-100 text-violet-600', text: 'text-violet-700' },
    slate: { icon: 'bg-slate-100 text-slate-600', text: 'text-slate-700' },
  };

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const colors = colorClasses[card.color];
        const DeltaIcon =
          card.delta?.tone === 'up'
            ? ArrowUpRight
            : card.delta?.tone === 'down'
              ? ArrowDownRight
              : Minus;
        const deltaTone =
          card.delta?.tone === 'up'
            ? 'text-rose-600'
            : card.delta?.tone === 'down'
              ? 'text-emerald-600'
              : 'text-gray-400';
        return (
          <div
            key={card.id}
            className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${
              loading ? 'animate-pulse' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-500">
                  {card.label}
                </p>
                <p className={`mt-1 text-2xl font-bold ${colors.text}`}>
                  {loading ? '-' : card.value}
                </p>
                <p className="mt-1 truncate text-xs text-gray-400">
                  {card.hint}
                </p>
                {card.delta && !loading && (
                  <p
                    className={`mt-1.5 inline-flex items-center gap-1 text-xs font-medium ${deltaTone}`}
                  >
                    <DeltaIcon className="h-3 w-3" />
                    {card.delta.text}
                  </p>
                )}
              </div>
              <div className={`rounded-lg p-2.5 ${colors.icon}`}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
