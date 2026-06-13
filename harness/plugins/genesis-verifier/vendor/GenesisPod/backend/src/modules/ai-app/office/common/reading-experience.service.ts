/**
 * 阅读体验优化服务
 * 优化文档和演示文稿的阅读/浏览体验
 */

import { Injectable } from "@nestjs/common";
import {
  ContentFeatures,
  ContentComplexity,
  SectionFeatures,
  ParagraphFeatures,
} from "../content-analysis/content-analysis.types";
import {
  ReadingExperienceConfig,
  ReadingExperienceAnalysis,
  ReadingExperienceIssue,
  ReadingExperienceSuggestion,
  VisualBreakType,
  getReadingExperienceForComplexity,
} from "./template-selection.types";

/**
 * 优化后的段落
 */
export interface OptimizedParagraph {
  id: string;
  originalText: string;
  optimizedText?: string;
  wordCount: number;
  needsSplit: boolean;
  splitSuggestion?: string[];
  highlightSuggestions?: string[];
  visualBreakAfter?: VisualBreakType;
}

/**
 * 优化后的章节
 */
export interface OptimizedSection {
  id: string;
  title: string;
  paragraphs: OptimizedParagraph[];
  visualBreaks: Array<{
    afterParagraph: number;
    type: VisualBreakType;
    content?: string;
  }>;
  readingScore: number;
  estimatedReadingTime: number; // 分钟
}

@Injectable()
export class ReadingExperienceService {
  /**
   * 分析并优化文档阅读体验
   */
  analyzeAndOptimize(
    sections: SectionFeatures[],
    documentFeatures: ContentFeatures,
  ): {
    analysis: ReadingExperienceAnalysis;
    optimizedSections: OptimizedSection[];
    overallScore: number;
  } {
    // 1. 获取适合的配置
    const config = getReadingExperienceForComplexity(
      documentFeatures.complexity,
    );

    // 2. 分析问题
    const analysis = this.analyzeReadingExperience(sections, config);

    // 3. 优化各章节
    const optimizedSections = sections.map((section) =>
      this.optimizeSection(section, config, analysis),
    );

    // 4. 计算总体分数
    const overallScore = this.calculateOverallScore(optimizedSections);

    return {
      analysis,
      optimizedSections,
      overallScore,
    };
  }

  /**
   * 分析阅读体验问题
   */
  private analyzeReadingExperience(
    sections: SectionFeatures[],
    config: ReadingExperienceConfig,
  ): ReadingExperienceAnalysis {
    const issues: ReadingExperienceIssue[] = [];
    const suggestions: ReadingExperienceSuggestion[] = [];

    let totalParagraphs = 0;
    let longParagraphs = 0;
    let _consecutiveTextBlocks = 0;
    let maxConsecutiveText = 0;

    sections.forEach((section, sectionIndex) => {
      let consecutiveCount = 0;

      section.paragraphs.forEach((paragraph, paragraphIndex) => {
        totalParagraphs++;
        const wordCount = paragraph.text.length;

        // 检查段落过长
        if (wordCount > config.density.maxWordsPerParagraph) {
          longParagraphs++;
          issues.push({
            type: "too_dense",
            severity:
              wordCount > config.density.maxWordsPerParagraph * 1.5
                ? "major"
                : "minor",
            location: `章节${sectionIndex + 1} 第${paragraphIndex + 1}段`,
            description: `段落过长 (${wordCount}字)，建议控制在${config.density.maxWordsPerParagraph}字以内`,
          });

          suggestions.push({
            type: "break_paragraph",
            location: `章节${sectionIndex + 1} 第${paragraphIndex + 1}段`,
            description: "将长段落拆分为多个短段落",
            expectedImprovement: 5,
          });
        }

        // 检查连续文字块
        if (!paragraph.hasList && !paragraph.hasQuote) {
          consecutiveCount++;
          maxConsecutiveText = Math.max(maxConsecutiveText, consecutiveCount);
        } else {
          consecutiveCount = 0;
        }

        // 连续纯文字超过阈值
        if (consecutiveCount >= config.rhythm.visualBreakFrequency) {
          _consecutiveTextBlocks++;
        }
      });

      // 章节过长检查
      if (section.paragraphs.length > config.density.maxParagraphsPerSection) {
        issues.push({
          type: "too_dense",
          severity: "major",
          location: `章节${sectionIndex + 1}`,
          description: `章节段落过多 (${section.paragraphs.length}段)`,
        });

        suggestions.push({
          type: "add_heading",
          location: `章节${sectionIndex + 1}`,
          description: "考虑拆分为子章节",
          expectedImprovement: 10,
        });
      }
    });

    // 检查是否缺少视觉休息
    if (maxConsecutiveText >= config.rhythm.visualBreakFrequency) {
      issues.push({
        type: "no_visual_breaks",
        severity: "major",
        location: "全文",
        description: `存在连续${maxConsecutiveText}段纯文字，缺少视觉休息点`,
      });

      suggestions.push({
        type: "add_visual",
        location: "适当位置",
        description: `每${config.rhythm.visualBreakFrequency}段后添加视觉元素`,
        expectedImprovement: 15,
      });
    }

    // 检查文字墙
    if (longParagraphs / Math.max(totalParagraphs, 1) > 0.3) {
      issues.push({
        type: "wall_of_text",
        severity: "critical",
        location: "全文",
        description: "超过30%的段落过长，形成文字墙",
      });
    }

    // 计算当前分数
    const currentScore = this.calculateAnalysisScore(issues);

    return {
      currentScore,
      issues,
      suggestions,
      optimizedConfig: config,
    };
  }

