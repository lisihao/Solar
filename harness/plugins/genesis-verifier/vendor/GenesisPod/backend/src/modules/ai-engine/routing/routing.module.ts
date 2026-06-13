/**
 * AiEngineRoutingModule —— engine 聚合之一（2026-06-02 扩出，全层共 12 个聚合）
 *
 * 提供项目唯一的"语义检索 + 多信号打分"路由 core，被 LLM / Tools / Skills 三处复用。
 * 见 standards/16 §二 与 docs/architecture/platform-review/2026-06-02-scored-router-sota-design.md。
 *
 * 依赖：AiEngineKnowledgeModule（导出 EmbeddingService）。无反向依赖、无 agent 状态。
 */

import { Module } from "@nestjs/common";
import { AiEngineKnowledgeModule } from "../knowledge/knowledge.module";
import { EmbeddingRouterPort } from "./embedding-router-port.adapter";
import { ScoredRouterService } from "./scored-router.service";
import { EMBEDDING_PORT, SCORED_ROUTER } from "./abstractions/routing.types";

@Module({
  imports: [AiEngineKnowledgeModule],
  providers: [
    EmbeddingRouterPort,
    { provide: EMBEDDING_PORT, useExisting: EmbeddingRouterPort },
    ScoredRouterService,
    { provide: SCORED_ROUTER, useExisting: ScoredRouterService },
  ],
  exports: [
    ScoredRouterService,
    SCORED_ROUTER,
    EmbeddingRouterPort,
    EMBEDDING_PORT,
  ],
})
export class AiEngineRoutingModule {}
