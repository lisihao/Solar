/**
 * 统一导出系统 - 内容类型定义
 */

// ==================== 统一内容格式 ====================

/**
 * 统一的文档内容格式
 * 所有来源的内容都会被转换为这个格式
 */
export interface UnifiedContent {
  // 元信息
  metadata: ContentMetadata;

  // 封面配置
  cover?: CoverConfig;

  // 目录
  tableOfContents?: TableOfContentsConfig;

  // 主体内容
  sections: ContentSection[];

  // 参考文献
  references?: Reference[];

  // 附录
  appendices?: Appendix[];
}

export interface ContentMetadata {
  title: string;
  subtitle?: string;
  author?: string;
  organization?: string;
  date?: Date;
  version?: string;
  tags?: string[];
  language?: string;
}

export interface CoverConfig {
  showCover: boolean;
  backgroundImage?: string;
  logo?: string;
  customHtml?: string;
}

export interface TableOfContentsConfig {
  enabled: boolean;
  maxDepth: number;
  title?: string;
}

// ==================== 内容节点 ====================

export type ContentType =
  | "heading" // 标题
  | "paragraph" // 段落
  | "list" // 列表
  | "table" // 表格
  | "image" // 图片
  | "chart" // 图表
  | "code" // 代码块
  | "quote" // 引用
  | "divider" // 分隔符
  | "callout"; // 提示框

export interface ContentSection {
  id: string;
  type: ContentType;

  // 通用属性
  content?: string;
  level?: number; // 标题层级 1-6

  // 列表属性
  items?: ListItem[];
  ordered?: boolean;

  // 表格属性
  rows?: TableRow[];
  headers?: string[];

  // 图片属性
  imageUrl?: string;
  imageAlt?: string;
  imageCaption?: string;

  // 图表属性
  chartConfig?: ChartConfig;

  // 代码属性
  codeLanguage?: string;

  // 引用索引
  citations?: number[];

  // 提示框属性
  calloutType?: "info" | "warning" | "success" | "error";

  // 子节点
  children?: ContentSection[];

  // 样式覆盖
  style?: Record<string, unknown>;
}

export interface ListItem {
  content: string;
  children?: ListItem[];
}

export interface TableRow {
  cells: string[];
  isHeader?: boolean;
}

export interface ChartConfig {
  type: "bar" | "line" | "pie" | "area" | "scatter";
  data: unknown;
  options?: unknown;
}

// ==================== 参考文献 ====================

export interface Reference {
  id: number;
  title: string;
  url?: string;
  author?: string;
  publishedDate?: string;
  accessedAt?: Date;
  snippet?: string;
  domain?: string;
}

// ==================== 附录 ====================

export interface Appendix {
  id: string;
  title: string;
  content: string;
  type: "text" | "table" | "image";
}
