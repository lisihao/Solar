/**
 * RAG Module Exports
 *
 * 核心能力从 AI Engine 重新导出
 * 业务服务从本模块导出
 */

export * from "./rag.module";

// 从 AI Engine Facade 重新导出核心能力 (向后兼容)
export {
  EmbeddingService,
  VectorService,
  DocumentChunker,
  DEFAULT_CHUNKING_CONFIG,
} from "@/modules/ai-harness/facade";
export type {
  EmbeddingResult,
  EmbeddingBatch,
  SimilaritySearchOptions,
  SimilarityResult,
  VectorSearchResult,
  ChildChunkData,
  ParentChunkData,
  ChunkedDocument,
  EmbeddingModelConfig,
  ChunkingConfig,
} from "@/modules/ai-harness/facade";

// 业务服务
export * from "./services/document-processor.service";
export * from "./services/embedding-processor.service";
// rag-pipeline.service shim removed (PR-X25); consumers import RAGPipelineService
// directly from "@/modules/ai-harness/facade".
export * from "./services/knowledge-base.service";
export * from "./services/google-drive-rag.service";

// rag.interfaces shim removed (PR-X25); consumers import RAG types directly
// from "@/modules/ai-harness/facade".
export * from "./dto";
