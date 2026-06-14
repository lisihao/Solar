/**
 * Multi-Language Research Types
 *
 * P0: 多语言深度研究
 * 跨语言证据融合，支持多语言查询生成和结果归一化
 */

/**
 * 支持的研究语言
 */
export enum ResearchLanguage {
  EN = "en",
  ZH = "zh",
  JA = "ja",
  KO = "ko",
  DE = "de",
  FR = "fr",
  ES = "es",
  PT = "pt",
  RU = "ru",
  AR = "ar",
}

/**
 * 语言检测结果
 */
export interface LanguageDetectionResult {
  /** 检测到的主要语言 */
  primaryLanguage: ResearchLanguage;
  /** 语言置信度 */
  confidence: number;
  /** 是否包含多种语言 */
  isMultilingual: boolean;
  /** 所有检测到的语言及其占比 */
  languageDistribution: Array<{
    language: ResearchLanguage;
    percentage: number;
  }>;
}

/**
 * 跨语言查询请求
 */
export interface CrossLanguageQueryRequest {
  /** 原始查询 */
  originalQuery: string;
  /** 原始语言 */
  sourceLanguage: ResearchLanguage;
  /** 目标语言列表 */
  targetLanguages: ResearchLanguage[];
  /** 研究领域上下文 */
  domainContext?: string;
  /** 是否保留专业术语 */
  preserveTerminology?: boolean;
}

/**
 * 跨语言查询结果
 */
export interface CrossLanguageQueryResult {
  /** 原始查询 */
  originalQuery: string;
  /** 翻译后的查询（按语言） */
  translatedQueries: Record<ResearchLanguage, string>;
  /** 跨语言关键术语映射 */
  terminologyMapping: Array<{
    term: string;
    translations: Record<ResearchLanguage, string>;
    isProperNoun: boolean;
  }>;
}

/**
 * 多语言证据归一化请求
 */
export interface EvidenceNormalizationRequest {
  /** 证据内容 */
  content: string;
  /** 证据来源语言 */
  sourceLanguage: ResearchLanguage;
  /** 目标归一化语言 */
  targetLanguage: ResearchLanguage;
  /** 证据标题 */
  title?: string;
  /** 证据摘要 */
  snippet?: string;
}

/**
 * 归一化后的证据
 */
export interface NormalizedEvidence {
  /** 原始内容 */
  originalContent: string;
  /** 翻译后内容 */
  translatedContent: string;
  /** 原始语言 */
  sourceLanguage: ResearchLanguage;
  /** 翻译后标题 */
  translatedTitle?: string;
  /** 翻译后摘要 */
  translatedSnippet?: string;
  /** 翻译质量评估 (0-1) */
  translationQuality: number;
  /** 文化上下文注释 */
  culturalNotes?: string[];
}

/**
 * 多语言研究配置
 */
export interface MultiLanguageConfig {
  /** 是否启用多语言研究 */
  enabled: boolean;
  /** 主要研究语言 */
  primaryLanguage: ResearchLanguage;
  /** 辅助搜索语言 */
  supplementaryLanguages: ResearchLanguage[];
  /** 结果归一化语言 */
  normalizationLanguage: ResearchLanguage;
  /** 每种语言最大结果数 */
  maxResultsPerLanguage: number;
  /** 是否自动检测话题语言 */
  autoDetectLanguage: boolean;
}

/**
 * 多语言研究统计
 */
export interface MultiLanguageStats {
  /** 各语言证据数量 */
  evidenceByLanguage: Record<ResearchLanguage, number>;
  /** 跨语言引用数 */
  crossLanguageCitations: number;
  /** 翻译质量平均分 */
  avgTranslationQuality: number;
  /** 覆盖语言数 */
  languagesCovered: number;
}
