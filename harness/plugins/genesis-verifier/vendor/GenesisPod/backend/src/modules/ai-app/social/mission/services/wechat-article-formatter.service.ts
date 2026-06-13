import { Injectable, Logger } from "@nestjs/common";

/**
 * 微信公众号文章格式化器
 *
 * 将 Topic Insights 报告的 Markdown 转换为微信公众号兼容的内联样式 HTML。
 * 微信公众号编辑器不支持外部 CSS，所有样式必须内联。
 */
@Injectable()
export class WechatArticleFormatterService {
  private readonly logger = new Logger(WechatArticleFormatterService.name);

  // 微信公众号样式常量
  private readonly STYLES = {
    body: 'font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 16px; line-height: 1.75; color: #333; padding: 0 8px;',
    h1: "font-size: 24px; font-weight: bold; color: #1a1a1a; margin: 32px 0 16px 0; padding-bottom: 8px; border-bottom: 2px solid #1a73e8;",
    h2: "font-size: 20px; font-weight: bold; color: #1a1a1a; margin: 28px 0 12px 0; padding-left: 12px; border-left: 4px solid #1a73e8;",
    h3: "font-size: 18px; font-weight: bold; color: #333; margin: 24px 0 10px 0;",
    h4: "font-size: 16px; font-weight: bold; color: #555; margin: 20px 0 8px 0;",
    p: "margin: 0 0 16px 0; text-align: justify;",
    blockquote:
      "margin: 16px 0; padding: 12px 16px; background: #f6f8fa; border-left: 4px solid #1a73e8; color: #555; font-size: 15px;",
    ul: "margin: 0 0 16px 0; padding-left: 24px;",
    ol: "margin: 0 0 16px 0; padding-left: 24px;",
    li: "margin: 4px 0; line-height: 1.75;",
    table:
      "width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;",
    th: "background: #f0f5ff; padding: 10px 12px; border: 1px solid #ddd; font-weight: bold; text-align: left; color: #1a1a1a;",
    td: "padding: 8px 12px; border: 1px solid #ddd; color: #333;",
    code: 'background: #f6f8fa; padding: 2px 6px; border-radius: 3px; font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 14px; color: #d63384;',
    codeBlock:
      'background: #f6f8fa; padding: 16px; border-radius: 8px; overflow-x: auto; font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 13px; line-height: 1.6; color: #333; margin: 16px 0;',
    hr: "border: none; border-top: 1px solid #e8e8e8; margin: 32px 0;",
    strong: "font-weight: bold; color: #1a1a1a;",
    em: "font-style: italic; color: #555;",
    a: "color: #1a73e8; text-decoration: none;",
    img: "max-width: 100%; height: auto; border-radius: 8px; margin: 16px 0; display: block;",
    figCaption:
      "text-align: center; color: #999; font-size: 13px; margin: -8px 0 16px 0;",
    footnoteSection:
      "margin-top: 40px; padding-top: 16px; border-top: 1px solid #e8e8e8; font-size: 13px; color: #888;",
    footnoteItem: "margin: 4px 0; font-size: 13px; color: #888;",
    executiveSummaryBox:
      "margin: 20px 0; padding: 20px; background: linear-gradient(135deg, #f0f5ff 0%, #e8f4f8 100%); border-radius: 12px; border: 1px solid #d6e4ff;",
    highlightBox:
      "margin: 16px 0; padding: 16px; background: #fffbe6; border-radius: 8px; border: 1px solid #ffe58f;",
    chartPlaceholder:
      "margin: 16px 0; padding: 20px; background: #f9f9f9; border-radius: 8px; border: 1px dashed #ddd; text-align: center; color: #999;",
  };

  // 结构性章节关键词 — 合并到相邻正文章节，不独立成篇
  private static readonly STRUCTURAL_HEADINGS = [
    /^前言$/,
    /^引言$/,
    /^导言$/,
    /^执行摘要/,
    /^executive\s*summary/i,
    /^目录$/,
    /^table\s*of\s*contents/i,
    /^结[语论]$/,
    /^总结$/,
    /^conclusion/i,
    /^参考文献/,
    /^references?$/i,
    /^附录/,
    /^appendix/i,
    /^跨维度关联/,
    /^风险评估$/,
    /^战略建议$/,
  ];

  /**
   * 判断标题是否为结构性章节（不应独立成篇）
   */
  private isStructuralHeading(heading: string): boolean {
    const trimmed = heading.replace(/^[\d.]+\s*/, "").trim();
    return WechatArticleFormatterService.STRUCTURAL_HEADINGS.some((re) =>
      re.test(trimmed),
    );
  }

