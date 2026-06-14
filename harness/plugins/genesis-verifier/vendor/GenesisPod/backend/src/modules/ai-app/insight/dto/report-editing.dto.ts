import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsEnum,
  IsOptional,
  IsNumber,
  IsArray,
  MaxLength,
} from "class-validator";

// ==================== Annotation DTOs ====================

export enum AnnotationType {
  COMMENT = "COMMENT",
  SUGGESTION = "SUGGESTION",
  ISSUE = "ISSUE",
  REFERENCE = "REFERENCE",
}

export enum AnnotationStatus {
  OPEN = "OPEN",
  RESOLVED = "RESOLVED",
  DISMISSED = "DISMISSED",
}

export class CreateAnnotationDto {
  @ApiProperty({ description: "批注内容" })
  @IsString()
  @MaxLength(10000)
  content!: string;

  @ApiProperty({
    description: "批注类型",
    enum: AnnotationType,
  })
  @IsEnum(AnnotationType)
  type!: AnnotationType;

  @ApiPropertyOptional({ description: "选中的文本" })
  @IsString()
  @IsOptional()
  @MaxLength(10000)
  selectedText?: string;

  @ApiProperty({ description: "起始偏移量" })
  @IsNumber()
  startOffset!: number;

  @ApiProperty({ description: "结束偏移量" })
  @IsNumber()
  endOffset!: number;

  @ApiPropertyOptional({ description: "选区前文上下文（用于精确定位）" })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  selectorPrefix?: string;

  @ApiPropertyOptional({ description: "选区后文上下文（用于精确定位）" })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  selectorSuffix?: string;

  @ApiPropertyOptional({ description: "高亮颜色", default: "yellow" })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  color?: string;
}

export class UpdateAnnotationDto {
  @ApiPropertyOptional({ description: "批注内容" })
  @IsString()
  @IsOptional()
  @MaxLength(10000)
  content?: string;

  @ApiPropertyOptional({
    description: "批注状态",
    enum: AnnotationStatus,
  })
  @IsEnum(AnnotationStatus)
  @IsOptional()
  status?: AnnotationStatus;
}

// ==================== Change DTOs ====================

export enum ChangeType {
  ADDED = "ADDED",
  MODIFIED = "MODIFIED",
  DELETED = "DELETED",
}

export class CheckinChangeDto {
  @ApiPropertyOptional({ description: "Checkin 备注" })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  comment?: string;
}

export class CheckinAllChangesDto {
  @ApiPropertyOptional({
    description:
      "要 Checkin 的变更 ID 列表，如果为空则 Checkin 所有未确认的变更",
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  changeIds?: string[];
}
