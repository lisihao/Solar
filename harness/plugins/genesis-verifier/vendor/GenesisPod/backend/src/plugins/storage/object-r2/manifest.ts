/**
 * object-r2 backend manifest（v5.1 R0.5-E W2-A）
 *
 * Cloudflare R2，通过 @aws-sdk/client-s3 走 S3-compatible API。
 * 是 IObjectStorageBackend 端口的第一个 backend；S3 native / GCS / Azure Blob /
 * local-fs 等其他部署平台 backend 按 §〇.3 反应式抽取触发新增。
 */
export const OBJECT_R2_MANIFEST = {
  id: "storage/object-r2",
  version: "1.0.0",
  description:
    "Cloudflare R2 object storage backend (S3-compatible API via @aws-sdk/client-s3)",
  category: "storage",
  type: "backend" as const,
  port: "IObjectStorageBackend",
  alternatives: [
    "storage/object-s3", // future: AWS S3 native
    "storage/object-gcs", // future: GCS (S3-mode 或 native)
    "storage/object-azure-blob", // future: Azure Blob native API
    "storage/object-local-fs", // future: dev / self-hosted local fs
  ],
  envRequired: [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
  ],
  homepage: "https://github.com/anthropics/genesis-agent-teams",
} as const;
