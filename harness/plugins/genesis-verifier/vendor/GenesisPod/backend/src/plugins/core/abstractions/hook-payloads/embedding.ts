/**
 * EMBEDDING_REQUEST hook payload (R0.5-E B-#6)
 *
 * Fire point：ai-engine/rag/embedding/embedding.service.ts.embed()
 * Plugin 用例：
 *   - voyage / jina / mistral 等 embedding fallback provider
 *   - 缓存（替换 payload 注入 cached vector）
 *   - 离线 mock / fixture 注入（spec / dev）
 */

export interface EmbeddingRequestPayload {
  /** 输入文本（单条 / 批量） */
  readonly inputs: ReadonlyArray<string>;
  /** 当前选用的 model id（OpenAI text-embedding-3-small 等） */
  readonly modelId: string;
  /** provider slug（openai / voyage / google ...） */
  readonly provider: string;
  /** 当前 user（BYOK 上下文，可空） */
  readonly userId?: string;
  /** 维度提示（如 1536），plugin 可校验 */
  readonly dimensions?: number;
}

export interface EmbeddingResponsePayload {
  /** 向量结果（embeddings.length === inputs.length） */
  readonly embeddings: ReadonlyArray<ReadonlyArray<number>>;
  /** 实际使用的 model（plugin 可能改换 provider） */
  readonly modelId: string;
  readonly provider: string;
  /** token 用量 */
  readonly tokensUsed?: number;
}
