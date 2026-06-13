import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { AiEngineModule } from "../../../ai-engine/ai-engine.module";
import { CreditsModule } from "../../../platform/credits/credits.module";
import { KeyResolverModule } from "../../../platform/credentials/resolution/key-resolver/key-resolver.module";
import { RAGModule } from "../rag/rag.module";
import { PromptSkillBridge } from "@/modules/ai-harness/facade";
import { SkillLoaderService } from "@/modules/ai-engine/facade";

import { WikiPageService } from "./wiki-page.service";
import { WikiDiffService } from "./wiki-diff.service";
import { WikiIngestService } from "./wiki-ingest.service";
import { WikiAutoIngestScheduler } from "./wiki-auto-ingest.scheduler";
import { WikiLintService } from "./wiki-lint.service";
import { WikiLintScheduler } from "./wiki-lint.scheduler";
import { WikiQueryService } from "./wiki-query.service";
import { WikiSourceProvider } from "./wiki-source-provider.service";
import { WikiKbAdminService } from "./wiki-kb-admin.service";
import { WikiController } from "./wiki.controller";
import { WikiKbAdminController } from "./wiki-kb-admin.controller";
import { WIKI_SKILL_DOMAIN } from "./skills";

/**
 * LLM Wiki module (v1.5.3 P1).
 *
 * Imports:
 *  - PrismaModule for DB access
 *  - AiEngineModule for facade (slug-normalize / wiki-link-parser /
 *    sanitizeMarkdownBody / StaleDetectorService /
 *    CrossCuttingSynthesisService.detect{Contradictions,DataGaps})
 *  - RAGModule for KnowledgeBaseService.hasAccess (KB role checks)
 *  - CreditsModule for upcoming ingest LLM cost accounting (P2)
 *
 * Skill registration (llm-wiki §3.1 + §5.1 Step 3):
 *  - In onModuleInit, register `wiki/skills/` directory with domain="library"
 *    via SkillLoaderService, then bridge to SkillRegistry via
 *    PromptSkillBridge.registerDomain("library"). Mirrors the pattern used
 *    by research / writing / office-slides modules.
 *
 * Exports WikiPageService for testability and potential cross-app reuse
 * (e.g. an export job worker may stream pages without going through the
 * HTTP controller).
 */
@Module({
  imports: [
    PrismaModule,
    AiEngineModule,
    RAGModule,
    CreditsModule,
    KeyResolverModule,
  ],
  controllers: [WikiController, WikiKbAdminController],
  providers: [
    WikiPageService,
    WikiDiffService,
    WikiIngestService,
    WikiAutoIngestScheduler,
    WikiLintService,
    WikiLintScheduler,
    WikiQueryService,
    WikiSourceProvider,
    WikiKbAdminService,
  ],
  exports: [
    WikiPageService,
    WikiDiffService,
    WikiIngestService,
    WikiLintService,
    WikiQueryService,
    WikiSourceProvider,
    WikiKbAdminService,
  ],
})
export class WikiModule implements OnModuleInit {
  private readonly logger = new Logger(WikiModule.name);

  constructor(
    private readonly skillLoader: SkillLoaderService,
    private readonly promptSkillBridge: PromptSkillBridge,
  ) {}

  async onModuleInit(): Promise<void> {
    const path = await import("path");
    await this.skillLoader.addSkillDirectory({
      path: path.resolve(__dirname, "skills"),
      domain: WIKI_SKILL_DOMAIN,
      recursive: false,
    });

    try {
      const result =
        await this.promptSkillBridge.registerDomain(WIKI_SKILL_DOMAIN);
      this.logger.log(
        `Registered library/wiki skill domain: registered=${result.registered.length}, ` +
          `skipped=${result.skipped.length}, errors=${result.errors.length}`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to register library/wiki skill domain: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
