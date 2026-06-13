import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { NotificationsController } from "../notifications/notifications.controller";
import { NotificationsAdminService } from "../services/notifications-admin.service";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";

jest.mock("../services/notifications-admin.service");

describe("NotificationsController", () => {
  let controller: NotificationsController;
  let service: jest.Mocked<NotificationsAdminService>;

  const mockStats = {
    totalCount: 100,
    todayCount: 10,
    unreadRate: 25,
    typeCount: 3,
    byType: { SYSTEM: 50, INFO: 30, ALERT: 20 },
  };

  const mockNotifications = {
    items: [
      {
        id: "notif-1",
        type: "SYSTEM",
        title: "Test Notification",
        message: "Test message",
        userId: "user-1",
        userEmail: "user@example.com",
        userName: "Test User",
        read: false,
        createdAt: new Date(),
      },
    ],
    total: 1,
    page: 1,
    totalPages: 1,
  };

  const mockService = {
    getNotificationStats: jest.fn(),
    getRecentNotifications: jest.fn(),
    markAsRead: jest.fn(),
    markAllRead: jest.fn(),
    deleteNotification: jest.fn(),
    broadcastNotification: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsAdminService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(NotificationsController);
    service = module.get(NotificationsAdminService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getNotificationStats", () => {
    it("should return notification stats from service", async () => {
      mockService.getNotificationStats.mockResolvedValue(mockStats);

      const result = await controller.getNotificationStats();

      expect(service.getNotificationStats).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockStats);
    });

    it("should propagate errors from service", async () => {
      mockService.getNotificationStats.mockRejectedValue(new Error("DB error"));

      await expect(controller.getNotificationStats()).rejects.toThrow(
        "DB error",
      );
    });
  });

  describe("getRecentNotifications", () => {
    it("should use default page=1 and limit=20 when no params provided", async () => {
      mockService.getRecentNotifications.mockResolvedValue(mockNotifications);

      await controller.getRecentNotifications();

      expect(service.getRecentNotifications).toHaveBeenCalledWith(
        1,
        20,
        undefined,
        undefined,
      );
    });

    it("should parse page and limit from string params", async () => {
      mockService.getRecentNotifications.mockResolvedValue(mockNotifications);

      await controller.getRecentNotifications("2", "50");

      expect(service.getRecentNotifications).toHaveBeenCalledWith(
        2,
        50,
        undefined,
        undefined,
      );
    });

    it("should cap limit at 100", async () => {
      mockService.getRecentNotifications.mockResolvedValue(mockNotifications);

      await controller.getRecentNotifications("1", "200");

      expect(service.getRecentNotifications).toHaveBeenCalledWith(
        1,
        100,
        undefined,
        undefined,
      );
    });

    it("should pass type filter when provided", async () => {
      mockService.getRecentNotifications.mockResolvedValue(mockNotifications);

      await controller.getRecentNotifications("1", "20", "SYSTEM");

      expect(service.getRecentNotifications).toHaveBeenCalledWith(
        1,
        20,
        "SYSTEM",
        undefined,
      );
    });

    it("should pass readStatus filter when provided", async () => {
      mockService.getRecentNotifications.mockResolvedValue(mockNotifications);

      await controller.getRecentNotifications("1", "20", undefined, "unread");

      expect(service.getRecentNotifications).toHaveBeenCalledWith(
        1,
        20,
        undefined,
        "unread",
      );
    });

    it("should default page to 1 for invalid page string", async () => {
      mockService.getRecentNotifications.mockResolvedValue(mockNotifications);

      await controller.getRecentNotifications("invalid", "10");

      expect(service.getRecentNotifications).toHaveBeenCalledWith(
        1,
        10,
        undefined,
        undefined,
      );
    });

    it("should default limit to 20 for invalid limit string", async () => {
      mockService.getRecentNotifications.mockResolvedValue(mockNotifications);

      await controller.getRecentNotifications("1", "invalid");

      expect(service.getRecentNotifications).toHaveBeenCalledWith(
        1,
        20,
        undefined,
        undefined,
      );
    });

    it("should return notifications from service", async () => {
      mockService.getRecentNotifications.mockResolvedValue(mockNotifications);

      const result = await controller.getRecentNotifications();

      expect(result).toEqual(mockNotifications);
    });
  });

  describe("markAsRead", () => {
    it("should call service.markAsRead and return result", async () => {
      mockService.markAsRead.mockResolvedValue({ success: true });

      const result = await controller.markAsRead("notif-1");

      expect(service.markAsRead).toHaveBeenCalledWith("notif-1");
      expect(result).toEqual({ success: true });
    });

    it("should propagate errors from service", async () => {
      mockService.markAsRead.mockRejectedValue(new Error("Mark failed"));

      await expect(controller.markAsRead("notif-1")).rejects.toThrow(
        "Mark failed",
      );
    });
  });

  describe("markAllRead", () => {
    it("should call service.markAllRead and return result", async () => {
      mockService.markAllRead.mockResolvedValue({ updated: 42 });

      const result = await controller.markAllRead();

      expect(service.markAllRead).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ updated: 42 });
    });
  });

  describe("deleteNotification", () => {
    it("should call service.deleteNotification and return result", async () => {
      mockService.deleteNotification.mockResolvedValue({ success: true });

      const result = await controller.deleteNotification("notif-1");

      expect(service.deleteNotification).toHaveBeenCalledWith("notif-1");
      expect(result).toEqual({ success: true });
    });

    it("should propagate errors from service", async () => {
      mockService.deleteNotification.mockRejectedValue(
        new Error("Delete failed"),
      );

      await expect(controller.deleteNotification("notif-1")).rejects.toThrow(
        "Delete failed",
      );
    });
  });

  describe("broadcastNotification", () => {
    it("should call service.broadcastNotification and return result", async () => {
      mockService.broadcastNotification.mockResolvedValue({ sent: 100 });

      const result = await controller.broadcastNotification({
        title: "System Update",
        message: "The system will be updated tonight.",
        type: "SYSTEM",
      });

      expect(service.broadcastNotification).toHaveBeenCalledWith(
        "System Update",
        "The system will be updated tonight.",
        "SYSTEM",
      );
      expect(result).toEqual({ sent: 100 });
    });

    it("should throw BadRequestException when title is missing", async () => {
      await expect(
        controller.broadcastNotification({ message: "Hello" }),
      ).rejects.toThrow(BadRequestException);
      expect(service.broadcastNotification).not.toHaveBeenCalled();
    });

    it("should throw BadRequestException when message is missing", async () => {
      await expect(
        controller.broadcastNotification({ title: "Hello" }),
      ).rejects.toThrow(BadRequestException);
      expect(service.broadcastNotification).not.toHaveBeenCalled();
    });

    it("should throw BadRequestException when title is empty string", async () => {
      await expect(
        controller.broadcastNotification({ title: "  ", message: "Hello" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when message is empty string", async () => {
      await expect(
        controller.broadcastNotification({ title: "Hello", message: "  " }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when title exceeds 200 characters", async () => {
      await expect(
        controller.broadcastNotification({
          title: "A".repeat(201),
          message: "Valid message",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when message exceeds 2000 characters", async () => {
      await expect(
        controller.broadcastNotification({
          title: "Valid title",
          message: "B".repeat(2001),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should default type to "SYSTEM" when type is not provided', async () => {
      mockService.broadcastNotification.mockResolvedValue({ sent: 10 });

      await controller.broadcastNotification({
        title: "Alert",
        message: "Something happened",
      });

      expect(service.broadcastNotification).toHaveBeenCalledWith(
        "Alert",
        "Something happened",
        "SYSTEM",
      );
    });

    it("should use provided type when given", async () => {
      mockService.broadcastNotification.mockResolvedValue({ sent: 10 });

      await controller.broadcastNotification({
        title: "Info",
        message: "FYI",
        type: "INFO",
      });

      expect(service.broadcastNotification).toHaveBeenCalledWith(
        "Info",
        "FYI",
        "INFO",
      );
    });
  });
});
