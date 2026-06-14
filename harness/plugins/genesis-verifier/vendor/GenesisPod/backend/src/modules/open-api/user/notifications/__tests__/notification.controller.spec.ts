import { Test, TestingModule } from "@nestjs/testing";
import { NotificationController } from "../notification.controller";
import { NotificationService } from "@/modules/platform/notifications/notification.service";
import {
  GetNotificationsQueryDto,
  UpdateNotificationPreferenceDto,
} from "../dto/notification.dto";

describe("NotificationController", () => {
  let controller: NotificationController;
  let notificationService: jest.Mocked<NotificationService>;

  const mockNotificationList = {
    data: [
      {
        id: "notif-1",
        type: "INFO",
        message: "Test notification",
        read: false,
        userId: "user-1",
        createdAt: new Date(),
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
  };

  const mockPreferences = {
    userId: "user-1",
    emailEnabled: true,
    pushEnabled: false,
  };

  const userReq = (userId = "user-1") => ({
    user: { id: userId },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        {
          provide: NotificationService,
          useValue: {
            getNotifications: jest.fn().mockResolvedValue(mockNotificationList),
            getUnreadCount: jest.fn().mockResolvedValue(3),
            markAsRead: jest.fn().mockResolvedValue(true),
            markAllAsRead: jest.fn().mockResolvedValue(5),
            deleteNotification: jest.fn().mockResolvedValue(true),
            getPreferences: jest.fn().mockResolvedValue(mockPreferences),
            updatePreferences: jest.fn().mockResolvedValue(mockPreferences),
          },
        },
      ],
    }).compile();

    controller = module.get<NotificationController>(NotificationController);
    notificationService = module.get(NotificationService);
  });

  describe("getNotifications", () => {
    it("should return notifications for user with default pagination", async () => {
      const req = userReq();
      const query: GetNotificationsQueryDto = {} as GetNotificationsQueryDto;

      const result = await controller.getNotifications(req, query);

      expect(notificationService.getNotifications).toHaveBeenCalledWith(
        "user-1",
        {
          page: 1,
          limit: 20,
          type: undefined,
          read: undefined,
        },
      );
      expect(result).toBe(mockNotificationList);
    });

    it("should pass query parameters to service", async () => {
      const req = userReq();
      const query: GetNotificationsQueryDto = {
        page: 2,
        limit: 10,
        type: "INFO",
        read: true,
      } as unknown as GetNotificationsQueryDto;

      await controller.getNotifications(req, query);

      expect(notificationService.getNotifications).toHaveBeenCalledWith(
        "user-1",
        {
          page: 2,
          limit: 10,
          type: "INFO",
          read: true,
        },
      );
    });
  });

  describe("getUnreadCount", () => {
    it("should return unread notification count", async () => {
      const req = userReq();
      const result = await controller.getUnreadCount(req);

      expect(notificationService.getUnreadCount).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ count: 3 });
    });
  });

  describe("markAsRead", () => {
    it("should mark a notification as read and return success", async () => {
      const req = userReq();
      const result = await controller.markAsRead(req, "notif-1");

      expect(notificationService.markAsRead).toHaveBeenCalledWith(
        "notif-1",
        "user-1",
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe("markAllAsRead", () => {
    it("should mark all notifications as read and return count", async () => {
      const req = userReq();
      const result = await controller.markAllAsRead(req);

      expect(notificationService.markAllAsRead).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ count: 5 });
    });
  });

  describe("deleteNotification", () => {
    it("should delete a notification and return success", async () => {
      const req = userReq();
      const result = await controller.deleteNotification(req, "notif-1");

      expect(notificationService.deleteNotification).toHaveBeenCalledWith(
        "notif-1",
        "user-1",
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe("getPreferences", () => {
    it("should return notification preferences for user", async () => {
      const req = userReq();
      const result = await controller.getPreferences(req);

      expect(notificationService.getPreferences).toHaveBeenCalledWith("user-1");
      expect(result).toBe(mockPreferences);
    });
  });

  describe("updatePreferences", () => {
    it("should update notification preferences and return updated prefs", async () => {
      const req = userReq();
      const dto: UpdateNotificationPreferenceDto = {
        emailEnabled: false,
        pushEnabled: true,
      } as unknown as UpdateNotificationPreferenceDto;

      const result = await controller.updatePreferences(req, dto);

      expect(notificationService.updatePreferences).toHaveBeenCalledWith(
        "user-1",
        dto,
      );
      expect(result).toBe(mockPreferences);
    });
  });
});
