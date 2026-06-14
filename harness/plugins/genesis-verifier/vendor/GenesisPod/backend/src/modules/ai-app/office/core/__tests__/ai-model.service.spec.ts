/**
 * Unit tests for AIModelService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AIModelService } from "../ai-model.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

describe("AIModelService", () => {
  let service: AIModelService;
  let aiFacade: jest.Mocked<ChatFacade>;

  const mockChatModel = {
    id: "model-1",
    modelId: "gpt-4",
    displayName: "GPT-4",
    name: "gpt-4",
    provider: "openai",
    maxTokens: 8192,
    isEnabled: true,
    isDefault: true,
  };

  const mockImageModel = {
    id: "img-model-1",
    modelId: "dall-e-3",
    displayName: "DALL-E 3",
    name: "dall-e-3",
    provider: "openai",
    maxTokens: 0,
    isEnabled: true,
    isDefault: true,
  };

  beforeEach(async () => {
    const mockFacade = {
      getModelById: jest.fn(),
      getDefaultTextModel: jest.fn(),
      getDefaultImageModel: jest.fn(),
      getAvailableModels: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIModelService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<AIModelService>(AIModelService);
    aiFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getDefaultTextModel", () => {
    it("should return user-specified model when userModelId is provided and found", async () => {
      aiFacade.getModelById.mockResolvedValueOnce(mockChatModel);

      const result = await service.getDefaultTextModel("model-1");

      expect(result).toBeDefined();
      expect(result.id).toBe("model-1");
      expect(result.modelId).toBe("gpt-4");
      expect(result.modelType).toBe(AIModelType.CHAT);
      expect(aiFacade.getModelById).toHaveBeenCalledWith("model-1");
    });

    it("should return system default when userModelId is provided but not found", async () => {
      aiFacade.getModelById.mockResolvedValueOnce(null);
      aiFacade.getDefaultTextModel.mockResolvedValueOnce(mockChatModel);

      const result = await service.getDefaultTextModel("nonexistent-id");

      expect(result).toBeDefined();
      expect(result.id).toBe("model-1");
      expect(aiFacade.getDefaultTextModel).toHaveBeenCalled();
    });

    it("should return system default when no userModelId provided", async () => {
      aiFacade.getDefaultTextModel.mockResolvedValueOnce(mockChatModel);

      const result = await service.getDefaultTextModel();

      expect(result).toBeDefined();
      expect(result.id).toBe("model-1");
      expect(result.isDefault).toBe(true);
      expect(aiFacade.getModelById).not.toHaveBeenCalled();
    });

    it("should throw error when no model is available", async () => {
      aiFacade.getDefaultTextModel.mockResolvedValueOnce(null);

      await expect(service.getDefaultTextModel()).rejects.toThrow(
        "No text model configured",
      );
    });

    it("should return model with correct modelType CHAT", async () => {
      aiFacade.getDefaultTextModel.mockResolvedValueOnce(mockChatModel);

      const result = await service.getDefaultTextModel();

      expect(result.modelType).toBe(AIModelType.CHAT);
    });

    it("should map provider from facade model", async () => {
      aiFacade.getDefaultTextModel.mockResolvedValueOnce(mockChatModel);

      const result = await service.getDefaultTextModel();

      expect(result.provider).toBe("openai");
    });

    it("should mark user-specified model as not default", async () => {
      aiFacade.getModelById.mockResolvedValueOnce(mockChatModel);

      const result = await service.getDefaultTextModel("model-1");

      expect(result.isDefault).toBe(false);
    });

    it("should mark system default model as isDefault true", async () => {
      aiFacade.getDefaultTextModel.mockResolvedValueOnce(mockChatModel);

      const result = await service.getDefaultTextModel();

      expect(result.isDefault).toBe(true);
    });
  });

  describe("getDefaultImageModel", () => {
    it("should return user-specified image model when found", async () => {
      aiFacade.getModelById.mockResolvedValueOnce(mockImageModel);

      const result = await service.getDefaultImageModel("img-model-1");

      expect(result).toBeDefined();
      expect(result.id).toBe("img-model-1");
      expect(result.modelType).toBe(AIModelType.IMAGE_GENERATION);
      expect(aiFacade.getModelById).toHaveBeenCalledWith("img-model-1");
    });

    it("should fall through to system default when user model not found", async () => {
      aiFacade.getModelById.mockResolvedValueOnce(null);
      aiFacade.getDefaultImageModel.mockResolvedValueOnce(mockImageModel);

      const result = await service.getDefaultImageModel("nonexistent");

      expect(result.id).toBe("img-model-1");
      expect(aiFacade.getDefaultImageModel).toHaveBeenCalled();
    });

    it("should return system default image model when no userModelId", async () => {
      aiFacade.getDefaultImageModel.mockResolvedValueOnce(mockImageModel);

      const result = await service.getDefaultImageModel();

      expect(result.modelType).toBe(AIModelType.IMAGE_GENERATION);
      expect(aiFacade.getModelById).not.toHaveBeenCalled();
    });

    it("should throw error when no image model configured", async () => {
      aiFacade.getDefaultImageModel.mockResolvedValueOnce(null);

      await expect(service.getDefaultImageModel()).rejects.toThrow(
        "No image generation model configured",
      );
    });

    it("should mark image model as isDefault true when from system", async () => {
      aiFacade.getDefaultImageModel.mockResolvedValueOnce(mockImageModel);

      const result = await service.getDefaultImageModel();

      expect(result.isDefault).toBe(true);
    });
  });

  describe("getAvailableTextModels", () => {
    it("should return sorted list of text models", async () => {
      const models = [
        { id: "model-a", name: "Model A", provider: "openai" },
        { id: "model-b", name: "Model B", provider: "anthropic" },
      ];
      aiFacade.getAvailableModels.mockResolvedValueOnce(models);

      const result = await service.getAvailableTextModels();

      expect(result).toHaveLength(2);
      expect(aiFacade.getAvailableModels).toHaveBeenCalledWith(
        AIModelType.CHAT,
      );
    });

    it("should return empty array when no text models available", async () => {
      aiFacade.getAvailableModels.mockResolvedValueOnce([]);

      const result = await service.getAvailableTextModels();

      expect(result).toHaveLength(0);
    });

    it("should map model properties correctly", async () => {
      const models = [{ id: "model-x", name: "Model X", provider: "google" }];
      aiFacade.getAvailableModels.mockResolvedValueOnce(models);

      const result = await service.getAvailableTextModels();

      expect(result[0]).toMatchObject({
        id: "model-x",
        name: "Model X",
        provider: "google",
        displayName: "Model X",
      });
    });

    it("should sort models alphabetically by displayName", async () => {
      const models = [
        { id: "model-z", name: "Z Model", provider: "openai" },
        { id: "model-a", name: "A Model", provider: "openai" },
        { id: "model-m", name: "M Model", provider: "openai" },
      ];
      aiFacade.getAvailableModels.mockResolvedValueOnce(models);

      const result = await service.getAvailableTextModels();

      expect(result[0].displayName).toBe("A Model");
      expect(result[1].displayName).toBe("M Model");
      expect(result[2].displayName).toBe("Z Model");
    });

    it("should include icon and color as null", async () => {
      const models = [{ id: "m1", name: "Model 1", provider: "openai" }];
      aiFacade.getAvailableModels.mockResolvedValueOnce(models);

      const result = await service.getAvailableTextModels();

      expect(result[0].icon).toBeNull();
      expect(result[0].color).toBeNull();
    });
  });

  describe("getAvailableImageModels", () => {
    it("should return list of image generation models", async () => {
      const models = [
        { id: "dalle3", name: "DALL-E 3", provider: "openai" },
        { id: "sd3", name: "Stable Diffusion 3", provider: "stability" },
      ];
      aiFacade.getAvailableModels.mockResolvedValueOnce(models);

      const result = await service.getAvailableImageModels();

      expect(result).toHaveLength(2);
      expect(aiFacade.getAvailableModels).toHaveBeenCalledWith(
        AIModelType.IMAGE_GENERATION,
      );
    });

    it("should return empty array when no image models available", async () => {
      aiFacade.getAvailableModels.mockResolvedValueOnce([]);

      const result = await service.getAvailableImageModels();

      expect(result).toHaveLength(0);
    });

    it("should sort models alphabetically", async () => {
      const models = [
        { id: "z-model", name: "Z Image Model", provider: "openai" },
        { id: "a-model", name: "A Image Model", provider: "stability" },
      ];
      aiFacade.getAvailableModels.mockResolvedValueOnce(models);

      const result = await service.getAvailableImageModels();

      expect(result[0].displayName).toBe("A Image Model");
      expect(result[1].displayName).toBe("Z Image Model");
    });
  });
});
