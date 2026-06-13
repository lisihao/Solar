import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsBoolean,
  IsNumber,
  Min,
  ArrayMinSize,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { ImportSource, ImportStatus } from "@prisma/client";

/**
 * 章节识别模式
 */
export type ChapterPatternType =
  | "auto"
  | "standard_chinese"
  | "chapter_number"
  | "numbered"
  | "custom";

/**
 * 冲突处理策略
 */
export type ConflictStrategy = "skip" | "overwrite" | "append";

/**
 * 解析导入内容请求
 */
export class ParseImportDto {
  @IsEnum(ImportSource)
  source!: ImportSource;

  @IsString()
  @IsOptional()
  @MaxLength(50000)
  content?: string; // 粘贴文本时使用

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  sourceUrl?: string; // URL 抓取时使用

  @IsString()
  @IsOptional()
  @MaxLength(500)
  fileName?: string; // 文件上传时使用

  @IsString()
  @IsOptional()
  @MaxLength(100)
  chapterPattern?: ChapterPatternType;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  customPattern?: string; // 自定义正则表达式
}

/**
 * 章节预览
 */
export interface ChapterPreview {
  index: number;
  title: string;
  wordCount: number;
  preview: string; // 前200字预览
  content: string; // 完整内容
}

/**
 * 解析结果响应
 */
export interface ParseResultResponse {
  success: boolean;
  importId: string;
  preview: {
    totalChapters: number;
    totalWords: number;
    chapters: ChapterPreview[];
  };
}

/**
 * 后处理选项
 */
export class PostProcessOptionsDto {
  @IsBoolean()
  @IsOptional()
  runConsistencyCheck?: boolean;

  @IsBoolean()
  @IsOptional()
  extractToBible?: boolean;
}

/**
 * 确认导入请求
 */
export class ConfirmImportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  targetVolumeId!: string;

  @IsNumber()
  @Min(1)
  startChapterNumber!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsNumber({}, { each: true })
  selectedChapters!: number[]; // 选中的章节索引

  @IsString()
  @IsOptional()
  @MaxLength(50)
  conflictStrategy?: ConflictStrategy;

  @IsOptional()
  postProcess?: PostProcessOptionsDto;
}

/**
 * 导入进度
 */
export interface ImportProgress {
  current: number;
  total: number;
  currentChapter?: string;
}

/**
 * 导入错误
 */
export interface ImportError {
  chapter: string;
  error: string;
}

/**
 * 导入状态响应
 */
export interface ImportStatusResponse {
  id: string;
  status: ImportStatus;
  source: ImportSource;
  totalChapters: number;
  totalWords: number;
  progress?: ImportProgress;
  result?: {
    importedChapterIds: string[];
    skippedCount: number;
    errors: ImportError[];
  };
  postProcessStatus?: {
    consistencyCheck: "pending" | "running" | "completed" | "skipped";
    bibleExtraction: "pending" | "running" | "completed" | "skipped";
  };
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * 导入历史项
 */
export interface ImportHistoryItem {
  id: string;
  source: ImportSource;
  fileName: string | null;
  sourceUrl: string | null;
  totalChapters: number;
  totalWords: number;
  status: ImportStatus;
  importedChapterIds: string[];
  createdAt: Date;
  completedAt: Date | null;
}
