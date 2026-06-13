/**
 * Document Diff Tool
 * 文档对比工具 - 对比两个文档或文本的差异
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";

// ============================================================================
// Types
// ============================================================================

export interface DocumentDiffInput {
  /**
   * 源文档/文本
   */
  source: string;

  /**
   * 目标文档/文本
   */
  target: string;

  /**
   * 对比类型
   */
  diffType?: "chars" | "words" | "lines" | "sentences";

  /**
   * 输出格式
   */
  format?: "unified" | "side-by-side" | "json" | "html";

  /**
   * 上下文行数（unified 格式）
   */
  contextLines?: number;

  /**
   * 忽略选项
   */
  ignore?: {
    /**
     * 忽略空白字符
     */
    whitespace?: boolean;

    /**
     * 忽略大小写
     */
    case?: boolean;

    /**
     * 忽略空行
     */
    emptyLines?: boolean;
  };
}

export interface DiffChange {
  /**
   * 变更类型
   */
  type: "add" | "delete" | "modify" | "unchanged";

  /**
   * 源文本位置
   */
  sourceStart: number;
  sourceEnd: number;

  /**
   * 目标文本位置
   */
  targetStart: number;
  targetEnd: number;

  /**
   * 源内容
   */
  sourceContent: string;

  /**
   * 目标内容
   */
  targetContent: string;
}

export interface DiffStatistics {
  /**
   * 新增数量
   */
  additions: number;

  /**
   * 删除数量
   */
  deletions: number;

  /**
   * 修改数量
   */
  modifications: number;

  /**
   * 未变更数量
   */
  unchanged: number;

  /**
   * 相似度（0-100）
   */
  similarity: number;
}

export interface DocumentDiffOutput {
  /**
   * 变更列表
   */
  changes: DiffChange[];

  /**
   * 统计信息
   */
  statistics: DiffStatistics;

  /**
   * 格式化的 diff 输出
   */
  formatted: string;

