'use client';

/**
 * ReportChartRenderer - 报告图表渲染组件
 *
 * 支持多种图表类型：折线图、柱状图、饼图、面积图、雷达图
 * 基于 Recharts 实现
 */

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ZAxis,
} from 'recharts';
import type {
  RenderableChart,
  RenderableChartDataPoint,
  RenderableEvidence,
} from './types';
import { triggerCitationClick } from '@/components/common/citations/citationNavigation';
import { useI18n } from '@/lib/i18n';

// 图表配色方案
const CHART_COLORS = [
  '#3B82F6', // blue-500
  '#10B981', // emerald-500
  '#F59E0B', // amber-500
  '#EF4444', // red-500
  '#8B5CF6', // violet-500
  '#EC4899', // pink-500
  '#06B6D4', // cyan-500
  '#84CC16', // lime-500
];

// 风险矩阵颜色
const RISK_COLORS = {
  low: '#10B981',
  medium: '#F59E0B',
  high: '#EF4444',
};

interface ReportChartRendererProps {
  chart: RenderableChart;
  className?: string;
  evidences?: RenderableEvidence[];
}

/**
 * Render chart source text with clickable [N] citation links.
 */
function ChartSourceWithCitations({
  source,
  evidences,
}: {
  source: string;
  evidences?: RenderableEvidence[];
}) {
  const parts: (string | React.ReactElement)[] = [];
  const pattern = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) {
      parts.push(source.slice(lastIndex, match.index));
    }
    const citationNum = parseInt(match[1], 10);
    const evidence = evidences?.find((e) => e.citationIndex === citationNum);
    if (evidence) {
      parts.push(
        <sup
          key={`cite-${match.index}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            triggerCitationClick(evidence.id);
          }}
          className="cursor-pointer rounded bg-purple-100 px-1 py-0.5 text-xs font-medium text-purple-700 transition-colors hover:bg-purple-200"
          title={evidence.title || `Citation [${citationNum}]`}
        >
          [{citationNum}]
        </sup>
      );
    } else {
      parts.push(match[0]);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < source.length) {
    parts.push(source.slice(lastIndex));
  }

  return <>{parts}</>;
}

/**
 * 从 chart metadata 提取单系列的有意义标签
 */
function getSingleSeriesLabel(chart: RenderableChart): string {
  if (chart.yAxis?.label) return chart.yAxis.label;
  if (chart.title) {
    // 去掉括号及其内容（如 "GDP增长率（%）" → "GDP增长率"）
    return chart.title.replace(/[（(][^）)]*[）)]/g, '').trim();
  }
  return 'value';
}

/**
 * 转换数据为 Recharts 格式
 */
function transformData(
  data: RenderableChartDataPoint[],
  seriesLabel = 'value'
): Record<string, unknown>[] {
  // 检查是否有多系列数据
  const hasSeries = data.some((d) => d.series);

  if (!hasSeries) {
    // 单系列数据 - 使用动态 label 作为 key
    return data.map((d) => ({
      name: d.label,
      [seriesLabel]: d.value,
      ...d.extra,
    }));
  }

  // 多系列数据：按 label 分组
  const grouped: Record<string, Record<string, unknown>> = {};
  data.forEach((d) => {
    if (!grouped[d.label]) {
      grouped[d.label] = { name: d.label };
    }
    if (d.series) {
      grouped[d.label][d.series] = d.value;
    }
  });

  return Object.values(grouped);
}

/**
 * 获取系列名称列表
 */
function getSeriesNames(data: RenderableChartDataPoint[]): string[] {
  const seriesSet = new Set<string>();
  data.forEach((d) => {
    if (d.series) {
      seriesSet.add(d.series);
    }
  });
  return Array.from(seriesSet);
}

/**
 * 折线图
 */
function LineChartComponent({
  chart,
  data,
  seriesLabel,
}: {
  chart: RenderableChart;
  data: Record<string, unknown>[];
  seriesLabel: string;
}) {
  const chartData = chart.data || [];
  const seriesNames = getSeriesNames(chartData);
  const hasSeries = seriesNames.length > 0;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart
        data={data}
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: '#E5E7EB' }}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: '#E5E7EB' }}
          label={
            chart.yAxis?.unit
              ? { value: chart.yAxis.unit, angle: -90, position: 'insideLeft' }
              : undefined
          }
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
          }}
        />
        <Legend />
        {hasSeries ? (
          seriesNames.map((series, idx) => (
            <Line
              key={series}
              type="monotone"
              dataKey={series}
              stroke={CHART_COLORS[idx % CHART_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
          ))
        ) : (
          <Line
            type="monotone"
            dataKey={seriesLabel}
            stroke={CHART_COLORS[0]}
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * 柱状图
 */
function BarChartComponent({
  chart,
  data,
  seriesLabel,
}: {
  chart: RenderableChart;
  data: Record<string, unknown>[];
  seriesLabel: string;
}) {
  const chartData = chart.data || [];
  const seriesNames = getSeriesNames(chartData);
  const hasSeries = seriesNames.length > 0;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={data}
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: '#E5E7EB' }}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: '#E5E7EB' }}
          label={
            chart.yAxis?.unit
              ? { value: chart.yAxis.unit, angle: -90, position: 'insideLeft' }
              : undefined
          }
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
          }}
        />
        <Legend />
        {hasSeries ? (
          seriesNames.map((series, idx) => (
            <Bar
              key={series}
              dataKey={series}
              fill={CHART_COLORS[idx % CHART_COLORS.length]}
              radius={[4, 4, 0, 0]}
            />
          ))
        ) : (
          <Bar
            dataKey={seriesLabel}
            fill={CHART_COLORS[0]}
            radius={[4, 4, 0, 0]}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * 面积图
 */
function AreaChartComponent({
  chart,
  data,
  seriesLabel,
}: {
  chart: RenderableChart;
  data: Record<string, unknown>[];
  seriesLabel: string;
}) {
  const chartData = chart.data || [];
  const seriesNames = getSeriesNames(chartData);
  const hasSeries = seriesNames.length > 0;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart
        data={data}
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: '#E5E7EB' }}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: '#E5E7EB' }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
          }}
        />
        <Legend />
        {hasSeries ? (
          seriesNames.map((series, idx) => (
            <Area
              key={series}
              type="monotone"
              dataKey={series}
              stroke={CHART_COLORS[idx % CHART_COLORS.length]}
              fill={CHART_COLORS[idx % CHART_COLORS.length]}
              fillOpacity={0.3}
            />
          ))
        ) : (
          <Area
            type="monotone"
            dataKey={seriesLabel}
            stroke={CHART_COLORS[0]}
            fill={CHART_COLORS[0]}
            fillOpacity={0.3}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * 饼图
 */
function PieChartComponent({
  data,
  seriesLabel,
}: {
  chart: RenderableChart;
  data: Record<string, unknown>[];
  seriesLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          dataKey={seriesLabel}
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={100}
          label={({ name, percent }) =>
            `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`
          }
          labelLine={{ stroke: '#9CA3AF' }}
        >
          {data.map((_, idx) => (
            <Cell
              key={`cell-${idx}`}
              fill={CHART_COLORS[idx % CHART_COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
          }}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

/**
 * 雷达图
 */
function RadarChartComponent({
  data,
  seriesLabel,
}: {
  chart: RenderableChart;
  data: Record<string, unknown>[];
  seriesLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={data}>
        <PolarGrid stroke="#E5E7EB" />
        <PolarAngleAxis dataKey="name" tick={{ fontSize: 12 }} />
        <PolarRadiusAxis tick={{ fontSize: 10 }} />
        <Radar
          dataKey={seriesLabel}
          stroke={CHART_COLORS[0]}
          fill={CHART_COLORS[0]}
          fillOpacity={0.5}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
          }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

/**
 * 风险矩阵图（散点图）
 */
function RiskMatrixComponent({ chart }: { chart: RenderableChart }) {
  const { t } = useI18n();
  const chartData = chart.data || [];
  const data = chartData.map((d) => ({
    name: d.label,
    probability: d.value,
    impact: (d.extra?.impact as number) || 50,
    risk: d.label,
  }));

  // 根据风险等级分配颜色
  const getColor = (probability: number, impact: number) => {
    const score = (probability + impact) / 2;
    if (score >= 70) return RISK_COLORS.high;
    if (score >= 40) return RISK_COLORS.medium;
    return RISK_COLORS.low;
  };

  return (
    <ResponsiveContainer width="100%" height={350}>
      <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          type="number"
          dataKey="probability"
          name={t('topicResearch.charts.probability')}
          domain={[0, 100]}
          tick={{ fontSize: 12 }}
          label={{
            value: t('topicResearch.charts.probabilityAxis'),
            position: 'bottom',
            offset: 0,
          }}
        />
        <YAxis
          type="number"
          dataKey="impact"
          name={t('topicResearch.charts.impact')}
          domain={[0, 100]}
          tick={{ fontSize: 12 }}
          label={{
            value: t('topicResearch.charts.impactAxis'),
            angle: -90,
            position: 'insideLeft',
          }}
        />
        <ZAxis range={[100, 400]} />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={({ payload }) => {
            if (!payload || payload.length === 0) return null;
            const item = payload[0].payload;
            return (
              <div className="rounded-lg border bg-white p-3 shadow-lg">
                <p className="font-medium">{item.risk}</p>
                <p className="text-sm text-gray-600">
                  {t('topicResearch.charts.probabilityLabel')}{' '}
                  {item.probability}%
                </p>
                <p className="text-sm text-gray-600">
                  {t('topicResearch.charts.impactLabel')} {item.impact}%
                </p>
              </div>
            );
          }}
        />
        <Scatter data={data} shape="circle">
          {data.map((entry, idx) => (
            <Cell
              key={`cell-${idx}`}
              fill={getColor(entry.probability, entry.impact)}
            />
          ))}
        </Scatter>
        {/* 风险区域背景 */}
        <defs>
          <linearGradient id="riskGradient" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#10B981" stopOpacity={0.1} />
            <stop offset="50%" stopColor="#F59E0B" stopOpacity={0.1} />
            <stop offset="100%" stopColor="#EF4444" stopOpacity={0.1} />
          </linearGradient>
        </defs>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/**
 * 生成图表类型的名称
 */
function getChartTypeName(type: string, t: (key: string) => string): string {
  const typeKey = `topicResearch.charts.types.${type}` as const;
  // Try to get the specific type translation, fallback to generic "chart"
  try {
    return t(typeKey);
  } catch {
    return t('topicResearch.charts.types.chart');
  }
}

/**
 * 为屏幕阅读器生成图表数据摘要
 */
function generateChartSummary(
  chart: RenderableChart,
  data: RenderableChartDataPoint[],
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const typeName = getChartTypeName(chart.type || 'bar', t);
  const dataCount = data.length;
  const title = chart.title || t('topicResearch.charts.types.chart');

  if (dataCount === 0) {
    return t('topicResearch.charts.chartSummaryNoData', {
      title,
      type: typeName,
    });
  }

  // 计算基本统计信息
  const values = data
    .map((d) => d.value)
    .filter((v) => typeof v === 'number' && isFinite(v));
  const min = Math.min(...values);
  const max = Math.max(...values);

  let summary = t('topicResearch.charts.chartSummary', {
    title,
    type: typeName,
    count: dataCount,
  });

  if (values.length > 0) {
    summary = t('topicResearch.charts.chartSummaryRange', {
      title,
      type: typeName,
      count: dataCount,
      min: min.toFixed(1),
      max: max.toFixed(1),
    });
  }

  if (chart.description) {
    summary += `。${chart.description}`;
  }

  return summary;
}

/**
 * 引用图表渲染（chartType === 'reference'）
 * 直接展示来自证据的原始图片
 */
function ReferenceFigureRenderer({
  chart,
  className = '',
}: {
  chart: RenderableChart;
  className?: string;
}) {
  if (!chart.imageUrl) {
    return (
      <div
        className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}
      >
        <div className="mb-2">
          {chart.figureNumber != null && (
            <span className="text-xs font-semibold text-purple-600">
              图 {chart.figureNumber}
            </span>
          )}
          <h4 className="text-base font-semibold text-gray-900">
            {chart.title}
          </h4>
        </div>
        <div className="flex min-h-[160px] items-center justify-center text-sm text-gray-400">
          图片暂不可用
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}
      role="figure"
      aria-label={chart.title}
    >
      {/* 图号 + 标题 */}
      <div className="mb-3">
        {chart.figureNumber != null && (
          <span className="mb-1 block text-xs font-semibold text-purple-600">
            图 {chart.figureNumber}
          </span>
        )}
        <h4 className="text-base font-semibold text-gray-900">{chart.title}</h4>
        {chart.description && (
          <p className="mt-1 text-sm text-gray-500">{chart.description}</p>
        )}
      </div>

      {/* 图片 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={chart.imageUrl}
        alt={chart.title}
        className="mx-auto max-h-[480px] w-full rounded-lg object-contain"
        loading="lazy"
      />

      {/* 来源 */}
      {chart.source && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-xs text-gray-400">来源：{chart.source}</p>
        </div>
      )}
    </div>
  );
}

/**
 * 主渲染组件
 */
export function ReportChartRenderer({
  chart,
  className = '',
  evidences,
}: ReportChartRendererProps) {
  const { t } = useI18n();

  // ★ 所有 hooks 必须无条件调用，early return 在 hooks 之后
  const chartData = chart.data || [];
  const chartType = chart.type || 'bar';

  const seriesLabel = useMemo(() => getSingleSeriesLabel(chart), [chart]);
  const transformedData = useMemo(
    () => transformData(chartData, seriesLabel),
    [chartData, seriesLabel]
  );

  // 生成唯一 ID 用于 aria 属性
  const chartId = useMemo(
    () => `chart-${chart.id || Math.random().toString(36).substr(2, 9)}`,
    [chart.id]
  );
  const descriptionId = `${chartId}-desc`;
  const tableId = `${chartId}-table`;

  // 生成屏幕阅读器摘要
  const chartSummary = useMemo(
    () => generateChartSummary(chart, chartData, t),
    [chart, chartData, t]
  );

  // ★ reference 类型：hooks 调用完毕后再 early return
  if (chart.chartType === 'reference') {
    return <ReferenceFigureRenderer chart={chart} className={className} />;
  }

  // ★ 如果没有数据，显示空状态
  if (chartData.length === 0) {
    return (
      <div
        className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}
        role="figure"
        aria-label={`${chart.title || t('topicResearch.charts.types.chart')}：${t('topicResearch.charts.noChartData')}`}
      >
        <div className="mb-4">
          <h4 className="text-base font-semibold text-gray-900">
            {chart.title}
          </h4>
          {chart.description && (
            <p className="mt-1 text-sm text-gray-500">{chart.description}</p>
          )}
        </div>
        <div className="flex min-h-[200px] items-center justify-center text-sm text-gray-400">
          {t('topicResearch.charts.noChartData')}
        </div>
      </div>
    );
  }

  // ★ 创建一个带数据的 chart 对象用于子组件
  const chartWithData = { ...chart, data: chartData, type: chartType };

  const renderChart = () => {
    switch (chartType) {
      case 'line':
        return (
          <LineChartComponent
            chart={chartWithData}
            data={transformedData}
            seriesLabel={seriesLabel}
          />
        );
      case 'bar':
        return (
          <BarChartComponent
            chart={chartWithData}
            data={transformedData}
            seriesLabel={seriesLabel}
          />
        );
      case 'area':
        return (
          <AreaChartComponent
            chart={chartWithData}
            data={transformedData}
            seriesLabel={seriesLabel}
          />
        );
      case 'pie':
        return (
          <PieChartComponent
            chart={chartWithData}
            data={transformedData}
            seriesLabel={seriesLabel}
          />
        );
      case 'radar':
        return (
          <RadarChartComponent
            chart={chartWithData}
            data={transformedData}
            seriesLabel={seriesLabel}
          />
        );
      case 'composed':
        return (
          <BarChartComponent
            chart={chartWithData}
            data={transformedData}
            seriesLabel={seriesLabel}
          />
        );
      default:
        return (
          <BarChartComponent
            chart={chartWithData}
            data={transformedData}
            seriesLabel={seriesLabel}
          />
        );
    }
  };

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}
      role="figure"
      aria-labelledby={chartId}
      aria-describedby={descriptionId}
    >
      {/* 图表标题 */}
      <div className="mb-4">
        <h4 id={chartId} className="text-base font-semibold text-gray-900">
          {chart.title}
        </h4>
        {chart.description && (
          <p id={descriptionId} className="mt-1 text-sm text-gray-500">
            {chart.description}
          </p>
        )}
      </div>

      {/* 屏幕阅读器摘要（视觉隐藏） */}
      <div className="sr-only" aria-live="polite">
        {chartSummary}
      </div>

      {/* 图表内容 */}
      <div className="min-h-[300px]" aria-hidden="true">
        {renderChart()}
      </div>

      {/* 数据表格（屏幕阅读器可访问，视觉隐藏） */}
      <table
        id={tableId}
        className="sr-only"
        aria-label={`${chart.title || t('topicResearch.charts.types.chart')} ${t('topicResearch.charts.dataTable')}`}
      >
        <caption>
          {chart.title} - {t('topicResearch.charts.dataDetails')}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('topicResearch.charts.item')}</th>
            <th scope="col">{t('topicResearch.charts.value')}</th>
          </tr>
        </thead>
        <tbody>
          {chartData.map((item, index) => (
            <tr key={index}>
              <td>{item.label}</td>
              <td>{item.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 数据来源 */}
      {chart.source && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-xs text-gray-400">
            {t('topicResearch.charts.dataSource')}{' '}
            <ChartSourceWithCitations
              source={chart.source}
              evidences={evidences}
            />
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 风险矩阵专用渲染
 */
export function RiskMatrixRenderer({
  chart,
  className = '',
}: ReportChartRendererProps) {
  const { t } = useI18n();
  const chartData = chart.data || [];
  // ★ 使用 useMemo 避免 hydration 错误（Math.random 在 SSR/CSR 产生不同值）
  const chartId = useMemo(
    () => `risk-matrix-${chart.id || Math.random().toString(36).substr(2, 9)}`,
    [chart.id]
  );

  // 计算风险等级
  const getRiskLevel = (probability: number, impact: number): string => {
    const score = (probability + impact) / 2;
    if (score >= 70) return t('topicResearch.charts.riskLevels.high');
    if (score >= 40) return t('topicResearch.charts.riskLevels.medium');
    return t('topicResearch.charts.riskLevels.low');
  };

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}
      role="figure"
      aria-labelledby={chartId}
    >
      <div className="mb-4">
        <h4 id={chartId} className="text-base font-semibold text-gray-900">
          {chart.title}
        </h4>
        {chart.description && (
          <p className="mt-1 text-sm text-gray-500">{chart.description}</p>
        )}
      </div>

      {/* 屏幕阅读器摘要 */}
      <div className="sr-only">
        {t('topicResearch.charts.riskMatrixDesc', { count: chartData.length })}
      </div>

      <div aria-hidden="true">
        <RiskMatrixComponent chart={chart} />
      </div>

      {/* 数据表格（屏幕阅读器可访问） */}
      <table
        className="sr-only"
        aria-label={t('topicResearch.charts.riskMatrix')}
      >
        <caption>
          {chart.title} - {t('topicResearch.charts.dataDetails')}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('topicResearch.charts.riskItem')}</th>
            <th scope="col">{t('topicResearch.charts.probability')}</th>
            <th scope="col">{t('topicResearch.charts.impact')}</th>
            <th scope="col">{t('topicResearch.charts.riskLevel')}</th>
          </tr>
        </thead>
        <tbody>
          {chartData.map((item, index) => {
            const impact = (item.extra?.impact as number) || 50;
            return (
              <tr key={index}>
                <td>{item.label}</td>
                <td>{item.value}%</td>
                <td>{impact}%</td>
                <td>{getRiskLevel(item.value, impact)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* 图例 */}
      <div
        className="mt-4 flex items-center justify-center gap-6"
        role="list"
        aria-label={t('topicResearch.charts.riskLegend')}
      >
        <div className="flex items-center gap-2" role="listitem">
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: RISK_COLORS.low }}
            aria-hidden="true"
          />
          <span className="text-sm text-gray-600">
            {t('topicResearch.charts.riskLevels.low')}
          </span>
        </div>
        <div className="flex items-center gap-2" role="listitem">
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: RISK_COLORS.medium }}
            aria-hidden="true"
          />
          <span className="text-sm text-gray-600">
            {t('topicResearch.charts.riskLevels.medium')}
          </span>
        </div>
        <div className="flex items-center gap-2" role="listitem">
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: RISK_COLORS.high }}
            aria-hidden="true"
          />
          <span className="text-sm text-gray-600">
            {t('topicResearch.charts.riskLevels.high')}
          </span>
        </div>
      </div>
    </div>
  );
}

export default ReportChartRenderer;
