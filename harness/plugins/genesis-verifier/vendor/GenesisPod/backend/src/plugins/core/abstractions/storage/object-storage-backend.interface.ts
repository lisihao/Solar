/**
 * IObjectStorageBackend — 对象存储端口（v5.1 R0.5-E W2-A）
 *
 * 部署平台差异驱动的真 plugin 候选（满足 §〇.1 三条充要条件）：
 *   - Cloudflare R2（S3-API endpoint）
 *   - AWS S3 native
 *   - GCS S3-mode
 *   - Azure Blob native API（结构差异，非 S3）
 *   - 本地 fs（dev / self-hosted）
 *   - IPFS / Arweave 等去中心化方案
 *
 * 由 plugins/storage/object-storage.module 通过 OBJECT_STORAGE_BACKEND_TOKEN
 * 注入给 platform/storage 的 ObjectStorageService（orchestrator）。
 */

export interface ObjectMetadata {
  readonly [key: string]: string;
}

export interface PutObjectOptions {
  readonly contentType?: string;
  readonly metadata?: ObjectMetadata;
}

/**
 * 流式写入的额外约束：S3/R2 的 PutObjectCommand 接受 Readable body，
 * 但非 Buffer/string body 必须显式传 ContentLength（SDK 无法预知流长度）。
 * contentLength 必须等于流的真实字节数，否则上传被服务端截断/报错。
 */
export interface PutObjectStreamOptions extends PutObjectOptions {
  readonly contentLength: number;
}

export interface IObjectStorageBackend {
  /** Backend 唯一标识（"r2" / "s3" / "gcs" / "local-fs" 等） */
  readonly id: string;

  /** 启动期初始化 */
  init?(): Promise<void>;

  /** Backend 是否可用（凭据齐全 + 连通） */
  isAvailable(): boolean;

  /** 写入对象（覆盖语义） */
  putObject(
    key: string,
    body: Buffer,
    options?: PutObjectOptions,
  ): Promise<void>;

  /**
   * 流式写入对象（覆盖语义）——body 为 Readable 流，全程不在进程内驻留完整 Buffer，
   * 适合大文件 / 高并发上传（内存最优）。必须在 options.contentLength 传流的真实字节数。
   * 不支持流式上传的 backend（如 local-fs 可走 fs.copy）可不实现此可选方法；
   * 调用方需在缺失时回退到 putObject(Buffer)。
   */
  putObjectStream?(
    key: string,
    body: import("stream").Readable,
    options: PutObjectStreamOptions,
  ): Promise<void>;

  /** 读取对象。不存在返回 null */
  getObject(key: string): Promise<Buffer | null>;

  /** 删除对象。返回 true=删成功 / false=不存在或失败 */
  deleteObject(key: string): Promise<boolean>;

  /**
   * 生成可下载的预签名 URL（私有 bucket / 临时访问）。
   * 不支持 signed URL 的 backend（如 local-fs）应返回直链。
   */
  getSignedUrl(key: string, expiresInSec: number): Promise<string>;

  /** Bucket / namespace 名（用于 URL 解析等） */
  getBucketName(): string;

  /**
   * 列对象（用于存储治理 / inventory）
   */
  listObjects(options?: {
    continuationToken?: string;
    maxKeys?: number;
  }): Promise<{
    objects: Array<{ key: string; size: number }>;
    nextContinuationToken?: string;
    isTruncated: boolean;
  }>;
}

/** DI token：注入 IObjectStorageBackend 实例（仅一个 active backend） */
export const OBJECT_STORAGE_BACKEND_TOKEN = "OBJECT_STORAGE_BACKEND_TOKEN";
