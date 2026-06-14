import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { InputJsonValue } from "@prisma/client/runtime/library";
import { SendChatMessageDto, CreateNoteDto, UpdateNoteDto } from "./dto";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { ChatMessage as FacadeChatMessage } from "@/modules/ai-harness/facade";
import {
  MissionContext,
  MissionExecutorService,
} from "@/modules/ai-harness/facade";
import { BillingContext } from "../../../platform/facade";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  citations?: string[];
}

@Injectable()
export class ResearchProjectChatService {
  private readonly logger = new Logger(ResearchProjectChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
    @Optional() private readonly missionExecutor?: MissionExecutorService,
  ) {}

  /**
   * Get or create the current chat session for a project
   */
  async getCurrentChat(userId: string, projectId: string) {
    // Verify project ownership
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    // Get the most recent chat or create a new one
    let chat = await this.prisma.researchProjectChat.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    if (!chat) {
      chat = await this.prisma.researchProjectChat.create({
        data: {
          projectId,
          messages: [],
          title: "New Chat",
        },
      });

      // Update chat count
      await this.prisma.researchProject.update({
        where: { id: projectId },
        data: { chatCount: { increment: 1 } },
      });
    }

    return chat;
  }

  /**
   * Send a message in a chat session and get AI response
   */
  async sendMessage(
    userId: string,
    projectId: string,
    dto: SendChatMessageDto,
  ) {
    // ★ AI Kernel: 创建进程
    let kernelProcessId: string | undefined;
    if (this.missionExecutor) {
      try {
        const kr = await this.missionExecutor.execute({
          userId,
          agentId: "research-project-chat",
          input: { action: "chat", projectId },
        });
        kernelProcessId = kr.processId;
      } catch {
        /* kernel optional */
      }
    }

    const billingRun = () =>
      BillingContext.run(
        {
          userId,
          moduleType: "notebook-research",
          operationType: "chat",
          referenceId: projectId,
        },
        () => this._sendMessageInternal(userId, projectId, dto),
      );

    try {
      const result = await (kernelProcessId
        ? MissionContext.run(
            { agentProcessId: kernelProcessId, userId },
            billingRun,
          )
        : billingRun());
      if (kernelProcessId && this.missionExecutor) {
        void this.missionExecutor
          .complete(kernelProcessId)
          .catch((err) =>
            this.logger.debug("Mission completion cleanup failed", err),
          );
      }
      return result;
    } catch (error) {
      if (kernelProcessId && this.missionExecutor) {
        void this.missionExecutor
          .fail(
            kernelProcessId,
            error instanceof Error ? error.message : String(error),
          )
          .catch((err) =>
            this.logger.debug("Mission failure cleanup failed", err),
          );
      }
      throw error;
    }
  }

  private async _sendMessageInternal(
    userId: string,
    projectId: string,
    dto: SendChatMessageDto,
  ) {
    const chat = await this.getCurrentChat(userId, projectId);

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: dto.message,
      timestamp: new Date().toISOString(),
    };

    // Get current messages and add the new one
    const messages = (chat.messages as unknown as ChatMessage[]) || [];
    messages.push(userMessage);

    // Update the chat with user message
    await this.prisma.researchProjectChat.update({
      where: { id: chat.id },
      data: {
        messages: messages as unknown as InputJsonValue,
        modelUsed: dto.model || "",
      },
    });

    // Get selected sources for context
    // IMPORTANT: Maintain the order of selectedSourceIds for consistent citation mapping
    let sourceContext: Array<{
      id: string;
      title: string;
      abstract: string | null;
      content: string | null;
      sourceType: string;
      aiSummary: string | null;
    }> = [];
    if (dto.selectedSourceIds && dto.selectedSourceIds.length > 0) {
      const sources = await this.prisma.researchProjectSource.findMany({
        where: {
          id: { in: dto.selectedSourceIds },
          projectId,
        },
        select: {
          id: true,
          title: true,
          abstract: true,
          content: true,
          sourceType: true,
          aiSummary: true,
        },
      });
      // Sort sources to match the order of selectedSourceIds
      // This ensures [1] always refers to the first selected source, [2] to second, etc.
      const sourceMap = new Map(sources.map((s) => [s.id, s]));
      sourceContext = dto.selectedSourceIds
        .map((id) => sourceMap.get(id))
        .filter((s): s is NonNullable<typeof s> => s != null);
    }

    // Build context from sources
    const sourceContextText = this.buildSourceContext(sourceContext);

    // Build system prompt with source context
    const systemPrompt = this.buildSystemPrompt(sourceContextText);

