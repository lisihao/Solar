/**
 * Slides Engine v3.0 - ECharts Configuration Generator
 *
 * 根据数据点生成专业的 ECharts 图表配置
 * 遵循 Genspark 深色主题设计规范
 */

import { ChartContent, DataPoint } from "../checkpoint/checkpoint.types";

// ============================================================================
// Types
// ============================================================================

export interface EChartsConfig {
  backgroundColor: string;
  textStyle: {
    color: string;
    fontFamily: string;
  };
  title?: {
    text: string;
    textStyle: {
      color: string;
      fontSize: number;
      fontWeight: string;
    };
    left: string;
  };
  grid?: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    containLabel?: boolean;
  };
  xAxis?: unknown;
  yAxis?: unknown;
  series: unknown[];
  tooltip?: unknown;
  legend?: unknown;
  [key: string]: unknown;
}

// ============================================================================
// Color Palettes
// ============================================================================

export type ThemeMode = "dark" | "light";

export interface ThemeColors {
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  danger: string;
  purple: string;
  textPrimary: string;
  textSecondary: string;
  background: string;
  gridLine: string;
  tooltipBg: string;
  tooltipBorder: string;
  itemBorder: string;
}

const DARK_THEME_COLORS: ThemeColors = {
  primary: "#D4AF37",
  secondary: "#3B82F6",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",
  purple: "#8B5CF6",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  background: "transparent",
  gridLine: "#334155",
  tooltipBg: "#1E293B",
  tooltipBorder: "#334155",
  itemBorder: "#0F172A",
};

const LIGHT_THEME_COLORS: ThemeColors = {
  primary: "#B8860B", // Darker gold for light theme
  secondary: "#2563EB",
  success: "#059669",
  warning: "#D97706",
  danger: "#DC2626",
  purple: "#7C3AED",
  textPrimary: "#1E293B",
  textSecondary: "#64748B",
  background: "transparent",
  gridLine: "#E2E8F0",
  tooltipBg: "#FFFFFF",
  tooltipBorder: "#E2E8F0",
  itemBorder: "#FFFFFF",
};

function getThemeColors(theme: ThemeMode): ThemeColors {
  return theme === "light" ? LIGHT_THEME_COLORS : DARK_THEME_COLORS;
}

// Legacy export for backward compatibility
export const GENSPARK_COLORS = DARK_THEME_COLORS;

const CHART_PALETTE = [
  "#D4AF37", // Gold
  "#3B82F6", // Blue
  "#10B981", // Green
  "#F59E0B", // Orange
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#14B8A6", // Teal
  "#EF4444", // Red
];

const LIGHT_CHART_PALETTE = [
  "#B8860B", // Darker Gold
  "#2563EB", // Blue
  "#059669", // Green
  "#D97706", // Orange
  "#7C3AED", // Purple
  "#DB2777", // Pink
  "#0D9488", // Teal
  "#DC2626", // Red
];

function getChartPalette(theme: ThemeMode): string[] {
  return theme === "light" ? LIGHT_CHART_PALETTE : CHART_PALETTE;
}

// ============================================================================
// Bar Chart Generator
// ============================================================================

export function generateBarChart(
  data: { name: string; value: number }[],
  title?: string,
  horizontal = false,
  theme: ThemeMode = "dark",
): EChartsConfig {
  const colors = getThemeColors(theme);
  const palette = getChartPalette(theme);

  const categoryAxis = {
    type: "category",
    data: data.map((d) => d.name),
    axisLine: { lineStyle: { color: colors.gridLine } },
    axisLabel: { color: colors.textSecondary, fontSize: 12 },
    axisTick: { show: false },
  };

  const valueAxis = {
    type: "value",
    axisLine: { show: false },
    axisLabel: { color: colors.textSecondary, fontSize: 12 },
    splitLine: { lineStyle: { color: colors.gridLine, type: "dashed" } },
  };

  return {
    backgroundColor: colors.background,
    textStyle: {
      color: colors.textPrimary,
      fontFamily: "'Noto Sans SC', sans-serif",
    },
    title: title
      ? {
          text: title,
          textStyle: {
            color: colors.textPrimary,
            fontSize: 14,
            fontWeight: "600",
          },
          left: "left",
        }
      : undefined,
    grid: {
      left: 20,
      right: 20,
      top: title ? 40 : 20,
      bottom: 20,
      containLabel: true,
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    tooltip: {
      trigger: "axis",
      backgroundColor: colors.tooltipBg,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.textPrimary },
    },
    series: [
      {
        type: "bar",
        data: data.map((d, i) => ({
          value: d.value,
          itemStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: horizontal ? 1 : 0,
              y2: horizontal ? 0 : 1,
              colorStops: [
                { offset: 0, color: palette[i % palette.length] },
                {
                  offset: 1,
                  color: palette[i % palette.length] + "80", // 50% opacity
                },
              ],
            },
            borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
          },
        })),
        barWidth: "60%",
        label: {
          show: true,
          position: horizontal ? "right" : "top",
          color: colors.textPrimary,
          fontSize: 12,
          fontWeight: "bold",
        },
      },
    ],
  };
}

