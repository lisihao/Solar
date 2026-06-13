import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMinSize,
  MaxLength,
} from "class-validator";
import { ForwardTargetType, MergeMode } from "@prisma/client";

export class ForwardMessagesDto {
  @IsArray()
  @IsUUID("4", { each: true })
  @ArrayMinSize(1)
  messageIds!: string[];

  @IsEnum(ForwardTargetType)
  targetType!: ForwardTargetType;

  @IsOptional()
  @IsUUID("4")
  targetTopicId?: string;

  @IsOptional()
  @IsUUID("4")
  targetUserId?: string;

  @IsOptional()
  @IsEnum(MergeMode)
  mergeMode?: MergeMode;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  forwardNote?: string;
}

export class BookmarkMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
