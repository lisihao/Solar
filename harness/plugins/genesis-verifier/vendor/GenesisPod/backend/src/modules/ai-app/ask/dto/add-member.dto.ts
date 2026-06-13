import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import { AskRoomMemberRole, AskRoomMemberType } from "@prisma/client";

export class AddMemberDto {
  @IsEnum(AskRoomMemberType)
  memberType!: AskRoomMemberType;

  /** memberType=REGISTERED 时为 harness AgentRegistry id；VIRTUAL 时不传 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  agentId?: string;

  @IsString()
  @MaxLength(64)
  modelId!: string;

  @IsString()
  @MaxLength(100)
  displayName!: string;

  @IsOptional()
  @IsEnum(AskRoomMemberRole)
  role?: AskRoomMemberRole;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  systemPrompt?: string;

  @IsOptional()
  @IsObject()
  persona?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  order?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateMemberDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsEnum(AskRoomMemberRole)
  role?: AskRoomMemberRole;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  systemPrompt?: string;

  @IsOptional()
  @IsObject()
  persona?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  order?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
