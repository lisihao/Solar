/**
 * PacingControlService - 叙事节奏控制服务
 *
 * 核心职责：
 * - 分析和控制章节叙事节奏
 * - 防止节奏单调（连续快节奏或慢节奏）
 * - 根据剧情阶段建议合适的节奏
 *
 * 设计理念（学习自头部网文）：
 * - 快节奏：战斗、追逐、危机 - 短句、密集动作、紧张对话
 * - 中节奏：日常、对话、探索 - 正常句式、适度描写
 * - 慢节奏：情感、回忆、铺垫 - 长句、细腻描写、内心戏
 *
 * 节奏规律：
 * - 高潮前必有铺垫（慢 → 快）
 * - 高潮后需要喘息（快 → 慢）
 * - 连续3章快节奏后强制插入慢节奏
 * - 每卷结尾节奏逐渐加快
 */

import { Injectable, Logger } from "@nestjs/common";

// ==================== 类型定义 ====================

export type PacingLevel = "fast" | "medium" | "slow";

export interface ChapterPacing {
  /** 章节号 */
  chapterNumber: number;
  /** 节奏类型 */
  pacing: PacingLevel;
  /** 章节类型 */
  chapterType?: string;
  /** 主要场景类型 */
  sceneTypes?: string[];
  /** 情绪基调 */
  emotionalTone?: string;
}

export interface PacingRecommendation {
  /** 推荐节奏 */
  recommendedPacing: PacingLevel;
  /** 推荐原因 */
  reason: string;
  /** 节奏指导 */
  guidance: string;
  /** 写作技巧 */
  techniques: string[];
  /** 禁忌 */
  forbidden: string[];
}

export interface PacingAnalysis {
  /** 当前节奏 */
  currentPacing: PacingLevel;
  /** 最近章节节奏 */
  recentPacings: ChapterPacing[];
  /** 是否需要节奏变化 */
  needsPacingChange: boolean;
  /** 推荐 */
  recommendation: PacingRecommendation;
}

// ==================== 节奏模板库 ====================

const PACING_TEMPLATES: Record<
  PacingLevel,
  {
    name: string;
    description: string;
    characteristics: string[];
    techniques: string[];
    sentenceStyle: string;
    forbidden: string[];
    exampleScenes: string[];
  }
> = {
  fast: {
    name: "快节奏",
    description: "紧张刺激，让读者屏息凝神",
    characteristics: [
      "句子短促有力",
      "动作密集",
      "对话简短",
      "时间压缩（一章可能只有几分钟的剧情）",
      "不断的危机和转折",
    ],
    techniques: [
      "使用短句（5-10字）",
      "动词为主，少用形容词",
      "对话不超过两句来回",
      "场景快速切换",
      "用动作代替描写",
      "悬念一个接一个",
    ],
    sentenceStyle:
      "短句为主，节奏明快。例：他转身。门开了。刀光闪过。血溅三尺。",
    forbidden: [
      "禁止大段心理描写",
      "禁止详细环境描写",
      "禁止长篇回忆",
      "禁止慢条斯理的对话",
    ],
    exampleScenes: ["战斗", "追逐", "逃亡", "对峙", "生死抉择"],
  },

  medium: {
    name: "中节奏",
    description: "张弛有度，推进剧情",
    characteristics: [
      "句式多样",
      "动作与描写平衡",
      "对话有来有回",
      "时间正常流逝",
      "情节稳步推进",
    ],
    techniques: [
      "长短句结合",
      "动作和描写交替",
      "对话推动剧情",
      "适当的环境描写",
      "角色互动自然",
    ],
    sentenceStyle: "长短结合，自然流畅。",
    forbidden: ["避免全是短句", "避免全是长句", "避免节奏太平"],
    exampleScenes: ["日常交流", "情报收集", "计划制定", "旅途", "调查"],
  },

  slow: {
    name: "慢节奏",
    description: "细腻深沉，让读者沉浸",
    characteristics: [
      "句子舒缓绵长",
      "大量细节描写",
      "深入内心世界",
      "时间放慢（一章可能只是一个场景）",
      "情感深度挖掘",
    ],
    techniques: [
      "使用长句（15-30字）",
      "五感描写细腻",
      "内心独白丰富",
      "回忆闪回",
      "象征和隐喻",
      "情绪层层递进",
    ],
    sentenceStyle: "长句为主，细腻悠长。注意用逗号切分，避免一口气读不完。",
    forbidden: ["禁止密集动作", "禁止快速场景切换", "禁止草草带过重要情感"],
    exampleScenes: ["情感告白", "生死离别", "回忆往事", "心理挣扎", "氛围铺垫"],
  },
};

// ==================== 剧情阶段节奏建议 ====================

const STORY_PHASE_PACING: Record<
  string,
  {
    recommendedPacing: PacingLevel;
    description: string;
  }
