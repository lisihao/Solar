import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { NotificationService } from "@/modules/platform/notifications/notification.service";
import {
  GetNotificationsQueryDto,
  UpdateNotificationPreferenceDto,
} from "./dto/notification.dto";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";

@ApiTags("Notifications")
@Controller("notifications")
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * 获取当前用户的通知列表
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "获取通知列表" })
  async getNotifications(
    @Request() req: { user: { id: string } },
    @Query() query: GetNotificationsQueryDto,
  ) {
    return this.notificationService.getNotifications(req.user.id, {
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      type: query.type,
      read: query.read,
    });
  }

  /**
   * 获取未读通知数量
   */
  @Get("unread-count")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "获取未读通知数量" })
  async getUnreadCount(@Request() req: { user: { id: string } }) {
    const count = await this.notificationService.getUnreadCount(req.user.id);
    return { count };
  }

  /**
   * 标记单个通知为已读
   */
  @Patch(":id/read")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "标记通知为已读" })
  async markAsRead(
    @Request() req: { user: { id: string } },
    @Param("id") notificationId: string,
  ) {
    const success = await this.notificationService.markAsRead(
      notificationId,
      req.user.id,
    );
    return { success };
  }

  /**
   * 标记所有通知为已读
   */
  @Post("read-all")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "标记所有通知为已读" })
  async markAllAsRead(@Request() req: { user: { id: string } }) {
    const count = await this.notificationService.markAllAsRead(req.user.id);
    return { count };
  }

  /**
   * 删除单个通知
   */
  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "删除通知" })
  async deleteNotification(
    @Request() req: { user: { id: string } },
    @Param("id") notificationId: string,
  ) {
    const success = await this.notificationService.deleteNotification(
      notificationId,
      req.user.id,
    );
    return { success };
  }

  // ========== 通知偏好设置 ==========

  /**
   * 获取通知偏好设置
   */
  @Get("preferences")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "获取通知偏好设置" })
  async getPreferences(@Request() req: { user: { id: string } }) {
    return this.notificationService.getPreferences(req.user.id);
  }

  /**
   * 更新通知偏好设置
   */
  @Patch("preferences")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "更新通知偏好设置" })
  async updatePreferences(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.notificationService.updatePreferences(req.user.id, dto);
  }
}
