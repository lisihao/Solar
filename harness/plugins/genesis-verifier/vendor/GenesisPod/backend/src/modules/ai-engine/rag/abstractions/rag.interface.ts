/**
 * RAG Pipeline Service Interface
 * RAG 检索服务抽象接口 - 供 AI Engine 使用
 *
 * 解决问题: AiController 不应直接依赖 AI Apps 的具体实现
 * 实现位置: backend/src/modules/ai-app/rag/
 */

export interface IRAGPipelineService {
  /**
   * 执行 RAG 查询
   */
  query(request: {
    query: string;
    knowledgeBaseIds: string[];
    options?: {
      topK?: number;
      useHyde?: boolean;
      useRerank?: boolean;
      minScore?: number;
      hybridAlpha?: number;
      includeMetadata?: boolean;
    };
  }): Promise<{
    context?: {
      text: string;
      sources: Array<{
        documentTitle: string;
        excerpt: string;
        score: number;
        metadata?: Record<string, unknown>;
      }>;
    };
    metadata?: {
      totalResults: number;
      queryTime: number;
      usedHyde?: boolean;
      usedRerank?: boolean;
    };
  }>;
}

/**
 * Injection Token for RAG Pipeline Service
 */
export const RAG_PIPELINE_SERVICE_TOKEN = Symbol("RAG_PIPELINE_SERVICE");
