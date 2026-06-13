/**
 * Export Image Tool
 * 图片导出工具 - 使用 sharp 库将 HTML/SVG 转换为图片
 */

import { Injectable, Logger } from "@nestjs/common";
import { PuppeteerPoolService } from "@/common/browser/puppeteer-pool.service";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";

import * as sharp from "sharp";

// ============================================================================
// Types
// ============================================================================

interface PuppeteerScreenshotOptions {
  type?: "png" | "jpeg" | "webp";
  omitBackground?: boolean;
  quality?: number;
  path?: string;
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
}

export interface ExportImageInput {
  /**
   * 内容（HTML 或 SVG）
   */
  content: string;

  /**
   * 图片格式
   * @default 'png'
   */
  format?: "png" | "jpeg" | "webp";

  /**
   * 图片宽度（像素）
   */
  width?: number;

  /**
   * 图片高度（像素）
   */
  height?: number;

  /**
   * 图片质量（1-100，仅适用于 jpeg 和 webp）
   * @default 90
   */
  quality?: number;

  /**
   * 背景颜色（仅适用于 png）
   * @default 'white'
   */
  background?: string;

  /**
   * 文件名（不含扩展名）
   */
  filename?: string;
}

export interface ExportImageOutput {
  /**
   * 文件名
   */
  filename: string;

  /**
   * MIME 类型
   */
  mimeType: string;

  /**
   * 文件大小（字节）
   */
  size: number;

