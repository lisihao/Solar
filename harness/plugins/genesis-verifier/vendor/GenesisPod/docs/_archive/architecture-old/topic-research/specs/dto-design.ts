/**
 * Topic Research DTO Design
 *
 * 本文件定义了专题研究模块的所有 DTO (Data Transfer Objects)
 * 用于 API 请求和响应的数据结构
 *
 * @version 1.0
 * @date 2026-01-11
 */

import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsBoolean,
  IsInt,
  IsEmail,
  MaxLength,
  Min,
  Max,
  ValidateNested,
  IsObject,
  IsDateString,
  IsNumber,
} from "class-validator";
import { Type } from "class-transformer";

// ==================== Enums ====================

export enum ResearchTopicType {
  MACRO = "MACRO", // 宏观洞察
  TECHNOLOGY = "TECHNOLOGY", // 技术专项
  COMPANY = "COMPANY", // 企业洞察
}

export enum ResearchTopicStatus {
  DRAFT = "DRAFT", // 草稿
  ACTIVE = "ACTIVE", // 活跃
  PAUSED = "PAUSED", // 暂停
  ARCHIVED = "ARCHIVED", // 归档
}

export enum RefreshFrequency {
  MANUAL = "MANUAL", // 手动
  DAILY = "DAILY", // 每日
  WEEKLY = "WEEKLY", // 每周
  BIWEEKLY = "BIWEEKLY", // 双周
  MONTHLY = "MONTHLY", // 每月
}

export enum DimensionStatus {
  PENDING = "PENDING", // 待处理
  RESEARCHING = "RESEARCHING", // 研究中
  COMPLETED = "COMPLETED", // 已完成
  FAILED = "FAILED", // 失败
}

export enum RefreshType {
  FULL = "FULL", // 全量刷新
  INCREMENTAL = "INCREMENTAL", // 增量刷新
  DIMENSION = "DIMENSION", // 维度刷新
}

export enum RefreshPriority {
  LOW = "LOW",
  NORMAL = "NORMAL",
  HIGH = "HIGH",
}

export enum SourceType {
  WEB = "web",
  ACADEMIC = "academic",
  NEWS = "news",
  GITHUB = "github",
  RSS = "rss",
  LOCAL = "local",
}

// ==================== Topic CRUD DTOs ====================

/**
 * 维度配置 DTO
 */
export class DimensionConfigDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchQueries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchSources?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  minSources?: number;
}

/**
 * 创建专题 DTO
 */
export class CreateTopicDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsEnum(ResearchTopicType)
  type!: ResearchTopicType;

  @IsOptional()
  @IsObject()
  topicConfig?: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsEnum(RefreshFrequency)
  refreshFrequency?: RefreshFrequency;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DimensionConfigDto)
  dimensions?: DimensionConfigDto[];
}

/**
 * 更新专题 DTO
 */
export class UpdateTopicDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(ResearchTopicStatus)
  status?: ResearchTopicStatus;

  @IsOptional()
  @IsObject()
  topicConfig?: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsEnum(RefreshFrequency)
  refreshFrequency?: RefreshFrequency;
}

/**
 * 查询专题列表 DTO
 */
export class ListTopicsDto {
  @IsOptional()
  @IsEnum(ResearchTopicType)
  type?: ResearchTopicType;

  @IsOptional()
  @IsEnum(ResearchTopicStatus)
  status?: ResearchTopicStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}

// ==================== Refresh DTOs ====================

/**
 * 触发刷新 DTO
 */
export class TriggerRefreshDto {
  @IsOptional()
  @IsEnum(RefreshType)
  type?: RefreshType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dimensionIds?: string[];

  @IsOptional()
  @IsEnum(RefreshPriority)
  priority?: RefreshPriority;

  @IsOptional()
  @IsBoolean()
  notify?: boolean;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  notificationEmail?: string;
}

/**
 * 刷新状态响应 DTO
 */
export class RefreshStatusDto {
  @IsString()
  jobId!: string;

  @IsString()
  topicId!: string;

  @IsEnum(RefreshType)
  type!: RefreshType;

  @IsString()
  status!: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @IsOptional()
  @IsObject()
  currentDimension?: {
    id: string;
    name: string;
    status: DimensionStatus;
  };

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  completedDimensions?: string[];

  @IsOptional()
  @IsInt()
  totalDimensions?: number;

  @IsOptional()
  @IsInt()
  sourcesFound?: number;

  @IsOptional()
  @IsInt()
  tokensUsed?: number;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  estimatedCompletionAt?: string;
}

