/**
 * HierarchicalSummaryService - 层次摘要系统
 *
 * 基于 SCORE 论文的 Context-Aware Summarization，实现四级层次摘要：
 * - 场景级摘要：每个场景 50-100 字，保留细节
 * - 章节级摘要：每章 200-300 字，包含关键事件
 * - 弧线级摘要：每个故事弧 500-800 字，完整情节线
 * - 卷级摘要：每卷 1000-1500 字，宏观概述
 *
 * 核心机制：
 * - 智能选择摘要层级，根据上下文需求动态调整
 * - 摘要缓存和增量更新
 * - 支持混合检索增强
 *
 * 参考文献:
 * - SCORE: Story Coherence and Retrieval Enhancement (ArXiv 2025)
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

// ==================== 类型定义 ====================

/**
 * 摘要级别
 */
export type SummaryLevel = "SCENE" | "CHAPTER" | "ARC" | "VOLUME";

/**
 * 层次摘要
 */
export interface HierarchicalSummary {
  /** 摘要级别 */
  level: SummaryLevel;
  /** 摘要内容 */
  content: string;
  /** 关键事件列表 */
  keyEvents: string[];
  /** 情感基调 */
  emotionalTone: string;
  /** 涉及角色状态 */
  characterStates: Record<string, string>;
  /** 来源（章节号/弧线名/卷号） */
  source: string;
  /** 创建时间 */
  createdAt: string;
  /** 字数 */
  wordCount: number;
}

/**
 * 场景摘要
 */
export interface SceneSummary {
  /** 场景编号 */
  sceneNumber: number;
  /** 场景摘要 */
  summary: string;
  /** 场景位置 */
  location?: string;
  /** 涉及角色 */
  characters: string[];
  /** 关键动作 */
  keyAction?: string;
}

/**
 * 章节摘要
 */
export interface ChapterSummary {
  /** 章节编号 */
  chapterNumber: number;
  /** 章节标题 */
  title: string;
  /** 章节摘要 */
  summary: string;
  /** 关键事件 */
  keyEvents: string[];
  /** 情感基调 */
  emotionalTone: string;
  /** 角色状态变化 */
  characterChanges: Record<string, string>;
  /** 场景摘要列表 */
  scenes?: SceneSummary[];
}

/**
 * 故事弧线摘要
 */
export interface ArcSummary {
  /** 弧线名称 */
  arcName: string;
  /** 包含章节范围 */
  chapterRange: [number, number];
  /** 弧线摘要 */
  summary: string;
  /** 弧线类型 */
  arcType: "main" | "sub" | "character";
  /** 主要冲突 */
  mainConflict: string;
  /** 解决状态 */
  resolution?: string;
  /** 涉及主要角色 */
  mainCharacters: string[];
}

/**
 * 卷级摘要
 */
export interface VolumeSummary {
  /** 卷号 */
  volumeNumber: number;
  /** 卷标题 */
  title: string;
  /** 卷摘要 */
  summary: string;
  /** 包含弧线 */
  arcs: string[];
  /** 主题 */
  theme: string;
  /** 起始状态 */
  startingState: string;
  /** 结束状态 */
  endingState: string;
}

/**
 * 上下文请求
 */
export interface ContextRequest {
  /** 当前章节号 */
  currentChapter: number;
  /** 目标 token 数 */
  targetTokens: number;
  /** 涉及角色 */
  involvedCharacters?: string[];
  /** 关键词 */
  keywords?: string[];
}

/**
 * 层次上下文
 */
export interface HierarchicalContext {
  /** 最近章节（详细） */
  recentChapters: ChapterSummary[];
  /** 中期章节（中等详细） */
  mediumChapters: ChapterSummary[];
  /** 远期上下文（弧线/卷级） */
  distantContext: string;
  /** 总字数估计 */
  estimatedTokens: number;
}

// ==================== 配置常量 ====================

