import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { AiEngineModule } from "../../../ai-engine/ai-engine.module";
import { KB_QUERY_AUGMENTOR } from "../../../ai-engine/rag/abstractions/kb-query-augmentor.interface";
import { WikiModule } from "../wiki/wiki.module";
import { KbQueryService } from "./kb-query.service";

/**
 * KbQueryModule — exports the unified KB query facade (PR-2) and the
 * KB_QUERY_AUGMENTOR DI port (PR-Wiki-Playground 2026-05-10).
 *
 * Composition:
 *  - WikiModule provides WikiSourceProvider (BM25 over WikiPage)
 *  - AiEngineModule provides RAGPipelineService (chunk RAG)
 *
 * Two consumption paths:
 *  - L3 ai-app modules (ai-ask, future topic-insights/teams …) inject
 *    `KbQueryService` directly via this module's exports
 *  - L2 ai-engine tools (`rag-search` and friends) `@Optional()` inject
 *    via the `KB_QUERY_AUGMENTOR` DI token — Dependency Inversion that
 *    keeps ai-engine wiki-agnostic at source-code level
 *
 * `@Global()` so the KB_QUERY_AUGMENTOR provider is visible everywhere
 * after one root import. Without `@Global()` the rag-search tool (in
 * AiEngineModule) wouldn't see it; explicitly importing KbQueryModule
 * into AiEngineModule would create a layer-direction cycle (engine
 * importing app at module level).
 */
@Global()
@Module({
  imports: [PrismaModule, AiEngineModule, WikiModule],
  providers: [
    KbQueryService,
    {
      provide: KB_QUERY_AUGMENTOR,
      useExisting: KbQueryService,
    },
  ],
  exports: [KbQueryService, KB_QUERY_AUGMENTOR],
})
export class KbQueryModule {}
