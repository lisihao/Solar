/**
 * ECharts Generator 单元测试
 */

import {
  generateBarChart,
  generateLineChart,
  generatePieChart,
  generateRadarChart,
  generateEChartsConfig,
  generateEChartsHTML,
  dataPointToChartContent,
  getThemeColorsExport,
  getChartPaletteExport,
  GENSPARK_COLORS,
} from "../echarts-generator";

// ==================== 测试数据 ====================

const sampleData = [
  { name: "类别A", value: 100 },
  { name: "类别B", value: 200 },
  { name: "类别C", value: 150 },
];

// ==================== getThemeColorsExport ====================

describe("getThemeColorsExport", () => {
  it("should return dark theme colors", () => {
    const colors = getThemeColorsExport("dark");
    expect(colors.primary).toBe("#D4AF37");
    expect(colors.background).toBe("transparent");
  });

  it("should return light theme colors", () => {
    const colors = getThemeColorsExport("light");
    expect(colors.primary).toBe("#B8860B"); // Darker gold for light theme
  });

  it("should have GENSPARK_COLORS as dark theme legacy export", () => {
    expect(GENSPARK_COLORS).toBe(getThemeColorsExport("dark"));
  });
});

// ==================== getChartPaletteExport ====================

describe("getChartPaletteExport", () => {
  it("should return dark palette with 8 colors", () => {
    const palette = getChartPaletteExport("dark");
    expect(palette).toHaveLength(8);
    expect(palette[0]).toBe("#D4AF37");
  });

  it("should return light palette", () => {
    const palette = getChartPaletteExport("light");
    expect(palette).toHaveLength(8);
    expect(palette[0]).toBe("#B8860B");
  });
});

// ==================== generateBarChart ====================

describe("generateBarChart", () => {
  it("should generate vertical bar chart (dark theme)", () => {
    const config = generateBarChart(sampleData, "测试柱状图");
    expect(config.series).toHaveLength(1);
    expect((config.series[0] as Record<string, unknown>).type).toBe("bar");
    expect(config.title?.text).toBe("测试柱状图");
  });

  it("should generate horizontal bar chart", () => {
    const config = generateBarChart(sampleData, undefined, true);
    // horizontal: xAxis is valueAxis, yAxis is categoryAxis
    expect((config.xAxis as Record<string, unknown>)?.type).toBe("value");
    expect((config.yAxis as Record<string, unknown>)?.type).toBe("category");
  });

  it("should generate without title when not provided", () => {
    const config = generateBarChart(sampleData);
    expect(config.title).toBeUndefined();
  });

  it("should use light theme colors", () => {
    const config = generateBarChart(sampleData, "标题", false, "light");
    const lightColors = getThemeColorsExport("light");
    expect(config.textStyle.color).toBe(lightColors.textPrimary);
  });

  it("should include grid with containLabel", () => {
    const config = generateBarChart(sampleData);
    expect(config.grid?.containLabel).toBe(true);
  });

  it("should adjust grid top based on title presence", () => {
    const withTitle = generateBarChart(sampleData, "标题");
    const withoutTitle = generateBarChart(sampleData);
    expect(withTitle.grid?.top).toBeGreaterThan(withoutTitle.grid?.top ?? 0);
  });

  it("should map data values correctly", () => {
    const config = generateBarChart(sampleData);
    const seriesData = (config.series[0] as Record<string, unknown>)
      .data as unknown[];
    expect(seriesData).toHaveLength(sampleData.length);
  });
});

// ==================== generateLineChart ====================

describe("generateLineChart", () => {
  it("should generate line chart", () => {
    const config = generateLineChart(sampleData, "折线图");
    expect((config.series[0] as Record<string, unknown>).type).toBe("line");
    expect(config.title?.text).toBe("折线图");
  });

  it("should include area style when showArea=true", () => {
    const config = generateLineChart(sampleData, undefined, true);
    const series = config.series[0] as Record<string, unknown>;
    expect(series.areaStyle).toBeDefined();
  });

  it("should not include area style when showArea=false", () => {
    const config = generateLineChart(sampleData, undefined, false);
    const series = config.series[0] as Record<string, unknown>;
    expect(series.areaStyle).toBeUndefined();
  });

  it("should use light theme", () => {
    const config = generateLineChart(sampleData, undefined, true, "light");
    const lightColors = getThemeColorsExport("light");
    const series = config.series[0] as Record<string, unknown>;
    expect((series.lineStyle as Record<string, unknown>).color).toBe(
      lightColors.primary,
    );
  });
});

// ==================== generatePieChart ====================

describe("generatePieChart", () => {
  it("should generate donut pie chart by default", () => {
    const config = generatePieChart(sampleData, "饼图");
    const series = config.series[0] as Record<string, unknown>;
    expect(series.type).toBe("pie");
    expect(series.radius).toEqual(["40%", "70%"]); // donut
  });

  it("should generate solid pie chart when donut=false", () => {
    const config = generatePieChart(sampleData, undefined, false);
    const series = config.series[0] as Record<string, unknown>;
    expect(series.radius).toBe("70%"); // solid
  });

  it("should include legend", () => {
    const config = generatePieChart(sampleData);
    expect(config.legend).toBeDefined();
  });

  it("should use light theme", () => {
    const config = generatePieChart(sampleData, undefined, true, "light");
    const lightColors = getThemeColorsExport("light");
    expect(config.textStyle.color).toBe(lightColors.textPrimary);
  });
});

