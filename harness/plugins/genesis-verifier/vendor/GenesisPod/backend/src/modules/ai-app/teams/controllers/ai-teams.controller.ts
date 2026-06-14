import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Logger,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import {
  RateLimit,
  RateLimitGuard,
} from "../../../../common/guards/rate-limit.guard";
import { AiTeamsService } from "../ai-teams.service";
import { AiTeamsGateway } from "../ai-teams.gateway";
import {
  DebateService,
  TeamMissionService,
  UrlParserService,
} from "../services";
import {
  CreateTopicDto,
  UpdateTopicDto,
  AddMemberDto,
  AddMembersDto,
  UpdateMemberDto,
  AddAIMemberDto,
  UpdateAIMemberDto,
  SendMessageDto,
  AddResourceDto,
  GenerateSummaryDto,
  ForwardMessagesDto,
  BookmarkMessageDto,
  CreateMissionDto,
  UpdateMissionNotificationDto,
  UpdateAIMemberTeamRoleDto,
} from "../dto";
import {
  TopicType,
  MentionType,
  TopicRole,
  MissionStatus,
} from "@prisma/client";
import type { RequestWithUser } from "../../../../common/types/express-request.types";

@ApiTags("AI Teams - Topics")
@ApiBearerAuth()
@Controller("topics")
@UseGuards(JwtAuthGuard)
export class AiTeamsController {
  private readonly logger = new Logger(AiTeamsController.name);

  constructor(
    private readonly aiGroupService: AiTeamsService,
    private readonly aiGroupGateway: AiTeamsGateway,
    private readonly debateService: DebateService,
    private readonly teamMissionService: TeamMissionService,
    private readonly urlParserService: UrlParserService,
  ) {}

  // ==================== Topic CRUD ====================

  @Post()
  @ApiOperation({
    summary: "创建话题",
    description: "创建新的 AI Teams 话题/团队",
  })
  @ApiResponse({ status: 201, description: "话题创建成功" })
  @ApiResponse({ status: 400, description: "请求参数错误" })
  async createTopic(
    @Request() req: RequestWithUser,
    @Body() dto: CreateTopicDto,
  ) {
    return this.aiGroupService.createTopic(req.user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: "获取话题列表",
    description: "获取当前用户的所有话题",
  })
  @ApiQuery({
    name: "type",
    required: false,
    enum: TopicType,
    description: "话题类型筛选",
  })
  @ApiQuery({ name: "search", required: false, description: "搜索关键词" })
  @ApiResponse({ status: 200, description: "话题列表" })
  async getTopics(
    @Request() req: RequestWithUser,
    @Query("type") type?: TopicType,
    @Query("search") search?: string,
  ) {
    return this.aiGroupService.getTopics(req.user.id, { type, search });
  }

  // ==================== Static Routes (must be before :topicId) ====================

