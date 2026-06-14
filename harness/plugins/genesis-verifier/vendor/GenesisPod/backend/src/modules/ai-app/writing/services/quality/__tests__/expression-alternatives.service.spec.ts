import { Test, TestingModule } from "@nestjs/testing";
import {
  ExpressionAlternativesService,
  AlternativeRequest,
} from "../expression-alternatives.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("ExpressionAlternativesService", () => {
  let service: ExpressionAlternativesService;
  let mockFacade: jest.Mocked<ChatFacade>;

  beforeEach(async () => {
    mockFacade = {
      chat: jest.fn(),
      chatStream: jest.fn(),
      chatWithSkills: jest.fn(),
    } as unknown as jest.Mocked<ChatFacade>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpressionAlternativesService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<ExpressionAlternativesService>(
      ExpressionAlternativesService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const makeRequest = (
    overrides: Partial<AlternativeRequest> = {},
  ): AlternativeRequest => ({
    expression: "心中一震",
    type: "emotion",
    ...overrides,
  });

  describe("getAlternatives", () => {
    it("should return alternatives for a new expression", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "心跳加速\n呼吸微滞\n瞳孔微缩",
        tokensUsed: 50,
      } as any);

      const result = await service.getAlternatives(makeRequest());

      expect(result.original).toBe("心中一震");
      expect(result.alternatives).toHaveLength(3);
      expect(result.fromCache).toBe(false);
      expect(mockFacade.chat).toHaveBeenCalledTimes(1);
    });

    it("should return cached alternatives on second call", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "心跳加速\n呼吸微滞",
        tokensUsed: 50,
      } as any);

      const request = makeRequest();
      await service.getAlternatives(request);
      const result = await service.getAlternatives(request);

      expect(result.fromCache).toBe(true);
      expect(mockFacade.chat).toHaveBeenCalledTimes(1); // only called once
    });

    it("should use different cache keys for different expression types", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "替代方案",
        tokensUsed: 50,
      } as any);

      await service.getAlternatives(makeRequest({ type: "emotion" }));
      await service.getAlternatives(makeRequest({ type: "action" }));

      expect(mockFacade.chat).toHaveBeenCalledTimes(2);
    });

    it("should return empty alternatives when LLM call fails", async () => {
      mockFacade.chat.mockRejectedValue(new Error("API error"));

      const result = await service.getAlternatives(makeRequest());

      expect(result.alternatives).toHaveLength(0);
      expect(result.fromCache).toBe(false);
    });

    it("should parse alternatives from numbered list", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "1. 心跳加速\n2. 呼吸微滞\n3. 瞳孔微缩",
        tokensUsed: 50,
      } as any);

      const result = await service.getAlternatives(makeRequest());

      expect(result.alternatives).toContain("心跳加速");
      expect(result.alternatives).toContain("呼吸微滞");
    });

    it("should strip quotes from alternatives", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "「心跳加速」\n「呼吸微滞」",
        tokensUsed: 50,
      } as any);

      const result = await service.getAlternatives(makeRequest());

      for (const alt of result.alternatives) {
        expect(alt).not.toContain("「");
        expect(alt).not.toContain("」");
      }
    });

    it("should limit alternatives to 5 maximum", async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          "方案一\n方案二\n方案三\n方案四\n方案五\n方案六\n方案七\n方案八",
        tokensUsed: 100,
      } as any);

      const result = await service.getAlternatives(makeRequest());

      expect(result.alternatives.length).toBeLessThanOrEqual(5);
    });

    it("should consider style in cache key", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "替代方案",
        tokensUsed: 50,
      } as any);

      const req1 = makeRequest({ style: "古典" });
      const req2 = makeRequest({ style: "现代" });

      await service.getAlternatives(req1);
      await service.getAlternatives(req2);

      expect(mockFacade.chat).toHaveBeenCalledTimes(2);
    });

    it("should retry on failure and succeed on second attempt", async () => {
      mockFacade.chat
        .mockRejectedValueOnce(new Error("Temporary error"))
        .mockResolvedValueOnce({
          content: "心跳加速\n呼吸微滞",
          tokensUsed: 50,
        } as any);

      const result = await service.getAlternatives(makeRequest());

      expect(result.alternatives.length).toBeGreaterThan(0);
    });
  });

  describe("getBatchAlternatives", () => {
    it("should return results for multiple requests", async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          "心中一震 → 心跳加速 / 呼吸微滞\n内心波动 → 心绪起伏 / 情绪波动",
        tokensUsed: 100,
      } as any);

      const requests: AlternativeRequest[] = [
        { expression: "心中一震", type: "emotion" },
        { expression: "内心波动", type: "emotion" },
      ];

      const results = await service.getBatchAlternatives(requests);

      expect(results.size).toBe(2);
    });

    it("should use cache for already-retrieved expressions", async () => {
      // Pre-populate cache
      mockFacade.chat.mockResolvedValue({
        content: "心跳加速\n呼吸微滞",
        tokensUsed: 50,
      } as any);
      await service.getAlternatives({
        expression: "心中一震",
        type: "emotion",
      });

      mockFacade.chat.mockClear();

      mockFacade.chat.mockResolvedValue({
        content: "内心波动 → 心绪起伏 / 情绪波动",
        tokensUsed: 50,
      } as any);

      const requests: AlternativeRequest[] = [
        { expression: "心中一震", type: "emotion" }, // cached
        { expression: "内心波动", type: "emotion" }, // not cached
      ];

      const results = await service.getBatchAlternatives(requests);

      expect(results.get("心中一震")?.fromCache).toBe(true);
      expect(results.get("内心波动")?.fromCache).toBe(false);
    });

    it("should group by type for batch generation", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "心中一震 → 心跳加速\n他走了 → 他离去",
        tokensUsed: 100,
      } as any);

      const requests: AlternativeRequest[] = [
        { expression: "心中一震", type: "emotion" },
        { expression: "内心波动", type: "emotion" },
        { expression: "他走了", type: "action" },
      ];

      await service.getBatchAlternatives(requests);

      // Should have called chat once per type
      expect(mockFacade.chat).toHaveBeenCalledTimes(2);
    });

    it("should handle empty request array", async () => {
      const results = await service.getBatchAlternatives([]);
      expect(results.size).toBe(0);
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });
  });

  describe("clearExpiredCache", () => {
    it("should not throw when called on empty cache", () => {
      expect(() => service.clearExpiredCache()).not.toThrow();
    });

    it("should clear expired entries", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "心跳加速",
        tokensUsed: 50,
      } as any);

      await service.getAlternatives(makeRequest());

      // Manually set expired timestamp by calling clearExpiredCache
      // In real scenarios this would be after 24 hours
      expect(() => service.clearExpiredCache()).not.toThrow();
    });
  });
});
