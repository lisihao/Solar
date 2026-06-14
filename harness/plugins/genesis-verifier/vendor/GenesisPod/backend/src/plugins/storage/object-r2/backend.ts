/**
 * R2 object storage backend（v5.1 R0.5-E W2-A，IObjectStorageBackend 实现）
 *
 * 用 @aws-sdk/client-s3 走 R2 的 S3-compatible 接口。
 * R2 endpoint: https://${ACCOUNT_ID}.r2.cloudflarestorage.com
 *
 * Backend 自身只做 primitive ops（put/get/delete/signedUrl）。高级 helper
 * （uploadBase64Image / uploadText）留在 platform/storage/ObjectStorageService。
 */
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "stream";
import type {
  IObjectStorageBackend,
  PutObjectOptions,
  PutObjectStreamOptions,
} from "@/plugins/core/abstractions";

@Injectable()
export class R2ObjectStorageBackend implements IObjectStorageBackend {
  readonly id = "r2";
  private readonly logger = new Logger(R2ObjectStorageBackend.name);
  private s3Client: S3Client | null = null;
  private bucketName!: string;
  private configured = false;

  constructor(private readonly configService: ConfigService) {}

  async init(): Promise<void> {
    this.bucketName =
      this.configService.get<string>("R2_BUCKET_NAME") || "genesis-reports";
    const accountId = this.configService.get<string>("R2_ACCOUNT_ID");
    const accessKeyId = this.configService.get<string>("R2_ACCESS_KEY_ID");
    const secretAccessKey = this.configService.get<string>(
      "R2_SECRET_ACCESS_KEY",
    );
    if (!accountId || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        "R2 not configured — set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY",
      );
      this.configured = false;
      return;
    }
    this.s3Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    this.configured = true;
    this.logger.log(`R2 backend ready (bucket: ${this.bucketName})`);
  }

  isAvailable(): boolean {
    return this.configured && this.s3Client !== null;
  }

  getBucketName(): string {
    return this.bucketName;
  }

  /** 内部：暴露原 S3Client（仅给同 plugin 使用，避免破坏封装） */
  getS3Client(): S3Client | null {
    return this.s3Client;
  }

  async putObject(
    key: string,
    body: Buffer,
    options?: PutObjectOptions,
  ): Promise<void> {
    if (!this.s3Client) throw new Error("R2 backend not configured");
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: options?.contentType,
        Metadata: options?.metadata as Record<string, string> | undefined,
      }),
    );
  }

  /**
   * 流式写入：PutObjectCommand.Body 接受 Readable，配合 ContentLength 即可不缓冲整流。
   * R2/S3 在 body 非 Buffer/string 时要求显式 ContentLength，否则无法计算签名/分片。
   */
  async putObjectStream(
    key: string,
    body: Readable,
    options: PutObjectStreamOptions,
  ): Promise<void> {
    if (!this.s3Client) throw new Error("R2 backend not configured");
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentLength: options.contentLength,
        ContentType: options.contentType,
        Metadata: options.metadata as Record<string, string> | undefined,
      }),
    );
  }

  async getObject(key: string): Promise<Buffer | null> {
    if (!this.s3Client) return null;
    try {
      const res = await this.s3Client.send(
        new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      if (!res.Body) return null;
      const text = await res.Body.transformToByteArray();
      return Buffer.from(text);
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === "NoSuchKey") return null;
      this.logger.warn(`getObject ${key} failed: ${(err as Error).message}`);
      return null;
    }
  }

  async deleteObject(key: string): Promise<boolean> {
    if (!this.s3Client) return false;
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      return true;
    } catch (err) {
      this.logger.warn(`deleteObject ${key} failed: ${(err as Error).message}`);
      return false;
    }
  }

  async getSignedUrl(key: string, expiresInSec: number): Promise<string> {
    if (!this.s3Client) throw new Error("R2 backend not configured");
    return getSignedUrl(
      this.s3Client,
      new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
      { expiresIn: expiresInSec },
    );
  }

  async listObjects(options?: {
    continuationToken?: string;
    maxKeys?: number;
  }): Promise<{
    objects: Array<{ key: string; size: number }>;
    nextContinuationToken?: string;
    isTruncated: boolean;
  }> {
    if (!this.s3Client) {
      return { objects: [], isTruncated: false };
    }
    const res = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.bucketName,
        ContinuationToken: options?.continuationToken,
        MaxKeys: options?.maxKeys ?? 1000,
      }),
    );
    return {
      objects: (res.Contents ?? [])
        .filter((o) => !!o.Key)
        .map((o) => ({ key: o.Key as string, size: o.Size ?? 0 })),
      nextContinuationToken: res.NextContinuationToken,
      isTruncated: !!res.IsTruncated,
    };
  }
}
