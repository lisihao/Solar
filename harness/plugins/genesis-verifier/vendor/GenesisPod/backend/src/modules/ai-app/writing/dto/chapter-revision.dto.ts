import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  Min,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { RevisionChangeType } from "@prisma/client";

// ==================== AI 编辑操作类型 ====================

export type AiEditOperation =
  | "rewrite"
  | "polish"
  | "expand"
  | "condense"
  | "style_fix";

export type PolishLevel = "light" | "moderate" | "heavy";

// ==================== 请求 DTOs ====================

/**
 * 更新章节内容 (人工编辑)
 */
export class UpdateChapterContentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  content!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  changeSummary?: string;
}

/**
 * 文本选择范围
 */
export class TextSelectionDto {
  @IsNumber()
  @Min(0)
  startOffset!: number;

  @IsNumber()
  @Min(0)
  endOffset!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  originalText!: string;
}

/**
 * 目标风格配置
 */
export class TargetStyleDto {
  @IsString()
  @IsOptional()
  tone?: string; // "严肃" | "轻松" | "悬疑"

  @IsString()
  @IsOptional()
  vocabulary?: string; // "现代白话" | "古风文言"

  @IsString()
  @IsOptional()
  sentenceLength?: string; // "short" | "medium" | "long"
}

/**
 * AI 辅助编辑请求
 */
export class AiEditChapterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  operation!: AiEditOperation;

  @IsObject()
  @IsOptional()
  selection?: TextSelectionDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  userFeedback!: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  polishLevel?: PolishLevel;

  @IsObject()
  @IsOptional()
  targetStyle?: TargetStyleDto;
}

/**
 * 版本回退请求
 */
export class RollbackRevisionDto {
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  reason?: string;
}

// ==================== 响应 DTOs ====================

/**
 * 章节修订响应
 */
export interface ChapterRevisionResponse {
  id: string;
  chapterId: string;
  versionNumber: number;
  content: string;
  wordCount: number;
  changeType: RevisionChangeType;
  changeSummary: string | null;
  changedBy: string;
  aiParams: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * 版本对比响应
 */
export interface RevisionDiffResponse {
  revision1: ChapterRevisionResponse;
  revision2: ChapterRevisionResponse;
  diff: {
    additions: string[];
    deletions: string[];
    changes: Array<{ before: string; after: string }>;
  };
}

/**
 * AI 编辑结果中的修改项
 */
export interface EditChange {
  type: string;
  before: string;
  after: string;
  description: string;
}

/**
 * AI 编辑响应
 */
export interface AiEditResponse {
  success: boolean;
  missionId?: string;
  chapter?: {
    id: string;
    content: string;
    wordCount: number;
  };
  revision?: ChapterRevisionResponse;
  changes?: EditChange[];
}
