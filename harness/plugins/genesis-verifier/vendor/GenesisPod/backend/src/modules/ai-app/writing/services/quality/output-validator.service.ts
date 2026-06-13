/**
 * OutputValidatorService - 输出验证服务 (P0-A01)
 *
 * 核心职责：
 * - JSON 完整性验证（检查括号闭合、语法错误）
 * - 大纲结构验证（章节数量、标题重复性、标题有效性）
 * - 章节内容验证（字数、空内容检测、格式检查）
 * - 提供详细的验证结果和修复建议
 */

import { Injectable, Logger } from "@nestjs/common";

// ==================== 常量配置 ====================

/**
 * 验证规则配置
 */
const VALIDATION_CONFIG = {
  // 大纲验证
  outline: {
    /** 章节数量下限（目标字数/每章字数 * 0.8） */
    minChapterRatio: 0.8,
    /** 标题重复次数上限 */
    maxTitleDuplication: 2,
    /** 无效标题比例上限 */
    maxInvalidTitleRatio: 0.1,
    /** 标题最小长度 */
    minTitleLength: 3,
    /** 标题最大长度 */
    maxTitleLength: 30,
  },
  // 章节内容验证
  chapter: {
    /** 字数下限（目标字数 * 0.6） */
    minWordCountRatio: 0.6,
    /** 最小绝对字数 */
    minAbsoluteWordCount: 300,
    /** 空段落警告阈值 */
    maxEmptyParagraphRatio: 0.3,
  },
} as const;

/**
 * 通用标题关键词（无效标题检测）
 */
const GENERIC_TITLE_KEYWORDS = [
  "章节",
  "内容",
  "正文",
  "待定",
  "未命名",
  "无标题",
  "TODO",
  "TBD",
  "暂定",
  "临时",
];

// ==================== 类型定义 ====================

/**
 * 验证问题严重程度
 */
export type ValidationSeverity = "ERROR" | "WARNING" | "INFO";

/**
 * 验证问题
 */
export interface ValidationIssue {
  /** 严重程度 */
  severity: ValidationSeverity;
  /** 问题类型 */
  type: string;
  /** 问题描述 */
  message: string;
  /** 修复建议 */
  suggestion?: string;
  /** 问题位置 */
  location?: string;
  /** 相关数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  /** 是否通过验证 */
  valid: boolean;
  /** 问题列表 */
  issues: ValidationIssue[];
  /** 验证元数据 */
  metadata?: {
    /** 验证耗时（毫秒） */
    duration?: number;
    /** 验证时间戳 */
    timestamp?: Date;
  };
}

/**
 * 大纲结构（简化版本）
 */
export interface OutlineStructure {
  chapters: Array<{
    chapterNumber: number;
    title: string;
    summary?: string;
    estimatedWordCount?: number;
  }>;
}

/**
 * 大纲验证配置
 */
export interface OutlineValidationConfig {
  /** 目标总字数 */
  targetTotalWordCount: number;
  /** 每章目标字数 */
  targetChapterWordCount: number;
  /** 是否严格模式（严格模式下更多检查） */
  strictMode?: boolean;
}

/**
 * 章节内容验证配置
 */
export interface ChapterValidationConfig {
  /** 目标字数 */
  targetWordCount: number;
  /** 是否检查格式 */
  checkFormat?: boolean;
  /** 是否检查对话格式 */
  checkDialogue?: boolean;
}

// ==================== 服务实现 ====================

@Injectable()
export class OutputValidatorService {
  private readonly logger = new Logger(OutputValidatorService.name);

  // ==================== JSON 完整性验证 ====================

  /**
   * 验证 JSON 输出完整性
   *
   * @param output - JSON 字符串
   * @returns 验证结果
   */
  validateJsonCompleteness(output: string): ValidationResult {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];

    // 1. 检查是否为空
    if (!output || output.trim().length === 0) {
      issues.push({
        severity: "ERROR",
        type: "json_empty",
        message: "JSON 输出为空",
        suggestion: "请检查 LLM 输出是否正常返回",
      });

      return {
        valid: false,
        issues,
        metadata: { duration: Date.now() - startTime, timestamp: new Date() },
      };
    }

