import { Test, TestingModule } from "@nestjs/testing";
import { PermissionsController } from "../permissions/permissions.controller";
import { PermissionsService } from "../services/permissions.service";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";

jest.mock("../services/permissions.service");

describe("PermissionsController", () => {
  let controller: PermissionsController;
  let service: jest.Mocked<PermissionsService>;

  const mockPermissionsOverview = {
    totalUsers: 150,
    adminCount: 5,
    activeUsers: 120,
    recentNewUsers: 8,
    admins: [
      {
        id: "admin-1",
        email: "admin@example.com",
        username: "admin",
        role: "ADMIN",
        createdAt: new Date("2025-01-01"),
        lastLoginAt: new Date("2026-03-01"),
      },
    ],
  };

  const mockPermissionsService = {
    getPermissionsOverview: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PermissionsController],
      providers: [
        { provide: PermissionsService, useValue: mockPermissionsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(PermissionsController);
    service = module.get(PermissionsService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getPermissionsOverview", () => {
    it("should call service.getPermissionsOverview and return result", async () => {
      mockPermissionsService.getPermissionsOverview.mockResolvedValue(
        mockPermissionsOverview,
      );

      const result = await controller.getPermissionsOverview();

      expect(service.getPermissionsOverview).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockPermissionsOverview);
    });

    it("should return overview with expected structure", async () => {
      mockPermissionsService.getPermissionsOverview.mockResolvedValue(
        mockPermissionsOverview,
      );

      const result = await controller.getPermissionsOverview();

      expect(result).toHaveProperty("totalUsers");
      expect(result).toHaveProperty("adminCount");
      expect(result).toHaveProperty("activeUsers");
      expect(result).toHaveProperty("recentNewUsers");
      expect(result).toHaveProperty("admins");
      expect(Array.isArray(result.admins)).toBe(true);
    });

    it("should return correct counts", async () => {
      mockPermissionsService.getPermissionsOverview.mockResolvedValue(
        mockPermissionsOverview,
      );

      const result = await controller.getPermissionsOverview();

      expect(result.totalUsers).toBe(150);
      expect(result.adminCount).toBe(5);
      expect(result.activeUsers).toBe(120);
      expect(result.recentNewUsers).toBe(8);
    });

    it("should return admin list with correct fields", async () => {
      mockPermissionsService.getPermissionsOverview.mockResolvedValue(
        mockPermissionsOverview,
      );

      const result = await controller.getPermissionsOverview();

      expect(result.admins[0]).toHaveProperty("id");
      expect(result.admins[0]).toHaveProperty("email");
      expect(result.admins[0]).toHaveProperty("username");
      expect(result.admins[0]).toHaveProperty("role");
    });

    it("should propagate errors from service", async () => {
      mockPermissionsService.getPermissionsOverview.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(controller.getPermissionsOverview()).rejects.toThrow(
        "DB error",
      );
    });

    it("should handle empty admin list", async () => {
      const emptyOverview = {
        ...mockPermissionsOverview,
        admins: [],
        adminCount: 0,
      };
      mockPermissionsService.getPermissionsOverview.mockResolvedValue(
        emptyOverview,
      );

      const result = await controller.getPermissionsOverview();

      expect(result.admins).toEqual([]);
      expect(result.adminCount).toBe(0);
    });
  });
});
