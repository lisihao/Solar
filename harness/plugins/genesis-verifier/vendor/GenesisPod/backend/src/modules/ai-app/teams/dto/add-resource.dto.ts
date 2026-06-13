import {
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { TopicResourceType } from "@prisma/client";

export class AddResourceDto {
  @IsEnum(TopicResourceType)
  type!: TopicResourceType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resourceId?: string; // 如果是Library资源

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  fileUrl?: string;

  @IsOptional()
  fileSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceMessageId?: string; // 来源消息ID
}
