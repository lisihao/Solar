/**
 * 统一导出系统 - XLSX 渲染器
 * 使用 exceljs 库生成 Excel 电子表格
 */

import { Injectable, Logger } from "@nestjs/common";
import { ExportFormat } from "@prisma/client";
import {
  ExportRenderer,
  MIME_TYPES,
  FILE_EXTENSIONS,
} from "./renderer.interface";
import {
  UnifiedContent,
  ContentSection,
  Reference,
} from "../types/unified-content";
import { ThemeConfig, LayoutConfig } from "../types/theme-config";
import { ExportOptions } from "../types/export-options";
import { APP_CONFIG } from "../../config/app.config";
import ExcelJS from "exceljs";

@Injectable()
export class XlsxRenderer implements ExportRenderer {
  private readonly logger = new Logger(XlsxRenderer.name);
  readonly format = ExportFormat.XLSX;

  async render(
    content: UnifiedContent,
    theme: ThemeConfig,
    _layout: LayoutConfig,
    options: ExportOptions,
  ): Promise<Buffer> {
    this.logger.debug("Rendering XLSX...");

    const workbook = new ExcelJS.Workbook();

    // 设置工作簿属性
    workbook.creator = content.metadata.author || APP_CONFIG.brand.fullName;
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.title = content.metadata.title;

    // 添加封面工作表
    if (options.includeCover !== false) {
      this.addCoverSheet(workbook, content, theme);
    }

    // 添加目录工作表
    if (options.includeTableOfContents && content.tableOfContents?.enabled) {
      this.addTocSheet(workbook, content, theme);
    }

    // 添加内容工作表
    this.addContentSheet(workbook, content, theme);

    // 添加表格数据工作表（如果有表格）
    this.addTablesSheet(workbook, content, theme);

    // 添加参考文献工作表
    if (content.references && options.includeReferences !== false) {
      this.addReferencesSheet(workbook, content.references, theme);
    }

    // 生成 Buffer
    const buffer = await workbook.xlsx.writeBuffer();

    this.logger.debug(`XLSX generated: ${buffer.byteLength} bytes`);

    return Buffer.from(buffer);
  }

  getMimeType(): string {
    return MIME_TYPES.XLSX;
  }

  getFileExtension(): string {
    return FILE_EXTENSIONS.XLSX;
  }

  /**
   * 添加封面工作表
   */
  private addCoverSheet(
    workbook: ExcelJS.Workbook,
    content: UnifiedContent,
    theme: ThemeConfig,
  ): void {
    const sheet = workbook.addWorksheet("封面", {
      properties: { tabColor: { argb: this.hexToArgb(theme.colors.primary) } },
    });

    // 设置列宽
    sheet.columns = [{ width: 50 }];

    // 标题
    sheet.addRow([]);
    sheet.addRow([]);
    sheet.addRow([]);
    const titleRow = sheet.addRow([content.metadata.title]);
    titleRow.font = {
      size: 28,
      bold: true,
      color: { argb: this.hexToArgb(theme.colors.heading) },
    };
    titleRow.alignment = { horizontal: "center" };

    // 副标题
    if (content.metadata.subtitle) {
      sheet.addRow([]);
      const subtitleRow = sheet.addRow([content.metadata.subtitle]);
      subtitleRow.font = {
        size: 16,
        color: { argb: this.hexToArgb(theme.colors.textLight) },
      };
      subtitleRow.alignment = { horizontal: "center" };
    }

    // 元信息
    sheet.addRow([]);
    sheet.addRow([]);

    if (content.metadata.author) {
      const authorRow = sheet.addRow([`作者: ${content.metadata.author}`]);
      authorRow.font = {
        size: 12,
        color: { argb: this.hexToArgb(theme.colors.text) },
      };
      authorRow.alignment = { horizontal: "center" };
    }

    if (content.metadata.organization) {
      const orgRow = sheet.addRow([content.metadata.organization]);
      orgRow.font = {
        size: 12,
        color: { argb: this.hexToArgb(theme.colors.text) },
      };
      orgRow.alignment = { horizontal: "center" };
    }

    if (content.metadata.date) {
      const dateRow = sheet.addRow([
        `日期: ${new Date(content.metadata.date).toLocaleDateString("zh-CN")}`,
      ]);
      dateRow.font = {
        size: 12,
        color: { argb: this.hexToArgb(theme.colors.textLight) },
      };
      dateRow.alignment = { horizontal: "center" };
    }

    // 合并单元格以美化
    sheet.mergeCells("A4:A4");
  }

