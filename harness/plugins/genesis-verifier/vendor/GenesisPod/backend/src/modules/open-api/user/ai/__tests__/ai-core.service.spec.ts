/**
 * Unit tests for AiService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { AiService } from "../ai.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "../../../../ai-harness/facade";
import { AiModelConfigService } from "../../../../ai-engine/llm/models/config/ai-model-config.service";

const mockPrisma = {
  topic: {
    findUnique: jest.fn(),
  },
};

const mockAiFacade = {
  getDefaultModelByType: jest.fn(),
  getDefaultTextModel: jest.fn(),
  chat: jest.fn(),
};

const mockModelConfigService = {
  getEnabledModelsForFrontend: jest.fn(),
  getAllModelsForDiagnostics: jest.fn(),
  getModelsByProvider: jest.fn(),
  getFirstModelByProvider: jest.fn(),
  getModelById: jest.fn(),
};

describe("AiService", () => {
  let service: AiService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "log").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "error").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "debug").mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockAiFacade },
        { provide: AiModelConfigService, useValue: mockModelConfigService },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  describe("getEnabledModels", () => {
    it("delegates to modelConfigService.getEnabledModelsForFrontend without userId", async () => {
      const expected = [{ id: "m1", name: "GPT-4" }];
      mockModelConfigService.getEnabledModelsForFrontend.mockResolvedValue(
        expected,
      );

      const result = await service.getEnabledModels();

      expect(
        mockModelConfigService.getEnabledModelsForFrontend,
      ).toHaveBeenCalledWith(undefined, undefined);
      expect(result).toEqual(expected);
    });

    it("passes userId to getEnabledModelsForFrontend when provided", async () => {
      mockModelConfigService.getEnabledModelsForFrontend.mockResolvedValue([]);

      await service.getEnabledModels("user-123");

      expect(
        mockModelConfigService.getEnabledModelsForFrontend,
      ).toHaveBeenCalledWith(undefined, "user-123");
    });
  });

  describe("translateText", () => {
    const mockModel = {
      displayName: "Gemini Flash",
      modelId: "gemini-flash",
    };

    it("translates text successfully using CHAT_FAST model", async () => {
      mockAiFacade.getDefaultModelByType.mockResolvedValue(mockModel);
      mockAiFacade.chat.mockResolvedValue({ content: "Hello world" });

      const result = await service.translateText(
        "Bonjour le monde",
        "fr",
        "en",
      );

      expect(mockAiFacade.getDefaultModelByType).toHaveBeenCalledWith(
        AIModelType.CHAT_FAST,
      );
      expect(mockAiFacade.chat).toHaveBeenCalledTimes(1);
      expect(result).toBe("Hello world");
    });

    it("falls back to default text model when CHAT_FAST is unavailable", async () => {
      mockAiFacade.getDefaultModelByType.mockResolvedValue(null);
      mockAiFacade.getDefaultTextModel.mockResolvedValue(mockModel);
      mockAiFacade.chat.mockResolvedValue({ content: "Translated" });

      const result = await service.translateText("text", "de", "en");

      expect(mockAiFacade.getDefaultTextModel).toHaveBeenCalled();
      expect(result).toBe("Translated");
    });

    it("throws SERVICE_UNAVAILABLE when no model is available", async () => {
      mockAiFacade.getDefaultModelByType.mockResolvedValue(null);
      mockAiFacade.getDefaultTextModel.mockResolvedValue(null);

      await expect(service.translateText("text", "de", "en")).rejects.toThrow(
        HttpException,
      );
    });

    it("throws SERVICE_UNAVAILABLE when chat throws an error", async () => {
      mockAiFacade.getDefaultModelByType.mockResolvedValue(mockModel);
      mockAiFacade.chat.mockRejectedValue(new Error("LLM failure"));

      await expect(
        service.translateText("text", "fr", "en"),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          originalText: "text",
        }),
      });
    });

    it("calculates dynamic maxTokens based on text length", async () => {
      mockAiFacade.getDefaultModelByType.mockResolvedValue(mockModel);
      mockAiFacade.chat.mockResolvedValue({ content: "ok" });

      const longText = "a".repeat(3000); // ~1000 estimated tokens -> maxTokens = 2000
      await service.translateText(longText, "fr", "en");

      const chatCall = mockAiFacade.chat.mock.calls[0][0] as {
        maxTokens: number;
      };
      expect(chatCall.maxTokens).toBeGreaterThanOrEqual(2000);
    });

    it("uses correct task profile for translation", async () => {
      mockAiFacade.getDefaultModelByType.mockResolvedValue(mockModel);
      mockAiFacade.chat.mockResolvedValue({ content: "ok" });

      await service.translateText("text", "fr", "en");

      const chatCall = mockAiFacade.chat.mock.calls[0][0] as {
        taskProfile: { creativity: string; outputLength: string };
      };
      expect(chatCall.taskProfile).toEqual({
        creativity: "low",
        outputLength: "medium",
      });
    });
  });

  describe("getAllModels", () => {
    it("delegates to modelConfigService.getAllModelsForDiagnostics", async () => {
      const expected = [{ id: "m1" }];
      mockModelConfigService.getAllModelsForDiagnostics.mockResolvedValue(
        expected,
      );

      const result = await service.getAllModels();

      expect(
        mockModelConfigService.getAllModelsForDiagnostics,
      ).toHaveBeenCalled();
      expect(result).toEqual(expected);
    });
  });

  describe("getGoogleModels", () => {
    it("delegates to modelConfigService.getModelsByProvider with 'gemini'", async () => {
      const expected = [{ id: "g1", provider: "gemini" }];
      mockModelConfigService.getModelsByProvider.mockResolvedValue(expected);

      const result = await service.getGoogleModels();

      expect(mockModelConfigService.getModelsByProvider).toHaveBeenCalledWith(
        "gemini",
      );
      expect(result).toEqual(expected);
    });
  });

  describe("getFirstGoogleModelWithKey", () => {
    it("delegates to modelConfigService.getFirstModelByProvider with 'gemini'", async () => {
      const expected = { id: "g1" };
      mockModelConfigService.getFirstModelByProvider.mockResolvedValue(
        expected,
      );

      const result = await service.getFirstGoogleModelWithKey();

      expect(
        mockModelConfigService.getFirstModelByProvider,
      ).toHaveBeenCalledWith("gemini");
      expect(result).toEqual(expected);
    });
  });

  describe("getTopicWithAIMembers", () => {
    it("queries prisma for topic with aiMembers", async () => {
      const expected = { id: "topic-1", aiMembers: [] };
      mockPrisma.topic.findUnique.mockResolvedValue(expected);

      const result = await service.getTopicWithAIMembers("topic-1");

      expect(mockPrisma.topic.findUnique).toHaveBeenCalledWith({
        where: { id: "topic-1" },
        include: { aiMembers: true },
      });
      expect(result).toEqual(expected);
    });

    it("returns null when topic not found", async () => {
      mockPrisma.topic.findUnique.mockResolvedValue(null);

      const result = await service.getTopicWithAIMembers("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("findModelByModelId", () => {
    it("delegates to modelConfigService.getModelById", async () => {
      const expected = { id: "m1", modelId: "gpt-4o" };
      mockModelConfigService.getModelById.mockResolvedValue(expected);

      const result = await service.findModelByModelId("gpt-4o");

      expect(mockModelConfigService.getModelById).toHaveBeenCalledWith(
        "gpt-4o",
      );
      expect(result).toEqual(expected);
    });
  });

  describe("findModelByName", () => {
    it("delegates to modelConfigService.getModelById with name", async () => {
      const expected = { id: "m1", name: "GPT-4" };
      mockModelConfigService.getModelById.mockResolvedValue(expected);

      const result = await service.findModelByName("GPT-4");

      expect(mockModelConfigService.getModelById).toHaveBeenCalledWith("GPT-4");
      expect(result).toEqual(expected);
    });
  });
});
