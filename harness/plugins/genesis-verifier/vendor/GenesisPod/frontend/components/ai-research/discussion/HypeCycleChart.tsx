'use client';

/**
 * HypeCycleChart - Gartner Hype Cycle 图表组件
 * 使用 SVG 绘制技术成熟度曲线
 */

import React, { useMemo, useState } from 'react';
import { Info, ZoomIn, ZoomOut } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export interface HypeCyclePosition {
  techName: string;
  xPosition: number; // 0-100
  yPosition: number; // 0-100
  stage: string;
  yearsToMainstream: string;
}

interface HypeCycleChartProps {
  positions: HypeCyclePosition[];
  onTechClick?: (techName: string) => void;
  width?: number;
  height?: number;
}

// STAGE_LABELS moved to component to use i18n

const STAGE_COLORS: Record<string, string> = {
  innovation_trigger: '#3B82F6',
  peak_of_expectations: '#10B981',
  trough_of_disillusionment: '#EF4444',
  slope_of_enlightenment: '#F59E0B',
  plateau_of_productivity: '#8B5CF6',
};

// Generate the Hype Cycle curve path
function generateHypeCyclePath(width: number, height: number): string {
  const padding = 40;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Control points for the curve
  const points = [
    { x: 0, y: 0.7 }, // Start (Innovation Trigger)
    { x: 0.15, y: 0.3 }, // Rising
    { x: 0.25, y: 0.05 }, // Peak (Peak of Inflated Expectations)
    { x: 0.35, y: 0.15 }, // Falling
    { x: 0.45, y: 0.85 }, // Trough (Trough of Disillusionment)
    { x: 0.55, y: 0.75 }, // Rising again
    { x: 0.7, y: 0.5 }, // Slope of Enlightenment
    { x: 0.85, y: 0.35 }, // Approaching plateau
    { x: 1, y: 0.3 }, // Plateau of Productivity
  ];

  // Convert to SVG coordinates
  const svgPoints = points.map((p) => ({
    x: padding + p.x * chartWidth,
    y: padding + p.y * chartHeight,
  }));

  // Create smooth curve using cubic bezier
  let path = `M ${svgPoints[0].x} ${svgPoints[0].y}`;

  for (let i = 1; i < svgPoints.length; i++) {
    const prev = svgPoints[i - 1];
    const curr = svgPoints[i];
    const cp1x = prev.x + (curr.x - prev.x) / 3;
    const cp1y = prev.y;
    const cp2x = prev.x + (2 * (curr.x - prev.x)) / 3;
    const cp2y = curr.y;
    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
  }

  return path;
}

function TechDot({
  position,
  chartWidth,
  chartHeight,
  padding,
  isHovered,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  position: HypeCyclePosition;
  chartWidth: number;
  chartHeight: number;
  padding: number;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}) {
  const x = padding + (position.xPosition / 100) * (chartWidth - padding * 2);
  const y = padding + (position.yPosition / 100) * (chartHeight - padding * 2);
  const color = STAGE_COLORS[position.stage] || '#6B7280';

  return (
    <g
      className="cursor-pointer"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      {/* Glow effect when hovered */}
      {isHovered && (
        <circle
          cx={x}
          cy={y}
          r={16}
          fill={color}
          opacity={0.2}
          className="transition-all"
        />
      )}

      {/* Main dot */}
      <circle
        cx={x}
        cy={y}
        r={isHovered ? 10 : 8}
        fill={color}
        stroke="white"
        strokeWidth={2}
        className="transition-all"
      />

      {/* Label */}
      <text
        x={x}
        y={y - 14}
        textAnchor="middle"
        className={`text-xs font-medium transition-all ${
          isHovered ? 'fill-gray-900' : 'fill-gray-600'
        }`}
        style={{ fontSize: isHovered ? '12px' : '10px' }}
      >
        {position.techName}
      </text>
    </g>
  );
}

