/**
 * File Conversion Tool
 * 文件格式转换工具 - 支持多种文件格式互转
 */

import { Injectable, Logger } from "@nestjs/common";
import { PuppeteerPoolService } from "@/common/browser/puppeteer-pool.service";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";

import { ExportOrchestratorService } from "@/common/export";
import { ExportFormat } from "@prisma/client";

// ============================================================================
// Types
// ============================================================================

export type SourceFormat = "markdown" | "html" | "json" | "csv";
export type TargetFormat = "html" | "docx" | "pdf" | "json" | "csv";

export interface FileConversionInput {
  /**
   * 源文件内容
   */
  sourceContent: string;

  /**
   * 源文件格式
   */
  sourceFormat: SourceFormat;

  /**
   * 目标文件格式
   */
  targetFormat: TargetFormat;

  /**
   * 转换选项
   */
  options?: {
    /**
     * 文档标题（用于 DOCX/PDF）
     */
    title?: string;

    /**
     * 编码格式
     */
    encoding?: string;

    /**
     * 作者（用于 DOCX/PDF）
     */
    author?: string;

    /**
     * CSV 分隔符（默认逗号）
     */
    csvDelimiter?: string;

    /**
     * JSON 美化输出
     */
    jsonPretty?: boolean;
  };
}

export interface FileConversionOutput {
  /**
   * 转换后的内容（文本或 Base64）
   */
  content: string;

  /**
   * 目标格式
   */
  format: string;

  /**
   * 是否为二进制内容（Base64 编码）
   */
  isBase64: boolean;

  /**
   * 文件名
   */
  filename?: string;