  /**
   * 获取所有公开团队列表
   * GET /topics/public
   */
  @Get("public")
  async getPublicTopics(
    @Query("search") search?: string,
    @Query("limit") limit?: string,
  ) {
    return this.aiGroupService.getPublicTopics({
      search,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  /**
   * 获取我的加入请求列表
   * GET /topics/my-join-requests
   */
  @Get("my-join-requests")
  async getMyJoinRequests(@Request() req: RequestWithUser) {
    return this.aiGroupService.getMyJoinRequests(req.user.id);
  }

  /**
   * 审核加入请求
   * POST /topics/join-requests/:requestId/review
   */
  @Post("join-requests/:requestId/review")
  async reviewJoinRequest(
    @Request() req: RequestWithUser,
    @Param("requestId") requestId: string,
    @Body() body: { approve: boolean; responseNote?: string },
  ) {
    return this.aiGroupService.reviewJoinRequest(
      requestId,
      req.user.id,
      body.approve,
      body.responseNote,
    );
  }

  /**
   * 取消加入请求
   * DELETE /topics/join-requests/:requestId
   */
  @Delete("join-requests/:requestId")
  async cancelJoinRequest(
    @Request() req: RequestWithUser,
    @Param("requestId") requestId: string,
  ) {
    return this.aiGroupService.cancelJoinRequest(requestId, req.user.id);
  }

  // ==================== Dynamic Routes ====================

  @Get(":topicId")
  async getTopicById(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ) {
    return this.aiGroupService.getTopicById(topicId, req.user.id);
  }

  @Patch(":topicId")
  async updateTopic(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body() dto: UpdateTopicDto,
  ) {
    return this.aiGroupService.updateTopic(topicId, req.user.id, dto);
  }

  @Post(":topicId/archive")
  async archiveTopic(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ) {
    return this.aiGroupService.archiveTopic(topicId, req.user.id);
  }

  @Delete(":topicId")
  async deleteTopic(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ) {
    return this.aiGroupService.deleteTopic(topicId, req.user.id);
  }

  // ==================== Member Management ====================

  @Get(":topicId/members")
  async getMembers(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ) {
    const topic = await this.aiGroupService.getTopicById(topicId, req.user.id);
    return topic.members;
  }

  @Post(":topicId/members")
  async addMember(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.aiGroupService.addMember(topicId, req.user.id, dto);
  }

  @Post(":topicId/members/invite")
  async addMemberByEmail(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body() dto: { email: string; role?: TopicRole },
  ) {
    return this.aiGroupService.addMemberByEmail(
      topicId,
      req.user.id,
      dto.email,
      dto.role,
    );
  }

  @Post(":topicId/members/batch")
  async addMembers(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.aiGroupService.addMembers(topicId, req.user.id, dto);
  }

  @Patch(":topicId/members/:memberId")
  async updateMember(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("memberId") memberId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.aiGroupService.updateMember(
      topicId,
      req.user.id,
      memberId,
      dto,
    );
  }

  @Delete(":topicId/members/:memberId")
  async removeMember(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("memberId") memberId: string,
  ) {
    return this.aiGroupService.removeMember(topicId, req.user.id, memberId);
  }

  @Post(":topicId/leave")
  async leaveTopic(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ) {
    return this.aiGroupService.leaveTopic(topicId, req.user.id);
  }

  /**
   * 申请加入团队
   * POST /topics/:topicId/join-request
   */
  @Post(":topicId/join-request")
  async requestToJoinTopic(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body() body: { requestMessage?: string },
  ) {
    return this.aiGroupService.requestToJoinTopic(
      topicId,
      req.user.id,
      body.requestMessage,
    );
  }

  /**
   * 获取团队的加入请求列表（管理员）
   * GET /topics/:topicId/join-requests
   */
  @Get(":topicId/join-requests")
  async getJoinRequests(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ) {
    return this.aiGroupService.getJoinRequests(topicId, req.user.id);
  }

  // ==================== AI Member Management ====================

  @Get(":topicId/ai-members")
  async getAIMembers(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ) {
    const topic = await this.aiGroupService.getTopicById(topicId, req.user.id);
    return topic.aiMembers;
  }

  @Post(":topicId/ai-members")
  async addAIMember(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body() dto: AddAIMemberDto,
  ) {
    return this.aiGroupService.addAIMember(topicId, req.user.id, dto);
  }

  @Patch(":topicId/ai-members/:aiMemberId")
  async updateAIMember(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("aiMemberId") aiMemberId: string,
    @Body() dto: UpdateAIMemberDto,
  ) {
    return this.aiGroupService.updateAIMember(
      topicId,
      req.user.id,
      aiMemberId,
      dto,
    );
  }

  @Delete(":topicId/ai-members/:aiMemberId")
  async removeAIMember(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("aiMemberId") aiMemberId: string,
  ) {
    return this.aiGroupService.removeAIMember(topicId, req.user.id, aiMemberId);
  }

  /**
   * 红蓝思辨快捷创建 API
   * 一键设置两个 AI 成员进行辩论
   */
  @Post(":topicId/ai-members/debate")
  async setupDebate(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body()
    dto: {
      redAiModel: string; // 红方使用的模型，如 "grok-3"
      blueAiModel: string; // 蓝方使用的模型，如 "gpt-5.1"
      topic?: string; // 辩论主题（可选，用于自定义 prompt）
    },
  ) {
    return this.aiGroupService.setupDebateAIs(
      topicId,
      req.user.id,
      dto.redAiModel,
      dto.blueAiModel,
      dto.topic,
    );
  }

  // ==================== Messages ====================

  @Get(":topicId/messages")
  async getMessages(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.aiGroupService.getMessages(topicId, req.user.id, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post(":topicId/messages")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    maxRequests: 60,
    windowSeconds: 60,
    message: "消息发送过于频繁，请稍后再试",
  })
  @ApiOperation({ summary: "发送消息", description: "向话题发送消息" })
  @ApiResponse({ status: 201, description: "消息发送成功" })
  @ApiResponse({ status: 429, description: "请求过于频繁" })
  async sendMessage(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body() dto: SendMessageDto,
  ) {
    const message = await this.aiGroupService.sendMessage(
      topicId,
      req.user.id,
      dto,
    );

    if (!message) {
      return null;
    }

    // 通过 WebSocket 广播新消息给所有房间成员
    this.logger.log(`Broadcasting message ${message.id} to topic ${topicId}`);
    void this.aiGroupGateway.emitToTopic(topicId, "message:new", message);

    // 处理 mentions - 向被@的用户发送通知
    if (dto.mentions && dto.mentions.length > 0) {
      // 收集需要响应的 AI 成员（保留顺序）
      const aiMembersToRespond: Array<{ id: string; displayName: string }> = [];
      const aiMemberIdsSet = new Set<string>();

      // 获取 topic 信息（一次性获取，避免重复查询）
      const topic = await this.aiGroupService.getTopicById(
        topicId,
        req.user.id,
      );
      const allAIMembers = topic.aiMembers || [];

      for (const mention of dto.mentions) {
        if (mention.mentionType === MentionType.AI && mention.aiMemberId) {
          // @单个AI - 按顺序添加
          if (!aiMemberIdsSet.has(mention.aiMemberId)) {
            const ai = allAIMembers.find((a) => a.id === mention.aiMemberId);
            if (ai) {
              aiMembersToRespond.push({
                id: ai.id,
                displayName: ai.displayName,
              });
              aiMemberIdsSet.add(mention.aiMemberId);
            }
          }
        } else if (
          mention.mentionType === MentionType.ALL_AI ||
          mention.mentionType === MentionType.ALL
        ) {
          // @All AIs 或 @Everyone：按创建顺序添加所有 AI
          this.logger.log(
            `@${mention.mentionType === MentionType.ALL ? "Everyone" : "All AIs"} triggered`,
          );
          for (const ai of allAIMembers) {
            if (!aiMemberIdsSet.has(ai.id)) {
              aiMembersToRespond.push({
                id: ai.id,
                displayName: ai.displayName,
              });
              aiMemberIdsSet.add(ai.id);
            }
          }
          // @Everyone 也要通知人类成员
          if (mention.mentionType === MentionType.ALL && topic.members) {
            for (const member of topic.members) {
              if (member.userId !== req.user.id) {
                this.aiGroupGateway.emitToUser(member.userId, "mention:new", {
                  topicId,
                  messageId: message.id,
                  fromUserId: req.user.id,
                  content:
                    message.content.length > 100
                      ? message.content.substring(0, 100) + "..."
                      : message.content,
                  timestamp: message.createdAt,
                  mentionType: "everyone",
                });
              }
            }
          }
        } else if (mention.mentionType === MentionType.USER && mention.userId) {
          // @真人用户：发送通知
          this.aiGroupGateway.emitToUser(mention.userId, "mention:new", {
            topicId,
            messageId: message.id,
            fromUserId: req.user.id,
            content:
              message.content.length > 100
                ? message.content.substring(0, 100) + "..."
                : message.content,
            timestamp: message.createdAt,
          });
        }
      }

      // 检测是否 @Leader 并包含任务控制命令（继续执行、重试等）
      const leader = allAIMembers.find((ai) => ai.isLeader);
      if (leader && aiMemberIdsSet.has(leader.id)) {
        // 用户 @了 Leader，检查是否是任务控制命令
        const commandResult =
          await this.teamMissionService.handleLeaderMentionCommand(
            topicId,
            req.user.id,
            dto.content,
          );

        if (commandResult.handled) {
          this.logger.log(
            `[Leader Command] Handled: action=${commandResult.action}, missionId=${commandResult.missionId}`,
          );
          // 命令已处理，不需要触发 AI 响应
          return message;
        }
      }

      // 在 Controller 层统一检测辩论模式
      const debateInfo = this.detectDebateMode(dto.content, aiMembersToRespond);

      if (debateInfo.isDebate && debateInfo.redAI && debateInfo.blueAI) {
        // 【新架构】使用独立的DebateService处理辩论
        // 参考业界最佳实践：AutoGen, MAD, DebateLLM
        this.logger.log(
          `[Debate] Creating new debate session: Red=${debateInfo.redAI.displayName}, Blue=${debateInfo.blueAI.displayName}, Topic=${debateInfo.topic}`,
        );

        // 异步启动辩论（不阻塞消息返回）
        void this.runDebateInBackground(
          topicId,
          req.user.id,
          debateInfo.topic,
          debateInfo.redAI.id,
          debateInfo.blueAI.id,
        );

        // 其他 AI 作为观察者（如果有）
        for (const ai of aiMembersToRespond) {
          if (ai.id !== debateInfo.redAI.id && ai.id !== debateInfo.blueAI.id) {
            setTimeout(() => {
              void this.aiGroupGateway.emitToTopic(topicId, "ai:typing", {
                topicId,
                aiMemberId: ai.id,
              });
              void this.generateAIResponseInBackground(
                topicId,
                req.user.id,
                ai.id,
                0,
                null,
              );
            }, 4000);
          }
        }
      } else {
        // 普通模式：并行触发所有 AI
        for (const ai of aiMembersToRespond) {
          this.logger.log(`Triggering AI response for ${ai.displayName}`);
          void this.aiGroupGateway.emitToTopic(topicId, "ai:typing", {
            topicId,
            aiMemberId: ai.id,
          });
          void this.generateAIResponseInBackground(
            topicId,
            req.user.id,
            ai.id,
            0,
            null,
          );
        }
      }
    }

    return message;
  }

  /**
   * 在 Controller 层统一检测辩论模式
   * 返回是否为辩论、红方AI、蓝方AI、辩论主题
   */
  private detectDebateMode(
    content: string,
    aiMembers: Array<{ id: string; displayName: string }>,
  ): {
    isDebate: boolean;
    redAI: { id: string; displayName: string } | null;
    blueAI: { id: string; displayName: string } | null;
    topic: string;
  } {
    // 必须同时满足：1. @了至少2个AI  2. 包含辩论关键词
    // 关键词要求严格，避免误触发
    if (aiMembers.length < 2) {
      return { isDebate: false, redAI: null, blueAI: null, topic: "" };
    }

    const debateKeywords = [
      "辩论",
      "辩一下",
      "辩一辩",
      "辩题",
      "思辨",
      "红蓝",
      "正方反方",
      "讨论一下",
      "讨论下",
      "PK",
      "pk",
      "debate",
      "对决",
    ];

    const contentLower = content.toLowerCase();
    const isDebateRequest = debateKeywords.some((kw) =>
      contentLower.includes(kw.toLowerCase()),
    );

    if (!isDebateRequest) {
      return { isDebate: false, redAI: null, blueAI: null, topic: "" };
    }

    // 提取辩论主题（去掉@mentions和关键词后的内容）
    const debateTopic = content
      .replace(/@[\w\-()（）\s\u4e00-\u9fa5]+/g, "") // 移除@mentions（包括中文）
      .replace(
        /辩论|辩一下|辩一辩|辩题|思辨|红蓝|正方反方|讨论一下|讨论下|PK|pk|debate|对决/gi,
        "",
      )
      .replace(/[：:请]/g, "")
      .trim();

    // 第一个 AI 是红方，第二个是蓝方（基于传入顺序）
    return {
      isDebate: true,
      redAI: aiMembers[0],
      blueAI: aiMembers[1],
      topic: debateTopic || "（请根据上下文确定主题）",
    };
  }

  // 后台生成 AI 响应
  private async generateAIResponseInBackground(
    topicId: string,
    userId: string,
    aiMemberId: string,
    depth: number = 0,
    debateRole: {
      role: "red" | "blue";
      opponent: { id: string; displayName: string };
      topic: string;
    } | null = null,
  ) {
    const AI_TIMEOUT_MS = 120000; // 2 minutes timeout
    const MAX_AI_CHAIN_DEPTH = 3; // 最大AI链式调用深度
    const MAX_DEBATE_ROUNDS = 3; // 辩论最大轮次

    this.logger.log(
      `[AI Response] Starting generation for topic=${topicId}, aiMemberId=${aiMemberId}, depth=${depth}, debateRole=${debateRole?.role || "none"}`,
    );

    try {
      // Wrap the AI call with a timeout to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("AI response generation timed out")),
          AI_TIMEOUT_MS,
        );
      });

      const aiMessage = await Promise.race([
        this.aiGroupService.generateAIResponse(
          topicId,
          userId,
          aiMemberId,
          [],
          debateRole, // 传递辩论角色信息
        ),
        timeoutPromise,
      ]);

      this.logger.log(
        `[AI Response] Success for topic=${topicId}, messageId=${aiMessage.id}`,
      );

      // 广播AI响应
      void this.aiGroupGateway.emitToTopic(topicId, "ai:response", {
        aiMemberId,
        messageId: aiMessage.id,
      });
      void this.aiGroupGateway.emitToTopic(topicId, "message:new", aiMessage);

      // AI-AI协作：检测AI回复中是否@了其他AI
      // 【关键修复】仅在辩论模式下才触发 AI-AI 协作链
      // 普通对话中，即使 AI 回复中 @ 了其他 AI，也不自动触发
      // 这避免了简单问候被 AI 误解为需要邀请其他 AI 参与的情况
      if (debateRole && depth < MAX_AI_CHAIN_DEPTH && aiMessage.content) {
        const mentionedAIs =
          await this.aiGroupService.parseAIMentionsFromContent(
            topicId,
            aiMessage.content,
            aiMemberId,
          );

        if (mentionedAIs.length > 0) {
          this.logger.log(
            `[AI-AI Collaboration] AI ${aiMemberId} (${aiMessage.aiMember?.displayName}) mentioned: ${mentionedAIs.map((ai) => ai.displayName).join(", ")}`,
          );

          // 检查是否超过辩论轮次限制
          if (depth >= MAX_DEBATE_ROUNDS) {
            this.logger.log(
              `[Debate] Max rounds (${MAX_DEBATE_ROUNDS}) reached, stopping debate`,
            );
            // 可选：发送辩论结束提示
            return;
          }

          // 延迟触发被@的AI
          for (let i = 0; i < mentionedAIs.length; i++) {
            const mentionedAI = mentionedAIs[i];

            // 辩论模式下的角色传递逻辑（核心修复）
            let nextDebateRole: {
              role: "red" | "blue";
              opponent: { id: string; displayName: string };
              topic: string;
            } | null = null;

            if (debateRole) {
              // 当前AI有辩论角色，需要传递给被@的AI
              const currentAIName = aiMessage.aiMember?.displayName || "";

              if (mentionedAI.id === debateRole.opponent.id) {
                // 被@的是对手，传递相反角色
                nextDebateRole = {
                  role: debateRole.role === "red" ? "blue" : "red",
                  opponent: {
                    id: aiMemberId,
                    displayName: currentAIName,
                  },
                  topic: debateRole.topic,
                };
                this.logger.log(
                  `[Debate] Passing role to opponent: ${mentionedAI.displayName} will be ${nextDebateRole.role}, opponent=${currentAIName}, topic=${debateRole.topic}`,
                );
              } else {
                // 被@的不是对手（可能是第三方AI），作为观察者，不传递辩论角色
                this.logger.log(
                  `[Debate] ${mentionedAI.displayName} is not the opponent, treating as observer`,
                );
              }
            }

            setTimeout(
              () => {
                this.logger.log(
                  `[AI-AI Collaboration] Triggering ${mentionedAI.displayName} with debateRole=${nextDebateRole?.role || "none"}`,
                );
                void this.aiGroupGateway.emitToTopic(topicId, "ai:typing", {
                  topicId,
                  aiMemberId: mentionedAI.id,
                });
                void this.generateAIResponseInBackground(
                  topicId,
                  userId,
                  mentionedAI.id,
                  depth + 1,
                  nextDebateRole,
                );
              },
              (i + 1) * 2000, // 增加延迟到2秒，确保前一条消息已保存
            );
          }
        }
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `[AI Response] Error for topic=${topicId}, aiMemberId=${aiMemberId}: ${errorMessage}`,
      );
      void this.aiGroupGateway.emitToTopic(topicId, "ai:error", {
        aiMemberId,
        error: errorMessage,
      });
    }
  }

