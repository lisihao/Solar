/**
 * ChapterQualityEvaluatorService - 章节质量评估服务
 *
 * 核心职责：
 * - 多维度评估章节质量（文字、内容、一致性）
 * - 提供具体的改进建议
 * - 追踪评估成本（Token、时间）
 *
 * 评估维度：
 * 1. 文字质量 (Writing Quality)
 *    - 句式流畅度、描写生动性、对话自然度、节奏把控
 * 2. 内容质量 (Content Quality)
 *    - 开篇吸引力、情节推进、人物塑造、情感共鸣
 * 3. 一致性 (Consistency)
 *    - 人物一致、时间线一致、世界观一致
 * 4. 成本追踪 (Cost Tracking)
 *    - Token 消耗、API 调用次数、处理时间
 */

import { Injectable, Logger } from "@nestjs/common";

// ==================== 类型定义 ====================

export interface QualityDimension {
  /** 维度名称 */
  name: string;
  /** 分数 0-100 */
  score: number;
  /** 权重 0-1 */
  weight: number;
  /** 具体问题 */
  issues: string[];
  /** 改进建议 */
  suggestions: string[];
}

export interface WritingQualityMetrics {
  /** 句式流畅度 */
  sentenceFluency: QualityDimension;
  /** 描写生动性 */
  descriptionVividness: QualityDimension;
  /** 对话自然度 */
  dialogueNaturalness: QualityDimension;
  /** 节奏把控 */
  pacingControl: QualityDimension;
}

export interface ContentQualityMetrics {
  /** 开篇吸引力 */
  openingHook: QualityDimension;
  /** 情节推进 */
  plotProgression: QualityDimension;
  /** 人物塑造 */
  characterDepiction: QualityDimension;
  /** 情感共鸣 */
  emotionalResonance: QualityDimension;
  /** 结尾质量（新增） */
  endingQuality: QualityDimension;
}

export interface ConsistencyMetrics {
  /** 人物一致性 */
  characterConsistency: QualityDimension;
  /** 时间线一致性 */
  timelineConsistency: QualityDimension;
  /** 世界观一致性 */
  worldConsistency: QualityDimension;
}

export interface CostMetrics {
  /** Token 消耗 */
  tokensUsed: number;
  /** API 调用次数 */
  apiCalls: number;
  /** 处理时间（毫秒） */
  processingTimeMs: number;
  /** 估算成本（美元） */
  estimatedCostUsd: number;
}

export interface ChapterQualityReport {
  /** 章节号 */
  chapterNumber: number;
  /** 总分 0-100 */
  overallScore: number;
  /** 质量等级 */
  grade: "A" | "B" | "C" | "D" | "F";
  /** 是否通过最低标准 */
  passed: boolean;
  /** 文字质量 */
  writingQuality: WritingQualityMetrics;
  /** 内容质量 */
  contentQuality: ContentQualityMetrics;
  /** 一致性 */
  consistency: ConsistencyMetrics;
  /** 成本统计 */
  cost: CostMetrics;
  /** 关键改进点（优先级排序） */
  prioritizedImprovements: Array<{
    dimension: string;
    issue: string;
    suggestion: string;
    impact: "high" | "medium" | "low";
  }>;
  /** 评估时间 */
  evaluatedAt: Date;
}

// ==================== 评估标准 ====================

const QUALITY_STANDARDS = {
  // 最低通过分数
  passingScore: 60,

  // 各维度权重（总和应为 1.0）
  weights: {
    writingQuality: 0.35,
    contentQuality: 0.35,
    consistency: 0.3,
  },

  // 子维度权重
  writingWeights: {
    sentenceFluency: 0.25,
    descriptionVividness: 0.3,
    dialogueNaturalness: 0.25,
    pacingControl: 0.2,
  },

  contentWeights: {
    openingHook: 0.25,
    plotProgression: 0.2,
    characterDepiction: 0.2,
    emotionalResonance: 0.15,
    endingQuality: 0.2, // 结尾质量权重提升
  },

  consistencyWeights: {
    characterConsistency: 0.4,
    timelineConsistency: 0.3,
    worldConsistency: 0.3,
  },

  // 等级划分
  gradeThresholds: {
    A: 85,
    B: 70,
    C: 60,
    D: 40,
    F: 0,
  },
};

