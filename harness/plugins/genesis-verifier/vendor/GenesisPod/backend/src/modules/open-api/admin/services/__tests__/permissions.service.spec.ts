import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PermissionsService } from "../permissions.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("PermissionsService", () => {
  let service: PermissionsService;
  let mockPrisma: {
    user: {
      count: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockPrisma = {
      user: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== getPermissionsOverview ====================

  describe("getPermissionsOverview", () => {
    const buildAdminUser = (id: string, email: string) => ({
      id,
      email,
      username: `admin_${id}`,
      role: "ADMIN",
      createdAt: new Date("2025-01-01T00:00:00Z"),
      lastLoginAt: new Date("2026-01-15T12:00:00Z"),
    });

    it("should return all overview fields with correct counts", async () => {
      // Arrange
      mockPrisma.user.count
        .mockResolvedValueOnce(200) // totalUsers
        .mockResolvedValueOnce(5) // adminCount
        .mockResolvedValueOnce(150) // activeUsers
        .mockResolvedValueOnce(8); // recentNewUsers

      mockPrisma.user.findMany.mockResolvedValue([
        buildAdminUser("u1", "admin1@example.com"),
        buildAdminUser("u2", "admin2@example.com"),
      ]);

      // Act
      const result = await service.getPermissionsOverview();

      // Assert
      expect(result.totalUsers).toBe(200);
      expect(result.adminCount).toBe(5);
      expect(result.activeUsers).toBe(150);
      expect(result.recentNewUsers).toBe(8);
      expect(result.admins).toHaveLength(2);
    });

    it("should filter adminCount by ADMIN role", async () => {
      // Arrange
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([]);

      // Act
      await service.getPermissionsOverview();

      // Assert: second count call filters by role ADMIN
      const adminCountCall = mockPrisma.user.count.mock.calls[1];
      expect(adminCountCall[0].where.role).toBe("ADMIN");
    });

    it("should filter activeUsers by isActive = true", async () => {
      // Arrange
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([]);

      // Act
      await service.getPermissionsOverview();

      // Assert: third count call filters by isActive = true
      const activeUsersCall = mockPrisma.user.count.mock.calls[2];
      expect(activeUsersCall[0].where.isActive).toBe(true);
    });

    it("should filter recentNewUsers with a 7-day date range", async () => {
      // Arrange
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([]);

      const before = Date.now();

      // Act
      await service.getPermissionsOverview();

      const after = Date.now();

      // Assert: fourth count call uses createdAt gte within last 7 days
      const recentCall = mockPrisma.user.count.mock.calls[3];
      const gteDate = recentCall[0].where.createdAt.gte as Date;
      const expectedLower = before - 7 * 24 * 60 * 60 * 1000;
      const expectedUpper = after - 7 * 24 * 60 * 60 * 1000;
      expect(gteDate.getTime()).toBeGreaterThanOrEqual(expectedLower);
      expect(gteDate.getTime()).toBeLessThanOrEqual(expectedUpper);
    });

    it("should fetch admin list filtered by ADMIN role", async () => {
      // Arrange
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([]);

      // Act
      await service.getPermissionsOverview();

      // Assert: findMany is called with ADMIN role filter
      const findManyCall = mockPrisma.user.findMany.mock.calls[0][0];
      expect(findManyCall.where.role).toBe("ADMIN");
    });

    it("should select specific fields for the admin list", async () => {
      // Arrange
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([]);

      // Act
      await service.getPermissionsOverview();

      // Assert: select includes required fields
      const findManyCall = mockPrisma.user.findMany.mock.calls[0][0];
      const { select } = findManyCall;
      expect(select.id).toBe(true);
      expect(select.email).toBe(true);
      expect(select.username).toBe(true);
      expect(select.role).toBe(true);
      expect(select.createdAt).toBe(true);
      expect(select.lastLoginAt).toBe(true);
    });

    it("should limit admin list to at most 100 entries", async () => {
      // Arrange
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([]);

      // Act
      await service.getPermissionsOverview();

      // Assert
      const findManyCall = mockPrisma.user.findMany.mock.calls[0][0];
      expect(findManyCall.take).toBe(100);
    });

    it("should order admin list by createdAt desc", async () => {
      // Arrange
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([]);

      // Act
      await service.getPermissionsOverview();

      // Assert
      const findManyCall = mockPrisma.user.findMany.mock.calls[0][0];
      expect(findManyCall.orderBy).toEqual({ createdAt: "desc" });
    });

    it("should return empty admins array when no admin users exist", async () => {
      // Arrange
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([]);

      // Act
      const result = await service.getPermissionsOverview();

      // Assert
      expect(result.admins).toEqual([]);
      expect(result.totalUsers).toBe(0);
      expect(result.adminCount).toBe(0);
    });

    it("should include full admin user objects in the admins list", async () => {
      // Arrange
      const adminUser = buildAdminUser("admin-1", "boss@company.com");
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.user.findMany.mockResolvedValue([adminUser]);

      // Act
      const result = await service.getPermissionsOverview();

      // Assert
      expect(result.admins[0]).toEqual(adminUser);
    });
  });
});
