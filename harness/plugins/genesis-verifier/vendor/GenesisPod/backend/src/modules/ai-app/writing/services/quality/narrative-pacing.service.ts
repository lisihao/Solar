/**
 * NarrativePacingService - 叙事节奏控制服务
 *
 * 核心职责：
 * - 追踪主角行动频率，防止"观望型"章节过多
 * - 检测章节开场多样性
 * - 确保情节推进不停滞
 * - 为 Writer Agent 提供节奏约束
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

// ==================== 常量配置 ====================

/**
 * 叙事节奏配置
 */
const NARRATIVE_PACING_CONFIG = {
  /** 允许的最大连续被动章节数 */
  maxConsecutivePassiveChapters: 2,
  /** 章节开场类型冷却章节数 */
  chapterOpeningTypeCooldown: 5,
  /** 主角行动检测的关键词 */
  protagonistActionKeywords: [
    "决定",
    "选择",
    "做出",
    "采取",
    "主动",
    "开口",
    "出手",
    "行动",
    "计划",
    "布置",
    "安排",
    "吩咐",
    "命令",
    "指示",
    "反击",
    "还击",
    "回应",
    "反驳",
    "质问",
    "追问",
  ],
  /** 被动观察的关键词 */
  passiveObservationKeywords: [
    "只能看着",
    "默默注视",
    "静静地",
    "无能为力",
    "只得",
    "只好",
    "不敢",
    "不能",
    "无法",
    "束手无策",
    "袖手旁观",
  ],
} as const;

/**
 * 章节开场类型
 */
export type ChapterOpeningType =
  | "SCENE_DESCRIPTION" // 场景描写开场
  | "DIALOGUE" // 对话开场
  | "ACTION" // 动作开场
  | "INNER_THOUGHT" // 心理独白开场
  | "TIME_SKIP" // 时间跳跃开场
  | "FLASHBACK" // 回忆开场
  | "CLIFFHANGER_CONTINUATION"; // 悬念延续

// ==================== 类型定义 ====================

export interface ChapterPacingAnalysis {
  /** 主角是否有主动行动 */
  hasProtagonistAction: boolean;
  /** 检测到的行动关键词 */
  actionKeywords: string[];
  /** 检测到的被动关键词 */
  passiveKeywords: string[];
  /** 章节开场类型 */
  openingType: ChapterOpeningType;
  /** 是否为被动章节 */
  isPassiveChapter: boolean;
  /** 节奏评分 (0-1) */
  pacingScore: number;
}

export interface PacingConstraints {
  /** 是否需要强制主角行动 */
  forceProtagonistAction: boolean;
  /** 连续被动章节数 */
  consecutivePassiveCount: number;
  /** 建议避免的开场类型 */
  avoidOpeningTypes: ChapterOpeningType[];
  /** 建议的开场类型 */
  suggestedOpeningTypes: ChapterOpeningType[];
  /** 节奏提示词 */
  pacingPrompt: string;
}

// ==================== 服务实现 ====================

