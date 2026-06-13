/**
 * Review Workflow DTOs
 *
 * 协作审核工作流相关的数据传输对象 (Phase 3.3)
 */

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
  IsNotEmpty,
} from "class-validator";

/**
 * 分配审核任务 DTO
 */
export class AssignReviewTaskDto {
  @ApiProperty({ description: "被分配人的用户ID" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  assigneeId!: string;

  @ApiProperty({ description: "被分配人的名称" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  assigneeName!: string;

  @ApiPropertyOptional({ description: "截止日期" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dueAt?: string;
}

/**
 * 完成审核任务 DTO
 */
export class CompleteReviewTaskDto {
  @ApiProperty({ description: "是否通过审核" })
  @IsBoolean()
  approved!: boolean;

  @ApiPropertyOptional({ description: "审核评论" })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  comments?: string;

  @ApiPropertyOptional({ description: "评分 (1-10)" })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  score?: number;
}
