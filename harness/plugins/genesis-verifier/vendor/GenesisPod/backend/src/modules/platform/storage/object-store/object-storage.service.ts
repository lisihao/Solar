/**
 * Object Storage Service —（v5.1 R0.5-E W2-A 重构后 orchestrator）
 *
 * 历史名 ObjectStorageService 保留为 backward-compat alias（30+ 调用方依赖此名）。
 * 内部 primitive 操作（put/get/delete/signedUrl）委托给 IObjectStorageBackend
 * （由 plugins/storage/object-storage.module 通过 OBJECT_STORAGE_BACKEND_TOKEN
 * 注入）。Backend 当前实现：plugins/storage/object-r2。未来 backend：S3 native /
 * GCS / Azure Blob native / local-fs / IPFS（按 §〇.3 反应式抽取触发）。
 *
 * 高级 helper（uploadBase64Image / uploadText / uploadBuffer / refreshUrl）保留
 * 在本 service —— 它们是基于 primitive ops 的便利封装，与 backend 无关。
 */

import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as crypto from "crypto";
import type { Readable } from "stream";
import {
  mapWithConcurrency,
  ConcurrencyLimits,
} from "../../../../common/utils/concurrency.utils";
import {
  OBJECT_STORAGE_BACKEND_TOKEN,
  type IObjectStorageBackend,
} from "@/plugins/core/abstractions";

export interface UploadResult {
  success: boolean;
  url?: string;
  key?: string;
  error?: string;
}

