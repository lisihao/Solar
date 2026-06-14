/**
 * Team Collaboration Service
 * 桥接 ai-agents 协作工具与 ai-teams 成员系统
 *
 * 重构于 2026-01-01: 使用数据库持久化替代内存存储
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { AiResponseService } from "../ai/ai-response.service";
import { randomUUID } from "crypto";
import {
  VoteStrategy,
  VoteValue,
  ProposalStatus,
  VoteProposal,
  VoteRecord,
} from "@prisma/client";

// ============================================================================
// Types
// ============================================================================

/**
 * 任务委派请求
 */
export interface HandoffRequest {
  topicId: string;
  fromMemberId: string; // 发起委派的成员
  toMemberId: string; // 目标成员
  task: string; // 任务描述
  context?: Record<string, unknown>;
  waitForResult?: boolean;
}

/**
 * 任务委派结果
 */
export interface HandoffResult {
  success: boolean;
  handoffId: string;
  targetMemberName: string;
  status: "delegated" | "completed" | "failed";
  responseMessageId?: string;
  error?: string;
}

/**
 * 投票请求
 */
export interface VoteRequest {
  topicId: string;
  proposalId: string;
  title: string;
  description: string;
  initiatorId: string; // 发起者（AI成员ID）
  voterIds: string[]; // 参与投票的成员ID列表
  strategy: "MAJORITY" | "SUPERMAJORITY" | "UNANIMOUS";
  options?: string[];
}

/**
 * 投票结果
 */
export interface VoteResult {
  success: boolean;
  proposalId: string;
  consensusReached: boolean;
  decision: string;
  votes: Array<{
    voterId: string;
    voterName: string;
    value: string;
    reason?: string;
  }>;
}

/**
 * 完整提案数据（包含投票记录和投票者信息）
 */
type ProposalWithVotes = VoteProposal & {
  votes: (VoteRecord & {
    voter: { id: string; displayName: string };
  })[];
  initiator: { id: string; displayName: string };
};

/**
 * 投票统计数据
 */
export interface VoteStatistics {
  totalVoters: number;
  votesReceived: number;
  participationRate: number;
  approves: number;
  rejects: number;
  abstains: number;
}

// ============================================================================
// Service Implementation
// ============================================================================

@Injectable()
export class TeamCollaborationService {
  private readonly logger = new Logger(TeamCollaborationService.name);

  constructor(
    private prisma: PrismaService,
    private aiResponseService: AiResponseService,
  ) {}

