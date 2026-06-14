/**
 * StoryCompletionDetectorService - 智能故事完结检测服务
 *
 * 基于 DOME 论文和业界最佳实践，提供多维度的故事完结检测：
 * - 文本标记检测：识别"全书完"、"大结局"等标记
 * - 剧情解决度分析：检查主要冲突是否解决
 * - 角色弧线完整度：检查角色成长/变化是否完整
 * - 叙事节奏分析：检测是否进入收尾节奏
 * - 字数达成度：与目标字数的比较
 *
 * 参考文献:
 * - DOME: Dynamic Hierarchical Outlining with Memory-Enhancement (NAACL 2025)
 * - SCORE: Story Coherence and Retrieval Enhancement (ArXiv 2025)
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

// ==================== 类型定义 ====================

/**
 * 完结信号类型
 */
export type CompletionSignalType =
  | "TEXT_MARKER" // 文本标记（全书完、大结局等）
  | "PLOT_RESOLUTION" // 剧情解决
  | "CHARACTER_ARC" // 角色弧线完成
  | "WORD_COUNT" // 字数达成
  | "PACING" // 叙事节奏
  | "CONFLICT_DENSITY"; // 冲突密度下降

/**
 * 完结信号
 */
export interface CompletionSignal {
  /** 信号类型 */
  type: CompletionSignalType;
  /** 描述 */
  description: string;
  /** 权重 (0-1) */
  weight: number;
  /** 置信度 (0-1) */
  confidence: number;
  /** 证据/来源 */
  evidence?: string;
}

/**
 * 完结分析结果
 */
export interface CompletionAnalysis {
  /** 是否完结 */
  isComplete: boolean;
  /** 总体置信度 (0-1) */
  confidence: number;
  /** 完结信号列表 */
  signals: CompletionSignal[];
  /** 推荐操作 */
  recommendation: "STOP" | "CONTINUE" | "ASK_USER";
  /** 推荐理由 */
  reason: string;
  /** 分析时间 */
  analyzedAt: string;
}

/**
 * 剧情解决度分析结果
 */
export interface PlotResolutionAnalysis {
  /** 主要冲突列表 */
  mainConflicts: {
    description: string;
    resolved: boolean;
    resolutionChapter?: number;
  }[];
  /** 解决比例 (0-1) */
  resolutionRatio: number;
  /** 主角目标达成情况 */
  protagonistGoalAchieved: boolean;
}

/**
 * 角色弧线分析结果
 */
export interface CharacterArcAnalysis {
  /** 角色弧线列表 */
  arcs: {
    characterName: string;
    arcType: "growth" | "fall" | "flat" | "transformation";
    isComplete: boolean;
    completionRatio: number;
  }[];
  /** 平均完成度 */
  averageCompletion: number;
}

/**
 * 叙事节奏分析结果
 */
export interface PacingAnalysis {
  /** 最近章节的冲突密度 */
  recentConflictDensity: number;
  /** 整体平均冲突密度 */
  averageConflictDensity: number;
  /** 是否进入收尾模式 */
  isWindingDown: boolean;
  /** 情节收敛程度 */
  convergenceLevel: number;
}

// ==================== 服务实现 ====================

@Injectable()
export class StoryCompletionDetectorService {
  private readonly logger = new Logger(StoryCompletionDetectorService.name);

  // 故事完结标记列表（按优先级排序）
  private readonly COMPLETION_MARKERS = [
    // 高置信度标记
    { marker: "全书完", confidence: 0.95 },
    { marker: "大结局", confidence: 0.95 },
    { marker: "（完）", confidence: 0.9 },
    { marker: "【完】", confidence: 0.9 },
    { marker: "（全文完）", confidence: 0.95 },
    { marker: "全剧终", confidence: 0.95 },
    { marker: "THE END", confidence: 0.9 },
    // 中置信度标记
    { marker: "——END——", confidence: 0.85 },
    { marker: "故事结束", confidence: 0.8 },
    { marker: "（终章）", confidence: 0.85 },
    { marker: "【终章】", confidence: 0.85 },
    { marker: "大同之世", confidence: 0.7 },
    // 低置信度标记（需要结合其他信号）
    { marker: "尾声", confidence: 0.5 },
    { marker: "后记", confidence: 0.5 },
    { marker: "番外", confidence: 0.3 },
  ];

  // 信号权重配置
  private readonly SIGNAL_WEIGHTS = {
    TEXT_MARKER: 0.35, // 文本标记权重最高
    PLOT_RESOLUTION: 0.25, // 剧情解决度
    CHARACTER_ARC: 0.15, // 角色弧线
    WORD_COUNT: 0.1, // 字数达成
    PACING: 0.1, // 叙事节奏
    CONFLICT_DENSITY: 0.05, // 冲突密度
  };

