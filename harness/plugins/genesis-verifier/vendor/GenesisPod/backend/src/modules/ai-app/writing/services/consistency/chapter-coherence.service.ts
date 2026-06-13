/**
 * Chapter Coherence Service - 章节间情节连贯性检查服务
 *
 * 功能：
 * - 检测章节间的情节断裂
 * - 验证剧情线索的延续
 * - 检查角色弧光的连贯性
 * - 检测悬念的设置与回收
 * - 分析场景转换的自然度
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { TaskProfile } from "@/modules/ai-harness/facade";
import type { AIModelType as _AIModelType } from "@prisma/client"; // 保留用于类型参考

export interface CoherenceIssue {
  /** 问题类型 */
  type:
    | "PLOT_DISCONTINUITY" // 情节断裂
    | "CHARACTER_ARC_BREAK" // 角色弧光中断
    | "UNRESOLVED_THREAD" // 未解决的线索
    | "MISSING_SETUP" // 缺少铺垫
    | "ABRUPT_TRANSITION" // 突兀的转场
    | "PACING_ISSUE"; // 节奏问题
  /** 严重程度 */
  severity: "CRITICAL" | "WARNING" | "INFO";
  /** 涉及章节 */
  chapters: number[];
  /** 问题描述 */
  description: string;
  /** 具体位置或引用 */
  reference?: string;
  /** 修改建议 */
  suggestion: string;
}

export interface CoherenceCheckResult {
  /** 检查状态 */
  status: "COHERENT" | "ISSUES_FOUND";
  /** 连贯性评分 (0-100) */
  score: number;
  /** 发现的问题 */
  issues: CoherenceIssue[];
  /** 情节线索追踪 */
  plotThreads: {
    thread: string;
    status: "ONGOING" | "RESOLVED" | "ABANDONED";
    introducedAt: number; // 章节号
    lastMentionedAt: number;
  }[];
  /** 角色弧光追踪 */
  characterArcs: {
    character: string;
    currentState: string;
    progression: string;
    consistency: "CONSISTENT" | "INCONSISTENT" | "STAGNANT";
  }[];
  /** 检查摘要 */
  summary: string;
}

export interface ChapterPair {
  fromChapter: {
    number: number;
    title: string;
    endingContent: string; // 章节结尾 1000 字
    outline?: string;
  };
  toChapter: {
    number: number;
    title: string;
    openingContent: string; // 章节开头 1000 字
    outline?: string;
  };
}

