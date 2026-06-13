/**
 * Webhook DTOs
 */

import {
  IsString,
  IsUrl,
  IsArray,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { WebhookEventType } from "@prisma/client";

/**
 * 创建 Webhook 订阅
 */
export class CreateWebhookDto {
  @ApiProperty({
    description: "Webhook 名称",
    example: "生产环境通知",
  })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    description: "Webhook 描述",
    example: "用于接收生产环境的事件通知",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: "Webhook 回调 URL",
    example: "https://example.com/webhooks/deepdive",
  })
  @IsUrl()
  url!: string;

  @ApiProperty({
    description: "订阅的事件类型列表",
    enum: [
      "TOPIC_CREATED",
      "TOPIC_UPDATED",
      "TOPIC_DELETED",
      "TOPIC_ARCHIVED",
      "MESSAGE_CREATED",
      "MESSAGE_DELETED",
      "AI_RESPONSE_CREATED",
      "AI_RESPONSE_ERROR",
      "MISSION_CREATED",
      "MISSION_COMPLETED",
      "MISSION_FAILED",
      "MISSION_CANCELLED",
      "MEMBER_JOINED",
      "MEMBER_LEFT",
      "AI_MEMBER_ADDED",
      "AI_MEMBER_REMOVED",
      "DEBATE_STARTED",
      "DEBATE_COMPLETED",
    ],
    isArray: true,
    example: ["TOPIC_CREATED", "MESSAGE_CREATED", "AI_RESPONSE_CREATED"],
  })
  @IsArray()
  events!: WebhookEventType[];

  @ApiPropertyOptional({
    description: "限制接收事件的 Topic ID 列表（空表示所有 Topic）",
    type: [String],
    example: ["topic_123", "topic_456"],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  topicIds?: string[];

  @ApiPropertyOptional({
    description: "失败时的重试次数 (1-10)",
    minimum: 1,
    maximum: 10,
    default: 3,
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  retryCount?: number;

  @ApiPropertyOptional({
    description: "请求超时时间（毫秒，5000-60000）",
    minimum: 5000,
    maximum: 60000,
    default: 30000,
    example: 30000,
  })
  @IsOptional()
  @IsInt()
  @Min(5000)
  @Max(60000)
  timeoutMs?: number;
}

/**
 * 更新 Webhook 订阅
 */
export class UpdateWebhookDto {
  @ApiPropertyOptional({
    description: "Webhook 名称",
    example: "更新后的名称",
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: "Webhook 描述",
    example: "更新后的描述",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: "Webhook 回调 URL",
    example: "https://new-url.com/webhooks",
  })
  @IsOptional()
  @IsUrl()
  url?: string;

  @ApiPropertyOptional({
    description: "订阅的事件类型列表",
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  events?: WebhookEventType[];

  @ApiPropertyOptional({
    description: "限制接收事件的 Topic ID 列表",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  topicIds?: string[];

  @ApiPropertyOptional({
    description: "是否启用 Webhook",
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: "失败时的重试次数 (1-10)",
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  retryCount?: number;

  @ApiPropertyOptional({
    description: "请求超时时间（毫秒，5000-60000）",
    minimum: 5000,
    maximum: 60000,
  })
  @IsOptional()
  @IsInt()
  @Min(5000)
  @Max(60000)
  timeoutMs?: number;
}

/**
 * Webhook 事件载荷
 */
export interface WebhookPayload {
  eventId: string;
  eventType: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}
