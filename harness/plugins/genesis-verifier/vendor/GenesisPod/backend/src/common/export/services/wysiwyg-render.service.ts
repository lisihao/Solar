/**
 * WYSIWYG 渲染服务
 * 使用 Puppeteer 将前端捕获的 HTML+CSS 渲染为各种导出格式
 */

import { Injectable, Logger } from "@nestjs/common";
import { Browser } from "puppeteer";
import { PuppeteerPoolService } from "../../browser/puppeteer-pool.service";
import { ExportOptions } from "../types/export-options";

export interface WysiwygOptions {
  pageSize?: "A4" | "A3" | "Letter" | "Legal";
  orientation?: "portrait" | "landscape";
  includePageNumbers?: boolean;
  watermark?: string;
  watermarkOpacity?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
}

export interface ScreenshotOptions extends WysiwygOptions {
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
}

@Injectable()
export class WysiwygRenderService {
  private readonly logger = new Logger(WysiwygRenderService.name);

  constructor(private readonly browserPool: PuppeteerPoolService) {}

  /**
   * 根据格式分发渲染
   */
  async renderByFormat(
    format: string,
    html: string,
    css: string | undefined,
    options: ExportOptions,
  ): Promise<Buffer> {
    const wysiwygOptions: WysiwygOptions = {
      pageSize: options.pageSize,
      orientation: options.orientation,
      includePageNumbers: options.includePageNumbers,
      watermark: options.watermark,
      watermarkOpacity: options.watermarkOpacity,
    };

    switch (format) {
      case "PDF":
        return this.renderToPdf(html, css || "", wysiwygOptions);
      case "HTML":
        return this.renderToStandaloneHtml(html, css || "", options);
      case "PPTX":
        return this.renderToScreenshots(html, css || "", wysiwygOptions);
      case "DOCX":
        return this.renderToScreenshots(html, css || "", wysiwygOptions);
      default:
        throw new Error(`WYSIWYG mode not supported for format: ${format}`);
    }
  }

