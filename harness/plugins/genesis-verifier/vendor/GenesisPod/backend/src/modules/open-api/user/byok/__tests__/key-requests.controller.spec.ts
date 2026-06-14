import { Test, TestingModule } from "@nestjs/testing";
import { UserKeyRequestsController } from "../key-requests.controller";
import { KeyRequestsService } from "@/modules/ai-harness/facade";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";

const mockGuard = { canActivate: () => true };

describe("UserKeyRequestsController", () => {
  let controller: UserKeyRequestsController;
  let service: {
    listMine: jest.Mock;
    create: jest.Mock;
    cancel: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listMine: jest.fn(),
      create: jest.fn(),
      cancel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserKeyRequestsController],
      providers: [{ provide: KeyRequestsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get(UserKeyRequestsController);
  });

  describe("listMine", () => {
    it("returns wrapped { items } using req.user.id", async () => {
      const items = [{ id: "kr-1", provider: "openai", status: "PENDING" }];
      service.listMine.mockResolvedValue(items);

      const result = await controller.listMine({
        user: { id: "user-1", email: "u@x.com" },
      } as never);

      expect(service.listMine).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ items });
    });

    it("handles empty list", async () => {
      service.listMine.mockResolvedValue([]);

      const result = await controller.listMine({
        user: { id: "user-2", email: "u@x.com" },
      } as never);

      expect(result).toEqual({ items: [] });
    });
  });

  describe("create", () => {
    it("forwards user id and dto to service.create", async () => {
      // 2026-05-08: dto 不再带 provider；admin 在审批时选模型授权
      const dto = { reason: "学习用途" } as never;
      const created = { id: "kr-1", status: "PENDING" };
      service.create.mockResolvedValue(created);

      const result = await controller.create(
        { user: { id: "user-1", email: "u@x.com" } } as never,
        dto,
      );

      expect(service.create).toHaveBeenCalledWith("user-1", dto);
      expect(result).toBe(created);
    });

    it("propagates service errors (e.g. duplicate request)", async () => {
      service.create.mockRejectedValue(new Error("duplicate request"));

      await expect(
        controller.create(
          { user: { id: "user-1", email: "u@x.com" } } as never,
          { reason: "x" } as never,
        ),
      ).rejects.toThrow("duplicate request");
    });
  });

  describe("cancel", () => {
    it("passes id and user id to service.cancel", async () => {
      service.cancel.mockResolvedValue({ id: "kr-1", status: "CANCELLED" });

      const result = await controller.cancel(
        { user: { id: "user-1", email: "u@x.com" } } as never,
        "kr-1",
      );

      expect(service.cancel).toHaveBeenCalledWith("kr-1", "user-1");
      expect(result).toEqual({ id: "kr-1", status: "CANCELLED" });
    });

    it("propagates not-found errors", async () => {
      service.cancel.mockRejectedValue(new Error("not found"));

      await expect(
        controller.cancel(
          { user: { id: "user-1", email: "u@x.com" } } as never,
          "missing-id",
        ),
      ).rejects.toThrow("not found");
    });
  });
});
