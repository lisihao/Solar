/**
 * Synthesis Types
 * AI Engine 核心能力 - 报告合成通用类型定义
 */

/**
 * 报告章节
 */
export interface SynthesisSection {
  title: string;
  content: string;
  citations?: number[];
  sources?: SourceReference[];
}

/**
 * 来源引用
 */
export interface SourceReference {
  id: number;
  title: string;
  url?: string;
  snippet?: string;
  domain?: string;
  publishedDate?: string;
  accessedAt?: Date;
}

/**
 * 一致性检查结果
 */
export interface ConsistencyResult {
  isConsistent: boolean;
  score: number; // 0-1
  issues: ConsistencyIssue[];
  suggestions: string[];
}

/**
 * 一致性问题
 */
export interface ConsistencyIssue {
  type:
    | "contradiction"
    | "unsupported_claim"
    | "missing_citation"
    | "factual_error";
  severity: "high" | "medium" | "low";
  location: string;
  description: string;
  suggestedFix?: string;
}

/**
 * 章节生成配置
 */
export interface SectionConfig {
  maxTokens?: number;
  creativity?: "deterministic" | "low" | "medium" | "high";
  language?: string;
  style?: "academic" | "business" | "casual";
}

/**
 * 引用格式
 */
export type CitationFormat = "apa" | "numbered" | "inline";
