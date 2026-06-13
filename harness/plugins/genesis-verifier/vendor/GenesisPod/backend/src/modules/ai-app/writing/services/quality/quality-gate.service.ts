/**
 * WritingQualityGateService - 质量门禁服务
 *
 * 核心职责：
 * - 计算章节内容的多维度质量评分
 * - 执行质量门禁检查
 * - 决定是否需要重写
 * - 记录质量问题模式
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ExpressionMemoryService } from "./expression-memory.service";
import {
  CharacterPersonalityService,
  PersonalityConsistencyResult,
} from "./character-personality.service";
import {
  SemanticConsistencyService,
  SemanticFact,
} from "./semantic-consistency.service";
import { NarrativeCraftService } from "./narrative-craft.service";

// ==================== 类型定义 ====================

/**
 * 质量门禁配置
 */
export interface QualityGateConfig {
  // 硬性门禁（不通过则打回重写）
  hard: {
    /** 多样性评分阈值 */
    minDiversityScore: number;
    /** 角色一致性阈值 */
    minCharacterConsistency: number;
    /** 最大重写次数 */
    maxRewriteAttempts: number;
  };
  // 软性门禁（警告但通过）
  soft: {
    /** 情节新颖度阈值 */
    minPlotNovelty: number;
    /** 叙事流畅度阈值 */
    minNarrativeFlow: number;
  };
}

/**
 * 默认质量门禁配置
 */
const DEFAULT_QUALITY_GATE_CONFIG: QualityGateConfig = {
  hard: {
    minDiversityScore: 0.45, // 从 0.6 降低到 0.45，因为中文小说常用表达会拉低得分
    minCharacterConsistency: 0.7,
    maxRewriteAttempts: 3,
  },
  soft: {
    minPlotNovelty: 0.5,
    minNarrativeFlow: 0.6,
  },
};

/**
 * 质量评分结果
 */
export interface QualityScoreResult {
  // 多样性评分
  diversityScore: number;
  vocabularyRichness: number;
  sentenceVariety: number;
  expressionNovelty: number;

  // 角色一致性评分
  characterConsistency: number;
  dialogueAuthenticity: number;

  // 情节评分
  plotNovelty: number;
  narrativeFlow: number;

  // 设定准确性
  settingAccuracy: number;

  // 综合评分
  overallScore: number;
}

/**
 * 质量问题
 */
export interface QualityIssue {
  type:
    | "repetition"
    | "character_inconsistency"
    | "plot_pattern"
    | "style_issue"
    | "setting_error";
  severity: "error" | "warning" | "info";
  description: string;
  location?: string;
  suggestion?: string;
}

/**
 * 质量门禁结果
 */
export interface QualityGateResult {
  /** 是否通过门禁 */
  passed: boolean;
  /** 质量评分 */
  scores: QualityScoreResult;
  /** 发现的问题 */
  issues: QualityIssue[];
  /** 是否需要重写 */
  requiresRewrite: boolean;
  /** 重写建议 */
  rewriteSuggestions?: string[];
  /** 当前重写次数 */
  rewriteCount: number;
}

// ==================== 服务实现 ====================

@Injectable()
export class WritingQualityGateService {
  private readonly logger = new Logger(WritingQualityGateService.name);
  private config: QualityGateConfig = DEFAULT_QUALITY_GATE_CONFIG;

  constructor(
    private readonly prisma: PrismaService,
    private readonly expressionMemory: ExpressionMemoryService,
    private readonly characterPersonality: CharacterPersonalityService,
    private readonly semanticConsistency: SemanticConsistencyService,
    private readonly narrativeCraft: NarrativeCraftService,
  ) {}

  /**
   * 执行语义一致性检查（可选增强）
   * @param content 章节内容
   * @param establishedFacts 已确立的事实
   * @param characterFacts 角色相关事实
   */
  async checkSemanticConsistency(
    content: string,
    establishedFacts: SemanticFact[] = [],
    characterFacts: SemanticFact[] = [],
  ) {
    return this.semanticConsistency.checkSemanticConsistency(
      content,
      establishedFacts,
      characterFacts,
    );
  }

