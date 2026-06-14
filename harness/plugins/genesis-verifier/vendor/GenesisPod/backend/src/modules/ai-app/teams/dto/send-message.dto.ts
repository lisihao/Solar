import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { Type } from "class-transformer";
import {
  MessageContentType,
  MentionType,
  AttachmentType,
} from "@prisma/client";

export class MentionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  aiMemberId?: string;

  @IsEnum(MentionType)
  mentionType!: MentionType;
}

export class AttachmentDto {
  @IsEnum(AttachmentType)
  type!: AttachmentType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  url!: string;

  @IsOptional()
  size?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resourceId?: string; // 如果是Library资源

  @IsOptional()
  linkPreview?: {
    title?: string;
    description?: string;
    image?: string;
    favicon?: string;
  };
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  content!: string;

  @IsOptional()
  @IsEnum(MessageContentType)
  contentType?: MessageContentType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  replyToId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MentionDto)
  mentions?: MentionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}