  /**
   * 计算分析分数
   */
  private calculateAnalysisScore(issues: ReadingExperienceIssue[]): number {
    let score = 100;

    issues.forEach((issue) => {
      switch (issue.severity) {
        case "critical":
          score -= 20;
          break;
        case "major":
          score -= 10;
          break;
        case "minor":
          score -= 5;
          break;
      }
    });

    return Math.max(0, score);
  }

  /**
   * 优化单个章节
   */
  private optimizeSection(
    section: SectionFeatures,
    config: ReadingExperienceConfig,
    _analysis: ReadingExperienceAnalysis,
  ): OptimizedSection {
    const optimizedParagraphs: OptimizedParagraph[] = [];
    const visualBreaks: OptimizedSection["visualBreaks"] = [];

    let consecutiveTextCount = 0;

    section.paragraphs.forEach((paragraph, index) => {
      const wordCount = paragraph.text.length;
      const needsSplit = wordCount > config.density.maxWordsPerParagraph;

      // 创建优化后的段落
      const optimized: OptimizedParagraph = {
        id: paragraph.id,
        originalText: paragraph.text,
        wordCount,
        needsSplit,
        highlightSuggestions: this.extractHighlights(paragraph),
      };

      // 如果需要拆分，生成建议
      if (needsSplit) {
        optimized.splitSuggestion = this.suggestSplit(
          paragraph.text,
          config.density.maxWordsPerParagraph,
        );
      }

      // 检查是否需要视觉休息
      if (!paragraph.hasList && !paragraph.hasQuote) {
        consecutiveTextCount++;
      } else {
        consecutiveTextCount = 0;
      }

      // 达到阈值时添加视觉休息
      if (consecutiveTextCount >= config.rhythm.visualBreakFrequency) {
        const breakType = this.selectVisualBreakType(paragraph, config);
        optimized.visualBreakAfter = breakType;
        visualBreaks.push({
          afterParagraph: index,
          type: breakType,
          content: this.generateVisualBreakContent(breakType, paragraph),
        });
        consecutiveTextCount = 0;
      }

      optimizedParagraphs.push(optimized);
    });

    // 计算章节阅读分数
    const readingScore = this.calculateSectionScore(
      optimizedParagraphs,
      visualBreaks,
      config,
    );

    // 估算阅读时间 (假设每分钟200字)
    const totalWords = optimizedParagraphs.reduce(
      (sum, p) => sum + p.wordCount,
      0,
    );
    const estimatedReadingTime = Math.ceil(totalWords / 200);

    return {
      id: section.id,
      title: section.title,
      paragraphs: optimizedParagraphs,
      visualBreaks,
      readingScore,
      estimatedReadingTime,
    };
  }

  /**
   * 提取需要高亮的内容
   */
  private extractHighlights(paragraph: ParagraphFeatures): string[] {
    const highlights: string[] = [];

    // 从关键点提取
    paragraph.keyPoints.forEach((point) => {
      if (point.length <= 20) {
        highlights.push(point);
      }
    });

    // 提取数字和百分比
    const numbers = paragraph.text.match(/\d+\.?\d*[%亿万千百]/g) || [];
    highlights.push(...numbers.slice(0, 3));

    return [...new Set(highlights)].slice(0, 5);
  }

  /**
   * 建议段落拆分
   */
  private suggestSplit(text: string, maxWords: number): string[] {
    const sentences = text.split(/[。！？；]/g).filter((s) => s.trim());
    const parts: string[] = [];
    let currentPart = "";

    sentences.forEach((sentence) => {
      if ((currentPart + sentence).length <= maxWords) {
        currentPart += sentence + "。";
      } else {
        if (currentPart) {
          parts.push(currentPart.trim());
        }
        currentPart = sentence + "。";
      }
    });

    if (currentPart) {
      parts.push(currentPart.trim());
    }

    return parts;
  }

  /**
   * 选择视觉休息类型
   */
  private selectVisualBreakType(
    paragraph: ParagraphFeatures,
    config: ReadingExperienceConfig,
  ): VisualBreakType {
    const preferred = config.rhythm.preferredBreakTypes;

    // 如果段落有数据，优先使用信息图
    if (paragraph.hasData && preferred.includes(VisualBreakType.INFOGRAPHIC)) {
      return VisualBreakType.INFOGRAPHIC;
    }

    // 如果有重要观点，使用强调框
    if (
      paragraph.keyPoints.length > 0 &&
      preferred.includes(VisualBreakType.CALLOUT)
    ) {
      return VisualBreakType.CALLOUT;
    }

    // 如果有引用，使用引用块
    if (paragraph.hasQuote && preferred.includes(VisualBreakType.QUOTE)) {
      return VisualBreakType.QUOTE;
    }

    // 默认使用分隔线
    return preferred[0] || VisualBreakType.DIVIDER;
  }

