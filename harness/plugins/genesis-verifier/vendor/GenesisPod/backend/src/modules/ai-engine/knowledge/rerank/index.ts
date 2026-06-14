/**
 * ai-engine/knowledge/rerank —— LLM Reranker（项目唯一权威实现）
 *
 * RAG 两阶段检索的第二阶段：对 fusion 后的候选集做 LLM 精排。
 * Generic over T extends RerankableItem，让任意 ai-app 的 retrieval item 类型可用。
 *
 * 归 ai-engine/knowledge/：搜索精排是无 agent 状态的引擎基元，直接注入
 * AiChatService（L2 内层调用，与 image module 同款），不经 ChatFacade。
 *
 * W1（2026-06-04）同名概念去重：删除 ai-app/insight 本地副本，insight 经
 * ai-engine/facade 统一消费此处。spec 看护见 standards/16 §五·补 律5。
 */

export { LlmRerankerAdapter } from "./llm-reranker.adapter";
export {
  type RerankableItem,
  type RerankCandidate,
  type RerankedItem,
  type RerankResult,
  type RerankRequest,
  type RerankAdapter,
  type RerankConfig,
  DEFAULT_RERANK_CONFIG,
} from "./rerank.types";
