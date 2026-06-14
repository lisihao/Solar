/**
 * Slides Engine v4.0 - Parameterized Renderer
 *
 * 参数化渲染器：根据 LayoutDecision 动态计算坐标和样式
 * 取代硬编码的 12 个 renderXXX() 方法
 */

import { Injectable, Logger } from "@nestjs/common";

import type PptxGenJSType from "pptxgenjs";
type PptxInstance = InstanceType<typeof PptxGenJSType>;
type Slide = ReturnType<PptxInstance["addSlide"]>;

import {
  PageContent,
  ContentSection,
  StatContent,
  ChartContent,
  GlobalStyles,
  GENSPARK_DESIGN_SYSTEM,
} from "../checkpoint/checkpoint.types";

import {
  LayoutDecision,
  SectionPlacement,
  LayoutOptimizerSkill,
} from "../skills/layout-optimizer.skill";

// ============================================================================
// Render Context Types
// ============================================================================

/**
 * 渲染上下文
 */
export interface RenderContext {
  /** pptxgenjs Slide 实例 */
  slide: Slide;
  /** 布局决策 */
  layout: LayoutDecision;
  /** 页面内容 */
  content: PageContent;
  /** 主题样式 */
  theme: GlobalStyles;
  /** 页码 */
  pageNumber: number;
  /** 画布信息 */
  canvas: {
    width: number;
    height: number;
    margin: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
  };
}

/**
 * 位置信息
 */
export interface Position {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 渲染结果
 */
export interface RenderResult {
  success: boolean;
  renderedSections: number;
  truncatedSections: number[];
  errors: string[];
}

// ============================================================================
// Parameterized Renderer Service
// ============================================================================

@Injectable()
export class ParameterizedRendererService {
  private readonly logger = new Logger(ParameterizedRendererService.name);

  // 默认画布尺寸 (16:9, inches)
  private readonly DEFAULT_CANVAS = {
    width: 13.33,
    height: 7.5,
    margin: {
      top: 0.5,
      right: 0.5,
      bottom: 0.6,
      left: 0.5,
    },
  };

  constructor(private readonly layoutOptimizer: LayoutOptimizerSkill) {}

  /**
   * 渲染页面内容到 PPTX Slide
   */
  async render(
    pptx: PptxInstance,
    content: PageContent,
    options?: {
      theme?: GlobalStyles;
      pageNumber?: number;
    },
  ): Promise<RenderResult> {
    const theme = options?.theme || GENSPARK_DESIGN_SYSTEM;
    const pageNumber = options?.pageNumber || 1;

    this.logger.debug(
      `[render] Rendering page ${pageNumber}: "${content.title}"`,
    );

    // 1. 获取布局决策
    const layout = this.layoutOptimizer.optimize(content);

    // 2. 创建 slide
    const slide = pptx.addSlide();

    // 3. 构建渲染上下文
    const ctx: RenderContext = {
      slide,
      layout,
      content,
      theme,
      pageNumber,
      canvas: this.DEFAULT_CANVAS,
    };

    // 4. 执行渲染
    return this.renderWithContext(ctx);
  }

  /**
   * 使用预计算的布局渲染
   */
  async renderWithLayout(
    pptx: PptxInstance,
    content: PageContent,
    layout: LayoutDecision,
    options?: {
      theme?: GlobalStyles;
      pageNumber?: number;
    },
  ): Promise<RenderResult> {
    const theme = options?.theme || GENSPARK_DESIGN_SYSTEM;
    const pageNumber = options?.pageNumber || 1;

    const slide = pptx.addSlide();

    const ctx: RenderContext = {
      slide,
      layout,
      content,
      theme,
      pageNumber,
      canvas: this.DEFAULT_CANVAS,
    };

    return this.renderWithContext(ctx);
  }

