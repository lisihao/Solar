/**
 * PPT Export Service - 统一导出服务
 *
 * 渲染架构 v3.1 (归一重构)
 *
 * 核心原则：
 * - 单一渲染路径：HTML 模板 → Puppeteer 截图 → PPTX/PDF/PNG
 * - 确保与预览 100% 一致
 *
 * 功能：
 * 1. PPTX 导出 - HTML 截图嵌入
 * 2. PDF 导出 - Puppeteer 渲染
 * 3. PNG 导出 - 逐页截图 + ZIP
 *
 * @see slides/ARCHITECTURE.md 统一架构文档
 */

import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { PuppeteerPoolService } from "../../../../../common/browser/puppeteer-pool.service";
import { APP_CONFIG } from "../../../../../common/config/app.config";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PptxGenJS = require("pptxgenjs");
import {
  PPTDocument,
  PPTTheme,
  GeneratedSlide,
  GeneratedSlideImage,
} from "../types/slides.types";
import {
  PageContent,
  GlobalStyles,
  GENSPARK_DESIGN_SYSTEM,
} from "../checkpoint/checkpoint.types";
import { ParameterizedRendererService } from "./parameterized-renderer.service";
import {
  LayoutOptimizerSkill,
  LayoutDecision,
} from "../skills/layout-optimizer.skill";

// pptxgenjs 类型
import type PptxGenJSType from "pptxgenjs";
type PptxInstance = InstanceType<typeof PptxGenJSType>;
type Slide = ReturnType<PptxInstance["addSlide"]>;

// 导出结果
export interface PPTXExportResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  slideCount: number;
  fileSize: number;
}

// PDF 导出结果
export interface PDFExportResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  slideCount: number;
  fileSize: number;
}

// PNG 导出结果（ZIP 包含多个图片）
export interface PNGExportResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  slideCount: number;
  fileSize: number;
}

// 主题到 PPTX 的映射配置
interface ThemePPTXConfig {
  masterSlide: {
    background: { color?: string; gradient?: GradientConfig };
  };
  titleStyle: TextStyle;
  subtitleStyle: TextStyle;
  bodyStyle: TextStyle;
  bulletStyle: TextStyle;
  accentColor: string;
  chartColors: string[];
}

interface GradientConfig {
  type: "linear" | "radial";
  stops: Array<{ color: string; position: number }>;
  angle?: number;
}

interface TextStyle {
  fontFace: string;
  fontSize: number;
  color: string;
  bold?: boolean;
}

@Injectable()
export class SlidesExportService {
  private readonly logger = new Logger(SlidesExportService.name);