// ==================== 服务实现 ====================

@Injectable()
export class ChapterQualityEvaluatorService {
  private readonly logger = new Logger(ChapterQualityEvaluatorService.name);

  /**
   * 快速评估（基于规则，不调用 LLM）
   * 用于实时反馈，成本为零
   */
  quickEvaluate(
    content: string,
    chapterNumber: number,
  ): Partial<ChapterQualityReport> {
    const startTime = Date.now();

    const writingQuality = this.evaluateWritingQualityByRules(content);
    const contentQuality = this.evaluateContentQualityByRules(
      content,
      chapterNumber,
    );

    // 计算总分
    const writingScore = this.calculateWeightedScore(
      writingQuality as unknown as Record<string, QualityDimension>,
      QUALITY_STANDARDS.writingWeights,
    );
    const contentScore = this.calculateWeightedScore(
      contentQuality as unknown as Record<string, QualityDimension>,
      QUALITY_STANDARDS.contentWeights,
    );

    this.logger.debug(
      `Chapter ${chapterNumber} quick evaluation: writing=${writingScore.toFixed(1)}, content=${contentScore.toFixed(1)}`,
    );

    const overallScore = Math.round(
      writingScore * QUALITY_STANDARDS.weights.writingQuality +
        contentScore * QUALITY_STANDARDS.weights.contentQuality +
        70 * QUALITY_STANDARDS.weights.consistency, // 一致性默认 70，需要 LLM 评估
    );

    return {
      chapterNumber,
      overallScore,
      grade: this.scoreToGrade(overallScore),
      passed: overallScore >= QUALITY_STANDARDS.passingScore,
      writingQuality,
      contentQuality,
      cost: {
        tokensUsed: 0,
        apiCalls: 0,
        processingTimeMs: Date.now() - startTime,
        estimatedCostUsd: 0,
      },
      evaluatedAt: new Date(),
    };
  }

