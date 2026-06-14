/**
 * AI Engine - Voting Pattern
 * 投票模式实现
 */

import { v4 as uuid } from "uuid";
import { Logger } from "@nestjs/common";
import {
  VoteRequest,
  VoteOption,
  VoteResult,
} from "../abstractions/collaborator.interface";

/**
 * 投票配置
 */
export interface VotingConfig {
  /**
   * 默认超时时间 (ms)
   */
  defaultTimeout?: number;

  /**
   * 最小参与率
   */
  minParticipationRate?: number;

  /**
   * 是否允许弃权
   */
  allowAbstain?: boolean;

  /**
   * 是否匿名投票
   */
  anonymous?: boolean;
}

/**
 * 单个投票
 */
export interface Vote {
  voterId: string;
  optionId: string;
  weight?: number;
  rank?: number[];
  timestamp: Date;
}

/**
 * 投票会话状态
 */
export interface VotingSession {
  id: string;
  request: VoteRequest;
  votes: Vote[];
  status: "open" | "closed" | "cancelled";
  result?: VoteResult;
  createdAt: Date;
  closedAt?: Date;
}

/**
 * 投票管理器
 */
export class VotingManager {
  private readonly logger = new Logger(VotingManager.name);
  private readonly config: Required<VotingConfig>;
  private readonly sessions = new Map<string, VotingSession>();

  private static readonly DEFAULT_CONFIG: Required<VotingConfig> = {
    defaultTimeout: 60000,
    minParticipationRate: 0.5,
    allowAbstain: true,
    anonymous: false,
  };

