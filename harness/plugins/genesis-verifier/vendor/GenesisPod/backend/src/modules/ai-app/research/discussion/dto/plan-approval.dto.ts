import { IsBoolean, IsObject, IsOptional, IsString } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { ResearchPlan } from "../types";

export class ApprovePlanDto {
  @ApiProperty({ description: "是否批准计划" })
  @IsBoolean()
  approved!: boolean;

  @ApiPropertyOptional({ description: "修改后的计划（批准时可选填）" })
  @IsOptional()
  @IsObject()
  modifiedPlan?: ResearchPlan;

  @ApiPropertyOptional({ description: "反馈意见" })
  @IsOptional()
  @IsString()
  feedback?: string;
}