  /**
   * 基于规则评估文字质量
   */
  private evaluateWritingQualityByRules(
    content: string,
  ): WritingQualityMetrics {
    // 1. 句式流畅度
    const sentences = content.split(/[。！？]/);
    const avgSentenceLength =
      sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;

    const sentenceFluencyIssues: string[] = [];
    const sentenceFluencySuggestions: string[] = [];

    // 检查句子长度变化
    const sentenceLengths = sentences.map((s) => s.length);
    const lengthVariance = this.calculateVariance(sentenceLengths);

    if (lengthVariance < 50) {
      sentenceFluencyIssues.push("句子长度过于一致，缺乏节奏变化");
      sentenceFluencySuggestions.push("交替使用长短句，创造节奏感");
    }

    if (avgSentenceLength > 50) {
      sentenceFluencyIssues.push("句子平均长度过长，可能影响阅读流畅度");
      sentenceFluencySuggestions.push("将长句拆分，每句控制在30字以内");
    }

    // 检查连续短句
    const shortSentenceStreak = this.findMaxStreak(
      sentenceLengths,
      (len) => len < 10,
    );
    if (shortSentenceStreak > 5) {
      sentenceFluencyIssues.push(
        `连续${shortSentenceStreak}个短句，节奏过于急促`,
      );
      sentenceFluencySuggestions.push("在连续短句中插入中等长度的句子");
    }

    const sentenceFluencyScore = Math.max(
      0,
      100 - sentenceFluencyIssues.length * 15,
    );

    // 2. 描写生动性
    const descriptionIssues: string[] = [];
    const descriptionSuggestions: string[] = [];

    // 检查五感描写
    const sensePatterns = {
      visual: /看|望|见|瞧|注视|目光|色|光|影|形/g,
      auditory: /听|闻|声|响|嘈|静|默/g,
      tactile: /触|摸|碰|握|抓|冷|热|滑|糙/g,
      olfactory: /嗅|闻|香|臭|味|气息/g,
      gustatory: /尝|吃|喝|甜|苦|咸|辣|酸/g,
    };

    const senseCount = Object.values(sensePatterns).filter(
      (pattern) => (content.match(pattern) || []).length > 0,
    ).length;

    if (senseCount < 3) {
      descriptionIssues.push(`仅使用了${senseCount}种感官描写，缺乏立体感`);
      descriptionSuggestions.push("增加触觉、听觉、嗅觉等多感官描写");
    }

    // 检查动作动词密度
    const actionVerbs = /冲|跑|跳|走|转|抬|落|挥|握|推|拉|按|敲/g;
    const actionCount = (content.match(actionVerbs) || []).length;
    const actionDensity = actionCount / (content.length / 1000);

    if (actionDensity < 3) {
      descriptionIssues.push("动作描写不足，场景偏静态");
      descriptionSuggestions.push("增加人物动作，用行动代替静态描写");
    }

    const descriptionScore = Math.max(0, 100 - descriptionIssues.length * 20);

    // 3. 对话自然度
    const dialogueIssues: string[] = [];
    const dialogueSuggestions: string[] = [];

    const dialogueMatches = content.match(/[「『""].*?[」』""]/g) || [];
    const dialogueRatio = dialogueMatches.join("").length / content.length;

    if (dialogueRatio < 0.1) {
      dialogueIssues.push("对话占比过低，叙述偏单调");
      dialogueSuggestions.push("增加角色对话，通过对话展现性格和推进情节");
    } else if (dialogueRatio > 0.6) {
      dialogueIssues.push("对话占比过高，缺乏叙述和描写");
      dialogueSuggestions.push("增加场景描写和心理活动");
    }

    // 检查对话长度
    const longDialogues = dialogueMatches.filter((d) => d.length > 100);
    if (longDialogues.length > 2) {
      dialogueIssues.push("存在多段过长的对话");
      dialogueSuggestions.push("将长对话拆分，插入动作和神态描写");
    }

    const dialogueScore = Math.max(0, 100 - dialogueIssues.length * 20);

    // 4. 节奏把控
    const pacingIssues: string[] = [];
    const pacingSuggestions: string[] = [];

    // 检查段落长度变化
    const paragraphs = content.split(/\n\n+/);
    const paragraphLengths = paragraphs.map((p) => p.length);
    const paragraphVariance = this.calculateVariance(paragraphLengths);

    if (paragraphVariance < 1000) {
      pacingIssues.push("段落长度过于一致，缺乏节奏变化");
      pacingSuggestions.push(
        "交替使用长段落（铺垫、描写）和短段落（冲突、转折）",
      );
    }

    const pacingScore = Math.max(0, 100 - pacingIssues.length * 25);

    return {
      sentenceFluency: {
        name: "句式流畅度",
        score: sentenceFluencyScore,
        weight: QUALITY_STANDARDS.writingWeights.sentenceFluency,
        issues: sentenceFluencyIssues,
        suggestions: sentenceFluencySuggestions,
      },
      descriptionVividness: {
        name: "描写生动性",
        score: descriptionScore,
        weight: QUALITY_STANDARDS.writingWeights.descriptionVividness,
        issues: descriptionIssues,
        suggestions: descriptionSuggestions,
      },
      dialogueNaturalness: {
        name: "对话自然度",
        score: dialogueScore,
        weight: QUALITY_STANDARDS.writingWeights.dialogueNaturalness,
        issues: dialogueIssues,
        suggestions: dialogueSuggestions,
      },
      pacingControl: {
        name: "节奏把控",
        score: pacingScore,
        weight: QUALITY_STANDARDS.writingWeights.pacingControl,
        issues: pacingIssues,
        suggestions: pacingSuggestions,
      },
    };
  }

