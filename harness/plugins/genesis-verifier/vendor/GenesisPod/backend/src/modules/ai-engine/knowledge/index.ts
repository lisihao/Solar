/**
 * AI Engine Knowledge
 * 知识管理模块 - 聚合 RAG、Memory、Evidence 子模块（Search 已迁 content/web-search）
 * Note: 直接导入各子模块以避免命名冲突
 */

// Sub-modules are imported directly by their paths to avoid name conflicts
// (rag 的 SearchResult 与 content/web-search 的 WebSearchResult 已解撞名)
// Use: import { EmbeddingService } from "@/modules/ai-engine/rag/embedding"
//      SearchService 已迁 content/web-search（W5）
