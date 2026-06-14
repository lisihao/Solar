import { Test, TestingModule } from "@nestjs/testing";
import { UserKeyAssignmentsController } from "../key-assignments.controller";
import { KeyAssignmentsService } from "@/modules/ai-harness/facade";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";

const mockGuard = { canActivate: () => true };

describe("UserKeyAssignmentsController", () => {
  let controller: UserKeyAssignmentsController;
  let service: { listByUser: jest.Mock };

  beforeEach(async () => {
    service = { listByUser: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserKeyAssignmentsController],
      providers: [{ provide: KeyAssignmentsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get(UserKeyAssignmentsController);
  });

  describe("listMine", () => {
    it("returns wrapped { items } from service.listByUser using req.user.id", async () => {
      const items = [
        { id: "a1", provider: "openai" },
        { id: "a2", provider: "anthropic" },
      ];
      service.listByUser.mockResolvedValue(items);

      const result = await controller.listMine({
        user: { id: "user-1", email: "u@x.com" },
      } as never);

      expect(service.listByUser).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ items });
    });

    it("returns empty items when user has no assignments", async () => {
      service.listByUser.mockResolvedValue([]);

      const result = await controller.listMine({
        user: { id: "user-2", email: "u2@x.com" },
      } as never);

      expect(result).toEqual({ items: [] });
    });

    it("propagates service errors", async () => {
      service.listByUser.mockRejectedValue(new Error("db down"));

      await expect(
        controller.listMine({
          user: { id: "user-3", email: "u@x.com" },
        } as never),
      ).rejects.toThrow("db down");
    });
  });
});