  /**
   * 渲染 HTML+CSS 为 PDF
   */
  async renderToPdf(
    html: string,
    css: string,
    options: WysiwygOptions,
  ): Promise<Buffer> {
    this.logger.debug("WYSIWYG: Rendering HTML to PDF...");
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    const tempFiles: string[] = [];

    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        const url = request.url();
        const resourceType = request.resourceType();
        if (
          url.startsWith("data:") ||
          url.startsWith("file:") ||
          url === "about:blank" ||
          url.includes("fonts.googleapis.com") ||
          url.includes("fonts.gstatic.com") ||
          resourceType === "image"
        ) {
          void request.continue();
        } else {
          void request.abort("blockedbyclient");
        }
      });

      // ★ Extract base64 data URLs to temp files to reduce Node.js heap pressure.
      // A 35MB HTML with 39 inline images can OOM the 1.5GB heap when
      // setContent serializes the full string to Chromium via CDP.
      let processedHtml = html;
      try {
        const fs = require("fs") as typeof import("fs");
        const path = require("path") as typeof import("path");
        const os = require("os") as typeof import("os");
        const tmpDir = os.tmpdir();
        let imgIndex = 0;
        processedHtml = html.replace(
          /src="data:image\/([^;]+);base64,([^"]+)"/g,
          (_match: string, ext: string, base64Data: string) => {
            const safeExt =
              ext === "svg+xml" ? "svg" : ext.replace(/[^a-z]/g, "");
            const fileName = `wysiwyg-${Date.now()}-${imgIndex++}.${safeExt}`;
            const filePath = path.join(tmpDir, fileName);
            fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
            tempFiles.push(filePath);
            return `src="file://${filePath}"`;
          },
        );
        if (tempFiles.length > 0) {
          this.logger.log(
            `[renderToPdf] Extracted ${tempFiles.length} base64 images to temp files (saved ~${Math.round((html.length - processedHtml.length) / 1024 / 1024)}MB heap)`,
          );
        }
      } catch (extractErr) {
        this.logger.warn(
          `[renderToPdf] Failed to extract base64 images: ${extractErr}`,
        );
        processedHtml = html;
      }

      const fullHtml = this.wrapHtml(processedHtml, css, {});
      // ★ 2026-05-25 用 file:// 导航替代 setContent：
      //   setContent 的页面 origin 是 about:blank，Chromium 禁止非 file 源加载
      //   file:// 子资源（上方为省堆把 base64 图片抽到的临时文件），导致 PDF
      //   图片全破（HTML 导出保留 data URL 不受影响）。把整页 HTML 写到临时
      //   .html 再 goto file://，页面 origin 变成 file://，配合启动参数
      //   --allow-file-access-from-files 放行 file://→file:// 子资源；同时仍保留
      //   base64 抽取的省堆优化。JS 已禁用 + HTML/CSS 已 sanitize，无本地文件外泄面。
      {
        const fs = require("fs") as typeof import("fs");
        const path = require("path") as typeof import("path");
        const os = require("os") as typeof import("os");
        const htmlPath = path.join(
          os.tmpdir(),
          `wysiwyg-${Date.now()}-doc.html`,
        );
        fs.writeFileSync(htmlPath, fullHtml, "utf-8");
        tempFiles.push(htmlPath);
        await page.goto(`file://${htmlPath}`, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
      }
      // Wait for images to load (max 15s); continue with broken images on timeout
      await page
        .evaluate(() =>
          Promise.all(
            Array.from(document.images)
              .filter((img) => !img.complete)
              .map(
                (img) =>
                  new Promise((resolve) => {
                    img.onload = resolve;
                    img.onerror = resolve;
                  }),
              ),
          ),
        )
        .catch(() => {});
      // Wait for fonts to load (max 5s); fall back to system fonts on timeout
      await page.evaluate(() => document.fonts.ready).catch(() => {});

      const pageFormat = this.mapPageSize(options.pageSize);
      const margin = {
        top: `${options.marginTop || 40}px`,
        right: `${options.marginRight || 40}px`,
        bottom: `${options.marginBottom || 40}px`,
        left: `${options.marginLeft || 40}px`,
      };

      const pdfOptions: Parameters<typeof page.pdf>[0] = {
        format: pageFormat as "A4" | "A3" | "Letter" | "Legal",
        landscape: options.orientation === "landscape",
        margin,
        printBackground: true,
      };

      if (options.includePageNumbers !== false) {
        pdfOptions.displayHeaderFooter = true;
        pdfOptions.headerTemplate = "<div></div>";
        pdfOptions.footerTemplate = `
          <div style="width: 100%; font-size: 10px; text-align: center; color: #666;">
            <span class="pageNumber"></span> / <span class="totalPages"></span>
          </div>
        `;
      }

      const pdfBuffer = await page.pdf(pdfOptions);
      this.logger.debug(`WYSIWYG PDF generated: ${pdfBuffer.length} bytes`);
      return Buffer.from(pdfBuffer);
    } finally {
      await page.close();
      // ★ Cleanup temp files AFTER PDF is generated and page is closed
      for (const f of tempFiles) {
        try {
          require("fs").unlinkSync(f);
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * 渲染 HTML+CSS 为 PNG 截图（用于 PPTX/DOCX 嵌入）
   * 返回一组 Buffer，每个代表一页的截图
   */
  async renderToScreenshots(
    html: string,
    css: string,
    options: WysiwygOptions,
  ): Promise<Buffer> {
    this.logger.debug("WYSIWYG: Rendering HTML to screenshots...");
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        const url = request.url();
        const resourceType = request.resourceType();
        if (
          url.startsWith("data:") ||
          url === "about:blank" ||
          url.includes("fonts.googleapis.com") ||
          url.includes("fonts.gstatic.com") ||
          resourceType === "image"
        ) {
          void request.continue();
        } else {
          void request.abort("blockedbyclient");
        }
      });

      // 设置视口 - 标准 16:9 宽度
      const viewportWidth = options.orientation === "landscape" ? 1280 : 960;
      await page.setViewport({
        width: viewportWidth,
        height: 720,
        deviceScaleFactor: 1.5, // 平衡清晰度和内存占用（2x 在 Railway 上容易 OOM）
      });

      const fullHtml = this.wrapHtml(html, css, {});
      await page.setContent(fullHtml, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.evaluate(() => document.fonts.ready).catch(() => {});

      // 单张全页截图
      const screenshot = await page.screenshot({
        type: "png",
        fullPage: true,
      });

      this.logger.debug(
        `WYSIWYG screenshot generated: ${screenshot.length} bytes`,
      );
      return Buffer.from(screenshot);
    } finally {
      await page.close();
    }
  }

  /**
   * 渲染为独立 HTML 文件
   */
  async renderToStandaloneHtml(
    html: string,
    css: string,
    options: ExportOptions,
  ): Promise<Buffer> {
    this.logger.debug("WYSIWYG: Generating standalone HTML...");
    const fullHtml = this.wrapHtml(html, css, {
      title: options.fileName || "Export",
      watermark: options.watermark,
      watermarkOpacity: options.watermarkOpacity,
    });
    return Buffer.from(fullHtml, "utf-8");
  }

  /**
   * 将分页内容截图为多张图片
   * 用于 PPTX 每一张幻灯片一页
   */
  async paginateAndScreenshot(
    html: string,
    css: string,
    pageHeight: number,
    options: ScreenshotOptions,
  ): Promise<Buffer[]> {
    this.logger.debug("WYSIWYG: Paginating and capturing screenshots...");
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        const url = request.url();
        if (
          url.startsWith("data:") ||
          url === "about:blank" ||
          url.includes("fonts.googleapis.com") ||
          url.includes("fonts.gstatic.com")
        ) {
          void request.continue();
        } else {
          void request.abort("blockedbyclient");
        }
      });

      const viewportWidth = options.width || 960;
      await page.setViewport({
        width: viewportWidth,
        height: pageHeight,
        deviceScaleFactor: options.deviceScaleFactor || 2,
      });

      const fullHtml = this.wrapHtml(html, css, {});
      await page.setContent(fullHtml, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.evaluate(() => document.fonts.ready).catch(() => {});

      // 获取内容总高度
      const contentHeight = await page.evaluate(
        () => document.body.scrollHeight,
      );
      const pageCount = Math.ceil(contentHeight / pageHeight);
      const screenshots: Buffer[] = [];

      for (let i = 0; i < pageCount; i++) {
        const screenshot = await page.screenshot({
          type: "png",
          clip: {
            x: 0,
            y: i * pageHeight,
            width: viewportWidth,
            height: Math.min(pageHeight, contentHeight - i * pageHeight),
          },
        });
        screenshots.push(Buffer.from(screenshot));
      }

      this.logger.debug(
        `WYSIWYG: Generated ${screenshots.length} page screenshots`,
      );
      return screenshots;
    } finally {
      await page.close();
    }
  }

  /**
   * 包装捕获的 HTML 为完整文档
   */
  private wrapHtml(
    html: string,
    css: string,
    metadata: {
      title?: string;
      watermark?: string;
      watermarkOpacity?: number;
    },
  ): string {
    const safeHtml = this.sanitizeHtml(html);
    const safeCss = this.sanitizeCss(css);

    const watermarkHtml = metadata.watermark
      ? `<div style="
          position: fixed; top: 50%; left: 50%;
          transform: translate(-50%, -50%) rotate(-45deg);
          font-size: 72px; font-weight: bold;
          color: rgba(0, 0, 0, ${metadata.watermarkOpacity || 0.05});
          pointer-events: none; white-space: nowrap; z-index: 10000;
          user-select: none;
        ">${this.escapeHtml(metadata.watermark)}</div>`
      : "";

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(metadata.title || "Export")}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    /* Reset for export rendering */
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 20px;
      background-color: #ffffff;
      font-family: 'Inter', 'Microsoft YaHei', 'Noto Sans SC', system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    /* Ensure SVGs render correctly */
    svg { max-width: 100%; }
    /* Captured styles */
    ${safeCss}
    /* Export rendering overrides: reset viewport-constrained layout classes.
       TipTap / flex-based UIs use overflow-hidden + flex-1 + h-full to create
       scrollable panels inside the browser. In Puppeteer (no flex parent context),
       flex-1 collapses to 0 height and overflow-hidden hides all content.
       These overrides make every element expand to its natural content height. */
    .flex-1 { flex: none !important; width: 100% !important; }
    .h-full, .min-h-full { height: auto !important; min-height: 0 !important; }
    .min-h-0 { min-height: 0 !important; }
    .overflow-hidden { overflow: visible !important; }
    .overflow-y-auto, .overflow-y-scroll { overflow-y: visible !important; }
    .overflow-x-hidden { overflow-x: visible !important; }
    /* ProseMirror / TipTap editor content */
    .ProseMirror { outline: none !important; height: auto !important; }
    [contenteditable] { height: auto !important; min-height: 0 !important; }
    /* Force white background on captured content — override app theme classes */
    [data-export-content], [data-export-content] * {
      background-color: transparent !important;
      background-image: none !important;
    }
    body > * { background-color: #ffffff !important; }
  </style>
</head>
<body>
  ${safeHtml}
  ${watermarkHtml}
</body>
</html>`;
  }

  /**
   * 获取共享 Puppeteer 浏览器实例
   * Public so PdfRenderer can reuse the shared browser instead of launching its own.
   */
  async getBrowser(): Promise<Browser> {
    return this.browserPool.getBrowser();
  }

  /**
   * 映射页面大小
   */
  private mapPageSize(size?: string): string {
    const sizeMap: Record<string, string> = {
      A4: "A4",
      A3: "A3",
      Letter: "Letter",
      Legal: "Legal",
    };
    return sizeMap[size || "A4"] || "A4";
  }

  /**
   * 清洗 CSS，移除可能的外部资源引用和危险表达式
   */
  private sanitizeCss(css: string): string {
    return css
      .replace(/@import\s+[^;]+;/gi, "/* @import removed */")
      .replace(
        /url\s*\(\s*['"]?\s*(https?:|file:|ftp:|\/\/)[^)]*\)/gi,
        "url(about:blank)",
      )
      .replace(/expression\s*\(/gi, "/* expression removed */(");
  }

  /**
   * 清洗 HTML，移除危险标签和属性
   */
  private sanitizeHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
      .replace(/<object[\s\S]*?<\/object>/gi, "")
      .replace(/<embed[\s\S]*?>/gi, "")
      .replace(/<link[^>]*>/gi, "")
      .replace(/<meta[^>]*>/gi, "")
      .replace(/<base[^>]*>/gi, "")
      .replace(/\bon\w+\s*=\s*(['"]?)[\s\S]*?\1/gi, "")
      .replace(/javascript\s*:/gi, "blocked:");
  }

  /**
   * 转义 HTML
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}
