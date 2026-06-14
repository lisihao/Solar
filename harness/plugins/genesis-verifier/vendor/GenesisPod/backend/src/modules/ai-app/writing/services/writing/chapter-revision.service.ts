import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { RevisionChangeType } from "@prisma/client";
import {
  UpdateChapterContentDto,
  AiEditChapterDto,
  ChapterRevisionResponse,
  RevisionDiffResponse,
  AiEditOperation,
} from "../../dto/chapter-revision.dto";
import { ChatFacade } from "@/modules/ai-harness/facade";

@Injectable()
export class ChapterRevisionService {
  private readonly logger = new Logger(ChapterRevisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * 获取章节的所有修订历史
   */
  async getRevisions(
    chapterId: string,
    userId: string,
  ): Promise<{ items: ChapterRevisionResponse[]; total: number }> {
    await this.verifyChapterAccess(chapterId, userId);

    const [items, total] = await Promise.all([
      this.prisma.chapterRevision.findMany({
        where: { chapterId },
        orderBy: { versionNumber: "desc" },
      }),
      this.prisma.chapterRevision.count({ where: { chapterId } }),
    ]);

    return {
      items: items.map((r) => this.mapToResponse(r)),
      total,
    };
  }

  /**
   * 获取单个修订版本
   */
  async getRevision(
    revisionId: string,
    userId: string,
  ): Promise<ChapterRevisionResponse> {
    const revision = await this.prisma.chapterRevision.findUnique({
      where: { id: revisionId },
      include: {
        chapter: {
          include: {
            volume: {
              include: {
                project: { select: { ownerId: true } },
              },
            },
          },
        },
      },
    });

    if (!revision) {
      throw new NotFoundException("Revision not found");
    }

    if (revision.chapter.volume.project.ownerId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    return this.mapToResponse(revision);
  }

  /**
   * 更新章节内容（人工编辑）- 自动创建新版本
   */
  async updateContent(
    chapterId: string,
    userId: string,
    dto: UpdateChapterContentDto,
  ): Promise<{
    chapter: { id: string; content: string; wordCount: number };
    revision: ChapterRevisionResponse;
  }> {
    await this.verifyChapterAccess(chapterId, userId);

    // 获取当前最大版本号
    const maxVersion = await this.getMaxVersionNumber(chapterId);
    const newVersionNumber = maxVersion + 1;

    // 计算字数
    const wordCount = this.countWords(dto.content);

    // 创建新版本记录
    const revision = await this.prisma.chapterRevision.create({
      data: {
        chapterId,
        versionNumber: newVersionNumber,
        content: dto.content,
        wordCount,
        changeType: RevisionChangeType.MANUAL_EDIT,
        changeSummary: dto.changeSummary || "手动编辑",
        changedBy: "user",
      },
    });

    // 更新章节内容
    const updatedChapter = await this.prisma.writingChapter.update({
      where: { id: chapterId },
      data: {
        content: dto.content,
        wordCount,
        revisedAt: new Date(),
      },
    });

    this.logger.log(
      `Chapter ${chapterId} updated to version ${newVersionNumber} by user`,
    );

    return {
      chapter: {
        id: updatedChapter.id,
        content: updatedChapter.content || "",
        wordCount: updatedChapter.wordCount,
      },
      revision: this.mapToResponse(revision),
    };
  }

  /**
   * AI 辅助编辑章节
   */
  async aiEdit(
    chapterId: string,
    userId: string,
    dto: AiEditChapterDto,
  ): Promise<{
    chapter: { id: string; content: string; wordCount: number };
    revision: ChapterRevisionResponse;
    changes: Array<{
      type: string;
      before: string;
      after: string;
      description: string;
    }>;
  }> {
    const chapter = await this.verifyChapterAccess(chapterId, userId);

    if (!chapter.content) {
      throw new BadRequestException("Chapter has no content to edit");
    }

    // 根据操作类型执行不同的编辑
    let newContent: string;
    let changeDescription: string;

    // 如果没有选中内容，创建全文选择
    const fullContentSelection = {
      startOffset: 0,
      endOffset: chapter.content.length,
      originalText: chapter.content,
    };
    const effectiveSelection = dto.selection || fullContentSelection;

    switch (dto.operation) {
      case "rewrite":
        const rewriteResult = await this.aiRewriteSection(
          chapter.content,
          effectiveSelection,
          dto.userFeedback,
        );
        newContent = rewriteResult.content;
        changeDescription = rewriteResult.description;
        break;

      case "polish":
        const polishResult = await this.aiPolish(
          chapter.content,
          dto.polishLevel || "moderate",
          dto.userFeedback,
        );
        newContent = polishResult.content;
        changeDescription = polishResult.description;
        break;

      case "expand":
        const expandResult = await this.aiExpand(
          chapter.content,
          effectiveSelection,
          dto.userFeedback,
        );
        newContent = expandResult.content;
        changeDescription = expandResult.description;
        break;

      case "condense":
        const condenseResult = await this.aiCondense(
          chapter.content,
          effectiveSelection,
          dto.userFeedback,
        );
        newContent = condenseResult.content;
        changeDescription = condenseResult.description;
        break;

      case "style_fix":
        const styleResult = await this.aiStyleFix(
          chapter.content,
          dto.targetStyle || {},
          dto.userFeedback,
        );
        newContent = styleResult.content;
        changeDescription = styleResult.description;
        break;

      default:
        throw new BadRequestException(`Unknown operation: ${dto.operation}`);
    }

    // 获取当前最大版本号
    const maxVersion = await this.getMaxVersionNumber(chapterId);
    const newVersionNumber = maxVersion + 1;

    // 计算字数
    const wordCount = this.countWords(newContent);

    // 映射操作类型到 RevisionChangeType
    const changeTypeMap: Record<AiEditOperation, RevisionChangeType> = {
      rewrite: RevisionChangeType.AI_REWRITE,
      polish: RevisionChangeType.AI_POLISH,
      expand: RevisionChangeType.AI_EXPAND,
      condense: RevisionChangeType.AI_CONDENSE,
      style_fix: RevisionChangeType.AI_STYLE_FIX,
    };

    // 创建新版本记录
    const revision = await this.prisma.chapterRevision.create({
      data: {
        chapterId,
        versionNumber: newVersionNumber,
        content: newContent,
        wordCount,
        changeType: changeTypeMap[dto.operation],
        changeSummary: changeDescription,
        changedBy: `ai_${dto.operation}`,
        aiParams: JSON.parse(
          JSON.stringify({
            operation: dto.operation,
            userFeedback: dto.userFeedback,
            selection: dto.selection,
            polishLevel: dto.polishLevel,
            targetStyle: dto.targetStyle,
          }),
        ),
      },
    });

    // 更新章节内容
    const updatedChapter = await this.prisma.writingChapter.update({
      where: { id: chapterId },
      data: {
        content: newContent,
        wordCount,
        revisedAt: new Date(),
      },
    });

    this.logger.log(
      `Chapter ${chapterId} AI edited (${dto.operation}) to version ${newVersionNumber}`,
    );

    return {
      chapter: {
        id: updatedChapter.id,
        content: updatedChapter.content || "",
        wordCount: updatedChapter.wordCount,
      },
      revision: this.mapToResponse(revision),
      changes: [
        {
          type: dto.operation,
          before: chapter.content.substring(0, 200) + "...",
          after: newContent.substring(0, 200) + "...",
          description: changeDescription,
        },
      ],
    };
  }

  /**
   * 比较两个版本的差异
   */
  async compareRevisions(
    chapterId: string,
    revisionId1: string,
    revisionId2: string,
    userId: string,
  ): Promise<RevisionDiffResponse> {
    await this.verifyChapterAccess(chapterId, userId);

    const [revision1, revision2] = await Promise.all([
      this.prisma.chapterRevision.findUnique({ where: { id: revisionId1 } }),
      this.prisma.chapterRevision.findUnique({ where: { id: revisionId2 } }),
    ]);

    if (!revision1 || !revision2) {
      throw new NotFoundException("One or both revisions not found");
    }

    if (
      revision1.chapterId !== chapterId ||
      revision2.chapterId !== chapterId
    ) {
      throw new BadRequestException(
        "Revisions do not belong to the specified chapter",
      );
    }

    // 简单的差异计算
    const diff = this.computeSimpleDiff(revision1.content, revision2.content);

    return {
      revision1: this.mapToResponse(revision1),
      revision2: this.mapToResponse(revision2),
      diff,
    };
  }

  /**
   * 回退到指定版本
   */
  async rollback(
    chapterId: string,
    revisionId: string,
    userId: string,
    reason?: string,
  ): Promise<{
    chapter: { id: string; content: string; wordCount: number };
    newRevision: ChapterRevisionResponse;
  }> {
    await this.verifyChapterAccess(chapterId, userId);

    const targetRevision = await this.prisma.chapterRevision.findUnique({
      where: { id: revisionId },
    });

    if (!targetRevision) {
      throw new NotFoundException("Revision not found");
    }

    if (targetRevision.chapterId !== chapterId) {
      throw new BadRequestException(
        "Revision does not belong to the specified chapter",
      );
    }

    // 获取当前最大版本号
    const maxVersion = await this.getMaxVersionNumber(chapterId);
    const newVersionNumber = maxVersion + 1;

    // 创建回退版本记录
    const newRevision = await this.prisma.chapterRevision.create({
      data: {
        chapterId,
        versionNumber: newVersionNumber,
        content: targetRevision.content,
        wordCount: targetRevision.wordCount,
        changeType: RevisionChangeType.ROLLBACK,
        changeSummary: reason || `回退到版本 ${targetRevision.versionNumber}`,
        changedBy: "user",
        aiParams: {
          rollbackFromVersion: maxVersion,
          rollbackToVersion: targetRevision.versionNumber,
          rollbackToRevisionId: revisionId,
        },
      },
    });

    // 更新章节内容
    const updatedChapter = await this.prisma.writingChapter.update({
      where: { id: chapterId },
      data: {
        content: targetRevision.content,
        wordCount: targetRevision.wordCount,
        revisedAt: new Date(),
      },
    });

    this.logger.log(
      `Chapter ${chapterId} rolled back to version ${targetRevision.versionNumber}`,
    );

    return {
      chapter: {
        id: updatedChapter.id,
        content: updatedChapter.content || "",
        wordCount: updatedChapter.wordCount,
      },
      newRevision: this.mapToResponse(newRevision),
    };
  }

  /**
   * 为章节创建初始版本（首次保存内容时调用）
   */
  async createInitialRevision(
    chapterId: string,
    content: string,
    source: "ai_generated" | "imported" | "manual",
  ): Promise<ChapterRevisionResponse> {
    const wordCount = this.countWords(content);

    const changeTypeMap: Record<string, RevisionChangeType> = {
      ai_generated: RevisionChangeType.AI_REWRITE,
      imported: RevisionChangeType.IMPORTED,
      manual: RevisionChangeType.MANUAL_EDIT,
    };

    const revision = await this.prisma.chapterRevision.create({
      data: {
        chapterId,
        versionNumber: 1,
        content,
        wordCount,
        changeType: changeTypeMap[source],
        changeSummary: source === "imported" ? "导入内容" : "初始版本",
        changedBy: source === "ai_generated" ? "ai" : "user",
      },
    });

    return this.mapToResponse(revision);
  }

  // ==================== Private Methods ====================

  private async verifyChapterAccess(chapterId: string, userId: string) {
    const chapter = await this.prisma.writingChapter.findUnique({
      where: { id: chapterId },
      include: {
        volume: {
          include: {
            project: { select: { ownerId: true } },
          },
        },
      },
    });

    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    if (chapter.volume.project.ownerId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    return chapter;
  }

  private async getMaxVersionNumber(chapterId: string): Promise<number> {
    const result = await this.prisma.chapterRevision.aggregate({
      where: { chapterId },
      _max: { versionNumber: true },
    });
    return result._max.versionNumber || 0;
  }

  private countWords(text: string): number {
    // 中文按字符计数，英文按单词计数
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return chineseChars + englishWords;
  }

  private mapToResponse(revision: {
    id: string;
    chapterId: string;
    versionNumber: number;
    content: string;
    wordCount: number;
    changeType: RevisionChangeType;
    changeSummary: string | null;
    changedBy: string;
    aiParams: unknown;
    createdAt: Date;
  }): ChapterRevisionResponse {
    return {
      id: revision.id,
      chapterId: revision.chapterId,
      versionNumber: revision.versionNumber,
      content: revision.content,
      wordCount: revision.wordCount,
      changeType: revision.changeType,
      changeSummary: revision.changeSummary,
      changedBy: revision.changedBy,
      aiParams: revision.aiParams as Record<string, unknown> | null,
      createdAt: revision.createdAt,
    };
  }

  private computeSimpleDiff(
    content1: string,
    content2: string,
  ): {
    additions: string[];
    deletions: string[];
    changes: Array<{ before: string; after: string }>;
  } {
    // 简单的行级差异比较
    const lines1 = content1.split("\n");
    const lines2 = content2.split("\n");

    const additions: string[] = [];
    const deletions: string[] = [];
    const changes: Array<{ before: string; after: string }> = [];

    const set1 = new Set(lines1);
    const set2 = new Set(lines2);

    // 找出新增的行
    for (const line of lines2) {
      if (!set1.has(line) && line.trim()) {
        additions.push(line);
      }
    }

    // 找出删除的行
    for (const line of lines1) {
      if (!set2.has(line) && line.trim()) {
        deletions.push(line);
      }
    }

    // 如果行数相同，找出变化的行
    const minLength = Math.min(lines1.length, lines2.length);
    for (let i = 0; i < minLength; i++) {
      if (lines1[i] !== lines2[i] && lines1[i].trim() && lines2[i].trim()) {
        changes.push({ before: lines1[i], after: lines2[i] });
      }
    }

    return { additions, deletions, changes };
  }

  // ==================== AI Edit Methods ====================

  private async aiRewriteSection(
    fullContent: string,
    selection: { startOffset: number; endOffset: number; originalText: string },
    userFeedback: string,
  ): Promise<{ content: string; description: string }> {
    const contextBefore = fullContent.substring(
      Math.max(0, selection.startOffset - 200),
      selection.startOffset,
    );
    const contextAfter = fullContent.substring(
      selection.endOffset,
      selection.endOffset + 200,
    );

    const response = await this.chatFacade.chatWithSkills({
      messages: [
        {
          role: "user",
          content: `请重写以下段落：\n\n${selection.originalText}`,
        },
      ],
      domain: "writing",
      taskProfile: {
        creativity: "high",
        outputLength: "medium",
      },
      skillContext: {
        originalText: selection.originalText,
        userFeedback,
        contextBefore,
        contextAfter,
      },
    });

    const rewrittenText = response.content;

    // 替换选中部分
    const newContent =
      fullContent.substring(0, selection.startOffset) +
      rewrittenText +
      fullContent.substring(selection.endOffset);

    return {
      content: newContent,
      description: `AI 根据用户要求重写了选中段落: "${userFeedback}"`,
    };
  }

  private async aiPolish(
    content: string,
    level: "light" | "moderate" | "heavy",
    userFeedback: string,
  ): Promise<{ content: string; description: string }> {
    const levelDescriptions = {
      light: "轻度润色：修正语法错误，改善句子流畅性，保持原文风格",
      moderate: "中度润色：优化表达方式，增强文字感染力，适度调整句式",
      heavy: "重度润色：大幅改善文字质量，重新组织段落结构，提升整体可读性",
    };

    const response = await this.chatFacade.chatWithSkills({
      messages: [
        {
          role: "user",
          content: `请对以下章节内容进行${levelDescriptions[level]}：\n\n${content}`,
        },
      ],
      domain: "writing",
      taskProfile: {
        creativity: level === "heavy" ? "high" : "medium",
        outputLength: "long",
      },
      skillContext: {
        originalText: content,
        userFeedback: userFeedback || "无",
      },
    });

    return {
      content: response.content,
      description: `AI ${level === "light" ? "轻度" : level === "moderate" ? "中度" : "重度"}润色`,
    };
  }

  private async aiExpand(
    fullContent: string,
    selection: { startOffset: number; endOffset: number; originalText: string },
    userFeedback: string,
  ): Promise<{ content: string; description: string }> {
    const contextBefore = fullContent.substring(
      Math.max(0, selection.startOffset - 200),
      selection.startOffset,
    );
    const contextAfter = fullContent.substring(
      selection.endOffset,
      selection.endOffset + 200,
    );

    const response = await this.chatFacade.chatWithSkills({
      messages: [
        {
          role: "user",
          content: `请扩写以下段落，增加更多细节和描写：\n\n${selection.originalText}`,
        },
      ],
      domain: "writing",
      taskProfile: {
        creativity: "high",
        outputLength: "long",
      },
      skillContext: {
        originalText: selection.originalText,
        userFeedback,
        contextBefore,
        contextAfter,
      },
    });

    const expandedText = response.content;

    const newContent =
      fullContent.substring(0, selection.startOffset) +
      expandedText +
      fullContent.substring(selection.endOffset);

    return {
      content: newContent,
      description: `AI 扩写了选中段落: "${userFeedback}"`,
    };
  }

  private async aiCondense(
    fullContent: string,
    selection: { startOffset: number; endOffset: number; originalText: string },
    userFeedback: string,
  ): Promise<{ content: string; description: string }> {
    const contextBefore = fullContent.substring(
      Math.max(0, selection.startOffset - 200),
      selection.startOffset,
    );
    const contextAfter = fullContent.substring(
      selection.endOffset,
      selection.endOffset + 200,
    );

    const response = await this.chatFacade.chatWithSkills({
      messages: [
        {
          role: "user",
          content: `请精简以下段落，保留核心内容：\n\n${selection.originalText}`,
        },
      ],
      domain: "writing",
      taskProfile: {
        creativity: "low",
        outputLength: "short",
      },
      skillContext: {
        originalText: selection.originalText,
        userFeedback,
        contextBefore,
        contextAfter,
      },
    });

    const condensedText = response.content;

    const newContent =
      fullContent.substring(0, selection.startOffset) +
      condensedText +
      fullContent.substring(selection.endOffset);

    return {
      content: newContent,
      description: `AI 精简了选中段落: "${userFeedback}"`,
    };
  }

  private async aiStyleFix(
    content: string,
    targetStyle: {
      tone?: string;
      vocabulary?: string;
      sentenceLength?: string;
    },
    userFeedback: string,
  ): Promise<{ content: string; description: string }> {
    const styleDesc = [];
    if (targetStyle.tone) styleDesc.push(`语气：${targetStyle.tone}`);
    if (targetStyle.vocabulary)
      styleDesc.push(`用词风格：${targetStyle.vocabulary}`);
    if (targetStyle.sentenceLength)
      styleDesc.push(`句式长度：${targetStyle.sentenceLength}`);

    const targetStyleText = styleDesc.join("\n") || "根据用户要求调整";

    const response = await this.chatFacade.chatWithSkills({
      messages: [
        {
          role: "user",
          content: `请对以下章节内容进行风格调整，目标风格：${targetStyleText}\n\n${content}`,
        },
      ],
      domain: "writing",
      taskProfile: {
        creativity: "medium",
        outputLength: "long",
      },
      skillContext: {
        originalText: content,
        userFeedback: userFeedback || "无",
      },
    });

    return {
      content: response.content,
      description: `AI 风格调整: ${styleDesc.join(", ") || userFeedback}`,
    };
  }
}