  // 完结判定阈值
  private readonly COMPLETION_THRESHOLD = 0.65;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * 分析故事是否完结
   */
  async analyzeCompletion(projectId: string): Promise<CompletionAnalysis> {
    this.logger.log(`Analyzing story completion for project ${projectId}`);

    const signals: CompletionSignal[] = [];

    // 获取项目信息
    const project = await this.prisma.writingProject.findUnique({
      where: { id: projectId },
      include: {
        storyBible: {
          include: {
            characters: true,
            timelineEvents: true,
          },
        },
        volumes: {
          include: {
            chapters: {
              orderBy: { chapterNumber: "asc" },
            },
          },
        },
      },
    });

    if (!project) {
      return this.createDefaultAnalysis(false, "项目不存在");
    }

    // 获取所有章节
    const allChapters = project.volumes.flatMap((v) => v.chapters);
    const writtenChapters = allChapters.filter(
      (c) => c.content && c.content.length > 0,
    );

    if (writtenChapters.length === 0) {
      return this.createDefaultAnalysis(false, "尚无已写章节");
    }

    // 1. 检测文本标记
    const textMarkerSignal = await this.detectTextMarkers(writtenChapters);
    if (textMarkerSignal) {
      signals.push(textMarkerSignal);
    }

    // 2. 分析剧情解决度
    const plotSignal = await this.analyzePlotResolution(
      projectId,
      writtenChapters,
      project.storyBible,
    );
    if (plotSignal) {
      signals.push(plotSignal);
    }

    // 3. 分析角色弧线完整度
    const arcSignal = await this.analyzeCharacterArcs(
      project.storyBible?.characters || [],
      writtenChapters,
    );
    if (arcSignal) {
      signals.push(arcSignal);
    }

    // 4. 检查字数达成度
    const wordCountSignal = this.analyzeWordCount(
      writtenChapters,
      project.targetWords || 0,
    );
    if (wordCountSignal) {
      signals.push(wordCountSignal);
    }

    // 5. 分析叙事节奏
    const pacingSignal = await this.analyzePacing(writtenChapters);
    if (pacingSignal) {
      signals.push(pacingSignal);
    }

    // 计算综合得分
    const totalScore = this.calculateCompletionScore(signals);
    const isComplete = totalScore >= this.COMPLETION_THRESHOLD;

    // 确定推荐操作
    const recommendation = this.determineRecommendation(
      totalScore,
      signals,
      writtenChapters.length,
    );

    const analysis: CompletionAnalysis = {
      isComplete,
      confidence: totalScore,
      signals,
      recommendation: recommendation.action,
      reason: recommendation.reason,
      analyzedAt: new Date().toISOString(),
    };

    this.logger.log(
      `Completion analysis result: isComplete=${isComplete}, confidence=${totalScore.toFixed(2)}, recommendation=${recommendation.action}`,
    );

    return analysis;
  }

  /**
   * 快速检测文本标记（轻量级检测，用于写作过程中）
   */
  async quickDetectCompletion(
    projectId: string,
  ): Promise<{ isComplete: boolean; marker?: string }> {
    const lastChapter = await this.prisma.writingChapter.findFirst({
      where: {
        volume: { projectId },
        content: { not: "" },
      },
      orderBy: { chapterNumber: "desc" },
      select: { content: true, title: true, outline: true },
    });

    if (!lastChapter) {
      return { isComplete: false };
    }

    for (const { marker, confidence } of this.COMPLETION_MARKERS) {
      if (confidence >= 0.8) {
        // 只检测高置信度标记
        if (
          lastChapter.content?.includes(marker) ||
          lastChapter.title?.includes(marker) ||
          lastChapter.outline?.includes(marker)
        ) {
          return { isComplete: true, marker };
        }
      }
    }

    return { isComplete: false };
  }

  /**
   * 检测文本标记
   */
  private async detectTextMarkers(
    chapters: { content: string | null; title: string | null }[],
  ): Promise<CompletionSignal | null> {
    // 重点检查最后几章
    const recentChapters = chapters.slice(-3);

    for (const chapter of recentChapters.reverse()) {
      for (const { marker, confidence } of this.COMPLETION_MARKERS) {
        const content = chapter.content || "";
        const title = chapter.title || "";

        if (content.includes(marker) || title.includes(marker)) {
          return {
            type: "TEXT_MARKER",
            description: `检测到完结标记: "${marker}"`,
            weight: this.SIGNAL_WEIGHTS.TEXT_MARKER,
            confidence,
            evidence: marker,
          };
        }
      }
    }

    return null;
  }

