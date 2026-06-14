/**
 * TODO DTOs
 *
 * 研究 TODO 相关的数据传输对象
 */

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsArray,
  Min,
  Max,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { Type } from "class-transformer";
import { ResearchTodoStatus, ResearchTodoType } from "@prisma/client";

/**
 * 获取 TODO 列表查询参数
 */
export class GetTodosQueryDto {
  @ApiPropertyOptional({ description: "按 Mission ID 过滤" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  missionId?: string;

  @ApiPropertyOptional({
    description: "按状态过滤",
    enum: ResearchTodoStatus,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ResearchTodoStatus, { each: true })
  status?: ResearchTodoStatus[];

  @ApiPropertyOptional({
    description: "按类型过滤",
    enum: ResearchTodoType,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ResearchTodoType, { each: true })
  type?: ResearchTodoType[];
}

/**
 * 暂停 TODO 请求
 */
export class PauseTodoDto {
  // 暂停操作不需要额外参数
}

/**
 * 恢复 TODO 请求
 */
export class ResumeTodoDto {
  // 恢复操作不需要额外参数
}

/**
 * 取消 TODO 请求
 */
export class CancelTodoDto {
  @ApiPropertyOptional({ description: "取消原因" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

/**
 * 重试 TODO 请求
 */
export class RetryTodoDto {
  // 重试操作不需要额外参数
}

/**
 * 调整优先级请求
 */
export class PrioritizeTodoDto {
  @ApiProperty({
    description: "优先级",
    enum: ["high", "normal", "low"],
  })
  @IsEnum(["high", "normal", "low"])
  priority!: "high" | "normal" | "low";
}

/**
 * 更新 TODO 进度请求
 */
export class UpdateTodoProgressDto {
  @ApiProperty({
    description: "进度百分比 (0-100)",
    minimum: 0,
    maximum: 100,
  })
  @IsInt()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  progress!: number;

  @ApiPropertyOptional({ description: "状态消息" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  statusMessage?: string;
}

/**
 * 创建用户请求 TODO
 */
export class CreateUserRequestTodoDto {
  @ApiProperty({ description: "TODO 标题" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ description: "TODO 描述" })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;
}
