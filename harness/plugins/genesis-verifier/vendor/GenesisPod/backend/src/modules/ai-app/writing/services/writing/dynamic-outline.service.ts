/**
 * DynamicOutlineService - 动态分层大纲服务
 *
 * 基于 DOME 论文的 Dynamic Hierarchical Outline (DHO) 机制：
 * - 粗纲要（Rough Outline）：基于小说写作理论的五阶段结构，保持不变
 * - 细纲要（Detailed Outline）：随写作进展动态更新
 *
 * 核心机制：
 * - 将计划和写作阶段融合
 * - 根据已写内容自适应调整后续章节大纲
 * - 确保情节完整性和逻辑连贯性
 *
 * 五阶段结构（基于小说写作理论）：
 * 1. Exposition (开篇) - 背景介绍、人物登场
 * 2. Rising Action (上升) - 冲突升级、情节发展
 * 3. Climax (高潮) - 核心冲突爆发
 * 4. Falling Action (下降) - 冲突解决、后果展现
 * 5. Resolution (结局) - 收尾、主题升华
 *
 * 参考文献:
 * - DOME: Generating Long-form Story Using Dynamic Hierarchical Outlining
 *   with Memory-Enhancement (NAACL 2025)
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import { ExtractedFact } from "../consistency/fact-extractor.service";

// ==================== 类型定义 ====================

/**
 * 故事阶段
 */
export type StoryPhase =
  | "EXPOSITION" // 开篇
  | "RISING_ACTION" // 上升
  | "CLIMAX" // 高潮
  | "FALLING_ACTION" // 下降
  | "RESOLUTION"; // 结局

/**
 * 粗纲要（五阶段结构）
 */
export interface RoughOutline {
  /** 开篇：背景介绍、人物登场、世界观建立 */
  exposition: {
    description: string;
    targetChapters: number;
    keyElements: string[];
  };
  /** 上升：冲突升级、情节发展、伏笔铺设 */
  risingAction: {
    description: string;
    targetChapters: number;
    keyConflicts: string[];
    foreshadowing: string[];
  };
  /** 高潮：核心冲突爆发、关键转折 */
  climax: {
    description: string;
    targetChapters: number;
    mainConflict: string;
    turningPoints: string[];
  };
  /** 下降：冲突解决、后果展现 */
  fallingAction: {
    description: string;
    targetChapters: number;
    resolutions: string[];
  };
  /** 结局：收尾、主题升华 */
  resolution: {
    description: string;
    targetChapters: number;
    ending: string;
    themeMessage: string;
  };
  /** 创建时间 */
  createdAt: string;
  /** 版本 */
  version: number;
}

/**
 * 细纲要（单章节详细大纲）
 */
export interface DetailedOutline {
  /** 章节编号 */
  chapterNumber: number;
  /** 章节标题 */
  title: string;
  /** 章节摘要 */
  summary: string;
  /** 所属阶段 */
  phase: StoryPhase;
  /** 关键事件 */
  keyEvents: string[];
  /** 涉及角色 */
  involvedCharacters: string[];
  /** 场景设定 */
  scenes: {
    location: string;
    time?: string;
    description: string;
  }[];
  /** 伏笔设置 */
  foreshadowingToSet?: string[];
  /** 伏笔回收 */
  foreshadowingToResolve?: string[];
  /** 情感基调 */
  emotionalTone: string;
  /** 与前章的连接 */
  connectionToPrevious?: string;
  /** 为后章铺垫 */
  setupForNext?: string;
  /** 目标字数 */
  targetWordCount: number;
  /** 状态 */
  status: "PLANNED" | "ADJUSTED" | "WRITTEN";
  /** 最后更新时间 */
  updatedAt: string;
}

/**
 * 动态大纲
 */
export interface DynamicOutline {
  /** 项目ID */
  projectId: string;
  /** 粗纲要 */
  roughOutline: RoughOutline;
  /** 细纲要列表 */
  detailedOutlines: DetailedOutline[];
  /** 当前阶段 */
  currentPhase: StoryPhase;
  /** 当前进度（已写章节数） */
  currentProgress: number;
  /** 版本 */
  version: number;
  /** 最后更新时间 */
  updatedAt: string;
}