  // ==================== 质量门禁检查 ====================

  /**
   * 执行质量门禁检查
   */
  async checkQualityGate(
    projectId: string,
    chapterId: string,
    chapterNumber: number,
    content: string,
    previousRewriteCount: number = 0,
  ): Promise<QualityGateResult> {
    this.logger.log(
      `[QualityGate] Checking chapter ${chapterNumber}, attempt ${previousRewriteCount + 1}`,
    );

    // 1. 计算质量评分
    const scores = await this.calculateQualityScores(
      projectId,
      chapterNumber,
      content,
    );

    // 2. 检测问题
    const issues = await this.detectQualityIssues(projectId, content);

    // 3. 检查人格一致性
    const personalityResult =
      await this.characterPersonality.checkPersonalityConsistency(
        projectId,
        content,
      );

    // 将人格问题加入问题列表
    for (const violation of personalityResult.violations) {
      issues.push({
        type: "character_inconsistency",
        severity: "error",
        description: violation.description,
        location: violation.location,
        suggestion: violation.suggestion,
      });
    }

    // 4. 判断是否通过门禁
    // ★ 修复：传入 issues 让 checkHardGate 检查叙事工艺错误
    const hardGatePassed = this.checkHardGate(
      scores,
      personalityResult,
      issues,
    );
    const softGatePassed = this.checkSoftGate(scores);

    // 5. 决定是否需要重写
    const canRewrite =
      previousRewriteCount < this.config.hard.maxRewriteAttempts;
    const requiresRewrite = !hardGatePassed && canRewrite;

    // 6. 生成重写建议
    const rewriteSuggestions = requiresRewrite
      ? this.generateRewriteSuggestions(scores, issues)
      : undefined;

    // 7. 记录评分
    await this.saveQualityScore(
      projectId,
      chapterId,
      scores,
      issues,
      hardGatePassed && softGatePassed,
      previousRewriteCount,
    );

    const result: QualityGateResult = {
      passed: hardGatePassed,
      scores,
      issues,
      requiresRewrite,
      rewriteSuggestions,
      rewriteCount: previousRewriteCount,
    };

    this.logger.log(
      `[QualityGate] Chapter ${chapterNumber}: passed=${hardGatePassed}, ` +
        `diversity=${scores.diversityScore.toFixed(2)}, ` +
        `character=${scores.characterConsistency.toFixed(2)}, ` +
        `issues=${issues.length}`,
    );

    return result;
  }

  // ==================== 质量评分计算 ====================

  /**
   * 计算质量评分
   */
  async calculateQualityScores(
    projectId: string,
    chapterNumber: number,
    content: string,
  ): Promise<QualityScoreResult> {
    // 1. 计算词汇丰富度 (TTR - Type-Token Ratio)
    const vocabularyRichness = this.calculateVocabularyRichness(content);

    // 2. 计算句式变化度
    const sentenceVariety = this.calculateSentenceVariety(content);

    // 3. 计算表达新颖度（基于表达记忆）
    const expressionNovelty = await this.calculateExpressionNovelty(
      projectId,
      chapterNumber,
      content,
    );

    // 4. 计算多样性综合分
    const diversityScore =
      vocabularyRichness * 0.3 +
      sentenceVariety * 0.3 +
      expressionNovelty * 0.4;

    // 5. 计算角色一致性（从人格检测获取）
    const personalityResult =
      await this.characterPersonality.checkPersonalityConsistency(
        projectId,
        content,
      );
    const characterConsistency = personalityResult.score;

    // 6. 计算对话真实度
    const dialogueAuthenticity = this.calculateDialogueAuthenticity(content);

    // 7. 计算情节新颖度
    const plotNovelty = await this.calculatePlotNovelty(projectId, content);

    // 8. 计算叙事流畅度
    const narrativeFlow = this.calculateNarrativeFlow(content);

    // 9. 设定准确性（暂时固定值，后续接入历史知识库）
    const settingAccuracy = 0.8;

    // 10. 计算综合评分
    const overallScore =
      diversityScore * 0.3 +
      characterConsistency * 0.25 +
      plotNovelty * 0.2 +
      narrativeFlow * 0.15 +
      settingAccuracy * 0.1;

    return {
      diversityScore,
      vocabularyRichness,
      sentenceVariety,
      expressionNovelty,
      characterConsistency,
      dialogueAuthenticity,
      plotNovelty,
      narrativeFlow,
      settingAccuracy,
      overallScore,
    };
  }

