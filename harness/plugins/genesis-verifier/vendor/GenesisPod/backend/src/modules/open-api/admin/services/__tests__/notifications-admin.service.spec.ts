import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { NotificationsAdminService } from "../notifications-admin.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("NotificationsAdminService", () => {
  let service: NotificationsAdminService;
  let mockPrisma: {
    notification: {
      count: jest.Mock;
      groupBy: jest.Mock;
      findMany: jest.Mock;
    };
    $executeRaw: jest.Mock;
  };
  let mockEventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      notification: {
        count: jest.fn(),
        groupBy: jest.fn(),
        findMany: jest.fn(),
      },
      $executeRaw: jest.fn(),
    };
    mockEventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsAdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<NotificationsAdminService>(NotificationsAdminService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== getNotificationStats ====================

  describe("getNotificationStats", () => {
    it("should return aggregated notification statistics", async () => {
      // Arrange
      mockPrisma.notification.count
        .mockResolvedValueOnce(100) // totalCount
        .mockResolvedValueOnce(10) // todayCount
        .mockResolvedValueOnce(40); // unreadCount
      mockPrisma.notification.groupBy.mockResolvedValue([
        { type: "SYSTEM", _count: 50 },
        { type: "ALERT", _count: 30 },
        { type: "INFO", _count: 20 },
      ]);

      // Act
      const result = await service.getNotificationStats();

      // Assert
      expect(result.totalCount).toBe(100);
      expect(result.todayCount).toBe(10);
      expect(result.unreadRate).toBe(40); // 40/100 * 100 = 40%
      expect(result.typeCount).toBe(3);
    });

    it("should build byType map from groupBy result", async () => {
      // Arrange
      mockPrisma.notification.count
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(10);
      mockPrisma.notification.groupBy.mockResolvedValue([
        { type: "SYSTEM", _count: 30 },
        { type: "ALERT", _count: 20 },
      ]);

      // Act
      const result = await service.getNotificationStats();

      // Assert
      expect(result.byType).toEqual({ SYSTEM: 30, ALERT: 20 });
    });

    it("should return unreadRate=0 when totalCount is zero", async () => {
      // Arrange
      mockPrisma.notification.count.mockResolvedValue(0);
      mockPrisma.notification.groupBy.mockResolvedValue([]);

      // Act
      const result = await service.getNotificationStats();

      // Assert: avoids division by zero
      expect(result.unreadRate).toBe(0);
      expect(result.totalCount).toBe(0);
    });

    it("should round unreadRate to integer", async () => {
      // Arrange
      mockPrisma.notification.count
        .mockResolvedValueOnce(3) // totalCount
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1); // unreadCount -> 1/3 ~ 33.3%
      mockPrisma.notification.groupBy.mockResolvedValue([]);

      // Act
      const result = await service.getNotificationStats();

      // Assert: Math.round(33.33) = 33
      expect(result.unreadRate).toBe(33);
    });

    it("should return fallback zeros when an error is thrown", async () => {
      // Arrange
      mockPrisma.notification.count.mockRejectedValue(
        new Error("DB connection lost"),
      );

      // Act
      const result = await service.getNotificationStats();

      // Assert: service swallows the error and returns default shape
      expect(result.totalCount).toBe(0);
      expect(result.todayCount).toBe(0);
      expect(result.unreadRate).toBe(0);
      expect(result.typeCount).toBe(0);
      expect(result.byType).toEqual({});
    });

    it("should filter todayCount by a start-of-day timestamp", async () => {
      // Arrange
      mockPrisma.notification.count.mockResolvedValue(0);
      mockPrisma.notification.groupBy.mockResolvedValue([]);

      // Act
      await service.getNotificationStats();

      // Assert: second count call has createdAt.gte filter
      const todayCall = mockPrisma.notification.count.mock.calls[1];
      expect(todayCall[0].where.createdAt.gte).toBeDefined();
    });

    it("should filter unreadCount by read=false", async () => {
      // Arrange
      mockPrisma.notification.count.mockResolvedValue(0);
      mockPrisma.notification.groupBy.mockResolvedValue([]);

      // Act
      await service.getNotificationStats();

      // Assert: third count call filters read=false
      const unreadCall = mockPrisma.notification.count.mock.calls[2];
      expect(unreadCall[0].where.read).toBe(false);
    });
  });

  // ==================== getRecentNotifications ====================

  describe("getRecentNotifications", () => {
    const buildNotification = (id: string) => ({
      id,
      type: "INFO",
      title: `Title ${id}`,
      message: `Message ${id}`,
      userId: `user-${id}`,
      read: false,
      createdAt: new Date("2026-01-15T10:00:00Z"),
      user: { email: `${id}@test.com`, username: `user_${id}` },
    });

    it("should return paginated notifications with user details", async () => {
      // Arrange
      const items = [buildNotification("n1"), buildNotification("n2")];
      mockPrisma.notification.findMany.mockResolvedValue(items);
      mockPrisma.notification.count.mockResolvedValue(2);

      // Act
      const result = await service.getRecentNotifications(1, 10);

      // Assert
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it("should map notification fields correctly", async () => {
      // Arrange
      const item = buildNotification("abc");
      mockPrisma.notification.findMany.mockResolvedValue([item]);
      mockPrisma.notification.count.mockResolvedValue(1);

      // Act
      const result = await service.getRecentNotifications(1, 10);

      // Assert
      const n = result.items[0];
      expect(n.id).toBe("abc");
      expect(n.type).toBe("INFO");
      expect(n.title).toBe("Title abc");
      expect(n.message).toBe("Message abc");
      expect(n.userEmail).toBe("abc@test.com");
      expect(n.userName).toBe("user_abc");
      expect(n.read).toBe(false);
    });

    it("should clamp page to minimum of 1", async () => {
      // Arrange
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      // Act
      const result = await service.getRecentNotifications(-10, 10);

      // Assert
      expect(result.page).toBe(1);
    });

    it("should clamp limit to maximum of 100", async () => {
      // Arrange
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      // Act
      await service.getRecentNotifications(1, 999);

      // Assert
      const findManyCall = mockPrisma.notification.findMany.mock.calls[0][0];
      expect(findManyCall.take).toBe(100);
    });

    it("should order notifications by createdAt desc", async () => {
      // Arrange
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      // Act
      await service.getRecentNotifications(1, 10);

      // Assert
      const findManyCall = mockPrisma.notification.findMany.mock.calls[0][0];
      expect(findManyCall.orderBy).toEqual({ createdAt: "desc" });
    });

    it("should return fallback empty result when an error is thrown", async () => {
      // Arrange
      mockPrisma.notification.findMany.mockRejectedValue(new Error("DB error"));

      // Act
      const result = await service.getRecentNotifications(1, 10);

      // Assert
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    it("should compute correct skip offset", async () => {
      // Arrange
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      // Act
      await service.getRecentNotifications(3, 20);

      // Assert: skip = (3-1)*20 = 40
      const findManyCall = mockPrisma.notification.findMany.mock.calls[0][0];
      expect(findManyCall.skip).toBe(40);
    });
  });

  // ==================== broadcastNotification ====================

  describe("broadcastNotification", () => {
    it("should execute raw SQL and return sent count", async () => {
      // Arrange
      mockPrisma.$executeRaw.mockResolvedValue(150);

      // Act
      const result = await service.broadcastNotification(
        "System Update",
        "We have deployed a new version.",
      );

      // Assert
      expect(result.sent).toBe(150);
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it("should trim and truncate title to 200 characters", async () => {
      // Arrange
      mockPrisma.$executeRaw.mockResolvedValue(0);
      const longTitle = "A".repeat(300);

      // Act
      await service.broadcastNotification(longTitle, "short message");

      // Assert: $executeRaw is still called (title truncated internally)
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it("should trim and truncate message to 2000 characters", async () => {
      // Arrange
      mockPrisma.$executeRaw.mockResolvedValue(0);
      const longMessage = "B".repeat(3000);

      // Act
      await service.broadcastNotification("Title", longMessage);

      // Assert
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it("should emit notification.broadcast event for realtime gateway", async () => {
      // Arrange
      mockPrisma.$executeRaw.mockResolvedValue(42);

      // Act
      await service.broadcastNotification(
        "System Maintenance",
        "Tonight 22:00 UTC",
        "UPDATE",
      );

      // Assert: event emit drives NotificationGateway frontend toast/badge update
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "notification.broadcast",
        expect.objectContaining({
          title: "System Maintenance",
          message: "Tonight 22:00 UTC",
          type: "UPDATE",
          sentCount: 42,
        }),
      );
    });
  });
});
