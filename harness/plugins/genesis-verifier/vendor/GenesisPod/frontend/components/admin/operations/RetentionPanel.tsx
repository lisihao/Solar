'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { LineChart as LineChartIcon } from 'lucide-react';
import AdminEmptyState from '@/components/admin/shared/AdminEmptyState';
import type { OperationCohort } from '@/hooks/domain/useOperationMetrics';

interface RetentionPanelProps {
  cohort: OperationCohort[];
  weeks: number;
}

// 多条 cohort 折线的配色（走 tailwind primary + 中性灰阶，避免每页一个主题色）。
const LINE_COLORS = [
  'hsl(var(--primary))',
  '#2563eb',
  '#0891b2',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#16a34a',
  '#64748b',
];

type ChartRow = { week: string; [cohortWeek: string]: number | string | null };

/**
 * Cohort 留存：每条 cohort 一条折线，X 轴为相对周（W0..），Y 轴为留存率（%）。
 * 下方附热力表，单元格颜色深浅表示留存高低。
 */
export default function RetentionPanel({ cohort, weeks }: RetentionPanelProps) {
  const chartData = useMemo<ChartRow[]>(() => {
    return Array.from({ length: weeks }).map((_, w) => {
      const row: ChartRow = { week: `W${w}` };
      cohort.forEach((c) => {
        const v = c.retention[w];
        row[c.cohortWeek] = v == null ? null : Math.round(v * 1000) / 10;
      });
      return row;
    });
  }, [cohort, weeks]);

  if (cohort.length === 0) {
    return (
      <AdminEmptyState
        icon={LineChartIcon}
        title="暂无 cohort 数据"
        description="窗口内还没有可分组的注册用户，或后端聚合返回为空"
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">
          留存曲线（按注册周分组）
        </h3>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="week" tick={{ fontSize: 12, fill: '#64748b' }} />
              <YAxis
                tick={{ fontSize: 12, fill: '#64748b' }}
                unit="%"
                domain={[0, 100]}
              />
              <Tooltip
                formatter={(value) =>
                  value == null ? '—' : `${value as number}%`
                }
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {cohort.map((c, i) => (
                <Line
                  key={c.cohortWeek}
                  type="monotone"
                  dataKey={c.cohortWeek}
                  name={`${c.cohortWeek} (n=${c.size})`}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <RetentionHeatTable cohort={cohort} weeks={weeks} />
    </div>
  );
}

function heatStyle(v: number | undefined): React.CSSProperties {
  if (v == null) return { background: '#f8fafc', color: '#cbd5e1' };
  // primary 蓝色按留存深浅，0 -> 浅，1 -> 深
  const alpha = 0.12 + v * 0.78;
  return {
    background: `rgba(37, 99, 235, ${alpha.toFixed(3)})`,
    color: v > 0.5 ? '#ffffff' : '#1e293b',
  };
}

function RetentionHeatTable({
  cohort,
  weeks,
}: {
  cohort: OperationCohort[];
  weeks: number;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Cohort
            </th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
              规模
            </th>
            {Array.from({ length: weeks }).map((_, w) => (
              <th
                key={w}
                className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500"
              >
                W{w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohort.map((c) => (
            <tr
              key={c.cohortWeek}
              className="border-b border-gray-50 last:border-0"
            >
              <td className="whitespace-nowrap px-4 py-2 font-medium text-gray-900">
                {c.cohortWeek}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                {c.size.toLocaleString()}
              </td>
              {Array.from({ length: weeks }).map((_, w) => {
                const v = c.retention[w];
                return (
                  <td
                    key={w}
                    className="px-2 py-2 text-center text-xs tabular-nums"
                    style={heatStyle(v)}
                  >
                    {v == null ? '—' : `${(v * 100).toFixed(0)}%`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
