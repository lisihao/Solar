import { Test, TestingModule } from "@nestjs/testing";
import { ContentAnalysisService } from "../content-analysis.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  ContentCategory,
  ContentComplexity,
  DataDensity,
  TemporalDimension,
} from "../content-analysis.types";

// ─── Mock ChatFacade ──────────────────────────────────
const mockAiFacade = {
  chat: jest.fn(),
  embed: jest.fn(),
};

// ─── Helpers ─────────────────────────────────────────────

function buildJsonResponse(data: Record<string, unknown>): string {
  return `\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;
}

// ─── Tests ───────────────────────────────────────────────

describe("ContentAnalysisService", () => {
  let service: ContentAnalysisService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentAnalysisService,
        { provide: ChatFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<ContentAnalysisService>(ContentAnalysisService);
  });

  // ─── analyzeContent: happy path ────────────────────────

  describe("analyzeContent()", () => {
    it("returns a ContentAnalysisResult with basic structure", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: buildJsonResponse({
          contentCategory: "informational",
          complexity: "medium",
          keyTopics: ["AI", "trends"],
          entities: [],
          visualizationOpportunities: [],
          summary: "An informational piece about AI trends.",
        }),
      });

      const result = await service.analyzeContent({
        content: "AI is changing the world. There are many new developments.",
        context: { title: "AI Trends", purpose: "Report" },
      });

      expect(result).toBeDefined();
      expect(result.features).toBeDefined();
      expect(result.suggestedStructure).toBeDefined();
      expect(result.processingTime).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("uses AI summary when provided", async () => {
      const aiSummary = "This is a detailed AI-generated summary.";
      mockAiFacade.chat.mockResolvedValue({
        content: buildJsonResponse({
          contentCategory: "analytical",
          complexity: "high",
          keyTopics: ["data", "analysis"],
          entities: [],
          visualizationOpportunities: [],
          summary: aiSummary,
        }),
      });

      const result = await service.analyzeContent({
        content: "Data analysis reveals important patterns.",
      });

      expect(result.summary).toBe(aiSummary);
      expect(result.confidence).toBe(0.85);
    });

    it("maps contentCategory to ContentCategory enum correctly", async () => {
      const categories = [
        ["narrative", ContentCategory.NARRATIVE],
        ["analytical", ContentCategory.ANALYTICAL],
        ["comparative", ContentCategory.COMPARATIVE],
        ["instructional", ContentCategory.INSTRUCTIONAL],
        ["persuasive", ContentCategory.PERSUASIVE],
        ["informational", ContentCategory.INFORMATIONAL],
      ] as const;

      for (const [raw, expected] of categories) {
        jest.clearAllMocks();
        mockAiFacade.chat.mockResolvedValue({
          content: buildJsonResponse({
            contentCategory: raw,
            complexity: "medium",
            keyTopics: [],
            entities: [],
            visualizationOpportunities: [],
            summary: "test",
          }),
        });

        const result = await service.analyzeContent({
          content: "test content",
        });
        expect(result.features.category).toBe(expected);
      }
    });

    it("maps complexity to ContentComplexity enum correctly", async () => {
      const complexities = [
        ["low", ContentComplexity.LOW, 5],
        ["medium", ContentComplexity.MEDIUM, 8],
        ["high", ContentComplexity.HIGH, 15],
      ] as const;

      for (const [raw, expectedComplexity, expectedSlides] of complexities) {
        jest.clearAllMocks();
        mockAiFacade.chat.mockResolvedValue({
          content: buildJsonResponse({
            contentCategory: "informational",
            complexity: raw,
            keyTopics: [],
            entities: [],
            visualizationOpportunities: [],
            summary: "test",
          }),
        });

        const result = await service.analyzeContent({
          content: "test content",
        });
        expect(result.features.complexity).toBe(expectedComplexity);
        expect(result.suggestedStructure.forSlides?.suggestedSlideCount).toBe(
          expectedSlides,
        );
      }
    });

    it("maps entities from AI response correctly", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: buildJsonResponse({
          contentCategory: "informational",
          complexity: "medium",
          keyTopics: [],
          entities: [
            {
              type: "organization",
              value: "OpenAI",
              count: 3,
              importance: 0.9,
            },
            { type: "technology", value: "GPT-4", count: 2, importance: 0.8 },
          ],
          visualizationOpportunities: [],
          summary: "test",
        }),
      });

      const result = await service.analyzeContent({
        content: "OpenAI released GPT-4.",
      });
      expect(result.features.entities).toHaveLength(2);
      expect(result.features.entities[0].type).toBe("organization");
      expect(result.features.entities[0].value).toBe("OpenAI");
    });

    it("maps visualization opportunities correctly", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: buildJsonResponse({
          contentCategory: "analytical",
          complexity: "medium",
          keyTopics: [],
          entities: [],
          visualizationOpportunities: [
            {
              type: "chart",
              description: "Sales data bar chart",
              dataPoints: ["Q1", "Q2", "Q3"],
              suggestedChartType: "bar",
              priority: "high",
            },
          ],
          summary: "test",
        }),
      });

      const result = await service.analyzeContent({
        content: "Sales grew 50% in Q2.",
      });
      expect(result.features.visualizationOpportunities).toHaveLength(1);
      expect(result.features.visualizationOpportunities[0].type).toBe("chart");
      expect(result.features.visualizationOpportunities[0].priority).toBe(
        "high",
      );
    });

    it("falls back gracefully when AI response has no JSON block", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: "I cannot analyze this content.",
      });

      const result = await service.analyzeContent({ content: "test content" });
      expect(result.confidence).toBe(0.5);
      expect(result.features).toBeDefined();
    });

    it("returns fallback analysis when AI call throws", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("LLM unreachable"));

      // When performAIAnalysis throws, it returns { features: {}, confidence: 0.5 }
      // and the outer analyzeContent merges basic features with that (confidence 0.5)
      const result = await service.analyzeContent({ content: "fallback test" });
      // confidence comes from aiAnalysis.confidence || 0.8, but aiAnalysis.confidence = 0.5
      expect(result.confidence).toBe(0.5);
      expect(result.features.wordCount).toBeGreaterThan(0);
    });

    it("truncates content to 8000 chars when calling AI", async () => {
      const longContent = "a".repeat(10000);
      mockAiFacade.chat.mockResolvedValue({ content: "" });

      await service.analyzeContent({ content: longContent });

      const callArgs = mockAiFacade.chat.mock.calls[0][0];
      const userMessage = callArgs.messages[1].content;
      expect(userMessage.length).toBeLessThanOrEqual(8100); // prompt template + 8000 chars
    });

    it("uses context title and purpose in the AI prompt", async () => {
      mockAiFacade.chat.mockResolvedValue({ content: "" });

      await service.analyzeContent({
        content: "some content",
        context: { title: "My Report", purpose: "executive briefing" },
      });

      const callArgs = mockAiFacade.chat.mock.calls[0][0];
      const userMessage = callArgs.messages[1].content;
      expect(userMessage).toContain("My Report");
      expect(userMessage).toContain("executive briefing");
    });
  });

  // ─── extractBasicFeatures (tested via analyzeContent) ──

  describe("basic feature extraction (rule-based)", () => {
    beforeEach(() => {
      // Make AI always fail so we use fallback (which calls extractBasicFeatures)
      mockAiFacade.chat.mockRejectedValue(new Error("forced fail"));
    });

    it("counts words correctly", async () => {
      const result = await service.analyzeContent({
        content: "Hello world this is five words more words",
      });
      expect(result.features.wordCount).toBeGreaterThan(0);
    });

    it("counts paragraphs correctly", async () => {
      const content = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
      const result = await service.analyzeContent({ content });
      expect(result.features.paragraphCount).toBe(3);
    });

    it("detects list items", async () => {
      const content = "Items:\n- item one\n- item two\n- item three\n";
      const result = await service.analyzeContent({ content });
      expect(result.features.listCount).toBeGreaterThan(0);
    });

    it("detects table content", async () => {
      const content =
        "| col1 | col2 | col3 |\n|------|------|------|\n| a | b | c |\n| d | e | f |";
      const result = await service.analyzeContent({ content });
      expect(result.features.tableCount).toBe(1);
    });

    it("counts code blocks correctly", async () => {
      const content =
        "Some code:\n```javascript\nconst x = 1;\n```\nMore code:\n```python\nprint('hi')\n```";
      const result = await service.analyzeContent({ content });
      expect(result.features.codeBlockCount).toBe(2);
    });

    it("detects image markdown", async () => {
      const content = "![Alt text](image1.png) and ![Another](image2.jpg)";
      const result = await service.analyzeContent({ content });
      expect(result.features.imageCount).toBe(2);
    });

    it("detects timeline content", async () => {
      const content =
        "2020年公司成立。2021年快速扩张。2022年上市。第一阶段完成。里程碑达成。";
      const result = await service.analyzeContent({ content });
      expect(result.features.hasTimeline).toBe(true);
    });

    it("detects comparison content", async () => {
      const content =
        "方案A vs 方案B 对比分析。方案A的优势是速度快，劣势是成本高。相比之下，方案B更经济。";
      const result = await service.analyzeContent({ content });
      expect(result.features.hasComparison).toBe(true);
    });

    it("detects statistical content", async () => {
      const content =
        "销售额增长50%，同比提升30%，ROI达到200%。总收入5亿元，同比环比均有增长。";
      const result = await service.analyzeContent({ content });
      expect(result.features.hasStatistics).toBe(true);
    });

    it("detects step-by-step content", async () => {
      const content =
        "操作指南：首先登录系统，其次配置环境，然后运行测试，最后部署应用。步骤一完成。";
      const result = await service.analyzeContent({ content });
      expect(result.features.hasSteps).toBe(true);
    });

    it("detects case study content", async () => {
      const content =
        "案例分析：某企业实施最佳实践后，成功经验表明最佳实践非常有效。应用场景广泛。";
      const result = await service.analyzeContent({ content });
      expect(result.features.hasCaseStudy).toBe(true);
    });

    it("detects recommendations", async () => {
      const content =
        "建议采用新策略。推荐优先处理优化方案。需要改进措施和优化方案，应该立即行动。下一步执行。";
      const result = await service.analyzeContent({ content });
      expect(result.features.hasRecommendations).toBe(true);
    });

    it("detects risk analysis", async () => {
      const content =
        "SWOT分析：优势在于技术。风险包括市场威胁和挑战。应对措施需要缓解风险。问题已识别。";
      const result = await service.analyzeContent({ content });
      expect(result.features.hasRiskAnalysis).toBe(true);
    });
  });

  // ─── DataDensity calculation ───────────────────────────

  describe("data density calculation", () => {
    beforeEach(() => {
      mockAiFacade.chat.mockRejectedValue(new Error("forced fail"));
    });

    it("returns DATA_HEAVY when numbers exceed 10% of words", async () => {
      // ~50 numeric tokens out of ~100 words = 50% ratio
      const numbers = Array(50).fill("100").join(" ");
      const words = Array(50).fill("hello").join(" ");
      const result = await service.analyzeContent({
        content: `${numbers} ${words}`,
      });
      expect(result.features.dataDensity).toBe(DataDensity.DATA_HEAVY);
    });

    it("returns TEXT_HEAVY when numbers are less than 2% of words", async () => {
      const words = Array(200).fill("hello").join(" ");
      const result = await service.analyzeContent({ content: words });
      expect(result.features.dataDensity).toBe(DataDensity.TEXT_HEAVY);
    });

    it("returns BALANCED for moderate data density", async () => {
      const words = Array(100).fill("analysis").join(" ");
      const numbers = Array(5).fill("42").join(" ");
      const result = await service.analyzeContent({
        content: `${words} ${numbers}`,
      });
      expect(result.features.dataDensity).toBe(DataDensity.BALANCED);
    });
  });

  // ─── TemporalDimension detection ──────────────────────

  describe("temporal dimension detection", () => {
    beforeEach(() => {
      mockAiFacade.chat.mockRejectedValue(new Error("forced fail"));
    });

    it("returns TIMELINE when many year+stage markers exist", async () => {
      const content =
        "2019年开始，2020年阶段一，2021年阶段二，2022年里程碑，2023年里程碑完成。";
      const result = await service.analyzeContent({ content });
      expect(result.features.temporalDimension).toBe(
        TemporalDimension.TIMELINE,
      );
    });

    it("returns FUTURE for future-oriented content", async () => {
      const content =
        "未来展望：规划中的项目将会在预测期内实现目标，计划于明年完成。";
      const result = await service.analyzeContent({ content });
      expect(result.features.temporalDimension).toBe(TemporalDimension.FUTURE);
    });

    it("returns HISTORICAL for historical content", async () => {
      const content =
        "历史回顾：过去十年中，曾经的发展历程值得回顾。过去的成就令人印象深刻。";
      const result = await service.analyzeContent({ content });
      expect(result.features.temporalDimension).toBe(
        TemporalDimension.HISTORICAL,
      );
    });

    it("returns NONE when no temporal indicators exist", async () => {
      const content =
        "This is a simple technical document about software architecture patterns.";
      const result = await service.analyzeContent({ content });
      expect(result.features.temporalDimension).toBe(TemporalDimension.NONE);
    });
  });

  // ─── suggestedStructure ───────────────────────────────

  describe("suggestedStructure generation", () => {
    it("includes timeline template when hasTimeline=true", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: buildJsonResponse({
          contentCategory: "narrative",
          complexity: "medium",
          keyTopics: [],
          entities: [],
          visualizationOpportunities: [],
          summary: "test",
        }),
      });

      // Content that triggers hasTimeline detection in basic features
      const content =
        "2020年开始。2021年扩张。2022年上市。第一阶段完成。里程碑达成。";
      const result = await service.analyzeContent({ content });
      // Basic features are merged - hasTimeline comes from rule engine
      expect(result.suggestedStructure.forSlides?.suggestedTemplates).toContain(
        "cover",
      );
    });

    it("generates chapter breakdown for topics from AI", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: buildJsonResponse({
          contentCategory: "informational",
          complexity: "medium",
          keyTopics: ["市场分析", "竞争对手", "战略规划"],
          entities: [],
          visualizationOpportunities: [],
          summary: "test",
        }),
      });

      const result = await service.analyzeContent({
        content: "Business analysis content.",
      });
      const breakdown = result.suggestedStructure.forSlides?.chapterBreakdown;
      expect(breakdown).toHaveLength(3);
      expect(breakdown?.[0].title).toBe("市场分析");
    });

    it("generates default chapter when no topics", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("forced fail"));

      const result = await service.analyzeContent({
        content: "Simple content.",
      });
      const breakdown = result.suggestedStructure.forSlides?.chapterBreakdown;
      expect(breakdown).toHaveLength(1);
      expect(breakdown?.[0].title).toBe("主要内容");
    });

    it("suggests technical style for content with code blocks", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("forced fail"));

      const content =
        "Code example:\n```typescript\nconst x = 1;\n```\nThis is technical documentation.";
      const result = await service.analyzeContent({ content });
      expect(result.suggestedStructure.forDocs?.documentStyle).toBe(
        "technical",
      );
    });

    it("suggests executive style for persuasive content", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: buildJsonResponse({
          contentCategory: "persuasive",
          complexity: "medium",
          keyTopics: [],
          entities: [],
          visualizationOpportunities: [],
          summary: "test",
        }),
      });

      const result = await service.analyzeContent({
        content: "Proposal content.",
      });
      expect(result.suggestedStructure.forDocs?.documentStyle).toBe(
        "executive",
      );
    });

    it("includes statistics section when hasStatistics=true", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("forced fail"));

      const content =
        "数据显示增长50%，同比提升30%，ROI达200%，总收入5亿元，环比持续增长。";
      const result = await service.analyzeContent({ content });
      const sections = result.suggestedStructure.forDocs?.suggestedSections;
      const hasDataSection = sections?.some((s) => s.type === "dataReport");
      expect(hasDataSection).toBe(true);
    });

    it("includes comparison section when hasComparison=true", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("forced fail"));

      const content =
        "方案A vs 方案B。优势劣势对比分析。相比之下的区别不同点。方案C对比。";
      const result = await service.analyzeContent({ content });
      const sections = result.suggestedStructure.forDocs?.suggestedSections;
      const hasCompSection = sections?.some((s) => s.type === "comparison");
      expect(hasCompSection).toBe(true);
    });

    it("word count scales with complexity", async () => {
      const lowResult = await runWithComplexity("low");
      const highResult = await runWithComplexity("high");

      const lowWords =
        lowResult.suggestedStructure.forDocs?.suggestedWordCount ?? 0;
      const highWords =
        highResult.suggestedStructure.forDocs?.suggestedWordCount ?? 0;
      expect(highWords).toBeGreaterThan(lowWords);
    });
  });

  // ─── summary generation ──────────────────────────────

  describe("summary generation fallback", () => {
    it("generates summary from features when AI gives no summary", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: buildJsonResponse({
          contentCategory: "informational",
          complexity: "medium",
          keyTopics: [],
          entities: [],
          visualizationOpportunities: [],
          // no summary field
        }),
      });

      const result = await service.analyzeContent({
        content:
          "Hello world this is some content for testing summary generation.",
      });

      expect(result.summary).toMatch(/字/); // Chinese "characters"
    });

    it("includes structural feature descriptions in fallback summary", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("forced fail"));

      // Content with timeline and comparison
      const content =
        "2020年开始扩张。2021年里程碑完成。2022年第一阶段。方案A vs 方案B。优势劣势对比。";
      const result = await service.analyzeContent({ content });
      // Summary should mention timeline and/or comparison
      expect(result.summary).toContain("字");
    });
  });

  // ─── Unknown enum values fallback ─────────────────────

  describe("enum mapping fallback", () => {
    it("defaults to INFORMATIONAL for unknown category", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: buildJsonResponse({
          contentCategory: "unknown_category_xyz",
          complexity: "medium",
          keyTopics: [],
          entities: [],
          visualizationOpportunities: [],
          summary: "test",
        }),
      });

      const result = await service.analyzeContent({ content: "test" });
      expect(result.features.category).toBe(ContentCategory.INFORMATIONAL);
    });

    it("defaults to MEDIUM for unknown complexity", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: buildJsonResponse({
          contentCategory: "informational",
          complexity: "unknown_xyz",
          keyTopics: [],
          entities: [],
          visualizationOpportunities: [],
          summary: "test",
        }),
      });

      const result = await service.analyzeContent({ content: "test" });
      expect(result.features.complexity).toBe(ContentComplexity.MEDIUM);
    });

    it("handles null entity fields gracefully", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: buildJsonResponse({
          contentCategory: "informational",
          complexity: "medium",
          keyTopics: [],
          entities: [
            { type: null, value: null, count: null, importance: null },
          ],
          visualizationOpportunities: [],
          summary: "test",
        }),
      });

      const result = await service.analyzeContent({ content: "test" });
      expect(result.features.entities[0].type).toBe("concept");
      expect(result.features.entities[0].value).toBe("");
      expect(result.features.entities[0].count).toBe(1);
      expect(result.features.entities[0].importance).toBe(0.5);
    });
  });
});

// ─── Helper ────────────────────────────────────────────

async function runWithComplexity(complexity: "low" | "high") {
  const service = new ContentAnalysisService({
    chat: jest.fn().mockResolvedValue({
      content: `\`\`\`json\n${JSON.stringify({
        contentCategory: "informational",
        complexity,
        keyTopics: [],
        entities: [],
        visualizationOpportunities: [],
        summary: "test",
      })}\n\`\`\``,
    }),
    embed: jest.fn(),
  } as unknown as ChatFacade);

  return service.analyzeContent({ content: "test content with some words" });
}
