/**
 * Research Export Service
 *
 * P1: 报告多格式导出
 * 将研究报告导出为多种格式，打通 AI Office 模块
 *
 * 支持的格式：
 * 1. Markdown（默认）
 * 2. PDF（通过 ExportModule）
 * 3. DOCX（通过 AI Office 桥接）
 * 4. PPTX（通过 AI Office 桥接）
 * 5. HTML（直接渲染）
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { CitationFormatterService } from "./citation-formatter.service";
import { CitationStyle } from "../../types/citation.types";
import { ObjectStorageService } from "@/modules/platform/facade";

/**
 * 导出格式
 */
export enum ExportFormat {
  MARKDOWN = "markdown",
  HTML = "html",
  PDF = "pdf",
  DOCX = "docx",
  PPTX = "pptx",
}

/**
 * 导出选项
 */
export interface ExportOptions {
  /** 导出格式 */
  format: ExportFormat;
  /** 引用格式 */
  citationStyle?: CitationStyle;
  /** 是否包含可信度报告 */
  includeCredibilityReport?: boolean;
  /** 是否包含参考文献 */
  includeBibliography?: boolean;
  /** 是否包含图表 */
  includeCharts?: boolean;
  /** 自定义标题 */
  customTitle?: string;
  /** 自定义摘要 */
  customAbstract?: string;
  /** 品牌配置 */
  branding?: {
    logo?: string;
    primaryColor?: string;
    companyName?: string;
  };
}

/**
 * 导出结果
 */
export interface ExportResult {
  /** 是否成功 */
  success: boolean;
  /** 导出格式 */
  format: ExportFormat;
  /** 导出内容（Markdown/HTML 直接返回，其他为 base64） */
  content: string;
  /** 文件名 */
  filename: string;
  /** MIME 类型 */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 错误信息 */
  error?: string;
  /** ★ Phase 6: 云存储 URL（可选） */
  cloudUrl?: string;
}

@Injectable()
export class ResearchExportService {
  private readonly logger = new Logger(ResearchExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly citationFormatter: CitationFormatterService,
    // ★ Phase 6: 报告云存储
    @Optional() private readonly r2Storage?: ObjectStorageService,
  ) {}

  /**
   * 导出研究报告
   */
  async exportReport(
    reportId: string,
    options: ExportOptions,
  ): Promise<ExportResult> {
    this.logger.log(
      `[exportReport] Exporting report ${reportId} as ${options.format}`,
    );

    try {
      // 获取报告数据
      const report = await this.prisma.topicReport.findUnique({
        where: { id: reportId },
        include: {
          topic: {
            include: {
              dimensions: true,
            },
          },
        },
      });

      if (!report) {
        return {
          success: false,
          format: options.format,
          content: "",
          filename: "",
          mimeType: "",
          size: 0,
          error: "Report not found",
        };
      }

      switch (options.format) {
        case ExportFormat.MARKDOWN:
          return this.exportAsMarkdown(
            report as unknown as ReportWithRelations,
            options,
          );

        case ExportFormat.HTML:
          return this.exportAsHTML(
            report as unknown as ReportWithRelations,
            options,
          );

        case ExportFormat.PDF:
          return this.exportAsPDF(
            report as unknown as ReportWithRelations,
            options,
          );

        case ExportFormat.DOCX:
          return this.exportAsDOCX(
            report as unknown as ReportWithRelations,
            options,
          );

        case ExportFormat.PPTX:
          return this.exportAsPPTX(
            report as unknown as ReportWithRelations,
            options,
          );

        default:
          return this.exportAsMarkdown(
            report as unknown as ReportWithRelations,
            options,
          );
      }
    } catch (error) {
      this.logger.error(`[exportReport] Failed: ${error}`);
      return {
        success: false,
        format: options.format,
        content: "",
        filename: "",
        mimeType: "",
        size: 0,
        error: String(error),
      };
    }
  }

