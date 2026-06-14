/**
 * Research Quality Gate Service
 *
 * 3 层质量控制体系的第一层：代码校验（纯规则，无 LLM 依赖）。
 *
 * 可自动修复的格式问题 → 自动修复并标记 warning
 * 需要重写的结构/内容问题 → 标记 error 并生成重写指导
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import type {
  QualityViolation,
  ReportQualityResult,
  DualLayerQualityResult,
} from "./quality.types";
import {
  QUALITY_GATE_CONFIG,
  QUALITY_GATE_DUAL_LAYER_CONFIG,
} from "../config/research.config";
import { ResearchContentScorerService } from "./research-content-scorer.service";
import { ResearchCritiqueService } from "./research-critique.service";

const {
  MIN_SECTION_CHARS,
  EMPTY_SECTION_CHARS,
  MAX_BOLD_COUNT,
  MAX_BLOCKQUOTE_COUNT,
  MIN_CITATION_COVERAGE_RATIO,
  MIN_SECTIONS_FOR_CITATION_CHECK,
} = QUALITY_GATE_CONFIG;

@Injectable()
export class ResearchQualityGateService {
  private readonly logger = new Logger(ResearchQualityGateService.name);

  constructor(
    @Optional()
    private readonly contentScorer?: ResearchContentScorerService,
    @Optional()
    private readonly critiqueService?: ResearchCritiqueService,
  ) {}

  /**
   * 验证完整研究报告内容，返回质量检查结果。
   *
   * @param content Markdown 格式的报告内容
   */
  validateReport(content: string): ReportQualityResult {
    const violations: QualityViolation[] = [];
    let fixedContent = content ?? "";
    let wasAutoFixed = false;

    // ========== 可自动修复的规则 (warning) ==========

    // 1. 标题层级规范化：h1/h2 → h3/h4
    if (/^#{1,2} /m.test(fixedContent)) {
      violations.push({
        rule: "heading-hierarchy",
        severity: "warning",
        message:
          "检测到 # 或 ## 标题（研究报告章节应使用 ### 和 ####），已自动修复",
        autoFixed: true,
      });
      fixedContent = this.sanitizeHeadingLevels(fixedContent);
      wasAutoFixed = true;
    }

    // 2. 水平分割线移除
    const hrCount = (fixedContent.match(/^\s*[-*]{3,}\s*$/gm) ?? []).length;
    if (hrCount > 0) {
      violations.push({
        rule: "horizontal-rules",
        severity: "warning",
        message: `检测到 ${hrCount} 条水平分割线，已自动移除`,
        autoFixed: true,
      });
      fixedContent = fixedContent
        .replace(/^\s*[-*]{3,}\s*$/gm, "")
        .replace(/\n{3,}/g, "\n\n");
      wasAutoFixed = true;
    }

    // 3. 加粗密度限制：全文最多 MAX_BOLD_COUNT 个加粗
    const boldMatches = fixedContent.match(/\*\*[^*]+\*\*/g) ?? [];
    if (boldMatches.length > MAX_BOLD_COUNT) {
      violations.push({
        rule: "bold-density",
        severity: "warning",
        message: `加粗标记数量 ${boldMatches.length} 超过阈值 ${MAX_BOLD_COUNT}，已自动限制`,
        autoFixed: true,
      });
      fixedContent = this.limitBoldFormatting(fixedContent, MAX_BOLD_COUNT);
      wasAutoFixed = true;
    }

    // 4. 块引用密度限制：全文最多 MAX_BLOCKQUOTE_COUNT 个
    const blockquoteCount = (fixedContent.match(/^>\s*.+$/gm) ?? []).length;
    if (blockquoteCount > MAX_BLOCKQUOTE_COUNT) {
      violations.push({
        rule: "blockquote-density",
        severity: "warning",
        message: `引用块数量 ${blockquoteCount} 超过阈值 ${MAX_BLOCKQUOTE_COUNT}，已自动限制`,
        autoFixed: true,
      });
      fixedContent = this.limitBlockquotes(fixedContent, MAX_BLOCKQUOTE_COUNT);
      wasAutoFixed = true;
    }

    // 5. LLM 元注释清理
    const beforeMetaNotes = fixedContent;
    fixedContent = fixedContent.replace(
      /^(?:字数[统计：:]*\s*\d+|word count[:\s]*\d+|以上[为是].{0,20}输出|note:\s*.{0,80}|注[：:]\s*.{0,80})\s*$/gim,
      "",
    );
    if (fixedContent !== beforeMetaNotes) {
      violations.push({
        rule: "llm-meta-notes",
        severity: "warning",
        message: "检测到 LLM 泄露的内部标注（字数统计/角色说明等），已自动清理",
        autoFixed: true,
      });
      wasAutoFixed = true;
    }

    // 6. 内联图片引用清理
    const beforeImages = fixedContent;
    fixedContent = fixedContent.replace(/!\[[^\]]*\]\(https?:\/\/[^)]+\)/g, "");
    if (fixedContent !== beforeImages) {
      violations.push({
        rule: "inline-images",
        severity: "warning",
        message:
          "检测到内联 Markdown 图片引用（AI 生成 URL 通常 404），已自动移除",
        autoFixed: true,
      });
      wasAutoFixed = true;
    }

    // 7. 重复标题去重
    const beforeDedup = fixedContent;
    fixedContent = this.deduplicateHeadings(fixedContent);
    if (fixedContent !== beforeDedup) {
      violations.push({
        rule: "duplicate-headings",
        severity: "warning",
        message: "检测到重复标题，已自动去重",
        autoFixed: true,
      });
      wasAutoFixed = true;
    }

    // ========== 检测但不自动修复的规则 (error) ==========

    // 解析所有 ### 章节
    const sectionPattern = /^(#{3,4})\s+(.+)$/gm;
    const sectionMatches = [...fixedContent.matchAll(sectionPattern)];

    let formattingViolations = 0;
    let sectionsWithCitations = 0;
    let totalSectionContentLength = 0;

    for (let i = 0; i < sectionMatches.length; i++) {
      const match = sectionMatches[i];
      const headingTitle = match[2].trim();
      const startIndex = (match.index ?? 0) + match[0].length;
      const endIndex =
        i + 1 < sectionMatches.length
          ? (sectionMatches[i + 1].index ?? fixedContent.length)
          : fixedContent.length;

      const sectionBody = fixedContent.slice(startIndex, endIndex);
      const bodyText = sectionBody.replace(/\s/g, "");

      totalSectionContentLength += bodyText.length;

      // 8. 空章节检测
      if (bodyText.length < EMPTY_SECTION_CHARS) {
        violations.push({
          rule: "empty-section",
          severity: "error",
          message: `章节「${headingTitle}」内容为空或过短（${bodyText.length} 字符），请补充实质内容`,
          section: headingTitle,
        });
        formattingViolations++;
      } else if (bodyText.length < MIN_SECTION_CHARS) {
        // 9. 最小章节长度
        violations.push({
          rule: "min-section-length",
          severity: "error",
          message: `章节「${headingTitle}」内容 ${bodyText.length} 字符不足最低要求 ${MIN_SECTION_CHARS} 字符`,
          section: headingTitle,
        });
        formattingViolations++;
      }

      // 统计含有引用标记的章节
      if (/\[\d+\]/.test(sectionBody)) {
        sectionsWithCitations++;
      }
    }

    // 10. 引用覆盖率检查
    const totalSections = sectionMatches.length;
    if (totalSections >= MIN_SECTIONS_FOR_CITATION_CHECK) {
      const coverageRatio =
        totalSections > 0 ? sectionsWithCitations / totalSections : 0;
      if (coverageRatio < MIN_CITATION_COVERAGE_RATIO) {
        violations.push({
          rule: "citation-coverage",
          severity: "error",
          message: `引用覆盖率 ${(coverageRatio * 100).toFixed(0)}% 低于要求 ${MIN_CITATION_COVERAGE_RATIO * 100}%，仅 ${sectionsWithCitations}/${totalSections} 个章节包含引用标记 [n]`,
        });
      }
    }

    // ========== 计算分数 ==========

    const warningViolations = violations.filter(
      (v) => v.severity === "warning",
    ).length;
    const errorViolations = violations.filter((v) => v.severity === "error");

    const formatting = Math.max(
      0,
      1 - warningViolations * 0.1 - formattingViolations * 0.15,
    );

    const citationCoverage =
      totalSections >= MIN_SECTIONS_FOR_CITATION_CHECK && totalSections > 0
        ? sectionsWithCitations / totalSections
        : 1;

    const avgSectionLength =
      totalSections > 0 ? totalSectionContentLength / totalSections : 0;
    const contentDepth = Math.min(1, avgSectionLength / 2000);

    const overall =
      formatting * 0.3 + citationCoverage * 0.3 + contentDepth * 0.4;

    const rewriteGuidance = errorViolations.map((v) => v.message);

    if (violations.length > 0) {
      this.logger.log(
        `[QualityGate] ${violations.length} violations (${errorViolations.length > 0 ? "FAILED" : "PASSED with warnings"}): ${violations.map((v) => v.rule).join(", ")}`,
      );
    }

    return {
      passed: errorViolations.length === 0,
      violations,
      wasAutoFixed,
      fixedContent: wasAutoFixed ? fixedContent : undefined,
      rewriteGuidance,
      scores: {
        formatting: Math.round(formatting * 100) / 100,
        citationCoverage: Math.round(citationCoverage * 100) / 100,
        contentDepth: Math.round(contentDepth * 100) / 100,
        overall: Math.round(overall * 100) / 100,
      },
    };
  }

  /**
   * 双层质量验证：Layer 1（结构规则）+ Layer 2（LLM 内容评分）+ 可选 Critique。
   *
   * Layer 1 调用现有 `validateReport()`，保持完全向后兼容。
   * Layer 2 通过 `ResearchContentScorerService.scoreContent()` 进行语义评分。
   * 当 Layer 2 overallScore < CRITIQUE_TRIGGER_THRESHOLD 时触发单轮改进建议。
   *
   * @param content 报告 Markdown 内容
   * @param query   原始研究查询
   */
  async validateReportDualLayer(
    content: string,
    query: string,
  ): Promise<DualLayerQualityResult> {
    const {
      CONTENT_SCORE_THRESHOLD,
      CRITIQUE_TRIGGER_THRESHOLD,
      STRUCTURAL_SCORE_THRESHOLD,
    } = QUALITY_GATE_DUAL_LAYER_CONFIG;

    // Layer 1: 结构/格式检查（同步，复用现有逻辑）
    const structuralResult = this.validateReport(content);

    // Layer 2: LLM 内容评分（异步，可选服务）
    const contentScore = this.contentScorer
      ? await this.contentScorer.scoreContent(content, query)
      : {
          factuality: 0.5,
          depth: 0.5,
          coherence: 0.5,
          completeness: 0.5,
          overallScore: 0.5,
        };

    this.logger.log(
      `[DualLayer] structural.overall=${structuralResult.scores.overall}, content.overall=${contentScore.overallScore}`,
    );

    // Critique-lite: 仅在 Layer 2 分数低于触发阈值时生成建议
    let critique: DualLayerQualityResult["critique"];
    if (
      contentScore.overallScore < CRITIQUE_TRIGGER_THRESHOLD &&
      this.critiqueService
    ) {
      critique = await this.critiqueService.critique(
        content,
        query,
        contentScore,
      );
      this.logger.log(
        `[DualLayer] Critique triggered (score=${contentScore.overallScore}): ${critique.suggestions.length} suggestions, ${critique.criticalIssues.length} critical issues`,
      );
    }

    const passed =
      structuralResult.scores.overall > STRUCTURAL_SCORE_THRESHOLD &&
      contentScore.overallScore > CONTENT_SCORE_THRESHOLD;

    return {
      structural: structuralResult,
      content: contentScore,
      critique,
      passed,
    };
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 将 h1/h2 标题降级为 h3/h4
   */
  private sanitizeHeadingLevels(content: string): string {
    return content.replace(/^(#{1,2}) /gm, (_, hashes: string) => {
      const depth = hashes.length;
      // h1 → h3, h2 → h4
      const newDepth = depth === 1 ? 3 : 4;
      return "#".repeat(newDepth) + " ";
    });
  }

  /**
   * 限制全文加粗标记数量，超出部分移除 ** 符号
   */
  private limitBoldFormatting(content: string, maxCount: number): string {
    let count = 0;
    return content.replace(/\*\*([^*]+)\*\*/g, (match, inner: string) => {
      count++;
      if (count <= maxCount) {
        return match;
      }
      return inner;
    });
  }

  /**
   * 限制引用块（blockquote）数量
   */
  private limitBlockquotes(content: string, maxCount: number): string {
    let count = 0;
    return content.replace(/^(>\s*.+)$/gm, (match) => {
      count++;
      if (count <= maxCount) {
        return match;
      }
      return match.replace(/^>\s*/, "");
    });
  }

  /**
   * 去除重复标题（保留第一次出现，后续同名标题移除）
   */
  private deduplicateHeadings(content: string): string {
    const seen = new Set<string>();
    return content.replace(
      /^(#{2,4})\s+(.+)$/gm,
      (match, hashes: string, title: string) => {
        const key = `${hashes.length}:${title.trim().toLowerCase()}`;
        if (seen.has(key)) {
          return "";
        }
        seen.add(key);
        return match;
      },
    );
  }
}
