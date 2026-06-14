import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsArray,
  IsEnum,
  ValidateNested,
  Min,
  MaxLength,
} from "class-validator";
import { Type } from "class-transformer";
import {
  AITeamTemplateStatus,
  AICapability,
  AgentWorkStyle,
} from "@prisma/client";

// ==================== MCP Tool Config ====================

export class MCPToolConfigDto {
  @IsString()
  id!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  serverUrl?: string;

  @IsBoolean()
  isEnabled!: boolean;

  @IsOptional()
  parameters?: Record<string, unknown>;
}

// ==================== Team Member DTOs ====================

export class CreateTeamMemberDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(100)
  displayName!: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  roleDescription?: string;

  @IsOptional()
  @IsString()
  personality?: string;

  @IsString()
  @MaxLength(50)
  roleId!: string;

  @IsOptional()
  @IsBoolean()
  isLeader?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultModel?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(AICapability, { each: true })
  capabilities?: AICapability[];

  @IsOptional()
  @IsEnum(AgentWorkStyle)
  workStyle?: AgentWorkStyle;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expertiseAreas?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MCPToolConfigDto)
  mcpTools?: MCPToolConfigDto[];

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxCount?: number;
}

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  roleDescription?: string;

  @IsOptional()
  @IsString()
  personality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  roleId?: string;

  @IsOptional()
  @IsBoolean()
  isLeader?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultModel?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(AICapability, { each: true })
  capabilities?: AICapability[];

  @IsOptional()
  @IsEnum(AgentWorkStyle)
  workStyle?: AgentWorkStyle;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expertiseAreas?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MCPToolConfigDto)
  mcpTools?: MCPToolConfigDto[];

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxCount?: number;
}

// ==================== Team DTOs ====================

export class CreateTeamDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(100)
  displayName!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsEnum(AITeamTemplateStatus)
  status?: AITeamTemplateStatus;

  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  workflowConfig?: unknown;

  @IsOptional()
  constraintProfile?: unknown;

  @IsOptional()
  metadata?: unknown;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTeamMemberDto)
  members?: CreateTeamMemberDto[];
}

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsEnum(AITeamTemplateStatus)
  status?: AITeamTemplateStatus;

  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  workflowConfig?: unknown;

  @IsOptional()
  constraintProfile?: unknown;

  @IsOptional()
  metadata?: unknown;
}

// ==================== Reorder DTO ====================

export class ReorderMembersDto {
  @IsArray()
  @IsString({ each: true })
  memberIds!: string[];
}

// ==================== Query DTOs ====================

export class QueryTeamsDto {
  @IsOptional()
  @IsEnum(AITeamTemplateStatus)
  status?: AITeamTemplateStatus;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  includeMembers?: boolean;
}
