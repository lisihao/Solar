/**
 * Unit tests for SmartContentExtractorSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SmartContentExtractorSkill } from "../smart-content-extractor.skill";

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-smart-content-extractor",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
});

const buildPageOutline = (
  title = "AI Market Growth",
  contentBrief = "Overview of AI market trends",
  keyElements: string[] = ["Revenue growth", "Market share", "Key players"],
) => ({
  pageNumber: 2,
  title,
  subtitle: "Key Findings",
  templateType: "content" as const,
  contentBrief,
  keyElements,
  layoutHints: [],
});

describe("SmartContentExtractorSkill", () => {
  let skill: SmartContentExtractorSkill;

  const mockFacade = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: SmartContentExtractorSkill,
          useFactory: () => new SmartContentExtractorSkill(mockFacade as any),
        },
      ],
    }).compile();

    skill = module.get<SmartContentExtractorSkill>(SmartContentExtractorSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-smart-content-extractor");
    expect(skill.name).toBe("Smart Content Extractor");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("1.0.0");
    expect(skill.tags).toContain("slides");
    expect(skill.tags).toContain("extraction");
  });

  // --------------------------------------------------------------------------
  // Empty sourceText
  // --------------------------------------------------------------------------

  describe("empty sourceText", () => {
    it("should return empty results for empty string sourceText", async () => {
      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText: "" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.relevantParagraphs).toHaveLength(0);
      expect(result.data!.dataPoints).toHaveLength(0);
      expect(result.data!.quotes).toHaveLength(0);
      expect(result.data!.promptFragment).toBe("");
    });
  });

  // --------------------------------------------------------------------------
  // Paragraph splitting
  // --------------------------------------------------------------------------

  describe("paragraph splitting", () => {
    it("should split source text on double newlines", async () => {
      const sourceText = [
        "The AI market revenue grew 25% last year.",
        "Investment in AI startups reached $10 billion.",
        "Major players include OpenAI, Google, and Microsoft.",
      ].join("\n\n");

      const result = await skill.execute(
        {
          pageOutline: buildPageOutline(
            "AI Market Revenue",
            "Revenue analysis",
            ["revenue", "investment"],
          ),
          sourceText,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.relevantParagraphs.length).toBeGreaterThan(0);
    });

    it("should filter out short paragraphs (less than 20 chars)", async () => {
      const sourceText = [
        "Short.", // too short — should be filtered
        "The AI market revenue grew by 25% last year, reaching record levels across all sectors.",
        "Hi.", // too short — should be filtered
        "Investment in AI startups reached $10 billion in the current fiscal year period.",
      ].join("\n\n");

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // Only the two long paragraphs should survive
      expect(result.data!.relevantParagraphs.length).toBeLessThanOrEqual(2);
      result.data!.relevantParagraphs.forEach((p) => {
        expect(p.length).toBeGreaterThan(20);
      });
    });

    it("should return at most 8 relevant paragraphs", async () => {
      const paragraphs = Array.from(
        { length: 15 },
        (_, i) =>
          `Paragraph ${i + 1}: This is a detailed paragraph about AI revenue growth trends and market analysis.`,
      );
      const sourceText = paragraphs.join("\n\n");

      const result = await skill.execute(
        {
          pageOutline: buildPageOutline("Revenue", "Revenue trends", [
            "revenue",
            "paragraph",
          ]),
          sourceText,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.relevantParagraphs.length).toBeLessThanOrEqual(8);
    });
  });

  // --------------------------------------------------------------------------
  // Keyword matching
  // --------------------------------------------------------------------------

  describe("keyword matching", () => {
    it("should rank paragraphs containing English keywords higher", async () => {
      const relevantParagraph =
        "Revenue growth in the AI market has been extraordinary, with market share expanding rapidly.";
      const irrelevantParagraph =
        "The weather was sunny with mild temperatures and clear skies throughout the entire weekend.";
      const sourceText = [irrelevantParagraph, relevantParagraph].join("\n\n");

      const result = await skill.execute(
        {
          pageOutline: buildPageOutline(
            "Market Analysis",
            "Revenue and market analysis",
            ["revenue", "market", "growth"],
          ),
          sourceText,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // The relevant paragraph should appear in results
      expect(result.data!.relevantParagraphs).toContain(relevantParagraph);
    });

    it("should match Chinese keywords from page outline", async () => {
      const chineseParagraph = "人工智能市场增长迅速，收入规模达到历史新高。";
      const englishIrrelevant =
        "The quick brown fox jumps over the lazy dog near the river bank.";
      const sourceText = [englishIrrelevant, chineseParagraph].join("\n\n");

      const result = await skill.execute(
        {
          pageOutline: buildPageOutline("AI市场分析", "人工智能收入增长分析", [
            "人工智能",
            "市场",
          ]),
          sourceText,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.relevantParagraphs).toContain(chineseParagraph);
    });
  });

  // --------------------------------------------------------------------------
  // Data point extraction
  // --------------------------------------------------------------------------

  describe("data point extraction", () => {
    it("should extract percentage values", async () => {
      const sourceText =
        "AI market revenue grew by 42% year over year, far exceeding analyst expectations.\n\nThis growth represents a 15% increase from the previous quarter.";

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const percentagePoints = result.data!.dataPoints.filter(
        (dp) => dp.type === "percentage",
      );
      expect(percentagePoints.length).toBeGreaterThan(0);
      const values = percentagePoints.map((dp) => dp.value);
      expect(values.some((v) => v.includes("%"))).toBe(true);
    });

    it("should extract numbers with units (million, billion)", async () => {
      const sourceText =
        "The market reached $5.2 billion in total investment last year.\n\nAnother $800 million was allocated to research and development activities.";

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const numberPoints = result.data!.dataPoints.filter(
        (dp) => dp.type === "number",
      );
      expect(numberPoints.length).toBeGreaterThan(0);
    });

    it("should extract trend data points", async () => {
      const sourceText =
        "Revenue continued to increase by 30% quarter over quarter throughout the year.\n\nThe market saw a significant growth of 45% in the enterprise segment compared to last year.";

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const trendPoints = result.data!.dataPoints.filter(
        (dp) => dp.type === "trend",
      );
      expect(trendPoints.length).toBeGreaterThan(0);
    });

    it("should deduplicate data points with same value", async () => {
      // Repeat the same percentage multiple times
      const sourceText = [
        "Revenue grew 25% in Q1.",
        "Revenue grew 25% in Q2.",
        "Revenue grew 25% in Q3.",
      ].join("\n\n");

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // Should deduplicate the "25%" value
      const values = result.data!.dataPoints.map((dp) => dp.value);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });

    it("should return at most 10 data points", async () => {
      const percentages = Array.from({ length: 20 }, (_, i) => `${i + 1}%`);
      const sourceText = percentages
        .map((p, i) => `Metric ${i + 1} grew by ${p} in the period.`)
        .join("\n\n");

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.dataPoints.length).toBeLessThanOrEqual(10);
    });
  });

  // --------------------------------------------------------------------------
  // Quote extraction
  // --------------------------------------------------------------------------

  describe("quote extraction", () => {
    it("should extract English double-quoted text", async () => {
      const sourceText =
        'The CEO stated "AI is transforming every aspect of modern business." in the annual report.\n\nResearchers noted "This represents the most significant shift in decades."';

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.quotes.length).toBeGreaterThan(0);
      expect(result.data!.quotes[0]).toContain("AI is transforming");
    });

    it("should extract Chinese curly-quoted text (\u201c...\u201d)", async () => {
      const sourceText =
        "\u201c人工智能将彻底改变商业格局，引领下一轮技术革命。\u201d\n\n研究表明人工智能的应用已经渗透到各个行业。";

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.quotes.length).toBeGreaterThan(0);
      expect(result.data!.quotes[0]).toContain("人工智能将彻底改变");
    });

    it("should return at most 5 quotes", async () => {
      const sourceText = Array.from(
        { length: 10 },
        (_, i) =>
          `Expert ${i + 1} said "This is an important insight number ${i + 1} about the topic."`,
      ).join("\n\n");

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.quotes.length).toBeLessThanOrEqual(5);
    });
  });

  // --------------------------------------------------------------------------
  // promptFragment structure
  // --------------------------------------------------------------------------

  describe("promptFragment structure", () => {
    it("should include page title in promptFragment", async () => {
      const pageOutline = buildPageOutline("Quarterly Revenue Analysis");
      const sourceText =
        "Revenue analysis for the current quarter showed significant improvement across all segments.\n\nThe data indicates a positive trend in market performance.";

      const result = await skill.execute(
        { pageOutline, sourceText },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.promptFragment).toContain(
        "Quarterly Revenue Analysis",
      );
    });

    it("should include Key Passages section when paragraphs are found", async () => {
      const sourceText =
        "The AI market revenue grew significantly in this period.\n\nInvestment reached new heights as venture capital flowed into the sector.";

      const result = await skill.execute(
        {
          pageOutline: buildPageOutline("Market", "Market analysis", [
            "market",
            "revenue",
          ]),
          sourceText,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.promptFragment).toContain("Key Passages");
    });

    it("should include Data Points section when data points are found", async () => {
      const sourceText =
        "Revenue grew by 35% year over year, reaching record highs.\n\nInvestment of $2 billion was deployed across multiple initiatives.";

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      if (result.data!.dataPoints.length > 0) {
        expect(result.data!.promptFragment).toContain("Data Points");
      }
    });

    it("should include Notable Quotes section when quotes are found", async () => {
      const sourceText =
        'The report noted "AI adoption has accelerated beyond all expectations this year."\n\nFurther analysis confirmed the trend.';

      const result = await skill.execute(
        { pageOutline: buildPageOutline(), sourceText },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      if (result.data!.quotes.length > 0) {
        expect(result.data!.promptFragment).toContain("Notable Quotes");
      }
    });
  });

  // --------------------------------------------------------------------------
  // Without AI facade
  // --------------------------------------------------------------------------

  describe("without AIFacade", () => {
    let skillWithoutFacade: SmartContentExtractorSkill;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          {
            provide: SmartContentExtractorSkill,
            useFactory: () => new SmartContentExtractorSkill(undefined),
          },
        ],
      }).compile();

      skillWithoutFacade = module.get<SmartContentExtractorSkill>(
        SmartContentExtractorSkill,
      );
    });

    it("should succeed without AI facade using keyword-based ranking", async () => {
      const sourceText =
        "Revenue analysis shows strong growth patterns.\n\nMarket share data indicates positive trends in the sector.";

      const result = await skillWithoutFacade.execute(
        { pageOutline: buildPageOutline(), sourceText },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.relevantParagraphs.length).toBeGreaterThan(0);
    });

    it("should not call LLM ranking when facade is absent", async () => {
      // Build text with more than 10 candidate paragraphs
      const paragraphs = Array.from(
        { length: 12 },
        (_, i) =>
          `Revenue paragraph ${i + 1}: detailed analysis of market revenue growth in the current year.`,
      );
      const sourceText = paragraphs.join("\n\n");

      const result = await skillWithoutFacade.execute(
        {
          pageOutline: buildPageOutline("Revenue", "Revenue analysis", [
            "revenue",
            "market",
          ]),
          sourceText,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // Should succeed without LLM — facade is absent
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // LLM ranking (when > 10 candidates)
  // --------------------------------------------------------------------------

  describe("LLM ranking for large candidate sets", () => {
    it("should call LLM when candidate paragraphs exceed 10", async () => {
      const paragraphs = Array.from(
        { length: 12 },
        (_, i) =>
          `Revenue and market paragraph ${i + 1}: The AI revenue market grew significantly with market share expanding rapidly across all major sectors.`,
      );
      const sourceText = paragraphs.join("\n\n");

      mockFacade.chat.mockResolvedValue({
        content: "1,2,3,4,5,6,7,8",
        isError: false,
      });

      const result = await skill.execute(
        {
          pageOutline: buildPageOutline(
            "Revenue Market",
            "Revenue market analysis",
            ["revenue", "market"],
          ),
          sourceText,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(mockFacade.chat).toHaveBeenCalled();
    });

    it("should fall back to keyword ranking when LLM ranking fails", async () => {
      const paragraphs = Array.from(
        { length: 12 },
        (_, i) =>
          `AI revenue market analysis paragraph ${i + 1} with detailed revenue market growth information for comprehensive study.`,
      );
      const sourceText = paragraphs.join("\n\n");

      mockFacade.chat.mockRejectedValue(new Error("LLM service unavailable"));

      const result = await skill.execute(
        {
          pageOutline: buildPageOutline("Revenue", "Revenue market", [
            "revenue",
            "market",
          ]),
          sourceText,
        },
        buildSkillContext(),
      );

      // Should still succeed using keyword-based ranking fallback
      expect(result.success).toBe(true);
      expect(result.data!.relevantParagraphs.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  describe("result metadata", () => {
    it("should include executionId in metadata", async () => {
      const result = await skill.execute(
        {
          pageOutline: buildPageOutline(),
          sourceText: "Some relevant content here.",
        },
        buildSkillContext("exec-xyz-42"),
      );

      expect(result.metadata?.executionId).toBe("exec-xyz-42");
    });

    it("should include timing in metadata", async () => {
      const result = await skill.execute(
        {
          pageOutline: buildPageOutline(),
          sourceText: "Some relevant content here.",
        },
        buildSkillContext(),
      );

      expect(result.metadata?.startTime).toBeInstanceOf(Date);
      expect(result.metadata?.endTime).toBeInstanceOf(Date);
      expect(typeof result.metadata?.duration).toBe("number");
    });
  });
});
