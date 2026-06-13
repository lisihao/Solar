import { Test, TestingModule } from "@nestjs/testing";
import { Logger, BadRequestException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { NotificationService } from "../notification.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  CreateNotificationDto,
  BatchCreateNotificationDto,
  UpdateNotificationPreferenceDto,
  NotificationTypeDto,
} from "../notification.types";

describe("NotificationService", () => {
  let service: NotificationService;
  let mockPrisma: jest.Mocked<Partial<PrismaService>>;
  let mockEventEmitter: jest.Mocked<Partial<EventEmitter2>>;

  const makeNotification = (overrides: Record<string, unknown> = {}) => ({
    id: "notif-1",
    userId: "user-1",
    type: "SYSTEM",
    title: "Test Notification",
    message: "Test message",
    iconUrl: null,
    actionUrl: null,
    actionLabel: null,
    relatedType: null,
    relatedId: null,
    read: false,
    readAt: null,
    metadata: {},
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const makePreference = (overrides: Record<string, unknown> = {}) => ({
    userId: "user-1",
    emailEnabled: true,
    pushEnabled: true,
    soundEnabled: true,
    typeSettings: {},
    quietHoursStart: null,
    quietHoursEnd: null,
    ...overrides,
  });

  beforeEach(async () => {
    mockPrisma = {
      notification: {
        create: jest.fn().mockResolvedValue(makeNotification()),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      } as unknown as PrismaService["notification"],
      notificationPreference: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(makePreference()),
      } as unknown as PrismaService["notificationPreference"],
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== createNotification ====================

  describe("createNotification", () => {
    const dto: CreateNotificationDto = {
      userId: "user-1",
      type: NotificationTypeDto.SYSTEM,
      title: "Test",
      message: "Test message",
    };

    it("creates a notification and returns its id", async () => {
      const result = await service.createNotification(dto);

      expect(result.id).toBe("notif-1");
      expect(mockPrisma.notification!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            type: "SYSTEM",
            title: "Test",
            message: "Test message",
          }),
        }),
      );
    });

    it("emits notification.created event", async () => {
      await service.createNotification(dto);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "notification.created",
        expect.objectContaining({
          notificationId: "notif-1",
          userId: "user-1",
          type: NotificationTypeDto.SYSTEM,
        }),
      );
    });

    it("throws BadRequestException for invalid notification type", async () => {
      const invalidDto = {
        ...dto,
        type: "INVALID_TYPE" as NotificationTypeDto,
      };

      await expect(service.createNotification(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("stores metadata as JSON", async () => {
      const dtoWithMeta: CreateNotificationDto = {
        ...dto,
        metadata: { key: "value" },
      };

      await service.createNotification(dtoWithMeta);

      expect(mockPrisma.notification!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ metadata: { key: "value" } }),
        }),
      );
    });
  });

  // ==================== batchCreateNotifications ====================

  describe("batchCreateNotifications", () => {
    const dto: BatchCreateNotificationDto = {
      userIds: ["user-1", "user-2"],
      type: NotificationTypeDto.SYSTEM,
      title: "Broadcast",
      message: "System update",
    };

    it("batch creates notifications with createMany", async () => {
      (mockPrisma.notification!.createMany as jest.Mock).mockResolvedValue({
        count: 2,
      });

      const result = await service.batchCreateNotifications(dto);

      expect(result.count).toBe(2);
      expect(result.succeeded).toContain("user-1");
      expect(result.succeeded).toContain("user-2");
      expect(result.failed).toHaveLength(0);
    });

    it("emits events for all users", async () => {
      (mockPrisma.notification!.createMany as jest.Mock).mockResolvedValue({
        count: 2,
      });

      await service.batchCreateNotifications(dto);

      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(2);
    });

    it("falls back to individual inserts when createMany fails", async () => {
      (mockPrisma.notification!.createMany as jest.Mock).mockRejectedValue(
        new Error("Batch failed"),
      );
      (mockPrisma.notification!.create as jest.Mock).mockResolvedValue(
        makeNotification(),
      );

      const result = await service.batchCreateNotifications(dto);

      expect(result.succeeded).toHaveLength(2);
      expect(mockPrisma.notification!.create).toHaveBeenCalledTimes(2);
    });

    it("records failed users in fallback mode", async () => {
      (mockPrisma.notification!.createMany as jest.Mock).mockRejectedValue(
        new Error("Batch failed"),
      );
      (mockPrisma.notification!.create as jest.Mock)
        .mockResolvedValueOnce(makeNotification())
        .mockRejectedValueOnce(new Error("Create failed for user-2"));

      const result = await service.batchCreateNotifications(dto);

      expect(result.succeeded).toContain("user-1");
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].userId).toBe("user-2");
    });
  });

  // ==================== getNotifications ====================

  describe("getNotifications", () => {
    it("returns paginated notifications", async () => {
      const notifications = [makeNotification()];
      (mockPrisma.notification!.findMany as jest.Mock).mockResolvedValue(
        notifications,
      );
      (mockPrisma.notification!.count as jest.Mock).mockResolvedValue(1);

      const result = await service.getNotifications("user-1");

      expect(result.notifications).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it("filters by read status", async () => {
      (mockPrisma.notification!.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.notification!.count as jest.Mock).mockResolvedValue(0);

      await service.getNotifications("user-1", { read: false });

      expect(mockPrisma.notification!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ read: false }),
        }),
      );
    });

    it("applies correct pagination skip", async () => {
      (mockPrisma.notification!.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.notification!.count as jest.Mock).mockResolvedValue(0);

      await service.getNotifications("user-1", { page: 3, limit: 10 });

      expect(mockPrisma.notification!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  // ==================== getUnreadCount ====================

  describe("getUnreadCount", () => {
    it("returns unread notification count", async () => {
      (mockPrisma.notification!.count as jest.Mock).mockResolvedValue(5);

      const count = await service.getUnreadCount("user-1");

      expect(count).toBe(5);
      expect(mockPrisma.notification!.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1", read: false },
        }),
      );
    });
  });

  // ==================== markAsRead / markAllAsRead ====================

  describe("markAsRead", () => {
    it("marks a single notification as read", async () => {
      (mockPrisma.notification!.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const result = await service.markAsRead("notif-1", "user-1");

      expect(result).toBe(true);
      expect(mockPrisma.notification!.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "notif-1", userId: "user-1" },
          data: expect.objectContaining({ read: true }),
        }),
      );
    });

    it("returns false on error", async () => {
      (mockPrisma.notification!.updateMany as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.markAsRead("notif-1", "user-1");

      expect(result).toBe(false);
    });
  });

  describe("markAllAsRead", () => {
    it("marks all notifications as read and returns count", async () => {
      (mockPrisma.notification!.updateMany as jest.Mock).mockResolvedValue({
        count: 10,
      });

      const count = await service.markAllAsRead("user-1");

      expect(count).toBe(10);
      expect(mockPrisma.notification!.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1", read: false },
        }),
      );
    });
  });

  // ==================== deleteNotification ====================

  describe("deleteNotification", () => {
    it("deletes a notification by id", async () => {
      (mockPrisma.notification!.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const result = await service.deleteNotification("notif-1", "user-1");

      expect(result).toBe(true);
      expect(mockPrisma.notification!.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "notif-1", userId: "user-1" },
        }),
      );
    });
  });

  // ==================== cleanupExpiredNotifications ====================

  describe("cleanupExpiredNotifications", () => {
    it("deletes expired notifications and returns count", async () => {
      (mockPrisma.notification!.deleteMany as jest.Mock).mockResolvedValue({
        count: 3,
      });

      const count = await service.cleanupExpiredNotifications();

      expect(count).toBe(3);
    });
  });

  // ==================== getPreferences ====================

  describe("getPreferences", () => {
    it("returns default preferences when none exist", async () => {
      (
        mockPrisma.notificationPreference!.findUnique as jest.Mock
      ).mockResolvedValue(null);

      const prefs = await service.getPreferences("user-1");

      expect(prefs.emailEnabled).toBe(true);
      expect(prefs.pushEnabled).toBe(true);
      expect(prefs.soundEnabled).toBe(true);
    });

    it("returns stored preferences", async () => {
      const stored = makePreference({
        emailEnabled: false,
        pushEnabled: true,
        soundEnabled: false,
      });
      (
        mockPrisma.notificationPreference!.findUnique as jest.Mock
      ).mockResolvedValue(stored);

      const prefs = await service.getPreferences("user-1");

      expect(prefs.emailEnabled).toBe(false);
      expect(prefs.soundEnabled).toBe(false);
    });
  });

  // ==================== updatePreferences ====================

  describe("updatePreferences", () => {
    it("upserts preference settings", async () => {
      const dto: UpdateNotificationPreferenceDto = {
        emailEnabled: false,
        pushEnabled: true,
      };
      (
        mockPrisma.notificationPreference!.findUnique as jest.Mock
      ).mockResolvedValue(null);

      await service.updatePreferences("user-1", dto);

      expect(mockPrisma.notificationPreference!.upsert).toHaveBeenCalled();
    });
  });

  // ==================== quiet hours (W4) =================================

  describe("quiet hours: timeInWindow (static)", () => {
    const at = (hours: number, mins = 0) => {
      const d = new Date(Date.UTC(2026, 0, 1, hours, mins));
      return d;
    };

    it("returns true inside same-day window", () => {
      // window 09:00 → 17:00, now 12:00
      expect(NotificationService.timeInWindow(at(12), "09:00", "17:00")).toBe(
        true,
      );
    });

    it("returns false outside same-day window", () => {
      // window 09:00 → 17:00, now 18:00
      expect(NotificationService.timeInWindow(at(18), "09:00", "17:00")).toBe(
        false,
      );
    });

    it("handles cross-midnight window correctly (22:00 → 06:00)", () => {
      // 23:30 should be in window
      expect(
        NotificationService.timeInWindow(at(23, 30), "22:00", "06:00"),
      ).toBe(true);
      // 03:00 should be in window
      expect(NotificationService.timeInWindow(at(3), "22:00", "06:00")).toBe(
        true,
      );
      // 12:00 should NOT be in window
      expect(NotificationService.timeInWindow(at(12), "22:00", "06:00")).toBe(
        false,
      );
    });

    it("returns false when start === end (empty window)", () => {
      expect(NotificationService.timeInWindow(at(10), "10:00", "10:00")).toBe(
        false,
      );
    });

    it("returns false on malformed time string", () => {
      expect(NotificationService.timeInWindow(at(10), "bad", "17:00")).toBe(
        false,
      );
      expect(NotificationService.timeInWindow(at(10), "25:00", "17:00")).toBe(
        false,
      );
    });

    it("treats end exclusively (now === end → outside window)", () => {
      // window 09:00 → 17:00, now exactly 17:00 → false (consistent with [start, end))
      expect(NotificationService.timeInWindow(at(17), "09:00", "17:00")).toBe(
        false,
      );
    });
  });

  describe("createNotification — silent flag from quiet hours", () => {
    it("emits silent=false when no preference set", async () => {
      (
        mockPrisma.notificationPreference!.findUnique as jest.Mock
      ).mockResolvedValue(null);

      await service.createNotification({
        userId: "user-1",
        type: NotificationTypeDto.SYSTEM,
        title: "T",
        message: "M",
      });

      const lastCall = (mockEventEmitter.emit as jest.Mock).mock.calls.find(
        (c) => c[0] === "notification.created",
      );
      expect(lastCall).toBeDefined();
      expect(lastCall![1]).toEqual(expect.objectContaining({ silent: false }));
    });

    it("emits silent=true when current time falls inside quiet hours", async () => {
      // Mock pref with full-day window so any time is silent
      (
        mockPrisma.notificationPreference!.findUnique as jest.Mock
      ).mockResolvedValue({
        quietHoursStart: "00:00",
        quietHoursEnd: "23:59",
      });

      await service.createNotification({
        userId: "user-1",
        type: NotificationTypeDto.SYSTEM,
        title: "T",
        message: "M",
      });

      const lastCall = (mockEventEmitter.emit as jest.Mock).mock.calls.find(
        (c) => c[0] === "notification.created",
      );
      expect(lastCall).toBeDefined();
      expect(lastCall![1]).toEqual(expect.objectContaining({ silent: true }));
    });

    it("never throws when preference lookup fails (degrades to silent=false)", async () => {
      (
        mockPrisma.notificationPreference!.findUnique as jest.Mock
      ).mockRejectedValue(new Error("DB error"));

      await expect(
        service.createNotification({
          userId: "user-1",
          type: NotificationTypeDto.SYSTEM,
          title: "T",
          message: "M",
        }),
      ).resolves.toBeDefined();

      const lastCall = (mockEventEmitter.emit as jest.Mock).mock.calls.find(
        (c) => c[0] === "notification.created",
      );
      expect(lastCall![1]).toEqual(expect.objectContaining({ silent: false }));
    });
  });
});
