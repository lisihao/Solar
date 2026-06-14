/**
 * Citation Formatter Service
 *
 * P1: 引用格式标准化
 * 支持 APA 7th / MLA 9th / Chicago 17th / IEEE 等学术引用格式
 *
 * 核心功能：
 * 1. 从证据元数据自动生成标准引用
 * 2. 生成行内引用和参考文献列表
 * 3. 智能判断来源类型（期刊/网站/新闻等）
 * 4. 多格式并行输出
 */

import { Injectable } from "@nestjs/common";
import {
  CitationStyle,
  SourceCategory,
  CitationMetadata,
  FormattedCitation,
  Bibliography,
} from "../../types/citation.types";

@Injectable()
export class CitationFormatterService {
  /**
   * 从证据数据构建引用元数据
   */
  buildCitationMetadata(evidence: {
    title: string;
    url?: string;
    domain?: string;
    sourceType?: string;
    publishedAt?: Date | string | null;
    metadata?: Record<string, unknown>;
  }): CitationMetadata {
    const authors = this.extractAuthors(evidence.metadata);
    const sourceCategory = this.classifySource(
      evidence.sourceType,
      evidence.domain,
      evidence.metadata,
    );

    return {
      sourceCategory,
      title: evidence.title,
      authors,
      publishedDate: evidence.publishedAt || undefined,
      accessedDate: new Date(),
      url: evidence.url,
      doi: evidence.metadata?.doi as string | undefined,
      journal: evidence.metadata?.journal as string | undefined,
      volume: evidence.metadata?.volume as string | undefined,
      issue: evidence.metadata?.issue as string | undefined,
      pages: evidence.metadata?.pages as string | undefined,
      publisher: evidence.metadata?.publisher as string | undefined,
      domain: evidence.domain,
      dataSourceType: evidence.sourceType,
    };
  }

  /**
   * 格式化单条引用
   */
  formatCitation(
    metadata: CitationMetadata,
    style: CitationStyle,
    index: number,
  ): FormattedCitation {
    switch (style) {
      case CitationStyle.APA:
        return this.formatAPA(metadata, index);
      case CitationStyle.MLA:
        return this.formatMLA(metadata, index);
      case CitationStyle.CHICAGO:
        return this.formatChicago(metadata, index);
      case CitationStyle.IEEE:
        return this.formatIEEE(metadata, index);
      case CitationStyle.HARVARD:
        return this.formatHarvard(metadata, index);
      default:
        return this.formatAPA(metadata, index);
    }
  }

  /**
   * 生成参考文献列表
   */
  generateBibliography(
    citations: CitationMetadata[],
    style: CitationStyle,
  ): Bibliography {
    const entries = citations.map((c, i) =>
      this.formatCitation(c, style, i + 1),
    );

    // 按排序键排序
    entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    // 重新编号
    entries.forEach((entry, i) => {
      entry.index = i + 1;
    });

    // 统计
    const byCategory: Record<string, number> = {};
    for (const c of citations) {
      byCategory[c.sourceCategory] = (byCategory[c.sourceCategory] || 0) + 1;
    }

    const formattedText = entries.map((e) => e.fullCitation).join("\n\n");

    return {
      style,
      entries,
      formattedText,
      stats: {
        totalSources: citations.length,
        byCategory,
        withDoi: citations.filter((c) => c.doi).length,
        withUrl: citations.filter((c) => c.url).length,
      },
    };
  }

  // =========================================================================
  // APA 7th Edition
  // =========================================================================

  private formatAPA(meta: CitationMetadata, index: number): FormattedCitation {
    const authorStr = this.formatAuthorsAPA(meta.authors);
    const year = this.extractYear(meta.publishedDate);
    const yearStr = year || "n.d.";

    // 行内引用
    const firstAuthorLast =
      meta.authors[0]?.lastName || meta.authors[0]?.fullName || "Unknown";
    const inText =
      meta.authors.length > 2
        ? `(${firstAuthorLast} et al., ${yearStr})`
        : meta.authors.length === 2
          ? `(${firstAuthorLast} & ${meta.authors[1]?.lastName || meta.authors[1]?.fullName}, ${yearStr})`
          : `(${firstAuthorLast}, ${yearStr})`;

    // 完整引用
    let fullCitation = `${authorStr} (${yearStr}). `;

    if (
      meta.sourceCategory === SourceCategory.JOURNAL_ARTICLE ||
      meta.sourceCategory === SourceCategory.PREPRINT
    ) {
      fullCitation += `${meta.title}. `;
      if (meta.journal) {
        fullCitation += `*${meta.journal}*`;
        if (meta.volume) fullCitation += `, *${meta.volume}*`;
        if (meta.issue) fullCitation += `(${meta.issue})`;
        if (meta.pages) fullCitation += `, ${meta.pages}`;
        fullCitation += ". ";
      }
      if (meta.doi) fullCitation += `https://doi.org/${meta.doi}`;
      else if (meta.url) fullCitation += meta.url;
    } else if (meta.sourceCategory === SourceCategory.WEBSITE) {
      fullCitation += `*${meta.title}*. `;
      if (meta.domain) fullCitation += `${meta.domain}. `;
      if (meta.url) fullCitation += meta.url;
    } else {
      fullCitation += `${meta.title}. `;
      if (meta.publisher) fullCitation += `${meta.publisher}. `;
      if (meta.url) fullCitation += meta.url;
    }

    return {
      inText,
      fullCitation: fullCitation.trim(),
      style: CitationStyle.APA,
      index,
      sortKey: `${firstAuthorLast}_${yearStr}`,
    };
  }

