import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { StoryBibleService } from "../bible/story-bible.service";
import { ToolFacade } from "@/modules/ai-harness/facade";

/**
 * Context Builder Service
 *
 * 负责为章节写作构建上下文信息，包括：
 * - Story Bible 快照
 * - 前文章节上下文
 * - 跨卷关键情节
 * - ★ NEW: 写作技能提示（从 AICapabilityResolver）
 */
@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storyBibleService: StoryBibleService,
    private readonly toolFacade: ToolFacade,
  ) {
    void this.logger;
  }

  /**
   * ★ NEW: 获取写作上下文相关的技能提示
   * 可用于增强写作提示词
   */
  async getContextSkillPrompts(projectId: string): Promise<string> {
    try {
      const skillPrompts = await this.toolFacade.capabilityGetSkillPrompts({
        domain: "writing",
        agentId: projectId,
      });

      if (skillPrompts && skillPrompts.content) {
        this.logger.debug(
          `[ContextBuilder] Loaded ${skillPrompts.usedSkills.length} writing skills for context`,
        );
        return skillPrompts.content;
      }

      return "";
    } catch (error) {
      this.logger.warn(
        `[ContextBuilder] Failed to load skill prompts: ${(error as Error).message}`,
      );
      return "";
    }
  }

  async buildWritingContext(
    chapterId: string,
    bibleSnapshot?: Record<string, unknown>,
  ) {
    const chapter = await this.prisma.writingChapter.findUnique({
      where: { id: chapterId },
      include: {
        volume: {
          include: {
            project: {
              include: { storyBible: true },
            },
          },
        },
      },
    });

    if (!chapter) {
      throw new Error("Chapter not found");
    }

    const bible =
      bibleSnapshot ||
      (await this.storyBibleService.getSnapshot(chapter.volume.project.id));

    // Get previous chapters for context
    const previousChapters = await this.getPreviousChapterContext(
      chapter.volumeId,
      chapter.chapterNumber,
    );

    return {
      chapter: {
        id: chapter.id,
        title: chapter.title,
        outline: chapter.outline,
        chapterNumber: chapter.chapterNumber,
      },
      characters: bible.characters,
      worldSettings: bible.worldSettings,
      terminology: bible.terminologies,
      timeline: bible.timelineEvents,
      previousContext: previousChapters,
    };
  }

  /**
   * 获取前文上下文（扩展版本）
   *
   * 策略：
   * - 最近 3 章：每章 2000 字（关键上下文）
   * - 前 3-6 章：每章 800 字（次要上下文）
   * - 更早章节：每章 300 字摘要（远期背景）
   * - 目标总量：8000+ 字上下文
   */
  async getPreviousChapterContext(
    volumeId: string,
    currentChapterNumber: number,
  ) {
    // 获取所有前文章节
    const allPreviousChapters = await this.prisma.writingChapter.findMany({
      where: {
        volumeId,
        chapterNumber: { lt: currentChapterNumber },
        content: { not: null },
      },
      orderBy: { chapterNumber: "desc" },
      select: {
        chapterNumber: true,
        title: true,
        content: true,
      },
    });

    const result: Array<{
      chapterNumber: number;
      title: string;
      context: string;
      contextType: "recent" | "medium" | "distant";
    }> = [];

    for (let i = 0; i < allPreviousChapters.length; i++) {
      const ch = allPreviousChapters[i];
      const content = ch.content || "";

      let contextLength: number;
      let contextType: "recent" | "medium" | "distant";

      if (i < 3) {
        // 最近 3 章：2000 字（详细上下文）
        contextLength = 2000;
        contextType = "recent";
      } else if (i < 6) {
        // 前 3-6 章：800 字（中等上下文）
        contextLength = 800;
        contextType = "medium";
      } else if (i < 12) {
        // 更早章节：300 字摘要（远期背景）
        contextLength = 300;
        contextType = "distant";
      } else {
        // 超过 12 章前的内容跳过（依赖 Story Bible 维护一致性）
        break;
      }

      // 智能截取：优先保留结尾（最新情节）
      let context: string;
      if (content.length <= contextLength) {
        context = content;
      } else {
        // 取结尾部分，但尝试在句号处截断
        const endPart = content.slice(-contextLength - 100);
        const sentenceEnd = endPart.indexOf("。");
        if (sentenceEnd > 0 && sentenceEnd < 100) {
          context = endPart.slice(sentenceEnd + 1);
        } else {
          context = content.slice(-contextLength);
        }
      }

      result.push({
        chapterNumber: ch.chapterNumber,
        title: ch.title,
        context: context.trim(),
        contextType,
      });
    }

    this.logger.log(
      `[ContextBuilder] Built context for chapter ${currentChapterNumber}: ` +
        `${result.filter((r) => r.contextType === "recent").length} recent, ` +
        `${result.filter((r) => r.contextType === "medium").length} medium, ` +
        `${result.filter((r) => r.contextType === "distant").length} distant chapters`,
    );

    return result;
  }

  /**
   * 获取跨卷的关键情节上下文
   * 用于长篇小说跨卷一致性
   */
  async getCrossVolumeContext(projectId: string, currentVolumeNumber: number) {
    // 获取前几卷的关键章节（每卷取首尾章）
    const previousVolumes = await this.prisma.writingVolume.findMany({
      where: {
        projectId,
        volumeNumber: { lt: currentVolumeNumber },
      },
      orderBy: { volumeNumber: "desc" },
      take: 3,
      include: {
        chapters: {
          where: { content: { not: null } },
          orderBy: { chapterNumber: "asc" },
          select: {
            chapterNumber: true,
            title: true,
            content: true,
          },
        },
      },
    });

    const keyContexts: Array<{
      volumeNumber: number;
      volumeTitle: string;
      keyPoints: string[];
    }> = [];

    for (const volume of previousVolumes) {
      if (volume.chapters.length === 0) continue;

      const keyPoints: string[] = [];
      const chapters = volume.chapters;

      // 取首章开头 500 字
      if (chapters[0]?.content) {
        keyPoints.push(`开篇：${chapters[0].content.slice(0, 500)}...`);
      }

      // 取末章结尾 500 字
      const lastChapter = chapters[chapters.length - 1];
      if (lastChapter?.content && chapters.length > 1) {
        keyPoints.push(`结尾：...${lastChapter.content.slice(-500)}`);
      }

      keyContexts.push({
        volumeNumber: volume.volumeNumber,
        volumeTitle: volume.title,
        keyPoints,
      });
    }

    return keyContexts;
  }

  formatWriterPrompt(context: Record<string, unknown>): string {
    const sections = [];

    const chapter = context.chapter as Record<string, unknown>;
    sections.push(
      `## 章节任务\n标题：${chapter.title}\n大纲：${chapter.outline || "无"}`,
    );

    const characters = context.characters as
      | Array<Record<string, unknown>>
      | undefined;
    if (characters && characters.length > 0) {
      sections.push(`## 本章涉及角色\n${this.formatCharacters(characters)}`);
    }

    const worldSettings = context.worldSettings as
      | Array<Record<string, unknown>>
      | undefined;
    if (worldSettings && worldSettings.length > 0) {
      sections.push(`## 场景设定\n${this.formatWorldSettings(worldSettings)}`);
    }

    const previousContext = context.previousContext as
      | Array<Record<string, unknown>>
      | undefined;
    if (previousContext && previousContext.length > 0) {
      sections.push(
        `## 前情提要\n${this.formatPreviousContext(previousContext)}`,
      );
    }

    return sections.join("\n\n");
  }

  private formatCharacters(characters: Array<Record<string, unknown>>): string {
    return characters
      .map(
        (c) =>
          `### ${c.name}\n- 角色：${c.role}\n- 外貌：${JSON.stringify(c.appearance)}\n- 性格：${JSON.stringify(c.personality)}`,
      )
      .join("\n\n");
  }

  private formatWorldSettings(
    settings: Array<Record<string, unknown>>,
  ): string {
    return settings
      .map((s) => `### ${s.name} (${s.category})\n${s.description}`)
      .join("\n\n");
  }

  private formatPreviousContext(
    chapters: Array<Record<string, unknown>>,
  ): string {
    // 按上下文类型分组格式化
    const recent = chapters.filter((ch) => ch.contextType === "recent");
    const medium = chapters.filter((ch) => ch.contextType === "medium");
    const distant = chapters.filter((ch) => ch.contextType === "distant");
    // 兼容旧格式（无 contextType）
    const legacy = chapters.filter((ch) => !ch.contextType);

    const sections: string[] = [];

    if (recent.length > 0) {
      sections.push("### 最近章节（详细）");
      sections.push(
        recent
          .map((ch) => `**第${ch.chapterNumber}章 ${ch.title}**\n${ch.context}`)
          .join("\n\n"),
      );
    }

    if (medium.length > 0) {
      sections.push("### 前文要点");
      sections.push(
        medium
          .map((ch) => `第${ch.chapterNumber}章 ${ch.title}：${ch.context}...`)
          .join("\n\n"),
      );
    }

    if (distant.length > 0) {
      sections.push("### 早期背景");
      sections.push(
        distant
          .map((ch) => `第${ch.chapterNumber}章 ${ch.title}：${ch.context}...`)
          .join("\n"),
      );
    }

    if (legacy.length > 0) {
      sections.push(
        legacy
          .map((ch) => `第${ch.chapterNumber}章 ${ch.title}：${ch.context}...`)
          .join("\n\n"),
      );
    }

    return sections.join("\n\n");
  }
}