  /**
   * 添加目录工作表
   */
  private addTocSheet(
    workbook: ExcelJS.Workbook,
    content: UnifiedContent,
    theme: ThemeConfig,
  ): void {
    const sheet = workbook.addWorksheet("目录", {
      properties: {
        tabColor: { argb: this.hexToArgb(theme.colors.secondary) },
      },
    });

    // 设置列宽
    sheet.columns = [{ width: 5 }, { width: 50 }];

    // 标题
    const titleRow = sheet.addRow(["", "目录"]);
    titleRow.font = {
      size: 18,
      bold: true,
      color: { argb: this.hexToArgb(theme.colors.heading) },
    };

    sheet.addRow([]);

    // 目录项
    const headings = content.sections.filter(
      (s) => s.type === "heading" && s.level && s.level <= 3,
    );

    headings.forEach((h, index) => {
      const indent = "  ".repeat((h.level || 1) - 1);
      const row = sheet.addRow([index + 1, `${indent}${h.content}`]);
      row.font = {
        size: h.level === 1 ? 14 : h.level === 2 ? 12 : 11,
        bold: h.level === 1,
        color: { argb: this.hexToArgb(theme.colors.text) },
      };
    });
  }

  /**
   * 添加内容工作表
   */
  private addContentSheet(
    workbook: ExcelJS.Workbook,
    content: UnifiedContent,
    theme: ThemeConfig,
  ): void {
    const sheet = workbook.addWorksheet("内容", {
      properties: { tabColor: { argb: this.hexToArgb(theme.colors.primary) } },
    });

    // 设置列宽
    sheet.columns = [{ width: 80 }];

    // 遍历内容节
    for (const section of content.sections) {
      this.renderSection(sheet, section, theme);
    }
  }

  /**
   * 渲染单个内容节
   */
  private renderSection(
    sheet: ExcelJS.Worksheet,
    section: ContentSection,
    theme: ThemeConfig,
  ): void {
    switch (section.type) {
      case "heading":
        this.renderHeading(sheet, section, theme);
        break;

      case "paragraph":
        this.renderParagraph(sheet, section, theme);
        break;

      case "list":
        this.renderList(sheet, section, theme);
        break;

      case "table":
        this.renderTable(sheet, section, theme);
        break;

      case "code":
        this.renderCode(sheet, section, theme);
        break;

      case "quote":
        this.renderQuote(sheet, section, theme);
        break;

      case "divider":
        sheet.addRow([]);
        sheet.addRow(["━".repeat(40)]);
        sheet.addRow([]);
        break;

      case "callout":
        this.renderCallout(sheet, section, theme);
        break;

      default:
        if (section.content) {
          sheet.addRow([section.content]);
        }
    }
  }

  /**
   * 渲染标题
   */
  private renderHeading(
    sheet: ExcelJS.Worksheet,
    section: ContentSection,
    theme: ThemeConfig,
  ): void {
    sheet.addRow([]);

    const sizes = [24, 20, 16, 14, 12, 11];
    const level = Math.min(section.level || 1, 6);

    const row = sheet.addRow([section.content || ""]);
    row.font = {
      size: sizes[level - 1],
      bold: true,
      color: { argb: this.hexToArgb(theme.colors.heading) },
    };

    // 一级标题添加下划线
    if (level === 1) {
      row.border = {
        bottom: {
          style: "medium",
          color: { argb: this.hexToArgb(theme.colors.primary) },
        },
      };
    }

    sheet.addRow([]);
  }

