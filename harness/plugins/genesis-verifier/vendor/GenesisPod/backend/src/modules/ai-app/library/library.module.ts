import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { LibraryContentSourceProvider } from "./integrations/library-content-source.provider";

/**
 * LibraryModule
 *
 * Aggregates Library-wide cross-cutting providers. Sub-modules
 * (NotesModule, RAGModule, CollectionsModule, etc.) are registered
 * separately in app.module.ts and import their own dependencies.
 *
 * This module's sole current responsibility is to register
 * LibraryContentSourceProvider so that user-authored Library content
 * (notes + kb-documents) is exposed as a generic ContentSource. The
 * provider is auto-discovered by the engine ContentSourceRegistry via
 * DiscoveryService at runtime (no multi-provider tokens involved).
 */
@Module({
  imports: [PrismaModule],
  providers: [
    // Generic ContentSource — auto-discovered by engine ContentSourceRegistry
    LibraryContentSourceProvider,
  ],
  exports: [LibraryContentSourceProvider],
})
export class LibraryModule {}
