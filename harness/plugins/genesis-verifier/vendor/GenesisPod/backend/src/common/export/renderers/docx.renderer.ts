/**
 * 统一导出系统 - DOCX 渲染器
 * 使用 docx 库生成 Word 文档
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
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  PageBreak,
  Header,
  Footer,
  PageNumber,
  convertInchesToTwip,
  LevelFormat,
  ShadingType,
  ImageRun,
} from "docx";

@Injectable()
export class DocxRenderer implements ExportRenderer {
  private readonly logger = new Logger(DocxRenderer.name);
  readonly format = ExportFormat.DOCX;

  async render(
    content: UnifiedContent,
    theme: ThemeConfig,
    layout: LayoutConfig,
    options: ExportOptions,
  ): Promise<Buffer> {
    this.logger.debug("Rendering DOCX...");

    const children: Array<Paragraph | Table> = [];

    // 封面
    if (options.includeCover !== false) {
      children.push(...this.generateCover(content, theme));
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // 目录
    if (options.includeTableOfContents && content.tableOfContents?.enabled) {
      children.push(...this.generateToc(content, theme));
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // 正文
    for (const section of content.sections) {
      const rendered = this.renderSection(section, theme);
      if (Array.isArray(rendered)) {
        children.push(...rendered);
      } else {
        children.push(rendered);
      }
    }

    // 参考文献
    if (content.references && options.includeReferences !== false) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(...this.generateReferences(content.references, theme));
    }

    // 创建文档
    const doc = new Document({
      styles: this.generateStyles(theme),
      numbering: this.generateNumbering() as never,
      sections: [
        {
          properties: {
            page: {
              size: this.getPageSize(layout.pageSize),
              margin: {
                top: convertInchesToTwip(theme.spacing.page.top / 72),
                right: convertInchesToTwip(theme.spacing.page.right / 72),
                bottom: convertInchesToTwip(theme.spacing.page.bottom / 72),
                left: convertInchesToTwip(theme.spacing.page.left / 72),
              },
            },
          },
          headers:
            options.includePageNumbers !== false
              ? {
                  default: new Header({
                    children: [],
                  }),
                }
              : undefined,
          footers:
            options.includePageNumbers !== false
              ? {
                  default: new Footer({
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                          new TextRun({
                            children: [
                              PageNumber.CURRENT,
                              " / ",
                              PageNumber.TOTAL_PAGES,
                            ],
                            size: 20,
                            color: "666666",
                          }),
                        ],
                      }),
                    ],
                  }),
                }
              : undefined,
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    this.logger.debug(`DOCX generated: ${buffer.length} bytes`);

    return buffer;
  }

  getMimeType(): string {
    return MIME_TYPES.DOCX;
  }

  getFileExtension(): string {
    return FILE_EXTENSIONS.DOCX;
  }

  /**
   * 生成封面
   */
  private generateCover(
    content: UnifiedContent,
    theme: ThemeConfig,
  ): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    // 添加空白间距
    for (let i = 0; i < 8; i++) {
      paragraphs.push(new Paragraph({ children: [] }));
    }

    // 标题
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: content.metadata.title,
            bold: true,
            size: 56,
            color: this.hexToDocxColor(theme.colors.heading),
          }),
        ],
      }),
    );

    // 副标题
    if (content.metadata.subtitle) {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
          children: [
            new TextRun({
              text: content.metadata.subtitle,
              size: 28,
              color: this.hexToDocxColor(theme.colors.textLight),
            }),
          ],
        }),
      );
    }

    // 添加更多空白
    for (let i = 0; i < 6; i++) {
      paragraphs.push(new Paragraph({ children: [] }));
    }

    // 作者
    if (content.metadata.author) {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: `作者: ${content.metadata.author}`,
              size: 24,
              color: this.hexToDocxColor(theme.colors.text),
            }),
          ],
        }),
      );
    }

    // 机构
    if (content.metadata.organization) {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: content.metadata.organization,
              size: 24,
              color: this.hexToDocxColor(theme.colors.text),
            }),
          ],
        }),
      );
    }

    // 日期
    if (content.metadata.date) {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: new Date(content.metadata.date).toLocaleDateString("zh-CN"),
              size: 24,
              color: this.hexToDocxColor(theme.colors.textLight),
            }),
          ],
        }),
      );
    }

    return paragraphs;
  }

  /**
   * 生成目录
   */
  private generateToc(
    content: UnifiedContent,
    theme: ThemeConfig,
  ): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    // 目录标题
    paragraphs.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: "目录",
            bold: true,
            size: 36,
            color: this.hexToDocxColor(theme.colors.heading),
          }),
        ],
      }),
    );

    // 目录项
    const headings = content.sections.filter(
      (s) => s.type === "heading" && s.level && s.level <= 3,
    );

    for (const h of headings) {
      const indent = (h.level || 1) - 1;
      paragraphs.push(
        new Paragraph({
          indent: { left: convertInchesToTwip(indent * 0.5) },
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: h.content || "",
              size: 24,
              color: this.hexToDocxColor(theme.colors.text),
            }),
          ],
        }),
      );
    }

    return paragraphs;
  }

  /**
   * 渲染单个内容节
   */
  private renderSection(
    section: ContentSection,
    theme: ThemeConfig,
  ): Paragraph | Paragraph[] | Table {
    switch (section.type) {
      case "heading":
        return this.renderHeading(section, theme);

      case "paragraph":
        return this.renderParagraph(section, theme);

      case "list":
        return this.renderList(section, theme);

      case "table":
        return this.renderTable(section, theme);

      case "code":
        return this.renderCode(section, theme);

      case "quote":
        return this.renderQuote(section, theme);

      case "divider":
        return this.renderDivider();

      case "callout":
        return this.renderCallout(section, theme);

      default:
        return new Paragraph({
          children: [
            new TextRun({
              text: section.content || "",
              size: theme.fonts.body.size * 2,
            }),
          ],
        });
    }
  }

  /**
   * 渲染标题
   */
  private renderHeading(
    section: ContentSection,
    theme: ThemeConfig,
  ): Paragraph {
    const level = Math.min(section.level || 1, 6);
    const headingLevels = [
      HeadingLevel.HEADING_1,
      HeadingLevel.HEADING_2,
      HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4,
      HeadingLevel.HEADING_5,
      HeadingLevel.HEADING_6,
    ];

    const sizes = [36, 30, 26, 24, 22, 20];

    return new Paragraph({
      heading: headingLevels[level - 1],
      spacing: { before: 400, after: 200 },
      children: [
        new TextRun({
          text: section.content || "",
          bold: true,
          size: sizes[level - 1],
          color: this.hexToDocxColor(theme.colors.heading),
        }),
      ],
    });
  }

  /**
   * 渲染段落
   */
  private renderParagraph(
    section: ContentSection,
    theme: ThemeConfig,
  ): Paragraph {
    return new Paragraph({
      spacing: { after: theme.spacing.paragraph * 20 },
      children: [
        new TextRun({
          text: section.content || "",
          size: theme.fonts.body.size * 2,
          color: this.hexToDocxColor(theme.colors.text),
        }),
      ],
    });
  }

  /**
   * 渲染列表
   */
  private renderList(section: ContentSection, theme: ThemeConfig): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    interface ListItemType {
      content: string;
      children?: ListItemType[];
    }
    const renderItems = (items: ListItemType[], level: number) => {
      for (const item of items) {
        paragraphs.push(
          new Paragraph({
            numbering: section.ordered
              ? { reference: "ordered-list", level }
              : { reference: "bullet-list", level },
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: item.content,
                size: theme.fonts.body.size * 2,
                color: this.hexToDocxColor(theme.colors.text),
              }),
            ],
          }),
        );

        if (item.children) {
          renderItems(item.children, level + 1);
        }
      }
    };

    if (section.items) {
      renderItems(section.items, 0);
    }

    return paragraphs;
  }

  /**
   * 渲染表格
   */
  private renderTable(section: ContentSection, theme: ThemeConfig): Table {
    const rows: TableRow[] = [];

    // 表头
    if (section.headers) {
      rows.push(
        new TableRow({
          tableHeader: true,
          children: section.headers.map(
            (h) =>
              new TableCell({
                shading: {
                  type: ShadingType.CLEAR,
                  fill: this.hexToDocxColor(
                    theme.colors.backgroundAlt || "f5f5f5",
                  ),
                },
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: h,
                        bold: true,
                        size: theme.fonts.body.size * 2,
                        color: this.hexToDocxColor(theme.colors.heading),
                      }),
                    ],
                  }),
                ],
              }),
          ),
        }),
      );
    }

    // 表体
    if (section.rows) {
      for (const row of section.rows) {
        rows.push(
          new TableRow({
            children: row.cells.map(
              (cell) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: cell,
                          size: theme.fonts.body.size * 2,
                          color: this.hexToDocxColor(theme.colors.text),
                        }),
                      ],
                    }),
                  ],
                }),
            ),
          }),
        );
      }
    }

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
    });
  }

  /**
   * 渲染代码块
   */
  private renderCode(section: ContentSection, theme: ThemeConfig): Paragraph {
    return new Paragraph({
      shading: {
        type: ShadingType.CLEAR,
        fill: "1e1e1e",
      },
      spacing: { before: 200, after: 200 },
      children: [
        new TextRun({
          text: section.content || "",
          font: theme.fonts.mono.family.split(",")[0].trim(),
          size: theme.fonts.mono.size * 2,
          color: "d4d4d4",
        }),
      ],
    });
  }

  /**
   * 渲染引用
   */
  private renderQuote(section: ContentSection, theme: ThemeConfig): Paragraph {
    return new Paragraph({
      indent: { left: convertInchesToTwip(0.5) },
      border: {
        left: {
          style: BorderStyle.SINGLE,
          size: 24,
          color: this.hexToDocxColor(theme.colors.primary),
        },
      },
      spacing: { before: 200, after: 200 },
      children: [
        new TextRun({
          text: section.content || "",
          italics: true,
          size: theme.fonts.body.size * 2,
          color: this.hexToDocxColor(theme.colors.textLight),
        }),
      ],
    });
  }

  /**
   * 渲染分隔线
   */
  private renderDivider(): Paragraph {
    return new Paragraph({
      border: {
        bottom: {
          style: BorderStyle.SINGLE,
          size: 1,
          color: "CCCCCC",
        },
      },
      spacing: { before: 300, after: 300 },
      children: [],
    });
  }

  /**
   * 渲染提示框
   */
  private renderCallout(
    section: ContentSection,
    theme: ThemeConfig,
  ): Paragraph {
    const colors: Record<string, string> = {
      info: theme.colors.info || "3b82f6",
      warning: theme.colors.warning,
      success: theme.colors.success,
      error: theme.colors.error,
    };

    const bgColors: Record<string, string> = {
      info: "e7f5ff",
      warning: "fff8e1",
      success: "e8f5e9",
      error: "ffebee",
    };

    const type = section.calloutType || "info";

    return new Paragraph({
      shading: {
        type: ShadingType.CLEAR,
        fill: bgColors[type],
      },
      border: {
        left: {
          style: BorderStyle.SINGLE,
          size: 24,
          color: this.hexToDocxColor(colors[type]),
        },
      },
      spacing: { before: 200, after: 200 },
      children: [
        new TextRun({
          text: section.content || "",
          size: theme.fonts.body.size * 2,
          color: this.hexToDocxColor(theme.colors.text),
        }),
      ],
    });
  }

  /**
   * 生成参考文献
   */
  private generateReferences(
    references: Reference[],
    theme: ThemeConfig,
  ): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    // 标题
    paragraphs.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: "参考文献",
            bold: true,
            size: 36,
            color: this.hexToDocxColor(theme.colors.heading),
          }),
        ],
      }),
    );

    // 参考文献列表
    for (const ref of references) {
      const children: TextRun[] = [
        new TextRun({
          text: `[${ref.id}] `,
          bold: true,
          size: theme.fonts.body.size * 2,
          color: this.hexToDocxColor(theme.colors.primary),
        }),
        new TextRun({
          text: ref.title,
          bold: true,
          size: theme.fonts.body.size * 2,
          color: this.hexToDocxColor(theme.colors.text),
        }),
      ];

      if (ref.url) {
        children.push(
          new TextRun({
            text: ` - ${ref.url}`,
            size: theme.fonts.body.size * 2,
            color: this.hexToDocxColor(theme.colors.link),
          }),
        );
      }

      paragraphs.push(
        new Paragraph({
          spacing: { after: 200 },
          children,
        }),
      );

      if (ref.snippet) {
        paragraphs.push(
          new Paragraph({
            indent: { left: convertInchesToTwip(0.5) },
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: ref.snippet.slice(0, 150) + "...",
                italics: true,
                size: (theme.fonts.body.size - 1) * 2,
                color: this.hexToDocxColor(theme.colors.textLight),
              }),
            ],
          }),
        );
      }
    }

    return paragraphs;
  }

  /**
   * 生成样式
   */
  private generateStyles(theme: ThemeConfig): {
    paragraphStyles: Array<{
      id: string;
      name: string;
      run: { size: number; font: string; color: string };
      paragraph: { spacing: { line: number } };
    }>;
  } {
    return {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          run: {
            size: theme.fonts.body.size * 2,
            font: theme.fonts.body.family.split(",")[0].trim(),
            color: this.hexToDocxColor(theme.colors.text),
          },
          paragraph: {
            spacing: { line: theme.fonts.body.lineHeight * 240 },
          },
        },
      ],
    };
  }

  /**
   * 生成编号配置
   */
  private generateNumbering(): unknown {
    return {
      config: [
        {
          reference: "bullet-list",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: "◦",
              alignment: AlignmentType.LEFT,
            },
            {
              level: 2,
              format: LevelFormat.BULLET,
              text: "▪",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
        {
          reference: "ordered-list",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
            },
            {
              level: 1,
              format: LevelFormat.LOWER_LETTER,
              text: "%2)",
              alignment: AlignmentType.LEFT,
            },
            {
              level: 2,
              format: LevelFormat.LOWER_ROMAN,
              text: "%3.",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    };
  }

  /**
   * WYSIWYG 模式：从截图创建 DOCX
   */
  async renderFromScreenshot(
    screenshotBuffer: Buffer,
    _title: string,
    options: ExportOptions,
  ): Promise<Buffer> {
    // A4 dimensions at 96 DPI: 794 x 1123 pixels
    const pageWidthPx = options.pageSize === "Letter" ? 816 : 794;
    const pageHeightPx = options.pageSize === "Letter" ? 1056 : 1123;

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              size: this.getPageSize(options.pageSize || "A4"),
              margin: {
                top: convertInchesToTwip(0.5),
                right: convertInchesToTwip(0.5),
                bottom: convertInchesToTwip(0.5),
                left: convertInchesToTwip(0.5),
              },
            },
          },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  data: screenshotBuffer,
                  transformation: {
                    width: pageWidthPx,
                    height: pageHeightPx,
                  },
                  type: "png",
                }),
              ],
            }),
          ],
        },
      ],
    });

    return await Packer.toBuffer(doc);
  }

  /**
   * 获取页面尺寸
   */
  private getPageSize(size: string): { width: number; height: number } {
    const sizes: Record<string, { width: number; height: number }> = {
      A4: {
        width: convertInchesToTwip(8.27),
        height: convertInchesToTwip(11.69),
      },
      A3: {
        width: convertInchesToTwip(11.69),
        height: convertInchesToTwip(16.54),
      },
      Letter: {
        width: convertInchesToTwip(8.5),
        height: convertInchesToTwip(11),
      },
      Legal: {
        width: convertInchesToTwip(8.5),
        height: convertInchesToTwip(14),
      },
    };
    return sizes[size] || sizes.A4;
  }

  /**
   * 转换十六进制颜色
   */
  private hexToDocxColor(hex: string): string {
    return hex.replace("#", "");
  }
}