  /**
   * 生成视觉休息内容
   */
  private generateVisualBreakContent(
    type: VisualBreakType,
    paragraph: ParagraphFeatures,
  ): string | undefined {
    switch (type) {
      case VisualBreakType.CALLOUT:
        return paragraph.keyPoints[0] || "关键要点";
      case VisualBreakType.QUOTE:
        return paragraph.keyPoints[0];
      case VisualBreakType.INFOGRAPHIC:
        return "数据可视化";
      default:
        return undefined;
    }
  }

  /**
   * 计算章节阅读分数
   */
  private calculateSectionScore(
    paragraphs: OptimizedParagraph[],
    visualBreaks: OptimizedSection["visualBreaks"],
    config: ReadingExperienceConfig,
  ): number {
    let score = 100;

    // 段落长度惩罚
    const longParagraphs = paragraphs.filter((p) => p.needsSplit).length;
    score -= longParagraphs * 5;

    // 视觉休息奖励
    const expectedBreaks = Math.floor(
      paragraphs.length / config.rhythm.visualBreakFrequency,
    );
    const actualBreaks = visualBreaks.length;
    if (actualBreaks >= expectedBreaks) {
      score += 10;
    } else {
      score -= (expectedBreaks - actualBreaks) * 5;
    }

    // 高亮内容奖励
    const paragraphsWithHighlights = paragraphs.filter(
      (p) => p.highlightSuggestions && p.highlightSuggestions.length > 0,
    ).length;
    if (paragraphsWithHighlights / paragraphs.length > 0.5) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 计算总体分数
   */
  private calculateOverallScore(sections: OptimizedSection[]): number {
    if (sections.length === 0) return 100;

    const totalScore = sections.reduce((sum, s) => sum + s.readingScore, 0);
    return Math.round(totalScore / sections.length);
  }

  /**
   * 获取阅读体验建议
   */
  getReadingExperienceRecommendations(
    complexity: ContentComplexity,
  ): ReadingExperienceConfig {
    return getReadingExperienceForComplexity(complexity);
  }

  /**
   * 快速评估文本的阅读友好度
   */
  quickAssess(text: string): {
    score: number;
    issues: string[];
    suggestions: string[];
  } {
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 100;

    // 检查段落长度
    const longParagraphs = paragraphs.filter((p) => p.length > 200).length;
    if (longParagraphs > 0) {
      issues.push(`${longParagraphs}个段落超过200字`);
      suggestions.push("将长段落拆分为多个短段落");
      score -= longParagraphs * 10;
    }

    // 检查总长度
    const totalLength = text.length;
    if (totalLength > 3000 && paragraphs.length < 5) {
      issues.push("内容过长但段落过少");
      suggestions.push("增加段落划分，提高可读性");
      score -= 15;
    }

    // 检查列表使用
    const hasList = /[-*•]\s/.test(text) || /\d+\.\s/.test(text);
    if (totalLength > 500 && !hasList) {
      issues.push("缺少列表结构");
      suggestions.push("使用列表突出关键要点");
      score -= 10;
    }

    // 检查标题使用
    const hasHeadings = /^#+\s|^[一二三四五六七八九十]+、/.test(text);
    if (paragraphs.length > 5 && !hasHeadings) {
      issues.push("缺少标题层级");
      suggestions.push("添加小标题组织内容");
      score -= 10;
    }

    return {
      score: Math.max(0, score),
      issues,
      suggestions,
    };
  }

  /**
   * 生成阅读体验报告
   */
  generateReport(analysis: ReadingExperienceAnalysis): string {
    const lines: string[] = [];

    lines.push(`# 阅读体验分析报告`);
    lines.push(``);
    lines.push(`## 综合评分: ${analysis.currentScore}/100`);
    lines.push(``);

    if (analysis.issues.length > 0) {
      lines.push(`## 发现的问题 (${analysis.issues.length})`);
      lines.push(``);
      analysis.issues.forEach((issue, index) => {
        const severityIcon =
          issue.severity === "critical"
            ? "🔴"
            : issue.severity === "major"
              ? "🟡"
              : "🟢";
        lines.push(
          `${index + 1}. ${severityIcon} **${issue.location}**: ${issue.description}`,
        );
      });
      lines.push(``);
    }

    if (analysis.suggestions.length > 0) {
      lines.push(`## 优化建议 (${analysis.suggestions.length})`);
      lines.push(``);
      analysis.suggestions.forEach((suggestion, index) => {
        lines.push(
          `${index + 1}. **${suggestion.location}**: ${suggestion.description} (预期提升 +${suggestion.expectedImprovement}分)`,
        );
      });
    }

    return lines.join("\n");
  }
}