  // =========================================================================
  // MLA 9th Edition
  // =========================================================================

  private formatMLA(meta: CitationMetadata, index: number): FormattedCitation {
    const firstAuthor = meta.authors[0];
    const authorStr = this.formatAuthorsMLA(meta.authors);
    const year = this.extractYear(meta.publishedDate);

    // 行内引用
    const lastName =
      firstAuthor?.lastName || firstAuthor?.fullName || "Unknown";
    const inText =
      meta.authors.length > 2 ? `(${lastName} et al.)` : `(${lastName})`;

    // 完整引用
    let fullCitation = `${authorStr} `;

    if (meta.sourceCategory === SourceCategory.JOURNAL_ARTICLE) {
      fullCitation += `"${meta.title}." `;
      if (meta.journal) fullCitation += `*${meta.journal}*, `;
      if (meta.volume) fullCitation += `vol. ${meta.volume}, `;
      if (meta.issue) fullCitation += `no. ${meta.issue}, `;
      if (year) fullCitation += `${year}, `;
      if (meta.pages) fullCitation += `pp. ${meta.pages}. `;
      if (meta.doi) fullCitation += `https://doi.org/${meta.doi}.`;
    } else {
      fullCitation += `"${meta.title}." `;
      if (meta.domain) fullCitation += `*${meta.domain}*, `;
      if (year) fullCitation += `${year}, `;
      if (meta.url) fullCitation += `${meta.url}.`;
    }

    return {
      inText,
      fullCitation: fullCitation.trim(),
      style: CitationStyle.MLA,
      index,
      sortKey: lastName,
    };
  }

  // =========================================================================
  // Chicago 17th Edition (Notes-Bibliography)
  // =========================================================================

  private formatChicago(
    meta: CitationMetadata,
    index: number,
  ): FormattedCitation {
    const authorStr = this.formatAuthorsChicago(meta.authors);
    const year = this.extractYear(meta.publishedDate);
    const firstName =
      meta.authors[0]?.lastName || meta.authors[0]?.fullName || "Unknown";

    const inText = `(${firstName}${year ? `, ${year}` : ""})`;

    let fullCitation = `${authorStr}. `;

    if (meta.sourceCategory === SourceCategory.JOURNAL_ARTICLE) {
      fullCitation += `"${meta.title}." `;
      if (meta.journal) fullCitation += `*${meta.journal}* `;
      if (meta.volume) fullCitation += `${meta.volume}`;
      if (meta.issue) fullCitation += `, no. ${meta.issue}`;
      if (year) fullCitation += ` (${year})`;
      if (meta.pages) fullCitation += `: ${meta.pages}`;
      fullCitation += ". ";
      if (meta.doi) fullCitation += `https://doi.org/${meta.doi}.`;
    } else {
      fullCitation += `"${meta.title}." `;
      if (meta.domain || meta.publisher) {
        fullCitation += `${meta.domain || meta.publisher}. `;
      }
      if (year) fullCitation += `${year}. `;
      if (meta.url) fullCitation += `${meta.url}.`;
    }

    return {
      inText,
      fullCitation: fullCitation.trim(),
      style: CitationStyle.CHICAGO,
      index,
      sortKey: firstName,
    };
  }

  // =========================================================================
  // IEEE
  // =========================================================================

  private formatIEEE(meta: CitationMetadata, index: number): FormattedCitation {
    const authorStr = this.formatAuthorsIEEE(meta.authors);
    const year = this.extractYear(meta.publishedDate);

    const inText = `[${index}]`;

    let fullCitation = `[${index}] ${authorStr}, `;
    fullCitation += `"${meta.title}," `;

    if (meta.sourceCategory === SourceCategory.JOURNAL_ARTICLE) {
      if (meta.journal) fullCitation += `*${meta.journal}*, `;
      if (meta.volume) fullCitation += `vol. ${meta.volume}, `;
      if (meta.issue) fullCitation += `no. ${meta.issue}, `;
      if (meta.pages) fullCitation += `pp. ${meta.pages}, `;
      if (year) fullCitation += `${year}. `;
      if (meta.doi) fullCitation += `doi: ${meta.doi}.`;
    } else {
      if (meta.domain) fullCitation += `${meta.domain}, `;
      if (year) fullCitation += `${year}. `;
      if (meta.url) fullCitation += `[Online]. Available: ${meta.url}`;
    }

    return {
      inText,
      fullCitation: fullCitation.trim(),
      style: CitationStyle.IEEE,
      index,
      sortKey: String(index).padStart(5, "0"),
    };
  }

