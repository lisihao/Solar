/**
 * Citation Types
 *
 * P1: 引用格式标准化
 * 支持 APA/MLA/Chicago/IEEE 等学术引用格式
 */

/**
 * 引用格式类型
 */
export enum CitationStyle {
  APA = "apa",
  MLA = "mla",
  CHICAGO = "chicago",
  IEEE = "ieee",
  HARVARD = "harvard",
  VANCOUVER = "vancouver",
}

/**
 * 引用来源类型
 */
export enum SourceCategory {
  JOURNAL_ARTICLE = "journal_article",
  CONFERENCE_PAPER = "conference_paper",
  BOOK = "book",
  BOOK_CHAPTER = "book_chapter",
  WEBSITE = "website",
  NEWS_ARTICLE = "news_article",
  REPORT = "report",
  GOVERNMENT_DOCUMENT = "government_document",
  PREPRINT = "preprint",
  SOCIAL_MEDIA = "social_media",
  BLOG_POST = "blog_post",
  DATASET = "dataset",
}

/**
 * 引用元数据（统一结构）
 */
export interface CitationMetadata {
  /** 来源类型 */
  sourceCategory: SourceCategory;
  /** 标题 */
  title: string;
  /** 作者列表 */
  authors: Array<{
    firstName?: string;
    lastName?: string;
    fullName: string;
    isOrganization?: boolean;
  }>;
  /** 发表日期 */
  publishedDate?: Date | string;
  /** 访问日期 */
  accessedDate?: Date | string;
  /** URL */
  url?: string;
  /** DOI */
  doi?: string;
  /** 期刊名称 */
  journal?: string;
  /** 卷号 */
  volume?: string;
  /** 期号 */
  issue?: string;
  /** 页码 */
  pages?: string;
  /** 出版商 */
  publisher?: string;
  /** 出版地点 */
  publicationPlace?: string;
  /** 版本 */
  edition?: string;
  /** 来源域名 */
  domain?: string;
  /** 数据源类型 */
  dataSourceType?: string;
}

/**
 * 格式化后的引用
 */
export interface FormattedCitation {
  /** 行内引用 (e.g., "(Smith, 2024)") */
  inText: string;
  /** 完整引用条目 */
  fullCitation: string;
  /** 引用格式 */
  style: CitationStyle;
  /** 引用编号 */
  index: number;
  /** 排序键 */
  sortKey: string;
}

/**
 * 参考文献列表
 */
export interface Bibliography {
  /** 引用格式 */
  style: CitationStyle;
  /** 格式化的引用列表 */
  entries: FormattedCitation[];
  /** 格式化的完整参考文献文本 */
  formattedText: string;
  /** 统计信息 */
  stats: {
    totalSources: number;
    byCategory: Record<string, number>;
    withDoi: number;
    withUrl: number;
  };
}