/**
 * 取消刷新 DTO
 */
export class CancelRefreshDto {
  @IsString()
  jobId!: string;
}

/**
 * 维度刷新 DTO
 */
export class RefreshDimensionDto {
  @IsOptional()
  @IsEnum(RefreshPriority)
  priority?: RefreshPriority;

  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;
}

// ==================== Dimension DTOs ====================

/**
 * 添加维度 DTO
 */
export class AddDimensionDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchQueries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchSources?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  minSources?: number;
}

/**
 * 更新维度 DTO
 */
export class UpdateDimensionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchQueries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchSources?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  sortOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  minSources?: number;
}

/**
 * 调整维度顺序 DTO
 */
export class ReorderDimensionsDto {
  @IsArray()
  @IsString({ each: true })
  dimensionIds!: string[];
}

// ==================== Report DTOs ====================

/**
 * 查询报告列表 DTO
 */
export class ListReportsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

/**
 * 导出报告 DTO
 */
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

/**
 * 比较报告版本 DTO
 */
export class CompareReportsDto {
  @IsInt()
  @Min(1)
  from!: number;

  @IsInt()
  @Min(1)
  to!: number;
}

// ==================== Evidence DTOs ====================

/**
 * 查询证据列表 DTO
 */
export class ListEvidenceDto {
  @IsOptional()
  @IsString()
  dimensionId?: string;

  @IsOptional()
  @IsEnum(SourceType)
  sourceType?: SourceType;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minCredibility?: number;

  @IsOptional()
  @IsEnum(["citationIndex", "credibilityScore", "publishedAt"])
  sortBy?: "citationIndex" | "credibilityScore" | "publishedAt";

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;
}

// ==================== Template DTOs ====================

/**
 * 查询模板 DTO
 */
export class GetTemplatesDto {
  @IsEnum(ResearchTopicType)
  type!: ResearchTopicType;
}

/**
 * 从模板创建专题 DTO
 */
export class CreateFromTemplateDto {
  @IsString()
  templateId!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsObject()
  topicConfig?: Record<string, any>;

  @IsOptional()
  @IsObject()
  customizations?: {
    dimensions?: {
      add?: Array<{
        name: string;
        description?: string;
        searchQueries?: string[];
      }>;
      remove?: string[];
    };
  };
}

// ==================== Schedule DTOs ====================

/**
 * 更新刷新计划 DTO
 */
export class UpdateScheduleDto {
  @IsEnum(RefreshFrequency)
  frequency!: RefreshFrequency;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number; // 0-6 (Sunday-Saturday)

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hourOfDay?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ==================== Log DTOs ====================

/**
 * 查询刷新日志 DTO
 */
export class ListLogsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(["completed", "failed", "running"])
  status?: "completed" | "failed" | "running";
}

// ==================== Response DTOs ====================

/**
 * 分页响应 DTO
 */
export class PaginatedResponseDto<T> {
  items!: T[];
  pagination!: {
    total?: number;
    skip?: number;
    take?: number;
    cursor?: string;
    hasMore?: boolean;
  };
}

/**
 * 专题响应 DTO
 */
export class TopicResponseDto {
  @IsString()
  id!: string;

  @IsString()
  userId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ResearchTopicType)
  type!: ResearchTopicType;

  @IsEnum(ResearchTopicStatus)
  status!: ResearchTopicStatus;

  @IsObject()
  topicConfig!: Record<string, any>;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsEnum(RefreshFrequency)
  refreshFrequency!: RefreshFrequency;

  @IsOptional()
  @IsDateString()
  lastRefreshAt?: string;

  @IsOptional()
  @IsDateString()
  nextRefreshAt?: string;

  @IsInt()
  totalReports!: number;

  @IsInt()
  totalSources!: number;

  @IsOptional()
  @IsArray()
  dimensions?: DimensionResponseDto[];

  @IsOptional()
  @IsObject()
  latestReport?: Partial<ReportResponseDto>;

  @IsDateString()
  createdAt!: string;

  @IsDateString()
  updatedAt!: string;
}

/**
 * 维度响应 DTO
 */
export class DimensionResponseDto {
  @IsString()
  id!: string;

  @IsString()
  topicId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  sortOrder!: number;

  @IsBoolean()
  isEnabled!: boolean;

  @IsEnum(DimensionStatus)
  status!: DimensionStatus;

  @IsOptional()
  @IsDateString()
  lastResearchedAt?: string;

  @IsOptional()
  @IsArray()
  searchQueries?: string[];

  @IsOptional()
  @IsArray()
  searchSources?: string[];

  @IsInt()
  minSources!: number;
}