// ==================== generateRadarChart ====================

describe("generateRadarChart", () => {
  it("should generate radar chart", () => {
    const config = generateRadarChart(sampleData, "雷达图");
    expect((config.series[0] as Record<string, unknown>).type).toBe("radar");
    expect(config.title?.text).toBe("雷达图");
  });

  it("should set indicator maxValue", () => {
    const config = generateRadarChart(sampleData, undefined, 200);
    const radar = config.radar as Record<string, unknown>;
    const indicators = radar.indicator as { name: string; max: number }[];
    expect(indicators[0].max).toBe(200);
  });

  it("should use light theme split area colors", () => {
    const config = generateRadarChart(sampleData, undefined, 100, "light");
    const radar = config.radar as Record<string, unknown>;
    expect(radar.splitArea).toBeDefined();
  });

  it("should map data to indicator names", () => {
    const config = generateRadarChart(sampleData);
    const radar = config.radar as Record<string, unknown>;
    const indicators = radar.indicator as { name: string }[];
    expect(indicators[0].name).toBe("类别A");
    expect(indicators[1].name).toBe("类别B");
  });
});

// ==================== generateEChartsConfig ====================

describe("generateEChartsConfig", () => {
  it("should dispatch bar chart type", () => {
    const config = generateEChartsConfig({
      type: "bar",
      data: sampleData,
      title: "柱状图",
    });
    expect((config.series[0] as Record<string, unknown>).type).toBe("bar");
  });

  it("should dispatch line chart type", () => {
    const config = generateEChartsConfig({ type: "line", data: sampleData });
    expect((config.series[0] as Record<string, unknown>).type).toBe("line");
  });

  it("should dispatch pie chart type", () => {
    const config = generateEChartsConfig({ type: "pie", data: sampleData });
    expect((config.series[0] as Record<string, unknown>).type).toBe("pie");
  });

  it("should dispatch radar chart type", () => {
    const config = generateEChartsConfig({ type: "radar", data: sampleData });
    expect((config.series[0] as Record<string, unknown>).type).toBe("radar");
  });

  it("should default to bar chart for unknown type", () => {
    const config = generateEChartsConfig({
      type: "unknown" as "bar",
      data: sampleData,
    });
    expect((config.series[0] as Record<string, unknown>).type).toBe("bar");
  });

  it("should coerce data name and value", () => {
    const rawData = [{ name: 123, value: "456" }] as unknown as {
      name: string;
      value: number;
    }[];
    const config = generateEChartsConfig({ type: "bar", data: rawData });
    expect(config.series).toBeDefined();
  });

  it("should use specified theme", () => {
    const darkConfig = generateEChartsConfig(
      { type: "bar", data: sampleData },
      "dark",
    );
    const lightConfig = generateEChartsConfig(
      { type: "bar", data: sampleData },
      "light",
    );
    expect(darkConfig.textStyle.color).not.toBe(lightConfig.textStyle.color);
  });
});

// ==================== generateEChartsHTML ====================

describe("generateEChartsHTML", () => {
  it("should generate HTML with chart div and script", () => {
    const html = generateEChartsHTML(
      { type: "bar", data: sampleData },
      "chart-001",
    );
    expect(html).toContain('id="chart-001"');
    expect(html).toContain("<script>");
    expect(html).toContain("echarts.init");
    expect(html).toContain("chart-001");
  });

  it("should include custom width and height", () => {
    const html = generateEChartsHTML(
      { type: "bar", data: sampleData },
      "chart-002",
      800,
      400,
    );
    expect(html).toContain("width: 800px");
    expect(html).toContain("height: 400px");
  });

  it("should include chart config JSON in script", () => {
    const html = generateEChartsHTML(
      { type: "pie", data: sampleData },
      "chart-003",
    );
    expect(html).toContain("setOption");
  });
});

// ==================== dataPointToChartContent ====================

describe("dataPointToChartContent", () => {
  it("should return null when no relatedData", () => {
    const dp = { name: "数据点", value: 100, context: "上下文" };
    expect(dataPointToChartContent(dp)).toBeNull();
  });

  it("should return null when relatedData is empty", () => {
    const dp = {
      name: "数据点",
      value: 100,
      context: "上下文",
      relatedData: [],
    };
    expect(dataPointToChartContent(dp)).toBeNull();
  });

  it("should convert data point to chart content", () => {
    const dp = {
      name: "数据点",
      value: 100,
      context: "图表标题",
      relatedData: [{ name: "A", value: 10 }],
      chartType: "pie",
    };
    const result = dataPointToChartContent(dp);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("pie");
    expect(result!.title).toBe("图表标题");
    expect(result!.data).toEqual([{ name: "A", value: 10 }]);
  });

  it("should default to bar chart when no chartType", () => {
    const dp = {
      name: "数据点",
      value: 100,
      context: "上下文",
      relatedData: [{ name: "A", value: 10 }],
    };
    const result = dataPointToChartContent(dp);
    expect(result!.type).toBe("bar");
  });
});
