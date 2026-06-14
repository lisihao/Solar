import {
  IsOptional,
  IsInt,
  IsString,
  IsEnum,
  IsBoolean,
  Min,
  Max,
  IsNotEmpty,
  MaxLength,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

// ==================== Report Update DTOs ====================

/**
 * 更新报告内容 DTO
 */
export class UpdateReportContentDto {
  @ApiPropertyOptional({
    description: "执行摘要",
    example: "本研究聚焦于 AI 大模型的发展趋势...",
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  executiveSummary?: string;

  @ApiPropertyOptional({
    description: "完整报告 (Markdown)",
    example: "# 研究报告\n\n## 摘要\n...",
  })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  fullReport?: string;

  @ApiPropertyOptional({
    description: "修改描述",
    example: "更新了市场分析部分",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changeDescription?: string;
}

/**
 * AI 编辑报告 DTO
 *
 * 支持两种模式:
 * 1. 新模式: 使用 selectedText + context 字段（前端 AIEditInputModal）
 * 2. 旧模式: 使用 selection + customInstruction 字段（兼容旧API）
 */
export class AIEditReportDto {
  @ApiProperty({
    description: "AI 编辑操作类型",
    enum: ["rewrite", "polish", "expand", "compress", "style"],
    example: "polish",
  })
  @IsEnum(["rewrite", "polish", "expand", "compress", "style"])
  @IsNotEmpty()
  operation!: "rewrite" | "polish" | "expand" | "compress" | "style";

  // ==================== 新模式字段 ====================

  @ApiPropertyOptional({
    description: "选中的文本（新模式）",
    example: "本研究聚焦于...",
  })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  selectedText?: string;

  @ApiPropertyOptional({
    description: "用户编辑指令/上下文（新模式）",
    example: "让语气更正式，添加数据支撑",
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  context?: string;

  @ApiPropertyOptional({
    description: "完整章节内容（新模式，用于AI理解上下文）",
    example: "# 章节标题\n\n完整的章节内容...",
  })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  fullContent?: string;

  @ApiPropertyOptional({
    description: "风格指南（新模式）",
    example: "使用学术写作风格",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  styleGuide?: string;

  @ApiPropertyOptional({
    description: "选中文本前的上下文（用于精确定位）",
    example: "在这个研究中，",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  selectorPrefix?: string;

  @ApiPropertyOptional({
    description: "选中文本后的上下文（用于精确定位）",
    example: "这表明了...",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  selectorSuffix?: string;

  // ==================== 旧模式字段（兼容） ====================

  @ApiPropertyOptional({
    description: "选中的文本（旧模式，兼容）",
    example: "本研究聚焦于...",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  selection?: string;

  @ApiPropertyOptional({
    description: "额外的用户指令（旧模式，兼容）",
    example: "更加专业化，使用学术风格",
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  customInstruction?: string;

  @ApiPropertyOptional({
    description: "目标风格（仅 style 操作）",
    enum: ["academic", "business", "casual", "technical"],
    example: "business",
  })
  @IsOptional()
  @IsEnum(["academic", "business", "casual", "technical"])
  targetStyle?: "academic" | "business" | "casual" | "technical";
}

/**
 * 回滚报告版本 DTO
 */
export class RollbackReportDto {
  @ApiProperty({
    description: "要回滚到的修订版本号",
    example: 3,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  revisionNumber!: number;
}

// ==================== Report Query DTOs ====================

export class ListReportsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;
}

export class ExportReportDto {
  @IsEnum(["pdf", "docx"])
  format!: "pdf" | "docx";

  @IsOptional()
  @IsBoolean()
  includeEvidence?: boolean;

  @IsOptional()
  @IsBoolean()
  includeMetadata?: boolean;
}

export class CompareReportsDto {
  @IsInt()
  @Min(1)
  from!: number;

  @IsInt()
  @Min(1)
  to!: number;
}