/**
 * 报告响应 DTO
 */
export class ReportResponseDto {
  @IsString()
  id!: string;

  @IsString()
  topicId!: string;

  @IsInt()
  version!: number;

  @IsOptional()
  @IsString()
  versionLabel?: string;

  @IsString()
  executiveSummary!: string;

  @IsOptional()
  @IsString()
  fullReport?: string;

  @IsArray()
  highlights!: Array<{
    title: string;
    content: string;
    dimensionId?: string;
    importance?: "LOW" | "MEDIUM" | "HIGH";
  }>;

  @IsOptional()
  @IsArray()
  dimensionAnalyses?: DimensionAnalysisDto[];

  @IsInt()
  totalDimensions!: number;

  @IsInt()
  totalSources!: number;

  @IsInt()
  totalTokens!: number;

  @IsBoolean()
  isIncremental!: boolean;

  @IsOptional()
  @IsObject()
  changesFromPrev?: {
    updatedDimensions: string[];
    newSources: number;
    summary?: string;
  };

  @IsDateString()
  generatedAt!: string;

  @IsOptional()
  @IsInt()
  generationTimeMs?: number;
}

/**
 * 维度分析 DTO
 */
export class DimensionAnalysisDto {
  @IsString()
  dimensionId!: string;

  @IsString()
  dimensionName!: string;

  @IsString()
  summary!: string;

  @IsArray()
  keyFindings!: Array<{
    title: string;
    content: string;
    sources: number[];
  }>;

  @IsOptional()
  @IsArray()
  dataPoints?: Array<{
    metric: string;
    value: string;
    source: number;
  }>;

  @IsInt()
  sourcesUsed!: number;

  @IsOptional()
  @IsString()
  modelUsed?: string;

  @IsOptional()
  @IsInt()
  tokensUsed?: number;
}

/**
 * 证据响应 DTO
 */
export class EvidenceResponseDto {
  @IsString()
  id!: string;

  @IsString()
  reportId!: string;

  @IsOptional()
  @IsString()
  analysisId?: string;

  @IsOptional()
  @IsString()
  dimensionName?: string;

  @IsInt()
  citationIndex!: number;

  @IsString()
  title!: string;

  @IsString()
  url!: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  snippet?: string;

  @IsOptional()
  @IsString()
  fullContent?: string;

  @IsEnum(SourceType)
  sourceType!: SourceType;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;

  @IsDateString()
  accessedAt!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  credibilityScore?: number;

  @IsOptional()
  @IsObject()
  credibilityBreakdown?: {
    domainAuthority: number;
    sourceType: number;
    citationCount: number;
    recency: number;
    contentDepth: number;
  };

  @IsOptional()
  @IsArray()
  usedInDimensions?: Array<{
    dimensionId: string;
    dimensionName: string;
    keyFindings: string[];
  }>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * 刷新任务响应 DTO
 */
export class RefreshJobResponseDto {
  @IsString()
  jobId!: string;

  @IsString()
  topicId!: string;

  @IsEnum(RefreshType)
  type!: RefreshType;

  @IsString()
  status!: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

  @IsOptional()
  @IsInt()
  estimatedDuration?: number; // seconds

  @IsDateString()
  createdAt!: string;
}

/**
 * 导出结果响应 DTO
 */
export class ExportResultDto {
  @IsString()
  downloadUrl!: string;

  @IsDateString()
  expiresAt!: string;

  @IsInt()
  fileSize!: number; // bytes

  @IsEnum(["pdf", "docx"])
  format!: "pdf" | "docx";
}

/**
 * 模板响应 DTO
 */
export class TemplateResponseDto {
  @IsString()
  id!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ResearchTopicType)
  type!: ResearchTopicType;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DimensionConfigDto)
  dimensions!: DimensionConfigDto[];
}

/**
 * 刷新计划响应 DTO
 */
export class ScheduleResponseDto {
  @IsString()
  id!: string;

  @IsString()
  topicId!: string;

  @IsEnum(RefreshFrequency)
  frequency!: RefreshFrequency;

  @IsOptional()
  @IsInt()
  dayOfWeek?: number;

  @IsOptional()
  @IsInt()
  dayOfMonth?: number;

  @IsInt()
  hourOfDay!: number;

  @IsBoolean()
  isActive!: number;

  @IsOptional()
  @IsDateString()
  lastRunAt?: string;

  @IsOptional()
  @IsDateString()
  nextRunAt?: string;
}

/**
 * 刷新日志响应 DTO
 */
export class RefreshLogResponseDto {
  @IsString()
  id!: string;

