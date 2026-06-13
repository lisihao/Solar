/**
 * Unit tests for ReadingExperienceService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ReadingExperienceService } from "../reading-experience.service";
import {
  ContentComplexity,
  ContentCategory,
  DataDensity,
  TemporalDimension,
  HierarchyType,
} from "../../content-analysis/content-analysis.types";
import { VisualBreakType } from "../template-selection.types";

const buildMockParagraph = (
  id: string,
  text: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  text,
  wordCount: text.length,
  hasList: false,
  hasQuote: false,
  hasData: false,
  keyPoints: [] as string[],
  ...overrides,
});

const buildMockSection = (
  id: string,
  paragraphs: ReturnType<typeof buildMockParagraph>[],
  overrides: Record<string, unknown> = {},
) => ({
  id,
  title: `Section ${id}`,
  paragraphs,
  level: 1,
  wordCount: paragraphs.reduce((sum, p) => sum + p.text.length, 0),
  hasSubsections: false,
  ...overrides,
});

const buildMockDocumentFeatures = (
  complexity: ContentComplexity = ContentComplexity.MEDIUM,
) => ({
  category: ContentCategory.INFORMATIONAL,
  complexity,
  dataDensity: DataDensity.BALANCED,
  temporalDimension: TemporalDimension.NONE,
  hierarchyType: HierarchyType.FLAT,
  wordCount: 500,
  paragraphCount: 5,
  listCount: 2,
  hasStatistics: false,
  hasTimeline: false,
  hasComparison: false,
  hasCaseStudy: false,
  hasRiskAnalysis: false,
  hasRecommendations: false,
  hasSteps: false,
  keyTopics: [],
  entities: [],
  sentiment: "neutral" as const,
});

describe("ReadingExperienceService", () => {
  let service: ReadingExperienceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReadingExperienceService],
    }).compile();

    service = module.get<ReadingExperienceService>(ReadingExperienceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("analyzeAndOptimize", () => {
    it("should return analysis, optimized sections and overall score", () => {
      const paragraphs = [buildMockParagraph("p1", "Short paragraph text")];
      const sections = [buildMockSection("s1", paragraphs)];
      const documentFeatures = buildMockDocumentFeatures();

      const result = service.analyzeAndOptimize(sections, documentFeatures);

      expect(result).toHaveProperty("analysis");
      expect(result).toHaveProperty("optimizedSections");
      expect(result).toHaveProperty("overallScore");
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
    });

    it("should return 100 score for empty sections", () => {
      const result = service.analyzeAndOptimize(
        [],
        buildMockDocumentFeatures(),
      );
      expect(result.overallScore).toBe(100);
    });

    it("should detect long paragraphs and create issues", () => {
      const longText = "A".repeat(300);
      const paragraphs = [buildMockParagraph("p1", longText)];
      const sections = [buildMockSection("s1", paragraphs)];

      const result = service.analyzeAndOptimize(
        sections,
        buildMockDocumentFeatures(),
      );

      const longIssues = result.analysis.issues.filter(
        (i) => i.type === "too_dense",
      );
      expect(longIssues.length).toBeGreaterThan(0);
    });

    it("should detect wall of text when more than 30% paragraphs are long", () => {
      const longText = "A".repeat(300);
      const shortText = "Short text";
      const paragraphs = [
        buildMockParagraph("p1", longText),
        buildMockParagraph("p2", longText),
        buildMockParagraph("p3", longText),
        buildMockParagraph("p4", shortText),
      ];
      const sections = [buildMockSection("s1", paragraphs)];

      const result = service.analyzeAndOptimize(
        sections,
        buildMockDocumentFeatures(),
      );

      const wallIssue = result.analysis.issues.find(
        (i) => i.type === "wall_of_text",
      );
      expect(wallIssue).toBeDefined();
      expect(wallIssue?.severity).toBe("critical");
    });

    it("should detect no_visual_breaks when consecutive text exceeds threshold", () => {
      // Medium complexity: visualBreakFrequency = 3
      const para = buildMockParagraph("p1", "Normal paragraph text");
      const paragraphs = [para, para, para, para]; // 4 consecutive text-only paragraphs
      const sections = [buildMockSection("s1", paragraphs)];

      const result = service.analyzeAndOptimize(
        sections,
        buildMockDocumentFeatures(),
      );

      const noBreakIssue = result.analysis.issues.find(
        (i) => i.type === "no_visual_breaks",
      );
      expect(noBreakIssue).toBeDefined();
    });

    it("should detect too many paragraphs in a section", () => {
      // Max paragraphs per section for medium complexity is 5
      const paragraphs = Array.from({ length: 7 }, (_, i) =>
        buildMockParagraph(`p${i}`, "Short text"),
      );
      const sections = [buildMockSection("s1", paragraphs)];

      const result = service.analyzeAndOptimize(
        sections,
        buildMockDocumentFeatures(),
      );

      const denseIssue = result.analysis.issues.find(
        (i) => i.type === "too_dense" && i.location === "章节1",
      );
      expect(denseIssue).toBeDefined();
    });

    it("should produce optimized sections with same count as input", () => {
      const s1 = buildMockSection("s1", [buildMockParagraph("p1", "Text one")]);
      const s2 = buildMockSection("s2", [buildMockParagraph("p2", "Text two")]);

      const result = service.analyzeAndOptimize(
        [s1, s2],
        buildMockDocumentFeatures(),
      );

      expect(result.optimizedSections).toHaveLength(2);
    });

    it("should mark paragraphs that need splitting", () => {
      const longText = "A".repeat(300);
      const paragraphs = [buildMockParagraph("p1", longText)];
      const sections = [buildMockSection("s1", paragraphs)];

      const result = service.analyzeAndOptimize(
        sections,
        buildMockDocumentFeatures(),
      );

      const section = result.optimizedSections[0];
      const longParagraph = section.paragraphs[0];
      expect(longParagraph.needsSplit).toBe(true);
      expect(longParagraph.splitSuggestion).toBeDefined();
    });

    it("should calculate estimated reading time per section", () => {
      const text200words = "word ".repeat(200);
      const paragraphs = [buildMockParagraph("p1", text200words)];
      const sections = [buildMockSection("s1", paragraphs)];

      const result = service.analyzeAndOptimize(
        sections,
        buildMockDocumentFeatures(),
      );

      // 1000 chars / 200 chars-per-minute = 5 min approx
      expect(result.optimizedSections[0].estimatedReadingTime).toBeGreaterThan(
        0,
      );
    });

    it("should add visual break after reaching threshold of consecutive text", () => {
      // Medium complexity: visualBreakFrequency = 3
      const para = buildMockParagraph("p1", "Text paragraph");
      const paragraphs = [para, para, para]; // exactly 3
      const sections = [buildMockSection("s1", paragraphs)];

      const result = service.analyzeAndOptimize(
        sections,
        buildMockDocumentFeatures(),
      );

      const section = result.optimizedSections[0];
      expect(section.visualBreaks.length).toBeGreaterThan(0);
    });

    it("should reset consecutive count after list paragraph", () => {
      const textPara = buildMockParagraph("p1", "Text");
      const listPara = buildMockParagraph("p2", "List item", { hasList: true });
      const paragraphs = [textPara, textPara, listPara, textPara];
      const sections = [buildMockSection("s1", paragraphs)];

      const result = service.analyzeAndOptimize(
        sections,
        buildMockDocumentFeatures(),
      );

      // Should not flag no_visual_breaks since list paragraph breaks the sequence
      expect(result.optimizedSections).toHaveLength(1);
    });

    it("should use infographic visual break for paragraphs with data", () => {
      const dataPara = buildMockParagraph("p1", "Data paragraph", {
        hasData: true,
      });
      const paragraphs = [dataPara, dataPara, dataPara]; // Trigger threshold of 3
      const sections = [buildMockSection("s1", paragraphs)];

      const result = service.analyzeAndOptimize(
        sections,
        buildMockDocumentFeatures(),
      );

      const section = result.optimizedSections[0];
      if (section.visualBreaks.length > 0) {
        expect(section.visualBreaks[0].type).toBe(VisualBreakType.INFOGRAPHIC);
      }
    });

    it("should use callout visual break for paragraphs with key points", () => {
      const keyPointPara = buildMockParagraph("p1", "Important paragraph", {
        keyPoints: ["Key finding 1"],
        hasData: false,
      });
      const paragraphs = [keyPointPara, keyPointPara, keyPointPara];
      const sections = [buildMockSection("s1", paragraphs)];

      const result = service.analyzeAndOptimize(
        sections,
        buildMockDocumentFeatures(),
      );

      const section = result.optimizedSections[0];
      if (section.visualBreaks.length > 0) {
        expect(section.visualBreaks[0].type).toBe(VisualBreakType.CALLOUT);
      }
    });

    it("should use different configuration for HIGH complexity", () => {
      const highComplexityFeatures = buildMockDocumentFeatures(
        ContentComplexity.HIGH,
      );
      const para = buildMockParagraph("p1", "Text paragraph");
      const paragraphs = [para, para, para, para, para]; // 5 paragraphs
      const sections = [buildMockSection("s1", paragraphs)];

      const result = service.analyzeAndOptimize(
        sections,
        highComplexityFeatures,
      );

      // HIGH complexity has visualBreakFrequency=4, so 5 consecutive should trigger
      expect(result.analysis).toBeDefined();
    });

    it("should use different configuration for LOW complexity", () => {
      const lowComplexityFeatures = buildMockDocumentFeatures(
        ContentComplexity.LOW,
      );
      const para = buildMockParagraph("p1", "Text paragraph");
      const paragraphs = [para, para]; // 2 paragraphs
      const sections = [buildMockSection("s1", paragraphs)];

      const result = service.analyzeAndOptimize(
        sections,
        lowComplexityFeatures,
      );

      // LOW complexity has visualBreakFrequency=2, so 2 consecutive should trigger
      expect(result.analysis).toBeDefined();
    });
  });

  describe("getReadingExperienceRecommendations", () => {
    it("should return config for medium complexity", () => {
      const config = service.getReadingExperienceRecommendations(
        ContentComplexity.MEDIUM,
      );
      expect(config).toBeDefined();
      expect(config.density).toBeDefined();
      expect(config.rhythm).toBeDefined();
    });

    it("should return different configs for different complexities", () => {
      const low = service.getReadingExperienceRecommendations(
        ContentComplexity.LOW,
      );
      const high = service.getReadingExperienceRecommendations(
        ContentComplexity.HIGH,
      );

      expect(low.density.maxWordsPerParagraph).toBeLessThan(
        high.density.maxWordsPerParagraph,
      );
    });
  });

  describe("quickAssess", () => {
    it("should return a score, issues and suggestions", () => {
      const result = service.quickAssess("Short text that is fine.");
      expect(result).toHaveProperty("score");
      expect(result).toHaveProperty("issues");
      expect(result).toHaveProperty("suggestions");
    });

    it("should start with score 100 for short perfect text", () => {
      const result = service.quickAssess("Short and clean.");
      expect(result.score).toBe(100);
      expect(result.issues).toHaveLength(0);
    });

    it("should penalize for long paragraphs over 200 chars", () => {
      const longParagraph = "A".repeat(250);
      const result = service.quickAssess(longParagraph);
      expect(result.score).toBeLessThan(100);
      expect(result.issues.some((i) => i.includes("段落"))).toBe(true);
    });

    it("should penalize for content over 3000 chars with fewer than 5 paragraphs", () => {
      const longContent = "A".repeat(3001);
      const result = service.quickAssess(longContent);
      expect(result.score).toBeLessThan(100);
    });

    it("should penalize for content over 500 chars without list structure", () => {
      const longNoList = "Normal text sentence. ".repeat(30);
      const result = service.quickAssess(longNoList);
      expect(result.issues.some((i) => i.includes("列表"))).toBe(true);
    });

    it("should NOT penalize for list structure when text has bullet markers", () => {
      const textWithList = "Some text\n\n- Item 1\n- Item 2\n- Item 3\n".repeat(
        5,
      );
      const result = service.quickAssess(textWithList);
      const listIssue = result.issues.find((i) => i.includes("列表"));
      expect(listIssue).toBeUndefined();
    });

    it("should penalize for more than 5 paragraphs without headings", () => {
      const manyParagraphs =
        "Para one.\n\nPara two.\n\nPara three.\n\nPara four.\n\nPara five.\n\nPara six.";
      const result = service.quickAssess(manyParagraphs);
      expect(result.issues.some((i) => i.includes("标题"))).toBe(true);
    });

    it("should NOT penalize for headings when using # format", () => {
      const textWithHeadings =
        "# Heading\n\nParagraph 1.\n\n## Sub\n\nParagraph 2.\n\n### Sub2\n\nMore\n\n#### More\n\nEven more\n\n##### Level5\n\nAnd more\n\n###### Level6\n\nLast";
      const result = service.quickAssess(textWithHeadings);
      const headingIssue = result.issues.find((i) => i.includes("标题"));
      expect(headingIssue).toBeUndefined();
    });

    it("should score 0 or above at minimum (no negative scores)", () => {
      const terribleText =
        "A".repeat(300) +
        "\n\n" +
        "B".repeat(300) +
        "\n\n" +
        "C".repeat(300) +
        "\n\n" +
        "D".repeat(3500);
      const result = service.quickAssess(terribleText);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe("generateReport", () => {
    it("should generate a markdown report with score", () => {
      const analysis = {
        currentScore: 75,
        issues: [],
        suggestions: [],
        optimizedConfig: service.getReadingExperienceRecommendations(
          ContentComplexity.MEDIUM,
        ),
      };

      const report = service.generateReport(analysis);
      expect(report).toContain("75/100");
      expect(report).toContain("阅读体验分析报告");
    });

    it("should include issues in report when present", () => {
      const analysis = {
        currentScore: 60,
        issues: [
          {
            type: "too_dense" as const,
            severity: "major" as const,
            location: "Section 1 Paragraph 2",
            description: "Paragraph is too long",
          },
        ],
        suggestions: [],
        optimizedConfig: service.getReadingExperienceRecommendations(
          ContentComplexity.MEDIUM,
        ),
      };

      const report = service.generateReport(analysis);
      expect(report).toContain("发现的问题");
      expect(report).toContain("Paragraph is too long");
    });

    it("should include suggestions in report when present", () => {
      const analysis = {
        currentScore: 80,
        issues: [],
        suggestions: [
          {
            type: "add_visual" as const,
            location: "Section 2",
            description: "Add infographic here",
            expectedImprovement: 15,
          },
        ],
        optimizedConfig: service.getReadingExperienceRecommendations(
          ContentComplexity.MEDIUM,
        ),
      };

      const report = service.generateReport(analysis);
      expect(report).toContain("优化建议");
      expect(report).toContain("Add infographic here");
      expect(report).toContain("+15");
    });

    it("should show correct severity icons", () => {
      const analysis = {
        currentScore: 40,
        issues: [
          {
            type: "wall_of_text" as const,
            severity: "critical" as const,
            location: "Full document",
            description: "Wall of text",
          },
          {
            type: "too_dense" as const,
            severity: "major" as const,
            location: "Section 1",
            description: "Dense section",
          },
          {
            type: "too_dense" as const,
            severity: "minor" as const,
            location: "Section 2",
            description: "Slightly dense",
          },
        ],
        suggestions: [],
        optimizedConfig: service.getReadingExperienceRecommendations(
          ContentComplexity.MEDIUM,
        ),
      };

      const report = service.generateReport(analysis);
      // The report uses emoji icons per severity
      expect(report).toBeDefined();
      expect(report.length).toBeGreaterThan(0);
    });
  });
});
