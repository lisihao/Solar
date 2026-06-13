/**
 * 统一导出系统 - PPTX 渲染器
 * 使用 pptxgenjs 库生成 PowerPoint 演示文稿
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
import type PptxGenJSType from "pptxgenjs";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PptxGenJS: new () => PptxGenJSType = require("pptxgenjs");

@Injectable()
export class PptxRenderer implements ExportRenderer {
  private readonly logger = new Logger(PptxRenderer.name);
  readonly format = ExportFormat.PPTX;

  async render(
    content: UnifiedContent,
    theme: ThemeConfig,
    layout: LayoutConfig,
    options: ExportOptions,
  ): Promise<Buffer> {
    this.logger.debug("Rendering PPTX...");

    const pptx = new PptxGenJS();

    // 设置演示文稿属性
    pptx.author = content.metadata.author || APP_CONFIG.brand.fullName;
    pptx.title = content.metadata.title;
    pptx.subject = content.metadata.subtitle || "";
    pptx.company = content.metadata.organization || "";

    // 设置布局
    if (layout.orientation === "landscape") {
      pptx.layout = "LAYOUT_WIDE";
    } else {
      pptx.layout = "LAYOUT_16x9";
    }

    // 定义母版样式
    this.defineMasterSlide(pptx, theme);

    // 封面页
    if (options.includeCover !== false) {
      this.addCoverSlide(pptx, content, theme);
    }

    // 目录页
    if (options.includeTableOfContents && content.tableOfContents?.enabled) {
      this.addTocSlide(pptx, content, theme);
    }

    // 内容页 - 按章节分组
    const slides = this.groupContentIntoSlides(content.sections);
    for (const slideContent of slides) {
      this.addContentSlide(pptx, slideContent, theme);
    }

    // 参考文献页
    if (content.references && options.includeReferences !== false) {
      this.addReferencesSlide(pptx, content.references, theme);
    }

    // 结束页
    this.addEndSlide(pptx, theme);

    // 生成 Buffer
    const data = await pptx.write({ outputType: "nodebuffer" });
    const buffer = Buffer.from(data as ArrayBuffer);

    this.logger.debug(`PPTX generated: ${buffer.length} bytes`);

    return buffer;
  }

  getMimeType(): string {
    return MIME_TYPES.PPTX;
  }

  getFileExtension(): string {
    return FILE_EXTENSIONS.PPTX;
  }

  /**
   * 定义母版幻灯片
   */
  private defineMasterSlide(pptx: PptxGenJSType, theme: ThemeConfig): void {
    pptx.defineSlideMaster({
      title: "MASTER_SLIDE",
      background: { color: this.hexToPptx(theme.colors.background) },
      objects: [
        // 页脚线条
        {
          line: {
            x: 0.5,
            y: 6.9,
            w: 9,
            h: 0,
            line: { color: this.hexToPptx(theme.colors.border), width: 0.5 },
          },
        },
        // 页码 - 使用 text 对象代替 placeholder
        {
          text: {
            options: {
              x: 9,
              y: 6.9,
              w: 0.5,
              h: 0.3,
              fontSize: 10,
              color: this.hexToPptx(theme.colors.textLight),
            },
            text: "",
          },
        },
      ],
    });
  }

  /**
   * 添加封面页
   */
  private addCoverSlide(
    pptx: PptxGenJSType,
    content: UnifiedContent,
    theme: ThemeConfig,
  ): void {
    const slide = pptx.addSlide({ masterName: "MASTER_SLIDE" });

    // 背景装饰
    slide.addShape("rect", {
      x: 0,
      y: 0,
      w: "100%",
      h: 2.5,
      fill: { color: this.hexToPptx(theme.colors.primary) },
    });

    // 标题
    slide.addText(content.metadata.title, {
      x: 0.5,
      y: 3,
      w: 9,
      h: 1.2,
      fontSize: 44,
      bold: true,
      color: this.hexToPptx(theme.colors.heading),
      align: "center",
    });

    // 副标题
    if (content.metadata.subtitle) {
      slide.addText(content.metadata.subtitle, {
        x: 0.5,
        y: 4.2,
        w: 9,
        h: 0.6,
        fontSize: 20,
        color: this.hexToPptx(theme.colors.textLight),
        align: "center",
      });
    }

    // 作者和日期
    const metaItems: string[] = [];
    if (content.metadata.author) metaItems.push(content.metadata.author);
    if (content.metadata.organization)
      metaItems.push(content.metadata.organization);
    if (content.metadata.date) {
      metaItems.push(
        new Date(content.metadata.date).toLocaleDateString("zh-CN"),
      );
    }

    if (metaItems.length > 0) {
      slide.addText(metaItems.join(" | "), {
        x: 0.5,
        y: 5.5,
        w: 9,
        h: 0.4,
        fontSize: 14,
        color: this.hexToPptx(theme.colors.textLight),
        align: "center",
      });
    }
  }

  /**
   * 添加目录页
   */
  private addTocSlide(
    pptx: PptxGenJSType,
    content: UnifiedContent,
    theme: ThemeConfig,
  ): void {
    const slide = pptx.addSlide({ masterName: "MASTER_SLIDE" });

    // 标题
    slide.addText("目录", {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.8,
      fontSize: 32,
      bold: true,
      color: this.hexToPptx(theme.colors.heading),
    });

    // 分隔线
    slide.addShape("line", {
      x: 0.5,
      y: 1.2,
      w: 2,
      h: 0,
      line: { color: this.hexToPptx(theme.colors.primary), width: 3 },
    });

    // 目录项
    const headings = content.sections.filter(
      (s) => s.type === "heading" && s.level && s.level <= 2,
    );

    const tocItems = headings.map((h) => ({
      text: h.content || "",
      options: {
        bullet: { code: "25CF" },
        fontSize: 18,
        color: this.hexToPptx(theme.colors.text),
        indentLevel: (h.level || 1) - 1,
      },
    }));

    if (tocItems.length > 0) {
      slide.addText(tocItems, {
        x: 0.5,
        y: 1.6,
        w: 9,
        h: 5,
        valign: "top",
      });
    }
  }

  /**
   * 将内容分组到幻灯片
   */
  private groupContentIntoSlides(
    sections: ContentSection[],
  ): ContentSection[][] {
    const slides: ContentSection[][] = [];
    let currentSlide: ContentSection[] = [];

    for (const section of sections) {
      // 一级标题开始新幻灯片
      if (section.type === "heading" && section.level === 1) {
        if (currentSlide.length > 0) {
          slides.push(currentSlide);
        }
        currentSlide = [section];
      }
      // 二级标题也可以开始新幻灯片（如果内容太多）
      else if (
        section.type === "heading" &&
        section.level === 2 &&
        currentSlide.length > 4
      ) {
        slides.push(currentSlide);
        currentSlide = [section];
      } else {
        currentSlide.push(section);
        // 如果内容太多，拆分到新幻灯片
        if (currentSlide.length > 6) {
          slides.push(currentSlide);
          currentSlide = [];
        }
      }
    }

    if (currentSlide.length > 0) {
      slides.push(currentSlide);
    }

    return slides;
  }

  /**
   * 添加内容幻灯片
   */
  private addContentSlide(
    pptx: PptxGenJSType,
    sections: ContentSection[],
    theme: ThemeConfig,
  ): void {
    const slide = pptx.addSlide({ masterName: "MASTER_SLIDE" });

    let yPosition = 0.5;

    for (const section of sections) {
      // 处理标题
      if (section.type === "heading") {
        if (section.level === 1 || section.level === 2) {
          // 主标题
          slide.addText(section.content || "", {
            x: 0.5,
            y: yPosition,
            w: 9,
            h: 0.8,
            fontSize: section.level === 1 ? 32 : 26,
            bold: true,
            color: this.hexToPptx(theme.colors.heading),
          });
          yPosition += 0.9;

          // 标题下划线
          slide.addShape("line", {
            x: 0.5,
            y: yPosition,
            w: 2,
            h: 0,
            line: { color: this.hexToPptx(theme.colors.primary), width: 3 },
          });
          yPosition += 0.3;
        } else {
          // 小标题
          slide.addText(section.content || "", {
            x: 0.5,
            y: yPosition,
            w: 9,
            h: 0.5,
            fontSize: 20,
            bold: true,
            color: this.hexToPptx(theme.colors.heading),
          });
          yPosition += 0.6;
        }
      }
      // 处理段落
      else if (section.type === "paragraph") {
        slide.addText(section.content || "", {
          x: 0.5,
          y: yPosition,
          w: 9,
          h: 0.8,
          fontSize: 16,
          color: this.hexToPptx(theme.colors.text),
          valign: "top",
        });
        yPosition += 0.9;
      }
      // 处理列表
      else if (section.type === "list" && section.items) {
        const listItems = section.items.map((item) => ({
          text: item.content,
          options: {
            bullet: section.ordered
              ? { type: "number" as const }
              : { code: "25CF" },
            fontSize: 16,
            color: this.hexToPptx(theme.colors.text),
          },
        }));

        slide.addText(listItems, {
          x: 0.5,
          y: yPosition,
          w: 9,
          h: Math.min(section.items.length * 0.4 + 0.2, 3),
          valign: "top",
        });
        yPosition += Math.min(section.items.length * 0.4 + 0.3, 3.1);
      }
      // 处理表格
      else if (section.type === "table") {
        const tableData: Array<
          Array<{
            text: string;
            options?: { bold?: boolean; fill?: { color: string } };
          }>
        > = [];

        if (section.headers) {
          tableData.push(
            section.headers.map((h) => ({
              text: h,
              options: {
                bold: true,
                fill: {
                  color: this.hexToPptx(theme.colors.backgroundAlt || "f5f5f5"),
                },
              },
            })),
          );
        }

        if (section.rows) {
          for (const row of section.rows) {
            tableData.push(row.cells.map((c) => ({ text: c })));
          }
        }

        if (tableData.length > 0) {
          slide.addTable(tableData, {
            x: 0.5,
            y: yPosition,
            w: 9,
            fontSize: 14,
            color: this.hexToPptx(theme.colors.text),
            border: {
              type: "solid",
              color: this.hexToPptx(theme.colors.border),
              pt: 1,
            },
          });
          yPosition += tableData.length * 0.4 + 0.3;
        }
      }
      // 处理代码块
      else if (section.type === "code") {
        slide.addText(section.content || "", {
          x: 0.5,
          y: yPosition,
          w: 9,
          h: 1.5,
          fontSize: 12,
          fontFace: theme.fonts.mono.family.split(",")[0].trim(),
          color: "d4d4d4",
          fill: { color: "1e1e1e" },
          valign: "top",
        });
        yPosition += 1.6;
      }
      // 处理引用
      else if (section.type === "quote") {
        slide.addShape("rect", {
          x: 0.5,
          y: yPosition,
          w: 0.1,
          h: 0.8,
          fill: { color: this.hexToPptx(theme.colors.primary) },
        });
        slide.addText(section.content || "", {
          x: 0.7,
          y: yPosition,
          w: 8.8,
          h: 0.8,
          fontSize: 16,
          italic: true,
          color: this.hexToPptx(theme.colors.textLight),
          valign: "middle",
        });
        yPosition += 0.9;
      }

      // 检查是否超出页面
      if (yPosition > 6) {
        break;
      }
    }
  }

  /**
   * 添加参考文献页
   */
  private addReferencesSlide(
    pptx: PptxGenJSType,
    references: Reference[],
    theme: ThemeConfig,
  ): void {
    const slide = pptx.addSlide({ masterName: "MASTER_SLIDE" });

    // 标题
    slide.addText("参考文献", {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.8,
      fontSize: 32,
      bold: true,
      color: this.hexToPptx(theme.colors.heading),
    });

    // 分隔线
    slide.addShape("line", {
      x: 0.5,
      y: 1.2,
      w: 2,
      h: 0,
      line: { color: this.hexToPptx(theme.colors.primary), width: 3 },
    });

    // 参考文献列表（只显示前10个）
    const refItems = references.slice(0, 10).map((ref) => ({
      text: `[${ref.id}] ${ref.title}${ref.url ? ` - ${ref.url}` : ""}`,
      options: {
        fontSize: 12,
        color: this.hexToPptx(theme.colors.text),
        bullet: false,
      },
    }));

    if (refItems.length > 0) {
      slide.addText(refItems, {
        x: 0.5,
        y: 1.6,
        w: 9,
        h: 5,
        valign: "top",
      });
    }

    if (references.length > 10) {
      slide.addText(`...及其他 ${references.length - 10} 条参考文献`, {
        x: 0.5,
        y: 6.5,
        w: 9,
        h: 0.3,
        fontSize: 12,
        color: this.hexToPptx(theme.colors.textLight),
        italic: true,
      });
    }
  }

  /**
   * 添加结束页
   */
  private addEndSlide(pptx: PptxGenJSType, theme: ThemeConfig): void {
    const slide = pptx.addSlide({ masterName: "MASTER_SLIDE" });

    // 背景装饰
    slide.addShape("rect", {
      x: 0,
      y: 2.5,
      w: "100%",
      h: 2.5,
      fill: { color: this.hexToPptx(theme.colors.primary) },
    });

    // 感谢文字
    slide.addText("谢谢观看", {
      x: 0.5,
      y: 3.2,
      w: 9,
      h: 1,
      fontSize: 48,
      bold: true,
      color: "FFFFFF",
      align: "center",
    });

    // Brand 标识
    slide.addText(`Powered by ${APP_CONFIG.brand.fullName}`, {
      x: 0.5,
      y: 6.5,
      w: 9,
      h: 0.3,
      fontSize: 12,
      color: this.hexToPptx(theme.colors.textLight),
      align: "center",
    });
  }

  /**
   * WYSIWYG 模式：从截图创建 PPTX
   */
  async renderFromScreenshot(
    screenshotBuffer: Buffer,
    title: string,
    options: ExportOptions,
  ): Promise<Buffer> {
    const pptx = new PptxGenJS();
    pptx.title = title;
    pptx.layout =
      options.orientation === "landscape" ? "LAYOUT_WIDE" : "LAYOUT_16x9";

    // Convert buffer to base64 data URL
    const base64 = screenshotBuffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64}`;

    // Calculate how many slides we need based on aspect ratio
    // Standard slide is 10" x 7.5" (landscape) or 7.5" x 10" (portrait)
    const slide = pptx.addSlide();
    slide.addImage({
      data: dataUrl,
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
      sizing: { type: "contain", w: "100%", h: "100%" },
    });

    const data = await pptx.write({ outputType: "nodebuffer" });
    return Buffer.from(data as ArrayBuffer);
  }

  /**
   * 转换十六进制颜色
   */
  private hexToPptx(hex: string): string {
    return hex.replace("#", "");
  }
}