export default function HypeCycleChart({
  positions,
  onTechClick,
  width = 800,
  height = 400,
}: HypeCycleChartProps) {
  const { t } = useI18n();
  const [hoveredTech, setHoveredTech] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  const padding = 40;
  const curvePath = useMemo(
    () => generateHypeCyclePath(width, height),
    [width, height]
  );

  const hoveredPosition = positions.find((p) => p.techName === hoveredTech);

  const STAGE_LABELS = [
    {
      x: 10,
      label: t('topicResearch.deepResearch.hypeCycle.phases.innovationTrigger'),
    },
    {
      x: 30,
      label: t(
        'topicResearch.deepResearch.hypeCycle.phases.peakOfExpectations'
      ),
    },
    {
      x: 50,
      label: t(
        'topicResearch.deepResearch.hypeCycle.phases.troughOfDisillusionment'
      ),
    },
    {
      x: 70,
      label: t(
        'topicResearch.deepResearch.hypeCycle.phases.slopeOfEnlightenment'
      ),
    },
    {
      x: 90,
      label: t(
        'topicResearch.deepResearch.hypeCycle.phases.plateauOfProductivity'
      ),
    },
  ];

  return (
    <div className="relative">
      {/* Controls */}
      <div className="absolute right-4 top-4 z-10 flex gap-2">
        <button
          onClick={() => setScale((s) => Math.min(2, s + 0.2))}
          className="rounded-lg bg-white p-2 shadow-md hover:bg-gray-50"
          title={t('topicResearch.deepResearch.hypeCycle.zoomIn')}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
          className="rounded-lg bg-white p-2 shadow-md hover:bg-gray-50"
          title={t('topicResearch.deepResearch.hypeCycle.zoomOut')}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
      </div>

      {/* Chart Container */}
      <div
        className="overflow-auto rounded-xl border border-gray-200 bg-white"
        style={{ maxHeight: '500px' }}
      >
        <svg
          width={width * scale}
          height={height * scale}
          viewBox={`0 0 ${width} ${height}`}
          className="transition-all"
        >
          {/* Background gradient */}
          <defs>
            <linearGradient
              id="curveGradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.1" />
              <stop offset="25%" stopColor="#10B981" stopOpacity="0.1" />
              <stop offset="50%" stopColor="#EF4444" stopOpacity="0.1" />
              <stop offset="75%" stopColor="#F59E0B" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.1" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <g className="stroke-gray-200">
            {[0.25, 0.5, 0.75].map((ratio) => (
              <line
                key={`h-${ratio}`}
                x1={padding}
                y1={padding + ratio * (height - padding * 2)}
                x2={width - padding}
                y2={padding + ratio * (height - padding * 2)}
                strokeDasharray="4"
              />
            ))}
            {STAGE_LABELS.map(({ x }) => (
              <line
                key={`v-${x}`}
                x1={padding + (x / 100) * (width - padding * 2)}
                y1={padding}
                x2={padding + (x / 100) * (width - padding * 2)}
                y2={height - padding}
                strokeDasharray="4"
              />
            ))}
          </g>

          {/* Y-axis labels */}
          <text
            x={padding - 10}
            y={padding + 10}
            textAnchor="end"
            className="fill-gray-500 text-xs"
          >
            {t('topicResearch.deepResearch.hypeCycle.yAxis.highExpectation')}
          </text>
          <text
            x={padding - 10}
            y={height - padding}
            textAnchor="end"
            className="fill-gray-500 text-xs"
          >
            {t('topicResearch.deepResearch.hypeCycle.yAxis.lowExpectation')}
          </text>

          {/* X-axis stage labels */}
          {STAGE_LABELS.map(({ x, label }) => (
            <text
              key={label}
              x={padding + (x / 100) * (width - padding * 2)}
              y={height - 10}
              textAnchor="middle"
              className="fill-gray-600 text-xs font-medium"
            >
              {label}
            </text>
          ))}

          {/* The Hype Cycle curve */}
          <path
            d={curvePath}
            fill="none"
            stroke="url(#curveGradient)"
            strokeWidth={40}
            opacity={0.5}
          />
          <path
            d={curvePath}
            fill="none"
            stroke="#6B7280"
            strokeWidth={3}
            strokeLinecap="round"
          />

          {/* Technology dots */}
          {positions.map((position) => (
            <TechDot
              key={position.techName}
              position={position}
              chartWidth={width}
              chartHeight={height}
              padding={padding}
              isHovered={hoveredTech === position.techName}
              onMouseEnter={() => setHoveredTech(position.techName)}
              onMouseLeave={() => setHoveredTech(null)}
              onClick={() => onTechClick?.(position.techName)}
            />
          ))}
        </svg>
      </div>

      {/* Tooltip */}
      {hoveredPosition && (
        <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <h4 className="font-medium text-gray-900">
            {hoveredPosition.techName}
          </h4>
          <div className="mt-1 space-y-1 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor:
                    STAGE_COLORS[hoveredPosition.stage] || '#6B7280',
                }}
              />
              <span>
                {STAGE_LABELS.find((s) =>
                  hoveredPosition.stage.includes(s.label.replace(/[期]/g, ''))
                )?.label || hoveredPosition.stage}
              </span>
            </div>
            <div>
              {t('topicResearch.deepResearch.hypeCycle.expectedMaturity')}:{' '}
              {hoveredPosition.yearsToMainstream}
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex flex-wrap justify-center gap-4">
        {Object.entries(STAGE_COLORS).map(([stage, color]) => {
          const labelKey = {
            innovation_trigger: 'innovationTrigger',
            peak_of_expectations: 'peakOfExpectations',
            trough_of_disillusionment: 'troughOfDisillusionment',
            slope_of_enlightenment: 'slopeOfEnlightenment',
            plateau_of_productivity: 'plateauOfProductivity',
          }[stage];

          return (
            <div key={stage} className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-gray-600">
                {labelKey &&
                  t(`topicResearch.deepResearch.hypeCycle.phases.${labelKey}`)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Info */}
      <div className="mt-4 flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>{t('topicResearch.deepResearch.hypeCycle.info')}</p>
      </div>
    </div>
  );
}
