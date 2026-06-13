/**
 * Coherence Checker
 * 连贯性检查器 - 检查内容的逻辑连贯性
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

export const COHERENCE_CHECKER_CONFIG = "COHERENCE_CHECKER_CONFIG";

/**
 * 连贯性检查器
 */
@Injectable()
export class CoherenceChecker extends BaseQualityChecker {
  readonly dimension: QualityDimension = "coherence";
  readonly name = "Coherence Checker";
  readonly description = "检查内容的逻辑连贯性和段落衔接";

  constructor(
    @Optional()
    @Inject(COHERENCE_CHECKER_CONFIG)
    config?: Partial<CheckerConfig>,
  ) {
    super(config);
  }

  /**
   * 执行连贯性检查
   */
  async performCheck(
    content: string,
    _context?: QualityCheckContext,
  ): Promise<{ score: number; issues: QualityIssue[] }> {
    const issues: QualityIssue[] = [];
    let score = 100;

    // 检查段落结构
    const structureIssues = this.checkParagraphStructure(content);
    if (structureIssues.length > 0) {
      score -= structureIssues.length * 5;
      issues.push(...structureIssues);
    }

    // 检查过渡词使用
    const transitionIssues = this.checkTransitions(content);
    if (transitionIssues.length > 0) {
      score -= transitionIssues.length * 3;
      issues.push(...transitionIssues);
    }

    // 检查主题一致性
    const topicIssues = this.checkTopicConsistency(content);
    if (topicIssues.length > 0) {
      score -= topicIssues.length * 5;
      issues.push(...topicIssues);
    }

    // 检查论证结构
    const argumentIssues = this.checkArgumentStructure(content);
    if (argumentIssues.length > 0) {
      score -= argumentIssues.length * 4;
      issues.push(...argumentIssues);
    }

    return { score: Math.max(0, score), issues };
  }

  /**
   * 检查段落结构
   */
  private checkParagraphStructure(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];
    const paragraphs = content
      .split(/\n\n+/)
      .filter((p) => p.trim().length > 0);

    // 检查是否有段落
    if (paragraphs.length < 2 && content.length > 500) {
      issues.push({
        severity: "warning",
        code: "NO_PARAGRAPHS",
        message: "内容较长但缺少段落分隔",
        suggestion: "建议将内容分成多个段落，每个段落围绕一个主题",
      });
    }

    // 检查段落长度
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];

      if (para.length > 800) {
        issues.push({
          severity: "info",
          code: "LONG_PARAGRAPH",
          message: `第 ${i + 1} 段过长 (${para.length} 字)`,
          suggestion: "建议将过长的段落拆分为多个小段落",
        });
      }

      if (para.length < 30 && paragraphs.length > 3) {
        issues.push({
          severity: "info",
          code: "SHORT_PARAGRAPH",
          message: `第 ${i + 1} 段过短`,
          suggestion: "建议扩展段落内容或与相邻段落合并",
        });
      }
    }

    return issues.slice(0, 5);
  }

  /**
   * 检查过渡词使用
   */
  private checkTransitions(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];
    const paragraphs = content
      .split(/\n\n+/)
      .filter((p) => p.trim().length > 0);

    if (paragraphs.length < 3) {
      return issues;
    }

    // 过渡词列表
    const transitionWords = [
      "首先",
      "其次",
      "然后",
      "最后",
      "此外",
      "另外",
      "同时",
      "因此",
      "所以",
      "然而",
      "但是",
      "不过",
      "虽然",
      "尽管",
      "总之",
      "综上所述",
      "由此可见",
      "换言之",
      "例如",
      "比如",
    ];

    let transitionCount = 0;
    for (const word of transitionWords) {
      transitionCount += (content.match(new RegExp(word, "g")) || []).length;
    }

    const transitionRatio = transitionCount / paragraphs.length;

    if (transitionRatio < 0.3 && paragraphs.length > 4) {
      issues.push({
        severity: "info",
        code: "FEW_TRANSITIONS",
        message: "段落间的过渡词使用较少",
        suggestion:
          '建议增加过渡词（如"首先"、"此外"、"因此"等）来增强段落间的衔接',
      });
    }

    return issues;
  }

  /**
   * 检查主题一致性
   */
  private checkTopicConsistency(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];
    const paragraphs = content
      .split(/\n\n+/)
      .filter((p) => p.trim().length > 0);

    if (paragraphs.length < 3) {
      return issues;
    }

    // 提取每个段落的关键词
    const paragraphKeywords = paragraphs.map((p) => this.extractKeywords(p));

    // 检查相邻段落的关键词重叠
    for (let i = 1; i < paragraphKeywords.length; i++) {
      const prev = paragraphKeywords[i - 1];
      const curr = paragraphKeywords[i];

      const overlap = this.calculateOverlap(prev, curr);

      if (overlap < 0.1 && prev.size > 3 && curr.size > 3) {
        issues.push({
          severity: "info",
          code: "TOPIC_JUMP",
          message: `第 ${i} 段和第 ${i + 1} 段之间的主题关联较弱`,
          suggestion: "建议增加过渡内容或调整段落顺序",
        });
      }
    }

    return issues.slice(0, 3);
  }

  /**
   * 检查论证结构
   */
  private checkArgumentStructure(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // 检查是否有论点但缺少论据
    const hasClaimIndicators = /认为|主张|应该|必须|建议/.test(content);
    const hasEvidenceIndicators =
      /因为|由于|根据|研究表明|数据显示|例如|比如/.test(content);

    if (hasClaimIndicators && !hasEvidenceIndicators && content.length > 500) {
      issues.push({
        severity: "warning",
        code: "CLAIM_WITHOUT_EVIDENCE",
        message: "内容包含观点主张，但缺少支撑论据",
        suggestion: "建议为主要观点添加事实、数据或例子作为支撑",
      });
    }

    // 检查是否有结论
    const hasConclusion = /总之|综上所述|因此可见|由此可以看出|总结来说/.test(
      content,
    );
    if (content.length > 1000 && !hasConclusion) {
      issues.push({
        severity: "info",
        code: "NO_CONCLUSION",
        message: "内容较长但缺少明确的总结",
        suggestion: "建议在文末添加总结性段落",
      });
    }

    return issues;
  }

  /**
   * 提取关键词
   */
  private extractKeywords(text: string): Set<string> {
    const words = text
      .split(/[\s，。！？、；：""''（）\n]+/)
      .filter((w) => w.length >= 2);

    // 简单的关键词提取：去除停用词
    const stopWords = new Set([
      "的",
      "是",
      "在",
      "有",
      "和",
      "与",
      "了",
      "也",
      "都",
      "就",
      "会",
      "要",
      "这",
      "那",
      "可以",
      "可能",
      "能够",
      "进行",
      "通过",
      "对于",
      "关于",
    ]);

    return new Set(words.filter((w) => !stopWords.has(w)));
  }

  /**
   * 计算两个集合的重叠度
   */
  private calculateOverlap(set1: Set<string>, set2: Set<string>): number {
    let overlap = 0;
    for (const word of set1) {
      if (set2.has(word)) {
        overlap++;
      }
    }
    const minSize = Math.min(set1.size, set2.size);
    return minSize > 0 ? overlap / minSize : 0;
  }
}