  /**
   * MIME 类型
   */
  mimeType?: string;

  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 错误信息
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class FileConversionTool extends BaseTool<
  FileConversionInput,
  FileConversionOutput
> {
  private readonly logger = new Logger(FileConversionTool.name);

  readonly id = "file-conversion";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "processing";
  readonly tags = ["processing", "file", "conversion", "format"];
  readonly name = "文件格式转换";
  readonly description =
    "转换文件格式，支持 Markdown、HTML、DOCX、PDF、JSON、CSV 之间的互转。适用于文档导出、数据格式转换等场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      sourceContent: {
        type: "string",
        description: "源文件内容（文本格式）",
      },
      sourceFormat: {
        type: "string",
        description: "源文件格式",
        enum: ["markdown", "html", "json", "csv"],
      },
      targetFormat: {
        type: "string",
        description: "目标文件格式",
        enum: ["html", "docx", "pdf", "json", "csv"],
      },
      options: {
        type: "object",
        description: "转换选项",
        properties: {
          title: {
            type: "string",
            description: "文档标题（用于 DOCX/PDF）",
          },
          encoding: {
            type: "string",
            description: "编码格式，默认 UTF-8",
            default: "utf-8",
          },
          author: {
            type: "string",
            description: "作者名称",
          },
          csvDelimiter: {
            type: "string",
            description: "CSV 分隔符，默认逗号",
            default: ",",
          },
          jsonPretty: {
            type: "boolean",
            description: "JSON 是否美化输出",
            default: true,
          },
        },
      },
    },
    required: ["sourceContent", "sourceFormat", "targetFormat"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "转换后的内容（文本或 Base64）",
      },
      format: {
        type: "string",
        description: "目标格式",
      },
      isBase64: {
        type: "boolean",
        description: "是否为 Base64 编码的二进制内容",
      },
      filename: {
        type: "string",
        description: "建议的文件名",
      },
      mimeType: {
        type: "string",
        description: "MIME 类型",
      },
      success: {
        type: "boolean",
        description: "转换是否成功",
      },
      error: {
        type: "string",
        description: "错误信息（如果失败）",
      },
    },
  };

  constructor(
    private readonly exportOrchestrator: ExportOrchestratorService,
    private readonly browserPool: PuppeteerPoolService,
  ) {
    super();
    // defaultTimeout set in class property // 60 秒超时
  }

  validateInput(input: FileConversionInput) {
    // 验证必填字段
    if (
      !input.sourceContent ||
      typeof input.sourceContent !== "string" ||
      input.sourceContent.trim().length === 0
    ) {
      return false;
    }

    if (!input.sourceFormat || !input.targetFormat) {
      return false;
    }

    // 验证格式是否支持
    const validSourceFormats: SourceFormat[] = [
      "markdown",
      "html",
      "json",
      "csv",
    ];
    const validTargetFormats: TargetFormat[] = [
      "html",
      "docx",
      "pdf",
      "json",
      "csv",
    ];

    if (!validSourceFormats.includes(input.sourceFormat)) {
      return false;
    }

    if (!validTargetFormats.includes(input.targetFormat)) {
      return false;
    }

    // 验证转换路径是否合理
    if (input.sourceFormat === input.targetFormat) {
      return false;
    }

    return true;
  }

  protected async doExecute(
    input: FileConversionInput,
    context: ToolContext,
  ): Promise<FileConversionOutput> {
    const { sourceContent, sourceFormat, targetFormat, options = {} } = input;
    const userId = context.userId || "system";

    this.logger.log(
      `[doExecute] Converting from ${sourceFormat} to ${targetFormat}`,
    );

    try {
      // 根据转换路径选择处理方法
      const conversionKey = `${sourceFormat}_to_${targetFormat}`;

      switch (conversionKey) {
        // Markdown 转换
        case "markdown_to_html":
          return await this.markdownToHTML(sourceContent, options);

        case "markdown_to_docx":
          return await this.markdownToDOCX(sourceContent, options, userId);

        case "markdown_to_pdf":
          return await this.markdownToPDF(sourceContent, options, userId);

        // HTML 转换
        case "html_to_pdf":
          return await this.htmlToPDF(sourceContent, options);

        case "html_to_docx":
          return await this.htmlToDOCX(sourceContent, options, userId);

        // JSON/CSV 互转
        case "json_to_csv":
          return await this.jsonToCSV(sourceContent, options);

        case "csv_to_json":
          return await this.csvToJSON(sourceContent, options);

        // HTML to JSON/CSV
        case "html_to_json":
          return await this.htmlToJSON(sourceContent, options);

        case "html_to_csv":
          return await this.htmlToCSV(sourceContent, options);

        // Markdown to JSON/CSV
        case "markdown_to_json":
          return await this.markdownToJSON(sourceContent, options);

        case "markdown_to_csv":
          return await this.markdownToCSV(sourceContent, options);

        default:
          throw new Error(
            `Unsupported conversion: ${sourceFormat} → ${targetFormat}`,
          );
      }
    } catch (error) {
      this.logger.error(
        `[doExecute] Conversion failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Re-throw to let BaseTool.execute() catch and return proper error result
      throw error;
    }
  }

  // ==========================================================================
  // Markdown Conversions
  // ==========================================================================

  private async markdownToHTML(
    markdown: string,
    options: FileConversionInput["options"],
  ): Promise<FileConversionOutput> {
    const title = options?.title || "Document";
    const html = this.convertMarkdownToHTML(markdown, title);

    return {
      content: html,
      format: "html",
      isBase64: false,
      filename: `${title}.html`,
      mimeType: "text/html",
      success: true,
    };
  }

  private async markdownToDOCX(
    markdown: string,
    options: FileConversionInput["options"],
    userId: string = "system",
  ): Promise<FileConversionOutput> {
    const title = options?.title || "Document";

    // 使用统一导出模块创建导出任务
    const job = await this.exportOrchestrator.createExportJob(userId, {
      source: {
        type: "RAW",
        content: markdown,
        contentType: "markdown",
        title,
      },
      format: ExportFormat.DOCX,
    });

    // 等待导出完成（轮询）
    let result = job;
    const maxWait = 30000;
    const startTime = Date.now();

    while (
      result.status !== "COMPLETED" &&
      result.status !== "FAILED" &&
      Date.now() - startTime < maxWait
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      result = await this.exportOrchestrator.getJobStatus(job.jobId, userId);
    }

    if (result.status === "COMPLETED") {
      const file = await this.exportOrchestrator.getExportFile(
        job.jobId,
        userId,
      );
      return {
        content: file.buffer.toString("base64"),
        format: "docx",
        isBase64: true,
        filename: file.fileName,
        mimeType: file.mimeType,
        success: true,
      };
    } else {
      throw new Error(result.error || "Export failed");
    }
  }

  private async markdownToPDF(
    markdown: string,
    options: FileConversionInput["options"],
    userId: string = "system",
  ): Promise<FileConversionOutput> {
    const title = options?.title || "Document";

    // 使用统一导出模块创建导出任务
    const job = await this.exportOrchestrator.createExportJob(userId, {
      source: {
        type: "RAW",
        content: markdown,
        contentType: "markdown",
        title,
      },
      format: ExportFormat.PDF,
    });

    // 等待导出完成（轮询）
    let result = job;
    const maxWait = 60000;
    const startTime = Date.now();

    while (
      result.status !== "COMPLETED" &&
      result.status !== "FAILED" &&
      Date.now() - startTime < maxWait
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      result = await this.exportOrchestrator.getJobStatus(job.jobId, userId);
    }

    if (result.status === "COMPLETED") {
      const file = await this.exportOrchestrator.getExportFile(
        job.jobId,
        userId,
      );
      return {
        content: file.buffer.toString("base64"),
        format: "pdf",
        isBase64: true,
        filename: file.fileName,
        mimeType: file.mimeType,
        success: true,
      };
    } else {
      throw new Error(result.error || "Export failed");
    }
  }

  private async markdownToJSON(
    markdown: string,
    options: FileConversionInput["options"],
  ): Promise<FileConversionOutput> {
    const data = this.parseMarkdownToStructuredData(markdown);
    const jsonStr = options?.jsonPretty
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);

    return {
      content: jsonStr,
      format: "json",
      isBase64: false,
      filename: `${options?.title || "data"}.json`,
      mimeType: "application/json",
      success: true,
    };
  }

  private async markdownToCSV(
    markdown: string,
    options: FileConversionInput["options"],
  ): Promise<FileConversionOutput> {
    const data = this.parseMarkdownToStructuredData(markdown);
    const csv = this.convertJSONToCSV(data, options?.csvDelimiter || ",");

    return {
      content: csv,
      format: "csv",
      isBase64: false,
      filename: `${options?.title || "data"}.csv`,
      mimeType: "text/csv",
      success: true,
    };
  }

  // ==========================================================================
  // HTML Conversions
  // ==========================================================================

  private async htmlToPDF(
    html: string,
    options: FileConversionInput["options"],
  ): Promise<FileConversionOutput> {
    const title = options?.title || "Document";

    // 使用共享浏览器池生成 PDF
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, { waitUntil: "load" });

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: {
          top: "20mm",
          right: "15mm",
          bottom: "20mm",
          left: "15mm",
        },
      });

      return {
        content: Buffer.from(pdfBuffer).toString("base64"),
        format: "pdf",
        isBase64: true,
        filename: `${title}.pdf`,
        mimeType: "application/pdf",
        success: true,
      };
    } finally {
      await page.close();
    }
  }

  private async htmlToDOCX(
    html: string,
    options: FileConversionInput["options"],
    userId: string = "system",
  ): Promise<FileConversionOutput> {
    // 先转 HTML 为 Markdown（简化处理）
    const turndown = await import("turndown");
    const TurndownService = turndown.default;
    const turndownService = new TurndownService();
    const markdown = turndownService.turndown(html);

    // 然后用 Markdown to DOCX
    return this.markdownToDOCX(markdown, options, userId);
  }

  private async htmlToJSON(
    html: string,
    options: FileConversionInput["options"],
  ): Promise<FileConversionOutput> {
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);

    // 提取表格数据
    const tables: Array<{ rows: string[][] }> = [];
    $("table").each((_, table) => {
      const rows: string[][] = [];
      $(table)
        .find("tr")
        .each((_, tr) => {
          const cells: string[] = [];
          $(tr)
            .find("td, th")
            .each((_, cell) => {
              cells.push($(cell).text().trim());
            });
          if (cells.length > 0) {
            rows.push(cells);
          }
        });
      if (rows.length > 0) {
        tables.push({ rows });
      }
    });

    const data = tables.length > 0 ? tables : { content: $.text().trim() };
    const jsonStr = options?.jsonPretty
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);

    return {
      content: jsonStr,
      format: "json",
      isBase64: false,
      filename: `${options?.title || "data"}.json`,
      mimeType: "application/json",
      success: true,
    };
  }

  private async htmlToCSV(
    html: string,
    options: FileConversionInput["options"],
  ): Promise<FileConversionOutput> {
    const jsonResult = await this.htmlToJSON(html, options);
    const data = JSON.parse(jsonResult.content);
    const csv = this.convertJSONToCSV(data, options?.csvDelimiter || ",");

    return {
      content: csv,
      format: "csv",
      isBase64: false,
      filename: `${options?.title || "data"}.csv`,
      mimeType: "text/csv",
      success: true,
    };
  }

  // ==========================================================================
  // JSON/CSV Conversions
  // ==========================================================================

  private async jsonToCSV(
    json: string,
    options: FileConversionInput["options"],
  ): Promise<FileConversionOutput> {
    try {
      const data = JSON.parse(json);
      const csv = this.convertJSONToCSV(data, options?.csvDelimiter || ",");

      return {
        content: csv,
        format: "csv",
        isBase64: false,
        filename: `${options?.title || "data"}.csv`,
        mimeType: "text/csv",
        success: true,
      };
    } catch (error) {
      throw new Error(
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async csvToJSON(
    csv: string,
    options: FileConversionInput["options"],
  ): Promise<FileConversionOutput> {
    const delimiter = options?.csvDelimiter || ",";
    const lines = csv.trim().split("\n");

    if (lines.length === 0) {
      throw new Error("Empty CSV content");
    }

    // 解析表头
    const headers = this.parseCSVLine(lines[0], delimiter);

    // 解析数据行
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i], delimiter);
      if (values.length === headers.length) {
        const row: Record<string, string> = {};
        headers.forEach((header, index) => {
          row[header] = values[index];
        });
        rows.push(row);
      }
    }

    const jsonStr = options?.jsonPretty
      ? JSON.stringify(rows, null, 2)
      : JSON.stringify(rows);

    return {
      content: jsonStr,
      format: "json",
      isBase64: false,
      filename: `${options?.title || "data"}.json`,
      mimeType: "application/json",
      success: true,
    };
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * 简单的 Markdown 转 HTML
   */
  private convertMarkdownToHTML(markdown: string, title: string): string {
    let html = markdown
      // 标题
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      // 粗体
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // 斜体
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // 列表
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/^\* (.+)$/gm, "<li>$1</li>")
      // 链接
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // 代码块
      .replace(/```(\w+)?\n([\s\S]+?)```/g, "<pre><code>$2</code></pre>")
      // 行内代码
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // 分隔符
      .replace(/^---$/gm, "<hr>")
      // 段落
      .replace(/\n\n/g, "</p><p>");

    // 包裹列表
    html = html.replace(
      /(<li>.*?<\/li>\s*)+/gs,
      (match) => `<ul>${match}</ul>`,
    );

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      line-height: 1.8;
      color: #333;
    }
    h1, h2, h3 { color: #1e3a5f; margin-top: 24px; }
    h1 { font-size: 2em; border-bottom: 2px solid #1e3a5f; padding-bottom: 10px; }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.2em; }
    ul { padding-left: 24px; }
    li { margin: 8px 0; }
    strong { color: #0891b2; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-family: 'Consolas', monospace; }
    pre { background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 8px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 32px 0; }
    p { margin: 16px 0; }
    a { color: #0891b2; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${html}</p>
</body>
</html>`;
  }

  /**
   * 解析 Markdown 为结构化数据
   */
  private parseMarkdownToStructuredData(markdown: string): unknown {
    const lines = markdown.split("\n");
    const sections: Array<Record<string, unknown>> = [];
    let currentSection: Record<string, unknown> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // 标题
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          type: "heading",
          level: headingMatch[1].length,
          text: headingMatch[2],
          content: [],
        };
        continue;
      }

      // 列表
      const listMatch = trimmed.match(/^[-*]\s+(.+)/);
      if (listMatch) {
        if (!currentSection) {
          currentSection = { type: "list", items: [] };
        }
        if (currentSection.type !== "list") {
          const contentArr = (currentSection.content as unknown[]) || [];
          contentArr.push({ type: "list_item", text: listMatch[1] });
          currentSection.content = contentArr;
        } else {
          const itemsArr = (currentSection.items as unknown[]) || [];
          itemsArr.push(listMatch[1]);
          currentSection.items = itemsArr;
        }
        continue;
      }

      // 普通段落
      if (trimmed && !trimmed.startsWith("#")) {
        if (!currentSection) {
          currentSection = { type: "paragraph", text: trimmed };
        } else {
          const contentArr = (currentSection.content as unknown[]) || [];
          contentArr.push({ type: "text", text: trimmed });
          currentSection.content = contentArr;
        }
      }
    }

    if (currentSection) {
      sections.push(currentSection);
    }

    return sections.length > 0 ? sections : { text: markdown };
  }

  /**
   * JSON 转 CSV
   */
  private convertJSONToCSV(data: unknown, delimiter: string): string {
    // 处理数组
    if (Array.isArray(data)) {
      if (data.length === 0) return "";

      // 提取所有唯一键
      const keys = new Set<string>();
      data.forEach((item) => {
        if (typeof item === "object" && item !== null) {
          Object.keys(item).forEach((key) => keys.add(key));
        }
      });

      const headers = Array.from(keys);
      const rows = [headers.join(delimiter)];

      data.forEach((item) => {
        const row = headers.map((header) => {
          const value = (item as Record<string, unknown>)[header];
          return this.escapeCSVValue(String(value ?? ""), delimiter);
        });
        rows.push(row.join(delimiter));
      });

      return rows.join("\n");
    }

    // 处理对象
    if (typeof data === "object" && data !== null) {
      const keys = Object.keys(data);
      const rows = [keys.join(delimiter)];
      const values = keys.map((key) =>
        this.escapeCSVValue(
          String((data as Record<string, unknown>)[key] ?? ""),
          delimiter,
        ),
      );
      rows.push(values.join(delimiter));
      return rows.join("\n");
    }

    // 其他情况
    return String(data);
  }

  /**
   * 解析 CSV 行
   */
  private parseCSVLine(line: string, delimiter: string): string[] {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    values.push(current.trim());
    return values;
  }

  /**
   * 转义 CSV 值
   */
  private escapeCSVValue(value: string, delimiter: string): string {
    if (
      value.includes(delimiter) ||
      value.includes('"') ||
      value.includes("\n")
    ) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
