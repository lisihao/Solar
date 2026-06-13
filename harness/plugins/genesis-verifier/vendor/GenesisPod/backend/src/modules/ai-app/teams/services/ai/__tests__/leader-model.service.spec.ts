/**
 * LeaderModelService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { LeaderModelService } from "../leader-model.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

const mockModelConfig = {
  id: "model-1",
  modelId: "gemini-pro",
  provider: "google",
  name: "Gemini Pro",
};

const mockModelFallback = {
  getModelFallbackChain: jest.fn().mockResolvedValue([mockModelConfig]),
  executeWithFallback: jest.fn(),
  getModelConfig: jest.fn().mockResolvedValue(mockModelConfig),
  shouldSwitchModel: jest.fn().mockReturnValue(false),
};

describe("LeaderModelService", () => {
  let service: LeaderModelService;
  let aiFacade: { modelFallback: typeof mockModelFallback | null }; // shape matches ChatFacade.modelFallback

  beforeEach(async () => {
    aiFacade = {
      modelFallback: mockModelFallback,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderModelService,
        { provide: ChatFacade, useValue: aiFacade },
      ],
    }).compile();

    service = module.get<LeaderModelService>(LeaderModelService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getReasoningModelFallbackChain", () => {
    it("should return reasoning model chain", async () => {
      const result = await service.getReasoningModelFallbackChain();

      expect(result).toEqual([mockModelConfig]);
      expect(mockModelFallback.getModelFallbackChain).toHaveBeenCalledWith({
        preferReasoning: true,
        excludeModels: [],
      });
    });

    it("should pass excludeModels to fallback service", async () => {
      const excluded = ["model-x", "model-y"];
      await service.getReasoningModelFallbackChain(excluded);

      expect(mockModelFallback.getModelFallbackChain).toHaveBeenCalledWith({
        preferReasoning: true,
        excludeModels: excluded,
      });
    });

    it("should return empty array when modelFallback is not available", async () => {
      aiFacade.modelFallback = null;

      const result = await service.getReasoningModelFallbackChain();

      expect(result).toEqual([]);
    });
  });

  describe("executeWithFallback", () => {
    it("should delegate to modelFallback.executeWithFallback", async () => {
      const mockResult = {
        success: true,
        data: "result data",
        modelUsed: "gemini-pro",
        fallbackUsed: false,
        attempts: 1,
        attemptedModels: ["gemini-pro"],
      };
      mockModelFallback.executeWithFallback.mockResolvedValue(mockResult);

      const executor = jest.fn().mockResolvedValue("result data");
      const result = await service.executeWithFallback("gemini-pro", executor, {
        operation: "test_op",
      });

      expect(result).toEqual(mockResult);
      expect(mockModelFallback.executeWithFallback).toHaveBeenCalledWith(
        "gemini-pro",
        executor,
        expect.objectContaining({
          preferReasoning: true,
          operation: "test_op",
        }),
      );
    });

    it("should throw when modelFallback is not available", async () => {
      aiFacade.modelFallback = null;

      const executor = jest.fn();
      await expect(
        service.executeWithFallback("model-id", executor),
      ).rejects.toThrow("ModelFallbackService is not available");
    });

    it("should use default operation name when not specified", async () => {
      mockModelFallback.executeWithFallback.mockResolvedValue({
        success: true,
        data: "ok",
        modelUsed: "gemini-pro",
        fallbackUsed: false,
        attempts: 1,
        attemptedModels: [],
      });

      const executor = jest.fn().mockResolvedValue("ok");
      await service.executeWithFallback("gemini-pro", executor, {});

      expect(mockModelFallback.executeWithFallback).toHaveBeenCalledWith(
        "gemini-pro",
        executor,
        expect.objectContaining({ operation: "leader_call" }),
      );
    });

    it("should pass context options through", async () => {
      mockModelFallback.executeWithFallback.mockResolvedValue({
        success: true,
        data: "ok",
        modelUsed: "gemini-pro",
        fallbackUsed: false,
        attempts: 1,
        attemptedModels: [],
      });

      const executor = jest.fn().mockResolvedValue("ok");
      const context = { missionId: "mission-1", taskId: "task-1" };
      await service.executeWithFallback("gemini-pro", executor, { context });

      expect(mockModelFallback.executeWithFallback).toHaveBeenCalledWith(
        "gemini-pro",
        executor,
        expect.objectContaining({ context }),
      );
    });
  });

  describe("getModelConfig", () => {
    it("should return model config by id", async () => {
      const result = await service.getModelConfig("model-1");

      expect(result).toEqual(mockModelConfig);
      expect(mockModelFallback.getModelConfig).toHaveBeenCalledWith("model-1");
    });

    it("should return null when modelFallback is not available", async () => {
      aiFacade.modelFallback = null;

      const result = await service.getModelConfig("model-1");

      expect(result).toBeNull();
    });
  });

  describe("shouldSwitchModel", () => {
    it("should delegate to modelFallback.shouldSwitchModel", () => {
      const mockError = {
        type: "rate_limit",
        getUserMessage: () => "rate limit",
      } as any;
      mockModelFallback.shouldSwitchModel.mockReturnValue(true);

      const result = service.shouldSwitchModel(mockError);

      expect(result).toBe(true);
      expect(mockModelFallback.shouldSwitchModel).toHaveBeenCalledWith(
        mockError,
      );
    });

    it("should return false when modelFallback is not available", () => {
      aiFacade.modelFallback = null;

      const mockError = {
        type: "api_error",
        getUserMessage: () => "error",
      } as any;
      const result = service.shouldSwitchModel(mockError);

      expect(result).toBe(false);
    });
  });
});