  // =========================================================================
  // Harvard
  // =========================================================================

  private formatHarvard(
    meta: CitationMetadata,
    index: number,
  ): FormattedCitation {
    // Harvard is similar to APA with minor differences
    return this.formatAPA(meta, index);
  }

  // =========================================================================
  // Helper Methods
  // =========================================================================

  private extractAuthors(
    metadata?: Record<string, unknown>,
  ): CitationMetadata["authors"] {
    if (!metadata?.authors) {
      return [{ fullName: "Unknown", isOrganization: false }];
    }

    const authors = metadata.authors as Array<string | { name: string }>;
    return authors.map((a) => {
      const name = typeof a === "string" ? a : a.name;
      const parts = name.split(/\s+/);
      if (parts.length >= 2) {
        return {
          firstName: parts.slice(0, -1).join(" "),
          lastName: parts[parts.length - 1],
          fullName: name,
        };
      }
      return { fullName: name };
    });
  }

  private classifySource(
    sourceType?: string,
    domain?: string,
    metadata?: Record<string, unknown>,
  ): SourceCategory {
    if (metadata?.doi || sourceType === "academic") {
      return metadata?.venue
        ? SourceCategory.CONFERENCE_PAPER
        : SourceCategory.JOURNAL_ARTICLE;
    }
    if (sourceType === "semantic-scholar" || sourceType === "pubmed") {
      return SourceCategory.JOURNAL_ARTICLE;
    }
    if (
      sourceType === "federal-register" ||
      sourceType === "congress-gov" ||
      sourceType === "whitehouse-news"
    ) {
      return SourceCategory.GOVERNMENT_DOCUMENT;
    }
    if (sourceType === "social-x") return SourceCategory.SOCIAL_MEDIA;
    if (sourceType === "hackernews") return SourceCategory.BLOG_POST;
    if (sourceType === "github") return SourceCategory.WEBSITE;

    // Domain-based classification
    if (domain) {
      if (domain.includes("arxiv")) return SourceCategory.PREPRINT;
      if (
        domain.includes("reuters") ||
        domain.includes("bbc") ||
        domain.includes("cnn")
      ) {
        return SourceCategory.NEWS_ARTICLE;
      }
    }

    return SourceCategory.WEBSITE;
  }

  private extractYear(date?: Date | string | null): string | null {
    if (!date) return null;
    const d = typeof date === "string" ? new Date(date) : date;
    return isNaN(d.getTime()) ? null : String(d.getFullYear());
  }

  private formatAuthorsAPA(authors: CitationMetadata["authors"]): string {
    if (authors.length === 0) return "Unknown";
    if (authors.length === 1) {
      const a = authors[0];
      return a.lastName
        ? `${a.lastName}, ${a.firstName?.charAt(0) || ""}.`
        : a.fullName;
    }
    if (authors.length === 2) {
      return authors
        .map((a) =>
          a.lastName
            ? `${a.lastName}, ${a.firstName?.charAt(0) || ""}.`
            : a.fullName,
        )
        .join(", & ");
    }
    // 3+ authors: first author ... et al.
    const first = authors[0];
    return `${first.lastName || first.fullName}, ${first.firstName?.charAt(0) || ""}., et al.`;
  }

  private formatAuthorsMLA(authors: CitationMetadata["authors"]): string {
    if (authors.length === 0) return "Unknown.";
    const first = authors[0];
    if (authors.length === 1) {
      return `${first.lastName || first.fullName}, ${first.firstName || ""}.`;
    }
    if (authors.length === 2) {
      const second = authors[1];
      return `${first.lastName}, ${first.firstName}, and ${second.fullName}.`;
    }
    return `${first.lastName}, ${first.firstName}, et al.`;
  }

  private formatAuthorsChicago(authors: CitationMetadata["authors"]): string {
    return this.formatAuthorsMLA(authors);
  }

  private formatAuthorsIEEE(authors: CitationMetadata["authors"]): string {
    if (authors.length === 0) return "Unknown";
    return authors
      .map((a) => {
        if (a.firstName && a.lastName) {
          return `${a.firstName.charAt(0)}. ${a.lastName}`;
        }
        return a.fullName;
      })
      .join(", ");
  }
}