/**
 * 大纲调整建议
 */
export interface OutlineAdjustment {
  /** 调整类型 */
  type: "ADD" | "MODIFY" | "REMOVE" | "REORDER";
  /** 目标章节 */
  targetChapter: number;
  /** 调整原因 */
  reason: string;
  /** 原始内容 */
  original?: Partial<DetailedOutline>;
  /** 新内容 */
  proposed: Partial<DetailedOutline>;
  /** 置信度 */
  confidence: number;
}

// ==================== 配置常量 ====================

const PHASE_DISTRIBUTION = {
  EXPOSITION: 0.15, // 15%
  RISING_ACTION: 0.35, // 35%
  CLIMAX: 0.2, // 20%
  FALLING_ACTION: 0.2, // 20%
  RESOLUTION: 0.1, // 10%
};

// 阶段顺序（供未来使用）
// const PHASE_ORDER: StoryPhase[] = [
//   "EXPOSITION", "RISING_ACTION", "CLIMAX", "FALLING_ACTION", "RESOLUTION"
// ];

// ==================== 服务实现 ====================

@Injectable()
export class DynamicOutlineService {
  private readonly logger = new Logger(DynamicOutlineService.name);

  // 内存缓存（动态大纲不持久化到数据库，可按需重建）
  private outlineCache = new Map<string, DynamicOutline>();

  constructor(
    private readonly _prisma: PrismaService, // 保留用于未来扩展
    private readonly chatFacade: ChatFacade,
  ) {
    void this._prisma; // 保留用于未来持久化扩展
  }

  /**
   * 生成初始动态大纲
   */
  async generateInitialOutline(
    projectId: string,
    premise: string,
    targetChapters: number,
    genre?: string,
  ): Promise<DynamicOutline> {
    this.logger.log(
      `Generating initial dynamic outline for project ${projectId}`,
    );

    // 1. 生成粗纲要
    const roughOutline = await this.generateRoughOutline(
      premise,
      targetChapters,
      genre,
    );

    // 2. 生成细纲要
    const detailedOutlines = await this.generateDetailedOutlines(
      roughOutline,
      targetChapters,
      premise,
    );

    const dynamicOutline: DynamicOutline = {
      projectId,
      roughOutline,
      detailedOutlines,
      currentPhase: "EXPOSITION",
      currentProgress: 0,
      version: 1,
      updatedAt: new Date().toISOString(),
    };

    // 3. 保存到数据库
    await this.saveDynamicOutline(projectId, dynamicOutline);

    return dynamicOutline;
  }