// ============================================================================
// Line Chart Generator
// ============================================================================

export function generateLineChart(
  data: { name: string; value: number }[],
  title?: string,
  showArea = true,
  theme: ThemeMode = "dark",
): EChartsConfig {
  const colors = getThemeColors(theme);

  return {
    backgroundColor: colors.background,
    textStyle: {
      color: colors.textPrimary,
      fontFamily: "'Noto Sans SC', sans-serif",
    },
    title: title
      ? {
          text: title,
          textStyle: {
            color: colors.textPrimary,
            fontSize: 14,
            fontWeight: "600",
          },
          left: "left",
        }
      : undefined,
    grid: {
      left: 20,
      right: 20,
      top: title ? 40 : 20,
      bottom: 20,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: data.map((d) => d.name),
      axisLine: { lineStyle: { color: colors.gridLine } },
      axisLabel: { color: colors.textSecondary, fontSize: 12 },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: { color: colors.textSecondary, fontSize: 12 },
      splitLine: { lineStyle: { color: colors.gridLine, type: "dashed" } },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: colors.tooltipBg,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.textPrimary },
    },
    series: [
      {
        type: "line",
        data: data.map((d) => d.value),
        smooth: true,
        lineStyle: {
          color: colors.primary,
          width: 3,
        },
        areaStyle: showArea
          ? {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: colors.primary + "40" },
                  { offset: 1, color: colors.primary + "00" },
                ],
              },
            }
          : undefined,
        symbol: "circle",
        symbolSize: 8,
        itemStyle: {
          color: colors.primary,
          borderColor: colors.itemBorder,
          borderWidth: 2,
        },
      },
    ],
  };
}

// ============================================================================
// Pie Chart Generator
// ============================================================================

export function generatePieChart(
  data: { name: string; value: number }[],
  title?: string,
  donut = true,
  theme: ThemeMode = "dark",
): EChartsConfig {
  const colors = getThemeColors(theme);
  const palette = getChartPalette(theme);

  return {
    backgroundColor: colors.background,
    textStyle: {
      color: colors.textPrimary,
      fontFamily: "'Noto Sans SC', sans-serif",
    },
    title: title
      ? {
          text: title,
          textStyle: {
            color: colors.textPrimary,
            fontSize: 14,
            fontWeight: "600",
          },
          left: "center",
        }
      : undefined,
    tooltip: {
      trigger: "item",
      backgroundColor: colors.tooltipBg,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.textPrimary },
      formatter: "{b}: {c} ({d}%)",
    },
    legend: {
      orient: "horizontal",
      bottom: 10,
      textStyle: { color: colors.textSecondary, fontSize: 12 },
    },
    series: [
      {
        type: "pie",
        radius: donut ? ["40%", "70%"] : "70%",
        center: ["50%", "45%"],
        data: data.map((d, i) => ({
          name: d.name,
          value: d.value,
          itemStyle: {
            color: palette[i % palette.length],
          },
        })),
        label: {
          show: true,
          color: colors.textPrimary,
          fontSize: 12,
          formatter: "{b}\n{d}%",
        },
        labelLine: {
          lineStyle: { color: colors.textSecondary },
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 20,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
      },
    ],
  };
}

// ============================================================================
// Radar Chart Generator
// ============================================================================