  constructor(
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => ParameterizedRendererService))
    private readonly parameterizedRenderer: ParameterizedRendererService,
    @Inject(forwardRef(() => LayoutOptimizerSkill))
    private readonly layoutOptimizer: LayoutOptimizerSkill,
    private readonly browserPool: PuppeteerPoolService,
  ) {
    this.logger.debug(`[SlidesExport] Service initialized`);
  }

  /**
   * 导出 PPT 文档为 PPTX
   *
   * 支持两种模式：
   * 1. 同源模式（默认）：使用 HTML 截图，确保与预览 100% 一致但不可编辑
   * 2. 可编辑模式：使用 pptxgenjs 原生渲染，文本可编辑但样式可能有差异
   *
   * @param document PPT 文档
   * @param options.editable 是否导出可编辑版本（默认 false，同源优先）
   */
  async exportToPPTX(
    document: PPTDocument,
    options?: { editable?: boolean },
  ): Promise<PPTXExportResult> {
    // v4.0: 默认改为同源模式，确保导出和预览 100% 一致
    const editable = options?.editable ?? false;

    this.logger.log(
      `[exportToPPTX] Starting export for: ${document.title}, ${document.slides.length} slides, editable=${editable}`,
    );

    const startTime = Date.now();
    const pptx = new PptxGenJS();

    // 1. 设置文档属性
    this.setDocumentProperties(pptx, document);

    // 检查是否有 HTML（同源导出的前提）- 必须是非空字符串
    const slidesWithHtml = document.slides.filter(
      (slide) => slide.html && slide.html.trim().length > 0,
    );
    const hasHtml = slidesWithHtml.length > 0;

    this.logger.log(
      `[exportToPPTX] HTML check: ${slidesWithHtml.length}/${document.slides.length} slides have HTML, editable=${editable}`,
    );

    if (!editable && hasHtml) {
      // 同源导出：使用 HTML 截图作为每页背景，确保与预览 100% 一致
      this.logger.log(
        `[exportToPPTX] Using HTML screenshots for same-source export`,
      );
      await this.renderSlidesFromHtml(pptx, document);
    } else {
      // 可编辑导出或无 HTML：使用 pptxgenjs 原生渲染
      if (!hasHtml) {
        this.logger.warn(
          `[exportToPPTX] No HTML found in slides, falling back to native rendering`,
        );
      }
      this.logger.log(
        `[exportToPPTX] Using native pptxgenjs rendering for editable text`,
      );
      const themeConfig = this.getThemePPTXConfig(document.theme);
      for (const slideData of document.slides) {
        await this.renderSlide(pptx, slideData, document.theme, themeConfig);
      }
    }

    // 生成文件
    const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

    const duration = Date.now() - startTime;
    this.logger.log(
      `[exportToPPTX] Completed in ${duration}ms, size: ${buffer.length} bytes`,
    );

    const suffix = editable ? "_editable" : "";
    return {
      buffer,
      filename: `${document.title}${suffix}.pptx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      slideCount: document.slides.length,
      fileSize: buffer.length,
    };
  }

  /**
   * v4.0: 使用内容驱动架构导出 PPTX（可编辑版本）
   *
   * 使用 ContentAnalyzer + LayoutOptimizer + ParameterizedRenderer 管线
   * 动态计算布局和坐标，生成原生可编辑的 PPTX
   *
   * ⚠️ 注意：此方法生成的 PPTX 可能与 HTML 预览有细微差异
   * 如需 100% 同源一致，请使用 exportToPPTX + HTML 截图模式
   *
   * @param pages PageContent 数组
   * @param options 导出选项
   */
  async exportFromPageContentEditable(
    pages: PageContent[],
    options: {
      title: string;
      subtitle?: string;
      theme?: GlobalStyles;
    },
  ): Promise<PPTXExportResult> {
    const theme = options.theme || GENSPARK_DESIGN_SYSTEM;

    this.logger.log(
      `[exportFromPageContent] Starting v4.0 export for: ${options.title}, ${pages.length} pages`,
    );

    const startTime = Date.now();
    const pptx = new PptxGenJS();

    // 1. 设置文档属性
    pptx.title = options.title;
    pptx.subject = options.subtitle || options.title;
    pptx.author = `${APP_CONFIG.brand.fullName} AI Office`;
    pptx.company = APP_CONFIG.brand.name;
    pptx.defineLayout({
      name: "LAYOUT_WIDE",
      width: 13.33,
      height: 7.5,
    });
    pptx.layout = "LAYOUT_WIDE";

    // 2. 使用 ParameterizedRenderer 渲染每页
    const renderResults: {
      pageNumber: number;
      success: boolean;
      errors: string[];
    }[] = [];

    for (let i = 0; i < pages.length; i++) {
      const pageContent = pages[i];
      const pageNumber = i + 1;

      try {
        // 使用 ParameterizedRenderer 渲染
        const result = await this.parameterizedRenderer.render(
          pptx,
          pageContent,
          {
            theme,
            pageNumber,
          },
        );

        renderResults.push({
          pageNumber,
          success: result.success,
          errors: result.errors,
        });

        if (!result.success) {
          this.logger.warn(
            `[exportFromPageContent] Page ${pageNumber} had errors: ${result.errors.join(", ")}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `[exportFromPageContent] Failed to render page ${pageNumber}:`,
          error,
        );
        renderResults.push({
          pageNumber,
          success: false,
          errors: [String(error)],
        });
      }
    }

    // 3. 生成文件
    const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

    const duration = Date.now() - startTime;
    const successCount = renderResults.filter((r) => r.success).length;
    this.logger.log(
      `[exportFromPageContent] Completed in ${duration}ms, ${successCount}/${pages.length} pages successful, size: ${buffer.length} bytes`,
    );

    return {
      buffer,
      filename: `${options.title}_v4.pptx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      slideCount: pages.length,
      fileSize: buffer.length,
    };
  }

  /**
   * v4.0: 获取页面的布局决策
   *
   * 用于预览或调试，返回 LayoutOptimizer 的决策结果
   * 同一个 LayoutDecision 应同时用于 HTML 渲染和 PPTX 导出，确保同源
   */
  getLayoutDecision(pageContent: PageContent): LayoutDecision {
    return this.layoutOptimizer.optimize(pageContent);
  }

  /**
   * v4.0: 同源导出 - 从 HTML 字符串数组导出 PPTX
   *
   * 此方法确保预览和导出 100% 一致：
   * 1. 使用 LayoutDecision 生成 HTML（预览时已完成）
   * 2. 将相同的 HTML 截图嵌入 PPTX
   *
   * @param htmlSlides HTML 字符串数组
   * @param options 导出选项
   */
  async exportFromHtmlSlides(
    htmlSlides: string[],
    options: {
      title: string;
      subtitle?: string;
    },
  ): Promise<PPTXExportResult> {
    this.logger.log(
      `[exportFromHtmlSlides] Starting 同源 export for: ${options.title}, ${htmlSlides.length} slides`,
    );

    const startTime = Date.now();
    const pptx = new PptxGenJS();

    // 设置文档属性
    pptx.title = options.title;
    pptx.subject = options.subtitle || options.title;
    pptx.author = `${APP_CONFIG.brand.fullName} AI Office`;
    pptx.company = APP_CONFIG.brand.name;
    pptx.defineLayout({
      name: "LAYOUT_WIDE",
      width: 13.33,
      height: 7.5,
    });
    pptx.layout = "LAYOUT_WIDE";

    // 使用 puppeteer 截图每个 HTML 并嵌入
    await this.renderHtmlSlidesToPptx(pptx, htmlSlides);

    // 生成文件
    const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

    const duration = Date.now() - startTime;
    this.logger.log(
      `[exportFromHtmlSlides] Completed in ${duration}ms, size: ${buffer.length} bytes`,
    );

    return {
      buffer,
      filename: `${options.title}.pptx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      slideCount: htmlSlides.length,
      fileSize: buffer.length,
    };
  }

  /**
   * 将 HTML 字符串数组渲染为 PPTX 幻灯片
   */
  private async renderHtmlSlidesToPptx(
    pptx: PptxInstance,
    htmlSlides: string[],
  ): Promise<void> {
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport({
        width: 1280,
        height: 720,
        deviceScaleFactor: 2,
      });

      for (const html of htmlSlides) {
        const slide = pptx.addSlide();

        // 包装 HTML 以确保正确渲染
        const wrappedHtml = this.wrapV3HtmlForScreenshot(html);

        await page.setContent(wrappedHtml, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });

        // 等待字体加载
        await page.evaluate(() => document.fonts.ready);
        await new Promise((resolve) => setTimeout(resolve, 200));

        // 截图
        const screenshot = await page.screenshot({
          type: "png",
          encoding: "base64",
        });

        // 嵌入为背景图
        slide.background = {
          data: `image/png;base64,${screenshot}`,
        };
      }
    } finally {
      await page.close();
    }
  }

  /**
   * 使用 HTML 截图渲染 PPTX 幻灯片（同源导出）
   * 每页幻灯片截图后作为背景图嵌入，确保与预览 100% 一致
   */
  private async renderSlidesFromHtml(
    pptx: PptxInstance,
    document: PPTDocument,
  ): Promise<void> {
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();

    try {
      // 设置页面大小为 16:9 比例 (1280x720)
      await page.setViewport({
        width: 1280,
        height: 720,
        deviceScaleFactor: 2, // 高清截图
      });

      for (const slideData of document.slides) {
        const slide = pptx.addSlide();

        if (slideData.html) {
          // 使用 HTML 截图
          const slideHtml = this.wrapV3HtmlForScreenshot(slideData.html);

          await page.setContent(slideHtml, {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          });

          // 等待渲染完成
          await page.evaluate(
            () => new Promise((resolve) => setTimeout(resolve, 300)),
          );

          const screenshot = await page.screenshot({
            type: "png",
            fullPage: false,
            encoding: "base64",
          });

          // 将截图作为背景图
          slide.background = {
            data: `data:image/png;base64,${screenshot}`,
          };
        } else {
          // 降级：使用传统渲染
          const themeConfig = this.getThemePPTXConfig(document.theme);
          await this.applyBackground(
            slide,
            slideData,
            document.theme,
            themeConfig,
          );
          await this.renderByLayout(
            slide,
            slideData,
            document.theme,
            themeConfig,
          );
        }
      }
    } finally {
      await page.close();
    }
  }

  /**
   * 导出 PPT 文档为 PDF
   * 使用 Puppeteer 将幻灯片渲染为 PDF
   *
   * 同源导出: 优先使用 生成的 HTML，确保与预览一致
   */
  async exportToPDF(document: PPTDocument): Promise<PDFExportResult> {
    this.logger.log(
      `[exportToPDF] Starting PDF export for: ${document.title}, ${document.slides.length} slides`,
    );

    const startTime = Date.now();

    // 检查是否有 HTML (同源导出)
    const hasV3Html = document.slides.some((slide) => slide.html);

    // 使用共享浏览器渲染 PDF
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();

    try {
      // 设置页面大小为 16:9 比例
      await page.setViewport({
        width: 1280,
        height: 720,
        deviceScaleFactor: 2, // 高清
      });

      if (hasV3Html) {
        // 同源导出: 使用 生成的 HTML
        this.logger.log(`[exportToPDF] Using HTML for same-source export`);
        const combinedHtml = this.combineV3SlidesForPdf(document);

        await page.setContent(combinedHtml, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
      } else {
        // 降级: 使用传统方式生成 HTML
        this.logger.log(`[exportToPDF] Fallback to legacy HTML generation`);
        const slidesHtml = this.generateSlidesHtml(document);

        await page.setContent(slidesHtml, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
      }

      // 生成 PDF
      const buffer = await page.pdf({
        width: "1280px",
        height: "720px",
        landscape: true, // 横向
        printBackground: true, // 打印背景
        margin: {
          top: "0",
          right: "0",
          bottom: "0",
          left: "0",
        },
        preferCSSPageSize: true,
      });

      const duration = Date.now() - startTime;
      this.logger.log(
        `[exportToPDF] Completed in ${duration}ms, size: ${buffer.length} bytes`,
      );

      return {
        buffer: Buffer.from(buffer),
        filename: `${document.title}.pdf`,
        mimeType: "application/pdf",
        slideCount: document.slides.length,
        fileSize: buffer.length,
      };
    } finally {
      await page.close();
    }
  }

  /**
   * 组合 HTML 幻灯片为 PDF 格式
   * 每页幻灯片一页 PDF
   */
  private combineV3SlidesForPdf(document: PPTDocument): string {
    const slides = document.slides;

    // 为每页幻灯片创建一个页面
    const slidesContent = slides
      .map((slide, index) => {
        if (slide.html) {
          // 使用 生成的 HTML，包装在 page 容器中
          // 需要提取 body 内容（去除 html/head/body 标签）
          const htmlContent = this.extractBodyContent(slide.html);
          return `
            <div class="slide-page" data-slide="${index + 1}">
              ${htmlContent}
            </div>
          `;
        }
        // 降级到传统渲染
        return `
          <div class="slide-page" data-slide="${index + 1}">
            ${this.generateSlideHtmlContent(slide, document.theme, index)}
          </div>
        `;
      })
      .join("\n");

    // 注意：不使用 Google Fonts 外部链接，避免网络超时
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    @page {
      size: 1280px 720px;
      margin: 0;
    }

    html, body {
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      font-family: "Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
    }

    .slide-page {
      width: 1280px;
      height: 720px;
      page-break-after: always;
      page-break-inside: avoid;
      position: relative;
      overflow: hidden;
      background: #0F172A;
    }

    .slide-page:last-child {
      page-break-after: auto;
    }

    /* 确保 HTML 样式正确应用 */
    .slide-page > div,
    .slide-page > section {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  ${slidesContent}
</body>
</html>
    `;
  }

  /**
   * 从完整 HTML 中提取 body 内容
   */
  private extractBodyContent(html: string): string {
    // 匹配 <body> 和 </body> 之间的内容
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      return bodyMatch[1];
    }

    // 如果没有 body 标签，尝试提取 style 和 body 内容
    // 移除 html, head, doctype 等标签
    const content = html
      .replace(/<!DOCTYPE[^>]*>/gi, "")
      .replace(/<html[^>]*>/gi, "")
      .replace(/<\/html>/gi, "")
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
      .replace(/<body[^>]*>/gi, "")
      .replace(/<\/body>/gi, "");

    // 保留 style 标签（如果有的话，在 head 中已被移除，这里是处理内联的情况）
    return content.trim();
  }

  /**
   * 包装 HTML 用于截图
   * 确保完整的 HTML 结构和样式
   */
  private wrapV3HtmlForScreenshot(html: string): string {
    // 如果已经是完整的 HTML 文档，直接返回
    if (html.includes("<!DOCTYPE") || html.includes("<html")) {
      return html;
    }

    // 否则包装在完整的 HTML 结构中
    // 注意：不使用 Google Fonts 外部链接，避免网络超时
    // 使用系统字体作为后备
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 1280px;
      height: 720px;
      overflow: hidden;
      background: #0F172A;
      font-family: "Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
    }
  </style>
</head>
<body>
  ${html}
</body>
</html>
    `;
  }

  /**
   * 导出 PPT 文档为 PNG 图片（ZIP 压缩包）
   *
   * 同源导出: 优先使用 生成的 HTML，确保与预览一致
   */
  async exportToPNG(document: PPTDocument): Promise<PNGExportResult> {
    this.logger.log(
      `[exportToPNG] Starting PNG export for: ${document.title}, ${document.slides.length} slides`,
    );

    const startTime = Date.now();
    const archiver = await import("archiver");

    // 检查是否有 HTML (同源导出)
    const hasV3Html = document.slides.some((slide) => slide.html);
    if (hasV3Html) {
      this.logger.log(`[exportToPNG] Using HTML for same-source export`);
    }

    // 使用共享浏览器渲染每页幻灯片
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();

    try {
      // 设置页面大小为 16:9 比例 (1280x720 与预览一致)
      await page.setViewport({
        width: 1280,
        height: 720,
        deviceScaleFactor: 2, // 高清导出
      });

      // 收集所有截图
      const screenshots: { name: string; data: Buffer }[] = [];

      for (let i = 0; i < document.slides.length; i++) {
        const slide = document.slides[i];

        // 同源导出: 优先使用 HTML
        let slideHtml: string;
        if (slide.html) {
          slideHtml = this.wrapV3HtmlForScreenshot(slide.html);
        } else {
          slideHtml = this.generateSingleSlideHtml(document, i);
        }

        await page.setContent(slideHtml, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });

        const screenshot = await page.screenshot({
          type: "png",
          fullPage: false,
          encoding: "binary",
        });

        screenshots.push({
          name: `slide_${String(i + 1).padStart(2, "0")}.png`,
          data: screenshot as Buffer,
        });
      }

      // 创建 ZIP 压缩包
      const archive = archiver.default("zip", { zlib: { level: 9 } });
      const chunks: Buffer[] = [];

      archive.on("data", (chunk: Buffer) => chunks.push(chunk));

      // 添加所有截图到压缩包
      for (const screenshot of screenshots) {
        archive.append(screenshot.data, { name: screenshot.name });
      }

      await archive.finalize();

      const buffer = Buffer.concat(chunks);

      const duration = Date.now() - startTime;
      this.logger.log(
        `[exportToPNG] Completed in ${duration}ms, ${screenshots.length} images, size: ${buffer.length} bytes`,
      );

      return {
        buffer,
        filename: `${document.title}_slides.zip`,
        mimeType: "application/zip",
        slideCount: document.slides.length,
        fileSize: buffer.length,
      };
    } finally {
      await page.close();
    }
  }

  /**
   * 生成幻灯片的完整 HTML（用于 PDF 导出）
   */
  private generateSlidesHtml(document: PPTDocument): string {
    const theme = document.theme;
    const slides = document.slides;

    const slidesContent = slides
      .map((slide, index) => this.generateSlideHtmlContent(slide, theme, index))
      .join("\n");

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: landscape; margin: 0; }

    body {
      font-family: ${theme.fonts.body};
      background: ${theme.colors.background};
    }

    .slide {
      width: 100vw;
      height: 100vh;
      padding: 60px;
      page-break-after: always;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .slide:last-child {
      page-break-after: auto;
    }

    .slide-title {
      font-family: ${theme.fonts.heading};
      font-size: 48px;
      font-weight: bold;
      color: ${theme.colors.text};
      margin-bottom: 30px;
    }

    .slide-subtitle {
      font-size: 24px;
      color: ${theme.colors.textLight};
      margin-bottom: 20px;
    }

    .slide-content {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .bullet-list {
      list-style: none;
      padding: 0;
    }

    .bullet-list li {
      font-size: 22px;
      color: ${theme.colors.text};
      padding: 12px 0;
      padding-left: 30px;
      position: relative;
    }

    .bullet-list li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${theme.colors.accent};
    }

    .title-slide {
      justify-content: center;
      align-items: center;
      text-align: center;
      background: linear-gradient(135deg, ${theme.colors.primary} 0%, ${theme.colors.secondary} 100%);
    }

    .title-slide .slide-title {
      font-size: 64px;
      color: white;
    }

    .title-slide .slide-subtitle {
      font-size: 28px;
      color: rgba(255,255,255,0.9);
    }

    .page-number {
      position: absolute;
      bottom: 20px;
      right: 40px;
      font-size: 14px;
      color: ${theme.colors.textMuted};
    }
  </style>
</head>
<body>
  ${slidesContent}
</body>
</html>
    `;
  }

  /**
   * 生成单页幻灯片的 HTML（用于 PNG 导出）
   */
  private generateSingleSlideHtml(
    document: PPTDocument,
    slideIndex: number,
  ): string {
    const theme = document.theme;
    const slide = document.slides[slideIndex];

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: ${theme.fonts.body};
      background: ${theme.colors.background};
      width: 1920px;
      height: 1080px;
      overflow: hidden;
    }

    .slide {
      width: 100%;
      height: 100%;
      padding: 60px;
      position: relative;
      display: flex;
      flex-direction: column;
    }

    .slide-title {
      font-family: ${theme.fonts.heading};
      font-size: 64px;
      font-weight: bold;
      color: ${theme.colors.text};
      margin-bottom: 40px;
    }

    .slide-subtitle {
      font-size: 32px;
      color: ${theme.colors.textLight};
      margin-bottom: 30px;
    }

    .slide-content {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .bullet-list {
      list-style: none;
      padding: 0;
    }

    .bullet-list li {
      font-size: 28px;
      color: ${theme.colors.text};
      padding: 16px 0;
      padding-left: 40px;
      position: relative;
    }

    .bullet-list li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: ${theme.colors.accent};
    }

    .title-slide {
      justify-content: center;
      align-items: center;
      text-align: center;
      background: linear-gradient(135deg, ${theme.colors.primary} 0%, ${theme.colors.secondary} 100%);
    }

    .title-slide .slide-title {
      font-size: 80px;
      color: white;
    }

    .title-slide .slide-subtitle {
      font-size: 36px;
      color: rgba(255,255,255,0.9);
    }

    .page-number {
      position: absolute;
      bottom: 30px;
      right: 50px;
      font-size: 18px;
      color: ${theme.colors.textMuted};
    }
  </style>
</head>
<body>
  ${this.generateSlideHtmlContent(slide, theme, slideIndex)}
</body>
</html>
    `;
  }

  /**
   * 生成单页幻灯片的 HTML 内容
   */
  private generateSlideHtmlContent(
    slide: GeneratedSlide,
    theme: PPTTheme,
    index: number,
  ): string {
    const purpose = slide.spec.purpose;
    const content = slide.content;
    const isTitle = purpose === "title" || purpose === "closing";

    // 标题页特殊处理
    if (isTitle) {
      return `
        <div class="slide title-slide">
          <div class="slide-title">${this.escapeHtml(content.title)}</div>
          ${content.subtitle ? `<div class="slide-subtitle">${this.escapeHtml(content.subtitle)}</div>` : ""}
        </div>
      `;
    }

    // 普通内容页
    let bulletHtml = "";
    if (content.bulletPoints && content.bulletPoints.length > 0) {
      bulletHtml = `
        <ul class="bullet-list">
          ${content.bulletPoints.map((point) => `<li>${this.escapeHtml(point)}</li>`).join("")}
        </ul>
      `;
    }

    return `
      <div class="slide">
        <div class="slide-title">${this.escapeHtml(content.title)}</div>
        ${content.subtitle ? `<div class="slide-subtitle">${this.escapeHtml(content.subtitle)}</div>` : ""}
        <div class="slide-content">
          ${bulletHtml}
          ${content.bodyText ? `<p style="font-size: 20px; color: ${theme.colors.textLight}; margin-top: 20px;">${this.escapeHtml(content.bodyText)}</p>` : ""}
        </div>
        <div class="page-number">${index + 1}</div>
      </div>
    `;
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * 设置文档属性
   */
  private setDocumentProperties(
    pptx: PptxInstance,
    document: PPTDocument,
  ): void {
    pptx.title = document.title;
    pptx.subject = document.subtitle || document.title;
    pptx.author = `${APP_CONFIG.brand.fullName} AI Office`;
    pptx.company = APP_CONFIG.brand.name;

    // 设置幻灯片尺寸 (16:9)
    pptx.defineLayout({
      name: "LAYOUT_WIDE",
      width: 13.33,
      height: 7.5,
    });
    pptx.layout = "LAYOUT_WIDE";
  }

  /**
   * 获取主题的 PPTX 配置
   */
  private getThemePPTXConfig(theme: PPTTheme): ThemePPTXConfig {
    // 判断是否为深色主题
    const isDarkTheme = this.isDarkColor(theme.colors.background);

    // 选择合适的字体 - Windows 和 Mac 兼容
    const headingFont = this.getCompatibleFont(theme.fonts.heading, "heading");
    const bodyFont = this.getCompatibleFont(theme.fonts.body, "body");

    return {
      masterSlide: {
        background: this.getBackgroundConfig(theme),
      },
      titleStyle: {
        fontFace: headingFont,
        fontSize: 44,
        color: this.hexToColor(
          isDarkTheme ? theme.colors.textLight : theme.colors.text,
        ),
        bold: true,
      },
      subtitleStyle: {
        fontFace: headingFont,
        fontSize: 24,
        color: this.hexToColor(theme.colors.textLight),
      },
      bodyStyle: {
        fontFace: bodyFont,
        fontSize: 18,
        color: this.hexToColor(theme.colors.text),
      },
      bulletStyle: {
        fontFace: bodyFont,
        fontSize: 20,
        color: this.hexToColor(theme.colors.text),
      },
      accentColor: this.hexToColor(theme.colors.accent),
      chartColors: [
        this.hexToColor(theme.colors.primary),
        this.hexToColor(theme.colors.secondary),
        this.hexToColor(theme.colors.accent),
        "36B37E",
        "FF8B00",
        "6554C0",
      ],
    };
  }

  /**
   * 获取背景配置
   */
  private getBackgroundConfig(
    theme: PPTTheme,
  ): ThemePPTXConfig["masterSlide"]["background"] {
    const bgColor = this.hexToColor(theme.colors.background);
    const bgSecondary = this.hexToColor(theme.colors.backgroundSecondary);

    // 对于深色主题，使用渐变
    if (this.isDarkColor(theme.colors.background)) {
      return {
        gradient: {
          type: "linear",
          stops: [
            { color: bgColor, position: 0 },
            { color: bgSecondary, position: 100 },
          ],
          angle: 45,
        },
      };
    }

    return { color: bgColor };
  }

  /**
   * 渲染单页幻灯片
   */
  private async renderSlide(
    pptx: PptxInstance,
    slideData: GeneratedSlide,
    theme: PPTTheme,
    config: ThemePPTXConfig,
  ): Promise<void> {
    const slide = pptx.addSlide();

    // 1. 设置背景
    await this.applyBackground(slide, slideData, theme, config);

    // 2. 根据布局类型渲染内容
    await this.renderByLayout(slide, slideData, theme, config);

    // 3. 添加页码 (除标题页外)
    if (
      slideData.spec.purpose !== "title" &&
      slideData.spec.purpose !== "closing"
    ) {
      this.addPageNumber(slide, slideData.index + 1, theme);
    }
  }

  /**
   * 应用背景
   */
  private async applyBackground(
    slide: Slide,
    slideData: GeneratedSlide,
    theme: PPTTheme,
    _config: ThemePPTXConfig,
  ): Promise<void> {
    const bgDecision = slideData.spec.backgroundDecision;

    // 检查是否有背景图片
    const bgImage = slideData.images.find(
      (img) => img.position === "background",
    );

    if (bgImage?.url) {
      // 使用 AI 生成的背景图片
      try {
        const imageBuffer = await this.downloadImage(bgImage.url);
        if (imageBuffer) {
          slide.background = {
            data: `data:image/png;base64,${imageBuffer.toString("base64")}`,
          };
          return;
        }
      } catch (error) {
        this.logger.warn(
          `[applyBackground] Failed to download background image: ${bgImage.url}`,
        );
      }
    }

    // 根据背景决策类型设置
    if (bgDecision.type === "gradient" && bgDecision.colors) {
      const primary = this.hexToColor(bgDecision.colors.primary);

      // pptxgenjs 不直接支持渐变，使用纯色作为降级
      slide.background = { color: primary };
    } else if (bgDecision.type === "solid" && bgDecision.colors) {
      slide.background = {
        color: this.hexToColor(bgDecision.colors.primary),
      };
    } else {
      // 默认使用主题背景
      slide.background = {
        color: this.hexToColor(theme.colors.background),
      };
    }
  }

  /**
   * 根据布局类型渲染
   */
  private async renderByLayout(
    slide: Slide,
    slideData: GeneratedSlide,
    theme: PPTTheme,
    config: ThemePPTXConfig,
  ): Promise<void> {
    const layoutType = slideData.spec.layoutType;

    switch (layoutType) {
      case "title_center":
        await this.renderTitleCenter(slide, slideData, theme, config);
        break;

      case "title_subtitle":
        await this.renderTitleSubtitle(slide, slideData, theme, config);
        break;

      case "text_image_left":
        await this.renderTextImageLeft(slide, slideData, theme, config);
        break;

      case "text_image_right":
        await this.renderTextImageRight(slide, slideData, theme, config);
        break;

      case "image_full":
        await this.renderImageFull(slide, slideData, theme, config);
        break;

      case "two_columns":
        await this.renderTwoColumns(slide, slideData, theme, config);
        break;

      case "bullet_points":
        await this.renderBulletPoints(slide, slideData, theme, config);
        break;

      case "statistics_cards":
        await this.renderStatisticsCards(slide, slideData, theme, config);
        break;

      case "quote_highlight":
        await this.renderQuoteHighlight(slide, slideData, theme, config);
        break;

      case "timeline_horizontal":
        await this.renderTimelineHorizontal(slide, slideData, theme, config);
        break;

      case "comparison_split":
        await this.renderComparisonSplit(slide, slideData, theme, config);
        break;

      default:
        // 默认使用 bullet_points 布局
        await this.renderBulletPoints(slide, slideData, theme, config);
    }
  }

  // ============================================
  // 布局渲染方法
  // ============================================

  /**
   * 标题居中布局
   */
  private async renderTitleCenter(
    slide: Slide,
    slideData: GeneratedSlide,
    theme: PPTTheme,
    config: ThemePPTXConfig,
  ): Promise<void> {
    const content = slideData.content;
    const isDark = this.isDarkColor(theme.colors.background);

    // 主标题 - 居中大字
    slide.addText(content.title, {
      x: 0.5,
      y: 2.5,
      w: 12.33,
      h: 1.5,
      fontSize: 54,
      fontFace: config.titleStyle.fontFace,
      color: isDark ? "FFFFFF" : config.titleStyle.color,
      bold: true,
      align: "center",
      valign: "middle",
    });

    // 副标题
    if (content.subtitle) {
      slide.addText(content.subtitle, {
        x: 1.5,
        y: 4.2,
        w: 10.33,
        h: 0.8,
        fontSize: 24,
        fontFace: config.subtitleStyle.fontFace,
        color: isDark ? "CCCCCC" : config.subtitleStyle.color,
        align: "center",
        valign: "middle",
      });
    }

    // 装饰线
    slide.addShape("rect", {
      x: 5.5,
      y: 4.0,
      w: 2.33,
      h: 0.05,
      fill: { color: config.accentColor },
    });
  }

  /**
   * 标题+副标题布局
   */
  private async renderTitleSubtitle(
    slide: Slide,
    slideData: GeneratedSlide,
    theme: PPTTheme,
    config: ThemePPTXConfig,
  ): Promise<void> {
    const content = slideData.content;
    const isDark = this.isDarkColor(theme.colors.background);

    // 主标题
    slide.addText(content.title, {
      x: 0.8,
      y: 2.8,
      w: 11.73,
      h: 1.2,
      fontSize: 44,
      fontFace: config.titleStyle.fontFace,
      color: isDark ? "FFFFFF" : config.titleStyle.color,
      bold: true,
      align: "center",
    });

    // 副标题
    if (content.subtitle) {
      slide.addText(content.subtitle, {
        x: 1.5,
        y: 4.2,
        w: 10.33,
        h: 0.8,
        fontSize: 22,
        fontFace: config.subtitleStyle.fontFace,
        color: isDark ? "AAAAAA" : config.subtitleStyle.color,
        align: "center",
      });
    }
  }

  /**
   * 左图右文布局
   */
  private async renderTextImageLeft(
    slide: Slide,
    slideData: GeneratedSlide,
    theme: PPTTheme,
    config: ThemePPTXConfig,
  ): Promise<void> {
    const content = slideData.content;
    const contentImage = slideData.images.find(
      (img) => img.position !== "background",
    );

    // 左侧图片区域
    if (contentImage?.url) {
      await this.addImageToSlide(slide, contentImage, {
        x: 0.5,
        y: 0.8,
        w: 5.5,
        h: 5.9,
      });
    } else {
      // 占位符
      slide.addShape("rect", {
        x: 0.5,
        y: 0.8,
        w: 5.5,
        h: 5.9,
        fill: { color: this.hexToColor(theme.colors.backgroundSecondary) },
      });
    }

    // 右侧标题
    slide.addText(content.title, {
      x: 6.5,
      y: 0.8,
      w: 6.33,
      h: 1,
      fontSize: 32,
      fontFace: config.titleStyle.fontFace,
      color: config.titleStyle.color,
      bold: true,
    });

    // 右侧内容
    if (content.bulletPoints && content.bulletPoints.length > 0) {
      this.addBulletPoints(slide, content.bulletPoints, {
        x: 6.5,
        y: 2.0,
        w: 6.33,
        h: 4.5,
        config,
      });
    }
  }

  /**
   * 左文右图布局
   */
  private async renderTextImageRight(
    slide: Slide,
    slideData: GeneratedSlide,
    theme: PPTTheme,
    config: ThemePPTXConfig,
  ): Promise<void> {
    const content = slideData.content;
    const contentImage = slideData.images.find(
      (img) => img.position !== "background",
    );

    // 左侧标题
    slide.addText(content.title, {
      x: 0.5,
      y: 0.8,
      w: 6,
      h: 1,
      fontSize: 32,
      fontFace: config.titleStyle.fontFace,
      color: config.titleStyle.color,
      bold: true,
    });

    // 左侧内容
    if (content.bulletPoints && content.bulletPoints.length > 0) {
      this.addBulletPoints(slide, content.bulletPoints, {
        x: 0.5,
        y: 2.0,
        w: 6,
        h: 4.5,
        config,
      });
    }

    // 右侧图片区域
    if (contentImage?.url) {
      await this.addImageToSlide(slide, contentImage, {
        x: 7,
        y: 0.8,
        w: 5.83,
        h: 5.9,
      });
    } else {
      slide.addShape("rect", {
        x: 7,
        y: 0.8,
        w: 5.83,
        h: 5.9,
        fill: { color: this.hexToColor(theme.colors.backgroundSecondary) },
      });
    }
  }

  /**
   * 全屏图片布局
   */
  private async renderImageFull(
    slide: Slide,
    slideData: GeneratedSlide,
    _theme: PPTTheme,
    config: ThemePPTXConfig,
  ): Promise<void> {
    const content = slideData.content;
    const mainImage = slideData.images[0];

    // 全屏图片
    if (mainImage?.url) {
      await this.addImageToSlide(slide, mainImage, {
        x: 0,
        y: 0,
        w: 13.33,
        h: 7.5,
      });
    }

    // 底部标题遮罩
    slide.addShape("rect", {
      x: 0,
      y: 5.5,
      w: 13.33,
      h: 2,
      fill: { color: "000000", transparency: 50 },
    });

    // 标题
    slide.addText(content.title, {
      x: 0.5,
      y: 5.8,
      w: 12.33,
      h: 1,
      fontSize: 36,
      fontFace: config.titleStyle.fontFace,
      color: "FFFFFF",
      bold: true,
      align: "center",
    });
  }

  /**
   * 双栏布局
   */
  private async renderTwoColumns(
    slide: Slide,
    slideData: GeneratedSlide,
    theme: PPTTheme,
    config: ThemePPTXConfig,
  ): Promise<void> {
    const content = slideData.content;
    const bullets = content.bulletPoints || [];

    // 标题
    slide.addText(content.title, {
      x: 0.5,
      y: 0.5,
      w: 12.33,
      h: 1,
      fontSize: 32,
      fontFace: config.titleStyle.fontFace,
      color: config.titleStyle.color,
      bold: true,
    });

    // 分割线
    slide.addShape("rect", {
      x: 6.5,
      y: 1.8,
      w: 0.02,
      h: 5,
      fill: { color: this.hexToColor(theme.colors.textMuted) },
    });

    // 左栏
    const leftBullets = bullets.slice(0, Math.ceil(bullets.length / 2));
    this.addBulletPoints(slide, leftBullets, {
      x: 0.5,
      y: 1.8,
      w: 5.8,
      h: 5,
      config,
    });

    // 右栏
    const rightBullets = bullets.slice(Math.ceil(bullets.length / 2));
    this.addBulletPoints(slide, rightBullets, {
      x: 7,
      y: 1.8,
      w: 5.83,
      h: 5,
      config,
    });
  }

  /**
   * 要点列表布局
   */
  private async renderBulletPoints(
    slide: Slide,
    slideData: GeneratedSlide,
    theme: PPTTheme,
    config: ThemePPTXConfig,
  ): Promise<void> {
    const content = slideData.content;

    // 标题
    slide.addText(content.title, {
      x: 0.5,
      y: 0.5,
      w: 12.33,
      h: 1,
      fontSize: 32,
      fontFace: config.titleStyle.fontFace,
      color: config.titleStyle.color,
      bold: true,
    });

    // 要点列表
    if (content.bulletPoints && content.bulletPoints.length > 0) {
      this.addBulletPoints(slide, content.bulletPoints, {
        x: 0.5,
        y: 1.8,
        w: 12.33,
        h: 5,
        config,
      });
    }

    // 正文
    if (content.bodyText) {
      slide.addText(content.bodyText, {
        x: 0.5,
        y: 5.8,
        w: 12.33,
        h: 1,
        fontSize: 16,
        fontFace: config.bodyStyle.fontFace,
        color: this.hexToColor(theme.colors.textLight),
        align: "left",
      });
    }
  }

  /**
   * 统计卡片布局
   */
  private async renderStatisticsCards(
    slide: Slide,
    slideData: GeneratedSlide,
    theme: PPTTheme,
    config: ThemePPTXConfig,
  ): Promise<void> {
    const content = slideData.content;
    const stats = content.statistics || [];

    // 标题
    slide.addText(content.title, {
      x: 0.5,
      y: 0.5,
      w: 12.33,
      h: 1,
      fontSize: 32,
      fontFace: config.titleStyle.fontFace,
      color: config.titleStyle.color,
      bold: true,
    });

    // 统计卡片
    const cardCount = Math.min(stats.length, 4);
    const cardWidth = (12.33 - (cardCount - 1) * 0.5) / cardCount;
    const startY = 2;

    stats.slice(0, 4).forEach((stat, index) => {
      const x = 0.5 + index * (cardWidth + 0.5);

      // 卡片背景
      slide.addShape("roundRect", {
        x,
        y: startY,
        w: cardWidth,
        h: 4,
        fill: { color: this.hexToColor(theme.colors.backgroundSecondary) },
        line: { color: this.hexToColor(theme.colors.accent), width: 2 },
      });

      // 数值
      slide.addText(stat.value, {
        x,
        y: startY + 0.5,
        w: cardWidth,
        h: 1.5,
        fontSize: 48,
        fontFace: config.titleStyle.fontFace,
        color: config.accentColor,
        bold: true,
        align: "center",
      });

      // 标签
      slide.addText(stat.label, {
        x,
        y: startY + 2.2,
        w: cardWidth,
        h: 0.8,
        fontSize: 18,
        fontFace: config.bodyStyle.fontFace,
        color: config.bodyStyle.color,
        align: "center",
      });

      // 对比
      if (stat.comparison) {
        const trendColor =
          stat.trend === "up"
            ? "36B37E"
            : stat.trend === "down"
              ? "FF5630"
              : config.bodyStyle.color;
        slide.addText(stat.comparison, {
          x,
          y: startY + 3.2,
          w: cardWidth,
          h: 0.5,
          fontSize: 14,
          fontFace: config.bodyStyle.fontFace,
          color: trendColor,
          align: "center",
        });
      }
    });
  }

  /**
   * 引用高亮布局
   */
  private async renderQuoteHighlight(
    slide: Slide,
    slideData: GeneratedSlide,
    theme: PPTTheme,
    config: ThemePPTXConfig,
  ): Promise<void> {
    const content = slideData.content;
    const quote = content.quote;
    const isDark = this.isDarkColor(theme.colors.background);

    // 引用符号
    slide.addText("\u201C", {
      x: 0.5,
      y: 1,
      w: 2,
      h: 2,
      fontSize: 120,
      fontFace: "Georgia",
      color: config.accentColor,
      bold: true,
    });

    // 引用文本
    slide.addText(quote?.text || content.title, {
      x: 1.5,
      y: 2.5,
      w: 10.33,
      h: 2.5,
      fontSize: 32,
      fontFace: config.titleStyle.fontFace,
      color: isDark ? "FFFFFF" : config.titleStyle.color,
      italic: true,
      align: "center",
      valign: "middle",
    });

    // 作者
    if (quote?.author) {
      slide.addText(`— ${quote.author}`, {
        x: 1.5,
        y: 5.3,
        w: 10.33,
        h: 0.8,
        fontSize: 20,
        fontFace: config.bodyStyle.fontFace,
        color: isDark ? "AAAAAA" : config.bodyStyle.color,
        align: "center",
      });
    }

    // 来源
    if (quote?.source) {
      slide.addText(quote.source, {
        x: 1.5,
        y: 6,
        w: 10.33,
        h: 0.5,
        fontSize: 14,
        fontFace: config.bodyStyle.fontFace,
        color: this.hexToColor(theme.colors.textMuted),
        align: "center",
      });
    }
  }

  /**
   * 时间线水平布局
   */
  private async renderTimelineHorizontal(
    slide: Slide,
    slideData: GeneratedSlide,
    _theme: PPTTheme,
    config: ThemePPTXConfig,
  ): Promise<void> {
    const content = slideData.content;
    const items = content.bulletPoints || [];

    // 标题
    slide.addText(content.title, {
      x: 0.5,
      y: 0.5,
      w: 12.33,
      h: 1,
      fontSize: 32,
      fontFace: config.titleStyle.fontFace,
      color: config.titleStyle.color,
      bold: true,
    });

    // 时间线
    const lineY = 3.5;
    slide.addShape("rect", {
      x: 1,
      y: lineY,
      w: 11.33,
      h: 0.05,
      fill: { color: config.accentColor },
    });

    // 时间点
    const itemCount = Math.min(items.length, 5);
    const spacing = 11.33 / (itemCount + 1);

    items.slice(0, 5).forEach((item, index) => {
      const x = 1 + spacing * (index + 1);

      // 圆点
      slide.addShape("ellipse", {
        x: x - 0.15,
        y: lineY - 0.15,
        w: 0.3,
        h: 0.3,
        fill: { color: config.accentColor },
      });

      // 文本
      slide.addText(item, {
        x: x - 1.5,
        y: lineY + 0.5,
        w: 3,
        h: 2,
        fontSize: 14,
        fontFace: config.bodyStyle.fontFace,
        color: config.bodyStyle.color,
        align: "center",
        valign: "top",
      });
    });
  }

  /**
   * 对比分割布局
   */
  private async renderComparisonSplit(
    slide: Slide,
    slideData: GeneratedSlide,
    theme: PPTTheme,
    config: ThemePPTXConfig,
  ): Promise<void> {
    const content = slideData.content;
    const bullets = content.bulletPoints || [];

    // 标题
    slide.addText(content.title, {
      x: 0.5,
      y: 0.5,
      w: 12.33,
      h: 1,
      fontSize: 32,
      fontFace: config.titleStyle.fontFace,
      color: config.titleStyle.color,
      bold: true,
    });

    // 左侧背景
    slide.addShape("rect", {
      x: 0.5,
      y: 1.8,
      w: 6,
      h: 5,
      fill: { color: this.hexToColor(theme.colors.primary) },
    });

    // 右侧背景
    slide.addShape("rect", {
      x: 6.83,
      y: 1.8,
      w: 6,
      h: 5,
      fill: { color: this.hexToColor(theme.colors.secondary) },
    });

    // 左侧标题
    slide.addText("Option A", {
      x: 0.5,
      y: 2,
      w: 6,
      h: 0.8,
      fontSize: 24,
      fontFace: config.titleStyle.fontFace,
      color: "FFFFFF",
      bold: true,
      align: "center",
    });

    // 右侧标题
    slide.addText("Option B", {
      x: 6.83,
      y: 2,
      w: 6,
      h: 0.8,
      fontSize: 24,
      fontFace: config.titleStyle.fontFace,
      color: "FFFFFF",
      bold: true,
      align: "center",
    });

    // 左侧内容
    const leftBullets = bullets.slice(0, Math.ceil(bullets.length / 2));
    leftBullets.forEach((bullet, index) => {
      slide.addText(`• ${bullet}`, {
        x: 0.7,
        y: 3 + index * 0.8,
        w: 5.6,
        h: 0.7,
        fontSize: 16,
        fontFace: config.bodyStyle.fontFace,
        color: "FFFFFF",
      });
    });

    // 右侧内容
    const rightBullets = bullets.slice(Math.ceil(bullets.length / 2));
    rightBullets.forEach((bullet, index) => {
      slide.addText(`• ${bullet}`, {
        x: 7.03,
        y: 3 + index * 0.8,
        w: 5.6,
        h: 0.7,
        fontSize: 16,
        fontFace: config.bodyStyle.fontFace,
        color: "FFFFFF",
      });
    });
  }

  // ============================================
  // 辅助方法
  // ============================================

  /**
   * 添加要点列表
   */
  private addBulletPoints(
    slide: Slide,
    bullets: string[],
    options: {
      x: number;
      y: number;
      w: number;
      h: number;
      config: ThemePPTXConfig;
    },
  ): void {
    const bulletTextOpts = bullets.map((text) => ({
      text,
      options: {
        bullet: { type: "bullet" as const, color: options.config.accentColor },
        fontSize: options.config.bulletStyle.fontSize,
        color: options.config.bulletStyle.color,
        breakLine: true,
        paraSpaceAfter: 12,
      },
    }));

    slide.addText(bulletTextOpts, {
      x: options.x,
      y: options.y,
      w: options.w,
      h: options.h,
      fontFace: options.config.bulletStyle.fontFace,
      valign: "top",
    });
  }

  /**
   * 添加图片到幻灯片
   */
  private async addImageToSlide(
    slide: Slide,
    image: GeneratedSlideImage,
    position: { x: number; y: number; w: number; h: number },
  ): Promise<void> {
    try {
      const imageBuffer = await this.downloadImage(image.url);
      if (imageBuffer) {
        slide.addImage({
          data: `data:image/png;base64,${imageBuffer.toString("base64")}`,
          x: position.x,
          y: position.y,
          w: position.w,
          h: position.h,
          sizing: { type: "cover", w: position.w, h: position.h },
        });
      }
    } catch (error) {
      this.logger.warn(`[addImageToSlide] Failed to add image: ${image.url}`);
    }
  }

  /**
   * 下载图片
   */
  private async downloadImage(url: string): Promise<Buffer | null> {
    try {
      // 处理 data URL
      if (url.startsWith("data:")) {
        const base64Data = url.split(",")[1];
        return Buffer.from(base64Data, "base64");
      }

      // 处理远程 URL
      const response = await firstValueFrom(
        this.httpService.get(url, {
          responseType: "arraybuffer",
          timeout: 30000,
        }),
      );

      return Buffer.from(response.data);
    } catch (error) {
      this.logger.error(`[downloadImage] Failed to download: ${url}`);
      return null;
    }
  }

  /**
   * 添加页码
   */
  private addPageNumber(slide: Slide, pageNum: number, theme: PPTTheme): void {
    slide.addText(String(pageNum), {
      x: 12.5,
      y: 7,
      w: 0.5,
      h: 0.3,
      fontSize: 12,
      fontFace: "Arial",
      color: this.hexToColor(theme.colors.textMuted),
      align: "right",
    });
  }

  /**
   * 判断是否为深色
   */
  private isDarkColor(hexColor: string): boolean {
    const hex = hexColor.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5;
  }

  /**
   * Hex 颜色转 PPTX 颜色（去掉 #）
   */
  private hexToColor(hex: string): string {
    return hex.replace("#", "").toUpperCase();
  }

  /**
   * 获取兼容字体
   */
  private getCompatibleFont(
    fontFamily: string,
    type: "heading" | "body",
  ): string {
    // 映射常见字体到 PPTX 兼容字体
    const fontMap: Record<string, string> = {
      "'Noto Sans SC', sans-serif": "Microsoft YaHei",
      "'Inter', sans-serif": "Arial",
      "'SF Pro Display', sans-serif": "Arial",
      "'Poppins', sans-serif": "Arial",
      "'Comic Sans MS', 'Noto Sans SC', cursive": "Comic Sans MS",
    };

    return fontMap[fontFamily] || (type === "heading" ? "Arial" : "Arial");
  }
}
