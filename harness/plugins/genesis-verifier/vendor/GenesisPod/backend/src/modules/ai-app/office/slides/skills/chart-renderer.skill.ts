/**
 * Slides Engine v3.0 - Chart Renderer Skill
 *
 * 服务端图表渲染：使用 ECharts 生成 SVG 字符串，内嵌到 HTML
 * 支持 line, bar, pie, radar 四种图表类型
 */

import { Injectable, Logger } from "@nestjs/common";
import * as echarts from "echarts";
import { ContentSection, StatContent } from "../checkpoint/checkpoint.types";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
} from "@/modules/ai-harness/facade";

/**
 * 图表数据结构
 */
export interface ChartData {
  type: "line" | "bar" | "pie" | "radar";
  title?: string;
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    color?: string;
  }[];
}

/**
 * 图表渲染配置
 */
export interface ChartRenderOptions {
  width?: number;
  height?: number;
  theme?: "dark" | "light";
  showLegend?: boolean;
  showTitle?: boolean;
}

const DEFAULT_COLORS = [
  "#F97316", // orange
  "#3B82F6", // blue
  "#10B981", // green
  "#8B5CF6", // purple
  "#EF4444", // red
  "#F59E0B", // amber
  "#06B6D4", // cyan
  "#EC4899", // pink
];

/**
 * 图表渲染技能的输入类型
 */
export interface ChartRendererInput {
  data: ChartData;
  options?: ChartRenderOptions;
}

/**
 * MissionOrchestrator 传递的输入格式
 */
interface OrchestratorInput {
  task?: string;
  context?: {
    input?: {
      data?: ChartData;
      options?: ChartRenderOptions;
    };
    [key: string]: unknown;
  };
  previousOutputs?: Record<string, unknown>;
}

/**
 * 图表渲染技能的输出类型
 */
export interface ChartRendererOutput {
  svgString: string;
  width: number;
  height: number;
  type: ChartData["type"];
}

@Injectable()
export class ChartRendererSkill implements ISkill<
  ChartRendererInput,
  ChartRendererOutput