> = {
  // 开篇
  opening: {
    recommendedPacing: "fast",
    description: "开篇需要快速抓住读者，用冲突或悬念开场",
  },
  // 铺垫
  setup: {
    recommendedPacing: "medium",
    description: "铺垫阶段推进剧情，介绍人物关系和世界观",
  },
  // 发展
  rising: {
    recommendedPacing: "medium",
    description: "剧情发展，矛盾逐渐升级",
  },
  // 高潮前
  pre_climax: {
    recommendedPacing: "slow",
    description: "高潮前的宁静，暴风雨前的平静，积蓄情绪",
  },
  // 高潮
  climax: {
    recommendedPacing: "fast",
    description: "高潮需要快节奏，密集冲突和转折",
  },
  // 高潮后
  post_climax: {
    recommendedPacing: "slow",
    description: "高潮后需要喘息，处理情感和后续",
  },
  // 过渡
  transition: {
    recommendedPacing: "medium",
    description: "过渡章节，衔接两个情节点",
  },
  // 情感
  emotional: {
    recommendedPacing: "slow",
    description: "情感戏需要慢节奏，深入挖掘人物内心",
  },
};

// ==================== 服务实现 ====================

@Injectable()
export class PacingControlService {
  private readonly logger = new Logger(PacingControlService.name);

  // 内存存储（实际项目应该用数据库）
  private pacingHistory: Map<string, ChapterPacing[]> = new Map();

  /**
   * 记录章节节奏
   */
  recordChapterPacing(projectId: string, pacing: ChapterPacing): void {
    const history = this.pacingHistory.get(projectId) || [];

    // 更新或添加
    const existingIndex = history.findIndex(
      (p) => p.chapterNumber === pacing.chapterNumber,
    );
    if (existingIndex >= 0) {
      history[existingIndex] = pacing;
    } else {
      history.push(pacing);
      history.sort((a, b) => a.chapterNumber - b.chapterNumber);
    }

    this.pacingHistory.set(projectId, history);

    this.logger.log(
      `[Pacing] Recorded chapter ${pacing.chapterNumber} pacing: ${pacing.pacing}`,
    );
  }

  /**
   * 分析节奏并给出建议
   */
  analyzePacing(
    projectId: string,
    currentChapter: number,
    chapterType?: string,
    outline?: string,
  ): PacingAnalysis {
    const history = this.pacingHistory.get(projectId) || [];
    const recentPacings = history
      .filter((p) => p.chapterNumber < currentChapter)
      .slice(-5);

    // 判断是否需要节奏变化
    const needsPacingChange = this.checkNeedsPacingChange(recentPacings);

    // 获取推荐节奏
    const recommendation = this.getRecommendation(
      recentPacings,
      currentChapter,
      chapterType,
      outline,
      needsPacingChange,
    );

    return {
      currentPacing: recommendation.recommendedPacing,
      recentPacings,
      needsPacingChange,
      recommendation,
    };
  }

  /**
   * 检查是否需要节奏变化
   */
  private checkNeedsPacingChange(recentPacings: ChapterPacing[]): boolean {
    if (recentPacings.length < 3) {
      return false;
    }

    // 检查连续3章是否同一节奏
    const last3 = recentPacings.slice(-3);
    const allSame = last3.every((p) => p.pacing === last3[0].pacing);

    if (allSame) {
      this.logger.log(
        `[Pacing] Warning: 3 consecutive ${last3[0].pacing} chapters, need change`,
      );
      return true;
    }

    return false;
  }

  /**
   * 获取节奏推荐
   */
  private getRecommendation(
    recentPacings: ChapterPacing[],
    currentChapter: number,
    chapterType?: string,
    outline?: string,
    needsPacingChange?: boolean,
  ): PacingRecommendation {
    let recommendedPacing: PacingLevel = "medium";
    let reason = "";

    // 1. 根据章节类型判断
    if (chapterType) {
      const phase = this.detectStoryPhase(chapterType, outline);
      if (STORY_PHASE_PACING[phase]) {
        recommendedPacing = STORY_PHASE_PACING[phase].recommendedPacing;
        reason = STORY_PHASE_PACING[phase].description;
      }
    }

    // 2. 如果需要节奏变化，调整推荐
    if (needsPacingChange && recentPacings.length > 0) {
      const lastPacing = recentPacings[recentPacings.length - 1].pacing;
      if (lastPacing === "fast") {
        recommendedPacing = "slow";
        reason = "连续快节奏后需要放缓，给读者喘息空间";
      } else if (lastPacing === "slow") {
        recommendedPacing = "fast";
        reason = "连续慢节奏后需要加速，防止读者失去兴趣";
      }
    }

    // 3. 第一章特殊处理
    if (currentChapter === 1) {
      recommendedPacing = "fast";
      reason = "第一章必须快节奏，用冲突或悬念抓住读者";
    }

    const template = PACING_TEMPLATES[recommendedPacing];

    return {
      recommendedPacing,
      reason,
      guidance: this.buildPacingGuidance(recommendedPacing, currentChapter),
      techniques: template.techniques,
      forbidden: template.forbidden,
    };
  }