  /**
   * 【新架构】在后台运行辩论
   * 使用独立的DebateService，完全隔离于Topic消息历史
   * 每条消息实时发送到前端
   */
  private async runDebateInBackground(
    topicId: string,
    userId: string,
    debateTopic: string,
    redAiMemberId: string,
    blueAiMemberId: string,
  ) {
    try {
      this.logger.log(`[Debate] Starting new debate session...`);

      // 创建辩论会话
      const session = await this.debateService.createDebateSession({
        topicId,
        userId,
        debateTopic,
        redAiMemberId,
        blueAiMemberId,
        config: {
          maxRounds: 3,
          roundTimeoutMs: 120000,
        },
      });

      this.logger.log(`[Debate] Session created: ${session.id}`);

      const redAgent = session.agents.find((a) => a.role === "RED");
      const blueAgent = session.agents.find((a) => a.role === "BLUE");

      if (!redAgent || !blueAgent) {
        throw new Error("Missing red or blue agent");
      }

      // 通知前端辩论开始
      void this.aiGroupGateway.emitToTopic(topicId, "debate:started", {
        sessionId: session.id,
        topic: debateTopic,
        redAgent,
        blueAgent,
      });

      const maxRounds = 3;
      let lastRedMessage = "";
      let lastBlueMessage = "";

      // 手动控制辩论流程，每条消息实时发送
      for (let round = 1; round <= maxRounds; round++) {
        this.logger.log(`[Debate] === Round ${round} ===`);

        // 红方发言
        void this.aiGroupGateway.emitToTopic(topicId, "ai:typing", {
          aiMemberId: redAgent.aiMemberId,
          isTyping: true,
        });

        const redResponse = await this.debateService.executeDebateRound(
          session.id,
          redAgent.id,
          round === 1 ? undefined : lastBlueMessage,
        );
        lastRedMessage = redResponse.content;

        // 创建TopicMessage并实时发送
        const redTopicMessage = await this.aiGroupService.createAIMessage(
          topicId,
          redAgent.aiMemberId,
          redResponse.content,
          redAgent.aiModel,
          redResponse.tokensUsed,
        );

        void this.aiGroupGateway.emitToTopic(topicId, "ai:typing", {
          aiMemberId: redAgent.aiMemberId,
          isTyping: false,
        });
        void this.aiGroupGateway.emitToTopic(
          topicId,
          "message:new",
          redTopicMessage,
        );

        // 蓝方回应
        void this.aiGroupGateway.emitToTopic(topicId, "ai:typing", {
          aiMemberId: blueAgent.aiMemberId,
          isTyping: true,
        });

        const blueResponse = await this.debateService.executeDebateRound(
          session.id,
          blueAgent.id,
          lastRedMessage,
        );
        lastBlueMessage = blueResponse.content;

        // 创建TopicMessage并实时发送
        const blueTopicMessage = await this.aiGroupService.createAIMessage(
          topicId,
          blueAgent.aiMemberId,
          blueResponse.content,
          blueAgent.aiModel,
          blueResponse.tokensUsed,
        );

        void this.aiGroupGateway.emitToTopic(topicId, "ai:typing", {
          aiMemberId: blueAgent.aiMemberId,
          isTyping: false,
        });
        void this.aiGroupGateway.emitToTopic(
          topicId,
          "message:new",
          blueTopicMessage,
        );
      }

      // 更新辩论状态为完成
      await this.debateService.completeDebate(session.id);

      // 通知前端辩论结束
      void this.aiGroupGateway.emitToTopic(topicId, "debate:completed", {
        sessionId: session.id,
      });

      this.logger.log(`[Debate] Debate completed`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`[Debate] Error: ${errorMessage}`);
      void this.aiGroupGateway.emitToTopic(topicId, "debate:error", {
        error: errorMessage,
      });
    }
  }

