/**
 * 统一导出系统 - HTML 渲染器
 * 生成独立的 HTML 文件
 */

import { Injectable, Logger } from "@nestjs/common";
import { ExportFormat } from "@prisma/client";
import {
  ExportRenderer,
  MIME_TYPES,
  FILE_EXTENSIONS,
} from "./renderer.interface";
import {
  UnifiedContent,
  ContentSection,
  Reference,
} from "../types/unified-content";
import { ThemeConfig, LayoutConfig } from "../types/theme-config";
import { ExportOptions } from "../types/export-options";
import { normalizeMarkdownSlug } from "../../../modules/ai-engine/content/markdown/slug-normalize.util";

@Injectable()
export class HtmlRenderer implements ExportRenderer {
  private readonly logger = new Logger(HtmlRenderer.name);
  readonly format = ExportFormat.HTML;

  async render(
    content: UnifiedContent,
    theme: ThemeConfig,
    _layout: LayoutConfig,
    options: ExportOptions,
  ): Promise<Buffer> {
    this.logger.debug("Rendering HTML...");

    const css = this.generateCss(theme);
    const bodyHtml = this.generateBody(content, theme, options);

    const html = `
<!DOCTYPE html>
<html lang="${content.metadata.language || "zh-CN"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="author" content="${this.escapeHtml(content.metadata.author || "")}">
  <meta name="description" content="${this.escapeHtml(content.metadata.subtitle || "")}">
  <title>${this.escapeHtml(content.metadata.title)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="container">
    ${options.includeCover !== false ? this.generateCover(content, theme) : ""}
    ${options.includeTableOfContents && content.tableOfContents?.enabled ? this.generateToc(content, theme) : ""}
    <main class="content" id="content">
      ${bodyHtml}
    </main>
    ${content.references && options.includeReferences !== false ? this.generateReferences(content.references, theme) : ""}
  </div>
  ${options.watermark ? this.generateWatermark(options.watermark, options.watermarkOpacity) : ""}
  <script>${this.generateScript()}</script>
</body>
</html>
    `.trim();

    const buffer = Buffer.from(html, "utf-8");
    this.logger.debug(`HTML generated: ${buffer.length} bytes`);

    return buffer;
  }

  getMimeType(): string {
    return MIME_TYPES.HTML;
  }

  getFileExtension(): string {
    return FILE_EXTENSIONS.HTML;
  }

