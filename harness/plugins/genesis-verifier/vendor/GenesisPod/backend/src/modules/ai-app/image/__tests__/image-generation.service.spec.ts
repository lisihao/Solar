/**
 * ImageGenerationService Unit Tests
 *
 * Tests model resolution and provider routing
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ImageGenerationService } from "../generation/image-generation.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { of } from "rxjs";

// Mock SecretsService
const mockSecretsService = {
  getValueInternal: jest.fn(),
};

jest.mock("../../../platform/credentials/storage/secrets/secrets.service", () => ({
  SecretsService: jest.fn().mockImplementation(() => mockSecretsService),
}));

describe("ImageGenerationService", () => {
  let service: ImageGenerationService;

  const mockFacade = {
    getDefaultTextModel: jest.fn(),
    getDefaultImageModel: jest.fn(),
    getAvailableModelsExtended: jest.fn(),
    getFullModelConfig: jest.fn(),
    getModelById: jest.fn(),
  };

  const mockHttpService = {
    post: jest.fn(),
    get: jest.fn(),
  };

  const mockFullModelConfig = {
    id: "model-db-001",
    modelId: "dall-e-3",
    displayName: "DALL-E 3",
    provider: "openai",
    apiEndpoint: null,
    apiKey: "test-api-key",
    secretKey: null,
    maxTokens: null,
    temperature: null,
    isEnabled: true,
    isDefault: true,
    name: "DALL-E 3",
    isReasoning: false,
    apiFormat: null,
    supportsTemperature: true,
    supportsStreaming: false,
    supportsFunctionCalling: false,
    supportsVision: false,
    tokenParamName: null,
    defaultTimeoutMs: null,
    priceInputPerMillion: null,
    priceOutputPerMillion: null,
    priority: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // 2026-05-12 PR-4: apiKey 明文列回读已删，默认 SYSTEM secret 解析有效
    mockSecretsService.getValueInternal.mockResolvedValue("default-test-key");

    const { SecretsService } =
      await import("../../../platform/credentials/storage/secrets/secrets.service");

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageGenerationService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ChatFacade, useValue: mockFacade },
        { provide: SecretsService, useValue: mockSecretsService },
      ],
    }).compile();

    service = module.get<ImageGenerationService>(ImageGenerationService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============ getApiKeyForModel ============

  describe("getApiKeyForModel", () => {
    // 2026-05-12 PR-4: AIModel.apiKey 明文列回读已删 — apiKey 直读路径全删
    it("should return null when no secretKey configured (apiKey 直读已删)", async () => {
      const model = { apiKey: "direct-api-key", displayName: "Test Model" };
      const result = await service.getApiKeyForModel(model);
      expect(result).toBeNull();
    });

    it("should fetch from secrets when secretKey configured", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("secret-value");
      const model = { secretKey: "my-secret-key", apiKey: "fallback-key" };
      const result = await service.getApiKeyForModel(model);
      expect(result).toBe("secret-value");
      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "my-secret-key",
      );
    });

    it("should return null when secret not found (no apiKey fallback)", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(null);
      const model = {
        secretKey: "missing-secret",
        apiKey: "fallback-key",
        displayName: "Test",
      };
      const result = await service.getApiKeyForModel(model);
      expect(result).toBeNull();
    });

    it("should return null when no apiKey and secret not found", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(null);
      const model = { secretKey: "missing-secret", apiKey: null };
      const result = await service.getApiKeyForModel(model);
      expect(result).toBeNull();
    });

    it("should trim whitespace from secret value", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("  trimmed-key  ");
      const model = { secretKey: "secret-key" };
      const result = await service.getApiKeyForModel(model);
      expect(result).toBe("trimmed-key");
    });
  });

  // ============ getDefaultTextModel ============

  describe("getDefaultTextModel", () => {
    it("should return default text model from facade", async () => {
      const defaultModel = {
        id: "text-001",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
      };
      mockFacade.getDefaultTextModel.mockResolvedValue(defaultModel);

      const result = await service.getDefaultTextModel();

      expect(result).toBe(defaultModel);
      expect(mockFacade.getDefaultTextModel).toHaveBeenCalledTimes(1);
    });

    it("should return null when no default model available", async () => {
      mockFacade.getDefaultTextModel.mockResolvedValue(null);

      const result = await service.getDefaultTextModel();

      expect(result).toBeNull();
    });
  });

  // ============ getDefaultImageModel ============

  describe("getDefaultImageModel", () => {
    it("should return default image model from facade", async () => {
      const facadeModel = {
        id: "img-model-001",
        modelId: "dall-e-3",
        displayName: "DALL-E 3",
        provider: "openai",
      };
      mockFacade.getDefaultImageModel.mockResolvedValue(facadeModel);
      mockFacade.getFullModelConfig.mockResolvedValue(mockFullModelConfig);

      const result = await service.getDefaultImageModel();

      expect(result).toBeDefined();
      expect(result!.modelId).toBe("dall-e-3");
    });

    it("should fall back to available IMAGE_GENERATION models when no default", async () => {
      mockFacade.getDefaultImageModel.mockResolvedValue(null);
      mockFacade.getAvailableModelsExtended.mockResolvedValueOnce([
        {
          id: "flux-001",
          dbId: "flux-db-001",
          name: "FLUX",
          provider: "together",
          maxTokens: null,
        },
      ]);
      mockFacade.getFullModelConfig.mockResolvedValue({
        ...mockFullModelConfig,
        modelId: "flux-001",
      });

      const result = await service.getDefaultImageModel();

      expect(result).toBeDefined();
      expect(mockFacade.getAvailableModelsExtended).toHaveBeenCalled();
    });

    it("should fall back to MULTIMODAL models when no IMAGE_GENERATION models", async () => {
      mockFacade.getDefaultImageModel.mockResolvedValue(null);
      mockFacade.getAvailableModelsExtended
        .mockResolvedValueOnce([]) // IMAGE_GENERATION: none
        .mockResolvedValueOnce([
          {
            id: "gemini-pro",
            dbId: "gemini-db-001",
            name: "Gemini Pro",
            provider: "google",
            maxTokens: null,
          },
        ]); // MULTIMODAL fallback
      mockFacade.getFullModelConfig.mockResolvedValue({
        ...mockFullModelConfig,
        modelId: "gemini-pro",
        provider: "google",
      });

      const result = await service.getDefaultImageModel();

      expect(result).toBeDefined();
    });

    it("should return null when no models of any type available", async () => {
      mockFacade.getDefaultImageModel.mockResolvedValue(null);
      mockFacade.getAvailableModelsExtended
        .mockResolvedValueOnce([]) // IMAGE_GENERATION: none
        .mockResolvedValueOnce([]); // MULTIMODAL: none

      const result = await service.getDefaultImageModel();

      expect(result).toBeNull();
    });
  });

  // ============ getModelById ============

  describe("getModelById", () => {
    it("should return model config by ID", async () => {
      const facadeModel = {
        id: "model-123",
        modelId: "dall-e-3",
        displayName: "DALL-E 3",
        provider: "openai",
      };
      mockFacade.getModelById.mockResolvedValue(facadeModel);
      mockFacade.getFullModelConfig.mockResolvedValue(mockFullModelConfig);

      const result = await service.getModelById("model-123");

      expect(result).toBeDefined();
      expect(result!.modelId).toBe("dall-e-3");
    });

    it("should return null when model not found", async () => {
      mockFacade.getModelById.mockResolvedValue(null);

      const result = await service.getModelById("not-found");

      expect(result).toBeNull();
    });
  });

  // ============ callImageGenerationAPI - Provider routing ============

  describe("callImageGenerationAPI", () => {
    const dimensions = { width: 1024, height: 1024 };

    it("should throw when no API key available", async () => {
      // 无 secretKey + 无 BYOK userId → 不调用 secretsService 直接 throw
      const modelConfig = {
        provider: "openai",
        modelId: "dall-e-3",
        displayName: "DALL-E 3",
        secretKey: null,
        apiKey: null,
      };

      await expect(
        service.callImageGenerationAPI(modelConfig, "test prompt", dimensions),
      ).rejects.toThrow("No API key found");
    });

    it("should route to OpenAI provider", async () => {
      const modelConfig = {
        provider: "openai",
        modelId: "dall-e-3",
        displayName: "DALL-E 3",
        apiKey: "test-key",
        secretKey: "TEST_SECRET",
        apiEndpoint: null,
      };

      mockHttpService.post.mockReturnValue(
        of({
          data: {
            data: [{ url: "https://openai.cdn.com/generated.png" }],
          },
        }),
      );

      const result = await service.callImageGenerationAPI(
        modelConfig,
        "A beautiful sunset",
        dimensions,
      );

      expect(result).toBe("https://openai.cdn.com/generated.png");
      expect(mockHttpService.post).toHaveBeenCalledWith(
        expect.stringContaining("openai.com"),
        expect.objectContaining({ model: "dall-e-3" }),
        expect.any(Object),
      );
    });

    it("should route to Stability AI provider", async () => {
      const modelConfig = {
        provider: "stability",
        modelId: "stable-diffusion-xl",
        displayName: "Stable Diffusion XL",
        apiKey: "stability-key",
        secretKey: "TEST_SECRET",
        apiEndpoint: null,
      };

      mockHttpService.post.mockReturnValue(
        of({
          data: {
            artifacts: [{ base64: "base64encodedimage" }],
          },
        }),
      );

      const result = await service.callImageGenerationAPI(
        modelConfig,
        "A mountain landscape",
        dimensions,
      );

      expect(result).toContain("data:image/png;base64,");
    });

    it("should route to Together AI provider", async () => {
      const modelConfig = {
        provider: "together",
        modelId: "black-forest-labs/FLUX.1-schnell-Free",
        displayName: "FLUX",
        apiKey: "together-key",
        secretKey: "TEST_SECRET",
      };

      mockHttpService.post.mockReturnValue(
        of({
          data: {
            data: [{ url: "https://together.cdn.com/image.png" }],
          },
        }),
      );

      const result = await service.callImageGenerationAPI(
        modelConfig,
        "Abstract art",
        dimensions,
      );

      expect(result).toBeDefined();
      expect(mockHttpService.post).toHaveBeenCalledWith(
        expect.stringContaining("together"),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should route to Google/Gemini provider based on provider name", async () => {
      const modelConfig = {
        provider: "google",
        modelId: "gemini-2.0-flash-exp",
        displayName: "Gemini Flash",
        apiKey: "google-key",
        secretKey: "TEST_SECRET",
      };

      mockHttpService.post.mockReturnValue(
        of({
          data: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: "base64imagedata",
                      },
                    },
                  ],
                },
              },
            ],
          },
        }),
      );

      const result = await service.callImageGenerationAPI(
        modelConfig,
        "A beautiful landscape",
        dimensions,
      );

      expect(result).toBe("data:image/png;base64,base64imagedata");
    });

    it("should route to Google/Gemini provider based on modelId containing gemini", async () => {
      const modelConfig = {
        provider: "custom",
        modelId: "gemini-2.0-flash-exp",
        displayName: "Gemini Flash",
        apiKey: "google-key",
        secretKey: "TEST_SECRET",
      };

      mockHttpService.post.mockReturnValue(
        of({
          data: {
            candidates: [
              {
                content: {
                  parts: [
                    { inlineData: { mimeType: "image/jpeg", data: "imgdata" } },
                  ],
                },
              },
            ],
          },
        }),
      );

      const result = await service.callImageGenerationAPI(
        modelConfig,
        "A city at night",
        dimensions,
      );

      expect(result).toContain("data:image/jpeg;base64,");
    });

    it("should use image-to-image API when referenceImageBase64 provided with google provider", async () => {
      const modelConfig = {
        provider: "google",
        modelId: "gemini-2.0-flash-exp",
        displayName: "Gemini Flash",
        apiKey: "google-key",
        secretKey: "TEST_SECRET",
      };

      const referenceBase64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgAB";

      mockHttpService.post.mockReturnValue(
        of({
          data: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: { mimeType: "image/png", data: "outputdata" },
                    },
                  ],
                },
              },
            ],
          },
        }),
      );

      const result = await service.callImageGenerationAPI(
        modelConfig,
        "modify this image",
        dimensions,
        undefined,
        referenceBase64,
      );

      expect(result).toContain("data:image/png;base64,outputdata");
    });

    it("should throw for image-to-image with unsupported provider", async () => {
      const modelConfig = {
        provider: "openai",
        modelId: "dall-e-3",
        displayName: "DALL-E 3",
        apiKey: "openai-key",
        secretKey: "TEST_SECRET",
        apiEndpoint: null,
      };

      await expect(
        service.callImageGenerationAPI(
          modelConfig,
          "modify image",
          dimensions,
          undefined,
          "data:image/jpeg;base64,abc123",
        ),
      ).rejects.toThrow("Image-to-Image not yet supported");
    });

    it("should route to OpenAI-compatible API for unknown providers", async () => {
      const modelConfig = {
        provider: "custom-provider",
        modelId: "custom-model",
        displayName: "Custom Model",
        apiKey: "custom-key",
        secretKey: "TEST_SECRET",
        apiEndpoint: "https://custom-api.example.com/v1",
      };

      mockHttpService.post.mockReturnValue(
        of({
          data: {
            data: [{ url: "https://custom.cdn.com/image.png" }],
          },
        }),
      );

      const result = await service.callImageGenerationAPI(
        modelConfig,
        "test prompt",
        dimensions,
      );

      expect(result).toBeDefined();
      expect(mockHttpService.post).toHaveBeenCalledWith(
        expect.stringContaining("custom-api.example.com"),
        expect.any(Object),
        expect.any(Object),
      );
    });
  });
});