  /**
   * 分析剧情解决度
   */
  private async analyzePlotResolution(
    _projectId: string,
    chapters: { content: string | null; chapterNumber: number }[],
    storyBible: { premise?: string | null } | null,
  ): Promise<CompletionSignal | null> {
    if (chapters.length < 5) {
      return null; // 章节太少，无法有效分析
    }

    try {
      // 使用 AI 分析剧情解决度
      const recentContent = chapters
        .slice(-5)
        .map((c) => c.content || "")
        .join("\n\n---\n\n");

      const premise = storyBible?.premise || "未知";

      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `你是一位故事分析专家。分析给定的故事片段，判断主要冲突是否已解决。

输出 JSON 格式：
{
  "mainConflictsResolved": true/false,
  "resolutionRatio": 0-1,
  "reason": "分析理由"
}`,
          },
          {
            role: "user",
            content: `故事前提: ${premise}

最近章节内容:
${recentContent.slice(0, 8000)}

请分析主要冲突是否已解决。`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low",
          outputLength: "minimal",
        },
      });

      const result = this.parseJsonResponse(response.content || "", {
        mainConflictsResolved: false,
        resolutionRatio: 0.5,
        reason: "无法分析",
      });

      if (result.resolutionRatio > 0.7) {
        return {
          type: "PLOT_RESOLUTION",
          description: `剧情解决度: ${(result.resolutionRatio * 100).toFixed(0)}%`,
          weight: this.SIGNAL_WEIGHTS.PLOT_RESOLUTION,
          confidence: result.resolutionRatio,
          evidence: result.reason,
        };
      }
    } catch (error) {
      this.logger.warn(`Failed to analyze plot resolution: ${error}`);
    }

    return null;
  }

  /**
   * 分析角色弧线完整度
   */
  private async analyzeCharacterArcs(
    characters: { name: string; role: string }[],
    chapters: { content: string | null }[],
  ): Promise<CompletionSignal | null> {
    if (characters.length === 0 || chapters.length < 10) {
      return null;
    }

    try {
      // 获取主要角色
      const mainCharacters = characters
        .filter((c) => c.role === "protagonist" || c.role === "antagonist")
        .slice(0, 3);

      if (mainCharacters.length === 0) {
        return null;
      }

      // 分析最后几章的角色状态
      const recentContent = chapters
        .slice(-5)
        .map((c) => c.content || "")
        .join("\n\n");

      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `你是一位故事分析专家。分析角色弧线是否完成。

输出 JSON 格式：
{
  "arcsComplete": true/false,
  "completionRatio": 0-1,
  "reason": "分析理由"
}`,
          },
          {
            role: "user",
            content: `主要角色: ${mainCharacters.map((c) => c.name).join(", ")}

最近章节内容:
${recentContent.slice(0, 6000)}

请分析这些角色的弧线是否已完成。`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low",
          outputLength: "minimal",
        },
      });

      const result = this.parseJsonResponse(response.content || "", {
        arcsComplete: false,
        completionRatio: 0.5,
        reason: "无法分析",
      });

      if (result.completionRatio > 0.6) {
        return {
          type: "CHARACTER_ARC",
          description: `角色弧线完成度: ${(result.completionRatio * 100).toFixed(0)}%`,
          weight: this.SIGNAL_WEIGHTS.CHARACTER_ARC,
          confidence: result.completionRatio,
          evidence: result.reason,
        };
      }
    } catch (error) {
      this.logger.warn(`Failed to analyze character arcs: ${error}`);
    }

    return null;
  }

  /**
   * 分析字数达成度
   */
  private analyzeWordCount(
    chapters: { wordCount: number | null }[],
    targetWords: number,
  ): CompletionSignal | null {
    if (targetWords <= 0) {
      return null;
    }

    const currentWords = chapters.reduce(
      (sum, c) => sum + (c.wordCount || 0),
      0,
    );
    const ratio = currentWords / targetWords;

    if (ratio >= 0.9) {
      return {
        type: "WORD_COUNT",
        description: `字数达成: ${currentWords.toLocaleString()}/${targetWords.toLocaleString()} (${(ratio * 100).toFixed(0)}%)`,
        weight: this.SIGNAL_WEIGHTS.WORD_COUNT,
        confidence: Math.min(ratio, 1),
        evidence: `当前 ${currentWords.toLocaleString()} 字`,
      };
    }

    return null;
  }

  /**
   * 分析叙事节奏
   */
  private async analyzePacing(
    chapters: { content: string | null; chapterNumber: number }[],
  ): Promise<CompletionSignal | null> {
    if (chapters.length < 10) {
      return null;
    }

    try {
      // 比较最近章节与整体的冲突密度
      const recentChapters = chapters.slice(-5);
      const earlierChapters = chapters.slice(-15, -5);

      const recentContent = recentChapters
        .map((c) => c.content || "")
        .join("\n");
      const earlierContent = earlierChapters
        .map((c) => c.content || "")
        .join("\n");

      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `你是一位故事分析专家。分析叙事节奏变化。

输出 JSON 格式：
{
  "isWindingDown": true/false,
  "pacingScore": 0-1,
  "reason": "分析理由"
}

isWindingDown 为 true 表示故事正在收尾（冲突减少、情节收敛）
pacingScore 越高表示越接近结尾`,
          },
          {
            role: "user",
            content: `早期内容片段:
${earlierContent.slice(0, 3000)}

---

最近内容片段:
${recentContent.slice(0, 3000)}

请分析叙事节奏是否在收尾。`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low",
          outputLength: "minimal",
        },
      });

      const result = this.parseJsonResponse(response.content || "", {
        isWindingDown: false,
        pacingScore: 0.5,
        reason: "无法分析",
      });

      if (result.isWindingDown && result.pacingScore > 0.6) {
        return {
          type: "PACING",
          description: `叙事节奏分析: 故事正在收尾`,
          weight: this.SIGNAL_WEIGHTS.PACING,
          confidence: result.pacingScore,
          evidence: result.reason,
        };
      }
    } catch (error) {
      this.logger.warn(`Failed to analyze pacing: ${error}`);
    }

    return null;
  }

  /**
   * 计算综合完结得分
   */
  private calculateCompletionScore(signals: CompletionSignal[]): number {
    if (signals.length === 0) {
      return 0;
    }

    let totalWeight = 0;
    let weightedScore = 0;

    for (const signal of signals) {
      const score = signal.weight * signal.confidence;
      weightedScore += score;
      totalWeight += signal.weight;
    }

    // 如果有高置信度的文本标记，直接提升分数
    const textMarkerSignal = signals.find((s) => s.type === "TEXT_MARKER");
    if (textMarkerSignal && textMarkerSignal.confidence >= 0.9) {
      return Math.max(weightedScore / totalWeight, 0.85);
    }

    return totalWeight > 0 ? weightedScore / totalWeight : 0;
  }

  /**
   * 确定推荐操作
   */
  private determineRecommendation(
    score: number,
    signals: CompletionSignal[],
    chapterCount: number,
  ): { action: "STOP" | "CONTINUE" | "ASK_USER"; reason: string } {
    // 有明确的完结标记且置信度高
    const textMarker = signals.find(
      (s) => s.type === "TEXT_MARKER" && s.confidence >= 0.9,
    );
    if (textMarker) {
      return {
        action: "STOP",
        reason: `检测到明确的完结标记"${textMarker.evidence}"，建议停止创作`,
      };
    }

    // 综合得分很高
    if (score >= 0.8) {
      return {
        action: "STOP",
        reason: `多维度分析显示故事已完结（置信度 ${(score * 100).toFixed(0)}%）`,
      };
    }

    // 综合得分中等，需要用户确认
    if (score >= 0.5) {
      return {
        action: "ASK_USER",
        reason: `故事可能已完结（置信度 ${(score * 100).toFixed(0)}%），建议确认是否继续`,
      };
    }

    // 章节太少，继续
    if (chapterCount < 10) {
      return {
        action: "CONTINUE",
        reason: `故事尚处于早期阶段（${chapterCount}章），建议继续创作`,
      };
    }

    // 默认继续
    return {
      action: "CONTINUE",
      reason: `未检测到明确的完结信号，建议继续创作`,
    };
  }

  /**
   * 创建默认分析结果
   */
  private createDefaultAnalysis(
    isComplete: boolean,
    reason: string,
  ): CompletionAnalysis {
    return {
      isComplete,
      confidence: isComplete ? 1 : 0,
      signals: [],
      recommendation: isComplete ? "STOP" : "CONTINUE",
      reason,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * 解析 JSON 响应
   */
  private parseJsonResponse<T>(content: string, defaultValue: T): T {
    try {
      // 尝试提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      this.logger.warn("Failed to parse JSON response");
    }
    return defaultValue;
  }
}
