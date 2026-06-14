import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Logger,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
  UnauthorizedException,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { ApiTags } from "@nestjs/swagger";
import { LibraryKnowledgeGraphService } from "./knowledge-graph.service.postgres";
import { Public } from "../../../../common/decorators/public.decorator";
import { AiChatService } from "@/modules/ai-harness/facade";
import { BillingContext } from "../../../platform/facade";
import { AIModelType } from "@prisma/client";

/**
 * 知识图谱控制器
 * GET endpoints are public (read-only browsing).
 * POST and DELETE endpoints require authentication (write/expensive operations).
 */
@ApiTags("Knowledge Graph")
@Controller("knowledge-graph")
export class KnowledgeGraphController {
  private readonly logger = new Logger(KnowledgeGraphController.name);

  constructor(
    private kgService: LibraryKnowledgeGraphService,
    private aiChatService: AiChatService,
  ) {}

  /**
   * 为单个资源构建知识图谱
   * POST /api/v1/knowledge-graph/build/:id
   */
  @Post("build/:id")
  async buildGraphForResource(@Param("id") id: string) {
    this.logger.log(`Building knowledge graph for resource ${id}`);
    await this.kgService.buildGraphFromResource(id);
    return { message: "Knowledge graph built successfully", resourceId: id };
  }

  /**
   * 批量构建所有资源的知识图谱
   * POST /api/v1/knowledge-graph/build-all
   */
  @Post("build-all")
  async buildGraphForAll() {
    this.logger.log("Building knowledge graph for all resources");
    const result = await this.kgService.buildGraphForAllResources();
    return {
      message: "Batch build completed",
      ...result,
    };
  }

  /**
   * 获取资源的知识图谱
   * GET /api/v1/knowledge-graph/resource/:id?depth=2
   */
  @Public()
  @Get("resource/:id")
  async getResourceGraph(
    @Param("id") id: string,
    @Query("depth", new DefaultValuePipe(2), ParseIntPipe) depth: number,
  ) {
    this.logger.log(
      `Fetching knowledge graph for resource ${id} (depth: ${depth})`,
    );
    return this.kgService.getResourceGraph(id, depth);
  }

  /**
   * 获取作者的知识图谱
   * GET /api/v1/knowledge-graph/author/:username
   */
  @Public()
  @Get("author/:username")
  async getAuthorGraph(@Param("username") username: string) {
    this.logger.log(`Fetching knowledge graph for author ${username}`);
    return this.kgService.getAuthorGraph(username);
  }

  /**
   * 获取主题的知识图谱
   * GET /api/v1/knowledge-graph/topic/:name
   */
  @Public()
  @Get("topic/:name")
  async getTopicGraph(@Param("name") name: string) {
    this.logger.log(`Fetching knowledge graph for topic ${name}`);
    return this.kgService.getTopicGraph(name);
  }

  /**
   * 获取知识图谱概览
   * GET /api/v1/knowledge-graph/overview
   *
   * Query params:
   * - userId: 用户ID，传入时返回用户个性化的知识图谱
   * - collectionId: 收藏集ID，筛选特定收藏集的内容
   * - includeNotes: 是否包含笔记节点（默认 true）
   */
  @Public()
  @Get("overview")
  async getOverview(
    @Query("userId") userId?: string,
    @Query("collectionId") collectionId?: string,
    @Query("includeNotes") includeNotes?: string,
  ) {
    const includeNotesFlag = includeNotes !== "false";

    if (userId) {
      this.logger.log(
        `Fetching personalized knowledge graph for user ${userId}` +
          (collectionId ? ` (collection: ${collectionId})` : ""),
      );
      return this.kgService.getUserGraphOverview(userId, {
        collectionId,
        includeNotes: includeNotesFlag,
      });
    }

    this.logger.log("Fetching global knowledge graph overview");
    return this.kgService.getGraphOverview();
  }

  /**
   * 查找相似资源
   * GET /api/v1/knowledge-graph/similar/:id?limit=10
   */
  @Public()
  @Get("similar/:id")
  async findSimilar(
    @Param("id") id: string,
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    this.logger.log(`Finding similar resources for ${id}`);
    return this.kgService.findSimilarResources(id, limit);
  }

