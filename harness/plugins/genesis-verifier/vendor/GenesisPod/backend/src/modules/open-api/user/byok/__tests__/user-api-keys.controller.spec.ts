import { Test, TestingModule } from "@nestjs/testing";
import { UserApiKeysController } from "../user-api-keys.controller";
import { UserApiKeysService } from "@/modules/ai-harness/facade";
import { AiModelConfigService } from "@/modules/ai-engine/facade";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";

const mockGuard = { canActivate: () => true };

describe("UserApiKeysController", () => {
  let controller: UserApiKeysController;
  let service: {
    listUserApiKeys: jest.Mock;
    getSupportedProviders: jest.Mock;
    getByokStatus: jest.Mock;
    saveKey: jest.Mock;
    deleteKey: jest.Mock;
    testKey: jest.Mock;
  };
  let aiModelConfig: { clearResolvedModelCache: jest.Mock };

  const reqUser = { user: { id: "user-1", email: "u@x.com" } } as never;

  beforeEach(async () => {
    service = {
      listUserApiKeys: jest.fn(),
      getSupportedProviders: jest.fn(),
      getByokStatus: jest.fn(),
      saveKey: jest.fn(),
      deleteKey: jest.fn(),
      testKey: jest.fn(),
    };
    aiModelConfig = { clearResolvedModelCache: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserApiKeysController],
      providers: [
        { provide: UserApiKeysService, useValue: service },
        { provide: AiModelConfigService, useValue: aiModelConfig },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get(UserApiKeysController);
  });

  describe("listKeys", () => {
    it("returns { keys, providers } combining service calls", async () => {
      service.listUserApiKeys.mockResolvedValue([{ provider: "openai" }]);
      service.getSupportedProviders.mockResolvedValue(["openai", "anthropic"]);

      const result = await controller.listKeys(reqUser);

      expect(service.listUserApiKeys).toHaveBeenCalledWith("user-1");
      expect(service.getSupportedProviders).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({
        keys: [{ provider: "openai" }],
        providers: ["openai", "anthropic"],
      });
    });

    it("returns empty keys + providers when user has none", async () => {
      service.listUserApiKeys.mockResolvedValue([]);
      service.getSupportedProviders.mockResolvedValue([]);

      const result = await controller.listKeys(reqUser);

      expect(result).toEqual({ keys: [], providers: [] });
    });
  });

  describe("getStatus", () => {
    it("delegates to service.getByokStatus", async () => {
      const status = {
        configured: true,
        activeProviders: ["openai"],
        hasModelConfig: true,
      };
      service.getByokStatus.mockResolvedValue(status);

      const result = await controller.getStatus(reqUser);

      expect(service.getByokStatus).toHaveBeenCalledWith("user-1");
      expect(result).toBe(status);
    });
  });

  describe("saveKey", () => {
    it("forwards full DTO arguments to service.saveKey", async () => {
      service.saveKey.mockResolvedValue({ id: "k1" });
      const dto = {
        apiKey: "sk-xxx",
        mode: "PERSONAL",
        preferredModelId: "gpt-4o",
        apiEndpoint: "https://api.openai.com",
      } as never;

      const result = await controller.saveKey(reqUser, "openai", dto);

      expect(service.saveKey).toHaveBeenCalledWith(
        "user-1",
        "openai",
        "sk-xxx",
        "PERSONAL",
        "gpt-4o",
        "https://api.openai.com",
        undefined, // PR-2 label param (default)
      );
      expect(result).toEqual({ id: "k1" });
      // M2: 保存 key 后失效解析缓存
      expect(aiModelConfig.clearResolvedModelCache).toHaveBeenCalledWith(
        "user-1",
      );
    });

    it("supports optional fields being undefined", async () => {
      service.saveKey.mockResolvedValue({ id: "k2" });
      const dto = { apiKey: "sk-bare", mode: "PERSONAL" } as never;

      await controller.saveKey(reqUser, "anthropic", dto);

      expect(service.saveKey).toHaveBeenCalledWith(
        "user-1",
        "anthropic",
        "sk-bare",
        "PERSONAL",
        undefined,
        undefined,
        undefined, // PR-2 label param (default)
      );
    });
  });

  describe("deleteKey", () => {
    it("calls service.deleteKey with user id and provider", async () => {
      service.deleteKey.mockResolvedValue({ deleted: true });

      const result = await controller.deleteKey(reqUser, "openai");

      expect(service.deleteKey).toHaveBeenCalledWith(
        "user-1",
        "openai",
        undefined, // PR-2 label query param
      );
      expect(result).toEqual({ deleted: true });
      // M2: 删除 key 后失效解析缓存
      expect(aiModelConfig.clearResolvedModelCache).toHaveBeenCalledWith(
        "user-1",
      );
    });
  });

  describe("testKey", () => {
    it("forwards provider, apiKey and apiEndpoint", async () => {
      service.testKey.mockResolvedValue({ ok: true });
      const dto = {
        apiKey: "sk-test",
        apiEndpoint: "https://api.openai.com",
      } as never;

      const result = await controller.testKey("openai", dto, reqUser);

      expect(service.testKey).toHaveBeenCalledWith(
        "openai",
        "sk-test",
        "https://api.openai.com",
        "user-1",
      );
      expect(result).toEqual({ ok: true });
    });

    it("propagates failed connection result", async () => {
      service.testKey.mockResolvedValue({ ok: false, error: "401" });
      const dto = { apiKey: "bad-key" } as never;

      const result = await controller.testKey("openai", dto, reqUser);

      expect(result).toEqual({ ok: false, error: "401" });
    });
  });
});
