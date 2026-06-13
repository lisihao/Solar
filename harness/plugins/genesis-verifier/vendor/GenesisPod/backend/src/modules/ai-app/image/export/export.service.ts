/**
 * GenesisPod v2.1 - 多格式导出服务
 *
 * 支持 PNG/SVG/PDF/PPTX 多种导出格式
 */

import { Injectable, Logger } from "@nestjs/common";
import { PuppeteerPoolService } from "../../../../common/browser/puppeteer-pool.service";
import { ObjectStorageService } from "../../../platform/facade";
import {
  ExportOptions,
  ExportResult,
  EditableInfographic,
} from "../core/engine.types";

interface PptxSlide {
  addImage(options: {
    data: string;
    x: number;
    y: number;
    w: string;
    h: string;
  }): void;
}

interface PptxGenJSInstance {
  defineLayout(options: { name: string; width: number; height: number }): void;
  layout: string;
  addSlide(): PptxSlide;
  write(outputType: string): Promise<unknown>;
}

interface PptxGenJSConstructor {
  new (): PptxGenJSInstance;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly r2Storage: ObjectStorageService,
    private readonly browserPool: PuppeteerPoolService,
  ) {}

  /**
   * 导出为 PNG
   */
  async exportToPNG(
    html: string,
    width: number,
    height: number,
    options: ExportOptions = { format: "png" },
  ): Promise<ExportResult> {
    try {
      const browser = await this.browserPool.getBrowser();
      const page = await browser.newPage();

      const scale = options.scale || 2;
      await page.setViewport({
        width,
        height,
        deviceScaleFactor: scale,
      });

      await page.setContent(html, {
        waitUntil: "load",
        timeout: 30000,
      });

      // 等待字体加载
      await page.evaluate(() => document.fonts.ready);

      const screenshot = await page.screenshot({
        type: "png",
        encoding: "base64",
        clip: { x: 0, y: 0, width, height },
      });

      await page.close();

      const base64 = `data:image/png;base64,${screenshot}`;

      // 上传到存储
      let url: string | undefined;
      if (this.r2Storage.isEnabled()) {
        const result = await this.r2Storage.uploadBase64Image(
          base64,
          "exports",
        );
        if (result.success) {
          url = result.url;
        }
      }

      return {
        success: true,
        base64,
        url,
        format: "png",
        fileSize: Buffer.from(screenshot, "base64").length,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`PNG export failed: ${message}`);
      return {
        success: false,
        format: "png",
        error: message,
      };
    }
  }

  /**
   * 导出为 SVG
   */
  async exportToSVG(
    html: string,
    width: number,
    height: number,
  ): Promise<ExportResult> {
    try {
      // 将 HTML 转换为 SVG 需要特殊处理
      // 这里使用 foreignObject 包装 HTML
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}"
     height="${height}"
     viewBox="0 0 ${width} ${height}">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml">
      ${html}
    </div>
  </foreignObject>
</svg>`;

      const base64 = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

      // 上传到存储
      let url: string | undefined;
      if (this.r2Storage.isEnabled()) {
        const filename = `export-${Date.now()}.svg`;
        // SVG 作为文本上传
        const result = await this.r2Storage.uploadBuffer(
          Buffer.from(svg),
          "exports",
          filename,
          "image/svg+xml",
        );
        if (result.success) {
          url = result.url;
        }
      }

      return {
        success: true,
        base64,
        url,
        format: "svg",
        fileSize: Buffer.from(svg).length,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`SVG export failed: ${message}`);
      return {
        success: false,
        format: "svg",
        error: message,
      };
    }
  }

  /**
   * 导出为 PDF
   */
  async exportToPDF(
    html: string,
    width: number,
    height: number,
    options: ExportOptions = { format: "pdf" },
  ): Promise<ExportResult> {
    try {
      const browser = await this.browserPool.getBrowser();
      const page = await browser.newPage();

      await page.setContent(html, {
        waitUntil: "load",
        timeout: 30000,
      });

      // 等待字体加载
      await page.evaluate(() => document.fonts.ready);

      // 确定页面尺寸
      let pdfWidth: string;
      let pdfHeight: string;

      switch (options.pageSize) {
        case "a4":
          pdfWidth = "210mm";
          pdfHeight = "297mm";
          break;
        case "letter":
          pdfWidth = "8.5in";
          pdfHeight = "11in";
          break;
        case "16:9":
          pdfWidth = `${width}px`;
          pdfHeight = `${height}px`;
          break;
        default:
          pdfWidth = `${width}px`;
          pdfHeight = `${height}px`;
      }

      const pdfUint8Array = await page.pdf({
        width: pdfWidth,
        height: pdfHeight,
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      const pdfBuffer = Buffer.from(pdfUint8Array);

      await page.close();

      const base64 = `data:application/pdf;base64,${pdfBuffer.toString("base64")}`;

      // 上传到存储
      let url: string | undefined;
      if (this.r2Storage.isEnabled()) {
        const filename = `export-${Date.now()}.pdf`;
        const result = await this.r2Storage.uploadBuffer(
          pdfBuffer,
          "exports",
          filename,
          "application/pdf",
        );
        if (result.success) {
          url = result.url;
        }
      }

      return {
        success: true,
        base64,
        url,
        format: "pdf",
        fileSize: pdfBuffer.length,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`PDF export failed: ${message}`);
      return {
        success: false,
        format: "pdf",
        error: message,
      };
    }
  }

  /**
   * 导出为 PPTX
   * 注意: 需要安装 pptxgenjs
   */
  async exportToPPTX(
    infographic: EditableInfographic,
    pngBase64: string,
  ): Promise<ExportResult> {
    try {
      // 动态导入 pptxgenjs (避免没安装时报错)
      let PptxGenJS: PptxGenJSConstructor;
      try {
        PptxGenJS = require("pptxgenjs");
      } catch {
        return {
          success: false,
          format: "pptx",
          error: "pptxgenjs not installed. Run: npm install pptxgenjs",
        };
      }

      const pptx = new PptxGenJS();

      // 设置幻灯片尺寸 (16:9)
      pptx.defineLayout({
        name: "CUSTOM",
        width: infographic.canvas.width / 96, // 转换为英寸
        height: infographic.canvas.height / 96,
      });
      pptx.layout = "CUSTOM";

      // 添加幻灯片
      const slide = pptx.addSlide();

      // 添加图片 (将 base64 PNG 作为背景)
      if (pngBase64) {
        const base64Data = pngBase64.replace(/^data:image\/png;base64,/, "");
        slide.addImage({
          data: `data:image/png;base64,${base64Data}`,
          x: 0,
          y: 0,
          w: "100%",
          h: "100%",
        });
      }

      // 生成 PPTX
      const pptxBuffer = await pptx.write("arraybuffer");
      const buffer = Buffer.from(pptxBuffer as ArrayBuffer);

      const base64 = `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${buffer.toString("base64")}`;

      // 上传到存储
      let url: string | undefined;
      if (this.r2Storage.isEnabled()) {
        const filename = `export-${Date.now()}.pptx`;
        const result = await this.r2Storage.uploadBuffer(
          buffer,
          "exports",
          filename,
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        );
        if (result.success) {
          url = result.url;
        }
      }

      return {
        success: true,
        base64,
        url,
        format: "pptx",
        fileSize: buffer.length,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`PPTX export failed: ${message}`);
      return {
        success: false,
        format: "pptx",
        error: message,
      };
    }
  }

  /**
   * 通用导出方法
   */
  async export(
    html: string,
    width: number,
    height: number,
    options: ExportOptions,
    infographic?: EditableInfographic,
  ): Promise<ExportResult> {
    switch (options.format) {
      case "png":
        return this.exportToPNG(html, width, height, options);

      case "svg":
        return this.exportToSVG(html, width, height);

      case "pdf":
        return this.exportToPDF(html, width, height, options);

      case "pptx":
        if (!infographic) {
          return {
            success: false,
            format: "pptx",
            error: "Infographic data required for PPTX export",
          };
        }
        // 先生成 PNG，再转 PPTX
        const pngResult = await this.exportToPNG(html, width, height, {
          ...options,
          format: "png",
        });
        if (!pngResult.success || !pngResult.base64) {
          return {
            success: false,
            format: "pptx",
            error: "Failed to generate PNG for PPTX",
          };
        }
        return this.exportToPPTX(infographic, pngResult.base64);

      default:
        return {
          success: false,
          format: options.format,
          error: `Unsupported format: ${options.format}`,
        };
    }
  }

  // Browser lifecycle managed by PuppeteerPoolService
}