  /**
   * 使用上下文执行渲染
   */
  private async renderWithContext(ctx: RenderContext): Promise<RenderResult> {
    const result: RenderResult = {
      success: true,
      renderedSections: 0,
      truncatedSections: [],
      errors: [],
    };

    try {
      // 1. 渲染背景
      this.renderBackground(ctx);

      // 2. 渲染标题区
      if (ctx.layout.titleArea.show) {
        this.renderTitleArea(ctx);
      }

      // 3. 计算网格位置
      const positions = this.calculateGridPositions(ctx);

      // 4. 渲染各 section
      for (const placement of ctx.layout.sectionPlacements) {
        const section = ctx.content.sections[placement.sectionIndex];
        if (!section) continue;

        const position = positions.get(placement.sectionIndex);
        if (!position) {
          result.errors.push(
            `No position calculated for section ${placement.sectionIndex}`,
          );
          continue;
        }

        try {
          const truncated = this.renderSection(
            ctx,
            section,
            position,
            placement,
          );
          result.renderedSections++;
          if (truncated) {
            result.truncatedSections.push(placement.sectionIndex);
          }
        } catch (error) {
          result.errors.push(
            `Failed to render section ${placement.sectionIndex}: ${error}`,
          );
        }
      }

      // 5. 渲染页脚
      if (ctx.layout.footerArea.show) {
        this.renderFooter(ctx);
      }
    } catch (error) {
      result.success = false;
      result.errors.push(`Render failed: ${error}`);
      this.logger.error(`[renderWithContext] Error:`, error);
    }

    return result;
  }

  /**
   * 渲染背景
   */
  private renderBackground(ctx: RenderContext): void {
    const { slide, theme } = ctx;

    slide.background = {
      color: this.hexToColor(theme.backgroundColor),
    };
  }

  /**
   * 渲染标题区
   */
  private renderTitleArea(ctx: RenderContext): void {
    const { slide, content, theme, layout, canvas } = ctx;
    const { titleArea } = layout;

    const titleHeight = canvas.height * titleArea.heightRatio;
    const x = canvas.margin.left;
    const y = canvas.margin.top;
    const w = canvas.width - canvas.margin.left - canvas.margin.right;

    // 主标题
    slide.addText(content.title, {
      x,
      y,
      w,
      h: titleHeight * 0.6,
      fontSize: this.calculateTitleFontSize(content.title, layout.layoutType),
      fontFace: this.getFontFace(theme.fontFamily),
      color: this.hexToColor(theme.textPrimary),
      bold: true,
      align: titleArea.alignment,
      valign: "bottom",
    });

    // 副标题
    if (content.subtitle) {
      slide.addText(content.subtitle, {
        x,
        y: y + titleHeight * 0.6,
        w,
        h: titleHeight * 0.35,
        fontSize: 18,
        fontFace: this.getFontFace(theme.fontFamily),
        color: this.hexToColor(theme.textSecondary),
        align: titleArea.alignment,
        valign: "top",
      });
    }
  }

  /**
   * 计算网格位置
   */
  private calculateGridPositions(ctx: RenderContext): Map<number, Position> {
    const positions = new Map<number, Position>();
    const { layout, canvas } = ctx;
    const { gridConfig, titleArea, footerArea, sectionPlacements } = layout;

    // 计算内容区域边界
    const contentTop =
      canvas.margin.top +
      (titleArea.show ? canvas.height * titleArea.heightRatio : 0) +
      0.2; // 间距

    const contentBottom =
      canvas.height -
      canvas.margin.bottom -
      (footerArea.show ? canvas.height * footerArea.heightRatio : 0);

    const contentLeft = canvas.margin.left;
    const contentRight = canvas.width - canvas.margin.right;

    const contentWidth = contentRight - contentLeft;
    const contentHeight = contentBottom - contentTop;

    // 计算每个 section 的位置
    for (const placement of sectionPlacements) {
      const { gridArea, sectionIndex } = placement;

      // 计算 X 位置
      let x = contentLeft;
      for (let c = 0; c < gridArea.col; c++) {
        x += contentWidth * gridConfig.columnWidths[c] + gridConfig.gap;
      }

      // 计算 Y 位置
      let y = contentTop;
      for (let r = 0; r < gridArea.row; r++) {
        y += contentHeight * gridConfig.rowHeights[r] + gridConfig.gap;
      }

      // 计算宽度（考虑 colSpan）
      let w = 0;
      for (let c = 0; c < gridArea.colSpan; c++) {
        const colIdx = gridArea.col + c;
        if (colIdx < gridConfig.columnWidths.length) {
          w += contentWidth * gridConfig.columnWidths[colIdx];
        }
      }
      w -= gridConfig.gap * 0.5; // 调整间距

      // 计算高度（考虑 rowSpan）
      let h = 0;
      for (let r = 0; r < gridArea.rowSpan; r++) {
        const rowIdx = gridArea.row + r;
        if (rowIdx < gridConfig.rowHeights.length) {
          h += contentHeight * gridConfig.rowHeights[rowIdx];
        }
      }
      h -= gridConfig.gap * 0.5;

      positions.set(sectionIndex, {
        x: Math.max(x, contentLeft),
        y: Math.max(y, contentTop),
        w: Math.max(w, 1),
        h: Math.max(h, 0.5),
      });
    }

    return positions;
  }

