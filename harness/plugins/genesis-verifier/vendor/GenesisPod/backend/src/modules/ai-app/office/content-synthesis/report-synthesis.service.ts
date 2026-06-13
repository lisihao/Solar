/**
 * Report Synthesis Engine
 * AI Engine 核心能力 - 报告合成通用工具集
 *
 * 提供跨模块共享的报告合成原子操作：
 * - generateSection: 生成单个报告章节
 * - checkConsistency: 跨来源一致性校验
 * - buildCitations: 构建引用列表
 * - sanitizeReport: 清洗报告 Markdown
 *
 * Topic-Insights 和 Research 模块各自保留编排逻辑，
 * 调用本服务完成通用操作。
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import {
  SynthesisSection,
  SourceReference,
  ConsistencyResult,
  ConsistencyIssue,
  SectionConfig,
  CitationFormat,
} from "./synthesis.types";
import { sanitizeMarkdownContent } from "../../../../common/utils/sanitize-content.utils";

@Injectable()
export class ReportSynthesisEngine {
  private readonly logger = new Logger(ReportSynthesisEngine.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 生成单个报告章节
   *
   * @param prompt - 完整的章节生成提示词（由调用方构建）
   * @param sources - 相关来源引用
   * @param config - 生成配置
   * @returns 生成的章节内容（Markdown）
   */
  async generateSection(
    prompt: string,
    sources: SourceReference[],
    config?: SectionConfig,
  ): Promise<string> {
    const sourceContext = this.formatSourcesForPrompt(sources);

    const fullPrompt = sourceContext
      ? `${prompt}\n\n## 参考来源\n${sourceContext}`
      : prompt;

    const response = await this.chatFacade.chat({
      messages: [{ role: "user", content: fullPrompt }],
      modelType: AIModelType.CHAT,
      taskProfile: {
        creativity: config?.creativity || "medium",
        outputLength: "long",
      },
    });

    return this.sanitizeReport(response.content);
  }

  /**
   * 跨来源一致性校验
   *
   * 检查多个章节之间是否存在矛盾、未支持的声明等问题
   */
  async checkConsistency(
    sections: SynthesisSection[],
  ): Promise<ConsistencyResult> {
    if (sections.length < 2) {
      return {
        isConsistent: true,
        score: 1.0,
        issues: [],
        suggestions: [],
      };
    }

    const sectionsSummary = sections
      .map(
        (s, i) => `## 章节 ${i + 1}: ${s.title}\n${s.content.slice(0, 2000)}`,
      )
      .join("\n\n---\n\n");

    const checkPrompt = `你是一位严谨的学术审查专家。请检查以下报告章节之间的一致性。

${sectionsSummary}

请以 JSON 格式输出检查结果：
\`\`\`json
{
  "isConsistent": true/false,
  "score": 0.0-1.0,
  "issues": [
    {
      "type": "contradiction|unsupported_claim|missing_citation|factual_error",
      "severity": "high|medium|low",
      "location": "章节X与章节Y",
      "description": "具体描述",
      "suggestedFix": "修复建议"
    }
  ],
  "suggestions": ["改进建议1", "改进建议2"]
}
\`\`\``;

    try {
      const response = await this.chatFacade.chat({
        messages: [{ role: "user", content: checkPrompt }],
        modelType: AIModelType.CHAT_FAST,
        taskProfile: {
          creativity: "deterministic",
          outputLength: "medium",
        },
      });

      return this.parseConsistencyResponse(response.content);
    } catch (error) {
      this.logger.warn(`Consistency check failed: ${error}`);
      return {
        isConsistent: true,
        score: 0.5,
        issues: [],
        suggestions: ["一致性检查失败，建议人工审核"],
      };
    }
  }

  /**
   * 构建引用列表
   *
   * @param sources - 来源列表
   * @param format - 引用格式
   * @returns 格式化的引用字符串数组
   */
  buildCitations(
    sources: SourceReference[],
    format: CitationFormat = "numbered",
  ): string[] {
    switch (format) {
      case "numbered":
        return sources.map(
          (s) =>
            `[${s.id}] ${s.title}${s.url ? ` - ${s.url}` : ""}${s.accessedAt ? ` (${s.accessedAt.toISOString().split("T")[0]})` : ""}`,
        );

      case "apa":
        return sources.map(
          (s) =>
            `${s.title}. ${s.domain ? `Retrieved from ${s.domain}` : ""}${s.publishedDate ? ` (${s.publishedDate})` : ""}${s.url ? `. ${s.url}` : ""}`,
        );

      case "inline":
        return sources.map((s) => `${s.title}${s.url ? ` (${s.url})` : ""}`);

      default:
        return sources.map((s) => `[${s.id}] ${s.title}`);
    }
  }

  /**
   * 清洗报告 Markdown
   *
   * 处理 AI 生成内容中的常见格式问题：
   * - 引用后的孤立下划线
   * - 多余的空行
   * - 不完整的 Markdown 语法
   * - 开头的重复标题
   */
  sanitizeReport(content: string): string {
    if (!content) return "";

    // 第一步：使用通用 Markdown 清洗（处理下划线 artifact 等）
    let sanitized = sanitizeMarkdownContent(content);

    // 第二步：报告特有的额外清洗

    // 移除 AI 输出中常见的代码块包装
    sanitized = sanitized.replace(/^```markdown\s*\n?/i, "");
    sanitized = sanitized.replace(/\n?```\s*$/i, "");

    // 清理多余的空行（超过2个连续空行合并为2个）
    sanitized = sanitized.replace(/\n{4,}/g, "\n\n\n");

    // 清理行尾空格
    sanitized = sanitized.replace(/[ \t]+$/gm, "");

    // 修复不完整的加粗标记
    const boldMatches = sanitized.match(/\*\*/g);
    if (boldMatches && boldMatches.length % 2 !== 0) {
      // 找到最后一个未配对的 ** 并移除
      const lastIndex = sanitized.lastIndexOf("**");
      sanitized =
        sanitized.slice(0, lastIndex) + sanitized.slice(lastIndex + 2);
    }

    return sanitized.trim();
  }

  /**
   * 格式化来源列表为 prompt 上下文
   */
  private formatSourcesForPrompt(sources: SourceReference[]): string {
    if (!sources.length) return "";

    return sources
      .map(
        (s) =>
          `[${s.id}] **${s.title}**${s.domain ? `\n来源: ${s.domain}` : ""}${s.publishedDate ? ` (${s.publishedDate})` : ""}\n${s.snippet || ""}`,
      )
      .join("\n\n---\n\n");
  }

  /**
   * 解析一致性检查响应
   */
  private parseConsistencyResponse(content: string): ConsistencyResult {
    try {
      // 提取 JSON
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          isConsistent: parsed.isConsistent ?? true,
          score: Math.max(0, Math.min(1, parsed.score ?? 0.5)),
          issues: (parsed.issues || []).map(
            (issue: Record<string, unknown>) => ({
              type: issue.type || "factual_error",
              severity: issue.severity || "low",
              location: String(issue.location || ""),
              description: String(issue.description || ""),
              suggestedFix: issue.suggestedFix
                ? String(issue.suggestedFix)
                : undefined,
            }),
          ) as ConsistencyIssue[],
          suggestions: (parsed.suggestions || []).map(String),
        };
      }
    } catch (error) {
      this.logger.warn(`Failed to parse consistency response: ${error}`);
    }

    return {
      isConsistent: true,
      score: 0.5,
      issues: [],
      suggestions: ["无法解析一致性检查结果"],
    };
  }
}
