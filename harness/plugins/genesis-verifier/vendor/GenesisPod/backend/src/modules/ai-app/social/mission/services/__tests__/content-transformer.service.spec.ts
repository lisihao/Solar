/**
 * Tests for ContentTransformerService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ContentTransformerService } from "../content-transformer.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { SocialContentType } from "@prisma/client";

jest.mock("@/modules/ai-harness/facade");

describe("ContentTransformerService", () => {
  let service: ContentTransformerService;
  let mockAiFacade: { chat: jest.Mock };

  const baseInput = {
    sourceContent:
      "This is a long article about AI technology and its impact...",
    sourceTitle: "AI Technology Impact",
    targetType: SocialContentType.WECHAT_ARTICLE,
  };

  beforeEach(async () => {
    mockAiFacade = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          title: "AI技术影响深远",
          content: "人工智能技术正在深刻影响我们的生活和工作方式...",
          digest: "AI技术的影响",
          tags: ["AI", "技术"],
        }),
        tokensUsed: 200,
        isError: false,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentTransformerService,
        { provide: ChatFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<ContentTransformerService>(ContentTransformerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("transform", () => {
    it("should transform content for WECHAT_ARTICLE", async () => {
      const result = await service.transform(baseInput);

      expect(result.title).toBe("AI技术影响深远");
      expect(result.content).toContain("人工智能");
      expect(result.tags).toContain("AI");
      expect(mockAiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            expect.objectContaining({ role: "user" }),
          ]),
        }),
      );
    });

    it("should transform content for XIAOHONGSHU_NOTE", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          title: "AI改变生活",
          content: "AI技术来袭！\n\n三个惊人改变...",
          tags: ["科技", "AI"],
        }),
        isError: false,
      });

      const result = await service.transform({
        ...baseInput,
        targetType: SocialContentType.XIAOHONGSHU_NOTE,
      });

      expect(result.title).toBe("AI改变生活");
      expect(result.tags).toContain("科技");
    });

    it("should handle bilingual content with both original and translated", async () => {
      const bilingualInput = {
        ...baseInput,
        originalContent: "AI is transforming technology worldwide.",
        translatedContent: "AI正在全球范围内改变技术。",
        isBilingual: true,
      };

      await service.transform(bilingualInput);

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      const userMessage = chatCall.messages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("AI is transforming");
      expect(userMessage.content).toContain("AI正在全球");
    });

    it("should handle original content without translation", async () => {
      const inputWithOriginalOnly = {
        ...baseInput,
        originalContent: "AI is transforming technology.",
      };

      await service.transform(inputWithOriginalOnly);

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      const userMessage = chatCall.messages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("英文原文");
    });

    it("should include additional instructions in prompt", async () => {
      await service.transform({
        ...baseInput,
        additionalInstructions: "请保持专业语气",
      });

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      const userMessage = chatCall.messages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("请保持专业语气");
    });

    it("should include billing info when userId is provided", async () => {
      await service.transform({ ...baseInput, userId: "user-123" });

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      expect(chatCall.billing).toBeDefined();
      expect(chatCall.billing.userId).toBe("user-123");
      expect(chatCall.billing.moduleType).toBe("ai-social");
    });

    it("should not include billing when userId is not provided", async () => {
      await service.transform(baseInput);

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      expect(chatCall.billing).toBeUndefined();
    });

    it("should throw when AI response indicates an error", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: "Error: API rate limit exceeded. Please try again later.",
        isError: true,
      });

      await expect(service.transform(baseInput)).rejects.toThrow(
        "AI 内容转换失败",
      );
    });

    it("should throw when AI response content is too short", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: "Short",
        isError: false,
      });

      await expect(service.transform(baseInput)).rejects.toThrow(
        "AI 返回的内容无效或过短",
      );
    });

    it("should fallback to raw response when JSON parsing fails", async () => {
      const rawResponse = "A".repeat(200); // long non-JSON response
      mockAiFacade.chat.mockResolvedValue({
        content: rawResponse,
        isError: false,
      });

      const result = await service.transform(baseInput);

      // When JSON parsing fails, falls back to raw response
      expect(result.content).toBe(rawResponse);
      expect(result.title).toBe(baseInput.sourceTitle);
    });

    it("should use fallback title '未命名' when no source title and JSON parsing fails", async () => {
      const rawResponse = "A".repeat(200);
      mockAiFacade.chat.mockResolvedValue({
        content: rawResponse,
        isError: false,
      });

      const result = await service.transform({
        ...baseInput,
        sourceTitle: undefined,
      });

      expect(result.title).toBe("未命名");
    });

    it("should handle malformed JSON gracefully and use fallback", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: "{ invalid json " + "a".repeat(100),
        isError: false,
      });

      const result = await service.transform(baseInput);

      expect(result.title).toBe(baseInput.sourceTitle);
      expect(result.tags).toEqual([]);
    });

    it("should use default system prompt for unknown content type", async () => {
      await service.transform({
        ...baseInput,
        targetType: "UNKNOWN_TYPE" as SocialContentType,
      });

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      const systemMessage = chatCall.messages.find(
        (m: { role: string }) => m.role === "system",
      );
      expect(systemMessage.content).toContain("社交媒体");
    });

    it("should include bilingual format guide in WECHAT system prompt when isBilingual", async () => {
      await service.transform({
        ...baseInput,
        isBilingual: true,
      });

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      const systemMessage = chatCall.messages.find(
        (m: { role: string }) => m.role === "system",
      );
      // The bilingual format guide should be included
      expect(systemMessage.content.length).toBeGreaterThan(100);
    });
  });
});