  /**
   * 渲染单个 section
   */
  private renderSection(
    ctx: RenderContext,
    section: ContentSection,
    position: Position,
    placement: SectionPlacement,
  ): boolean {
    const { slide, theme } = ctx;
    let truncated = false;

    // 根据渲染样式添加背景卡片
    if (placement.renderStyle === "card") {
      slide.addShape("roundRect", {
        x: position.x,
        y: position.y,
        w: position.w,
        h: position.h,
        fill: { color: this.hexToColor(theme.cardBackground) },
        line: { color: this.hexToColor(theme.borderColor), width: 1 },
      });
    } else if (placement.renderStyle === "highlight") {
      slide.addShape("rect", {
        x: position.x,
        y: position.y,
        w: position.w,
        h: position.h,
        fill: { color: this.hexToColor(theme.accentColor), transparency: 85 },
      });
    }

    // 内容区域（在卡片内部留 padding）
    const innerPadding = placement.renderStyle === "card" ? 0.15 : 0;
    const innerPos: Position = {
      x: position.x + innerPadding,
      y: position.y + innerPadding,
      w: position.w - innerPadding * 2,
      h: position.h - innerPadding * 2,
    };

    // 根据 section 类型渲染
    switch (section.type) {
      case "stat":
        truncated = this.renderStatSection(ctx, section, innerPos);
        break;
      case "list":
        truncated = this.renderListSection(ctx, section, innerPos);
        break;
      case "text":
        truncated = this.renderTextSection(ctx, section, innerPos);
        break;
      case "chart":
        truncated = this.renderChartSection(ctx, section, innerPos);
        break;
      case "quote":
        truncated = this.renderQuoteSection(ctx, section, innerPos);
        break;
      case "image":
        truncated = this.renderImageSection(ctx, section, innerPos);
        break;
      default:
        // 未知类型，作为文本渲染
        truncated = this.renderTextSection(ctx, section, innerPos);
    }

    return truncated;
  }

  /**
   * 渲染 stat 类型 section
   */
  private renderStatSection(
    ctx: RenderContext,
    section: ContentSection,
    position: Position,
  ): boolean {
    const { slide, theme } = ctx;
    const stat = section.content as StatContent;

    // 主数值
    slide.addText(stat.value, {
      x: position.x,
      y: position.y,
      w: position.w,
      h: position.h * 0.5,
      fontSize: this.calculateStatFontSize(position.w, stat.value),
      fontFace: this.getFontFace(theme.fontFamily),
      color: this.hexToColor(theme.accentColor),
      bold: true,
      align: "center",
      valign: "bottom",
    });

    // 标签
    slide.addText(stat.label, {
      x: position.x,
      y: position.y + position.h * 0.5,
      w: position.w,
      h: position.h * 0.3,
      fontSize: 14,
      fontFace: this.getFontFace(theme.fontFamily),
      color: this.hexToColor(theme.textSecondary),
      align: "center",
      valign: "top",
    });

    // 趋势/变化
    if (stat.change) {
      const trendColor =
        stat.trend === "up"
          ? "36B37E"
          : stat.trend === "down"
            ? "FF5630"
            : theme.textSecondary.replace("#", "");

      slide.addText(stat.change, {
        x: position.x,
        y: position.y + position.h * 0.8,
        w: position.w,
        h: position.h * 0.15,
        fontSize: 12,
        fontFace: this.getFontFace(theme.fontFamily),
        color: trendColor,
        align: "center",
        valign: "top",
      });
    }

    return false;
  }

