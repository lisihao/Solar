/**
 * File Parser Tool
 * 文件解析工具 - 支持解析 PDF、Word、Excel、PPT 等文件
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";

// ============================================================================
// Types
// ============================================================================

interface PDFParseResult {
  numpages: number;
  text: string;
  info?: {
    Author?: string;
  };
}

interface ExcelJSCell {
  value: unknown;
}

interface ExcelJSRow {
  eachCell: (
    options: { includeEmpty: boolean },
    callback: (cell: ExcelJSCell) => void,
  ) => void;
}

interface ExcelJSWorksheet {
  name: string;
  eachRow: (callback: (row: ExcelJSRow, rowNumber: number) => void) => void;
}

export interface FileParserInput {
  /**
   * 文件信息
   */
  file: {
    /**
     * 文件 URL（如果是远程文件）
     */
    url?: string;

    /**
     * 文件 Buffer（如果是本地文件）
     */
    buffer?: Buffer;

    /**
     * MIME 类型
     */
    mimeType: string;

    /**
     * 文件名
     */
    filename: string;
  };

  /**
   * 解析选项
   */
  options?: {
    /**
     * 是否提取图片
     */
    extractImages?: boolean;

    /**
     * 是否提取表格
     */
    extractTables?: boolean;

    /**
     * 是否保留布局
     */
    preserveLayout?: boolean;

    /**
     * 最大页数（PDF）
     */
    maxPages?: number;
  };
}

export interface FileParserOutput {
  /**
   * 提取的文本内容
   */
  content: string;

  /**
   * 文档结构
   */
  structure: {
    /**
     * 文档标题
     */
    title?: string;

    /**
     * 章节列表
     */
    sections: Array<{
      /**
       * 章节层级
       */
      level: number;

      /**
       * 章节标题
       */
      title: string;

      /**
       * 章节内容
       */
      content: string;
    }>;

    /**
     * 元数据
     */
    metadata: {
      /**
       * 作者
       */
      author?: string;

      /**
       * 页数
       */
      pageCount?: number;

      /**
       * 字数
       */
      wordCount?: number;
    };
  };