  /**
   * 基于规则评估内容质量
   */
  private evaluateContentQualityByRules(
    content: string,
    chapterNumber: number,
  ): ContentQualityMetrics {
    // 1. 开篇吸引力
    const openingIssues: string[] = [];
    const openingSuggestions: string[] = [];

    const firstParagraph = content.split(/\n\n+/)[0] || "";
    const first100Chars = content.slice(0, 100);

    // 检查开篇是否有钩子
    const hookPatterns = /[！？]|危|死|血|秘|谁|为何|怎么|突然|忽然|猛然|骤然/;
    if (!hookPatterns.test(first100Chars)) {
      openingIssues.push("开篇缺乏钩子，未能立即抓住读者");
      openingSuggestions.push("用冲突、悬念或感官冲击开场");
    }

    // 第一章特别检查
    if (chapterNumber === 1) {
      // 检查是否有背景铺垫过多的问题
      const backgroundPatterns = /曾经|从前|在.*之前|历史上|据说/g;
      const backgroundCount = (firstParagraph.match(backgroundPatterns) || [])
        .length;
      if (backgroundCount > 2) {
        openingIssues.push("第一章开篇背景铺垫过多");
        openingSuggestions.push("从具体场景或冲突切入，背景信息融入后续情节");
      }
    }

    const openingScore = Math.max(0, 100 - openingIssues.length * 30);

    // 2. 情节推进
    const plotIssues: string[] = [];
    const plotSuggestions: string[] = [];

    // 检查是否有转折或冲突
    const conflictPatterns = /但是|然而|却|可是|不料|没想到|竟然|突然|忽然/g;
    const conflictCount = (content.match(conflictPatterns) || []).length;

    if (conflictCount < 2) {
      plotIssues.push("情节缺乏转折，推进过于平淡");
      plotSuggestions.push("增加意外和转折，避免情节一路顺遂");
    }

    const plotScore = Math.max(0, 100 - plotIssues.length * 25);

    // 3. 人物塑造
    const characterIssues: string[] = [];
    const characterSuggestions: string[] = [];

    // 检查对话是否有个性
    const dialogueMatches = content.match(/[「『""].*?[」』""]/g) || [];
    if (dialogueMatches.length > 5) {
      // 检查对话是否过于相似
      const dialogueLengths = dialogueMatches.map((d) => d.length);
      const dialogueVariance = this.calculateVariance(dialogueLengths);
      if (dialogueVariance < 100) {
        characterIssues.push("不同角色对话风格过于相似");
        characterSuggestions.push("根据角色性格区分说话方式和语气");
      }
    }

    const characterScore = Math.max(0, 100 - characterIssues.length * 25);

    // 4. 情感共鸣
    const emotionIssues: string[] = [];
    const emotionSuggestions: string[] = [];

    // 检查情感词密度
    const emotionPatterns = /喜|怒|哀|乐|悲|惧|爱|恨|心|情|感|泪|笑|叹/g;
    const emotionCount = (content.match(emotionPatterns) || []).length;
    const emotionDensity = emotionCount / (content.length / 1000);

    if (emotionDensity < 5) {
      emotionIssues.push("情感表达不足，难以引起共鸣");
      emotionSuggestions.push("增加人物内心活动和情感反应");
    }

    const emotionScore = Math.max(0, 100 - emotionIssues.length * 25);

    // 5. 结尾质量（新增）
    const endingResult = this.evaluateEndingQuality(content);

    return {
      openingHook: {
        name: "开篇吸引力",
        score: openingScore,
        weight: QUALITY_STANDARDS.contentWeights.openingHook,
        issues: openingIssues,
        suggestions: openingSuggestions,
      },
      plotProgression: {
        name: "情节推进",
        score: plotScore,
        weight: QUALITY_STANDARDS.contentWeights.plotProgression,
        issues: plotIssues,
        suggestions: plotSuggestions,
      },
      characterDepiction: {
        name: "人物塑造",
        score: characterScore,
        weight: QUALITY_STANDARDS.contentWeights.characterDepiction,
        issues: characterIssues,
        suggestions: characterSuggestions,
      },
      emotionalResonance: {
        name: "情感共鸣",
        score: emotionScore,
        weight: QUALITY_STANDARDS.contentWeights.emotionalResonance,
        issues: emotionIssues,
        suggestions: emotionSuggestions,
      },
      endingQuality: endingResult,
    };
  }