  // ==================== Debate API Endpoints ====================

  @Get(":topicId/debates")
  async getDebates(@Param("topicId") topicId: string) {
    return this.debateService.getDebatesByTopic(topicId);
  }

  @Get(":topicId/debates/:debateId")
  async getDebate(@Param("debateId") debateId: string) {
    return this.debateService.getDebateSession(debateId);
  }

  @Delete(":topicId/messages/:messageId")
  async deleteMessage(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("messageId") messageId: string,
  ) {
    return this.aiGroupService.deleteMessage(topicId, req.user.id, messageId);
  }

  @Post(":topicId/messages/:messageId/reactions")
  async addReaction(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("messageId") messageId: string,
    @Body("emoji") emoji: string,
  ) {
    return this.aiGroupService.addReaction(
      topicId,
      req.user.id,
      messageId,
      emoji,
    );
  }

  @Delete(":topicId/messages/:messageId/reactions/:emoji")
  async removeReaction(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("messageId") messageId: string,
    @Param("emoji") emoji: string,
  ) {
    return this.aiGroupService.removeReaction(
      topicId,
      req.user.id,
      messageId,
      emoji,
    );
  }

  @Post(":topicId/read")
  async markAsRead(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body("messageId") messageId?: string,
  ) {
    return this.aiGroupService.markAsRead(topicId, req.user.id, messageId);
  }