  /**
   * 委派任务给其他AI成员
   */
  async delegateTask(request: HandoffRequest): Promise<HandoffResult> {
    const handoffId = randomUUID();
    const {
      topicId,
      fromMemberId,
      toMemberId,
      task,
      context,
      waitForResult = false,
    } = request;

    this.logger.log(
      `[delegateTask] ${fromMemberId} -> ${toMemberId}: ${task.substring(0, 50)}...`,
    );

    try {
      // 1. 验证成员存在
      const [fromMember, toMember] = await Promise.all([
        this.prisma.topicAIMember.findFirst({
          where: { id: fromMemberId, topicId },
          select: { id: true, displayName: true },
        }),
        this.prisma.topicAIMember.findFirst({
          where: { id: toMemberId, topicId },
          select: { id: true, displayName: true, aiModel: true },
        }),
      ]);

      if (!fromMember) {
        throw new NotFoundException(
          `From member ${fromMemberId} not found in topic`,
        );
      }

      if (!toMember) {
        throw new NotFoundException(
          `To member ${toMemberId} not found in topic`,
        );
      }

      // 2. 创建委派消息
      const delegationMessage = await this.prisma.topicMessage.create({
        data: {
          topicId,
          aiMemberId: fromMemberId,
          content: `[任务委派] 委派给 @${toMember.displayName}\n\n**任务**：${task}\n\n${context ? `**上下文**：\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`` : ""}`,
          contentType: "TEXT",
          modelUsed: "system",
          tokensUsed: 0,
        },
      });

      this.logger.log(
        `[delegateTask] Created delegation message ${delegationMessage.id}`,
      );

      // 3. 如果 waitForResult=true，调用目标 AI 生成响应
      if (waitForResult) {
        try {
          // 构造任务消息作为上下文（无需事务，因为响应生成可能失败，消息已记录）
          const taskContextMessage = await this.prisma.topicMessage.create({
            data: {
              topicId,
              senderId: null, // 系统消息
              content: `@${toMember.displayName}\n\n${task}`,
              contentType: "TEXT",
            },
          });

          this.logger.log(
            `[delegateTask] Waiting for AI response from ${toMember.displayName}...`,
          );

          // 调用 AI 生成响应
          const response = await this.aiResponseService.generateAIResponse(
            topicId,
            "system", // 系统用户
            toMemberId,
            [taskContextMessage.id],
          );

          return {
            success: true,
            handoffId,
            targetMemberName: toMember.displayName,
            status: "completed",
            responseMessageId: response.id,
          };
        } catch (error) {
          this.logger.error(
            `[delegateTask] AI response generation failed:`,
            error,
          );

          return {
            success: false,
            handoffId,
            targetMemberName: toMember.displayName,
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }

      // 异步模式：立即返回
      return {
        success: true,
        handoffId,
        targetMemberName: toMember.displayName,
        status: "delegated",
      };
    } catch (error) {
      this.logger.error(`[delegateTask] Failed:`, error);

      return {
        success: false,
        handoffId,
        targetMemberName: "Unknown",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 发起共识投票（持久化到数据库）
   */
  async createVoteProposal(
    request: VoteRequest,
  ): Promise<{ proposalId: string; status: string }> {
    const {
      topicId,
      proposalId,
      title,
      description,
      initiatorId,
      voterIds,
      strategy,
      options,
    } = request;

    this.logger.log(
      `[createVoteProposal] Creating proposal ${proposalId} in topic ${topicId}`,
    );

    try {
      // 1. 验证发起者
      const initiator = await this.prisma.topicAIMember.findFirst({
        where: { id: initiatorId, topicId },
        select: { id: true, displayName: true },
      });

      if (!initiator) {
        throw new NotFoundException(
          `Initiator ${initiatorId} not found in topic`,
        );
      }

      // 2. 验证所有投票者
      const voters = await this.prisma.topicAIMember.findMany({
        where: {
          id: { in: voterIds },
          topicId,
        },
        select: { id: true, displayName: true },
      });

      if (voters.length !== voterIds.length) {
        const foundIds = voters.map((v) => v.id);
        const missingIds = voterIds.filter((id) => !foundIds.includes(id));
        throw new Error(
          `Some voters not found in topic: ${missingIds.join(", ")}`,
        );
      }

      // 3. 创建提案和消息（事务确保一致性）
      const proposal = await this.prisma.$transaction(async (tx) => {
        const newProposal = await tx.voteProposal.create({
          data: {
            id: proposalId,
            topicId,
            title,
            description,
            initiatorId,
            strategy: strategy as VoteStrategy,
            options: options || [],
            status: ProposalStatus.OPEN,
          },
        });

        // 4. 创建提案消息
        const optionsText =
          options && options.length > 0
            ? `\n\n**选项**：\n${options.map((opt, i) => `${i + 1}. ${opt}`).join("\n")}`
            : "";

        await tx.topicMessage.create({
          data: {
            topicId,
            aiMemberId: initiatorId,
            content: `📊 **[共识投票]**\n\n**提案**：${title}\n\n**描述**：${description}${optionsText}\n\n**策略**：${strategy}\n**投票者**：${voters.map((v) => `@${v.displayName}`).join(", ")}\n\n提案ID: \`${proposalId}\``,
            contentType: "TEXT",
            modelUsed: "system",
            tokensUsed: 0,
          },
        });

        return newProposal;
      });

      this.logger.log(
        `[createVoteProposal] Proposal ${proposal.id} created successfully`,
      );

      return {
        proposalId: proposal.id,
        status: proposal.status,
      };
    } catch (error) {
      this.logger.error(`[createVoteProposal] Failed:`, error);
      throw error;
    }
  }

  /**
   * AI成员投票（持久化到数据库）
   */
  async castMemberVote(
    proposalId: string,
    memberId: string,
    value: "APPROVE" | "REJECT" | "ABSTAIN",
    reason?: string,
    confidence?: number,
  ): Promise<{ success: boolean; statistics: VoteStatistics }> {
    this.logger.log(
      `[castMemberVote] Member ${memberId} voting ${value} on proposal ${proposalId}`,
    );

    try {
      // 1. 查询提案及其投票记录
      const proposal = await this.prisma.voteProposal.findUnique({
        where: { id: proposalId },
        include: {
          votes: true,
        },
      });

      if (!proposal) {
        throw new Error("Proposal not found");
      }

      if (proposal.status === ProposalStatus.CLOSED) {
        throw new Error("Voting is closed");
      }

      // 2. 检查是否已投票
      const existingVote = proposal.votes.find((v) => v.voterId === memberId);
      if (existingVote) {
        throw new Error("Member has already voted");
      }

      // 3. 验证投票者是否属于该话题
      const member = await this.prisma.topicAIMember.findFirst({
        where: { id: memberId, topicId: proposal.topicId },
        select: { id: true, displayName: true },
      });

      if (!member) {
        throw new Error("Member not found in topic");
      }

      // 4. 创建投票记录
      await this.prisma.voteRecord.create({
        data: {
          proposalId,
          voterId: memberId,
          value: value as VoteValue,
          reason,
          confidence,
        },
      });

      // 5. 重新查询获取最新统计
      const updatedProposal = await this.getProposalWithVotes(proposalId);
      const statistics = this.calculateStatisticsFromDb(updatedProposal!);

      this.logger.log(
        `[castMemberVote] Vote recorded: ${member.displayName} -> ${value}`,
      );

      return {
        success: true,
        statistics,
      };
    } catch (error) {
      this.logger.error(`[castMemberVote] Failed:`, error);
      throw error;
    }
  }

  /**
   * 自动收集所有AI成员的投票（使用数据库持久化）
   * 让每个AI成员基于上下文自主决定投票
   */
  async collectAIVotes(
    proposalId: string,
    voterIds: string[],
  ): Promise<VoteResult> {
    this.logger.log(
      `[collectAIVotes] Collecting votes for proposal ${proposalId}`,
    );

    try {
      // 1. 查询提案及已有投票
      const proposal = await this.getProposalWithVotes(proposalId);

      if (!proposal) {
        throw new Error("Proposal not found");
      }

      if (proposal.status === ProposalStatus.CLOSED) {
        throw new Error("Voting is already closed");
      }

      const { topicId, title, description, options } = proposal;

      // 构造投票提示词
      const votePrompt = this.buildVotePrompt(title, description, options);

      // 已投票的成员ID集合
      const votedMemberIds = new Set(proposal.votes.map((v) => v.voterId));

      // 为每个未投票的成员生成投票
      const votePromises = voterIds.map(async (memberId) => {
        // 跳过已投票的成员
        if (votedMemberIds.has(memberId)) {
          return null;
        }

        try {
          // 获取成员信息
          const member = await this.prisma.topicAIMember.findFirst({
            where: { id: memberId, topicId },
            select: { id: true, displayName: true, roleDescription: true },
          });

          if (!member) {
            this.logger.warn(`[collectAIVotes] Member ${memberId} not found`);
            return null;
          }

          // 创建投票提示消息
          const voteMessage = await this.prisma.topicMessage.create({
            data: {
              topicId,
              senderId: null,
              content: `@${member.displayName}\n\n${votePrompt}`,
              contentType: "TEXT",
            },
          });

          // 调用 AI 获取投票意见
          const response = await this.aiResponseService.generateAIResponse(
            topicId,
            "system",
            memberId,
            [voteMessage.id],
          );

          // 解析 AI 响应提取投票意见
          const vote = this.parseVoteFromResponse(response.content);

          // 持久化投票到数据库
          await this.prisma.voteRecord.create({
            data: {
              proposalId,
              voterId: memberId,
              value: vote.value as VoteValue,
              reason: vote.reason,
              confidence: vote.confidence,
            },
          });

          this.logger.log(
            `[collectAIVotes] ${member.displayName} voted: ${vote.value}`,
          );

          return {
            voterId: memberId,
            voterName: member.displayName,
            value: vote.value,
            reason: vote.reason,
          };
        } catch (error) {
          this.logger.error(
            `[collectAIVotes] Failed to get vote from member ${memberId}:`,
            error,
          );
          return null;
        }
      });

      const votes = (await Promise.all(votePromises)).filter(
        (v) => v !== null,
      ) as VoteResult["votes"];

      // 重新查询获取最新提案状态
      const updatedProposal = await this.getProposalWithVotes(proposalId);

      // 计算最终结果
      const result = this.calculateConsensusFromDb(
        updatedProposal!,
        voterIds.length,
      );

      // 关闭投票并记录结果
      await this.prisma.voteProposal.update({
        where: { id: proposalId },
        data: {
          status: ProposalStatus.CLOSED,
          closedAt: new Date(),
          decision: result.decision,
        },
      });

      return {
        success: true,
        proposalId,
        consensusReached: result.consensusReached,
        decision: result.decision,
        votes,
      };
    } catch (error) {
      this.logger.error(`[collectAIVotes] Failed:`, error);

      return {
        success: false,
        proposalId,
        consensusReached: false,
        decision: "ERROR",
        votes: [],
      };
    }
  }

  /**
   * 获取投票结果（从数据库查询）
   */
  async getVoteResult(
    proposalId: string,
    totalVoters?: number,
  ): Promise<VoteResult | null> {
    const proposal = await this.getProposalWithVotes(proposalId);

    if (!proposal) {
      return null;
    }

    const result = this.calculateConsensusFromDb(
      proposal,
      totalVoters || proposal.votes.length,
    );

    return {
      success: true,
      proposalId,
      consensusReached: result.consensusReached,
      decision: result.decision,
      votes: proposal.votes.map((v) => ({
        voterId: v.voterId,
        voterName: v.voter.displayName,
        value: v.value,
        reason: v.reason || undefined,
      })),
    };
  }

  /**
   * 获取提案状态（从数据库查询）
   */
  async getProposalStatus(proposalId: string): Promise<{
    exists: boolean;
    status?: string;
    statistics?: VoteStatistics;
  }> {
    const proposal = await this.getProposalWithVotes(proposalId);

    if (!proposal) {
      return { exists: false };
    }

    return {
      exists: true,
      status: proposal.status,
      statistics: this.calculateStatisticsFromDb(proposal),
    };
  }

  // ============================================================================
  // Database Query Helpers
  // ============================================================================

  /**
   * 查询提案及其投票记录
   */
  private async getProposalWithVotes(
    proposalId: string,
  ): Promise<ProposalWithVotes | null> {
    return this.prisma.voteProposal.findUnique({
      where: { id: proposalId },
      include: {
        votes: {
          include: {
            voter: {
              select: { id: true, displayName: true },
            },
          },
        },
        initiator: {
          select: { id: true, displayName: true },
        },
      },
    });
  }

  /**
   * 按话题查询所有提案
   */
  async getProposalsByTopic(
    topicId: string,
    status?: ProposalStatus,
  ): Promise<ProposalWithVotes[]> {
    return this.prisma.voteProposal.findMany({
      where: {
        topicId,
        ...(status && { status }),
      },
      include: {
        votes: {
          include: {
            voter: {
              select: { id: true, displayName: true },
            },
          },
        },
        initiator: {
          select: { id: true, displayName: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * 构造投票提示词（增强版 - 使用结构化输出）
   */
  private buildVotePrompt(
    title: string,
    description: string,
    options?: string[],
  ): string {
    let prompt = `请对以下提案进行投票：\n\n`;
    prompt += `**提案标题**：${title}\n\n`;
    prompt += `**提案描述**：${description}\n\n`;

    if (options && options.length > 0) {
      prompt += `**可选项**：\n${options.map((opt, i) => `${i + 1}. ${opt}`).join("\n")}\n\n`;
    }

    prompt += `请基于你的角色和专业知识，明确表达你的投票意见。\n\n`;
    prompt += `**重要**：请严格按照以下 JSON 格式回复：\n`;
    prompt += `\`\`\`json\n`;
    prompt += `{\n`;
    prompt += `  "vote": "APPROVE" | "REJECT" | "ABSTAIN",\n`;
    prompt += `  "reasoning": "你的投票理由（简洁明了）",\n`;
    prompt += `  "confidence": 0.0-1.0（你对这个决定的信心程度）\n`;
    prompt += `}\n`;
    prompt += `\`\`\`\n\n`;
    prompt += `投票选项说明：\n`;
    prompt += `- APPROVE：赞成此提案\n`;
    prompt += `- REJECT：反对此提案\n`;
    prompt += `- ABSTAIN：弃权（无法做出决定）\n`;

    return prompt;
  }

  /**
   * 从AI响应中解析投票意见（增强版 - 支持结构化 JSON 和文本回退）
   */
  private parseVoteFromResponse(content: string): {
    value: "APPROVE" | "REJECT" | "ABSTAIN";
    reason?: string;
    confidence?: number;
  } {
    // 1. 首先尝试解析 JSON 格式
    const jsonResult = this.tryParseJsonVote(content);
    if (jsonResult) {
      this.logger.debug(
        `[parseVoteFromResponse] Parsed JSON vote: ${jsonResult.value}`,
      );
      return jsonResult;
    }

    // 2. 回退到文本匹配模式
    this.logger.debug(`[parseVoteFromResponse] Falling back to text matching`);
    return this.parseVoteFromText(content);
  }

  /**
   * 尝试从响应中解析 JSON 格式的投票
   */
  private tryParseJsonVote(content: string): {
    value: "APPROVE" | "REJECT" | "ABSTAIN";
    reason?: string;
    confidence?: number;
  } | null {
    try {
      // 尝试提取 JSON 块
      const jsonPatterns = [
        /```json\s*([\s\S]*?)\s*```/i, // ```json ... ```
        /```\s*([\s\S]*?)\s*```/, // ``` ... ```
        /\{[\s\S]*?"vote"[\s\S]*?\}/, // 直接的 JSON 对象
      ];

      let jsonStr: string | null = null;

      for (const pattern of jsonPatterns) {
        const match = content.match(pattern);
        if (match) {
          jsonStr = match[1] || match[0];
          break;
        }
      }

      if (!jsonStr) {
        return null;
      }

      // 清理 JSON 字符串
      jsonStr = jsonStr.trim();
      if (!jsonStr.startsWith("{")) {
        jsonStr = "{" + jsonStr.split("{").slice(1).join("{");
      }
      if (!jsonStr.endsWith("}")) {
        jsonStr = jsonStr.split("}").slice(0, -1).join("}") + "}";
      }

      const parsed = JSON.parse(jsonStr);

      // 验证并规范化投票值
      let vote: "APPROVE" | "REJECT" | "ABSTAIN" = "ABSTAIN";
      const voteValue = (parsed.vote || "").toUpperCase();

      if (voteValue === "APPROVE" || voteValue === "赞成") {
        vote = "APPROVE";
      } else if (voteValue === "REJECT" || voteValue === "反对") {
        vote = "REJECT";
      } else if (voteValue === "ABSTAIN" || voteValue === "弃权") {
        vote = "ABSTAIN";
      }

      // 验证 confidence 范围
      let confidence = parsed.confidence;
      if (typeof confidence === "number") {
        confidence = Math.max(0, Math.min(1, confidence));
      } else {
        confidence = undefined;
      }

      return {
        value: vote,
        reason: parsed.reasoning || parsed.reason || undefined,
        confidence,
      };
    } catch (error) {
      this.logger.debug(`[tryParseJsonVote] JSON parsing failed: ${error}`);
      return null;
    }
  }

  /**
   * 从文本中解析投票（回退方法）
   */
  private parseVoteFromText(content: string): {
    value: "APPROVE" | "REJECT" | "ABSTAIN";
    reason?: string;
  } {
    // 检测投票意向 - 使用更精确的模式匹配
    let value: "APPROVE" | "REJECT" | "ABSTAIN" = "ABSTAIN";

    // 赞成关键词（按优先级排序）
    const approvePatterns = [
      /我(投)?赞成/,
      /我(的)?投票(是|为)[:：]?\s*赞成/,
      /选择\s*[:：]?\s*赞成/,
      /approve/i,
      /赞成/,
      /同意/,
      /支持/,
    ];

    // 反对关键词（按优先级排序）
    const rejectPatterns = [
      /我(投)?反对/,
      /我(的)?投票(是|为)[:：]?\s*反对/,
      /选择\s*[:：]?\s*反对/,
      /reject/i,
      /反对/,
      /拒绝/,
      /不同意/,
    ];

    // 弃权关键词
    const abstainPatterns = [
      /我(投)?弃权/,
      /我(的)?投票(是|为)[:：]?\s*弃权/,
      /选择\s*[:：]?\s*弃权/,
      /abstain/i,
      /弃权/,
      /中立/,
    ];

    // 检测顺序：先检测明确的反对，再检测赞成，最后弃权
    for (const pattern of rejectPatterns) {
      if (pattern.test(content)) {
        value = "REJECT";
        break;
      }
    }

    if (value === "ABSTAIN") {
      for (const pattern of approvePatterns) {
        if (pattern.test(content)) {
          value = "APPROVE";
          break;
        }
      }
    }

    if (value === "ABSTAIN") {
      for (const pattern of abstainPatterns) {
        if (pattern.test(content)) {
          value = "ABSTAIN";
          break;
        }
      }
    }

    // 提取理由（取前200字符）
    const reason =
      content.length > 200 ? content.substring(0, 200) + "..." : content;

    return { value, reason };
  }

  // ============================================================================
  // Statistics & Consensus Calculation (Database Version)
  // ============================================================================

  /**
   * 计算投票统计（数据库版本）
   */
  private calculateStatisticsFromDb(
    proposal: ProposalWithVotes,
    totalVoters?: number,
  ): {
    totalVoters: number;
    votesReceived: number;
    participationRate: number;
    approves: number;
    rejects: number;
    abstains: number;
  } {
    const voters = totalVoters || proposal.votes.length;
    const votesReceived = proposal.votes.length;

    const approves = proposal.votes.filter(
      (v) => v.value === VoteValue.APPROVE,
    ).length;
    const rejects = proposal.votes.filter(
      (v) => v.value === VoteValue.REJECT,
    ).length;
    const abstains = proposal.votes.filter(
      (v) => v.value === VoteValue.ABSTAIN,
    ).length;

    return {
      totalVoters: voters,
      votesReceived,
      participationRate: voters > 0 ? (votesReceived / voters) * 100 : 0,
      approves,
      rejects,
      abstains,
    };
  }

  /**
   * 计算共识结果（数据库版本）
   */
  private calculateConsensusFromDb(
    proposal: ProposalWithVotes,
    totalVoters: number,
  ): {
    consensusReached: boolean;
    decision: string;
  } {
    const stats = this.calculateStatisticsFromDb(proposal, totalVoters);
    const { approves, rejects, votesReceived } = stats;
    const { strategy } = proposal;

    let consensusReached = false;
    let decision = "REJECT";

    switch (strategy) {
      case VoteStrategy.MAJORITY:
        // 简单多数（>50%）
        consensusReached = approves > votesReceived / 2;
        decision = consensusReached ? "APPROVE" : "REJECT";
        break;

      case VoteStrategy.SUPERMAJORITY:
        // 超级多数（>66%）
        consensusReached = approves >= votesReceived * 0.667;
        decision = consensusReached ? "APPROVE" : "REJECT";
        break;

      case VoteStrategy.UNANIMOUS:
        // 全票通过
        consensusReached = approves === totalVoters;
        decision = consensusReached ? "APPROVE" : "REJECT";
        break;

      default:
        consensusReached = approves > rejects;
        decision = consensusReached ? "APPROVE" : "REJECT";
    }

    return { consensusReached, decision };
  }

  /**
   * 生成投票结果摘要
   */
  async generateVoteSummary(proposalId: string): Promise<string | null> {
    const proposal = await this.getProposalWithVotes(proposalId);

    if (!proposal) {
      return null;
    }

    const stats = this.calculateStatisticsFromDb(proposal);
    const result = this.calculateConsensusFromDb(proposal, stats.totalVoters);

    const summary = [
      `## 投票结果`,
      `**提案**: ${proposal.title}`,
      `**状态**: ${proposal.status}`,
      `**决议**: ${result.decision} (${result.consensusReached ? "达成共识" : "未达成共识"})`,
      ``,
      `### 统计`,
      `- 总投票人数: ${stats.votesReceived}/${stats.totalVoters}`,
      `- 参与率: ${stats.participationRate.toFixed(1)}%`,
      `- 赞成: ${stats.approves}`,
      `- 反对: ${stats.rejects}`,
      `- 弃权: ${stats.abstains}`,
      ``,
      `### 投票详情`,
      ...proposal.votes.map(
        (v) =>
          `- **${v.voter.displayName}**: ${v.value}${v.reason ? ` - ${v.reason}` : ""}`,
      ),
    ].join("\n");

    // 更新提案摘要到数据库
    await this.prisma.voteProposal.update({
      where: { id: proposalId },
      data: { summary },
    });

    return summary;
  }
}
