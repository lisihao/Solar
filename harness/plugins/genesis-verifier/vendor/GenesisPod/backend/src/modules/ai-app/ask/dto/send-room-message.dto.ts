import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { AskRoomMode } from "@prisma/client";

export class VoteOptionDto {
  @IsString()
  @MaxLength(64)
  id!: string;

  @IsString()
  @MaxLength(200)
  label!: string;
}

/** 可选 mode-specific options（VOTE 选项 / REVIEW 角色等） */
export class ModeOptionsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => VoteOptionDto)
  voteOptions?: VoteOptionDto[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  authorMemberId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  reviewerMemberIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  startMemberId?: string;
}

export class SendRoomMessageDto {
  @IsString()
  @MaxLength(20000)
  content!: string;

  /** 显式 mode；不传则按启发式 + roomConfig.defaultMode 决定 */
  @IsOptional()
  @IsEnum(AskRoomMode)
  mode?: AskRoomMode;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  mentionedMemberIds?: string[];

  /** 复用 SOLO Ask 的 RAG 知识库 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knowledgeBaseIds?: string[];

  /** 复用 SOLO Ask 工具能力 */
  @IsOptional()
  @IsBoolean()
  enableTools?: boolean;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ModeOptionsDto)
  modeOptions?: ModeOptionsDto;
}