  /**
   * 生成 CSS 样式
   */
  private generateCss(theme: ThemeConfig): string {
    return `
      :root {
        --color-primary: ${theme.colors.primary};
        --color-secondary: ${theme.colors.secondary};
        --color-accent: ${theme.colors.accent};
        --color-background: ${theme.colors.background};
        --color-background-alt: ${theme.colors.backgroundAlt || "#f9fafb"};
        --color-text: ${theme.colors.text};
        --color-text-light: ${theme.colors.textLight};
        --color-heading: ${theme.colors.heading};
        --color-link: ${theme.colors.link};
        --color-border: ${theme.colors.border};
        --color-success: ${theme.colors.success};
        --color-warning: ${theme.colors.warning};
        --color-error: ${theme.colors.error};
        --color-info: ${theme.colors.info || "#3b82f6"};

        --font-heading: ${theme.fonts.heading.family};
        --font-body: ${theme.fonts.body.family};
        --font-mono: ${theme.fonts.mono.family};

        --spacing-section: ${theme.spacing.section}px;
        --spacing-paragraph: ${theme.spacing.paragraph}px;
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      html {
        scroll-behavior: smooth;
      }

      body {
        font-family: var(--font-body);
        font-size: ${theme.fonts.body.size}px;
        line-height: ${theme.fonts.body.lineHeight};
        color: var(--color-text);
        background: var(--color-background);
      }

      .container {
        max-width: 900px;
        margin: 0 auto;
        padding: 2rem;
      }

      /* 封面 */
      .cover {
        min-height: 80vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
        padding: 4rem 2rem;
        border-bottom: 2px solid var(--color-border);
        margin-bottom: 3rem;
      }

      .cover-title {
        font-family: var(--font-heading);
        font-size: 3rem;
        font-weight: ${theme.fonts.heading.weight};
        color: var(--color-heading);
        margin-bottom: 1rem;
        line-height: 1.2;
      }

      .cover-subtitle {
        font-size: 1.25rem;
        color: var(--color-text-light);
        margin-bottom: 2rem;
        max-width: 600px;
      }

      .cover-meta {
        font-size: 0.95rem;
        color: var(--color-text-light);
      }

      .cover-meta p {
        margin: 0.25rem 0;
      }

      /* 目录 */
      .toc {
        background: var(--color-background-alt);
        padding: 2rem;
        border-radius: ${theme.decorations.roundedCorners ? "12px" : "0"};
        margin-bottom: 3rem;
      }

      .toc-title {
        font-family: var(--font-heading);
        font-size: 1.5rem;
        font-weight: ${theme.fonts.heading.weight};
        color: var(--color-heading);
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 2px solid var(--color-primary);
      }

      .toc-list {
        list-style: none;
      }

      .toc-item {
        padding: 0.5rem 0;
        border-bottom: 1px dotted var(--color-border);
      }

      .toc-item:last-child {
        border-bottom: none;
      }

      .toc-item a {
        color: var(--color-text);
        text-decoration: none;
        transition: color 0.2s;
      }

      .toc-item a:hover {
        color: var(--color-primary);
      }

      .toc-item-level-1 { font-weight: 600; }
      .toc-item-level-2 { padding-left: 1.5rem; }
      .toc-item-level-3 { padding-left: 3rem; font-size: 0.9em; }

      /* 内容 */
      .content {
        line-height: ${theme.fonts.body.lineHeight};
      }

      h1, h2, h3, h4, h5, h6 {
        font-family: var(--font-heading);
        font-weight: ${theme.fonts.heading.weight};
        color: var(--color-heading);
        margin-top: var(--spacing-section);
        margin-bottom: var(--spacing-paragraph);
        line-height: ${theme.fonts.heading.lineHeight};
      }

      h1 {
        font-size: 2rem;
        padding-bottom: 0.5rem;
        border-bottom: ${theme.decorations.headingUnderline ? `2px solid var(--color-primary)` : "none"};
      }

      h2 { font-size: 1.5rem; }
      h3 { font-size: 1.25rem; }
      h4 { font-size: 1.1rem; }
      h5 { font-size: 1rem; }
      h6 { font-size: 0.95rem; }

      p {
        margin-bottom: var(--spacing-paragraph);
        text-align: justify;
      }

      a {
        color: var(--color-link);
        text-decoration: none;
        transition: opacity 0.2s;
      }

      a:hover {
        opacity: 0.8;
        text-decoration: underline;
      }

      /* 列表 */
      ul, ol {
        margin-bottom: var(--spacing-paragraph);
        padding-left: 2rem;
      }

      li {
        margin-bottom: 0.25rem;
      }

      li ul, li ol {
        margin-top: 0.25rem;
        margin-bottom: 0;
      }

      /* 表格 */
      table {
        width: 100%;
        border-collapse: collapse;
        margin: var(--spacing-section) 0;
        font-size: 0.95em;
      }

      th, td {
        padding: 0.75rem 1rem;
        text-align: left;
        border: ${theme.decorations.showTableBorders ? "1px solid var(--color-border)" : "none"};
      }

      th {
        background: var(--color-background-alt);
        font-weight: 600;
        color: var(--color-heading);
      }

      tr:nth-child(even) {
        background: var(--color-background-alt);
      }

      tr:hover {
        background: rgba(0, 0, 0, 0.02);
      }

      /* 代码 */
      code {
        font-family: var(--font-mono);
        font-size: ${theme.fonts.mono.size}px;
        background: var(--color-background-alt);
        padding: 0.2rem 0.4rem;
        border-radius: ${theme.decorations.roundedCorners ? "4px" : "0"};
      }

      pre {
        background: #1e1e1e;
        color: #d4d4d4;
        padding: 1rem 1.25rem;
        border-radius: ${theme.decorations.roundedCorners ? "8px" : "0"};
        overflow-x: auto;
        margin: var(--spacing-section) 0;
        font-size: ${theme.fonts.mono.size}px;
        line-height: 1.5;
      }

      pre code {
        background: transparent;
        padding: 0;
        font-size: inherit;
      }

      /* 引用 */
      blockquote {
        border-left: 4px solid var(--color-primary);
        padding: 1rem 1.25rem;
        margin: var(--spacing-section) 0;
        background: var(--color-background-alt);
        font-style: italic;
        color: var(--color-text-light);
        border-radius: ${theme.decorations.roundedCorners ? "0 8px 8px 0" : "0"};
      }

      blockquote p:last-child {
        margin-bottom: 0;
      }

      /* 分隔线 */
      hr {
        border: none;
        border-top: 1px solid var(--color-border);
        margin: var(--spacing-section) 0;
      }

      /* 提示框 */
      .callout {
        padding: 1rem 1.25rem;
        margin: var(--spacing-section) 0;
        border-radius: ${theme.decorations.roundedCorners ? "8px" : "0"};
        border-left: 4px solid;
      }

      .callout-info {
        background: #e7f5ff;
        border-color: var(--color-info);
      }

      .callout-warning {
        background: #fff8e1;
        border-color: var(--color-warning);
      }

      .callout-success {
        background: #e8f5e9;
        border-color: var(--color-success);
      }

      .callout-error {
        background: #ffebee;
        border-color: var(--color-error);
      }

      .callout-icon {
        font-size: 1.2em;
        margin-right: 0.5rem;
      }

      /* 图片 */
      figure {
        margin: var(--spacing-section) 0;
        text-align: center;
      }

      figure img {
        max-width: 100%;
        height: auto;
        border-radius: ${theme.decorations.roundedCorners ? "8px" : "0"};
        ${theme.decorations.shadowEffects ? "box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);" : ""}
      }

      figcaption {
        margin-top: 0.5rem;
        font-size: 0.9em;
        color: var(--color-text-light);
        font-style: italic;
      }

      /* 引用标记 */
      .citation {
        color: var(--color-primary);
        font-weight: 600;
        font-size: 0.85em;
        vertical-align: super;
        cursor: pointer;
        transition: opacity 0.2s;
      }

      .citation:hover {
        opacity: 0.7;
      }

      /* 参考文献 */
      .references {
        margin-top: 4rem;
        padding-top: 2rem;
        border-top: 2px solid var(--color-border);
      }

      .references-title {
        font-family: var(--font-heading);
        font-size: 1.5rem;
        font-weight: ${theme.fonts.heading.weight};
        color: var(--color-heading);
        margin-bottom: 1.5rem;
        padding-bottom: 0.5rem;
        border-bottom: 2px solid var(--color-primary);
      }

      .reference-item {
        display: flex;
        margin-bottom: 1rem;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid var(--color-border);
      }

      .reference-item:last-child {
        border-bottom: none;
      }

      .reference-number {
        flex-shrink: 0;
        width: 2.5rem;
        font-weight: 600;
        color: var(--color-primary);
      }

      .reference-content {
        flex: 1;
      }

      .reference-title {
        font-weight: 600;
        color: var(--color-heading);
        margin-bottom: 0.25rem;
      }

      .reference-url {
        font-size: 0.9em;
        color: var(--color-link);
        word-break: break-all;
      }

      .reference-snippet {
        font-size: 0.9em;
        color: var(--color-text-light);
        margin-top: 0.25rem;
        line-height: 1.5;
      }

      /* 水印 */
      .watermark {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-45deg);
        font-size: 72px;
        font-weight: bold;
        color: rgba(0, 0, 0, 0.03);
        pointer-events: none;
        white-space: nowrap;
        z-index: 1000;
        user-select: none;
      }

      /* 响应式 */
      @media (max-width: 768px) {
        .container {
          padding: 1rem;
        }

        .cover {
          min-height: auto;
          padding: 2rem 1rem;
        }

        .cover-title {
          font-size: 2rem;
        }

        h1 { font-size: 1.5rem; }
        h2 { font-size: 1.25rem; }

        table {
          font-size: 0.85em;
        }

        th, td {
          padding: 0.5rem;
        }
      }

      /* 打印样式 */
      @media print {
        .container {
          max-width: 100%;
          padding: 0;
        }

        .cover {
          page-break-after: always;
        }

        .toc {
          page-break-after: always;
        }

        h1, h2, h3 {
          page-break-after: avoid;
        }

        table, figure {
          page-break-inside: avoid;
        }

        .watermark {
          display: none;
        }

        a {
          color: var(--color-text);
          text-decoration: none;
        }

        a::after {
          content: " (" attr(href) ")";
          font-size: 0.8em;
          color: var(--color-text-light);
        }
      }

      /* 暗色模式支持 */
      @media (prefers-color-scheme: dark) {
        :root {
          --color-background: #1a1a1a;
          --color-background-alt: #2a2a2a;
          --color-text: #e0e0e0;
          --color-text-light: #a0a0a0;
          --color-heading: #ffffff;
          --color-border: #404040;
        }

        pre {
          background: #0d0d0d;
        }

        .callout-info { background: #1a3a5c; }
        .callout-warning { background: #4a3a1a; }
        .callout-success { background: #1a3a2a; }
        .callout-error { background: #3a1a1a; }

        th {
          background: #2a2a2a;
        }

        tr:nth-child(even) {
          background: #222;
        }
      }
    `;
  }