// 摘要字数配置（供未来使用）
// const SUMMARY_CONFIG = {
//   SCENE: { minWords: 50, maxWords: 100 },
//   CHAPTER: { minWords: 200, maxWords: 300 },
//   ARC: { minWords: 500, maxWords: 800 },
//   VOLUME: { minWords: 1000, maxWords: 1500 },
// };

const CONTEXT_WINDOWS = {
  RECENT: 3, // 最近 3 章使用场景级详细摘要
  MEDIUM: 6, // 3-6 章使用章节级摘要
  DISTANT: 12, // 6-12 章使用弧线级摘要
  // 12+ 章使用卷级摘要
};

// ==================== 服务实现 ====================

@Injectable()
export class HierarchicalSummaryService {
  private readonly logger = new Logger(HierarchicalSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * 生成章节摘要
   */
  async generateChapterSummary(
    chapterId: string,
    content: string,
    chapterNumber: number,
    title: string,
  ): Promise<ChapterSummary> {
    this.logger.log(`Generating chapter summary for chapter ${chapterNumber}`);

    try {
      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `你是一位故事摘要专家。生成章节摘要，包含关键事件和角色状态变化。

输出 JSON 格式：
{
  "summary": "章节摘要（200-300字）",
  "keyEvents": ["事件1", "事件2"],
  "emotionalTone": "情感基调",
  "characterChanges": {
    "角色名": "状态变化描述"
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "summary": "场景摘要（50-100字）",
      "location": "场景位置",
      "characters": ["角色1"],
      "keyAction": "关键动作"
    }
  ]
}`,
          },
          {
            role: "user",
            content: `第${chapterNumber}章：${title}

内容：
${content.slice(0, 8000)}

请生成层次摘要。`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
      });

      const result = this.parseJsonResponse(response.content || "", {
        summary: "",
        keyEvents: [],
        emotionalTone: "未知",
        characterChanges: {},
        scenes: [],
      });

      const chapterSummary: ChapterSummary = {
        chapterNumber,
        title,
        summary: result.summary || `第${chapterNumber}章摘要`,
        keyEvents: result.keyEvents || [],
        emotionalTone: result.emotionalTone || "未知",
        characterChanges: result.characterChanges || {},
        scenes: result.scenes || [],
      };

      // 保存到数据库
      await this.saveSummaryToChapter(chapterId, chapterSummary);

      return chapterSummary;
    } catch (error) {
      this.logger.warn(`Failed to generate chapter summary: ${error}`);
      return {
        chapterNumber,
        title,
        summary: `第${chapterNumber}章`,
        keyEvents: [],
        emotionalTone: "未知",
        characterChanges: {},
      };
    }
  }

  /**
   * 生成弧线摘要
   */
  async generateArcSummary(
    projectId: string,
    arcName: string,
    chapterRange: [number, number],
  ): Promise<ArcSummary> {
    this.logger.log(
      `Generating arc summary for "${arcName}" (chapters ${chapterRange[0]}-${chapterRange[1]})`,
    );

    // 获取范围内的章节摘要
    const chapterSummaries = await this.getChapterSummaries(
      projectId,
      chapterRange[0],
      chapterRange[1],
    );

    const summariesText = chapterSummaries
      .map((s) => `第${s.chapterNumber}章：${s.summary}`)
      .join("\n\n");

    try {
      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `你是一位故事摘要专家。根据章节摘要生成故事弧线摘要。

输出 JSON 格式：
{
  "summary": "弧线摘要（500-800字）",
  "arcType": "main|sub|character",
  "mainConflict": "主要冲突",
  "resolution": "解决方式（如有）",
  "mainCharacters": ["角色1", "角色2"]
}`,
          },
          {
            role: "user",
            content: `弧线名称：${arcName}
章节范围：${chapterRange[0]}-${chapterRange[1]}

章节摘要：
${summariesText}

请生成弧线摘要。`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
      });

      const result = this.parseJsonResponse(response.content || "", {
        summary: "",
        arcType: "sub",
        mainConflict: "",
        resolution: "",
        mainCharacters: [],
      });

      return {
        arcName,
        chapterRange,
        summary: result.summary || `${arcName}弧线摘要`,
        arcType: (result.arcType || "sub") as "main" | "sub" | "character",
        mainConflict: result.mainConflict || "未知",
        resolution: result.resolution,
        mainCharacters: result.mainCharacters || [],
      };
    } catch (error) {
      this.logger.warn(`Failed to generate arc summary: ${error}`);
      return {
        arcName,
        chapterRange,
        summary: `${arcName}弧线`,
        arcType: "sub",
        mainConflict: "未知",
        mainCharacters: [],
      };
    }
  }

  /**
   * 生成卷级摘要
   */
  async generateVolumeSummary(
    projectId: string,
    volumeNumber: number,
  ): Promise<VolumeSummary> {
    this.logger.log(`Generating volume summary for volume ${volumeNumber}`);

    const volume = await this.prisma.writingVolume.findFirst({
      where: { projectId, volumeNumber },
      include: {
        chapters: {
          orderBy: { chapterNumber: "asc" },
          select: {
            chapterNumber: true,
            title: true,
            content: true,
            metadata: true,
          },
        },
      },
    });

    if (!volume) {
      return {
        volumeNumber,
        title: `第${volumeNumber}卷`,
        summary: "",
        arcs: [],
        theme: "未知",
        startingState: "",
        endingState: "",
      };
    }

    // 获取或生成章节摘要
    const chapterSummaries: ChapterSummary[] = [];
    for (const chapter of volume.chapters) {
      const metadata = chapter.metadata as { summary?: ChapterSummary } | null;
      if (metadata?.summary) {
        chapterSummaries.push(metadata.summary);
      } else if (chapter.content) {
        const summary = await this.generateChapterSummary(
          "", // 不保存
          chapter.content,
          chapter.chapterNumber,
          chapter.title || `第${chapter.chapterNumber}章`,
        );
        chapterSummaries.push(summary);
      }
    }

    const summariesText = chapterSummaries
      .map((s) => `第${s.chapterNumber}章：${s.summary}`)
      .join("\n");

    try {
      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `你是一位故事摘要专家。根据章节摘要生成卷级宏观摘要。

输出 JSON 格式：
{
  "summary": "卷摘要（1000-1500字）",
  "arcs": ["弧线1", "弧线2"],
  "theme": "主题",
  "startingState": "开始时的状态",
  "endingState": "结束时的状态"
}`,
          },
          {
            role: "user",
            content: `第${volumeNumber}卷：${volume.title || ""}

章节摘要：
${summariesText}

请生成卷级摘要。`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low",
          outputLength: "long",
        },
      });

      const result = this.parseJsonResponse(response.content || "", {
        summary: "",
        arcs: [],
        theme: "",
        startingState: "",
        endingState: "",
      });

      return {
        volumeNumber,
        title: volume.title || `第${volumeNumber}卷`,
        summary: result.summary || "",
        arcs: result.arcs || [],
        theme: result.theme || "未知",
        startingState: result.startingState || "",
        endingState: result.endingState || "",
      };
    } catch (error) {
      this.logger.warn(`Failed to generate volume summary: ${error}`);
      return {
        volumeNumber,
        title: volume.title || `第${volumeNumber}卷`,
        summary: "",
        arcs: [],
        theme: "未知",
        startingState: "",
        endingState: "",
      };
    }
  }

  /**
   * 智能获取上下文（核心方法）
   */
  async getHierarchicalContext(
    projectId: string,
    request: ContextRequest,
  ): Promise<HierarchicalContext> {
    this.logger.log(
      `Getting hierarchical context for chapter ${request.currentChapter}`,
    );

    const { currentChapter } = request;

    // 1. 获取最近章节（详细）
    const recentChapters = await this.getChapterSummaries(
      projectId,
      Math.max(1, currentChapter - CONTEXT_WINDOWS.RECENT),
      currentChapter - 1,
    );

    // 2. 获取中期章节（中等详细）
    const mediumStart = Math.max(1, currentChapter - CONTEXT_WINDOWS.MEDIUM);
    const mediumEnd = Math.max(1, currentChapter - CONTEXT_WINDOWS.RECENT - 1);
    const mediumChapters =
      mediumStart <= mediumEnd
        ? await this.getChapterSummaries(projectId, mediumStart, mediumEnd)
        : [];

    // 3. 获取远期上下文
    let distantContext = "";
    const distantEnd = Math.max(1, mediumStart - 1);

    if (distantEnd >= 1 && currentChapter > CONTEXT_WINDOWS.MEDIUM) {
      // 尝试获取弧线级或卷级摘要
      distantContext = await this.getDistantContextSummary(
        projectId,
        1,
        distantEnd,
      );
    }

    // 估算 token 数
    const estimatedTokens = this.estimateTokens(
      recentChapters,
      mediumChapters,
      distantContext,
    );

    return {
      recentChapters,
      mediumChapters,
      distantContext,
      estimatedTokens,
    };
  }

  /**
   * 获取章节摘要列表
   */
  async getChapterSummaries(
    projectId: string,
    fromChapter: number,
    toChapter: number,
  ): Promise<ChapterSummary[]> {
    const chapters = await this.prisma.writingChapter.findMany({
      where: {
        volume: { projectId },
        chapterNumber: {
          gte: fromChapter,
          lte: toChapter,
        },
        content: { not: "" },
      },
      orderBy: { chapterNumber: "asc" },
      select: {
        id: true,
        chapterNumber: true,
        title: true,
        content: true,
        metadata: true,
      },
    });

    const summaries: ChapterSummary[] = [];

    for (const chapter of chapters) {
      const metadata = chapter.metadata as { summary?: ChapterSummary } | null;

      if (metadata?.summary) {
        summaries.push(metadata.summary);
      } else if (chapter.content) {
        // 生成摘要并缓存
        const summary = await this.generateChapterSummary(
          chapter.id,
          chapter.content,
          chapter.chapterNumber,
          chapter.title || `第${chapter.chapterNumber}章`,
        );
        summaries.push(summary);
      }
    }

    return summaries;
  }

  /**
   * 获取远期上下文摘要（弧线/卷级）
   */
  private async getDistantContextSummary(
    projectId: string,
    fromChapter: number,
    toChapter: number,
  ): Promise<string> {
    // 获取章节摘要
    const summaries = await this.getChapterSummaries(
      projectId,
      fromChapter,
      toChapter,
    );

    if (summaries.length === 0) {
      return "";
    }

    // 压缩成一个综合摘要
    const summaryTexts = summaries
      .map((s) => `第${s.chapterNumber}章：${s.summary}`)
      .join("\n");

    try {
      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `请将以下章节摘要压缩成一个综合性的背景摘要，保留关键情节和角色状态，控制在500字以内。`,
          },
          {
            role: "user",
            content: summaryTexts,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
      });

      return response.content || "";
    } catch (error) {
      this.logger.warn(`Failed to generate distant context: ${error}`);
      // 回退：简单拼接
      return summaries.map((s) => s.summary).join(" ");
    }
  }

  /**
   * 保存摘要到章节元数据
   */
  private async saveSummaryToChapter(
    chapterId: string,
    summary: ChapterSummary,
  ): Promise<void> {
    if (!chapterId) {
      return;
    }

    try {
      const chapter = await this.prisma.writingChapter.findUnique({
        where: { id: chapterId },
        select: { metadata: true },
      });

      const existingMetadata =
        (chapter?.metadata as Record<string, unknown>) || {};

      await this.prisma.writingChapter.update({
        where: { id: chapterId },
        data: {
          metadata: JSON.parse(
            JSON.stringify({
              ...existingMetadata,
              summary,
              summaryUpdatedAt: new Date().toISOString(),
            }),
          ),
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to save summary: ${error}`);
    }
  }

  /**
   * 估算 token 数
   */
  private estimateTokens(
    recent: ChapterSummary[],
    medium: ChapterSummary[],
    distant: string,
  ): number {
    // 粗略估算：中文约 1.5 字符 = 1 token
    let totalChars = 0;

    for (const s of recent) {
      totalChars += s.summary.length;
      for (const scene of s.scenes || []) {
        totalChars += scene.summary.length;
      }
    }

    for (const s of medium) {
      totalChars += s.summary.length;
    }

    totalChars += distant.length;

    return Math.ceil(totalChars / 1.5);
  }

  /**
   * 将层次上下文格式化为字符串
   */
  formatContextForPrompt(context: HierarchicalContext): string {
    const parts: string[] = [];

    // 远期背景
    if (context.distantContext) {
      parts.push(`【故事背景】\n${context.distantContext}`);
    }

    // 中期章节
    if (context.mediumChapters.length > 0) {
      parts.push(
        `【近期剧情】\n${context.mediumChapters.map((s) => `第${s.chapterNumber}章：${s.summary}`).join("\n")}`,
      );
    }

    // 最近章节（详细）
    if (context.recentChapters.length > 0) {
      const recentDetails = context.recentChapters.map((s) => {
        let detail = `第${s.chapterNumber}章 ${s.title}：\n${s.summary}`;
        if (s.keyEvents.length > 0) {
          detail += `\n关键事件：${s.keyEvents.join("、")}`;
        }
        if (Object.keys(s.characterChanges).length > 0) {
          detail += `\n角色变化：${Object.entries(s.characterChanges)
            .map(([k, v]) => `${k}(${v})`)
            .join("、")}`;
        }
        return detail;
      });
      parts.push(`【前文详情】\n${recentDetails.join("\n\n")}`);
    }

    return parts.join("\n\n---\n\n");
  }

  /**
   * 解析 JSON 响应
   */
  private parseJsonResponse<T>(content: string, defaultValue: T): T {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      this.logger.warn("Failed to parse JSON response");
    }
    return defaultValue;
  }

  /**
   * 批量更新章节摘要
   *
   * 优化策略：
   * 1. 并发控制：最多同时处理 CONCURRENCY_LIMIT 个章节，避免 AI 服务过载
   * 2. 批量数据库更新：收集所有摘要后批量写入，减少数据库 I/O
   */
  async batchUpdateSummaries(projectId: string): Promise<number> {
    const CONCURRENCY_LIMIT = 3; // AI 调用并发限制

    const chapters = await this.prisma.writingChapter.findMany({
      where: {
        volume: { projectId },
        content: { not: "" },
      },
      orderBy: { chapterNumber: "asc" },
      select: {
        id: true,
        chapterNumber: true,
        title: true,
        content: true,
        metadata: true,
      },
    });

    // 筛选需要生成摘要的章节
    const chaptersNeedingSummary = chapters.filter((chapter) => {
      const metadata = chapter.metadata as { summary?: ChapterSummary } | null;
      return !metadata?.summary && chapter.content;
    });

    if (chaptersNeedingSummary.length === 0) {
      this.logger.log("No chapters need summary updates");
      return 0;
    }

    this.logger.log(
      `Generating summaries for ${chaptersNeedingSummary.length} chapters with concurrency ${CONCURRENCY_LIMIT}`,
    );

    // 收集生成的摘要结果
    const summaryResults: Array<{
      chapterId: string;
      summary: ChapterSummary;
      existingMetadata: Record<string, unknown>;
    }> = [];

    // 并发控制处理
    for (let i = 0; i < chaptersNeedingSummary.length; i += CONCURRENCY_LIMIT) {
      const batch = chaptersNeedingSummary.slice(i, i + CONCURRENCY_LIMIT);

      const batchResults = await Promise.all(
        batch.map(async (chapter) => {
          try {
            const summary = await this.generateChapterSummaryWithoutSave(
              chapter.content!,
              chapter.chapterNumber,
              chapter.title || `第${chapter.chapterNumber}章`,
            );
            const existingMetadata =
              (chapter.metadata as Record<string, unknown>) || {};
            return {
              chapterId: chapter.id,
              summary,
              existingMetadata,
            };
          } catch (error) {
            this.logger.warn(
              `Failed to generate summary for chapter ${chapter.chapterNumber}: ${error}`,
            );
            return null;
          }
        }),
      );

      // 收集成功的结果
      for (const result of batchResults) {
        if (result) {
          summaryResults.push(result);
        }
      }
    }

    // 批量更新数据库
    if (summaryResults.length > 0) {
      await this.batchSaveSummariesToDatabase(summaryResults);
    }

    this.logger.log(`Batch updated ${summaryResults.length} chapter summaries`);
    return summaryResults.length;
  }

  /**
   * 生成章节摘要（不保存到数据库）
   * 用于批量操作时分离生成和保存步骤
   */
  private async generateChapterSummaryWithoutSave(
    content: string,
    chapterNumber: number,
    title: string,
  ): Promise<ChapterSummary> {
    try {
      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `你是一位故事摘要专家。生成章节摘要，包含关键事件和角色状态变化。

输出 JSON 格式：
{
  "summary": "章节摘要（200-300字）",
  "keyEvents": ["事件1", "事件2"],
  "emotionalTone": "情感基调",
  "characterChanges": {
    "角色名": "状态变化描述"
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "summary": "场景摘要（50-100字）",
      "location": "场景位置",
      "characters": ["角色1"],
      "keyAction": "关键动作"
    }
  ]
}`,
          },
          {
            role: "user",
            content: `第${chapterNumber}章：${title}

内容：
${content.slice(0, 8000)}

请生成层次摘要。`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
      });

      const result = this.parseJsonResponse(response.content || "", {
        summary: "",
        keyEvents: [],
        emotionalTone: "未知",
        characterChanges: {},
        scenes: [],
      });

      return {
        chapterNumber,
        title,
        summary: result.summary || `第${chapterNumber}章摘要`,
        keyEvents: result.keyEvents || [],
        emotionalTone: result.emotionalTone || "未知",
        characterChanges: result.characterChanges || {},
        scenes: result.scenes || [],
      };
    } catch (error) {
      this.logger.warn(`Failed to generate chapter summary: ${error}`);
      return {
        chapterNumber,
        title,
        summary: `第${chapterNumber}章`,
        keyEvents: [],
        emotionalTone: "未知",
        characterChanges: {},
      };
    }
  }

  /**
   * 批量保存摘要到数据库
   * 使用事务确保原子性
   */
  private async batchSaveSummariesToDatabase(
    results: Array<{
      chapterId: string;
      summary: ChapterSummary;
      existingMetadata: Record<string, unknown>;
    }>,
  ): Promise<void> {
    const BATCH_SIZE = 10; // 每批更新数量

    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const batch = results.slice(i, i + BATCH_SIZE);

      try {
        await this.prisma.$transaction(
          batch.map((result) =>
            this.prisma.writingChapter.update({
              where: { id: result.chapterId },
              data: {
                metadata: JSON.parse(
                  JSON.stringify({
                    ...result.existingMetadata,
                    summary: result.summary,
                    summaryUpdatedAt: new Date().toISOString(),
                  }),
                ),
              },
            }),
          ),
        );

        this.logger.debug(
          `Saved batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} chapters)`,
        );
      } catch (error) {
        this.logger.warn(`Failed to save batch: ${error}`);
        // 回退到单个更新
        for (const result of batch) {
          try {
            await this.prisma.writingChapter.update({
              where: { id: result.chapterId },
              data: {
                metadata: JSON.parse(
                  JSON.stringify({
                    ...result.existingMetadata,
                    summary: result.summary,
                    summaryUpdatedAt: new Date().toISOString(),
                  }),
                ),
              },
            });
          } catch (innerError) {
            this.logger.error(
              `Failed to save summary for chapter ${result.chapterId}: ${innerError}`,
            );
          }
        }
      }
    }
  }
}