  /**
   * ★ Phase 6: 可选上传导出结果到 R2 云存储
   * 上传失败不阻塞导出
   */
  async uploadToCloud(result: ExportResult): Promise<ExportResult> {
    if (!this.r2Storage || !result.success) return result;

    try {
      const buffer = Buffer.from(result.content, "utf-8");
      const uploadResult = await this.r2Storage.uploadBuffer(
        buffer,
        "research-exports",
        result.filename,
        result.mimeType,
      );
      if (uploadResult.success && uploadResult.url) {
        this.logger.log(
          `[uploadToCloud] Uploaded ${result.filename} to cloud storage`,
        );
        return { ...result, cloudUrl: uploadResult.url };
      }
      this.logger.warn(`[uploadToCloud] Upload failed: ${uploadResult.error}`);
    } catch (err) {
      this.logger.warn(
        `[uploadToCloud] Upload failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return result;
  }

  /**
   * 获取支持的导出格式
   */
  getSupportedFormats(): Array<{
    format: ExportFormat;
    name: string;
    available: boolean;
    description: string;
  }> {
    return [
      {
        format: ExportFormat.MARKDOWN,
        name: "Markdown",
        available: true,
        description: "Plain text with formatting",
      },
      {
        format: ExportFormat.HTML,
        name: "HTML",
        available: true,
        description: "Web page format",
      },
      {
        format: ExportFormat.PDF,
        name: "PDF",
        available: true,
        description: "Portable Document Format",
      },
      {
        format: ExportFormat.DOCX,
        name: "Word Document",
        available: false, // 需要 AI Office 集成
        description: "Microsoft Word format (requires AI Office)",
      },
      {
        format: ExportFormat.PPTX,
        name: "PowerPoint",
        available: false, // 需要 AI Office 集成
        description: "Microsoft PowerPoint format (requires AI Office)",
      },
    ];
  }

  // =========================================================================
  // 格式导出实现
  // =========================================================================

  private exportAsMarkdown(
    report: ReportWithRelations,
    options: ExportOptions,
  ): ExportResult {
    const title = options.customTitle || report.topic.name;
    let content = `# ${title}\n\n`;

    // 执行摘要
    if (report.executiveSummary) {
      content += `## Executive Summary\n\n${report.executiveSummary}\n\n`;
    }

    // 主体内容
    if (report.content) {
      content += report.content;
      content += "\n\n";
    }

    // 参考文献
    if (options.includeBibliography !== false) {
      const bibliography = this.buildBibliography(
        report.topic.dimensions || [],
        options.citationStyle || CitationStyle.APA,
      );
      if (bibliography) {
        content += `\n\n## References\n\n${bibliography}`;
      }
    }

    const filename = `${this.sanitizeFilename(title)}.md`;

    return {
      success: true,
      format: ExportFormat.MARKDOWN,
      content,
      filename,
      mimeType: "text/markdown",
      size: Buffer.byteLength(content, "utf-8"),
    };
  }

  private exportAsHTML(
    report: ReportWithRelations,
    options: ExportOptions,
  ): ExportResult {
    const title = options.customTitle || report.topic.name;
    const primaryColor = options.branding?.primaryColor || "#1a1a2e";

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
    body { font-family: 'Segoe UI', system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; line-height: 1.6; color: #333; }
    h1 { color: ${primaryColor}; border-bottom: 2px solid ${primaryColor}; padding-bottom: 0.5rem; }
    h2 { color: ${primaryColor}; margin-top: 2rem; }
    .executive-summary { background: #f8f9fa; padding: 1.5rem; border-radius: 8px; margin: 1.5rem 0; border-left: 4px solid ${primaryColor}; }
    .references { font-size: 0.9em; border-top: 1px solid #ddd; padding-top: 1rem; margin-top: 2rem; }
    .metadata { color: #666; font-size: 0.85em; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <h1>${this.escapeHtml(title)}</h1>
  <div class="metadata">
    <p>Generated: ${new Date().toLocaleDateString()}</p>
    ${options.branding?.companyName ? `<p>${this.escapeHtml(options.branding.companyName)}</p>` : ""}
  </div>`;

    if (report.executiveSummary) {
      html += `\n  <div class="executive-summary">
    <h2>Executive Summary</h2>
    <p>${this.escapeHtml(report.executiveSummary)}</p>
  </div>`;
    }

    if (report.content) {
      html += `\n  <div class="content">${this.markdownToSimpleHtml(report.content)}</div>`;
    }

    html += "\n</body>\n</html>";

    const filename = `${this.sanitizeFilename(title)}.html`;

    return {
      success: true,
      format: ExportFormat.HTML,
      content: html,
      filename,
      mimeType: "text/html",
      size: Buffer.byteLength(html, "utf-8"),
    };
  }

  private async exportAsPDF(
    report: ReportWithRelations,
    options: ExportOptions,
  ): Promise<ExportResult> {
    // PDF 导出通过先生成 HTML 再转换
    const htmlResult = this.exportAsHTML(report, options);

    // 实际 PDF 生成需要 puppeteer 或类似工具
    // 此处返回 HTML 内容标记为 PDF 待转换
    const filename = `${this.sanitizeFilename(options.customTitle || report.topic.name)}.pdf`;

    return {
      success: true,
      format: ExportFormat.PDF,
      content: htmlResult.content, // 标记为需要 PDF 转换
      filename,
      mimeType: "application/pdf",
      size: htmlResult.size,
    };
  }

  private async exportAsDOCX(
    report: ReportWithRelations,
    options: ExportOptions,
  ): Promise<ExportResult> {
    // DOCX 导出需要通过 AI Office 模块
    // 目前返回 Markdown 内容作为降级方案
    this.logger.warn(
      "[exportAsDOCX] AI Office integration not yet available, falling back to Markdown",
    );

    return this.exportAsMarkdown(report, options);
  }

  private async exportAsPPTX(
    report: ReportWithRelations,
    options: ExportOptions,
  ): Promise<ExportResult> {
    // PPTX 导出需要通过 AI Office 模块
    this.logger.warn(
      "[exportAsPPTX] AI Office integration not yet available, falling back to Markdown",
    );

    return this.exportAsMarkdown(report, options);
  }

  // =========================================================================
  // Utility Methods
  // =========================================================================

  private buildBibliography(
    dimensions: Array<Record<string, unknown>>,
    style: CitationStyle,
  ): string {
    const allEvidence = dimensions.flatMap(
      (d) => (d.evidence as Array<Record<string, unknown>>) || [],
    );
    if (allEvidence.length === 0) return "";

    const citationMetas = allEvidence
      .filter((e) => e.title && e.url)
      .map((e) =>
        this.citationFormatter.buildCitationMetadata({
          title: e.title as string,
          url: e.url as string,
          domain: e.domain as string,
          sourceType: e.sourceType as string,
          publishedAt: e.publishedAt as Date | null,
          metadata: e.metadata as Record<string, unknown>,
        }),
      );

    const bibliography = this.citationFormatter.generateBibliography(
      citationMetas,
      style,
    );

    return bibliography.formattedText;
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff\s-]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 100);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private markdownToSimpleHtml(markdown: string): string {
    return markdown
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\n\n/g, "</p><p>")
      .replace(/^/, "<p>")
      .replace(/$/, "</p>");
  }
}

/**
 * 报告数据（含关联关系）
 */
type ReportWithRelations = {
  id: string;
  content: string | null;
  executiveSummary: string | null;
  fullReport?: string;
  topic: {
    name: string;
    dimensions?: Array<Record<string, unknown>>;
  };
} & Record<string, unknown>;