@Injectable()
export class ChapterCoherenceService {
  private readonly logger = new Logger(ChapterCoherenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * 检查单个章节与前一章节的连贯性
   */
  async checkChapterTransition(
    chapterId: string,
    modelId = "",
  ): Promise<CoherenceCheckResult> {
    const chapter = await this.prisma.writingChapter.findUnique({
      where: { id: chapterId },
      include: {
        volume: {
          include: {
            chapters: {
              orderBy: { chapterNumber: "asc" },
              select: {
                id: true,
                chapterNumber: true,
                title: true,
                content: true,
                outline: true,
              },
            },
          },
        },
      },
    });

    if (!chapter) {
      throw new Error("Chapter not found");
    }

    // 找到前一章
    const previousChapter = chapter.volume.chapters.find(
      (c) => c.chapterNumber === chapter.chapterNumber - 1,
    );

    if (!previousChapter?.content || !chapter.content) {
      return {
        status: "COHERENT",
        score: 100,
        issues: [],
        plotThreads: [],
        characterArcs: [],
        summary: "无法检查：缺少前一章或当前章内容",
      };
    }

    const chapterPair: ChapterPair = {
      fromChapter: {
        number: previousChapter.chapterNumber,
        title: previousChapter.title,
        endingContent: previousChapter.content.slice(-1500),
        outline: previousChapter.outline || undefined,
      },
      toChapter: {
        number: chapter.chapterNumber,
        title: chapter.title,
        openingContent: chapter.content.slice(0, 1500),
        outline: chapter.outline || undefined,
      },
    };

    return this.analyzeCoherence(chapterPair, modelId);
  }

  /**
   * 检查整卷的章节连贯性
   */
  async checkVolumeCoherence(
    volumeId: string,
    modelId = "",
  ): Promise<{
    volumeScore: number;
    chapterResults: Array<{
      fromChapter: number;
      toChapter: number;
      score: number;
      issues: CoherenceIssue[];
    }>;
    overallIssues: CoherenceIssue[];
    plotThreadsSummary: CoherenceCheckResult["plotThreads"];
  }> {
    const volume = await this.prisma.writingVolume.findUnique({
      where: { id: volumeId },
      include: {
        chapters: {
          where: { content: { not: null } },
          orderBy: { chapterNumber: "asc" },
          select: {
            id: true,
            chapterNumber: true,
            title: true,
            content: true,
            outline: true,
          },
        },
      },
    });

    if (!volume || volume.chapters.length < 2) {
      return {
        volumeScore: 100,
        chapterResults: [],
        overallIssues: [],
        plotThreadsSummary: [],
      };
    }

    const chapterResults: Array<{
      fromChapter: number;
      toChapter: number;
      score: number;
      issues: CoherenceIssue[];
    }> = [];

    const allIssues: CoherenceIssue[] = [];
    const allPlotThreads: Map<string, CoherenceCheckResult["plotThreads"][0]> =
      new Map();

    // 逐对检查相邻章节
    for (let i = 1; i < volume.chapters.length; i++) {
      const fromChapter = volume.chapters[i - 1];
      const toChapter = volume.chapters[i];

      const chapterPair: ChapterPair = {
        fromChapter: {
          number: fromChapter.chapterNumber,
          title: fromChapter.title,
          endingContent: (fromChapter.content || "").slice(-1500),
          outline: fromChapter.outline || undefined,
        },
        toChapter: {
          number: toChapter.chapterNumber,
          title: toChapter.title,
          openingContent: (toChapter.content || "").slice(0, 1500),
          outline: toChapter.outline || undefined,
        },
      };

      const result = await this.analyzeCoherence(chapterPair, modelId);

      chapterResults.push({
        fromChapter: fromChapter.chapterNumber,
        toChapter: toChapter.chapterNumber,
        score: result.score,
        issues: result.issues,
      });

      allIssues.push(...result.issues);

      // 合并情节线索追踪
      for (const thread of result.plotThreads) {
        const existing = allPlotThreads.get(thread.thread);
        if (existing) {
          existing.lastMentionedAt = Math.max(
            existing.lastMentionedAt,
            thread.lastMentionedAt,
          );
          if (thread.status === "RESOLVED") {
            existing.status = "RESOLVED";
          }
        } else {
          allPlotThreads.set(thread.thread, { ...thread });
        }
      }
    }

    // 检查整体情节线索问题（跨多章节）
    const overallIssues = await this.checkOverallPlotThreads(
      volume.chapters,
      modelId,
    );

    // 计算总体评分
    const volumeScore =
      chapterResults.length > 0
        ? Math.round(
            chapterResults.reduce((sum, r) => sum + r.score, 0) /
              chapterResults.length,
          )
        : 100;

    this.logger.log(
      `[ChapterCoherence] Volume ${volumeId} check completed: score=${volumeScore}, issues=${allIssues.length}`,
    );

    return {
      volumeScore,
      chapterResults,
      overallIssues: [...allIssues, ...overallIssues],
      plotThreadsSummary: Array.from(allPlotThreads.values()),
    };
  }

  /**
   * 分析两个章节之间的连贯性
   */
  private async analyzeCoherence(
    pair: ChapterPair,
    modelId: string,
  ): Promise<CoherenceCheckResult> {
    const systemPrompt = `你是专业的小说编辑，擅长分析章节之间的情节连贯性。

## 分析维度

1. **情节连续性** (PLOT_DISCONTINUITY)
   - 前一章结尾的情节是否在下一章得到延续
   - 时间线是否连贯（没有莫名的时间跳跃）
   - 场景转换是否自然

2. **角色弧光** (CHARACTER_ARC_BREAK)
   - 角色的情绪/状态是否连贯
   - 角色的行为动机是否一致
   - 角色间的关系发展是否自然

3. **情节线索** (UNRESOLVED_THREAD / MISSING_SETUP)
   - 前章设置的悬念是否得到回应
   - 新情节是否有足够铺垫
   - 伏笔的设置与回收

4. **转场质量** (ABRUPT_TRANSITION)
   - 场景切换是否流畅
   - 是否有生硬的跳转
   - POV (视角) 切换是否自然

5. **节奏问题** (PACING_ISSUE)
   - 情节推进速度是否合理
   - 是否有过于急促或拖沓的感觉

## 输出格式 (JSON)

{
  "score": 85,  // 连贯性评分 0-100
  "issues": [
    {
      "type": "PLOT_DISCONTINUITY",
      "severity": "WARNING",
      "chapters": [3, 4],
      "description": "第3章结尾主角正在战斗，第4章开头却在家中休息，缺少过渡",
      "reference": "第3章末: '他举起剑...' → 第4章开: '清晨的阳光...'",
      "suggestion": "在第4章开头增加战斗结束后的过渡段落"
    }
  ],
  "plotThreads": [
    {
      "thread": "神秘信件的来源",
      "status": "ONGOING",
      "introducedAt": 3,
      "lastMentionedAt": 4
    }
  ],
  "characterArcs": [
    {
      "character": "主角",
      "currentState": "对真相产生怀疑",
      "progression": "从坚定信念到开始动摇",
      "consistency": "CONSISTENT"
    }
  ],
  "summary": "整体连贯性良好，但第3-4章之间的战斗场景过渡需要补充"
}`;

    const userPrompt = `请分析以下两个相邻章节之间的连贯性：

## 第${pair.fromChapter.number}章：${pair.fromChapter.title}
${pair.fromChapter.outline ? `大纲：${pair.fromChapter.outline}\n` : ""}
【章节结尾】
${pair.fromChapter.endingContent}

---

## 第${pair.toChapter.number}章：${pair.toChapter.title}
${pair.toChapter.outline ? `大纲：${pair.toChapter.outline}\n` : ""}
【章节开头】
${pair.toChapter.openingContent}

请分析这两章之间的连贯性，输出 JSON 格式的分析结果。`;

    try {
      // 使用 TaskProfile 语义化描述任务特征
      const taskProfile: TaskProfile = {
        creativity: "low", // 连贯性分析需要客观准确 (原 temperature: 0.3)
        outputLength: "medium", // 分析结果需要中等长度 (原 maxTokens: 3000)
      };

      const response = await this.chatFacade.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        model: modelId,
        taskProfile,
      });

      const content = response.content || "{}";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        this.logger.warn(
          `[ChapterCoherence] Failed to parse response for chapters ${pair.fromChapter.number}-${pair.toChapter.number}`,
        );
        return this.getDefaultResult();
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        status: (parsed.issues?.length || 0) > 0 ? "ISSUES_FOUND" : "COHERENT",
        score: parsed.score || 80,
        issues: (parsed.issues || []).map((issue: Partial<CoherenceIssue>) => ({
          type: issue.type || "PLOT_DISCONTINUITY",
          severity: issue.severity || "WARNING",
          chapters: issue.chapters || [
            pair.fromChapter.number,
            pair.toChapter.number,
          ],
          description: issue.description || "",
          reference: issue.reference,
          suggestion: issue.suggestion || "",
        })),
        plotThreads: parsed.plotThreads || [],
        characterArcs: parsed.characterArcs || [],
        summary: parsed.summary || "",
      };
    } catch (error) {
      this.logger.error(
        `[ChapterCoherence] Analysis failed: ${(error as Error).message}`,
      );
      return this.getDefaultResult();
    }
  }

  /**
   * 检查整体情节线索（跨多章节）
   */
  private async checkOverallPlotThreads(
    chapters: Array<{
      chapterNumber: number;
      title: string;
      content: string | null;
      outline: string | null;
    }>,
    modelId: string,
  ): Promise<CoherenceIssue[]> {
    if (chapters.length < 3) {
      return [];
    }

    // 构建章节摘要
    const chapterSummaries = chapters
      .map((ch) => {
        const content = ch.content || "";
        // 取开头和结尾各500字
        const summary =
          content.length > 1200
            ? `${content.slice(0, 500)}...[中间省略]...${content.slice(-500)}`
            : content;
        return `第${ch.chapterNumber}章 ${ch.title}:\n${ch.outline || "无大纲"}\n摘要: ${summary.slice(0, 800)}`;
      })
      .join("\n\n---\n\n");

    const systemPrompt = `你是专业的小说结构分析师。分析多个章节，识别以下问题：

1. **被遗忘的情节线** - 开头设置但后续完全没有提及的线索
2. **悬念超时** - 悬念设置后太久没有解答
3. **突然冒出的设定** - 没有任何铺垫就出现的重要设定
4. **角色消失** - 重要角色莫名消失，没有交代

仅输出发现的问题，JSON 数组格式：
[{
  "type": "UNRESOLVED_THREAD|MISSING_SETUP",
  "severity": "CRITICAL|WARNING|INFO",
  "chapters": [1, 5],  // 涉及的章节
  "description": "问题描述",
  "suggestion": "修改建议"
}]

如果没有问题，返回 []`;

    try {
      // 使用 TaskProfile 语义化描述任务特征
      const taskProfile: TaskProfile = {
        creativity: "low", // 整体情节分析需要客观准确 (原 temperature: 0.3)
        outputLength: "short", // 整体问题输出较短 (原 maxTokens: 2000)
      };

      const response = await this.chatFacade.chat({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `请分析以下${chapters.length}个章节的整体情节连贯性：\n\n${chapterSummaries}`,
          },
        ],
        model: modelId,
        taskProfile,
      });

      const content = response.content || "[]";
      const jsonMatch = content.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        return [];
      }

      return JSON.parse(jsonMatch[0]) as CoherenceIssue[];
    } catch (error) {
      this.logger.error(
        `[ChapterCoherence] Overall check failed: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * 快速检查：仅检查最近写的章节与前章的连贯性
   * 适合在写作流程中实时调用
   */
  async quickCoherenceCheck(
    chapterId: string,
  ): Promise<{ score: number; criticalIssues: CoherenceIssue[] }> {
    const result = await this.checkChapterTransition(chapterId);

    return {
      score: result.score,
      criticalIssues: result.issues.filter(
        (issue) => issue.severity === "CRITICAL",
      ),
    };
  }

  /**
   * 获取默认结果（用于错误处理）
   */
  private getDefaultResult(): CoherenceCheckResult {
    return {
      status: "COHERENT",
      score: 80,
      issues: [],
      plotThreads: [],
      characterArcs: [],
      summary: "分析完成，未发现明显问题",
    };
  }

  /**
   * 保存连贯性检查结果到数据库
   */
  async saveCoherenceCheck(
    chapterId: string,
    result: CoherenceCheckResult,
  ): Promise<void> {
    await this.prisma.consistencyCheck.create({
      data: {
        chapterId,
        checkType: "PLOT", // 复用现有的 checkType
        status:
          result.status === "COHERENT"
            ? "PASSED"
            : result.issues.some((i) => i.severity === "CRITICAL")
              ? "ISSUES_FOUND"
              : "PASSED",
        issues: result.issues as object[],
        suggestions: result.issues.map((i) => ({
          issue: i.description,
          suggestion: i.suggestion,
        })),
      },
    });

    this.logger.log(
      `[ChapterCoherence] Saved coherence check for chapter ${chapterId}: score=${result.score}`,
    );
  }
}
