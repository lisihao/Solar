/**
 * WritingQualityCheckerService - 写作质量检查服务
 *
 * 核心职责：
 * - 整合所有质量检查，提供统一的后置验证入口
 * - 重复表达检测增强（变体检测、段落内检测、对话口头禅检测）
 * - 对话质量检测（现代感表达、千人一面、NPC式对话、节奏问题）
 * - 风格一致性检测（风格转换、视角混乱、时态不一致）
 * - 逻辑一致性检测（角色行为冲突、时间线矛盾、空间逻辑问题）
 * - 自动修复功能
 *
 * 设计理念：
 * 1. 后置验证：在章节生成后统一检查
 * 2. 分级报告：error、warning、info 三级
 * 3. 自动修复：部分问题可自动修复
 * 4. 智能建议：提供具体的修改建议
 */

import { Injectable, Logger } from "@nestjs/common";
import { ExpressionMemoryService } from "./expression-memory.service";
import { CharacterPersonalityService } from "./character-personality.service";
import { NarrativeCraftService } from "./narrative-craft.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

// ==================== 类型定义 ====================

export type QualityIssueSeverity = "error" | "warning" | "info";

export type QualityIssueType =
  | "repetition"
  | "dialogue"
  | "style"
  | "logic"
  | "pacing"
  | "modern_language"
  | "character_consistency";

export interface WritingQualityIssue {
  /** 问题类型 */
  type: QualityIssueType;
  /** 严重程度 */
  severity: QualityIssueSeverity;
  /** 问题位置 */
  location: { line: number; column?: number };
  /** 问题描述 */
  message: string;
  /** 问题上下文（实际文本） */
  context: string;
  /** 修改建议 */
  suggestion?: string;
  /** 是否可自动修复 */
  autoFixable?: boolean;
}

export interface ChapterContext {
  projectId: string;
  chapterId: string;
  chapterNumber: number;
  /** 章节所属卷 */
  volumeId?: string;
  /** 出场角色名称列表 */
  characters?: string[];
  /** 历史背景（朝代、时期） */
  historicalPeriod?: string;
  /** 主视角人物 */
  povCharacter?: string;
}

export interface QualityCheckResult {
  /** 总体评分 0-100 */
  overallScore: number;
  /** 是否通过（60分及格） */
  passed: boolean;
  /** 问题列表 */
  issues: WritingQualityIssue[];
  /** 修改建议 */
  suggestions: string[];
  /** 是否可自动修复 */
  autoFixable: boolean;
  /** 检查耗时（毫秒） */
  processingTimeMs: number;
}

// ==================== 禁用词库 ====================

/**
 * 现代感词汇词库
 * 这些词汇在古代/历史背景中不应出现
 */
const MODERN_LANGUAGE_PATTERNS = [
  // 现代口语
  { pattern: /\bOK\b/, replacement: "好的", severity: "error" as const },
  { pattern: /拜拜/g, replacement: "告辞", severity: "error" as const },
  { pattern: /加油/g, replacement: "努力", severity: "warning" as const },
  { pattern: /没问题/g, replacement: "无妨", severity: "warning" as const },
  { pattern: /搞定/g, replacement: "办妥", severity: "warning" as const },
  { pattern: /厉害/g, replacement: "了得", severity: "info" as const },
  { pattern: /尴尬/g, replacement: "窘迫", severity: "info" as const },
  { pattern: /无语/g, replacement: "无言以对", severity: "warning" as const },

  // 现代疑问
  { pattern: /怎么了/g, replacement: "何事", severity: "warning" as const },
  { pattern: /是吗/g, replacement: "当真", severity: "warning" as const },
  {
    pattern: /真的假的/g,
    replacement: "此言当真",
    severity: "warning" as const,
  },
  { pattern: /不会吧/g, replacement: "不至于此", severity: "warning" as const },

  // 现代情态词
  { pattern: /靠谱/g, replacement: "可靠", severity: "info" as const },
  { pattern: /给力/g, replacement: "得力", severity: "warning" as const },
  { pattern: /牛逼/g, replacement: "了得", severity: "error" as const },
  { pattern: /牛/g, replacement: "厉害", severity: "info" as const },

  // 网络用语
  { pattern: /666/g, replacement: "（删除）", severity: "error" as const },
  { pattern: /哈哈哈/g, replacement: "笑道", severity: "warning" as const },
  { pattern: /emmm/g, replacement: "（沉吟）", severity: "error" as const },
];

