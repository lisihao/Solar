import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsObject,
  IsUUID,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * 通知类型枚举
 */
export enum NotificationTypeDto {
  // 系统通知
  SYSTEM = "SYSTEM",
  UPDATE = "UPDATE",
  TIP = "TIP",

  // 团队/协作通知
  JOIN_REQUEST = "JOIN_REQUEST",
  JOIN_APPROVED = "JOIN_APPROVED",
  JOIN_REJECTED = "JOIN_REJECTED",
  INVITATION = "INVITATION",
  INVITATION_EXPIRED = "INVITATION_EXPIRED",

  // 研究/任务通知
  RESEARCH_COMPLETED = "RESEARCH_COMPLETED",
  MISSION_COMPLETED = "MISSION_COMPLETED",
  MISSION_FAILED = "MISSION_FAILED",
  WRITING_COMPLETED = "WRITING_COMPLETED",
  OFFICE_COMPLETED = "OFFICE_COMPLETED",
  TASK_ASSIGNED = "TASK_ASSIGNED",
  MENTION = "MENTION",

  // 积分通知
  CREDITS_LOW = "CREDITS_LOW",
  CREDITS_RECEIVED = "CREDITS_RECEIVED",

  // 反馈通知
  FEEDBACK_RECEIVED = "FEEDBACK_RECEIVED",
  FEEDBACK_REPLIED = "FEEDBACK_REPLIED",
  FEEDBACK_STATUS_CHANGED = "FEEDBACK_STATUS_CHANGED",

  // AI Social 通知
  SESSION_EXPIRED = "SESSION_EXPIRED",

  // BYOK 密钥申请通知
  KEY_REQUEST_SUBMITTED = "KEY_REQUEST_SUBMITTED",
  KEY_REQUEST_APPROVED = "KEY_REQUEST_APPROVED",
  KEY_REQUEST_REJECTED = "KEY_REQUEST_REJECTED",
  KEY_GRANTED = "KEY_GRANTED",

  // AI 雷达通知（PR-DR1a 与 prisma enum 同步；R3 arch P0 整改）
  RADAR_DAILY = "RADAR_DAILY",
  RADAR_WEEKLY = "RADAR_WEEKLY",
  RADAR_TIER3_INSTANT = "RADAR_TIER3_INSTANT",
  RADAR_SOURCE_AUTO_DISABLED = "RADAR_SOURCE_AUTO_DISABLED",
  RADAR_MISSION_COMPLETE = "RADAR_MISSION_COMPLETE",
}

/**
 * 创建通知 DTO（内部使用，platform service 边界）
 */
export class CreateNotificationDto {
  @ApiProperty({ description: "接收通知的用户ID" })
  @IsUUID()
  userId!: string;

  @ApiProperty({ enum: NotificationTypeDto, description: "通知类型" })
  @IsEnum(NotificationTypeDto)
  type!: NotificationTypeDto;

  @ApiProperty({ description: "通知标题" })
  @IsString()
  title!: string;

  @ApiProperty({ description: "通知内容" })
  @IsString()
  message!: string;

  @ApiPropertyOptional({ description: "通知图标URL" })
  @IsOptional()
  @IsString()
  iconUrl?: string;

  @ApiPropertyOptional({ description: "操作链接" })
  @IsOptional()
  @IsString()
  actionUrl?: string;

  @ApiPropertyOptional({ description: "操作按钮文字" })
  @IsOptional()
  @IsString()
  actionLabel?: string;

  @ApiPropertyOptional({ description: "关联实体类型" })
  @IsOptional()
  @IsString()
  relatedType?: string;

  @ApiPropertyOptional({ description: "关联实体ID" })
  @IsOptional()
  @IsString()
  relatedId?: string;

  @ApiPropertyOptional({ description: "元数据" })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * 更新通知偏好 DTO（platform service 边界；open-api controller 也消费）
 */
export class UpdateNotificationPreferenceDto {
  @ApiPropertyOptional({ description: "是否启用邮件通知" })
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiPropertyOptional({ description: "是否启用推送通知" })
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiPropertyOptional({ description: "是否启用通知声音" })
  @IsOptional()
  @IsBoolean()
  soundEnabled?: boolean;

  @ApiPropertyOptional({ description: "各类型通知开关" })
  @IsOptional()
  @IsObject()
  typeSettings?: Record<string, boolean>;

  @ApiPropertyOptional({ description: "免打扰开始时间 HH:mm" })
  @IsOptional()
  @IsString()
  quietHoursStart?: string;

  @ApiPropertyOptional({ description: "免打扰结束时间 HH:mm" })
  @IsOptional()
  @IsString()
  quietHoursEnd?: string;

  // PR-DR1b 新增：业务类型 × 渠道矩阵 + tier3 即时推
  @ApiPropertyOptional({
    description:
      "业务类型 × 渠道矩阵：{ [NotificationType]: { email?, site?, wechat?, webpush?: bool } }",
  })
  @IsOptional()
  @IsObject()
  channelSubscriptions?: Record<
    string,
    Partial<Record<"email" | "site" | "wechat" | "webpush", boolean>>
  >;

  @ApiPropertyOptional({
    description:
      "⭐⭐⭐ 信号即时推开关（E2，默认 ON，关闭后 tier3 信号不即时推）",
  })
  @IsOptional()
  @IsBoolean()
  instantPushForTier3?: boolean;
}

/**
 * 批量创建通知 DTO（内部使用，platform service 边界）
 */
export class BatchCreateNotificationDto {
  @ApiProperty({ description: "接收通知的用户ID列表" })
  @IsUUID("4", { each: true })
  userIds!: string[];

  @ApiProperty({ enum: NotificationTypeDto, description: "通知类型" })
  @IsEnum(NotificationTypeDto)
  type!: NotificationTypeDto;

  @ApiProperty({ description: "通知标题" })
  @IsString()
  title!: string;

  @ApiProperty({ description: "通知内容" })
  @IsString()
  message!: string;

  @ApiPropertyOptional({ description: "操作链接" })
  @IsOptional()
  @IsString()
  actionUrl?: string;

  @ApiPropertyOptional({ description: "操作按钮文字" })
  @IsOptional()
  @IsString()
  actionLabel?: string;

  @ApiPropertyOptional({ description: "元数据" })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