export function generateRadarChart(
  data: { name: string; value: number }[],
  title?: string,
  maxValue = 100,
  theme: ThemeMode = "dark",
): EChartsConfig {
  const colors = getThemeColors(theme);
  const splitAreaColors =
    theme === "light"
      ? ["rgba(226, 232, 240, 0.3)", "rgba(226, 232, 240, 0.5)"]
      : ["rgba(30, 41, 59, 0.3)", "rgba(30, 41, 59, 0.5)"];

  return {
    backgroundColor: colors.background,
    textStyle: {
      color: colors.textPrimary,
      fontFamily: "'Noto Sans SC', sans-serif",
    },
    title: title
      ? {
          text: title,
          textStyle: {
            color: colors.textPrimary,
            fontSize: 14,
            fontWeight: "600",
          },
          left: "center",
        }
      : undefined,
    tooltip: {
      trigger: "item",
      backgroundColor: colors.tooltipBg,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.textPrimary },
    },
    radar: {
      indicator: data.map((d) => ({
        name: d.name,
        max: maxValue,
      })),
      splitNumber: 4,
      axisName: {
        color: colors.textSecondary,
        fontSize: 12,
      },
      splitLine: {
        lineStyle: { color: colors.gridLine },
      },
      splitArea: {
        areaStyle: {
          color: splitAreaColors,
        },
      },
      axisLine: {
        lineStyle: { color: colors.gridLine },
      },
    },
    series: [
      {
        type: "radar",
        data: [
          {
            value: data.map((d) => d.value),
            areaStyle: {
              color: {
                type: "radial",
                x: 0.5,
                y: 0.5,
                r: 0.5,
                colorStops: [
                  { offset: 0, color: colors.primary + "60" },
                  { offset: 1, color: colors.primary + "20" },
                ],
              },
            },
            lineStyle: {
              color: colors.primary,
              width: 2,
            },
            itemStyle: {
              color: colors.primary,
            },
          },
        ],
      },
    ],
  };
}

// ============================================================================
// Main Generator Function
// ============================================================================

/**
 * 根据图表内容生成 ECharts 配置
 */
export function generateEChartsConfig(
  chartContent: ChartContent,
  theme: ThemeMode = "dark",
): EChartsConfig {
  const data = chartContent.data.map((d) => ({
    name: String(d.name || ""),
    value: Number(d.value || 0),
  }));

  switch (chartContent.type) {
    case "bar":
      return generateBarChart(data, chartContent.title, false, theme);
    case "line":
      return generateLineChart(data, chartContent.title, true, theme);
    case "pie":
      return generatePieChart(data, chartContent.title, true, theme);
    case "radar":
      return generateRadarChart(data, chartContent.title, 100, theme);
    default:
      return generateBarChart(data, chartContent.title, false, theme);
  }
}

/**
 * 生成完整的 ECharts HTML 片段
 */
export function generateEChartsHTML(
  chartContent: ChartContent,
  chartId: string,
  width = 500,
  height = 300,
  theme: ThemeMode = "dark",
): string {
  const config = generateEChartsConfig(chartContent, theme);
  const configJson = JSON.stringify(config);

  return `
<div id="${chartId}" style="width: ${width}px; height: ${height}px;"></div>
<script>
  (function() {
    var chartDom = document.getElementById('${chartId}');
    if (chartDom && typeof echarts !== 'undefined') {
      var chart = echarts.init(chartDom);
      chart.setOption(${configJson});
    }
  })();
</script>
  `.trim();
}

/**
 * 从数据点生成图表内容
 */
export function dataPointToChartContent(
  dataPoint: DataPoint & {
    relatedData?: { name: string; value: number }[];
    chartType?: string;
  },
): ChartContent | null {
  if (!dataPoint.relatedData || dataPoint.relatedData.length === 0) {
    return null;
  }

  return {
    type: (dataPoint.chartType as ChartContent["type"]) || "bar",
    data: dataPoint.relatedData,
    title: dataPoint.context,
  };
}

/**
 * 获取主题颜色配置
 */
export function getThemeColorsExport(theme: ThemeMode): ThemeColors {
  return getThemeColors(theme);
}

/**
 * 获取图表调色板
 */
export function getChartPaletteExport(theme: ThemeMode): string[] {
  return getChartPalette(theme);
}