  /**
   * 将 Markdown 报告按 ## 标题拆分为多个 section
   * 只保留正文维度章节，结构性章节（前言、目录、结语等）合并到相邻章节
   */
  splitMarkdownIntoSections(fullMarkdown: string): Array<{
    heading: string;
    markdown: string;
    chartIds: string[];
  }> {
    // Step 1: Parse all ## sections
    const rawSections: Array<{ heading: string; lines: string[] }> = [];
    const lines = fullMarkdown.split("\n");
    let currentHeading = "";
    let currentLines: string[] = [];
    const introLines: string[] = [];
    let foundFirstH2 = false;

    for (const line of lines) {
      const h2Match = line.match(/^## (.+)/);
      if (h2Match) {
        if (foundFirstH2 && currentLines.length > 0) {
          rawSections.push({
            heading: currentHeading,
            lines: [...currentLines],
          });
        }
        currentHeading = h2Match[1].trim();
        currentLines = [];
        foundFirstH2 = true;
      } else if (!foundFirstH2) {
        introLines.push(line);
      } else {
        currentLines.push(line);
      }
    }
    if (foundFirstH2 && currentLines.length > 0) {
      rawSections.push({ heading: currentHeading, lines: [...currentLines] });
    }

    // Step 2: Merge structural sections into adjacent content sections
    // - Leading structural sections (前言, 执行摘要, 目录) → prepend to first content section
    // - Trailing structural sections (结语, 参考文献) → append to last content section
    // - Middle structural sections (跨维度关联, 风险评估, 战略建议) → append to previous content section
    const sections: Array<{
      heading: string;
      markdown: string;
      chartIds: string[];
    }> = [];
    const leadingBuffer: string[] = [];

    for (let i = 0; i < rawSections.length; i++) {
      const raw = rawSections[i];
      const isStructural = this.isStructuralHeading(raw.heading);

      if (isStructural) {
        const sectionMd = `## ${raw.heading}\n${raw.lines.join("\n")}`;
        if (sections.length === 0) {
          // Before any content section → buffer to prepend
          leadingBuffer.push(sectionMd);
        } else {
          // After a content section → append to previous
          sections[sections.length - 1].markdown += "\n\n" + sectionMd;
          sections[sections.length - 1].chartIds = this.extractChartIds(
            sections[sections.length - 1].markdown,
          );
        }
      } else {
        // Content section
        let markdown = raw.lines.join("\n").trim();

        // Prepend any buffered leading sections
        if (leadingBuffer.length > 0) {
          markdown = leadingBuffer.join("\n\n") + "\n\n" + markdown;
          leadingBuffer.length = 0;
        }

        sections.push(this.buildSection(raw.heading, markdown.split("\n")));
      }
    }

    // If all sections were structural (unlikely), create one section from buffers
    if (sections.length === 0 && leadingBuffer.length > 0) {
      const allContent = leadingBuffer.join("\n\n");
      sections.push({
        heading: "Content",
        markdown: allContent,
        chartIds: this.extractChartIds(allContent),
      });
    }

    // Prepend intro content to first section
    if (introLines.length > 0) {
      const introContent = introLines.join("\n").trim();
      if (introContent && sections.length > 0) {
        sections[0].markdown = introContent + "\n\n" + sections[0].markdown;
        sections[0].chartIds = this.extractChartIds(sections[0].markdown);
      } else if (introContent && sections.length === 0) {
        sections.push({
          heading: "Content",
          markdown: introContent,
          chartIds: this.extractChartIds(introContent),
        });
      }
    }

    // Fallback: no ## headings at all
    if (sections.length === 0) {
      sections.push({
        heading: "Content",
        markdown: fullMarkdown,
        chartIds: this.extractChartIds(fullMarkdown),
      });
    }

    this.logger.log(
      `Split report into ${sections.length} content sections (filtered structural): ${sections.map((s) => s.heading).join(", ")}`,
    );
    return sections;
  }

  private buildSection(
    heading: string,
    lines: string[],
  ): {
    heading: string;
    markdown: string;
    chartIds: string[];
  } {
    const markdown = lines.join("\n").trim();
    return {
      heading,
      markdown,
      chartIds: this.extractChartIds(markdown),
    };
  }

  private extractChartIds(markdown: string): string[] {
    const ids: string[] = [];
    const regex = /<!-- chart:([^\s]+?) -->/g;
    let match;
    while ((match = regex.exec(markdown)) !== null) {
      ids.push(match[1]);
    }
    return ids;
  }

  /**
   * 将 Markdown 报告转换为微信公众号兼容 HTML
   */
  formatForWechat(
    markdown: string,
    options?: {
      executiveSummary?: string;
      charts?: unknown[];
      title?: string;
    },
  ): string {
    this.logger.log(`Formatting report for WeChat: ${markdown.length} chars`);

    let html = "";

    // 添加执行摘要（如果有）
    if (options?.executiveSummary) {
      html += this.formatExecutiveSummary(options.executiveSummary);
    }

    // 转换 Markdown → HTML
    html += this.markdownToWechatHtml(markdown);

    // 包裹在容器中
    const result = `<section style="${this.STYLES.body}">${html}</section>`;

    this.logger.log(`Formatted HTML: ${result.length} chars`);
    return result;
  }

  /**
   * 格式化执行摘要
   */
  private formatExecutiveSummary(summary: string): string {
    const content = this.escapeHtml(summary)
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => `<p style="${this.STYLES.p}">${line.trim()}</p>`)
      .join("");

    return `<div style="${this.STYLES.executiveSummaryBox}">
      <p style="font-size: 14px; font-weight: bold; color: #1a73e8; margin: 0 0 12px 0;">Executive Summary</p>
      ${content}
    </div>`;
  }

