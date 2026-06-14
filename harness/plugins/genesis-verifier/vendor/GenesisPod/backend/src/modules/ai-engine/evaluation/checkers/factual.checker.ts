/**
 * Factual Checker
 * 事实检查器 - 检查内容的事实准确性
 */

import { Injectable, Optional, Inject } from "@nestjs/common";
import {
  BaseQualityChecker,
  CheckerConfig,
} from "../abstractions/quality-checker.interface";
import {
  QualityDimension,
  QualityIssue,
  QualityCheckContext,
} from "../abstractions/quality-gate.interface";

/**
 * 事实检查器
 */
export const FACTUAL_CHECKER_CONFIG = "FACTUAL_CHECKER_CONFIG";

@Injectable()
export class FactualChecker extends BaseQualityChecker {
  readonly dimension: QualityDimension = "factual";
  readonly name = "Factual Checker";
  readonly description = "检查内容的事实准确性和逻辑合理性";

  constructor(
    @Optional() @Inject(FACTUAL_CHECKER_CONFIG) config?: Partial<CheckerConfig>,
  ) {
    super(config);
  }

  /**
   * 执行事实检查
   */
  async performCheck(
    content: string,
    _context?: QualityCheckContext,
  ): Promise<{ score: number; issues: QualityIssue[] }> {
    const issues: QualityIssue[] = [];
    let score = 100;

    // 检查可疑的绝对性陈述
    const absoluteIssues = this.checkAbsoluteStatements(content);
    if (absoluteIssues.length > 0) {
      score -= absoluteIssues.length * 3;
      issues.push(...absoluteIssues);
    }

    // 检查数值合理性
    const numericIssues = this.checkNumericClaims(content);
    if (numericIssues.length > 0) {
      score -= numericIssues.length * 5;
      issues.push(...numericIssues);
    }

    // 检查引用和来源
    const sourceIssues = this.checkSourceClaims(content);
    if (sourceIssues.length > 0) {
      score -= sourceIssues.length * 2;
      issues.push(...sourceIssues);
    }

    // 检查逻辑矛盾
    const contradictionIssues = this.checkContradictions(content);
    if (contradictionIssues.length > 0) {
      score -= contradictionIssues.length * 10;
      issues.push(...contradictionIssues);
    }

    // 检查模糊表述
    const vagueIssues = this.checkVagueStatements(content);
    if (vagueIssues.length > 0) {
      score -= vagueIssues.length * 2;
      issues.push(...vagueIssues);
    }

    return { score: Math.max(0, score), issues };
  }

  /**
   * 检查绝对性陈述
   */
  private checkAbsoluteStatements(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];

    const absolutePatterns = [
      { pattern: /所有人?都/g, word: "所有...都" },
      { pattern: /从来没有/g, word: "从来没有" },
      { pattern: /绝对不会/g, word: "绝对不会" },
      { pattern: /一定会/g, word: "一定会" },
      { pattern: /永远不会/g, word: "永远不会" },
      { pattern: /完全没有/g, word: "完全没有" },
      { pattern: /百分之百/g, word: "百分之百" },
    ];

    for (const { pattern, word } of absolutePatterns) {
      const matches = content.match(pattern) || [];
      if (matches.length > 0) {
        issues.push({
          severity: "warning",
          code: "ABSOLUTE_STATEMENT",
          message: `使用了绝对性表述"${word}"`,
          suggestion: "绝对性陈述通常难以证实，建议使用更谨慎的表述",
        });
      }
    }

    return issues.slice(0, 5); // 限制数量
  }

  /**
   * 检查数值声明
   */
  private checkNumericClaims(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // 检查可疑的大数字（没有来源的统计数据）
    const largeNumbers = content.match(/\d{6,}/g) || [];
    const percentages = content.match(/\d+\.?\d*%/g) || [];

    // 检查是否有引用来源
    const hasSourceIndicators =
      /据.*统计|根据.*数据|.*研究表明|.*报告显示/.test(content);

    if (largeNumbers.length > 0 && !hasSourceIndicators) {
      issues.push({
        severity: "info",
        code: "UNSOURCED_STATISTICS",
        message: "文中包含统计数据，但未注明来源",
        suggestion: "建议为统计数据添加可靠的来源引用",
      });
    }

    // 检查不合理的百分比
    for (const pct of percentages) {
      const value = parseFloat(pct);
      if (value > 100 && !content.includes("增长")) {
        issues.push({
          severity: "warning",
          code: "INVALID_PERCENTAGE",
          message: `百分比 ${pct} 超过 100%，请确认是否正确`,
          suggestion: "请核实该百分比数据的准确性",
        });
      }
    }

    return issues;
  }

  /**
   * 检查来源声明
   */
  private checkSourceClaims(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // 检查模糊的来源引用
    const vagueSourcePatterns = [
      { pattern: /有人说/g, word: "有人说" },
      { pattern: /据说/g, word: "据说" },
      { pattern: /有研究表明/g, word: "有研究表明" },
      { pattern: /专家认为/g, word: "专家认为" },
    ];

    for (const { pattern, word } of vagueSourcePatterns) {
      const matches = content.match(pattern) || [];
      if (matches.length > 0) {
        issues.push({
          severity: "info",
          code: "VAGUE_SOURCE",
          message: `使用了模糊的来源引用"${word}"`,
          suggestion: "建议明确指出具体的来源、研究或专家",
        });
      }
    }

    return issues.slice(0, 3);
  }

  /**
   * 检查逻辑矛盾
   */
  private checkContradictions(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // 简单的矛盾检测：查找同一段落中的对立表述
    const paragraphs = content.split(/\n\n+/);

    for (const para of paragraphs) {
      // 检查正反对立
      if (
        (para.includes("增长") && para.includes("下降")) ||
        (para.includes("提高") && para.includes("降低")) ||
        (para.includes("上升") && para.includes("减少"))
      ) {
        // 如果不是在讨论不同的对象，可能存在矛盾
        if (
          !para.includes("而") &&
          !para.includes("但") &&
          !para.includes("相反")
        ) {
          issues.push({
            severity: "warning",
            code: "POTENTIAL_CONTRADICTION",
            message: "段落中可能存在逻辑矛盾",
            suggestion: "请检查该段落中是否存在自相矛盾的表述",
          });
        }
      }
    }

    return issues;
  }

  /**
   * 检查模糊表述
   */
  private checkVagueStatements(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];

    const vaguePatterns = [
      { pattern: /很多人/g, word: "很多人" },
      { pattern: /大部分/g, word: "大部分" },
      { pattern: /一些/g, word: "一些" },
      { pattern: /某些/g, word: "某些" },
      { pattern: /经常/g, word: "经常" },
      { pattern: /有时/g, word: "有时" },
    ];

    let vagueCount = 0;
    for (const { pattern } of vaguePatterns) {
      vagueCount += (content.match(pattern) || []).length;
    }

    if (vagueCount > 10) {
      issues.push({
        severity: "info",
        code: "EXCESSIVE_VAGUE_TERMS",
        message: `文中使用了较多模糊表述 (${vagueCount} 处)`,
        suggestion: "建议在可能的情况下使用具体的数据或描述",
      });
    }

    return issues;
  }
}
