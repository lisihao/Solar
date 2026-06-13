import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  MaxLength,
  IsObject,
} from "class-validator";

export class CreateAgentConfigDto {
  @ApiProperty({
    description: "Unique agent identifier",
    example: "research-lead",
  })
  @IsString()
  @MaxLength(100)
  agentId!: string;

  @ApiProperty({ description: "Agent display name", example: "Research Lead" })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ description: "Agent description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: "Agent type", example: "plan-based" })
  @IsString()
  @MaxLength(50)
  agentType!: string;

  @ApiProperty({ description: "Agent domain", example: "research" })
  @IsString()
  @MaxLength(50)
  domain!: string;

  @ApiProperty({ description: "System prompt for the agent" })
  @IsString()
  systemPrompt!: string;

  @ApiPropertyOptional({
    description: "Tool IDs assigned to agent",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[];

  @ApiPropertyOptional({
    description: "Skill IDs assigned to agent",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ description: "Model type override", example: "CHAT" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  modelType?: string;

  @ApiPropertyOptional({ description: "Task profile configuration" })
  @IsOptional()
  @IsObject()
  taskProfile?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: "Whether agent is enabled",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateAgentConfigDto {
  @ApiPropertyOptional({ description: "Agent display name" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: "Agent description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "System prompt for the agent" })
  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @ApiPropertyOptional({
    description: "Tool IDs assigned to agent",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[];

  @ApiPropertyOptional({
    description: "Skill IDs assigned to agent",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ description: "Model type override" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  modelType?: string;

  @ApiPropertyOptional({ description: "Task profile configuration" })
  @IsOptional()
  @IsObject()
  taskProfile?: Record<string, unknown>;

  @ApiPropertyOptional({ description: "Whether agent is enabled" })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
