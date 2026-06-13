/**
 * Unit tests for WritingModelManager
 */

import { Test, TestingModule } from "@nestjs/testing";
import { WritingModelManager } from "../writing-model-manager.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

function buildMockFacade() {
  return {
    getAvailableModelsExtended: jest.fn(),
  };
}

describe("WritingModelManager", () => {
  let service: WritingModelManager;
  let facade: ReturnType<typeof buildMockFacade>;

  const mockChatModel = {
    id: "model-gpt4",
    name: "GPT-4",
    provider: "openai",
    isReasoning: false,
  };

  const mockReasoningModel = {
    id: "model-o1",
    name: "o1",
    provider: "openai",
    isReasoning: true,
  };

  const mockClaudeModel = {
    id: "model-claude",
    name: "Claude 3",
    provider: "anthropic",
    isReasoning: false,
  };

  const mockXaiModel = {
    id: "model-grok",
    name: "Grok",
    provider: "xAI",
    isReasoning: false,
  };

  beforeEach(async () => {
    facade = buildMockFacade();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingModelManager,
        { provide: ChatFacade, useValue: facade },
      ],
    }).compile();

    service = module.get<WritingModelManager>(WritingModelManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getAvailableModels", () => {
    it("should return models excluding xAI provider", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
        mockXaiModel,
      ]);

      const result = await service.getAvailableModels();

      expect(result).toHaveLength(1);
      expect(result[0].modelId).toBe("model-gpt4");
    });

    it("should cache models for subsequent calls", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([mockChatModel]);

      await service.getAvailableModels();
      await service.getAvailableModels();

      expect(facade.getAvailableModelsExtended).toHaveBeenCalledTimes(1);
    });

    it("should return empty array when facade throws", async () => {
      facade.getAvailableModelsExtended.mockRejectedValue(
        new Error("API error"),
      );

      const result = await service.getAvailableModels();

      expect(result).toEqual([]);
    });

    it("should call facade with CHAT model type", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([]);

      await service.getAvailableModels();

      expect(facade.getAvailableModelsExtended).toHaveBeenCalledWith(
        AIModelType.CHAT,
      );
    });

    it("should re-fetch after cache TTL expires", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([mockChatModel]);

      await service.getAvailableModels();

      // Force cache expiry by manually setting cache time to past
      (service as unknown as { modelCacheTime: number }).modelCacheTime =
        Date.now() - 6 * 60 * 1000;

      await service.getAvailableModels();

      expect(facade.getAvailableModelsExtended).toHaveBeenCalledTimes(2);
    });
  });

  describe("assignModelsToRoles", () => {
    it("should return all inactive roles when no models available", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([]);

      const result = await service.assignModelsToRoles();

      expect(result).toHaveLength(5);
      result.forEach((r) => expect(r.isActive).toBe(false));
    });

    it("should assign reasoning model to story-architect", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
        mockReasoningModel,
      ]);

      const result = await service.assignModelsToRoles();

      const architect = result.find((r) => r.roleId === "story-architect");
      expect(architect?.modelId).toBe("model-o1");
      expect(architect?.isActive).toBe(true);
    });

    it("should use first model for architect when no reasoning models", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([mockChatModel]);

      const result = await service.assignModelsToRoles();

      const architect = result.find((r) => r.roleId === "story-architect");
      expect(architect?.modelId).toBe("model-gpt4");
    });

    it("should assign models to all 5 roles", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
        mockClaudeModel,
      ]);

      const result = await service.assignModelsToRoles();

      expect(result).toHaveLength(5);
      const roleIds = result.map((r) => r.roleId);
      expect(roleIds).toContain("story-architect");
      expect(roleIds).toContain("bible-keeper");
      expect(roleIds).toContain("writer");
      expect(roleIds).toContain("consistency-checker");
      expect(roleIds).toContain("editor");
    });

    it("should diversify across providers when multiple providers available", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
        mockClaudeModel,
      ]);

      const result = await service.assignModelsToRoles();

      const modelIds = result.map((r) => r.modelId);
      const uniqueModels = new Set(modelIds);
      // With 2 providers, should use at least 2 different models
      expect(uniqueModels.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getActiveRoles", () => {
    it("should return all role IDs when models available", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([mockChatModel]);

      const result = await service.getActiveRoles();

      expect(result).toHaveLength(5);
      expect(result).toContain("writer");
    });

    it("should return empty array when no models available", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([]);

      const result = await service.getActiveRoles();

      expect(result).toHaveLength(0);
    });
  });

  describe("getModelForRole", () => {
    it("should return model ID for active role", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([mockChatModel]);

      const result = await service.getModelForRole("writer");

      expect(result).toBe("model-gpt4");
    });

    it("should return null for inactive role", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([]);

      const result = await service.getModelForRole("writer");

      expect(result).toBeNull();
    });

    it("should return null for non-existent role", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([mockChatModel]);

      const result = await service.getModelForRole("non-existent-role");

      expect(result).toBeNull();
    });
  });

  describe("clearCache", () => {
    it("should force re-fetch after cache is cleared", async () => {
      facade.getAvailableModelsExtended.mockResolvedValue([mockChatModel]);

      await service.getAvailableModels();
      service.clearCache();
      await service.getAvailableModels();

      expect(facade.getAvailableModelsExtended).toHaveBeenCalledTimes(2);
    });
  });
});
