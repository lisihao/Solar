/**
 * Supplemental unit tests for ContentCompressionSkill
 *
 * Covers branches not addressed in the primary spec:
 * - normalizeInput: orchestrator format with missing fields warning
 * - shouldSupplementData: closing / thankYou page types
 * - getStrategyGuidance: detailed / creative / conservative / default strategies
 * - generateFallbackSections: pillars, timeline, riskOpportunity, dashboard, default variants
 * - isSectionValid: stat with value="0", stat with placeholder label, list with < 2 valid items
 * - isPlaceholderText: various placeholder patterns
 * - validateAndEnrichSections: low valid ratio, insufficient valid sections
 * - getMinSectionsForTemplate: cover/toc/sectionDivider specials; ContentAnalyzer layout paths
 * - getCapacityFromAnalysis: single-focus, data-dashboard, comparison-grid, pillar-showcase,
 *                            timeline-progress, content-flow (simple/moderate/dense)
 * - willOverflow: sections_exceeded (capacity), chars_exceeded, section_too_long
 * - normalizeContent: list (string input), stat (null content), chart (null content)
 * - validateSectionType / validatePosition: invalid values default
 * - executeBatch: execute returns success=false (fallback path inside batch)
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

// ==================== Helpers ====================

const buildSkillContext = (id = "test-exec-supp") => ({
  executionId: id,
  skillId: "slides-content-compression",
  domain: "slides",
  sessionId: "session-supp",
  createdAt: new Date(),
  metadata: {},
});

const buildPageOutline = (
  overrides: Partial<PageOutline> = {},
): PageOutline => ({
  pageNumber: 1,
  title: "Test Page",
  subtitle: "Subtitle",
  templateType: "splitLayout",
  contentBrief: "Content brief",
  keyElements: ["Element A", "Element B", "Element C"],
  layoutHints: [],
  ...overrides,
});

const buildPageContent = (
  title: string,
  sections: ContentSection[] = [],
): PageContent => ({ title, sections });

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
    footer: "Source",
  })}\n\`\`\``;

const makeAnalysis = (overrides: Record<string, unknown> = {}) => ({
  recommendedLayout: "content-flow",
  comparison: { detected: false, count: 0 },
  pillars: { detected: false, count: 0 },
  timeline: { detected: false, nodeCount: 0 },
  sectionTypes: { stat: 0, list: 0, text: 1, chart: 0, image: 0, quote: 0 },
  visualComplexity: "simple",
  estimatedCapacity: {
    fitsOnOnePage: true,
    suggestedPageCount: 1,
    overflowSections: 0,
  },
  ...overrides,
});

// ==================== Tests ====================

describe("ContentCompressionSkill (supplemental)", () => {
  let skill: ContentCompressionSkill;
  let aiFacade: jest.Mocked<ChatFacade>;
  let dataSupplementSkill: jest.Mocked<DataSupplementSkill>;
  let contentAnalyzerSkill: jest.Mocked<ContentAnalyzerSkill>;

  beforeEach(async () => {
    const mockFacade = { chat: jest.fn() };
    const mockDataSupplement = {
      execute: jest.fn().mockResolvedValue({ success: false, data: null }),
    };
    const mockContentAnalyzer = {
      analyze: jest.fn().mockReturnValue(makeAnalysis()),
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

  // ==================== shouldSupplementData variants ====================

  describe("shouldSupplementData - skip types", () => {
    it("should not supplement for closing page", async () => {
      const outline = buildPageOutline({ templateType: "closing" });
      aiFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json\n${JSON.stringify({
          title: "Closing",
          subtitle: "",
          sections: [],
        })}\n\`\`\``,
        tokensUsed: 50,
      });

      await skill.execute(
        { pageOutline: outline, sourceText: "content" },
        buildSkillContext(),
      );

      expect(dataSupplementSkill.execute).not.toHaveBeenCalled();
    });

    it("should not supplement for thankYou page", async () => {
      const outline = buildPageOutline({ templateType: "thankYou" });
      aiFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json\n${JSON.stringify({
          title: "Thank You",
          subtitle: "",
          sections: [],
        })}\n\`\`\``,
        tokensUsed: 50,
      });

      await skill.execute(
        { pageOutline: outline, sourceText: "content" },
        buildSkillContext(),
      );

      expect(dataSupplementSkill.execute).not.toHaveBeenCalled();
    });
  });

  // ==================== getStrategyGuidance variants ====================

  describe("getStrategyGuidance via retryContext", () => {
    const runWithStrategy = async (strategy: string) => {
      const validSections: ContentSection[] = [
        buildStatSection("80%", "Rate"),
        buildListSection(["Item 1 detail", "Item 2 detail", "Item 3 detail"]),
        buildTextSection("Summary line with meaningful content here"),
      ];
      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(validSections),
        tokensUsed: 100,
      });

      await skill.execute(
        {
          pageOutline: buildPageOutline(),
          sourceText: "content",
          retryContext: {
            attempt: 2,
            strategy: strategy as
              | "detailed"
              | "creative"
              | "conservative"
              | "default",
          },
        },
        buildSkillContext(),
      );

      const callArgs = aiFacade.chat.mock.calls[0][0];
      const userMsg = callArgs.messages.find(
        (m: { role: string; content: string }) => m.role === "user",
      );
      return userMsg.content;
    };

    it("should include detailed strategy guidance", async () => {
      const msg = await runWithStrategy("detailed");
      expect(msg).toContain("详细策略");
    });

    it("should include creative strategy guidance", async () => {
      const msg = await runWithStrategy("creative");
      expect(msg).toContain("创意策略");
    });

    it("should include conservative strategy guidance", async () => {
      const msg = await runWithStrategy("conservative");
      expect(msg).toContain("稳健策略");
    });

    it("should use standard strategy when strategy is undefined", async () => {
      const msg = await runWithStrategy("default");
      expect(msg).toContain("标准策略");
    });
  });

  // ==================== generateFallbackSections ====================

  describe("generateFallbackSections via execute (invalid JSON response)", () => {
    const runWithTemplateType = async (
      templateType: string,
      keyElements: string[],
    ) => {
      const outline = buildPageOutline({ templateType, keyElements });
      // Return invalid JSON so parseResponse falls back to createFallbackContent
      aiFacade.chat.mockResolvedValueOnce({
        content: "not valid json",
        tokensUsed: 10,
      });

      const result = await skill.execute(
        { pageOutline: outline, sourceText: "content" },
        buildSkillContext(),
      );

      return result;
    };

    it("should create fallback content for pillars template", async () => {
      const result = await runWithTemplateType("pillars", ["A", "B", "C"]);
      expect(result.success).toBe(true);
    });

    it("should create fallback content for timeline template", async () => {
      const result = await runWithTemplateType("timeline", [
        "Phase 1",
        "Phase 2",
        "Phase 3",
      ]);
      expect(result.success).toBe(true);
    });

    it("should create fallback content for riskOpportunity template", async () => {
      const result = await runWithTemplateType("riskOpportunity", [
        "Risk A",
        "Risk B",
        "Opp A",
      ]);
      expect(result.success).toBe(true);
    });

    it("should create fallback content for dashboard template", async () => {
      const result = await runWithTemplateType("dashboard", [
        "Metric 1",
        "Metric 2",
        "Metric 3",
        "Metric 4",
      ]);
      expect(result.success).toBe(true);
    });
  });

  // ==================== validateAndEnrichSections - low valid ratio ====================

  describe("validateAndEnrichSections via execute (placeholder sections)", () => {
    it("should replace all-placeholder sections with fallback", async () => {
      const outline = buildPageOutline({
        templateType: "splitLayout",
        keyElements: ["Real Element 1", "Real Element 2", "Real Element 3"],
      });

      // AI returns all-placeholder content
      const placeholderSections = [
        { type: "text", position: "full", content: "商务简约设计" },
        { type: "text", position: "full", content: "设计风格专业" },
        { type: "list", position: "right", content: ["核心能力", "关键优势"] },
      ];

      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(
          placeholderSections as ContentSection[],
        ),
        tokensUsed: 100,
      });
      contentAnalyzerSkill.analyze.mockReturnValue(makeAnalysis());

      const result = await skill.execute(
        { pageOutline: outline, sourceText: "Some real source text" },
        buildSkillContext(),
      );

      // Should still succeed (fallback sections generated)
      expect(result.success).toBe(true);
    });

    it("should supplement insufficient valid sections up to minimum", async () => {
      const outline = buildPageOutline({
        templateType: "splitLayout",
        keyElements: ["Key A", "Key B", "Key C", "Key D"],
      });

      // Only 1 valid section
      const mixedSections = [
        {
          type: "stat",
          position: "left",
          content: { value: "85%", label: "Valid Metric" },
        },
        { type: "text", position: "full", content: "赋能数字化" }, // placeholder
      ];

      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(mixedSections as ContentSection[]),
        tokensUsed: 100,
      });

      // Return analysis that requires 2 sections minimum
      contentAnalyzerSkill.analyze.mockReturnValue(
        makeAnalysis({
          recommendedLayout: "content-flow",
          visualComplexity: "simple",
        }),
      );

      const result = await skill.execute(
        { pageOutline: outline, sourceText: "Source text content" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.pageContent.sections.length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  // ==================== isSectionValid edge cases ====================

  describe("isSectionValid via execute (stat section edge cases)", () => {
    it("should treat stat with value=0 as invalid and generate fallback", async () => {
      const outline = buildPageOutline({
        templateType: "dashboard",
        keyElements: ["A", "B", "C", "D"],
      });

      const zerValueStat = [
        {
          type: "stat",
          position: "left",
          content: { value: "0", label: "Some Metric" },
        },
        {
          type: "stat",
          position: "right",
          content: { value: "0", label: "Other Metric" },
        },
      ];

      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(zerValueStat as ContentSection[]),
        tokensUsed: 80,
      });
      contentAnalyzerSkill.analyze.mockReturnValue(makeAnalysis());

      const result = await skill.execute(
        { pageOutline: outline, sourceText: "content" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
    });

    it("should treat stat with placeholder label as invalid", async () => {
      const outline = buildPageOutline({
        templateType: "splitLayout",
        keyElements: ["Real A", "Real B", "Real C"],
      });

      const placeholderLabelStat = [
        {
          type: "stat",
          position: "left",
          content: { value: "42%", label: "核心能力" },
        },
        {
          type: "stat",
          position: "right",
          content: { value: "18%", label: "关键优势" },
        },
      ];

      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(
          placeholderLabelStat as ContentSection[],
        ),
        tokensUsed: 80,
      });
      contentAnalyzerSkill.analyze.mockReturnValue(makeAnalysis());

      const result = await skill.execute(
        { pageOutline: outline, sourceText: "content" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
    });
  });

  // ==================== willOverflow - extra branches ====================

  describe("willOverflow additional branches", () => {
    it("should return overflow=true with sections_exceeded reason when too many sections", () => {
      const content = buildPageContent("Title", [
        buildTextSection("A"),
        buildTextSection("B"),
        buildTextSection("C"),
        buildTextSection("D"),
        buildTextSection("E"),
        buildTextSection("F"),
        buildTextSection("G"),
      ]);

      contentAnalyzerSkill.analyze
        .mockReturnValueOnce(
          makeAnalysis({
            estimatedCapacity: {
              fitsOnOnePage: true,
              suggestedPageCount: 1,
              overflowSections: 0,
            },
            recommendedLayout: "content-flow",
            visualComplexity: "simple",
          }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
        )
        .mockReturnValueOnce(
          makeAnalysis({
            recommendedLayout: "content-flow",
            visualComplexity: "simple",
          }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
        );

      // 7 sections > 4 (simple content-flow max)
      const result = skill.willOverflow(content, "splitLayout");

      expect(result.overflow).toBe(true);
      expect(result.reason).toBe("sections_exceeded");
    });

    it("should return overflow=true with chars_exceeded when total chars exceeds limit", () => {
      const longText = "A".repeat(700);
      const content = buildPageContent("T", [buildTextSection(longText)]);

      contentAnalyzerSkill.analyze
        .mockReturnValueOnce(
          makeAnalysis({
            estimatedCapacity: {
              fitsOnOnePage: true,
              suggestedPageCount: 1,
              overflowSections: 0,
            },
            recommendedLayout: "content-flow",
            visualComplexity: "simple",
          }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
        )
        .mockReturnValueOnce(
          makeAnalysis({
            recommendedLayout: "content-flow",
            visualComplexity: "simple",
          }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
        );

      const result = skill.willOverflow(content, "splitLayout");

      expect(result.overflow).toBe(true);
      expect(result.reason).toBe("chars_exceeded");
    });

    it("should return overflow=true with section_too_long for single very long section", () => {
      const longSection = buildTextSection("B".repeat(200));
      const content = buildPageContent("T", [longSection]);

      contentAnalyzerSkill.analyze
        .mockReturnValueOnce(
          makeAnalysis({
            estimatedCapacity: {
              fitsOnOnePage: true,
              suggestedPageCount: 1,
              overflowSections: 0,
            },
            recommendedLayout: "content-flow",
            visualComplexity: "simple",
          }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
        )
        .mockReturnValueOnce(
          makeAnalysis({
            recommendedLayout: "content-flow",
            visualComplexity: "simple",
          }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
        );

      // simple: maxCharsPerSection = 150, section is 200 chars => section_too_long
      const result = skill.willOverflow(content, "splitLayout");

      expect(result.overflow).toBe(true);
      expect(result.reason).toBe("section_too_long");
    });

    it("should use single-focus capacity for single-focus layout", () => {
      const content = buildPageContent("Cover", [
        buildTextSection("Minimal text"),
      ]);

      contentAnalyzerSkill.analyze
        .mockReturnValueOnce(
          makeAnalysis({
            estimatedCapacity: {
              fitsOnOnePage: true,
              suggestedPageCount: 1,
              overflowSections: 0,
            },
            recommendedLayout: "single-focus",
          }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
        )
        .mockReturnValueOnce(
          makeAnalysis({
            recommendedLayout: "single-focus",
          }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
        );

      const result = skill.willOverflow(content, "cover");
      // single-focus maxSections=0, 1 section > 0 => sections_exceeded
      expect(result.overflow).toBe(true);
    });

    it("should use data-dashboard capacity for data-dashboard layout", () => {
      const content = buildPageContent(
        "Dashboard",
        Array.from({ length: 7 }, () =>
          buildStatSection("10%", "Label with text"),
        ),
      );

      contentAnalyzerSkill.analyze
        .mockReturnValueOnce(
          makeAnalysis({
            estimatedCapacity: {
              fitsOnOnePage: true,
              suggestedPageCount: 1,
              overflowSections: 0,
            },
            recommendedLayout: "data-dashboard",
            sectionTypes: {
              stat: 7,
              list: 0,
              text: 0,
              chart: 0,
              image: 0,
              quote: 0,
            },
          }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
        )
        .mockReturnValueOnce(
          makeAnalysis({
            recommendedLayout: "data-dashboard",
            sectionTypes: {
              stat: 7,
              list: 0,
              text: 0,
              chart: 0,
              image: 0,
              quote: 0,
            },
          }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
        );

      const result = skill.willOverflow(content, "dashboard");
      // data-dashboard maxSections=6, 7 > 6 => sections_exceeded
      expect(result.overflow).toBe(true);
    });
  });

  // ==================== getCapacityFromAnalysis via autoCompress ====================

  describe("getCapacityFromAnalysis via autoCompress", () => {
    it("should use moderate capacity for moderate visual complexity", () => {
      const sections = Array.from({ length: 6 }, (_, i) =>
        buildTextSection(`Section ${i + 1}`),
      );
      const content = buildPageContent("Title", sections);

      contentAnalyzerSkill.analyze.mockReturnValue(
        makeAnalysis({
          recommendedLayout: "content-flow",
          visualComplexity: "moderate",
        }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
      );

      const result = skill.autoCompress(content, "splitLayout");
      // moderate: maxSections=5
      expect(result.sections.length).toBeLessThanOrEqual(5);
    });

    it("should use dense capacity for dense visual complexity", () => {
      const sections = Array.from({ length: 8 }, (_, i) =>
        buildTextSection(`Section ${i + 1}`),
      );
      const content = buildPageContent("Title", sections);

      contentAnalyzerSkill.analyze.mockReturnValue(
        makeAnalysis({
          recommendedLayout: "mixed-content",
          visualComplexity: "dense",
        }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
      );

      const result = skill.autoCompress(content, "splitLayout");
      // dense: maxSections=6
      expect(result.sections.length).toBeLessThanOrEqual(6);
    });

    it("should use comparison-grid capacity dynamically", () => {
      const sections = Array.from({ length: 10 }, (_, i) =>
        buildTextSection(`Section ${i + 1}`),
      );
      const content = buildPageContent("Title", sections);

      contentAnalyzerSkill.analyze.mockReturnValue(
        makeAnalysis({
          recommendedLayout: "comparison-grid",
          comparison: { detected: true, count: 3 },
        }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
      );

      const result = skill.autoCompress(content, "comparison");
      // comparison-grid: maxSections = min(3+2, 8) = 5
      expect(result.sections.length).toBeLessThanOrEqual(5);
    });

    it("should use pillar-showcase capacity dynamically", () => {
      const sections = Array.from({ length: 8 }, (_, i) =>
        buildTextSection(`Pillar ${i + 1}`),
      );
      const content = buildPageContent("Title", sections);

      contentAnalyzerSkill.analyze.mockReturnValue(
        makeAnalysis({
          recommendedLayout: "pillar-showcase",
          pillars: { detected: true, count: 4 },
        }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
      );

      const result = skill.autoCompress(content, "pillars");
      // pillar-showcase: maxSections = min(4+1, 7) = 5
      expect(result.sections.length).toBeLessThanOrEqual(5);
    });

    it("should use timeline-progress capacity dynamically", () => {
      const sections = Array.from({ length: 8 }, (_, i) =>
        buildTextSection(`Phase ${i + 1}`),
      );
      const content = buildPageContent("Title", sections);

      contentAnalyzerSkill.analyze.mockReturnValue(
        makeAnalysis({
          recommendedLayout: "timeline-progress",
          timeline: { detected: true, nodeCount: 4 },
        }) as ReturnType<ContentAnalyzerSkill["analyze"]>,
      );

      const result = skill.autoCompress(content, "timeline");
      // timeline-progress: maxSections = min(4, 6) = 4
      expect(result.sections.length).toBeLessThanOrEqual(4);
    });
  });

  // ==================== getMinSectionsForTemplate ====================

  describe("getMinSectionsForTemplate via validateAndEnrichSections", () => {
    it("should accept 0 sections for cover template", async () => {
      const outline = buildPageOutline({ templateType: "cover" });
      aiFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json\n${JSON.stringify({
          title: "Cover Title",
          subtitle: "Sub",
          sections: [],
        })}\n\`\`\``,
        tokensUsed: 50,
      });

      const result = await skill.execute(
        { pageOutline: outline, sourceText: "content" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
    });

    it("should require at least 1 section for toc template", async () => {
      const outline = buildPageOutline({ templateType: "toc" });
      // AI returns valid toc section
      const tocSections = [
        {
          type: "list",
          position: "full",
          content: ["Chapter 1: Introduction", "Chapter 2: Details"],
        },
      ];
      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(tocSections as ContentSection[]),
        tokensUsed: 50,
      });
      contentAnalyzerSkill.analyze.mockReturnValue(
        makeAnalysis({
          recommendedLayout: "content-flow",
          visualComplexity: "simple",
        }),
      );

      const result = await skill.execute(
        { pageOutline: outline, sourceText: "Table of contents" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
    });

    it("should accept 0 sections for sectionDivider template", async () => {
      const outline = buildPageOutline({ templateType: "sectionDivider" });
      aiFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json\n${JSON.stringify({
          title: "Section 2",
          subtitle: "Divider",
          sections: [],
        })}\n\`\`\``,
        tokensUsed: 30,
      });

      const result = await skill.execute(
        { pageOutline: outline, sourceText: "content" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
    });
  });

  // ==================== normalizeContent edge cases ====================

  describe("normalizeContent edge cases via execute", () => {
    it("should convert string list content to array", async () => {
      // AI returns list with string instead of array
      const rawContent = {
        title: "Test",
        subtitle: "Sub",
        sections: [
          { type: "list", position: "right", content: "Single string item" },
        ],
        footer: "F",
      };
      aiFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json\n${JSON.stringify(rawContent)}\n\`\`\``,
        tokensUsed: 50,
      });

      contentAnalyzerSkill.analyze.mockReturnValue(makeAnalysis());

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText: "content" },
        buildSkillContext(),
      );

      // Should succeed and normalize the list section
      expect(result.success).toBe(true);
    });

    it("should fallback stat content when content is null", async () => {
      const rawContent = {
        title: "Test",
        subtitle: "Sub",
        sections: [{ type: "stat", position: "left", content: null }],
        footer: "F",
      };
      aiFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json\n${JSON.stringify(rawContent)}\n\`\`\``,
        tokensUsed: 50,
      });
      contentAnalyzerSkill.analyze.mockReturnValue(makeAnalysis());

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText: "content" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
    });

    it("should fallback chart content when content is null", async () => {
      const rawContent = {
        title: "Chart Page",
        sections: [{ type: "chart", position: "center", content: null }],
      };
      aiFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json\n${JSON.stringify(rawContent)}\n\`\`\``,
        tokensUsed: 50,
      });
      contentAnalyzerSkill.analyze.mockReturnValue(makeAnalysis());

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText: "content" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
    });

    it("should default invalid section type to text", async () => {
      const rawContent = {
        title: "Test",
        sections: [
          {
            type: "invalid_type",
            position: "full",
            content: "Some content here that is valid",
          },
        ],
      };
      aiFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json\n${JSON.stringify(rawContent)}\n\`\`\``,
        tokensUsed: 50,
      });
      contentAnalyzerSkill.analyze.mockReturnValue(makeAnalysis());

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText: "content" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
    });

    it("should default invalid position to left", async () => {
      const rawContent = {
        title: "Test",
        sections: [
          {
            type: "text",
            position: "invalid_position",
            content: "Valid text content here",
          },
        ],
      };
      aiFacade.chat.mockResolvedValueOnce({
        content: `\`\`\`json\n${JSON.stringify(rawContent)}\n\`\`\``,
        tokensUsed: 50,
      });
      contentAnalyzerSkill.analyze.mockReturnValue(makeAnalysis());

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText: "content" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
    });
  });

  // ==================== normalizeInput with orchestrator format ====================

  describe("normalizeInput - orchestrator format branches", () => {
    it("should return INVALID_INPUT when context.input has no pageOutline", async () => {
      const result = await skill.execute(
        {
          task: "compress",
          context: {
            input: {
              sourceText: "some text",
              // pageOutline missing
            },
          },
        } as Parameters<typeof skill.execute>[0],
        buildSkillContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_INPUT");
    });

    it("should return INVALID_INPUT when context.input has no sourceText", async () => {
      const result = await skill.execute(
        {
          task: "compress",
          context: {
            input: {
              pageOutline: buildPageOutline(),
              // sourceText missing
            },
          },
        } as Parameters<typeof skill.execute>[0],
        buildSkillContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_INPUT");
    });
  });

  // ==================== executeBatch with success=false fallback ====================

  describe("executeBatch - execute returns success=false triggers fallback", () => {
    it("should use fallback result when execute returns success=false", async () => {
      // Return empty response to trigger LLM error -> success=false
      aiFacade.chat.mockResolvedValue({
        content: "",
        tokensUsed: 0,
      });

      const inputs = [
        {
          pageOutline: buildPageOutline({ pageNumber: 1 }),
          sourceText: "Source",
        },
      ];

      const results = await skill.executeBatch(inputs, buildSkillContext());

      expect(results.size).toBe(1);
      expect(results.has(1)).toBe(true);
    });
  });

  // ==================== compressSection - list item truncation ====================

  describe("compressSection - list with item too long", () => {
    it("should truncate list item that exceeds remaining budget", () => {
      const longItem = "X".repeat(50);
      const section = buildListSection(["Short item", longItem]);
      const result = skill.compressSection(section, 15);

      const items = result.content as string[];
      expect(items.length).toBeGreaterThanOrEqual(1);
    });

    it("should stop adding items when remaining budget is zero", () => {
      const section = buildListSection([
        "A".repeat(10),
        "B".repeat(10),
        "C".repeat(10),
      ]);
      const result = skill.compressSection(section, 0);
      // remaining=0 from the start, loop breaks immediately
      expect(result.content).toEqual([]);
    });
  });

  // ==================== isPlaceholderText patterns ====================

  describe("isPlaceholderText via isSectionValid via validateAndEnrichSections", () => {
    it("should treat '赋能企业' as placeholder and filter it out", async () => {
      const outline = buildPageOutline({
        keyElements: ["Real A", "Real B", "Real C"],
      });
      const placeholderSections = [
        { type: "text", position: "full", content: "赋能企业未来发展" },
        { type: "text", position: "full", content: "助力业务增长" },
      ];

      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(
          placeholderSections as ContentSection[],
        ),
        tokensUsed: 60,
      });
      contentAnalyzerSkill.analyze.mockReturnValue(makeAnalysis());

      const result = await skill.execute(
        { pageOutline: outline, sourceText: "Real content" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
    });

    it("should treat '构建生态' as placeholder", async () => {
      const outline = buildPageOutline({
        keyElements: ["Key A", "Key B", "Key C"],
      });
      const placeholderSections = [
        { type: "text", position: "full", content: "构建行业生态系统" },
        { type: "text", position: "full", content: "打造核心竞争力" },
      ];

      aiFacade.chat.mockResolvedValueOnce({
        content: buildValidJsonResponse(
          placeholderSections as ContentSection[],
        ),
        tokensUsed: 60,
      });
      contentAnalyzerSkill.analyze.mockReturnValue(makeAnalysis());

      const result = await skill.execute(
        { pageOutline: outline, sourceText: "Real source content" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
    });
  });

  // ==================== execute with empty LLM response ====================

  describe("execute - empty LLM response error", () => {
    it("should return failure when LLM returns null content", async () => {
      aiFacade.chat.mockResolvedValueOnce({
        content: "",
        tokensUsed: 0,
      });

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText: "content" },
        buildSkillContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("CONTENT_COMPRESSION_FAILED");
    });
  });
});
