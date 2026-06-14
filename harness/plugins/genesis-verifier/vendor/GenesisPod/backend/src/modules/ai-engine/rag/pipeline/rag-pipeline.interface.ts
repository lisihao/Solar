/**
 * RAG Pipeline Interfaces
 * RAG 检索管道类型定义 - AI Engine 核心能力层
 *
 * 从 ai-app/rag/interfaces/rag.interfaces.ts 迁移
 * 仅包含 Pipeline 特有的类型，通用类型从 chunking/embedding 重导出
 */

// Shared types (ChunkingConfig, DEFAULT_CHUNKING_CONFIG, ChildChunkData, ParentChunkData)
// are exported from ../chunking via rag/index.ts — do NOT re-export here to avoid duplicates

// ==================== Query & Response ====================

export interface RAGQuery {
  query: string;
  knowledgeBaseIds: string[];
  options?: RAGOptions;
}

export interface RAGOptions {
  topK?: number; // Number of results to retrieve (default: 10)
  useHyde?: boolean; // Use HyDE query enhancement (default: true)
  useRerank?: boolean; // Use Cohere reranking (default: true)
  hybridAlpha?: number; // Balance between vector/keyword (0-1, default: 0.5)
  minScore?: number; // Minimum relevance score (default: 0.3)
  includeMetadata?: boolean; // Include document metadata (default: true)
}

// ★ 全覆盖审计修 (2026-05-06): vector search 降级信号，调用方可读此字段 emit 业务事件
export type RAGQuality = "full" | "degraded";

export interface RAGResponse {
  context: RAGContext;
  hydeQuery?: string;
  searchResults: SearchResult[];
  processingTime: {
    hyde?: number;
    search: number;
    rerank?: number;
    total: number;
  };
  /** ★ 全覆盖审计修 (2026-05-06): 'degraded' = vector search 失败，结果仅来自 keyword search */
  quality: RAGQuality;
  /** vector search 降级时的原因描述，quality='full' 时为 undefined */
  degradedReason?: string;
}

export interface RAGContext {
  text: string;
  sources: ContextSource[];
  totalTokens: number;
}

export interface ContextSource {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  excerpt: string;
  score: number;
  pageStart?: number;
  pageEnd?: number;
  sectionTitle?: string;
  metadata?: Record<string, unknown>;
}

// ==================== Search ====================

export interface SearchResult {
  childChunkId: string;
  parentChunkId: string;
  documentId: string;
  content: string;
  parentContent: string;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
  rerankScore?: number;
  metadata?: Record<string, unknown>;
}

export interface HybridSearchParams {
  queryEmbedding: number[];
  queryText: string;
  knowledgeBaseIds: string[];
  topK: number;
  alpha: number; // 0 = keyword only, 1 = vector only
}

// ==================== Document Processing ====================

export interface ProcessedDocument {
  documentId: string;
  title: string;
  parentChunks: import("../chunking").ParentChunkData[];
  metadata: DocumentMetadata;
}

export interface DocumentMetadata {
  sourceType: string;
  sourceId?: string;
  sourceUrl?: string;
  mimeType?: string;
  fileSize?: number;
  processedAt: Date;
}

// Embedding types (EmbeddingResult, EmbeddingBatch) are exported from
// ../embedding via rag/index.ts — do NOT re-export here to avoid duplicates

// ==================== Knowledge Base ====================

export interface KnowledgeBaseStats {
  documentCount: number;
  parentChunkCount: number;
  childChunkCount: number;
  embeddingCount: number;
  totalTokens: number;
  lastSyncedAt?: Date;
}

// ==================== Sync ====================

export interface SyncResult {
  added: number;
  updated: number;
  deleted: number;
  errors: string[];
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
  webViewLink?: string;
}
