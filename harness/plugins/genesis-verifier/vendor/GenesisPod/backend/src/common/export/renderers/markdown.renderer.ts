/**
 * 统一导出系统 - Markdown 渲染器
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
export class MarkdownRenderer implements ExportRenderer {
  private readonly logger = new Logger(MarkdownRenderer.name);
  readonly format = ExportFormat.MARKDOWN;

  async render(
    content: UnifiedContent,
    _theme: ThemeConfig,
    _layout: LayoutConfig,
    options: ExportOptions,
  ): Promise<Buffer> {
    this.logger.debug("Rendering Markdown...");

    const parts: string[] = [];

    // 标题
    parts.push(`# ${content.metadata.title}\n`);

    // 元信息
    if (content.metadata.subtitle) {
      parts.push(`> ${content.metadata.subtitle}\n`);
    }

    const meta: string[] = [];
    if (content.metadata.author)
      meta.push(`**作者**: ${content.metadata.author}`);
    if (content.metadata.date) {
      meta.push(
        `**日期**: ${new Date(content.metadata.date).toLocaleDateString("zh-CN")}`,
      );
    }
    if (meta.length > 0) {
      parts.push(`${meta.join(" | ")}\n`);
    }

    parts.push("---\n");

    // 目录
    if (options.includeTableOfContents && content.tableOfContents?.enabled) {
      parts.push(this.generateToc(content));
    }

    // 正文
    for (const section of content.sections) {
      parts.push(this.renderSection(section));
    }

    // 参考文献
    if (content.references && options.includeReferences !== false) {
      parts.push(this.generateReferences(content.references));
    }

    const markdown = parts.join("\n");
    return Buffer.from(markdown, "utf-8");
  }

  getMimeType(): string {
    return MIME_TYPES.MARKDOWN;
  }

  getFileExtension(): string {
    return FILE_EXTENSIONS.MARKDOWN;
  }

  /**
   * 生成目录
   */
  private generateToc(content: UnifiedContent): string {
    const headings = content.sections.filter(
      (s) => s.type === "heading" && s.level && s.level <= 3,
    );

    if (headings.length === 0) return "";

    const lines = ["## 目录\n"];

    for (const h of headings) {
      const indent = "  ".repeat((h.level || 1) - 1);
      const anchor = normalizeMarkdownSlug(h.content || "");
      lines.push(`${indent}- [${h.content}](#${anchor})`);
    }

    lines.push("\n---\n");
    return lines.join("\n");
  }

  /**
   * 渲染单个内容节
   */
  private renderSection(section: ContentSection): string {
    switch (section.type) {
      case "heading":
        const prefix = "#".repeat(section.level || 1);
        return `${prefix} ${section.content}\n`;

      case "paragraph":
        return `${section.content}\n`;

      case "list":
        return this.renderList(section);

      case "table":
        return this.renderTable(section);

      case "code":
        return `\`\`\`${section.codeLanguage || ""}\n${section.content}\n\`\`\`\n`;

      case "quote":
        return `> ${section.content}\n`;

      case "divider":
        return "---\n";

      case "callout":
        return `> **${this.getCalloutEmoji(section.calloutType)}** ${section.content}\n`;

      case "image":
        return `![${section.imageAlt || ""}](${section.imageUrl})\n${section.imageCaption ? `*${section.imageCaption}*\n` : ""}`;

      default:
        return `${section.content || ""}\n`;
    }
  }

  /**
   * 渲染列表
   */
  private renderList(section: ContentSection): string {
    const lines: string[] = [];

    interface ListItemType {
      content: string;
      children?: ListItemType[];
    }
    const renderItems = (
      items: ListItemType[],
      prefix: string,
      depth: number,
    ) => {
      const marker = section.ordered ? `1.` : `-`;
      for (const item of items) {
        lines.push(`${"  ".repeat(depth)}${marker} ${item.content}`);
        if (item.children) {
          renderItems(item.children, prefix, depth + 1);
        }
      }
    };

    if (section.items) {
      renderItems(section.items, "", 0);
    }

    return lines.join("\n") + "\n";
  }

  /**
   * 渲染表格
   */
  private renderTable(section: ContentSection): string {
    const lines: string[] = [];

    // 表头
    if (section.headers) {
      lines.push(`| ${section.headers.join(" | ")} |`);
      lines.push(`| ${section.headers.map(() => "---").join(" | ")} |`);
    }

    // 表体
    if (section.rows) {
      for (const row of section.rows) {
        lines.push(`| ${row.cells.join(" | ")} |`);
      }
    }

    return lines.join("\n") + "\n";
  }

  /**
   * 生成参考文献
   */
  private generateReferences(references: Reference[]): string {
    const lines = ["\n---\n", "## 参考文献\n"];

    for (const ref of references) {
      lines.push(
        `${ref.id}. **${ref.title}**${ref.url ? ` - [链接](${ref.url})` : ""}`,
      );
      if (ref.snippet) {
        lines.push(`   > ${ref.snippet.slice(0, 100)}...`);
      }
    }

    return lines.join("\n");
  }

  /**
   * 获取提示框 emoji
   */
  private getCalloutEmoji(type?: string): string {
    const emojis: Record<string, string> = {
      info: "ℹ️ 提示",
      warning: "⚠️ 警告",
      success: "✅ 成功",
      error: "❌ 错误",
    };
    return emojis[type || "info"] || emojis.info;
  }
}