  /**
   * 生成封面
   */
  private generateCover(content: UnifiedContent, _theme: ThemeConfig): string {
    const meta = content.metadata;
    return `
      <header class="cover">
        <h1 class="cover-title">${this.escapeHtml(meta.title)}</h1>
        ${meta.subtitle ? `<p class="cover-subtitle">${this.escapeHtml(meta.subtitle)}</p>` : ""}
        <div class="cover-meta">
          ${meta.author ? `<p>作者: ${this.escapeHtml(meta.author)}</p>` : ""}
          ${meta.organization ? `<p>${this.escapeHtml(meta.organization)}</p>` : ""}
          ${meta.date ? `<p>日期: ${new Date(meta.date).toLocaleDateString("zh-CN")}</p>` : ""}
        </div>
      </header>
    `;
  }

  /**
   * 生成目录
   */
  private generateToc(content: UnifiedContent, _theme: ThemeConfig): string {
    const headings = content.sections.filter(
      (s) => s.type === "heading" && s.level && s.level <= 3,
    );

    if (headings.length === 0) return "";

    const items = headings
      .map((h) => {
        const anchor = normalizeMarkdownSlug(h.content || "");
        return `
          <li class="toc-item toc-item-level-${h.level}">
            <a href="#${anchor}">${this.escapeHtml(h.content || "")}</a>
          </li>
        `;
      })
      .join("");

    return `
      <nav class="toc">
        <h2 class="toc-title">${content.tableOfContents?.title || "目录"}</h2>
        <ul class="toc-list">
          ${items}
        </ul>
      </nav>
    `;
  }

