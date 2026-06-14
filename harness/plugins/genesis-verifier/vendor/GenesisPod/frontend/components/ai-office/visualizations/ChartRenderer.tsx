'use client';

/**
 * 图表渲染组件
 * 支持折线图、饼图、柱状图、雷达图
 */

import React from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ChartData } from '@/lib/features/ai-office/markdown-parser';
import type { PPTTemplate } from '@/lib/features/ai-office/ppt-templates';

interface ChartRendererProps {
  data: ChartData;
  type: 'line' | 'pie' | 'bar' | 'radar' | 'area';
  template: PPTTemplate;
  className?: string;
}

// 默认配色方案
const DEFAULT_COLORS = [
  '#3B82F6', // blue-500
  '#10B981', // green-500
  '#F59E0B', // amber-500
  '#EF4444', // red-500
  '#8B5CF6', // purple-500
  '#EC4899', // pink-500
  '#06B6D4', // cyan-500
  '#F97316', // orange-500
];

export default function ChartRenderer({
  data,
  type,
  template,
  className = '',
}: ChartRendererProps) {
  // 转换数据格式为 recharts 需要的格式
  const chartData = data.labels.map((label, index) => ({
    name: label,
    value: data.datasets[0].data[index],
  }));

  // 使用模板颜色或默认配色
  const colors = template.colors.decorative
    ? [template.colors.decorative, template.colors.primary, ...DEFAULT_COLORS]
    : DEFAULT_COLORS;

  // 自定义 Tooltip 样式
  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string }>;
  }) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <p className="font-medium text-gray-900">{payload[0].name}</p>
          <p className="text-sm" style={{ color: payload[0].color }}>
            {payload[0].value.toLocaleString()}
            {type === 'pie' ? '%' : ''}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`h-full w-full ${className}`}>
      <ResponsiveContainer width="100%" height="100%">
        {type === 'line' ? (
          <LineChart data={chartData}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={`${template.colors.text}20`}
            />
            <XAxis
              dataKey="name"
              stroke={template.colors.text}
              style={{
                fontSize: template.typography.caption,
                fontFamily: template.fonts.body,
              }}
            />
            <YAxis
              stroke={template.colors.text}
              style={{
                fontSize: template.typography.caption,
                fontFamily: template.fonts.body,
              }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Line
              type="monotone"
              dataKey="value"
              stroke={template.colors.primary}
              strokeWidth={3}
              dot={{ fill: template.colors.decorative, r: 6 }}
              activeDot={{ r: 8 }}
            />
          </LineChart>
        ) : type === 'bar' ? (
          <BarChart data={chartData}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={`${template.colors.text}20`}
            />
            <XAxis
              dataKey="name"
              stroke={template.colors.text}
              style={{
                fontSize: template.typography.caption,
                fontFamily: template.fonts.body,
              }}
            />
            <YAxis
              stroke={template.colors.text}
              style={{
                fontSize: template.typography.caption,
                fontFamily: template.fonts.body,
              }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Bar dataKey="value" fill={template.colors.primary}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={colors[index % colors.length]}
                />
              ))}
            </Bar>
          </BarChart>
        ) : type === 'pie' ? (
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={(entry) => `${entry.name}: ${entry.value}%`}
              outerRadius={120}
              fill={template.colors.primary}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={colors[index % colors.length]}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend />
          </PieChart>
        ) : type === 'radar' ? (
          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={chartData}>
            <PolarGrid stroke={`${template.colors.text}30`} />
            <PolarAngleAxis
              dataKey="name"
              stroke={template.colors.text}
              style={{
                fontSize: template.typography.caption,
                fontFamily: template.fonts.body,
              }}
            />
            <PolarRadiusAxis stroke={template.colors.text} />
            <Radar
              name="值"
              dataKey="value"
              stroke={template.colors.primary}
              fill={template.colors.primary}
              fillOpacity={0.6}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
          </RadarChart>
        ) : null}
      </ResponsiveContainer>
    </div>
  );
}