  /**
   * 是否完全相同
   */
  identical: boolean;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class DocumentDiffTool extends BaseTool<
  DocumentDiffInput,
  DocumentDiffOutput
> {
  private readonly logger = new Logger(DocumentDiffTool.name);

  readonly id = "document-diff";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "processing";
  readonly tags = ["processing", "document", "diff", "compare", "version"];
  readonly name = "文档对比";
  readonly description =
    "对比两个文档或文本的差异。支持字符、单词、行、句子级别的对比，显示新增、删除、修改内容。支持多种输出格式（unified、side-by-side、JSON、HTML）。适用于版本对比、文档审核、变更跟踪等场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      source: {
        type: "string",
        description: "源文档/文本内容",
      },
      target: {
        type: "string",
        description: "目标文档/文本内容",
      },
      diffType: {
        type: "string",
        description: "对比粒度",
        enum: ["chars", "words", "lines", "sentences"],
        default: "lines",
      },
      format: {
        type: "string",
        description: "输出格式",
        enum: ["unified", "side-by-side", "json", "html"],
        default: "unified",
      },
      contextLines: {
        type: "number",
        description: "上下文行数（unified 格式）",
        default: 3,
      },
      ignore: {
        type: "object",
        description: "忽略选项",
        properties: {
          whitespace: {
            type: "boolean",
            description: "忽略空白字符",
            default: false,
          },
          case: {
            type: "boolean",
            description: "忽略大小写",
            default: false,
          },
          emptyLines: {
            type: "boolean",
            description: "忽略空行",
            default: false,
          },
        },
      },
    },
    required: ["source", "target"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      changes: {
        type: "array",
        description: "变更列表",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "变更类型" },
            sourceStart: { type: "number", description: "源位置开始" },
            sourceEnd: { type: "number", description: "源位置结束" },
            targetStart: { type: "number", description: "目标位置开始" },
            targetEnd: { type: "number", description: "目标位置结束" },
            sourceContent: { type: "string", description: "源内容" },
            targetContent: { type: "string", description: "目标内容" },
          },
        },
      },
      statistics: {
        type: "object",
        description: "统计信息",
        properties: {
          additions: { type: "number", description: "新增数量" },
          deletions: { type: "number", description: "删除数量" },
          modifications: { type: "number", description: "修改数量" },
          unchanged: { type: "number", description: "未变更数量" },
          similarity: { type: "number", description: "相似度（0-100）" },
        },
      },
      formatted: {
        type: "string",
        description: "格式化的 diff 输出",
      },
      identical: {
        type: "boolean",
        description: "是否完全相同",
      },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property // 60 秒超时
  }

  validateInput(input: DocumentDiffInput) {
    if (
      input.source === undefined ||
      input.source === null ||
      input.target === undefined ||
      input.target === null
    ) {
      return false;
    }

    return true;
  }

  protected async doExecute(
    input: DocumentDiffInput,
    _context: ToolContext,
  ): Promise<DocumentDiffOutput> {
    const {
      source,
      target,
      diffType = "lines",
      format = "unified",
      contextLines = 3,
      ignore = {},
    } = input;

    this.logger.log(`[doExecute] Comparing documents (type: ${diffType})...`);

    try {
      // 预处理文本
      const processedSource = this.preprocessText(source, ignore);
      const processedTarget = this.preprocessText(target, ignore);

      // 分割文本
      const sourceUnits = this.splitText(processedSource, diffType);
      const targetUnits = this.splitText(processedTarget, diffType);

      // 计算 diff
      const changes = this.computeDiff(sourceUnits, targetUnits);

      // 计算统计信息
      const statistics = this.computeStatistics(
        changes,
        sourceUnits,
        targetUnits,
      );

      // 格式化输出
      const formatted = this.formatDiff(
        changes,
        sourceUnits,
        targetUnits,
        format,
        contextLines,
      );

      const result: DocumentDiffOutput = {
        changes,
        statistics,
        formatted,
        identical: changes.every((c) => c.type === "unchanged"),
      };

      this.logger.log(
        `[doExecute] Diff complete. Additions: ${statistics.additions}, Deletions: ${statistics.deletions}, Similarity: ${statistics.similarity}%`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[doExecute] Diff failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // ==========================================================================
  // Text Preprocessing
  // ==========================================================================

  private preprocessText(
    text: string,
    ignore: DocumentDiffInput["ignore"] = {},
  ): string {
    let processed = text;

    if (ignore.case) {
      processed = processed.toLowerCase();
    }

    if (ignore.whitespace) {
      processed = processed.replace(/\s+/g, " ");
    }

    if (ignore.emptyLines) {
      processed = processed
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .join("\n");
    }

    return processed;
  }

  private splitText(text: string, diffType: string): string[] {
    switch (diffType) {
      case "chars":
        return text.split("");

      case "words":
        return text.split(/\s+/);

      case "sentences":
        return text.split(/[.!?]+\s+/).filter((s) => s.length > 0);

      case "lines":
      default:
        return text.split("\n");
    }
  }

  // ==========================================================================
  // Diff Computation (Myers Algorithm)
  // ==========================================================================

  private computeDiff(source: string[], target: string[]): DiffChange[] {
    const diff = require("diff");

    const changes: DiffChange[] = [];
    let sourceIndex = 0;
    let targetIndex = 0;

    const patches = diff.diffArrays(source, target);

    for (const patch of patches) {
      const value = patch.value as string[];

      if (patch.added) {
        changes.push({
          type: "add",
          sourceStart: sourceIndex,
          sourceEnd: sourceIndex,
          targetStart: targetIndex,
          targetEnd: targetIndex + value.length,
          sourceContent: "",
          targetContent: value.join(this.getJoinSeparator(source)),
        });
        targetIndex += value.length;
      } else if (patch.removed) {
        changes.push({
          type: "delete",
          sourceStart: sourceIndex,
          sourceEnd: sourceIndex + value.length,
          targetStart: targetIndex,
          targetEnd: targetIndex,
          sourceContent: value.join(this.getJoinSeparator(source)),
          targetContent: "",
        });
        sourceIndex += value.length;
      } else {
        changes.push({
          type: "unchanged",
          sourceStart: sourceIndex,
          sourceEnd: sourceIndex + value.length,
          targetStart: targetIndex,
          targetEnd: targetIndex + value.length,
          sourceContent: value.join(this.getJoinSeparator(source)),
          targetContent: value.join(this.getJoinSeparator(target)),
        });
        sourceIndex += value.length;
        targetIndex += value.length;
      }
    }

    return this.mergeModifications(changes);
  }

  private mergeModifications(changes: DiffChange[]): DiffChange[] {
    const merged: DiffChange[] = [];

    for (let i = 0; i < changes.length; i++) {
      const current = changes[i];

      // Check if next change is a pair (delete + add = modify)
      if (
        current.type === "delete" &&
        i + 1 < changes.length &&
        changes[i + 1].type === "add"
      ) {
        const next = changes[i + 1];
        merged.push({
          type: "modify",
          sourceStart: current.sourceStart,
          sourceEnd: current.sourceEnd,
          targetStart: next.targetStart,
          targetEnd: next.targetEnd,
          sourceContent: current.sourceContent,
          targetContent: next.targetContent,
        });
        i++; // Skip next
      } else {
        merged.push(current);
      }
    }

    return merged;
  }

  private getJoinSeparator(units: string[]): string {
    // Heuristic: if units contain newlines, use newline; otherwise use space
    return units.some((u) => u.includes("\n")) ? "\n" : " ";
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  private computeStatistics(
    changes: DiffChange[],
    source: string[],
    target: string[],
  ): DiffStatistics {
    const statistics: DiffStatistics = {
      additions: 0,
      deletions: 0,
      modifications: 0,
      unchanged: 0,
      similarity: 0,
    };

    for (const change of changes) {
      switch (change.type) {
        case "add":
          statistics.additions += change.targetEnd - change.targetStart;
          break;
        case "delete":
          statistics.deletions += change.sourceEnd - change.sourceStart;
          break;
        case "modify":
          statistics.modifications += 1;
          break;
        case "unchanged":
          statistics.unchanged += change.sourceEnd - change.sourceStart;
          break;
      }
    }

    // Calculate similarity (Levenshtein-based)
    const totalUnits = Math.max(source.length, target.length);
    const changedUnits = statistics.additions + statistics.deletions;
    statistics.similarity = Math.round(
      ((totalUnits - changedUnits) / totalUnits) * 100,
    );

    return statistics;
  }

  // ==========================================================================
  // Formatting
  // ==========================================================================

  private formatDiff(
    changes: DiffChange[],
    source: string[],
    target: string[],
    format: string,
    contextLines: number,
  ): string {
    switch (format) {
      case "unified":
        return this.formatUnified(changes, source, target, contextLines);

      case "side-by-side":
        return this.formatSideBySide(changes, source, target);

      case "json":
        return JSON.stringify(changes, null, 2);

      case "html":
        return this.formatHTML(changes, source, target);

      default:
        return this.formatUnified(changes, source, target, contextLines);
    }
  }

  private formatUnified(
    changes: DiffChange[],
    _source: string[],
    _target: string[],
    contextLines: number,
  ): string {
    const lines: string[] = [];

    lines.push("--- Source");
    lines.push("+++ Target");

    for (const change of changes) {
      if (change.type === "unchanged") {
        const content = change.sourceContent.split("\n");
        content.slice(0, contextLines).forEach((line) => {
          lines.push(` ${line}`);
        });
      } else if (change.type === "delete") {
        const content = change.sourceContent.split("\n");
        content.forEach((line) => {
          lines.push(`-${line}`);
        });
      } else if (change.type === "add") {
        const content = change.targetContent.split("\n");
        content.forEach((line) => {
          lines.push(`+${line}`);
        });
      } else if (change.type === "modify") {
        const sourceContent = change.sourceContent.split("\n");
        const targetContent = change.targetContent.split("\n");
        sourceContent.forEach((line) => {
          lines.push(`-${line}`);
        });
        targetContent.forEach((line) => {
          lines.push(`+${line}`);
        });
      }
    }

    return lines.join("\n");
  }

  private formatSideBySide(
    changes: DiffChange[],
    _source: string[],
    _target: string[],
  ): string {
    const lines: string[] = [];
    const width = 50;

    lines.push("Source".padEnd(width) + " | Target");
    lines.push("-".repeat(width) + " | " + "-".repeat(width));

    for (const change of changes) {
      const sourceLines = change.sourceContent.split("\n");
      const targetLines = change.targetContent.split("\n");

      const maxLines = Math.max(sourceLines.length, targetLines.length);

      for (let i = 0; i < maxLines; i++) {
        const sourceLine = (sourceLines[i] || "").padEnd(width);
        const targetLine = targetLines[i] || "";
        lines.push(`${sourceLine} | ${targetLine}`);
      }
    }

    return lines.join("\n");
  }

  private formatHTML(
    changes: DiffChange[],
    _source: string[],
    _target: string[],
  ): string {
    const lines: string[] = [];

    lines.push('<div class="diff">');

    for (const change of changes) {
      switch (change.type) {
        case "add":
          lines.push(
            `<div class="add">+ ${this.escapeHtml(change.targetContent)}</div>`,
          );
          break;
        case "delete":
          lines.push(
            `<div class="delete">- ${this.escapeHtml(change.sourceContent)}</div>`,
          );
          break;
        case "modify":
          lines.push(
            `<div class="modify">~ ${this.escapeHtml(change.sourceContent)} → ${this.escapeHtml(change.targetContent)}</div>`,
          );
          break;
        case "unchanged":
          lines.push(
            `<div class="unchanged">  ${this.escapeHtml(change.sourceContent)}</div>`,
          );
          break;
      }
    }

    lines.push("</div>");

    return lines.join("\n");
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