  /**
   * 从资源移除关联节点
   * DELETE /api/v1/knowledge-graph/resource/:id/unlink
   * Body: { nodeType: "tag" | "category" | "author", nodeName: string }
   */
  @Delete("resource/:id/unlink")
  async unlinkNode(
    @Param("id") id: string,
    @Body() body: { nodeType: "tag" | "category" | "author"; nodeName: string },
  ) {
    const { nodeType, nodeName } = body;

    if (!nodeType || !nodeName) {
      throw new BadRequestException("nodeType and nodeName are required");
    }

    if (!["tag", "category", "author"].includes(nodeType)) {
      throw new BadRequestException(
        "nodeType must be one of: tag, category, author",
      );
    }

    this.logger.log(`Unlinking ${nodeType} "${nodeName}" from resource ${id}`);
    return this.kgService.unlinkNode(id, nodeType, nodeName);
  }

  /**
   * 从资源移除标签
   * DELETE /api/v1/knowledge-graph/resource/:id/tag/:tagName
   */
  @Delete("resource/:id/tag/:tagName")
  async unlinkTag(@Param("id") id: string, @Param("tagName") tagName: string) {
    this.logger.log(`Unlinking tag "${tagName}" from resource ${id}`);
    return this.kgService.unlinkTag(id, tagName);
  }

  /**
   * 从资源移除分类
   * DELETE /api/v1/knowledge-graph/resource/:id/category/:categoryName
   */
  @Delete("resource/:id/category/:categoryName")
  async unlinkCategory(
    @Param("id") id: string,
    @Param("categoryName") categoryName: string,
  ) {
    this.logger.log(`Unlinking category "${categoryName}" from resource ${id}`);
    return this.kgService.unlinkCategory(id, categoryName);
  }

  /**
   * 从资源移除作者
   * DELETE /api/v1/knowledge-graph/resource/:id/author/:authorName
   */
  @Delete("resource/:id/author/:authorName")
  async unlinkAuthor(
    @Param("id") id: string,
    @Param("authorName") authorName: string,
  ) {
    this.logger.log(`Unlinking author "${authorName}" from resource ${id}`);
    return this.kgService.unlinkAuthor(id, authorName);
  }

  /**
   * 知识图谱对话模式
   * POST /api/v1/knowledge-graph/chat
   *
   * Body: { message: string, userId?: string, collectionId?: string }
   * 基于当前图谱数据回答用户关于知识关联的问题
   */
  @Post("chat")
  async chat(
    @Req() req: Request,
    @Body()
    body: {
      message: string;
      collectionId?: string;
    },
  ) {
    const { message, collectionId } = body;
    // Always use authenticated user's ID — never trust client-supplied userId
    const userId = (req.user as { id?: string })?.id;
    if (!userId) {
      throw new UnauthorizedException("User authentication required");
    }
    if (!message?.trim()) {
      throw new BadRequestException("message is required");
    }

    this.logger.log(`[chat] userId=${userId} msg="${message.slice(0, 60)}"`);

    // 获取图谱概览作为上下文
    let graphSummary = "No graph data available yet.";
    try {
      const overview = await this.kgService.getUserGraphOverview(userId, {
        collectionId,
      });

      const stats = (overview as { stats?: Record<string, number> })?.stats;
      const nodes =
        (overview as { nodes?: { label: string; type: string }[] })?.nodes ??
        [];

      // 构建紧凑的文本摘要（top 20 节点 + 统计）
      const topNodes = nodes
        .slice(0, 20)
        .map((n) => `${n.type}:${n.label}`)
        .join(", ");

      graphSummary = stats
        ? `Graph stats — Resources: ${stats.totalResources ?? 0}, Authors: ${stats.totalAuthors ?? 0}, Topics: ${stats.totalTopics ?? 0}, Tags: ${stats.totalTags ?? 0}, Edges: ${stats.totalEdges ?? 0}.\nTop nodes: ${topNodes || "none"}.`
        : `Top nodes: ${topNodes || "none"}.`;
    } catch {
      // 图谱获取失败，使用默认摘要继续
    }

    const systemPrompt = `You are a knowledge graph assistant. The user is exploring a knowledge graph that connects resources, authors, topics, and tags.

Current graph context:
${graphSummary}

Help the user understand the connections and insights in their knowledge graph. Answer questions about relationships, suggest what to explore, or help them discover patterns. Be concise and insightful.`;

    return BillingContext.run(
      {
        userId,
        moduleType: "knowledge-graph",
        operationType: "chat",
        description: "Knowledge Graph Chat",
      },
      async () => {
        const result = await this.aiChatService.chat({
          messages: [{ role: "user", content: message }],
          systemPrompt,
          modelType: AIModelType.CHAT,
          taskProfile: { creativity: "medium", outputLength: "medium" },
          userId,
        });
        return { reply: result.content, model: result.model };
      },
    );
  }
}
