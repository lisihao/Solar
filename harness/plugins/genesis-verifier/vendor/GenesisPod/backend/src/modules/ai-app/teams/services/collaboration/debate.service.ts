/**
 * DebateService - 基于业界最佳实践的多AI辩论系统
 *
 * 参考架构:
 * - AutoGen (Microsoft): 独立Agent历史，topic隔离
 * - MAD (Multi-Agents-Debate): Devil/Angel对抗模式 + Judge
 * - DebateLLM (InstaDeep): 多种辩论协议
 *
 * 核心设计原则:
 * 1. 每个DebateSession是独立的，与Topic消息历史完全隔离
 * 2. 每个DebateAgent维护自己的conversationHistory，防止角色混乱
 * 3. 结构化的轮次管理，系统控制发言顺序
 * 4. 可选的Judge角色进行总结和裁决
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatMessage } from "@/modules/ai-harness/facade";
import { ChatFacade, TeamFacade } from "@/modules/ai-harness/facade";
import { DebateStatus, DebateRole, DebateAgent, Prisma } from "@prisma/client";

// 辩论消息类型（用于Agent的conversationHistory）
interface DebateHistoryMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: string;
  round?: number;
}

// 辩论配置
interface DebateConfig {
  maxRounds?: number;
  roundTimeoutMs?: number;
  enableJudge?: boolean;
  judgeAiMemberId?: string;
}

// 创建辩论请求
interface CreateDebateRequest {
  topicId: string;
  userId: string;
  debateTopic: string;
  redAiMemberId: string;
  blueAiMemberId: string;
  config?: DebateConfig;
}

@Injectable()
export class DebateService {
  private readonly logger = new Logger(DebateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
    private readonly teamFacade: TeamFacade,
  ) {}

  /**
   * 创建新的辩论会话
   * 关键：完全独立于Topic的消息历史
   */
  async createDebateSession(request: CreateDebateRequest) {
    const {
      topicId,
      userId,
      debateTopic,
      redAiMemberId,
      blueAiMemberId,
      config,
    } = request;

    this.logger.log(
      `[Debate] Creating new session: topic="${debateTopic}", red=${redAiMemberId}, blue=${blueAiMemberId}`,
    );

    // 获取AI成员信息
    const [redAi, blueAi] = await Promise.all([
      this.prisma.topicAIMember.findUnique({ where: { id: redAiMemberId } }),
      this.prisma.topicAIMember.findUnique({ where: { id: blueAiMemberId } }),
    ]);

    if (!redAi || !blueAi) {
      throw new NotFoundException("AI member not found");
    }

    // 创建辩论会话
    const session = await this.prisma.debateSession.create({
      data: {
        topicId,
        topic: debateTopic,
        status: DebateStatus.ACTIVE,
        maxRounds: config?.maxRounds || 3,
        currentRound: 1,
        roundTimeoutMs: config?.roundTimeoutMs || 120000,
        initiatedById: userId,
        agents: {
          create: [
            {
              aiMemberId: redAiMemberId,
              displayName: redAi.displayName,
              aiModel: redAi.aiModel,
              role: DebateRole.RED,
              stance: `支持/正方观点`,
              stancePrompt: this.buildAgentPrompt(
                DebateRole.RED,
                debateTopic,
                redAi.displayName,
                blueAi.displayName,
              ),
              conversationHistory: [],
            },
            {
              aiMemberId: blueAiMemberId,
              displayName: blueAi.displayName,
              aiModel: blueAi.aiModel,
              role: DebateRole.BLUE,
              stance: `反对/反方观点`,
              stancePrompt: this.buildAgentPrompt(
                DebateRole.BLUE,
                debateTopic,
                blueAi.displayName,
                redAi.displayName,
              ),
              conversationHistory: [],
            },
          ],
        },
      },
      include: {
        agents: true,
      },
    });

    this.logger.log(`[Debate] Session created: ${session.id}`);
    return session;
  }

  /**
   * 构建Agent的角色Prompt
   * 核心：明确身份、立场、对手，不依赖历史上下文
   */
  private buildAgentPrompt(
    role: DebateRole,
    debateTopic: string,
    myName: string,
    opponentName: string,
  ): string {
    if (role === DebateRole.RED) {
      return `
#############################################
#  🔴 辩论角色：正方辩手                      #
#############################################

【身份信息】
- 你的名字：${myName}
- 你的角色：正方/红方辩手
- 你的对手：${opponentName}（反方/蓝方）

【辩论主题】
>>> ${debateTopic} <<<

【核心规则】
1. 你必须支持正方立场（支持/赞成）
2. 只讨论上述主题，不讨论任何其他话题
3. 必须针对对手的观点进行回应和反驳
4. 每次发言结尾用 @${opponentName} 邀请对方回应

【发言格式】
**辩论主题**：${debateTopic}
**我方立场**：正方/支持
**核心论点**：[2-3个论点]
**数据佐证**：[证据来源]
**向对方提问**：[问题]

@${opponentName} 请回应
`;
    } else if (role === DebateRole.BLUE) {
      return `
#############################################
#  🔵 辩论角色：反方辩手                      #
#############################################

【身份信息】
- 你的名字：${myName}
- 你的角色：反方/蓝方辩手
- 你的对手：${opponentName}（正方/红方）

【辩论主题】
>>> ${debateTopic} <<<

【核心规则】
1. 你必须支持反方立场（反对/质疑）
2. 只讨论上述主题，不讨论任何其他话题
3. 必须针对对手的观点进行反驳
4. 每次发言结尾用 @${opponentName} 邀请对方回应

【发言格式】
**辩论主题**：${debateTopic}
**对方观点问题**：[指出问题]
**我方反驳**：[2-3个反驳点]
**反面证据**：[证据来源]
**质疑点**：[尖锐问题]

@${opponentName} 请继续
`;
    } else if (role === DebateRole.JUDGE) {
      return `
#############################################
#  ⚖️ 辩论角色：裁判                         #
#############################################

【辩论主题】
>>> ${debateTopic} <<<

【职责】
1. 客观评估双方论点的有效性
2. 指出各方论证的优缺点
3. 总结辩论要点
4. 给出公正的评判

【评判格式】
**辩论主题**：${debateTopic}
**正方论点评估**：[评价]
**反方论点评估**：[评价]
**关键交锋点**：[总结]
**综合评判**：[结论]
`;
    }
    return "";
  }

  /**
   * 执行辩论回合
   * 关键：使用Agent独立的conversationHistory，不读取Topic历史
   */
  async executeDebateRound(
    sessionId: string,
    agentId: string,
    opponentLastMessage?: string,
  ): Promise<{ content: string; tokensUsed: number }> {
    // 获取Agent信息
    const agent = await this.prisma.debateAgent.findUnique({
      where: { id: agentId },
      include: { session: true },
    });

    if (!agent) {
      throw new NotFoundException("Debate agent not found");
    }

    const session = agent.session;

    this.logger.log(
      `[Debate] Executing round ${session.currentRound} for agent ${agent.displayName} (${agent.role})`,
    );

    // 获取AI模型配置
    const aiModelConfig = await this.chatFacade.getModelById(agent.aiModel);
    if (!aiModelConfig) {
      throw new Error(`AI model not found: ${agent.aiModel}`);
    }

    // 构建消息历史（完全独立，不使用Topic历史）
    const history =
      agent.conversationHistory as unknown as DebateHistoryMessage[];

    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [];

    // 添加历史消息
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // 添加对手的最新消息（如果有）
    if (opponentLastMessage) {
      messages.push({
        role: "user",
        content: `【对手发言】\n${opponentLastMessage}\n\n请针对上述观点进行回应。`,
      });
    } else {
      // 第一轮，正方先发言
      messages.push({
        role: "user",
        content: `这是第 ${session.currentRound} 轮辩论。请阐述你的观点。`,
      });
    }

    // 调用AI生成回复
    const startTime = Date.now();
    const debateMessages: ChatMessage[] = [
      { role: "system", content: agent.stancePrompt || "" },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];
    const response = await this.chatFacade.chat({
      messages: debateMessages,
      model: agent.aiModel,
      taskProfile: {
        creativity: "medium",
        outputLength: "standard",
      },
      // ★ 自动积分扣除
      billing: session.initiatedById
        ? {
            userId: session.initiatedById,
            moduleType: "ai-teams",
            operationType: "debate",
            referenceId: sessionId,
            description: `AI辩论 - ${agent.displayName} (${session.topic})`,
          }
        : undefined,
    });
    const latencyMs = Date.now() - startTime;

    // 更新Agent的conversationHistory
    const newHistory: DebateHistoryMessage[] = [
      ...history,
      ...(opponentLastMessage
        ? [
            {
              role: "user" as const,
              content: opponentLastMessage,
              timestamp: new Date().toISOString(),
              round: session.currentRound,
            },
          ]
        : []),
      {
        role: "assistant" as const,
        content: response.content,
        timestamp: new Date().toISOString(),
        round: session.currentRound,
      },
    ];

    // 保存消息和更新Agent
    await this.prisma.$transaction([
      this.prisma.debateMessage.create({
        data: {
          sessionId,
          agentId,
          content: response.content,
          round: session.currentRound,
          modelUsed: agent.aiModel,
          tokensUsed: response.tokensUsed,
          latencyMs,
        },
      }),
      this.prisma.debateAgent.update({
        where: { id: agentId },
        data: {
          conversationHistory: newHistory as unknown as Prisma.InputJsonValue,
          messageCount: { increment: 1 },
          totalTokens: { increment: response.tokensUsed || 0 },
        },
      }),
    ]);

    this.logger.log(
      `[Debate] Agent ${agent.displayName} responded (${response.tokensUsed} tokens, ${latencyMs}ms)`,
    );

    // 通过 A2A Bus 广播辩论发言，供可观测性系统记录消息流
    void this.teamFacade.a2aPublish({
      sessionId,
      fromAgentId: agentId,
      type: "info_share",
      payload: {
        content: response.content,
        role: agent.role,
        round: session.currentRound,
        displayName: agent.displayName,
      },
    });

    return { content: response.content, tokensUsed: response.tokensUsed || 0 };
  }

  /**
   * 运行完整的辩论流程
   * 参考MAD架构：Red -> Blue -> Red -> Blue -> ... -> Judge
   * 新增：每轮结束后进行投票，收集团队共识
   */
  async runDebate(sessionId: string): Promise<void> {
    const session = await this.prisma.debateSession.findUnique({
      where: { id: sessionId },
      include: { agents: true },
    });

    if (!session) {
      throw new NotFoundException("Debate session not found");
    }

    const redAgent = session.agents.find(
      (a: DebateAgent) => a.role === DebateRole.RED,
    );
    const blueAgent = session.agents.find(
      (a: DebateAgent) => a.role === DebateRole.BLUE,
    );

    if (!redAgent || !blueAgent) {
      throw new Error("Missing red or blue agent");
    }

    this.logger.log(`[Debate] Starting debate: ${session.topic}`);
    this.logger.log(
      `[Debate] Red: ${redAgent.displayName}, Blue: ${blueAgent.displayName}`,
    );
    this.logger.log(`[Debate] Max rounds: ${session.maxRounds}`);

    let lastRedMessage = "";
    let lastBlueMessage = "";
    let consensusPosition: string | undefined;

    for (let round = 1; round <= session.maxRounds; round++) {
      this.logger.log(`[Debate] === Round ${round} ===`);

      // 更新当前轮次
      await this.prisma.debateSession.update({
        where: { id: sessionId },
        data: { currentRound: round },
      });

      // 红方发言
      const redResponse = await this.executeDebateRound(
        sessionId,
        redAgent.id,
        round === 1 ? undefined : lastBlueMessage,
      );
      lastRedMessage = redResponse.content;

      // 蓝方回应
      const blueResponse = await this.executeDebateRound(
        sessionId,
        blueAgent.id,
        lastRedMessage,
      );
      lastBlueMessage = blueResponse.content;

      // ★ 每轮结束后进行投票（如果 VotingManager 可用）
      const votingResult = await this.conductRoundVoting(
        sessionId,
        round,
        {
          id: redAgent.id,
          displayName: redAgent.displayName,
          position: lastRedMessage,
        },
        {
          id: blueAgent.id,
          displayName: blueAgent.displayName,
          position: lastBlueMessage,
        },
      );

      if (votingResult?.consensus) {
        consensusPosition = votingResult.winner;
        this.logger.log(
          `[Debate] Consensus reached in round ${round}: ${votingResult.winner}`,
        );
        // 可选：如果达成共识，提前结束辩论
        // break;
      }
    }

    // 辩论结束
    await this.prisma.debateSession.update({
      where: { id: sessionId },
      data: {
        status: DebateStatus.COMPLETED,
        completedAt: new Date(),
        // 可选：将共识信息存储到 session 的元数据中
      },
    });

    this.logger.log(`[Debate] Debate completed: ${sessionId}`);
    if (consensusPosition) {
      this.logger.log(
        `[Debate] Final consensus position: ${consensusPosition}`,
      );
    }
    this.teamFacade.a2aClearSession(sessionId);
  }

  /**
   * 在每轮辩论后进行投票
   * 基于参与者对各方论点的评估进行投票
   */
  private async conductRoundVoting(
    sessionId: string,
    round: number,
    redPosition: { id: string; displayName: string; position: string },
    bluePosition: { id: string; displayName: string; position: string },
  ): Promise<{ winner?: string; consensus: boolean } | null> {
    try {
      // 创建投票会话
      const session = this.teamFacade.votingCreate({
        id: `debate-${sessionId}-round-${round}`,
        topic: `第 ${round} 轮辩论投票`,
        options: [
          {
            id: redPosition.id,
            label: `${redPosition.displayName} (正方)`,
            description: redPosition.position.substring(0, 200), // 截取前200字符作为描述
          },
          {
            id: bluePosition.id,
            label: `${bluePosition.displayName} (反方)`,
            description: bluePosition.position.substring(0, 200),
          },
        ],
        strategy: "majority", // 简单多数决
        deadline: new Date(Date.now() + 60000), // 1分钟超时（实际上是同步投票）
        initiator: "debate-system", // 系统发起的投票
      });

      if (!session) {
        return null; // VotingManager not available
      }

      this.logger.log(
        `[Debate] Created voting session ${session.id} for round ${round}`,
      );

      // 在实际场景中，这里应该由参与者（可能是其他团队成员或裁判）投票
      // 现在我们模拟一个简单的评分机制：基于消息长度和结构作为代理指标
      // 注意：在真实实现中，应该有真实的评审机制或用户投票

      // 模拟投票：这里简化为基于论证复杂度的自动投票
      // 在实际应用中，应该由裁判或其他团队成员提供真实投票
      const redScore = this.evaluateArgumentStrength(redPosition.position);
      const blueScore = this.evaluateArgumentStrength(bluePosition.position);

      // Use AI evaluation judges instead of self-voting debaters
      const voters = [
        `judge-${sessionId}-round-${round}`,
        `judge-${sessionId}-review`,
      ];

      for (const voterId of voters) {
        // 基于评分投票
        const preferredOption =
          redScore > blueScore ? redPosition.id : bluePosition.id;
        this.teamFacade.votingCastVote(session.id, voterId, preferredOption);
      }

      // 关闭投票并获取结果
      const result = this.teamFacade.votingClose(session.id, voters.length);

      if (result) {
        this.logger.log(
          `[Debate] Round ${round} voting result: winner=${result.winner}, consensus=${result.consensus}`,
        );
        this.logger.debug(
          `[Debate] Voting tally: ${JSON.stringify(result.tally)}`,
        );

        return {
          winner: result.winner,
          consensus: result.consensus,
        };
      }

      return null;
    } catch (error) {
      this.logger.error(
        `[Debate] Failed to conduct voting for round ${round}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * 评估论证强度（简化版）
   * 在实际应用中，应该使用 AI 评估或人工评审
   */
  private evaluateArgumentStrength(argument: string): number {
    // 简单评分指标：
    // 1. 长度（更详细的论证）
    // 2. 是否包含证据关键词
    // 3. 是否包含逻辑连接词
    let score = 0;

    // 长度分（最多30分）
    score += Math.min(argument.length / 50, 30);

    // 证据关键词（每个5分，最多20分）
    const evidenceKeywords = [
      "数据",
      "研究",
      "证据",
      "统计",
      "报告",
      "调查",
      "实验",
      "案例",
    ];
    const evidenceCount = evidenceKeywords.filter((kw) =>
      argument.includes(kw),
    ).length;
    score += Math.min(evidenceCount * 5, 20);

    // 逻辑连接词（每个3分，最多15分）
    const logicKeywords = [
      "因为",
      "所以",
      "因此",
      "然而",
      "但是",
      "此外",
      "而且",
      "综上",
    ];
    const logicCount = logicKeywords.filter((kw) =>
      argument.includes(kw),
    ).length;
    score += Math.min(logicCount * 3, 15);

    // 结构化标记（如果包含格式化内容，加10分）
    if (argument.includes("**") || argument.includes("###")) {
      score += 10;
    }

    return score;
  }

  /**
   * 完成辩论会话
   */
  async completeDebate(sessionId: string) {
    await this.prisma.debateSession.update({
      where: { id: sessionId },
      data: {
        status: DebateStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
    this.logger.log(`[Debate] Session ${sessionId} marked as completed`);
    this.teamFacade.a2aClearSession(sessionId);
  }

  /**
   * 获取辩论会话详情
   */
  async getDebateSession(sessionId: string) {
    return this.prisma.debateSession.findUnique({
      where: { id: sessionId },
      include: {
        agents: true,
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  /**
   * 获取Topic下的所有辩论会话
   */
  async getDebatesByTopic(topicId: string) {
    return this.prisma.debateSession.findMany({
      where: { topicId },
      include: {
        agents: true,
        messages: {
          take: 1,
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 将辩论消息同步到Topic（可选，用于在聊天界面显示）
   */
  async syncDebateToTopic(
    sessionId: string,
    topicId: string,
    _userId: string,
  ): Promise<void> {
    const session = await this.prisma.debateSession.findUnique({
      where: { id: sessionId },
      include: {
        agents: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!session) {
      throw new NotFoundException("Debate session not found");
    }

    // 为每条辩论消息创建对应的Topic消息
    for (const msg of session.messages) {
      const agent = session.agents.find((a) => a.id === msg.agentId);
      if (!agent) continue;

      const topicMessage = await this.prisma.topicMessage.create({
        data: {
          topicId,
          aiMemberId: agent.aiMemberId,
          content: msg.content,
          contentType: "TEXT",
          modelUsed: msg.modelUsed,
          tokensUsed: msg.tokensUsed,
        },
      });

      // 更新辩论消息的topicMessageId
      await this.prisma.debateMessage.update({
        where: { id: msg.id },
        data: { topicMessageId: topicMessage.id },
      });
    }

    this.logger.log(
      `[Debate] Synced ${session.messages.length} messages to topic ${topicId}`,
    );
  }
}
