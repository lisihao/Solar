/**
 * Citation Formatter Service
 * 引用格式化服务
 */

import { Injectable } from "@nestjs/common";
import { Evidence, CitationStyle } from "../abstractions/evidence.interface";

/**
 * 引用格式化服务
 */
@Injectable()
export class CitationFormatterService {
  /**
   * 格式化单条引用
   */
  format(evidence: Evidence, style: CitationStyle): string {
    switch (style) {
      case "apa":
        return this.formatAPA(evidence);
      case "mla":
        return this.formatMLA(evidence);
      case "chicago":
        return this.formatChicago(evidence);
      case "harvard":
        return this.formatHarvard(evidence);
      case "ieee":
        return this.formatIEEE(evidence);
      default:
        return this.formatAPA(evidence);
    }
  }

  /**
   * 格式化参考文献列表
   */
  formatBibliography(citations: string[], style: CitationStyle): string {
    const header = this.getBibliographyHeader(style);
    const sortedCitations = [...citations].sort((a, b) => a.localeCompare(b));

    return `${header}\n\n${sortedCitations.join("\n\n")}`;
  }

  /**
   * 安全地将日期值转换为 Date 对象
   */
  private toDate(value: Date | string | undefined): Date | undefined {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    const date = new Date(value);
    return isNaN(date.getTime()) ? undefined : date;
  }

  /**
   * APA 格式
   * Author, A. A. (Year). Title of work. Source. URL
   */
  private formatAPA(evidence: Evidence): string {
    const parts: string[] = [];

    // 作者
    if (evidence.source.author) {
      parts.push(this.formatAuthorAPA(evidence.source.author));
    }

    // 年份
    const publishedDate = this.toDate(evidence.source.publishedAt);
    if (publishedDate) {
      parts.push(`(${publishedDate.getFullYear()}).`);
    }

    // 标题
    parts.push(`${evidence.source.title}.`);

    // 出版商/来源
    if (evidence.source.publisher) {
      parts.push(`${evidence.source.publisher}.`);
    }

    // URL
    if (evidence.source.url) {
      parts.push(evidence.source.url);
    }

    return parts.join(" ");
  }

  /**
   * MLA 格式
   * Author. "Title." Source, Publisher, Date. URL.
   */
  private formatMLA(evidence: Evidence): string {
    const parts: string[] = [];

    // 作者
    if (evidence.source.author) {
      parts.push(`${evidence.source.author}.`);
    }

    // 标题（加引号）
    parts.push(`"${evidence.source.title}."`);

    // 出版商
    if (evidence.source.publisher) {
      parts.push(`${evidence.source.publisher},`);
    }

    // 日期
    const publishedDateMLA = this.toDate(evidence.source.publishedAt);
    if (publishedDateMLA) {
      parts.push(`${this.formatDateMLA(publishedDateMLA)}.`);
    }

    // URL
    if (evidence.source.url) {
      parts.push(evidence.source.url);
    }

    return parts.join(" ");
  }

  /**
   * Chicago 格式
   * Author. "Title." Source. Date. URL.
   */
  private formatChicago(evidence: Evidence): string {
    const parts: string[] = [];

    // 作者
    if (evidence.source.author) {
      parts.push(`${evidence.source.author}.`);
    }

    // 标题
    parts.push(`"${evidence.source.title}."`);

    // 来源
    if (evidence.source.publisher) {
      parts.push(`${evidence.source.publisher}.`);
    }

    // 日期
    const publishedDateChicago = this.toDate(evidence.source.publishedAt);
    if (publishedDateChicago) {
      parts.push(`${this.formatDateChicago(publishedDateChicago)}.`);
    }

    // URL
    if (evidence.source.url) {
      parts.push(evidence.source.url);
    }

    return parts.join(" ");
  }

  /**
   * Harvard 格式
   * Author (Year) Title. Available at: URL (Accessed: Date).
   */
  private formatHarvard(evidence: Evidence): string {
    const parts: string[] = [];

    // 作者
    if (evidence.source.author) {
      parts.push(evidence.source.author);
    }

    // 年份
    const publishedDateHarvard = this.toDate(evidence.source.publishedAt);
    if (publishedDateHarvard) {
      parts.push(`(${publishedDateHarvard.getFullYear()})`);
    }

    // 标题
    parts.push(`${evidence.source.title}.`);

    // URL
    if (evidence.source.url) {
      parts.push(`Available at: ${evidence.source.url}`);
      parts.push(`(Accessed: ${new Date().toLocaleDateString()}).`);
    }

    return parts.join(" ");
  }

  /**
   * IEEE 格式
   * [N] A. Author, "Title," Source, Date. [Online]. Available: URL
   */
  private formatIEEE(evidence: Evidence): string {
    const parts: string[] = [];

    // 作者
    if (evidence.source.author) {
      parts.push(`${this.formatAuthorIEEE(evidence.source.author)},`);
    }

    // 标题
    parts.push(`"${evidence.source.title},"`);

    // 来源
    if (evidence.source.publisher) {
      parts.push(`${evidence.source.publisher},`);
    }

    // 日期
    const publishedDateIEEE = this.toDate(evidence.source.publishedAt);
    if (publishedDateIEEE) {
      parts.push(`${this.formatDateIEEE(publishedDateIEEE)}.`);
    }

    // URL
    if (evidence.source.url) {
      parts.push(`[Online]. Available: ${evidence.source.url}`);
    }

    return parts.join(" ");
  }

  /**
   * 获取参考文献标题
   */
  private getBibliographyHeader(style: CitationStyle): string {
    switch (style) {
      case "apa":
        return "References";
      case "mla":
        return "Works Cited";
      case "chicago":
        return "Bibliography";
      case "harvard":
        return "Reference List";
      case "ieee":
        return "References";
      default:
        return "References";
    }
  }

  /**
   * APA 作者格式
   */
  private formatAuthorAPA(author: string): string {
    // 简化处理：假设是 "First Last" 格式
    const parts = author.split(" ");
    if (parts.length >= 2) {
      const lastName = parts[parts.length - 1];
      const initials = parts
        .slice(0, -1)
        .map((p) => p[0].toUpperCase() + ".")
        .join(" ");
      return `${lastName}, ${initials}`;
    }
    return author;
  }

  /**
   * IEEE 作者格式
   */
  private formatAuthorIEEE(author: string): string {
    // 简化处理：假设是 "First Last" 格式
    const parts = author.split(" ");
    if (parts.length >= 2) {
      const lastName = parts[parts.length - 1];
      const initials = parts
        .slice(0, -1)
        .map((p) => p[0].toUpperCase() + ".")
        .join(" ");
      return `${initials} ${lastName}`;
    }
    return author;
  }

  /**
   * MLA 日期格式
   */
  private formatDateMLA(date: Date): string {
    const day = date.getDate();
    const month = date.toLocaleString("en-US", { month: "short" });
    const year = date.getFullYear();
    return `${day} ${month}. ${year}`;
  }

  /**
   * Chicago 日期格式
   */
  private formatDateChicago(date: Date): string {
    const month = date.toLocaleString("en-US", { month: "long" });
    const day = date.getDate();
    const year = date.getFullYear();
    return `${month} ${day}, ${year}`;
  }

  /**
   * IEEE 日期格式
   */
  private formatDateIEEE(date: Date): string {
    const month = date.toLocaleString("en-US", { month: "short" });
    const year = date.getFullYear();
    return `${month}. ${year}`;
  }
}
