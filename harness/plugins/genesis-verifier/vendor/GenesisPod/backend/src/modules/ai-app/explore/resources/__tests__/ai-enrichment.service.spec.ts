import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { AIEnrichmentService } from "../ai-enrichment.service";
import axios from "axios";
import { ResourceType } from "@prisma/client";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("AIEnrichmentService", () => {
  let service: AIEnrichmentService;
  let configService: jest.Mocked<ConfigService>;
  let mockAxiosInstance: any;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn(),
    };

    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
    };

    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIEnrichmentService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AIEnrichmentService>(AIEnrichmentService);
    configService = module.get(ConfigService);

    configService.get.mockReturnValue("http://localhost:5000");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("generateSummary", () => {
    it("should generate summary successfully", async () => {
      const mockResponse = {
        data: {
          summary: "This is a test summary",
          model_used: "gpt-4",
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await service.generateSummary("Test content");

      expect(result).toBe("This is a test summary");
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/api/v1/ai/summary",
        expect.objectContaining({
          content: "Test content",
          max_length: 200,
          language: "zh",
        }),
      );
    });

    it("should respect max_length parameter", async () => {
      const mockResponse = {
        data: {
          summary: "Short summary",
          model_used: "gpt-4",
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      await service.generateSummary("Test content", 100, "en");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/api/v1/ai/summary",
        expect.objectContaining({
          max_length: 100,
          language: "en",
        }),
      );
    });

    it("should return null on error", async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error("API error"));

      const result = await service.generateSummary("Test content");

      expect(result).toBeNull();
    });
  });

  describe("extractInsights", () => {
    it("should extract insights successfully", async () => {
      const mockInsights = [
        { text: "Insight 1", confidence: 0.9 },
        { text: "Insight 2", confidence: 0.85 },
      ];

      const mockResponse = {
        data: {
          insights: mockInsights,
          model_used: "gpt-4",
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await service.extractInsights("Test content");

      expect(result).toEqual(mockInsights);
      expect(result).toHaveLength(2);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/api/v1/ai/insights",
        expect.objectContaining({
          content: "Test content",
          language: "zh",
        }),
      );
    });

    it("should return null on error", async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error("Network error"));

      const result = await service.extractInsights("Test content");

      expect(result).toBeNull();
    });

    it("should support English language", async () => {
      const mockResponse = {
        data: {
          insights: [],
          model_used: "gpt-4",
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      await service.extractInsights("Test content", "en");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/api/v1/ai/insights",
        expect.objectContaining({
          language: "en",
        }),
      );
    });
  });

  describe("classifyContent", () => {
    it("should classify content successfully", async () => {
      const mockResponse = {
        data: {
          category: "Technology",
          subcategories: ["AI", "Machine Learning"],
          tags: ["neural-networks", "deep-learning"],
          difficulty_level: "intermediate",
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await service.classifyContent("Test content");

      expect(result).toEqual({
        category: "Technology",
        subcategories: ["AI", "Machine Learning"],
        tags: ["neural-networks", "deep-learning"],
        difficultyLevel: "intermediate",
      });
    });

    it("should return null on error", async () => {
      mockAxiosInstance.post.mockRejectedValue(
        new Error("Classification failed"),
      );

      const result = await service.classifyContent("Test content");

      expect(result).toBeNull();
    });
  });

  describe("translateContent", () => {
    it("should translate content successfully", async () => {
      const mockResponse = {
        data: {
          translatedText: "这是翻译的文本",
          model: "gpt-4",
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await service.translateContent("This is a test");

      expect(result).toEqual({
        translatedText: "这是翻译的文本",
        model: "gpt-4",
      });
    });

    it("should support custom target language", async () => {
      const mockResponse = {
        data: {
          translatedText: "Ceci est un test",
          model: "gpt-4",
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      await service.translateContent("This is a test", "fr");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/api/v1/ai/translate",
        expect.objectContaining({
          targetLanguage: "fr",
        }),
      );
    });

    it("should return null on error", async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error("Translation failed"));

      const result = await service.translateContent("Test");

      expect(result).toBeNull();
    });
  });

  describe("enrichResource", () => {
    const mockResource = {
      title: "Test Resource",
      abstract: "Test abstract",
      content: "Test content",
      sourceUrl: "https://example.com",
    };

    it("should enrich resource with all AI services", async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: { summary: "Test summary", model_used: "gpt-4" },
        })
        .mockResolvedValueOnce({
          data: { insights: [{ text: "Insight 1" }], model_used: "gpt-4" },
        })
        .mockResolvedValueOnce({
          data: {
            category: "Technology",
            tags: ["ai", "ml"],
            difficulty_level: "intermediate",
          },
        });

      const result = await service.enrichResource(mockResource);

      expect(result).toMatchObject({
        aiSummary: "Test summary",
        keyInsights: [{ text: "Insight 1" }],
        primaryCategory: "Technology",
        autoTags: ["ai", "ml"],
        difficultyLevel: 2,
      });
    });

    it("should handle partial failures gracefully", async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: { summary: "Test summary", model_used: "gpt-4" },
        })
        .mockRejectedValueOnce(new Error("Insights failed"))
        .mockResolvedValueOnce({
          data: {
            category: "Technology",
            tags: ["ai"],
            difficulty_level: "beginner",
          },
        });

      const result = await service.enrichResource(mockResource);

      expect(result.aiSummary).toBe("Test summary");
      expect(result.keyInsights).toEqual([]);
      expect(result.difficultyLevel).toBe(1);
    });

    it("should map difficulty levels correctly", async () => {
      const testCases = [
        { input: "beginner", expected: 1 },
        { input: "intermediate", expected: 2 },
        { input: "advanced", expected: 3 },
        { input: "expert", expected: 4 },
        { input: "unknown", expected: 2 },
      ];

      for (const testCase of testCases) {
        mockAxiosInstance.post
          .mockResolvedValueOnce({
            data: { summary: "Summary", model_used: "gpt-4" },
          })
          .mockResolvedValueOnce({
            data: { insights: [], model_used: "gpt-4" },
          })
          .mockResolvedValueOnce({
            data: {
              category: "Test",
              tags: [],
              difficulty_level: testCase.input,
            },
          });

        const result = await service.enrichResource(mockResource);

        expect(result.difficultyLevel).toBe(testCase.expected);
      }
    });
  });

  describe("checkHealth", () => {
    it("should return true when service is healthy", async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          status: "ok",
          active_model: "gpt-4",
        },
      });

      const result = await service.checkHealth();

      expect(result).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        "/api/v1/ai/health",
        expect.objectContaining({
          timeout: 5000,
        }),
      );
    });

    it("should return true when service is degraded", async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          status: "degraded",
          active_model: "gpt-3.5",
        },
      });

      const result = await service.checkHealth();

      expect(result).toBe(true);
    });

    it("should return false on error", async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error("Connection failed"));

      const result = await service.checkHealth();

      expect(result).toBe(false);
    });
  });

  describe("generateStructuredSummary", () => {
    const mockResource = {
      title: "Research Paper",
      abstract: "Abstract text",
      content: "Full content",
      type: "PAPER" as ResourceType,
    };

    it("should generate structured summary for paper", async () => {
      const mockStructuredSummary = {
        overview: "Paper overview",
        keyPoints: ["Point 1", "Point 2"],
        category: "Academic",
        subcategories: [],
        keywords: [],
        difficulty: "intermediate" as const,
        readingTime: 5,
        confidence: 0.9,
        generatedAt: new Date(),
        model: "gpt-4",
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: {
          summary: mockStructuredSummary,
          model: "gpt-4",
        },
      });

      const result = await service.generateStructuredSummary(
        mockResource,
        "PAPER" as ResourceType,
      );

      expect(result).toMatchObject({
        overview: "Paper overview",
        category: "Academic",
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/api/v1/ai/generate-structured-summary",
        expect.objectContaining({
          resourceType: "PAPER",
          title: "Research Paper",
        }),
      );
    });

    it("should return null on error", async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error("API error"));

      const result = await service.generateStructuredSummary(mockResource);

      expect(result).toBeNull();
    });
  });

  describe("enrichResourceWithStructured", () => {
    const mockResource = {
      title: "Test Resource",
      abstract: "Test abstract",
      content: "Test content",
      type: "BLOG" as ResourceType,
    };

    it("should enrich resource with structured summary", async () => {
      const mockStructuredSummary = {
        overview: "Blog overview",
        keyPoints: ["Point 1"],
        category: "Blog",
        subcategories: [],
        keywords: [],
        difficulty: "intermediate" as const,
        readingTime: 3,
        confidence: 0.85,
        generatedAt: new Date(),
        model: "gpt-4",
      };

      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: { summary: "Plain summary", model_used: "gpt-4" },
        })
        .mockResolvedValueOnce({
          data: { insights: [], model_used: "gpt-4" },
        })
        .mockResolvedValueOnce({
          data: {
            category: "Blog",
            tags: ["tech"],
            difficulty_level: "intermediate",
          },
        })
        .mockResolvedValueOnce({
          data: { summary: mockStructuredSummary, model: "gpt-4" },
        });

      const result = await service.enrichResourceWithStructured(
        mockResource,
        "BLOG" as ResourceType,
      );

      expect(result.structuredAISummary).toMatchObject({
        overview: "Blog overview",
        category: "Blog",
      });
      expect(result.aiSummary).toBe("Plain summary");
    });

    it("should use fallback if structured summary fails", async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: { summary: "Plain summary", model_used: "gpt-4" },
        })
        .mockResolvedValueOnce({
          data: { insights: [], model_used: "gpt-4" },
        })
        .mockResolvedValueOnce({
          data: {
            category: "Technology",
            tags: [],
            difficulty_level: "beginner",
          },
        })
        .mockRejectedValueOnce(new Error("Structured summary failed"));

      const result = await service.enrichResourceWithStructured(mockResource);

      expect(result.structuredAISummary).toBeTruthy();
      expect(result.structuredAISummary?.category).toBe("Technology");
    });
  });
});
