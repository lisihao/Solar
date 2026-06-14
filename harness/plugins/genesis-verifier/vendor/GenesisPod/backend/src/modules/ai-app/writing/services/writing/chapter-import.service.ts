import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ImportSource, ImportStatus } from "@prisma/client";
import {
  ParseImportDto,
  ConfirmImportDto,
  ChapterPreview,
  ParseResultResponse,
  ImportStatusResponse,
  ImportHistoryItem,
  ChapterPatternType,
} from "../../dto/chapter-import.dto";
import { ChapterRevisionService } from "./chapter-revision.service";

// 章节识别正则模式
const CHAPTER_PATTERNS: Record<string, RegExp> = {
  standard_chinese: /^第[一二三四五六七八九十百千零\d]+章[\s:：]*.*/gm,
  chapter_number: /^Chapter\s*\d+[:.：]?\s*.*/gim,
  numbered: /^\d+[.、．]\s*.+/gm,
  custom_bracket: /^[【\[].*[】\]]/gm,
};

@Injectable()
export class ChapterImportService {
  private readonly logger = new Logger(ChapterImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chapterRevisionService: ChapterRevisionService,
  ) {}

  /**
   * 解析导入内容，返回章节预览
   */
  async parseImport(
    projectId: string,
    userId: string,
    dto: ParseImportDto,
  ): Promise<ParseResultResponse> {
    await this.verifyProjectAccess(projectId, userId);

    let rawContent: string;

    // 根据来源获取内容
    switch (dto.source) {
      case ImportSource.PASTE:
        if (!dto.content) {
          throw new BadRequestException("Content is required for paste import");
        }
        rawContent = dto.content;
        break;

      case ImportSource.FILE_TXT:
      case ImportSource.FILE_MD:
        if (!dto.content) {
          throw new BadRequestException("File content is required");
        }
        rawContent = dto.content;
        break;

      case ImportSource.FILE_DOCX:
      case ImportSource.FILE_EPUB:
        // 这些格式需要前端先解析后传入
        if (!dto.content) {
          throw new BadRequestException(
            "Parsed content is required for this file type",
          );
        }
        rawContent = dto.content;
        break;

      default:
        throw new BadRequestException(
          `Unsupported import source: ${dto.source}`,
        );
    }

    // 解析章节
    const chapters = this.parseChapters(
      rawContent,
      dto.chapterPattern || "auto",
      dto.customPattern,
    );

    if (chapters.length === 0) {
      throw new BadRequestException(
        "No chapters detected. Please check the content format or try a different chapter pattern.",
      );
    }

    // 计算总字数
    const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);

    // 创建导入记录
    const importRecord = await this.prisma.chapterImport.create({
      data: {
        projectId,
        source: dto.source,
        sourceUrl: dto.sourceUrl,
        fileName: dto.fileName,
        totalChapters: chapters.length,
        totalWords,
        status: ImportStatus.PREVIEWING,
        parsedChapters: JSON.parse(JSON.stringify(chapters)),
      },
    });

    this.logger.log(
      `Import ${importRecord.id} parsed: ${chapters.length} chapters, ${totalWords} words`,
    );

