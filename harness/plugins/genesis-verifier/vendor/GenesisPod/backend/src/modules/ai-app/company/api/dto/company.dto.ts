/**
 * Company OS — write-operation DTOs (W2 CRUD)
 *
 * All DTOs use class-validator decorators.
 */

import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

// ─── Hire ─────────────────────────────────────────────────────────────────────

export class HireAgentDto {
  @ApiProperty({ description: "Marketplace listing id of the agent to hire" })
  @IsString()
  listingId!: string;
}

// ─── HiredAgent update ────────────────────────────────────────────────────────

export class UpdateHiredAgentDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  models?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoFallback?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skillIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  toolIds?: string[];
}

// ─── CEO ──────────────────────────────────────────────────────────────────────

export class SetCeoDto {
  @ApiPropertyOptional({
    description: "Id of a hired agent to appoint as CEO, or null to unset",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  hiredAgentId?: string | null;
}

// ─── Team ─────────────────────────────────────────────────────────────────────

export class CreateTeamDto {
  @ApiProperty()
  @IsString()
  name!: string;
}

export class UpdateTeamDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;
}

// ─── Team member ──────────────────────────────────────────────────────────────

export class AddTeamMemberDto {
  @ApiProperty({ description: "Id of the hired agent to add to the team" })
  @IsString()
  hiredAgentId!: string;
}

// ─── Team leader ──────────────────────────────────────────────────────────────

export class SetTeamLeaderDto {
  @ApiProperty({ description: "Id of the hired agent to set as team leader" })
  @IsString()
  hiredAgentId!: string;
}

// ─── Mission ──────────────────────────────────────────────────────────────────

export class CreateMissionDto {
  @ApiProperty({ description: "Mission title / prompt (2–200 chars)" })
  @IsString()
  title!: string;

  @ApiPropertyOptional({
    description: "可选研究描述：背景 / 关注角度 / 约束，提升拆解质量",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ["quick", "standard", "deep"] })
  @IsOptional()
  @IsIn(["quick", "standard", "deep"])
  depth?: "quick" | "standard" | "deep";

  @ApiPropertyOptional({ enum: ["zh-CN", "en-US"] })
  @IsOptional()
  @IsIn(["zh-CN", "en-US"])
  language?: "zh-CN" | "en-US";

  @ApiPropertyOptional({ description: "researcher 抽图开关" })
  @IsOptional()
  @IsBoolean()
  withFigures?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: "本地知识库 ids（uuid）",
  })
  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  knowledgeBaseIds?: string[];

  @ApiPropertyOptional({ enum: ["30d", "90d", "180d", "365d", "730d", "all"] })
  @IsOptional()
  @IsIn(["30d", "90d", "180d", "365d", "730d", "all"])
  searchTimeRange?: "30d" | "90d" | "180d" | "365d" | "730d" | "all";

  @ApiPropertyOptional({
    enum: ["executive", "academic", "journalistic", "technical"],
    description: "报告文风档位（透传到能力 runner writer/outline）",
  })
  @IsOptional()
  @IsIn(["executive", "academic", "journalistic", "technical"])
  styleProfile?: "executive" | "academic" | "journalistic" | "technical";

  @ApiPropertyOptional({
    enum: ["brief", "standard", "deep", "extended", "epic", "mega"],
    description: "报告长度档位（透传到能力 runner）",
  })
  @IsOptional()
  @IsIn(["brief", "standard", "deep", "extended", "epic", "mega"])
  lengthProfile?: "brief" | "standard" | "deep" | "extended" | "epic" | "mega";

  @ApiPropertyOptional({
    enum: ["executive", "domain-expert", "general-public"],
    description: "报告受众档位（透传到能力 runner）",
  })
  @IsOptional()
  @IsIn(["executive", "domain-expert", "general-public"])
  audienceProfile?: "executive" | "domain-expert" | "general-public";

  @ApiPropertyOptional({
    enum: ["minimal", "default", "thorough", "thorough+"],
    description: "审核层级（透传到能力 runner）",
  })
  @IsOptional()
  @IsIn(["minimal", "default", "thorough", "thorough+"])
  auditLayers?: "minimal" | "default" | "thorough" | "thorough+";
}

export class RenameMissionDto {
  @ApiProperty({ description: "New mission title" })
  @IsString()
  title!: string;
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

export class AdoptHeroDto {
  @ApiProperty({ description: "Marketplace capability id to adopt as a hero" })
  @IsString()
  capabilityId!: string;
}

export class UpdateHeroDto {
  @ApiPropertyOptional({ description: "Hero display name" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    type: [String],
    description: "Model slot (real model ids)",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  models?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoFallback?: boolean;

  @ApiPropertyOptional({
    description: "Cosmetic avatar preset key (display only)",
  })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional({
    description: "Cosmetic one-line persona (display only)",
  })
  @IsOptional()
  @IsString()
  tagline?: string;
}

// ─── Team workflow ────────────────────────────────────────────────────────────

export class SetTeamWorkflowDto {
  @ApiPropertyOptional({
    description: "Id of a workflow to assign to the team, or null to unset",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  workflowId?: string | null;
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

export class AcquireWorkflowDto {
  @ApiProperty({ description: "Marketplace listing id of the workflow" })
  @IsString()
  sourceListingId!: string;
}

export class InstantiateTeamFromWorkflowDto {
  @ApiProperty({
    description: "Marketplace workflow listing id to staff a new team from",
  })
  @IsString()
  workflowListingId!: string;

  @ApiPropertyOptional({ description: "Optional team name override" })
  @IsOptional()
  @IsString()
  name?: string;
}

export class UpdateWorkflowDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stages?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  teamSize?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;
}