  /**
   * Base64 编码的文件内容
   */
  base64Content: string;

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
export class ExportImageTool extends BaseTool<
  ExportImageInput,
  ExportImageOutput
> {
  private readonly logger = new Logger(ExportImageTool.name);

  readonly id = "export-image";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "export";
  readonly tags = ["export", "image", "png", "jpeg", "raster"];
  readonly name = "导出图片";
  readonly description =
    "将 HTML 或 SVG 内容转换为图片文件。支持 PNG、JPEG、WebP 格式，可自定义尺寸和质量。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "要转换的内容，支持 SVG 或 HTML 片段",
      },
      format: {
        type: "string",
        enum: ["png", "jpeg", "webp"],
        description: "输出图片格式，默认为 png",
      },
      width: {
        type: "number",
        description: "图片宽度（像素），如果不指定则自动计算",
      },
      height: {
        type: "number",
        description: "图片高度（像素），如果不指定则自动计算",
      },
      quality: {
        type: "number",
        description: "图片质量（1-100），默认为 90，仅适用于 JPEG 和 WebP",
      },
      background: {
        type: "string",
        description: "背景颜色，默认为 white，支持颜色名称或十六进制",
      },
      filename: {
        type: "string",
        description: "文件名（不含扩展名），默认为时间戳",
      },
    },
    required: ["content"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "生成的文件名",
      },
      mimeType: {
        type: "string",
        description: "文件 MIME 类型",
      },
      size: {
        type: "number",
        description: "文件大小（字节）",
      },
      base64Content: {
        type: "string",
        description: "Base64 编码的文件内容",
      },
      success: {
        type: "boolean",
        description: "导出是否成功",
      },
      error: {
        type: "string",
        description: "错误信息（如果失败）",
      },
    },
  };

  constructor(private readonly browserPool: PuppeteerPoolService) {
    super();
    // defaultTimeout set in class property // 30 秒超时
  }

  validateInput(input: ExportImageInput) {
    if (
      typeof input.content !== "string" ||
      input.content.trim().length === 0
    ) {
      return false;
    }

    // 验证格式
    if (input.format && !["png", "jpeg", "webp"].includes(input.format)) {
      return false;
    }

    // 验证尺寸
    if (
      (input.width !== undefined &&
        (typeof input.width !== "number" || input.width <= 0)) ||
      (input.height !== undefined &&
        (typeof input.height !== "number" || input.height <= 0))
    ) {
      return false;
    }

    // 验证质量
    if (
      input.quality !== undefined &&
      (typeof input.quality !== "number" ||
        input.quality < 1 ||
        input.quality > 100)
    ) {
      return false;
    }

    return true;
  }

  protected async doExecute(
    input: ExportImageInput,
    _context: ToolContext,
  ): Promise<ExportImageOutput> {
    const format = input.format || "png";
    const quality = input.quality || 90;
    const background = input.background || "white";
    const filename = input.filename || `image-${Date.now()}`;

    try {
      let buffer: Buffer;

      // 检查内容类型
      const isSVG =
        input.content.trim().startsWith("<svg") ||
        input.content.includes('xmlns="http://www.w3.org/2000/svg"');

      if (isSVG) {
        // 处理 SVG
        buffer = await this.convertSVGToImage(
          input.content,
          format,
          quality,
          background,
          input.width,
          input.height,
        );
      } else {
        // 处理 HTML (需要使用 puppeteer)
        buffer = await this.convertHTMLToImage(
          input.content,
          format,
          quality,
          background,
          input.width,
          input.height,
        );
      }

      const mimeType = this.getMimeType(format);

      return {
        filename: `${filename}.${format}`,
        mimeType,
        size: buffer.length,
        base64Content: buffer.toString("base64"),
        success: true,
      };
    } catch (error) {
      this.logger.error(
        `[doExecute] Failed to export image: ${error instanceof Error ? error.message : String(error)}`,
      );

      return {
        filename: "",
        mimeType: "",
        size: 0,
        base64Content: "",
        success: false,
        error: error instanceof Error ? error.message : "Export failed",
      };
    }
  }

  /**
   * 将 SVG 转换为图片
   */
  private async convertSVGToImage(
    svgContent: string,
    format: "png" | "jpeg" | "webp",
    quality: number,
    background: string,
    width?: number,
    height?: number,
  ): Promise<Buffer> {
    this.logger.log(`[convertSVGToImage] Converting SVG to ${format}`);

    // 创建 sharp 实例
    let image = sharp(Buffer.from(svgContent));

    // 设置尺寸
    if (width || height) {
      image = image.resize(width, height, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      });
    }

    // 根据格式转换
    switch (format) {
      case "png":
        return image
          .png({ quality: Math.floor((quality / 100) * 9) }) // PNG quality: 0-9
          .toBuffer();

      case "jpeg":
        return image.flatten({ background }).jpeg({ quality }).toBuffer();

      case "webp":
        return image.webp({ quality }).toBuffer();

      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * 将 HTML 转换为图片（使用 puppeteer）
   */
  private async convertHTMLToImage(
    htmlContent: string,
    format: "png" | "jpeg" | "webp",
    quality: number,
    background: string,
    width?: number,
    height?: number,
  ): Promise<Buffer> {
    this.logger.log(`[convertHTMLToImage] Converting HTML to ${format}`);

    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();

    try {
      // 设置视口
      if (width && height) {
        await page.setViewport({ width, height });
      }

      // 设置内容
      const html = this.wrapHTMLContent(htmlContent, background);
      await page.setContent(html, { waitUntil: "load" });

      // 截图
      const screenshotOptions: PuppeteerScreenshotOptions = {
        type: format === "jpeg" ? "jpeg" : "png",
        omitBackground: format === "png",
      };

      if (format === "jpeg") {
        screenshotOptions.quality = quality;
      }

      const screenshot = await page.screenshot(screenshotOptions);

      // 如果是 WebP，需要使用 sharp 转换
      if (format === "webp") {
        return sharp(screenshot).webp({ quality }).toBuffer();
      }

      return Buffer.from(screenshot);
    } finally {
      await page.close();
    }
  }

  /**
   * 包装 HTML 内容
   */
  private wrapHTMLContent(content: string, background: string): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: ${background};
      font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
    }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
  }

  /**
   * 获取 MIME 类型
   */
  private getMimeType(format: "png" | "jpeg" | "webp"): string {
    const mimeTypes = {
      png: "image/png",
      jpeg: "image/jpeg",
      webp: "image/webp",
    };
    return mimeTypes[format];
  }
}