  /**
   * 生成正文
   */
  private generateBody(
    content: UnifiedContent,
    _theme: ThemeConfig,
    _options: ExportOptions,
  ): string {
    return content.sections
      .map((section) => this.renderSection(section))
      .join("\n");
  }

  /**
   * 渲染单个内容节
   */
  private renderSection(section: ContentSection): string {
    switch (section.type) {
      case "heading":
        const level = Math.min(section.level || 1, 6);
        const anchor = normalizeMarkdownSlug(section.content || "");
        return `<h${level} id="${anchor}">${this.escapeHtml(section.content || "")}</h${level}>`;

      case "paragraph":
        return `<p>${this.formatContent(section.content || "")}</p>`;

      case "list":
        return this.renderList(section);

      case "table":
        return this.renderTable(section);

      case "code":
        return `<pre><code class="language-${section.codeLanguage || ""}">${this.escapeHtml(section.content || "")}</code></pre>`;

      case "quote":
        return `<blockquote><p>${this.escapeHtml(section.content || "")}</p></blockquote>`;

      case "divider":
        return "<hr>";

      case "callout":
        const icon = this.getCalloutIcon(section.calloutType);
        return `
          <div class="callout callout-${section.calloutType || "info"}">
            <span class="callout-icon">${icon}</span>
            ${this.escapeHtml(section.content || "")}
          </div>
        `;

      case "image":
        return `
          <figure>
            <img src="${section.imageUrl}" alt="${this.escapeHtml(section.imageAlt || "")}">
            ${section.imageCaption ? `<figcaption>${this.escapeHtml(section.imageCaption)}</figcaption>` : ""}
          </figure>
        `;

      default:
        return `<p>${this.escapeHtml(section.content || "")}</p>`;
    }
  }