/**
 * 表达变体词库
 * 用于检测语义相同但用词略有不同的重复表达
 */
const EXPRESSION_VARIANTS = [
  // "心X"系列变体
  ["心中一震", "心头一震", "心下一震", "心里一震"],
  ["心中一紧", "心头一紧", "心下一紧", "心里一紧"],
  ["心中一动", "心头一动", "心下一动", "心里一动"],
  ["心中一喜", "心头一喜", "心下一喜", "心里一喜"],
  ["心中明白", "心里明白", "心下明白", "心中清楚", "心里清楚"],

  // "目光/眼神"系列变体
  ["目光一闪", "眼中一闪", "眼神一闪", "眼底一闪"],
  ["目光坚定", "眼神坚定", "眼中坚定"],
  ["目光灼灼", "眼神灼灼", "目光炯炯"],

  // "微笑"系列变体
  ["微微一笑", "嘴角微扬", "嘴角上扬", "嘴角轻轻上扬", "唇角微扬"],
  ["淡然一笑", "淡淡一笑", "莞尔一笑"],

  // "说话"系列变体
  ["轻声道", "低声道", "淡淡道", "缓缓道", "沉声道"],

  // "程度副词"系列变体
  ["微微", "轻轻", "略", "稍", "稍微"],
  ["缓缓", "慢慢", "徐徐", "从容地"],
  ["深深", "深深地", "深"],

  // "比喻词"系列变体
  ["仿佛", "好像", "似乎", "宛如", "犹如", "恍若"],
];

/**
 * 对话口头禅检测阈值
 * 同一角色在一个章节内重复使用相同表达的次数限制
 */
const CATCHPHRASE_THRESHOLDS = {
  /** 短语（2-4字）重复次数上限 */
  shortPhrase: 3,
  /** 长句（5字以上）重复次数上限 */
  longPhrase: 2,
  /** 语气词重复次数上限 */
  filler: 5,
};

// ==================== 服务实现 ====================

@Injectable()
export class WritingQualityCheckerService {
  private readonly logger = new Logger(WritingQualityCheckerService.name);

  constructor(
    private readonly expressionMemoryService: ExpressionMemoryService,
    private readonly characterPersonalityService: CharacterPersonalityService,
    private readonly narrativeCraftService: NarrativeCraftService,
    private readonly chatFacade: ChatFacade,
  ) {}

  // ==================== 核心检查方法 ====================

  /**
   * 检查章节质量（主入口）
   */
  async checkChapterQuality(
    content: string,
    context: ChapterContext,
  ): Promise<QualityCheckResult> {
    const startTime = Date.now();
    const issues: WritingQualityIssue[] = [];

    this.logger.log(
      `[QualityChecker] Starting quality check for chapter ${context.chapterNumber}`,
    );

    // 1. 重复表达检测（增强版）
    const repetitionIssues = await this.checkRepetition(content, context);
    issues.push(...repetitionIssues);

    // 2. 对话质量检测
    const dialogueIssues = await this.checkDialogueQuality(content, context);
    issues.push(...dialogueIssues);

    // 3. 风格一致性检测
    const styleIssues = this.checkStyleConsistency(content);
    issues.push(...styleIssues);

    // 4. 逻辑一致性检测
    const logicIssues = await this.checkLogicConsistency(content, context);
    issues.push(...logicIssues);

    // 5. 现代感表达检测
    const modernIssues = this.checkModernLanguage(content, context);
    issues.push(...modernIssues);

    // 6. 叙事工艺检测（使用 NarrativeCraftService）
    const craftReport = this.narrativeCraftService.analyzeContent(content);
    issues.push(
      ...craftReport.issues.map((i) => ({
        type: "pacing" as QualityIssueType,
        severity: "warning" as QualityIssueSeverity,
        location: { line: i.line },
        message: i.problem,
        context: i.match,
        suggestion: i.suggestion,
        autoFixable: i.type === "ending", // 结尾问题可自动修复
      })),
    );

    // 计算总分
    const { score, suggestions, autoFixable } = this.calculateScore(issues);

    const processingTimeMs = Date.now() - startTime;

    this.logger.log(
      `[QualityChecker] Check completed in ${processingTimeMs}ms: score=${score}, issues=${issues.length}`,
    );

    return {
      overallScore: score,
      passed: score >= 60,
      issues,
      suggestions,
      autoFixable,
      processingTimeMs,
    };
  }

