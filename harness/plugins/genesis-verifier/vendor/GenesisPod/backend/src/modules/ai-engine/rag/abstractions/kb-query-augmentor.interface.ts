/**
 * KB Query Augmentor — Dependency Inversion port (PR-Wiki-Aug 2026-05-10)
 *
 * Lets ai-engine consumers (such as the `rag-search` tool used by L3 AI
 * apps that need internal-knowledge retrieval) optionally upgrade a plain
 * RAG query into a wiki-aware query without taking a source-code
 * dependency on `ai-app/library/kb-query`. The implementation lives in
 * ai-app (KbQueryService); the port lives here in ai-engine so the layer
 * direction stays L3 → L2 only.
 *
 * Same Dependency Inversion pattern as `engine-skill-provider.adapter.ts`
 * — already an allowlisted reverse-import in
 * `__tests__/architecture/layer-boundaries.spec.ts`.
 *
 * Contract: same shape as `RAGPipelineService.simpleQuery` so the tool
 * can swap the call destination 1:1 — `searchService.simpleQuery(...)`.
 * The augmentor itself decides whether to use wiki / chunk RAG / merge
 * — the consumer doesn't care.
 */

import type { SearchResult } from "../pipeline/rag-pipeline.interface";

/**
 * W4 v2.0 rebuild (2026-05-12): canonical wiki page read shape returned to
 * tools that want to traverse the wiki graph (e.g. follow [[slug]] cross-
 * links). Defined here in ai-engine rather than ai-app so the tool stays
 * source-code-agnostic of the WikiPage Prisma model.
 */
export interface WikiPageRead {
  knowledgeBaseId: string;
  slug: string;
  locale: string;
  title: string;
  category: "ENTITY" | "CONCEPT" | "SUMMARY" | "SOURCE";
  body: string;
  oneLiner: string;
  /** Slugs this page links to via [[slug]] markdown refs. */
  outboundLinks: string[];
  /** Slugs of pages that link back to this one. */
  backlinks: string[];
  updatedAt: string;
}

export interface IKbQueryAugmentor {
  simpleQuery(
    query: string,
    knowledgeBaseIds: string[],
    topK?: number,
  ): Promise<SearchResult[]>;

  /**
   * Slug-based wiki page read used by the `wiki-page-read` engine tool to
   * fetch a specific page (so agents can follow [[slug]] cross-links).
   * Returns null when wiki is disabled / page is missing / userId lacks
   * access. Optional so providers that only implement query can still
   * conform — but in practice KbQueryService implements both.
   */
  getWikiPage?(
    userId: string,
    knowledgeBaseId: string,
    slug: string,
    locale?: "zh" | "en",
  ): Promise<WikiPageRead | null>;
}

/**
 * NestJS DI token. KbQueryModule (ai-app/library/kb-query) registers
 * KbQueryService against this token via `useExisting` and exports it as a
 * `@Global()` provider so the rag-search tool sees it everywhere without
 * an explicit module import.
 */
export const KB_QUERY_AUGMENTOR = Symbol("KB_QUERY_AUGMENTOR");
