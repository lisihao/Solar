'use client';

import { ChartColumn, TrendingUp } from 'lucide-react';

interface TrendPoint {
  at: string;
  dbMb: number;
  r2Mb: number;
  r2Objects: number;
}

interface StorageTrendPanelProps {
  points: TrendPoint[];
}

export default function StorageTrendPanel({ points }: StorageTrendPanelProps) {
  const insights = [
    {
      title: '看 DB 曲线',
      body: '若 DB 长期陡增但 R2 不增，说明新增大字段尚未纳入 offload 治理。',
    },
    {
      title: '看 R2 曲线',
      body: 'R2 增长而 DB 放缓，通常说明冷数据迁移路径正常工作。',
    },
    {
      title: '看 Prefix 目录',
      body: 'bucket 出现新前缀但 Pipeline 没有受管目标，说明仍有业务写入未接入治理。',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_0.8fr]">
      {/* Chart Card */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <TrendingUp className="h-4 w-4 text-gray-500" />
            过去 30 天体量走势
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-full bg-gray-900" />
              DB MB
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-full bg-blue-600" />
              R2 MB
            </span>
          </div>
        </div>
        <div className="p-4">
          {points.length < 2 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ChartColumn className="h-12 w-12 text-gray-300" />
              <p className="text-sm text-gray-500">
                还没有足够的趋势数据，请等待定时快照累积。
              </p>
            </div>
          ) : (
            <TrendChart points={points} />
          )}
        </div>
      </div>

      {/* Insights Card */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-700">
          趋势解读
        </div>
        <div className="space-y-3 p-4">
          {insights.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5"
            >
              <div className="text-sm font-medium text-gray-900">
                {item.title}
              </div>
              <div className="mt-1 text-xs leading-5 text-gray-600">
                {item.body}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  const width = 900;
  const height = 240;
  const pad = { left: 48, right: 16, top: 16, bottom: 28 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.flatMap((p) => [p.dbMb, p.r2Mb]));
  const xFor = (i: number) =>
    pad.left + (i * innerWidth) / Math.max(1, points.length - 1);
  const yFor = (v: number) => pad.top + innerHeight - (v * innerHeight) / max;
  const path = (key: 'dbMb' | 'r2Mb') =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i)},${yFor(p[key])}`)
      .join(' ');

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[640px]">
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            key={ratio}
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + innerHeight * (1 - ratio)}
            y2={pad.top + innerHeight * (1 - ratio)}
            stroke="rgb(229 231 235)"
            strokeOpacity="0.8"
          />
        ))}
        {[0, 0.5, 1].map((ratio) => (
          <text
            key={ratio}
            x={pad.left - 8}
            y={pad.top + innerHeight * (1 - ratio) + 4}
            fontSize="11"
            textAnchor="end"
            fill="rgb(107 114 128)"
          >
            {Math.round(max * ratio)}
          </text>
        ))}

        <path
          d={path('dbMb')}
          fill="none"
          stroke="rgb(17 24 39)"
          strokeWidth="2.5"
        />
        <path
          d={path('r2Mb')}
          fill="none"
          stroke="rgb(37 99 235)"
          strokeWidth="2.5"
        />

        {points.map((p, i) => (
          <g key={p.at}>
            <circle
              cx={xFor(i)}
              cy={yFor(p.dbMb)}
              r="2.5"
              fill="rgb(17 24 39)"
            />
            <circle
              cx={xFor(i)}
              cy={yFor(p.r2Mb)}
              r="2.5"
              fill="rgb(37 99 235)"
            />
          </g>
        ))}

        <text x={xFor(0)} y={height - 6} fontSize="11" fill="rgb(107 114 128)">
          {new Date(points[0].at).toISOString().slice(5, 10)}
        </text>
        <text
          x={xFor(points.length - 1) - 36}
          y={height - 6}
          fontSize="11"
          fill="rgb(107 114 128)"
        >
          {new Date(points[points.length - 1].at).toISOString().slice(5, 10)}
        </text>
      </svg>
    </div>
  );
}