  constructor(config?: VotingConfig) {
    this.config = { ...VotingManager.DEFAULT_CONFIG, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): VotingConfig {
    return { ...this.config };
  }

  /**
   * 创建投票
   */
  createVote(request: Omit<VoteRequest, "id">): VotingSession {
    const voteId = uuid();
    const session: VotingSession = {
      id: voteId,
      request: { ...request, id: voteId },
      votes: [],
      status: "open",
      createdAt: new Date(),
    };

    this.sessions.set(voteId, session);

    this.logger.log(
      `Created voting session ${voteId}: ${request.topic} with ${request.options.length} options`,
    );

    return session;
  }

  /**
   * 投票
   */
  castVote(
    voteId: string,
    voterId: string,
    optionId: string,
    options?: { weight?: number; rank?: number[] },
  ): boolean {
    const session = this.sessions.get(voteId);
    if (!session || session.status !== "open") {
      return false;
    }

    // 检查是否已投票
    const existingVote = session.votes.find((v) => v.voterId === voterId);
    if (existingVote) {
      this.logger.warn(`Voter ${voterId} already voted in session ${voteId}`);
      return false;
    }

    // 检查选项是否有效
    const validOption = session.request.options.find((o) => o.id === optionId);
    if (!validOption && optionId !== "abstain") {
      return false;
    }

    session.votes.push({
      voterId,
      optionId,
      weight: options?.weight,
      rank: options?.rank,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Vote cast in session ${voteId}: ${voterId} -> ${optionId}`,
    );

    return true;
  }

  /**
   * 关闭投票并计算结果
   */
  closeVote(voteId: string, expectedParticipants: number): VoteResult | null {
    const session = this.sessions.get(voteId);
    if (!session || session.status !== "open") {
      return null;
    }

    session.status = "closed";
    session.closedAt = new Date();

    // 计算结果
    const result = this.calculateResult(session, expectedParticipants);
    session.result = result;

    this.logger.log(
      `Voting session ${voteId} closed. Winner: ${result.winner || "none"}, Consensus: ${result.consensus}`,
    );

    return result;
  }

  /**
   * 计算投票结果
   */
  private calculateResult(
    session: VotingSession,
    expectedParticipants: number,
  ): VoteResult {
    const { request, votes } = session;
    const tally: Record<string, number> = {};

    // 初始化计数
    for (const option of request.options) {
      tally[option.id] = 0;
    }

    // 根据策略计算
    switch (request.strategy) {
      case "majority":
        return this.calculateMajority(
          votes,
          tally,
          expectedParticipants,
          session.id,
        );

      case "unanimous":
        return this.calculateUnanimous(
          votes,
          tally,
          expectedParticipants,
          session.id,
        );

      case "weighted":
        return this.calculateWeighted(
          votes,
          tally,
          expectedParticipants,
          session.id,
        );

      case "ranked":
        return this.calculateRanked(
          votes,
          request.options,
          expectedParticipants,
          session.id,
        );

      default:
        return this.calculateMajority(
          votes,
          tally,
          expectedParticipants,
          session.id,
        );
    }
  }

  /**
   * 多数票计算
   */
  private calculateMajority(
    votes: Vote[],
    tally: Record<string, number>,
    expectedParticipants: number,
    sessionId: string,
  ): VoteResult {
    // 计票
    for (const vote of votes) {
      if (vote.optionId !== "abstain") {
        tally[vote.optionId] = (tally[vote.optionId] || 0) + 1;
      }
    }

    // 找出最高票
    let maxVotes = 0;
    let winner: string | undefined;
    for (const [optionId, count] of Object.entries(tally)) {
      if (count > maxVotes) {
        maxVotes = count;
        winner = optionId;
      }
    }

    // 检查是否达到多数
    const threshold = Math.floor(votes.length / 2) + 1;
    const consensus = maxVotes >= threshold;

    return {
      voteId: sessionId,
      winner: consensus ? winner : undefined,
      tally,
      consensus,
      participantCount: expectedParticipants,
      voteCount: votes.length,
    };
  }

  /**
   * 一致同意计算
   */
  private calculateUnanimous(
    votes: Vote[],
    tally: Record<string, number>,
    expectedParticipants: number,
    sessionId: string,
  ): VoteResult {
    // 计票
    for (const vote of votes) {
      if (vote.optionId !== "abstain") {
        tally[vote.optionId] = (tally[vote.optionId] || 0) + 1;
      }
    }

    // 检查是否全票
    const nonAbstainVotes = votes.filter((v) => v.optionId !== "abstain");
    const allSame = nonAbstainVotes.every(
      (v) => v.optionId === nonAbstainVotes[0]?.optionId,
    );

    return {
      voteId: sessionId,
      winner: allSame ? nonAbstainVotes[0]?.optionId : undefined,
      tally,
      consensus: allSame && nonAbstainVotes.length > 0,
      participantCount: expectedParticipants,
      voteCount: votes.length,
    };
  }

  /**
   * 加权投票计算
   */
  private calculateWeighted(
    votes: Vote[],
    tally: Record<string, number>,
    expectedParticipants: number,
    sessionId: string,
  ): VoteResult {
    // 加权计票
    for (const vote of votes) {
      if (vote.optionId !== "abstain") {
        const weight = vote.weight || 1;
        tally[vote.optionId] = (tally[vote.optionId] || 0) + weight;
      }
    }

    // 找出最高加权票
    let maxWeight = 0;
    let winner: string | undefined;
    for (const [optionId, weight] of Object.entries(tally)) {
      if (weight > maxWeight) {
        maxWeight = weight;
        winner = optionId;
      }
    }

    return {
      voteId: sessionId,
      winner,
      tally,
      consensus: maxWeight > 0,
      participantCount: expectedParticipants,
      voteCount: votes.length,
    };
  }

  /**
   * 排名投票计算（简化实现：仅取第一偏好，等价于 FIRST_CHOICE）
   *
   * 当前为简化实现，仅取第一选择，等价于 FIRST_CHOICE。
   * 完整的即时决选投票（IRV）需要多轮淘汰，未在此实现。
   */
  private calculateRanked(
    votes: Vote[],
    options: VoteOption[],
    expectedParticipants: number,
    sessionId: string,
  ): VoteResult {
    const tally: Record<string, number> = {};
    for (const option of options) {
      tally[option.id] = 0;
    }

    // 简化实现：使用第一选择（rank[0] 是选项的索引）
    for (const vote of votes) {
      if (vote.rank && vote.rank.length > 0) {
        const firstChoice = options[vote.rank[0]]?.id;
        if (firstChoice) {
          tally[firstChoice] = (tally[firstChoice] || 0) + 1;
        }
      }
    }

    let maxVotes = 0;
    let winner: string | undefined;
    for (const [optionId, count] of Object.entries(tally)) {
      if (count > maxVotes) {
        maxVotes = count;
        winner = optionId;
      }
    }

    return {
      voteId: sessionId,
      winner,
      tally,
      consensus: maxVotes > votes.length / 2,
      participantCount: expectedParticipants,
      voteCount: votes.length,
    };
  }

  /**
   * 获取投票会话
   */
  getSession(voteId: string): VotingSession | undefined {
    return this.sessions.get(voteId);
  }

  /**
   * 获取投票状态
   */
  getVoteStatus(voteId: string): VotingSession["status"] | null {
    const session = this.sessions.get(voteId);
    return session?.status || null;
  }

  /**
   * 取消投票
   */
  cancelVote(voteId: string): boolean {
    const session = this.sessions.get(voteId);
    if (!session || session.status !== "open") {
      return false;
    }

    session.status = "cancelled";
    session.closedAt = new Date();

    return true;
  }
}
