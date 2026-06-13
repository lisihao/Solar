import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { CreateNoteDto, UpdateNoteDto, AddHighlightDto } from "./dto";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { Prisma } from "@prisma/client";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  USER_EVENT_NAME,
  MODULE,
  ACTION,
  type UserEventPayload,
} from "@/common/observability/user-event.types";

/**
 * 笔记服务
 *
 * 核心功能：
 * 1. Markdown笔记的CRUD
 * 2. 高亮和标注管理
 * 3. AI洞察集成
 * 4. 知识图谱节点关联
 */
@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(
    private prisma: PrismaService,
    private chatFacade: ChatFacade,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * 创建笔记
   */
  async createNote(userId: string, dto: CreateNoteDto) {
    // CRITICAL FIX: Validate resourceId if provided to prevent FOREIGN_KEY_VIOLATION
    // Empty strings or invalid UUIDs should be treated as null
    const resourceId: string | null = dto.resourceId || null;

    if (resourceId) {
      // Check if resourceId is a valid UUID and exists
      const resource = await this.prisma.resource.findUnique({
        where: { id: resourceId },
        select: { id: true },
      });

      if (!resource) {
        this.logger.warn(
          `Invalid resourceId ${resourceId} provided for note creation`,
        );
        throw new NotFoundException(`Resource with ID ${resourceId} not found`);
      }
    }

    const createData: Prisma.NoteCreateInput = {
      user: { connect: { id: userId } },
      title: dto.title,
      content: dto.content,
      source: dto.source,
      highlights: (dto.highlights || []) as Prisma.InputJsonValue,
      tags: dto.tags || [],
      isPublic: dto.isPublic ?? false,
    };

    if (resourceId) {
      createData.resource = { connect: { id: resourceId } };
    }

    const note = await this.prisma.note.create({
      data: createData,
      include: {
        resource: resourceId
          ? {
              select: {
                id: true,
                type: true,
                title: true,
              },
            }
          : false,
      },
    });

    this.logger.log(
      `Note created ${resourceId ? `for resource ${resourceId}` : "(standalone)"} by user ${userId}`,
    );

    if (this.eventEmitter) {
      this.eventEmitter.emit(USER_EVENT_NAME, {
        userId,
        module: MODULE.LIBRARY,
        action: ACTION.SAVED,
        resourceType: "Note",
        resourceId: note.id,
      } satisfies UserEventPayload);
    }

    return note;
  }

  /**
   * 获取用户的所有笔记
   */
  async getUserNotes(userId: string, skip = 0, take = 50, source?: string) {
    const where: Record<string, unknown> = { userId };
    if (source) {
      where.source = source;
    }

    const [notes, total] = await Promise.all([
      this.prisma.note.findMany({
        where,
        include: {
          resource: {
            select: {
              id: true,
              type: true,
              title: true,
              thumbnailUrl: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        skip,
        take,
      }),
      this.prisma.note.count({
        where,
      }),
    ]);

    return {
      notes,
      total,
      skip,
      take,
    };
  }

  /**
   * 获取资源的笔记
   */
  async getResourceNotes(resourceId: string, userId?: string) {
    let where: Record<string, unknown>;

    // 如果没有提供userId，只返回公开笔记
    if (!userId) {
      where = {
        resourceId,
        isPublic: true,
      };
    } else {
      // 返回公开笔记或用户自己的笔记
      where = {
        resourceId,
        OR: [{ isPublic: true }, { userId }],
      };
    }

    const notes = await this.prisma.note.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return notes;
  }

  /**
   * 获取单个笔记
   */
  async getNote(noteId: string, userId?: string) {
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
        resource: true,
      },
    });

    if (!note) {
      throw new NotFoundException("Note not found");
    }

    // 检查权限：公开笔记或者是笔记所有者
    if (!note.isPublic && note.userId !== userId) {
      throw new ForbiddenException("You do not have access to this note");
    }

    return note;
  }

  /**
   * 更新笔记
   */
  async updateNote(noteId: string, userId: string, dto: UpdateNoteDto) {
    // 验证所有权
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
    });

    if (!note) {
      throw new NotFoundException("Note not found");
    }

    if (note.userId !== userId) {
      throw new ForbiddenException("You can only update your own notes");
    }

    const updated = await this.prisma.note.update({
      where: { id: noteId },
      data: {
        content: dto.content,
        highlights: dto.highlights,
        tags: dto.tags,
        isPublic: dto.isPublic,
        aiInsights: dto.aiInsights,
        graphNodes: dto.graphNodes,
      },
      include: {
        resource: {
          select: {
            id: true,
            type: true,
            title: true,
          },
        },
      },
    });

    this.logger.log(`Note ${noteId} updated by user ${userId}`);

    return updated;
  }

  /**
   * 删除笔记
   */
  async deleteNote(noteId: string, userId: string) {
    // 验证所有权
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
    });

    if (!note) {
      throw new NotFoundException("Note not found");
    }

    if (note.userId !== userId) {
      throw new ForbiddenException("You can only delete your own notes");
    }

    await this.prisma.note.delete({
      where: { id: noteId },
    });

    this.logger.log(`Note ${noteId} deleted by user ${userId}`);

    return { success: true };
  }

  /**
   * 添加高亮标注
   */
  async addHighlight(noteId: string, userId: string, dto: AddHighlightDto) {
    // 验证所有权
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
    });

    if (!note) {
      throw new NotFoundException("Note not found");
    }

    if (note.userId !== userId) {
      throw new ForbiddenException("You can only modify your own notes");
    }

    // 获取现有高亮
    const currentHighlights =
      (note.highlights as Array<Record<string, unknown>>) || [];

    // 添加新高亮
    const newHighlight = {
      id: Math.random().toString(36).substr(2, 9),
      text: dto.text,
      startOffset: dto.startOffset,
      endOffset: dto.endOffset,
      color: dto.color || "#ffeb3b",
      note: dto.note,
      createdAt: new Date().toISOString(),
    };

    currentHighlights.push(newHighlight);

    const updated = await this.prisma.note.update({
      where: { id: noteId },
      data: {
        highlights: currentHighlights as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Highlight added to note ${noteId}`);

    return updated;
  }

  /**
   * 删除高亮标注
   */
  async removeHighlight(noteId: string, userId: string, highlightId: string) {
    // 验证所有权
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
    });

    if (!note) {
      throw new NotFoundException("Note not found");
    }

    if (note.userId !== userId) {
      throw new ForbiddenException("You can only modify your own notes");
    }

    // 移除高亮
    const currentHighlights =
      (note.highlights as Array<Record<string, unknown>>) || [];
    const filteredHighlights = currentHighlights.filter(
      (h: Record<string, unknown>) => h.id !== highlightId,
    );

    const updated = await this.prisma.note.update({
      where: { id: noteId },
      data: {
        highlights: filteredHighlights as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Highlight ${highlightId} removed from note ${noteId}`);

    return updated;
  }

  /**
   * 请求AI解释
   * 使用 AIFacade 进行 AI 调用，不直接访问外部 API
   */
  async requestAIExplanation(
    noteId: string,
    userId: string,
    text: string,
    pdfContext?: string,
  ) {
    // 验证所有权
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
      include: {
        resource: true,
      },
    });

    if (!note) {
      throw new NotFoundException("Note not found");
    }

    if (note.userId !== userId) {
      throw new ForbiddenException("You can only modify your own notes");
    }

    // 调用AI服务获取解释
    let explanation = "AI服务暂时不可用";

    try {
      // 构建上下文：优先使用传入的PDF内容，否则使用资源的标题和摘要
      let context = "";
      if (pdfContext?.trim()) {
        // 使用传入的PDF内容，限制长度以避免超过token限制
        const maxContextLength = 10000;
        const trimmedContext =
          pdfContext.length > maxContextLength
            ? pdfContext.substring(0, maxContextLength) + "...[内容已截断]"
            : pdfContext;
        context = `PDF内容:\n${trimmedContext}`;
      } else if (note.resource) {
        // 回退到使用标题和摘要
        context = `资源标题: ${note.resource.title}\n摘要: ${note.resource.abstract || "无"}`;
      }

      // 使用 AIFacade.chat() 进行 AI 调用
      const systemPrompt = context
        ? `你是一个专业的文档分析助手。以下是相关的文档上下文：\n\n${context}`
        : "你是一个专业的文档分析助手。";

      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "user",
            content: `请详细解释以下选中文本的含义、重要性和在文档中的作用：\n\n选中的文本：${text}`,
          },
        ],
        systemPrompt,
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
        // ★ 自动积分扣除
        billing: {
          userId,
          moduleType: "library",
          operationType: "ai-explanation",
          referenceId: noteId,
          description: "AI 解释笔记内容",
        },
      });

      if (response.content) {
        explanation = response.content;
      }
    } catch (error) {
      this.logger.error(
        `Failed to call AI service: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    const aiExplanation = {
      text,
      explanation,
      timestamp: new Date().toISOString(),
    };

    // 更新笔记的AI洞察
    const currentInsights = (note.aiInsights as Record<string, unknown>) || {
      explanations: [],
    };
    const explanations = Array.isArray(currentInsights.explanations)
      ? currentInsights.explanations
      : [];
    explanations.push(aiExplanation);
    currentInsights.explanations = explanations;

    await this.prisma.note.update({
      where: { id: noteId },
      data: {
        aiInsights: currentInsights as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`AI explanation requested for note ${noteId}`);

    return aiExplanation;
  }

  /**
   * Toggle bookmark status
   */
  async toggleBookmark(noteId: string, userId: string) {
    // Verify ownership
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
    });

    if (!note) {
      throw new NotFoundException("Note not found");
    }

    if (note.userId !== userId) {
      throw new ForbiddenException("You can only bookmark your own notes");
    }

    const updated = await this.prisma.note.update({
      where: { id: noteId },
      data: {
        isBookmarked: !note.isBookmarked,
      },
      include: {
        resource: {
          select: {
            id: true,
            type: true,
            title: true,
          },
        },
      },
    });

    this.logger.log(
      `Note ${noteId} bookmark toggled to ${updated.isBookmarked} by user ${userId}`,
    );

    return updated;
  }

  /**
   * 关联知识图谱节点
   */
  async linkGraphNode(
    noteId: string,
    userId: string,
    nodeId: string,
    nodeType: string,
  ) {
    // 验证所有权
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
    });

    if (!note) {
      throw new NotFoundException("Note not found");
    }

    if (note.userId !== userId) {
      throw new ForbiddenException("You can only modify your own notes");
    }

    // 获取现有图谱节点
    const currentNodes =
      (note.graphNodes as Array<Record<string, unknown>>) || [];

    // 检查是否已存在
    const exists = currentNodes.some(
      (node: Record<string, unknown>) => node.id === nodeId,
    );
    if (exists) {
      return note;
    }

    // 添加新节点
    const newNode = {
      id: nodeId,
      type: nodeType,
      linkedAt: new Date().toISOString(),
    };

    currentNodes.push(newNode);

    const updated = await this.prisma.note.update({
      where: { id: noteId },
      data: {
        graphNodes: currentNodes as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Graph node ${nodeId} linked to note ${noteId}`);

    return updated;
  }

  /**
   * 解除知识图谱节点关联
   */
  async unlinkGraphNode(noteId: string, userId: string, nodeId: string) {
    // 验证所有权
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
    });

    if (!note) {
      throw new NotFoundException("Note not found");
    }

    if (note.userId !== userId) {
      throw new ForbiddenException("You can only modify your own notes");
    }

    // 获取现有图谱节点
    const currentNodes =
      (note.graphNodes as Array<Record<string, unknown>>) || [];

    // 过滤掉要移除的节点
    const filteredNodes = currentNodes.filter(
      (node: Record<string, unknown>) => node.id !== nodeId,
    );

    // 如果没有变化,直接返回
    if (filteredNodes.length === currentNodes.length) {
      return note;
    }

    const updated = await this.prisma.note.update({
      where: { id: noteId },
      data: {
        graphNodes: filteredNodes as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Graph node ${nodeId} unlinked from note ${noteId}`);

    return updated;
  }

  // ===== AI Organization Methods =====

  /**
   * 提取笔记要点
   */
  async extractKeyPoints(userId: string) {
    this.logger.log(`Extracting key points for user ${userId}`);

    // Get user's recent notes
    const notes = await this.prisma.note.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        content: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });

    if (notes.length === 0) {
      return { keyPoints: [], message: "No notes found to analyze" };
    }

    try {
      const model = await this.chatFacade.getDefaultTextModel();
      if (!model) {
        throw new Error("No default text model available");
      }

      // Combine notes content for analysis
      const notesContent = notes
        .map(
          (n) =>
            `[${n.title || "Untitled"}]: ${n.content?.slice(0, 500) || ""}`,
        )
        .join("\n\n");

      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "user",
            content: `Analyze these notes and extract 5-10 key points or insights. Return JSON: {"keyPoints": [{"title": "...", "insight": "...", "importance": "high|medium|low", "sourceNotes": ["noteId1", "noteId2"]}]}\n\nNotes:\n${notesContent}`,
          },
        ],
        systemPrompt:
          "You are an expert at analyzing notes and extracting key insights. Output JSON format only.",
        taskProfile: {
          creativity: "low",
          outputLength: "short",
        },
        // ★ 自动积分扣除
        billing: {
          userId,
          moduleType: "library",
          operationType: "ai-extract",
          description: "提取笔记要点",
        },
      });

      try {
        const result = JSON.parse(response.content);
        this.logger.log(
          `Extracted ${result.keyPoints?.length || 0} key points for user ${userId}`,
        );
        return result;
      } catch {
        return {
          keyPoints: [
            {
              title: "Analysis Complete",
              insight: response.content,
              importance: "medium",
            },
          ],
        };
      }
    } catch (err) {
      this.logger.error(
        `Failed to extract key points: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  /**
   * 发现笔记之间的关联
   */
  async findConnections(userId: string) {
    this.logger.log(`Finding connections for user ${userId}`);

    // Get user's notes
    const notes = await this.prisma.note.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        content: true,
        tags: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
    });

    if (notes.length < 2) {
      return {
        connections: [],
        message: "Need at least 2 notes to find connections",
      };
    }

    try {
      const model = await this.chatFacade.getDefaultTextModel();
      if (!model) {
        throw new Error("No default text model available");
      }

      const notesContent = notes
        .map(
          (n) =>
            `[ID:${n.id}][${n.title || "Untitled"}]: ${n.content?.slice(0, 300) || ""}`,
        )
        .join("\n\n");

      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "user",
            content: `Analyze these notes and find meaningful connections between them. Return JSON: {"connections": [{"noteIds": ["id1", "id2"], "relationship": "description of connection", "strength": "strong|moderate|weak", "theme": "common theme"}]}\n\nNotes:\n${notesContent}`,
          },
        ],
        systemPrompt:
          "You are an expert at finding thematic and conceptual connections between notes. Output JSON format only.",
        taskProfile: {
          creativity: "low",
          outputLength: "short",
        },
        // ★ 自动积分扣除
        billing: {
          userId,
          moduleType: "library",
          operationType: "ai-extract",
          description: "发现笔记关联",
        },
      });

      try {
        // 尝试从AI响应中提取JSON
        let jsonContent = response.content;

        // 如果响应被markdown代码块包裹，提取JSON部分
        const jsonMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          jsonContent = jsonMatch[1].trim();
        }

        // 尝试找到JSON对象
        const jsonStart = jsonContent.indexOf("{");
        const jsonEnd = jsonContent.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          jsonContent = jsonContent.slice(jsonStart, jsonEnd + 1);
        }

        const result = JSON.parse(jsonContent);
        this.logger.log(
          `Found ${result.connections?.length || 0} connections for user ${userId}`,
        );

        // 创建 ID 到标题的映射，如果没有标题则使用内容前30个字符
        const noteMap = new Map(
          notes.map((n) => {
            let displayTitle = n.title;
            if (!displayTitle || displayTitle.trim() === "") {
              // 使用内容的前30个字符作为标题
              const contentPreview = (n.content || "")
                .replace(/[#>*_~`\[\]]/g, "") // 移除 markdown 符号
                .trim()
                .slice(0, 30);
              displayTitle = contentPreview
                ? `${contentPreview}${contentPreview.length >= 30 ? "..." : ""}`
                : "Untitled Note";
            }
            return [n.id, displayTitle];
          }),
        );

        // 丰富连接数据，添加笔记标题
        const enrichedConnections = (result.connections || []).map(
          (conn: Record<string, unknown> & { noteIds?: string[] }) => {
            const noteIds = conn.noteIds || [];
            return {
              ...conn,
              note1Title: noteMap.get(noteIds[0]) || noteIds[0] || "Unknown",
              note2Title: noteMap.get(noteIds[1]) || noteIds[1] || "Unknown",
              noteId1: noteIds[0],
              noteId2: noteIds[1],
            };
          },
        );

        return { connections: enrichedConnections };
      } catch (parseError) {
        this.logger.warn(
          `Failed to parse connections JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        );
        this.logger.debug(`Raw AI response: ${response.content}`);
        return { connections: [], rawAnalysis: response.content };
      }
    } catch (err) {
      this.logger.error(
        `Failed to find connections: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  /**
   * 生成所有笔记的综合摘要
   */
  async summarizeNotes(userId: string) {
    this.logger.log(`Summarizing notes for user ${userId}`);

    // Get user's notes
    const notes = await this.prisma.note.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        content: true,
        createdAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    if (notes.length === 0) {
      return { summary: "No notes found to summarize", highlights: [] };
    }

    try {
      const model = await this.chatFacade.getDefaultTextModel();
      if (!model) {
        throw new Error("No default text model available");
      }

      const notesContent = notes
        .map(
          (n) =>
            `[${n.title || "Untitled"}] (${new Date(n.createdAt).toLocaleDateString()}): ${n.content?.slice(0, 400) || ""}`,
        )
        .join("\n\n");

      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "user",
            content: `Create a comprehensive summary of all these notes, identifying main themes, key learnings, and areas of focus. Return JSON: {"summary": "comprehensive summary...", "themes": ["theme1", "theme2"], "highlights": [{"point": "key point", "category": "category"}], "suggestedActions": ["action1", "action2"]}\n\nNotes:\n${notesContent}`,
          },
        ],
        systemPrompt:
          "You are an expert at synthesizing and summarizing information. Output JSON format only.",
        taskProfile: {
          creativity: "medium",
          outputLength: "short",
        },
        // ★ 自动积分扣除
        billing: {
          userId,
          moduleType: "library",
          operationType: "ai-summary",
          description: "笔记综合摘要",
        },
      });

      try {
        const result = JSON.parse(response.content);
        this.logger.log(`Generated summary for user ${userId}`);
        return result;
      } catch {
        return {
          summary: response.content,
          themes: [],
          highlights: [],
        };
      }
    } catch (err) {
      this.logger.error(
        `Failed to summarize notes: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