> {
  readonly id = "slides-chart-renderer";
  readonly name = "图表渲染";
  readonly description = "根据数据生成 ECharts 图表配置";
  readonly layer: SkillLayer = SKILL_LAYERS.RENDERING;
  readonly domain = "slides";
  readonly tags = ["slides", "chart", "rendering", "echarts"];
  readonly version = "4.0.0";

  private readonly logger = new Logger(ChartRendererSkill.name);

  /**
   * 执行技能：渲染图表为 SVG 字符串
   *
   * 支持两种输入格式：
   * 1. 直接调用: { data, options }
   * 2. MissionOrchestrator 格式: { task, context, previousOutputs }
   */
  async execute(
    input: ChartRendererInput | OrchestratorInput,
    context: SkillContext,
  ): Promise<SkillResult<ChartRendererOutput>> {
    const startTime = new Date();

    // 处理 Orchestrator 输入格式
    const actualInput = this.normalizeInput(input);
    if (!actualInput.data) {
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "Missing chart data in input",
          retryable: false,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }

    try {
      const { data, options = {} } = actualInput;

      // 验证输入
      if (!data?.type) {
        throw new Error("Invalid chart data: missing type");
      }

      if (!Array.isArray(data.labels) || data.labels.length === 0) {
        throw new Error("Invalid chart data: empty or missing labels");
      }

      if (!Array.isArray(data.datasets) || data.datasets.length === 0) {
        throw new Error("Invalid chart data: empty or missing datasets");
      }

      // 渲染图表
      const svgString = this.renderToSvg(data, options);

      const width = options.width || 600;
      const height = options.height || 400;

      return {
        success: true,
        data: {
          svgString,
          width,
          height,
          type: data.type,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[execute] Failed to render chart: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        success: false,
        error: {
          code: "CHART_RENDER_ERROR",
          message: errorMessage,
          retryable: false,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }
  }

  /**
   * 渲染图表为 SVG 字符串
   * 保留用于向后兼容
   */
  renderToSvg(data: ChartData, options: ChartRenderOptions = {}): string {
    const {
      width = 600,
      height = 400,
      theme = "dark",
      showLegend = true,
      showTitle = false,
    } = options;

    try {
      // 创建 ECharts 实例（SSR 模式）
      const chart = echarts.init(null, theme === "dark" ? "dark" : null, {
        renderer: "svg",
        ssr: true,
        width,
        height,
      });

      // 构建 ECharts option
      const option = this.buildOption(data, { showLegend, showTitle, theme });
      chart.setOption(option);

      // 渲染 SVG
      const svgStr = chart.renderToSVGString();

      // 清理
      chart.dispose();

      this.logger.log(
        `[renderToSvg] Rendered ${data.type} chart, size: ${width}x${height}`,
      );

      return svgStr;
    } catch (error) {
      this.logger.error(`[renderToSvg] Failed to render chart: ${error}`);
      return this.renderFallbackSvg(data, width, height);
    }
  }

  /**
   * 智能推断图表类型
   * 根据数据特性自动选择最合适的图表类型，防止 AI 选错
   */
  inferChartType(
    labels: string[],
    requestedType: ChartData["type"],
  ): ChartData["type"] {
    // 检测是否为时间序列数据
    const timePatterns = [
      /^\d{4}年?$/,
      /^Q[1-4]$/i,
      /^[一二三四]季度$/,
      /^\d{1,2}月$/,
      /^20\d{2}/,
      /第[一二三四五六七八九十]+阶段/,
    ];

    const isTimeSeries = labels.every((label) =>
      timePatterns.some((pattern) => pattern.test(label)),
    );

    // 检测是否为分类数据（不同类别的对比）
    const categoryPatterns = [
      /人口$/,
      /面积$/,
      /数量$/,
      /规模$/,
      /产品[A-Z]?$/,
      /部门$/,
      /区域$/,
      /市区/,
      /首都/,
      /城市/,
    ];

    const isCategoryData =
      labels.length <= 6 &&
      !isTimeSeries &&
      labels.some((label) =>
        categoryPatterns.some((pattern) => pattern.test(label)),
      );

    // 检测是否为占比数据
    const isPercentageData =
      labels.some((l) => l.includes("占比") || l.includes("比例")) ||
      requestedType === "pie";

    // 智能修正
    if (isCategoryData && requestedType === "line") {
      this.logger.warn(
        `[inferChartType] 检测到分类数据但请求了折线图，自动修正为柱状图。Labels: ${labels.join(", ")}`,
      );
      return "bar";
    }

    if (isTimeSeries && requestedType === "bar") {
      this.logger.log(
        `[inferChartType] 检测到时间序列数据，建议使用折线图。Labels: ${labels.join(", ")}`,
      );
      return "line";
    }

    if (isPercentageData && requestedType !== "pie") {
      this.logger.log(
        `[inferChartType] 检测到占比数据，建议使用饼图。Labels: ${labels.join(", ")}`,
      );
      return "pie";
    }

    return requestedType;
  }

  /**
   * 从 ContentSection 提取图表数据
   */
  extractChartData(
    sections: ContentSection[],
    chartType: ChartData["type"] = "bar",
  ): ChartData | null {
    // 查找包含统计数据的 sections
    const statSections = sections.filter(
      (s) => s.type === "stat" && this.isStatContent(s.content),
    );

    if (statSections.length === 0) {
      // 尝试从 list 类型提取
      const listSection = sections.find(
        (s) => s.type === "list" && Array.isArray(s.content),
      );
      if (listSection && Array.isArray(listSection.content)) {
        return this.extractFromList(listSection.content, chartType);
      }
      return null;
    }

    // 从统计数据构建图表数据
    const labels: string[] = [];
    const values: number[] = [];

    statSections.forEach((section) => {
      const stat = section.content as StatContent;
      labels.push(stat.label);
      // 尝试提取数值
      const numValue = this.parseNumber(stat.value);
      values.push(numValue);
    });

    // 智能推断并修正图表类型
    const inferredType = this.inferChartType(labels, chartType);

    return {
      type: inferredType,
      labels,
      datasets: [
        {
          label: "数据",
          data: values,
        },
      ],
    };
  }

  /**
   * 生成示例图表数据（用于演示）
   */
  generateSampleData(type: ChartData["type"], _topic?: string): ChartData {
    const templates = {
      line: {
        labels: ["Q1", "Q2", "Q3", "Q4"],
        datasets: [
          { label: "本年", data: [120, 150, 180, 220] },
          { label: "去年", data: [100, 110, 140, 160] },
        ],
      },
      bar: {
        labels: ["产品A", "产品B", "产品C", "产品D"],
        datasets: [{ label: "销售额", data: [320, 280, 240, 200] }],
      },
      pie: {
        labels: ["技术", "市场", "运营", "其他"],
        datasets: [{ label: "占比", data: [35, 30, 25, 10] }],
      },
      radar: {
        labels: ["技术能力", "市场份额", "用户满意度", "创新力", "成本控制"],
        datasets: [
          { label: "当前", data: [80, 70, 85, 60, 75] },
          { label: "目标", data: [90, 85, 90, 80, 85] },
        ],
      },
    };

    const data = templates[type] || templates.bar;
    return { type, ...data };
  }

  /**
   * 构建 ECharts option
   */
  private buildOption(
    data: ChartData,
    config: {
      showLegend: boolean;
      showTitle: boolean;
      theme: "dark" | "light";
    },
  ): echarts.EChartsOption {
    const { type, labels, datasets, title } = data;
    const { showLegend, showTitle, theme } = config;

    const textColor = theme === "dark" ? "#94A3B8" : "#475569";
    const backgroundColor = "transparent";

    const baseOption: echarts.EChartsOption = {
      backgroundColor,
      title:
        showTitle && title
          ? {
              text: title,
              left: "center",
              textStyle: { color: textColor, fontSize: 16 },
            }
          : undefined,
      legend: showLegend
        ? {
            bottom: 10,
            textStyle: { color: textColor, fontSize: 12 },
          }
        : undefined,
      grid: {
        left: "10%",
        right: "10%",
        top: showTitle ? 60 : 30,
        bottom: showLegend ? 60 : 30,
      },
    };

    switch (type) {
      case "line":
        return {
          ...baseOption,
          xAxis: {
            type: "category",
            data: labels,
            axisLine: { lineStyle: { color: textColor } },
            axisLabel: { color: textColor },
          },
          yAxis: {
            type: "value",
            axisLine: { lineStyle: { color: textColor } },
            axisLabel: { color: textColor },
            splitLine: {
              lineStyle: { color: theme === "dark" ? "#334155" : "#E2E8F0" },
            },
          },
          series: datasets.map((ds, idx) => ({
            name: ds.label,
            type: "line",
            data: ds.data,
            smooth: true,
            lineStyle: {
              color: ds.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
            },
            itemStyle: {
              color: ds.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
            },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                {
                  offset: 0,
                  color:
                    (ds.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]) +
                    "40",
                },
                {
                  offset: 1,
                  color:
                    (ds.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]) +
                    "00",
                },
              ]),
            },
          })),
        };

      case "bar":
        return {
          ...baseOption,
          xAxis: {
            type: "category",
            data: labels,
            axisLine: { lineStyle: { color: textColor } },
            axisLabel: { color: textColor },
          },
          yAxis: {
            type: "value",
            axisLine: { lineStyle: { color: textColor } },
            axisLabel: { color: textColor },
            splitLine: {
              lineStyle: { color: theme === "dark" ? "#334155" : "#E2E8F0" },
            },
          },
          series: datasets.map((ds, idx) => ({
            name: ds.label,
            type: "bar",
            data: ds.data,
            barWidth: "40%",
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                {
                  offset: 0,
                  color:
                    ds.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
                },
                {
                  offset: 1,
                  color:
                    (ds.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]) +
                    "80",
                },
              ]),
              borderRadius: [4, 4, 0, 0],
            },
          })),
        };

      case "pie":
        return {
          ...baseOption,
          series: [
            {
              type: "pie",
              radius: ["40%", "70%"],
              center: ["50%", "50%"],
              data: labels.map((label, idx) => ({
                name: label,
                value: datasets[0]?.data[idx] || 0,
                itemStyle: {
                  color: DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
                },
              })),
              label: {
                color: textColor,
                fontSize: 12,
              },
              emphasis: {
                label: { fontSize: 14, fontWeight: "bold" },
              },
            },
          ],
        };

      case "radar":
        return {
          ...baseOption,
          radar: {
            indicator: labels.map((label) => ({ name: label, max: 100 })),
            axisLine: { lineStyle: { color: textColor } },
            splitLine: {
              lineStyle: { color: theme === "dark" ? "#334155" : "#E2E8F0" },
            },
            axisName: { color: textColor, fontSize: 11 },
          },
          series: [
            {
              type: "radar",
              data: datasets.map((ds, idx) => ({
                name: ds.label,
                value: ds.data,
                lineStyle: {
                  color:
                    ds.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
                },
                itemStyle: {
                  color:
                    ds.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
                },
                areaStyle: {
                  color:
                    (ds.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]) +
                    "30",
                },
              })),
            },
          ],
        };

      default:
        return baseOption;
    }
  }

  /**
   * 降级渲染：生成简单的占位 SVG
   */
  private renderFallbackSvg(
    data: ChartData,
    width: number,
    height: number,
  ): string {
    const { type, labels } = data;
    const typeNames = {
      line: "折线图",
      bar: "柱状图",
      pie: "饼图",
      radar: "雷达图",
    };
    const typeName = typeNames[type] || "图表";

    return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#1E293B" rx="8"/>
  <text x="50%" y="45%" text-anchor="middle" fill="#94A3B8" font-size="16">${typeName}</text>
  <text x="50%" y="55%" text-anchor="middle" fill="#64748B" font-size="12">${labels.slice(0, 4).join(" | ")}</text>
</svg>
    `.trim();
  }

  /**
   * 从列表内容提取图表数据
   */
  private extractFromList(
    items: string[],
    chartType: ChartData["type"],
  ): ChartData | null {
    const labels: string[] = [];
    const values: number[] = [];

    items.forEach((item) => {
      // 尝试提取 "xxx: 123" 或 "xxx 123%" 格式
      const match = item.match(/^(.+?)[:：\s]+(\d+(?:\.\d+)?%?)$/);
      if (match) {
        labels.push(match[1].trim());
        values.push(this.parseNumber(match[2]));
      } else {
        labels.push(item.slice(0, 20));
        values.push(Math.floor(Math.random() * 50) + 50); // 随机值作为占位
      }
    });

    if (labels.length === 0) return null;

    return {
      type: chartType,
      labels,
      datasets: [{ label: "数据", data: values }],
    };
  }

  /**
   * 解析数值字符串
   */
  private parseNumber(value: string): number {
    const cleaned = value.replace(/[%,，\s]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * 检查是否为 StatContent
   */
  private isStatContent(content: unknown): content is StatContent {
    return (
      typeof content === "object" &&
      content !== null &&
      "value" in content &&
      "label" in content
    );
  }

  /**
   * 规范化输入格式
   * 支持直接调用格式和 MissionOrchestrator 格式
   */
  private normalizeInput(
    input: ChartRendererInput | OrchestratorInput,
  ): ChartRendererInput {
    // 检查是否是直接调用格式（有 data 属性）
    if ("data" in input && input.data && typeof input.data === "object") {
      return input;
    }

    // 处理 Orchestrator 格式
    const orchestratorInput = input as OrchestratorInput;
    const missionInput = orchestratorInput.context?.input;

    if (missionInput?.data) {
      return {
        data: missionInput.data,
        options: missionInput.options,
      };
    }

    // 尝试从 context 的其他位置获取 data
    const context = orchestratorInput.context;
    if (context) {
      // 检查 context 是否直接有 data
      if (
        typeof (context as Record<string, unknown>).data === "object" &&
        (context as Record<string, unknown>).data !== null
      ) {
        return {
          data: (context as Record<string, unknown>).data as ChartData,
          options: (context as Record<string, unknown>)
            .options as ChartRenderOptions,
        };
      }
    }

    // 返回空输入，让调用者处理错误
    this.logger.warn(
      `[normalizeInput] Could not extract chart data from input: ${JSON.stringify(Object.keys(input))}`,
    );
    return { data: undefined as unknown as ChartData };
  }
}
