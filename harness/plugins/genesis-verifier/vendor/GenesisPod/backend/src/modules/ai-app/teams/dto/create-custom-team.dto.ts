/**
 * 创建自定义 Team DTO
 * 用于通过 AI Teams 模块创建自定义团队配置
 */

import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  Max,
  IsEnum,
  IsBoolean,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { Type } from "class-transformer";

/**
 * 成员角色配置
 */
export class MemberRoleConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  roleId!: string;

  @IsNumber()
  @Min(0)
  @Max(10)
  minCount!: number;

  @IsNumber()
  @Min(1)
  @Max(10)
  maxCount!: number;

  @IsBoolean()
  @IsOptional()
  required?: boolean;
}

/**
 * 工作流步骤配置
 */
export class WorkflowStepConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  type!:
    | "task"
    | "decision"
    | "parallel"
    | "loop"
    | "review"
    | "wait"
    | "handoff";

  @IsArray()
  @IsString({ each: true })
  executorRoles!: string[];

  @IsBoolean()
  @IsOptional()
  parallel?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  dependsOn?: string[];

  @IsNumber()
  @IsOptional()
  timeout?: number;
}

/**
 * 工作流配置
 */
export class WorkflowConfigDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(["sequential", "parallel", "dag", "hybrid"])
  @IsOptional()
  type?: "sequential" | "parallel" | "dag" | "hybrid";

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepConfigDto)
  steps!: WorkflowStepConfigDto[];
}

/**
 * 约束配置
 */
export class ConstraintConfigDto {
  @IsNumber()
  @IsOptional()
  budget?: number;

  @IsEnum(["cheap", "balanced", "premium"])
  @IsOptional()
  modelPreference?: "cheap" | "balanced" | "premium";

  @IsEnum(["quick", "standard", "comprehensive"])
  @IsOptional()
  depth?: "quick" | "standard" | "comprehensive";

  @IsBoolean()
  @IsOptional()
  reviewRequired?: boolean;

  @IsNumber()
  @IsOptional()
  maxReworks?: number;

  @IsNumber()
  @IsOptional()
  maxDuration?: number;
}

/**
 * 创建自定义 Team DTO
 */
export class CreateCustomTeamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  icon?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  color?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  leaderRoleId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MemberRoleConfigDto)
  memberRoles!: MemberRoleConfigDto[];

  @ValidateNested()
  @Type(() => WorkflowConfigDto)
  @IsOptional()
  workflow?: WorkflowConfigDto;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  availableSkills?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  availableTools?: string[];

  @ValidateNested()
  @Type(() => ConstraintConfigDto)
  @IsOptional()
  constraints?: ConstraintConfigDto;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  deliverableTypes?: string[];
}

/**
 * 更新自定义 Team DTO
 */
export class UpdateCustomTeamDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MemberRoleConfigDto)
  @IsOptional()
  memberRoles?: MemberRoleConfigDto[];

  @ValidateNested()
  @Type(() => WorkflowConfigDto)
  @IsOptional()
  workflow?: WorkflowConfigDto;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  availableSkills?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  availableTools?: string[];

  @ValidateNested()
  @Type(() => ConstraintConfigDto)
  @IsOptional()
  constraints?: ConstraintConfigDto;
}