  /**
   * 渲染列表
   */
  private renderList(section: ContentSection): string {
    const tag = section.ordered ? "ol" : "ul";

    interface ListItemType {
      content: string;
      children?: ListItemType[];
    }
    const renderItems = (items: ListItemType[]): string => {
      return items
        .map((item) => {
          const children = item.children ? renderItems(item.children) : "";
          return `<li>${this.escapeHtml(item.content)}${children ? `<${tag}>${children}</${tag}>` : ""}</li>`;
        })
        .join("");
    };

    return `<${tag}>${renderItems(section.items || [])}</${tag}>`;
  }

  /**
   * 渲染表格
   */
  private renderTable(section: ContentSection): string {
    const headers = section.headers
      ?.map((h) => `<th>${this.escapeHtml(h)}</th>`)
      .join("");

    const rows = section.rows
      ?.map(
        (row) =>
          `<tr>${row.cells.map((c) => `<td>${this.escapeHtml(c)}</td>`).join("")}</tr>`,
      )
      .join("");

    return `
      <table>
        ${headers ? `<thead><tr>${headers}</tr></thead>` : ""}
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  /**
   * 生成参考文献
   */
  private generateReferences(
    references: Reference[],
    _theme: ThemeConfig,
  ): string {
    const items = references
      .map(
        (ref) => `
        <div class="reference-item" id="ref-${ref.id}">
          <span class="reference-number">[${ref.id}]</span>
          <div class="reference-content">
            <div class="reference-title">${this.escapeHtml(ref.title)}</div>
            ${ref.url ? `<a class="reference-url" href="${ref.url}" target="_blank" rel="noopener">${this.escapeHtml(ref.url)}</a>` : ""}
            ${ref.snippet ? `<div class="reference-snippet">${this.escapeHtml(ref.snippet.slice(0, 200))}...</div>` : ""}
          </div>
        </div>
      `,
      )
      .join("");

    return `
      <section class="references">
        <h2 class="references-title">参考文献</h2>
        ${items}
      </section>
    `;
  }

  /**
   * 生成水印
   */
  private generateWatermark(text: string, opacity?: number): string {
    const opacityValue = opacity || 0.03;
    return `<div class="watermark" style="opacity: ${opacityValue}">${this.escapeHtml(text)}</div>`;
  }

  /**
   * 生成脚本
   */
  private generateScript(): string {
    return `
      // 平滑滚动到锚点
      document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
          e.preventDefault();
          const target = document.querySelector(this.getAttribute('href'));
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      });

      // 引用点击跳转
      document.querySelectorAll('.citation').forEach(citation => {
        citation.addEventListener('click', function() {
          const refId = this.getAttribute('data-ref');
          const refElement = document.getElementById('ref-' + refId);
          if (refElement) {
            refElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            refElement.style.backgroundColor = 'rgba(99, 102, 241, 0.1)';
            setTimeout(() => {
              refElement.style.backgroundColor = '';
            }, 2000);
          }
        });
      });
    `;
  }

  /**
   * 格式化内容（处理引用标记等）
   */
  private formatContent(content: string): string {
    return this.escapeHtml(content).replace(
      /\[(\d+)\]/g,
      '<a href="#ref-$1" class="citation" data-ref="$1" style="text-decoration:none">[$1]</a>',
    );
  }

  /**
   * 获取提示框图标
   */
  private getCalloutIcon(type?: string): string {
    const icons: Record<string, string> = {
      info: "ℹ️",
      warning: "⚠️",
      success: "✅",
      error: "❌",
    };
    return icons[type || "info"] || icons.info;
  }

  /**
   * WYSIWYG 模式：包装前端捕获的 HTML+CSS 为独立文件
   */
  async renderFromHtml(
    capturedHtml: string,
    capturedCss: string,
    title: string,
  ): Promise<Buffer> {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
  <style>${capturedCss}</style>
  <style>
    /* Override app background styles captured from the live DOM */
    html, body { background: #ffffff !important; background-image: none !important; }
    body { max-width: 900px; margin: 0 auto; padding: 2rem; color: #333; font-family: 'Inter', 'Noto Sans SC', system-ui, sans-serif; line-height: 1.6; }
  </style>
</head>
<body>
  ${capturedHtml}
</body>
</html>`;
    return Buffer.from(html, "utf-8");
  }

  /**
   * 转义 HTML
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}