  /**
   * 生成粗纲要
   */
  private async generateRoughOutline(
    premise: string,
    targetChapters: number,
    genre?: string,
  ): Promise<RoughOutline> {
    const expositionChapters = Math.ceil(
      targetChapters * PHASE_DISTRIBUTION.EXPOSITION,
    );
    const risingChapters = Math.ceil(
      targetChapters * PHASE_DISTRIBUTION.RISING_ACTION,
    );
    const climaxChapters = Math.ceil(
      targetChapters * PHASE_DISTRIBUTION.CLIMAX,
    );
    const fallingChapters = Math.ceil(
      targetChapters * PHASE_DISTRIBUTION.FALLING_ACTION,
    );
    const resolutionChapters =
      targetChapters -
      expositionChapters -
      risingChapters -
      climaxChapters -
      fallingChapters;

    try {
      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `你是一位故事结构专家。根据故事前提，设计五阶段粗纲要。

五阶段结构：
1. EXPOSITION (开篇 ${expositionChapters}章): 背景介绍、人物登场、世界观建立
2. RISING_ACTION (上升 ${risingChapters}章): 冲突升级、情节发展、伏笔铺设
3. CLIMAX (高潮 ${climaxChapters}章): 核心冲突爆发、关键转折
4. FALLING_ACTION (下降 ${fallingChapters}章): 冲突解决、后果展现
5. RESOLUTION (结局 ${resolutionChapters}章): 收尾、主题升华

输出 JSON 格式：
{
  "exposition": {
    "description": "开篇描述",
    "keyElements": ["元素1", "元素2"]
  },
  "risingAction": {
    "description": "上升描述",
    "keyConflicts": ["冲突1"],
    "foreshadowing": ["伏笔1"]
  },
  "climax": {
    "description": "高潮描述",
    "mainConflict": "主要冲突",
    "turningPoints": ["转折1"]
  },
  "fallingAction": {
    "description": "下降描述",
    "resolutions": ["解决1"]
  },
  "resolution": {
    "description": "结局描述",
    "ending": "结局方式",
    "themeMessage": "主题"
  }
}`,
          },
          {
            role: "user",
            content: `故事前提：${premise}
类型：${genre || "通用"}
目标章节：${targetChapters}章

请设计五阶段粗纲要。`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "medium",
          outputLength: "medium",
        },
      });

      const result = this.parseJsonResponse(response.content || "", {
        exposition: { description: "", keyElements: [] },
        risingAction: { description: "", keyConflicts: [], foreshadowing: [] },
        climax: { description: "", mainConflict: "", turningPoints: [] },
        fallingAction: { description: "", resolutions: [] },
        resolution: { description: "", ending: "", themeMessage: "" },
      });

      return {
        exposition: {
          description: result.exposition.description || "开篇",
          targetChapters: expositionChapters,
          keyElements: result.exposition.keyElements || [],
        },
        risingAction: {
          description: result.risingAction.description || "上升",
          targetChapters: risingChapters,
          keyConflicts: result.risingAction.keyConflicts || [],
          foreshadowing: result.risingAction.foreshadowing || [],
        },
        climax: {
          description: result.climax.description || "高潮",
          targetChapters: climaxChapters,
          mainConflict: result.climax.mainConflict || "",
          turningPoints: result.climax.turningPoints || [],
        },
        fallingAction: {
          description: result.fallingAction.description || "下降",
          targetChapters: fallingChapters,
          resolutions: result.fallingAction.resolutions || [],
        },
        resolution: {
          description: result.resolution.description || "结局",
          targetChapters: resolutionChapters,
          ending: result.resolution.ending || "",
          themeMessage: result.resolution.themeMessage || "",
        },
        createdAt: new Date().toISOString(),
        version: 1,
      };
    } catch (error) {
      this.logger.warn(`Failed to generate rough outline: ${error}`);
      // 返回默认结构
      return this.createDefaultRoughOutline(
        expositionChapters,
        risingChapters,
        climaxChapters,
        fallingChapters,
        resolutionChapters,
      );
    }
  }

  /**
   * 生成细纲要
   */
  private async generateDetailedOutlines(
    roughOutline: RoughOutline,
    targetChapters: number,
    premise: string,
  ): Promise<DetailedOutline[]> {
    const outlines: DetailedOutline[] = [];

    // 计算每个阶段的章节范围
    const phaseRanges = this.calculatePhaseRanges(roughOutline);

    for (let i = 1; i <= targetChapters; i++) {
      const phase = this.getPhaseForChapter(i, phaseRanges);

      outlines.push({
        chapterNumber: i,
        title: `第${i}章`,
        summary: `${phase}阶段 - 待详细规划`,
        phase,
        keyEvents: [],
        involvedCharacters: [],
        scenes: [],
        emotionalTone: "待定",
        targetWordCount: 3000,
        status: "PLANNED",
        updatedAt: new Date().toISOString(),
      });
    }

    // 批量生成前几章的详细大纲
    const initialBatch = Math.min(5, targetChapters);
    for (let i = 0; i < initialBatch; i++) {
      const detailed = await this.generateSingleChapterOutline(
        outlines[i],
        roughOutline,
        premise,
        i > 0 ? outlines[i - 1] : undefined,
      );
      outlines[i] = detailed;
    }

    return outlines;
  }

  /**
   * 生成单章节大纲
   */
  private async generateSingleChapterOutline(
    current: DetailedOutline,
    roughOutline: RoughOutline,
    premise: string,
    previous?: DetailedOutline,
  ): Promise<DetailedOutline> {
    const phaseInfo = roughOutline[this.getPhaseKey(current.phase)];

    try {
      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `你是一位章节规划专家。生成详细的章节大纲。

输出 JSON 格式：
{
  "title": "章节标题",
  "summary": "章节摘要（100-200字）",
  "keyEvents": ["事件1", "事件2"],
  "involvedCharacters": ["角色1", "角色2"],
  "scenes": [
    {"location": "地点", "time": "时间", "description": "场景描述"}
  ],
  "emotionalTone": "情感基调",
  "foreshadowingToSet": ["要设置的伏笔"],
  "foreshadowingToResolve": ["要回收的伏笔"],
  "connectionToPrevious": "与前章的连接",
  "setupForNext": "为后章铺垫"
}`,
          },
          {
            role: "user",
            content: `故事前提：${premise}

当前阶段：${current.phase}
阶段描述：${JSON.stringify(phaseInfo)}

第${current.chapterNumber}章
${previous ? `前章摘要：${previous.summary}` : "（无前章）"}

请生成本章详细大纲。`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "medium",
          outputLength: "medium",
        },
      });

      const result = this.parseJsonResponse<Partial<DetailedOutline>>(
        response.content || "",
        {
          title: current.title,
          summary: current.summary,
          keyEvents: [],
          involvedCharacters: [],
          scenes: [],
          emotionalTone: "待定",
        },
      );

      return {
        ...current,
        title: result.title || current.title,
        summary: result.summary || current.summary,
        keyEvents: result.keyEvents || [],
        involvedCharacters: result.involvedCharacters || [],
        scenes: result.scenes || [],
        emotionalTone: result.emotionalTone || "待定",
        foreshadowingToSet: result.foreshadowingToSet,
        foreshadowingToResolve: result.foreshadowingToResolve,
        connectionToPrevious: result.connectionToPrevious,
        setupForNext: result.setupForNext,
        status: "PLANNED",
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(`Failed to generate chapter outline: ${error}`);
      return current;
    }
  }

  /**
   * 动态更新大纲（核心方法）
   *
   * 在章节写完后调用，根据已写内容调整后续章节大纲
   */
  async updateOutlineAfterWriting(
    projectId: string,
    chapterNumber: number,
    writtenContent: string,
    extractedFacts: ExtractedFact[],
  ): Promise<OutlineAdjustment[]> {
    this.logger.log(`Updating outline after writing chapter ${chapterNumber}`);

    // 1. 获取当前动态大纲
    const outline = await this.getDynamicOutline(projectId);
    if (!outline) {
      this.logger.warn("No dynamic outline found for project");
      return [];
    }

    // 2. 分析已写内容与计划的偏差
    const currentPlan = outline.detailedOutlines.find(
      (o) => o.chapterNumber === chapterNumber,
    );
    if (!currentPlan) {
      return [];
    }

    // 3. 检测偏差并生成调整建议
    const adjustments = await this.analyzeDeviations(
      currentPlan,
      writtenContent,
      extractedFacts,
      outline,
    );

    // 4. 应用调整
    if (adjustments.length > 0) {
      await this.applyAdjustments(projectId, outline, adjustments);
    }

    // 5. 更新进度
    await this.updateProgress(projectId, chapterNumber);

    return adjustments;
  }

  /**
   * 分析偏差
   */
  private async analyzeDeviations(
    plan: DetailedOutline,
    writtenContent: string,
    facts: ExtractedFact[],
    outline: DynamicOutline,
  ): Promise<OutlineAdjustment[]> {
    const adjustments: OutlineAdjustment[] = [];

    try {
      // 获取后续未写章节
      const futureChapters = outline.detailedOutlines.filter(
        (o) => o.chapterNumber > plan.chapterNumber && o.status !== "WRITTEN",
      );

      if (futureChapters.length === 0) {
        return [];
      }

      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `你是一位故事规划专家。分析已写内容与计划的偏差，提出后续章节调整建议。

只提出必要的调整，保持故事整体结构稳定。

输出 JSON 格式：
{
  "adjustments": [
    {
      "type": "MODIFY",
      "targetChapter": 章节号,
      "reason": "调整原因",
      "proposed": {
        "summary": "新摘要",
        "keyEvents": ["新事件"]
      },
      "confidence": 0-1
    }
  ]
}

如果无需调整，返回空数组。`,
          },
          {
            role: "user",
            content: `原计划：
${JSON.stringify(plan, null, 2)}

实际写的内容摘要：
${writtenContent.slice(0, 2000)}

提取的关键事实：
${facts
  .slice(0, 10)
  .map((f) => `- ${f.subject} ${f.predicate} ${f.object || ""}`)
  .join("\n")}

后续计划：
${JSON.stringify(futureChapters.slice(0, 5), null, 2)}

请分析是否需要调整后续章节计划。`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
      });

      interface AdjustmentResult {
        adjustments?: Array<{
          type?: string;
          targetChapter?: number;
          reason?: string;
          proposed?: Partial<DetailedOutline>;
          confidence?: number;
        }>;
      }

      const result = this.parseJsonResponse<AdjustmentResult>(
        response.content || "",
        {
          adjustments: [],
        },
      );

      for (const adj of result.adjustments || []) {
        if ((adj.confidence ?? 0) >= 0.6 && adj.targetChapter) {
          adjustments.push({
            type: (adj.type || "MODIFY") as OutlineAdjustment["type"],
            targetChapter: adj.targetChapter,
            reason: adj.reason || "基于已写内容调整",
            proposed: adj.proposed || {},
            confidence: adj.confidence || 0.7,
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to analyze deviations: ${error}`);
    }

    return adjustments;
  }

  /**
   * 应用调整
   */
  private async applyAdjustments(
    projectId: string,
    outline: DynamicOutline,
    adjustments: OutlineAdjustment[],
  ): Promise<void> {
    for (const adj of adjustments) {
      const target = outline.detailedOutlines.find(
        (o) => o.chapterNumber === adj.targetChapter,
      );

      if (target) {
        // 合并调整
        Object.assign(target, adj.proposed, {
          status: "ADJUSTED",
          updatedAt: new Date().toISOString(),
        });

        this.logger.log(
          `Applied adjustment to chapter ${adj.targetChapter}: ${adj.reason}`,
        );
      }
    }

    // 保存更新后的大纲
    outline.version++;
    outline.updatedAt = new Date().toISOString();
    await this.saveDynamicOutline(projectId, outline);
  }

  /**
   * 更新进度
   */
  private async updateProgress(
    projectId: string,
    completedChapter: number,
  ): Promise<void> {
    const outline = await this.getDynamicOutline(projectId);
    if (!outline) return;

    // 更新章节状态
    const chapter = outline.detailedOutlines.find(
      (o) => o.chapterNumber === completedChapter,
    );
    if (chapter) {
      chapter.status = "WRITTEN";
    }

    // 更新当前进度
    outline.currentProgress = completedChapter;

    // 更新当前阶段
    const nextChapter = outline.detailedOutlines.find(
      (o) => o.chapterNumber === completedChapter + 1,
    );
    if (nextChapter) {
      outline.currentPhase = nextChapter.phase;
    }

    await this.saveDynamicOutline(projectId, outline);
  }

  /**
   * 获取动态大纲（从内存缓存）
   */
  async getDynamicOutline(projectId: string): Promise<DynamicOutline | null> {
    return this.outlineCache.get(projectId) || null;
  }

  /**
   * 保存动态大纲（到内存缓存）
   *
   * 注意：动态大纲目前存储在内存中，服务重启会丢失。
   * 如果需要持久化，可以将大纲序列化到文件或专用的数据库表。
   */
  private async saveDynamicOutline(
    projectId: string,
    outline: DynamicOutline,
  ): Promise<void> {
    this.outlineCache.set(projectId, outline);
    this.logger.debug(
      `Saved dynamic outline for project ${projectId} (v${outline.version})`,
    );
  }

  /**
   * 删除动态大纲（从内存缓存）
   */
  async deleteDynamicOutline(projectId: string): Promise<void> {
    this.outlineCache.delete(projectId);
  }

  /**
   * 获取章节的大纲
   */
  async getChapterOutline(
    projectId: string,
    chapterNumber: number,
  ): Promise<DetailedOutline | null> {
    const outline = await this.getDynamicOutline(projectId);
    if (!outline) return null;

    return (
      outline.detailedOutlines.find((o) => o.chapterNumber === chapterNumber) ||
      null
    );
  }

  /**
   * 计算阶段范围
   */
  private calculatePhaseRanges(
    roughOutline: RoughOutline,
  ): Map<StoryPhase, [number, number]> {
    const ranges = new Map<StoryPhase, [number, number]>();
    let start = 1;

    ranges.set("EXPOSITION", [
      start,
      start + roughOutline.exposition.targetChapters - 1,
    ]);
    start += roughOutline.exposition.targetChapters;

    ranges.set("RISING_ACTION", [
      start,
      start + roughOutline.risingAction.targetChapters - 1,
    ]);
    start += roughOutline.risingAction.targetChapters;

    ranges.set("CLIMAX", [
      start,
      start + roughOutline.climax.targetChapters - 1,
    ]);
    start += roughOutline.climax.targetChapters;

    ranges.set("FALLING_ACTION", [
      start,
      start + roughOutline.fallingAction.targetChapters - 1,
    ]);
    start += roughOutline.fallingAction.targetChapters;

    ranges.set("RESOLUTION", [
      start,
      start + roughOutline.resolution.targetChapters - 1,
    ]);

    return ranges;
  }

  /**
   * 获取章节所属阶段
   */
  private getPhaseForChapter(
    chapterNumber: number,
    ranges: Map<StoryPhase, [number, number]>,
  ): StoryPhase {
    for (const [phase, [start, end]] of ranges) {
      if (chapterNumber >= start && chapterNumber <= end) {
        return phase;
      }
    }
    return "RESOLUTION";
  }

  /**
   * 获取阶段key
   */
  private getPhaseKey(
    phase: StoryPhase,
  ): keyof Omit<RoughOutline, "createdAt" | "version"> {
    const mapping: Record<
      StoryPhase,
      keyof Omit<RoughOutline, "createdAt" | "version">
    > = {
      EXPOSITION: "exposition",
      RISING_ACTION: "risingAction",
      CLIMAX: "climax",
      FALLING_ACTION: "fallingAction",
      RESOLUTION: "resolution",
    };
    return mapping[phase];
  }

  /**
   * 创建默认粗纲要
   */
  private createDefaultRoughOutline(
    expositionChapters: number,
    risingChapters: number,
    climaxChapters: number,
    fallingChapters: number,
    resolutionChapters: number,
  ): RoughOutline {
    return {
      exposition: {
        description: "背景介绍、人物登场",
        targetChapters: expositionChapters,
        keyElements: [],
      },
      risingAction: {
        description: "冲突升级、情节发展",
        targetChapters: risingChapters,
        keyConflicts: [],
        foreshadowing: [],
      },
      climax: {
        description: "核心冲突爆发",
        targetChapters: climaxChapters,
        mainConflict: "",
        turningPoints: [],
      },
      fallingAction: {
        description: "冲突解决、后果展现",
        targetChapters: fallingChapters,
        resolutions: [],
      },
      resolution: {
        description: "收尾、主题升华",
        targetChapters: resolutionChapters,
        ending: "",
        themeMessage: "",
      },
      createdAt: new Date().toISOString(),
      version: 1,
    };
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
}
