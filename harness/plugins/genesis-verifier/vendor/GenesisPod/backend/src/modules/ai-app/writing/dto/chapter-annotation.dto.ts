import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  Min,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { AnnotationType, AnnotationStatus } from "@prisma/client";

/**
 * 创建批注请求
 */
export class CreateAnnotationDto {
  @IsNumber()
  @Min(0)
  startOffset!: number;

  @IsNumber()
  @Min(0)
  endOffset!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content!: string;

  @IsEnum(AnnotationType)
  @IsOptional()
  type?: AnnotationType;

  @IsString()
  @IsOptional()
  @MaxLength(10000)
  selectedText?: string;
}

/**
 * 更新批注请求
 */
export class UpdateAnnotationDto {
  @IsString()
  @IsOptional()
  @MaxLength(10000)
  content?: string;

  @IsEnum(AnnotationStatus)
  @IsOptional()
  status?: AnnotationStatus;
}

/**
 * 批注响应
 */
export interface AnnotationResponse {
  id: string;
  chapterId: string;
  startOffset: number;
  endOffset: number;
  content: string;
  type: AnnotationType;
  status: AnnotationStatus;
  selectedText: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}
