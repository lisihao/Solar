/**
 * ObjectStorageModule — @Global 暴露 IObjectStorageBackend
 * （v5.1 R0.5-E W2-A 部署平台差异驱动的真 plugin）
 *
 * AppModule import 一次。platform/storage 的 ObjectStorageService 通过
 * OBJECT_STORAGE_BACKEND_TOKEN 拿 active backend，不 import 任何具体 plugin。
 *
 * 当前 active backend：R2（凭 R2_* ENV 自动启用）
 *
 * 未来加 backend：
 *   1. plugins/storage/object-{s3,gcs,azure-blob,local-fs}/ 实现 IObjectStorageBackend
 *   2. 在下面 useFactory 加优先级序列：返回第一个 isAvailable() 的 backend
 */
import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { OBJECT_STORAGE_BACKEND_TOKEN } from "@/plugins/core/abstractions";
import type { IObjectStorageBackend } from "@/plugins/core/abstractions";
import { R2ObjectStorageBackend } from "./object-r2";

/**
 * Boot 期初始化所有 backend，挑第一个可用的暴露给 token。
 * 顺序 = 优先级（按部署平台需求调整）。
 */
async function selectActiveBackend(
  ...candidates: IObjectStorageBackend[]
): Promise<IObjectStorageBackend> {
  for (const c of candidates) {
    try {
      await c.init?.();
    } catch (err) {
      console.warn(
        `[ObjectStorage] backend ${c.id} init failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  const chosen = candidates.find((c) => c.isAvailable());
  if (chosen) return chosen;
  // 全部不可用 → 返回第一个（保持 isAvailable=false 让 service 显式报错）
  return candidates[0];
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    R2ObjectStorageBackend,
    {
      provide: OBJECT_STORAGE_BACKEND_TOKEN,
      useFactory: async (r2: R2ObjectStorageBackend) =>
        // 当前唯一 backend：R2。未来加新 backend 在此扩展数组：
        //   selectActiveBackend(r2, s3, gcs, azureBlob, localFs)
        selectActiveBackend(r2),
      inject: [R2ObjectStorageBackend],
    },
  ],
  exports: [OBJECT_STORAGE_BACKEND_TOKEN],
})
export class ObjectStorageModule {}
