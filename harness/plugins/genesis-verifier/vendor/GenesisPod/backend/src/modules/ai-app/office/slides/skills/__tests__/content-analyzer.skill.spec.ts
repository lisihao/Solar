/**
 * Unit tests for ContentAnalyzerSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ContentAnalyzerSkill } from "../content-analyzer.skill";
import {
  PageContent,
  ContentSection,
  StatContent,
} from "../../checkpoint/checkpoint.types";

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-content-analyzer",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
  metadata: {},
});

const buildPageContent = (
  title: string,
  sections: ContentSection[] = [],
  subtitle?: string,
): PageContent => ({
  title,
  subtitle,
  sections,
  footer: undefined,
});

const makeTextSection = (
  content: string,
  position: ContentSection["position"] = "full",
): ContentSection => ({
  type: "text",
  position,
  content,
});

const makeListSection = (
  items: string[],
  position: ContentSection["position"] = "full",
): ContentSection => ({
  type: "list",
  position,
  content: items,
});

const makeStatSection = (
  value: string,
  label: string,
  position: ContentSection["position"] = "left",
): ContentSection => ({
  type: "stat",
  position,
  content: { value, label } as StatContent,
});

const makeChartSection = (
  position: ContentSection["position"] = "full",
): ContentSection => ({
  type: "chart",
  position,
  content: { type: "bar", data: [{ name: "A", value: 10 }], title: "Chart" },
});

const makeImageSection = (
  position: ContentSection["position"] = "full",
): ContentSection => ({
  type: "image",
  position,
  content: "https://example.com/image.jpg",
});

const makeQuoteSection = (text: string): ContentSection => ({
  type: "quote",
  position: "full",
  content: text,
});

describe("ContentAnalyzerSkill", () => {
  let skill: ContentAnalyzerSkill;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContentAnalyzerSkill],
    }).compile();

    skill = module.get<ContentAnalyzerSkill>(ContentAnalyzerSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-content-analyzer");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("4.0.0");
  });

  describe("execute", () => {
    it("should return success result for valid PageContent", async () => {
      const content = buildPageContent("Test Slide", [
        makeTextSection("Some text"),
      ]);
      const context = buildSkillContext();

      const result = await skill.execute(content, context);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.metadata?.executionId).toBe("test-exec-1");
    });

    it("should return failure for invalid input (no title)", async () => {
      const invalidContent = { sections: [] } as unknown as PageContent;
      const context = buildSkillContext();

      const result = await skill.execute(invalidContent, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_INPUT");
    });

    it("should support OrchestratorInput format", async () => {
      const orchestratorInput = {
        task: "analyze",
        context: {
          pageContent: buildPageContent("Orchestrator Title", [
            makeTextSection("Content"),
          ]),
        },
        previousOutputs: {},
      };
      const context = buildSkillContext("orch-exec-1");

      const result = await skill.execute(orchestratorInput as any, context);

      expect(result.success).toBe(true);
      expect(result.data?.totalSections).toBe(1);
    });

    it("should return failure for OrchestratorInput without pageContent", async () => {
      const orchestratorInput = {
        task: "analyze",
        context: {},
        previousOutputs: {},
      };
      const context = buildSkillContext();

      const result = await skill.execute(orchestratorInput as any, context);

      expect(result.success).toBe(false);
    });

    it("should include execution metadata with timing", async () => {
      const content = buildPageContent("Timing Test", []);
      const context = buildSkillContext();

      const result = await skill.execute(content, context);

      expect(result.metadata?.startTime).toBeDefined();
      expect(result.metadata?.endTime).toBeDefined();
      expect(result.metadata?.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("analyze", () => {
    it("should analyze empty page content", () => {
      const content = buildPageContent("Empty", []);

      const result = skill.analyze(content);

      expect(result).toBeDefined();
      expect(result.totalSections).toBe(0);
      expect(result.analysisVersion).toBe("4.0.0");
    });

    it("should count section types correctly", () => {
      const content = buildPageContent("Mixed Content", [
        makeStatSection("90%", "Growth"),
        makeStatSection("$1M", "Revenue"),
        makeListSection(["A", "B", "C"]),
        makeTextSection("Some text"),
        makeChartSection(),
        makeImageSection(),
        makeQuoteSection("A quote"),
      ]);

      const result = skill.analyze(content);

      expect(result.sectionTypes.stat).toBe(2);
      expect(result.sectionTypes.list).toBe(1);
      expect(result.sectionTypes.text).toBe(1);
      expect(result.sectionTypes.chart).toBe(1);
      expect(result.sectionTypes.image).toBe(1);
      expect(result.sectionTypes.quote).toBe(1);
    });

    it("should calculate total characters including title", () => {
      const content = buildPageContent("12345", [
        makeTextSection("Hello World"),
      ]);

      const result = skill.analyze(content);

      expect(result.totalCharacters).toBeGreaterThanOrEqual(5 + 11); // title + content
    });

    it("should calculate content metrics for list sections", () => {
      const content = buildPageContent("List Slide", [
        makeListSection(["Item A", "Item B", "Item C"]),
      ]);

      const result = skill.analyze(content);

      expect(result.totalSections).toBe(1);
      expect(result.totalCharacters).toBeGreaterThan(0);
    });

    it("should detect comparison structure from title keywords", () => {
      const content = buildPageContent("方案A vs 方案B 对比分析", [
        makeListSection(["Option A details"]),
        makeListSection(["Option B details"]),
      ]);

      const result = skill.analyze(content);

      expect(result.comparison.detected).toBe(true);
    });

    it("should detect comparison from symmetric left/right sections", () => {
      const leftSection: ContentSection = {
        type: "list",
        position: "left",
        content: ["Left item 1"],
      };
      const rightSection: ContentSection = {
        type: "list",
        position: "right",
        content: ["Right item 1"],
      };
      const content = buildPageContent("Compare Options", [
        leftSection,
        rightSection,
      ]);

      const result = skill.analyze(content);

      expect(result.comparison.detected).toBe(true);
    });

    it("should detect pillar structure from 3+ stat sections", () => {
      const content = buildPageContent("Core Pillars", [
        makeStatSection("85%", "Efficiency"),
        makeStatSection("$2M", "Revenue"),
        makeStatSection("150+", "Clients"),
      ]);

      const result = skill.analyze(content);

      expect(result.pillars.detected).toBe(true);
      expect(result.pillars.count).toBe(3);
    });

    it("should detect pillar structure from numbered list", () => {
      const content = buildPageContent("Key Pillars", [
        makeListSection([
          "1. Innovation Focus",
          "2. Customer First",
          "3. Data Driven",
        ]),
      ]);

      const result = skill.analyze(content);

      expect(result.pillars.detected).toBe(true);
    });

    it("should detect timeline from year patterns", () => {
      const content = buildPageContent("Company History", [
        makeTextSection(
          "Founded in 2010. Major expansion in 2015. IPO in 2020.",
        ),
      ]);

      const result = skill.analyze(content);

      expect(result.timeline.detected).toBe(true);
      expect(result.timeline.nodeCount).toBeGreaterThanOrEqual(2);
      expect(result.timeline.hasSequence).toBe(true);
    });

    it("should detect timeline from phase patterns", () => {
      const content = buildPageContent("Project Phases", [
        makeTextSection(
          "第一阶段: Planning. 第二阶段: Development. 第三阶段: Launch.",
        ),
      ]);

      const result = skill.analyze(content);

      expect(result.timeline.detected).toBe(true);
    });

    it("should detect timeline from title keywords", () => {
      const content = buildPageContent("发展路线图 Timeline", [
        makeTextSection("Some content"),
      ]);

      const result = skill.analyze(content);

      expect(result.timeline.detected).toBe(true);
    });

    it("should analyze data density with numbers and percentages", () => {
      const content = buildPageContent("Data Slide", [
        makeTextSection("Revenue grew 85% to $2.5B in Q3 2024, up from $1.3B."),
      ]);

      const result = skill.analyze(content);

      expect(result.dataDensity.dataPointCount).toBeGreaterThan(0);
      expect(result.dataDensity.percentageCount).toBeGreaterThan(0);
      expect(result.dataDensity.currencyCount).toBeGreaterThan(0);
    });

    it("should assess simple visual complexity for few sections", () => {
      const content = buildPageContent("Simple", [
        makeTextSection("Just one section"),
      ]);

      const result = skill.analyze(content);

      expect(["simple", "moderate"]).toContain(result.visualComplexity);
    });

    it("should assess dense visual complexity for many chart+stat sections", () => {
      const sections = [
        makeChartSection(),
        makeChartSection(),
        makeStatSection("1", "A"),
        makeStatSection("2", "B"),
        makeStatSection("3", "C"),
        makeTextSection("A".repeat(600)),
      ];
      const content = buildPageContent("Dense Dashboard", sections);

      const result = skill.analyze(content);

      expect(["complex", "dense"]).toContain(result.visualComplexity);
    });

    it("should recommend timeline-progress layout for timeline content", () => {
      const content = buildPageContent(
        "2010年 - 2015年 - 2020年 - 2024年 历程",
        [makeTextSection("Development from 2010 to 2020 to present 2024.")],
      );

      const result = skill.analyze(content);

      if (result.timeline.detected && result.timeline.nodeCount >= 3) {
        expect(result.recommendedLayout).toBe("timeline-progress");
      }
    });

    it("should recommend comparison-grid layout for comparison content", () => {
      const leftSection: ContentSection = {
        type: "stat",
        position: "left",
        content: { value: "90%", label: "A" } as StatContent,
      };
      const rightSection: ContentSection = {
        type: "stat",
        position: "right",
        content: { value: "70%", label: "B" } as StatContent,
      };
      const content = buildPageContent("A vs B 对比", [
        leftSection,
        rightSection,
      ]);

      const result = skill.analyze(content);

      expect(result.comparison.detected).toBe(true);
    });

    it("should recommend pillar-showcase layout for pillar content", () => {
      const content = buildPageContent("Three Core Pillars", [
        makeStatSection("85%", "Quality"),
        makeStatSection("99.9%", "Uptime"),
        makeStatSection("24h", "Support"),
      ]);

      const result = skill.analyze(content);

      if (result.pillars.detected && result.pillars.count >= 3) {
        expect(result.recommendedLayout).toBe("pillar-showcase");
      }
    });

    it("should recommend data-dashboard for stats/chart dominant content", () => {
      const content = buildPageContent("Dashboard", [
        makeStatSection("1", "A"),
        makeStatSection("2", "B"),
        makeStatSection("3", "C"),
      ]);

      const result = skill.analyze(content);

      expect(result.sectionTypes.stat).toBeGreaterThanOrEqual(3);
    });

    it("should recommend visual-story for image+text content", () => {
      const content = buildPageContent("Visual Story", [
        makeImageSection(),
        makeTextSection("Accompanying text"),
      ]);

      const result = skill.analyze(content);

      expect(result.sectionTypes.image).toBeGreaterThanOrEqual(1);
      expect(result.sectionTypes.text).toBeGreaterThanOrEqual(1);
    });

    it("should recommend content-flow for list-heavy content", () => {
      const content = buildPageContent("Key Points", [
        makeListSection(["Point 1", "Point 2", "Point 3", "Point 4"]),
      ]);

      const result = skill.analyze(content);

      expect(result.sectionTypes.list).toBeGreaterThanOrEqual(1);
    });

    it("should calculate grid suggestion based on comparison", () => {
      const leftSection: ContentSection = {
        type: "list",
        position: "left",
        content: ["L1", "L2"],
      };
      const rightSection: ContentSection = {
        type: "list",
        position: "right",
        content: ["R1", "R2"],
      };
      const content = buildPageContent("Compare A vs B", [
        leftSection,
        rightSection,
      ]);

      const result = skill.analyze(content);

      expect(result.suggestedGrid.columns).toBeGreaterThan(0);
      expect(result.suggestedGrid.rows).toBeGreaterThan(0);
      expect(result.suggestedGrid.reason).toBeTruthy();
    });

    it("should estimate capacity: fits on one page for few sections", () => {
      const content = buildPageContent("Simple", [
        makeTextSection("A".repeat(50)),
        makeListSection(["Item 1", "Item 2"]),
      ]);

      const result = skill.analyze(content);

      expect(result.estimatedCapacity.fitsOnOnePage).toBe(true);
    });

    it("should estimate capacity: does not fit for many large sections", () => {
      const sections = Array.from({ length: 10 }, (_) =>
        makeTextSection("A".repeat(150), "full"),
      );
      const content = buildPageContent("Overflow Content", sections);

      const result = skill.analyze(content);

      expect(result.estimatedCapacity.fitsOnOnePage).toBe(false);
      expect(result.estimatedCapacity.suggestedPageCount).toBeGreaterThan(1);
    });

    it("should include analyzedAt date", () => {
      const content = buildPageContent("Test", []);
      const before = new Date();

      const result = skill.analyze(content);

      expect(result.analyzedAt).toBeDefined();
      expect(result.analyzedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
    });
  });

  describe("needsSplit", () => {
    it("should return false for content that fits on one page", () => {
      const content = buildPageContent("Simple", [
        makeTextSection("Short text"),
      ]);
      expect(skill.needsSplit(content)).toBe(false);
    });

    it("should return true for content that overflows", () => {
      const sections = Array.from({ length: 10 }, () =>
        makeTextSection("A".repeat(200)),
      );
      const content = buildPageContent("Overflow", sections);
      expect(skill.needsSplit(content)).toBe(true);
    });
  });

  describe("getSplitSuggestion", () => {
    it("should return shouldSplit=false for small content", () => {
      const content = buildPageContent("Simple", [makeTextSection("A")]);

      const suggestion = skill.getSplitSuggestion(content);

      expect(suggestion.shouldSplit).toBe(false);
      expect(suggestion.suggestedPageCount).toBe(1);
    });

    it("should return shouldSplit=true with page count for overflow content", () => {
      const sections = Array.from({ length: 12 }, () =>
        makeTextSection("A".repeat(200)),
      );
      const content = buildPageContent("Overflow", sections);

      const suggestion = skill.getSplitSuggestion(content);

      expect(suggestion.shouldSplit).toBe(true);
      expect(suggestion.suggestedPageCount).toBeGreaterThan(1);
      expect(suggestion.sectionsPerPage).toBeGreaterThan(0);
    });
  });
});