  /**
   * 计算词汇丰富度 (TTR)
   */
  private calculateVocabularyRichness(content: string): number {
    // 提取中文词汇
    const words = content.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    if (words.length === 0) return 0.5;

    const uniqueWords = new Set(words);
    const ttr = uniqueWords.size / words.length;

    // 将 TTR 映射到 0-1 分数（典型值在 0.3-0.7 之间）
    return Math.min(1, Math.max(0, (ttr - 0.2) / 0.4));
  }

  /**
   * 计算句式变化度
   */
  private calculateSentenceVariety(content: string): number {
    // 按句号分割句子
    const sentences = content
      .split(/[。！？]/)
      .filter((s) => s.trim().length > 0);
    if (sentences.length < 3) return 0.5;

    // 计算句子长度的标准差
    const lengths = sentences.map((s) => s.length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance =
      lengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) /
      lengths.length;
    const stdDev = Math.sqrt(variance);

    // 计算句首词变化度
    const starters = sentences.map((s) => s.trim().substring(0, 2));
    const uniqueStarters = new Set(starters);
    const starterVariety = uniqueStarters.size / starters.length;

    // 综合评分
    const lengthVarietyScore = Math.min(1, stdDev / 20);
    const score = lengthVarietyScore * 0.5 + starterVariety * 0.5;

    return Math.min(1, Math.max(0, score));
  }

  /**
   * 计算表达新颖度
   */
  private async calculateExpressionNovelty(
    projectId: string,
    _chapterNumber: number,
    content: string,
  ): Promise<number> {
    // ★ 只分析不记录，避免在质量评估时重复记录表达
    const analysisResult = await this.expressionMemory.analyzeExpressionsOnly(
      projectId,
      content,
    );

    // 计算新颖度：新表达占比
    const totalExpressions =
      analysisResult.newExpressions.length +
      analysisResult.violatedExpressions.length;

    if (totalExpressions === 0) return 0.8; // 没有检测到特定表达，给中等分

    const noveltyRatio =
      analysisResult.newExpressions.length / totalExpressions;

    // 违反冷却期的表达降分（从 0.1 降到 0.03，因为中文小说常用表达会触发很多次）
    const penaltyRatio = analysisResult.violatedExpressions.length * 0.03;

    // ★ 详细日志：追踪违规表达
    if (analysisResult.violatedExpressions.length > 0) {
      const violatedList = analysisResult.violatedExpressions
        .slice(0, 10)
        .map((v) => `"${v.expression}"(${v.useCount}次)`)
        .join(", ");
      this.logger.warn(
        `[QualityGate] Found ${analysisResult.violatedExpressions.length} cooling violations: ${violatedList}`,
      );
    }

    return Math.max(0, noveltyRatio - penaltyRatio);
  }