    // 2. 检查括号配对
    const bracketIssues = this.checkBracketBalance(output);
    issues.push(...bracketIssues);

    // 3. 尝试解析 JSON
    try {
      JSON.parse(output);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      issues.push({
        severity: "ERROR",
        type: "json_parse_error",
        message: `JSON 解析失败: ${errorMessage}`,
        suggestion: this.generateJsonFixSuggestion(errorMessage, output),
        metadata: { error: errorMessage },
      });
    }

    // 4. 检查常见格式问题
    const formatIssues = this.checkJsonFormatIssues(output);
    issues.push(...formatIssues);

    const valid = !issues.some((issue) => issue.severity === "ERROR");

    this.logger.log(
      `[OutputValidator] JSON validation: valid=${valid}, issues=${issues.length}`,
    );

    return {
      valid,
      issues,
      metadata: { duration: Date.now() - startTime, timestamp: new Date() },
    };
  }

  /**
   * 检查括号配对
   */
  private checkBracketBalance(output: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const brackets = [
      { open: "{", close: "}", name: "花括号" },
      { open: "[", close: "]", name: "方括号" },
    ];

    for (const bracket of brackets) {
      const openCount = (
        output.match(new RegExp(`\\${bracket.open}`, "g")) || []
      ).length;
      const closeCount = (
        output.match(new RegExp(`\\${bracket.close}`, "g")) || []
      ).length;

      if (openCount !== closeCount) {
        const diff = openCount - closeCount;
        issues.push({
          severity: "ERROR",
          type: "bracket_mismatch",
          message: `${bracket.name}不配对: ${openCount} 个 '${bracket.open}' vs ${closeCount} 个 '${bracket.close}'`,
          suggestion:
            diff > 0
              ? `缺少 ${Math.abs(diff)} 个 '${bracket.close}'`
              : `多余 ${Math.abs(diff)} 个 '${bracket.close}'`,
          metadata: { openCount, closeCount, diff },
        });
      }
    }

    return issues;
  }

  /**
   * 检查 JSON 格式问题
   */
  private checkJsonFormatIssues(output: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // 检查是否有非闭合的字符串
    const stringPattern = /"(?:[^"\\]|\\.)*"/g;
    const strings = output.match(stringPattern) || [];
    const quoteCount = (output.match(/"/g) || []).length;

    if (quoteCount % 2 !== 0) {
      issues.push({
        severity: "WARNING",
        type: "unclosed_string",
        message: "可能存在未闭合的字符串",
        suggestion: "检查所有字符串是否正确闭合",
        metadata: { quoteCount, stringCount: strings.length },
      });
    }

    // 检查是否有尾随逗号
    if (/,\s*[}\]]/.test(output)) {
      issues.push({
        severity: "WARNING",
        type: "trailing_comma",
        message: "存在尾随逗号",
        suggestion: "删除对象或数组末尾的多余逗号",
      });
    }

    return issues;
  }

  /**
   * 生成 JSON 修复建议
   */
  private generateJsonFixSuggestion(
    errorMessage: string,
    output: string,
  ): string {
    if (errorMessage.includes("Unexpected end")) {
      return "JSON 输出不完整，可能被截断。请检查 LLM 输出是否达到 max_tokens 限制";
    }

    if (errorMessage.includes("Unexpected token")) {
      const match = errorMessage.match(/position (\d+)/);
      if (match) {
        const position = parseInt(match[1], 10);
        const context = output.substring(
          Math.max(0, position - 30),
          Math.min(output.length, position + 30),
        );
        return `在位置 ${position} 附近发现语法错误。上下文: "${context}"`;
      }
      return "存在非法字符或语法错误，请检查 JSON 格式";
    }

    return "请修复 JSON 格式错误后重试";
  }

  // ==================== 大纲结构验证 ====================

  /**
   * 验证大纲结构
   *
   * @param outline - 大纲结构
   * @param config - 验证配置
   * @returns 验证结果
   */
  validateOutline(
    outline: OutlineStructure,
    config: OutlineValidationConfig,
  ): ValidationResult {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];

    // 1. 检查章节数量
    const chapterCountIssues = this.checkChapterCount(outline, config);
    issues.push(...chapterCountIssues);

    // 2. 检查标题重复性
    const titleDuplicationIssues = this.checkTitleDuplication(outline);
    issues.push(...titleDuplicationIssues);

    // 3. 检查标题有效性
    const titleValidityIssues = this.checkTitleValidity(outline, config);
    issues.push(...titleValidityIssues);

    // 4. 检查章节编号连续性
    const numberingIssues = this.checkChapterNumbering(outline);
    issues.push(...numberingIssues);

    // 5. 严格模式下的额外检查
    if (config.strictMode) {
      const strictIssues = this.strictOutlineChecks(outline, config);
      issues.push(...strictIssues);
    }

    const valid = !issues.some((issue) => issue.severity === "ERROR");

    this.logger.log(
      `[OutputValidator] Outline validation: valid=${valid}, chapters=${outline.chapters.length}, issues=${issues.length}`,
    );

    return {
      valid,
      issues,
      metadata: { duration: Date.now() - startTime, timestamp: new Date() },
    };
  }

  /**
   * 检查章节数量
   */
  private checkChapterCount(
    outline: OutlineStructure,
    config: OutlineValidationConfig,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const actualCount = outline.chapters.length;

    // 计算预期章节数
    const expectedCount = Math.ceil(
      config.targetTotalWordCount / config.targetChapterWordCount,
    );
    const minCount = Math.floor(
      expectedCount * VALIDATION_CONFIG.outline.minChapterRatio,
    );

    if (actualCount < minCount) {
      issues.push({
        severity: "ERROR",
        type: "insufficient_chapters",
        message: `章节数量不足: 实际 ${actualCount} 章，建议至少 ${minCount} 章`,
        suggestion: `根据目标字数 ${config.targetTotalWordCount} 和每章字数 ${config.targetChapterWordCount}，建议生成 ${expectedCount} 章左右`,
        metadata: { actualCount, minCount, expectedCount },
      });
    } else if (actualCount < expectedCount * 0.9) {
      issues.push({
        severity: "WARNING",
        type: "fewer_chapters",
        message: `章节数量偏少: 实际 ${actualCount} 章，建议 ${expectedCount} 章`,
        suggestion: "考虑增加章节数量以更好地展开故事",
        metadata: { actualCount, expectedCount },
      });
    }

    return issues;
  }

  /**
   * 检查标题重复性
   */
  private checkTitleDuplication(outline: OutlineStructure): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const titleCount = new Map<string, number[]>();

    // 统计标题出现次数
    for (const chapter of outline.chapters) {
      const title = chapter.title.trim();
      if (!titleCount.has(title)) {
        titleCount.set(title, []);
      }
      titleCount.get(title)!.push(chapter.chapterNumber);
    }

    // 检查重复
    for (const [title, chapters] of titleCount) {
      if (chapters.length > VALIDATION_CONFIG.outline.maxTitleDuplication) {
        issues.push({
          severity: "ERROR",
          type: "title_duplication",
          message: `标题重复过多: "${title}" 出现 ${chapters.length} 次`,
          suggestion: "请为每章设计独特的标题",
          location: `章节 ${chapters.join(", ")}`,
          metadata: { title, chapters, count: chapters.length },
        });
      } else if (chapters.length > 1) {
        issues.push({
          severity: "WARNING",
          type: "title_duplicate",
          message: `标题重复: "${title}" 出现 ${chapters.length} 次`,
          suggestion: "建议使用不同的标题以区分章节",
          location: `章节 ${chapters.join(", ")}`,
          metadata: { title, chapters, count: chapters.length },
        });
      }
    }

    return issues;
  }

  /**
   * 检查标题有效性
   */
  private checkTitleValidity(
    outline: OutlineStructure,
    _config: OutlineValidationConfig,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    let invalidCount = 0;

    for (const chapter of outline.chapters) {
      const title = chapter.title.trim();

      // 检查空标题
      if (!title) {
        invalidCount++;
        issues.push({
          severity: "ERROR",
          type: "empty_title",
          message: `第 ${chapter.chapterNumber} 章标题为空`,
          suggestion: "请为该章节添加有意义的标题",
          location: `第 ${chapter.chapterNumber} 章`,
        });
        continue;
      }

      // 检查标题长度
      if (title.length < VALIDATION_CONFIG.outline.minTitleLength) {
        invalidCount++;
        issues.push({
          severity: "WARNING",
          type: "title_too_short",
          message: `第 ${chapter.chapterNumber} 章标题过短: "${title}"`,
          suggestion: `标题应至少 ${VALIDATION_CONFIG.outline.minTitleLength} 个字符`,
          location: `第 ${chapter.chapterNumber} 章`,
        });
      }

      if (title.length > VALIDATION_CONFIG.outline.maxTitleLength) {
        issues.push({
          severity: "WARNING",
          type: "title_too_long",
          message: `第 ${chapter.chapterNumber} 章标题过长: "${title}"`,
          suggestion: `标题应控制在 ${VALIDATION_CONFIG.outline.maxTitleLength} 个字符以内`,
          location: `第 ${chapter.chapterNumber} 章`,
        });
      }

      // 检查是否为通用标题
      const isGeneric = GENERIC_TITLE_KEYWORDS.some((keyword) =>
        title.includes(keyword),
      );
      if (isGeneric) {
        invalidCount++;
        issues.push({
          severity: "WARNING",
          type: "generic_title",
          message: `第 ${chapter.chapterNumber} 章标题过于通用: "${title}"`,
          suggestion: "使用更具体、更能反映章节内容的标题",
          location: `第 ${chapter.chapterNumber} 章`,
        });
      }
    }

    // 检查无效标题比例
    const invalidRatio = invalidCount / outline.chapters.length;
    if (
      invalidRatio > VALIDATION_CONFIG.outline.maxInvalidTitleRatio &&
      outline.chapters.length > 0
    ) {
      issues.push({
        severity: "ERROR",
        type: "high_invalid_title_ratio",
        message: `无效标题比例过高: ${(invalidRatio * 100).toFixed(1)}%`,
        suggestion: `超过 ${VALIDATION_CONFIG.outline.maxInvalidTitleRatio * 100}% 的标题无效，请重新生成大纲`,
        metadata: { invalidCount, totalCount: outline.chapters.length },
      });
    }

    return issues;
  }

  /**
   * 检查章节编号连续性
   */
  private checkChapterNumbering(outline: OutlineStructure): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (let i = 0; i < outline.chapters.length; i++) {
      const expectedNumber = i + 1;
      const actualNumber = outline.chapters[i].chapterNumber;

      if (actualNumber !== expectedNumber) {
        issues.push({
          severity: "WARNING",
          type: "chapter_number_mismatch",
          message: `章节编号不连续: 位置 ${i + 1} 期望编号 ${expectedNumber}，实际编号 ${actualNumber}`,
          suggestion: "检查章节编号是否正确",
          location: `第 ${actualNumber} 章`,
          metadata: { position: i + 1, expectedNumber, actualNumber },
        });
      }
    }

    return issues;
  }

  /**
   * 严格模式额外检查
   */
  private strictOutlineChecks(
    outline: OutlineStructure,
    config: OutlineValidationConfig,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // 检查摘要完整性
    for (const chapter of outline.chapters) {
      if (!chapter.summary || chapter.summary.trim().length < 10) {
        issues.push({
          severity: "INFO",
          type: "missing_summary",
          message: `第 ${chapter.chapterNumber} 章缺少摘要或摘要过短`,
          suggestion: "建议为每章添加详细摘要",
          location: `第 ${chapter.chapterNumber} 章`,
        });
      }
    }

    // 检查预估字数
    for (const chapter of outline.chapters) {
      if (chapter.estimatedWordCount) {
        const deviation = Math.abs(
          chapter.estimatedWordCount - config.targetChapterWordCount,
        );
        const deviationRatio = deviation / config.targetChapterWordCount;

        if (deviationRatio > 0.5) {
          issues.push({
            severity: "INFO",
            type: "word_count_deviation",
            message: `第 ${chapter.chapterNumber} 章预估字数偏差较大: ${chapter.estimatedWordCount} 字`,
            suggestion: `建议每章字数在 ${config.targetChapterWordCount} 左右`,
            location: `第 ${chapter.chapterNumber} 章`,
            metadata: {
              estimatedWordCount: chapter.estimatedWordCount,
              targetWordCount: config.targetChapterWordCount,
            },
          });
        }
      }
    }

    return issues;
  }

  // ==================== 章节内容验证 ====================

  /**
   * 验证章节内容
   *
   * @param content - 章节内容
   * @param config - 验证配置
   * @returns 验证结果
   */
  validateChapterContent(
    content: string,
    config: ChapterValidationConfig,
  ): ValidationResult {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];

    // 1. 检查内容非空
    if (!content || content.trim().length === 0) {
      issues.push({
        severity: "ERROR",
        type: "empty_content",
        message: "章节内容为空",
        suggestion: "请生成有效的章节内容",
      });

      return {
        valid: false,
        issues,
        metadata: { duration: Date.now() - startTime, timestamp: new Date() },
      };
    }

    // 2. 检查字数
    const wordCountIssues = this.checkChapterWordCount(content, config);
    issues.push(...wordCountIssues);

    // 3. 检查段落结构
    const paragraphIssues = this.checkParagraphStructure(content);
    issues.push(...paragraphIssues);

    // 4. 检查格式（如果启用）
    if (config.checkFormat) {
      const formatIssues = this.checkContentFormat(content);
      issues.push(...formatIssues);
    }

    // 5. 检查对话格式（如果启用）
    if (config.checkDialogue) {
      const dialogueIssues = this.checkDialogueFormat(content);
      issues.push(...dialogueIssues);
    }

    const valid = !issues.some((issue) => issue.severity === "ERROR");

    this.logger.log(
      `[OutputValidator] Chapter content validation: valid=${valid}, wordCount=${this.countWords(content)}, issues=${issues.length}`,
    );

    return {
      valid,
      issues,
      metadata: { duration: Date.now() - startTime, timestamp: new Date() },
    };
  }

  /**
   * 检查章节字数
   */
  private checkChapterWordCount(
    content: string,
    config: ChapterValidationConfig,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const wordCount = this.countWords(content);
    const minWordCount = Math.max(
      config.targetWordCount * VALIDATION_CONFIG.chapter.minWordCountRatio,
      VALIDATION_CONFIG.chapter.minAbsoluteWordCount,
    );

    if (wordCount < minWordCount) {
      issues.push({
        severity: "ERROR",
        type: "insufficient_word_count",
        message: `章节字数不足: 实际 ${wordCount} 字，要求至少 ${Math.floor(minWordCount)} 字`,
        suggestion: `目标字数为 ${config.targetWordCount} 字，当前仅达到 ${((wordCount / config.targetWordCount) * 100).toFixed(1)}%`,
        metadata: { wordCount, targetWordCount: config.targetWordCount },
      });
    } else if (wordCount < config.targetWordCount * 0.8) {
      issues.push({
        severity: "WARNING",
        type: "low_word_count",
        message: `章节字数偏少: 实际 ${wordCount} 字，目标 ${config.targetWordCount} 字`,
        suggestion: "建议适当扩充内容",
        metadata: { wordCount, targetWordCount: config.targetWordCount },
      });
    }

    return issues;
  }

  /**
   * 检查段落结构
   */
  private checkParagraphStructure(content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // 按双换行符分割段落
    const paragraphs = content
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (paragraphs.length === 0) {
      issues.push({
        severity: "ERROR",
        type: "no_paragraphs",
        message: "内容缺少段落分隔",
        suggestion: "使用空行分隔段落",
      });
      return issues;
    }

    // 检查空段落比例
    const emptyParagraphs = paragraphs.filter((p) => p.length < 10).length;
    const emptyRatio = emptyParagraphs / paragraphs.length;

    if (emptyRatio > VALIDATION_CONFIG.chapter.maxEmptyParagraphRatio) {
      issues.push({
        severity: "WARNING",
        type: "too_many_empty_paragraphs",
        message: `过多的空段落: ${emptyParagraphs}/${paragraphs.length}`,
        suggestion: "检查段落内容是否完整",
        metadata: { emptyParagraphs, totalParagraphs: paragraphs.length },
      });
    }

    // 检查段落长度分布
    const avgLength =
      paragraphs.reduce((sum, p) => sum + p.length, 0) / paragraphs.length;

    if (avgLength < 50) {
      issues.push({
        severity: "INFO",
        type: "short_paragraphs",
        message: `段落平均长度较短: ${Math.floor(avgLength)} 字符`,
        suggestion: "考虑适当扩充段落内容",
        metadata: { avgLength },
      });
    }

    return issues;
  }

  /**
   * 检查内容格式
   */
  private checkContentFormat(content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // 检查是否包含 Markdown 标记（可能是格式错误）
    if (/^#+\s/.test(content)) {
      issues.push({
        severity: "WARNING",
        type: "markdown_headers",
        message: "内容包含 Markdown 标题标记",
        suggestion: "正文内容不应包含 # 标题标记",
      });
    }

    // 检查是否有过多的连续空格
    const consecutiveSpaces = content.match(/\s{5,}/g);
    if (consecutiveSpaces && consecutiveSpaces.length > 3) {
      issues.push({
        severity: "INFO",
        type: "excessive_whitespace",
        message: "内容包含过多连续空格",
        suggestion: "检查格式是否正确",
      });
    }

    // 检查是否包含特殊控制字符
    const controlChars = content.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g);
    if (controlChars) {
      issues.push({
        severity: "WARNING",
        type: "control_characters",
        message: "内容包含特殊控制字符",
        suggestion: "清除不可见的控制字符",
        metadata: { count: controlChars.length },
      });
    }

    return issues;
  }

  /**
   * 检查对话格式
   */
  private checkDialogueFormat(content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // 提取对话
    const dialogues = content.match(/[""「『]([^""」』]+)[""」』]/g) || [];

    if (dialogues.length > 0) {
      // 检查引号配对
      const leftQuotes = (content.match(/[""「『]/g) || []).length;
      const rightQuotes = (content.match(/[""」』]/g) || []).length;

      if (leftQuotes !== rightQuotes) {
        issues.push({
          severity: "WARNING",
          type: "unmatched_quotes",
          message: `对话引号不配对: ${leftQuotes} 个左引号 vs ${rightQuotes} 个右引号`,
          suggestion: "检查所有对话是否正确闭合",
          metadata: { leftQuotes, rightQuotes },
        });
      }

      // 检查是否混用引号样式
      const quoteSamples = [
        { pattern: /"/g, name: '中文双引号 ""' },
        { pattern: /「/g, name: "直角引号「」" },
        { pattern: /『/g, name: "双直角引号『』" },
      ];

      const usedStyles = quoteSamples.filter(
        (style) => (content.match(style.pattern) || []).length > 0,
      );

      if (usedStyles.length > 1) {
        issues.push({
          severity: "INFO",
          type: "mixed_quote_styles",
          message: `混用了多种引号样式: ${usedStyles.map((s) => s.name).join(", ")}`,
          suggestion: "建议统一使用一种引号样式",
        });
      }
    }

    return issues;
  }

  /**
   * 计算字数（中英文混合）
   */
  private countWords(text: string): number {
    // 统计中文字符
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;

    // 统计英文单词
    const englishWords = text
      .replace(/[\u4e00-\u9fa5]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    return chineseChars + englishWords;
  }

  // ==================== 工具方法 ====================

  /**
   * 批量验证多个章节
   */
  async validateMultipleChapters(
    chapters: Array<{ content: string; targetWordCount: number }>,
  ): Promise<ValidationResult[]> {
    return Promise.all(
      chapters.map((chapter) =>
        this.validateChapterContent(chapter.content, {
          targetWordCount: chapter.targetWordCount,
          checkFormat: true,
          checkDialogue: true,
        }),
      ),
    );
  }

  /**
   * 生成验证报告摘要
   */
  generateValidationSummary(results: ValidationResult[]): {
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    validCount: number;
    issuesByType: Record<string, number>;
  } {
    let totalIssues = 0;
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    let validCount = 0;
    const issuesByType: Record<string, number> = {};

    for (const result of results) {
      if (result.valid) validCount++;

      for (const issue of result.issues) {
        totalIssues++;

        if (issue.severity === "ERROR") errorCount++;
        else if (issue.severity === "WARNING") warningCount++;
        else if (issue.severity === "INFO") infoCount++;

        issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1;
      }
    }

    return {
      totalIssues,
      errorCount,
      warningCount,
      infoCount,
      validCount,
      issuesByType,
    };
  }
}