@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  // 预签名 URL 有效期（秒）- 7 天
  private readonly PRESIGN_EXPIRES = 7 * 24 * 60 * 60;

  constructor(
    @Inject(OBJECT_STORAGE_BACKEND_TOKEN)
    private readonly backend: IObjectStorageBackend,
  ) {}

  isEnabled(): boolean {
    return this.backend.isAvailable();
  }

  /** 历史接口：返回当前 active backend id（"r2" / "s3" / "none"） */
  getProvider(): string {
    return this.backend.isAvailable() ? this.backend.id : "none";
  }

  getBucketName(): string {
    return this.backend.getBucketName();
  }

  /** 上传 base64 图片并返回预签名 URL */
  async uploadBase64Image(
    base64Data: string,
    prefix: string = "generated",
  ): Promise<UploadResult> {
    if (!this.backend.isAvailable()) {
      return { success: false, error: "Object Storage not configured" };
    }
    try {
      const matches = base64Data.match(
        /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/,
      );
      if (!matches) {
        return { success: false, error: "Invalid base64 image format" };
      }
      const imageType = matches[1];
      const base64Content = matches[2];
      const buffer = Buffer.from(base64Content, "base64");

      const hash = crypto
        .createHash("md5")
        .update(base64Content.slice(0, 1000))
        .digest("hex")
        .slice(0, 8);
      const key = `${prefix}/${Date.now()}-${hash}.${imageType}`;

      await this.backend.putObject(key, buffer, {
        contentType: `image/${imageType}`,
        metadata: {
          "uploaded-at": new Date().toISOString(),
          "original-size": buffer.length.toString(),
        },
      });
      const url = await this.backend.getSignedUrl(key, this.PRESIGN_EXPIRES);
      this.logger.log(
        `Uploaded image: ${key} (${Math.round(buffer.length / 1024)}KB) - URL valid for 7 days`,
      );
      return { success: true, url, key };
    } catch (error) {
      this.logger.error("Failed to upload:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Upload failed",
      };
    }
  }

  /** 上传 Buffer */
  async uploadBuffer(
    buffer: Buffer,
    prefix: string,
    filename: string,
    contentType: string,
  ): Promise<UploadResult> {
    if (!this.backend.isAvailable()) {
      return { success: false, error: "Object Storage not configured" };
    }
    try {
      const hash = crypto
        .createHash("md5")
        .update(buffer.slice(0, 1000))
        .digest("hex")
        .slice(0, 8);
      const ext = filename.split(".").pop() || "bin";
      const key = `${prefix}/${Date.now()}-${hash}.${ext}`;
      await this.backend.putObject(key, buffer, {
        contentType,
        metadata: {
          "uploaded-at": new Date().toISOString(),
          "original-size": buffer.length.toString(),
          "original-filename": filename,
        },
      });
      const url = await this.backend.getSignedUrl(key, this.PRESIGN_EXPIRES);
      this.logger.log(
        `Uploaded file: ${key} (${Math.round(buffer.length / 1024)}KB) - URL valid for 7 days`,
      );
      return { success: true, url, key };
    } catch (error) {
      this.logger.error("Failed to upload buffer:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Upload failed",
      };
    }
  }

  /**
   * 流式上传（内存最优）——直接把 Readable（如 fs.createReadStream）透传给 backend，
   * 全程不在进程内驻留完整 Buffer。必须传 size（流的真实字节数，S3/R2 签名所需）。
   *
   * key 由随机 hash + 时间戳生成（不读流内容做 hash，避免消费流）；
   * 若当前 backend 未实现 putObjectStream，调用方应回退到 uploadBuffer。
   */
  async uploadStream(
    body: Readable,
    size: number,
    prefix: string,
    filename: string,
    contentType: string,
  ): Promise<UploadResult> {
    if (!this.backend.isAvailable()) {
      return { success: false, error: "Object Storage not configured" };
    }
    if (typeof this.backend.putObjectStream !== "function") {
      return {
        success: false,
        error: "Active storage backend does not support stream upload",
      };
    }
    try {
      const hash = crypto.randomBytes(4).toString("hex");
      const ext = filename.split(".").pop() || "bin";
      const key = `${prefix}/${Date.now()}-${hash}.${ext}`;
      await this.backend.putObjectStream(key, body, {
        contentLength: size,
        contentType,
        metadata: {
          "uploaded-at": new Date().toISOString(),
          "original-size": size.toString(),
          "original-filename": filename,
        },
      });
      const url = await this.backend.getSignedUrl(key, this.PRESIGN_EXPIRES);
      this.logger.log(
        `Streamed file: ${key} (${Math.round(size / 1024)}KB) - URL valid for 7 days`,
      );
      return { success: true, url, key };
    } catch (error) {
      this.logger.error("Failed to stream upload:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Upload failed",
      };
    }
  }

  /** 预签名 URL */
  async getPresignedUrl(key: string): Promise<string> {
    if (!this.backend.isAvailable()) {
      throw new ServiceUnavailableException("Storage not configured");
    }
    return this.backend.getSignedUrl(key, this.PRESIGN_EXPIRES);
  }

  /** 用旧 URL 解出 key 后重新签名 */
  async refreshImageUrl(oldUrl: string): Promise<string | null> {
    const key = this.extractKeyFromUrl(oldUrl);
    if (!key) return null;
    try {
      return await this.getPresignedUrl(key);
    } catch (error) {
      this.logger.error(`Failed to refresh URL for key: ${key}`, error);
      return null;
    }
  }

  async deleteImage(key: string): Promise<boolean> {
    if (!this.backend.isAvailable()) return false;
    return this.backend.deleteObject(key);
  }

  /**
   * List objects（用于 storage governance / inventory）
   * 委托给 backend.listObjects（W2-A 引入端口方法替代历史 getS3Client 直调）。
   */
  async listObjects(options?: {
    continuationToken?: string;
    maxKeys?: number;
  }): Promise<{
    objects: Array<{ key: string; size: number }>;
    nextContinuationToken?: string;
    isTruncated: boolean;
  }> {
    if (!this.backend.isAvailable()) {
      return { objects: [], isTruncated: false };
    }
    return this.backend.listObjects(options);
  }

  extractKeyFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      const bucketPrefix = `/${this.backend.getBucketName()}/`;
      if (path.startsWith(bucketPrefix)) {
        return path.slice(bucketPrefix.length);
      }
      return path.startsWith("/") ? path.slice(1) : path;
    } catch {
      return null;
    }
  }

  /** 上传文本（不返回 signed URL；调用方走后端代理下载） */
  async uploadText(
    content: string,
    key: string,
    contentType = "text/markdown; charset=utf-8",
  ): Promise<UploadResult> {
    if (!this.backend.isAvailable()) {
      return { success: false, error: "Object Storage not configured" };
    }
    try {
      const buffer = Buffer.from(content, "utf-8");
      await this.backend.putObject(key, buffer, {
        contentType,
        metadata: {
          "uploaded-at": new Date().toISOString(),
          "original-size": buffer.length.toString(),
        },
      });
      this.logger.log(
        `Uploaded text: ${key} (${Math.round(buffer.length / 1024)}KB)`,
      );
      return { success: true, key };
    } catch (error) {
      this.logger.error(`Failed to upload text ${key}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Upload failed",
      };
    }
  }

  async downloadText(key: string): Promise<string | null> {
    if (!this.backend.isAvailable()) return null;
    const buf = await this.backend.getObject(key);
    if (!buf) return null;
    return buf.toString("utf-8");
  }

  async deleteObject(key: string): Promise<boolean> {
    return this.deleteImage(key);
  }

  async uploadMultiple(
    images: Array<{ base64: string; prefix?: string }>,
  ): Promise<UploadResult[]> {
    return mapWithConcurrency(
      images,
      (img) => this.uploadBase64Image(img.base64, img.prefix),
      ConcurrencyLimits.FILE,
    );
  }
}
