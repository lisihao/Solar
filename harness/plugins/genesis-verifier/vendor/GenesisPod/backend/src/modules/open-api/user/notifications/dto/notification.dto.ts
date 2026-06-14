import { IsEnum, IsOptional, IsBoolean } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { NotificationTypeDto } from "@/modules/platform/notifications/notification.types";

// Re-export so controller and its callers get a single import point
export {
  UpdateNotificationPreferenceDto,
  NotificationTypeDto,
} from "@/modules/platform/notifications/notification.types";

/**
 * 查询通知列表参数（HTTP，user zone）
 */
export class GetNotificationsQueryDto {
  @ApiPropertyOptional({ description: "页码", default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: "每页数量", default: 20 })
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({
    enum: NotificationTypeDto,
    description: "通知类型过滤",
  })
  @IsOptional()
  @IsEnum(NotificationTypeDto)
  type?: NotificationTypeDto;

  @ApiPropertyOptional({ description: "是否已读" })
  @IsOptional()
  @IsBoolean()
  read?: boolean;
}
