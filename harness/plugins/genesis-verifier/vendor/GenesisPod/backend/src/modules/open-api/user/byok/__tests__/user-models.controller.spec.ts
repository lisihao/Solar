import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  UserModelsController,
  UserModelConfigsAutoController,
} from "../user-models.controller";
import {
  AiModelDiscoveryService,
  AiConnectionTestService,
  UserApiKeysService,
  UserModelConfigsService,
  AutoConfigureService,
} from "@/modules/ai-harness/facade";
import { KeyHealthStore } from "@/modules/platform/credentials/governance/key-health";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";

const mockGuard = { canActivate: () => true };

describe("UserModelsController", () => {
  let controller: UserModelsController;
  let modelDiscovery: { fetchAvailableModels: jest.Mock };
  let userApiKeys: { getPersonalKey: jest.Mock };

  const reqUser = { user: { id: "user-1", email: "u@x.com" } } as never;

  beforeEach(async () => {
    modelDiscovery = { fetchAvailableModels: jest.fn() };
    userApiKeys = { getPersonalKey: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserModelsController],
      providers: [
        { provide: AiModelDiscoveryService, useValue: modelDiscovery },
        { provide: UserApiKeysService, useValue: userApiKeys },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get(UserModelsController);
  });

  describe("fetchAvailableModels", () => {
    it("uses dto.apiKey when provided (form input takes priority)", async () => {
      modelDiscovery.fetchAvailableModels.mockResolvedValue({
        models: [{ id: "m1" }],
      });

      const result = await controller.fetchAvailableModels(reqUser, "OpenAI", {
        apiKey: "  sk-form  ",
        apiEndpoint: "  https://api.example.com  ",
        modelType: "CHAT",
      });

      expect(userApiKeys.getPersonalKey).not.toHaveBeenCalled();
      expect(modelDiscovery.fetchAvailableModels).toHaveBeenCalledWith(
        "openai",
        "sk-form",
        "https://api.example.com",
        "CHAT",
      );
      expect(result).toEqual({ models: [{ id: "m1" }] });
    });

    it("falls back to saved Personal Key when dto.apiKey is missing", async () => {
      userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-saved" });
      modelDiscovery.fetchAvailableModels.mockResolvedValue({ models: [] });

      await controller.fetchAvailableModels(reqUser, "openai", {});

      expect(userApiKeys.getPersonalKey).toHaveBeenCalledWith(
        "user-1",
        "openai",
      );
      expect(modelDiscovery.fetchAvailableModels).toHaveBeenCalledWith(
        "openai",
        "sk-saved",
        undefined,
        undefined,
      );
    });

    it("falls back to saved key when dto.apiKey is whitespace only", async () => {
      userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-saved" });
      modelDiscovery.fetchAvailableModels.mockResolvedValue({ models: [] });

      await controller.fetchAvailableModels(reqUser, "openai", {
        apiKey: "   ",
      });

      expect(userApiKeys.getPersonalKey).toHaveBeenCalled();
      expect(modelDiscovery.fetchAvailableModels).toHaveBeenCalledWith(
        "openai",
        "sk-saved",
        undefined,
        undefined,
      );
    });

    it("throws BadRequestException when neither form key nor saved key is available", async () => {
      userApiKeys.getPersonalKey.mockResolvedValue(null);

      await expect(
        controller.fetchAvailableModels(reqUser, "openai", {}),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when saved key has no apiKey field", async () => {
      userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: null });

      await expect(
        controller.fetchAvailableModels(reqUser, "openai", {}),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

describe("UserModelConfigsAutoController", () => {
  let controller: UserModelConfigsAutoController;
  let autoConfigure: { runForUser: jest.Mock };
  let userModelConfigs: { findById: jest.Mock };
  let userApiKeys: { getPersonalKey: jest.Mock };
  let connectionTest: { testModelConnectionWithKey: jest.Mock };
  let keyHealth: { forceHealthy: jest.Mock };

  const reqUser = { user: { id: "user-1", email: "u@x.com" } } as never;

  beforeEach(async () => {
    autoConfigure = { runForUser: jest.fn() };
    userModelConfigs = { findById: jest.fn() };
    userApiKeys = { getPersonalKey: jest.fn() };
    connectionTest = { testModelConnectionWithKey: jest.fn() };
    keyHealth = { forceHealthy: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserModelConfigsAutoController],
      providers: [
        { provide: AutoConfigureService, useValue: autoConfigure },
        { provide: UserModelConfigsService, useValue: userModelConfigs },
        { provide: UserApiKeysService, useValue: userApiKeys },
        { provide: AiConnectionTestService, useValue: connectionTest },
        { provide: KeyHealthStore, useValue: keyHealth },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get(UserModelConfigsAutoController);
  });

  describe("autoConfigureModels", () => {
    it("delegates to autoConfigure.runForUser", async () => {
      autoConfigure.runForUser.mockResolvedValue({ created: 3 });

      const result = await controller.autoConfigureModels(reqUser);

      expect(autoConfigure.runForUser).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ created: 3 });
    });
  });

  describe("testConnection", () => {
    it("throws NotFoundException when config does not exist", async () => {
      userModelConfigs.findById.mockResolvedValue(null);

      await expect(
        controller.testConnection(reqUser, "missing"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when no Personal Key for the provider", async () => {
      userModelConfigs.findById.mockResolvedValue({
        provider: "openai",
        modelId: "gpt-4o",
        modelType: "CHAT",
        apiEndpoint: null,
      });
      userApiKeys.getPersonalKey.mockResolvedValue(null);

      await expect(controller.testConnection(reqUser, "c1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException when personal key is empty string", async () => {
      userModelConfigs.findById.mockResolvedValue({
        provider: "openai",
        modelId: "gpt-4o",
        modelType: "CHAT",
      });
      userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "" });

      await expect(controller.testConnection(reqUser, "c1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("uses config.apiEndpoint when set", async () => {
      userModelConfigs.findById.mockResolvedValue({
        provider: "openai",
        modelId: "gpt-4o",
        modelType: "CHAT",
        apiEndpoint: "  https://config.example.com  ",
      });
      userApiKeys.getPersonalKey.mockResolvedValue({
        apiKey: "sk-personal",
        apiEndpoint: "https://saved.example.com",
      });
      connectionTest.testModelConnectionWithKey.mockResolvedValue({ ok: true });

      const result = await controller.testConnection(reqUser, "c1");

      expect(connectionTest.testModelConnectionWithKey).toHaveBeenCalledWith(
        "openai",
        "gpt-4o",
        "sk-personal",
        "https://config.example.com",
        "CHAT",
      );
      expect(result).toEqual({ ok: true });
    });

    it("falls back to personal key apiEndpoint when config has none", async () => {
      userModelConfigs.findById.mockResolvedValue({
        provider: "openai",
        modelId: "gpt-4o",
        modelType: "CHAT",
        apiEndpoint: null,
      });
      userApiKeys.getPersonalKey.mockResolvedValue({
        apiKey: "sk-personal",
        apiEndpoint: "  https://saved.example.com  ",
      });
      connectionTest.testModelConnectionWithKey.mockResolvedValue({ ok: true });

      await controller.testConnection(reqUser, "c1");

      expect(connectionTest.testModelConnectionWithKey).toHaveBeenCalledWith(
        "openai",
        "gpt-4o",
        "sk-personal",
        "https://saved.example.com",
        "CHAT",
      );
    });

    it("uses empty string endpoint when neither config nor key has it", async () => {
      userModelConfigs.findById.mockResolvedValue({
        provider: "anthropic",
        modelId: "claude-3-5-sonnet",
        modelType: "CHAT",
        apiEndpoint: null,
      });
      userApiKeys.getPersonalKey.mockResolvedValue({
        apiKey: "sk-personal",
        apiEndpoint: null,
      });
      connectionTest.testModelConnectionWithKey.mockResolvedValue({ ok: true });

      await controller.testConnection(reqUser, "c1");

      expect(connectionTest.testModelConnectionWithKey).toHaveBeenCalledWith(
        "anthropic",
        "claude-3-5-sonnet",
        "sk-personal",
        "",
        "CHAT",
      );
    });
  });
});
