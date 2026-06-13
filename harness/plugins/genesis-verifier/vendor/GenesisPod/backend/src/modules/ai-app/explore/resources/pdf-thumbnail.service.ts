import { Injectable, Logger } from "@nestjs/common";
import { getErrorMessage } from "../../../../common/utils/error.utils";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import axios from "axios";
// 使用 legacy 版本，兼容 Node.js 环境（无需 DOMMatrix）
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "canvas";

// 动态导入sharp以兼容生产环境
const sharp = require("sharp");

/**
 * PDF缩略图生成服务
 * 从PDF URL生成缩略图并保存到本地
 */
@Injectable()
export class PdfThumbnailService {
  private readonly logger = new Logger(PdfThumbnailService.name);
  private thumbnailDir = path.join(process.cwd(), "public", "thumbnails");
  private readonly thumbnailWidth = 400; // 缩略图宽度
  private readonly thumbnailHeight = 566; // 缩略图高度 (A4比例)

  constructor() {
    void this.ensureThumbnailDirExists();
  }

  /**
   * 确保缩略图目录存在，若主目录不可写则回退到 /tmp
   */
  private async ensureThumbnailDirExists() {
    try {
      await fs.mkdir(this.thumbnailDir, { recursive: true });
      this.logger.log(`Thumbnail directory ensured at: ${this.thumbnailDir}`);
    } catch (error) {
      this.logger.warn(
        `Failed to create thumbnail directory at ${this.thumbnailDir}: ${error}`,
      );
      // Fallback to /tmp for restricted filesystems (e.g., Railway)
      const fallbackDir = path.join(os.tmpdir(), "thumbnails");
      try {
        await fs.mkdir(fallbackDir, { recursive: true });
        this.thumbnailDir = fallbackDir;
        this.logger.log(
          `Using fallback thumbnail directory: ${this.thumbnailDir}`,
        );
      } catch (fallbackError) {
        this.logger.error(
          `Failed to create fallback thumbnail directory: ${fallbackError}`,
        );
      }
    }
  }

  /**
   * 从PDF URL生成缩略图
   * @param pdfUrl PDF文件URL
   * @param resourceId 资源ID (用于文件命名)
   * @returns 缩略图URL
   */
  async generateThumbnail(
    pdfUrl: string,
    resourceId: string,
  ): Promise<string | null> {
    try {
      this.logger.log(
        `Generating thumbnail for resource ${resourceId} from ${pdfUrl}`,
      );

      // 检查缩略图是否已存在
      if (await this.thumbnailExists(resourceId)) {
        this.logger.log(`Thumbnail already exists for resource ${resourceId}`);
        return `/thumbnails/${resourceId}.jpg`;
      }

      // 1. 下载PDF
      this.logger.debug(`Step 1: Downloading PDF from ${pdfUrl}`);
      const pdfData = await this.downloadPdf(pdfUrl);
      if (!pdfData) {
        this.logger.warn(`Failed to download PDF for resource ${resourceId}`);
        return null;
      }
      this.logger.debug(`Step 1: Downloaded ${pdfData.length} bytes`);

      // 2. 加载PDF文档
      this.logger.debug(`Step 2: Loading PDF document`);
      // Convert Buffer to Uint8Array for pdfjs-dist
      const uint8Array = new Uint8Array(pdfData);
      const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
      const pdfDocument = await loadingTask.promise;
      this.logger.debug(
        `Step 2: PDF loaded with ${pdfDocument.numPages} pages`,
      );

      // 3. 获取第一页
      const page = await pdfDocument.getPage(1);

      // 4. 设置缩放比例以匹配目标尺寸
      const viewport = page.getViewport({ scale: 1.0 });
      const scale = Math.min(
        this.thumbnailWidth / viewport.width,
        this.thumbnailHeight / viewport.height,
      );
      const scaledViewport = page.getViewport({ scale });

      // 5. 创建canvas
      const canvas = createCanvas(scaledViewport.width, scaledViewport.height);
      const context = canvas.getContext("2d");

      // 6. 渲染PDF页面到canvas
      const renderContext = {
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport: scaledViewport,
        canvas: canvas as unknown as HTMLCanvasElement,
      };
      await page.render(renderContext).promise;

      // 7. 转换为buffer
      const buffer = canvas.toBuffer("image/png");

      // 8. 使用sharp优化图片（可选：压缩、调整大小）
      const optimizedBuffer = await sharp(buffer)
        .resize(this.thumbnailWidth, this.thumbnailHeight, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();

      // 9. 保存到文件
      const filename = `${resourceId}.jpg`;
      const filepath = path.join(this.thumbnailDir, filename);
      await fs.writeFile(filepath, optimizedBuffer);

      this.logger.log(
        `Thumbnail generated successfully for resource ${resourceId}`,
      );

      // 10. 返回相对URL
      return `/thumbnails/${filename}`;
    } catch (error) {
      this.logger.error(
        `Failed to generate thumbnail for resource ${resourceId}:`,
        getErrorMessage(error),
      );
      return null;
    }
  }

  /**
   * 下载PDF文件
   * @param url PDF URL
   * @returns PDF数据buffer
   */
  private async downloadPdf(url: string): Promise<Buffer | null> {
    try {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000, // 30秒超时
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      return Buffer.from(response.data);
    } catch (error) {
      this.logger.error(
        `Failed to download PDF from ${url}:`,
        getErrorMessage(error),
      );
      return null;
    }
  }

  /**
   * 检查缩略图是否存在
   * @param resourceId 资源ID
   * @returns 是否存在
   */
  async thumbnailExists(resourceId: string): Promise<boolean> {
    try {
      const filename = `${resourceId}.jpg`;
      const filepath = path.join(this.thumbnailDir, filename);
      await fs.access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 删除缩略图
   * @param resourceId 资源ID
   */
  async deleteThumbnail(resourceId: string): Promise<void> {
    try {
      const filename = `${resourceId}.jpg`;
      const filepath = path.join(this.thumbnailDir, filename);
      await fs.unlink(filepath);
      this.logger.log(`Deleted thumbnail for resource ${resourceId}`);
    } catch (error) {
      this.logger.warn(
        `Failed to delete thumbnail for resource ${resourceId}:`,
        getErrorMessage(error),
      );
    }
  }

  /**
   * 批量生成缩略图
   * @param resources 包含pdfUrl和id的资源列表
   * @returns 生成结果统计
   */
  async generateBatchThumbnails(
    resources: Array<{ id: string; pdfUrl: string }>,
  ): Promise<{ success: number; failed: number; skipped: number }> {
    const stats = { success: 0, failed: 0, skipped: 0 };

    for (const resource of resources) {
      // 检查是否已有缩略图
      if (await this.thumbnailExists(resource.id)) {
        this.logger.log(
          `Thumbnail already exists for resource ${resource.id}, skipping`,
        );
        stats.skipped++;
        continue;
      }

      // 生成缩略图
      const thumbnailUrl = await this.generateThumbnail(
        resource.pdfUrl,
        resource.id,
      );
      if (thumbnailUrl) {
        stats.success++;
      } else {
        stats.failed++;
      }

      // 添加延迟避免过快请求
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    this.logger.log(
      `Batch thumbnail generation completed: ${stats.success} success, ${stats.failed} failed, ${stats.skipped} skipped`,
    );

    return stats;
  }
}