  /**
   * 渲染 list 类型 section
   */
  private renderListSection(
    ctx: RenderContext,
    section: ContentSection,
    position: Position,
  ): boolean {
    const { slide, theme } = ctx;
    const items = section.content as string[];
    let truncated = false;

    // 计算每个 item 的高度
    const maxItems = Math.min(items.length, 6);
    const itemHeight = position.h / maxItems;
    const fontSize = Math.min(16, Math.max(12, itemHeight * 10));

    if (items.length > maxItems) {
      truncated = true;
    }

    // 构建 bullet list
    const bulletItems = items.slice(0, maxItems).map((text) => ({
      text: this.truncateText(text, Math.floor(position.w * 12)),
      options: {
        bullet: {
          type: "bullet" as const,
          color: this.hexToColor(theme.accentColor),
        },
        fontSize,
        color: this.hexToColor(theme.textPrimary),
        breakLine: true,
        paraSpaceAfter: 8,
      },
    }));

    slide.addText(bulletItems, {
      x: position.x,
      y: position.y,
      w: position.w,
      h: position.h,
      fontFace: this.getFontFace(theme.fontFamily),
      valign: "top",
    });

    return truncated;
  }

  /**
   * 渲染 text 类型 section
   */
  private renderTextSection(
    ctx: RenderContext,
    section: ContentSection,
    position: Position,
  ): boolean {
    const { slide, theme } = ctx;
    const text = section.content as string;
    const maxChars = Math.floor(position.w * position.h * 20);
    const truncated = text.length > maxChars;
    const displayText = truncated ? text.slice(0, maxChars - 3) + "..." : text;

    const fontSize = this.calculateTextFontSize(
      displayText.length,
      position.w * position.h,
    );

    slide.addText(displayText, {
      x: position.x,
      y: position.y,
      w: position.w,
      h: position.h,
      fontSize,
      fontFace: this.getFontFace(theme.fontFamily),
      color: this.hexToColor(theme.textPrimary),
      valign: "top",
    });

    return truncated;
  }

  /**
   * 渲染 chart 类型 section
   */
  private renderChartSection(
    ctx: RenderContext,
    section: ContentSection,
    position: Position,
  ): boolean {
    const { slide, theme } = ctx;
    const chartData = section.content as ChartContent;

    // 图表标题
    if (chartData.title) {
      slide.addText(chartData.title, {
        x: position.x,
        y: position.y,
        w: position.w,
        h: 0.4,
        fontSize: 14,
        fontFace: this.getFontFace(theme.fontFamily),
        color: this.hexToColor(theme.textPrimary),
        bold: true,
        align: "center",
      });
    }

    // 准备图表数据
    const chartY = chartData.title ? position.y + 0.45 : position.y;
    const chartH = chartData.title ? position.h - 0.45 : position.h;

    // 提取数据
    const labels: string[] = [];
    const values: number[] = [];

    for (const item of chartData.data) {
      const name = item.name || item.label || String(Object.keys(item)[0]);
      const value =
        item.value !== undefined
          ? Number(item.value)
          : Number(Object.values(item)[0]);
      labels.push(String(name));
      values.push(isNaN(value) ? 0 : value);
    }

    // 根据图表类型渲染
    try {
      const chartConfig = {
        x: position.x,
        y: chartY,
        w: position.w,
        h: chartH,
        chartColors: [
          this.hexToColor(theme.accentColor),
          this.hexToColor(theme.secondaryAccent),
          "36B37E",
          "FF8B00",
          "6554C0",
        ],
        showLegend: chartData.data.length <= 5,
        legendPos: "b" as const,
      };

      switch (chartData.type) {
        case "bar":
          slide.addChart("bar", [{ name: "", labels, values }], chartConfig);
          break;
        case "line":
          slide.addChart("line", [{ name: "", labels, values }], chartConfig);
          break;
        case "pie":
          slide.addChart("pie", [{ name: "", labels, values }], chartConfig);
          break;
        default:
          // 默认使用柱状图
          slide.addChart("bar", [{ name: "", labels, values }], chartConfig);
      }
    } catch (error) {
      // 图表渲染失败，使用文本替代
      this.logger.warn(`[renderChartSection] Chart render failed: ${error}`);
      slide.addText(`[图表: ${chartData.title || chartData.type}]`, {
        x: position.x,
        y: chartY,
        w: position.w,
        h: chartH,
        fontSize: 14,
        fontFace: this.getFontFace(theme.fontFamily),
        color: this.hexToColor(theme.textSecondary),
        align: "center",
        valign: "middle",
      });
    }

    return false;
  }

