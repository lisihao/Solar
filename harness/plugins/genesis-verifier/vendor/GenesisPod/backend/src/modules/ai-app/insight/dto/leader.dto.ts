import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsObject,
  IsBoolean,
  MaxLength,
  IsIn,
  IsNotEmpty,
  IsArray,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

/**
 * 研究启动模式
 * - fresh: 全新开始，取消所有旧任务
 * - incremental: 增量更新，保留已完成的任务
 */
export type ResearchMode = "fresh" | "incremental";

/**
 * Leader 规划请求 DTO
 */
export class LeaderPlanDto {
  @ApiPropertyOptional({
    description: "用户研究指令",
    example: "请深入研究 AI 大模型的技术趋势和商业应用",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  userPrompt?: string;

  @ApiPropertyOptional({
    description: "用户补充的上下文信息",
    example: { focus: "技术趋势", timeRange: "2024-2025" },
  })
  @IsOptional()
  @IsObject()
  userContext?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      "研究启动模式：fresh=全新开始（取消旧任务），incremental=增量更新（保留已完成任务）",
    example: "incremental",
    enum: ["fresh", "incremental"],
    default: "fresh",
  })
  @IsOptional()
  @IsIn(["fresh", "incremental"])
  mode?: ResearchMode;

  @ApiPropertyOptional({
    description:
      "研究深度：quick=快速搜索，standard=标准研究，thorough=深度研究（全部V5功能）",
    example: "standard",
    enum: ["quick", "standard", "thorough"],
    default: "standard",
  })
  @IsOptional()
  @IsString()
  @IsIn(["quick", "standard", "thorough"])
  @MaxLength(50)
  researchDepth?: string;

  @ApiPropertyOptional({
    description: "是否启用 AI 质量审核（默认关闭，使用确定性检查）",
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  enableAiQualityReview?: boolean;
}

/**
 * Leader 消息 DTO
 */
export class LeaderMessageDto {
  @ApiProperty({
    description: "@Leader 消息内容",
    example: "@Leader 请增加对开源模型的分析",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;
}

/**
 * Mission 重试 DTO
 */
export class MissionRetryDto {
  @ApiPropertyOptional({
    description: "仅重试指定的任务ID列表",
    example: ["task_1", "task_2"],
  })
  @IsOptional()
  @IsString({ each: true })
  taskIds?: string[];
}

/**
 * 单个维度调整 DTO
 */
export class DimensionAdjustDto {
  @ApiProperty({ description: "维度名称", example: "开源模型分析" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: "维度描述", example: "分析主流开源大模型" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;
}

/**
 * Mission 调整 DTO
 */
export class MissionAdjustDto {
  @ApiPropertyOptional({
    description: "新增的维度",
    example: [{ name: "开源模型分析", description: "分析主流开源大模型" }],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DimensionAdjustDto)
  addDimensions?: DimensionAdjustDto[];

  @ApiPropertyOptional({
    description: "移除的维度ID",
    example: ["dim_1"],
  })
  @IsOptional()
  @IsString({ each: true })
  removeDimensions?: string[];

  @ApiPropertyOptional({
    description: "聚焦的领域",
    example: ["技术原理", "商业应用"],
  })
  @IsOptional()
  @IsString({ each: true })
  focusAreas?: string[];
}
