import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  Param,
  Body,
  UseGuards,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { NotificationsAdminService } from "../services/notifications-admin.service";

@ApiTags("Admin - Notifications")
@Controller("admin")
@UseGuards(JwtAuthGuard, AdminGuard)
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private notificationsAdminService: NotificationsAdminService) {}

  @Get("notifications/stats")
  async getNotificationStats() {
    this.logger.log("Admin: Fetching notification stats");
    return this.notificationsAdminService.getNotificationStats();
  }

  @Get("notifications/recent")
  async getRecentNotifications(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("type") type?: string,
    @Query("readStatus") readStatus?: string,
  ) {
    const parsedPage = parseInt(page ?? "") || 1;
    const parsedLimit = Math.min(100, parseInt(limit ?? "") || 20);
    return this.notificationsAdminService.getRecentNotifications(
      parsedPage,
      parsedLimit,
      type,
      readStatus,
    );
  }

  @Patch("notifications/:id/read")
  async markAsRead(@Param("id") id: string) {
    this.logger.log(`Admin: Marking notification ${id} as read`);
    return this.notificationsAdminService.markAsRead(id);
  }

  @Post("notifications/mark-all-read")
  async markAllRead() {
    this.logger.log("Admin: Marking all notifications as read");
    return this.notificationsAdminService.markAllRead();
  }

  @Delete("notifications/:id")
  async deleteNotification(@Param("id") id: string) {
    this.logger.log(`Admin: Deleting notification ${id}`);
    return this.notificationsAdminService.deleteNotification(id);
  }

  @Post("notifications/broadcast")
  async broadcastNotification(
    @Body() body: { title?: string; message?: string; type?: string },
  ) {
    const title = body.title?.trim();
    const message = body.message?.trim();
    const type = body.type?.trim() || "SYSTEM";
    if (!title || !message) {
      throw new BadRequestException("Title and message are required");
    }
    if (title.length > 200) {
      throw new BadRequestException("Title must be 200 characters or less");
    }
    if (message.length > 2000) {
      throw new BadRequestException("Message must be 2000 characters or less");
    }
    this.logger.log(`Admin: Broadcasting notification: "${title}" (${type})`);
    return this.notificationsAdminService.broadcastNotification(
      title,
      message,
      type,
    );
  }
}