  /**
   * 渲染段落
   */
  private renderParagraph(
    sheet: ExcelJS.Worksheet,
    section: ContentSection,
    theme: ThemeConfig,
  ): void {
    const row = sheet.addRow([section.content || ""]);
    row.font = {
      size: 11,
      color: { argb: this.hexToArgb(theme.colors.text) },
    };
    row.alignment = { wrapText: true };
    sheet.addRow([]);
  }

  /**
   * 渲染列表
   */
  private renderList(
    sheet: ExcelJS.Worksheet,
    section: ContentSection,
    theme: ThemeConfig,
  ): void {
    interface ListItemType {
      content: string;
      children?: ListItemType[];
    }
    const renderItems = (items: ListItemType[], depth: number) => {
      items.forEach((item, index) => {
        const prefix = section.ordered
          ? `${"  ".repeat(depth)}${index + 1}. `
          : `${"  ".repeat(depth)}• `;
        const row = sheet.addRow([`${prefix}${item.content}`]);
        row.font = {
          size: 11,
          color: { argb: this.hexToArgb(theme.colors.text) },
        };

        if (item.children) {
          renderItems(item.children, depth + 1);
        }
      });
    };

    if (section.items) {
      renderItems(section.items, 0);
    }

    sheet.addRow([]);
  }

