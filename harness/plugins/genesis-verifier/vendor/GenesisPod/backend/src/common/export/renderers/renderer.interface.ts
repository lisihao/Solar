/**
 * 统一导出系统 - 渲染器接口
 */

import { ExportFormat } from "@prisma/client";
import { UnifiedContent } from "../types/unified-content";
import { ThemeConfig, LayoutConfig } from "../types/theme-config";
import { ExportOptions } from "../types/export-options";

/**
 * 渲染器接口
 * 所有格式渲染器都必须实现此接口
 */
export interface ExportRenderer {
  /**
   * 渲染器支持的格式
   */
  readonly format: ExportFormat;

  /**
   * 渲染文档
   * @param content 统一内容格式
   * @param theme 主题配置
   * @param layout 布局配置
   * @param options 导出选项
   * @returns 文件 Buffer
   */
  render(
    content: UnifiedContent,
    theme: ThemeConfig,
    layout: LayoutConfig,
    options: ExportOptions,
  ): Promise<Buffer>;

  /**
   * 获取 MIME 类型
   */
  getMimeType(): string;

  /**
   * 获取文件扩展名
   */
  getFileExtension(): string;

  /**
   * 验证内容是否可以渲染
   * @param content 统一内容格式
   * @returns 验证结果
   */
  validate?(content: UnifiedContent): ValidationResult;

  /**
   * WYSIWYG 模式：从截图 Buffer 创建目标格式文件
   * 仅 DOCX/PPTX 渲染器需要实现
   */
  renderFromScreenshot?(
    screenshotBuffer: Buffer,
    title: string,
    options: ExportOptions,
  ): Promise<Buffer>;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * 渲染器注册表
 */
export const RENDERER_TOKEN = Symbol("RENDERER_TOKEN");

/**
 * MIME 类型映射
 */
export const MIME_TYPES: Record<ExportFormat, string> = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  MARKDOWN: "text/markdown",
  HTML: "text/html",
  TARBALL: "application/gzip", // ★ v1.5.3 LLM Wiki raw/+wiki/ tarball
};

/**
 * 文件扩展名映射
 */
export const FILE_EXTENSIONS: Record<ExportFormat, string> = {
  PDF: ".pdf",
  DOCX: ".docx",
  PPTX: ".pptx",
  XLSX: ".xlsx",
  MARKDOWN: ".md",
  HTML: ".html",
  TARBALL: ".tar.gz", // ★ v1.5.3 LLM Wiki raw/+wiki/ tarball
};
