import {
  IsString,
  IsOptional,
  IsEmail,
  IsEnum,
  MaxLength,
  IsArray,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export enum FeedbackTypeDto {
  BUG = "bug",
  FEATURE = "feature",
  IMPROVEMENT = "improvement",
  OTHER = "other",
  ANNOTATION = "annotation",
}

export class AttachmentDto {
  @IsString()
  filename!: string;

  @IsString()
  url!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  size?: number;
}

export class CreateFeedbackDto {
  @IsEnum(FeedbackTypeDto)
  type!: FeedbackTypeDto;

  @IsString()
  @MaxLength(500)
  title!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsEmail()
  userEmail?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}