  /**
   * 评估结尾质量
   * 检测"总结式结尾"等常见问题
   */
  private evaluateEndingQuality(content: string): QualityDimension {
    const endingIssues: string[] = [];
    const endingSuggestions: string[] = [];

    // 获取最后500字符用于结尾分析
    const ending = content.slice(-500);
    // 获取最后3行
    const lastLines = content
      .split("\n")
      .filter((l) => l.trim())
      .slice(-3);
    const lastLine = lastLines[lastLines.length - 1] || "";

    // 禁止模式检测库
    const ENDING_BAD_PATTERNS = [
      // 决心式
      { pattern: /心中燃起/, type: "心理总结", penalty: 25 },
      { pattern: /心中升起/, type: "心理总结", penalty: 25 },
      { pattern: /心底涌起/, type: "心理总结", penalty: 25 },
      { pattern: /一丝斗志/, type: "心理总结", penalty: 20 },
      { pattern: /一丝希望/, type: "心理总结", penalty: 20 },
      { pattern: /一丝决心/, type: "心理总结", penalty: 20 },
      { pattern: /暗暗发誓/, type: "决心宣言", penalty: 25 },
      { pattern: /下定决心/, type: "决心宣言", penalty: 25 },
      { pattern: /绝不放弃/, type: "决心宣言", penalty: 20 },
      { pattern: /绝不认输/, type: "决心宣言", penalty: 20 },
      { pattern: /绝不随波逐流/, type: "鸡汤宣言", penalty: 30 },
      { pattern: /牢牢握住.*命运/, type: "鸡汤宣言", penalty: 30 },
      { pattern: /找到.*一席之地/, type: "空洞目标", penalty: 25 },
      { pattern: /找到.*力量/, type: "空洞目标", penalty: 20 },
      { pattern: /掌控这一切/, type: "空洞目标", penalty: 25 },
      // 顿悟式
      { pattern: /她终于明白/, type: "顿悟总结", penalty: 25 },
      { pattern: /他终于明白/, type: "顿悟总结", penalty: 25 },
      { pattern: /此刻.*意识到/, type: "顿悟总结", penalty: 25 },
      { pattern: /这一刻.*知道/, type: "顿悟总结", penalty: 25 },
      // 预告式
      { pattern: /这一切.*只是开始/, type: "空洞预告", penalty: 30 },
      { pattern: /风暴即将来临/, type: "空洞预告", penalty: 25 },
      { pattern: /命运的齿轮/, type: "空洞预告", penalty: 25 },
      { pattern: /新的篇章/, type: "空洞预告", penalty: 20 },
      { pattern: /未来.*方向.*明朗/, type: "空洞预告", penalty: 25 },
      // 旁白总结式
      { pattern: /距离.*逐渐拉近/, type: "旁白总结", penalty: 25 },
      { pattern: /关系.*更进一步/, type: "旁白总结", penalty: 20 },
      { pattern: /就这样/, type: "陈述总结", penalty: 15 },
      { pattern: /至此/, type: "陈述总结", penalty: 15 },
      // 使命宣言式
      { pattern: /只要她能/, type: "使命宣言", penalty: 20 },
      { pattern: /只要他能/, type: "使命宣言", penalty: 20 },
      { pattern: /既然命运/, type: "使命宣言", penalty: 25 },
      { pattern: /她要在这.*中/, type: "使命宣言", penalty: 20 },
      { pattern: /书写.*篇章/, type: "使命宣言", penalty: 25 },
    ];

    let totalPenalty = 0;

    // 检测结尾禁止模式
    for (const { pattern, type, penalty } of ENDING_BAD_PATTERNS) {
      if (pattern.test(ending)) {
        endingIssues.push(`结尾使用了"${type}"模式`);
        totalPenalty += penalty;
      }
    }

    // 检测结尾是否为对话或动作（好的结尾）
    const goodEndingPatterns = {
      dialogue: /[「『""].*[」』""]$/, // 以对话结尾
      action: /[了着过]。$/, // 以动作结尾
      sensory: /[声音色味气].*[了着]。$/, // 以感官结尾
      question: /[？?]$/, // 以问题结尾
    };

    const hasGoodEnding = Object.values(goodEndingPatterns).some((p) =>
      p.test(lastLine),
    );

    if (!hasGoodEnding && endingIssues.length === 0) {
      // 没有明确的好结尾也没有检测到坏模式，给予中等评价
      endingIssues.push("结尾缺乏悬念或具体动作");
      totalPenalty += 15;
    }

    // 生成建议
    if (endingIssues.length > 0) {
      endingSuggestions.push("用对话悬念、动作定格或感官细节结尾");
      endingSuggestions.push("避免心理总结和决心宣言");
      endingSuggestions.push("参考示例：'门被轻轻带上，脚步声渐行渐远。'");
    }

    const endingScore = Math.max(0, 100 - totalPenalty);

    return {
      name: "结尾质量",
      score: endingScore,
      weight: QUALITY_STANDARDS.contentWeights.endingQuality,
      issues: endingIssues,
      suggestions: endingSuggestions,
    };
  }

