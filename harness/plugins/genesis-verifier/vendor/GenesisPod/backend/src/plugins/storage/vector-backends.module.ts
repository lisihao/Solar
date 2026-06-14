/**
 * VectorBackendsModule — @Global 暴露 IVectorBackend 数组
 * （v5.1 R0.5-E W2-B 部署平台差异驱动的真 plugin）
 *
 * AppModule import 一次。VectorService 通过 VECTOR_BACKENDS_TOKEN 拿数组，
 * 按 isAvailable() 选第一个可用 backend，不直接 import 任何 plugin 实现。
 *
 * 加新 backend（如 Qdrant / Pinecone）：
 *   1. plugins/storage/vector-qdrant/ 实现 IVectorBackend
 *   2. 加进 providers + useFactory 数组
 */
import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { VECTOR_BACKENDS_TOKEN } from "@/plugins/core/abstractions";
import { PgvectorBackend } from "./vector-pgvector";
import { JsonbBackend } from "./vector-jsonb";

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    PgvectorBackend,
    JsonbBackend,
    {
      provide: VECTOR_BACKENDS_TOKEN,
      useFactory: (pg: PgvectorBackend, jb: JsonbBackend) => [pg, jb],
      inject: [PgvectorBackend, JsonbBackend],
    },
  ],
  exports: [VECTOR_BACKENDS_TOKEN],
})
export class VectorBackendsModule {}
