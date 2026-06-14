import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  MaxLength,
  IsEnum,
} from "class-validator";

export enum AgentWorkStyle {
  AUTONOMOUS = "AUTONOMOUS",
  COLLABORATIVE = "COLLABORATIVE",
  SUPPORTIVE = "SUPPORTIVE",
  ANALYTICAL = "ANALYTICAL",
  CREATIVE = "CREATIVE",
}

export class UpdateAIMemberTeamRoleDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  agentName?: string; // Agent 名称

  @IsOptional()
  @IsString()
  @MaxLength(500)
  agentIdentity?: string; // 身份描述

  @IsOptional()
  @IsBoolean()
  isLeader?: boolean; // 是否为 Leader

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expertiseAreas?: string[]; // 擅长领域

  @IsOptional()
  @IsEnum(AgentWorkStyle)
  workStyle?: AgentWorkStyle; // 工作风格
}
