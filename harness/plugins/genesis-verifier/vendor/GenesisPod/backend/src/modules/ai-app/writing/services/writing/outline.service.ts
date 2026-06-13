import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { StoryBibleService } from "../bible/story-bible.service";

export interface ChapterOutline {
  chapterNumber: number;
  title: string;
  plot: string;
  keyPoint?: string;
  characters: string[];
  location?: string;
}

export interface VolumeOutline {
  volumeNumber: number;
  volumeTitle: string;
  theme: string;
  chapters: ChapterOutline[];
}

@Injectable()
export class OutlineService {
  private readonly _logger = new Logger(OutlineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
    private readonly storyBibleService: StoryBibleService,
  ) {}

  /**
   * 使用 AI 生成卷大纲
   *
   * @param projectId 项目ID
   * @param volumeNumber 卷号
   * @param chapterCount 章节数量
   * @param modelId 使用的AI模型
   */
  async generateOutline(
    projectId: string,
    volumeNumber: number,
    chapterCount: number,
    _modelId: string = "", // 保留参数用于未来扩展
  ): Promise<VolumeOutline> {
    this._logger.log(
      `Generating outline for project ${projectId}, volume ${volumeNumber}, ${chapterCount} chapters`,
    );

    // 1. 获取项目信息和 Story Bible
    const project = await this.prisma.writingProject.findUnique({
      where: { id: projectId },
      include: { storyBible: true },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    // 2. 获取 Story Bible 快照
    const bibleSnapshot = await this.storyBibleService.getSnapshot(projectId);

    // 3. 获取前几卷的大纲（如果有）
    const previousVolumes = await this.prisma.writingVolume.findMany({
      where: {
        projectId,
        volumeNumber: { lt: volumeNumber },
      },
      include: {
        chapters: {
          orderBy: { chapterNumber: "asc" },
          select: { title: true, outline: true },
        },
      },
      orderBy: { volumeNumber: "asc" },
    });

    const previousOutlineContext = previousVolumes
      .map(
        (v) =>
          `第${v.volumeNumber}卷 ${v.title}:\n` +
          v.chapters
            .map((c) => `- ${c.title}: ${c.outline || "无"}`)
            .join("\n"),
      )
      .join("\n\n");

    // 4. 构建大纲生成上下文
    const projectInfo = `标题：${project.name}
简介：${project.description || "无"}
类型：${project.genre || "通用"}
目标字数：${project.targetWords?.toLocaleString() || "未设定"} 字`;

    const worldSetting = `${bibleSnapshot.premise || "无"}
基调：${bibleSnapshot.tone || "未设定"}
主题：${bibleSnapshot.theme || "未设定"}`;

    const characters =
      bibleSnapshot.characters
        ?.slice(0, 5)
        .map((c: Record<string, unknown>) => {
          const personality = c.personality as Record<string, unknown> | null;
          const traits = personality?.traits as string[] | undefined;
          return `- ${c.name} (${c.role}): ${traits?.join("、") || "性格待定"}`;
        })
        .join("\n") || "无";

    const requirements = `1. 生成 ${chapterCount} 个章节的大纲
2. 每章大纲包含：标题、主要情节、关键转折点、涉及角色
3. 情节要有递进，避免重复
4. 角色要有成长和变化
5. 设置悬念和伏笔`;

    try {
      // ★ P3 迁移：使用 chatWithSkills 统一入口
      const response = await this.chatFacade.chatWithSkills({
        messages: [
          {
            role: "user",
            content: `请为小说生成第${volumeNumber}卷的详细章节大纲。`,
          },
        ],
        domain: "writing",
        taskProfile: {
          creativity: "medium", // 大纲创作需要平衡创造性和结构性
          outputLength: "long", // 大纲需要详细输出
        },
        skillContext: {
          projectInfo,
          worldSetting,
          characters,
          previousOutline: previousOutlineContext || undefined,
          requirements,
        },
      });

      // 5. 解析 AI 响应
      const content = response.content || "{}";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error("Failed to parse outline JSON");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const outline: VolumeOutline = {
        volumeNumber,
        volumeTitle: parsed.volumeTitle || `第${volumeNumber}卷`,
        theme: parsed.theme || "",
        chapters: (parsed.chapters || []).map(
          (ch: Partial<ChapterOutline>, index: number) => ({
            chapterNumber: ch.chapterNumber || index + 1,
            title: ch.title || `第${index + 1}章`,
            plot: ch.plot || "",
            keyPoint: ch.keyPoint,
            characters: ch.characters || [],
            location: ch.location,
          }),
        ),
      };

      this._logger.log(
        `Generated outline for volume ${volumeNumber}: ${outline.chapters.length} chapters`,
      );

      return outline;
    } catch (error) {
      this._logger.error(
        `Failed to generate outline: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * 将生成的大纲保存到数据库
   */
  async saveOutlineToDatabase(
    projectId: string,
    volumeNumber: number,
    outline: VolumeOutline,
  ): Promise<void> {
    // 1. 创建或更新卷
    const volume = await this.prisma.writingVolume.upsert({
      where: {
        projectId_volumeNumber: {
          projectId,
          volumeNumber,
        },
      },
      create: {
        projectId,
        volumeNumber,
        title: outline.volumeTitle,
      },
      update: {
        title: outline.volumeTitle,
      },
    });

    // 2. 创建章节
    for (const chapter of outline.chapters) {
      // 构建更丰富的纲要内容
      const outlineContent = [
        chapter.plot,
        chapter.keyPoint ? `【关键转折】${chapter.keyPoint}` : null,
        chapter.characters?.length
          ? `【涉及角色】${chapter.characters.join("、")}`
          : null,
        chapter.location ? `【场景】${chapter.location}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      await this.prisma.writingChapter.upsert({
        where: {
          volumeId_chapterNumber: {
            volumeId: volume.id,
            chapterNumber: chapter.chapterNumber,
          },
        },
        create: {
          volumeId: volume.id,
          chapterNumber: chapter.chapterNumber,
          title: chapter.title,
          outline: outlineContent,
          status: "OUTLINING",
        },
        update: {
          title: chapter.title,
          outline: outlineContent,
        },
      });
    }

    this._logger.log(
      `Saved outline to database: volume ${volumeNumber}, ${outline.chapters.length} chapters`,
    );
  }

  async updateChapterOutline(chapterId: string, outline: string) {
    return this.prisma.writingChapter.update({
      where: { id: chapterId },
      data: {
        outline,
        status: "OUTLINING",
      },
    });
  }

  async analyzeOutlineDependencies(volumeId: string) {
    const chapters = await this.prisma.writingChapter.findMany({
      where: { volumeId },
      orderBy: { chapterNumber: "asc" },
      select: {
        id: true,
        chapterNumber: true,
        title: true,
        outline: true,
        dependsOn: true,
      },
    });

    // Analyze and suggest dependencies based on outline content
    return chapters.map((chapter) => ({
      ...chapter,
      suggestedDependencies: this.suggestDependencies(chapter, chapters),
    }));
  }

  private suggestDependencies(chapter: unknown, allChapters: unknown[]) {
    // Simple heuristic: depend on previous chapter
    const c = chapter as Record<string, unknown>;
    const previousChapter = allChapters.find(
      (ch) =>
        (ch as Record<string, unknown>)["chapterNumber"] ===
        (c["chapterNumber"] as number) - 1,
    );
    return previousChapter
      ? [(previousChapter as Record<string, unknown>)["id"] as string]
      : [];
  }
}
