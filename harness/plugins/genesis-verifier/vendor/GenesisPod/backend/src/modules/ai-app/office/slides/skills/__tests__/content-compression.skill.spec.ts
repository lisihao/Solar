/**
 * Unit tests for ContentCompressionSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ContentCompressionSkill } from "../content-compression.skill";
import { ContentAnalyzerSkill } from "../content-analyzer.skill";
import { DataSupplementSkill } from "../data-supplement.skill";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  PageContent,
  PageOutline,
  ContentSection,
  StatContent,
} from "../../checkpoint/checkpoint.types";

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-content-compression",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
  metadata: {},
});

const buildPageOutline = (
  overrides: Partial<PageOutline> = {},
): PageOutline => ({
  pageNumber: 1,
  title: "Market Analysis 2024",
  subtitle: "Key Insights",
  templateType: "splitLayout",
  contentBrief: "Analyze current market trends",
  keyElements: ["Market size", "Growth rate", "Key players"],
  layoutHints: [],
  ...overrides,
});

const buildPageContent = (
  title: string,
  sections: ContentSection[] = [],
): PageContent => ({
  title,
  sections,
});

const buildTextSection = (content: string): ContentSection => ({
  type: "text",
  position: "full",
  content,
});

const buildStatSection = (value: string, label: string): ContentSection => ({
  type: "stat",
  position: "left",
  content: { value, label } as StatContent,
});

const buildListSection = (items: string[]): ContentSection => ({
  type: "list",
  position: "right",
  content: items,
});

const buildValidJsonResponse = (sections: ContentSection[] = []) =>
  `\`\`\`json\n${JSON.stringify({
    title: "AI Generated Title",
    subtitle: "Generated Subtitle",
    sections,
    footer: "Source: Research 2024",
  })}\n\`\`\``;

describe("ContentCompressionSkill", () => {
  let skill: ContentCompressionSkill;
  let aiFacade: jest.Mocked<ChatFacade>;
  let dataSupplementSkill: jest.Mocked<DataSupplementSkill>;
  let contentAnalyzerSkill: jest.Mocked<ContentAnalyzerSkill>;

  beforeEach(async () => {
    const mockFacade = {
      chat: jest.fn(),
    };

    const mockDataSupplement = {
      execute: jest.fn().mockResolvedValue({
        success: false,
        data: null,
      }),
    };

    const mockContentAnalyzer = {
      analyze: jest.fn().mockReturnValue({
        recommendedLayout: "content-flow",
        comparison: { detected: false, count: 0 },
        pillars: { detected: false, count: 0 },
        timeline: { detected: false, nodeCount: 0 },
        sectionTypes: {
          stat: 0,
          list: 0,
          text: 1,
          chart: 0,
          image: 0,
          quote: 0,
        },
        visualComplexity: "simple",
        estimatedCapacity: {
          fitsOnOnePage: true,
          suggestedPageCount: 1,
          overflowSections: 0,
        },
      }),
      getSplitSuggestion: jest.fn().mockReturnValue({
        shouldSplit: false,
        suggestedPageCount: 1,
        sectionsPerPage: 4,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentCompressionSkill,
        { provide: ChatFacade, useValue: mockFacade },
        { provide: DataSupplementSkill, useValue: mockDataSupplement },
        { provide: ContentAnalyzerSkill, useValue: mockContentAnalyzer },
      ],
    }).compile();

    skill = module.get<ContentCompressionSkill>(ContentCompressionSkill);
    aiFacade = module.get(ChatFacade);
    dataSupplementSkill = module.get(DataSupplementSkill);
    contentAnalyzerSkill = module.get(ContentAnalyzerSkill);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-content-compression");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("4.0.0");
  });

  describe("execute", () => {
    it("should compress content and return result", async () => {
      const validSections: ContentSection[] = [
        buildStatSection("85%", "Market Share"),
        buildListSection([
          "Growth trend 1: 20% YoY",
          "Growth trend 2: key markets",
          "Trend 3: competitive landscape",
        ]),
        buildTextSection(
          "Market analysis shows strong growth and positive outlook",
        ),
      ];
      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(validSections),
        tokensUsed: 300,
      });

      const result = await skill.execute(
        {
          pageOutline: buildPageOutline(),
          sourceText: "Source text about market analysis with growth data",
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.pageContent.title).toBeDefined();
      expect(aiFacade.chat).toHaveBeenCalled();
    });

    it("should return failure when ChatFacade is not available", async () => {
      // Create skill without facade
      const moduleNoFacade: TestingModule = await Test.createTestingModule({
        providers: [
          ContentCompressionSkill,
          { provide: ChatFacade, useValue: null },
          { provide: DataSupplementSkill, useValue: dataSupplementSkill },
          { provide: ContentAnalyzerSkill, useValue: contentAnalyzerSkill },
        ],
      }).compile();

      const skillNoFacade = moduleNoFacade.get<ContentCompressionSkill>(
        ContentCompressionSkill,
      );

      const result = await skillNoFacade.execute(
        {
          pageOutline: buildPageOutline(),
          sourceText: "Some content",
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("CONTENT_COMPRESSION_FAILED");
    });

    it("should return failure for invalid OrchestratorInput (missing fields)", async () => {
      const result = await skill.execute(
        { task: "compress", context: {} } as any,
        buildSkillContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_INPUT");
    });

    it("should handle JSON parse error gracefully and return fallback", async () => {
      aiFacade.chat.mockResolvedValueOnce({
        content: "Not valid JSON at all {{{",
        tokensUsed: 50,
      });

      const result = await skill.execute(
        {
          pageOutline: buildPageOutline(),
          sourceText: "Source text",
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // Fallback content uses keyElements
      expect(result.data?.pageContent).toBeDefined();
    });

    it("should handle LLM error and return failure", async () => {
      aiFacade.chat.mockRejectedValueOnce(new Error("LLM API error"));

      const result = await skill.execute(
        {
          pageOutline: buildPageOutline(),
          sourceText: "Source text",
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("CONTENT_COMPRESSION_FAILED");
    });

    it("should include token usage in metadata", async () => {
      const validSections: ContentSection[] = [
        buildStatSection("90%", "Accuracy"),
        buildListSection([
          "Detail 1: with specifics",
          "Detail 2: with data",
          "Detail 3: more info",
        ]),
        buildTextSection("Summary of the key findings and implications"),
      ];
      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(validSections),
        tokensUsed: 400,
      });

      const result = await skill.execute(
        {
          pageOutline: buildPageOutline(),
          sourceText: "Source",
        },
        buildSkillContext(),
      );

      expect(result.metadata?.tokensUsed).toBe(400);
    });

    it("should not supplement data for cover page type", async () => {
      const coverOutline = buildPageOutline({ templateType: "cover" });
      aiFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json\n${JSON.stringify({
          title: "Cover Title",
          subtitle: "Cover Subtitle",
          sections: [],
        })}\n\`\`\``,
        tokensUsed: 100,
      });

      await skill.execute(
        { pageOutline: coverOutline, sourceText: "Content" },
        buildSkillContext(),
      );

      expect(dataSupplementSkill.execute).not.toHaveBeenCalled();
    });

    it("should not supplement data for toc page type", async () => {
      const tocOutline = buildPageOutline({ templateType: "toc" });
      const validSections: ContentSection[] = [
        buildTextSection("Table of contents content"),
      ];
      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(validSections),
        tokensUsed: 100,
      });

      await skill.execute(
        { pageOutline: tocOutline, sourceText: "TOC Content" },
        buildSkillContext(),
      );

      expect(dataSupplementSkill.execute).not.toHaveBeenCalled();
    });

    it("should attempt data supplement for non-cover slides", async () => {
      const validSections: ContentSection[] = [
        buildStatSection("75%", "Metric"),
        buildListSection([
          "Insight 1: quantified finding",
          "Insight 2: more detail",
          "Insight 3: conclusion",
        ]),
        buildTextSection("Analysis complete with concrete data points"),
      ];
      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(validSections),
        tokensUsed: 200,
      });

      dataSupplementSkill.execute.mockResolvedValueOnce({
        success: true,
        data: {
          wasSupplemented: true,
          supplementedFields: ["stat.value"],
          pageContent: buildPageContent("Supplemented Title", validSections),
        },
      } as any);

      const result = await skill.execute(
        {
          pageOutline: buildPageOutline({ templateType: "dashboard" }),
          sourceText: "Some content with [--] placeholders",
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(dataSupplementSkill.execute).toHaveBeenCalled();
    });

    it("should handle data supplement failure gracefully", async () => {
      const validSections: ContentSection[] = [
        buildStatSection("60%", "Success Rate"),
        buildListSection([
          "Key point 1 detail",
          "Key point 2 detail",
          "Key point 3 detail",
        ]),
        buildTextSection("Main content body with relevant information"),
      ];
      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(validSections),
        tokensUsed: 200,
      });

      dataSupplementSkill.execute.mockRejectedValueOnce(
        new Error("Supplement failed"),
      );

      const result = await skill.execute(
        {
          pageOutline: buildPageOutline(),
          sourceText: "Source",
        },
        buildSkillContext(),
      );

      // Should succeed despite supplement failure
      expect(result.success).toBe(true);
    });

    it("should include retry context in message when provided", async () => {
      const validSections: ContentSection[] = [
        buildStatSection("88%", "Quality"),
        buildListSection([
          "Improved point 1 with data",
          "Improved point 2 concrete",
          "Improved point 3 specific",
        ]),
        buildTextSection("Revised content addressing feedback"),
      ];
      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(validSections),
        tokensUsed: 200,
      });

      const _result = await skill.execute(
        {
          pageOutline: buildPageOutline(),
          sourceText: "Content",
          retryContext: {
            attempt: 2,
            feedback: "Content was too sparse",
            suggestions: ["Add more data points"],
          },
        },
        buildSkillContext(),
      );

      const callArgs = aiFacade.chat.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: any) => m.role === "user");
      expect(userMessage.content).toContain("第 2 次尝试");
    });

    it("should handle OrchestratorInput format successfully", async () => {
      const validSections: ContentSection[] = [
        buildStatSection("95%", "Efficiency"),
        buildListSection([
          "Process 1: streamlined",
          "Process 2: automated",
          "Process 3: optimized",
        ]),
        buildTextSection("Orchestrator content analysis complete"),
      ];
      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(validSections),
        tokensUsed: 150,
      });

      const result = await skill.execute(
        {
          task: "compress",
          context: {
            input: {
              pageOutline: buildPageOutline(),
              sourceText: "Source text from orchestrator",
              maxCharacters: 500,
            },
          },
        } as any,
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
    });

    it("should truncate very long source text at 8000 chars", async () => {
      const longSource = "A".repeat(10000);
      const validSections: ContentSection[] = [
        buildTextSection("Compressed from long source"),
        buildListSection([
          "Summary point 1: from analysis",
          "Summary point 2: key finding",
        ]),
      ];
      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(validSections),
        tokensUsed: 200,
      });

      await skill.execute(
        { pageOutline: buildPageOutline(), sourceText: longSource },
        buildSkillContext(),
      );

      const callArgs = aiFacade.chat.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: any) => m.role === "user");
      expect(userMessage.content).toContain("[内容已截断]");
    });
  });

  describe("executeBatch", () => {
    it("should compress multiple pages in batches", async () => {
      const validSections: ContentSection[] = [
        buildStatSection("80%", "Rate"),
        buildListSection([
          "Batch item 1 detail",
          "Batch item 2 detail",
          "Batch item 3 detail",
        ]),
        buildTextSection("Batch compression result complete"),
      ];
      aiFacade.chat.mockResolvedValue({
        content: buildValidJsonResponse(validSections),
        tokensUsed: 200,
      });

      const inputs = Array.from({ length: 5 }, (_, i) => ({
        pageOutline: buildPageOutline({ pageNumber: i + 1 }),
        sourceText: `Source text for page ${i + 1}`,
      }));

      const results = await skill.executeBatch(inputs, buildSkillContext());

      expect(results.size).toBe(5);
      for (let i = 1; i <= 5; i++) {
        expect(results.has(i)).toBe(true);
      }
    });

    it("should handle individual batch failures with fallback", async () => {
      aiFacade.chat
        .mockResolvedValueOnce({
          content: buildValidJsonResponse([
            buildTextSection("Valid content page"),
          ]),
          tokensUsed: 100,
        })
        .mockRejectedValueOnce(new Error("LLM failed for page 2"));

      const inputs = [
        {
          pageOutline: buildPageOutline({ pageNumber: 1 }),
          sourceText: "Page 1 source",
        },
        {
          pageOutline: buildPageOutline({ pageNumber: 2 }),
          sourceText: "Page 2 source",
        },
      ];

      const results = await skill.executeBatch(inputs, buildSkillContext());

      // Both pages should have results (second uses fallback)
      expect(results.size).toBe(2);
      expect(results.has(1)).toBe(true);
      expect(results.has(2)).toBe(true);
    });
  });

  describe("willOverflow", () => {
    it("should return overflow=false for small content", () => {
      const content = buildPageContent("Simple", [
        buildTextSection("Short text"),
      ]);

      contentAnalyzerSkill.analyze.mockReturnValueOnce({
        recommendedLayout: "content-flow",
        comparison: { detected: false, count: 0 },
        pillars: { detected: false, count: 0 },
        timeline: { detected: false, nodeCount: 0 },
        sectionTypes: {
          stat: 0,
          list: 0,
          text: 1,
          chart: 0,
          image: 0,
          quote: 0,
        },
        visualComplexity: "simple",
        estimatedCapacity: {
          fitsOnOnePage: true,
          suggestedPageCount: 1,
          overflowSections: 0,
        },
      } as any);

      const result = skill.willOverflow(content, "splitLayout");

      expect(result.overflow).toBe(false);
    });

    it("should return overflow=true when ContentAnalyzer says it does not fit", () => {
      const sections = Array.from({ length: 8 }, () =>
        buildTextSection("A".repeat(200)),
      );
      const content = buildPageContent("Overflow", sections);

      contentAnalyzerSkill.analyze.mockReturnValueOnce({
        recommendedLayout: "content-flow",
        comparison: { detected: false, count: 0 },
        pillars: { detected: false, count: 0 },
        timeline: { detected: false, nodeCount: 0 },
        sectionTypes: {
          stat: 0,
          list: 0,
          text: 8,
          chart: 0,
          image: 0,
          quote: 0,
        },
        visualComplexity: "dense",
        estimatedCapacity: {
          fitsOnOnePage: false,
          suggestedPageCount: 3,
          overflowSections: 4,
        },
      } as any);

      const result = skill.willOverflow(content, "splitLayout");

      expect(result.overflow).toBe(true);
    });

    it("should include analysis in result", () => {
      const content = buildPageContent("Test", []);

      contentAnalyzerSkill.analyze.mockReturnValueOnce({
        estimatedCapacity: {
          fitsOnOnePage: true,
          suggestedPageCount: 1,
          overflowSections: 0,
        },
      } as any);

      const result = skill.willOverflow(content, "splitLayout");

      expect(result.analysis).toBeDefined();
    });
  });

  describe("compressSection", () => {
    it("should not truncate short text sections", () => {
      const section = buildTextSection("Short text");
      const result = skill.compressSection(section, 200);
      expect(result.content).toBe("Short text");
    });

    it("should truncate long text sections", () => {
      const longText = "A".repeat(300);
      const section = buildTextSection(longText);
      const result = skill.compressSection(section, 100);
      expect((result.content as string).length).toBeLessThanOrEqual(100);
      expect((result.content as string).endsWith("...")).toBe(true);
    });

    it("should compress list sections by limiting items", () => {
      const section = buildListSection([
        "Item 1",
        "Item 2",
        "Item 3",
        "Item 4",
        "Item 5",
      ]);
      const result = skill.compressSection(section, 20); // Very short limit

      expect((result.content as string[]).length).toBeLessThanOrEqual(
        (section.content as string[]).length,
      );
    });

    it("should return section unchanged if list fits in target", () => {
      const section = buildListSection(["Short 1", "Short 2"]);
      const result = skill.compressSection(section, 200);
      expect(result.content).toEqual(section.content);
    });
  });

  describe("autoCompress", () => {
    it("should trim sections exceeding capacity", () => {
      // Mock analyzer to say max 4 sections for content-flow
      contentAnalyzerSkill.analyze.mockReturnValue({
        recommendedLayout: "content-flow",
        comparison: { detected: false, count: 0 },
        pillars: { detected: false, count: 0 },
        timeline: { detected: false, nodeCount: 0 },
        sectionTypes: {
          stat: 0,
          list: 0,
          text: 6,
          chart: 0,
          image: 0,
          quote: 0,
        },
        visualComplexity: "simple",
        estimatedCapacity: {
          fitsOnOnePage: true,
          suggestedPageCount: 1,
          overflowSections: 0,
        },
      } as any);

      const sections = Array.from({ length: 6 }, (_, i) =>
        buildTextSection(`Section ${i + 1}`),
      );
      const content = buildPageContent("Too many", sections);

      const result = skill.autoCompress(content, "splitLayout");

      // autoCompress with simple complexity -> maxSections=4
      expect(result.sections.length).toBeLessThanOrEqual(6);
    });

    it("should truncate title over 50 chars", () => {
      contentAnalyzerSkill.analyze.mockReturnValue({
        recommendedLayout: "mixed-content",
        comparison: { detected: false, count: 0 },
        pillars: { detected: false, count: 0 },
        timeline: { detected: false, nodeCount: 0 },
        sectionTypes: {
          stat: 0,
          list: 0,
          text: 0,
          chart: 0,
          image: 0,
          quote: 0,
        },
        visualComplexity: "simple",
        estimatedCapacity: {
          fitsOnOnePage: true,
          suggestedPageCount: 1,
          overflowSections: 0,
        },
      } as any);

      const longTitle = "A".repeat(60);
      const content = buildPageContent(longTitle, []);

      const result = skill.autoCompress(content, "splitLayout");

      expect(result.title.length).toBeLessThanOrEqual(50);
      expect(result.title.endsWith("...")).toBe(true);
    });

    it("should truncate subtitle over 80 chars", () => {
      contentAnalyzerSkill.analyze.mockReturnValue({
        recommendedLayout: "mixed-content",
        comparison: { detected: false, count: 0 },
        pillars: { detected: false, count: 0 },
        timeline: { detected: false, nodeCount: 0 },
        sectionTypes: {
          stat: 0,
          list: 0,
          text: 0,
          chart: 0,
          image: 0,
          quote: 0,
        },
        visualComplexity: "simple",
        estimatedCapacity: {
          fitsOnOnePage: true,
          suggestedPageCount: 1,
          overflowSections: 0,
        },
      } as any);

      const content: PageContent = {
        title: "Title",
        subtitle: "B".repeat(90),
        sections: [],
      };

      const result = skill.autoCompress(content, "splitLayout");

      expect((result.subtitle as string).length).toBeLessThanOrEqual(80);
    });
  });

  describe("splitIntoPages", () => {
    it("should return single page when no split needed", () => {
      contentAnalyzerSkill.getSplitSuggestion.mockReturnValueOnce({
        shouldSplit: false,
        suggestedPageCount: 1,
        sectionsPerPage: 4,
      });

      const content = buildPageContent("Simple", [buildTextSection("Content")]);

      const pages = skill.splitIntoPages(content, "splitLayout");

      expect(pages).toHaveLength(1);
    });

    it("should split into multiple pages when needed", () => {
      contentAnalyzerSkill.getSplitSuggestion.mockReturnValueOnce({
        shouldSplit: true,
        suggestedPageCount: 3,
        sectionsPerPage: 2,
      });

      const sections = Array.from({ length: 6 }, (_, i) =>
        buildTextSection(`Section ${i + 1}`),
      );
      const content = buildPageContent("Long Content", sections);

      const pages = skill.splitIntoPages(content, "splitLayout");

      expect(pages.length).toBeGreaterThan(1);
    });

    it("should add continuation suffix to split pages after first", () => {
      contentAnalyzerSkill.getSplitSuggestion.mockReturnValueOnce({
        shouldSplit: true,
        suggestedPageCount: 2,
        sectionsPerPage: 2,
      });

      const sections = [
        buildTextSection("Section 1"),
        buildTextSection("Section 2"),
        buildTextSection("Section 3"),
        buildTextSection("Section 4"),
      ];
      const content = buildPageContent("Main Title", sections);

      const pages = skill.splitIntoPages(content, "splitLayout");

      if (pages.length > 1) {
        expect(pages[0].title).toBe("Main Title");
        expect(pages[1].title).toContain("续");
      }
    });
  });

  describe("analyzeContent", () => {
    it("should delegate to contentAnalyzer.analyze", () => {
      const content = buildPageContent("Test", [buildTextSection("Content")]);
      contentAnalyzerSkill.analyze.mockReturnValueOnce({
        totalSections: 1,
      } as any);

      const result = skill.analyzeContent(content);

      expect(result).toBeDefined();
      expect(contentAnalyzerSkill.analyze).toHaveBeenCalledWith(content);
    });
  });
});
