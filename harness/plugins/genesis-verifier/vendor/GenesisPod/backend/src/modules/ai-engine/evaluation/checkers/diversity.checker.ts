/**
 * Diversity Checker
 * 多样性检查器 - 检查词汇、句式多样性
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

export const DIVERSITY_CHECKER_CONFIG = "DIVERSITY_CHECKER_CONFIG";

/**
 * 多样性检查器
 */
@Injectable()
export class DiversityChecker extends BaseQualityChecker {
  readonly dimension: QualityDimension = "diversity";
  readonly name = "Diversity Checker";
  readonly description = "检查内容的词汇和句式多样性";

  constructor(
    @Optional()
    @Inject(DIVERSITY_CHECKER_CONFIG)
    config?: Partial<CheckerConfig>,
  ) {
    super(config);
  }

  /**
   * 执行多样性检查
   */
  async performCheck(
    content: string,
    _context?: QualityCheckContext,
  ): Promise<{ score: number; issues: QualityIssue[] }> {
    const issues: QualityIssue[] = [];
    let score = 100;

    // 分析词汇多样性
    const vocabularyAnalysis = this.analyzeVocabulary(content);
    if (vocabularyAnalysis.uniqueRatio < 0.3) {
      score -= 20;
      issues.push({
        severity: "warning",
        code: "LOW_VOCABULARY_DIVERSITY",
        message: `词汇多样性较低 (${(vocabularyAnalysis.uniqueRatio * 100).toFixed(1)}%)`,
        suggestion: "建议使用更多样化的词汇，避免重复使用相同的词语",
      });
    }

    // 分析句式多样性
    const sentenceAnalysis = this.analyzeSentences(content);
    if (sentenceAnalysis.avgLength < 10) {
      score -= 10;
      issues.push({
        severity: "info",
        code: "SHORT_SENTENCES",
        message: "句子普遍较短",
        suggestion: "可以适当增加复合句，丰富句式结构",
      });
    }
    if (sentenceAnalysis.lengthVariance < 5) {
      score -= 15;
      issues.push({
        severity: "warning",
        code: "LOW_SENTENCE_VARIETY",
        message: "句子长度变化较小，句式较为单一",
        suggestion: "建议混合使用长短句，增加文章节奏感",
      });
    }

    // 检查重复短语
    const repeatedPhrases = this.findRepeatedPhrases(content);
    if (repeatedPhrases.length > 3) {
      score -= 15;
      issues.push({
        severity: "warning",
        code: "REPEATED_PHRASES",
        message: `发现 ${repeatedPhrases.length} 个重复短语`,
        suggestion: `考虑替换重复的表达：${repeatedPhrases.slice(0, 3).join("、")}`,
      });
    }

    // 检查开头词重复
    const repeatedStarters = this.findRepeatedStarters(content);
    if (repeatedStarters.length > 2) {
      score -= 10;
      issues.push({
        severity: "info",
        code: "REPEATED_STARTERS",
        message: "多个句子使用相同的开头",
        suggestion: "建议变化句子开头，避免单调",
      });
    }

    return { score: Math.max(0, score), issues };
  }

  // ★ 预编译正则表达式提高性能
  private static readonly WORD_SPLIT_REGEX =
    /[\s，。！？、；：""''（）\[\]【】<>《》\n]+/;
  private static readonly MAX_CONTENT_LENGTH = 50000; // 超过此长度时采样分析

  /**
   * 分析词汇多样性
   * ★ 对长文本使用采样分析以提高性能
   */
  private analyzeVocabulary(content: string): {
    uniqueRatio: number;
    wordCount: number;
  } {
    // ★ 对超长内容进行采样
    let textToAnalyze = content;
    if (content.length > DiversityChecker.MAX_CONTENT_LENGTH) {
      // 取前、中、后各一部分
      const partSize = Math.floor(DiversityChecker.MAX_CONTENT_LENGTH / 3);
      const middle = Math.floor(content.length / 2);
      textToAnalyze =
        content.slice(0, partSize) +
        content.slice(middle - partSize / 2, middle + partSize / 2) +
        content.slice(-partSize);
    }

    const words = textToAnalyze
      .toLowerCase()
      .split(DiversityChecker.WORD_SPLIT_REGEX)
      .filter((w) => w.length > 0);

    const uniqueWords = new Set(words);

    return {
      uniqueRatio: words.length > 0 ? uniqueWords.size / words.length : 0,
      wordCount: words.length,
    };
  }

  /**
   * 分析句子结构
   */
  private analyzeSentences(content: string): {
    avgLength: number;
    lengthVariance: number;
  } {
    const sentences = content
      .split(/[。！？\n]+/)
      .filter((s) => s.trim().length > 0);

    if (sentences.length === 0) {
      return { avgLength: 0, lengthVariance: 0 };
    }

    const lengths = sentences.map((s) => s.trim().length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;

    // 计算方差
    const variance =
      lengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) /
      lengths.length;

    return {
      avgLength,
      lengthVariance: Math.sqrt(variance),
    };
  }

  /**
   * 查找重复短语
   */
  private findRepeatedPhrases(
    content: string,
    minLength = 4,
    minOccurrences = 3,
  ): string[] {
    const phrases = new Map<string, number>();

    // 提取所有可能的短语
    const words = content
      .split(/[\s，。！？、；：""''（）\n]+/)
      .filter((w) => w.length > 0);

    for (let i = 0; i <= words.length - 2; i++) {
      const phrase = words.slice(i, i + 2).join("");
      if (phrase.length >= minLength) {
        phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
      }
    }

    return Array.from(phrases.entries())
      .filter(([_, count]) => count >= minOccurrences)
      .map(([phrase, _]) => phrase);
  }

  /**
   * 查找重复的句子开头
   */
  private findRepeatedStarters(content: string): string[] {
    const sentences = content
      .split(/[。！？\n]+/)
      .filter((s) => s.trim().length > 0);

    const starters = new Map<string, number>();

    for (const sentence of sentences) {
      const starter = sentence.trim().slice(0, 4);
      if (starter.length >= 2) {
        starters.set(starter, (starters.get(starter) || 0) + 1);
      }
    }

    return Array.from(starters.entries())
      .filter(([_, count]) => count >= 3)
      .map(([starter, _]) => starter);
  }
}