  /**
   * 自动修复章节内容
   */
  async autoFix(
    content: string,
    issues: WritingQualityIssue[],
    context: ChapterContext,
  ): Promise<string> {
    this.logger.log(
      `[QualityChecker] Starting auto-fix for ${issues.length} issues`,
    );

    let fixedContent = content;

    // 1. 修复现代感表达（直接替换）
    const modernIssues = issues.filter((i) => i.type === "modern_language");
    for (const issue of modernIssues) {
      const pattern = MODERN_LANGUAGE_PATTERNS.find((p) =>
        p.pattern.test(issue.context),
      );
      if (pattern && issue.suggestion) {
        fixedContent = fixedContent.replace(
          pattern.pattern,
          pattern.replacement,
        );
        this.logger.debug(
          `[QualityChecker] Fixed modern language: "${issue.context}" → "${pattern.replacement}"`,
        );
      }
    }

    // 2. 修复结尾问题（使用 NarrativeCraftService）
    const endingIssues = issues.filter(
      (i) => i.type === "pacing" && i.autoFixable,
    );
    if (endingIssues.length > 0) {
      const craftIssues = endingIssues.map((i) => ({
        type: "ending" as const,
        category: "ending",
        match: i.context,
        line: i.location.line,
        problem: i.message,
        suggestion: i.suggestion || "",
      }));

      fixedContent = await this.narrativeCraftService.rewriteEnding(
        fixedContent,
        craftIssues,
      );
      this.logger.log(`[QualityChecker] Fixed ending issues`);
    }

    // 3. 修复简单的对话问题（调用 LLM）
    const dialogueIssues = issues.filter(
      (i) => i.type === "dialogue" && i.severity !== "error",
    );
    if (dialogueIssues.length > 0 && dialogueIssues.length <= 3) {
      fixedContent = await this.fixDialogueIssues(
        fixedContent,
        dialogueIssues,
        context,
      );
    }

    return fixedContent;
  }

  // ==================== 重复表达检测（增强版） ====================

  /**
   * 检查重复表达
   * 增强功能：
   * 1. 变体检测（如"心中一震"和"心头一震"）
   * 2. 段落内检测
   * 3. 对话口头禅检测
   */
  private async checkRepetition(
    content: string,
    context: ChapterContext,
  ): Promise<WritingQualityIssue[]> {
    const issues: WritingQualityIssue[] = [];

    // 1. 全文表达重复检测（使用 ExpressionMemoryService）
    const expressionAnalysis =
      await this.expressionMemoryService.analyzeExpressionsOnly(
        context.projectId,
        content,
      );

    for (const violation of expressionAnalysis.violatedExpressions) {
      issues.push({
        type: "repetition",
        severity: "warning",
        location: { line: 0 }, // 全文问题，行号暂时设为0
        message: `表达"${violation.expression}"处于冷却期，不应再次使用`,
        context: violation.expression,
        suggestion: "请使用替代表达或重新创作",
        autoFixable: false,
      });
    }

    // 2. 变体检测
    const variantIssues = this.checkExpressionVariants(content);
    issues.push(...variantIssues);

    // 3. 段落内重复检测
    const paragraphIssues = this.checkParagraphRepetition(content);
    issues.push(...paragraphIssues);

    // 4. 对话口头禅检测
    if (context.characters && context.characters.length > 0) {
      const catchphraseIssues = this.checkCatchphrases(
        content,
        context.characters,
      );
      issues.push(...catchphraseIssues);
    }

    return issues;
  }

  /**
   * 检测表达变体重复
   */
  private checkExpressionVariants(content: string): WritingQualityIssue[] {
    const issues: WritingQualityIssue[] = [];

    for (const variants of EXPRESSION_VARIANTS) {
      const matches = new Map<string, number>();

      // 统计每个变体出现的次数
      for (const variant of variants) {
        const regex = new RegExp(variant, "g");
        const count = (content.match(regex) || []).length;
        if (count > 0) {
          matches.set(variant, count);
        }
      }

      // 如果同一组变体中有2个以上出现，则报警
      if (matches.size >= 2) {
        const variantList = Array.from(matches.entries())
          .map(([v, c]) => `"${v}"(${c}次)`)
          .join("、");

        issues.push({
          type: "repetition",
          severity: "warning",
          location: { line: 0 },
          message: `使用了语义相同的变体表达：${variantList}`,
          context: variantList,
          suggestion: `这些表达本质相同，建议只保留一种，或用完全不同的表达方式`,
          autoFixable: false,
        });
      }
    }

    return issues;
  }