  @IsString()
  topicId!: string;

  @IsString()
  triggerType!: "manual" | "scheduled";

  @IsDateString()
  startedAt!: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsString()
  status!: "pending" | "running" | "completed" | "failed";

  @IsOptional()
  @IsString()
  reportId?: string;

  @IsOptional()
  @IsString()
  error?: string;

  @IsOptional()
  @IsInt()
  dimensionsRefreshed?: number;

  @IsOptional()
  @IsInt()
  sourcesFound?: number;

  @IsOptional()
  @IsInt()
  tokensUsed?: number;
}

/**
 * 统计响应 DTO
 */
export class StatsResponseDto {
  @IsString()
  topicId!: string;

  @IsInt()
  totalReports!: number;

  @IsInt()
  totalSources!: number;

  @IsInt()
  totalTokens!: number;

  @IsNumber()
  totalCost!: number;

  @IsArray()
  dimensionStats!: Array<{
    dimensionId: string;
    dimensionName: string;
    totalSources: number;
    avgSourcesPerReport: number;
    lastUpdated?: string;
  }>;

  @IsObject()
  refreshStats!: {
    totalRefreshes: number;
    successRate: number;
    avgDuration: number;
    lastRefresh?: string;
  };

  @IsObject()
  credibilityDistribution!: {
    high: number;
    medium: number;
    low: number;
  };
}

/**
 * 错误响应 DTO
 */
export class ErrorResponseDto {
  @IsInt()
  statusCode!: number;

  @IsString()
  error!: string;

  @IsString()
  message!: string;

  @IsDateString()
  timestamp!: string;

  @IsString()
  path!: string;

  @IsOptional()
  @IsObject()
  details?: Record<string, any>;
}

// ==================== SSE Event DTOs ====================

/**
 * SSE 事件基类
 */
export class SSEEventDto {
  @IsString()
  event!: string;

  @IsObject()
  data!: Record<string, any>;
}

/**
 * 刷新开始事件
 */
export class RefreshStartEventDto extends SSEEventDto {
  event = "start";
  data!: {
    topicId: string;
    type: RefreshType;
    timestamp: string;
  };
}

/**
 * 维度进度事件
 */
export class DimensionProgressEventDto extends SSEEventDto {
  event!: "dimension:start" | "dimension:progress" | "dimension:complete";
  data!: {
    dimensionId: string;
    name?: string;
    status?: DimensionStatus;
    progress?: number;
    sourcesFound?: number;
    sourcesUsed?: number;
    tokensUsed?: number;
    message?: string;
  };
}

/**
 * 报告生成事件
 */
export class ReportGenerationEventDto extends SSEEventDto {
  event!: "report:start" | "report:progress" | "report:complete";
  data!: {
    reportId?: string;
    version?: number;
    progress?: number;
    message?: string;
  };
}

/**
 * 完成/错误事件
 */
export class CompletionEventDto extends SSEEventDto {
  event!: "complete" | "error";
  data!: {
    reportId?: string;
    totalSources?: number;
    totalTokens?: number;
    duration?: number;
    error?: string;
    dimensionId?: string;
  };
}

// ==================== Export All ====================

export const TopicResearchDTOs = {
  // Enums
  ResearchTopicType,
  ResearchTopicStatus,
  RefreshFrequency,
  DimensionStatus,
  RefreshType,
  RefreshPriority,
  SourceType,

  // Request DTOs
  CreateTopicDto,
  UpdateTopicDto,
  ListTopicsDto,
  TriggerRefreshDto,
  CancelRefreshDto,
  RefreshDimensionDto,
  AddDimensionDto,
  UpdateDimensionDto,
  ReorderDimensionsDto,
  ListReportsDto,
  ExportReportDto,
  CompareReportsDto,
  ListEvidenceDto,
  GetTemplatesDto,
  CreateFromTemplateDto,
  UpdateScheduleDto,
  ListLogsDto,

  // Response DTOs
  TopicResponseDto,
  DimensionResponseDto,
  ReportResponseDto,
  DimensionAnalysisDto,
  EvidenceResponseDto,
  RefreshJobResponseDto,
  RefreshStatusDto,
  ExportResultDto,
  TemplateResponseDto,
  ScheduleResponseDto,
  RefreshLogResponseDto,
  StatsResponseDto,
  ErrorResponseDto,
  PaginatedResponseDto,

  // SSE Event DTOs
  SSEEventDto,
  RefreshStartEventDto,
  DimensionProgressEventDto,
  ReportGenerationEventDto,
  CompletionEventDto,
};
