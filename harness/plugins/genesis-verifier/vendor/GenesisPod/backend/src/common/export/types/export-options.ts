/**
 * 统一导出系统 - 导出选项类型
 */

import {
  ExportFormat,
  ExportSourceType,
  ExportTemplateCategory,
} from "@prisma/client";
import { ThemeConfig, LayoutConfig } from "./theme-config";

// ==================== 导出请求 ====================

export interface ExportRequest {
  // 内容来源
  source: ExportSource;

  // 导出格式
  format: ExportFormat;

  // 模板 (可选)
  templateId?: string;
  customTheme?: Partial<ThemeConfig>;
  customLayout?: Partial<LayoutConfig>;

  // 导出选项
  options?: ExportOptions;
}

export type ExportSource =
  | DocumentSource
  | ResearchSource
  | ReportSource
  | RawSource
  | MissionSource
  | PlanningSource
  | WritingSource
  | SocialSource
  | SlidesSource
  | TopicReportSource;

export interface DocumentSource {
  type: "DOCUMENT";
  documentId: string;
}

export interface ResearchSource {
  type: "RESEARCH";
  sessionId: string;
}

export interface ReportSource {
  type: "REPORT";
  reportId: string;
}

export interface RawSource {
  type: "RAW";
  content: string;
  contentType: "markdown" | "html" | "json";
  title?: string;
}

export interface MissionSource {
  type: "MISSION";
  missionId: string;
  /**
   * topicId 可选 —— 兼容 playground (standalone mission, 无 topic 绑定)
   * 与 AI Teams (mission 与 topic 绑定) 两条路径。空字符串/缺省即视为无 topic。
   */
  topicId?: string;
}

export interface PlanningSource {
  type: "PLANNING";
  planId: string;
}

export interface WritingSource {
  type: "WRITING";
  sessionId: string;
}

export interface SocialSource {
  type: "SOCIAL";
  contentId: string;
}

export interface SlidesSource {
  type: "SLIDES";
  sessionId: string;
}

export interface TopicReportSource {
  type: "TOPIC_REPORT";
  topicId: string;
  reportId?: string; // Optional - if not provided, use latest report
}

// ==================== 导出选项 ====================

export interface ExportOptions {
  // 内容选项
  includeCover?: boolean;
  includeTableOfContents?: boolean;
  includeReferences?: boolean;
  includePageNumbers?: boolean;
  includeMetadata?: boolean;

  // 页面设置
  pageSize?: "A4" | "A3" | "Letter" | "Legal";
  orientation?: "portrait" | "landscape";

  // 安全选项
  watermark?: string;
  watermarkOpacity?: number;
  password?: string;

  // 文件名
  fileName?: string;

  // 语言
  language?: string;

  // Mission 导出专用选项
  // 简化模式：只导出核心结果，跳过详细的任务执行报告和附录
  simplifiedMode?: boolean;

  // WYSIWYG 导出选项
  renderMode?: "wysiwyg" | "editable";
  wysiwygHtml?: string;
  wysiwygCss?: string;
}

// ==================== 导出响应 ====================

export interface ExportJobResponse {
  jobId: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress: number;
  estimatedTime?: number;
  downloadUrl?: string;
  expiresAt?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
}

// ==================== 模板 DTO ====================

export interface CreateTemplateDto {
  name: string;
  description?: string;
  category: ExportTemplateCategory;
  themeConfig: ThemeConfig;
  layoutConfig: LayoutConfig;
  styleConfig?: Record<string, unknown>;
  supportedFormats: ExportFormat[];
  supportedSources: ExportSourceType[];
  isPublic?: boolean;
  previewImage?: string;
}

export interface UpdateTemplateDto {
  name?: string;
  description?: string;
  themeConfig?: ThemeConfig;
  layoutConfig?: LayoutConfig;
  styleConfig?: Record<string, unknown>;
  supportedFormats?: ExportFormat[];
  supportedSources?: ExportSourceType[];
  isPublic?: boolean;
  isDefault?: boolean;
  previewImage?: string;
}

export interface TemplateQueryDto {
  category?: ExportTemplateCategory;
  format?: ExportFormat;
  sourceType?: ExportSourceType;
  includeBuiltIn?: boolean;
  includePublic?: boolean;
}

export interface TemplateResponse {
  id: string;
  name: string;
  description?: string;
  category: ExportTemplateCategory;
  themeConfig: ThemeConfig;
  layoutConfig: LayoutConfig;
  supportedFormats: ExportFormat[];
  supportedSources: ExportSourceType[];
  isBuiltIn: boolean;
  isDefault: boolean;
  isPublic: boolean;
  previewImage?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