  /**
   * 表格数据
   */
  tables?: Array<{
    /**
     * 表头
     */
    headers: string[];

    /**
     * 数据行
     */
    rows: string[][];
  }>;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class FileParserTool extends BaseTool<
  FileParserInput,
  FileParserOutput
> {
  private readonly logger = new Logger(FileParserTool.name);

  readonly id = "file-parser";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "processing";
  readonly tags = ["processing", "file", "parser", "pdf", "docx", "extract"];
  readonly name = "文件解析";
  readonly description =
    "解析 PDF、Word (docx)、Excel (xlsx)、PowerPoint (pptx) 文件，提取文本内容、结构和表格数据。适用于文档分析、内容提取等场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      file: {
        type: "object",
        description: "文件信息",
        properties: {
          url: {
            type: "string",
            description: "文件 URL（远程文件）",
          },
          buffer: {
            type: "string",
            description: "文件 Buffer（Base64 编码）",
          },
          mimeType: {
            type: "string",
            description: "MIME 类型",
            enum: [
              "application/pdf",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ],
          },
          filename: {
            type: "string",
            description: "文件名",
          },
        },
        required: ["mimeType", "filename"],
      },
      options: {
        type: "object",
        description: "解析选项",
        properties: {
          extractImages: {
            type: "boolean",
            description: "是否提取图片",
            default: false,
          },
          extractTables: {
            type: "boolean",
            description: "是否提取表格",
            default: true,
          },
          preserveLayout: {
            type: "boolean",
            description: "是否保留布局",
            default: false,
          },
          maxPages: {
            type: "number",
            description: "最大解析页数（仅 PDF）",
            default: 100,
          },
        },
      },
    },
    required: ["file"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "提取的文本内容",
      },
      structure: {
        type: "object",
        description: "文档结构",
        properties: {
          title: {
            type: "string",
            description: "文档标题",
          },
          sections: {
            type: "array",
            description: "章节列表",
            items: {
              type: "object",
              properties: {
                level: { type: "number", description: "章节层级" },
                title: { type: "string", description: "章节标题" },
                content: { type: "string", description: "章节内容" },
              },
            },
          },
          metadata: {
            type: "object",
            description: "元数据",
            properties: {
              author: { type: "string", description: "作者" },
              pageCount: { type: "number", description: "页数" },
              wordCount: { type: "number", description: "字数" },
            },
          },
        },
      },
      tables: {
        type: "array",
        description: "表格数据",
        items: {
          type: "object",
          properties: {
            headers: {
              type: "array",
              description: "表头",
              items: { type: "string" },
            },
            rows: {
              type: "array",
              description: "数据行",
              items: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        },
      },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property // 90 秒超时
  }

  validateInput(input: FileParserInput) {
    // 验证必填字段
    if (!input.file?.mimeType || !input.file.filename) {
      return false;
    }

    // 至少需要 URL 或 Buffer 之一
    if (!input.file.url && !input.file.buffer) {
      return false;
    }

    // 验证支持的文件类型
    const supportedMimeTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ];

    if (!supportedMimeTypes.includes(input.file.mimeType)) {
      return false;
    }

    return true;
  }

  protected async doExecute(
    input: FileParserInput,
    _context: ToolContext,
  ): Promise<FileParserOutput> {
    const { file, options = {} } = input;

    this.logger.log(
      `[doExecute] Parsing file: ${file.filename} (${file.mimeType})`,
    );

    try {
      // 获取文件内容
      let buffer: Buffer;

      if (file.buffer) {
        buffer = file.buffer;
      } else if (file.url) {
        // 如果是远程文件，先下载
        buffer = await this.downloadFile(file.url);
      } else {
        throw new Error("No file buffer or URL provided");
      }

      // 根据 MIME 类型选择解析器
      switch (file.mimeType) {
        case "application/pdf":
          return await this.parsePDF(buffer, options);

        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
          return await this.parseDOCX(buffer, options);

        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
          return await this.parseXLSX(buffer, options);

        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
          return await this.parsePPTX(buffer, options);

        default:
          throw new Error(`Unsupported file type: ${file.mimeType}`);
      }
    } catch (error) {
      this.logger.error(
        `[doExecute] Parse failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // ==========================================================================
  // PDF Parser
  // ==========================================================================

  private async parsePDF(
    buffer: Buffer,
    options: FileParserInput["options"],
  ): Promise<FileParserOutput> {
    const pdfParse = await import("pdf-parse");

    const data = await (
      pdfParse.default as unknown as (
        buffer: Buffer,
        options: { max: number },
      ) => Promise<PDFParseResult>
    )(buffer, {
      max: options?.maxPages || 100,
    });

    // 提取文本内容
    const content = data.text;

    // 分析文档结构
    const sections = this.analyzeSections(content);

    // 计算字数
    const wordCount = content
      .split(/\s+/)
      .filter((w: string) => w.length > 0).length;

    return {
      content,
      structure: {
        title: this.extractTitle(content),
        sections,
        metadata: {
          author: data.info?.Author,
          pageCount: data.numpages,
          wordCount,
        },
      },
      tables: options?.extractTables ? this.extractTables(content) : undefined,
    };
  }

  // ==========================================================================
  // DOCX Parser
  // ==========================================================================

  private async parseDOCX(
    buffer: Buffer,
    options: FileParserInput["options"],
  ): Promise<FileParserOutput> {
    const mammoth = await import("mammoth");

    const result = await mammoth.convertToHtml({ buffer });
    const htmlContent = result.value;

    // 使用 cheerio 解析 HTML
    const cheerio = await import("cheerio");
    const $ = cheerio.load(htmlContent);

    // 提取纯文本
    const content = $.text().trim();

    // 提取章节
    const sections: FileParserOutput["structure"]["sections"] = [];
    $("h1, h2, h3, h4, h5, h6").each((_: number, element: unknown) => {
      const $el = $(element as never);
      const elementObj = element as { tagName: string };
      const tagName = elementObj.tagName.toLowerCase();
      const level = parseInt(tagName.substring(1));
      const title = $el.text().trim();

      // 获取该标题后的内容（直到下一个同级或更高级标题）
      let content = "";
      $el
        .nextUntil(`h1, h2, h3, h4, h5, h6`)
        .each((_: number, sibling: unknown) => {
          content +=
            $(sibling as never)
              .text()
              .trim() + "\n";
        });

      sections.push({
        level,
        title,
        content: content.trim(),
      });
    });

    // 计算字数
    const wordCount = content
      .split(/\s+/)
      .filter((w: string) => w.length > 0).length;

    // 提取表格
    let tables: FileParserOutput["tables"] | undefined;
    if (options?.extractTables) {
      tables = [];
      $("table").each((_: number, table: unknown) => {
        const headers: string[] = [];
        const rows: string[][] = [];

        // 提取表头
        $(table as never)
          .find("thead tr th, tr:first-child th, tr:first-child td")
          .each((_: number, th: unknown) => {
            headers.push(
              $(th as never)
                .text()
                .trim(),
            );
          });

        // 提取数据行
        const hasTheadOrFirstRowAsHeader = headers.length > 0;
        $(table as never)
          .find(
            hasTheadOrFirstRowAsHeader
              ? "tbody tr, tr:not(:first-child)"
              : "tr",
          )
          .each((_: number, tr: unknown) => {
            const row: string[] = [];
            $(tr as never)
              .find("td, th")
              .each((_: number, td: unknown) => {
                row.push(
                  $(td as never)
                    .text()
                    .trim(),
                );
              });
            if (row.length > 0) {
              rows.push(row);
            }
          });

        if (headers.length > 0 || rows.length > 0) {
          tables!.push({
            headers: headers.length > 0 ? headers : rows[0] || [],
            rows: headers.length > 0 ? rows : rows.slice(1),
          });
        }
      });
    }

    return {
      content,
      structure: {
        title: this.extractTitle(content),
        sections,
        metadata: {
          wordCount,
        },
      },
      tables,
    };
  }

  // ==========================================================================
  // XLSX Parser
  // ==========================================================================

  private async parseXLSX(
    buffer: Buffer,
    options: FileParserInput["options"],
  ): Promise<FileParserOutput> {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const sections: FileParserOutput["structure"]["sections"] = [];
    const tables: FileParserOutput["tables"] = [];
    let content = "";

    // 遍历所有工作表
    workbook.eachSheet((worksheet: ExcelJSWorksheet, sheetId: number) => {
      const sheetName = worksheet.name;
      sections.push({
        level: 1,
        title: sheetName,
        content: `工作表 ${sheetId}`,
      });

      // 提取表格数据
      const rows: string[][] = [];
      let headers: string[] = [];

      worksheet.eachRow((row: ExcelJSRow, rowNumber: number) => {
        const rowData: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
          const value = cell.value;
          let cellText = "";

          if (value !== null && value !== undefined) {
            if (
              typeof value === "object" &&
              value !== null &&
              "richText" in value
            ) {
              const richTextValue = value as {
                richText: Array<{ text: string }>;
              };
              cellText = richTextValue.richText.map((t) => t.text).join("");
            } else if (
              typeof value === "object" &&
              value !== null &&
              "text" in value
            ) {
              const textValue = value as { text: string };
              cellText = textValue.text;
            } else {
              cellText = String(value);
            }
          }

          rowData.push(cellText);
        });

        if (rowNumber === 1) {
          headers = rowData;
        } else {
          rows.push(rowData);
        }

        content += rowData.join("\t") + "\n";
      });

      if (options?.extractTables && (headers.length > 0 || rows.length > 0)) {
        tables.push({
          headers,
          rows,
        });
      }
    });

    return {
      content: content.trim(),
      structure: {
        title: workbook.creator || "Excel 工作簿",
        sections,
        metadata: {
          author: workbook.creator,
          pageCount: workbook.worksheets.length,
          wordCount: content.split(/\s+/).filter((w) => w.length > 0).length,
        },
      },
      tables: options?.extractTables ? tables : undefined,
    };
  }

  // ==========================================================================
  // PPTX Parser
  // ==========================================================================

  private async parsePPTX(
    buffer: Buffer,
    options: FileParserInput["options"],
  ): Promise<FileParserOutput> {
    const JSZip = await import("jszip");
    const xml2js = await import("xml2js");

    const zip = await JSZip.loadAsync(buffer);

    const sections: FileParserOutput["structure"]["sections"] = [];
    let content = "";
    let slideCount = 0;

    // 提取所有幻灯片
    const slideFiles = Object.keys(zip.files).filter((name) =>
      name.match(/ppt\/slides\/slide\d+\.xml$/),
    );

    slideFiles.sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || "0");
      const numB = parseInt(b.match(/\d+/)?.[0] || "0");
      return numA - numB;
    });

    for (const slideFile of slideFiles) {
      slideCount++;
      const slideXml = await zip.files[slideFile].async("string");
      const slideData = await xml2js.parseStringPromise(slideXml);

      // 提取文本内容
      const slideText = this.extractTextFromSlideXML(slideData);

      if (slideText.trim()) {
        sections.push({
          level: 1,
          title: `幻灯片 ${slideCount}`,
          content: slideText,
        });

        content += `\n=== 幻灯片 ${slideCount} ===\n${slideText}\n`;
      }
    }

    // 提取元数据
    let author: string | undefined;
    try {
      const coreXml = await zip.files["docProps/core.xml"]?.async("string");
      if (coreXml) {
        const coreData = await xml2js.parseStringPromise(coreXml);
        author = coreData?.["cp:coreProperties"]?.["dc:creator"]?.[0];
      }
    } catch (error) {
      // 忽略元数据提取错误
    }

    return {
      content: content.trim(),
      structure: {
        title: this.extractTitle(content) || "PowerPoint 演示文稿",
        sections,
        metadata: {
          author,
          pageCount: slideCount,
          wordCount: content.split(/\s+/).filter((w) => w.length > 0).length,
        },
      },
      tables: options?.extractTables ? this.extractTables(content) : undefined,
    };
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * 下载远程文件
   */
  private async downloadFile(url: string): Promise<Buffer> {
    const axios = await import("axios");
    const response = await axios.default.get(url, {
      responseType: "arraybuffer",
    });
    return Buffer.from(response.data);
  }

  /**
   * 提取标题（取第一行或第一个标题）
   */
  private extractTitle(content: string): string | undefined {
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) return undefined;

    // 返回第一行（不超过 100 字符）
    const firstLine = lines[0].trim();
    return firstLine.length > 100
      ? firstLine.substring(0, 100) + "..."
      : firstLine;
  }

  /**
   * 分析章节结构（基于空行和标题模式）
   */
  private analyzeSections(
    content: string,
  ): FileParserOutput["structure"]["sections"] {
    const sections: FileParserOutput["structure"]["sections"] = [];
    const lines = content.split("\n");

    let currentSection: {
      level: number;
      title: string;
      content: string;
    } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 检测标题（全大写、较短、或以数字/符号开头）
      const isTitleLike =
        line.length > 0 &&
        line.length < 80 &&
        (line === line.toUpperCase() ||
          /^[\d一二三四五六七八九十]+[、\.]/.test(line));

      if (isTitleLike) {
        if (currentSection) {
          sections.push(currentSection);
        }

        currentSection = {
          level: 1,
          title: line,
          content: "",
        };
      } else if (currentSection && line.length > 0) {
        currentSection.content += line + "\n";
      }
    }

    if (currentSection) {
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * 提取表格（简单的文本表格检测）
   */
  private extractTables(content: string): FileParserOutput["tables"] {
    const tables: FileParserOutput["tables"] = [];
    const lines = content.split("\n");

    let currentTable: { headers: string[]; rows: string[][] } | null = null;

    for (const line of lines) {
      // 检测表格分隔符（如 |、\t、多个空格）
      if (line.includes("|") || /\t/.test(line) || /\s{3,}/.test(line)) {
        const cells = line
          .split(/[|\t]|(?:\s{3,})/)
          .map((cell) => cell.trim())
          .filter((cell) => cell.length > 0);

        if (cells.length > 1) {
          if (!currentTable) {
            currentTable = {
              headers: cells,
              rows: [],
            };
          } else {
            currentTable.rows.push(cells);
          }
        }
      } else if (currentTable && line.trim().length === 0) {
        // 表格结束
        if (currentTable.rows.length > 0) {
          tables.push(currentTable);
        }
        currentTable = null;
      }
    }

    if (currentTable && currentTable.rows.length > 0) {
      tables.push(currentTable);
    }

    return tables.length > 0 ? tables : undefined;
  }

  /**
   * 从 PPTX Slide XML 中提取文本
   */
  private extractTextFromSlideXML(slideData: unknown): string {
    const texts: string[] = [];

    const extractText = (obj: unknown): void => {
      if (!obj) return;

      if (typeof obj === "string") {
        texts.push(obj);
        return;
      }

      if (Array.isArray(obj)) {
        obj.forEach((item) => extractText(item));
        return;
      }

      if (typeof obj === "object") {
        const objRecord = obj as Record<string, unknown>;
        // 查找 <a:t> 标签（文本内容）
        if (objRecord["a:t"]) {
          extractText(objRecord["a:t"]);
        }

        // 递归处理所有属性
        Object.values(objRecord).forEach((value) => extractText(value));
      }
    };

    extractText(slideData);

    return texts.join(" ");
  }
}
