/**
 * ai-engine/content/citation —— 引用工具（沉淀自 {app}, 2026-04-29）
 *
 * 纯函数 utility，零 LLM 调用，零 DI 依赖。所有 ai-app 都可用。
 *
 * - extractCitationsWithContext: 提取 [N] 引用 + 上下文
 * - buildEvidenceFingerprint: 证据指纹
 * - scoreCitationMatch: 引用-证据相似度评分
 * - verifyCitations: 验证 + 纠正幻觉引用
 * - buildContiguousMapping / restoreGlobalIndices: 局部-全局编号映射（章节合并必备）
 */

export {
  type CitationWithContext,
  type EvidenceFingerprint,
  type CitationVerifyResult,
  type VerificationStats,
  type VerifyCitationsResult,
  type EvidenceForVerification,
  type LocalToGlobalMap,
  extractCitationsWithContext,
  buildEvidenceFingerprint,
  scoreCitationMatch,
  verifyCitations,
  buildContiguousMapping,
  restoreGlobalIndices,
} from "./citation-verifier.util";

// ★ Phase 9 沉淀 (2026-04-29): 5 种学术引用格式（APA/MLA/Chicago/IEEE/Harvard）
export {
  type CitationStyle,
  type SourceCategory,
  type CitationAuthor,
  type CitationMetadata,
  type FormattedCitation,
  type Bibliography,
  type RawEvidence,
  buildCitationMetadata,
  formatCitation,
  generateBibliography,
} from "./citation-formatting.util";