@Injectable()
export class NarrativePacingService {
  private readonly logger = new Logger(NarrativePacingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================== 核心分析方法 ====================

  /**
   * 分析章节的叙事节奏
   */
  analyzeChapterPacing(content: string): ChapterPacingAnalysis {
    // 1. 检测主角行动
    const actionKeywords = this.detectActionKeywords(content);
    const passiveKeywords = this.detectPassiveKeywords(content);

    // 2. 判断章节开场类型
    const openingType = this.detectOpeningType(content);

    // 3. 计算节奏评分
    const hasProtagonistAction = actionKeywords.length > passiveKeywords.length;
    const isPassiveChapter =
      passiveKeywords.length > 3 && actionKeywords.length < 2;

    // 节奏评分：行动词越多越好，被动词越少越好
    const actionScore = Math.min(actionKeywords.length / 5, 1);
    const passivePenalty = Math.min(passiveKeywords.length / 5, 0.5);
    const pacingScore = Math.max(0, actionScore - passivePenalty + 0.3);

    return {
      hasProtagonistAction,
      actionKeywords,
      passiveKeywords,
      openingType,
      isPassiveChapter,
      pacingScore: Math.min(pacingScore, 1),
    };
  }

  /**
   * 获取写作前的节奏约束
   *
   * Writer Agent 在写作前调用此方法
   */
  async getPacingConstraints(
    projectId: string,
    currentChapterNumber: number,
  ): Promise<PacingConstraints> {
    // 1. 获取最近几章的分析结果
    const recentChapters = await this.getRecentChaptersAnalysis(
      projectId,
      currentChapterNumber,
      5,
    );

    // 2. 计算连续被动章节数
    let consecutivePassiveCount = 0;
    for (const analysis of recentChapters) {
      if (analysis.isPassiveChapter) {
        consecutivePassiveCount++;
      } else {
        break;
      }
    }

    // 3. 判断是否需要强制主角行动
    const forceProtagonistAction =
      consecutivePassiveCount >=
      NARRATIVE_PACING_CONFIG.maxConsecutivePassiveChapters;

    // 4. 获取最近的开场类型，建议避免重复
    const recentOpeningTypes = recentChapters
      .slice(0, NARRATIVE_PACING_CONFIG.chapterOpeningTypeCooldown)
      .map((a) => a.openingType);

    const allOpeningTypes: ChapterOpeningType[] = [
      "SCENE_DESCRIPTION",
      "DIALOGUE",
      "ACTION",
      "INNER_THOUGHT",
      "TIME_SKIP",
      "FLASHBACK",
      "CLIFFHANGER_CONTINUATION",
    ];

    const avoidOpeningTypes = recentOpeningTypes.filter(
      (type, index) => recentOpeningTypes.indexOf(type) === index,
    );

    const suggestedOpeningTypes = allOpeningTypes.filter(
      (type) => !avoidOpeningTypes.includes(type),
    );

    // 5. 生成节奏提示词
    const pacingPrompt = this.generatePacingPrompt(
      forceProtagonistAction,
      consecutivePassiveCount,
      avoidOpeningTypes,
      suggestedOpeningTypes,
    );

    return {
      forceProtagonistAction,
      consecutivePassiveCount,
      avoidOpeningTypes,
      suggestedOpeningTypes,
      pacingPrompt,
    };
  }

  // ==================== 记录方法 ====================

  /**
   * 记录章节的节奏分析结果
   *
   * 注意：当前版本不持久化存储，仅记录日志
   * 未来可扩展为写入专门的叙事节奏分析表
   */
  async recordChapterPacing(
    _projectId: string,
    _chapterId: string,
    chapterNumber: number,
    content: string,
  ): Promise<ChapterPacingAnalysis> {
    const analysis = this.analyzeChapterPacing(content);

    this.logger.log(
      `[NarrativePacing] Chapter ${chapterNumber}: ` +
        `action=${analysis.hasProtagonistAction}, ` +
        `passive=${analysis.isPassiveChapter}, ` +
        `score=${analysis.pacingScore.toFixed(2)}, ` +
        `opening=${analysis.openingType}`,
    );

    return analysis;
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 检测行动关键词
   */
  private detectActionKeywords(content: string): string[] {
    const found: string[] = [];
    for (const keyword of NARRATIVE_PACING_CONFIG.protagonistActionKeywords) {
      const regex = new RegExp(keyword, "g");
      const matches = content.match(regex);
      if (matches) {
        found.push(...matches);
      }
    }
    return found;
  }

  /**
   * 检测被动关键词
   */
  private detectPassiveKeywords(content: string): string[] {
    const found: string[] = [];
    for (const keyword of NARRATIVE_PACING_CONFIG.passiveObservationKeywords) {
      const regex = new RegExp(keyword, "g");
      const matches = content.match(regex);
      if (matches) {
        found.push(...matches);
      }
    }
    return found;
  }

  /**
   * 检测章节开场类型
   */
  private detectOpeningType(content: string): ChapterOpeningType {
    // 取前 200 字分析
    const opening = content.slice(0, 200);

    // 对话开场
    if (/^["「『]/.test(opening) || /^[^\n]{0,20}["「『]/.test(opening)) {
      return "DIALOGUE";
    }

    // 动作开场
    if (/^[^\n]{0,30}(走|跑|冲|闯|推开|踏入|来到)/.test(opening)) {
      return "ACTION";
    }

    // 心理独白开场
    if (/^[^\n]{0,30}(心中|心想|暗想|思绪|回想)/.test(opening)) {
      return "INNER_THOUGHT";
    }

    // 时间跳跃开场
    if (
      /^[^\n]{0,30}(三日后|数日|次日|翌日|过了|时隔|一月后|半年后)/.test(
        opening,
      )
    ) {
      return "TIME_SKIP";
    }

    // 回忆开场
    if (/^[^\n]{0,30}(记得|想起|回忆|往事|从前)/.test(opening)) {
      return "FLASHBACK";
    }

    // 悬念延续
    if (/^[^\n]{0,30}(就在此时|话音未落|正当|突然)/.test(opening)) {
      return "CLIFFHANGER_CONTINUATION";
    }

    // 默认：场景描写
    return "SCENE_DESCRIPTION";
  }

  /**
   * 获取最近章节的分析结果
   */
  private async getRecentChaptersAnalysis(
    projectId: string,
    currentChapterNumber: number,
    limit: number,
  ): Promise<ChapterPacingAnalysis[]> {
    // 查询最近几章的内容
    const chapters = await this.prisma.writingChapter.findMany({
      where: {
        volume: { projectId },
        chapterNumber: { lt: currentChapterNumber },
        content: { not: null },
      },
      orderBy: { chapterNumber: "desc" },
      take: limit,
      select: { content: true, chapterNumber: true },
    });

    // 分析每章的节奏
    return chapters.map((ch) => this.analyzeChapterPacing(ch.content || ""));
  }

  /**
   * 生成节奏提示词
   */
  private generatePacingPrompt(
    forceProtagonistAction: boolean,
    consecutivePassiveCount: number,
    avoidOpeningTypes: ChapterOpeningType[],
    suggestedOpeningTypes: ChapterOpeningType[],
  ): string {
    const parts: string[] = [];

    parts.push("## 叙事节奏约束\n");

    // 主角行动约束
    if (forceProtagonistAction) {
      parts.push(
        `⚠️ **强制要求**：前${consecutivePassiveCount}章主角过于被动，本章必须让主角采取主动行动！`,
      );
      parts.push("- 主角必须做出至少一个重要决策或行动");
      parts.push("- 避免让主角只是观察、等待、被动接受");
      parts.push("- 示例行动：制定计划、采取反击、主动试探、收集情报\n");
    } else if (consecutivePassiveCount > 0) {
      parts.push(
        `⚡ **建议**：前${consecutivePassiveCount}章主角行动较少，本章建议增加主角的主动性。`,
      );
    }

    // 开场类型约束
    if (avoidOpeningTypes.length > 0) {
      const typeLabels: Record<ChapterOpeningType, string> = {
        SCENE_DESCRIPTION: "场景描写",
        DIALOGUE: "对话",
        ACTION: "动作",
        INNER_THOUGHT: "心理独白",
        TIME_SKIP: "时间跳跃",
        FLASHBACK: "回忆",
        CLIFFHANGER_CONTINUATION: "悬念延续",
      };

      parts.push("### 章节开场多样性");
      parts.push(
        `- 避免使用：${avoidOpeningTypes.map((t) => typeLabels[t]).join("、")}`,
      );
      if (suggestedOpeningTypes.length > 0) {
        parts.push(
          `- 建议使用：${suggestedOpeningTypes.map((t) => typeLabels[t]).join("、")}`,
        );
      }
    }

    return parts.join("\n");
  }
}