  /**
   * 渲染表格
   */
  private renderTable(
    sheet: ExcelJS.Worksheet,
    section: ContentSection,
    theme: ThemeConfig,
  ): void {
    // 表头
    if (section.headers) {
      const headerRow = sheet.addRow(section.headers);
      headerRow.font = {
        bold: true,
        color: { argb: this.hexToArgb(theme.colors.heading) },
      };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: this.hexToArgb(theme.colors.backgroundAlt || "#f5f5f5"),
        },
      };
      headerRow.border = {
        bottom: {
          style: "thin",
          color: { argb: this.hexToArgb(theme.colors.border) },
        },
      };
    }

    // 表体
    if (section.rows) {
      for (const tableRow of section.rows) {
        const row = sheet.addRow(tableRow.cells);
        row.font = {
          color: { argb: this.hexToArgb(theme.colors.text) },
        };
        row.border = {
          bottom: {
            style: "thin",
            color: { argb: this.hexToArgb(theme.colors.border) },
          },
        };
      }
    }

    sheet.addRow([]);
  }

  /**
   * 渲染代码块
   */
  private renderCode(
    sheet: ExcelJS.Worksheet,
    section: ContentSection,
    theme: ThemeConfig,
  ): void {
    const row = sheet.addRow([section.content || ""]);
    row.font = {
      name: theme.fonts.mono.family.split(",")[0].trim(),
      size: 10,
      color: { argb: "FFd4d4d4" },
    };
    row.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1e1e1e" },
    };
    row.alignment = { wrapText: true };
    sheet.addRow([]);
  }

  /**
   * 渲染引用
   */
  private renderQuote(
    sheet: ExcelJS.Worksheet,
    section: ContentSection,
    theme: ThemeConfig,
  ): void {
    const row = sheet.addRow([`"${section.content || ""}"`]);
    row.font = {
      size: 11,
      italic: true,
      color: { argb: this.hexToArgb(theme.colors.textLight) },
    };
    row.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: this.hexToArgb(theme.colors.backgroundAlt || "#f9f9f9"),
      },
    };
    sheet.addRow([]);
  }

  /**
   * 渲染提示框
   */
  private renderCallout(
    sheet: ExcelJS.Worksheet,
    section: ContentSection,
    theme: ThemeConfig,
  ): void {
    const icons: Record<string, string> = {
      info: "ℹ️",
      warning: "⚠️",
      success: "✅",
      error: "❌",
    };

    const colors: Record<string, string> = {
      info: theme.colors.info || "#3b82f6",
      warning: theme.colors.warning,
      success: theme.colors.success,
      error: theme.colors.error,
    };

    const type = section.calloutType || "info";

    const row = sheet.addRow([`${icons[type]} ${section.content || ""}`]);
    row.font = {
      size: 11,
      color: { argb: this.hexToArgb(colors[type]) },
    };
    sheet.addRow([]);
  }

  /**
   * 添加表格数据工作表
   */
  private addTablesSheet(
    workbook: ExcelJS.Workbook,
    content: UnifiedContent,
    theme: ThemeConfig,
  ): void {
    // 找出所有表格
    const tables = content.sections.filter((s) => s.type === "table");

    if (tables.length === 0) return;

    const sheet = workbook.addWorksheet("数据表格", {
      properties: { tabColor: { argb: this.hexToArgb(theme.colors.accent) } },
    });

    let currentRow = 1;

    tables.forEach((table, tableIndex) => {
      // 表格标题
      const titleRow = sheet.getRow(currentRow);
      titleRow.getCell(1).value = `表格 ${tableIndex + 1}`;
      titleRow.font = {
        size: 14,
        bold: true,
        color: { argb: this.hexToArgb(theme.colors.heading) },
      };
      currentRow += 2;

      // 表头
      if (table.headers) {
        const headerRow = sheet.getRow(currentRow);
        table.headers.forEach((h, i) => {
          const cell = headerRow.getCell(i + 1);
          cell.value = h;
          cell.font = {
            bold: true,
            color: { argb: this.hexToArgb(theme.colors.heading) },
          };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: {
              argb: this.hexToArgb(theme.colors.backgroundAlt || "#f5f5f5"),
            },
          };
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        });
        currentRow++;
      }

      // 表体
      if (table.rows) {
        for (const tableRow of table.rows) {
          const row = sheet.getRow(currentRow);
          tableRow.cells.forEach((c, i) => {
            const cell = row.getCell(i + 1);
            cell.value = c;
            cell.border = {
              top: { style: "thin" },
              left: { style: "thin" },
              bottom: { style: "thin" },
              right: { style: "thin" },
            };
          });
          currentRow++;
        }
      }

      currentRow += 2; // 表格之间的间隔
    });

    // 自动调整列宽
    sheet.columns.forEach((column) => {
      column.width = 15;
    });
  }

  /**
   * 添加参考文献工作表
   */
  private addReferencesSheet(
    workbook: ExcelJS.Workbook,
    references: Reference[],
    theme: ThemeConfig,
  ): void {
    const sheet = workbook.addWorksheet("参考文献", {
      properties: {
        tabColor: { argb: this.hexToArgb(theme.colors.secondary) },
      },
    });

    // 设置列宽
    sheet.columns = [
      { width: 5, header: "序号" },
      { width: 40, header: "标题" },
      { width: 40, header: "URL" },
      { width: 30, header: "摘要" },
    ];

    // 表头
    const headerRow = sheet.addRow(["序号", "标题", "URL", "摘要"]);
    headerRow.font = {
      bold: true,
      color: { argb: this.hexToArgb(theme.colors.heading) },
    };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: this.hexToArgb(theme.colors.primary) },
    };
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };

    // 数据行
    for (const ref of references) {
      const row = sheet.addRow([
        ref.id,
        ref.title,
        ref.url || "",
        ref.snippet ? ref.snippet.slice(0, 100) + "..." : "",
      ]);
      row.font = {
        color: { argb: this.hexToArgb(theme.colors.text) },
      };
      row.alignment = { wrapText: true };

      // URL 超链接样式
      if (ref.url) {
        const urlCell = row.getCell(3);
        urlCell.value = {
          text: ref.url,
          hyperlink: ref.url,
        };
        urlCell.font = {
          color: { argb: this.hexToArgb(theme.colors.link) },
          underline: true,
        };
      }
    }

    // 添加筛选器
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: references.length + 1, column: 4 },
    };
  }

  /**
   * 转换十六进制颜色为 ARGB 格式
   */
  private hexToArgb(hex: string): string {
    const cleanHex = hex.replace("#", "");
    return `FF${cleanHex}`;
  }
}