    // Build conversation history for AI
    const conversationHistory = messages
      .filter((m) => m.role !== "system")
      .slice(-10) // Keep last 10 messages for context
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    try {
      this.logger.log(
        `Generating AI response for project ${projectId} with ${sourceContext.length} sources, model: ${dto.model}`,
      );

      // Get model configuration from database
      const modelConfig = await this.getModelConfig(dto.model);

      if (!modelConfig) {
        throw new Error(`Model "${dto.model}" not found or not enabled`);
      }

      this.logger.log(
        `Using model: ${modelConfig.displayName} (${modelConfig.provider}/${modelConfig.modelId})`,
      );

      // Call AI service with database configuration
      const facadeMessages: FacadeChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...conversationHistory.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];
      const aiResult = await this.chatFacade.chat({
        messages: facadeMessages,
        model: modelConfig.modelId,
        taskProfile: {
          creativity: "medium",
          outputLength: "standard",
        },
        skipGuardrails: true, // 内部系统调用，研究内容可能触发误报
      });

      // Create AI response message
      const aiMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: aiResult.content,
        timestamp: new Date().toISOString(),
        citations: sourceContext.map((s) => s.title),
      };

      // Add AI response to messages
      messages.push(aiMessage);

      // Update chat with AI response
      const responseTokens = aiResult.tokensUsed || 0;
      await this.prisma.researchProjectChat.update({
        where: { id: chat.id },
        data: {
          messages: messages as unknown as InputJsonValue,
          tokensUsed: (chat.tokensUsed || 0) + responseTokens,
        },
      });

      return {
        chatId: chat.id,
        userMessage,
        aiMessage,
        sourceContext,
        tokensUsed: responseTokens,
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`AI chat failed: ${errMsg}`);

      // Return error message as AI response
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: `抱歉，AI 回复生成失败：${errMsg}。请稍后重试。`,
        timestamp: new Date().toISOString(),
      };

      messages.push(errorMessage);
      await this.prisma.researchProjectChat.update({
        where: { id: chat.id },
        data: {
          messages: messages as unknown as InputJsonValue,
        },
      });

      return {
        chatId: chat.id,
        userMessage,
        aiMessage: errorMessage,
        sourceContext,
        error: errMsg,
      };
    }
  }

  /**
   * Build context text from sources
   */
  private buildSourceContext(
    sources: Array<{
      id: string;
      title: string;
      abstract: string | null;
      content: string | null;
      sourceType: string;
      aiSummary: string | null;
    }>,
  ): string {
    if (sources.length === 0) {
      return "";
    }

    const contextParts = sources.map((source, index) => {
      const parts = [`[资料 ${index + 1}] ${source.title}`];
      parts.push(`类型: ${source.sourceType}`);

      if (source.abstract) {
        parts.push(`摘要: ${source.abstract}`);
      }

      if (source.content) {
        // Limit content to avoid token overflow
        const maxContentLength = 2000;
        const content =
          source.content.length > maxContentLength
            ? source.content.substring(0, maxContentLength) + "..."
            : source.content;
        parts.push(`内容: ${content}`);
      }

      if (source.aiSummary) {
        parts.push(`AI 总结: ${source.aiSummary}`);
      }

      return parts.join("\n");
    });

    return contextParts.join("\n\n---\n\n");
  }

  /**
   * Get model configuration using ChatFacade
   */
  private async getModelConfig(modelId?: string) {
    // If model ID is provided, find by ID
    if (modelId) {
      const model = await this.chatFacade.getModelById(modelId);
      if (model) {
        this.logger.log(
          `[AIStudio] Using specified model: ${model.displayName} (${model.modelId})`,
        );
        return model;
      }
    }

    // Fallback to default CHAT model
    const defaultModel = await this.chatFacade.getDefaultTextModel();

    if (defaultModel) {
      this.logger.log(
        `[AIStudio] Using default CHAT model: ${defaultModel.displayName} (${defaultModel.modelId})`,
      );
      return defaultModel;
    }

    // No model available
    this.logger.warn("[AIStudio] No enabled CHAT model found");
    return null;
  }

  /**
   * Build system prompt with source context
   * Uses NotebookLM-style numbered citations [1], [2], etc.
   */
  private buildSystemPrompt(sourceContext: string): string {
    const basePrompt = `你是一个专业的研究助手，帮助用户分析和理解研究资料。

**引用格式要求（非常重要）**：
- 在回答中引用资料时，必须使用数字标记格式：[1]、[2]、[3] 等
- 数字对应资料的顺序编号（资料 1 = [1]，资料 2 = [2]）
- 可以同时引用多个资料：[1, 2] 或 [1, 3, 5]
- 引用应该紧跟在相关陈述之后
- 例如："根据最新研究，AI 技术正在快速发展 [1]，这将对多个行业产生深远影响 [2, 3]。"

**回答要求**：
1. 基于提供的资料内容进行分析和回答
2. 每个关键观点都应该标注引用来源
3. 如果资料中没有相关信息，请明确说明
4. 保持客观、准确、专业的态度
5. 使用清晰的结构组织回答（可使用 Markdown 格式）`;

    if (sourceContext) {
      return `${basePrompt}

---

**用户选择的研究资料**：

${sourceContext}

---

请基于以上资料回答用户的问题，并在相关陈述后标注引用 [1]、[2] 等。`;
    }

    return `${basePrompt}

注意：用户没有选择任何研究资料。如果用户的问题需要基于特定资料回答，请提醒他们先选择相关资料。`;
  }

  /**
   * Add AI response to chat
   */
  async addAIResponse(
    chatId: string,
    content: string,
    citations?: string[],
    tokensUsed?: number,
  ) {
    const chat = await this.prisma.researchProjectChat.findUnique({
      where: { id: chatId },
    });

    if (!chat) {
      throw new NotFoundException("Chat not found");
    }

    const aiMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "assistant",
      content,
      timestamp: new Date().toISOString(),
      citations,
    };

    const messages = (chat.messages as unknown as ChatMessage[]) || [];
    messages.push(aiMessage);

    return this.prisma.researchProjectChat.update({
      where: { id: chatId },
      data: {
        messages: messages as unknown as InputJsonValue,
        tokensUsed: (chat.tokensUsed || 0) + (tokensUsed || 0),
      },
    });
  }

  /**
   * Get chat history
   */
  async getChatHistory(userId: string, projectId: string) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    return this.prisma.researchProjectChat.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        modelUsed: true,
        tokensUsed: true,
      },
    });
  }

  /**
   * Start a new chat session
   */
  async startNewChat(userId: string, projectId: string) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    const chat = await this.prisma.researchProjectChat.create({
      data: {
        projectId,
        messages: [],
        title: `Chat ${new Date().toLocaleDateString()}`,
      },
    });

    // Update chat count
    await this.prisma.researchProject.update({
      where: { id: projectId },
      data: { chatCount: { increment: 1 } },
    });

    return chat;
  }

  // ==================== Notes ====================

  /**
   * Create a note in a project
   */
  async createNote(userId: string, projectId: string, dto: CreateNoteDto) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    const note = await this.prisma.researchProjectNote.create({
      data: {
        projectId,
        title: dto.title,
        content: dto.content,
        sourceType: dto.sourceType || "manual",
        chatId: dto.chatId,
        tags: dto.tags || [],
        isPinned: dto.isPinned || false,
      },
    });

    // Update note count
    await this.prisma.researchProject.update({
      where: { id: projectId },
      data: { noteCount: { increment: 1 } },
    });

    return note;
  }

  /**
   * Get all notes for a project
   */
  async getNotes(userId: string, projectId: string) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    return this.prisma.researchProjectNote.findMany({
      where: { projectId },
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    });
  }

  /**
   * Update a note
   */
  async updateNote(
    userId: string,
    projectId: string,
    noteId: string,
    dto: UpdateNoteDto,
  ) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    const note = await this.prisma.researchProjectNote.findUnique({
      where: { id: noteId },
    });

    if (!note || note.projectId !== projectId) {
      throw new NotFoundException("Note not found");
    }

    return this.prisma.researchProjectNote.update({
      where: { id: noteId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.isPinned !== undefined && { isPinned: dto.isPinned }),
      },
    });
  }

  /**
   * Delete a note
   */
  async deleteNote(userId: string, projectId: string, noteId: string) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    const note = await this.prisma.researchProjectNote.findUnique({
      where: { id: noteId },
    });

    if (!note || note.projectId !== projectId) {
      throw new NotFoundException("Note not found");
    }

    await this.prisma.researchProjectNote.delete({
      where: { id: noteId },
    });

    // Update note count
    await this.prisma.researchProject.update({
      where: { id: projectId },
      data: { noteCount: { decrement: 1 } },
    });

    return { success: true };
  }

  /**
   * Save chat message as note
   */
  async saveMessageAsNote(
    userId: string,
    projectId: string,
    chatId: string,
    messageContent: string,
    title?: string,
  ) {
    return this.createNote(userId, projectId, {
      title: title || "Saved from chat",
      content: messageContent,
      sourceType: "ai-chat",
      chatId,
    });
  }
}
