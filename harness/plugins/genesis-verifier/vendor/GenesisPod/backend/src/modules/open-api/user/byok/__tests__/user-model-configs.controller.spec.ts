import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { UserModelConfigsController } from "../user-model-configs.controller";
import { UserModelConfigsService } from "@/modules/ai-harness/facade";
import {
  CapabilityOverridesWriterService,
  AiModelConfigService,
} from "@/modules/ai-engine/facade";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";

const mockGuard = { canActivate: () => true };

describe("UserModelConfigsController", () => {
  let controller: UserModelConfigsController;
  let service: {
    listByUser: jest.Mock;
    listByUserAndProvider: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    setDefault: jest.Mock;
    delete: jest.Mock;
  };
  let aiModelConfig: { clearResolvedModelCache: jest.Mock };

  const reqUser = { user: { id: "user-1", email: "u@x.com" } } as never;

  beforeEach(async () => {
    service = {
      listByUser: jest.fn(),
      listByUserAndProvider: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      setDefault: jest.fn(),
      delete: jest.fn(),
    };
    aiModelConfig = { clearResolvedModelCache: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserModelConfigsController],
      providers: [
        { provide: UserModelConfigsService, useValue: service },
        {
          provide: CapabilityOverridesWriterService,
          useValue: { applyOverrideTransactional: jest.fn() },
        },
        { provide: AiModelConfigService, useValue: aiModelConfig },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get(UserModelConfigsController);
  });

  describe("list", () => {
    it("calls listByUser when no provider filter", async () => {
      service.listByUser.mockResolvedValue([{ id: "c1" }]);

      const result = await controller.list(reqUser);

      expect(service.listByUser).toHaveBeenCalledWith("user-1");
      expect(service.listByUserAndProvider).not.toHaveBeenCalled();
      expect(result).toEqual({ items: [{ id: "c1" }] });
    });

    it("calls listByUserAndProvider when provider is given", async () => {
      service.listByUserAndProvider.mockResolvedValue([{ id: "c2" }]);

      const result = await controller.list(reqUser, "openai");

      expect(service.listByUserAndProvider).toHaveBeenCalledWith(
        "user-1",
        "openai",
      );
      expect(service.listByUser).not.toHaveBeenCalled();
      expect(result).toEqual({ items: [{ id: "c2" }] });
    });
  });

  describe("detail", () => {
    it("returns wrapped { item } when found", async () => {
      service.findById.mockResolvedValue({ id: "c1", provider: "openai" });

      const result = await controller.detail(reqUser, "c1");

      expect(service.findById).toHaveBeenCalledWith("user-1", "c1");
      expect(result).toEqual({ item: { id: "c1", provider: "openai" } });
    });

    it("throws NotFoundException when service returns null", async () => {
      service.findById.mockResolvedValue(null);

      await expect(controller.detail(reqUser, "missing")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("forwards user id and dto", async () => {
      const dto = { provider: "openai", modelId: "gpt-4o" } as never;
      service.create.mockResolvedValue({ id: "c1" });

      const result = await controller.create(reqUser, dto);

      expect(service.create).toHaveBeenCalledWith("user-1", dto);
      expect(result).toEqual({ id: "c1" });
      expect(aiModelConfig.clearResolvedModelCache).toHaveBeenCalledWith(
        "user-1",
      );
    });
  });

  describe("update", () => {
    it("forwards user id, id and dto", async () => {
      const dto = { displayName: "renamed" } as never;
      service.update.mockResolvedValue({ id: "c1", displayName: "renamed" });

      const result = await controller.update(reqUser, "c1", dto);

      expect(service.update).toHaveBeenCalledWith("user-1", "c1", dto);
      expect(result).toEqual({ id: "c1", displayName: "renamed" });
      expect(aiModelConfig.clearResolvedModelCache).toHaveBeenCalledWith(
        "user-1",
      );
    });
  });

  describe("setDefault", () => {
    it("delegates to service.setDefault", async () => {
      service.setDefault.mockResolvedValue({ id: "c1", isDefault: true });

      const result = await controller.setDefault(reqUser, "c1");

      expect(service.setDefault).toHaveBeenCalledWith("user-1", "c1");
      expect(result).toEqual({ id: "c1", isDefault: true });
      expect(aiModelConfig.clearResolvedModelCache).toHaveBeenCalledWith(
        "user-1",
      );
    });
  });

  describe("remove", () => {
    it("delegates to service.delete", async () => {
      service.delete.mockResolvedValue({ deleted: true });

      const result = await controller.remove(reqUser, "c1");

      expect(service.delete).toHaveBeenCalledWith("user-1", "c1");
      expect(result).toEqual({ deleted: true });
      expect(aiModelConfig.clearResolvedModelCache).toHaveBeenCalledWith(
        "user-1",
      );
    });
  });
});