  /**
   * 检测剧情阶段
   */
  private detectStoryPhase(chapterType: string, outline?: string): string {
    const text = `${chapterType} ${outline || ""}`.toLowerCase();

    if (
      text.includes("高潮") ||
      text.includes("决战") ||
      text.includes("最终")
    ) {
      return "climax";
    }
    if (
      text.includes("铺垫") ||
      text.includes("准备") ||
      text.includes("暴风雨前")
    ) {
      return "pre_climax";
    }
    if (
      text.includes("结束") ||
      text.includes("善后") ||
      text.includes("高潮后")
    ) {
      return "post_climax";
    }
    if (text.includes("过渡") || text.includes("转场")) {
      return "transition";
    }
    if (
      text.includes("情感") ||
      text.includes("告白") ||
      text.includes("离别")
    ) {
      return "emotional";
    }
    if (text.includes("开篇") || text.includes("序章")) {
      return "opening";
    }

    return "rising";
  }

  /**
   * 构建节奏指导提示词
   */
  private buildPacingGuidance(
    pacing: PacingLevel,
    chapterNumber: number,
  ): string {
    const template = PACING_TEMPLATES[pacing];
    const parts: string[] = [];

    parts.push(`## 第${chapterNumber}章节奏指导：${template.name}\n`);
    parts.push(`**基调**：${template.description}\n`);

    parts.push(`### 特征`);
    template.characteristics.forEach((c) => {
      parts.push(`- ${c}`);
    });

    parts.push(`\n### 写作技巧`);
    template.techniques.forEach((t) => {
      parts.push(`- ${t}`);
    });

    parts.push(`\n### 句式风格`);
    parts.push(template.sentenceStyle);

    parts.push(`\n### 禁忌`);
    template.forbidden.forEach((f) => {
      parts.push(`- ❌ ${f}`);
    });

    parts.push(`\n### 适合场景`);
    parts.push(template.exampleScenes.join("、"));

    return parts.join("\n");
  }

  /**
   * 生成完整的节奏约束提示词
   */
  generatePacingConstraints(
    projectId: string,
    currentChapter: number,
    chapterType?: string,
    outline?: string,
  ): string {
    const analysis = this.analyzePacing(
      projectId,
      currentChapter,
      chapterType,
      outline,
    );

    const parts: string[] = [];

    parts.push(analysis.recommendation.guidance);

    if (analysis.needsPacingChange) {
      parts.push(`\n### ⚠️ 节奏调整提醒`);
      parts.push(analysis.recommendation.reason);
    }

    // 添加最近章节节奏信息
    if (analysis.recentPacings.length > 0) {
      parts.push(`\n### 最近章节节奏`);
      analysis.recentPacings.slice(-3).forEach((p) => {
        parts.push(
          `- 第${p.chapterNumber}章：${PACING_TEMPLATES[p.pacing].name}`,
        );
      });
    }

    return parts.join("\n");
  }

  /**
   * 分析内容节奏（用于后置检查）
   */
  analyzeContentPacing(content: string): {
    detectedPacing: PacingLevel;
    metrics: {
      avgSentenceLength: number;
      dialogueRatio: number;
      actionVerbDensity: number;
    };
  } {
    // 计算平均句子长度
    const sentences = content.split(/[。！？]/);
    const avgSentenceLength =
      sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;

    // 计算对话占比
    const dialogueMatches = content.match(/["「『].*?["」』]/g) || [];
    const dialogueRatio = dialogueMatches.join("").length / content.length;

    // 计算动作动词密度
    const actionVerbs = [
      "冲",
      "跑",
      "跳",
      "打",
      "踢",
      "砍",
      "刺",
      "挡",
      "躲",
      "闪",
      "追",
      "逃",
      "抓",
      "推",
      "拉",
      "扔",
    ];
    let actionCount = 0;
    for (const verb of actionVerbs) {
      const matches = content.match(new RegExp(verb, "g"));
      if (matches) actionCount += matches.length;
    }
    const actionVerbDensity = actionCount / (content.length / 1000);

    // 判断节奏
    let detectedPacing: PacingLevel = "medium";

    if (avgSentenceLength < 15 && actionVerbDensity > 5) {
      detectedPacing = "fast";
    } else if (avgSentenceLength > 25 && dialogueRatio < 0.2) {
      detectedPacing = "slow";
    }

    return {
      detectedPacing,
      metrics: {
        avgSentenceLength,
        dialogueRatio,
        actionVerbDensity,
      },
    };
  }
}