  /**
   * 渲染 quote 类型 section
   */
  private renderQuoteSection(
    ctx: RenderContext,
    section: ContentSection,
    position: Position,
  ): boolean {
    const { slide, theme } = ctx;
    const quote = section.content as string;

    // 引号
    slide.addText("\u201C", {
      x: position.x,
      y: position.y,
      w: 0.5,
      h: 0.8,
      fontSize: 60,
      fontFace: "Georgia",
      color: this.hexToColor(theme.accentColor),
      bold: true,
    });

    // 引用文本
    slide.addText(quote, {
      x: position.x + 0.3,
      y: position.y + 0.3,
      w: position.w - 0.3,
      h: position.h - 0.3,
      fontSize: 18,
      fontFace: this.getFontFace(theme.fontFamily),
      color: this.hexToColor(theme.textPrimary),
      italic: true,
      valign: "middle",
    });

    return false;
  }

  /**
   * 渲染 image 类型 section
   */
  private renderImageSection(
    ctx: RenderContext,
    _section: ContentSection,
    position: Position,
  ): boolean {
    const { slide, theme } = ctx;

    // 图片占位符
    slide.addShape("rect", {
      x: position.x,
      y: position.y,
      w: position.w,
      h: position.h,
      fill: { color: this.hexToColor(theme.cardBackground) },
      line: { color: this.hexToColor(theme.borderColor), width: 1 },
    });

    slide.addText("[Image]", {
      x: position.x,
      y: position.y,
      w: position.w,
      h: position.h,
      fontSize: 14,
      fontFace: this.getFontFace(theme.fontFamily),
      color: this.hexToColor(theme.textSecondary),
      align: "center",
      valign: "middle",
    });

    return false;
  }

  /**
   * 渲染页脚
   */
  private renderFooter(ctx: RenderContext): void {
    const { slide, content, theme, pageNumber, canvas, layout } = ctx;

    const footerY =
      canvas.height -
      canvas.margin.bottom -
      canvas.height * layout.footerArea.heightRatio;

    // 页脚文本
    if (content.footer) {
      slide.addText(content.footer, {
        x: canvas.margin.left,
        y: footerY,
        w: canvas.width / 2,
        h: canvas.height * layout.footerArea.heightRatio,
        fontSize: 10,
        fontFace: this.getFontFace(theme.fontFamily),
        color: this.hexToColor(theme.textSecondary),
        valign: "middle",
      });
    }

    // 页码
    slide.addText(String(pageNumber), {
      x: canvas.width - canvas.margin.right - 0.5,
      y: footerY,
      w: 0.5,
      h: canvas.height * layout.footerArea.heightRatio,
      fontSize: 12,
      fontFace: "Arial",
      color: this.hexToColor(theme.textSecondary),
      align: "right",
      valign: "middle",
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * 计算标题字体大小
   */
  private calculateTitleFontSize(title: string, layoutType: string): number {
    if (layoutType === "single-focus") {
      return 48;
    }

    const length = title.length;
    if (length < 15) return 36;
    if (length < 25) return 32;
    if (length < 35) return 28;
    return 24;
  }

  /**
   * 计算 stat 数值字体大小
   */
  private calculateStatFontSize(width: number, value: string): number {
    const baseSize = Math.min(48, width * 15);
    const lengthFactor = Math.max(0.5, 1 - (value.length - 3) * 0.08);
    return Math.round(baseSize * lengthFactor);
  }

  /**
   * 计算文本字体大小
   */
  private calculateTextFontSize(charCount: number, area: number): number {
    const density = charCount / (area * 100);
    if (density < 1) return 18;
    if (density < 2) return 16;
    if (density < 3) return 14;
    return 12;
  }

  /**
   * 截断文本
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + "...";
  }

  /**
   * Hex 颜色转 PPTX 颜色
   */
  private hexToColor(hex: string): string {
    return hex.replace("#", "").toUpperCase();
  }

  /**
   * 获取兼容字体
   */
  private getFontFace(fontFamily: string): string {
    if (fontFamily.includes("Noto Sans SC")) {
      return "Microsoft YaHei";
    }
    if (fontFamily.includes("Inter")) {
      return "Arial";
    }
    return "Microsoft YaHei";
  }
}
