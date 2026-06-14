/**
 * QueryStrategyService Unit Tests
 *
 * Covers:
 * - generateQueries(): full bilingual pipeline
 *   - English-only input → translates to Chinese
 *   - Chinese-only input → translates to English
 *   - Mixed language input → handles correctly
 * - extractRawQueries(): dimension.searchQueries parsing
 * - batchTranslate(): LLM call, empty input, error handling
 * - enhanceWithTimestamp(): historical/trend/default cases, already-has-time
 * - containsChinese(): detection logic
 * - isTechnicalTopic(): keyword detection
 * - Source-specific query building (WEB, ACADEMIC, GITHUB, HACKERNEWS, SOCIAL_X, etc.)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { QueryStrategyService } from "../query-strategy.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { DataSourceType } from "../../../../types/data-source.types";

// ============================================================
// Helpers
// ============================================================

function makeTopic(overrides: Record<string, unknown> = {}) {
  return {
    id: "topic-1",
    name: "AI Technology",
    description: "AI tech research topic",
    userId: "user-1",
    language: "en",
    reportStyle: "COMPREHENSIVE",
    topicConfig: null,
    config: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDimension(overrides: Record<string, unknown> = {}) {
  return {
    id: "dim-1",
    name: "Technical Trends",
    description: "Technology trends dimension",
    topicId: "topic-1",
    status: "PENDING",
    searchSources: null,
    searchKeywords: [],
    searchQueries: null,
    priority: 1,
    order: 1,
    estimatedTime: 30,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ============================================================
// Mock
// ============================================================

const mockChatFacade = {
  chat: jest.fn(),
};

// ============================================================
// Tests
// ============================================================

describe("QueryStrategyService", () => {
  let service: QueryStrategyService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryStrategyService,
        { provide: ChatFacade, useValue: mockChatFacade },
      ],
    }).compile();

    service = module.get<QueryStrategyService>(QueryStrategyService);
  });

  // ===========================================================
  // generateQueries() — English input path
  // ===========================================================

  describe("generateQueries() — English input", () => {
    it("should translate English queries to Chinese", async () => {
      const topic = makeTopic({ name: "AI Technology" });
      const dimension = makeDimension({
        name: "Technical Trends",
        searchQueries: JSON.stringify([
          "AI technology trends",
          "machine learning",
        ]),
      });

      // Mock translation response: Chinese lines
      mockChatFacade.chat.mockResolvedValue({
        content: "AI技术趋势\n机器学习",
      });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result.language).toBe("en");
      expect(result.baseQueries.length).toBeGreaterThan(0);
      expect(result.sourceSpecific.has(DataSourceType.WEB)).toBe(true);
      expect(result.sourceSpecific.has(DataSourceType.ACADEMIC)).toBe(true);
      expect(result.sourceSpecific.has(DataSourceType.GITHUB)).toBe(true);
      expect(result.sourceSpecific.has(DataSourceType.HACKERNEWS)).toBe(true);
      expect(result.sourceSpecific.has(DataSourceType.SOCIAL_X)).toBe(true);
    });

    it("should set ACADEMIC, OPENALEX, SEMANTIC_SCHOLAR, PUBMED to English queries", async () => {
      const topic = makeTopic();
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["deep learning"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "深度学习" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const academicQueries = result.sourceSpecific.get(
        DataSourceType.ACADEMIC,
      );
      const openalexQueries = result.sourceSpecific.get(
        DataSourceType.OPENALEX,
      );
      const ssQueries = result.sourceSpecific.get(
        DataSourceType.SEMANTIC_SCHOLAR,
      );
      const pubmedQueries = result.sourceSpecific.get(DataSourceType.PUBMED);

      expect(academicQueries).toBeDefined();
      expect(openalexQueries).toEqual(academicQueries);
      expect(ssQueries).toEqual(academicQueries);
      expect(pubmedQueries).toEqual(academicQueries);
    });

    it("should include policy sources (FEDERAL_REGISTER, CONGRESS, WHITEHOUSE)", async () => {
      const topic = makeTopic();
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["AI regulation policy"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "AI法规政策" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result.sourceSpecific.has(DataSourceType.FEDERAL_REGISTER)).toBe(
        true,
      );
      expect(result.sourceSpecific.has(DataSourceType.CONGRESS)).toBe(true);
      expect(result.sourceSpecific.has(DataSourceType.WHITEHOUSE)).toBe(true);
      expect(result.sourceSpecific.has(DataSourceType.LOCAL)).toBe(true);
    });

    it("should deduplicate baseQueries", async () => {
      const topic = makeTopic();
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["AI trends", "AI trends"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "AI趋势" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const uniqueQueries = new Set(result.baseQueries);
      expect(uniqueQueries.size).toBe(result.baseQueries.length);
    });

    it("should cap baseQueries at 6", async () => {
      const topic = makeTopic();
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["query 1", "query 2", "query 3"]),
      });

      // Return many Chinese translations
      mockChatFacade.chat.mockResolvedValue({
        content: "查询1\n查询2\n查询3\n查询4\n查询5\n查询6\n查询7\n查询8",
      });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result.baseQueries.length).toBeLessThanOrEqual(6);
    });
  });

  // ===========================================================
  // generateQueries() — Chinese input path
  // ===========================================================

  describe("generateQueries() — Chinese input", () => {
    it("should translate Chinese queries to English", async () => {
      const topic = makeTopic({ name: "人工智能技术" });
      const dimension = makeDimension({
        name: "技术趋势",
        searchQueries: JSON.stringify(["人工智能发展", "机器学习应用"]),
      });

      mockChatFacade.chat.mockResolvedValue({
        content:
          "Artificial intelligence development\nMachine learning applications",
      });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result.language).toBe("zh");
      expect(result.baseQueries.length).toBeGreaterThan(0);
    });

    it("should include Chinese queries in WEB source-specific queries", async () => {
      const topic = makeTopic({ name: "AI研究" });
      const dimension = makeDimension({
        name: "技术分析",
        searchQueries: JSON.stringify(["机器学习"]),
      });

      mockChatFacade.chat.mockResolvedValue({
        content: "Machine learning",
      });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const webQueries = result.sourceSpecific.get(DataSourceType.WEB) ?? [];
      // Should have Chinese queries included in WEB
      const hasChinese = webQueries.some((q) => /[\u4e00-\u9fff]/.test(q));
      expect(hasChinese).toBe(true);
    });

    it("should include Chinese queries in SOCIAL_X", async () => {
      const topic = makeTopic({ name: "数字货币" });
      const dimension = makeDimension({
        name: "市场趋势",
        searchQueries: JSON.stringify(["数字货币政策"]),
      });

      mockChatFacade.chat.mockResolvedValue({
        content: "Digital currency policy",
      });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const socialQueries =
        result.sourceSpecific.get(DataSourceType.SOCIAL_X) ?? [];
      const hasChinese = socialQueries.some((q) => /[\u4e00-\u9fff]/.test(q));
      expect(hasChinese).toBe(true);
    });
  });

  // ===========================================================
  // generateQueries() — Mixed language input
  // ===========================================================

  describe("generateQueries() — Mixed language input", () => {
    it("should detect mixed language and translate Chinese to English", async () => {
      const topic = makeTopic({ name: "AI研究 Research" });
      const dimension = makeDimension({
        name: "技术趋势 Trends",
        searchQueries: JSON.stringify(["AI research", "机器学习"]),
      });

      mockChatFacade.chat.mockResolvedValue({
        content: "Machine learning",
      });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result.language).toBe("mixed");
    });
  });

  // ===========================================================
  // extractRawQueries() — dimension.searchQueries parsing
  // ===========================================================

  describe("extractRawQueries() — via generateQueries()", () => {
    it("should use topic.name + dimension.name as fallback when searchQueries is null", async () => {
      const topic = makeTopic({ name: "AI Topic" });
      const dimension = makeDimension({
        name: "Security Dimension",
        searchQueries: null,
      });

      mockChatFacade.chat.mockResolvedValue({ content: "AI话题" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      // Base query should include the fallback
      const allQueries = [
        ...result.baseQueries,
        ...(result.sourceSpecific.get(DataSourceType.WEB) ?? []),
      ].join(" ");
      expect(allQueries).toContain("AI Topic");
    });

    it("should parse searchQueries as JSON string", async () => {
      const topic = makeTopic({ name: "Test" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["query one", "query two"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "查询一\n查询二" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result.baseQueries).toContain("query one");
    });

    it("should use searchQueries as object (non-string) directly", async () => {
      const topic = makeTopic({ name: "Test" });
      const dimension = makeDimension({
        searchQueries: ["query from object"],
      });

      mockChatFacade.chat.mockResolvedValue({ content: "对象查询" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result.baseQueries).toContain("query from object");
    });

    it("should fallback when searchQueries JSON parse fails", async () => {
      const topic = makeTopic({ name: "Parse Fail" });
      const dimension = makeDimension({
        name: "Dimension",
        searchQueries: "{not valid json",
      });

      mockChatFacade.chat.mockResolvedValue({ content: "翻译" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      // Should fallback to topic.name + dimension.name
      const allBaseQueries = result.baseQueries.join(" ");
      expect(allBaseQueries).toContain("Parse Fail");
    });

    it("should fallback when searchQueries is not an array", async () => {
      const topic = makeTopic({ name: "Array Fail" });
      const dimension = makeDimension({
        name: "Test",
        searchQueries: JSON.stringify({ key: "value" }),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "翻译" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const allBaseQueries = result.baseQueries.join(" ");
      expect(allBaseQueries).toContain("Array Fail");
    });

    it("should filter out non-string and empty items from searchQueries", async () => {
      const topic = makeTopic({ name: "Filter Test" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["valid query", "", 42, null, "  "]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "有效查询" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result.baseQueries).toContain("valid query");
      // Should not contain empty strings or non-strings
      expect(result.baseQueries.every((q) => typeof q === "string")).toBe(true);
    });

    it("should cap raw queries at 3 items", async () => {
      const topic = makeTopic({ name: "Cap Test" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify([
          "query 1",
          "query 2",
          "query 3",
          "query 4",
          "query 5",
        ]),
      });

      // Should only translate up to 2 queries (for English → Chinese translation)
      mockChatFacade.chat.mockResolvedValue({ content: "查询1\n查询2" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      // Verify at most 3 original English queries used
      const englishInBase = result.baseQueries.filter(
        (q) => !/[\u4e00-\u9fff]/.test(q),
      );
      expect(englishInBase.length).toBeLessThanOrEqual(3);
    });

    it("should use fallback when all searchQueries items are invalid", async () => {
      const topic = makeTopic({ name: "Fallback Required" });
      const dimension = makeDimension({
        name: "Dim",
        searchQueries: JSON.stringify([42, null, false]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "翻译" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const allBaseQueries = result.baseQueries.join(" ");
      expect(allBaseQueries).toContain("Fallback Required");
    });
  });

  // ===========================================================
  // batchTranslate() — via generateQueries()
  // ===========================================================

  describe("batchTranslate() — via generateQueries()", () => {
    it("should return empty array when translate input is empty (no Chinese in English path)", async () => {
      // English path slices(0, 2) — if all 3 queries fill the slice, translate is still called
      // We test empty translation by having no queries to translate (zero English queries with
      // Chinese input would be translated — but chineseOnly = 0 doesn't call batchTranslate)
      const topic = makeTopic({ name: "Empty" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["机器学习"]),
      });

      // Simulate: only Chinese input, English-only = [], Chinese-only = ["机器学习"]
      // batchTranslate(["机器学习"], "en") is called
      mockChatFacade.chat.mockResolvedValue({ content: "Machine learning" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result.language).toBe("zh");
      expect(result.baseQueries.some((q) => q === "Machine learning")).toBe(
        true,
      );
    });

    it("should handle LLM error gracefully and return empty translated array", async () => {
      const topic = makeTopic({ name: "Error Topic" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["AI research"]),
      });

      mockChatFacade.chat.mockRejectedValue(new Error("LLM API Error"));

      // Should not throw
      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result).toBeDefined();
      expect(result.language).toBe("en");
      // English queries should still be present despite translation failure
      expect(result.baseQueries.some((q) => q === "AI research")).toBe(true);
    });

    it("should filter empty lines from LLM translation response", async () => {
      const topic = makeTopic({ name: "Filter Lines" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["AI trends"]),
      });

      mockChatFacade.chat.mockResolvedValue({
        content: "AI趋势\n\n  \n技术动态",
      });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const chineseBase = result.baseQueries.filter((q) =>
        /[\u4e00-\u9fff]/.test(q),
      );
      // Should only have non-empty lines
      expect(chineseBase.every((q) => q.trim().length > 0)).toBe(true);
    });

    it("should handle empty content response from LLM", async () => {
      const topic = makeTopic({ name: "Empty Content" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["AI research"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result).toBeDefined();
      // baseQueries should still have English queries
      expect(result.baseQueries.length).toBeGreaterThan(0);
    });

    it("should handle non-string content response from LLM", async () => {
      const topic = makeTopic({ name: "Non-String Content" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["AI research"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: null });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result).toBeDefined();
    });
  });

  // ===========================================================
  // enhanceWithTimestamp() — via generateQueries() WEB queries
  // ===========================================================

  describe("enhanceWithTimestamp() — via WEB queries", () => {
    it("should not add timestamp if query already contains a year", async () => {
      const topic = makeTopic({ name: "AI" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["AI research 2023"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "AI研究2023" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const webQueries = result.sourceSpecific.get(DataSourceType.WEB) ?? [];
      // Query with year should not have extra timestamp appended
      const query2023 = webQueries.find((q) => q.includes("2023"));
      expect(query2023).toBeDefined();
      // Should not be duplicated with "latest recent"
      if (query2023) {
        expect(query2023).toBe("AI research 2023");
      }
    });

    it("should not add timestamp if query contains 'latest'", async () => {
      const topic = makeTopic({ name: "AI" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["latest AI developments"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "最新AI发展" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const webQueries = result.sourceSpecific.get(DataSourceType.WEB) ?? [];
      const latestQuery = webQueries.find((q) =>
        q.startsWith("latest AI developments"),
      );
      if (latestQuery) {
        // Should NOT have additional " 2024 latest recent" appended
        expect(latestQuery).toBe("latest AI developments");
      }
    });

    it("should not add timestamp for historical dimension description", async () => {
      const topic = makeTopic({ name: "History" });
      const dimension = makeDimension({
        name: "Evolution",
        description: "The historical evolution and heritage of computing",
        searchQueries: JSON.stringify(["computing history"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "计算机历史" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const webQueries = result.sourceSpecific.get(DataSourceType.WEB) ?? [];
      // Historical dimension — no timestamp enhancement
      const histQuery = webQueries.find((q) => q === "computing history");
      expect(histQuery).toBeDefined();
    });

    it("should add 'latest trends' suffix for trend dimension description", async () => {
      const currentYear = new Date().getFullYear();
      const topic = makeTopic({ name: "AI" });
      const dimension = makeDimension({
        name: "Emerging Trends",
        description: "Future outlook and forecast for emerging AI trends",
        searchQueries: JSON.stringify(["AI forecast"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "AI预测" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const webQueries = result.sourceSpecific.get(DataSourceType.WEB) ?? [];
      const trendQuery = webQueries.find(
        (q) =>
          q.includes("AI forecast") &&
          q.includes("latest trends") &&
          q.includes(String(currentYear)),
      );
      expect(trendQuery).toBeDefined();
    });

    it("should add 'latest recent' suffix as default for regular dimension", async () => {
      const currentYear = new Date().getFullYear();
      const topic = makeTopic({ name: "AI" });
      const dimension = makeDimension({
        name: "Applications",
        description: "Current applications of AI technology",
        searchQueries: JSON.stringify(["AI applications"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "AI应用" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const webQueries = result.sourceSpecific.get(DataSourceType.WEB) ?? [];
      const defaultQuery = webQueries.find(
        (q) =>
          q.includes("AI applications") &&
          q.includes("latest recent") &&
          q.includes(String(currentYear)),
      );
      expect(defaultQuery).toBeDefined();
    });

    it("should not add timestamp for dimension with 'recent' in query", async () => {
      const topic = makeTopic({ name: "AI" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["recent AI breakthroughs"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "最近的AI突破" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const webQueries = result.sourceSpecific.get(DataSourceType.WEB) ?? [];
      const recentQuery = webQueries.find((q) =>
        q.startsWith("recent AI breakthroughs"),
      );
      if (recentQuery) {
        expect(recentQuery).toBe("recent AI breakthroughs");
      }
    });

    it("should handle non-string dimension description gracefully", async () => {
      const topic = makeTopic({ name: "AI" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify(["AI research"]),
        description: null, // non-string
      });

      mockChatFacade.chat.mockResolvedValue({ content: "AI研究" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result).toBeDefined();
    });
  });

  // ===========================================================
  // isTechnicalTopic() — via GITHUB queries
  // ===========================================================

  describe("isTechnicalTopic() — via GITHUB queries", () => {
    it("should enhance GITHUB query with 'framework OR library' for technical topic", async () => {
      const topic = makeTopic({ name: "API Development" });
      const dimension = makeDimension({
        name: "SDK Frameworks",
        searchQueries: JSON.stringify(["API design patterns"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "API设计模式" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const githubQueries =
        result.sourceSpecific.get(DataSourceType.GITHUB) ?? [];
      const enhanced = githubQueries.find((q) =>
        q.includes("framework OR library"),
      );
      expect(enhanced).toBeDefined();
    });

    it("should not add 'framework OR library' to GITHUB query if query already contains 'framework'", async () => {
      const topic = makeTopic({ name: "Python Framework" });
      const dimension = makeDimension({
        name: "Open Source",
        searchQueries: JSON.stringify(["web framework comparison"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "Web框架比较" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const githubQueries =
        result.sourceSpecific.get(DataSourceType.GITHUB) ?? [];
      const query = githubQueries.find((q) =>
        q.startsWith("web framework comparison"),
      );
      if (query) {
        // Should not have double "framework"
        expect(query).toBe("web framework comparison");
      }
    });

    it("should not enhance GITHUB query for non-technical topic", async () => {
      const topic = makeTopic({ name: "Cultural Heritage" });
      const dimension = makeDimension({
        name: "Traditions",
        searchQueries: JSON.stringify(["traditional music history"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "传统音乐历史" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const githubQueries =
        result.sourceSpecific.get(DataSourceType.GITHUB) ?? [];
      const enhanced = githubQueries.find((q) =>
        q.includes("framework OR library"),
      );
      expect(enhanced).toBeUndefined();
    });

    it("should detect technical topic by 'ai' keyword", async () => {
      const topic = makeTopic({ name: "AI Model Deployment" });
      const dimension = makeDimension({
        name: "LLM Infrastructure",
        searchQueries: JSON.stringify(["LLM deployment"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "LLM部署" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const githubQueries =
        result.sourceSpecific.get(DataSourceType.GITHUB) ?? [];
      const enhanced = githubQueries.some((q) =>
        q.includes("framework OR library"),
      );
      expect(enhanced).toBe(true);
    });

    it("should detect technical topic by 'software' keyword", async () => {
      const topic = makeTopic({ name: "Enterprise Software" });
      const dimension = makeDimension({
        name: "Platform Architecture",
        searchQueries: JSON.stringify(["software design"]),
      });

      mockChatFacade.chat.mockResolvedValue({ content: "软件设计" });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const githubQueries =
        result.sourceSpecific.get(DataSourceType.GITHUB) ?? [];
      const enhanced = githubQueries.some((q) =>
        q.includes("framework OR library"),
      );
      expect(enhanced).toBe(true);
    });
  });

  // ===========================================================
  // Source-specific query caps
  // ===========================================================

  describe("source-specific query limits", () => {
    it("should cap HACKERNEWS queries at 2", async () => {
      const topic = makeTopic({ name: "AI" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify([
          "query one",
          "query two",
          "query three",
        ]),
      });

      mockChatFacade.chat.mockResolvedValue({
        content: "查询一\n查询二\n查询三",
      });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const hnQueries =
        result.sourceSpecific.get(DataSourceType.HACKERNEWS) ?? [];
      expect(hnQueries.length).toBeLessThanOrEqual(2);
    });

    it("should cap GITHUB queries at 2", async () => {
      const topic = makeTopic({ name: "ML Framework" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify([
          "query one",
          "query two",
          "query three",
        ]),
      });

      mockChatFacade.chat.mockResolvedValue({
        content: "查询一\n查询二",
      });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const githubQueries =
        result.sourceSpecific.get(DataSourceType.GITHUB) ?? [];
      expect(githubQueries.length).toBeLessThanOrEqual(2);
    });

    it("should cap ACADEMIC queries at 3", async () => {
      const topic = makeTopic({ name: "AI" });
      const dimension = makeDimension({
        searchQueries: JSON.stringify([
          "deep learning",
          "neural networks",
          "reinforcement learning",
        ]),
      });

      mockChatFacade.chat.mockResolvedValue({
        content: "深度学习\n神经网络\n强化学习",
      });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      const academicQueries =
        result.sourceSpecific.get(DataSourceType.ACADEMIC) ?? [];
      expect(academicQueries.length).toBeLessThanOrEqual(3);
    });
  });

  // ===========================================================
  // Mixed scenario: both Chinese and English in searchQueries
  // ===========================================================

  describe("generateQueries() — mixed with englishOnly + chineseOnly", () => {
    it("should separate English and Chinese queries and translate Chinese to English", async () => {
      const topic = makeTopic({ name: "Tech" });
      const dimension = makeDimension({
        name: "Analysis",
        searchQueries: JSON.stringify(["AI analysis", "数据分析"]),
      });

      mockChatFacade.chat.mockResolvedValue({
        content: "Data analysis",
      });

      const result = await service.generateQueries(
        topic as any,
        dimension as any,
      );

      expect(result.language).toBe("mixed");
      // Both English original and translated Chinese should appear
      const allEnglish = result.baseQueries.filter(
        (q) => !/[\u4e00-\u9fff]/.test(q),
      );
      expect(allEnglish.length).toBeGreaterThan(0);
    });
  });
});
