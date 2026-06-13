/**
 * MissionAICallerService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { MissionAICallerService } from "../mission-ai-caller.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

const mockModelConfig = {
  id: "model-1",
  modelId: "gemini-pro",
  provider: "google",
  name: "Gemini Pro",
};

describe("MissionAICallerService", () => {
  let service: MissionAICallerService;
  let prisma: { $executeRaw: jest.Mock };
  let aiFacade: { chat: jest.Mock; getModelById: jest.Mock };

  beforeEach(async () => {
    prisma = {
      $executeRaw: jest.fn().mockResolvedValue(1),
    };

    aiFacade = {
      chat: jest
        .fn()
        .mockResolvedValue({ content: "AI response", tokensUsed: 150 }),
      getModelById: jest.fn().mockResolvedValue(mockModelConfig),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionAICallerService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatFacade, useValue: aiFacade },
      ],
    }).compile();

    service = module.get<MissionAICallerService>(MissionAICallerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getModelConfig", () => {
    it("should return model config from facade", async () => {
      const result = await service.getModelConfig("gemini-pro");

      expect(result).toEqual(mockModelConfig);
      expect(aiFacade.getModelById).toHaveBeenCalledWith("gemini-pro");
    });

    it("should return null when model not found", async () => {
      aiFacade.getModelById.mockResolvedValue(null);

      const result = await service.getModelConfig("unknown-model");

      expect(result).toBeNull();
    });
  });

  describe("callAIWithConfig", () => {
    const messages = [{ role: "user", content: "What is AI?" }];
    const systemPrompt = "You are a helpful assistant.";

    it("should call AI with messages and return result", async () => {
      const result = await service.callAIWithConfig(
        "gemini-pro",
        messages,
        systemPrompt,
      );

      expect(result).toEqual({ content: "AI response", tokensUsed: 150 });
      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system", content: systemPrompt }),
          ]),
        }),
      );
    });

    it("should use taskProfile when provided", async () => {
      await service.callAIWithConfig("gemini-pro", messages, systemPrompt, {
        taskProfile: { creativity: "high", outputLength: "long" },
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: { creativity: "high", outputLength: "long" },
        }),
      );
    });

    it("should map temperature to creativity when taskProfile not provided", async () => {
      await service.callAIWithConfig("gemini-pro", messages, systemPrompt, {
        temperature: 0.9,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ creativity: "high" }),
        }),
      );
    });

    it("should map maxTokens to outputLength when taskProfile not provided", async () => {
      await service.callAIWithConfig("gemini-pro", messages, systemPrompt, {
        maxTokens: 6000,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ outputLength: "long" }),
        }),
      );
    });

    it("should use modelId from model config when available", async () => {
      await service.callAIWithConfig("gemini-pro", messages, systemPrompt);

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gemini-pro" }),
      );
    });

    it("should use aiModel as fallback when model config not found", async () => {
      aiFacade.getModelById.mockResolvedValue(null);

      await service.callAIWithConfig("my-custom-model", messages, systemPrompt);

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "my-custom-model" }),
      );
    });

    it("should track mission tokens when missionId is provided and tokensUsed > 0", async () => {
      await service.callAIWithConfig("gemini-pro", messages, systemPrompt, {
        missionId: "mission-123",
      });

      // Allow the async trackMissionTokens to run
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("should NOT track tokens when missionId is not provided", async () => {
      await service.callAIWithConfig("gemini-pro", messages, systemPrompt);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it("should NOT track tokens when tokensUsed is 0", async () => {
      aiFacade.chat.mockResolvedValue({ content: "response", tokensUsed: 0 });

      await service.callAIWithConfig("gemini-pro", messages, systemPrompt, {
        missionId: "mission-123",
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe("trackMissionTokens", () => {
    it("should execute raw SQL to update tokens", async () => {
      await service.trackMissionTokens("mission-123", 500);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("should not throw when DB update fails", async () => {
      prisma.$executeRaw.mockRejectedValue(new Error("DB connection failed"));

      await expect(
        service.trackMissionTokens("mission-123", 500),
      ).resolves.not.toThrow();
    });
  });

  describe("mapTemperatureToCreativity", () => {
    it('should return "medium" when temperature is undefined', () => {
      expect(service.mapTemperatureToCreativity(undefined)).toBe("medium");
    });

    it('should return "deterministic" for temperature <= 0.2', () => {
      expect(service.mapTemperatureToCreativity(0)).toBe("deterministic");
      expect(service.mapTemperatureToCreativity(0.1)).toBe("deterministic");
      expect(service.mapTemperatureToCreativity(0.2)).toBe("deterministic");
    });

    it('should return "low" for temperature <= 0.5', () => {
      expect(service.mapTemperatureToCreativity(0.3)).toBe("low");
      expect(service.mapTemperatureToCreativity(0.5)).toBe("low");
    });

    it('should return "medium" for temperature <= 0.8', () => {
      expect(service.mapTemperatureToCreativity(0.6)).toBe("medium");
      expect(service.mapTemperatureToCreativity(0.8)).toBe("medium");
    });

    it('should return "high" for temperature > 0.8', () => {
      expect(service.mapTemperatureToCreativity(0.9)).toBe("high");
      expect(service.mapTemperatureToCreativity(1.0)).toBe("high");
    });
  });

  describe("mapMaxTokensToOutputLength", () => {
    it('should return "medium" when maxTokens is undefined', () => {
      expect(service.mapMaxTokensToOutputLength(undefined)).toBe("medium");
    });

    it('should return "minimal" for maxTokens <= 1000', () => {
      expect(service.mapMaxTokensToOutputLength(500)).toBe("minimal");
      expect(service.mapMaxTokensToOutputLength(1000)).toBe("minimal");
    });

    it('should return "short" for maxTokens <= 2000', () => {
      expect(service.mapMaxTokensToOutputLength(1500)).toBe("short");
      expect(service.mapMaxTokensToOutputLength(2000)).toBe("short");
    });

    it('should return "medium" for maxTokens <= 4000', () => {
      expect(service.mapMaxTokensToOutputLength(3000)).toBe("medium");
      expect(service.mapMaxTokensToOutputLength(4000)).toBe("medium");
    });

    it('should return "long" for maxTokens <= 8000', () => {
      expect(service.mapMaxTokensToOutputLength(6000)).toBe("long");
      expect(service.mapMaxTokensToOutputLength(8000)).toBe("long");
    });

    it('should return "standard" for maxTokens <= 12000', () => {
      expect(service.mapMaxTokensToOutputLength(10000)).toBe("standard");
      expect(service.mapMaxTokensToOutputLength(12000)).toBe("standard");
    });

    it('should return "extended" for maxTokens > 12000', () => {
      expect(service.mapMaxTokensToOutputLength(15000)).toBe("extended");
    });
  });
});
