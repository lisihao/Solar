/**
 * Event Source Parser Utilities
 *
 * 轻量工具函数（非 NestJS 服务），用于 EVENT 类型的锚定文章处理。
 * URL 抓取由现有 web-scraper tool 负责，LLM 实体提取由调用方处理。
 */

import { Logger } from "@nestjs/common";

const logger = new Logger("EventSourceParser");

/**
 * 信源可信度等级
 * Tier 1: 政府/官方 → 最高可信度
 * Tier 2: 主流权威媒体/机构 → 高可信度
 * Tier 3: 其余 → 标准可信度
 */
export type SourceTier = 1 | 2 | 3;

/** EVENT topicConfig 中锚定文章相关字段 */
export interface EventTopicConfig {
  sourceUrl?: string;
  sourceContent?: string;
  sourceTitle?: string;
  sourceDate?: string;
  sourceDomain?: string;
  sourceTier?: SourceTier;
  eventType?: string;
  keyEntities?: {
    people: string[];
    organizations: string[];
    technologies: string[];
    locations: string[];
  };
  causalHypotheses?: {
    structuralCause: string;
    proximateCause: string;
    trigger: string;
    essenceStatement: string;
  };
  searchTimeRange?: string;
  enableFigures?: boolean;
  researchDepth?: string;
}

/** Tier 1 域名模式：政府/官方 */
const TIER_1_PATTERNS = [
  /\.gov($|\/)/i,
  /\.gov\.\w+($|\/)/i,
  /^gov\.\w+$/i,
  /newsroom\./i,
  /press\./i,
  /investor\./i,
  /ir\./i,
];

/** Tier 2 域名关键词：权威媒体/机构 */
const TIER_2_DOMAINS = new Set([
  "reuters.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "nytimes.com",
  "washingtonpost.com",
  "economist.com",
  "bbc.com",
  "bbc.co.uk",
  "apnews.com",
  "cnbc.com",
  "techcrunch.com",
  "theverge.com",
  "arstechnica.com",
  "wired.com",
  "nature.com",
  "science.org",
  "arxiv.org",
  "gartner.com",
  "mckinsey.com",
  "bcg.com",
  "hbr.org",
  "forbes.com",
  "caixin.com",
  "thepaper.cn",
  "36kr.com",
  "jiemian.com",
  "yicai.com",
  "mp.weixin.qq.com",
  "weixin.qq.com",
  "news.qq.com",
]);

/**
 * 评估信源可信度等级
 */
export function assessSourceTier(urlOrDomain: string): SourceTier {
  try {
    const domain = urlOrDomain.includes("://")
      ? new URL(urlOrDomain).hostname.replace(/^www\./, "")
      : urlOrDomain.replace(/^www\./, "");

    // Tier 1: 政府/企业官方
    if (TIER_1_PATTERNS.some((p) => p.test(domain))) {
      return 1;
    }

    // Tier 2: 主流权威媒体
    if (TIER_2_DOMAINS.has(domain)) {
      return 2;
    }

    // 检查二级域名匹配（如 cn.reuters.com）
    const parts = domain.split(".");
    if (parts.length > 2) {
      const baseDomain = parts.slice(-2).join(".");
      if (TIER_2_DOMAINS.has(baseDomain)) {
        return 2;
      }
    }

    return 3;
  } catch {
    return 3;
  }
}

/**
 * 从 URL 提取域名
 */
export function extractDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/**
 * 截取锚定文章内容（前 5000 字符）
 */
export function truncateSourceContent(
  content: string,
  maxLength = 5000,
): string {
  if (content.length <= maxLength) return content;
  return (
    content.slice(0, maxLength) +
    "\n\n[... 内容已截取前 " +
    maxLength +
    " 字符]"
  );
}

/**
 * 构建锚定文章的证据数据（用于注入 dimension-mission 的 evidenceData）
 *
 * 返回一个与 EnrichedEvidenceData 兼容的对象，
 * 作为第一条证据 unshift 到搜索结果前面。
 */
export function buildAnchorEvidence(topicConfig: Record<string, unknown>): {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  fullContent: string;
  sourceType: string;
  credibilityScore: number;
  publishedAt: string | null;
} {
  const config = topicConfig as Partial<EventTopicConfig>;
  const sourceUrl = (config.sourceUrl as string) || "";
  const sourceContent = (config.sourceContent as string) || "";
  const sourceTitle = (config.sourceTitle as string) || "锚定文章";
  const sourceDomain =
    (config.sourceDomain as string) ||
    extractDomain(sourceUrl) ||
    "user-provided";
  const sourceTier =
    (config.sourceTier as SourceTier) ||
    (sourceUrl ? assessSourceTier(sourceUrl) : 3);
  const sourceDate = (config.sourceDate as string) || null;

  // Tier → credibilityScore 映射
  const tierToScore: Record<SourceTier, number> = { 1: 95, 2: 85, 3: 70 };

  const content = sourceContent
    ? truncateSourceContent(sourceContent)
    : `[锚定文章] ${sourceTitle} — 来源: ${sourceDomain}`;

  logger.debug(
    `Built anchor evidence: title="${sourceTitle}", domain="${sourceDomain}", tier=${sourceTier}, content=${content.length} chars`,
  );

  return {
    title: `[锚定文章] ${sourceTitle}`,
    url: sourceUrl,
    domain: sourceDomain,
    snippet: content.slice(0, 300),
    fullContent: content,
    sourceType: "anchor_article",
    credibilityScore: tierToScore[sourceTier],
    publishedAt: sourceDate,
  };
}

/**
 * 格式化锚定文章内容，用于注入 Leader prompt
 */
export function formatAnchorContentForPrompt(
  topicConfig: Record<string, unknown>,
): string {
  const config = topicConfig as Partial<EventTopicConfig>;
  const sourceTitle = config.sourceTitle || "";
  const sourceDomain = config.sourceDomain || "";
  const sourceTier = config.sourceTier;
  const sourceContent = config.sourceContent || "";
  const sourceUrl = config.sourceUrl || "";
  const keyEntities = config.keyEntities;

  const parts: string[] = [];

  if (sourceTitle) {
    parts.push(`**标题**: ${sourceTitle}`);
  }
  if (sourceDomain) {
    const tierLabel =
      sourceTier === 1
        ? "官方/政府"
        : sourceTier === 2
          ? "权威媒体"
          : "一般来源";
    parts.push(`**来源**: ${sourceDomain} (${tierLabel})`);
  }
  if (sourceUrl) {
    parts.push(`**链接**: ${sourceUrl}`);
  }
  if (sourceContent) {
    parts.push(
      `\n**文章内容**:\n${truncateSourceContent(sourceContent, 3000)}`,
    );
  }
  if (keyEntities) {
    const entityParts: string[] = [];
    if (keyEntities.people?.length)
      entityParts.push(`人物: ${keyEntities.people.join(", ")}`);
    if (keyEntities.organizations?.length)
      entityParts.push(`机构: ${keyEntities.organizations.join(", ")}`);
    if (keyEntities.technologies?.length)
      entityParts.push(`技术: ${keyEntities.technologies.join(", ")}`);
    if (keyEntities.locations?.length)
      entityParts.push(`地区: ${keyEntities.locations.join(", ")}`);
    if (entityParts.length > 0) {
      parts.push(`\n**关键实体**:\n${entityParts.join("\n")}`);
    }
  }

  return parts.join("\n");
}
