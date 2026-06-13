'use client';

import { Users, Zap, Repeat, CreditCard } from 'lucide-react';
import { StatGrid } from '@/components/admin/_shared/admin-tables';
import type { OperationFunnel } from '@/hooks/domain/useOperationMetrics';

interface FunnelPanelProps {
  funnel?: OperationFunnel;
  /** 时间窗（天），用于副标题 */
  days: number;
}

interface FunnelStage {
  key: keyof OperationFunnel;
  label: string;
  icon: typeof Users;
  count: number;
  /** 相对上一阶段的转化率（0..1），首阶段为 null */
  convFromPrev: number | null;
  /** 相对入口（registered）的占比（0..1） */
  pctOfTop: number;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function ratio(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

/**
 * 增长漏斗：注册 → 激活 → 留存 → 付费代理。
 * 复用 StatGrid 顶部计数，漏斗条形为页面专属可视化（条形宽度按占入口比例）。
 */
export default function FunnelPanel({ funnel, days }: FunnelPanelProps) {
  const f: OperationFunnel = funnel ?? {
    registered: 0,
    activated: 0,
    retained: 0,
    payingProxy: 0,
  };

  const stages: FunnelStage[] = [
    {
      key: 'registered',
      label: '注册',
      icon: Users,
      count: f.registered,
      convFromPrev: null,
      pctOfTop: 1,
    },
    {
      key: 'activated',
      label: '激活',
      icon: Zap,
      count: f.activated,
      convFromPrev: ratio(f.activated, f.registered),
      pctOfTop: ratio(f.activated, f.registered),
    },
    {
      key: 'retained',
      label: '留存',
      icon: Repeat,
      count: f.retained,
      convFromPrev: ratio(f.retained, f.activated),
      pctOfTop: ratio(f.retained, f.registered),
    },
    {
      key: 'payingProxy',
      label: '付费代理',
      icon: CreditCard,
      count: f.payingProxy,
      convFromPrev: ratio(f.payingProxy, f.retained),
      pctOfTop: ratio(f.payingProxy, f.registered),
    },
  ];

  return (
    <div className="space-y-5">
      <StatGrid
        items={stages.map((s) => ({ label: s.label, value: s.count }))}
      />

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">转化漏斗</h3>
          <span className="text-xs text-gray-500">近 {days} 天</span>
        </div>

        <div className="space-y-3">
          {stages.map((s) => {
            const Icon = s.icon;
            const width = Math.max(s.pctOfTop * 100, 2);
            return (
              <div key={s.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-gray-700">
                    <Icon className="h-4 w-4 text-gray-400" />
                    {s.label}
                  </span>
                  <span className="flex items-center gap-3 tabular-nums">
                    <span className="font-semibold text-gray-900">
                      {s.count.toLocaleString()}
                    </span>
                    {s.convFromPrev !== null && (
                      <span className="text-xs text-gray-500">
                        转化 {pct(s.convFromPrev)}
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-6 w-full overflow-hidden rounded-md bg-gray-100">
                  <div
                    className="flex h-full items-center justify-end rounded-md bg-primary/80 px-2 text-[10px] font-medium text-white transition-all"
                    style={{ width: `${width}%` }}
                  >
                    {pct(s.pctOfTop)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
