'use client';

import { Hash } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  AdminLoadingSkeleton,
  AdminEmptyState,
} from '@/components/admin/shared';
import type { TopicRow } from '@/hooks/domain/useOperationMetrics';

interface TopicsPanelProps {
  rows: TopicRow[] | undefined;
  loading: boolean;
  error: boolean;
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

function truncate(label: string, max = 18): string {
  return label.length > max ? `${label.slice(0, max)}…` : label;
}

export default function TopicsPanel({
  rows,
  loading,
  error,
}: TopicsPanelProps) {
  if (loading) return <AdminLoadingSkeleton variant="list" rows={6} />;

  if (error || !rows || rows.length === 0) {
    return (
      <AdminEmptyState
        icon={Hash}
        title="暂无主题数据"
        description="所选时间窗内没有带 topicKey 的 user_event。"
      />
    );
  }

  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const chartData = sorted.map((r) => ({
    topicKey: r.topicKey,
    label: truncate(r.topicKey),
    count: r.count,
  }));

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-700">
        <Hash className="h-4 w-4 text-gray-500" />
        热门主题 Top {sorted.length}（按出现频次）
      </div>
      <div className="p-4">
        <ResponsiveContainer
          width="100%"
          height={Math.max(200, chartData.length * 32 + 40)}
        >
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 48, bottom: 0, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => fmtNum(v)}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fontSize: 11 }}
              width={140}
            />
            <Tooltip
              formatter={(value) => [fmtNum(Number(value)), '次数']}
              labelFormatter={(_label, payload) => {
                const item = payload?.[0]?.payload as
                  | { topicKey?: string }
                  | undefined;
                return item?.topicKey ?? '';
              }}
            />
            <Bar
              dataKey="count"
              fill="hsl(var(--primary))"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