  /**
   * 计算加权分数
   */
  private calculateWeightedScore(
    metrics: Record<string, QualityDimension>,
    weights: Record<string, number>,
  ): number {
    let totalScore = 0;
    let totalWeight = 0;

    for (const [key, dimension] of Object.entries(metrics)) {
      const weight = weights[key] || 0;
      totalScore += dimension.score * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * 分数转等级
   */
  private scoreToGrade(score: number): "A" | "B" | "C" | "D" | "F" {
    const thresholds = QUALITY_STANDARDS.gradeThresholds;
    if (score >= thresholds.A) return "A";
    if (score >= thresholds.B) return "B";
    if (score >= thresholds.C) return "C";
    if (score >= thresholds.D) return "D";
    return "F";
  }

  /**
   * 计算方差
   */
  private calculateVariance(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    return (
      numbers.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) /
      numbers.length
    );
  }

  /**
   * 找最大连续符合条件的数量
   */
  private findMaxStreak(
    numbers: number[],
    condition: (n: number) => boolean,
  ): number {
    let maxStreak = 0;
    let currentStreak = 0;

    for (const n of numbers) {
      if (condition(n)) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    return maxStreak;
  }

  /**
   * 生成质量评估摘要
   */
  generateSummary(report: Partial<ChapterQualityReport>): string {
    const parts: string[] = [];

    parts.push(`## 第${report.chapterNumber}章质量评估报告\n`);
    parts.push(
      `**总分**: ${report.overallScore}/100 (${report.grade}级) ${report.passed ? "✓ 通过" : "✗ 未通过"}\n`,
    );

    if (report.writingQuality) {
      parts.push(`\n### 文字质量`);
      for (const [, dimension] of Object.entries(report.writingQuality)) {
        if (dimension.issues.length > 0) {
          parts.push(`- **${dimension.name}** (${dimension.score}分)`);
          for (const issue of dimension.issues) {
            parts.push(`  - ⚠️ ${issue}`);
          }
        }
      }
    }

    if (report.contentQuality) {
      parts.push(`\n### 内容质量`);
      for (const [, dimension] of Object.entries(report.contentQuality)) {
        if (dimension.issues.length > 0) {
          parts.push(`- **${dimension.name}** (${dimension.score}分)`);
          for (const issue of dimension.issues) {
            parts.push(`  - ⚠️ ${issue}`);
          }
        }
      }
    }

    if (report.cost) {
      parts.push(`\n### 评估成本`);
      parts.push(`- 处理时间: ${report.cost.processingTimeMs}ms`);
      parts.push(`- Token消耗: ${report.cost.tokensUsed}`);
      parts.push(`- API调用: ${report.cost.apiCalls}次`);
    }

    return parts.join("\n");
  }
}