  /**
   * 检测段落内重复
   */
  private checkParagraphRepetition(content: string): WritingQualityIssue[] {
    const issues: WritingQualityIssue[] = [];
    const paragraphs = content.split(/\n\s*\n/);

    paragraphs.forEach((para, index) => {
      // 提取3-6字的短语
      const phrases = para.match(/[\u4e00-\u9fa5]{3,6}/g) || [];
      const phraseCount = new Map<string, number>();

      for (const phrase of phrases) {
        phraseCount.set(phrase, (phraseCount.get(phrase) || 0) + 1);
      }

      // 检查段落内重复
      for (const [phrase, count] of phraseCount) {
        if (count >= 3) {
          issues.push({
            type: "repetition",
            severity: "info",
            location: { line: index + 1 },
            message: `段落内重复使用"${phrase}"${count}次`,
            context: phrase,
            suggestion: "段落内避免重复使用相同表达",
            autoFixable: false,
          });
        }
      }
    });

    return issues;
  }

  /**
   * 检测对话口头禅
   */
  private checkCatchphrases(
    content: string,
    characters: string[],
  ): WritingQualityIssue[] {
    const issues: WritingQualityIssue[] = [];

    // 提取对话并关联说话者
    const dialogues = this.extractDialoguesWithSpeaker(content, characters);

    // 按角色分组统计
    const characterPhrases = new Map<
      string,
      Map<string, { count: number; dialogues: string[] }>
    >();

    for (const { speaker, dialogue } of dialogues) {
      if (!speaker) continue;

      if (!characterPhrases.has(speaker)) {
        characterPhrases.set(speaker, new Map());
      }

      const phrases = dialogue.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
      const charMap = characterPhrases.get(speaker)!;

      for (const phrase of phrases) {
        if (!charMap.has(phrase)) {
          charMap.set(phrase, { count: 0, dialogues: [] });
        }
        const entry = charMap.get(phrase)!;
        entry.count++;
        entry.dialogues.push(dialogue);
      }
    }

    // 检测口头禅
    for (const [speaker, phraseMap] of characterPhrases) {
      for (const [phrase, { count, dialogues }] of phraseMap) {
        const threshold =
          phrase.length <= 4
            ? CATCHPHRASE_THRESHOLDS.shortPhrase
            : CATCHPHRASE_THRESHOLDS.longPhrase;

        if (count > threshold) {
          issues.push({
            type: "dialogue",
            severity: "info",
            location: { line: 0 },
            message: `角色"${speaker}"对话中过度使用"${phrase}"（${count}次）`,
            context: dialogues.slice(0, 2).join(" / "),
            suggestion: `角色对话应该多样化，避免口头禅式的重复`,
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  }

  // ==================== 对话质量检测 ====================

  /**
   * 检查对话质量
   * 包括：千人一面、NPC式对话、对话节奏
   */
  private async checkDialogueQuality(
    content: string,
    context: ChapterContext,
  ): Promise<WritingQualityIssue[]> {
    const issues: WritingQualityIssue[] = [];

    // 1. 千人一面检测
    if (context.characters && context.characters.length >= 2) {
      const uniformityIssues = await this.checkDialogueUniformity(
        content,
        context,
      );
      issues.push(...uniformityIssues);
    }

    // 2. NPC式对话检测
    const npcIssues = this.checkNPCDialogue(content);
    issues.push(...npcIssues);

    // 3. 对话节奏检测
    const pacingIssues = this.checkDialoguePacing(content);
    issues.push(...pacingIssues);

    return issues;
  }

  /**
   * 检测千人一面（所有角色说话风格相同）
   */
  private async checkDialogueUniformity(
    content: string,
    context: ChapterContext,
  ): Promise<WritingQualityIssue[]> {
    const issues: WritingQualityIssue[] = [];

    if (!context.characters || context.characters.length < 2) {
      return issues;
    }

    // 使用 CharacterPersonalityService 验证对话
    const dialogues = this.extractDialoguesWithSpeaker(
      content,
      context.characters,
    ).map((d) => ({
      characterName: d.speaker || "",
      dialogue: d.dialogue,
    }));

    const validationResult =
      await this.characterPersonalityService.validateDialogue(
        context.projectId,
        dialogues,
      );

    for (const issue of validationResult.issues) {
      issues.push({
        type: "dialogue",
        severity: "warning",
        location: { line: 0 },
        message: issue.issue,
        context: issue.dialogue,
        suggestion: issue.suggestion,
        autoFixable: false,
      });
    }

    return issues;
  }

  /**
   * 检测NPC式对话（信息灌输型）
   */
  private checkNPCDialogue(content: string): WritingQualityIssue[] {
    const issues: WritingQualityIssue[] = [];

    const npcPatterns = [
      { pattern: /奴婢名唤.*小姐您是/g, message: "对话像在读设定集" },
      { pattern: /您可知道.*其实.*因为/g, message: "信息灌输式对话" },
      { pattern: /我得告诉您.*这件事.*因为/g, message: "强行解释背景" },
      {
        pattern: /让我来告诉你.*这.*那.*还有/g,
        message: "列举式信息灌输",
      },
    ];

    const lines = content.split("\n");

    for (const { pattern, message } of npcPatterns) {
      lines.forEach((line, index) => {
        if (pattern.test(line)) {
          issues.push({
            type: "dialogue",
            severity: "warning",
            location: { line: index + 1 },
            message,
            context: line.slice(0, 50),
            suggestion: "通过冲突、问题、误解来自然引出信息",
            autoFixable: false,
          });
        }
      });
    }

    return issues;
  }

  /**
   * 检测对话节奏问题（连续长对话没有动作间隔）
   */
  private checkDialoguePacing(content: string): WritingQualityIssue[] {
    const issues: WritingQualityIssue[] = [];

    const dialogueMatches = content.match(/[「『""].*?[」』""]/g) || [];

    let consecutiveLongDialogues = 0;
    let lastDialogueEnd = 0;

    for (let i = 0; i < dialogueMatches.length; i++) {
      const dialogue = dialogueMatches[i];

      if (dialogue.length > 50) {
        // 检查与上一段对话之间是否有足够的叙述间隔
        const dialogueStart = content.indexOf(dialogue, lastDialogueEnd);
        const betweenText = content.slice(lastDialogueEnd, dialogueStart);

        // 如果中间文本少于20字且没有动作描写，算作连续
        if (
          betweenText.length < 20 ||
          !/[走站坐转抬握推拉]/.test(betweenText)
        ) {
          consecutiveLongDialogues++;
        } else {
          consecutiveLongDialogues = 1;
        }

        lastDialogueEnd = dialogueStart + dialogue.length;

        if (consecutiveLongDialogues >= 3) {
          issues.push({
            type: "pacing",
            severity: "info",
            location: { line: 0 },
            message: `连续${consecutiveLongDialogues}段长对话缺乏动作描写间隔`,
            context: dialogue.slice(0, 50),
            suggestion: "在对话间插入角色动作、表情或环境描写",
            autoFixable: false,
          });
          consecutiveLongDialogues = 0; // 报告后重置
        }
      } else {
        consecutiveLongDialogues = 0;
      }
    }

    return issues;
  }

  // ==================== 现代感表达检测 ====================

  /**
   * 检测现代感表达
   */
  private checkModernLanguage(
    content: string,
    context: ChapterContext,
  ): WritingQualityIssue[] {
    const issues: WritingQualityIssue[] = [];

    // 只在古代背景下检测
    if (!context.historicalPeriod) {
      return issues;
    }

    const lines = content.split("\n");

    for (const { pattern, replacement, severity } of MODERN_LANGUAGE_PATTERNS) {
      lines.forEach((line, index) => {
        const matches = line.match(pattern);
        if (matches) {
          for (const match of matches) {
            issues.push({
              type: "modern_language",
              severity,
              location: { line: index + 1 },
              message: `在古代背景中使用了现代表达"${match}"`,
              context: match,
              suggestion: `建议替换为"${replacement}"`,
              autoFixable: true,
            });
          }
        }
      });
    }

    return issues;
  }

  // ==================== 风格一致性检测 ====================

  /**
   * 检查风格一致性
   */
  private checkStyleConsistency(content: string): WritingQualityIssue[] {
    const issues: WritingQualityIssue[] = [];

    // 1. 检测突兀的风格转换
    const styleShiftIssues = this.detectStyleShift(content);
    issues.push(...styleShiftIssues);

    // 2. 检测时态不一致
    const tenseIssues = this.detectTenseInconsistency(content);
    issues.push(...tenseIssues);

    return issues;
  }

  /**
   * 检测风格突变
   */
  private detectStyleShift(content: string): WritingQualityIssue[] {
    const issues: WritingQualityIssue[] = [];

    const paragraphs = content.split(/\n\s*\n/);

    // 检测白话文和文言文的混用
    for (let i = 0; i < paragraphs.length - 1; i++) {
      const current = paragraphs[i];
      const next = paragraphs[i + 1];

      const currentIsClassical = /[之乎者也矣焉哉]/.test(current);
      const nextIsClassical = /[之乎者也矣焉哉]/.test(next);

      if (currentIsClassical !== nextIsClassical) {
        issues.push({
          type: "style",
          severity: "warning",
          location: { line: i + 1 },
          message: "段落间风格突变（文言与白话混用）",
          context: `${current.slice(0, 30)} → ${next.slice(0, 30)}`,
          suggestion: "保持整章的语言风格一致",
          autoFixable: false,
        });
      }
    }

    return issues;
  }

  /**
   * 检测时态不一致
   */
  private detectTenseInconsistency(content: string): WritingQualityIssue[] {
    const issues: WritingQualityIssue[] = [];

    // 检测过去时和现在时的混用
    const lines = content.split("\n");
    let dominantTense: "past" | "present" | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const hasPast = /[了着过](?=[。，！？\s])/.test(line);
      const hasPresent = /正在|正要|此刻|眼下/.test(line);

      if (!dominantTense && (hasPast || hasPresent)) {
        dominantTense = hasPast ? "past" : "present";
      }

      if (
        dominantTense === "past" &&
        hasPresent &&
        !hasPast &&
        line.length > 20
      ) {
        issues.push({
          type: "style",
          severity: "info",
          location: { line: i + 1 },
          message: "时态不一致（主要使用过去时，此处使用现在时）",
          context: line.slice(0, 50),
          suggestion: "保持时态一致，统一使用过去时或现在时",
          autoFixable: false,
        });
      } else if (
        dominantTense === "present" &&
        hasPast &&
        !hasPresent &&
        line.length > 20
      ) {
        issues.push({
          type: "style",
          severity: "info",
          location: { line: i + 1 },
          message: "时态不一致（主要使用现在时，此处使用过去时）",
          context: line.slice(0, 50),
          suggestion: "保持时态一致，统一使用过去时或现在时",
          autoFixable: false,
        });
      }
    }

    return issues;
  }

  // ==================== 逻辑一致性检测 ====================

  /**
   * 检查逻辑一致性
   */
  private async checkLogicConsistency(
    content: string,
    context: ChapterContext,
  ): Promise<WritingQualityIssue[]> {
    const issues: WritingQualityIssue[] = [];

    // 1. 角色行为与性格冲突
    if (context.characters && context.characters.length > 0) {
      const behaviorIssues = await this.checkCharacterBehavior(
        content,
        context,
      );
      issues.push(...behaviorIssues);
    }

    // 2. 空间逻辑问题（角色瞬移）
    const spatialIssues = this.checkSpatialLogic(content);
    issues.push(...spatialIssues);

    return issues;
  }

  /**
   * 检查角色行为与性格一致性
   */
  private async checkCharacterBehavior(
    content: string,
    context: ChapterContext,
  ): Promise<WritingQualityIssue[]> {
    const issues: WritingQualityIssue[] = [];

    // 使用 CharacterPersonalityService 检查人格一致性
    const consistencyResult =
      await this.characterPersonalityService.checkPersonalityConsistency(
        context.projectId,
        content,
      );

    for (const violation of consistencyResult.violations) {
      issues.push({
        type: "character_consistency",
        severity: "warning",
        location: { line: 0 },
        message: violation.description,
        context: violation.location,
        suggestion: violation.suggestion,
        autoFixable: false,
      });
    }

    return issues;
  }

  /**
   * 检查空间逻辑（角色瞬移）
   */
  private checkSpatialLogic(content: string): WritingQualityIssue[] {
    const issues: WritingQualityIssue[] = [];

    // 检测场景快速切换但没有过渡
    const locationPatterns = [
      "宫中",
      "殿内",
      "府中",
      "院子",
      "房间",
      "街上",
      "城门",
      "郊外",
    ];

    const lines = content.split("\n");
    let lastLocation: string | null = null;
    let lastLocationLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const location of locationPatterns) {
        if (line.includes(location)) {
          if (
            lastLocation &&
            lastLocation !== location &&
            i - lastLocationLine < 3
          ) {
            // 3行内场景切换，检查是否有过渡描写
            const betweenText = lines.slice(lastLocationLine, i + 1).join("");
            const hasTransition = /走|行|去|来|到|进|出|离/.test(betweenText);

            if (!hasTransition) {
              issues.push({
                type: "logic",
                severity: "info",
                location: { line: i + 1 },
                message: `场景从"${lastLocation}"切换到"${location}"缺乏过渡`,
                context: line.slice(0, 50),
                suggestion: "添加角色移动或场景转换的描写",
                autoFixable: false,
              });
            }
          }

          lastLocation = location;
          lastLocationLine = i;
          break;
        }
      }
    }

    return issues;
  }

  // ==================== 辅助方法 ====================

  /**
   * 提取对话并关联说话者
   */
  private extractDialoguesWithSpeaker(
    content: string,
    characters: string[],
  ): Array<{ speaker: string | null; dialogue: string }> {
    const result: Array<{ speaker: string | null; dialogue: string }> = [];

    const dialogueMatches = [
      ...content.matchAll(/[「『""]([^」』""]+)[」』""]/g),
    ];

    for (const match of dialogueMatches) {
      const dialogue = match[1];
      const startIndex = match.index || 0;

      // 在对话前50字符内查找角色名
      const before = content.slice(Math.max(0, startIndex - 50), startIndex);

      let speaker: string | null = null;
      for (const char of characters) {
        if (before.includes(char)) {
          speaker = char;
          break;
        }
      }

      result.push({ speaker, dialogue });
    }

    return result;
  }

  /**
   * 计算总分
   */
  private calculateScore(issues: WritingQualityIssue[]): {
    score: number;
    suggestions: string[];
    autoFixable: boolean;
  } {
    // 按严重程度扣分
    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;
    const infoCount = issues.filter((i) => i.severity === "info").length;

    const score = Math.max(
      0,
      100 - errorCount * 20 - warningCount * 10 - infoCount * 3,
    );

    // 生成建议
    const suggestions: string[] = [];
    const topIssues = issues
      .filter((i) => i.severity === "error" || i.severity === "warning")
      .slice(0, 5);

    for (const issue of topIssues) {
      if (issue.suggestion) {
        suggestions.push(`${issue.message}: ${issue.suggestion}`);
      }
    }

    // 检查是否可自动修复
    const autoFixable = issues.some((i) => i.autoFixable);

    return { score, suggestions, autoFixable };
  }

  /**
   * 修复对话问题（调用 LLM）
   */
  private async fixDialogueIssues(
    content: string,
    issues: WritingQualityIssue[],
    context: ChapterContext,
  ): Promise<string> {
    if (issues.length === 0) return content;

    this.logger.log(
      `[QualityChecker] Fixing ${issues.length} dialogue issues with LLM`,
    );

    // 构建问题列表
    const issuesList = issues
      .map(
        (i, idx) =>
          `${idx + 1}. ${i.message}\n   上下文: ${i.context}\n   建议: ${i.suggestion}`,
      )
      .join("\n\n");

    try {
      // ★ P3 迁移：使用 chatWithSkills 统一入口
      const response = await this.chatFacade.chatWithSkills({
        messages: [
          {
            role: "user",
            content: `请修复以下对话问题，保持原文风格和情节，只改进对话部分。\n\n## 原文\n${content}`,
          },
        ],
        domain: "writing",
        taskProfile: {
          creativity: "medium",
          outputLength: "long",
        },
        skillContext: {
          characters: context.characters?.join("、") || undefined,
          historicalPeriod: context.historicalPeriod || undefined,
          issuesList,
        },
      });

      return response.content?.trim() || content;
    } catch (error) {
      this.logger.error(
        `[QualityChecker] Failed to fix dialogue issues: ${error}`,
      );
      return content;
    }
  }
}
