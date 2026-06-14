import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { LogsService } from "../logs.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("LogsService", () => {
  let service: LogsService;
  let mockPrisma: {
    loginHistory: {
      count: jest.Mock;
      findMany: jest.Mock;
    };
    collectionTask: {
      count: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockPrisma = {
      loginHistory: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      collectionTask: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LogsService>(LogsService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== getLogsStats ====================

  describe("getLogsStats", () => {
    it("should return total logins, today logins, total tasks, failed tasks", async () => {
      // Arrange
      mockPrisma.loginHistory.count
        .mockResolvedValueOnce(500) // totalLogins
        .mockResolvedValueOnce(12); // todayLogins
      mockPrisma.collectionTask.count
        .mockResolvedValueOnce(80) // totalTasks
        .mockResolvedValueOnce(5); // failedTasks

      // Act
      const result = await service.getLogsStats();

      // Assert
      expect(result.totalLogins).toBe(500);
      expect(result.todayLogins).toBe(12);
      expect(result.totalTasks).toBe(80);
      expect(result.failedTasks).toBe(5);
    });

    it("should filter todayLogins using start-of-day timestamp", async () => {
      // Arrange
      mockPrisma.loginHistory.count.mockResolvedValue(0);
      mockPrisma.collectionTask.count.mockResolvedValue(0);

      // Act
      await service.getLogsStats();

      // Assert: second loginHistory.count call includes a gte date filter
      const todayCall = mockPrisma.loginHistory.count.mock.calls[1];
      expect(todayCall[0].where.loginAt.gte).toBeDefined();
      const filterDate = todayCall[0].where.loginAt.gte as Date;
      expect(filterDate.getHours()).toBe(0);
      expect(filterDate.getMinutes()).toBe(0);
      expect(filterDate.getSeconds()).toBe(0);
    });

    it("should filter failedTasks by FAILED status", async () => {
      // Arrange
      mockPrisma.loginHistory.count.mockResolvedValue(0);
      mockPrisma.collectionTask.count.mockResolvedValue(0);

      // Act
      await service.getLogsStats();

      // Assert: second collectionTask.count call uses FAILED status
      const failedCall = mockPrisma.collectionTask.count.mock.calls[1];
      expect(failedCall[0].where.status).toBe("FAILED");
    });

    it("should return zeros when no records exist", async () => {
      // Arrange
      mockPrisma.loginHistory.count.mockResolvedValue(0);
      mockPrisma.collectionTask.count.mockResolvedValue(0);

      // Act
      const result = await service.getLogsStats();

      // Assert
      expect(result.totalLogins).toBe(0);
      expect(result.todayLogins).toBe(0);
      expect(result.totalTasks).toBe(0);
      expect(result.failedTasks).toBe(0);
    });
  });

  // ==================== getLoginHistory ====================

  describe("getLoginHistory", () => {
    const buildLoginRecord = (id: string) => ({
      id,
      loginAt: new Date("2026-01-15T10:00:00Z"),
      ipAddress: "127.0.0.1",
      device: "Desktop",
      browser: "Chrome",
      os: "Windows",
      location: "US",
      user: { email: `${id}@test.com`, username: id },
    });

    it("should return paginated login history with user details", async () => {
      // Arrange
      const records = [buildLoginRecord("user-1"), buildLoginRecord("user-2")];
      mockPrisma.loginHistory.findMany.mockResolvedValue(records);
      mockPrisma.loginHistory.count.mockResolvedValue(2);

      // Act
      const result = await service.getLoginHistory({ page: 1, limit: 20 });

      // Assert
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it("should map item fields correctly from the join result", async () => {
      // Arrange
      const record = buildLoginRecord("alice");
      mockPrisma.loginHistory.findMany.mockResolvedValue([record]);
      mockPrisma.loginHistory.count.mockResolvedValue(1);

      // Act
      const result = await service.getLoginHistory({ page: 1, limit: 10 });

      // Assert
      const item = result.items[0];
      expect(item.id).toBe("alice");
      expect(item.userEmail).toBe("alice@test.com");
      expect(item.userName).toBe("alice");
      expect(item.ipAddress).toBe("127.0.0.1");
      expect(item.device).toBe("Desktop");
      expect(item.browser).toBe("Chrome");
      expect(item.os).toBe("Windows");
      expect(item.location).toBe("US");
    });

    it("should apply search filter to user email and username", async () => {
      // Arrange
      mockPrisma.loginHistory.findMany.mockResolvedValue([]);
      mockPrisma.loginHistory.count.mockResolvedValue(0);

      // Act
      await service.getLoginHistory({ page: 1, limit: 10, search: "alice" });

      // Assert
      const findManyCall = mockPrisma.loginHistory.findMany.mock.calls[0][0];
      expect(findManyCall.where.user.OR).toBeDefined();
      expect(findManyCall.where.user.OR).toHaveLength(2);
      expect(findManyCall.where.user.OR[0].email.contains).toBe("alice");
      expect(findManyCall.where.user.OR[0].email.mode).toBe("insensitive");
      expect(findManyCall.where.user.OR[1].username.contains).toBe("alice");
    });

    it("should use empty where clause when no search provided", async () => {
      // Arrange
      mockPrisma.loginHistory.findMany.mockResolvedValue([]);
      mockPrisma.loginHistory.count.mockResolvedValue(0);

      // Act
      await service.getLoginHistory({ page: 1, limit: 10 });

      // Assert
      const findManyCall = mockPrisma.loginHistory.findMany.mock.calls[0][0];
      expect(findManyCall.where).toEqual({});
    });

    it("should clamp page to minimum of 1", async () => {
      // Arrange
      mockPrisma.loginHistory.findMany.mockResolvedValue([]);
      mockPrisma.loginHistory.count.mockResolvedValue(0);

      // Act
      const result = await service.getLoginHistory({ page: -5, limit: 10 });

      // Assert
      expect(result.page).toBe(1);
    });

    it("should clamp limit to maximum of 100", async () => {
      // Arrange
      mockPrisma.loginHistory.findMany.mockResolvedValue([]);
      mockPrisma.loginHistory.count.mockResolvedValue(0);

      // Act
      const result = await service.getLoginHistory({ page: 1, limit: 9999 });

      // Assert
      expect(result.limit).toBe(100);
    });

    it("should use default page=1 and limit=20 when not provided", async () => {
      // Arrange
      mockPrisma.loginHistory.findMany.mockResolvedValue([]);
      mockPrisma.loginHistory.count.mockResolvedValue(0);

      // Act
      const result = await service.getLoginHistory({});

      // Assert
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it("should compute correct totalPages", async () => {
      // Arrange
      mockPrisma.loginHistory.findMany.mockResolvedValue([]);
      mockPrisma.loginHistory.count.mockResolvedValue(45);

      // Act
      const result = await service.getLoginHistory({ page: 1, limit: 20 });

      // Assert: ceil(45/20) = 3
      expect(result.totalPages).toBe(3);
    });

    it("should compute correct skip offset based on page and limit", async () => {
      // Arrange
      mockPrisma.loginHistory.findMany.mockResolvedValue([]);
      mockPrisma.loginHistory.count.mockResolvedValue(100);

      // Act
      await service.getLoginHistory({ page: 3, limit: 10 });

      // Assert: skip = (3-1)*10 = 20
      const findManyCall = mockPrisma.loginHistory.findMany.mock.calls[0][0];
      expect(findManyCall.skip).toBe(20);
      expect(findManyCall.take).toBe(10);
    });
  });

  // ==================== getTaskHistory ====================

  describe("getTaskHistory", () => {
    const buildTaskRecord = (id: string) => ({
      id,
      name: `Task ${id}`,
      status: "COMPLETED",
      totalItems: 100,
      successItems: 95,
      failedItems: 5,
      duplicateItems: 2,
      startedAt: new Date("2026-01-10T08:00:00Z"),
      completedAt: new Date("2026-01-10T09:00:00Z"),
      createdAt: new Date("2026-01-10T07:00:00Z"),
      source: { name: "Source A", type: "RSS" },
    });

    it("should return paginated task history", async () => {
      // Arrange
      mockPrisma.collectionTask.findMany.mockResolvedValue([
        buildTaskRecord("task-1"),
      ]);
      mockPrisma.collectionTask.count.mockResolvedValue(1);

      // Act
      const result = await service.getTaskHistory({ page: 1, limit: 10 });

      // Assert
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(1);
    });

    it("should map task fields including source name and type", async () => {
      // Arrange
      mockPrisma.collectionTask.findMany.mockResolvedValue([
        buildTaskRecord("task-abc"),
      ]);
      mockPrisma.collectionTask.count.mockResolvedValue(1);

      // Act
      const result = await service.getTaskHistory({ page: 1, limit: 10 });

      // Assert
      const item = result.items[0];
      expect(item.id).toBe("task-abc");
      expect(item.name).toBe("Task task-abc");
      expect(item.sourceName).toBe("Source A");
      expect(item.sourceType).toBe("RSS");
      expect(item.status).toBe("COMPLETED");
      expect(item.totalItems).toBe(100);
      expect(item.successItems).toBe(95);
      expect(item.failedItems).toBe(5);
    });

    it("should filter by valid status when provided", async () => {
      // Arrange
      mockPrisma.collectionTask.findMany.mockResolvedValue([]);
      mockPrisma.collectionTask.count.mockResolvedValue(0);

      // Act
      await service.getTaskHistory({ page: 1, limit: 10, status: "FAILED" });

      // Assert
      const findManyCall = mockPrisma.collectionTask.findMany.mock.calls[0][0];
      expect(findManyCall.where.status).toBe("FAILED");
    });

    it("should ignore invalid status values and return all tasks", async () => {
      // Arrange
      mockPrisma.collectionTask.findMany.mockResolvedValue([]);
      mockPrisma.collectionTask.count.mockResolvedValue(0);

      // Act
      await service.getTaskHistory({
        page: 1,
        limit: 10,
        status: "NOT_A_REAL_STATUS",
      });

      // Assert: where clause should be empty (no status filter)
      const findManyCall = mockPrisma.collectionTask.findMany.mock.calls[0][0];
      expect(findManyCall.where).toEqual({});
    });
  });
});