  /**
   * Markdown → 微信 HTML 核心转换
   * 逐行解析，支持：标题、段落、列表、表格、引用、代码块、图片、分隔线、加粗、斜体、链接、脚注
   */
  private markdownToWechatHtml(markdown: string): string {
    const lines = markdown.split("\n");
    const result: string[] = [];
    let inCodeBlock = false;
    let codeBlockContent: string[] = [];
    let inTable = false;
    let tableRows: string[][] = [];
    let inList = false;
    let listType: "ul" | "ol" = "ul";
    let listItems: string[] = [];
    let inBlockquote = false;
    let blockquoteLines: string[] = [];

    const flushList = () => {
      if (inList && listItems.length > 0) {
        const tag = listType;
        const items = listItems
          .map((item) => `<li style="${this.STYLES.li}">${item}</li>`)
          .join("");
        result.push(
          `<${tag} style="${this.STYLES[listType]}">${items}</${tag}>`,
        );
        listItems = [];
        inList = false;
      }
    };

    const flushBlockquote = () => {
      if (inBlockquote && blockquoteLines.length > 0) {
        const content = blockquoteLines
          .map((l) => this.formatInline(l))
          .join("<br/>");
        result.push(
          `<blockquote style="${this.STYLES.blockquote}">${content}</blockquote>`,
        );
        blockquoteLines = [];
        inBlockquote = false;
      }
    };

    const flushTable = () => {
      if (inTable && tableRows.length > 0) {
        result.push(this.renderTable(tableRows));
        tableRows = [];
        inTable = false;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 代码块
      if (line.trim().startsWith("```")) {
        if (inCodeBlock) {
          result.push(
            `<pre style="${this.STYLES.codeBlock}"><code>${this.escapeHtml(codeBlockContent.join("\n"))}</code></pre>`,
          );
          codeBlockContent = [];
          inCodeBlock = false;
        } else {
          flushList();
          flushBlockquote();
          flushTable();
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockContent.push(line);
        continue;
      }

      // 空行
      if (!line.trim()) {
        flushList();
        flushBlockquote();
        flushTable();
        continue;
      }

      // 表格行
      if (line.includes("|") && line.trim().startsWith("|")) {
        flushList();
        flushBlockquote();
        // 跳过分隔行 |---|---|
        if (/^\|[\s\-:|]+\|$/.test(line.trim())) {
          continue;
        }
        const cells = line
          .split("|")
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
          .map((c) => c.trim());
        if (cells.length > 0) {
          inTable = true;
          tableRows.push(cells);
        }
        continue;
      } else {
        flushTable();
      }

      // 引用
      if (line.startsWith(">")) {
        flushList();
        flushTable();
        inBlockquote = true;
        blockquoteLines.push(line.replace(/^>\s*/, ""));
        continue;
      } else {
        flushBlockquote();
      }

      // 标题
      const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
      if (headingMatch) {
        flushList();
        flushTable();
        flushBlockquote();
        const level = headingMatch[1].length;
        const text = this.formatInline(headingMatch[2]);
        const tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
        result.push(`<${tag} style="${this.STYLES[tag]}">${text}</${tag}>`);
        continue;
      }

      // 分隔线
      if (/^[-*_]{3,}\s*$/.test(line.trim())) {
        flushList();
        result.push(`<hr style="${this.STYLES.hr}" />`);
        continue;
      }

      // 无序列表
      if (/^\s*[-*+]\s+/.test(line)) {
        flushTable();
        flushBlockquote();
        if (!inList || listType !== "ul") {
          flushList();
          inList = true;
          listType = "ul";
        }
        listItems.push(this.formatInline(line.replace(/^\s*[-*+]\s+/, "")));
        continue;
      }

      // 有序列表
      if (/^\s*\d+\.\s+/.test(line)) {
        flushTable();
        flushBlockquote();
        if (!inList || listType !== "ol") {
          flushList();
          inList = true;
          listType = "ol";
        }
        listItems.push(this.formatInline(line.replace(/^\s*\d+\.\s+/, "")));
        continue;
      }

      // 图片
      const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      if (imgMatch) {
        flushList();
        flushBlockquote();
        flushTable();
        const alt = this.escapeHtml(imgMatch[1]);
        const src = imgMatch[2];
        result.push(
          `<figure><img src="${src}" alt="${alt}" style="${this.STYLES.img}" />`,
        );
        if (alt) {
          result.push(
            `<figcaption style="${this.STYLES.figCaption}">${alt}</figcaption>`,
          );
        }
        result.push(`</figure>`);
        continue;
      }

      // 普通段落
      flushList();
      flushBlockquote();
      flushTable();
      result.push(`<p style="${this.STYLES.p}">${this.formatInline(line)}</p>`);
    }

    // Flush remaining
    flushList();
    flushBlockquote();
    flushTable();
    if (inCodeBlock && codeBlockContent.length > 0) {
      result.push(
        `<pre style="${this.STYLES.codeBlock}"><code>${this.escapeHtml(codeBlockContent.join("\n"))}</code></pre>`,
      );
    }

    return result.join("\n");
  }

  /**
   * 行内格式化：加粗、斜体、行内代码、链接、脚注引用
   *
   * 注意：先处理 Markdown 语法再转义，避免 escapeHtml 干扰正则匹配。
   * 每个 regex 捕获组内的文本内容单独转义，URL 不转义（浏览器可直接处理）。
   */
  private formatInline(text: string): string {
    let result = text;

    // 行内代码（内容单独转义）
    result = result.replace(
      /`([^`]+)`/g,
      (_, code: string) =>
        `<code style="${this.STYLES.code}">${this.escapeHtml(code)}</code>`,
    );

    // 加粗+斜体（非贪婪匹配 .+? 避免跨相邻标记吞噬）
    result = result.replace(
      /\*\*\*(.+?)\*\*\*/g,
      (_, content: string) =>
        `<strong style="${this.STYLES.strong}"><em style="${this.STYLES.em}">${this.escapeHtml(content)}</em></strong>`,
    );

    // 加粗（非贪婪）
    result = result.replace(
      /\*\*(.+?)\*\*/g,
      (_, content: string) =>
        `<strong style="${this.STYLES.strong}">${this.escapeHtml(content)}</strong>`,
    );

    // 斜体（非贪婪）
    result = result.replace(
      /\*(.+?)\*/g,
      (_, content: string) =>
        `<em style="${this.STYLES.em}">${this.escapeHtml(content)}</em>`,
    );

    // 链接（文本转义，URL 保留原样）
    result = result.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_, linkText: string, url: string) =>
        `<a style="${this.STYLES.a}" href="${url}">${this.escapeHtml(linkText)}</a>`,
    );

    // 脚注引用 [^1] → 上标
    result = result.replace(
      /\[\^(\d+)\]/g,
      '<sup style="color: #1a73e8; font-size: 12px;">[$1]</sup>',
    );

    // 转义剩余的 HTML 特殊字符（不影响已生成的 HTML 标签）
    result = result.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;)/g, "&amp;");
    result = result.replace(/<(?!\/?(?:code|strong|em|a|sup)\b)/g, "&lt;");

    return result;
  }

  /**
   * 渲染表格
   */
  private renderTable(rows: string[][]): string {
    if (rows.length === 0) return "";

    const headerRow = rows[0];
    const dataRows = rows.slice(1);

    let html = `<table style="${this.STYLES.table}"><thead><tr>`;
    for (const cell of headerRow) {
      html += `<th style="${this.STYLES.th}">${this.formatInline(cell)}</th>`;
    }
    html += "</tr></thead><tbody>";

    for (const row of dataRows) {
      html += "<tr>";
      for (let j = 0; j < headerRow.length; j++) {
        const cell = row[j] || "";
        html += `<td style="${this.STYLES.td}">${this.formatInline(cell)}</td>`;
      }
      html += "</tr>";
    }

    html += "</tbody></table>";
    return html;
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * 生成报告摘要（用于微信文章的 digest 字段）
   */
  generateDigest(markdown: string, maxLength: number = 120): string {
    // 移除 Markdown 标记，提取纯文本
    const plainText = markdown
      .replace(/#{1,6}\s+/g, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/^>\s*/gm, "")
      .replace(/\|/g, " ")
      .replace(/---+/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim();

    // 取前 N 个字符
    if (plainText.length <= maxLength) return plainText;
    return plainText.substring(0, maxLength - 3) + "...";
  }
}
