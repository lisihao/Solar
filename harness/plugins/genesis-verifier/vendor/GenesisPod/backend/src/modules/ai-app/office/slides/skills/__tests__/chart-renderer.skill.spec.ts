/**
 * Unit tests for ChartRendererSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ChartRendererSkill, ChartData } from "../chart-renderer.skill";

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-chart-renderer",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
  metadata: {},
});

const buildBarChart = (): ChartData => ({
  type: "bar",
  title: "Revenue",
  labels: ["Q1", "Q2", "Q3", "Q4"],
  datasets: [{ label: "2024", data: [100, 150, 130, 180] }],
});

const buildLineChart = (): ChartData => ({
  type: "line",
  labels: ["Jan", "Feb", "Mar"],
  datasets: [{ label: "Growth", data: [10, 20, 15] }],
});

const buildPieChart = (): ChartData => ({
  type: "pie",
  labels: ["Tech", "Market", "Ops"],
  datasets: [{ label: "Share", data: [40, 35, 25] }],
});

const buildRadarChart = (): ChartData => ({
  type: "radar",
  labels: ["Speed", "Quality", "Cost"],
  datasets: [{ label: "Score", data: [80, 90, 70] }],
});

describe("ChartRendererSkill", () => {
  let skill: ChartRendererSkill;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChartRendererSkill],
    }).compile();

    skill = module.get<ChartRendererSkill>(ChartRendererSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-chart-renderer");
    expect(skill.name).toBe("图表渲染");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("4.0.0");
  });

  it("should return error when chart data is missing", async () => {
    const result = await skill.execute({} as any, buildSkillContext());
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
  });

  it("should render a bar chart as SVG", async () => {
    const result = await skill.execute(
      { data: buildBarChart() },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.svgString).toBeDefined();
    expect(result.data!.type).toBe("bar");
    expect(result.data!.width).toBe(600);
    expect(result.data!.height).toBe(400);
  });

  it("should render a line chart", async () => {
    const result = await skill.execute(
      { data: buildLineChart() },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.type).toBe("line");
  });

  it("should render a pie chart", async () => {
    const result = await skill.execute(
      { data: buildPieChart() },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.type).toBe("pie");
  });

  it("should render a radar chart", async () => {
    const result = await skill.execute(
      { data: buildRadarChart() },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.type).toBe("radar");
  });

  it("should respect custom width and height options", async () => {
    const result = await skill.execute(
      { data: buildBarChart(), options: { width: 800, height: 500 } },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.width).toBe(800);
    expect(result.data!.height).toBe(500);
  });

  it("should infer line chart for time series data labeled with bar", () => {
    const labels = ["2020", "2021", "2022", "2023"];
    const inferred = skill.inferChartType(labels, "bar");
    expect(inferred).toBe("line");
  });

  it("should infer bar chart for categorical data labeled with line", () => {
    const labels = ["北京市区", "上海市区", "广州市区"];
    const inferred = skill.inferChartType(labels, "line");
    expect(inferred).toBe("bar");
  });

  it("should keep requested type when no correction needed", () => {
    const labels = ["Category A", "Category B"];
    const inferred = skill.inferChartType(labels, "bar");
    expect(inferred).toBe("bar");
  });

  it("should generate sample data for each chart type", () => {
    const types: ChartData["type"][] = ["line", "bar", "pie", "radar"];
    for (const type of types) {
      const data = skill.generateSampleData(type);
      expect(data.type).toBe(type);
      expect(data.labels.length).toBeGreaterThan(0);
      expect(data.datasets.length).toBeGreaterThan(0);
    }
  });

  it("should extract chart data from stat sections", () => {
    const sections = [
      {
        type: "stat" as const,
        position: "left" as const,
        content: { value: "85%", label: "Market Share" },
      },
      {
        type: "stat" as const,
        position: "left" as const,
        content: { value: "120", label: "Revenue" },
      },
    ];

    const chartData = skill.extractChartData(sections, "bar");
    expect(chartData).not.toBeNull();
    expect(chartData!.labels).toContain("Market Share");
    expect(chartData!.datasets[0].data).toHaveLength(2);
  });

  it("should return null when no stat or list sections found", () => {
    const sections = [
      {
        type: "text" as const,
        position: "full" as const,
        content: "Some text",
      },
    ];

    const chartData = skill.extractChartData(sections, "bar");
    expect(chartData).toBeNull();
  });

  it("should handle Orchestrator input format", async () => {
    const orchestratorInput = {
      task: "render chart",
      context: {
        input: {
          data: buildBarChart(),
        },
      },
    };

    const result = await skill.execute(
      orchestratorInput as any,
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.type).toBe("bar");
  });
});