  /**
   * 计算对话真实度
   */
  private calculateDialogueAuthenticity(content: string): number {
    // 提取对话
    const dialogues = content.match(/[""「]([^""」]+)[""」]/g) || [];
    if (dialogues.length === 0) return 0.7;

    let score = 0.7;

    // 检查对话长度分布
    const lengths = dialogues.map((d) => d.length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;

    // 对话不应该都太短或太长
    if (avgLength >= 10 && avgLength <= 50) score += 0.1;

    // 检查语气词使用
    const withParticles = dialogues.filter((d) =>
      /[吗吧呢啊哦嘛呀哪]/.test(d),
    ).length;
    const particleRatio = withParticles / dialogues.length;

    if (particleRatio >= 0.3 && particleRatio <= 0.7) score += 0.1;

    // 检查是否有动作描写穿插
    const actionInterrupts = (content.match(/[""」]，[^""「]/g) || []).length;
    if (actionInterrupts >= dialogues.length * 0.2) score += 0.1;

    return Math.min(1, score);
  }

  /**
   * 计算情节新颖度
   */
  private async calculatePlotNovelty(
    projectId: string,
    content: string,
  ): Promise<number> {
    // 检测常见情节模式
    const patterns = await this.prisma.writingPlotPattern.findMany({
      where: { projectId },
    });

    let matchedPatterns = 0;
    for (const pattern of patterns) {
      for (const keyword of pattern.keywords) {
        if (content.includes(keyword)) {
          matchedPatterns++;
          break;
        }
      }
    }

    // 基础分 0.7，每匹配一个已用模式扣 0.1
    const score = Math.max(0.3, 0.8 - matchedPatterns * 0.1);

    return score;
  }

  /**
   * 计算叙事流畅度
   */
  private calculateNarrativeFlow(content: string): number {
    let score = 0.7;

    // 检查段落长度分布
    const paragraphs = content
      .split(/\n\s*\n/)
      .filter((p) => p.trim().length > 0);
    if (paragraphs.length >= 3) {
      const lengths = paragraphs.map((p) => p.length);
      const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;

      // 段落不应该太长或太短
      if (avgLength >= 100 && avgLength <= 500) score += 0.1;
    }

    // 检查过渡词使用
    const transitionWords = [
      "然而",
      "但是",
      "不过",
      "于是",
      "因此",
      "随后",
      "接着",
      "这时",
      "此时",
      "就在",
    ];
    const transitionCount = transitionWords.reduce(
      (count, word) =>
        count + (content.match(new RegExp(word, "g")) || []).length,
      0,
    );

    const transitionRatio = transitionCount / paragraphs.length;
    if (transitionRatio >= 0.3 && transitionRatio <= 1.5) score += 0.1;

    // 检查时间顺序词
    const timeWords = ["片刻", "良久", "不多时", "转眼", "须臾", "顷刻"];
    const timeWordCount = timeWords.reduce(
      (count, word) =>
        count + (content.match(new RegExp(word, "g")) || []).length,
      0,
    );

    if (timeWordCount >= 2) score += 0.1;

    return Math.min(1, score);
  }

  // ==================== 问题检测 ====================

  /**
   * 检测质量问题
   */
  private async detectQualityIssues(
    projectId: string,
    content: string,
  ): Promise<QualityIssue[]> {
    const issues: QualityIssue[] = [];

    // 1. 检测重复表达
    const repetitionIssues = this.detectRepetitions(content);
    issues.push(...repetitionIssues);

    // 2. 检测情节模式重复
    const plotPatternIssues = await this.detectPlotPatternIssues(
      projectId,
      content,
    );
    issues.push(...plotPatternIssues);

    // 3. 检测风格问题
    const styleIssues = this.detectStyleIssues(content);
    issues.push(...styleIssues);

    // ★★★ 4. 叙事工艺检测（结尾问题、说教模式、NPC对话）- 核心质量检测
    const narrativeIssues = this.detectNarrativeCraftIssues(content);
    issues.push(...narrativeIssues);

    return issues;
  }

  /**
   * ★★★ 检测叙事工艺问题（后置检测 - 最关键的质量门禁）
   * 这是约束执行的第二道防线：即使 prompt 约束被忽略，这里也能检测出问题
   */
  private detectNarrativeCraftIssues(content: string): QualityIssue[] {
    const qualityIssues: QualityIssue[] = [];

    // 使用 NarrativeCraftService 进行深度分析
    const report = this.narrativeCraft.analyzeContent(content);

    // 统计各类问题数量
    let endingCount = 0;
    let preachCount = 0;
    let npcCount = 0;

    // 遍历所有检测到的问题
    for (const issue of report.issues) {
      // 根据问题类型确定严重程度
      let severity: "error" | "warning" | "info";
      if (issue.type === "ending") {
        severity = "error"; // 结尾问题 - 严重错误，必须重写
        endingCount++;
      } else if (issue.type === "preach") {
        severity = "error"; // 说教模式 - 严重错误
        preachCount++;
      } else {
        severity = "warning"; // NPC对话 - 警告级别
        npcCount++;
      }

      qualityIssues.push({
        type: "style_issue",
        severity,
        description: `[${issue.type}] ${issue.problem}`,
        location: `第${issue.line}行: "${issue.match.substring(0, 50)}..."`,
        suggestion: issue.suggestion,
      });
    }

    // 记录日志
    if (qualityIssues.length > 0) {
      this.logger.warn(
        `[QualityGate] NarrativeCraft detected ${qualityIssues.length} issues: ` +
          `endings=${endingCount}, preach=${preachCount}, npc=${npcCount}, ` +
          `score=${report.score}, passed=${report.passed}`,
      );
    }

    return qualityIssues;
  }

  /**
   * 检测重复表达
   */
  private detectRepetitions(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // 检测高频重复词
    const phrases = content.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
    const freqMap = new Map<string, number>();

    for (const phrase of phrases) {
      freqMap.set(phrase, (freqMap.get(phrase) || 0) + 1);
    }

    // 找出重复超过5次的词
    for (const [phrase, count] of freqMap) {
      if (count >= 5 && phrase.length >= 3) {
        issues.push({
          type: "repetition",
          severity: count >= 10 ? "error" : "warning",
          description: `表达 "${phrase}" 重复出现 ${count} 次`,
          suggestion: `请使用多样化的表达替换部分 "${phrase}"`,
        });
      }
    }

    return issues;
  }

  /**
   * 检测情节模式问题
   */
  private async detectPlotPatternIssues(
    projectId: string,
    content: string,
  ): Promise<QualityIssue[]> {
    const issues: QualityIssue[] = [];

    // 检测常见模式关键词
    const commonPatterns = [
      { keywords: ["偷听", "隔墙有耳", "暗中观察"], name: "偷听秘密" },
      { keywords: ["深夜", "夜访", "月下"], name: "深夜密会" },
      { keywords: ["昏迷", "晕倒", "不省人事"], name: "昏迷情节" },
      { keywords: ["误会", "误解", "以为"], name: "误会情节" },
      { keywords: ["巧合", "恰好", "正巧"], name: "巧合推进" },
    ];

    for (const pattern of commonPatterns) {
      const matches = pattern.keywords.filter((k) => content.includes(k));
      if (matches.length >= 2) {
        // 检查是否在冷却期
        const existing = await this.prisma.writingPlotPattern.findFirst({
          where: {
            projectId,
            patternName: pattern.name,
            isCoolingDown: true,
          },
        });

        if (existing) {
          issues.push({
            type: "plot_pattern",
            severity: "warning",
            description: `情节模式 "${pattern.name}" 近期已使用过`,
            suggestion: `请考虑使用不同的情节推进方式`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * 检测风格问题
   */
  private detectStyleIssues(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // 检测现代词汇（对于古风小说）
    const modernWords = [
      "OK",
      "好的",
      "没问题",
      "搞定",
      "靠谱",
      "给力",
      "牛逼",
      "尴尬",
    ];

    for (const word of modernWords) {
      if (content.includes(word)) {
        issues.push({
          type: "style_issue",
          severity: "warning",
          description: `出现现代词汇 "${word}"，可能与古风设定不符`,
          suggestion: `请使用符合时代背景的表达`,
        });
      }
    }

    // 检测过度使用的句式
    const exclamations = (content.match(/！/g) || []).length;
    const sentences = content.split(/[。！？]/).filter((s) => s.trim()).length;

    // ★ 防止除零：至少有 1 个句子时才检查
    if (sentences > 0 && exclamations / sentences > 0.3) {
      issues.push({
        type: "style_issue",
        severity: "info",
        description: "感叹号使用频率偏高",
        suggestion: "适当减少感叹号，使用其他方式表达情绪",
      });
    }

    return issues;
  }

  // ==================== 门禁判断 ====================

  /**
   * 检查硬性门禁
   *
   * ★★★ 重要修复：增加叙事工艺错误检查 ★★★
   * 之前的 bug：checkHardGate 只检查 diversityScore 和 characterConsistency，
   * 即使检测到严重的结尾问题、说教模式等，也不会触发重写。
   */
  private checkHardGate(
    scores: QualityScoreResult,
    personalityResult: PersonalityConsistencyResult,
    issues: QualityIssue[] = [],
  ): boolean {
    const { hard } = this.config;

    // 多样性必须达标
    if (scores.diversityScore < hard.minDiversityScore) {
      this.logger.warn(
        `[QualityGate] Hard gate failed: diversity ${scores.diversityScore} < ${hard.minDiversityScore}`,
      );
      return false;
    }

    // 角色一致性必须达标
    if (personalityResult.score < hard.minCharacterConsistency) {
      this.logger.warn(
        `[QualityGate] Hard gate failed: character consistency ${personalityResult.score} < ${hard.minCharacterConsistency}`,
      );
      return false;
    }

    // ★★★ 智能叙事工艺检查：结尾问题必须修复，AI cliche 有阈值 ★★★
    const endingIssues = issues.filter(
      (issue) =>
        issue.severity === "error" &&
        issue.type === "style_issue" &&
        issue.description.includes("[ending]"),
    );

    // 结尾问题：必须修复
    if (endingIssues.length > 0) {
      this.logger.warn(
        `[QualityGate] Hard gate failed: ${endingIssues.length} ending issues`,
      );
      return false;
    }

    // AI cliche/preach 问题：超过阈值才触发重写（避免少量问题导致无限循环）
    const preachIssues = issues.filter(
      (issue) =>
        issue.severity === "error" &&
        issue.type === "style_issue" &&
        issue.description.includes("[preach]"),
    );

    // 超过5个 preach 问题才触发 hard gate 失败
    if (preachIssues.length > 5) {
      this.logger.warn(
        `[QualityGate] Hard gate failed: ${preachIssues.length} preach issues (threshold: 5)`,
      );
      return false;
    } else if (preachIssues.length > 0) {
      this.logger.log(
        `[QualityGate] ${preachIssues.length} preach issues detected (under threshold, accepted)`,
      );
    }

    // ★ 新增：表达冷却违规检查
    // 如果使用了过多冷却中的表达，也应该触发重写
    const expressionViolations = issues.filter(
      (issue) => issue.severity === "error" && issue.type === "repetition",
    );

    if (expressionViolations.length >= 5) {
      this.logger.warn(
        `[QualityGate] Hard gate failed: ${expressionViolations.length} repetition errors`,
      );
      return false;
    }

    return true;
  }

  /**
   * 检查软性门禁
   */
  private checkSoftGate(scores: QualityScoreResult): boolean {
    const { soft } = this.config;

    // 软性门禁只记录警告，不阻止通过
    if (scores.plotNovelty < soft.minPlotNovelty) {
      this.logger.warn(
        `[QualityGate] Soft gate warning: plot novelty ${scores.plotNovelty} < ${soft.minPlotNovelty}`,
      );
    }

    if (scores.narrativeFlow < soft.minNarrativeFlow) {
      this.logger.warn(
        `[QualityGate] Soft gate warning: narrative flow ${scores.narrativeFlow} < ${soft.minNarrativeFlow}`,
      );
    }

    return true;
  }

  // ==================== 重写建议 ====================

  /**
   * 生成重写建议
   */
  private generateRewriteSuggestions(
    scores: QualityScoreResult,
    issues: QualityIssue[],
  ): string[] {
    const suggestions: string[] = [];

    // 根据评分生成建议
    if (scores.vocabularyRichness < 0.5) {
      suggestions.push("词汇过于单一，请使用更丰富的词汇表达");
    }

    if (scores.sentenceVariety < 0.5) {
      suggestions.push("句式变化不足，请调整句子长度和结构");
    }

    if (scores.expressionNovelty < 0.5) {
      suggestions.push("存在较多重复表达，请参考禁用列表替换");
    }

    if (scores.characterConsistency < 0.7) {
      suggestions.push("角色对话不符合人格设定，请调整对话内容");
    }

    // 根据问题生成建议
    const errors = issues.filter((i) => i.severity === "error");
    for (const error of errors.slice(0, 3)) {
      if (error.suggestion) {
        suggestions.push(error.suggestion);
      }
    }

    return suggestions;
  }

  // ==================== 数据持久化 ====================

  /**
   * 保存质量评分
   */
  private async saveQualityScore(
    projectId: string,
    chapterId: string,
    scores: QualityScoreResult,
    issues: QualityIssue[],
    passedGate: boolean,
    rewriteCount: number,
  ): Promise<void> {
    // 先检查是否已存在记录，避免重复创建
    const existing = await this.prisma.writingQualityScore.findFirst({
      where: { projectId, chapterId },
    });

    const scoreData = {
      diversityScore: scores.diversityScore,
      vocabularyRichness: scores.vocabularyRichness,
      sentenceVariety: scores.sentenceVariety,
      expressionNovelty: scores.expressionNovelty,
      characterConsistency: scores.characterConsistency,
      dialogueAuthenticity: scores.dialogueAuthenticity,
      plotNovelty: scores.plotNovelty,
      narrativeFlow: scores.narrativeFlow,
      settingAccuracy: scores.settingAccuracy,
      overallScore: scores.overallScore,
      issues: issues as unknown as object,
      passedGate,
      rewriteCount,
    };

    if (existing) {
      // 更新现有记录
      await this.prisma.writingQualityScore.update({
        where: { id: existing.id },
        data: scoreData,
      });
    } else {
      // 创建新记录
      await this.prisma.writingQualityScore.create({
        data: {
          projectId,
          chapterId,
          ...scoreData,
        },
      });
    }
  }

  /**
   * 记录质量问题模式
   */
  async recordIssuePattern(
    projectId: string | null,
    issueType: string,
    patternDesc: string,
    examples: string[],
  ): Promise<void> {
    const existing = await this.prisma.writingQualityIssuePattern.findFirst({
      where: {
        projectId,
        issueType,
        patternDesc,
      },
    });

    if (existing) {
      await this.prisma.writingQualityIssuePattern.update({
        where: { id: existing.id },
        data: {
          occurrenceCount: existing.occurrenceCount + 1,
          examples: [...existing.examples, ...examples].slice(-10),
        },
      });
    } else {
      await this.prisma.writingQualityIssuePattern.create({
        data: {
          projectId,
          issueType,
          patternDesc,
          examples,
        },
      });
    }
  }

  // ==================== 配置管理 ====================

  /**
   * 更新质量门禁配置
   */
  updateConfig(config: Partial<QualityGateConfig>): void {
    if (config.hard) {
      this.config.hard = { ...this.config.hard, ...config.hard };
    }
    if (config.soft) {
      this.config.soft = { ...this.config.soft, ...config.soft };
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): QualityGateConfig {
    return { ...this.config };
  }
}