  // ==================== AI Response ====================

  @Post(":topicId/ai/generate")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    maxRequests: 10,
    windowSeconds: 60,
    message: "AI 请求过于频繁，请稍后再试",
  })
  @ApiOperation({
    summary: "生成AI响应",
    description: "触发指定AI成员生成响应",
  })
  @ApiResponse({ status: 201, description: "AI响应生成成功" })
  @ApiResponse({ status: 429, description: "请求过于频繁" })
  async generateAIResponse(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body("aiMemberId") aiMemberId: string,
    @Body("contextMessageIds") contextMessageIds?: string[],
  ) {
    return this.aiGroupService.generateAIResponse(
      topicId,
      req.user.id,
      aiMemberId,
      contextMessageIds || [],
    );
  }

  /**
   * SSE 流式生成 AI 响应
   */
  @Post(":topicId/ai/generate/stream")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    maxRequests: 10,
    windowSeconds: 60,
    message: "AI 请求过于频繁，请稍后再试",
  })
  @ApiOperation({
    summary: "流式生成AI响应 (SSE)",
    description: "通过 Server-Sent Events 实时推送 AI 生成内容",
  })
  @ApiResponse({ status: 200, description: "SSE 流连接成功" })
  @ApiResponse({ status: 429, description: "请求过于频繁" })
  async generateAIResponseStream(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body("aiMemberId") aiMemberId: string,
    @Body("contextMessageIds") contextMessageIds: string[] = [],
    @Res() res: Response,
  ) {
    // 设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const userId = req.user.id;

    // 发送开始事件
    this.sendSSEEvent(res, "start", {
      topicId,
      aiMemberId,
      timestamp: new Date().toISOString(),
    });

    try {
      // 调用生成服务
      const result = await this.aiGroupService.generateAIResponse(
        topicId,
        userId,
        aiMemberId,
        contextMessageIds,
      );

      if (result) {
        // 模拟流式输出（按字符分块发送）
        const content = result.content || "";
        const chunkSize = 30; // 每块约30个字符

        for (let i = 0; i < content.length; i += chunkSize) {
          const chunk = content.slice(i, i + chunkSize);
          this.sendSSEEvent(res, "chunk", {
            content: chunk,
            index: Math.floor(i / chunkSize),
          });

          // 添加小延迟模拟打字效果
          await this.delay(20);
        }

        // 发送完成事件
        this.sendSSEEvent(res, "complete", {
          messageId: result.id,
          model: result.aiMember?.aiModel,
          totalLength: content.length,
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`SSE AI generate error: ${errorMessage}`);

      this.sendSSEEvent(res, "error", {
        message: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }

    // 发送结束标记
    res.write("data: [DONE]\n\n");
    res.end();
  }

  /**
   * 发送 SSE 事件
   */
  private sendSSEEvent(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /**
   * 延迟工具函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==================== Resources ====================

  @Get(":topicId/resources")
  async getResources(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ) {
    return this.aiGroupService.getResources(topicId, req.user.id);
  }

  @Post(":topicId/resources")
  async addResource(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body() dto: AddResourceDto,
  ) {
    return this.aiGroupService.addResource(topicId, req.user.id, dto);
  }

  @Delete(":topicId/resources/:resourceId")
  async removeResource(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("resourceId") resourceId: string,
  ) {
    return this.aiGroupService.removeResource(topicId, req.user.id, resourceId);
  }

  // ==================== Summaries ====================

  @Get(":topicId/summaries")
  async getSummaries(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ) {
    return this.aiGroupService.getSummaries(topicId, req.user.id);
  }

  @Post(":topicId/summaries")
  async generateSummary(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body() dto: GenerateSummaryDto,
  ) {
    return this.aiGroupService.generateSummary(topicId, req.user.id, dto);
  }

  @Delete(":topicId/summaries/:summaryId")
  async deleteSummary(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("summaryId") summaryId: string,
  ) {
    return this.aiGroupService.deleteSummary(topicId, req.user.id, summaryId);
  }

  // ==================== Message Forward & Bookmark ====================

  @Post(":topicId/messages/forward")
  async forwardMessages(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body() dto: ForwardMessagesDto,
  ) {
    const result = await this.aiGroupService.forwardMessages(
      topicId,
      req.user.id,
      dto,
    );

    // 如果转发到其他Topic，通知目标Topic的成员
    if (dto.targetType === "TOPIC" && dto.targetTopicId) {
      void this.aiGroupGateway.emitToTopic(
        dto.targetTopicId,
        "messages:forwarded",
        {
          fromTopicId: topicId,
          messageCount: result.messageCount,
          forwardedById: req.user.id,
        },
      );
    }

    return result;
  }

  @Post(":topicId/messages/:messageId/bookmark")
  async bookmarkMessage(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("messageId") messageId: string,
    @Body() dto: BookmarkMessageDto,
  ) {
    return this.aiGroupService.bookmarkMessage(
      topicId,
      req.user.id,
      messageId,
      dto,
    );
  }

  @Delete(":topicId/messages/:messageId/bookmark")
  async unbookmarkMessage(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("messageId") messageId: string,
  ) {
    return this.aiGroupService.unbookmarkMessage(
      topicId,
      req.user.id,
      messageId,
    );
  }

  // ==================== Team Mission API ====================

  @Post(":topicId/missions")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    maxRequests: 5,
    windowSeconds: 60,
    message: "任务创建过于频繁，请稍后再试",
  })
  @ApiOperation({
    summary: "创建团队任务",
    description: "创建新的AI团队协作任务",
  })
  @ApiResponse({ status: 201, description: "任务创建成功" })
  @ApiResponse({ status: 429, description: "请求过于频繁" })
  async createMission(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Body() dto: CreateMissionDto,
  ) {
    return this.teamMissionService.createMission(topicId, req.user.id, dto);
  }

  @Get(":topicId/missions")
  async getMissions(
    @Param("topicId") topicId: string,
    @Query("status") status?: MissionStatus,
  ) {
    return this.teamMissionService.getMissions(topicId, {
      status,
    });
  }

  @Get(":topicId/missions/:missionId")
  async getMissionById(
    @Param("topicId") _topicId: string,
    @Param("missionId") missionId: string,
  ) {
    return this.teamMissionService.getMissionById(missionId);
  }

  @Post(":topicId/missions/:missionId/cancel")
  async cancelMission(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("missionId") missionId: string,
  ) {
    return this.teamMissionService.cancelMission(missionId, req.user.id);
  }

  @Post(":topicId/missions/:missionId/pause")
  async pauseMission(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("missionId") missionId: string,
  ) {
    return this.teamMissionService.pauseMission(missionId, req.user.id);
  }

  @Post(":topicId/missions/:missionId/resume")
  async resumeMission(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("missionId") missionId: string,
  ) {
    return this.teamMissionService.resumeMission(missionId, req.user.id);
  }

  @Post(":topicId/missions/:missionId/retry")
  async retryMission(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("missionId") missionId: string,
    @Body() body: { mode?: "full" | "continue"; reason?: string },
  ) {
    return this.teamMissionService.retryMission(missionId, req.user.id, {
      mode: body.mode,
      reason: body.reason,
    });
  }

  @Get(":topicId/missions/:missionId/full-report")
  @ApiOperation({
    summary: "获取完整报告",
    description: "从数据库获取完整报告内容，确保所有章节都包含",
  })
  @ApiResponse({ status: 200, description: "获取成功" })
  async getFullReport(
    @Param("topicId") _topicId: string,
    @Param("missionId") missionId: string,
  ) {
    return this.teamMissionService.getFullReport(missionId);
  }

  @Post(":topicId/missions/:missionId/regenerate-report")
  @ApiOperation({
    summary: "重新生成最终报告",
    description: "重新生成已完成任务的最终报告，修复排序或内容缺失问题",
  })
  @ApiResponse({ status: 200, description: "报告重新生成成功" })
  async regenerateFinalReport(
    @Param("topicId") _topicId: string,
    @Param("missionId") missionId: string,
  ) {
    return this.teamMissionService.regenerateFinalReport(missionId);
  }

  @Get(":topicId/missions/:missionId/logs")
  async getMissionLogs(
    @Param("topicId") _topicId: string,
    @Param("missionId") missionId: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.teamMissionService.getMissionLogs(missionId, {
      limit: limit ? parseInt(limit) : undefined,
      cursor,
    });
  }

  @Patch(":topicId/missions/:missionId/notification")
  @ApiOperation({
    summary: "更新任务通知配置",
    description: "更新任务完成后的邮件通知配置",
  })
  @ApiResponse({ status: 200, description: "通知配置更新成功" })
  async updateMissionNotification(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("missionId") missionId: string,
    @Body() dto: UpdateMissionNotificationDto,
  ) {
    return this.teamMissionService.updateMissionNotification(
      missionId,
      req.user.id,
      dto,
    );
  }

  @Delete(":topicId/missions/:missionId")
  @ApiOperation({
    summary: "删除任务",
    description: "删除已完成、失败或取消的任务（仅限历史任务）",
  })
  @ApiResponse({ status: 200, description: "任务删除成功" })
  @ApiResponse({ status: 400, description: "任务正在执行中，无法删除" })
  async deleteMission(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("missionId") missionId: string,
  ) {
    return this.teamMissionService.deleteMission(missionId, req.user.id);
  }

  // ==================== Team Role API ====================

  @Post(":topicId/ai-members/:aiMemberId/set-leader")
  async setLeader(
    @Param("topicId") topicId: string,
    @Param("aiMemberId") aiMemberId: string,
  ) {
    return this.teamMissionService.setLeader(topicId, aiMemberId);
  }

  @Patch(":topicId/ai-members/:aiMemberId/team-role")
  async updateTeamRole(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("aiMemberId") aiMemberId: string,
    @Body() dto: UpdateAIMemberTeamRoleDto,
  ) {
    return this.aiGroupService.updateAIMemberTeamRole(
      topicId,
      req.user.id,
      aiMemberId,
      dto,
    );
  }

  @Get(":topicId/team")
  async getTeamMembers(@Param("topicId") topicId: string) {
    return this.teamMissionService.getTeamMembers(topicId);
  }

  // ==================== URL Parsing ====================

  /**
   * 解析单个 URL
   */
  @Post("parse-url")
  async parseUrl(@Body() dto: { url: string }) {
    return this.urlParserService.parseUrl(dto.url);
  }

  /**
   * 批量解析 URL
   */
  @Post("parse-urls")
  async parseUrls(@Body() dto: { urls: string[] }) {
    return this.urlParserService.parseUrls(dto.urls);
  }

  /**
   * 从文本中检测 URL（不解析内容，仅检测）
   */
  @Post("detect-urls")
  async detectUrls(@Body() dto: { text: string }) {
    return this.urlParserService.detectUrls(dto.text);
  }

  /**
   * 从文本中检测并解析所有 URL
   */
  @Post("detect-and-parse-urls")
  async detectAndParseUrls(@Body() dto: { text: string }) {
    return this.urlParserService.detectAndParseUrls(dto.text);
  }
}

// Bookmarks controller (user level)
@Controller("bookmarks")
@UseGuards(JwtAuthGuard)
export class BookmarksController {
  constructor(private readonly aiGroupService: AiTeamsService) {}

  @Get()
  async getBookmarks(
    @Request() req: RequestWithUser,
    @Query("category") category?: string,
  ) {
    return this.aiGroupService.getBookmarks(req.user.id, { category });
  }

  @Get("categories")
  async getBookmarkCategories(@Request() req: RequestWithUser) {
    return this.aiGroupService.getBookmarkCategories(req.user.id);
  }
}

// Separate controller for user search to avoid route conflicts
@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly aiGroupService: AiTeamsService) {}

  @Get("search")
  async searchUsers(
    @Query("email") email?: string,
    @Query("query") query?: string,
    @Query("limit") limit?: string,
  ) {
    if (email) {
      return this.aiGroupService.searchUserByEmail(email);
    }
    if (query) {
      return this.aiGroupService.searchUsers(
        query,
        limit ? parseInt(limit) : 10,
      );
    }
    return [];
  }
}

// Public controller for shared reports (no authentication required)
@ApiTags("AI Teams - Public Reports")
@Controller("public/reports")
export class PublicReportsController {
  constructor(private readonly teamMissionService: TeamMissionService) {}

  @Get(":missionId")
  @ApiOperation({
    summary: "获取公开报告",
    description: "获取已完成任务的公开报告，无需登录",
  })
  @ApiResponse({ status: 200, description: "获取成功" })
  @ApiResponse({ status: 404, description: "报告不存在或未完成" })
  async getPublicReport(@Param("missionId") missionId: string) {
    return this.teamMissionService.getPublicReport(missionId);
  }
}
