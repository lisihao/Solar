import { Test, TestingModule } from "@nestjs/testing";
import { MultiLanguageResearchService } from "../multi-language-research.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { ResearchLanguage } from "../../../types/multi-language.types";

const mockAiFacade = {
  chat: jest.fn(),
};

describe("MultiLanguageResearchService", () => {
  let service: MultiLanguageResearchService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MultiLanguageResearchService,
        { provide: ChatFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<MultiLanguageResearchService>(
      MultiLanguageResearchService,
    );
  });

  // ============================================================
  // detectLanguage
  // ============================================================

  describe("detectLanguage", () => {
    it("should detect English language from AI response", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          primaryLanguage: "en",
          confidence: 0.99,
          isMultilingual: false,
          languageDistribution: [{ language: "en", percentage: 100 }],
        }),
      });

      const result = await service.detectLanguage(
        "This is an English text about AI.",
      );

      expect(result.primaryLanguage).toBe(ResearchLanguage.EN);
      expect(result.confidence).toBe(0.99);
      expect(result.isMultilingual).toBe(false);
    });

    it("should detect Chinese language", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          primaryLanguage: "zh",
          confidence: 0.95,
          isMultilingual: false,
          languageDistribution: [{ language: "zh", percentage: 100 }],
        }),
      });

      const result =
        await service.detectLanguage("这是一段关于人工智能的中文文本。");

      expect(result.primaryLanguage).toBe(ResearchLanguage.ZH);
    });

    it("should fall back to English on AI error", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("LLM error"));

      const result = await service.detectLanguage("Some text");

      expect(result.primaryLanguage).toBe(ResearchLanguage.EN);
      expect(result.confidence).toBe(0.5);
    });

    it("should handle malformed JSON response gracefully", async () => {
      mockAiFacade.chat.mockResolvedValue({ content: "not valid json" });

      const result = await service.detectLanguage("Some text");

      expect(result.primaryLanguage).toBe(ResearchLanguage.EN);
      expect(result.languageDistribution).toBeDefined();
    });
  });

  // ============================================================
  // generateCrossLanguageQueries
  // ============================================================

  describe("generateCrossLanguageQueries", () => {
    it("should return translated queries for target languages", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          translatedQueries: {
            zh: "人工智能趋势",
            ja: "人工知能のトレンド",
          },
          terminologyMapping: [
            {
              term: "artificial intelligence",
              translations: { zh: "人工智能", ja: "人工知能" },
              isProperNoun: false,
            },
          ],
        }),
      });

      const result = await service.generateCrossLanguageQueries({
        originalQuery: "artificial intelligence trends",
        sourceLanguage: ResearchLanguage.EN,
        targetLanguages: [ResearchLanguage.ZH, ResearchLanguage.JA],
      });

      expect(result.originalQuery).toBe("artificial intelligence trends");
      expect(result.translatedQueries[ResearchLanguage.ZH]).toBe(
        "人工智能趋势",
      );
      expect(result.terminologyMapping).toHaveLength(1);
    });

    it("should return empty translations on AI error", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("LLM error"));

      const result = await service.generateCrossLanguageQueries({
        originalQuery: "AI trends",
        sourceLanguage: ResearchLanguage.EN,
        targetLanguages: [ResearchLanguage.ZH],
      });

      expect(result.translatedQueries).toEqual({});
      expect(result.terminologyMapping).toEqual([]);
    });

    it("should include domain context in request", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          translatedQueries: {},
          terminologyMapping: [],
        }),
      });

      await service.generateCrossLanguageQueries({
        originalQuery: "AI trends",
        sourceLanguage: ResearchLanguage.EN,
        targetLanguages: [ResearchLanguage.ZH],
        domainContext: "technology research",
      });

      const callArgs = mockAiFacade.chat.mock.calls[0][0];
      expect(callArgs.messages[1].content).toContain("technology research");
    });
  });

  // ============================================================
  // normalizeEvidence
  // ============================================================

  describe("normalizeEvidence", () => {
    it("should return original content unchanged when source equals target language", async () => {
      const result = await service.normalizeEvidence({
        content: "This is an article about AI.",
        title: "AI Article",
        snippet: "AI short snippet",
        sourceLanguage: ResearchLanguage.EN,
        targetLanguage: ResearchLanguage.EN,
      });

      expect(result.translatedContent).toBe("This is an article about AI.");
      expect(result.translationQuality).toBe(1.0);
      expect(mockAiFacade.chat).not.toHaveBeenCalled();
    });

    it("should translate content from Chinese to English", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          translatedContent: "Artificial intelligence is developing rapidly.",
          translatedTitle: "AI Development",
          translatedSnippet: "AI is growing",
          translationQuality: 0.92,
          culturalNotes: ["Chinese tech context"],
        }),
      });

      const result = await service.normalizeEvidence({
        content: "人工智能正在快速发展。",
        title: "人工智能发展",
        snippet: "人工智能",
        sourceLanguage: ResearchLanguage.ZH,
        targetLanguage: ResearchLanguage.EN,
      });

      expect(result.translatedContent).toBe(
        "Artificial intelligence is developing rapidly.",
      );
      expect(result.translationQuality).toBe(0.92);
      expect(result.culturalNotes).toContain("Chinese tech context");
    });

    it("should fall back to original content on translation error", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("Translation failed"));

      const result = await service.normalizeEvidence({
        content: "日本語のコンテンツ",
        sourceLanguage: ResearchLanguage.JA,
        targetLanguage: ResearchLanguage.EN,
      });

      expect(result.translatedContent).toBe("日本語のコンテンツ");
      expect(result.translationQuality).toBe(0);
    });
  });

  // ============================================================
  // getRecommendedLanguages
  // ============================================================

  describe("getRecommendedLanguages", () => {
    it("should recommend EN, ZH, JA for TECHNOLOGY_INSIGHT", () => {
      const langs = service.getRecommendedLanguages(
        "AI Research",
        "TECHNOLOGY_INSIGHT",
      );

      expect(langs).toContain(ResearchLanguage.EN);
      expect(langs).toContain(ResearchLanguage.ZH);
      expect(langs).toContain(ResearchLanguage.JA);
    });

    it("should recommend EN and ZH for COMPANY_INSIGHT", () => {
      const langs = service.getRecommendedLanguages(
        "Apple Inc",
        "COMPANY_INSIGHT",
      );

      expect(langs).toContain(ResearchLanguage.EN);
      expect(langs).toContain(ResearchLanguage.ZH);
    });

    it("should default to EN and ZH for unknown topic types", () => {
      const langs = service.getRecommendedLanguages(
        "Unknown Topic",
        "UNKNOWN_TYPE",
      );

      expect(langs).toContain(ResearchLanguage.EN);
      expect(langs).toContain(ResearchLanguage.ZH);
    });

    it("should recommend DE and FR for MACRO_INSIGHT", () => {
      const langs = service.getRecommendedLanguages(
        "Global Economy",
        "MACRO_INSIGHT",
      );

      expect(langs).toContain(ResearchLanguage.DE);
      expect(langs).toContain(ResearchLanguage.FR);
    });
  });

  // ============================================================
  // getDefaultConfig
  // ============================================================

  describe("getDefaultConfig", () => {
    it("should return default configuration", () => {
      const config = service.getDefaultConfig();

      expect(config.enabled).toBe(true);
      expect(config.primaryLanguage).toBe(ResearchLanguage.EN);
      expect(config.supplementaryLanguages).toContain(ResearchLanguage.ZH);
    });

    it("should return a copy (not reference) of config", () => {
      const config1 = service.getDefaultConfig();
      const config2 = service.getDefaultConfig();

      config1.enabled = false;
      expect(config2.enabled).toBe(true); // should not be affected
    });
  });

  // ============================================================
  // calculateStats
  // ============================================================

  describe("calculateStats", () => {
    it("should calculate evidence stats by language", () => {
      const languages = [
        { language: ResearchLanguage.EN, count: 10 },
        { language: ResearchLanguage.ZH, count: 5 },
        { language: ResearchLanguage.JA, count: 2 },
      ];

      const stats = service.calculateStats(languages);

      expect(stats.evidenceByLanguage[ResearchLanguage.EN]).toBe(10);
      expect(stats.evidenceByLanguage[ResearchLanguage.ZH]).toBe(5);
      expect(stats.languagesCovered).toBe(3);
    });

    it("should return empty stats for empty language list", () => {
      const stats = service.calculateStats([]);

      expect(stats.languagesCovered).toBe(0);
    });
  });
});
