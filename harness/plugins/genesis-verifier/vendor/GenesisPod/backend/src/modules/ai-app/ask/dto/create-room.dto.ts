import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import {
  AskRoomMemberRole,
  AskRoomMemberType,
  AskRoomMode,
} from "@prisma/client";

export class RoomConfigDto {
  @IsOptional()
  @IsEnum(AskRoomMode)
  defaultMode?: AskRoomMode;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  leaderModelId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  maxParticipants?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  debateRounds?: number;
}

export class InitialMemberDto {
  @IsEnum(AskRoomMemberType)
  memberType!: AskRoomMemberType;

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

export class CreateRoomDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  /** 从已有 SOLO session 升级为 ROOM；与 title 二选一 */
  @IsOptional()
  @IsString()
  fromSessionId?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RoomConfigDto)
  roomConfig?: RoomConfigDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InitialMemberDto)
  initialMembers?: InitialMemberDto[];
}
