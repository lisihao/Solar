/**
 * OutputReviewerService — supplemental branch coverage
 *
 * Targets:
 *  - Lines 510-513: mapTemperatureToCreativity (deterministic/low/medium/high)
 *  - Lines 521-527: mapMaxTokensToOutputLength (minimal/short/medium/standard/long/extended)
 *  - Line 546: getModelConfig catch block
 *  - Lines 564-566: callAIWithConfig fallback when no taskProfile
 */

import { Test, TestingModule } from "@nestjs/testing";
import { OutputReviewerService } from "../output-reviewer.service";
import { AiChatService } from "../../../../ai-engine/llm/chat/ai-chat.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

const MOCK_COMPLETION = {
  content: "Some AI response",
  tokensUsed: 50,
};

async function buildService(
  prismaOverride?: Partial<{
    aIModel: { findFirst: jest.Mock };
  }>,
) {
  const mockAiChat = {
    generateChatCompletion: jest.fn().mockResolvedValue(MOCK_COMPLETION),
    chat: jest.fn().mockResolvedValue(MOCK_COMPLETION),
  };

  const mockPrisma = prismaOverride ?? {
    aIModel: {
      findFirst: jest.fn().mockResolvedValue({
        modelId: "gpt-4o",
        provider: "openai",
        apiKey: "test-key",
        apiEndpoint: null,
      }),
    },
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OutputReviewerService,
      { provide: AiChatService, useValue: mockAiChat },
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();

  return {
    service: module.get<OutputReviewerService>(OutputReviewerService),
    mockAiChat,
  };
}

describe("OutputReviewerService (branch supplement)", () => {
  afterEach(() => jest.clearAllMocks());

  // ─────────────────────────────────────────────────────────────────
  // mapTemperatureToCreativity branches (lines 510-513)
  // Reached via executeAICall with temperature option (no taskProfile)
  // ─────────────────────────────────────────────────────────────────
  describe("mapTemperatureToCreativity via executeAICall", () => {
    it("uses 'deterministic' for temperature <= 0.2", async () => {
      const { service, mockAiChat } = await buildService();
      await service.executeAICall(
        "gpt-4o",
        [{ role: "user", content: "test" }],
        { temperature: 0.1 },
      );
      const call = mockAiChat.generateChatCompletion.mock.calls[0][0];
      expect(call.taskProfile.creativity).toBe("deterministic");
    });

    it("uses 'low' for temperature 0.21-0.3", async () => {
      const { service, mockAiChat } = await buildService();
      await service.executeAICall(
        "gpt-4o",
        [{ role: "user", content: "test" }],
        { temperature: 0.25 },
      );
      const call = mockAiChat.generateChatCompletion.mock.calls[0][0];
      expect(call.taskProfile.creativity).toBe("low");
    });

    it("uses 'medium' for temperature 0.31-0.7", async () => {
      const { service, mockAiChat } = await buildService();
      await service.executeAICall(
        "gpt-4o",
        [{ role: "user", content: "test" }],
        { temperature: 0.5 },
      );
      const call = mockAiChat.generateChatCompletion.mock.calls[0][0];
      expect(call.taskProfile.creativity).toBe("medium");
    });

    it("uses 'high' for temperature > 0.7", async () => {
      const { service, mockAiChat } = await buildService();
      await service.executeAICall(
        "gpt-4o",
        [{ role: "user", content: "test" }],
        { temperature: 0.9 },
      );
      const call = mockAiChat.generateChatCompletion.mock.calls[0][0];
      expect(call.taskProfile.creativity).toBe("high");
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // mapMaxTokensToOutputLength branches (lines 521-527)
  // ─────────────────────────────────────────────────────────────────
  describe("mapMaxTokensToOutputLength via executeAICall", () => {
    it("uses 'minimal' for maxTokens <= 1000", async () => {
      const { service, mockAiChat } = await buildService();
      await service.executeAICall(
        "gpt-4o",
        [{ role: "user", content: "test" }],
        { maxTokens: 500 },
      );
      const call = mockAiChat.generateChatCompletion.mock.calls[0][0];
      expect(call.taskProfile.outputLength).toBe("minimal");
    });

    it("uses 'short' for maxTokens 1001-2000", async () => {
      const { service, mockAiChat } = await buildService();
      await service.executeAICall(
        "gpt-4o",
        [{ role: "user", content: "test" }],
        { maxTokens: 1500 },
      );
      const call = mockAiChat.generateChatCompletion.mock.calls[0][0];
      expect(call.taskProfile.outputLength).toBe("short");
    });

    it("uses 'medium' for maxTokens 2001-4000", async () => {
      const { service, mockAiChat } = await buildService();
      await service.executeAICall(
        "gpt-4o",
        [{ role: "user", content: "test" }],
        { maxTokens: 3000 },
      );
      const call = mockAiChat.generateChatCompletion.mock.calls[0][0];
      expect(call.taskProfile.outputLength).toBe("medium");
    });

    it("uses 'standard' for maxTokens 4001-6000", async () => {
      const { service, mockAiChat } = await buildService();
      await service.executeAICall(
        "gpt-4o",
        [{ role: "user", content: "test" }],
        { maxTokens: 5000 },
      );
      const call = mockAiChat.generateChatCompletion.mock.calls[0][0];
      expect(call.taskProfile.outputLength).toBe("standard");
    });

    it("uses 'long' for maxTokens 6001-8000", async () => {
      const { service, mockAiChat } = await buildService();
      await service.executeAICall(
        "gpt-4o",
        [{ role: "user", content: "test" }],
        { maxTokens: 7000 },
      );
      const call = mockAiChat.generateChatCompletion.mock.calls[0][0];
      expect(call.taskProfile.outputLength).toBe("long");
    });

    it("uses 'extended' for maxTokens > 8000", async () => {
      const { service, mockAiChat } = await buildService();
      await service.executeAICall(
        "gpt-4o",
        [{ role: "user", content: "test" }],
        { maxTokens: 16000 },
      );
      const call = mockAiChat.generateChatCompletion.mock.calls[0][0];
      expect(call.taskProfile.outputLength).toBe("extended");
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // getModelConfig catch block (line 546)
  // ─────────────────────────────────────────────────────────────────
  describe("getModelConfig catch block", () => {
    it("returns null when prisma throws", async () => {
      const { service, mockAiChat } = await buildService({
        aIModel: {
          findFirst: jest.fn().mockRejectedValue(new Error("DB error")),
        },
      });

      // executeAICall without aiCaller → falls through to getModelConfig → catch → null
      await service.executeAICall(
        "gpt-4o",
        [
          { role: "system", content: "system" },
          { role: "user", content: "test" },
        ],
        { temperature: 0.5 },
      );

      // Call still completes using callAIWithConfig (with null modelConfig)
      expect(mockAiChat.generateChatCompletion).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // executeAICall with aiCaller provided (line 310)
  // ─────────────────────────────────────────────────────────────────
  describe("executeAICall with injected aiCaller", () => {
    it("uses aiCaller instead of internal callAIWithConfig", async () => {
      const { service, mockAiChat } = await buildService();
      const aiCaller = jest
        .fn()
        .mockResolvedValue({ content: "caller response", tokensUsed: 42 });

      const result = await service.executeAICall(
        "gpt-4o",
        [{ role: "user", content: "test" }],
        { taskProfile: { creativity: "medium", outputLength: "medium" } },
        aiCaller,
      );

      expect(aiCaller).toHaveBeenCalled();
      expect(mockAiChat.generateChatCompletion).not.toHaveBeenCalled();
      expect(result.content).toBe("caller response");
    });
  });
});