    return {
      success: true,
      importId: importRecord.id,
      preview: {
        totalChapters: chapters.length,
        totalWords,
        chapters: chapters.map((ch) => ({
          ...ch,
          preview:
            ch.content.substring(0, 200) +
            (ch.content.length > 200 ? "..." : ""),
        })),
      },
    };
  }

  /**
   * 确认并执行导入
   */
  async confirmImport(
    projectId: string,
    importId: string,
    userId: string,
    dto: ConfirmImportDto,
  ): Promise<{ success: boolean; importId: string }> {
    await this.verifyProjectAccess(projectId, userId);

    const importRecord = await this.prisma.chapterImport.findUnique({
      where: { id: importId },
    });

    if (!importRecord) {
      throw new NotFoundException("Import record not found");
    }

    if (importRecord.projectId !== projectId) {
      throw new ForbiddenException("Import does not belong to this project");
    }

    if (importRecord.status !== ImportStatus.PREVIEWING) {
      throw new BadRequestException(
        `Cannot confirm import in status: ${importRecord.status}`,
      );
    }

    // 验证目标卷存在
    const targetVolume = await this.prisma.writingVolume.findUnique({
      where: { id: dto.targetVolumeId },
      include: {
        project: { select: { ownerId: true } },
        chapters: { select: { chapterNumber: true } },
      },
    });

    if (!targetVolume) {
      throw new NotFoundException("Target volume not found");
    }

    if (targetVolume.project.ownerId !== userId) {
      throw new ForbiddenException("Access denied to target volume");
    }

    // 更新状态为导入中
    await this.prisma.chapterImport.update({
      where: { id: importId },
      data: { status: ImportStatus.IMPORTING },
    });

    // 异步执行导入
    void this.executeImport(
      importId,
      dto,
      targetVolume.chapters.map((c) => c.chapterNumber),
    ).catch((error) => {
      this.logger.error(`Import ${importId} failed:`, error);
      void this.prisma.chapterImport.update({
        where: { id: importId },
        data: {
          status: ImportStatus.FAILED,
          errors: [{ chapter: "all", error: error.message }],
        },
      });
    });

    return { success: true, importId };
  }

  /**
   * 获取导入状态
   */
  async getImportStatus(
    projectId: string,
    importId: string,
    userId: string,
  ): Promise<ImportStatusResponse> {
    await this.verifyProjectAccess(projectId, userId);

    const importRecord = await this.prisma.chapterImport.findUnique({
      where: { id: importId },
    });

    if (!importRecord) {
      throw new NotFoundException("Import record not found");
    }

    if (importRecord.projectId !== projectId) {
      throw new ForbiddenException("Import does not belong to this project");
    }

    return this.mapToStatusResponse(importRecord);
  }

  /**
   * 获取导入历史
   */
  async getImportHistory(
    projectId: string,
    userId: string,
  ): Promise<{ items: ImportHistoryItem[]; total: number }> {
    await this.verifyProjectAccess(projectId, userId);

    const [items, total] = await Promise.all([
      this.prisma.chapterImport.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.chapterImport.count({ where: { projectId } }),
    ]);

    return {
      items: items.map((i) => ({
        id: i.id,
        source: i.source,
        fileName: i.fileName,
        sourceUrl: i.sourceUrl,
        totalChapters: i.totalChapters,
        totalWords: i.totalWords,
        status: i.status,
        importedChapterIds: i.importedChapterIds,
        createdAt: i.createdAt,
        completedAt: i.completedAt,
      })),
      total,
    };
  }

  /**
   * 取消导入
   */
  async cancelImport(
    projectId: string,
    importId: string,
    userId: string,
  ): Promise<{ success: boolean }> {
    await this.verifyProjectAccess(projectId, userId);

    const importRecord = await this.prisma.chapterImport.findUnique({
      where: { id: importId },
    });

    if (!importRecord) {
      throw new NotFoundException("Import record not found");
    }

    if (importRecord.projectId !== projectId) {
      throw new ForbiddenException("Import does not belong to this project");
    }

    if (
      importRecord.status === ImportStatus.COMPLETED ||
      importRecord.status === ImportStatus.FAILED
    ) {
      throw new BadRequestException("Cannot cancel completed or failed import");
    }

    await this.prisma.chapterImport.delete({
      where: { id: importId },
    });

    this.logger.log(`Import ${importId} cancelled`);

    return { success: true };
  }

  // ==================== Private Methods ====================

  private async verifyProjectAccess(projectId: string, userId: string) {
    const project = await this.prisma.writingProject.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.ownerId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    return project;
  }

  private parseChapters(
    content: string,
    patternType: ChapterPatternType,
    customPattern?: string,
  ): ChapterPreview[] {
    let pattern: RegExp;

    if (patternType === "auto") {
      // 自动检测最佳模式
      pattern = this.detectBestPattern(content);
    } else if (patternType === "custom" && customPattern) {
      try {
        pattern = new RegExp(customPattern, "gm");
      } catch {
        throw new BadRequestException("Invalid custom pattern");
      }
    } else {
      pattern =
        CHAPTER_PATTERNS[patternType] || CHAPTER_PATTERNS.standard_chinese;
    }

    // 查找所有章节标题
    const matches: { title: string; index: number }[] = [];
    let match: RegExpExecArray | null;

    // 重置 lastIndex
    pattern.lastIndex = 0;

    while ((match = pattern.exec(content)) !== null) {
      matches.push({
        title: match[0].trim(),
        index: match.index,
      });
    }

    if (matches.length === 0) {
      // 如果没有找到章节，将整个内容作为一章
      return [
        {
          index: 0,
          title: "导入内容",
          wordCount: this.countWords(content),
          preview: content.substring(0, 200),
          content: content.trim(),
        },
      ];
    }

    // 提取每章内容
    const chapters: ChapterPreview[] = [];

    for (let i = 0; i < matches.length; i++) {
      const currentMatch = matches[i];
      const nextMatch = matches[i + 1];

      const startIndex = currentMatch.index;
      const endIndex = nextMatch ? nextMatch.index : content.length;

      const chapterContent = content.substring(startIndex, endIndex).trim();

      // 从章节内容中移除标题行，获取纯内容
      const titleEndIndex = chapterContent.indexOf("\n");
      const pureContent =
        titleEndIndex > 0
          ? chapterContent.substring(titleEndIndex).trim()
          : chapterContent;

      chapters.push({
        index: i,
        title: this.extractChapterTitle(currentMatch.title),
        wordCount: this.countWords(pureContent),
        preview: pureContent.substring(0, 200),
        content: pureContent,
      });
    }

    return chapters;
  }

  private detectBestPattern(content: string): RegExp {
    // 测试每种模式，选择匹配最多的
    let bestPattern = CHAPTER_PATTERNS.standard_chinese;
    let bestCount = 0;

    for (const [, pattern] of Object.entries(CHAPTER_PATTERNS)) {
      pattern.lastIndex = 0;
      const matches = content.match(pattern) || [];
      if (matches.length > bestCount) {
        bestCount = matches.length;
        bestPattern = pattern;
      }
    }

    return bestPattern;
  }

  private extractChapterTitle(rawTitle: string): string {
    // 清理章节标题
    return (
      rawTitle
        .replace(/^第[一二三四五六七八九十百千零\d]+章[\s:：]*/, "")
        .replace(/^Chapter\s*\d+[:.：]?\s*/i, "")
        .replace(/^\d+[.、．]\s*/, "")
        .replace(/^[【\[](.+)[】\]]$/, "$1")
        .trim() || rawTitle.trim()
    );
  }

  private countWords(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return chineseChars + englishWords;
  }

  private async executeImport(
    importId: string,
    dto: ConfirmImportDto,
    existingChapterNumbers: number[],
  ): Promise<void> {
    const importRecord = await this.prisma.chapterImport.findUnique({
      where: { id: importId },
    });

    if (!importRecord || !importRecord.parsedChapters) {
      throw new Error("Import record not found or has no parsed chapters");
    }

    const parsedChapters =
      importRecord.parsedChapters as unknown as ChapterPreview[];
    const selectedChapters = dto.selectedChapters
      .map((idx) => parsedChapters[idx])
      .filter(Boolean);

    const importedChapterIds: string[] = [];
    const errors: Array<{ chapter: string; error: string }> = [];

    let currentChapterNumber = dto.startChapterNumber;

    for (const chapter of selectedChapters) {
      try {
        // 检查章节号冲突
        if (existingChapterNumbers.includes(currentChapterNumber)) {
          if (dto.conflictStrategy === "skip") {
            this.logger.log(
              `Skipping chapter ${currentChapterNumber} (already exists)`,
            );
            currentChapterNumber++;
            continue;
          } else if (dto.conflictStrategy === "append") {
            // 找到最大章节号并追加
            currentChapterNumber = Math.max(...existingChapterNumbers) + 1;
          }
          // 'overwrite' 会直接覆盖
        }

        // 创建或更新章节
        let createdChapter;

        if (
          dto.conflictStrategy === "overwrite" &&
          existingChapterNumbers.includes(currentChapterNumber)
        ) {
          // 覆盖现有章节
          const existingChapter = await this.prisma.writingChapter.findFirst({
            where: {
              volumeId: dto.targetVolumeId,
              chapterNumber: currentChapterNumber,
            },
          });

          if (existingChapter) {
            createdChapter = await this.prisma.writingChapter.update({
              where: { id: existingChapter.id },
              data: {
                title: chapter.title,
                content: chapter.content,
                wordCount: chapter.wordCount,
                status: "DRAFT",
              },
            });
          }
        } else {
          // 创建新章节
          createdChapter = await this.prisma.writingChapter.create({
            data: {
              volumeId: dto.targetVolumeId,
              chapterNumber: currentChapterNumber,
              title: chapter.title,
              content: chapter.content,
              wordCount: chapter.wordCount,
              status: "DRAFT",
            },
          });
        }

        if (createdChapter) {
          importedChapterIds.push(createdChapter.id);

          // 创建初始版本记录
          await this.chapterRevisionService.createInitialRevision(
            createdChapter.id,
            chapter.content,
            "imported",
          );
        }

        currentChapterNumber++;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        errors.push({ chapter: chapter.title, error: errorMessage });
        this.logger.error(`Failed to import chapter: ${chapter.title}`, error);
      }
    }

    // 更新导入记录
    const finalStatus =
      errors.length === selectedChapters.length
        ? ImportStatus.FAILED
        : ImportStatus.COMPLETED;

    await this.prisma.chapterImport.update({
      where: { id: importId },
      data: {
        status: finalStatus,
        importedChapterIds,
        errors: JSON.parse(JSON.stringify(errors)),
        completedAt: new Date(),
      },
    });

    // 更新项目字数统计
    await this.updateProjectWordCount(importRecord.projectId);

    this.logger.log(
      `Import ${importId} completed: ${importedChapterIds.length} chapters imported, ${errors.length} errors`,
    );
  }

  private async updateProjectWordCount(projectId: string): Promise<void> {
    // 计算项目总字数
    const result = await this.prisma.writingChapter.aggregate({
      where: {
        volume: { projectId },
      },
      _sum: { wordCount: true },
    });

    await this.prisma.writingProject.update({
      where: { id: projectId },
      data: { currentWords: result._sum.wordCount || 0 },
    });
  }

  private mapToStatusResponse(importRecord: {
    id: string;
    status: ImportStatus;
    source: ImportSource;
    totalChapters: number;
    totalWords: number;
    importedChapterIds: string[];
    errors: unknown[];
    consistencyCheckMissionId: string | null;
    bibleExtractionMissionId: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }): ImportStatusResponse {
    const errors = importRecord.errors as Array<{
      chapter: string;
      error: string;
    }>;

    return {
      id: importRecord.id,
      status: importRecord.status,
      source: importRecord.source,
      totalChapters: importRecord.totalChapters,
      totalWords: importRecord.totalWords,
      progress:
        importRecord.status === ImportStatus.IMPORTING
          ? {
              current: importRecord.importedChapterIds.length,
              total: importRecord.totalChapters,
            }
          : undefined,
      result:
        importRecord.status === ImportStatus.COMPLETED ||
        importRecord.status === ImportStatus.FAILED
          ? {
              importedChapterIds: importRecord.importedChapterIds,
              skippedCount:
                importRecord.totalChapters -
                importRecord.importedChapterIds.length -
                errors.length,
              errors,
            }
          : undefined,
      postProcessStatus: {
        consistencyCheck: importRecord.consistencyCheckMissionId
          ? "running"
          : "skipped",
        bibleExtraction: importRecord.bibleExtractionMissionId
          ? "running"
          : "skipped",
      },
      createdAt: importRecord.createdAt,
      completedAt: importRecord.completedAt,
    };
  }
}
