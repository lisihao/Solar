/**
 * Search Fusion 通用工具集 — Phase 8 沉淀
 *
 * 沉淀自 TI search/fusion，提取纯算法部分，供所有 ai-app 复用：
 *   - consumer 未来引入 search 时不重写
 *   - 其他 ai-app（如 office）的搜索能力可复用
 */

export {
  type IndexedItem,
  normalizeUrl,
  dedupeByUrlAndTitle,
  tokenizeQuery,
  computeRelevanceScore,
  extractDomain,
  enforceDomainDiversity,
} from "./result-fusion.utils";

export {
  type SuggestedSearchAction,
  type QualityGateInput,
  type QualityGateContext,
  type QualityGateItem,
  type QualityVerdict,
  evaluateSearchQuality,
} from "./quality-gate.utils";
