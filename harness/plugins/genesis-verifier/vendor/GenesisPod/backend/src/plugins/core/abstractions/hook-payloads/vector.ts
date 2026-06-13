/**
 * VECTOR_QUERY hook payload
 *
 * Fire point：rag pipeline 的向量查询入口
 * Plugin 用例：
 *   - 切换 vector backend（pgvector / qdrant / pinecone / weaviate）
 *   - 查询前置过滤（按 namespace / tenant 注入条件）
 *   - 命中缓存（replacePayload 注入 cached results）
 */

export interface VectorQueryPayload {
  /** 查询向量 */
  readonly queryEmbedding: ReadonlyArray<number>;
  /** namespace / 集合名 */
  readonly namespace?: string;
  /** topK */
  readonly topK: number;
  /** 元数据过滤条件 */
  readonly filter?: Readonly<Record<string, unknown>>;
}

export interface VectorQueryResultPayload {
  readonly hits: ReadonlyArray<{
    readonly id: string;
    readonly score: number;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }>;
}
